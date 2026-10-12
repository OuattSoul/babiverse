"""Systèmes de base : économie (solde + journal), inventaire, besoins, temps."""
from game import rules
from game.models import InventoryItem, LedgerEntry

from .errors import GameError


def clamp(value, low=rules.NEEDS["min"], high=rules.NEEDS["max"]):
    return max(low, min(high, value))


# --- Économie -----------------------------------------------------------------

def credit(char, amount, kind, description, now):
    if amount <= 0:
        return
    char.balance += amount
    LedgerEntry.objects.create(
        character=char, kind=kind, amount=amount, balance_after=char.balance,
        description=description, created_at=now,
    )


def debit(char, amount, kind, description, now):
    if amount <= 0:
        raise GameError("invalid_amount", "Montant invalide.", 400)
    if char.balance < amount:
        raise GameError(
            "insufficient_funds",
            f"Solde insuffisant : il te faut {amount} F, tu as {char.balance} F.",
        )
    char.balance -= amount
    LedgerEntry.objects.create(
        character=char, kind=kind, amount=-amount, balance_after=char.balance,
        description=description, created_at=now,
    )


# --- Inventaire ---------------------------------------------------------------

def add_item(char, item_id, quantity):
    row, _ = InventoryItem.objects.get_or_create(character=char, item_id=item_id, defaults={"quantity": 0})
    row.quantity += quantity
    row.save(update_fields=["quantity"])


def remove_item(char, item_id, quantity):
    row = InventoryItem.objects.filter(character=char, item_id=item_id).first()
    if row is None or row.quantity < quantity:
        name = rules.ITEMS.get(item_id, {}).get("name", item_id)
        raise GameError("missing_item", f"Tu n'as pas assez de « {name} ».")
    row.quantity -= quantity
    if row.quantity == 0:
        row.delete()
    else:
        row.save(update_fields=["quantity"])


def inventory_dict(char):
    return {row.item_id: row.quantity for row in char.inventory.all() if row.quantity > 0}


# --- Besoins ------------------------------------------------------------------

def apply_needs(char, now):
    """Fait évoluer faim et énergie selon le temps de jeu actif écoulé.

    Un écart supérieur à `max_active_gap_seconds` signifie que le joueur était absent :
    seul ce plafond est compté, les besoins sont donc suspendus hors ligne.
    """
    cfg = rules.NEEDS
    elapsed = (now - char.needs_updated_at).total_seconds()
    active = max(0.0, min(elapsed, cfg["max_active_gap_seconds"]))
    minutes = active / 60.0
    char.hunger = clamp(char.hunger + minutes * cfg["hunger_per_minute"])
    char.energy = clamp(char.energy - minutes * cfg["energy_per_minute"])
    char.needs_updated_at = now


def change_needs(char, hunger=0, energy=0):
    char.hunger = clamp(char.hunger + hunger)
    char.energy = clamp(char.energy + energy)


def require_zone(char, zone, message):
    if char.zone != zone:
        raise GameError("wrong_zone", message)
