"""Assainissement et analyse des fichiers SVG importés.

Stratégie (liste blanche, côté serveur) :
- refus de tout DOCTYPE, déclaration d'entité ou instruction de traitement (attaques XXE / « billion laughs ») ;
- seuls les éléments graphiques de base sont conservés (pas de script, foreignObject, image, style, a, animation,
  texte) ; les attributs sont filtrés un par un (pas de on*, pas d'URL externe : seulement `url(#id)` et `href="#id"`) ;
- le résultat est re-sérialisé : c'est ce SVG normalisé qui est stocké et servi, jamais le fichier d'origine.

Convention de recoloration (documentée dans le guide) : un élément recolorable porte
`style="fill:var(--babi-<canal>, #couleur-par-défaut)"` (ou stroke / stop-color). Canaux globaux :
skin, hair, eyes (personnages) et ceux des kits modulaires (trim, glass, chrome, leaf, bark, metal, wood, line,
stone : voir taxonomy.KITS) ; canaux de calque : primary, secondary, accent. Un SVG quelconque n'est PAS recolorable :
l'atelier propose d'associer chacune de ses couleurs à un canal (`assign_channels`), sinon il est rendu tel quel.
Calques : un groupe `<g data-babi-layer="back">` de premier niveau est dessiné derrière le corps.
"""
from __future__ import annotations

import re
import xml.etree.ElementTree as ET

SVG_NS = "http://www.w3.org/2000/svg"
XLINK_NS = "http://www.w3.org/1999/xlink"

ALLOWED_ELEMENTS = {"svg", "g", "path", "circle", "ellipse", "rect", "polygon", "polyline", "line", "defs",
                    "linearGradient", "radialGradient", "stop", "pattern", "clipPath", "mask", "use", "title",
                    "desc", "symbol"}
DANGEROUS_ELEMENTS = {"script", "foreignObject", "iframe", "object", "embed", "handler", "listener"}
ALLOWED_ATTRS = {
    "id", "d", "cx", "cy", "r", "rx", "ry", "x", "y", "x1", "y1", "x2", "y2", "width", "height", "points",
    "transform", "viewBox", "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin",
    "stroke-miterlimit", "stroke-dasharray", "stroke-dashoffset", "stroke-opacity", "fill-opacity", "opacity",
    "fill-rule", "clip-rule", "clip-path", "mask", "offset", "stop-color", "stop-opacity", "gradientUnits",
    "gradientTransform", "patternUnits", "patternContentUnits", "patternTransform", "fx", "fy", "fr",
    "spreadMethod", "href", "style", "data-babi-layer", "data-babi-role", "visibility", "display",
    "preserveAspectRatio", "maskUnits", "maskContentUnits", "clipPathUnits", "vector-effect", "pathLength",
}
STYLE_PROPS = {"fill", "stroke", "stroke-width", "opacity", "fill-opacity", "stroke-opacity", "fill-rule",
               "stroke-linecap", "stroke-linejoin", "stroke-dasharray", "stop-color", "stop-opacity", "display",
               "visibility", "clip-rule"}
from .taxonomy import KIT_CHANNELS

CHANNELS = {"skin", "hair", "eyes", "primary", "secondary", "accent", *KIT_CHANNELS}
COLOR_PROPS = ("fill", "stroke", "stop-color")

MAX_ELEMENTS = 4000
MAX_VALUE = 20_000

_FORBIDDEN_MARKUP = re.compile(r"<!DOCTYPE|<!ENTITY|<\?xml-stylesheet", re.I)
_URL = re.compile(r"url\(\s*([^)]*)\)", re.I)
_LOCAL_URL = re.compile(r"^['\"]?#[A-Za-z_][\w\-.:]*['\"]?$")
_VAR = re.compile(r"^var\(\s*--babi-([a-z]+)\s*(?:,\s*(#[0-9a-fA-F]{3,8}|[a-zA-Z]+|rgba?\([^)]*\)))?\s*\)$")
_HEX = re.compile(r"^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")
_RGB = re.compile(r"^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*[\d.]+\s*)?\)$")
_ID = re.compile(r"^[A-Za-z_][\w\-.]{0,63}$")
_NUM = re.compile(r"-?\d*\.?\d+(?:[eE][-+]?\d+)?")

NAMED = {"black": "#000000", "white": "#ffffff", "red": "#ff0000", "green": "#008000", "blue": "#0000ff",
         "yellow": "#ffff00", "gray": "#808080", "grey": "#808080", "orange": "#ffa500", "brown": "#a52a2a",
         "pink": "#ffc0cb", "purple": "#800080", "navy": "#000080", "maroon": "#800000", "olive": "#808000",
         "teal": "#008080", "silver": "#c0c0c0", "gold": "#ffd700", "beige": "#f5f5dc", "tan": "#d2b48c"}


class SvgError(ValueError):
    pass


def _local(tag: str) -> tuple[str, str]:
    if tag.startswith("{"):
        ns, name = tag[1:].split("}", 1)
        return ns, name
    return "", tag


def normalize_color(v: str) -> str | None:
    v = v.strip().lower()
    if v in NAMED:
        return NAMED[v]
    m = _HEX.match(v)
    if m:
        h = m.group(1)
        return "#" + ("".join(c * 2 for c in h) if len(h) == 3 else h)
    m = _RGB.match(v)
    if m:
        r, g, b = (min(255, int(x)) for x in m.groups())
        return f"#{r:02x}{g:02x}{b:02x}"
    return None


def _safe_value(name: str, value: str, warnings: list[str]) -> str | None:
    if len(value) > MAX_VALUE:
        warnings.append(f"Attribut « {name} » trop long : retiré.")
        return None
    low = value.lower()
    if "javascript:" in low or "data:" in low or "expression(" in low or "@import" in low:
        warnings.append(f"Attribut « {name} » dangereux retiré.")
        return None
    for m in _URL.finditer(value):
        if not _LOCAL_URL.match(m.group(1).strip()):
            warnings.append(f"Référence externe retirée dans « {name} ».")
            return None
    if "var(" in low and not _VAR.match(value.strip()):
        warnings.append(f"Variable CSS non reconnue dans « {name} » : retirée.")
        return None
    return value


def _clean_style(style: str, warnings: list[str]) -> str:
    out = []
    for decl in style.split(";"):
        if ":" not in decl:
            continue
        prop, val = (s.strip() for s in decl.split(":", 1))
        prop = prop.lower()
        if prop not in STYLE_PROPS:
            continue
        val = _safe_value(f"style/{prop}", val, warnings)
        if val is None:
            continue
        m = _VAR.match(val)
        if m and m.group(1) not in CHANNELS:
            warnings.append(f"Canal de couleur inconnu : --babi-{m.group(1)} (retiré).")
            continue
        out.append(f"{prop}:{val}")
    return ";".join(out)


def parse_viewbox(v: str | None) -> list[float] | None:
    if not v:
        return None
    nums = [float(n) for n in _NUM.findall(v)]
    return nums if len(nums) == 4 else None


def sanitize(data: bytes) -> dict:
    """Retourne {svg, view_box, width, height, colors, channels, warnings, removed}. Lève SvgError."""
    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise SvgError("Le fichier SVG doit être encodé en UTF-8.") from exc
    if _FORBIDDEN_MARKUP.search(text):
        raise SvgError("DOCTYPE, entités et feuilles de style externes sont interdits dans un SVG importé.")
    try:
        root = ET.fromstring(text)
    except ET.ParseError as exc:
        raise SvgError(f"SVG illisible : {exc}") from exc
    ns, name = _local(root.tag)
    if name != "svg" or ns not in (SVG_NS, ""):
        raise SvgError("Le fichier n'est pas un document SVG (élément racine <svg> attendu).")

    warnings: list[str] = []
    removed: dict[str, int] = {}
    count = 0

    def walk(el: ET.Element, is_root: bool):
        nonlocal count
        count += 1
        if count > MAX_ELEMENTS:
            raise SvgError(f"SVG trop complexe (plus de {MAX_ELEMENTS} éléments).")
        _, tag = _local(el.tag)
        el.tag = tag
        # attributs
        for key in list(el.attrib):
            kns, kname = _local(key)
            value = el.attrib.pop(key)
            if kns == XLINK_NS and kname == "href":
                kname = "href"
            elif kns:
                continue  # autres espaces de noms (inkscape, sodipodi…) : retirés
            if kname.lower().startswith("on"):
                removed["on*"] = removed.get("on*", 0) + 1
                continue
            if kname not in ALLOWED_ATTRS or (kname == "viewBox" and not is_root):
                continue
            if kname == "href" and not _LOCAL_URL.match(value.strip()):
                warnings.append("Lien externe (href) retiré.")
                continue
            if kname == "id" and not _ID.match(value):
                continue
            if kname == "style":
                value = _clean_style(value, warnings)
                if not value:
                    continue
            else:
                value = _safe_value(kname, value, warnings)
                if value is None:
                    continue
            el.set(kname, value)
        # enfants
        for child in list(el):
            if not isinstance(child.tag, str):  # commentaires, instructions
                el.remove(child)
                continue
            cns, ctag = _local(child.tag)
            if cns not in (SVG_NS, "") or ctag not in ALLOWED_ELEMENTS:
                removed[ctag] = removed.get(ctag, 0) + 1
                el.remove(child)
                continue
            walk(child, False)
        if el.text and not el.text.strip():
            el.text = None
        if tag not in ("title", "desc"):
            el.text = None
        for child in el:
            child.tail = None

    walk(root, True)
    for tag, n in removed.items():
        if tag in DANGEROUS_ELEMENTS or tag == "on*":
            warnings.append(f"Contenu actif retiré : {tag} ({n}).")
        elif tag == "text":
            warnings.append(f"Textes retirés ({n}) : convertissez-les en tracés dans votre logiciel de dessin.")
        elif tag == "image":
            warnings.append(f"Images intégrées retirées ({n}) : seuls les tracés vectoriels sont acceptés.")
        else:
            warnings.append(f"Éléments non pris en charge retirés : <{tag}> ({n}).")

    vb = parse_viewbox(root.get("viewBox"))
    w, h = _dim(root.get("width")), _dim(root.get("height"))
    if not vb:
        if w and h:
            vb = [0.0, 0.0, w, h]
            root.set("viewBox", f"0 0 {_fmt(w)} {_fmt(h)}")
            warnings.append("viewBox absent : déduit de width/height.")
        else:
            raise SvgError("Le SVG doit définir un viewBox (ou une largeur et une hauteur).")
    if vb[2] <= 0 or vb[3] <= 0 or vb[2] > 10000 or vb[3] > 10000:
        raise SvgError("viewBox invalide : largeur et hauteur doivent être comprises entre 0 et 10 000.")
    # dimensions d'affichage retirées : c'est le viewBox qui fait foi
    root.attrib.pop("width", None)
    root.attrib.pop("height", None)
    if not len(root):
        raise SvgError("Le SVG ne contient aucun élément graphique utilisable après assainissement.")
    info = analyze_root(root)
    return {"svg": serialize(root), "view_box": vb, "width": vb[2], "height": vb[3], **info,
            "warnings": warnings, "removed": removed}


def _dim(v: str | None) -> float | None:
    if not v:
        return None
    m = _NUM.match(v.strip())
    if not m or not v.strip().replace(m.group(0), "", 1).strip() in ("", "px"):
        return None
    f = float(m.group(0))
    return f if f > 0 else None


def _fmt(f: float) -> str:
    return str(int(f)) if f == int(f) else str(f)


def serialize(root: ET.Element) -> str:
    root.set("xmlns", SVG_NS)
    s = ET.tostring(root, encoding="unicode", short_empty_elements=True)
    root.attrib.pop("xmlns", None)
    return s


def _iter_colors(el: ET.Element):
    """(propriété, valeur, source) pour chaque couleur déclarée d'un élément."""
    for p in COLOR_PROPS:
        if p in el.attrib:
            yield p, el.attrib[p], "attr"
    st = el.get("style")
    if st:
        for decl in st.split(";"):
            if ":" in decl:
                p, v = (s.strip() for s in decl.split(":", 1))
                if p in COLOR_PROPS:
                    yield p, v, "style"


def analyze_root(root: ET.Element) -> dict:
    colors: dict[str, int] = {}
    channels: dict[str, str] = {}
    for el in root.iter():
        for _, v, _src in _iter_colors(el):
            m = _VAR.match(v.strip())
            if m:
                fallback = normalize_color(m.group(2) or "") or "#999999"
                channels.setdefault(m.group(1), fallback)
                continue
            c = normalize_color(v)
            if c:
                colors[c] = colors.get(c, 0) + 1
    has_back = any(ch.get("data-babi-layer") == "back" for ch in root)
    return {"colors": dict(sorted(colors.items(), key=lambda kv: -kv[1])), "channels": channels,
            "recolorable": bool(channels), "has_back_layer": has_back}


def assign_channels(svg: str, mapping: dict[str, str]) -> dict:
    """Convertit les couleurs listées en canaux recolorables. mapping : {"#rrggbb": "primary", …}.
    Le SVG doit déjà être assaini. Retourne le même format que sanitize (svg ré-analysé)."""
    for col, ch in mapping.items():
        if ch not in CHANNELS:
            raise SvgError(f"Canal inconnu : {ch}")
        if not normalize_color(col):
            raise SvgError(f"Couleur invalide : {col}")
    norm = {normalize_color(k): v for k, v in mapping.items()}
    root = ET.fromstring(svg)
    for el in root.iter():
        el.tag = _local(el.tag)[1]
        styles = []
        for p, v, src in list(_iter_colors(el)):
            c = normalize_color(v)
            if c and c in norm:
                if src == "attr":
                    el.attrib.pop(p, None)
                styles.append((p, f"var(--babi-{norm[c]}, {c})"))
        if styles:
            st = el.get("style", "")
            decls = [d for d in st.split(";") if d.strip() and d.split(":", 1)[0].strip() not in {p for p, _ in styles}]
            decls += [f"{p}:{v}" for p, v in styles]
            el.set("style", ";".join(decls))
    vb = parse_viewbox(root.get("viewBox")) or [0, 0, 0, 0]
    return {"svg": serialize(root), "view_box": vb, "width": vb[2], "height": vb[3], **analyze_root(root), "warnings": []}


def split_layers(svg: str) -> dict:
    """Découpe un SVG assaini en {defs, back, front} (contenu interne, sans la racine) pour la composition."""
    root = ET.fromstring(svg)
    for el in root.iter():
        el.tag = _local(el.tag)[1]
    defs, back, front = [], [], []
    for child in root:
        s = ET.tostring(child, encoding="unicode", short_empty_elements=True)
        if child.tag == "defs":
            defs.append(s)
        elif child.get("data-babi-layer") == "back":
            back.append(s)
        else:
            front.append(s)
    return {"defs": "".join(defs), "back": "".join(back), "front": "".join(front)}
