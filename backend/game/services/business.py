"""Petite entreprise : le kiosque à boissons du joueur."""
from datetime import timedelta

from game import rules
from game.models import Business, JobShift

from . import missions
from .core import credit, debit, remove_item, require_zone
from .errors import GameError


def get_business(char):
    return Business.objects.filter(character=char).first()


def is_unlocked(char):
    cfg = rules.BUSINESS_TYPES["kiosque"]
    if rules.PROFILES[char.profile].get("business_unlocked"):
        return True
    return char.shifts.filter(status=JobShift.COMPLETED).count() >= cfg["unlock_jobs_completed"]


def cost_for(char, type_id):
    cfg = rules.BUSINESS_TYPES[type_id]
    return int(round(cfg["cost"] * rules.PROFILES[char.profile]["business_cost_multiplier"]))


def settle_passive(char, now, notices):
    """Ventes passives depuis le dernier règlement, plafonnées à 3 jours virtuels et au stock."""
    biz = get_business(char)
    if biz is None:
        return
    cfg = rules.BUSINESS_TYPES[biz.type_id]
    cap_hours = rules.TIME["offline_passive_cap_hours"]
    hours = max(0.0, (now - biz.last_settled_at).total_seconds() / 3600.0)
    capped = min(hours, cap_hours)
    # Une publicité active attire des clients en plus, sur la même fenêtre plafonnée.
    from . import plots
    window_start = now - timedelta(hours=capped)
    bonus = plots.ad_bonus_hours(char, window_start, now) * rules.AD_RENTAL["passive_bonus_units_per_hour"]
    biz.last_settled_at = now
    if biz.stock == 0:
        biz.passive_carry = 0
        biz.save()
        return
    biz.passive_carry += capped * cfg["passive_units_per_hour"] + bonus
    units = min(int(biz.passive_carry), biz.stock)
    biz.passive_carry -= int(biz.passive_carry)
    if units:
        revenue = units * biz.sale_price
        biz.stock -= units
        biz.units_sold += units
        biz.revenue += revenue
        credit(char, revenue, "business_passive", f"{units} boisson(s) vendue(s) par le voisinage", now)
        if hours >= 1:
            message = f"Pendant ton absence, ton kiosque a vendu {units} boisson(s) : +{revenue} F."
            if hours > cap_hours:
                message += " (Ventes limitées à 3 jours d'absence.)"
            notices.append({"type": "passive_income", "message": message, "units": units, "revenue": revenue})
    biz.save()


def open_business(char, data, now):
    type_id = data.get("type", "kiosque")
    cfg = rules.BUSINESS_TYPES.get(type_id)
    if cfg is None:
        raise GameError("unknown_business", "Type d'activité inconnu.", 400)
    if get_business(char):
        raise GameError("already_open", "Ton kiosque est déjà ouvert.")
    require_zone(char, cfg["zone"], "Va sur l'emplacement du kiosque pour l'ouvrir.")
    if not is_unlocked(char):
        raise GameError("business_locked", "Termine d'abord un premier travail pour gagner la confiance du quartier.")
    cost = cost_for(char, type_id)
    debit(char, cost, "business_open", f"Lancement : {cfg['name']}", now)
    Business.objects.create(character=char, type_id=type_id, sale_price=cfg["sale_price"],
                            opened_at=now, last_settled_at=now, spent=cost)
    missions.emit(char, "business_open", {"type": type_id}, now)
    return {"cost": cost}


def _require_business(char):
    biz = get_business(char)
    if biz is None:
        raise GameError("no_business", "Tu n'as pas encore de kiosque.")
    return biz


def restock(char, data, now):
    biz = _require_business(char)
    cfg = rules.BUSINESS_TYPES[biz.type_id]
    require_zone(char, cfg["zone"], "Va à ton kiosque pour le réapprovisionner.")
    crates = data.get("crates", 1)
    if not isinstance(crates, int) or isinstance(crates, bool) or crates < 1:
        raise GameError("invalid_quantity", "Quantité invalide.", 400)
    units = crates * rules.ITEMS[cfg["stock_item"]]["stock_units"]
    if biz.stock + units > cfg["max_stock"]:
        raise GameError("stock_full", f"Ton kiosque ne peut pas contenir plus de {cfg['max_stock']} boissons.")
    remove_item(char, cfg["stock_item"], crates)
    # Coût d'achat du stock, pour le suivi de rentabilité.
    biz.spent += crates * rules.SHOPS["epicerie"]["items"][cfg["stock_item"]]["price"]
    biz.stock += units
    biz.save()
    return {"stock": biz.stock}


def sell(char, data, now):
    biz = _require_business(char)
    cfg = rules.BUSINESS_TYPES[biz.type_id]
    require_zone(char, cfg["zone"], "Tu dois être à ton kiosque pour servir.")
    if biz.stock < 1:
        raise GameError("out_of_stock", "Plus de boissons en stock. Achète un casier à l'épicerie.")
    if biz.last_sale_at and (now - biz.last_sale_at).total_seconds() < cfg["min_seconds_between_sales"]:
        raise GameError("too_fast", "Un client à la fois !")
    biz.stock -= 1
    biz.units_sold += 1
    biz.revenue += biz.sale_price
    biz.last_sale_at = now
    biz.save()
    credit(char, biz.sale_price, "business_sale", "Vente au kiosque", now)
    missions.emit(char, "sale", {}, now)
    return {"price": biz.sale_price}


def snapshot(char):
    biz = get_business(char)
    if biz is None:
        return {"open": False, "unlocked": is_unlocked(char), "cost": cost_for(char, "kiosque")}
    return {
        "open": True, "type": biz.type_id, "stock": biz.stock, "sale_price": biz.sale_price,
        "max_stock": rules.BUSINESS_TYPES[biz.type_id]["max_stock"], "units_sold": biz.units_sold,
        "revenue": biz.revenue, "spent": biz.spent, "profit": biz.revenue - biz.spent,
    }
