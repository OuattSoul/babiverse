"""API HTTP du jeu.

Chaque action mutante passe par `run_action` qui :
1. verrouille la ligne du personnage (sérialise toutes les actions d'un même joueur) ;
2. rejoue le résultat mémorisé si la clé d'idempotence a déjà été vue ;
3. applique le passage du temps (besoins, services expirés, ventes passives) ;
4. exécute l'action dans un point de sauvegarde : un refus n'a aucun effet partiel ;
5. renvoie le résultat accompagné d'un instantané d'état à jour.
"""
import hashlib
import json
import logging
import re
from datetime import timedelta

from django.db import transaction
from rest_framework import status
from rest_framework.decorators import api_view, authentication_classes, permission_classes, throttle_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle
from rest_framework.views import exception_handler

from . import atelier, clock, rules
from .auth import AuthRateThrottle
from .models import BugReport, Character, IdempotencyRecord, LedgerEntry, Player
from .services import accounts, business, life, missions, plots, social, work
from .services.errors import GameError
from .services.state import apply_position, build_state, change_appearance, create_character, tick

log = logging.getLogger("game")
KEY_RE = re.compile(r"^[A-Za-z0-9_-]{8,64}$")
MAX_BUG_REPORT_CHARS = 1000
MAX_BUG_REPORTS_PER_DAY = 10
# Un joueur est « connecté » s'il a donné signe de vie depuis 2 min (battement de cœur toutes les 45 s).
PRESENCE_WINDOW = timedelta(minutes=2)


def error_response(code, message, http_status):
    return Response({"ok": False, "error": {"code": code, "message": message}}, status=http_status)


def api_exception_handler(exc, context):
    response = exception_handler(exc, context)
    if response is not None:
        detail = response.data.get("detail", "Erreur") if isinstance(response.data, dict) else "Erreur"
        code = getattr(getattr(exc, "detail", None), "code", None) or "error"
        response.data = {"ok": False, "error": {"code": code, "message": str(detail)}}
        return response
    log.exception("Erreur inattendue", exc_info=exc)
    return error_response("server_error", "Erreur interne du serveur.", 500)


def _lock_character(player):
    char = Character.objects.select_for_update().filter(player=player).first()
    if char is None:
        raise GameError("no_character", "Aucun personnage pour ce joueur.", 404)
    return char


def run_action(request, action, handler, idempotent=True):
    key = request.headers.get("Idempotency-Key")
    if idempotent and (not key or not KEY_RE.match(key)):
        return error_response("idempotency_key_required", "En-tête Idempotency-Key manquant ou invalide.", 400)
    body = request.data if isinstance(request.data, dict) else {}
    # La position n'entre pas dans l'empreinte : un nouvel envoi après un déplacement reste un rejeu.
    payload_for_hash = {k: v for k, v in body.items() if k != "pos"}
    request_hash = hashlib.sha256(json.dumps(payload_for_hash, sort_keys=True, default=str).encode()).hexdigest()
    now = clock.now()

    try:
        with transaction.atomic():
            char = _lock_character(request.user)
            if idempotent:
                record = IdempotencyRecord.objects.filter(character=char, key=key).first()
                if record is not None:
                    if record.action != action or record.request_hash != request_hash:
                        return error_response("idempotency_conflict", "Clé d'idempotence déjà utilisée pour une autre requête.", 409)
                    notices = tick(char, now)
                    char.save()
                    data = dict(record.response, replayed=True, state=build_state(char, now, notices))
                    return Response(data, status=record.status_code)

            notices = tick(char, now)
            apply_position(char, body)
            char.save()

            http_status = 200
            try:
                with transaction.atomic():
                    result = handler(char, body, now) or {}
                    missions.emit(char, "balance", {}, now)
                    char.version += 1
                    char.save()
                outcome = {"ok": True, "result": result}
                log.info("action=%s char=%s ok", action, char.pk)
            except GameError as err:
                # Le point de sauvegarde a annulé les écritures ; on recharge l'objet en mémoire.
                char.refresh_from_db()
                outcome = {"ok": False, "error": {"code": err.code, "message": err.message}}
                http_status = err.status
                log.info("action=%s char=%s refused=%s", action, char.pk, err.code)

            if idempotent:
                IdempotencyRecord.objects.create(character=char, key=key, action=action, request_hash=request_hash,
                                                 status_code=http_status, response=outcome, created_at=now)
            request.user.last_seen_at = now
            request.user.save(update_fields=["last_seen_at"])
            return Response(dict(outcome, state=build_state(char, now, notices)), status=http_status)
    except GameError as err:
        return error_response(err.code, err.message, err.status)


# --- Identité -------------------------------------------------------------------

def _body(request):
    return request.data if isinstance(request.data, dict) else {}


def _guarded(fn):
    """Traduit un refus métier (GameError) en réponse d'erreur uniforme."""
    def wrapper(request):
        try:
            return fn(request)
        except GameError as err:
            return error_response(err.code, err.message, err.status)
    wrapper.__name__ = fn.__name__
    wrapper.__doc__ = fn.__doc__
    return wrapper


@api_view(["POST"])
@permission_classes([AllowAny])
@throttle_classes([AnonRateThrottle, AuthRateThrottle])
@_guarded
def register(request):
    """Crée un compte (nom d'utilisateur, mot de passe, e-mail facultatif). Un invité authentifié garde sa partie."""
    player, token = accounts.register(request.user, _body(request), clock.now())
    data = {"ok": True, "account": accounts.account_info(player)}
    if token:
        data["token"] = token
    return Response(data, status=status.HTTP_201_CREATED)


@api_view(["POST"])
@authentication_classes([])
@permission_classes([AllowAny])
@throttle_classes([AuthRateThrottle])
@_guarded
def login(request):
    player, token = accounts.login(_body(request), clock.now())
    log.info("connexion joueur=%s", player.pk)
    return Response({"ok": True, "token": token, "account": accounts.account_info(player)})


@api_view(["POST"])
def logout(request):
    """Ferme la session de cet appareil, ou toutes avec `{"everywhere": true}`."""
    accounts.logout(request.user, request.auth, everywhere=_body(request).get("everywhere") is True)
    return Response({"ok": True})


@api_view(["POST"])
@throttle_classes([AuthRateThrottle])
@_guarded
def password_change(request):
    accounts.change_password(request.user, request.auth, _body(request), clock.now())
    return Response({"ok": True})


@api_view(["POST"])
@throttle_classes([AuthRateThrottle])
@_guarded
def email(request):
    """Ajoute, change (`{email, password}`) ou retire (`email` vide) l'adresse de récupération."""
    accounts.set_email(request.user, _body(request), clock.now())
    return Response({"ok": True, "account": accounts.account_info(request.user)})


@api_view(["POST"])
@throttle_classes([AuthRateThrottle])
@_guarded
def email_resend(request):
    accounts.resend_verification(request.user, clock.now())
    return Response({"ok": True, "account": accounts.account_info(request.user)})


@api_view(["POST"])
@authentication_classes([])
@permission_classes([AllowAny])
@throttle_classes([AuthRateThrottle])
@_guarded
def email_verify(request):
    """Lien de confirmation reçu par e-mail (peut être ouvert sur un autre appareil, sans session)."""
    player = accounts.verify_email(_body(request), clock.now())
    return Response({"ok": True, "account": accounts.account_info(player)})


@api_view(["POST"])
@authentication_classes([])
@permission_classes([AllowAny])
@throttle_classes([AuthRateThrottle])
def password_forgot(request):
    """Toujours la même réponse : on ne révèle pas si l'adresse correspond à un compte."""
    accounts.request_reset(_body(request), clock.now())
    return Response({"ok": True, "message": "Si ce compte existe et a une adresse e-mail confirmée, un lien vient d'y "
                                            "être envoyé. Pense à regarder dans les indésirables."})


@api_view(["POST"])
@authentication_classes([])
@permission_classes([AllowAny])
@throttle_classes([AuthRateThrottle])
@_guarded
def password_reset(request):
    player, token = accounts.reset_password(_body(request), clock.now())
    return Response({"ok": True, "token": token, "account": accounts.account_info(player)})


@api_view(["GET"])
@authentication_classes([])
@permission_classes([AllowAny])
def config(request):
    return Response(rules.public_config())


@api_view(["GET"])
@authentication_classes([])
@permission_classes([AllowAny])
def atelier_pack(request):
    """Contenu de l'atelier d'assets utilisé par le client (garde-robe, habitants, maison) ; null sans atelier."""
    pack = atelier.current()
    tag = f'"{pack["revision"]}"' if pack and pack.get("revision") else None
    if tag and request.headers.get("If-None-Match") == tag:
        return Response(status=status.HTTP_304_NOT_MODIFIED, headers={"ETag": tag})
    res = Response({"ok": True, "pack": pack})
    if tag:
        res["ETag"] = tag
        res["Cache-Control"] = "no-cache"
    return res


# --- État -----------------------------------------------------------------------

@api_view(["GET"])
def state(request):
    now = clock.now()
    with transaction.atomic():
        char = Character.objects.select_for_update().filter(player=request.user).first()
        if char is None:
            return Response({"ok": True, "state": None})
        notices = tick(char, now)
        char.save()
        return Response({"ok": True, "state": build_state(char, now, notices)})


@api_view(["POST", "DELETE"])
def character(request):
    now = clock.now()
    if request.method == "DELETE":
        Character.objects.filter(player=request.user).delete()
        return Response({"ok": True, "state": None})
    try:
        with transaction.atomic():
            char = create_character(request.user, request.data if isinstance(request.data, dict) else {}, now)
            return Response({"ok": True, "state": build_state(char, now)}, status=status.HTTP_201_CREATED)
    except GameError as err:
        return error_response(err.code, err.message, err.status)


@api_view(["GET", "DELETE"])
def account(request):
    """GET : identifiants du compte. DELETE : suppression définitive (personnage, maison, parcelle,
    publicités, signalements, sessions)."""
    if request.method == "GET":
        return Response({"ok": True, "account": accounts.account_info(request.user)})
    with transaction.atomic():
        player_id = request.user.pk
        request.user.delete()
    log.info("compte supprimé %s", player_id)
    return Response({"ok": True})


@api_view(["POST"])
def feedback(request):
    """Signalement de bug d'un testeur (texte libre + zone courante et navigateur)."""
    body = request.data if isinstance(request.data, dict) else {}
    message = str(body.get("message", "")).strip()
    if not 5 <= len(message) <= MAX_BUG_REPORT_CHARS:
        return error_response("invalid_message", f"Décris le problème en 5 à {MAX_BUG_REPORT_CHARS} caractères.", 400)
    now = clock.now()
    if BugReport.objects.filter(player=request.user, created_at__gte=now - timedelta(days=1)).count() >= MAX_BUG_REPORTS_PER_DAY:
        return error_response("too_many_reports", "Tu as déjà envoyé beaucoup de signalements aujourd'hui. Merci !", 400)
    zone = body.get("zone")
    BugReport.objects.create(player=request.user, message=message, created_at=now,
                             zone=zone if rules.zone_known(zone) else "",
                             user_agent=request.headers.get("User-Agent", "")[:200])
    log.info("signalement de bug joueur=%s", request.user.pk)
    return Response({"ok": True}, status=status.HTTP_201_CREATED)


@api_view(["POST"])
def sync(request):
    """Battement de cœur : sauvegarde la position et fait avancer les besoins."""
    return run_action(request, "sync", lambda char, body, now: {}, idempotent=False)


@api_view(["GET"])
@permission_classes([AllowAny])
def presence(request):
    """Fréquentation affichée dans la barre du haut : joueurs actifs depuis PRESENCE_WINDOW.

    Ouvert sans session (écran de connexion). L'appel d'un joueur connecté compte comme signe de vie.
    Il n'existe pas de mode visiteur (sans compte) : `visitors` reste null tant qu'aucun comptage n'existe.
    """
    now = clock.now()
    if request.user is not None:  # UNAUTHENTICATED_USER = None : appel sans session
        Player.objects.filter(pk=request.user.pk).update(last_seen_at=now)
    online = Player.objects.filter(last_seen_at__gte=now - PRESENCE_WINDOW).count()
    return Response({"ok": True, "players_online": online, "visitors": None})


@api_view(["GET"])
def ledger(request):
    char = Character.objects.filter(player=request.user).first()
    if char is None:
        return error_response("no_character", "Aucun personnage.", 404)
    entries = LedgerEntry.objects.filter(character=char)[:30]
    return Response({"ok": True, "entries": [
        {"kind": e.kind, "amount": e.amount, "balance_after": e.balance_after,
         "description": e.description, "at": e.created_at.isoformat()} for e in entries
    ]})


# --- Actions ----------------------------------------------------------------------

def _talk(char, body, now):
    npc = body.get("npc")
    if npc not in rules.NPCS:
        raise GameError("unknown_npc", "Personne de ce nom ici.", 400)
    missions.emit(char, "talk_npc", {"npc": npc}, now)
    return {}


def _action(name, handler, idempotent=True):
    @api_view(["POST"])
    def view(request):
        return run_action(request, name, handler, idempotent=idempotent)

    view.__name__ = name
    return view


shop_buy = _action("shop_buy", life.buy)
consume = _action("consume", life.consume)
rest = _action("rest", life.rest)
appearance = _action("appearance", change_appearance)
talk = _action("talk", _talk, idempotent=False)
job_start = _action("job_start", work.start)
job_deliver = _action("job_deliver", work.deliver, idempotent=False)
job_complete = _action("job_complete", work.complete)
job_abandon = _action("job_abandon", work.abandon)
business_open = _action("business_open", business.open_business)
business_restock = _action("business_restock", business.restock)
business_sell = _action("business_sell", business.sell)
mission_accept = _action("mission_accept", lambda c, b, n: missions.accept(c, b.get("mission"), n), idempotent=False)
mission_claim = _action("mission_claim", lambda c, b, n: missions.claim(c, b.get("mission"), n))
plot_buy = _action("plot_buy", plots.buy)
plot_build = _action("plot_build", plots.build)
ad_rent = _action("ad_rent", plots.rent_ad)


# --- Rencontres entre joueurs ---------------------------------------------------------
# Hors du pipeline des actions : rien n'y touche à l'économie ni à l'état du personnage
# (pas de verrou ni de version), seule la position est mémorisée.

def _social(handler):
    @api_view(["POST"])
    @_guarded
    def view(request):
        char = Character.objects.filter(player=request.user).first()
        if char is None:
            raise GameError("no_character", "Aucun personnage pour ce joueur.", 404)
        with transaction.atomic():
            result = handler(char, _body(request), clock.now())
        return Response({"ok": True, **result})

    view.__name__ = handler.__name__
    return view


social_poll = _social(social.poll)
social_request = _social(social.send_request)
social_respond = _social(social.respond)
social_read = _social(social.mark_read)
social_cancel = _social(social.cancel)
social_hangup = _social(social.hangup)
social_signal = _social(social.signal)
social_unfriend = _social(social.unfriend)
social_message = _social(social.send_message)
social_messages_read = _social(social.read_messages)
