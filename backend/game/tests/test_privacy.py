from game.models import BugReport, Character, Home, PlotClaim, Player

from .base import GameTestCase


class PrivateInteriorTests(GameTestCase):
    """Le serveur refuse d'enregistrer un joueur dans l'intérieur d'une construction qui n'est pas la sienne."""

    def setUp(self):
        super().setUp()
        self.other = self.new_player()
        self.create_character(self.other, name="Mariam")
        mariam = Character.objects.get(name="Mariam")
        PlotClaim.objects.create(plot_id="P03", owner=mariam, claimed_at=self.now, template="maisonnette")
        PlotClaim.objects.create(plot_id="P04", owner=self.char(), claimed_at=self.now, template="maisonnette")

    def test_owner_enters_own_building(self):
        self.act("sync", {}, zone="int_pb_P04", expect=200)
        self.assertEqual(self.char().zone, "int_pb_P04")

    def test_cannot_enter_someone_elses_building_by_changing_the_zone(self):
        self.act("sync", {}, zone="quartier", expect=200)
        self.act("sync", {}, zone="int_pb_P03", expect=200)
        self.assertEqual(self.char().zone, "quartier")

    def test_cannot_enter_someone_elses_home(self):
        mine = Home.objects.get(player__character__name="Kouadio").slot
        theirs = Home.objects.get(player__character__name="Mariam").slot
        self.act("sync", {}, zone=f"int_home_{theirs}", expect=200)
        self.assertNotEqual(self.char().zone, f"int_home_{theirs}")
        self.act("sync", {}, zone=f"int_home_{mine}", expect=200)
        self.assertEqual(self.char().zone, f"int_home_{mine}")

    def test_public_interiors_stay_open(self):
        self.act("sync", {}, zone="int_maquis", expect=200)
        self.assertEqual(self.char().zone, "int_maquis")


class AccountDeletionTests(GameTestCase):
    def test_deleting_the_account_removes_every_trace(self):
        PlotClaim.objects.create(plot_id="P04", owner=self.char(), claimed_at=self.now)
        self.client.post("/api/feedback", {"message": "La caméra tremble."}, format="json")
        res = self.client.delete("/api/account")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(Player.objects.count(), 0)
        for model in (Character, Home, PlotClaim, BugReport):
            self.assertFalse(model.objects.exists(), model.__name__)
        # L'ancien jeton ne fonctionne plus.
        self.assertEqual(self.client.get("/api/state").status_code, 401)

    def test_other_players_are_untouched(self):
        other = self.new_player()
        self.create_character(other, name="Mariam")
        self.client.delete("/api/account")
        self.assertTrue(Character.objects.filter(name="Mariam").exists())
        self.assertEqual(Home.objects.count(), 1)

    def test_requires_authentication(self):
        from rest_framework.test import APIClient
        self.assertEqual(APIClient().delete("/api/account").status_code, 401)


class BugReportTests(GameTestCase):
    def test_report_is_stored_with_minimal_context(self):
        res = self.client.post("/api/feedback", {"message": "  Le PNJ traverse le mur.  ", "zone": "quartier"},
                               format="json", HTTP_USER_AGENT="Mozilla/5.0 Android")
        self.assertEqual(res.status_code, 201, res.content)
        report = BugReport.objects.get()
        self.assertEqual((report.message, report.zone, report.user_agent),
                         ("Le PNJ traverse le mur.", "quartier", "Mozilla/5.0 Android"))

    def test_rejects_empty_or_too_long_messages_and_unknown_zones(self):
        for message in ("", "abc", "x" * 1001):
            res = self.client.post("/api/feedback", {"message": message}, format="json")
            self.assertEqual(res.json()["error"]["code"], "invalid_message")
        self.client.post("/api/feedback", {"message": "Bug quelque part", "zone": "<script>"}, format="json")
        self.assertEqual(BugReport.objects.get().zone, "")

    def test_daily_limit(self):
        for _ in range(10):
            self.assertEqual(self.client.post("/api/feedback", {"message": "Encore un bug"}, format="json").status_code, 201)
        res = self.client.post("/api/feedback", {"message": "Encore un bug"}, format="json")
        self.assertEqual(res.json()["error"]["code"], "too_many_reports")
        self.advance(days=1, minutes=1)
        self.assertEqual(self.client.post("/api/feedback", {"message": "Encore un bug"}, format="json").status_code, 201)
