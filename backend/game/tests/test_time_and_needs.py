from game.models import PlotClaim

from .base import GameTestCase


class NeedsTests(GameTestCase):
    def test_needs_evolve_during_active_play(self):
        # Joueur actif : un battement de cœur toutes les 60 s pendant 10 minutes.
        for _ in range(10):
            self.advance(seconds=60)
            self.act("sync", zone="quartier")
        char = self.state()["character"]
        self.assertAlmostEqual(char["hunger"], 30 + 10 * 1.2, places=1)
        self.assertAlmostEqual(char["energy"], 70 - 10 * 0.8, places=1)

    def test_needs_are_suspended_while_absent(self):
        self.advance(hours=30)
        char = self.state()["character"]
        # Seules les 120 s de grâce sont comptées.
        self.assertAlmostEqual(char["hunger"], 30 + 2 * 1.2, places=1)
        self.assertAlmostEqual(char["energy"], 70 - 2 * 0.8, places=1)

    def test_needs_stay_bounded(self):
        self.set_char(hunger=99.5, energy=0.5)
        self.advance(seconds=120)
        char = self.state()["character"]
        self.assertEqual((char["hunger"], char["energy"]), (100, 0))


class PositionAndRestoreTests(GameTestCase):
    def test_position_and_progress_are_restored(self):
        self.act("sync", {"pos": {"zone": "epicerie", "x": 160.5, "y": 200}})
        self.act("shop/buy", {"shop": "epicerie", "item": "cafe_touba"}, zone="epicerie", expect=200)
        self.act("sync", {"pos": {"zone": "epicerie", "x": 170, "y": 210}})
        # « Fermeture du navigateur » puis retour le lendemain.
        self.advance(days=1)
        state = self.state()
        self.assertEqual((state["character"]["zone"], state["character"]["x"], state["character"]["y"]),
                         ("epicerie", 170, 210))
        self.assertEqual(state["character"]["balance"], 3800)
        self.assertEqual(state["inventory"]["cafe_touba"], 1)

    def test_position_far_out_in_a_large_city_is_kept(self):
        # La carte n'a pas de taille fixe : une position à 300 cases de l'origine reste valable.
        self.act("sync", {"pos": {"zone": "quartier", "x": 9600, "y": 4800.5}})
        state = self.state()
        self.assertEqual((state["character"]["x"], state["character"]["y"]), (9600, 4800.5))

    def test_invalid_position_falls_back_to_spawn(self):
        self.act("sync", {"pos": {"zone": "quartier", "x": "nan", "y": -5}})
        state = self.state()
        self.assertEqual(state["character"]["zone"], "quartier")
        self.assertIsNone(state["character"]["x"])
        self.act("sync", {"pos": {"zone": "abobo", "x": 10, "y": 10}})
        self.assertEqual(self.state()["character"]["zone"], "quartier")
        self.act("sync", {"pos": {"zone": "int_../../x", "x": 10, "y": 10}})
        self.assertEqual(self.state()["character"]["zone"], "quartier")

    def test_building_interiors_are_valid_zones(self):
        # Intérieur public, et intérieur de sa propre construction (ceux des autres : test_privacy).
        PlotClaim.objects.create(plot_id="P06", owner=self.char(), claimed_at=self.now, template="maisonnette")
        for zone in ("int_maquis", "int_pb_P06"):
            self.act("sync", {"pos": {"zone": zone, "x": 144, "y": 176}})
            self.assertEqual(self.state()["character"]["zone"], zone)
