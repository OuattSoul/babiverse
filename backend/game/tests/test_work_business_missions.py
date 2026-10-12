from game.models import Character, JobShift, LedgerEntry

from .base import GameTestCase


class JobMixin:
    def do_shift(self, client=None):
        res = self.act("jobs/start", {"job": "livraison"}, zone="quartier", client=client, expect=200)
        shift_id, targets = res["result"]["shift_id"], res["result"]["targets"]
        for target in targets:
            self.advance(seconds=10)
            self.act("jobs/deliver", {"shift_id": shift_id, "target": target}, zone="quartier", client=client, expect=200)
        return shift_id


class JobTests(JobMixin, GameTestCase):
    def test_full_shift_pays_wage_once(self):
        shift_id = self.do_shift()
        key = "complete-shift-1"
        res = self.act("jobs/complete", {"shift_id": shift_id}, key=key, zone="quartier", expect=200)
        self.assertEqual(res["result"]["wage"], 1200)
        self.assertEqual(res["state"]["character"]["balance"], 5200)
        # Rejeu avec la même clé, puis nouvelle clé : jamais de second paiement.
        self.act("jobs/complete", {"shift_id": shift_id}, key=key, zone="quartier", expect=200)
        res = self.act("jobs/complete", {"shift_id": shift_id}, zone="quartier", expect=409)
        self.assertEqual(res["error"]["code"], "shift_closed")
        self.assertEqual(LedgerEntry.objects.filter(kind="job_wage").count(), 1)
        self.assertEqual(res["state"]["character"]["balance"], 5200)

    def test_cannot_complete_without_deliveries_or_too_fast(self):
        res = self.act("jobs/start", {"job": "livraison"}, zone="quartier", expect=200)
        shift_id, targets = res["result"]["shift_id"], res["result"]["targets"]
        res = self.act("jobs/complete", {"shift_id": shift_id}, zone="quartier", expect=409)
        self.assertEqual(res["error"]["code"], "deliveries_missing")
        for target in targets:
            self.advance(seconds=5)
            self.act("jobs/deliver", {"shift_id": shift_id, "target": target}, zone="quartier", expect=200)
        res = self.act("jobs/complete", {"shift_id": shift_id}, zone="quartier", expect=409)
        self.assertEqual(res["error"]["code"], "too_fast")

    def test_wrong_target_and_too_fast_deliveries(self):
        res = self.act("jobs/start", {"job": "livraison"}, zone="quartier", expect=200)
        shift_id, targets = res["result"]["shift_id"], res["result"]["targets"]
        res = self.act("jobs/deliver", {"shift_id": shift_id, "target": "chez_moi"}, zone="quartier", expect=409)
        self.assertEqual(res["error"]["code"], "wrong_target")
        self.act("jobs/deliver", {"shift_id": shift_id, "target": targets[0]}, zone="quartier", expect=200)
        res = self.act("jobs/deliver", {"shift_id": shift_id, "target": targets[1]}, zone="quartier", expect=409)
        self.assertEqual(res["error"]["code"], "too_fast")

    def test_too_tired_or_too_hungry_to_work(self):
        self.set_char(energy=10)
        self.assertEqual(self.act("jobs/start", {"job": "livraison"}, zone="quartier", expect=409)["error"]["code"],
                         "too_tired")
        self.set_char(energy=80, hunger=95)
        self.assertEqual(self.act("jobs/start", {"job": "livraison"}, zone="quartier", expect=409)["error"]["code"],
                         "too_hungry")

    def test_unfinished_shift_expires_offline_without_pay(self):
        self.act("jobs/start", {"job": "livraison"}, zone="quartier", expect=200)
        self.advance(hours=5)
        state = self.state()
        self.assertIsNone(state["job"]["active"])
        self.assertEqual(state["notices"][0]["type"], "shift_expired")
        self.assertEqual(JobShift.objects.get().status, JobShift.EXPIRED)
        self.assertEqual(state["character"]["balance"], 4000)

    def test_daily_shift_limit(self):
        self.set_char(energy=100)
        for _ in range(8):
            shift_id = self.do_shift()
            self.advance(seconds=30)
            self.act("jobs/complete", {"shift_id": shift_id}, zone="quartier", expect=200)
            self.set_char(energy=100, hunger=0)
        res = self.act("jobs/start", {"job": "livraison"}, zone="quartier", expect=409)
        self.assertEqual(res["error"]["code"], "daily_limit")

    def test_artisan_wage_multiplier(self):
        client = self.new_player()
        self.create_character(client, profile="artisan", name="Yao")
        self.assertEqual(self.state(client)["job"]["wage"], 1500)


class BusinessTests(JobMixin, GameTestCase):
    def unlock_and_fund(self):
        shift_id = self.do_shift()
        self.advance(seconds=30)
        self.act("jobs/complete", {"shift_id": shift_id}, zone="quartier", expect=200)
        self.set_char(balance=20000)

    def test_business_is_locked_before_first_job(self):
        self.set_char(balance=20000)
        res = self.act("business/open", {"type": "kiosque"}, zone="quartier", expect=409)
        self.assertEqual(res["error"]["code"], "business_locked")

    def test_full_business_cycle(self):
        self.unlock_and_fund()
        res = self.act("business/open", {"type": "kiosque"}, zone="quartier", expect=200)
        self.assertEqual(res["state"]["character"]["balance"], 8000)
        self.assertEqual(self.act("business/open", {"type": "kiosque"}, zone="quartier", expect=409)["error"]["code"],
                         "already_open")
        # Vente impossible sans stock.
        self.assertEqual(self.act("business/sell", zone="quartier", expect=409)["error"]["code"], "out_of_stock")
        # Achat d'un casier à l'épicerie puis mise en rayon au kiosque.
        self.act("shop/buy", {"shop": "epicerie", "item": "casier_boissons"}, zone="epicerie", expect=200)
        res = self.act("business/restock", {"crates": 1}, zone="quartier", expect=200)
        self.assertEqual(res["state"]["business"]["stock"], 12)
        self.assertNotIn("casier_boissons", res["state"]["inventory"])
        res = self.act("business/sell", zone="quartier", expect=200)
        self.assertEqual(res["state"]["character"]["balance"], 8000 - 1800 + 250)
        self.assertEqual(self.act("business/sell", zone="quartier", expect=409)["error"]["code"], "too_fast")
        self.advance(seconds=5)
        res = self.act("business/sell", zone="quartier", expect=200)
        biz = res["state"]["business"]
        self.assertEqual((biz["stock"], biz["units_sold"], biz["revenue"]), (10, 2, 500))
        self.assertEqual(biz["profit"], 500 - 12000 - 1800)

    def test_entrepreneur_discount_and_no_unlock_needed(self):
        client = self.new_player()
        self.create_character(client, profile="entrepreneur", name="Awa")
        res = self.act("business/open", {"type": "kiosque"}, zone="quartier", client=client, expect=409)
        self.assertEqual(res["error"]["code"], "insufficient_funds")  # 9 000 F < 9 600 F
        Character.objects.filter(name="Awa").update(balance=10000)
        res = self.act("business/open", {"type": "kiosque"}, zone="quartier", client=client, expect=200)
        self.assertEqual(res["result"]["cost"], 9600)

    def test_passive_income_is_capped_at_three_days_and_by_stock(self):
        self.unlock_and_fund()
        self.act("business/open", {"type": "kiosque"}, zone="quartier", expect=200)
        self.set_char(balance=50000)
        self.act("shop/buy", {"shop": "epicerie", "item": "casier_boissons", "quantity": 4}, zone="epicerie", expect=200)
        self.act("business/restock", {"crates": 4}, zone="quartier", expect=200)  # 48 unités
        before = self.state()["character"]["balance"]
        self.advance(days=10)  # absence de 10 jours : seuls 72 h comptent -> 144 unités possibles, 48 en stock
        state = self.state()
        self.assertEqual(state["business"]["stock"], 0)
        self.assertEqual(state["character"]["balance"] - before, 48 * 250)
        self.assertEqual(state["notices"][0]["type"], "passive_income")

    def test_passive_income_cap_without_stock_limit(self):
        self.unlock_and_fund()
        self.act("business/open", {"type": "kiosque"}, zone="quartier", expect=200)
        self.set_char(balance=50000)
        self.act("shop/buy", {"shop": "epicerie", "item": "casier_boissons", "quantity": 4}, zone="epicerie", expect=200)
        self.act("business/restock", {"crates": 4}, zone="quartier", expect=200)
        before = self.state()["character"]["balance"]
        self.advance(hours=20)
        state = self.state()
        self.assertEqual(state["character"]["balance"] - before, 40 * 250)  # 2 unités/h
        self.advance(days=5)
        state2 = self.state()
        self.assertEqual(state2["business"]["stock"], 0)  # 8 restantes vendues, plafonné par le stock


class MissionTests(JobMixin, GameTestCase):
    def test_first_mission_progress_and_single_reward(self):
        missions = {m["id"]: m for m in self.state()["missions"]}
        self.assertEqual(missions["m_bienvenue"]["status"], "active")
        self.assertNotIn("m_courses", missions)
        res = self.act("missions/claim", {"mission": "m_bienvenue"}, expect=409)
        self.assertEqual(res["error"]["code"], "mission_not_completed")
        self.act("npc/talk", {"npc": "koffi"})
        res = self.act("missions/claim", {"mission": "m_bienvenue"}, key="claim-bienvenue", expect=200)
        self.assertEqual(res["state"]["character"]["balance"], 4300)
        # Rejeu et nouvelle tentative : une seule récompense.
        self.act("missions/claim", {"mission": "m_bienvenue"}, key="claim-bienvenue", expect=200)
        res = self.act("missions/claim", {"mission": "m_bienvenue"}, expect=409)
        self.assertEqual(res["error"]["code"], "already_rewarded")
        self.assertEqual(LedgerEntry.objects.filter(kind="mission_reward").count(), 1)
        missions = {m["id"]: m["status"] for m in res["state"]["missions"]}
        self.assertEqual(missions["m_courses"], "available")
        self.assertEqual(missions["m_livraison"], "available")

    def test_available_mission_does_not_progress_until_accepted(self):
        self.act("npc/talk", {"npc": "koffi"})
        self.act("missions/claim", {"mission": "m_bienvenue"}, expect=200)
        self.act("shop/buy", {"shop": "epicerie", "item": "pain"}, zone="epicerie", expect=200)
        missions = {m["id"]: m for m in self.state()["missions"]}
        self.assertEqual((missions["m_courses"]["status"], missions["m_courses"]["progress"]), ("available", 0))
        self.act("missions/accept", {"mission": "m_courses"})
        self.act("shop/buy", {"shop": "epicerie", "item": "pain"}, zone="epicerie", expect=200)
        missions = {m["id"]: m for m in self.state()["missions"]}
        self.assertEqual(missions["m_courses"]["status"], "completed")

    def test_savings_mission_completes_on_accept_if_already_rich(self):
        self.act("npc/talk", {"npc": "koffi"})
        self.act("missions/claim", {"mission": "m_bienvenue"}, expect=200)
        self.act("missions/accept", {"mission": "m_livraison"})
        shift_id = self.do_shift()
        self.advance(seconds=30)
        self.act("jobs/complete", {"shift_id": shift_id}, zone="quartier", expect=200)
        self.act("missions/claim", {"mission": "m_livraison"}, expect=200)
        self.set_char(balance=15000)
        self.act("missions/accept", {"mission": "m_epargne"})
        missions = {m["id"]: m for m in self.state()["missions"]}
        self.assertEqual(missions["m_epargne"]["status"], "completed")


class IsolationTests(JobMixin, GameTestCase):
    def test_requires_authentication(self):
        from rest_framework.test import APIClient
        anon = APIClient()
        self.assertEqual(anon.get("/api/state").status_code, 401)
        anon.credentials(HTTP_AUTHORIZATION="Bearer faux-jeton")
        self.assertEqual(anon.get("/api/state").status_code, 401)

    def test_player_cannot_touch_another_players_shift(self):
        res = self.act("jobs/start", {"job": "livraison"}, zone="quartier", expect=200)
        shift_id, target = res["result"]["shift_id"], res["result"]["targets"][0]
        other = self.new_player()
        self.create_character(other, name="Mariam")
        res = self.act("jobs/deliver", {"shift_id": shift_id, "target": target}, zone="quartier", client=other, expect=404)
        self.assertEqual(res["error"]["code"], "unknown_shift")
        self.assertEqual(JobShift.objects.get(pk=shift_id).delivered, [])

    def test_states_are_separate(self):
        other = self.new_player()
        self.create_character(other, profile="salarie", name="Mariam")
        self.act("shop/buy", {"shop": "epicerie", "item": "pain"}, zone="epicerie", expect=200)
        self.assertEqual(self.state(other)["character"]["balance"], 8000)
        self.assertEqual(self.state(other)["shops"]["epicerie"]["pain"], 20)
        # Les clés d'idempotence sont propres à chaque joueur.
        res = self.act("shop/buy", {"shop": "epicerie", "item": "pain"}, key="shared-key-1", zone="epicerie", expect=200)
        res2 = self.act("shop/buy", {"shop": "epicerie", "item": "pain"}, key="shared-key-1", zone="epicerie",
                        client=other, expect=200)
        self.assertNotIn("replayed", res2)
        self.assertNotIn("replayed", res)

    def test_character_creation_validation(self):
        client = self.new_player()
        res = client.post("/api/character", {"name": "<script>", "profile": "etudiant"}, format="json")
        self.assertEqual(res.status_code, 400)
        res = client.post("/api/character", {"name": "Aya", "profile": "ministre"}, format="json")
        self.assertEqual(res.status_code, 400)
        self.create_character(client, name="Aya")
        res = client.post("/api/character", {"name": "Aya", "profile": "etudiant"}, format="json")
        self.assertEqual(res.status_code, 409)
