"""Bibliothèque de départ des kits modulaires (bâtiments, véhicules, végétation, mobilier urbain, meubles, surfaces).

Même principe que la bibliothèque des personnages (seed_characters.py) : on sépare les COMPOSANTS, jamais les
combinaisons. Chaque kit a une base qui déclare ses points d'ancrage et des pièces indépendantes qui s'y accrochent
(voir taxonomy.KITS : repère, emplacements, positions de référence).
Couleurs : `var(--babi-<canal>, défaut)` — canaux de pièce primary / secondary / accent, canaux partagés du kit
(trim, glass, chrome, leaf, bark, metal, wood, line, stone). Ombres et lumières neutres en rgba(0,0,0,a) / rgba(255,255,255,a).
Les fichiers passent par le même import sécurisé que ceux de l'administrateur.
"""
from __future__ import annotations

import math


# ---------------------------------------------------------------- utilitaires de dessin

def F(ch: str, default: str, extra: str = "") -> str:
    return f'style="fill:var(--babi-{ch},{default}){extra}"'


def ST(ch: str, default: str, w: float, extra: str = "") -> str:
    return (f'style="fill:none;stroke:var(--babi-{ch},{default});stroke-width:{w};stroke-linecap:round;'
            f'stroke-linejoin:round{extra}"')


def SH(a: float) -> str:
    return f'style="fill:rgba(0,0,0,{a})"'


def LT(a: float) -> str:
    return f'style="fill:rgba(255,255,255,{a})"'


def SHS(a: float, w: float) -> str:
    return f'style="fill:none;stroke:rgba(0,0,0,{a});stroke-width:{w};stroke-linecap:round;stroke-linejoin:round"'


def LTS(a: float, w: float) -> str:
    return f'style="fill:none;stroke:rgba(255,255,255,{a});stroke-width:{w};stroke-linecap:round;stroke-linejoin:round"'


def n(v: float) -> str:
    return f"{v:.2f}".rstrip("0").rstrip(".")


def R(x, y, w, h, st, rx=0) -> str:
    r = f' rx="{n(rx)}"' if rx else ""
    return f'<rect x="{n(x)}" y="{n(y)}" width="{n(w)}" height="{n(h)}"{r} {st}/>'


def C(cx, cy, r, st) -> str:
    return f'<circle cx="{n(cx)}" cy="{n(cy)}" r="{n(r)}" {st}/>'


def E(cx, cy, rx, ry, st) -> str:
    return f'<ellipse cx="{n(cx)}" cy="{n(cy)}" rx="{n(rx)}" ry="{n(ry)}" {st}/>'


def P(d: str, st: str) -> str:
    return f'<path d="{d}" {st}/>'


def poly(pts, st) -> str:
    return P("M" + " L".join(f"{n(x)} {n(y)}" for x, y in pts) + " Z", st)


def svg(inner: str, vb: str) -> str:
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}">{inner}</svg>'


def rnd(seed: int):
    """Suite pseudo-aléatoire déterministe (bibliothèque identique à chaque installation)."""
    s = seed

    def nxt() -> float:
        nonlocal s
        s = (s * 1103515245 + 12345) % 2147483648
        return s / 2147483648
    return nxt


def letters(x0: float, y: float, h: float, widths, st: str, gap: float = 2.5) -> str:
    """Lettrage stylisé (blocs) : aucun texte dans un SVG importé, l'enseigne reste lisible à petite taille."""
    out, x = "", x0
    for w in widths:
        out += R(x, y, w, h, st, rx=1)
        x += w + gap
    return out


def tile(w: int, h: int, inner: str) -> str:
    return svg(inner, f"0 0 {w} {h}")


PARTS: list[dict] = []


def part(kit: str, key: str, name: str, slot: str, inner: str, vb: str, **kw) -> None:
    PARTS.append({"kit": kit, "key": f"{kit}-{key}", "name": name, "slot": slot, "svg": svg(inner, vb), **kw})


def pattern(kit: str, key: str, name: str, svg_text: str, defaults: dict) -> None:
    PARTS.append({"kit": kit, "key": f"{kit}-motif-{key}", "name": name, "slot": "pattern", "svg": svg_text, "defaults": defaults})


# ================================================================ BÂTIMENTS (0 0 200 280, sol y = 270)
BV = "0 0 200 280"


def bp(key, name, slot, inner, **kw):
    part("building", key, name, slot, inner, BV, **kw)


def building_base(levels: int) -> tuple[str, dict]:
    top = 210 - 50 * (levels - 1)
    inner = (R(30, top, 140, 270 - top, F("primary", "#e8d9b5"))
             + R(158, top, 12, 270 - top, SH(0.07))
             + R(30, 258, 140, 12, F("secondary", "#b98d5a")) + R(30, 268, 140, 2, SH(0.18)))
    for k in range(1, levels):
        y = 210 - 50 * (k - 1)
        inner += R(28, y - 3, 144, 5, F("accent", "#f4ecd8")) + R(30, y + 2, 140, 2, SH(0.08))
    inner += R(27, top - 4, 146, 6, F("accent", "#f4ecd8")) + R(30, top + 2, 140, 2, SH(0.1))
    anchors = {"roof": [[100, top]], "rooftop": [[100, top]], "door": [[100, 270]], "ground": [[100, 270]],
               "floors": [[100, 210 - 50 * (k - 1)] for k in range(1, levels)], "sign": [[100, 219]],
               "awning": [[100, 228]], "wall_side": [[158, 250]], "front": [[100, 270]]}
    return inner, anchors


for lv, key, name, defaults in [
        (1, "maison-basse", "Maison basse (rez-de-chaussée)", {"primary": "#efe2c6", "secondary": "#b98d5a", "accent": "#f7f0e0"}),
        (2, "r-plus-1", "Maison à étage (R+1)", {"primary": "#f3ead8", "secondary": "#9c6b45", "accent": "#ffffff"}),
        (3, "r-plus-2", "Petit immeuble (R+2)", {"primary": "#e3b778", "secondary": "#8a5a35", "accent": "#f4ecd8"}),
        (4, "r-plus-3", "Immeuble (R+3)", {"primary": "#d8e2dc", "secondary": "#5f7470", "accent": "#f4f7f5"})]:
    inner, anchors = building_base(lv)
    bp(key, name, "base", inner, anchors=anchors, defaults=defaults, tags=["structure", f"{lv} niveau(x)"])

_banco = (P("M30 270 L30 214 Q32 206 40 207 Q70 203 100 206 Q130 203 160 207 Q168 206 170 214 L170 270 Z", F("primary", "#c98b5a"))
          + P("M160 207 Q168 206 170 214 L170 270 L158 270 Z", SH(0.08))
          + R(30, 256, 140, 14, F("secondary", "#8a5a35")) + R(30, 268, 140, 2, SH(0.18))
          + "".join(E(x, y, 4, 2, SH(0.06)) for x, y in [(52, 226), (90, 240), (136, 222), (148, 250), (64, 248), (118, 232)]))
bp("banco", "Case en banco", "base", _banco, tags=["structure", "traditionnel"],
   defaults={"primary": "#c98b5a", "secondary": "#8a5a35"},
   anchors={"roof": [[100, 208]], "rooftop": [[100, 208]], "door": [[100, 270]], "ground": [[100, 270]], "floors": [],
            "sign": [[100, 219]], "awning": [[100, 228]], "wall_side": [[158, 250]], "front": [[100, 270]]})

# --- toitures (ancre roof : haut des murs y = 210, murs x 30–170)
_ribs = "".join(P(f"M{x} {n(212 - 46 * (1 - abs(x - 100) / 82))} L{x} 211", SHS(0.16, 1)) for x in range(28, 174, 9))
bp("toit-tole-pignon", "Toit en tôle à deux pentes", "roof",
   R(26, 209, 148, 5, SH(0.2)) + P("M18 212 L100 166 L182 212 Z", F("primary", "#8d9ba3")) + _ribs
   + P("M18 212 L100 166 L182 212", LTS(0.35, 1.5)), defaults={"primary": "#8d9ba3"})
bp("toit-appentis", "Toit en tôle ondulée (une pente)", "roof",
   P("M16 214 L184 194 L184 203 L16 223 Z", F("primary", "#9aa3a8"))
   + "".join(P(f"M{x} {n(214 - (x - 16) * 20 / 168)} L{x} {n(223 - (x - 16) * 20 / 168)}", SHS(0.2, 1)) for x in range(22, 184, 8))
   + R(30, 222, 140, 3, SH(0.15)), defaults={"primary": "#9aa3a8"})
bp("toit-tuiles", "Toit en tuiles (quatre pans)", "roof",
   P("M16 213 L52 176 L148 176 L184 213 Z", F("primary", "#b5523b"))
   + "".join(P(f"M{n(16 + (213 - y) * 36 / 37)} {y} L{n(184 - (213 - y) * 36 / 37)} {y}", SHS(0.22, 1.2)) for y in (186, 196, 206))
   + P("M52 176 L148 176", LTS(0.3, 2)) + R(26, 212, 148, 3, SH(0.2)), defaults={"primary": "#b5523b"})
bp("toit-terrasse", "Toit-terrasse avec acrotère", "roof",
   R(26, 196, 148, 16, F("primary", "#d9d2c3")) + R(26, 196, 148, 3, LT(0.35)) + R(26, 209, 148, 3, SH(0.15))
   + R(38, 206, 6, 3, SH(0.35)) + R(156, 206, 6, 3, SH(0.35)), defaults={"primary": "#d9d2c3"})
bp("toit-tropical", "Toit débordant tropical", "roof",
   R(30, 209, 140, 6, SH(0.18)) + R(12, 199, 176, 10, F("primary", "#7d5a44")) + R(12, 205, 176, 4, F("accent", "#e9dcc2"))
   + "".join(R(x, 209, 3, 4, SH(0.3)) for x in range(18, 184, 14)) + R(12, 199, 176, 2, LT(0.25)),
   defaults={"primary": "#7d5a44", "accent": "#e9dcc2"})
bp("toit-paille", "Toit de paille", "roof",
   P("M10 216 Q40 170 100 150 Q160 170 190 216 Z", F("primary", "#c9a25b"))
   + "".join(P(f"M{x} 214 L{n(100 + (x - 100) * 0.55)} {n(160 + abs(x - 100) * 0.2)}", SHS(0.16, 1)) for x in range(18, 186, 12))
   + "".join(P(f"M{x} 214 L{x + 3} 220 L{x + 6} 214", SHS(0.25, 1)) for x in range(12, 186, 6)),
   defaults={"primary": "#c9a25b"}, bases=["building-banco", "building-maison-basse"], tags=["traditionnel"])
PITCHED = ["building-toit-tole-pignon", "building-toit-appentis", "building-toit-tuiles", "building-toit-paille"]

# --- équipements de toit (posés vers y = 197)
bp("polytank", "Château d'eau (polytank)", "rooftop",
   P("M130 197 L133 184 M150 197 L147 184", ST("secondary", "#6b7378", 2.4)) + R(124, 182, 32, 4, F("secondary", "#6b7378"))
   + R(127, 158, 26, 25, F("primary", "#1f3b57"), rx=6) + R(127, 166, 26, 2, SH(0.25)) + R(127, 174, 26, 2, SH(0.25))
   + R(131, 161, 4, 19, LT(0.18), rx=2) + R(135, 154, 10, 5, F("primary", "#1f3b57"), rx=2),
   defaults={"primary": "#1f3b57", "secondary": "#6b7378"}, incompatible=PITCHED)
bp("parabole", "Antenne parabolique", "rooftop",
   R(58, 172, 3, 25, F("secondary", "#9aa3a8")) + P("M42 158 Q60 148 74 170 Q58 178 42 158 Z", F("primary", "#eef0f2"))
   + P("M42 158 Q60 148 74 170", SHS(0.2, 1)) + P("M58 164 L70 152", ST("secondary", "#9aa3a8", 1.6)),
   defaults={"primary": "#eef0f2", "secondary": "#9aa3a8"}, incompatible=PITCHED)
bp("solaire", "Panneaux solaires", "rooftop",
   "".join(P(f"M{x} 197 L{x + 8} 180 L{x + 52} 180 L{x + 44} 197 Z", F("primary", "#1d3557"))
           + P(f"M{x + 4} 188.5 L{x + 48} 188.5 M{x + 19} 180 L{x + 15} 197 M{x + 34} 180 L{x + 30} 197", LTS(0.35, 0.8)) for x in (44, 104)),
   defaults={"primary": "#1d3557"}, incompatible=PITCHED)
bp("clim-toit", "Climatiseur de toit", "rooftop",
   R(118, 178, 42, 19, F("primary", "#e3e6e8"), rx=2) + C(132, 187.5, 6.5, SH(0.25)) + C(132, 187.5, 2, F("primary", "#e3e6e8"))
   + "".join(R(144, y, 12, 1.4, SH(0.25)) for y in (182, 186, 190)) + R(118, 194, 42, 3, SH(0.12)),
   defaults={"primary": "#e3e6e8"}, incompatible=PITCHED)
bp("linge", "Corde à linge", "rooftop",
   R(40, 166, 3, 31, F("secondary", "#6b7378")) + R(157, 166, 3, 31, F("secondary", "#6b7378")) + P("M41 168 Q100 174 159 168", SHS(0.5, 1))
   + R(52, 170, 16, 18, F("primary", "#e63946")) + R(74, 171, 14, 12, F("accent", "#f1c40f")) + R(94, 171.5, 18, 22, F("primary", "#2a9d8f"))
   + R(118, 171, 12, 14, F("accent", "#ffffff")) + R(136, 170, 14, 18, F("primary", "#6a4c93")),
   defaults={"primary": "#e63946", "secondary": "#6b7378", "accent": "#f1c40f"}, incompatible=PITCHED)


# --- portes (ancre door : bas de porte y = 270, porte x 86–114)
def door_frame(w=32):
    return R(100 - w / 2, 229, w, 41, F("trim", "#2f5d62")) + R(82, 268, 36, 3, SH(0.2))


bp("porte-bois", "Porte en bois", "door",
   door_frame() + R(87, 232, 26, 38, F("primary", "#8b5a2b")) + R(90, 236, 9, 14, SH(0.12)) + R(101, 236, 9, 14, SH(0.12))
   + R(90, 254, 9, 12, SH(0.12)) + R(101, 254, 9, 12, SH(0.12)) + C(108, 252, 1.4, F("accent", "#d4a017")),
   defaults={"primary": "#8b5a2b", "accent": "#d4a017"})
bp("porte-vitree", "Porte vitrée", "door",
   door_frame() + R(87, 232, 26, 38, F("glass", "#9cc8d6")) + P("M90 266 L104 236 L108 236 L94 266 Z", LT(0.3))
   + R(99, 232, 2, 38, F("trim", "#2f5d62")) + R(104, 246, 2, 10, F("primary", "#c8ced3")), defaults={"primary": "#c8ced3"})
bp("porte-metal", "Porte métallique", "door",
   door_frame() + R(87, 232, 26, 38, F("primary", "#4a5560")) + "".join(R(87, y, 26, 1, SH(0.25)) for y in range(236, 270, 4))
   + R(106, 248, 4, 2, F("accent", "#c8ced3")), defaults={"primary": "#4a5560", "accent": "#c8ced3"})
bp("porte-arc", "Porte en arc", "door",
   P("M84 270 L84 244 Q84 226 100 226 Q116 226 116 244 L116 270 Z", F("trim", "#2f5d62"))
   + P("M87 270 L87 244 Q87 229 100 229 Q113 229 113 244 L113 270 Z", F("primary", "#6b3f2a"))
   + P("M89 242 Q89 231 100 231 Q111 231 111 242 Z", F("glass", "#9cc8d6")) + R(99, 242, 2, 28, SH(0.2))
   + C(104, 256, 1.3, F("accent", "#d4a017")) + R(82, 268, 36, 3, SH(0.2)), defaults={"primary": "#6b3f2a", "accent": "#d4a017"})
bp("porte-persiennes", "Double porte à persiennes", "door",
   door_frame(40) + R(83, 232, 16, 38, F("primary", "#3f7d6b")) + R(101, 232, 16, 38, F("primary", "#3f7d6b"))
   + "".join(R(85, y, 12, 1.4, SH(0.22)) + R(103, y, 12, 1.4, SH(0.22)) for y in range(236, 268, 4)),
   defaults={"primary": "#3f7d6b"})
bp("rideau-metallique", "Rideau métallique", "door",
   R(80, 226, 40, 5, SH(0.3)) + R(82, 230, 36, 40, F("primary", "#a6aeb3")) + "".join(R(82, y, 36, 1, SH(0.2)) for y in range(233, 268, 3))
   + R(82, 266, 36, 4, SH(0.25)), defaults={"primary": "#a6aeb3"})


# --- rez-de-chaussée (ancre ground ; fenêtres de part et d'autre de la porte : x 42–78 et 122–158)
def window(x, y, w, h, extra=""):
    return (R(x - 2, y - 2, w + 4, h + 4, F("trim", "#2f5d62")) + R(x, y, w, h, F("glass", "#9cc8d6"))
            + P(f"M{n(x + 2)} {n(y + h - 2)} L{n(x + w * 0.45)} {n(y + 2)}", LTS(0.35, 2)) + extra)


bp("rez-fenetres", "Fenêtres simples", "ground",
   "".join(window(x, 238, 32, 22, R(x + 15, 238, 2, 22, F("trim", "#2f5d62"))) + R(x - 4, 261, 40, 3, F("primary", "#efe6d2")) for x in (44, 124)),
   defaults={"primary": "#efe6d2"})
bp("rez-persiennes", "Fenêtres à persiennes", "ground",
   "".join(window(x, 238, 30, 22) + R(x - 11, 236, 10, 26, F("primary", "#3f7d6b")) + R(x + 31, 236, 10, 26, F("primary", "#3f7d6b"))
           + "".join(R(x - 10, yy, 8, 1.2, SH(0.25)) + R(x + 32, yy, 8, 1.2, SH(0.25)) for yy in range(239, 261, 4)) for x in (46, 124)),
   defaults={"primary": "#3f7d6b"})
bp("vitrines", "Vitrines de boutique", "ground",
   "".join(R(x, 230, 48, 38, F("trim", "#2f5d62")) + R(x + 3, 233, 42, 32, F("glass", "#9cc8d6"))
           + R(x + 7, 252, 8, 13, F("accent", "#e67e22")) + R(x + 18, 256, 9, 9, F("primary", "#27ae60")) + R(x + 30, 249, 9, 16, F("accent", "#c0392b"))
           + P(f"M{x + 6} 262 L{x + 22} 236 L{x + 28} 236 L{x + 12} 262 Z", LT(0.25)) for x in (34, 118)),
   defaults={"primary": "#27ae60", "accent": "#e67e22"})
bp("rez-grilles", "Fenêtres à grilles", "ground",
   "".join(window(x, 238, 32, 22) + "".join(P(f"M{xx} 238 L{xx} 260", ST("secondary", "#2b2f33", 1.4)) for xx in range(x + 4, x + 32, 5))
           + P(f"M{x} 249 L{x + 32} 249", ST("secondary", "#2b2f33", 1.4)) for x in (44, 124)),
   defaults={"secondary": "#2b2f33"})
bp("rez-claustras", "Claustras", "ground",
   "".join(R(x, 236, 38, 26, F("primary", "#f2ead8")) + "".join(P(f"M{xx} {yy - 3} L{xx + 3} {yy} L{xx} {yy + 3} L{xx - 3} {yy} Z", SH(0.32))
                                                              for xx in range(x + 5, x + 38, 7) for yy in range(241, 262, 7)) for x in (40, 122)),
   defaults={"primary": "#f2ead8"})
bp("garage", "Garage et fenêtre", "ground",
   R(34, 226, 50, 44, F("trim", "#2f5d62")) + R(37, 229, 44, 41, F("primary", "#c8ced3")) + "".join(R(37, y, 44, 1.2, SH(0.2)) for y in range(233, 270, 5))
   + window(124, 238, 32, 22) + R(120, 261, 40, 3, F("accent", "#efe6d2")), defaults={"primary": "#c8ced3", "accent": "#efe6d2"})


# --- fenêtres d'étage (ancre floors : bas d'étage y = 210, fenêtres y 170–198)
def floor_windows(fn):
    return "".join(fn(x) for x in (44, 124))


bp("fenetres", "Fenêtres simples", "windows",
   floor_windows(lambda x: window(x, 172, 30, 24, R(x + 14, 172, 2, 24, F("trim", "#2f5d62"))) + R(x - 4, 197, 38, 3, F("primary", "#efe6d2"))),
   defaults={"primary": "#efe6d2"})
bp("fenetres-persiennes", "Fenêtres à persiennes", "windows",
   floor_windows(lambda x: window(x + 2, 172, 26, 24) + R(x - 8, 170, 9, 28, F("primary", "#3f7d6b")) + R(x + 29, 170, 9, 28, F("primary", "#3f7d6b"))
                 + "".join(R(x - 7, yy, 7, 1.2, SH(0.25)) + R(x + 30, yy, 7, 1.2, SH(0.25)) for yy in range(173, 197, 4))),
   defaults={"primary": "#3f7d6b"})
bp("baie-vitree", "Baie vitrée", "windows",
   window(46, 172, 108, 24, "".join(R(x, 172, 2, 24, F("trim", "#2f5d62")) for x in (72, 99, 126))) + R(42, 197, 116, 3, F("primary", "#efe6d2")),
   defaults={"primary": "#efe6d2"})
bp("fenetres-arc", "Fenêtres en arc", "windows",
   floor_windows(lambda x: P(f"M{x - 2} 198 L{x - 2} 182 Q{x - 2} 168 {x + 15} 168 Q{x + 32} 168 {x + 32} 182 L{x + 32} 198 Z", F("trim", "#2f5d62"))
                 + P(f"M{x} 196 L{x} 182 Q{x} 171 {x + 15} 171 Q{x + 30} 171 {x + 30} 182 L{x + 30} 196 Z", F("glass", "#9cc8d6"))
                 + R(x + 14, 171, 2, 25, F("trim", "#2f5d62")) + R(x - 4, 197, 38, 3, F("primary", "#efe6d2"))),
   defaults={"primary": "#efe6d2"})
bp("claustras-etage", "Claustras d'étage", "windows",
   R(46, 172, 108, 22, F("primary", "#f2ead8")) + "".join(C(xx, yy, 2.6, SH(0.3)) for xx in range(52, 152, 8) for yy in (177, 183, 189)),
   defaults={"primary": "#f2ead8"})

# --- balcons (ancre floors)
_slab = R(38, 203, 124, 6, F("primary", "#d9d2c3")) + R(40, 209, 120, 3, SH(0.2))
bp("balcon-metal", "Balcon à garde-corps métallique", "balcony",
   _slab + P("M38 186 L162 186", ST("trim", "#2f5d62", 2)) + "".join(P(f"M{x} 186 L{x} 203", ST("trim", "#2f5d62", 1.2)) for x in range(40, 162, 7)),
   defaults={"primary": "#d9d2c3"})
bp("balcon-beton", "Balcon en béton plein", "balcony",
   _slab + R(38, 188, 124, 16, F("primary", "#d9d2c3")) + R(38, 188, 124, 3, LT(0.35)) + R(38, 201, 124, 2, SH(0.12)),
   defaults={"primary": "#d9d2c3"})
bp("balcon-balustres", "Balcon à balustres", "balcony",
   _slab + R(36, 184, 128, 4, F("primary", "#d9d2c3")) + "".join(P(f"M{x} 188 Q{x - 3} 195 {x} 203 L{x + 3} 203 Q{x + 6} 195 {x + 3} 188 Z", F("accent", "#f4ecd8")) for x in range(40, 160, 8)),
   defaults={"primary": "#d9d2c3", "accent": "#f4ecd8"})
bp("balconnets", "Balconnets fleuris", "balcony",
   "".join(R(x, 198, 42, 5, F("primary", "#d9d2c3")) + P(f"M{x} 190 L{x + 42} 190", ST("trim", "#2f5d62", 1.6))
           + "".join(P(f"M{xx} 190 L{xx} 198", ST("trim", "#2f5d62", 1)) for xx in range(x + 3, x + 42, 6))
           + "".join(C(xx, 189, 2.6, F("accent", "#d6337a")) + C(xx + 2, 191, 2, F("secondary", "#3f8f4a")) for xx in range(x + 4, x + 40, 7)) for x in (38, 120)),
   defaults={"primary": "#d9d2c3", "secondary": "#3f8f4a", "accent": "#d6337a"})

# --- équipements muraux
bp("climatiseur", "Climatiseur mural", "wall_extra",
   P("M160 255 L166 262 M180 255 L174 262", SHS(0.4, 1.5)) + R(158, 238, 26, 17, F("primary", "#e9ecef"), rx=2)
   + "".join(R(162, y, 18, 1.2, SH(0.2)) for y in (242, 246, 250)) + P("M166 255 L166 268", SHS(0.3, 1.2)), defaults={"primary": "#e9ecef"})
bp("compteur", "Compteur électrique", "wall_extra",
   P("M166 244 L166 214", SHS(0.55, 1.2)) + R(160, 244, 12, 14, F("primary", "#c9ccc6"), rx=1) + C(166, 250, 3, F("secondary", "#ffffff")),
   defaults={"primary": "#c9ccc6", "secondary": "#ffffff"})
bp("applique", "Applique lumineuse", "wall_extra",
   C(81.5, 239, 8, 'style="fill:rgba(255,236,160,0.35)"') + R(79.5, 235, 4, 8, F("primary", "#2d3436"), rx=1) + R(80.3, 237, 2.4, 4, F("secondary", "#ffe9a8")),
   anchor="door", defaults={"primary": "#2d3436", "secondary": "#ffe9a8"})
bp("plaque", "Numéro et boîte aux lettres", "wall_extra",
   R(116.5, 236, 5, 7, F("primary", "#1e3d6b"), rx=1) + R(117.5, 238, 3, 1, LT(0.8)) + R(117.5, 240, 2, 1, LT(0.8))
   + R(116, 248, 6, 8, F("secondary", "#c0392b"), rx=1), anchor="door", defaults={"primary": "#1e3d6b", "secondary": "#c0392b"})


# --- auvents (ancre awning y = 228)
def stripes_quads(x0t, x1t, x0b, x1b, yt, yb, nstripe, st_a, st_b):
    out = ""
    for i in range(nstripe):
        a, b = i / nstripe, (i + 1) / nstripe
        pts = [(x0t + (x1t - x0t) * a, yt), (x0t + (x1t - x0t) * b, yt), (x0b + (x1b - x0b) * b, yb), (x0b + (x1b - x0b) * a, yb)]
        out += poly(pts, st_a if i % 2 == 0 else st_b)
    return out


def scallops(x0, x1, y, r, st):
    return "".join(P(f"M{n(x)} {y} A{r} {r} 0 0 0 {n(x + 2 * r)} {y} Z", st) for x in [x0 + i * 2 * r for i in range(int((x1 - x0) / (2 * r)))])


bp("auvent-raye", "Auvent rayé", "awning",
   stripes_quads(34, 166, 28, 172, 224, 240, 12, F("primary", "#c0392b"), F("secondary", "#f4ecd8"))
   + scallops(28, 172, 240, 4, F("primary", "#c0392b")) + R(34, 222, 132, 3, SH(0.25)) + R(36, 245, 128, 3, SH(0.12)),
   defaults={"primary": "#c0392b", "secondary": "#f4ecd8"})
bp("auvent-feston", "Auvent festonné", "awning",
   P("M34 224 L166 224 L172 240 L28 240 Z", F("primary", "#2a9d8f")) + scallops(28, 172, 240, 4.5, F("primary", "#2a9d8f"))
   + P("M28 240 L172 240", LTS(0.4, 1.2)) + R(36, 246, 128, 3, SH(0.12)), defaults={"primary": "#2a9d8f"})
bp("auvent-tole", "Auvent en tôle", "awning",
   P("M30 222 L170 222 L176 236 L24 236 Z", F("primary", "#9aa3a8")) + "".join(P(f"M{x} 222 L{n(x + (x - 100) * 0.08)} 236", SHS(0.2, 1)) for x in range(34, 168, 8))
   + P("M40 236 L34 248 M160 236 L166 248", ST("secondary", "#4a5560", 1.6)), defaults={"primary": "#9aa3a8", "secondary": "#4a5560"})
bp("store-porte", "Store au-dessus de la porte", "awning",
   stripes_quads(80, 120, 76, 124, 224, 236, 6, F("primary", "#f4a261"), F("secondary", "#ffffff")) + scallops(76, 124, 236, 4, F("primary", "#f4a261")),
   defaults={"primary": "#f4a261", "secondary": "#ffffff"})
bp("marquise", "Marquise vitrée", "awning",
   P("M30 224 L170 224 L176 234 L24 234 Z", F("glass", "#9cc8d6", ";opacity:0.75")) + P("M24 234 L176 234 M30 224 L170 224", ST("primary", "#2d3436", 1.6))
   + "".join(P(f"M{x} 224 L{n(x + (x - 100) * 0.04)} 234", ST("primary", "#2d3436", 1)) for x in range(34, 170, 20)),
   defaults={"primary": "#2d3436"})

# --- enseignes (ancre sign y = 219 ; bandeau y 211–227) — lettrage en blocs (aucun texte importé)
bp("enseigne-caisson", "Enseigne en caisson", "sign",
   R(52, 210, 96, 18, F("primary", "#c0392b"), rx=2) + letters(60, 214, 8, [8, 6, 10, 5, 9, 7, 9], F("secondary", "#ffffff"))
   + R(52, 225, 96, 3, F("accent", "#f1c40f")), defaults={"primary": "#c0392b", "secondary": "#ffffff", "accent": "#f1c40f"})
bp("enseigne-peinte", "Enseigne peinte", "sign",
   R(46, 211, 108, 16, F("primary", "#f4e3b1")) + C(58, 219, 6, F("accent", "#e67e22")) + letters(70, 215, 8, [9, 7, 7, 11, 6, 9, 8], F("secondary", "#1e3d6b")),
   defaults={"primary": "#f4e3b1", "secondary": "#1e3d6b", "accent": "#e67e22"})
bp("enseigne-lumineuse", "Enseigne lumineuse", "sign",
   R(56, 210, 88, 18, F("primary", "#1d2a30"), rx=4) + R(56, 210, 88, 18, ST("accent", "#ff5ea8", 1.6), rx=4)
   + letters(64, 215, 8, [7, 9, 6, 8, 10, 7], F("secondary", "#f9e79f")), defaults={"primary": "#1d2a30", "secondary": "#f9e79f", "accent": "#ff5ea8"})
bp("enseigne-drapeau", "Enseigne en drapeau", "sign",
   P("M170 214 L188 214", ST("trim", "#2f5d62", 2)) + R(176, 216, 14, 26, F("primary", "#2a9d8f"), rx=2)
   + "".join(R(179, y, 8, 3, F("secondary", "#ffffff"), rx=1) for y in (220, 226, 232)), defaults={"primary": "#2a9d8f", "secondary": "#ffffff"})
bp("lettrage-mural", "Lettrage peint sur le mur", "sign",
   letters(58, 213, 10, [10, 8, 8, 12, 9, 10, 9], F("primary", "#1e3d6b"), gap=3) + R(58, 225, 86, 2, F("accent", "#e67e22")),
   defaults={"primary": "#1e3d6b", "accent": "#e67e22"})

# --- clôture et abords (ancre front y = 270 ; passage laissé devant la porte x 80–120)
bp("muret", "Muret bas", "front",
   "".join(R(x, 254, 76, 18, F("primary", "#d8cfc0")) + R(x - 2, 251, 80, 4, F("accent", "#f2ede3")) + R(x, 270, 76, 2, SH(0.2)) for x in (6, 118)),
   defaults={"primary": "#d8cfc0", "accent": "#f2ede3"})
bp("grille", "Grille en fer forgé", "front",
   "".join(R(x, 262, 76, 10, F("primary", "#d8cfc0")) + P(f"M{x} 238 L{x + 76} 238", ST("secondary", "#2b2f33", 1.6))
           + "".join(P(f"M{xx} 238 L{xx} 262", ST("secondary", "#2b2f33", 1.2)) + C(xx, 236, 1.4, F("secondary", "#2b2f33")) for xx in range(x + 3, x + 76, 6)) for x in (6, 118)),
   defaults={"primary": "#d8cfc0", "secondary": "#2b2f33"})
bp("portail", "Clôture et portail", "front",
   "".join(R(x, 236, 72, 36, F("primary", "#e9e0cf")) + R(x - 2, 233, 76, 4, F("accent", "#ffffff")) for x in (6, 122))
   + R(80, 240, 20, 32, F("secondary", "#1f6f5c")) + R(100, 240, 20, 32, F("secondary", "#1f6f5c"))
   + "".join(R(x, 243, 1.2, 26, SH(0.25)) for x in range(83, 118, 4)) + R(80, 270, 40, 2, SH(0.25)),
   defaults={"primary": "#e9e0cf", "secondary": "#1f6f5c", "accent": "#ffffff"})
bp("haie", "Haie taillée", "front",
   "".join(R(x, 252, 72, 20, F("primary", "#3f7d3a"), rx=9) + "".join(C(xx, 256, 1.5, LT(0.18)) for xx in range(x + 6, x + 70, 9)) for x in (6, 122)),
   defaults={"primary": "#3f7d3a"})
bp("marches", "Marches d'entrée", "front",
   R(80, 268, 40, 4, F("primary", "#cfc6b4")) + R(76, 272, 48, 4, F("primary", "#cfc6b4")) + R(76, 275, 48, 1.5, SH(0.25)) + R(80, 271, 40, 1, SH(0.2)),
   defaults={"primary": "#cfc6b4"})

# --- plantes devant la façade
bp("pots-fleurs", "Pots de fleurs", "greenery",
   "".join(P(f"M{x} 258 L{x + 12} 258 L{x + 10} 270 L{x + 2} 270 Z", F("secondary", "#c8693f")) + C(x + 6, 252, 7, F("primary", "#3f8f4a"))
           + C(x + 3, 249, 2.2, F("accent", "#d6337a")) + C(x + 9, 251, 2.2, F("accent", "#d6337a")) + C(x + 6, 246, 2, F("accent", "#d6337a")) for x in (66, 122)),
   defaults={"primary": "#3f8f4a", "secondary": "#c8693f", "accent": "#d6337a"})
bp("bananier", "Bananier", "greenery",
   R(14, 214, 6, 56, F("secondary", "#7b8b3a")) + P("M17 216 Q0 204 2 186 Q12 200 17 214 Z", F("primary", "#5aa04a"))
   + P("M17 214 Q30 192 46 196 Q30 206 18 218 Z", F("primary", "#5aa04a")) + P("M17 212 Q10 190 22 176 Q24 196 18 214 Z", F("primary", "#4d8f3f"))
   + P("M17 214 Q22 204 34 210", SHS(0.2, 1)), defaults={"primary": "#5aa04a", "secondary": "#7b8b3a"})
bp("bougainvillier", "Bougainvillier grimpant", "greenery",
   P("M26 270 Q22 240 34 226 Q42 214 30 200", ST("secondary", "#6b4f2a", 2.4))
   + "".join(C(x, y, r, F("primary", "#3f8f4a")) for x, y, r in [(30, 252, 6), (36, 232, 7), (28, 214, 6), (38, 206, 5)])
   + "".join(C(x, y, 2.6, F("accent", "#d6337a")) for x, y in [(26, 248), (34, 254), (40, 236), (32, 228), (24, 212), (34, 210), (42, 202), (30, 220)]),
   defaults={"primary": "#3f8f4a", "secondary": "#6b4f2a", "accent": "#d6337a"})
bp("palmier-pot", "Palmier en pot", "greenery",
   P("M176 254 L192 254 L190 270 L178 270 Z", F("secondary", "#c8693f")) + P("M184 254 L184 226", ST("secondary", "#8a6a3b", 2))
   + "".join(P(f"M184 226 Q{184 + dx * 0.6} {226 + dy * 0.4 - 6} {184 + dx} {226 + dy} Q{184 + dx * 0.5} {228 + dy * 0.4} 184 228 Z", F("primary", "#4f9a3a"))
             for dx, dy in [(-16, 8), (16, 8), (-10, -4), (10, -4), (0, -10)]),
   defaults={"primary": "#4f9a3a", "secondary": "#c8693f"})

# --- motifs de mur, d'auvent ou de clôture
pattern("building", "briques", "Briques", tile(24, 12, R(0, 0, 24, 12, F("primary", "#b5583c")) + R(0, 5.5, 24, 1, F("secondary", "#e8d9c4"))
                                             + R(0, 11.5, 24, 0.5, F("secondary", "#e8d9c4")) + R(11.5, 0, 1, 6, F("secondary", "#e8d9c4"))
                                             + R(5.5, 6, 1, 6, F("secondary", "#e8d9c4")) + R(17.5, 6, 1, 6, F("secondary", "#e8d9c4"))),
        {"primary": "#b5583c", "secondary": "#e8d9c4"})
pattern("building", "faience", "Carreaux de faïence", tile(16, 16, R(0, 0, 16, 16, F("primary", "#e8f1f2")) + R(0, 0, 16, 0.8, F("secondary", "#9cb8bd"))
                                                        + R(0, 0, 0.8, 16, F("secondary", "#9cb8bd")) + P("M8 4 L12 8 L8 12 L4 8 Z", F("accent", "#2a7f9e"))),
        {"primary": "#e8f1f2", "secondary": "#9cb8bd", "accent": "#2a7f9e"})
pattern("building", "crepi", "Crépi moucheté", tile(14, 14, R(0, 0, 14, 14, F("primary", "#efe2c6")) + C(3, 4, 0.9, F("secondary", "#d5c3a0"))
                                                   + C(10, 2, 0.7, F("secondary", "#d5c3a0")) + C(7, 9, 1, F("secondary", "#d5c3a0")) + C(12, 12, 0.8, F("secondary", "#d5c3a0"))),
        {"primary": "#efe2c6", "secondary": "#d5c3a0"})
pattern("building", "bandes", "Bandes horizontales", tile(20, 20, R(0, 0, 20, 20, F("primary", "#f3ead8")) + R(0, 0, 20, 6, F("secondary", "#2a9d8f"))),
        {"primary": "#f3ead8", "secondary": "#2a9d8f"})
pattern("building", "wax", "Inspiration wax", tile(24, 24, R(0, 0, 24, 24, F("primary", "#e67e22")) + C(12, 12, 8, F("secondary", "#1e3d6b"))
                                                   + C(12, 12, 4, F("accent", "#f1c40f")) + "".join(C(x, y, 4, F("secondary", "#1e3d6b")) for x in (0, 24) for y in (0, 24))),
        {"primary": "#e67e22", "secondary": "#1e3d6b", "accent": "#f1c40f"})
pattern("building", "kente", "Inspiration kente", tile(16, 16, R(0, 0, 16, 16, F("primary", "#f1c40f")) + R(0, 0, 16, 4, F("secondary", "#27ae60"))
                                                     + R(0, 8, 4, 8, F("accent", "#c0392b")) + R(8, 8, 4, 8, F("secondary", "#27ae60")) + R(0, 5, 16, 1, F("accent", "#c0392b"))),
        {"primary": "#f1c40f", "secondary": "#27ae60", "accent": "#c0392b"})


# ================================================================ VÉHICULES (0 0 240 140, profil avant à droite, roues y = 116)
VV = "0 0 240 140"


def vp(key, name, slot, inner, **kw):
    part("vehicle", key, name, slot, inner, VV, **kw)


def arches(*xs):
    return "".join(C(x, 116, 17, SH(0.55)) for x in xs)


def car_body(path, glass_paths, wheels, handles, extra=""):
    return (P(path, F("primary", "#2980b9")) + arches(*wheels) + "".join(P(g, F("glass", "#9cc8d6")) for g in glass_paths)
            + "".join(P(g, LTS(0.35, 1.5)) for g in glass_paths[:1])
            + "".join(R(x, 97, 8, 2.5, F("chrome", "#c8ced3"), rx=1) for x in handles) + extra)


vp("berline", "Berline", "base",
   car_body("M18 104 Q18 92 30 90 L60 88 Q78 66 100 62 L150 62 Q170 64 186 86 L212 90 Q222 92 222 104 L222 116 Q222 120 216 120 L24 120 Q18 120 18 116 Z",
            ["M66 88 Q80 70 100 67 L118 67 L118 88 Z", "M124 67 L148 67 Q164 69 178 88 L124 88 Z"], (62, 178), (100, 146),
            P("M121 90 L121 116 M70 92 L70 112", SHS(0.2, 1)) + R(28, 112, 186, 4, F("secondary", "#2b2f33")) + P("M24 96 L214 96", LTS(0.25, 1.5))
            + P("M180 84 L188 84 L186 90 L180 90 Z", F("primary", "#2980b9"))),
   defaults={"primary": "#2980b9", "secondary": "#2b2f33"},
   anchors={"wheels": [[62, 116], [178, 116]], "roof": [[120, 62]], "front": [[222, 104]], "rear": [[18, 104]], "side": [[120, 104]]})
vp("citadine", "Citadine", "base",
   car_body("M38 104 Q38 90 50 88 L66 86 Q76 64 96 60 L156 60 Q166 60 170 72 L182 88 L198 92 Q204 94 204 104 L204 116 Q204 120 198 120 L44 120 Q38 120 38 116 Z",
            ["M70 86 Q80 66 98 64 L118 64 L118 86 Z", "M124 64 L154 64 Q162 66 166 74 L176 86 L124 86 Z"], (72, 170), (100, 144),
            P("M121 88 L121 116", SHS(0.2, 1)) + R(46, 112, 152, 4, F("secondary", "#2b2f33")) + P("M44 96 L198 96", LTS(0.25, 1.5))),
   defaults={"primary": "#e63946", "secondary": "#2b2f33"},
   anchors={"wheels": [[72, 116], [170, 116]], "roof": [[124, 60]], "front": [[204, 104]], "rear": [[38, 102]], "side": [[121, 104]]})
vp("minibus", "Minibus (gbaka)", "base",
   P("M12 116 L12 56 Q12 48 22 48 L190 48 Q206 48 214 62 L226 92 Q228 96 228 104 L228 116 Q228 120 222 120 L18 120 Q12 120 12 116 Z", F("primary", "#f1c40f"))
   + arches(56, 188) + "".join(R(x, 58, 22, 22, F("glass", "#9cc8d6"), rx=2) for x in range(20, 180, 27))
   + P("M192 56 L206 58 L220 90 L192 90 Z", F("glass", "#9cc8d6")) + P("M196 62 L204 62 L214 86", LTS(0.35, 1.5))
   + R(150, 84, 26, 34, SH(0.1)) + P("M150 84 L150 118 M176 84 L176 118", SHS(0.25, 1)) + R(18, 112, 204, 4, F("secondary", "#2b2f33"))
   + P("M14 88 L226 88", SHS(0.15, 1.2)),
   defaults={"primary": "#f1c40f", "secondary": "#2b2f33"},
   anchors={"wheels": [[56, 116], [188, 116]], "roof": [[116, 48]], "front": [[224, 104]], "rear": [[20, 100]], "side": [[118, 104]]})
vp("autobus", "Autobus", "base",
   P("M4 116 L4 44 Q4 36 14 36 L224 36 Q234 36 236 48 L236 116 Q236 120 230 120 L10 120 Q4 120 4 116 Z", F("primary", "#1e6f9f"))
   + arches(46, 172, 202) + "".join(R(x, 46, 20, 26, F("glass", "#9cc8d6"), rx=2) for x in range(12, 196, 24))
   + R(212, 46, 20, 42, F("glass", "#9cc8d6"), rx=2) + R(190, 78, 18, 40, SH(0.12)) + P("M199 78 L199 118", SHS(0.25, 1))
   + R(6, 80, 228, 3, F("secondary", "#f4f1e8")) + R(10, 112, 222, 4, F("secondary", "#2b2f33")),
   defaults={"primary": "#1e6f9f", "secondary": "#f4f1e8"},
   anchors={"wheels": [[46, 116], [172, 116], [202, 116]], "roof": [[120, 36]], "front": [[224, 104]], "rear": [[14, 100]], "side": [[110, 104]]})
vp("pick-up", "Pick-up", "base",
   P("M16 92 L118 92 L118 120 L22 120 Q16 120 16 114 Z", F("primary", "#f4f1e8")) + R(16, 89, 102, 4, F("secondary", "#4a5560"))
   + P("M118 104 L118 88 L132 64 Q136 60 144 60 L176 60 Q182 60 186 66 L200 88 L214 90 Q222 92 222 104 L222 116 Q222 120 216 120 L118 120 Z", F("primary", "#f4f1e8"))
   + arches(60, 180) + P("M134 88 L142 66 L158 66 L158 88 Z", F("glass", "#9cc8d6")) + P("M162 66 L178 66 Q182 66 184 70 L194 88 L162 88 Z", F("glass", "#9cc8d6"))
   + R(170, 97, 8, 2.5, F("chrome", "#c8ced3"), rx=1) + R(22, 112, 192, 4, F("secondary", "#4a5560")) + P("M118 92 L118 120", SHS(0.25, 1)),
   defaults={"primary": "#f4f1e8", "secondary": "#4a5560"},
   anchors={"wheels": [[60, 116], [180, 116]], "roof": [[160, 60]], "front": [[222, 104]], "rear": [[16, 100]], "side": [[119, 104]]})
vp("moto", "Moto", "base",
   P("M86 116 L102 96 L130 96 L156 116", ST("secondary", "#2b2f33", 3)) + R(104, 98, 22, 14, SH(0.6), rx=3)
   + P("M112 110 L72 106", ST("chrome", "#c8ced3", 3)) + P("M96 92 L132 86 Q146 84 150 94 L120 100 Q104 102 96 92 Z", F("primary", "#c0392b"))
   + P("M80 90 Q84 84 98 86 L118 88 L112 94 L86 96 Z", F("secondary", "#2b2f33")) + P("M156 116 L146 82", ST("chrome", "#c8ced3", 3))
   + P("M140 80 L152 76", ST("secondary", "#2b2f33", 3)) + P("M100 90 Q120 86 140 88", LTS(0.3, 1.5)),
   defaults={"primary": "#c0392b", "secondary": "#2b2f33"}, tags=["deux-roues"],
   anchors={"wheels": [[86, 116], [156, 116]], "front": [[158, 90]], "rear": [[80, 94]], "side": [[124, 96]]})
CARS = ["vehicle-berline", "vehicle-citadine", "vehicle-minibus", "vehicle-autobus", "vehicle-pick-up"]

# --- roues (ancre wheels : centre 62,116, rayon 14)
TYRE = C(62, 116, 14, F("secondary", "#1f2124"))
vp("roue-acier", "Roue à jante acier", "wheels",
   TYRE + C(62, 116, 8.5, F("chrome", "#c8ced3")) + C(62, 116, 3, SH(0.35)) + "".join(C(62 + 5 * math.cos(a), 116 + 5 * math.sin(a), 0.9, SH(0.4)) for a in (0, 1.57, 3.14, 4.71))
   + P("M52 108 A13 13 0 0 1 60 103", LTS(0.25, 1.5)), defaults={"secondary": "#1f2124"})
vp("roue-alliage", "Jante alliage 5 branches", "wheels",
   TYRE + C(62, 116, 9, F("chrome", "#c8ced3")) + "".join(P(f"M62 116 L{n(62 + 8 * math.cos(a))} {n(116 + 8 * math.sin(a))}", SHS(0.45, 2.2)) for a in [i * 2 * math.pi / 5 for i in range(5)])
   + C(62, 116, 2.5, F("chrome", "#c8ced3")), defaults={"secondary": "#1f2124"})
vp("roue-enjoliveur", "Enjoliveur plein", "wheels",
   TYRE + C(62, 116, 10, F("primary", "#e9ecef")) + C(62, 116, 7, SHS(0.2, 1)) + C(62, 116, 2.5, SH(0.3)), defaults={"primary": "#e9ecef", "secondary": "#1f2124"})
vp("roue-tout-terrain", "Roue tout-terrain", "wheels",
   C(62, 116, 15, F("secondary", "#1f2124")) + "".join(P(f"M{n(62 + 12 * math.cos(a))} {n(116 + 12 * math.sin(a))} L{n(62 + 15 * math.cos(a))} {n(116 + 15 * math.sin(a))}", LTS(0.25, 2))
                                                    for a in [i * math.pi / 8 for i in range(16)])
   + C(62, 116, 8, F("primary", "#4a5560")) + C(62, 116, 2.5, F("chrome", "#c8ced3")), defaults={"primary": "#4a5560", "secondary": "#1f2124"})
vp("roue-rayons", "Roue à rayons", "wheels",
   C(62, 116, 12.5, ST("secondary", "#1f2124", 3)) + "".join(P(f"M62 116 L{n(62 + 11 * math.cos(a))} {n(116 + 11 * math.sin(a))}", ST("chrome", "#c8ced3", 0.8)) for a in [i * math.pi / 6 for i in range(12)])
   + C(62, 116, 2.5, F("chrome", "#c8ced3")), defaults={"secondary": "#1f2124"}, tags=["deux-roues"])

# --- livrées (ancre side : centre 120,104 ; bandeau x 45–195)
vp("bande", "Bande latérale", "livery", R(45, 101, 150, 6, F("primary", "#f1c40f")), defaults={"primary": "#f1c40f"}, bases=CARS)
vp("damier", "Damier de taxi", "livery",
   "".join(R(x, 98 + (6 if (i % 2) else 0), 6, 6, F("primary", "#1d2a30")) + R(x, 98 + (0 if (i % 2) else 6), 6, 6, F("secondary", "#f4f1e8"))
           for i, x in enumerate(range(45, 195, 6))), defaults={"primary": "#1d2a30", "secondary": "#f4f1e8"}, bases=CARS)
vp("double-filet", "Double filet", "livery", R(45, 99, 150, 2, F("primary", "#ffffff")) + R(45, 104, 150, 2, F("secondary", "#c0392b")),
   defaults={"primary": "#ffffff", "secondary": "#c0392b"}, bases=CARS)
vp("flammes", "Flammes", "livery",
   P("M195 104 L150 96 L162 102 L132 98 L146 104 L120 104 L146 108 L130 112 L162 108 L150 114 Z", F("primary", "#e67e22"))
   + P("M195 104 L160 100 L168 104 L150 104 L168 107 L160 110 Z", F("accent", "#f1c40f")), defaults={"primary": "#e67e22", "accent": "#f1c40f"}, bases=CARS)
vp("tricolore", "Bandeau tricolore", "livery",
   R(45, 99, 50, 10, F("primary", "#f77f00")) + R(95, 99, 50, 10, F("secondary", "#ffffff")) + R(145, 99, 50, 10, F("accent", "#009e60")),
   defaults={"primary": "#f77f00", "secondary": "#ffffff", "accent": "#009e60"}, bases=CARS)

# --- autocollants (ancre side)
vp("etoile", "Étoile", "decal", poly([(134 + 7 * math.cos(-math.pi / 2 + i * math.pi / 5) * (1 if i % 2 == 0 else 0.45),
                                       104 + 7 * math.sin(-math.pi / 2 + i * math.pi / 5) * (1 if i % 2 == 0 else 0.45)) for i in range(10)], F("primary", "#f1c40f")),
   defaults={"primary": "#f1c40f"})
vp("pastille", "Pastille ronde", "decal", C(134, 104, 6.5, F("primary", "#ffffff")) + C(134, 104, 3.5, F("secondary", "#c0392b")),
   defaults={"primary": "#ffffff", "secondary": "#c0392b"})
vp("eclair", "Éclair", "decal", poly([(136, 96), (128, 106), (134, 106), (130, 114), (140, 102), (134, 102)], F("primary", "#f1c40f")),
   defaults={"primary": "#f1c40f"})
vp("drapeau", "Drapeau", "decal", R(128, 100, 4, 8, F("primary", "#f77f00")) + R(132, 100, 4, 8, F("secondary", "#ffffff")) + R(136, 100, 4, 8, F("accent", "#009e60")),
   defaults={"primary": "#f77f00", "secondary": "#ffffff", "accent": "#009e60"})

# --- pare-chocs (ancre front 222,104)
vp("pare-chocs-chrome", "Pare-chocs chromé", "bumper", P("M212 109 L224 109 Q228 109 228 113 L228 118 L212 118 Z", F("chrome", "#c8ced3")) + R(212, 109, 16, 1.5, LT(0.4)),
   bases=CARS)
vp("pare-buffle", "Pare-buffle", "bumper", P("M218 92 L230 95 L230 120 L218 120", ST("primary", "#2b2f33", 2.6)) + P("M218 104 L230 104 M218 112 L230 112", ST("primary", "#2b2f33", 2)),
   defaults={"primary": "#2b2f33"}, bases=CARS)
vp("pare-chocs-peint", "Pare-chocs peint", "bumper", R(211, 108, 15, 12, F("primary", "#2b2f33"), rx=3), defaults={"primary": "#2b2f33"}, bases=CARS)

# --- phares (ancre front)
vp("phare-rond", "Phare rond", "lights", C(215, 98, 4, F("primary", "#fff3b0")) + C(215, 98, 4, SHS(0.3, 0.8)) + C(214, 97, 1.2, LT(0.8)),
   defaults={"primary": "#fff3b0"})
vp("phare-rectangulaire", "Phare rectangulaire", "lights", R(210, 95, 11, 6, F("primary", "#fff8d6"), rx=1.5) + R(210, 95, 11, 6, SHS(0.3, 0.8), rx=1.5),
   defaults={"primary": "#fff8d6"})
vp("phares-led", "Bandeau LED", "lights", R(204, 96, 18, 3, F("primary", "#e8f6ff"), rx=1.5) + R(202, 94.5, 22, 6, 'style="fill:rgba(232,246,255,0.35)"', rx=3),
   defaults={"primary": "#e8f6ff"})
vp("antibrouillards", "Antibrouillards", "lights", C(216, 98, 3.5, F("primary", "#fff3b0")) + C(217, 112, 2.4, F("secondary", "#ffd966")),
   defaults={"primary": "#fff3b0", "secondary": "#ffd966"})

# --- arrière (ancre rear 18,104)
vp("feux-arriere", "Feux arrière", "rear", R(18, 96, 5, 9, F("primary", "#c0392b"), rx=1.5) + R(19, 97, 2, 3, LT(0.5)), defaults={"primary": "#c0392b"})
vp("roue-secours", "Roue de secours", "rear", C(12, 102, 9, F("secondary", "#1f2124")) + C(12, 102, 4.5, F("chrome", "#c8ced3")),
   defaults={"secondary": "#1f2124"}, bases=["vehicle-minibus", "vehicle-pick-up", "vehicle-citadine"])
vp("echelle", "Échelle de toit", "rear", P("M8 40 L8 112 M15 40 L15 112", ST("chrome", "#c8ced3", 1.6)) + "".join(P(f"M8 {y} L15 {y}", ST("chrome", "#c8ced3", 1.2)) for y in range(46, 112, 8)),
   bases=["vehicle-minibus", "vehicle-autobus"])
vp("attelage", "Attelage", "rear", R(10, 112, 9, 3, F("primary", "#2b2f33")) + C(10, 113.5, 2.5, F("primary", "#2b2f33")), defaults={"primary": "#2b2f33"}, bases=CARS)

# --- toit (ancre roof 120,62)
vp("galerie", "Galerie de toit", "roof",
   R(78, 50, 84, 3, F("primary", "#2b2f33")) + R(84, 53, 3, 9, F("primary", "#2b2f33")) + R(153, 53, 3, 9, F("primary", "#2b2f33"))
   + "".join(R(x, 47, 2, 6, F("primary", "#2b2f33")) for x in (80, 100, 120, 140, 158)), defaults={"primary": "#2b2f33"})
vp("enseigne-taxi", "Enseigne de taxi", "roof",
   R(110, 59, 20, 3, SH(0.4)) + R(106, 47, 28, 13, F("primary", "#f1c40f"), rx=3) + letters(110, 51, 5, [4, 4, 4, 4], F("secondary", "#1d2a30"), gap=1.6),
   defaults={"primary": "#f1c40f", "secondary": "#1d2a30"})
vp("gyrophare", "Gyrophare", "roof",
   R(104, 58, 32, 4, SH(0.4)) + R(104, 50, 16, 9, F("primary", "#e74c3c"), rx=3) + R(120, 50, 16, 9, F("secondary", "#2e86de"), rx=3) + R(106, 51, 8, 2, LT(0.6)),
   defaults={"primary": "#e74c3c", "secondary": "#2e86de"})
vp("barres-toit", "Barres de toit", "roof", R(82, 55, 76, 2.5, F("chrome", "#c8ced3")) + R(86, 57, 3, 5, F("chrome", "#c8ced3")) + R(151, 57, 3, 5, F("chrome", "#c8ced3")))
NO_CARGO = ["vehicle-enseigne-taxi", "vehicle-gyrophare"]

# --- chargement (ancre roof ; nécessite un équipement de toit)
vp("bagages", "Bagages et valises", "cargo",
   R(84, 32, 26, 18, F("primary", "#8e5b3a"), rx=2) + R(112, 36, 22, 14, F("secondary", "#2a9d8f"), rx=2) + R(136, 30, 20, 20, F("accent", "#e9c46a"), rx=2)
   + P("M84 41 L156 41", SHS(0.4, 1.2)), defaults={"primary": "#8e5b3a", "secondary": "#2a9d8f", "accent": "#e9c46a"}, requires_slots=["roof"], incompatible=NO_CARGO)
vp("bananes", "Régimes de bananes", "cargo",
   "".join(E(x, 42 - (i % 2) * 6, 9, 6, F("primary", "#6a994e")) + P(f"M{x - 6} {42 - (i % 2) * 6} Q{x} {36 - (i % 2) * 6} {x + 6} {42 - (i % 2) * 6}", SHS(0.2, 1))
           for i, x in enumerate(range(88, 156, 12))), defaults={"primary": "#6a994e"}, requires_slots=["roof"], incompatible=NO_CARGO)
vp("sacs-riz", "Sacs de riz", "cargo",
   "".join(R(x, 36, 22, 14, F("primary", "#f2efe6"), rx=5) + R(x + 4, 41, 14, 3, F("accent", "#c0392b")) for x in (84, 108, 132))
   + R(96, 28, 22, 12, F("primary", "#f2efe6"), rx=5) + R(120, 28, 22, 12, F("primary", "#f2efe6"), rx=5),
   defaults={"primary": "#f2efe6", "accent": "#c0392b"}, requires_slots=["roof"], incompatible=NO_CARGO)
vp("matelas", "Matelas roulé", "cargo",
   R(82, 36, 76, 14, F("primary", "#2a9d8f"), rx=7) + "".join(R(x, 36, 3, 14, F("secondary", "#f4f1e8")) for x in range(90, 154, 10)),
   defaults={"primary": "#2a9d8f", "secondary": "#f4f1e8"}, requires_slots=["roof"], incompatible=NO_CARGO)
vp("bidons", "Bidons d'eau", "cargo",
   "".join(R(x, 30, 15, 20, F("primary", "#f4c430"), rx=2) + R(x + 9, 27, 4, 4, F("primary", "#f4c430")) for x in (84, 102, 120, 138)),
   defaults={"primary": "#f4c430"}, requires_slots=["roof"], incompatible=NO_CARGO)

pattern("vehicle", "damier", "Damier", tile(12, 12, R(0, 0, 12, 12, F("primary", "#f4f1e8")) + R(0, 0, 6, 6, F("secondary", "#1d2a30")) + R(6, 6, 6, 6, F("secondary", "#1d2a30"))),
        {"primary": "#f4f1e8", "secondary": "#1d2a30"})
pattern("vehicle", "wax", "Inspiration wax", tile(24, 24, R(0, 0, 24, 24, F("primary", "#f1c40f")) + C(12, 12, 7, F("secondary", "#27ae60")) + C(12, 12, 3, F("accent", "#c0392b"))),
        {"primary": "#f1c40f", "secondary": "#27ae60", "accent": "#c0392b"})
pattern("vehicle", "kente", "Inspiration kente", tile(16, 16, R(0, 0, 16, 16, F("primary", "#f1c40f")) + R(0, 0, 16, 4, F("secondary", "#27ae60")) + R(0, 8, 4, 8, F("accent", "#c0392b"))),
        {"primary": "#f1c40f", "secondary": "#27ae60", "accent": "#c0392b"})
pattern("vehicle", "rayures", "Rayures", tile(20, 20, R(0, 0, 20, 20, F("primary", "#e67e22")) + R(0, 0, 20, 7, F("secondary", "#ffffff"))),
        {"primary": "#e67e22", "secondary": "#ffffff"})
pattern("vehicle", "pois", "Pois", tile(16, 16, R(0, 0, 16, 16, F("primary", "#1e6f9f")) + C(8, 8, 3, F("secondary", "#ffffff"))),
        {"primary": "#1e6f9f", "secondary": "#ffffff"})


# ================================================================ VÉGÉTATION (0 0 160 220, sol y = 210, couronne de référence 80,110)
GV = "0 0 160 220"


def gp(key, name, slot, inner, **kw):
    part("vegetation", key, name, slot, inner, GV, **kw)


gp("tronc-droit", "Tronc droit", "base",
   P("M70 210 Q74 196 75 170 L76 110 L84 110 L85 170 Q86 196 90 210 Z", F("bark", "#7a5236"))
   + P("M80 110 L84 110 L85 170 Q86 196 90 210 L80 210 Z", SH(0.15)) + P("M77 140 L78 156 M82 172 L81 190 M78 196 L77 206", SHS(0.25, 1))
   + P("M64 210 Q72 206 76 200 M96 210 Q88 206 84 200", ST("bark", "#7a5236", 3)),
   anchors={"crown": [[80, 110]], "ground": [[80, 210]]})
gp("jeune-arbre", "Jeune arbre tuteuré", "base",
   P("M78 210 L78.5 130 L81.5 130 L82 210 Z", F("bark", "#7a5236")) + R(86, 150, 2.5, 60, F("primary", "#c9a46a"))
   + P("M80 160 L87 158 M80 186 L87 184", ST("primary", "#c9a46a", 1.4)), defaults={"primary": "#c9a46a"},
   anchors={"crown": [[80, 130]], "ground": [[80, 210]]})
gp("tronc-palmier", "Tronc de palmier", "base",
   P("M74 210 Q72 150 80 100 Q84 76 86 62 L92 62 Q90 78 87 102 Q80 150 86 210 Z", F("bark", "#8a6a3b"))
   + "".join(P(f"M{n(73 + (210 - y) * 0.09)} {y} L{n(86 + (210 - y) * 0.03)} {y - 2}", SHS(0.25, 1.2)) for y in range(204, 70, -9)),
   anchors={"crown": [[89, 62]], "ground": [[80, 210]]}, tags=["palmier"])
gp("tronc-fromager", "Grand tronc (fromager)", "base",
   P("M50 210 Q66 200 70 180 L72 96 L88 96 L90 180 Q94 200 110 210 Q94 206 87 198 L80 210 L73 198 Q66 206 50 210 Z", F("bark", "#8a7a68"))
   + P("M80 96 L88 96 L90 180 Q94 200 110 210 Q94 206 87 198 L80 210 Z", SH(0.12)) + P("M76 120 L75 170 M84 130 L85 176", SHS(0.2, 1.2)),
   anchors={"crown": [[80, 96]], "ground": [[80, 210]]})
gp("touffe", "Touffe (buisson)", "base",
   P("M80 210 L66 186 M80 210 L80 180 M80 210 L94 186", ST("bark", "#6b4f2a", 2.4)), anchors={"crown": [[80, 180]], "ground": [[80, 210]]}, tags=["buisson"])
TREES = ["vegetation-tronc-droit", "vegetation-jeune-arbre", "vegetation-tronc-fromager"]
PALM = ["vegetation-tronc-palmier"]
BUSH = ["vegetation-touffe"]

LEAF = F("leaf", "#3f8f4a")
gp("feuillage-rond", "Feuillage rond", "canopy",
   "".join(C(x, y, r, LEAF) for x, y, r in [(80, 80, 36), (56, 92, 24), (104, 92, 24), (68, 58, 22), (94, 60, 22)])
   + C(94, 98, 18, SH(0.12)) + C(66, 62, 9, LT(0.18)) + C(88, 54, 6, LT(0.14)), bases=TREES)
gp("feuillage-etale", "Feuillage étalé (flamboyant)", "canopy",
   E(80, 86, 66, 18, LEAF) + "".join(C(x, y, r, LEAF) for x, y, r in [(30, 80, 14), (52, 72, 18), (80, 66, 20), (108, 72, 18), (130, 80, 14)])
   + E(80, 98, 58, 7, SH(0.15)) + C(70, 64, 7, LT(0.15)), bases=TREES)
gp("feuillage-conique", "Feuillage conique", "canopy",
   P("M80 18 Q104 70 108 112 Q80 122 52 112 Q56 70 80 18 Z", LEAF) + P("M64 62 Q80 70 96 62 M58 88 Q80 98 102 88", SHS(0.15, 1.5))
   + P("M80 24 Q90 60 92 104 Q86 108 80 108 Z", SH(0.1)), bases=TREES)


def fronds(cx, cy, specs, st):
    out = ""
    for dx, dy, bend in specs:
        mx, my = cx + dx * 0.5, cy + dy * 0.5 - bend
        out += P(f"M{cx} {cy} Q{n(mx)} {n(my)} {n(cx + dx)} {n(cy + dy)} Q{n(mx)} {n(my + 8)} {cx} {cy + 3} Z", st)
        out += P(f"M{cx} {cy} Q{n(mx)} {n(my + 3)} {n(cx + dx)} {n(cy + dy)}", SHS(0.2, 1))
    return out


gp("palmes-cocotier", "Palmes de cocotier", "canopy",
   fronds(80, 110, [(-62, 18, 22), (62, 18, 22), (-46, -26, 10), (46, -26, 10), (-24, -44, 4), (24, -44, 4), (-56, 40, 6), (56, 40, 6)], LEAF), bases=PALM)
gp("palmes-huile", "Palmes de palmier à huile", "canopy",
   fronds(80, 110, [(-60, 36, 30), (60, 36, 30), (-50, 4, 26), (50, 4, 26), (-30, -30, 14), (30, -30, 14), (0, -46, 0)], LEAF), bases=PALM)
gp("buisson-rond", "Buisson arrondi", "canopy",
   "".join(C(x, y, r, LEAF) for x, y, r in [(80, 104, 24), (62, 112, 16), (98, 112, 16)]) + C(72, 96, 7, LT(0.16)) + E(80, 124, 30, 4, SH(0.15)), bases=BUSH)
gp("haie-taillee", "Massif taillé", "canopy",
   R(50, 92, 60, 32, LEAF, rx=10) + R(50, 92, 60, 6, LT(0.12), rx=3) + R(50, 118, 60, 6, SH(0.12), rx=3), bases=BUSH)

gp("fleurs-rouges", "Fleurs rouges", "blossom",
   "".join(C(x, y, 3, F("primary", "#e63946")) for x, y in [(50, 70), (62, 58), (78, 52), (96, 56), (110, 68), (44, 86), (66, 78), (88, 74), (104, 86), (58, 98), (80, 92), (98, 100), (120, 82), (72, 64)]),
   defaults={"primary": "#e63946"}, bases=TREES)
gp("mangues", "Mangues", "blossom",
   "".join(P(f"M{x} {y - 8} L{x} {y - 4}", SHS(0.4, 1)) + E(x, y, 3.2, 4.4, F("primary", "#f4a261")) for x, y in [(56, 108), (72, 114), (92, 112), (106, 104), (64, 96), (98, 92)]),
   defaults={"primary": "#f4a261"}, bases=["vegetation-tronc-droit", "vegetation-tronc-fromager"])
gp("noix-coco", "Noix de coco", "blossom",
   "".join(C(x, y, 5, F("primary", "#6b4f2a")) for x, y in [(74, 116), (86, 116), (80, 122), (70, 123), (90, 123)]) + C(78, 114, 1.5, LT(0.3)),
   defaults={"primary": "#6b4f2a"}, bases=PALM)
gp("bougainvillier", "Fleurs de bougainvillier", "blossom",
   "".join(C(x + dx, y + dy, 2.4, F("primary", "#d6337a")) for x, y in [(60, 96), (90, 92), (76, 106), (100, 108), (58, 112)] for dx, dy in [(0, 0), (3, 2), (-2, 3)]),
   defaults={"primary": "#d6337a"}, bases=TREES + BUSH)
gp("frangipanier", "Fleurs de frangipanier", "blossom",
   "".join("".join(C(x + 2.6 * math.cos(a), y + 2.6 * math.sin(a), 2, F("primary", "#fdf6e3")) for a in (0, 1.26, 2.51, 3.77, 5.03)) + C(x, y, 1.4, F("accent", "#f4c430"))
           for x, y in [(54, 74), (78, 58), (102, 70), (66, 94), (96, 96)]), defaults={"primary": "#fdf6e3", "accent": "#f4c430"}, bases=TREES)

gp("pot", "Pot en terre cuite", "planter",
   P("M62 186 L98 186 L94 212 L66 212 Z", F("primary", "#c8693f")) + R(60, 183, 40, 6, F("primary", "#c8693f")) + R(60, 183, 40, 2, LT(0.2)) + P("M80 189 L94 189 L91 212 L80 212 Z", SH(0.12)),
   defaults={"primary": "#c8693f"})
gp("bac-beton", "Bac en béton", "planter",
   R(50, 190, 60, 22, F("primary", "#b9b4a8")) + R(50, 190, 60, 3, LT(0.3)) + R(80, 193, 30, 19, SH(0.1)), defaults={"primary": "#b9b4a8"})
gp("cercle-pierres", "Cercle de pierres", "planter",
   "".join(E(x, 207 + (i % 2), 6, 4, F("primary", "#9a948a")) + E(x - 1, 206, 2, 1, LT(0.25)) for i, x in enumerate(range(52, 112, 10))), defaults={"primary": "#9a948a"})
gp("pneu-peint", "Pneu peint", "planter",
   E(80, 204, 28, 9, F("primary", "#e63946")) + E(80, 202.5, 16, 5, SH(0.6)) + E(80, 206, 28, 9, SHS(0.2, 1)), defaults={"primary": "#e63946"})
gp("grille-arbre", "Grille d'arbre", "planter",
   E(80, 207, 30, 6, F("primary", "#4a5560")) + "".join(P(f"M{n(80 + 12 * math.cos(a))} {n(207 + 2.4 * math.sin(a))} L{n(80 + 27 * math.cos(a))} {n(207 + 5.4 * math.sin(a))}", LTS(0.3, 1))
                                                       for a in [i * math.pi / 8 for i in range(16)]), defaults={"primary": "#4a5560"})

gp("herbes-hautes", "Herbes hautes", "ground_cover",
   "".join(P(f"M{x} 210 Q{x - 3} 200 {x - 5} {194 + (i % 3) * 3} M{x} 210 Q{x + 1} 198 {x + 2} {192 + (i % 2) * 4} M{x} 210 Q{x + 4} 202 {x + 7} 198", ST("primary", "#5a9e4b", 1.6))
           for i, x in enumerate(range(46, 118, 9))), defaults={"primary": "#5a9e4b"})
gp("fleurs-sol", "Fleurs au sol", "ground_cover",
   "".join(P(f"M{x} 210 L{x} 202", ST("accent", "#3f8f4a", 1.2)) + C(x, 201, 2.4, F("primary" if i % 2 else "secondary", "#f4c430" if i % 2 else "#e63946"))
           for i, x in enumerate(range(48, 116, 8))), defaults={"primary": "#f4c430", "secondary": "#e63946", "accent": "#3f8f4a"})
gp("feuilles-mortes", "Feuilles mortes", "ground_cover",
   "".join(E(x, 208 - (i % 2) * 2, 3.6, 1.6, F("primary" if i % 2 else "secondary", "#c97b3a" if i % 2 else "#8b5a2b")) for i, x in enumerate(range(44, 120, 7))),
   defaults={"primary": "#c97b3a", "secondary": "#8b5a2b"})
gp("cailloux", "Cailloux", "ground_cover",
   "".join(E(x, 208, 3 + (i % 3), 2 + (i % 2), F("primary", "#9a948a")) for i, x in enumerate(range(50, 114, 9))), defaults={"primary": "#9a948a"})

pattern("vegetation", "rayures", "Rayures", tile(20, 20, R(0, 0, 20, 20, F("primary", "#c8693f")) + R(0, 0, 20, 6, F("secondary", "#f4ecd8"))),
        {"primary": "#c8693f", "secondary": "#f4ecd8"})
pattern("vegetation", "wax", "Inspiration wax", tile(24, 24, R(0, 0, 24, 24, F("primary", "#e67e22")) + C(12, 12, 7, F("secondary", "#1e3d6b")) + C(12, 12, 3, F("accent", "#f1c40f"))),
        {"primary": "#e67e22", "secondary": "#1e3d6b", "accent": "#f1c40f"})
pattern("vegetation", "pois", "Pois", tile(16, 16, R(0, 0, 16, 16, F("primary", "#2a9d8f")) + C(8, 8, 3, F("secondary", "#ffffff"))), {"primary": "#2a9d8f", "secondary": "#ffffff"})


# ================================================================ MOBILIER URBAIN ET ÉTALS (0 0 160 220, sol y = 210)
UV = "0 0 160 220"


def up(key, name, slot, inner, **kw):
    part("street", key, name, slot, inner, UV, **kw)


MET = F("metal", "#4a5560")
WOOD = F("wood", "#a0703c")
up("poteau-haut", "Poteau haut (lampadaire)", "base",
   R(77, 40, 6, 170, MET) + R(78, 42, 1.4, 150, LT(0.22)) + R(71, 198, 18, 12, MET) + R(73, 194, 14, 4, MET),
   anchors={"head": [[80, 40]], "mid": [[80, 130]], "side": [[128, 210]]})
up("poteau-court", "Poteau court (signalisation)", "base",
   R(78, 92, 4, 118, MET) + R(78.6, 94, 1, 110, LT(0.22)) + R(74, 204, 12, 6, MET),
   anchors={"head": [[80, 92]], "mid": [[80, 150]], "side": [[128, 210]]})
up("banc", "Banc (structure)", "base",
   R(30, 172, 6, 38, MET) + R(124, 172, 6, 38, MET) + R(30, 134, 4, 40, MET) + R(126, 134, 4, 40, MET) + R(26, 206, 14, 4, MET) + R(120, 206, 14, 4, MET),
   anchors={"seat": [[80, 172]], "side": [[140, 210]]})
up("etal", "Étal de marché", "base",
   R(18, 60, 3, 100, WOOD) + R(139, 60, 3, 100, WOOD) + R(16, 156, 128, 6, WOOD) + R(18, 162, 124, 12, F("primary", "#d9c7a0"))
   + R(22, 162, 4, 48, WOOD) + R(134, 162, 4, 48, WOOD) + R(18, 172, 124, 2, SH(0.15)),
   defaults={"primary": "#d9c7a0"}, anchors={"counter": [[80, 156]], "canopy": [[80, 60]], "side": [[140, 210]]})
up("abribus", "Abribus", "base",
   R(19, 92, 122, 92, LT(0.3)) + R(19, 92, 122, 92, SHS(0.25, 1)) + R(14, 58, 5, 152, MET) + R(141, 58, 5, 152, MET) + R(19, 132, 122, 2, SH(0.12)),
   anchors={"canopy": [[80, 56]], "seat": [[80, 180]], "side": [[140, 210]]})

up("lanterne", "Lanterne classique", "head",
   C(80, 30, 14, 'style="fill:rgba(255,236,160,0.35)"') + P("M72 40 L88 40 L92 22 L68 22 Z", F("primary", "#2d3436"))
   + R(72, 24, 16, 14, F("secondary", "#ffe9a8")) + P("M66 22 L94 22 L80 12 Z", F("primary", "#2d3436")) + R(79, 24, 2, 14, F("primary", "#2d3436")),
   defaults={"primary": "#2d3436", "secondary": "#ffe9a8"})
up("tete-led", "Tête LED moderne", "head",
   R(80, 38, 28, 3, F("primary", "#4a5560")) + R(104, 35, 24, 6, F("primary", "#4a5560"), rx=2) + R(106, 41, 20, 1.6, F("secondary", "#e8f6ff"))
   + P("M106 43 L100 60 L132 60 L126 43 Z", 'style="fill:rgba(232,246,255,0.25)"'), defaults={"primary": "#4a5560", "secondary": "#e8f6ff"})
up("double-lanterne", "Double lanterne", "head",
   P("M80 42 Q80 30 64 30 L56 30 M80 42 Q80 30 96 30 L104 30", ST("primary", "#2d3436", 2.4))
   + "".join(R(x, 30, 10, 12, F("secondary", "#ffe9a8")) + P(f"M{x - 2} 30 L{x + 12} 30 L{x + 5} 24 Z", F("primary", "#2d3436")) + C(x + 5, 36, 10, 'style="fill:rgba(255,236,160,0.3)"') for x in (51, 99)),
   defaults={"primary": "#2d3436", "secondary": "#ffe9a8"})
up("stop", "Panneau stop", "head",
   poly([(80 + 13 * math.cos(math.pi / 8 + i * math.pi / 4), 26 + 13 * math.sin(math.pi / 8 + i * math.pi / 4)) for i in range(8)], F("primary", "#c0392b"))
   + poly([(80 + 11 * math.cos(math.pi / 8 + i * math.pi / 4), 26 + 11 * math.sin(math.pi / 8 + i * math.pi / 4)) for i in range(8)], LTS(0.9, 1))
   + R(71, 24, 18, 4, F("secondary", "#ffffff")), defaults={"primary": "#c0392b", "secondary": "#ffffff"})
up("direction", "Panneau de direction", "head",
   P("M80 18 L112 18 L118 24 L112 30 L80 30 Z", F("primary", "#1e6f3e")) + P("M80 34 L48 34 L42 40 L48 46 L80 46 Z", F("secondary", "#1e3d6b"))
   + letters(84, 22, 4, [6, 5, 8, 6], LT(0.85), gap=1.5) + letters(52, 38, 4, [7, 5, 6, 5], LT(0.85), gap=1.5),
   defaults={"primary": "#1e6f3e", "secondary": "#1e3d6b"})
up("feu-tricolore", "Feu tricolore", "head",
   R(72, 4, 16, 38, F("primary", "#222831"), rx=3) + C(80, 12, 4, F("secondary", "#e74c3c")) + C(80, 23, 4, SH(0.5)) + C(80, 34, 4, F("accent", "#2ecc71")),
   defaults={"primary": "#222831", "secondary": "#e74c3c", "accent": "#2ecc71"})
up("horloge", "Horloge", "head",
   C(80, 24, 13, F("primary", "#2d3436")) + C(80, 24, 10, F("secondary", "#fdf6e3")) + P("M80 24 L80 17 M80 24 L85 27", SHS(0.8, 1.4)), defaults={"primary": "#2d3436", "secondary": "#fdf6e3"})


def wedges(apex, x0, x1, y, k, st_a, st_b):
    out = ""
    for i in range(k):
        a, b = x0 + (x1 - x0) * i / k, x0 + (x1 - x0) * (i + 1) / k
        out += poly([apex, (a, y), (b, y)], st_a if i % 2 == 0 else st_b)
    return out


up("parasol", "Parasol rayé", "canopy",
   wedges((80, 26), 10, 150, 64, 8, F("primary", "#e63946"), F("secondary", "#f4f1e8")) + scallops(10, 150, 64, 4.375, F("primary", "#e63946"))
   + C(80, 24, 2.5, F("primary", "#e63946")), defaults={"primary": "#e63946", "secondary": "#f4f1e8"})
up("bache", "Bâche tendue", "canopy",
   R(10, 52, 140, 10, F("primary", "#2a9d8f")) + scallops(10, 150, 62, 5, F("primary", "#2a9d8f")) + P("M10 52 L150 52", LTS(0.4, 1.2)) + R(10, 60, 140, 2, SH(0.12)),
   defaults={"primary": "#2a9d8f"})
up("toit-tole", "Toit de tôle", "canopy",
   P("M8 66 L152 52 L152 59 L8 73 Z", F("primary", "#9aa3a8")) + "".join(P(f"M{x} {n(66 - (x - 8) * 14 / 144)} L{x} {n(73 - (x - 8) * 14 / 144)}", SHS(0.2, 1)) for x in range(12, 152, 8)),
   defaults={"primary": "#9aa3a8"})
up("toit-abribus", "Toit d'abribus vitré", "canopy",
   R(6, 50, 148, 8, F("primary", "#4a5560")) + R(10, 44, 140, 6, LT(0.45)) + R(10, 44, 140, 6, SHS(0.2, 0.8)) + R(6, 56, 148, 2, SH(0.2)),
   defaults={"primary": "#4a5560"}, bases=["street-abribus"])
up("parasol-pub", "Parasol publicitaire", "canopy",
   poly([(14, 64), (80, 30), (146, 64)], F("primary", "#f1c40f")) + R(14, 64, 132, 7, F("secondary", "#c0392b"))
   + letters(40, 66, 3, [10, 8, 12, 9, 10], LT(0.85), gap=4) + C(80, 28, 2.5, F("secondary", "#c0392b")), defaults={"primary": "#f1c40f", "secondary": "#c0392b"})

up("lattes-bois", "Lattes de bois", "seat",
   R(24, 164, 112, 3.5, WOOD) + R(24, 168.5, 112, 3.5, WOOD) + "".join(R(26, y, 108, 4, WOOD) + R(26, y + 3, 108, 1, SH(0.2)) for y in (140, 147, 154)))
up("assise-beton", "Assise en béton", "seat", R(22, 162, 116, 10, F("primary", "#b9b4a8")) + R(22, 162, 116, 2, LT(0.3)) + R(22, 170, 116, 2, SH(0.15)),
   defaults={"primary": "#b9b4a8"})
up("assise-perforee", "Assise métallique perforée", "seat",
   R(24, 163, 112, 8, F("primary", "#2f6f8f"), rx=2) + R(26, 140, 108, 18, F("primary", "#2f6f8f"), rx=2)
   + "".join(C(x, y, 1, SH(0.35)) for x in range(30, 132, 5) for y in (144, 149, 154, 167)), defaults={"primary": "#2f6f8f"})
up("coussins", "Coussins colorés", "seat",
   R(24, 166, 112, 6, WOOD) + "".join(R(x, 156, 32, 11, F(ch, d), rx=4) for x, ch, d in [(28, "primary", "#e76f51"), (64, "secondary", "#2a9d8f"), (100, "accent", "#e9c46a")]),
   defaults={"primary": "#e76f51", "secondary": "#2a9d8f", "accent": "#e9c46a"})

up("fruits", "Fruits (oranges, bananes)", "goods",
   "".join(C(x, y, 5, F("primary", "#f39c12")) for x, y in [(32, 155), (42, 155), (52, 155), (62, 155), (37, 147), (47, 147), (57, 147), (42, 139), (52, 139)])
   + "".join(P(f"M{x} 158 Q{x + 6} 140 {x + 16} 138 Q{x + 8} 146 {x + 4} 158 Z", F("secondary", "#f4d03f")) for x in (88, 100, 112)),
   defaults={"primary": "#f39c12", "secondary": "#f4d03f"})
up("poisson-fume", "Poisson fumé", "goods",
   "".join(R(x, 154, 48, 6, F("secondary", "#c9a46a"), rx=2) + "".join(E(xx, 151, 7, 3, F("primary", "#8b5a2b")) + P(f"M{xx + 7} 151 L{xx + 11} 148 L{xx + 11} 154 Z", F("primary", "#8b5a2b"))
                                                                     for xx in (x + 8, x + 24, x + 38) if xx + 11 <= x + 50) for x in (24, 86)),
   defaults={"primary": "#8b5a2b", "secondary": "#c9a46a"})
up("pagnes", "Pagnes pliés", "goods",
   "".join("".join(R(x, 156 - (j + 1) * 5, 42, 5, F(["primary", "secondary", "accent"][j % 3], ["#e76f51", "#2a9d8f", "#f1c40f"][j % 3])) for j in range(5)) for x in (28, 90)),
   defaults={"primary": "#e76f51", "secondary": "#2a9d8f", "accent": "#f1c40f"})
up("boissons", "Bouteilles et boissons", "goods",
   "".join(R(x, 138, 6, 22, F("primary" if i % 2 else "accent", "#c0392b" if i % 2 else "#27ae60"), rx=2) + R(x + 1.5, 134, 3, 5, F("secondary", "#2d3436")) + R(x + 1, 142, 1.4, 12, LT(0.3))
           for i, x in enumerate(range(30, 132, 12))), defaults={"primary": "#c0392b", "secondary": "#2d3436", "accent": "#27ae60"})
up("legumes", "Légumes (tomates, piments)", "goods",
   E(50, 155, 22, 5, F("secondary", "#6c7a89")) + "".join(C(x, 150, 4, F("primary", "#e74c3c")) for x in range(34, 68, 7))
   + E(110, 155, 22, 5, F("secondary", "#6c7a89")) + "".join(E(x, 150, 2, 4, F("accent", "#27ae60")) for x in range(94, 128, 5)),
   defaults={"primary": "#e74c3c", "secondary": "#6c7a89", "accent": "#27ae60"})

up("poubelle-poteau", "Poubelle accrochée", "attachment",
   R(83, 126, 4, 3, MET) + R(87, 122, 14, 18, F("primary", "#2e7d32"), rx=2) + R(86, 120, 16, 3, F("primary", "#2e7d32")) + R(87, 130, 14, 2, SH(0.2)),
   defaults={"primary": "#2e7d32"})
up("affiche", "Affiche", "attachment",
   R(66, 112, 28, 36, F("primary", "#f4e3b1")) + R(70, 116, 20, 12, F("secondary", "#e76f51")) + letters(70, 132, 3, [8, 6, 5], F("accent", "#1e3d6b"), gap=1.5)
   + letters(70, 138, 3, [6, 9], F("accent", "#1e3d6b"), gap=1.5), defaults={"primary": "#f4e3b1", "secondary": "#e76f51", "accent": "#1e3d6b"})
up("fanion", "Fanion", "attachment",
   P("M83 104 L83 120", ST("primary", "#2d3436", 1.4)) + poly([(83, 104), (110, 109), (83, 116)], F("secondary", "#f77f00")),
   defaults={"primary": "#2d3436", "secondary": "#f77f00"})
up("pot-suspendu", "Pot de fleurs suspendu", "attachment",
   P("M83 118 L96 118 M90 118 L86 128 M90 118 L94 128", ST("primary", "#2d3436", 1)) + P("M84 128 L96 128 L94 136 L86 136 Z", F("secondary", "#c8693f"))
   + C(87, 126, 3, F("accent", "#3f8f4a")) + C(93, 125, 3, F("accent", "#3f8f4a")) + C(90, 123, 2, F("primary", "#d6337a")),
   defaults={"primary": "#d6337a", "secondary": "#c8693f", "accent": "#3f8f4a"})

up("poubelle-sol", "Poubelle au sol", "ground",
   P("M118 182 L138 182 L136 210 L120 210 Z", F("primary", "#2e7d32")) + R(116, 178, 24, 5, F("primary", "#2e7d32"), rx=2) + R(128, 182, 8, 28, SH(0.12)),
   defaults={"primary": "#2e7d32"})
up("glaciere", "Glacière", "ground",
   R(114, 190, 28, 20, F("primary", "#2980b9"), rx=3) + R(113, 186, 30, 6, F("secondary", "#ecf0f1"), rx=2) + R(124, 183, 8, 3, F("secondary", "#ecf0f1"))
   + R(128, 192, 14, 18, SH(0.1)), defaults={"primary": "#2980b9", "secondary": "#ecf0f1"})
up("seau-balai", "Seau et balai", "ground",
   P("M112 194 L128 194 L126 210 L114 210 Z", F("primary", "#e74c3c")) + P("M112 194 Q120 186 128 194", SHS(0.5, 1))
   + P("M138 210 L134 160", ST("wood", "#a0703c", 2)) + P("M130 206 L142 206 L146 212 L128 212 Z", F("secondary", "#d4b483")),
   defaults={"primary": "#e74c3c", "secondary": "#d4b483"})
up("caisse-bouteilles", "Caisse de bouteilles", "ground",
   R(114, 192, 28, 18, F("primary", "#c0392b"), rx=1) + "".join(C(x, 190, 2.4, F("secondary", "#2d3436")) for x in range(118, 140, 6)) + R(114, 198, 28, 2, SH(0.2)),
   defaults={"primary": "#c0392b", "secondary": "#2d3436"})
up("sac-charbon", "Sac de charbon", "ground",
   P("M114 210 Q112 192 118 186 L138 186 Q144 192 142 210 Z", F("primary", "#e8e1d0")) + "".join(C(x, 187, 3, SH(0.75)) for x in (120, 126, 132, 137))
   + R(118, 196, 20, 3, F("secondary", "#2a9d8f")), defaults={"primary": "#e8e1d0", "secondary": "#2a9d8f"})

pattern("street", "rayures", "Rayures", tile(20, 20, R(0, 0, 20, 20, F("primary", "#e63946")) + R(0, 0, 10, 20, F("secondary", "#f4f1e8"))), {"primary": "#e63946", "secondary": "#f4f1e8"})
pattern("street", "madras", "Madras", tile(20, 20, R(0, 0, 20, 20, F("primary", "#f4d03f")) + R(0, 0, 20, 6, F("secondary", "#c0392b", ";opacity:0.6"))
                                          + R(0, 0, 6, 20, F("secondary", "#c0392b", ";opacity:0.6")) + R(12, 0, 1.5, 20, F("accent", "#1e6f3e")) + R(0, 12, 20, 1.5, F("accent", "#1e6f3e"))),
        {"primary": "#f4d03f", "secondary": "#c0392b", "accent": "#1e6f3e"})
pattern("street", "wax", "Inspiration wax", tile(24, 24, R(0, 0, 24, 24, F("primary", "#2a9d8f")) + C(12, 12, 7, F("secondary", "#f1c40f")) + C(12, 12, 3, F("accent", "#c0392b"))),
        {"primary": "#2a9d8f", "secondary": "#f1c40f", "accent": "#c0392b"})


# ================================================================ MEUBLES (0 0 200 160, sol y = 150)
MV = "0 0 200 160"


def mp(key, name, slot, inner, **kw):
    part("furniture", key, name, slot, inner, MV, **kw)


FW = F("wood", "#8b5a33")
FM = F("metal", "#6b7378")
UPH = F("primary", "#c0623b")
mp("canape", "Canapé 3 places", "base",
   R(22, 66, 156, 48, UPH, rx=10) + R(32, 108, 136, 28, UPH) + R(16, 88, 24, 48, UPH, rx=8) + R(160, 88, 24, 48, UPH, rx=8)
   + R(32, 108, 136, 3, SH(0.12)) + R(24, 132, 152, 6, F("secondary", "#8a4a2b")) + R(22, 66, 156, 4, LT(0.15), rx=2),
   defaults={"primary": "#c0623b", "secondary": "#8a4a2b"},
   anchors={"legs": [[36, 150], [164, 150]], "seat": [[58, 104], [100, 104], [142, 104]], "throw": [[124, 104]]})
mp("fauteuil", "Fauteuil", "base",
   R(62, 66, 76, 48, UPH, rx=10) + R(70, 108, 60, 28, UPH) + R(52, 88, 22, 48, UPH, rx=8) + R(126, 88, 22, 48, UPH, rx=8)
   + R(54, 132, 92, 6, F("secondary", "#8a4a2b")) + R(62, 66, 76, 4, LT(0.15), rx=2),
   defaults={"primary": "#2a9d8f", "secondary": "#1d6b62"},
   anchors={"legs": [[64, 150], [136, 150]], "seat": [[100, 104]], "throw": [[112, 104]]})
mp("lit", "Lit double", "base",
   R(24, 40, 152, 70, FW, rx=6) + R(32, 48, 136, 54, SH(0.1), rx=4) + R(18, 104, 164, 32, F("primary", "#e9e4d8"), rx=4) + R(16, 128, 168, 10, FW),
   defaults={"primary": "#e9e4d8"}, anchors={"legs": [[26, 150], [174, 150]], "bed": [[100, 108]], "throw": [[132, 108]]})
mp("commode", "Commode à tiroirs", "base",
   R(40, 66, 120, 72, F("primary", "#c79a63"), rx=3) + R(36, 61, 128, 6, FW) + "".join(R(46, y, 108, 18, SH(0.07), rx=2) for y in (72, 94, 116))
   + R(150, 66, 10, 72, SH(0.08)), defaults={"primary": "#c79a63"},
   anchors={"legs": [[48, 150], [152, 150]], "front": [[78, 81], [122, 81], [78, 103], [122, 103], [78, 125], [122, 125]], "top": [[100, 61]]})
mp("table-basse", "Table basse", "base",
   R(26, 104, 148, 8, FW) + R(32, 112, 136, 8, F("primary", "#a8743f")) + R(34, 120, 6, 30, FW) + R(160, 120, 6, 30, FW) + R(36, 138, 128, 4, FW)
   + R(26, 104, 148, 2, LT(0.2)), defaults={"primary": "#a8743f"}, anchors={"top": [[100, 104]]})
mp("meuble-tv", "Meuble TV bas", "base",
   R(24, 94, 152, 44, F("primary", "#efe6d2"), rx=2) + R(20, 90, 160, 6, FW) + R(28, 98, 70, 36, SH(0.06)) + R(102, 98, 70, 36, SH(0.06))
   + R(98, 98, 4, 36, SH(0.15)), defaults={"primary": "#efe6d2"},
   anchors={"legs": [[34, 150], [166, 150]], "front": [[88, 116], [112, 116]], "top": [[100, 90]]})

mp("pieds-coniques", "Pieds en bois coniques", "legs", P("M56 136 L64 136 L62 150 L58 150 Z", FW))
mp("pieds-metal", "Pieds métalliques fins", "legs", R(58.5, 136, 3, 14, FM) + R(56, 148.5, 8, 1.5, FM))
mp("pieds-compas", "Pieds compas", "legs", P("M57 136 L62 136 L56 150 L52 150 Z", FW))
mp("roulettes", "Roulettes", "legs", R(58, 136, 4, 7, FM) + C(60, 146, 4, F("secondary", "#2d3436")) + C(60, 146, 1.3, FM), defaults={"secondary": "#2d3436"})
mp("pieds-sculptes", "Pieds sculptés", "legs", P("M56 136 L64 136 Q67 141 62 144 L62 150 L58 150 L58 144 Q53 141 56 136 Z", FW))

mp("coussin-uni", "Coussin uni", "cushion",
   R(82, 72, 36, 32, F("primary", "#e9c46a"), rx=8) + R(79, 100, 42, 14, F("primary", "#e9c46a"), rx=5) + R(84, 74, 32, 4, LT(0.25), rx=2) + R(79, 110, 42, 4, SH(0.1), rx=2),
   defaults={"primary": "#e9c46a"})
mp("coussin-capitonne", "Coussin capitonné", "cushion",
   R(82, 72, 36, 32, F("primary", "#264653"), rx=6) + R(79, 100, 42, 14, F("primary", "#264653"), rx=5)
   + "".join(C(x, y, 1.3, SH(0.35)) for x in (91, 100, 109) for y in (81, 94)), defaults={"primary": "#264653"})
mp("coussin-rond", "Coussin rond à passepoil", "cushion",
   C(100, 88, 15, F("primary", "#e76f51")) + C(100, 88, 15, ST("secondary", "#f4f1e8", 1.4)) + C(100, 88, 3, F("secondary", "#f4f1e8"))
   + R(79, 100, 42, 14, F("primary", "#e76f51"), rx=5), defaults={"primary": "#e76f51", "secondary": "#f4f1e8"})
mp("coussin-wax", "Coussin wax", "cushion",
   R(82, 72, 36, 32, F("primary", "#f4a261"), rx=8) + C(100, 88, 9, F("secondary", "#1e3d6b")) + C(100, 88, 4, F("accent", "#f1c40f"))
   + R(79, 100, 42, 14, F("primary", "#f4a261"), rx=5), defaults={"primary": "#f4a261", "secondary": "#1e3d6b", "accent": "#f1c40f"})

PILLOWS = R(34, 86, 50, 20, F("secondary", "#ffffff"), rx=8) + R(116, 86, 50, 20, F("secondary", "#ffffff"), rx=8)
mp("drap-oreillers", "Drap et oreillers", "bedding",
   PILLOWS + R(18, 100, 164, 36, F("primary", "#9cc8d6"), rx=4) + R(18, 100, 164, 8, LT(0.35), rx=3), defaults={"primary": "#9cc8d6", "secondary": "#ffffff"})
mp("couverture-pagne", "Couverture en pagne", "bedding",
   PILLOWS + R(18, 100, 164, 36, F("primary", "#c0392b"), rx=4) + "".join(R(18, y, 164, 4, F("accent", "#f1c40f")) for y in (110, 124)) + R(18, 116, 164, 4, F("secondary", "#1e6f3e")),
   defaults={"primary": "#c0392b", "secondary": "#1e6f3e", "accent": "#f1c40f"})
mp("moustiquaire", "Moustiquaire", "bedding",
   PILLOWS + R(18, 100, 164, 36, F("primary", "#f4e3b1"), rx=4) + P("M100 4 L20 104 L180 104 Z", LT(0.35))
   + P("M100 4 L20 104 M100 4 L60 104 M100 4 L100 104 M100 4 L140 104 M100 4 L180 104", LTS(0.6, 0.8)) + C(100, 5, 3, F("accent", "#8b5a33")),
   defaults={"primary": "#f4e3b1", "secondary": "#ffffff", "accent": "#8b5a33"})
mp("couette", "Couette épaisse", "bedding",
   PILLOWS + R(14, 96, 172, 42, F("primary", "#6a4c93"), rx=12) + "".join(P(f"M{x} 98 L{x} 136", SHS(0.15, 1)) for x in range(40, 180, 28)) + R(14, 96, 172, 6, LT(0.18), rx=4),
   defaults={"primary": "#6a4c93", "secondary": "#ffffff"})

mp("plaid-carreaux", "Plaid à carreaux", "throw",
   P("M104 98 L140 98 L144 140 L108 136 Z", F("primary", "#b5523b")) + P("M116 98 L120 138 M128 98 L132 139 M106 112 L142 114 M107 126 L143 128", ST("secondary", "#f4e3b1", 1.4)),
   defaults={"primary": "#b5523b", "secondary": "#f4e3b1"})
mp("pagne-plie", "Pagne plié", "throw",
   R(100, 96, 40, 10, F("primary", "#2a9d8f"), rx=2) + P("M132 106 L140 106 L142 136 L134 136 Z", F("primary", "#2a9d8f")) + R(100, 99, 40, 2, F("accent", "#f1c40f")) + R(134, 120, 8, 2, F("accent", "#f1c40f")),
   defaults={"primary": "#2a9d8f", "accent": "#f1c40f"})
mp("chale", "Châle à franges", "throw",
   P("M102 98 L142 98 L138 128 L106 128 Z", F("primary", "#e9c46a")) + "".join(P(f"M{x} 128 L{x} 134", ST("primary", "#e9c46a", 1)) for x in range(108, 138, 3)),
   defaults={"primary": "#e9c46a"})

mp("bouton", "Bouton rond", "handles", C(100, 120, 2.6, FM) + C(99.3, 119.3, 0.8, LT(0.6)))
mp("poignee-barre", "Poignée barre", "handles", R(93, 118.5, 14, 3, FM, rx=1.5))
mp("anneau", "Anneau", "handles", C(100, 117, 1.3, FM) + C(100, 121, 3.5, ST("metal", "#6b7378", 1.3)))
mp("coquille", "Poignée coquille", "handles", P("M95 118 Q100 124 105 118 Z", FM))

mp("lampe-chevet", "Lampe de chevet", "top_item",
   C(100, 60, 18, 'style="fill:rgba(255,236,160,0.3)"') + R(94, 82, 12, 8, F("secondary", "#8b5a33"), rx=2) + R(99, 66, 2, 16, F("secondary", "#8b5a33"))
   + P("M88 66 L112 66 L106 50 L94 50 Z", F("primary", "#f4e3b1")), defaults={"primary": "#f4e3b1", "secondary": "#8b5a33"})
mp("plante", "Plante en pot", "top_item",
   P("M90 76 L110 76 L107 90 L93 90 Z", F("secondary", "#c8693f")) + P("M100 76 Q86 64 84 50 Q96 58 100 74 Z M100 76 Q114 62 118 50 Q104 60 100 74 Z M100 76 Q98 58 102 44 Q106 60 101 76 Z", F("primary", "#3f8f4a")),
   defaults={"primary": "#3f8f4a", "secondary": "#c8693f"})
mp("television", "Télévision", "top_item",
   R(94, 84, 12, 6, F("secondary", "#2d3436")) + R(70, 48, 60, 36, F("primary", "#1d2a30"), rx=2) + R(73, 51, 54, 30, F("secondary", "#2d3436")) + P("M76 78 L96 54 L104 54 L84 78 Z", LT(0.12)),
   defaults={"primary": "#1d2a30", "secondary": "#2d3436"})
mp("radio", "Radio", "top_item",
   P("M112 72 L124 54", ST("metal", "#6b7378", 1.2)) + R(80, 72, 40, 18, F("primary", "#8b5a33"), rx=3) + C(92, 81, 6, SH(0.35)) + R(104, 76, 12, 3, F("secondary", "#e9c46a")) + C(110, 85, 2, F("secondary", "#e9c46a")),
   defaults={"primary": "#8b5a33", "secondary": "#e9c46a"})
mp("vase-fleurs", "Vase de fleurs", "top_item",
   P("M94 90 Q90 80 96 72 L104 72 Q110 80 106 90 Z", F("primary", "#2a9d8f")) + P("M100 72 L96 56 M100 72 L100 52 M100 72 L105 58", ST("accent", "#3f8f4a", 1.2))
   + C(96, 55, 3.5, F("secondary", "#e63946")) + C(100, 50, 3.5, F("secondary", "#f4c430")) + C(105, 57, 3.5, F("secondary", "#e63946")),
   defaults={"primary": "#2a9d8f", "secondary": "#e63946", "accent": "#3f8f4a"})
mp("ventilateur", "Ventilateur", "top_item",
   R(92, 86, 16, 4, FM, rx=2) + R(99, 66, 2, 20, FM) + C(100, 56, 14, ST("metal", "#6b7378", 1.4)) + "".join(E(100 + 6 * math.cos(a), 56 + 6 * math.sin(a), 5, 2.5, F("primary", "#9cc8d6")) for a in (0, 2.09, 4.19))
   + C(100, 56, 2.5, FM), defaults={"primary": "#9cc8d6"})
mp("theiere", "Théière et verres", "top_item",
   P("M84 90 Q80 76 92 74 L104 74 Q114 76 110 90 Z", F("primary", "#c8ced3")) + P("M110 80 L118 74", ST("primary", "#c8ced3", 2)) + R(94, 70, 6, 4, F("primary", "#c8ced3"))
   + "".join(R(x, 82, 5, 8, LT(0.55)) + R(x, 86, 5, 4, F("secondary", "#b5523b")) for x in (118, 126)), defaults={"primary": "#c8ced3", "secondary": "#b5523b"})

pattern("furniture", "wax", "Inspiration wax", tile(24, 24, R(0, 0, 24, 24, F("primary", "#e67e22")) + C(12, 12, 7, F("secondary", "#1e3d6b")) + C(12, 12, 3, F("accent", "#f1c40f"))
                                                    + "".join(C(x, y, 4, F("secondary", "#1e3d6b")) for x in (0, 24) for y in (0, 24))),
        {"primary": "#e67e22", "secondary": "#1e3d6b", "accent": "#f1c40f"})
pattern("furniture", "kente", "Inspiration kente", tile(16, 16, R(0, 0, 16, 16, F("primary", "#f1c40f")) + R(0, 0, 16, 4, F("secondary", "#27ae60")) + R(0, 8, 4, 8, F("accent", "#c0392b"))
                                                      + R(8, 8, 4, 8, F("secondary", "#27ae60"))), {"primary": "#f1c40f", "secondary": "#27ae60", "accent": "#c0392b"})
pattern("furniture", "madras", "Madras", tile(20, 20, R(0, 0, 20, 20, F("primary", "#f4d03f")) + R(0, 0, 20, 6, F("secondary", "#c0392b", ";opacity:0.6"))
                                             + R(0, 0, 6, 20, F("secondary", "#c0392b", ";opacity:0.6")) + R(12, 0, 1.5, 20, F("accent", "#1e6f3e"))),
        {"primary": "#f4d03f", "secondary": "#c0392b", "accent": "#1e6f3e"})
pattern("furniture", "bogolan", "Inspiration bogolan", tile(18, 18, R(0, 0, 18, 18, F("primary", "#5b3a29")) + P("M3 4 L8 4 M5.5 2 L5.5 7", ST("secondary", "#efe2c6", 1.3))
                                                          + P("M10 13 L16 13", ST("secondary", "#efe2c6", 1.3)) + C(14, 5, 1.2, F("secondary", "#efe2c6")) + C(4, 14, 1.2, F("secondary", "#efe2c6"))),
        {"primary": "#5b3a29", "secondary": "#efe2c6"})
pattern("furniture", "rayures", "Rayures", tile(20, 20, R(0, 0, 20, 20, F("primary", "#264653")) + R(0, 0, 20, 6, F("secondary", "#e9c46a"))), {"primary": "#264653", "secondary": "#e9c46a"})


# ================================================================ SURFACES (0 0 200 200, vue de dessus)
SV = "0 0 200 200"


def sp(key, name, slot, inner, **kw):
    part("surface", key, name, slot, inner, SV, **kw)


def scatter(seed, count, fn):
    r = rnd(seed)
    return "".join(fn(14 + r() * 156, 14 + r() * 156, r()) for _ in range(count))


sp("gazon", "Gazon", "base", R(0, 0, 200, 200, F("primary", "#7fb25a")) + scatter(3, 70, lambda x, y, t: P(f"M{n(x)} {n(y)} l{n(-2 + 4 * t)} -5", SHS(0.12, 1.2)))
   + scatter(5, 8, lambda x, y, t: E(x, y, 14, 8, LT(0.06))), defaults={"primary": "#7fb25a"})
sp("sable", "Sable", "base", R(0, 0, 200, 200, F("primary", "#e6d3a3")) + scatter(7, 90, lambda x, y, t: C(x, y, 0.8 + t, SH(0.07) if t > 0.5 else LT(0.2))),
   defaults={"primary": "#e6d3a3"})
sp("terre-battue", "Terre battue", "base", R(0, 0, 200, 200, F("primary", "#c1844f")) + scatter(11, 10, lambda x, y, t: E(x, y, 16, 9, SH(0.06)))
   + scatter(13, 7, lambda x, y, t: P(f"M{n(x)} {n(y)} l{n(8 * t)} 6 l6 {n(-4 * t)} l5 7", SHS(0.18, 0.8))), defaults={"primary": "#c1844f"})
sp("beton", "Dalle de béton", "base", R(0, 0, 200, 200, F("primary", "#b8b8b0")) + "".join(P(f"M{v} 0 L{v} 200 M0 {v} L200 {v}", SHS(0.18, 1.2)) for v in (50, 100, 150))
   + scatter(17, 50, lambda x, y, t: C(x, y, 0.7, SH(0.12))), defaults={"primary": "#b8b8b0"})
sp("carrelage", "Carrelage", "base", R(0, 0, 200, 200, F("primary", "#e8e2d4")) + "".join(P(f"M{v} 0 L{v} 200 M0 {v} L200 {v}", ST("secondary", "#c9c0ad", 1.4)) for v in range(25, 200, 25)),
   defaults={"primary": "#e8e2d4", "secondary": "#c9c0ad"})
sp("eau", "Eau", "base", R(0, 0, 200, 200, F("primary", "#3d8fc6")) + E(110, 110, 70, 50, SH(0.08))
   + scatter(19, 16, lambda x, y, t: P(f"M{n(x)} {n(y)} q6 -4 12 0 t12 0", LTS(0.35, 1.2))), defaults={"primary": "#3d8fc6"})

sp("touffes", "Touffes d'herbe", "details", scatter(23, 22, lambda x, y, t: P(f"M{n(x)} {n(y)} l-4 -7 M{n(x)} {n(y)} l0 -9 M{n(x)} {n(y)} l4 -7", ST("primary", "#4e8a3a", 1.6))),
   defaults={"primary": "#4e8a3a"})
sp("cailloux", "Cailloux", "details", scatter(29, 26, lambda x, y, t: E(x, y, 2.5 + 3 * t, 2 + 2 * t, F("primary", "#9a948a")) + E(x - 1, y - 1, 1, 0.6, LT(0.35))),
   defaults={"primary": "#9a948a"})
sp("feuilles", "Feuilles mortes", "details", scatter(31, 30, lambda x, y, t: E(x, y, 4, 2, F("primary" if t > 0.5 else "secondary", "#c97b3a" if t > 0.5 else "#8b5a2b"))),
   defaults={"primary": "#c97b3a", "secondary": "#8b5a2b"})
sp("fleurs-sauvages", "Fleurs sauvages", "details",
   scatter(37, 28, lambda x, y, t: C(x, y, 2.6, F(["primary", "secondary", "accent"][int(t * 3) % 3], ["#f4c430", "#e63946", "#ffffff"][int(t * 3) % 3])) + C(x, y, 0.9, SH(0.3))),
   defaults={"primary": "#f4c430", "secondary": "#e63946", "accent": "#ffffff"})
sp("fissures", "Fissures", "details", scatter(41, 6, lambda x, y, t: P(f"M{n(x)} {n(y)} l{n(10 * t)} 8 l7 {n(-5 * t)} l6 9 l-3 8", ST("primary", "#4a3f35", 1, ";opacity:0.55"))),
   defaults={"primary": "#4a3f35"})
sp("flaques", "Flaques", "details", scatter(43, 5, lambda x, y, t: E(x, y, 12 + 8 * t, 7 + 4 * t, F("primary", "#6fa8d6", ";opacity:0.75")) + E(x - 3, y - 2, 4, 1.5, LT(0.4))),
   defaults={"primary": "#6fa8d6"})

LINE = "#f4f1e8"
sp("parking", "Places de parking", "marking", "".join(P(f"M{x} 20 L{x} 180", ST("line", LINE, 4)) for x in (12, 100, 188)) + P("M12 180 L188 180", ST("line", LINE, 4)))
sp("passage-pieton", "Passage piéton", "marking", "".join(R(30, y, 140, 14, F("line", LINE)) for y in range(16, 190, 28)))
sp("terrain-sport", "Lignes de terrain de sport", "marking",
   R(10, 10, 180, 180, ST("line", LINE, 3)) + P("M10 100 L190 100", ST("line", LINE, 3)) + C(100, 100, 26, ST("line", LINE, 3)) + C(100, 100, 2.5, F("line", LINE)))
sp("fleche", "Flèche directionnelle", "marking", poly([(100, 30), (140, 80), (114, 80), (114, 170), (86, 170), (86, 80), (60, 80)], F("line", LINE)))
sp("marelle", "Marelle", "marking",
   "".join(R(85, y, 30, 26, ST("line", LINE, 2.5)) for y in (150, 98, 20)) + R(70, 124, 30, 26, ST("line", LINE, 2.5)) + R(100, 124, 30, 26, ST("line", LINE, 2.5))
   + R(70, 46, 30, 26, ST("line", LINE, 2.5)) + R(100, 46, 30, 26, ST("line", LINE, 2.5)))

STONE = F("stone", "#b9b4a8")
sp("bordure-trottoir", "Bordure de trottoir", "edging",
   R(0, 0, 200, 10, STONE) + R(0, 190, 200, 10, STONE) + R(0, 0, 10, 200, STONE) + R(190, 0, 10, 200, STONE) + R(10, 10, 180, 2, SH(0.15)) + R(10, 10, 2, 180, SH(0.15))
   + "".join(P(f"M{v} 0 L{v} 10 M{v} 190 L{v} 200 M0 {v} L10 {v} M190 {v} L200 {v}", SHS(0.2, 0.8)) for v in range(25, 200, 25)))
sp("bordure-pierres", "Bordure de pierres", "edging",
   "".join(E(x, y, 6, 4.5, STONE) + E(x - 2, y - 1.5, 2, 1, LT(0.3)) for v in range(8, 200, 13) for x, y in [(v, 6), (v, 194), (6, v), (194, v)]))
sp("haie-basse", "Haie basse", "edging",
   "".join(C(x, y, 6.5, F("primary", "#3f7d3a")) for v in range(7, 194, 11) for x, y in [(v, 7), (v, 193), (7, v), (193, v)]), defaults={"primary": "#3f7d3a"})
sp("bordure-peinte", "Bordure peinte rouge et blanc", "edging",
   "".join(R(x, 0, 20, 8, F("primary" if i % 2 else "secondary", "#c0392b" if i % 2 else LINE)) + R(x, 192, 20, 8, F("secondary" if i % 2 else "primary", LINE if i % 2 else "#c0392b"))
           + R(0, x, 8, 20, F("secondary" if i % 2 else "primary", LINE if i % 2 else "#c0392b")) + R(192, x, 8, 20, F("primary" if i % 2 else "secondary", "#c0392b" if i % 2 else LINE))
           for i, x in enumerate(range(0, 200, 20))), defaults={"primary": "#c0392b", "secondary": LINE})

pattern("surface", "paves", "Pavés autobloquants", tile(24, 24, R(0, 0, 24, 24, F("primary", "#9c8f80")) + R(1, 1, 10, 22, F("secondary", "#b5a898"), rx=2)
                                                      + R(13, 1, 10, 10, F("secondary", "#b5a898"), rx=2) + R(13, 13, 10, 10, F("secondary", "#b5a898"), rx=2)),
        {"primary": "#9c8f80", "secondary": "#b5a898"})
pattern("surface", "damier", "Damier", tile(20, 20, R(0, 0, 20, 20, F("primary", "#e8e2d4")) + R(0, 0, 10, 10, F("secondary", "#2d3436")) + R(10, 10, 10, 10, F("secondary", "#2d3436"))),
        {"primary": "#e8e2d4", "secondary": "#2d3436"})
pattern("surface", "planches", "Planches de bois", tile(40, 12, R(0, 0, 40, 12, F("primary", "#b07a48")) + R(0, 11, 40, 1, SH(0.3)) + R(26, 0, 1, 12, SH(0.25))),
        {"primary": "#b07a48"})
pattern("surface", "herbe-tondue", "Herbe tondue en bandes", tile(40, 40, R(0, 0, 40, 40, F("primary", "#7fb25a")) + R(0, 0, 20, 40, F("secondary", "#8fc26a"))),
        {"primary": "#7fb25a", "secondary": "#8fc26a"})
pattern("surface", "vaguelettes", "Vaguelettes", tile(30, 16, R(0, 0, 30, 16, F("primary", "#3d8fc6")) + P("M0 8 Q7.5 3 15 8 T30 8", ST("secondary", "#7fc3dd", 1.6))),
        {"primary": "#3d8fc6", "secondary": "#7fc3dd"})
pattern("surface", "galets", "Galets", tile(20, 20, R(0, 0, 20, 20, F("primary", "#cfc6b4")) + E(5, 5, 4, 3, F("secondary", "#a89f8e")) + E(14, 9, 3.5, 2.5, F("secondary", "#a89f8e"))
                                             + E(7, 15, 3, 2.5, F("secondary", "#a89f8e"))), {"primary": "#cfc6b4", "secondary": "#a89f8e"})


# ================================================================ exemples publiés (un assemblage = une liste d'identifiants)
# layers : {emplacement: (clé, {couleurs}) | (clé, {couleurs}, (clé motif, {couleurs}))}

def L(key, colors=None, pat=None):
    return (key, colors or {}, pat) if pat else (key, colors or {})


def _base(**kw) -> dict:
    d = {"description": "", "tags": ["modulaire"], "footprint": {"kind": "rect", "w": 1, "d": 1}, "height_m": 1,
         "placement": {"allowed_terrain": ["ground", "sand"], "road_access": "none"}, "representation": "modular"}
    d.update(kw)
    return d


def _bldg(name, sub, floors, desc, entr_side="S"):
    return {"name": name, "description": desc, "subcategory": sub, "tags": ["modulaire"], "representation": "modular",
            "footprint": {"kind": "rect", "w": 2, "d": 2}, "height_m": round(floors * 3 + 1.5, 1),
            "entrances": [{"id": "porte", "cell": [1, 1], "side": entr_side, "kind": "main"}],
            "materials": {"wall": "#efe2c6", "roof": "#8e4a35", "trim": "#2f5d62"},
            "placement": {"allowed_terrain": ["ground"], "road_access": "preferred"},
            "properties": {"floors": floors, "occupancy": 4 * floors, "ownership": "npc",
                           "style": {"roof": "flat", "window_style": "grid", "door_style": "wood"}}}


EXAMPLES = [
    {"category": "commerce", "key": "kit-boutique-tantie", "kit": "building",
     "def": {**_bldg("Boutique Chez Tantie", "Boutique de quartier", 2, "Boutique à étage assemblée : vitrines, auvent rayé, enseigne, château d'eau."),
             "behaviors": [{"id": "shop", "params": {"goods_slots": 24}}]},
     "shop": {"sign_text": "CHEZ TANTIE", "shopfront": True, "awning": True, "goods_slots": 24},
     "base": "r-plus-1", "base_colors": {"primary": "#f3ead8"}, "colors": {"trim": "#1f6f5c"},
     "layers": {"roof": L("toit-terrasse"), "rooftop": L("polytank"), "ground": L("vitrines"), "windows": L("fenetres-persiennes"),
                "door": L("porte-vitree"), "awning": L("auvent-raye", {"primary": "#1f6f5c"}), "sign": L("enseigne-caisson", {"primary": "#1f6f5c"}),
                "greenery": L("pots-fleurs")},
     "variants": [{"id": "facade-ocre", "name": "Façade ocre", "base_colors": {"primary": "#e3b778"}, "layers": {"awning": L("auvent-feston", {"primary": "#c0392b"})}}]},
    {"category": "residential", "key": "kit-maison-akwaba", "kit": "building",
     "def": _bldg("Maison basse Akwaba", "Maison économique", 1, "Maison basse assemblée : toit de tôle, persiennes, muret, bougainvillier."),
     "base": "maison-basse", "colors": {"trim": "#7a4b2a"},
     "layers": {"roof": L("toit-tole-pignon"), "ground": L("rez-persiennes"), "door": L("porte-bois"), "wall_extra": L("compteur"),
                "front": L("muret"), "greenery": L("bougainvillier")}},
    {"category": "residential", "key": "kit-immeuble-fromagers", "kit": "building",
     "def": _bldg("Immeuble Les Fromagers", "Immeuble résidentiel", 4, "Immeuble R+3 assemblé : balcons, climatiseurs, motif de faïence au rez."),
     "base": "r-plus-3", "base_pattern": ("motif-bandes", {"primary": "#d8e2dc", "secondary": "#5f9ea0"}), "colors": {"trim": "#2d3436"},
     "layers": {"roof": L("toit-terrasse"), "rooftop": L("parabole"), "ground": L("rez-grilles"), "windows": L("fenetres"), "balcony": L("balcon-metal"),
                "door": L("porte-metal"), "wall_extra": L("climatiseur"), "front": L("marches")}},
    {"category": "residential", "key": "kit-case-banco", "kit": "building",
     "def": _bldg("Case en banco", "Maison traditionnelle", 1, "Case traditionnelle : murs en banco, toit de paille."),
     "base": "banco", "layers": {"roof": L("toit-paille"), "door": L("porte-arc"), "ground": L("rez-claustras"), "greenery": L("bananier")}},
    {"category": "vehicles", "key": "kit-taxi-compteur", "kit": "vehicle",
     "def": _base(name="Taxi compteur (modulaire)", subcategory="Taxi", footprint={"kind": "rect", "w": 1, "d": 2}, height_m=1.5,
                  materials={"body": "#e67e22", "trim": "#1d2a30", "glass": "#9cc8d6"}, behaviors=[{"id": "parked", "params": {}}],
                  properties={"kind": "taxi", "seats": 4, "parking": "road", "anchors": {}}),
     "base": "berline", "base_colors": {"primary": "#e67e22"},
     "layers": {"wheels": L("roue-acier"), "livery": L("damier"), "lights": L("phare-rond"), "rear": L("feux-arriere"), "roof": L("enseigne-taxi"),
                "bumper": L("pare-chocs-chrome")},
     "variants": [{"id": "woro-woro", "name": "Wôrô-wôrô vert", "base_colors": {"primary": "#27ae60"}, "layers": {"roof": None, "livery": L("bande", {"primary": "#f1c40f"})}}]},
    {"category": "vehicles", "key": "kit-gbaka", "kit": "vehicle",
     "def": _base(name="Gbaka d'Adjamé", subcategory="Gbaka", footprint={"kind": "rect", "w": 1, "d": 3}, height_m=2.3,
                  materials={"body": "#f1c40f", "trim": "#27ae60", "glass": "#9cc8d6"}, properties={"kind": "gbaka", "seats": 18, "parking": "road", "anchors": {}}),
     "base": "minibus", "layers": {"wheels": L("roue-tout-terrain"), "livery": L("tricolore"), "lights": L("phare-rectangulaire"), "rear": L("echelle"),
                                   "roof": L("galerie"), "cargo": L("bagages"), "decal": L("etoile", {"primary": "#c0392b"})}},
    {"category": "vehicles", "key": "kit-moto-livreur", "kit": "vehicle",
     "def": _base(name="Moto de livreur", subcategory="Moto", height_m=1.2, materials={"body": "#c0392b", "trim": "#1d2a30", "glass": "#9cc8d6"},
                  properties={"kind": "moto", "seats": 2, "parking": "anywhere", "anchors": {}}),
     "base": "moto", "layers": {"wheels": L("roue-rayons"), "lights": L("phare-rond"), "rear": L("feux-arriere"), "decal": L("eclair")}},
    {"category": "vegetation", "key": "kit-manguier", "kit": "vegetation",
     "def": _base(name="Manguier", subcategory="Arbre", height_m=6, properties={"shape": None}),
     "base": "tronc-droit", "layers": {"canopy": L("feuillage-rond"), "blossom": L("mangues"), "planter": L("grille-arbre")}},
    {"category": "vegetation", "key": "kit-cocotier", "kit": "vegetation",
     "def": _base(name="Cocotier", subcategory="Palmier", height_m=8, properties={"shape": None}),
     "base": "tronc-palmier", "layers": {"canopy": L("palmes-cocotier"), "blossom": L("noix-coco"), "ground_cover": L("herbes-hautes")}},
    {"category": "vegetation", "key": "kit-flamboyant", "kit": "vegetation",
     "def": _base(name="Flamboyant", subcategory="Arbre", height_m=6, properties={"shape": None}),
     "base": "tronc-fromager", "colors": {"leaf": "#4f8f3a"}, "layers": {"canopy": L("feuillage-etale"), "blossom": L("fleurs-rouges"), "planter": L("pneu-peint")}},
    {"category": "urban_furniture", "key": "kit-lampadaire-avenue", "kit": "street",
     "def": _base(name="Lampadaire de l'avenue", subcategory="Lampadaire", height_m=5, behaviors=[{"id": "light_at_night", "params": {"radius": 3}}],
                  properties={"shape": None}),
     "base": "poteau-haut", "layers": {"head": L("double-lanterne"), "attachment": L("fanion")}},
    {"category": "decoration", "key": "kit-etal-fruits", "kit": "street",
     "def": _base(name="Étal de fruits", subcategory="Étal", footprint={"kind": "rect", "w": 2, "d": 1}, height_m=2.4, properties={"shape": None}),
     "base": "etal", "layers": {"canopy": L("parasol"), "goods": L("fruits"), "ground": L("glaciere")}},
    {"category": "urban_furniture", "key": "kit-banc-square", "kit": "street",
     "def": _base(name="Banc du square", subcategory="Banc", footprint={"kind": "rect", "w": 2, "d": 1}, behaviors=[{"id": "sit", "params": {}}],
                  properties={"shape": None}),
     "base": "banc", "layers": {"seat": L("lattes-bois"), "ground": L("poubelle-sol")}},
    {"category": "furniture_home", "key": "kit-canape-salon", "kit": "furniture",
     "def": _base(name="Canapé du salon", subcategory="Canapé", height_m=1, properties={"shape": "seat", "w": 3, "d": 1, "height_px": 9, "actions": ["sit"]}),
     "base": "canape", "base_colors": {"primary": "#2a9d8f"},
     "layers": {"legs": L("pieds-coniques"), "cushion": L("coussin-wax"), "throw": L("pagne-plie", {"primary": "#e76f51"})}},
    {"category": "furniture_home", "key": "kit-lit-moustiquaire", "kit": "furniture",
     "def": _base(name="Lit avec moustiquaire", subcategory="Lit", height_m=1, properties={"shape": "bed", "w": 2, "d": 3, "height_px": 7, "actions": ["sleep"]}),
     "base": "lit", "layers": {"legs": L("pieds-sculptes"), "bedding": L("moustiquaire")}},
    {"category": "furniture_home", "key": "kit-meuble-tv", "kit": "furniture",
     "def": _base(name="Meuble TV", subcategory="Télévision", height_m=1, properties={"shape": "screen", "w": 2, "d": 1, "height_px": 8, "actions": ["watch"]}),
     "base": "meuble-tv", "layers": {"legs": L("pieds-metal"), "handles": L("poignee-barre"), "top_item": L("television")}},
    {"category": "nature", "key": "kit-pelouse-square", "kit": "surface",
     "def": _base(name="Pelouse du square", subcategory="Pelouse", collision="none", height_m=0, footprint={"kind": "rect", "w": 4, "d": 3},
                  materials={"base": "#7fb25a", "detail": "#4e8a3a"}, properties={"kind": "grass", "terrain": "ground", "walkable": True, "buildable": True}),
     "base": "gazon", "layers": {"details": L("fleurs-sauvages"), "edging": L("bordure-pierres")}},
    {"category": "paving", "key": "kit-place-pavee", "kit": "surface",
     "def": _base(name="Place pavée", subcategory="Place", collision="none", height_m=0, footprint={"kind": "rect", "w": 4, "d": 4},
                  materials={"base": "#9c8f80", "detail": "#b5a898"}, properties={"kind": "paving", "terrain": "ground", "walkable": True, "buildable": True}),
     "base": "beton", "base_pattern": ("motif-paves", {}), "layers": {"edging": L("bordure-trottoir"), "marking": L("marelle")}},
]
