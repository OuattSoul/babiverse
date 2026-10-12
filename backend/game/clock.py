"""Horloge serveur : seule référence temporelle pour les règles persistantes.

Les tests remplacent `now` (unittest.mock.patch("game.clock.now")) pour simuler
le passage du temps sans attendre.
"""
from django.utils import timezone


def now():
    return timezone.now()


def virtual_day(dt):
    """Jour virtuel (1 jour virtuel = 24 h réelles, fuseau d'Abidjan)."""
    return timezone.localtime(dt).date()
