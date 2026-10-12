"""Bibliothèque de départ des composants de personnage (SVG).

Repère commun : viewBox 0 0 200 380, axe vertical x = 100, vue de face (cf. « Atelier Babiverse.md »).
Couleurs recolorables par la convention de l'atelier : `var(--babi-<canal>, <défaut>)` ; ombres en rgba(0,0,0,a).
Ces fichiers passent par le même import sécurisé que ceux de l'administrateur (assainissement, analyse).
"""
from __future__ import annotations


def F(ch: str, default: str, extra: str = "") -> str:
    return f'style="fill:var(--babi-{ch},{default}){extra}"'


def ST(ch: str, default: str, w: float) -> str:
    return f'style="fill:none;stroke:var(--babi-{ch},{default});stroke-width:{w};stroke-linecap:round;stroke-linejoin:round"'


def svg(inner: str, vb: str = "0 0 200 380") -> str:
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}">{inner}</svg>'


SK = F("skin", "#a86b3c")
HR = F("hair", "#1b1b1b")
SHADOW = 'style="fill:rgba(0,0,0,0.14)"'
INK = 'style="fill:none;stroke:#2a1a10;stroke-width:2.2;stroke-linecap:round"'

MALE_ANCHORS = {"head_top": [100, 22], "eyes": [100, 62], "mouth": [100, 84], "neck": [100, 108], "shoulders": [100, 124],
                "waist": [100, 224], "feet": [100, 362], "wrist_left": [50, 246], "wrist_right": [150, 246], "ears": [100, 66]}
FEMALE_ANCHORS = {"head_top": [100, 26], "eyes": [100, 64], "mouth": [100, 86], "neck": [100, 108], "shoulders": [100, 126],
                  "waist": [100, 224], "feet": [100, 362], "wrist_left": [52, 246], "wrist_right": [148, 246], "ears": [100, 68]}

BODY_MALE = svg(
    f'<path d="M74 214 L126 214 L128 300 L124 356 L104 356 L101 262 L99 262 L96 356 L76 356 L72 300 Z" {SK}/>'
    f'<ellipse cx="86" cy="358" rx="13" ry="7" {SK}/><ellipse cx="114" cy="358" rx="13" ry="7" {SK}/>'
    f'<path d="M68 122 Q100 112 132 122 L138 136 L128 224 L72 224 L62 136 Z" {SK}/>'
    f'<path d="M66 128 C54 134 50 164 48 196 L44 242 C43 252 57 254 58 244 L64 198 L72 150 Z" {SK}/>'
    f'<path d="M134 128 C146 134 150 164 152 196 L156 242 C157 252 143 254 142 244 L136 198 L128 150 Z" {SK}/>'
    f'<circle cx="51" cy="248" r="8" {SK}/><circle cx="149" cy="248" r="8" {SK}/>'
    f'<rect x="89" y="90" width="22" height="36" rx="8" {SK}/>'
    f'<path d="M89 104 Q100 113 111 104 L111 114 Q100 120 89 114 Z" {SHADOW}/>'
    f'<ellipse cx="66" cy="66" rx="7" ry="10" {SK}/><ellipse cx="134" cy="66" rx="7" ry="10" {SK}/>'
    f'<ellipse cx="100" cy="62" rx="34" ry="40" {SK}/>')

BODY_FEMALE = svg(
    f'<path d="M73 214 L127 214 L127 300 L122 356 L104 356 L101 262 L99 262 L96 356 L78 356 L73 300 Z" {SK}/>'
    f'<ellipse cx="88" cy="358" rx="12" ry="7" {SK}/><ellipse cx="112" cy="358" rx="12" ry="7" {SK}/>'
    f'<path d="M72 124 Q100 116 128 124 L134 138 L124 196 L132 226 L68 226 L76 196 L66 138 Z" {SK}/>'
    f'<path d="M70 130 C58 136 54 164 52 196 L47 242 C46 252 60 254 61 244 L67 198 L75 150 Z" {SK}/>'
    f'<path d="M130 130 C142 136 146 164 148 196 L153 242 C154 252 140 254 139 244 L133 198 L125 150 Z" {SK}/>'
    f'<circle cx="54" cy="248" r="7.5" {SK}/><circle cx="146" cy="248" r="7.5" {SK}/>'
    f'<rect x="90" y="92" width="20" height="34" rx="8" {SK}/>'
    f'<path d="M90 106 Q100 114 110 106 L110 115 Q100 121 90 115 Z" {SHADOW}/>'
    f'<ellipse cx="68" cy="68" rx="6" ry="9" {SK}/><ellipse cx="132" cy="68" rx="6" ry="9" {SK}/>'
    f'<ellipse cx="100" cy="64" rx="32" ry="38" {SK}/>')

M, W = ["male"], ["female"]  # composant réservé aux silhouettes masculines / féminines
NECKLINE = f'<path d="M87 117 Q100 133 113 117 Z" {SK}/>'


def mirror_x(d: str) -> str:
    """Symétrique d'un tracé simple (commandes absolues M/L/Q/C/Z) par rapport à x = 100."""
    import re
    out = []
    is_x = True
    for t in re.findall(r"[A-Za-z]|-?\d*\.?\d+", d):
        if t.isalpha():
            out.append(t)
            is_x = True
            continue
        v = float(t)
        out.append(f"{200 - v:g}" if is_x else f"{v:g}")
        is_x = not is_x
    return " ".join(out)


def pair(d: str, style: str) -> str:
    return f'<path d="{d}" {style}/><path d="{mirror_x(d)}" {style}/>'


# key, nom, emplacement, ancrage, svg, couleurs par défaut, options
PARTS: list[dict] = [
    # --- corps
    {"key": "corps-homme", "name": "Corps — silhouette masculine", "slot": "body", "svg": BODY_MALE,
     "anchors": MALE_ANCHORS, "gender": "male", "tags": ["corps", "homme"]},
    {"key": "corps-femme", "name": "Corps — silhouette féminine", "slot": "body", "svg": BODY_FEMALE,
     "anchors": FEMALE_ANCHORS, "gender": "female", "tags": ["corps", "femme"]},
    # --- yeux
    {"key": "yeux-ronds", "name": "Yeux ronds", "slot": "eyes", "anchor": "eyes", "svg": svg(
        '<ellipse cx="86" cy="62" rx="7" ry="5" fill="#ffffff"/><ellipse cx="114" cy="62" rx="7" ry="5" fill="#ffffff"/>'
        f'<circle cx="87" cy="62" r="3.6" {F("eyes", "#3b2414")}/><circle cx="113" cy="62" r="3.6" {F("eyes", "#3b2414")}/>'
        '<circle cx="88" cy="61" r="1.2" fill="#ffffff"/><circle cx="114" cy="61" r="1.2" fill="#ffffff"/>')},
    {"key": "yeux-amande", "name": "Yeux en amande", "slot": "eyes", "anchor": "eyes", "svg": svg(
        pair("M78 63 Q86 55 94 63 Q86 67 78 63 Z", 'fill="#ffffff"')
        + f'<circle cx="86" cy="62" r="3.2" {F("eyes", "#3b2414")}/><circle cx="114" cy="62" r="3.2" {F("eyes", "#3b2414")}/>'
        + pair("M77 62 Q86 53 95 62", INK))},
    {"key": "yeux-rieurs", "name": "Yeux rieurs (fermés)", "slot": "eyes", "anchor": "eyes", "svg": svg(
        pair("M79 64 Q86 57 93 64", 'style="fill:none;stroke:#2a1a10;stroke-width:2.6;stroke-linecap:round"'))},
    # --- sourcils
    {"key": "sourcils-droits", "name": "Sourcils droits", "slot": "eyebrows", "anchor": "eyes", "svg": svg(
        f'<rect x="78" y="47" width="17" height="4" rx="2" {HR}/><rect x="105" y="47" width="17" height="4" rx="2" {HR}/>')},
    {"key": "sourcils-arques", "name": "Sourcils arqués", "slot": "eyebrows", "anchor": "eyes", "svg": svg(
        pair("M77 51 Q86 43 95 49", ST("hair", "#1b1b1b", 3.4)))},
    {"key": "sourcils-fronces", "name": "Sourcils froncés (sérieux)", "slot": "eyebrows", "anchor": "eyes", "svg": svg(
        pair("M78 46 L95 52", ST("hair", "#1b1b1b", 3.6)))},
    # --- nez
    {"key": "nez-arrondi", "name": "Nez arrondi", "slot": "nose", "anchor": "eyes", "svg": svg(
        '<path d="M96 70 Q91 82 98 84 Q100 85 102 84 Q109 82 104 70" style="fill:none;stroke:rgba(0,0,0,0.35);stroke-width:2;stroke-linecap:round"/>')},
    {"key": "nez-large", "name": "Nez large", "slot": "nose", "anchor": "eyes", "svg": svg(
        '<ellipse cx="100" cy="78" rx="9" ry="5" style="fill:rgba(0,0,0,0.10)"/>'
        '<path d="M92 80 Q100 88 108 80" style="fill:none;stroke:rgba(0,0,0,0.35);stroke-width:2.2;stroke-linecap:round"/>')},
    # --- bouche et expression
    {"key": "bouche-sourire", "name": "Sourire", "slot": "mouth", "anchor": "mouth", "svg": svg(
        '<path d="M88 84 Q100 96 112 84" style="fill:none;stroke:#5a2a20;stroke-width:3;stroke-linecap:round"/>')},
    {"key": "bouche-neutre", "name": "Expression neutre", "slot": "mouth", "anchor": "mouth", "svg": svg(
        '<path d="M90 88 L110 88" style="fill:none;stroke:#5a2a20;stroke-width:3;stroke-linecap:round"/>')},
    {"key": "bouche-rire", "name": "Grand sourire", "slot": "mouth", "anchor": "mouth", "svg": svg(
        '<path d="M86 83 Q100 102 114 83 Z" fill="#5a1f1a"/><path d="M89 84 L111 84 L109 88 L91 88 Z" fill="#ffffff"/>')},
    {"key": "bouche-levres", "genders": W, "name": "Lèvres colorées (rouge à lèvres)", "slot": "mouth", "anchor": "mouth", "defaults": {"primary": "#8a2c3a"},
     "palette": {"primary": ["#8a2c3a", "#b23a48", "#6d2335", "#c0605a", "#4a1d24"]}, "svg": svg(
        f'<path d="M88 86 Q94 81 100 84 Q106 81 112 86 Q100 96 88 86 Z" {F("primary", "#8a2c3a")}/>'
        '<path d="M89 86 Q100 89 111 86" style="fill:none;stroke:rgba(0,0,0,0.25);stroke-width:1"/>')},
    # --- barbe
    {"key": "barbe-courte", "name": "Barbe courte", "slot": "beard", "anchor": "mouth", "genders": M, "svg": svg(
        f'<path d="M68 70 Q70 104 100 106 Q130 104 132 70 Q128 92 116 96 Q100 100 84 96 Q72 92 68 70 Z" {F("hair", "#1b1b1b", ";opacity:0.9")}/>')},
    {"key": "barbe-bouc", "name": "Bouc", "slot": "beard", "anchor": "mouth", "genders": M, "svg": svg(
        f'<path d="M90 96 Q100 110 110 96 Q100 102 90 96 Z" {HR}/>')},
    {"key": "moustache", "name": "Moustache", "slot": "beard", "anchor": "mouth", "genders": M, "svg": svg(
        f'<path d="M86 80 Q100 74 114 80 Q108 84 100 81 Q92 84 86 80 Z" {HR}/>')},
    # --- coiffures
    {"key": "coiffure-rase", "name": "Coupe rase", "slot": "hair", "anchor": "head_top", "hint": "short", "svg": svg(
        f'<path d="M66 60 Q64 22 100 22 Q136 22 134 60 Q130 38 100 36 Q70 38 66 60 Z" {F("hair", "#1b1b1b", ";opacity:0.85")}/>')},
    {"key": "coiffure-courte", "name": "Coupe courte", "slot": "hair", "anchor": "head_top", "hint": "short", "svg": svg(
        f'<path d="M63 66 Q58 14 100 13 Q142 14 137 66 Q134 40 120 32 Q100 40 80 32 Q66 40 63 66 Z" {HR}/>')},
    {"key": "coiffure-afro", "name": "Afro", "slot": "hair", "anchor": "head_top", "hint": "afro", "svg": svg(
        f'<g data-babi-layer="back"><circle cx="100" cy="50" r="54" {HR}/></g>'
        f'<path d="M60 62 Q56 14 100 10 Q144 14 140 62 Q134 34 100 30 Q66 34 60 62 Z" {HR}/>')},
    {"key": "coiffure-tresses", "name": "Tresses plaquées", "slot": "hair", "anchor": "head_top", "hint": "braids", "svg": svg(
        f'<g data-babi-layer="back"><rect x="64" y="56" width="10" height="90" rx="5" {HR}/><rect x="126" y="56" width="10" height="90" rx="5" {HR}/>'
        f'<rect x="76" y="60" width="10" height="84" rx="5" {HR}/><rect x="114" y="60" width="10" height="84" rx="5" {HR}/></g>'
        f'<path d="M64 62 Q60 18 100 18 Q140 18 136 62 Q132 30 100 30 Q68 30 64 62 Z" {HR}/>'
        '<path d="M84 22 L84 44 M100 19 L100 42 M116 22 L116 44" style="fill:none;stroke:rgba(255,255,255,0.2);stroke-width:2"/>')},
    {"key": "coiffure-crete", "name": "Crête", "slot": "hair", "anchor": "head_top", "hint": "short", "svg": svg(
        f'<path d="M66 60 Q64 26 100 24 Q136 26 134 60 Q130 40 100 38 Q70 40 66 60 Z" {F("hair", "#1b1b1b", ";opacity:0.45")}/>'
        f'<path d="M88 40 Q92 4 100 2 Q108 4 112 40 Q100 34 88 40 Z" {HR}/>')},
    {"key": "coiffure-bantu", "genders": W, "name": "Bantu knots", "slot": "hair", "anchor": "head_top", "hint": "braids", "svg": svg(
        f'<path d="M64 62 Q60 20 100 20 Q140 20 136 62 Q132 32 100 32 Q68 32 64 62 Z" {HR}/>'
        f'<circle cx="82" cy="28" r="9" {HR}/><circle cx="100" cy="20" r="10" {HR}/><circle cx="118" cy="28" r="9" {HR}/>'
        f'<circle cx="70" cy="44" r="8" {HR}/><circle cx="130" cy="44" r="8" {HR}/>')},
    {"key": "coiffure-chignon", "genders": W, "name": "Chignon haut", "slot": "hair", "anchor": "head_top", "hint": "short", "svg": svg(
        f'<circle cx="100" cy="16" r="15" {HR}/>'
        f'<path d="M64 62 Q60 22 100 22 Q140 22 136 62 Q132 36 100 34 Q68 36 64 62 Z" {HR}/>')},
    {"key": "coiffure-longue", "genders": W, "name": "Cheveux longs lissés", "slot": "hair", "anchor": "head_top", "hint": "short", "svg": svg(
        f'<g data-babi-layer="back"><path d="M60 50 Q60 10 100 10 Q140 10 140 50 L146 150 Q100 160 54 150 Z" {HR}/></g>'
        f'<path d="M62 62 Q58 12 100 12 Q142 12 138 62 Q130 30 108 30 Q96 44 74 40 Q66 46 62 62 Z" {HR}/>')},
    # --- accessoires capillaires et couvre-chefs
    {"key": "bandeau", "name": "Bandeau", "slot": "hair_accessory", "anchor": "head_top", "defaults": {"primary": "#e67e22"},
     "incompatible_slots": ["headwear"], "svg": svg(f'<path d="M64 44 Q100 26 136 44 L136 52 Q100 34 64 52 Z" {F("primary", "#e67e22")}/>')},
    {"key": "casquette", "name": "Casquette", "slot": "headwear", "anchor": "head_top", "defaults": {"primary": "#c0392b", "secondary": "#1d2a30"},
     "incompatible_slots": ["hair_accessory"], "incompatible": ["coiffure-afro", "coiffure-bantu", "coiffure-chignon", "coiffure-crete"], "svg": svg(
        f'<path d="M62 46 Q62 6 100 6 Q138 6 138 46 Z" {F("primary", "#c0392b")}/>'
        f'<path d="M60 44 L150 42 Q156 50 140 54 L62 52 Z" {F("secondary", "#1d2a30")}/><circle cx="100" cy="8" r="4" {F("secondary", "#1d2a30")}/>')},
    {"key": "foulard", "genders": W, "name": "Foulard noué", "slot": "headwear", "anchor": "head_top", "defaults": {"primary": "#8e44ad", "secondary": "#f1c40f"},
     "incompatible_slots": ["hair_accessory"], "incompatible": ["coiffure-afro", "coiffure-crete", "coiffure-chignon"], "svg": svg(
        f'<path d="M58 66 Q50 2 100 2 Q150 2 142 66 Q136 30 100 28 Q64 30 58 66 Z" {F("primary", "#8e44ad")}/>'
        f'<path d="M86 8 Q100 0 116 6 Q124 18 112 22 Q100 12 88 20 Q78 16 86 8 Z" {F("secondary", "#f1c40f")}/>')},
    {"key": "chapeau-paille", "name": "Chapeau de paille", "slot": "headwear", "anchor": "head_top", "defaults": {"primary": "#d9b26a", "secondary": "#6b4423"},
     "incompatible_slots": ["hair_accessory"], "incompatible": ["coiffure-afro", "coiffure-crete", "coiffure-chignon", "coiffure-bantu"], "svg": svg(
        f'<ellipse cx="100" cy="40" rx="60" ry="11" {F("primary", "#d9b26a")}/>'
        f'<path d="M72 40 Q72 6 100 6 Q128 6 128 40 Z" {F("primary", "#d9b26a")}/>'
        f'<rect x="72" y="29" width="56" height="8" {F("secondary", "#6b4423")}/>')},
    # --- lunettes et bijoux
    {"key": "lunettes-vue", "name": "Lunettes de vue", "slot": "glasses", "anchor": "eyes", "defaults": {"primary": "#222222"}, "svg": svg(
        f'<rect x="74" y="53" width="24" height="18" rx="6" style="fill:rgba(255,255,255,0.15);stroke:var(--babi-primary,#222222);stroke-width:2.5"/>'
        f'<rect x="102" y="53" width="24" height="18" rx="6" style="fill:rgba(255,255,255,0.15);stroke:var(--babi-primary,#222222);stroke-width:2.5"/>'
        f'<path d="M98 60 L102 60 M74 60 L66 58 M126 60 L134 58" {ST("primary", "#222222", 2.5)}/>')},
    {"key": "lunettes-soleil", "name": "Lunettes de soleil", "slot": "glasses", "anchor": "eyes", "defaults": {"primary": "#111111", "secondary": "#1d2731"}, "svg": svg(
        '<rect x="73" y="53" width="25" height="17" rx="7" style="fill:var(--babi-secondary,#1d2731);stroke:var(--babi-primary,#111111);stroke-width:2"/>'
        '<rect x="102" y="53" width="25" height="17" rx="7" style="fill:var(--babi-secondary,#1d2731);stroke:var(--babi-primary,#111111);stroke-width:2"/>'
        f'<path d="M98 59 L102 59 M73 59 L66 57 M127 59 L134 57" {ST("primary", "#111111", 2.4)}/>')},
    {"key": "collier-perles", "name": "Collier de perles", "slot": "jewelry", "anchor": "neck", "defaults": {"primary": "#f1c40f", "accent": "#c0392b"}, "svg": svg(
        f'<path d="M86 116 Q100 132 114 116" {ST("primary", "#f1c40f", 2)}/>'
        + "".join(f'<circle cx="{x}" cy="{116 + (14 - abs(x - 100)) * 0.9:.1f}" r="2.6" {F("accent" if i % 2 else "primary", "#c0392b" if i % 2 else "#f1c40f")}/>'
                  for i, x in enumerate(range(88, 113, 4))))},
    {"key": "boucles-oreilles", "genders": W, "name": "Boucles d'oreilles", "slot": "jewelry", "anchor": "ears", "defaults": {"primary": "#f1c40f"}, "svg": svg(
        f'<circle cx="66" cy="80" r="4" {F("primary", "#f1c40f")}/><circle cx="134" cy="80" r="4" {F("primary", "#f1c40f")}/>')},
    {"key": "montre", "name": "Montre", "slot": "watch", "anchor": "wrist_left", "defaults": {"primary": "#2c3e50", "secondary": "#ecf0f1"}, "svg": svg(
        f'<rect x="43" y="232" width="14" height="9" rx="2" {F("primary", "#2c3e50")}/><rect x="46" y="233.5" width="8" height="6" rx="1" {F("secondary", "#ecf0f1")}/>')},
    # --- sacs
    {"key": "sac-bandouliere", "name": "Sac bandoulière", "slot": "bag", "anchor": "shoulders", "defaults": {"primary": "#a0522d", "secondary": "#5a3a22"}, "svg": svg(
        f'<path d="M132 124 L80 206" {ST("secondary", "#5a3a22", 5)}/>'
        f'<rect x="62" y="202" width="34" height="28" rx="5" {F("primary", "#a0522d")}/><path d="M62 210 L96 210 L96 204 Q96 202 94 202 L64 202 Q62 202 62 204 Z" {F("secondary", "#5a3a22")}/>')},
    {"key": "sac-a-dos", "name": "Sac à dos", "slot": "bag", "anchor": "shoulders", "defaults": {"primary": "#2980b9", "secondary": "#1d2a30"}, "svg": svg(
        f'<g data-babi-layer="back"><rect x="64" y="126" width="72" height="82" rx="12" {F("primary", "#2980b9")}/></g>'
        f'<path d="M76 124 L82 200 M124 124 L118 200" {ST("secondary", "#1d2a30", 6)}/>')},
    # --- hauts
    {"key": "tshirt", "name": "T-shirt", "slot": "top", "anchor": "shoulders", "defaults": {"primary": "#2980b9", "secondary": "#ecf0f1"}, "svg": svg(
        f'<path d="M64 122 Q100 108 136 122 L160 158 L144 170 L134 150 L130 230 L70 230 L66 150 L56 170 L40 158 Z" {F("primary", "#2980b9")}/>'
        f'{NECKLINE}<path d="M87 117 Q100 133 113 117" {ST("secondary", "#ecf0f1", 4)}/>')},
    {"key": "chemise", "name": "Chemise manches longues", "slot": "top", "anchor": "shoulders", "defaults": {"primary": "#ecf0f1", "secondary": "#2c3e50"}, "svg": svg(
        f'<path d="M64 122 Q100 108 136 122 L154 196 L158 242 L144 244 L134 160 L130 232 L70 232 L66 160 L56 244 L42 242 L46 196 Z" {F("primary", "#ecf0f1")}/>'
        f'{NECKLINE}<path d="M86 114 L100 132 L114 114 L119 124 L100 140 L81 124 Z" {F("secondary", "#2c3e50")}/>'
        f'<path d="M100 140 L100 230" style="fill:none;stroke:rgba(0,0,0,0.18);stroke-width:1.5"/>'
        + "".join(f'<circle cx="100" cy="{y}" r="2.2" {F("secondary", "#2c3e50")}/>' for y in (152, 172, 192, 212)))},
    {"key": "debardeur", "name": "Débardeur", "slot": "top", "anchor": "shoulders", "defaults": {"primary": "#f1c40f"}, "svg": svg(
        f'<path d="M76 120 L86 118 Q100 140 114 118 L124 120 L130 230 L70 230 Z" {F("primary", "#f1c40f")}/>')},
    {"key": "polo", "name": "Polo", "slot": "top", "anchor": "shoulders", "defaults": {"primary": "#27ae60", "secondary": "#ffffff"}, "svg": svg(
        f'<path d="M64 122 Q100 108 136 122 L160 158 L144 170 L134 150 L130 230 L70 230 L66 150 L56 170 L40 158 Z" {F("primary", "#27ae60")}/>'
        f'{NECKLINE}<path d="M86 114 L100 126 L94 134 L82 120 Z M114 114 L100 126 L106 134 L118 120 Z" {F("secondary", "#ffffff")}/>'
        f'<circle cx="100" cy="138" r="2" {F("secondary", "#ffffff")}/><circle cx="100" cy="148" r="2" {F("secondary", "#ffffff")}/>')},
    # --- surcouches
    {"key": "veste", "name": "Veste ouverte", "slot": "outerwear", "anchor": "shoulders", "requires_slots": ["top"],
     "defaults": {"primary": "#34495e", "secondary": "#2c3e50"}, "svg": svg(
        pair("M62 124 Q80 112 94 118 L96 238 L66 236 L64 162 L54 246 L40 244 L44 198 Z", F("primary", "#34495e"))
        + pair("M86 116 L94 120 L92 150 L82 132 Z", F("secondary", "#2c3e50")))},
    {"key": "gilet", "name": "Gilet sans manches", "slot": "outerwear", "anchor": "shoulders", "requires_slots": ["top"],
     "defaults": {"primary": "#7f8c8d"}, "svg": svg(pair("M70 122 Q84 116 94 118 L96 232 L70 232 L66 160 Z", F("primary", "#7f8c8d")))},
    # --- bas
    {"key": "pantalon", "name": "Pantalon", "slot": "bottom", "anchor": "waist", "defaults": {"primary": "#2c3e50", "secondary": "#1b1b1b"}, "svg": svg(
        f'<path d="M70 222 L130 222 L132 300 L128 352 L104 352 L101 252 L99 252 L96 352 L72 352 L68 300 Z" {F("primary", "#2c3e50")}/>'
        f'<rect x="70" y="222" width="60" height="7" {F("secondary", "#1b1b1b")}/>')},
    {"key": "jean", "name": "Jean", "slot": "bottom", "anchor": "waist", "defaults": {"primary": "#3b5b8c", "secondary": "#d4a24c"}, "svg": svg(
        f'<path d="M70 222 L130 222 L132 300 L128 352 L104 352 L101 252 L99 252 L96 352 L72 352 L68 300 Z" {F("primary", "#3b5b8c")}/>'
        f'<path d="M84 230 L84 350 M116 230 L116 350 M74 238 Q84 246 92 236 M126 238 Q116 246 108 236" {ST("secondary", "#d4a24c", 1.2)}/>')},
    {"key": "short", "name": "Short", "slot": "bottom", "anchor": "waist", "defaults": {"primary": "#16a085", "secondary": "#0e6655"}, "svg": svg(
        f'<path d="M70 222 L130 222 L134 282 L104 284 L100 252 L96 284 L66 282 Z" {F("primary", "#16a085")}/>'
        f'<rect x="70" y="222" width="60" height="6" {F("secondary", "#0e6655")}/>')},
    {"key": "jupe", "genders": W, "name": "Jupe", "slot": "bottom", "anchor": "waist", "defaults": {"primary": "#c0392b", "secondary": "#7b241c"}, "svg": svg(
        f'<path d="M72 220 L128 220 L144 302 L56 302 Z" {F("primary", "#c0392b")}/><rect x="72" y="220" width="56" height="7" {F("secondary", "#7b241c")}/>')},
    {"key": "pagne-long", "genders": W, "name": "Pagne long", "slot": "bottom", "anchor": "waist", "defaults": {"primary": "#e67e22", "secondary": "#6e2c00"}, "svg": svg(
        f'<path d="M70 220 L130 220 L136 350 L64 350 Z" {F("primary", "#e67e22")}/><path d="M118 220 L106 350" {ST("secondary", "#6e2c00", 3)}/>')},
    # --- robes
    {"key": "robe", "genders": W, "name": "Robe", "slot": "dress", "anchor": "shoulders", "incompatible_slots": ["top", "bottom"],
     "defaults": {"primary": "#8e44ad", "secondary": "#f1c40f"}, "svg": svg(
        f'<path d="M68 122 Q100 110 132 122 L140 140 L128 150 L126 200 L150 330 L50 330 L74 200 L72 150 L60 140 Z" {F("primary", "#8e44ad")}/>'
        f'{NECKLINE}<rect x="74" y="196" width="52" height="8" {F("secondary", "#f1c40f")}/>')},
    {"key": "boubou", "name": "Boubou", "slot": "dress", "anchor": "shoulders", "incompatible_slots": ["top", "bottom", "outerwear"],
     "defaults": {"primary": "#ecf0f1", "secondary": "#c9a227"}, "svg": svg(
        f'<path d="M60 122 Q100 106 140 122 L180 232 L152 244 L140 214 L146 352 L54 352 L60 214 L48 244 L20 232 Z" {F("primary", "#ecf0f1")}/>'
        f'{NECKLINE}<path d="M86 118 Q100 152 114 118 M100 150 L100 220" {ST("secondary", "#c9a227", 4)}/>')},
    # --- chaussures
    {"key": "baskets", "name": "Baskets", "slot": "shoes", "anchor": "feet", "defaults": {"primary": "#ecf0f1", "secondary": "#c0392b"}, "svg": svg(
        f'<path d="M70 348 L98 348 L100 366 L66 368 Q64 356 70 348 Z M102 348 L130 348 Q136 356 134 368 L100 366 Z" {F("primary", "#ecf0f1")}/>'
        f'<rect x="64" y="364" width="37" height="6" rx="3" {F("secondary", "#c0392b")}/><rect x="99" y="364" width="37" height="6" rx="3" {F("secondary", "#c0392b")}/>')},
    {"key": "sandales", "name": "Sandales", "slot": "shoes", "anchor": "feet", "defaults": {"primary": "#6b4423", "secondary": "#3e2716"}, "svg": svg(
        f'<rect x="72" y="362" width="28" height="5" rx="2.5" {F("secondary", "#3e2716")}/><rect x="100" y="362" width="28" height="5" rx="2.5" {F("secondary", "#3e2716")}/>'
        f'<path d="M76 354 L96 354 M104 354 L124 354" {ST("primary", "#6b4423", 4)}/>')},
    {"key": "chaussures-ville", "name": "Chaussures de ville", "slot": "shoes", "anchor": "feet", "defaults": {"primary": "#3a2a20"},
     "palette": {"primary": ["#3a2a20", "#111111", "#6b4423", "#7b241c"]}, "svg": svg(
        f'<path d="M72 350 L98 350 L99 366 L66 366 Q66 354 72 350 Z M102 350 L128 350 Q134 354 134 366 L101 366 Z" {F("primary", "#3a2a20")}/>'
        '<path d="M74 355 L84 353 M116 353 L126 355" style="fill:none;stroke:rgba(255,255,255,0.35);stroke-width:1.5;stroke-linecap:round"/>')},
    # --- maquillage (réservé aux silhouettes féminines)
    {"key": "rouge-a-levres", "name": "Rouge à lèvres", "slot": "makeup", "anchor": "mouth", "genders": W, "defaults": {"primary": "#c0392b"},
     "palette": {"primary": ["#c0392b", "#8a2c3a", "#b23a48", "#d35400", "#6d2335", "#e84393"]}, "tags": ["maquillage"], "svg": svg(
        f'<path d="M88 86 Q94 80.5 100 83.5 Q106 80.5 112 86 Q100 97 88 86 Z" {F("primary", "#c0392b")}/>'
        '<ellipse cx="96" cy="89.5" rx="3" ry="1.2" style="fill:rgba(255,255,255,0.45)"/>')},
    {"key": "fard-paupieres", "name": "Fard à paupières", "slot": "makeup", "anchor": "eyes", "genders": W, "defaults": {"primary": "#8e44ad"}, "tags": ["maquillage"],
     "svg": svg(pair("M76 59 Q86 49 96 58 Q86 54 76 59 Z", F("primary", "#8e44ad", ";opacity:0.7")))},
    {"key": "khol", "name": "Khôl et cils", "slot": "makeup", "anchor": "eyes", "genders": W, "defaults": {"primary": "#1b1b1b"}, "tags": ["maquillage"],
     "svg": svg(pair("M77 61 Q86 55 96 60 L98 58", ST("primary", "#1b1b1b", 1.8)) + pair("M80 58 L78 55 M85 56 L84 53 M90 56 L91 53", ST("primary", "#1b1b1b", 1.2)))},
    {"key": "fard-joues", "name": "Fard à joues", "slot": "makeup", "anchor": "eyes", "genders": W, "defaults": {"primary": "#e17055"}, "tags": ["maquillage"],
     "svg": svg(f'<ellipse cx="80" cy="76" rx="8" ry="4.5" {F("primary", "#e17055", ";opacity:0.35")}/><ellipse cx="120" cy="76" rx="8" ry="4.5" {F("primary", "#e17055", ";opacity:0.35")}/>')},
    # --- coiffures féminines supplémentaires
    {"key": "coiffure-nattes", "name": "Nattes longues (box braids)", "slot": "hair", "anchor": "head_top", "hint": "braids", "genders": W, "svg": svg(
        '<g data-babi-layer="back">' + "".join(f'<rect x="{x}" y="50" width="7" height="{150 - abs(x - 97) // 2}" rx="3.5" {HR}/>' for x in range(56, 140, 8)) + '</g>'
        f'<path d="M62 62 Q58 16 100 16 Q142 16 138 62 Q132 30 100 30 Q68 30 62 62 Z" {HR}/>'
        '<path d="M80 22 L76 48 M92 18 L90 40 M108 18 L110 40 M120 22 L124 48" style="fill:none;stroke:rgba(255,255,255,0.18);stroke-width:2"/>')},
    {"key": "coiffure-queue", "name": "Queue de cheval", "slot": "hair", "anchor": "head_top", "hint": "short", "genders": W, "svg": svg(
        f'<g data-babi-layer="back"><path d="M124 30 Q160 50 150 120 Q146 150 134 160 Q140 120 132 80 Q128 56 116 40 Z" {HR}/></g>'
        f'<path d="M64 62 Q60 20 100 20 Q140 20 136 62 Q132 34 100 32 Q68 34 64 62 Z" {HR}/>'
        f'<circle cx="124" cy="32" r="5" {F("primary", "#e84393")}/>', ), "defaults": {"primary": "#e84393"}},
    # --- bijoux et sac féminins
    {"key": "creoles", "name": "Créoles", "slot": "jewelry", "anchor": "ears", "genders": W, "defaults": {"primary": "#f1c40f"}, "svg": svg(
        f'<circle cx="66" cy="84" r="7" {ST("primary", "#f1c40f", 2)}/><circle cx="134" cy="84" r="7" {ST("primary", "#f1c40f", 2)}/>')},
    {"key": "sac-a-main", "name": "Sac à main", "slot": "bag", "anchor": "wrist_right", "genders": W, "defaults": {"primary": "#c0392b", "secondary": "#7b241c"}, "svg": svg(
        f'<path d="M144 244 Q153 228 162 244" {ST("secondary", "#7b241c", 2.5)}/>'
        f'<path d="M138 244 L168 244 L172 268 Q153 274 134 268 Z" {F("primary", "#c0392b")}/><rect x="150" y="248" width="6" height="4" rx="1" {F("secondary", "#7b241c")}/>')},
    # --- hauts : blouse (femmes), chemise et cravate (hommes)
    {"key": "blouse", "name": "Blouse à manches bouffantes", "slot": "top", "anchor": "shoulders", "genders": W, "defaults": {"primary": "#f8c9d4", "secondary": "#c0392b"}, "svg": svg(
        f'<path d="M66 122 Q100 110 134 122 L130 196 Q140 214 132 230 L68 230 Q60 214 70 196 Z" {F("primary", "#f8c9d4")}/>'
        f'<ellipse cx="60" cy="140" rx="17" ry="20" {F("primary", "#f8c9d4")}/><ellipse cx="140" cy="140" rx="17" ry="20" {F("primary", "#f8c9d4")}/>'
        f'{NECKLINE}<path d="M70 198 Q100 206 130 198" {ST("secondary", "#c0392b", 3)}/><path d="M87 117 Q100 133 113 117" {ST("secondary", "#c0392b", 2.5)}/>')},
    {"key": "chemise-cravate", "name": "Chemise et cravate", "slot": "top", "anchor": "shoulders", "genders": M, "defaults": {"primary": "#ecf0f1", "secondary": "#1e3d6b"}, "svg": svg(
        f'<path d="M64 122 Q100 108 136 122 L154 196 L158 242 L144 244 L134 160 L130 232 L70 232 L66 160 L56 244 L42 242 L46 196 Z" {F("primary", "#ecf0f1")}/>'
        f'{NECKLINE}<path d="M86 114 L100 128 L114 114 L118 122 L100 134 L82 122 Z" {F("primary", "#ecf0f1")}/>'
        '<path d="M86 114 L100 128 L114 114" style="fill:none;stroke:rgba(0,0,0,0.25);stroke-width:1.5"/>'
        f'<path d="M96 128 L104 128 L102 136 L98 136 Z M98 136 L102 136 L108 196 L100 206 L92 196 Z" {F("secondary", "#1e3d6b")}/>')},
    # --- robes féminines supplémentaires
    {"key": "kaba", "name": "Kaba (robe ample)", "slot": "dress", "anchor": "shoulders", "genders": W, "incompatible_slots": ["top", "bottom", "outerwear"],
     "defaults": {"primary": "#e67e22", "secondary": "#6e2c00"}, "svg": svg(
        f'<path d="M62 122 Q100 108 138 122 L172 200 L150 210 L138 180 L150 352 L50 352 L62 180 L50 210 L28 200 Z" {F("primary", "#e67e22")}/>'
        f'{NECKLINE}<path d="M86 118 Q100 138 114 118" {ST("secondary", "#6e2c00", 3)}/><path d="M52 340 L148 340" {ST("secondary", "#6e2c00", 4)}/>')},
    {"key": "robe-longue", "name": "Robe longue ajustée", "slot": "dress", "anchor": "shoulders", "genders": W, "incompatible_slots": ["top", "bottom"],
     "defaults": {"primary": "#1e3d6b", "secondary": "#f1c40f"}, "svg": svg(
        f'<path d="M76 120 L88 118 Q100 136 112 118 L124 120 L128 196 Q122 214 128 240 L136 352 L64 352 L72 240 Q78 214 72 196 Z" {F("primary", "#1e3d6b")}/>'
        f'<path d="M72 200 Q100 210 128 200" {ST("secondary", "#f1c40f", 3)}/>')},
    # --- chaussures féminines
    {"key": "escarpins", "name": "Escarpins à talons", "slot": "shoes", "anchor": "feet", "genders": W, "defaults": {"primary": "#c0392b"},
     "palette": {"primary": ["#c0392b", "#111111", "#ecf0f1", "#d4a24c", "#e84393", "#1e3d6b"]}, "svg": svg(
        f'<rect x="76" y="360" width="3" height="10" {F("primary", "#c0392b")}/><rect x="121" y="360" width="3" height="10" {F("primary", "#c0392b")}/>'
        f'<path d="M74 354 Q86 348 98 353 L99 364 Q86 368 72 362 Z M102 353 Q114 348 126 354 L128 362 Q114 368 101 364 Z" {F("primary", "#c0392b")}/>'
        '<path d="M78 355 Q86 352 94 355 M106 355 Q114 352 122 355" style="fill:none;stroke:rgba(255,255,255,0.4);stroke-width:1.4;stroke-linecap:round"/>')},
    {"key": "sandales-talons", "name": "Sandales à talons", "slot": "shoes", "anchor": "feet", "genders": W, "defaults": {"primary": "#d4a24c", "secondary": "#6b4423"}, "svg": svg(
        f'<rect x="77" y="360" width="3" height="10" {F("secondary", "#6b4423")}/><rect x="120" y="360" width="3" height="10" {F("secondary", "#6b4423")}/>'
        f'<rect x="72" y="362" width="28" height="4" rx="2" {F("secondary", "#6b4423")}/><rect x="100" y="362" width="28" height="4" rx="2" {F("secondary", "#6b4423")}/>'
        f'<path d="M76 352 L96 356 M76 358 L96 352 M104 356 L124 352 M104 352 L124 358" {ST("primary", "#d4a24c", 2.5)}/>')},
    {"key": "ballerines", "name": "Ballerines", "slot": "shoes", "anchor": "feet", "genders": W, "defaults": {"primary": "#e84393", "secondary": "#ffffff"}, "svg": svg(
        f'<path d="M72 356 Q86 352 98 356 L99 367 L68 367 Q68 359 72 356 Z M102 356 Q114 352 128 356 Q132 359 132 367 L101 367 Z" {F("primary", "#e84393")}/>'
        f'<circle cx="86" cy="357" r="2.2" {F("secondary", "#ffffff")}/><circle cx="114" cy="357" r="2.2" {F("secondary", "#ffffff")}/>')},
    # --- motifs (tuiles répétées)
    {"key": "motif-rayures", "name": "Motif rayures", "slot": "pattern", "defaults": {"primary": "#2980b9", "secondary": "#ecf0f1"}, "svg": svg(
        f'<rect width="20" height="20" {F("primary", "#2980b9")}/><rect width="20" height="7" {F("secondary", "#ecf0f1")}/>', "0 0 20 20")},
    {"key": "motif-wax", "name": "Motif wax (cercles)", "slot": "pattern", "defaults": {"primary": "#e67e22", "secondary": "#1e3d6b", "accent": "#f1c40f"}, "svg": svg(
        f'<rect width="24" height="24" {F("primary", "#e67e22")}/><circle cx="12" cy="12" r="8" {F("secondary", "#1e3d6b")}/>'
        f'<circle cx="12" cy="12" r="4" {F("accent", "#f1c40f")}/>'
        + "".join(f'<circle cx="{x}" cy="{y}" r="4" {F("secondary", "#1e3d6b")}/>' for x in (0, 24) for y in (0, 24)), "0 0 24 24")},
    {"key": "motif-carreaux", "name": "Motif carreaux", "slot": "pattern", "defaults": {"primary": "#ecf0f1", "secondary": "#c0392b"}, "svg": svg(
        f'<rect width="20" height="20" {F("primary", "#ecf0f1")}/><rect width="20" height="6" {F("secondary", "#c0392b", ";opacity:0.55")}/>'
        f'<rect width="6" height="20" {F("secondary", "#c0392b", ";opacity:0.55")}/>', "0 0 20 20")},
    {"key": "motif-pois", "name": "Motif à pois", "slot": "pattern", "defaults": {"primary": "#1d2a30", "secondary": "#ecf0f1"}, "svg": svg(
        f'<rect width="16" height="16" {F("primary", "#1d2a30")}/><circle cx="8" cy="8" r="3" {F("secondary", "#ecf0f1")}/>', "0 0 16 16")},
]

# Habitants de démonstration : composants désignés par leur nom technique
CHARACTERS = [
    {"key": "habitant-kouadio", "name": "Kouadio, commerçant", "sub": "Commerçant", "role": "Tient la boutique de l'avenue",
     "body": "corps-homme", "skin": "#8d5524", "hair_color": "#1b1b1b", "eye_color": "#3b2414",
     "layers": {"eyes": ("yeux-ronds", {}), "eyebrows": ("sourcils-droits", {}), "nose": ("nez-arrondi", {}), "mouth": ("bouche-sourire", {}),
                "beard": ("barbe-courte", {}), "hair": ("coiffure-courte", {}),
                "top": ("chemise", {"secondary": "#1e3d6b"}, ("motif-wax", {"primary": "#e67e22", "secondary": "#1e3d6b", "accent": "#f1c40f"})),
                "bottom": ("pantalon", {"primary": "#2c3e50"}), "shoes": ("chaussures-ville", {"primary": "#3a2a20"}), "watch": ("montre", {})},
     "variants": [
         {"id": "dimanche", "name": "Tenue du dimanche", "layers": {"top": None, "bottom": None, "dress": ("boubou", {"primary": "#ecf0f1", "secondary": "#c9a227"})}},
         {"id": "decontracte", "name": "Décontracté", "layers": {"top": ("tshirt", {"primary": "#c0392b"}), "bottom": ("short", {}), "shoes": ("baskets", {})}},
     ]},
    {"key": "habitante-awa", "name": "Awa, pharmacienne", "sub": "Personnel de santé", "role": "Pharmacie du quartier",
     "body": "corps-femme", "skin": "#c68642", "hair_color": "#2b1a12", "eye_color": "#2b1a12",
     "layers": {"eyes": ("yeux-amande", {}), "eyebrows": ("sourcils-arques", {}), "nose": ("nez-large", {}), "mouth": ("bouche-levres", {"primary": "#b23a48"}),
                "hair": ("coiffure-chignon", {}), "dress": ("robe", {"primary": "#16a085", "secondary": "#ecf0f1"}),
                "jewelry": ("boucles-oreilles", {}), "shoes": ("sandales", {})},
     "variants": [
         {"id": "marche", "name": "Jour de marché", "layers": {"dress": None, "top": ("tshirt", {"primary": "#f1c40f"}),
                                                               "bottom": ("pagne-long", {}, ("motif-wax", {"primary": "#8e44ad", "secondary": "#f1c40f", "accent": "#ecf0f1"})),
                                                               "hair": None, "headwear": ("foulard", {})}},
     ]},
    {"key": "habitant-yao", "name": "Yao, élève", "sub": "Élève", "role": "Lycéen du quartier",
     "body": "corps-homme", "skin": "#5c3a1e", "hair_color": "#111111", "eye_color": "#2a1a10",
     "layers": {"eyes": ("yeux-ronds", {}), "eyebrows": ("sourcils-arques", {}), "nose": ("nez-large", {}), "mouth": ("bouche-rire", {}),
                "hair": ("coiffure-afro", {}), "top": ("tshirt", {"primary": "#f39c12", "secondary": "#ffffff"}), "bottom": ("short", {"primary": "#2c3e50"}),
                "shoes": ("baskets", {"primary": "#ffffff", "secondary": "#2980b9"}), "bag": ("sac-a-dos", {"primary": "#c0392b"})},
     "variants": [{"id": "uniforme", "name": "Uniforme scolaire", "layers": {"top": ("chemise", {"primary": "#d6eaf8", "secondary": "#1b4f72"}),
                                                                            "bottom": ("pantalon", {"primary": "#1b4f72"})}}]},
{"key": "habitante-aminata", "name": "Aminata, coiffeuse", "sub": "Commerçant", "role": "Salon de coiffure de la rue des Fromagers",
     "body": "corps-femme", "skin": "#8d5524", "hair_color": "#111111", "eye_color": "#2b1a12",
     "layers": {"eyes": ("yeux-amande", {}), "eyebrows": ("sourcils-arques", {}), "nose": ("nez-arrondi", {}), "mouth": ("bouche-sourire", {}),
                "makeup": ("rouge-a-levres", {"primary": "#b23a48"}), "hair": ("coiffure-nattes", {}),
                "top": ("blouse", {"primary": "#f8c9d4", "secondary": "#c0392b"}),
                "bottom": ("jupe", {"secondary": "#1e3d6b"}, ("motif-wax", {"primary": "#1e3d6b", "secondary": "#e67e22", "accent": "#f1c40f"})),
                "shoes": ("escarpins", {"primary": "#c0392b"}), "jewelry": ("creoles", {}), "bag": ("sac-a-main", {})},
     "variants": [{"id": "soiree", "name": "Tenue de soirée", "layers": {"top": None, "bottom": None, "dress": ("robe-longue", {}),
                                                                         "makeup": ("fard-paupieres", {"primary": "#8e44ad"}), "shoes": ("sandales-talons", {})}}]},
    {"key": "habitante-adjoua", "name": "Tantie Adjoua, vendeuse de garba", "sub": "Commerçant", "role": "Garba d'Adjoua",
     "body": "corps-femme", "skin": "#6f4422", "hair_color": "#1b1b1b", "eye_color": "#3b2414",
     "layers": {"eyes": ("yeux-rieurs", {}), "eyebrows": ("sourcils-droits", {}), "nose": ("nez-large", {}), "mouth": ("bouche-rire", {}),
                "makeup": ("fard-joues", {}), "hair": ("coiffure-tresses", {}), "headwear": ("foulard", {"primary": "#27ae60", "secondary": "#f1c40f"}),
                "dress": ("kaba", {}, ("motif-wax", {"primary": "#e67e22", "secondary": "#1e3d6b", "accent": "#f1c40f"})),
                "jewelry": ("collier-perles", {}), "shoes": ("sandales", {})}},
    {"key": "habitant-konan", "name": "Konan, agent de banque", "sub": "Agent public", "role": "Agence de transfert de l'avenue",
     "body": "corps-homme", "skin": "#a86b3c", "hair_color": "#1b1b1b", "eye_color": "#3b2414",
     "layers": {"eyes": ("yeux-ronds", {}), "eyebrows": ("sourcils-fronces", {}), "nose": ("nez-arrondi", {}), "mouth": ("bouche-neutre", {}),
                "beard": ("moustache", {}), "hair": ("coiffure-rase", {}), "glasses": ("lunettes-vue", {}),
                "top": ("chemise-cravate", {"secondary": "#7b241c"}), "outerwear": ("veste", {"primary": "#2c3e50"}),
                "bottom": ("pantalon", {"primary": "#2c3e50"}), "shoes": ("chaussures-ville", {"primary": "#111111"}), "watch": ("montre", {})}},
]
