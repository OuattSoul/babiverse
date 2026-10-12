"""Rencontres entre joueurs : présence dans la ville, demandes (discuter, appeler, devenir amis),
notifications, discussions et mise en relation des appels vocaux.

- Le client envoie sa position toutes les 2 s (`poll`) ; il reçoit les joueurs visibles de sa zone,
  ses notifications, ses nouveaux messages et l'appel en cours.
- Une demande n'est possible qu'entre deux joueurs proches dans un lieu partagé (ville, commerces) ;
  exceptions : entre amis, et pour rappeler quelqu'un avec qui on a déjà échangé un appel.
- Le serveur ne transporte pas la voix : il relaie seulement les messages de mise en relation WebRTC.
"""
import json
import math
from datetime import timedelta

from django.db.models import Q

from game import rules
from game.models import CallSignal, Character, ChatMessage, Friendship, Player, SocialRequest

from .errors import GameError
from .state import PRIVATE_INTERIOR_RE, apply_position

S = rules.SOCIAL
TILE = 32
ONLINE_WINDOW = timedelta(minutes=2)
SIGNAL_KINDS = ("offer", "answer", "ice")
MAX_SIGNAL_BYTES = 16000
MAX_SIGNALS_PER_CALL = 300
R = SocialRequest


def shared_zone(zone):
    """Lieu où l'on peut croiser d'autres joueurs : pas « Chez moi » (chacun le sien) ni un intérieur privé."""
    return rules.zone_known(zone) and zone != "maison" and not PRIVATE_INTERIOR_RE.match(zone)


def _ring_deadline(now):
    return now - timedelta(seconds=S["call_ring_s"])


def _between(a, b):
    return Q(sender=a, recipient=b) | Q(sender=b, recipient=a)


def _involving(char):
    return Q(sender=char) | Q(recipient=char)


def are_friends(a, b):
    low, high = sorted((a.pk, b.pk))
    return Friendship.objects.filter(low_id=low, high_id=high).exists()


def chat_open(a, b):
    """Discussion possible : demande de discussion acceptée (dans un sens ou l'autre), ou amis."""
    return are_friends(a, b) or R.objects.filter(_between(a, b), kind=R.CHAT, status=R.ACCEPTED).exists()


def expire_calls(char, now):
    """Appels qui sonnent depuis plus de 30 s → manqués ; communication dont l'autre ne répond plus → terminée."""
    R.objects.filter(_involving(char), kind=R.CALL, status=R.PENDING, created_at__lt=_ring_deadline(now)) \
        .update(status=R.MISSED, answered_at=now)
    lost = now - timedelta(seconds=S["call_lost_s"])
    for call in R.objects.filter(_involving(char), kind=R.CALL, status=R.ACCEPTED, ended_at=None).select_related("sender", "recipient"):
        other = call.recipient if call.sender_id == char.pk else call.sender
        if other.seen_in_world_at is None or other.seen_in_world_at < lost:
            call.ended_at = now
            call.save(update_fields=["ended_at"])


def active_call(char):
    return R.objects.filter(_involving(char), kind=R.CALL, status=R.ACCEPTED, ended_at=None).first()


def _visible(char, now):
    return char.seen_in_world_at is not None and char.seen_in_world_at >= now - timedelta(seconds=S["visible_s"])


def _distance_px(a, b):
    if None in (a.pos_x, a.pos_y, b.pos_x, b.pos_y):
        return math.inf
    return math.hypot(a.pos_x - b.pos_x, a.pos_y - b.pos_y)


def _who(char):
    return {"id": char.pk, "name": char.name}


# --- Boucle sociale -----------------------------------------------------------------

def poll(char, data, now):
    """Position du joueur + tout ce qui le concerne. `data` : {pos, after (dernier message reçu), signal_after}."""
    apply_position(char, data)
    char.seen_in_world_at = now
    Character.objects.filter(pk=char.pk).update(zone=char.zone, pos_x=char.pos_x, pos_y=char.pos_y, seen_in_world_at=now)
    Player.objects.filter(pk=char.player_id).update(last_seen_at=now)
    expire_calls(char, now)

    friend_ids = friends_of(char)
    players = []
    if shared_zone(char.zone):
        others = Character.objects.filter(zone=char.zone, seen_in_world_at__gte=now - timedelta(seconds=S["visible_s"])) \
            .exclude(pk=char.pk).exclude(pos_x=None)[:200]
        others = sorted(others, key=lambda o: _distance_px(char, o))[:60]
        players = [{**_who(o), "appearance": o.appearance, "x": o.pos_x, "y": o.pos_y, "friend": o.pk in friend_ids}
                   for o in others]

    after = _int(data.get("after"))
    messages = ChatMessage.objects.filter(_involving(char))
    messages = messages.filter(id__gt=after) if after else messages.order_by("-id")[:100]
    messages = sorted(messages[:200], key=lambda m: m.id)

    call = R.objects.filter(_involving(char), kind=R.CALL).filter(
        Q(status=R.ACCEPTED, ended_at=None) | Q(status=R.PENDING)).select_related("sender", "recipient").first()

    return {
        "me": char.pk,
        "players": players,
        "notifications": notifications(char, now),
        "unread": unread_count(char),
        "friends": friends(char, friend_ids, now),
        "chats": sorted(chat_partners(char, friend_ids)),
        "messages": [message_view(m, char) for m in messages],
        "zone": char.zone,
        "call": call_view(call, char, now, _int(data.get("signal_after"))) if call else None,
    }


def _int(value):
    return value if isinstance(value, int) and not isinstance(value, bool) and value > 0 else 0


def friends_of(char):
    rows = Friendship.objects.filter(Q(low=char) | Q(high=char)).values_list("low_id", "high_id")
    return {high if low == char.pk else low for low, high in rows}


def friends(char, ids, now):
    online = now - ONLINE_WINDOW
    return [{**_who(c), "online": bool(c.seen_in_world_at and c.seen_in_world_at >= online)}
            for c in Character.objects.filter(pk__in=ids).order_by("name")]


def chat_partners(char, friend_ids):
    rows = R.objects.filter(_involving(char), kind=R.CHAT, status=R.ACCEPTED).values_list("sender_id", "recipient_id")
    return set(friend_ids) | {r if s == char.pk else s for s, r in rows}


def notifications(char, now):
    """Demandes reçues (tous états) et réponses à mes demandes, les plus récentes d'abord."""
    rows = R.objects.filter(Q(recipient=char) | Q(sender=char, status__in=(R.ACCEPTED, R.DECLINED, R.MISSED))) \
        .select_related("sender", "recipient")[:S["notifications_max"]]
    return [request_view(r, char, now) for r in rows]


def unread_count(char):
    incoming = R.objects.filter(recipient=char, read_at=None).count()
    outcomes = R.objects.filter(sender=char, outcome_read_at=None, status__in=(R.ACCEPTED, R.DECLINED, R.MISSED)).count()
    return incoming + outcomes + ChatMessage.objects.filter(recipient=char, read_at=None).count()


def request_view(r, char, now):
    incoming = r.recipient_id == char.pk
    other = r.sender if incoming else r.recipient
    view = {
        "id": r.id, "kind": r.kind, "status": r.status, "direction": "in" if incoming else "out",
        "other": _who(other), "created_at": r.created_at.isoformat(),
        "read": (r.read_at is not None) if incoming else (r.status == R.PENDING or r.outcome_read_at is not None),
    }
    if r.kind == R.CALL and r.status == R.PENDING:
        view["expires_at"] = (r.created_at + timedelta(seconds=S["call_ring_s"])).isoformat()
    if r.kind == R.CALL and r.status == R.ACCEPTED:
        view["ended"] = r.ended_at is not None
    return view


def message_view(m, char):
    mine = m.sender_id == char.pk
    return {"id": m.id, "with": m.recipient_id if mine else m.sender_id, "mine": mine, "text": m.text,
            "at": m.created_at.isoformat(), "read": m.read_at is not None}


def call_view(call, char, now, signal_after=0):
    caller = call.sender_id == char.pk
    signals = call.signals.exclude(sender=char)
    if signal_after:
        signals = signals.filter(id__gt=signal_after)
    view = {
        "id": call.id, "status": call.status, "role": "caller" if caller else "callee",
        "other": _who(call.recipient if caller else call.sender),
        "signals": [{"id": s.id, "kind": s.kind, "payload": s.payload} for s in signals.order_by("id")[:100]],
    }
    if call.status == R.PENDING:
        view["expires_at"] = (call.created_at + timedelta(seconds=S["call_ring_s"])).isoformat()
    return view


# --- Demandes ------------------------------------------------------------------------

def _other(char, data, key="to"):
    other_id = data.get(key)
    other = Character.objects.filter(pk=other_id).first() if isinstance(other_id, int) and not isinstance(other_id, bool) else None
    if other is None or other.pk == char.pk:
        raise GameError("unknown_player", "Ce joueur n'existe pas.", 400)
    return other


def _in_call(char):
    return R.objects.filter(_involving(char), kind=R.CALL).filter(
        Q(status=R.ACCEPTED, ended_at=None) | Q(status=R.PENDING)).exists()


def send_request(char, data, now):
    """Envoie une demande à un joueur proche. Renvoie la demande (la même si elle est déjà en attente)."""
    kind = data.get("kind")
    if kind not in (R.CHAT, R.CALL, R.FRIEND):
        raise GameError("invalid_kind", "Demande inconnue.", 400)
    other = _other(char, data)
    apply_position(char, data)
    char.seen_in_world_at = now
    Character.objects.filter(pk=char.pk).update(zone=char.zone, pos_x=char.pos_x, pos_y=char.pos_y, seen_in_world_at=now)
    expire_calls(char, now)
    expire_calls(other, now)

    friends = are_friends(char, other)
    if kind == R.FRIEND and friends:
        raise GameError("already_friends", f"{other.name} est déjà ton ami.")
    if kind == R.CHAT and chat_open(char, other):
        raise GameError("chat_open", f"Ta discussion avec {other.name} est déjà ouverte.")
    if not _visible(other, now):
        raise GameError("not_available", f"{other.name} n'est plus dans le jeu.")
    callback = kind == R.CALL and R.objects.filter(_between(char, other), kind=R.CALL).exists()
    if not (friends or callback):
        near = (shared_zone(char.zone) and char.zone == other.zone
                and _distance_px(char, other) <= S["reach_tiles"] * TILE)
        if not near:
            raise GameError("too_far", f"Rapproche-toi de {other.name} pour lui faire une demande.")

    existing = R.objects.filter(sender=char, recipient=other, kind=kind, status=R.PENDING).first()
    if existing:
        return {"request": request_view(existing, char, now)}
    if R.objects.filter(sender=other, recipient=char, kind=kind, status=R.PENDING).exists():
        raise GameError("answer_first", f"{other.name} t'a déjà fait cette demande : réponds-lui dans 🔔.")
    if kind == R.CALL:
        if _in_call(char):
            raise GameError("busy", "Tu as déjà un appel en cours.")
        if _in_call(other):
            raise GameError("busy", f"{other.name} est déjà en ligne.")
    declined = R.objects.filter(sender=char, recipient=other, kind=kind, status=R.DECLINED,
                                answered_at__gte=now - timedelta(seconds=S["retry_after_decline_s"])).exists()
    if declined:
        raise GameError("too_soon", f"{other.name} vient de refuser : attends un peu avant de redemander.")
    if R.objects.filter(sender=char, created_at__gte=now - timedelta(hours=1)).count() >= S["max_requests_per_hour"]:
        raise GameError("too_many_requests", "Tu as envoyé beaucoup de demandes : réessaie plus tard.", 429)

    req = R.objects.create(sender=char, recipient=other, kind=kind, created_at=now)
    return {"request": request_view(req, char, now)}


def _incoming(char, data, now):
    expire_calls(char, now)
    req = R.objects.select_for_update().filter(pk=data.get("id"), recipient=char).select_related("sender").first() \
        if isinstance(data.get("id"), int) else None
    if req is None:
        raise GameError("unknown_request", "Demande introuvable.", 404)
    return req


def respond(char, data, now):
    """Accepter ou refuser une demande reçue (`answer` = accept | decline)."""
    answer = data.get("answer")
    if answer not in ("accept", "decline"):
        raise GameError("invalid_answer", "Réponse inconnue.", 400)
    req = _incoming(char, data, now)
    if req.status != R.PENDING:
        message = "Cet appel a pris fin." if req.kind == R.CALL else "Tu as déjà répondu à cette demande."
        raise GameError("not_pending", message)
    if answer == "accept" and req.kind == R.CALL and active_call(char):
        raise GameError("busy", "Termine d'abord ton appel en cours.")
    req.status = R.ACCEPTED if answer == "accept" else R.DECLINED
    req.answered_at = now
    req.read_at = req.read_at or now
    req.save(update_fields=["status", "answered_at", "read_at"])
    if req.status == R.ACCEPTED and req.kind == R.FRIEND:
        low, high = sorted((req.sender_id, req.recipient_id))
        Friendship.objects.get_or_create(low_id=low, high_id=high, defaults={"created_at": now})
    return {"request": request_view(req, char, now)}


def mark_read(char, data, now):
    """Notifications vues (sans y répondre) : elles restent dans la liste, marquées lues."""
    ids = [i for i in data.get("ids", []) if isinstance(i, int)][:100] if isinstance(data.get("ids"), list) else []
    R.objects.filter(pk__in=ids, recipient=char, read_at=None).update(read_at=now)
    R.objects.filter(pk__in=ids, sender=char, outcome_read_at=None).exclude(status=R.PENDING).update(outcome_read_at=now)
    return {"unread": unread_count(char)}


def cancel(char, data, now):
    """L'expéditeur annule sa demande en attente (raccrocher avant que l'autre ne décroche)."""
    req = R.objects.filter(pk=data.get("id"), sender=char, status=R.PENDING).first() if isinstance(data.get("id"), int) else None
    if req is None:
        raise GameError("unknown_request", "Demande introuvable.", 404)
    req.status = R.MISSED if req.kind == R.CALL else R.CANCELLED
    req.answered_at = now
    req.outcome_read_at = now
    req.save(update_fields=["status", "answered_at", "outcome_read_at"])
    return {"request": request_view(req, char, now)}


def hangup(char, data, now):
    call = R.objects.filter(_involving(char), pk=data.get("id"), kind=R.CALL, status=R.ACCEPTED).first() \
        if isinstance(data.get("id"), int) else None
    if call is None:
        raise GameError("unknown_call", "Appel introuvable.", 404)
    if call.ended_at is None:
        call.ended_at = now
        call.save(update_fields=["ended_at"])
    return {}


def signal(char, data, now):
    """Relaie un message de mise en relation WebRTC à l'autre participant d'un appel en cours."""
    call = active_call(char)
    if call is None or call.pk != data.get("id"):
        raise GameError("unknown_call", "Aucun appel en cours.", 404)
    kind, payload = data.get("kind"), data.get("payload")
    if kind not in SIGNAL_KINDS or not isinstance(payload, dict) or len(json.dumps(payload)) > MAX_SIGNAL_BYTES:
        raise GameError("invalid_signal", "Message d'appel invalide.", 400)
    if call.signals.count() >= MAX_SIGNALS_PER_CALL:
        raise GameError("too_many_signals", "Mise en relation impossible.", 429)
    CallSignal.objects.create(call=call, sender=char, kind=kind, payload=payload, created_at=now)
    return {}


def unfriend(char, data, now):
    other = _other(char, data, "id")
    low, high = sorted((char.pk, other.pk))
    Friendship.objects.filter(low_id=low, high_id=high).delete()
    return {}


# --- Discussions ---------------------------------------------------------------------

def send_message(char, data, now):
    other = _other(char, data)
    text = str(data.get("text", "")).strip()
    if not 1 <= len(text) <= S["message_max"]:
        raise GameError("invalid_message", f"Écris un message de 1 à {S['message_max']} caractères.", 400)
    if not chat_open(char, other):
        raise GameError("chat_closed", f"{other.name} n'a pas encore accepté de discuter avec toi.", 403)
    msg = ChatMessage.objects.create(sender=char, recipient=other, text=text, created_at=now)
    return {"message": message_view(msg, char)}


def read_messages(char, data, now):
    other = _other(char, data, "with")
    ChatMessage.objects.filter(sender=other, recipient=char, read_at=None).update(read_at=now)
    return {"unread": unread_count(char)}
