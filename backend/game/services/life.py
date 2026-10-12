"""Vie quotidienne : achats auprès des commerces PNJ, consommation, repos."""
from datetime import timedelta

from game import rules
from game.clock import virtual_day
from game.models import ShopStock

from . import missions
from .core import add_item, change_needs, debit, remove_item, require_zone
from .errors import GameError

MAX_QUANTITY = 20


def shop_stock(char, shop_id, now):
    """Stock du commerce pour le jour virtuel courant (réapprovisionnement paresseux)."""
    shop = rules.SHOPS[shop_id]
    today = virtual_day(now)
    rows = {r.item_id: r for r in ShopStock.objects.filter(character=char, shop_id=shop_id)}
    stock = {}
    for item_id, offer in shop["items"].items():
        row = rows.get(item_id)
        if row is None:
            row = ShopStock.objects.create(character=char, shop_id=shop_id, item_id=item_id,
                                           quantity=offer["daily_stock"], day=today)
        elif row.day != today:
            row.quantity, row.day = offer["daily_stock"], today
            row.save(update_fields=["quantity", "day"])
        stock[item_id] = row
    return stock


def buy(char, data, now):
    shop_id, item_id = data.get("shop"), data.get("item")
    quantity = data.get("quantity", 1)
    shop = rules.SHOPS.get(shop_id)
    if shop is None or item_id not in shop["items"]:
        raise GameError("unknown_product", "Ce produit n'est pas vendu ici.", 400)
    if not isinstance(quantity, int) or isinstance(quantity, bool) or not 1 <= quantity <= MAX_QUANTITY:
        raise GameError("invalid_quantity", f"Quantité invalide (1 à {MAX_QUANTITY}).", 400)
    require_zone(char, shop["zone"], f"Tu dois être chez « {shop['name']} » pour acheter.")

    row = shop_stock(char, shop_id, now)[item_id]
    if row.quantity < quantity:
        raise GameError("out_of_stock", f"Plus assez de stock (reste {row.quantity}). Reviens demain.")

    item = rules.ITEMS[item_id]
    total = shop["items"][item_id]["price"] * quantity
    debit(char, total, "purchase", f"{quantity} × {item['name']} ({shop['name']})", now)
    row.quantity -= quantity
    row.save(update_fields=["quantity"])
    add_item(char, item_id, quantity)
    missions.emit(char, "purchase", {"shop": shop_id, "item": item_id, "count": 1}, now)
    return {"item": item_id, "quantity": quantity, "total": total}


def consume(char, data, now):
    item_id = data.get("item")
    item = rules.ITEMS.get(item_id)
    if item is None or not item["effects"]:
        raise GameError("not_consumable", "Cet objet ne se consomme pas.", 400)
    remove_item(char, item_id, 1)
    effects = item["effects"]
    change_needs(char, hunger=effects.get("hunger", 0), energy=effects.get("energy", 0))
    missions.emit(char, "consume", {"item": item_id, "category": item["category"]}, now)
    return {"item": item_id, "effects": effects}


def rest(char, data, now):
    cfg = rules.REST
    require_zone(char, cfg["zone"], "Tu ne peux faire la sieste que dans ton lit, chez toi.")
    if char.last_rest_at:
        ready_at = char.last_rest_at + timedelta(seconds=cfg["cooldown_seconds"])
        if now < ready_at:
            wait = int((ready_at - now).total_seconds()) + 1
            raise GameError("rest_cooldown", f"Tu viens de te reposer. Réessaie dans {wait} s.")
    before = char.energy
    change_needs(char, hunger=cfg["hunger_cost"], energy=cfg["energy_gain"])
    char.last_rest_at = now
    missions.emit(char, "rest", {}, now)
    return {"energy_gained": round(char.energy - before, 1)}


def rest_ready_at(char):
    if not char.last_rest_at:
        return None
    return char.last_rest_at + timedelta(seconds=rules.REST["cooldown_seconds"])
