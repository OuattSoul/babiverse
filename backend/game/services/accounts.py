"""Comptes joueurs : inscription, connexion, adresse e-mail de récupération, mot de passe.

On se connecte avec son **nom d'utilisateur** et son mot de passe. L'e-mail est facultatif mais sert à
récupérer le compte : il n'est utilisé qu'une fois **confirmé** par un lien envoyé à cette adresse.

Sécurité :
- mot de passe haché par Django (PBKDF2 salé), validé par `AUTH_PASSWORD_VALIDATORS` ;
- message d'échec de connexion identique que le compte existe ou non, temps de calcul comparable ;
- verrouillage temporaire après `MAX_FAILED_LOGINS` essais ratés ;
- liens (confirmation, réinitialisation) aléatoires de 256 bits, seule leur empreinte est stockée, usage
  unique, durée limitée ;
- rien ne révèle si une adresse e-mail est inscrite : saisir l'adresse confirmée d'un autre compte donne
  la même réponse (le propriétaire de l'adresse est prévenu à la place), « mot de passe oublié » répond
  toujours pareil, et les e-mails partent hors de la requête (`mail.send_async`) ;
- changer de mot de passe ou d'adresse exige le mot de passe actuel et prévient l'adresse confirmée.
"""
import logging
import re
import secrets
from datetime import timedelta

from django.conf import settings
from django.contrib.auth.hashers import check_password, make_password
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.db import IntegrityError, transaction

from game.auth import hash_token, issue_token, purge_expired_sessions
from game.mail import send_async
from game.models import AuthToken, EmailVerification, PasswordReset, Player

from .errors import GameError

log = logging.getLogger("game")

USERNAME_RE = re.compile(r"^[a-z0-9][a-z0-9_.]{2,19}$")
RESERVED_USERNAMES = {"admin", "administrateur", "babiverse", "moderateur", "support", "systeme"}
MAX_PASSWORD_CHARS = 128  # borne le coût du hachage
MAX_FAILED_LOGINS = 5
LOCK_DURATION = timedelta(minutes=15)
RESET_TTL = timedelta(minutes=30)
MAX_RESETS_PER_HOUR = 3
VERIFY_TTL = timedelta(hours=24)
MAX_VERIFICATIONS_PER_HOUR = 3
LOGIN_FAILED = "Nom d'utilisateur ou mot de passe incorrect."


# --- Validation ---------------------------------------------------------------------

def _clean_username(value):
    username = str(value or "").strip().lower()
    if not USERNAME_RE.match(username):
        raise GameError("invalid_username", "Le nom d'utilisateur doit faire 3 à 20 caractères, sans espace : lettres "
                                            "minuscules, chiffres, « _ » ou « . », en commençant par une lettre ou un chiffre.", 400)
    if username in RESERVED_USERNAMES:
        raise GameError("username_taken", "Ce nom d'utilisateur n'est pas disponible.", 400)
    return username


def _clean_email(value):
    """Adresse normalisée, ou None si le champ est vide (l'e-mail est facultatif)."""
    email = str(value or "").strip().lower()
    if not email:
        return None
    try:
        if len(email) > 254:
            raise ValidationError("trop long")
        validate_email(email)
    except ValidationError:
        raise GameError("invalid_email", "Adresse e-mail invalide.", 400)
    return email


def _check_new_password(password, player):
    if not isinstance(password, str) or len(password) > MAX_PASSWORD_CHARS:
        raise GameError("invalid_password", f"Le mot de passe doit faire au plus {MAX_PASSWORD_CHARS} caractères.", 400)
    try:
        validate_password(password, user=player)
    except ValidationError as err:
        raise GameError("weak_password", " ".join(err.messages), 400)


def _require_password(player, password):
    if not isinstance(password, str) or not check_password(password, player.password):
        raise GameError("wrong_password", "Mot de passe actuel incorrect.", 400)


def mask_email(email):
    """k*****@exemple.ci : assez pour reconnaître son adresse, pas pour la lire en entier."""
    local, _, domain = email.partition("@")
    return f"{local[:1]}{'*' * max(len(local) - 1, 3)}@{domain}"


def _link(fragment, token):
    # Le jeton est placé après « # » : il n'est envoyé ni au serveur web ni dans l'en-tête Referer.
    return f"{settings.PUBLIC_URL.rstrip('/')}/#{fragment}={token}"


def _notify(player, subject, body):
    """Alerte de sécurité à l'adresse confirmée du joueur (s'il en a une)."""
    if player.email:
        send_async(f"BabiVerse — {subject}", f"Bonjour {player.username},\n\n{body}", player.email)


def account_info(player):
    return {
        "registered": player.registered,
        "username": player.username,
        "email": player.email,  # adresse confirmée (sert à la récupération)
        "pending_email": player.pending_email,  # adresse en attente de confirmation
    }


# --- Adresse e-mail -------------------------------------------------------------------

def _start_email_verification(player, email, now):
    """Met `email` en attente et envoie le lien de confirmation. La réponse ne dépend pas de l'adresse."""
    recent = EmailVerification.objects.filter(player=player, created_at__gte=now - timedelta(hours=1)).count()
    if recent >= MAX_VERIFICATIONS_PER_HOUR:
        raise GameError("too_many_emails", "Trop d'e-mails envoyés. Réessaie dans une heure.", 400)
    EmailVerification.objects.filter(player=player, used_at__isnull=True).update(used_at=now)
    player.pending_email = email
    player.save(update_fields=["pending_email"])
    token = secrets.token_urlsafe(32)
    # Trace créée dans tous les cas : la limite par heure s'applique aussi aux adresses déjà prises.
    EmailVerification.objects.create(player=player, email=email, token_hash=hash_token(token),
                                     created_at=now, expires_at=now + VERIFY_TTL)
    if Player.objects.filter(email=email).exclude(pk=player.pk).exists():
        # Adresse confirmée sur un autre compte : on prévient son propriétaire au lieu de révéler quoi que ce soit.
        send_async("BabiVerse — ton adresse e-mail", "Quelqu'un a essayé d'associer cette adresse à un autre compte "
                   "BabiVerse. Elle reste liée à ton compte actuel. Si tu as oublié ton nom d'utilisateur ou ton mot "
                   "de passe, utilise « Mot de passe oublié » dans le jeu.", email)
        log.info("adresse déjà confirmée ailleurs, propriétaire prévenu joueur=%s", player.pk)
        return
    hours = int(VERIFY_TTL.total_seconds() // 3600)
    send_async("BabiVerse — confirme ton adresse e-mail",
               f"Bonjour {player.username},\n\nConfirme ton adresse pour pouvoir récupérer ton compte si tu perds ton "
               f"mot de passe (lien valable {hours} heures, une seule fois) :\n\n{_link('verify', token)}\n\n"
               "Tu n'as pas créé de compte BabiVerse ? Ignore ce message.", email)


def set_email(player, data, now):
    """Ajoute, change ou retire l'adresse de récupération (mot de passe actuel exigé)."""
    if not player.registered:
        raise GameError("not_registered", "Crée d'abord tes identifiants.", 400)
    _require_password(player, data.get("password"))
    email = _clean_email(data.get("email"))
    if email is None:
        old = player.email
        player.email, player.email_verified_at, player.pending_email = None, None, None
        player.save(update_fields=["email", "email_verified_at", "pending_email"])
        EmailVerification.objects.filter(player=player, used_at__isnull=True).update(used_at=now)
        if old:
            send_async("BabiVerse — adresse de récupération retirée",
                       f"Bonjour {player.username},\n\nCette adresse n'est plus liée à ton compte BabiVerse : elle ne "
                       "pourra plus servir à le récupérer. Si ce n'est pas toi, reconnecte-toi vite et change ton "
                       "mot de passe.", old)
        return
    if email == player.email:
        raise GameError("same_email", "C'est déjà ton adresse confirmée.", 400)
    _start_email_verification(player, email, now)
    _notify(player, "changement d'adresse demandé",
            f"Une nouvelle adresse de récupération ({mask_email(email)}) a été demandée pour ton compte. Elle ne "
            "remplacera celle-ci qu'une fois confirmée. Si ce n'est pas toi, change ton mot de passe.")


def resend_verification(player, now):
    if not player.pending_email:
        raise GameError("no_pending_email", "Aucune adresse en attente de confirmation.", 400)
    _start_email_verification(player, player.pending_email, now)


def verify_email(data, now):
    """Confirme l'adresse du lien. Renvoie le joueur concerné."""
    token = data.get("token")
    ver = None
    if isinstance(token, str) and 0 < len(token) <= 128:
        ver = (EmailVerification.objects.select_related("player")
               .filter(token_hash=hash_token(token), used_at__isnull=True, expires_at__gt=now).first())
    # Un lien remplacé par une demande plus récente ne vaut plus rien.
    if ver is None or ver.player.pending_email != ver.email:
        raise GameError("invalid_verify_link", "Ce lien de confirmation est invalide ou a expiré. Redemande-le depuis "
                                               "⚙️ Réglages → Mon compte.", 400)
    player = ver.player
    if Player.objects.filter(email=ver.email).exclude(pk=player.pk).exists():
        # Seul le détenteur de la boîte peut voir ce message : aucune fuite.
        raise GameError("email_taken", "Cette adresse est déjà confirmée sur un autre compte.", 409)
    old = player.email
    player.email, player.email_verified_at, player.pending_email = ver.email, now, None
    try:
        with transaction.atomic():
            player.save(update_fields=["email", "email_verified_at", "pending_email"])
    except IntegrityError:
        raise GameError("email_taken", "Cette adresse est déjà confirmée sur un autre compte.", 409)
    EmailVerification.objects.filter(player=player, used_at__isnull=True).update(used_at=now)
    if old and old != player.email:
        send_async("BabiVerse — adresse de récupération remplacée",
                   f"Bonjour {player.username},\n\nTon compte BabiVerse utilise désormais l'adresse "
                   f"{mask_email(player.email)} pour la récupération. Si ce n'est pas toi, réponds vite à ce message.", old)
    log.info("adresse confirmée joueur=%s", player.pk)
    return player


# --- Inscription et connexion ------------------------------------------------------

def register(player, data, now):
    """Crée un compte, ou rattache des identifiants au joueur invité authentifié `player`.

    L'e-mail est facultatif ; s'il est fourni, un lien de confirmation part. Renvoie `(player, token)` ;
    `token` est None quand le joueur garde sa session actuelle.
    """
    if player is not None and player.registered:
        raise GameError("already_registered", "Ce compte a déjà ses identifiants.", 409)
    username = _clean_username(data.get("username"))
    email = _clean_email(data.get("email"))
    password = data.get("password")
    candidate = player or Player()
    candidate.username = username
    candidate.pending_email = email  # pour comparer le mot de passe à l'adresse (similarité)
    _check_new_password(password, candidate)
    if Player.objects.filter(username=username).exclude(pk=candidate.pk).exists():
        raise GameError("username_taken", "Ce nom d'utilisateur est déjà pris.", 409)
    candidate.password = make_password(password)
    candidate.password_changed_at = now
    candidate.pending_email = None
    try:
        with transaction.atomic():
            candidate.save()
    except IntegrityError:  # inscription simultanée avec le même nom d'utilisateur
        raise GameError("username_taken", "Ce nom d'utilisateur est déjà pris.", 409)
    if email:
        _start_email_verification(candidate, email, now)
    token = None if player is not None else issue_token(candidate, now)
    log.info("compte enregistré joueur=%s", candidate.pk)
    return candidate, token


def login(data, now):
    """Connexion par nom d'utilisateur. Renvoie `(player, token)`."""
    username = str(data.get("username") or "").strip().lower()
    password = data.get("password")
    if not username or not isinstance(password, str) or len(password) > MAX_PASSWORD_CHARS:
        raise GameError("invalid_credentials", LOGIN_FAILED, 400)
    player = Player.objects.filter(username=username).exclude(password="").first() if USERNAME_RE.match(username) else None
    if player is None:
        make_password(password)  # même coût qu'une vraie vérification : pas d'indice par le temps de réponse
        raise GameError("invalid_credentials", LOGIN_FAILED, 400)
    if player.locked_until and player.locked_until > now:
        raise GameError("account_locked", "Trop d'essais. Réessaie dans quelques minutes ou réinitialise ton mot de passe.", 403)
    if not check_password(password, player.password):
        player.failed_logins += 1
        if player.failed_logins >= MAX_FAILED_LOGINS:
            player.failed_logins = 0
            player.locked_until = now + LOCK_DURATION
            log.warning("compte verrouillé après échecs répétés joueur=%s", player.pk)
            _notify(player, "connexion bloquée", "Plusieurs mots de passe erronés ont été saisis pour ton compte : les "
                    f"connexions sont bloquées {int(LOCK_DURATION.total_seconds() // 60)} minutes. Si ce n'est pas toi, "
                    "change ton mot de passe dès que possible.")
        player.save(update_fields=["failed_logins", "locked_until"])
        raise GameError("invalid_credentials", LOGIN_FAILED, 400)
    player.failed_logins, player.locked_until = 0, None
    player.save(update_fields=["failed_logins", "locked_until"])
    purge_expired_sessions(now, player)
    return player, issue_token(player, now)


def logout(player, token, everywhere=False):
    sessions = AuthToken.objects.filter(player=player)
    if not everywhere:
        sessions = sessions.filter(token_hash=hash_token(token))
    sessions.delete()


# --- Mot de passe ---------------------------------------------------------------------

def change_password(player, current_token, data, now):
    """Change le mot de passe (l'actuel est exigé) et ferme les sessions des autres appareils."""
    if not player.registered:
        raise GameError("not_registered", "Crée d'abord tes identifiants.", 400)
    _require_password(player, data.get("current_password"))
    new = data.get("new_password")
    _check_new_password(new, player)
    player.password = make_password(new)
    player.password_changed_at = now
    player.save(update_fields=["password", "password_changed_at"])
    AuthToken.objects.filter(player=player).exclude(token_hash=hash_token(current_token)).delete()
    _notify(player, "mot de passe modifié", "Le mot de passe de ton compte vient d'être modifié. Les autres appareils "
            "ont été déconnectés.\n\nSi ce n'est pas toi, utilise « Mot de passe oublié » tout de suite pour reprendre "
            "la main sur ton compte.")


def request_reset(data, now):
    """Envoie un lien de réinitialisation à l'adresse confirmée du compte (nom d'utilisateur ou adresse).

    Ne révèle jamais si le compte existe ni s'il a une adresse confirmée.
    """
    identifier = str(data.get("login") or "").strip().lower()
    if "@" in identifier:
        try:
            player = Player.objects.filter(email=_clean_email(identifier)).first()
        except GameError:
            player = None
    else:
        player = Player.objects.filter(username=identifier).first() if USERNAME_RE.match(identifier) else None
    if player is None or not player.email or not player.password:
        return
    recent = PasswordReset.objects.filter(player=player, created_at__gte=now - timedelta(hours=1)).count()
    if recent >= MAX_RESETS_PER_HOUR:
        log.info("demande de réinitialisation ignorée (limite) joueur=%s", player.pk)
        return
    token = secrets.token_urlsafe(32)
    PasswordReset.objects.create(player=player, token_hash=hash_token(token), created_at=now, expires_at=now + RESET_TTL)
    minutes = int(RESET_TTL.total_seconds() // 60)
    _notify(player, "réinitialiser ton mot de passe",
            f"Pour choisir un nouveau mot de passe, ouvre ce lien (valable {minutes} minutes, une seule fois) :\n\n"
            f"{_link('reset', token)}\n\nTon nom d'utilisateur : {player.username}\n\n"
            "Tu n'as rien demandé ? Ignore ce message : ton mot de passe ne change pas.")
    log.info("lien de réinitialisation envoyé joueur=%s", player.pk)


def reset_password(data, now):
    """Applique un nouveau mot de passe avec un lien valide. Ferme toutes les sessions, en ouvre une neuve."""
    token = data.get("token")
    reset = None
    if isinstance(token, str) and 0 < len(token) <= 128:
        reset = (PasswordReset.objects.select_related("player")
                 .filter(token_hash=hash_token(token), used_at__isnull=True, expires_at__gt=now).first())
    if reset is None:
        raise GameError("invalid_reset_link", "Ce lien est invalide ou a expiré. Refais une demande.", 400)
    player = reset.player
    password = data.get("password")
    _check_new_password(password, player)
    player.password = make_password(password)
    player.password_changed_at = now
    player.failed_logins, player.locked_until = 0, None
    player.save(update_fields=["password", "password_changed_at", "failed_logins", "locked_until"])
    PasswordReset.objects.filter(player=player, used_at__isnull=True).update(used_at=now)
    AuthToken.objects.filter(player=player).delete()
    _notify(player, "mot de passe réinitialisé", "Le mot de passe de ton compte a été réinitialisé et tous les "
            "appareils ont été déconnectés.\n\nSi ce n'est pas toi, refais une demande « Mot de passe oublié » "
            "immédiatement.")
    log.info("mot de passe réinitialisé joueur=%s", player.pk)
    return player, issue_token(player, now)


def purge(now):
    """Nettoyage périodique : sessions expirées, liens utilisés ou expirés depuis plus de 7 jours."""
    old = now - timedelta(days=7)
    sessions = purge_expired_sessions(now)
    links = 0
    for model in (PasswordReset, EmailVerification):
        links += model.objects.filter(expires_at__lt=old).delete()[0]
        links += model.objects.filter(used_at__lt=old).delete()[0]
    return sessions, links
