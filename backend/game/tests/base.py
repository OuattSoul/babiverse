import itertools
from datetime import datetime, timedelta, timezone as dt_timezone
from unittest import mock

from django.core.cache import cache
from django.test import TestCase
from rest_framework.test import APIClient

from game.models import Character

_keys = itertools.count(1)
_players = itertools.count(1)
PASSWORD = "Akwaba-2026!"


def register(client, username=None, email=None, password=PASSWORD):
    """Inscrit un nouveau compte avec ce client et l'authentifie. Renvoie le jeton de session.

    L'e-mail est facultatif, comme dans le jeu ; s'il est donné, il reste à confirmer.
    """
    username = username or f"joueur{next(_players):04d}"
    body = {"username": username, "password": password}
    if email:
        body["email"] = email
    res = client.post("/api/auth/register", body, format="json")
    assert res.status_code == 201, res.content
    token = res.json()["token"]
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
    return token
T0 = datetime(2026, 10, 1, 9, 0, tzinfo=dt_timezone.utc)


class GameTestCase(TestCase):
    """Fournit une horloge contrôlable et des raccourcis d'API."""

    profile = "etudiant"

    def setUp(self):
        cache.clear()  # remet à zéro les compteurs de limitation de débit
        self.now = T0
        patcher = mock.patch("game.clock.now", side_effect=lambda: self.now)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.client = self.new_player()
        self.create_character(self.client, profile=self.profile)

    def advance(self, **delta):
        self.now += timedelta(**delta)

    def new_player(self):
        client = APIClient()
        register(client)
        return client

    def create_character(self, client, profile="etudiant", name="Kouadio"):
        res = client.post("/api/character", {"name": name, "profile": profile,
                                             "appearance": {"skin": "#8d5524"}}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        return res.json()["state"]

    def act(self, path, body=None, key=None, zone=None, client=None, expect=None):
        client = client or self.client
        body = dict(body or {})
        if zone:
            body["pos"] = {"zone": zone, "x": 100, "y": 100}
        key = key or f"test-key-{next(_keys):06d}"
        res = client.post(f"/api/{path}", body, format="json", HTTP_IDEMPOTENCY_KEY=key)
        if expect is not None:
            self.assertEqual(res.status_code, expect, res.content)
        return res.json()

    def state(self, client=None):
        return (client or self.client).get("/api/state").json()["state"]

    def char(self):
        return Character.objects.get(name="Kouadio")

    def set_char(self, **fields):
        Character.objects.filter(name="Kouadio").update(**fields)
