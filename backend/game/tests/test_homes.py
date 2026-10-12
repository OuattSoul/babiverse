from unittest import mock

from game.auth import create_player
from game.models import Character, Home, Player
from game.services import homes
from game.services.errors import GameError

from .base import GameTestCase


def mine(state):
    return [h for h in state["world"]["residential"]["homes"] if h["mine"]]


class LotGeometryTests(GameTestCase):
    def test_first_block_holds_1024_distinct_lots_inside_the_zone(self):
        z = homes.ZONE
        self.assertEqual(homes.LOTS_PER_BLOCK, 1024)
        origins = [homes.lot_origin(n) for n in range(homes.LOTS_PER_BLOCK)]
        self.assertEqual(len(set(origins)), 1024)
        for x, y in origins:
            self.assertTrue(z["x"] <= x <= z["x"] + z["w"] - 2 and z["y"] <= y <= z["y"] + z["h"] - 2)
        self.assertEqual(origins[0], (z["x"], z["y"]))
        self.assertEqual(origins[1], (z["x"] + 2, z["y"]))
        self.assertEqual(origins[32], (z["x"], z["y"] + 2))

    def test_next_block_extends_south_without_moving_the_first(self):
        z = homes.ZONE
        self.assertEqual(homes.lot_origin(1024), (z["x"], z["y"] + z["h"]))
        self.assertEqual(homes.blocks_for(None), 1)
        self.assertEqual(homes.blocks_for(1023), 1)
        self.assertEqual(homes.blocks_for(1024), 2)

    def test_first_free_slot_fills_gaps(self):
        self.assertEqual(homes.first_free_slot([]), 0)
        self.assertEqual(homes.first_free_slot([0, 1, 2]), 3)
        self.assertEqual(homes.first_free_slot([2, 0, 3]), 1)


class InitialHomeTests(GameTestCase):
    def test_new_player_owns_a_house_immediately(self):
        client = self.new_player()
        state = self.create_character(client, name="Mariam")
        [home] = mine(state)
        self.assertEqual(home["owner"], "Mariam")
        self.assertEqual(home["template"], homes.ZONE["template"])
        self.assertEqual((home["x"], home["y"]), homes.lot_origin(home["slot"]))
        db = Home.objects.get(player__character__name="Mariam")
        self.assertEqual((db.slot, db.x, db.y), (home["slot"], home["x"], home["y"]))

    def test_two_new_players_get_distinct_lots(self):
        a = mine(self.state())[0]
        other = self.new_player()
        b = mine(self.create_character(other, name="Mariam"))[0]
        self.assertNotEqual(a["slot"], b["slot"])
        self.assertNotEqual((a["x"], a["y"]), (b["x"], b["y"]))
        # Chacun voit la maison de l'autre, sans en être propriétaire.
        seen = {h["owner"]: h["mine"] for h in self.state()["world"]["residential"]["homes"]}
        self.assertEqual(seen, {"Kouadio": True, "Mariam": False})

    def test_reconnection_finds_the_same_house_and_never_builds_another(self):
        first = mine(self.state())[0]
        for _ in range(3):
            self.advance(hours=5)
            self.assertEqual(mine(self.state()), [first])
            self.act("sync", {}, zone="quartier", expect=200)
        self.assertEqual(Home.objects.count(), 1)

    def test_second_character_creation_does_not_create_a_second_house(self):
        before = mine(self.state())[0]
        res = self.client.post("/api/character", {"name": "Autre", "profile": "etudiant"}, format="json")
        self.assertEqual(res.json()["error"]["code"], "character_exists")
        self.assertEqual(Home.objects.count(), 1)
        self.assertEqual(mine(self.state()), [before])

    def test_house_belongs_to_the_player_and_survives_a_character_reset(self):
        before = Home.objects.get()
        self.client.delete("/api/character")
        self.assertEqual(Home.objects.count(), 1)
        state = self.create_character(self.client, name="Kouadio")
        self.assertEqual(Home.objects.count(), 1)
        self.assertEqual(mine(state)[0]["slot"], before.slot)

    def test_failed_initialisation_leaves_neither_character_nor_house(self):
        client = self.new_player()
        with mock.patch("game.services.state.missions.refresh_availability", side_effect=RuntimeError("panne")):
            res = client.post("/api/character", {"name": "Mariam", "profile": "etudiant"}, format="json")
        self.assertEqual(res.status_code, 500)
        self.assertFalse(Character.objects.filter(name="Mariam").exists())
        self.assertEqual(Home.objects.count(), 1)
        # Nouvel essai : le joueur obtient bien sa maison, une seule.
        self.create_character(client, name="Mariam")
        self.assertEqual(Home.objects.filter(player__character__name="Mariam").count(), 1)

    def test_lot_taken_concurrently_is_retried_on_the_next_one(self):
        player, _ = create_player()
        with mock.patch("game.services.homes.first_free_slot", side_effect=[0, 1]):
            home = homes.assign_initial_home(player, self.now)
        self.assertEqual(home.slot, 1)
        self.assertEqual(Home.objects.count(), 2)

    def test_gives_up_cleanly_when_no_lot_can_be_reserved(self):
        player, _ = create_player()
        with mock.patch("game.services.homes.first_free_slot", return_value=0):
            with self.assertRaises(GameError) as err:
                homes.assign_initial_home(player, self.now)
        self.assertEqual(err.exception.code, "home_unavailable")
        self.assertFalse(Home.objects.filter(player=player).exists())

    def test_lot_freed_by_a_deleted_player_is_reused(self):
        other = self.new_player()
        self.create_character(other, name="Mariam")
        Home.objects.get(slot=0).player.delete()
        third = self.new_player()
        self.assertEqual(mine(self.create_character(third, name="Awa"))[0]["slot"], 0)

    def test_full_zone_opens_a_new_block_without_moving_existing_houses(self):
        n = homes.LOTS_PER_BLOCK
        players = Player.objects.bulk_create(Player() for _ in range(1, n))
        Home.objects.bulk_create(
            Home(player=p, slot=slot, x=homes.lot_origin(slot)[0], y=homes.lot_origin(slot)[1],
                 template="maisonnette", facing="S", created_at=self.now)
            for slot, p in enumerate(players, start=1))
        before = {s: (x, y) for s, x, y in Home.objects.values_list("slot", "x", "y")}
        self.assertEqual(self.state()["world"]["residential"]["blocks"], 1)

        state = self.create_character(self.new_player(), name="Mariam")
        res = state["world"]["residential"]
        home = mine(state)[0]
        self.assertEqual(home["slot"], n)
        self.assertEqual((home["x"], home["y"]), (homes.ZONE["x"], homes.ZONE["y"] + homes.ZONE["h"]))
        self.assertEqual((res["blocks"], res["lots"]), (2, 2 * n))
        self.assertEqual({s: (x, y) for s, x, y in Home.objects.filter(slot__lt=n).values_list("slot", "x", "y")}, before)
