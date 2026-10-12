from unittest import mock

from game import rules
from game.models import AdCampaign, Business, Character, LedgerEntry, PlotClaim
from game.services.plots import placement, sign_tile

from .base import GameTestCase

Q = "quartier"


class PlotTests(GameTestCase):
    def rich(self, name="Kouadio", amount=100000):
        Character.objects.filter(name=name).update(balance=amount)

    def test_buy_plot_debits_and_appears_in_world(self):
        self.rich()
        res = self.act("plots/buy", {"plot": "P04"}, zone=Q, expect=200)
        self.assertEqual(res["state"]["character"]["balance"], 100000 - rules.PLOT_PRICE)
        self.assertEqual(res["state"]["world"]["plots"]["P04"], {"owner": "Kouadio", "mine": True, "building": None})
        self.assertEqual(LedgerEntry.objects.filter(kind="plot_buy").count(), 1)

    def test_buy_refusals(self):
        res = self.act("plots/buy", {"plot": "P04"}, zone=Q, expect=409)
        self.assertEqual(res["error"]["code"], "insufficient_funds")
        self.assertFalse(PlotClaim.objects.exists())
        self.rich()
        self.assertEqual(self.act("plots/buy", {"plot": "P99"}, zone=Q, expect=400)["error"]["code"], "unknown_plot")
        self.assertEqual(self.act("plots/buy", {"plot": "P04"}, zone="epicerie", expect=409)["error"]["code"], "wrong_zone")
        self.act("plots/buy", {"plot": "P04"}, zone=Q, expect=200)
        self.assertEqual(self.act("plots/buy", {"plot": "P05"}, zone=Q, expect=409)["error"]["code"], "plot_limit")

    def test_unavailable_plot_cannot_be_bought(self):
        self.rich()
        unavailable = [p["id"] for p in rules.CITY["plots"] if p.get("status") == "unavailable"]
        self.assertTrue(unavailable, "au moins une parcelle de démonstration est indisponible")
        res = self.act("plots/buy", {"plot": unavailable[0]}, zone=Q, expect=409)
        self.assertEqual(res["error"]["code"], "plot_unavailable")
        self.assertEqual(self.char().balance, 100000)
        self.assertFalse(PlotClaim.objects.exists())
        self.assertEqual(LedgerEntry.objects.filter(kind="plot_buy").count(), 0)

    def test_plot_taken_by_another_player(self):
        self.rich()
        self.act("plots/buy", {"plot": "P04"}, zone=Q, expect=200)
        other = self.new_player()
        self.create_character(other, name="Mariam")
        self.rich("Mariam")
        res = self.act("plots/buy", {"plot": "P04"}, zone=Q, client=other, expect=409)
        self.assertEqual(res["error"]["code"], "plot_taken")
        self.assertEqual(Character.objects.get(name="Mariam").balance, 100000)
        # Mariam voit la parcelle de Kouadio, sans en être propriétaire.
        self.assertEqual(res["state"]["world"]["plots"]["P04"]["owner"], "Kouadio")
        self.assertFalse(res["state"]["world"]["plots"]["P04"]["mine"])

    def test_repeated_purchase_is_charged_once(self):
        self.rich()
        self.act("plots/buy", {"plot": "P04"}, key="buy-plot-once", zone=Q, expect=200)
        res = self.act("plots/buy", {"plot": "P04"}, key="buy-plot-once", zone=Q, expect=200)
        self.assertTrue(res["replayed"])
        self.assertEqual(res["state"]["character"]["balance"], 100000 - rules.PLOT_PRICE)

    def test_build_on_own_plot(self):
        self.rich()
        self.act("plots/buy", {"plot": "P06"}, zone=Q, expect=200)
        res = self.act("plots/build", {"plot": "P06", "template": "boutique", "name": "Chez Kouadio"}, zone=Q, expect=200)
        cost = rules.PLAYER_BUILDINGS["boutique"]["cost"]
        self.assertEqual(res["state"]["character"]["balance"], 100000 - rules.PLOT_PRICE - cost)
        building = res["state"]["world"]["plots"]["P06"]["building"]
        self.assertEqual((building["template"], building["name"], building["facing"]), ("boutique", "Chez Kouadio", "N"))
        self.assertEqual(self.act("plots/build", {"plot": "P06", "template": "maisonnette"}, zone=Q, expect=409)["error"]["code"],
                         "already_built")

    def test_build_refusals(self):
        self.rich()
        self.assertEqual(self.act("plots/build", {"plot": "P06", "template": "boutique"}, zone=Q, expect=403)["error"]["code"],
                         "not_owner")
        self.act("plots/buy", {"plot": "P06"}, zone=Q, expect=200)
        self.assertEqual(self.act("plots/build", {"plot": "P06", "template": "gratte-ciel"}, zone=Q, expect=400)["error"]["code"],
                         "unknown_template")
        self.assertEqual(self.act("plots/build", {"plot": "P06", "template": "boutique", "name": "<b>"}, zone=Q, expect=400)["error"]["code"],
                         "invalid_name")
        Character.objects.filter(name="Kouadio").update(balance=100)
        self.assertEqual(self.act("plots/build", {"plot": "P06", "template": "boutique"}, zone=Q, expect=409)["error"]["code"],
                         "insufficient_funds")
        self.assertEqual(PlotClaim.objects.get().template, "")

    def test_placement_rules_for_every_plot_and_template(self):
        for plot in rules.PLOTS.values():
            sx, sy = sign_tile(plot)
            for template_id, t in rules.PLAYER_BUILDINGS.items():
                r = placement(plot, template_id)
                # Dans la parcelle
                self.assertGreaterEqual(r["x0"], plot["x"])
                self.assertLessEqual(r["x1"], plot["x"] + plot["w"] - 1)
                self.assertGreaterEqual(r["y0"], plot["y"])
                self.assertLessEqual(r["y1"], plot["y"] + plot["h"] - 1)
                # Le panneau reste libre et la case devant la porte aussi
                self.assertFalse(r["x0"] <= sx <= r["x1"] and r["y0"] <= sy <= r["y1"])
                door_x = r["x0"] + t["facade"].index("D")
                front_y = r["y1"] + 1 if r["facing"] == "S" else r["y0"] - 1
                self.assertNotEqual((door_x, front_y), (sx, sy), plot["id"])
                self.assertEqual(r["facing"], plot["front"])

    def test_buildings_of_others_are_visible(self):
        self.rich()
        self.act("plots/buy", {"plot": "P09"}, zone=Q, expect=200)
        self.act("plots/build", {"plot": "P09", "template": "maisonnette"}, zone=Q, expect=200)
        other = self.new_player()
        self.create_character(other, name="Mariam")
        world = self.state(other)["world"]
        self.assertEqual(world["plots"]["P09"]["building"]["template"], "maisonnette")
        self.assertEqual(world["plots"]["P09"]["owner"], "Kouadio")

    def test_freed_when_character_is_deleted(self):
        self.rich()
        self.act("plots/buy", {"plot": "P09"}, zone=Q, expect=200)
        self.client.delete("/api/character")
        self.assertFalse(PlotClaim.objects.exists())

    def test_missions_owner_and_builder(self):
        from game.models import MissionState
        self.rich()
        char = Character.objects.get(name="Kouadio")
        MissionState.objects.create(character=char, mission_id="m_terrain", status="active", updated_at=self.now)
        self.act("plots/buy", {"plot": "P01"}, zone=Q, expect=200)
        self.act("missions/claim", {"mission": "m_terrain"}, expect=200)
        missions = {m["id"]: m["status"] for m in self.state()["missions"]}
        self.assertEqual(missions["m_construire"], "active")
        self.act("plots/build", {"plot": "P01", "template": "maisonnette"}, zone=Q, expect=200)
        missions = {m["id"]: m["status"] for m in self.state()["missions"]}
        self.assertEqual(missions["m_construire"], "completed")


class AdTests(GameTestCase):
    profile = "entrepreneur"

    def open_kiosk(self, name="Kouadio"):
        char = Character.objects.get(name=name)
        Business.objects.create(character=char, type_id="kiosque", sale_price=250, opened_at=self.now,
                                last_settled_at=self.now, stock=48)
        Character.objects.filter(name=name).update(balance=50000)

    def test_rent_requires_a_business(self):
        Character.objects.filter(name="Kouadio").update(balance=50000)
        res = self.act("ads/rent", {"slot": "pub_place"}, zone=Q, expect=409)
        self.assertEqual(res["error"]["code"], "no_business")

    def test_rent_shows_ad_to_everyone_then_expires(self):
        self.open_kiosk()
        res = self.act("ads/rent", {"slot": "pub_place"}, zone=Q, expect=200)
        self.assertEqual(res["state"]["character"]["balance"], 50000 - rules.AD_RENTAL["price"])
        self.assertEqual(res["state"]["world"]["ads"]["pub_place"]["title"], "KIOSQUE DE KOUADIO")
        other = self.new_player()
        self.create_character(other, profile="entrepreneur", name="Mariam")
        self.open_kiosk("Mariam")
        self.assertTrue(self.state(other)["world"]["ads"]["pub_place"]["title"].startswith("KIOSQUE DE KOUADIO"))
        self.assertEqual(self.act("ads/rent", {"slot": "pub_place"}, zone=Q, client=other, expect=409)["error"]["code"], "slot_taken")
        self.advance(hours=rules.AD_RENTAL["duration_hours"] + 1)
        self.assertNotIn("pub_place", self.state(other)["world"]["ads"])
        self.act("ads/rent", {"slot": "pub_place"}, zone=Q, client=other, expect=200)
        self.assertEqual(AdCampaign.objects.get(slot="pub_place").owner.name, "Mariam")

    def test_rent_refused_on_slot_showing_a_catalog_ad(self):
        self.open_kiosk()
        res = self.act("ads/rent", {"slot": "pub_avenue_ouest"}, zone=Q, expect=409)
        self.assertEqual(res["error"]["code"], "slot_taken")
        self.assertEqual(self.char().balance, 50000)
        self.assertFalse(AdCampaign.objects.exists())

    def test_rent_follows_placement_status(self):
        self.open_kiosk()
        placements = {
            "pub_place": {"status": "reserved"},
            "pub_rue2": {"status": "disabled"},
            "pub_avenue_est": {"status": "active", "ad": "ad_absente"},
        }
        expired = dict(rules.ADVERTS["ad_maquis_bon_coin"], ends_at="2026-01-02T00:00:00Z")
        with mock.patch.dict(rules.AD_PLACEMENTS, placements), mock.patch.dict(rules.ADVERTS, {"ad_maquis_bon_coin": expired}):
            self.assertEqual(self.act("ads/rent", {"slot": "pub_place"}, zone=Q, expect=409)["error"]["code"], "slot_reserved")
            self.assertEqual(self.act("ads/rent", {"slot": "pub_rue2"}, zone=Q, expect=409)["error"]["code"], "slot_disabled")
            # Annonce introuvable : l'emplacement est libre et peut être loué.
            self.act("ads/rent", {"slot": "pub_avenue_est"}, zone=Q, expect=200)
            # Annonce de démonstration expirée : l'emplacement redevient libre.
            rules.AD_PLACEMENTS["pub_avenue_ouest"] = {"status": "active", "ad": "ad_maquis_bon_coin"}
            self.act("ads/rent", {"slot": "pub_avenue_ouest"}, zone=Q, expect=200)
        self.assertEqual(AdCampaign.objects.count(), 2)

    def test_ad_adds_passive_sales(self):
        self.open_kiosk()
        self.act("ads/rent", {"slot": "pub_rue2"}, zone=Q, expect=200)
        before = self.state()["business"]["units_sold"]
        self.advance(hours=10)
        after = self.state()["business"]["units_sold"]
        base = rules.BUSINESS_TYPES["kiosque"]["passive_units_per_hour"]
        bonus = rules.AD_RENTAL["passive_bonus_units_per_hour"]
        self.assertEqual(after - before, 10 * (base + bonus))
