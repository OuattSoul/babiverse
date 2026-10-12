from datetime import timedelta

from rest_framework.test import APIClient

from game.models import Player

from .base import GameTestCase


class PresenceTests(GameTestCase):
    """Compteur « joueurs connectés » de la barre du haut : uniquement des signes de vie réels."""

    def presence(self, client=None):
        res = (client or APIClient()).get("/api/presence")
        self.assertEqual(res.status_code, 200, res.content)
        return res.json()

    def test_counts_players_seen_in_the_last_two_minutes(self):
        self.act("sync", {}, expect=200)
        other = self.new_player()
        self.create_character(other, name="Mariam")
        self.act("sync", {}, client=other, expect=200)
        self.assertEqual(self.presence()["players_online"], 2)
        self.advance(seconds=90)
        self.act("sync", {}, expect=200)
        self.advance(seconds=60)
        # Mariam n'a plus donné signe de vie depuis 2 min 30 : elle n'est plus comptée.
        self.assertEqual(self.presence()["players_online"], 1)

    def test_open_without_session_and_no_invented_visitors(self):
        data = self.presence()
        self.assertIn("players_online", data)
        self.assertIsNone(data["visitors"])

    def test_call_from_a_player_counts_as_a_sign_of_life(self):
        Player.objects.update(last_seen_at=self.now - timedelta(hours=1))
        self.assertEqual(self.presence()["players_online"], 0)
        self.assertEqual(self.presence(self.client)["players_online"], 1)
