from game.models import IdempotencyRecord, InventoryItem, LedgerEntry, ShopStock

from .base import GameTestCase


class PurchaseTests(GameTestCase):
    def test_purchase_updates_balance_inventory_stock_and_ledger(self):
        res = self.act("shop/buy", {"shop": "epicerie", "item": "pain", "quantity": 2}, zone="epicerie", expect=200)
        self.assertTrue(res["ok"])
        state = res["state"]
        self.assertEqual(state["character"]["balance"], 4000 - 300)
        self.assertEqual(state["inventory"]["pain"], 2 + 2)  # 2 pains de départ (étudiant)
        self.assertEqual(state["shops"]["epicerie"]["pain"], 20 - 2)
        entry = LedgerEntry.objects.filter(kind="purchase").get()
        self.assertEqual((entry.amount, entry.balance_after), (-300, 3700))

    def test_insufficient_funds_is_refused_without_side_effects(self):
        res = self.act("shop/buy", {"shop": "epicerie", "item": "casier_boissons", "quantity": 3},
                       zone="epicerie", expect=409)
        self.assertEqual(res["error"]["code"], "insufficient_funds")
        self.assertEqual(res["state"]["character"]["balance"], 4000)
        self.assertNotIn("casier_boissons", res["state"]["inventory"])
        self.assertEqual(res["state"]["shops"]["epicerie"]["casier_boissons"], 5)
        self.assertFalse(LedgerEntry.objects.filter(kind="purchase").exists())

    def test_invalid_quantity_and_unknown_product(self):
        for qty in (0, -1, 21, "3", 1.5, True):
            res = self.act("shop/buy", {"shop": "epicerie", "item": "pain", "quantity": qty}, zone="epicerie", expect=400)
            self.assertEqual(res["error"]["code"], "invalid_quantity", qty)
        res = self.act("shop/buy", {"shop": "epicerie", "item": "garba"}, zone="epicerie", expect=400)
        self.assertEqual(res["error"]["code"], "unknown_product")

    def test_purchase_requires_being_in_the_shop(self):
        res = self.act("shop/buy", {"shop": "epicerie", "item": "pain"}, zone="quartier", expect=409)
        self.assertEqual(res["error"]["code"], "wrong_zone")

    def test_out_of_stock_then_daily_restock(self):
        self.set_char(balance=100000)
        self.act("shop/buy", {"shop": "epicerie", "item": "casier_boissons", "quantity": 5}, zone="epicerie", expect=200)
        res = self.act("shop/buy", {"shop": "epicerie", "item": "casier_boissons"}, zone="epicerie", expect=409)
        self.assertEqual(res["error"]["code"], "out_of_stock")
        self.advance(days=1)
        res = self.act("shop/buy", {"shop": "epicerie", "item": "casier_boissons"}, zone="epicerie", expect=200)
        self.assertEqual(res["state"]["shops"]["epicerie"]["casier_boissons"], 4)

    def test_repeated_request_is_not_charged_twice(self):
        body = {"shop": "epicerie", "item": "pain", "quantity": 1}
        first = self.act("shop/buy", body, key="same-key-123", zone="epicerie", expect=200)
        second = self.act("shop/buy", body, key="same-key-123", zone="epicerie", expect=200)
        self.assertTrue(second["replayed"])
        self.assertEqual(second["result"], first["result"])
        self.assertEqual(second["state"]["character"]["balance"], 4000 - 150)
        self.assertEqual(InventoryItem.objects.get(item_id="pain").quantity, 3)
        self.assertEqual(LedgerEntry.objects.filter(kind="purchase").count(), 1)
        self.assertEqual(ShopStock.objects.get(item_id="pain").quantity, 19)

    def test_reusing_a_key_for_another_request_is_rejected(self):
        self.act("shop/buy", {"shop": "epicerie", "item": "pain"}, key="reused-key-1", zone="epicerie", expect=200)
        res = self.act("shop/buy", {"shop": "epicerie", "item": "cafe_touba"}, key="reused-key-1",
                       zone="epicerie", expect=409)
        self.assertEqual(res["error"]["code"], "idempotency_conflict")

    def test_refused_request_replays_the_refusal(self):
        body = {"shop": "epicerie", "item": "casier_boissons", "quantity": 3}
        self.act("shop/buy", body, key="refused-key", zone="epicerie", expect=409)
        self.set_char(balance=100000)
        res = self.act("shop/buy", body, key="refused-key", zone="epicerie", expect=409)
        self.assertTrue(res["replayed"])
        self.assertEqual(IdempotencyRecord.objects.count(), 1)

    def test_idempotency_key_is_required(self):
        res = self.client.post("/api/shop/buy", {"shop": "epicerie", "item": "pain"}, format="json")
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.json()["error"]["code"], "idempotency_key_required")


class ConsumeAndRestTests(GameTestCase):
    def test_eating_reduces_hunger_and_removes_item(self):
        self.set_char(hunger=50)
        res = self.act("items/consume", {"item": "pain"}, expect=200)
        self.assertEqual(res["state"]["character"]["hunger"], 35)
        self.assertEqual(res["state"]["inventory"]["pain"], 1)

    def test_cannot_eat_what_you_do_not_have_or_is_not_food(self):
        res = self.act("items/consume", {"item": "garba"}, expect=409)
        self.assertEqual(res["error"]["code"], "missing_item")
        res = self.act("items/consume", {"item": "cahier"}, expect=400)
        self.assertEqual(res["error"]["code"], "not_consumable")

    def test_hunger_never_goes_below_zero(self):
        self.set_char(hunger=5)
        res = self.act("items/consume", {"item": "pain"}, expect=200)
        self.assertEqual(res["state"]["character"]["hunger"], 0)

    def test_rest_restores_energy_at_home_with_cooldown(self):
        self.set_char(energy=30)
        res = self.act("rest", zone="maison", expect=200)
        self.assertEqual(res["state"]["character"]["energy"], 75)
        res = self.act("rest", zone="maison", expect=409)
        self.assertEqual(res["error"]["code"], "rest_cooldown")
        self.advance(seconds=91)
        res = self.act("rest", zone="maison", expect=200)
        self.assertEqual(res["state"]["character"]["energy"], 100)  # borné à 100

    def test_rest_outside_home_is_refused(self):
        res = self.act("rest", zone="quartier", expect=409)
        self.assertEqual(res["error"]["code"], "wrong_zone")
