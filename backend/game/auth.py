"""Authentification : un jeton de session aléatoire par appareil, stocké haché côté serveur.

Le compte (e-mail, nom d'utilisateur, mot de passe) est géré par `services/accounts.py` ; une
connexion réussie délivre un jeton `AuthToken` envoyé ensuite dans `Authorization: Bearer`.
"""
import hashlib
import secrets
from datetime import timedelta

from django.db.models import Q
from rest_framework import authentication, exceptions
from rest_framework.throttling import SimpleRateThrottle

from . import clock
from .models import AuthToken, Player

# Évite une écriture en base à chaque requête : la date d'usage est rafraîchie au plus 1 fois/heure.
TOKEN_TOUCH_EVERY = timedelta(hours=1)
# Une session expire après 30 jours sans utilisation, et dans tous les cas 180 jours après la connexion.
SESSION_IDLE_TTL = timedelta(days=30)
SESSION_MAX_AGE = timedelta(days=180)


def session_expired(session, now):
    last_use = session.last_used_at or session.created_at
    return now - last_use > SESSION_IDLE_TTL or now - session.created_at > SESSION_MAX_AGE


def purge_expired_sessions(now, player=None):
    """Supprime les sessions expirées (de ce joueur, ou de tous). Renvoie le nombre supprimé."""
    idle_limit = now - SESSION_IDLE_TTL
    expired = AuthToken.objects.filter(
        Q(last_used_at__lt=idle_limit) | Q(last_used_at=None, created_at__lt=idle_limit)
        | Q(created_at__lt=now - SESSION_MAX_AGE))
    if player is not None:
        expired = expired.filter(player=player)
    return expired.delete()[0]


def hash_token(token):
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def issue_token(player, now=None):
    """Ouvre une session pour ce joueur et renvoie le jeton en clair (jamais stocké)."""
    token = secrets.token_urlsafe(24)
    AuthToken.objects.create(player=player, token_hash=hash_token(token), created_at=now or clock.now())
    return token


def create_player():
    """Joueur sans identifiants + première session (utilisé par les tests et l'inscription)."""
    player = Player.objects.create()
    return player, issue_token(player)


class PlayerTokenAuthentication(authentication.BaseAuthentication):
    keyword = "Bearer"

    def authenticate(self, request):
        header = request.headers.get("Authorization", "")
        if not header.startswith(self.keyword + " "):
            return None
        token = header[len(self.keyword) + 1:].strip()
        if not token or len(token) > 128:
            raise exceptions.AuthenticationFailed("Jeton invalide.")
        session = AuthToken.objects.select_related("player").filter(token_hash=hash_token(token)).first()
        if session is None:
            raise exceptions.AuthenticationFailed("Session inconnue ou expirée.")
        now = clock.now()
        if session_expired(session, now):
            session.delete()
            raise exceptions.AuthenticationFailed("Session expirée : reconnecte-toi.")
        if session.last_used_at is None or now - session.last_used_at > TOKEN_TOUCH_EVERY:
            AuthToken.objects.filter(pk=session.pk).update(last_used_at=now)
        return session.player, token

    def authenticate_header(self, request):
        return self.keyword


class AuthRateThrottle(SimpleRateThrottle):
    """Limite par adresse IP des routes sensibles (connexion, inscription, mot de passe oublié)."""

    scope = "auth"

    def get_cache_key(self, request, view):
        return self.cache_format % {"scope": self.scope, "ident": self.get_ident(request)}
