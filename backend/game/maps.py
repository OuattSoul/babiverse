"""Catalogue des cartes jouables (shared/maps.json), partagé avec le client.

Le serveur n'a pas besoin de la géométrie des cartes (elle vit côté client) : il lit ici quelles cartes
existent, ce qui décide des zones qu'il reconnaît dans `pos.zone`. Le catalogue est validé au chargement ;
un catalogue invalide empêche le démarrage plutôt que d'accepter ou de refuser des positions au hasard.

Règles de compatibilité (carte historique, migrée le 2026-10-13) :
- l'identifiant d'une carte est celui stocké dans `Character.zone` (32 caractères au plus) : jamais renommé ;
- seules les cartes « published » sont reconnues ; une carte « disabled » n'efface rien : la position d'un
  joueur qui s'y trouvait reste en base, elle est simplement ignorée tant que la carte est désactivée.
"""
import json
import re
from pathlib import Path

PATH = Path(__file__).resolve().parents[2] / "shared" / "maps.json"
FORMAT = "babiverse-maps"
STATUSES = ("draft", "published", "disabled")
KINDS = ("outdoor", "home", "interior")
SOURCE_TYPES = ("generator",)
# Identifiant de carte : minuscules, chiffres, « _ » ; « int_ » est réservé aux intérieurs générés.
MAP_ID_RE = re.compile(r"^[a-z][a-z0-9_]{0,31}$")
ENTITY_ID_RE = re.compile(r"^[a-z][a-z0-9_]{0,47}$")


class CatalogueError(ValueError):
    """Catalogue de cartes incohérent."""


def check_catalogue(cat):
    """Lève CatalogueError à la première incohérence ; renvoie le catalogue sinon."""
    if not isinstance(cat, dict) or cat.get("format") != FORMAT or cat.get("format_version") != 1:
        raise CatalogueError("format de catalogue inconnu")

    def ids(items, label, pattern):
        seen = set()
        for item in items:
            ident = item.get("id")
            if not isinstance(ident, str) or not pattern.match(ident):
                raise CatalogueError(f"{label} : identifiant invalide {ident!r}")
            if ident in seen:
                raise CatalogueError(f"{label} : identifiant en double {ident!r}")
            if item.get("status") not in STATUSES:
                raise CatalogueError(f"{label} {ident} : statut inconnu {item.get('status')!r}")
            if not isinstance(item.get("name"), str) or not item["name"].strip():
                raise CatalogueError(f"{label} {ident} : nom manquant")
            seen.add(ident)
        return seen

    cities = ids(cat.get("cities", []), "ville", ENTITY_ID_RE)
    districts = ids(cat.get("districts", []), "zone", ENTITY_ID_RE)
    for d in cat["districts"]:
        if d.get("city") not in cities:
            raise CatalogueError(f"zone {d['id']} : ville inconnue {d.get('city')!r}")
    maps = ids(cat.get("maps", []), "carte", MAP_ID_RE)
    for m in cat["maps"]:
        if m["id"].startswith("int_"):
            raise CatalogueError(f"carte {m['id']} : le préfixe int_ est réservé aux intérieurs générés")
        if m.get("district") not in districts:
            raise CatalogueError(f"carte {m['id']} : zone inconnue {m.get('district')!r}")
        if m.get("kind") not in KINDS:
            raise CatalogueError(f"carte {m['id']} : type inconnu {m.get('kind')!r}")
        if (m.get("source") or {}).get("type") not in SOURCE_TYPES:
            raise CatalogueError(f"carte {m['id']} : source non prise en charge")
    gen = cat.get("generated_interiors") or {}
    if gen.get("district") not in districts or not isinstance(gen.get("pattern"), str):
        raise CatalogueError("intérieurs générés : zone ou motif manquant")
    re.compile(gen["pattern"])
    start = next((m for m in cat["maps"] if m["id"] == cat.get("start_map")), None)
    if not start or start["status"] != "published":
        raise CatalogueError(f"carte de départ invalide {cat.get('start_map')!r}")
    if not maps:
        raise CatalogueError("aucune carte")
    return cat


def load(path=PATH):
    return check_catalogue(json.loads(Path(path).read_text(encoding="utf-8")))


CATALOGUE = load()


def published_ids(cat=CATALOGUE):
    """Identifiants des cartes publiées, dans l'ordre du catalogue."""
    return tuple(m["id"] for m in cat["maps"] if m["status"] == "published")


def interior_pattern(cat=CATALOGUE):
    return re.compile(cat["generated_interiors"]["pattern"])


def atelier_maps(pack=None, cat=CATALOGUE):
    """Cartes publiées par l'atelier (pack de jeu), par identifiant. Un identifiant invalide, réservé à une carte
    intégrée ou à un intérieur généré est écarté : le catalogue intégré a toujours priorité."""
    if pack is None:
        from game import atelier  # import tardif : atelier dépend des réglages Django
        pack = atelier.current()
    builtin = {m["id"] for m in cat["maps"]}
    out = {}
    for m in (pack or {}).get("maps") or []:
        mid = m.get("id") if isinstance(m, dict) else None
        if isinstance(mid, str) and MAP_ID_RE.match(mid) and not mid.startswith("int_") and mid not in builtin and mid not in out:
            out[mid] = m
    return out


CONDITION_TYPES = ("mission_completed", "min_balance")


def conditions_met(char, conditions) -> bool:
    """Conditions de passage d'une porte (même registre que client/src/world/conditions.js). Inconnue = refusée."""
    from game.models import MissionState  # import tardif : modèles Django
    for c in conditions or []:
        kind = c.get("type") if isinstance(c, dict) else None
        if kind == "mission_completed":
            if not MissionState.objects.filter(character=char, mission_id=c.get("mission"), status__in=("completed", "rewarded")).exists():
                return False
        elif kind == "min_balance":
            if not isinstance(c.get("amount"), int) or char.balance < c["amount"]:
                return False
        else:
            return False
    return True


def entry_allowed(char, src, dst, pack=None) -> bool:
    """Un joueur n'entre sur une carte de l'atelier que par un passage existant : son accès depuis la Cité Akwaba, ou
    une porte active d'une autre carte de l'atelier dont les conditions sont remplies. Rester sur la même carte
    (déplacement, reconnexion) est toujours permis ; les cartes intégrées et intérieurs ne sont pas concernés."""
    amaps = atelier_maps(pack)
    if dst not in amaps or src == dst:
        return True
    entrance = amaps[dst].get("entrance") or {}
    if src == "quartier" and entrance and entrance.get("zone", "quartier") == "quartier":
        return True
    for it in (amaps.get(src) or {}).get("interactives") or []:
        target = it.get("target") or {}
        if it.get("type") == "door" and it.get("active", True) and target.get("zone") == dst and conditions_met(char, it.get("conditions")):
            return True
    return False


def map_info(zone, cat=CATALOGUE):
    """Métadonnées de la carte d'une zone (ville, zone, type), ou None si elle n'est pas au catalogue publié."""
    if not isinstance(zone, str):
        return None
    district = None
    entry = next((m for m in cat["maps"] if m["id"] == zone and m["status"] == "published"), None)
    if entry:
        district, kind = entry["district"], entry["kind"]
    elif interior_pattern(cat).match(zone):
        district, kind = cat["generated_interiors"]["district"], "interior"
    else:
        extra = atelier_maps(cat=cat).get(zone)
        if not extra:
            return None
        return {"id": zone, "district": (extra.get("district") or {}).get("id"), "city": (extra.get("city") or {}).get("id"),
                "kind": "outdoor", "source": "atelier", "version": extra.get("version")}
    city = next(d["city"] for d in cat["districts"] if d["id"] == district)
    return {"id": zone, "district": district, "city": city, "kind": kind}
