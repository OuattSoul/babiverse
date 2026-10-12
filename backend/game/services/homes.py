"""Lotissement : attribution automatique d'un emplacement et construction de la maison initiale.

L'emplacement n est à une position fixe, calculée à partir de shared/city.json (même règle que
client/src/world/city.js) : les blocs de 64×64 cases s'empilent vers le sud, et un nouveau bloc
n'est occupé que lorsque tous les emplacements des précédents le sont. Agrandir la zone ne
déplace donc jamais une maison existante.
"""
from django.db import IntegrityError, transaction

from game import rules
from game.models import Home

from .errors import GameError

ZONE = rules.RESIDENTIAL
LOT = ZONE["lot"]
COLS = ZONE["w"] // LOT
LOTS_PER_BLOCK = COLS * (ZONE["h"] // LOT)
MAX_ATTEMPTS = 5


def lot_origin(slot):
    """Case nord-ouest de l'emplacement `slot`."""
    block, local = divmod(slot, LOTS_PER_BLOCK)
    row, col = divmod(local, COLS)
    return ZONE["x"] + col * LOT, ZONE["y"] + block * ZONE["h"] + row * LOT


def blocks_for(highest_slot):
    """Nombre de blocs ouverts : au moins un, et assez pour contenir l'emplacement le plus haut."""
    return 1 if highest_slot is None else highest_slot // LOTS_PER_BLOCK + 1


def first_free_slot(taken):
    """Plus petit emplacement libre (réutilise ceux libérés par un joueur supprimé)."""
    expected = 0
    for slot in sorted(taken):
        if slot != expected:
            break
        expected += 1
    return expected


def assign_initial_home(player, now):
    """Retourne la maison du joueur, en l'attribuant et la construisant si elle n'existe pas encore.

    Appelé uniquement lors de la création du personnage, dans sa transaction : en cas d'échec,
    rien n'est enregistré. Deux créations simultanées qui visent le même emplacement sont
    départagées par les contraintes d'unicité ; la perdante réessaie sur l'emplacement suivant.
    """
    home = Home.objects.filter(player=player).first()
    if home is not None:
        return home
    for _ in range(MAX_ATTEMPTS):
        slot = first_free_slot(Home.objects.values_list("slot", flat=True))
        x, y = lot_origin(slot)
        try:
            with transaction.atomic():
                return Home.objects.create(player=player, slot=slot, x=x, y=y, template=ZONE["template"],
                                           facing=ZONE["facing"], created_at=now)
        except IntegrityError:
            home = Home.objects.filter(player=player).first()
            if home is not None:  # attribuée entre-temps par une requête parallèle du même joueur
                return home
    raise GameError("home_unavailable", "Impossible d'attribuer un emplacement pour le moment, réessaie.", 503)


def snapshot(char):
    """Maisons de tous les joueurs et capacité du lotissement (état public de la ville)."""
    rows = Home.objects.order_by("slot").values("slot", "x", "y", "template", "facing", "player_id",
                                                "player__character__name")
    homes = [{
        "slot": r["slot"], "x": r["x"], "y": r["y"], "template": r["template"], "facing": r["facing"],
        "owner": r["player__character__name"] or "", "mine": r["player_id"] == char.player_id,
    } for r in rows]
    blocks = blocks_for(homes[-1]["slot"] if homes else None)
    return {"homes": homes, "blocks": blocks, "lots": blocks * LOTS_PER_BLOCK}
