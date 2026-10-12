"""Parcelles des joueurs, constructions et publicités : l'état partagé de la ville."""
import re
from datetime import datetime, timedelta

from django.db import IntegrityError, transaction

from game import rules
from game.models import AdCampaign, Business, PlotClaim

from . import missions
from .core import debit, require_zone
from .errors import GameError

NAME_RE = re.compile(r"^[\w' .&-]{2,20}$", re.UNICODE)
AD_COLORS = [("#1f6feb", "#ffffff"), ("#c0392b", "#ffffff"), ("#16a085", "#ffffff"), ("#8e44ad", "#ffffff"), ("#f1c40f", "#2b2118")]


def sign_tile(plot):
    """Case du panneau de la parcelle (réservée, jamais construite) : même règle que le client."""
    cx = plot["x"] + plot["w"] // 2
    return (cx, plot["y"] + plot["h"] - 1) if plot["front"] == "S" else (cx, plot["y"])


def placement(plot, template_id):
    """Position du bâtiment dans la parcelle, calculée par le serveur.

    Le bâtiment (2 rangées) est posé contre le côté d'accès, façade vers la rue ; la rangée du
    panneau reste libre devant lui, et la porte n'est jamais placée face au panneau.
    """
    t = rules.PLAYER_BUILDINGS[template_id]
    w = len(t["facade"])
    door = t["facade"].index("D")
    if plot["h"] < 3 or w > plot["w"]:
        raise GameError("plot_too_small", "Ce bâtiment ne tient pas sur cette parcelle.")
    cx, sy = sign_tile(plot)
    y0 = plot["y"] + plot["h"] - 3 if plot["front"] == "S" else plot["y"] + 1
    x0 = plot["x"]
    if x0 + door == cx:
        x0 += 1
    if x0 + w - 1 > plot["x"] + plot["w"] - 1:
        raise GameError("plot_too_small", "Ce bâtiment ne tient pas sur cette parcelle.")
    rect = {"x0": x0, "y0": y0, "x1": x0 + w - 1, "y1": y0 + 1}
    assert not (rect["x0"] <= cx <= rect["x1"] and rect["y0"] <= sy <= rect["y1"]), "le panneau doit rester libre"
    return {**rect, "facing": plot["front"]}


def buy(char, data, now):
    plot = rules.PLOTS.get(data.get("plot"))
    if plot is None:
        raise GameError("unknown_plot", "Cette parcelle n'existe pas.", 400)
    if plot.get("status") == "unavailable":
        raise GameError("plot_unavailable", plot.get("reason") or "Cette parcelle n'est pas à vendre.")
    require_zone(char, "quartier", "Va voir la parcelle dans le quartier.")
    if char.plots.count() >= rules.MAX_PLOTS_PER_PLAYER:
        raise GameError("plot_limit", "Tu possèdes déjà une parcelle.")
    if PlotClaim.objects.filter(plot_id=plot["id"]).exists():
        raise GameError("plot_taken", "Cette parcelle appartient déjà à quelqu'un.")
    debit(char, rules.PLOT_PRICE, "plot_buy", f"Parcelle {plot['id']}", now)
    try:
        with transaction.atomic():
            PlotClaim.objects.create(plot_id=plot["id"], owner=char, claimed_at=now)
    except IntegrityError:
        # Achat simultané par un autre joueur : la contrainte d'unicité tranche, rien n'est débité.
        raise GameError("plot_taken", "Cette parcelle vient d'être achetée par quelqu'un d'autre.")
    missions.emit(char, "plot_buy", {"plot": plot["id"]}, now)
    return {"plot": plot["id"], "price": rules.PLOT_PRICE}


def build(char, data, now):
    claim = char.plots.filter(plot_id=data.get("plot")).first()
    if claim is None:
        raise GameError("not_owner", "Cette parcelle ne t'appartient pas.", 403)
    if claim.template:
        raise GameError("already_built", "Tu as déjà construit sur cette parcelle.")
    template_id = data.get("template")
    template = rules.PLAYER_BUILDINGS.get(template_id)
    if template is None:
        raise GameError("unknown_template", "Type de bâtiment inconnu.", 400)
    require_zone(char, "quartier", "Va sur ta parcelle pour construire.")
    name = str(data.get("name") or char.name).strip()
    if not NAME_RE.match(name):
        raise GameError("invalid_name", "Le nom de l'enseigne doit contenir 2 à 20 caractères.", 400)
    place = placement(rules.PLOTS[claim.plot_id], template_id)
    debit(char, template["cost"], "plot_build", f"Construction : {template['name']}", now)
    claim.template, claim.name, claim.built_at = template_id, name, now
    claim.x0, claim.y0, claim.facing = place["x0"], place["y0"], place["facing"]
    claim.save()
    missions.emit(char, "plot_build", {"template": template_id}, now)
    return {"plot": claim.plot_id, "template": template_id, **place}


def _parse(ts):
    return datetime.fromisoformat(ts.replace("Z", "+00:00"))


def placement_refusal(slot_id, now):
    """Motif de refus si l'emplacement n'est pas libre à la location (hors campagnes de joueurs).

    Même règle que l'affichage du client (client/src/world/ads.js) : une annonce de démonstration
    absente, suspendue, expirée ou pas encore commencée laisse l'emplacement libre.
    """
    placement = rules.AD_PLACEMENTS.get(slot_id) or {"status": "free"}
    status = placement.get("status", "free")
    if status == "disabled":
        return GameError("slot_disabled", "Ce panneau est hors service.")
    if status == "reserved":
        return GameError("slot_reserved", "Ce panneau est réservé à un annonceur.")
    if status != "active":
        return None
    ad = rules.ADVERTS.get(placement.get("ad"))
    if not ad or ad.get("status", "active") != "active":
        return None
    if ad.get("ends_at") and _parse(ad["ends_at"]) <= now:
        return None
    if ad.get("starts_at") and _parse(ad["starts_at"]) > now:
        return None
    return GameError("slot_taken", "Ce panneau affiche déjà une annonce.")


def rent_ad(char, data, now):
    slot = rules.AD_SLOTS.get(data.get("slot"))
    if slot is None:
        raise GameError("unknown_slot", "Ce panneau n'existe pas.", 400)
    refusal = placement_refusal(slot["id"], now)
    if refusal:
        raise refusal
    require_zone(char, "quartier", "Va devant le panneau.")
    if not Business.objects.filter(character=char).exists():
        raise GameError("no_business", "Il te faut une entreprise (ton kiosque) pour faire de la publicité.")
    campaign = AdCampaign.objects.select_for_update().filter(slot=slot["id"]).first()
    if campaign and campaign.ends_at > now:
        raise GameError("slot_taken", "Ce panneau est déjà loué.")
    cfg = rules.AD_RENTAL
    debit(char, cfg["price"], "ad_rental", f"Publicité ({slot['id']})", now)
    bg, fg = AD_COLORS[sum(map(ord, char.name)) % len(AD_COLORS)]
    fields = {
        "owner": char, "title": f"KIOSQUE DE {char.name.upper()}"[:40], "subtitle": "Boissons fraîches · Cité Akwaba",
        "bg": bg, "fg": fg, "starts_at": now, "ends_at": now + timedelta(hours=cfg["duration_hours"]),
    }
    try:
        with transaction.atomic():
            AdCampaign.objects.update_or_create(slot=slot["id"], defaults=fields)
    except IntegrityError:
        raise GameError("slot_taken", "Ce panneau vient d'être loué par quelqu'un d'autre.")
    return {"slot": slot["id"], "ends_at": fields["ends_at"].isoformat()}


def ad_bonus_hours(char, start, end):
    """Heures de [start, end] couvertes par une publicité active de ce joueur."""
    total = 0.0
    for c in AdCampaign.objects.filter(owner=char, ends_at__gt=start, starts_at__lt=end):
        overlap = (min(end, c.ends_at) - max(start, c.starts_at)).total_seconds()
        total += max(0.0, overlap) / 3600.0
    return total


def world_snapshot(char, now):
    """État public de la ville : parcelles, constructions et publicités de tous les joueurs."""
    plots = {}
    for c in PlotClaim.objects.select_related("owner"):
        plots[c.plot_id] = {
            "owner": c.owner.name, "mine": c.owner_id == char.pk,
            "building": None if not c.template else {
                "template": c.template, "name": c.name, "x0": c.x0, "y0": c.y0, "facing": c.facing,
            },
        }
    ads = {}
    for a in AdCampaign.objects.select_related("owner").filter(ends_at__gt=now):
        ads[a.slot] = {"title": a.title, "subtitle": a.subtitle, "bg": a.bg, "fg": a.fg,
                       "owner": a.owner.name, "mine": a.owner_id == char.pk, "ends_at": a.ends_at.isoformat()}
    return {"plots": plots, "ads": ads}
