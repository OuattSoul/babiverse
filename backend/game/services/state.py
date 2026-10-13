"""Création du personnage, avancée du temps et instantané d'état envoyé au client."""
import logging
import re

from django.core.cache import cache

from game import atelier, maps, rules
from game.clock import virtual_day
from game.models import Character, Home, Player, PlotClaim

from . import business, homes, life, missions, plots, work
from .core import add_item, apply_needs, credit, inventory_dict
from .errors import GameError

log = logging.getLogger("game")
NAME_RE = re.compile(r"^[\w' -]{2,24}$", re.UNICODE)
PRIVATE_INTERIOR_RE = re.compile(r"^int_(pb|home)_(.+)$")
SKINS = ("#f1c27d", "#c68642", "#8d5524", "#5c3a1e")
MAX_POS_PX = 1_000_000  # pixels de grille (32 par case)
OUTFITS = ("#e67e22", "#27ae60", "#2980b9", "#c0392b", "#8e44ad", "#f1c40f")
HAIRS = ("short", "afro", "braids", "bald")


def clean_appearance(look):
    """Apparence validée : classique (peau, tenue, cheveux du modèle 3D) ou composée avec la garde-robe de
    l'atelier (silhouette, peau, coiffure, haut, bas, chaussures), validée contre le pack en vigueur ;
    l'apparence classique devient alors la plus proche (repli d'affichage)."""
    look = look if isinstance(look, dict) else {}
    appearance = {
        "skin": look.get("skin") if look.get("skin") in SKINS else SKINS[1],
        "outfit": look.get("outfit") if look.get("outfit") in OUTFITS else OUTFITS[0],
        "hair": look.get("hair") if look.get("hair") in HAIRS else HAIRS[0],
    }
    pack = atelier.current() if look.get("studio") else None
    studio = atelier.clean_look(look.get("studio"), pack)
    if studio:
        appearance = {**atelier.fallback_appearance(studio, pack, SKINS, OUTFITS, HAIRS), "studio": studio}
    return appearance


def change_appearance(char, data, now):
    """Changement d'apparence après la création (gratuit, sans effet sur la partie)."""
    look = data.get("appearance")
    if not isinstance(look, dict) or not look:
        raise GameError("invalid_appearance", "Apparence manquante.", 400)
    if look.get("studio") and not atelier.clean_look(look.get("studio"), atelier.current()):
        raise GameError("invalid_appearance", "Cette tenue n'est plus disponible : choisis-en une autre.", 400)
    char.appearance = clean_appearance(look)
    return {"appearance": char.appearance}


def create_character(player, data, now):
    # Verrou sur la ligne du joueur : deux créations simultanées du même compte sont sérialisées,
    # la seconde voit le personnage créé par la première (409 au lieu d'une erreur d'unicité → 500).
    Player.objects.select_for_update().filter(pk=player.pk).first()
    if Character.objects.filter(player=player).exists():
        raise GameError("character_exists", "Tu as déjà un personnage.")
    name = str(data.get("name") or "").strip()
    if not name and player.registered:
        # le nom d'utilisateur choisi à l'inscription sert de nom dans le jeu : on ne le redemande pas
        name = player.username
    elif not NAME_RE.match(name):
        raise GameError("invalid_name", "Le nom doit contenir 2 à 24 lettres.", 400)
    profile_id = data.get("profile")
    profile = rules.PROFILES.get(profile_id)
    if profile is None:
        raise GameError("invalid_profile", "Profil inconnu.", 400)
    appearance = clean_appearance(data.get("appearance"))
    start = rules.NEEDS["start"]
    char = Character.objects.create(
        player=player, name=name, profile=profile_id, appearance=appearance,
        balance=0, hunger=start["hunger"], energy=start["energy"], needs_updated_at=now,
        zone=rules.START_ZONE,
    )
    # Première initialisation du joueur : emplacement et maison attribués dans la même transaction
    # que le personnage. Les chargements suivants ne font que lire cette maison (voir build_state).
    homes.assign_initial_home(player, now)
    credit(char, profile["balance"], "start", f"Capital de départ ({profile['label']})", now)
    for item_id, qty in profile["items"].items():
        add_item(char, item_id, qty)
    missions.refresh_availability(char, now)
    char.save()
    return char


def tick(char, now):
    """Applique le passage du temps. Retourne les notifications à afficher."""
    notices = []
    apply_needs(char, now)
    work.expire_shifts(char, now, notices)
    business.settle_passive(char, now, notices)
    return notices


def private_interior_allowed(char, zone):
    """Seul le propriétaire entre dans une construction de joueur (int_pb_<parcelle>) ou dans une
    maison du lotissement (int_home_<emplacement>). Les autres intérieurs sont publics."""
    match = PRIVATE_INTERIOR_RE.match(zone)
    if not match:
        return True
    kind, ident = match.groups()
    if kind == "pb":
        allowed = PlotClaim.objects.filter(plot_id=ident, owner=char).exists()
    else:
        allowed = ident.isdigit() and Home.objects.filter(slot=int(ident), player_id=char.player_id).exists()
    if not allowed:
        log.warning("intérieur refusé zone=%s char=%s", zone, char.pk)
    return allowed


def _in_order(char, pos) -> bool:
    """Ignore une position plus ancienne que la dernière appliquée pour le même onglet (`pos.c`, horodatage `pos.t`) :
    une requête lente (battement de cœur, rencontres) ne doit pas ramener le joueur dans la zone qu'il vient de
    quitter. Sans horodatage (anciens clients), la position est appliquée comme avant."""
    t, cid = pos.get("t"), pos.get("c")
    if not isinstance(t, (int, float)) or isinstance(t, bool) or not isinstance(cid, str) or not cid:
        return True
    key = f"babiverse:pos:{char.pk}"
    last = cache.get(key)
    if last and last[0] == cid[:40] and t < last[1]:
        log.info("position périmée ignorée char=%s", char.pk)
        return False
    cache.set(key, (cid[:40], t), 6 * 3600)
    return True


def apply_position(char, data):
    """Mémorise la zone et la position rapportées par le client (validées grossièrement).

    La géométrie fine est contrôlée côté client ; le serveur s'assure que la zone existe
    et que les coordonnées sont plausibles, sinon le client utilisera le point d'apparition.
    """
    pos = data.get("pos") if isinstance(data, dict) else None
    if not isinstance(pos, dict):
        return
    zone, x, y = pos.get("zone"), pos.get("x"), pos.get("y")
    if not _in_order(char, pos):
        return
    if not rules.zone_known(zone) or not private_interior_allowed(char, zone):
        return
    if not maps.entry_allowed(char, char.zone, zone):
        log.warning("passage refusé %s → %s char=%s", char.zone, zone, char.pk)
        return
    char.zone = zone
    # La carte de la ville n'a pas de taille fixe (elle grandit avec son contenu) : seule une borne
    # très large écarte les valeurs absurdes.
    if all(isinstance(v, (int, float)) and not isinstance(v, bool) and 0 <= v <= MAX_POS_PX for v in (x, y)):
        char.pos_x, char.pos_y = float(x), float(y)
    else:
        char.pos_x = char.pos_y = None


def build_state(char, now, notices=()):
    ready = life.rest_ready_at(char)
    return {
        "server_time": now.isoformat(),
        "virtual_day": virtual_day(now).isoformat(),
        "config_version": rules.CONFIG_VERSION,
        "version": char.version,
        "character": {
            "name": char.name,
            "profile": char.profile,
            "appearance": char.appearance,
            "balance": char.balance,
            "hunger": round(char.hunger, 2),
            "energy": round(char.energy, 2),
            "zone": char.zone,
            "x": char.pos_x,
            "y": char.pos_y,
            "rest_ready_at": ready.isoformat() if ready and ready > now else None,
        },
        "inventory": inventory_dict(char),
        "shops": {
            shop_id: {item_id: row.quantity for item_id, row in life.shop_stock(char, shop_id, now).items()}
            for shop_id in rules.SHOPS
        },
        "missions": missions.snapshot(char),
        "job": work.snapshot(char, now),
        "business": business.snapshot(char),
        "world": {**plots.world_snapshot(char, now), "residential": homes.snapshot(char)},
        "notices": list(notices),
    }
