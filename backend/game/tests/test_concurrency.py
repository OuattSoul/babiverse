"""Requêtes simultanées : ni double dépense, ni double paiement.

Sur SQLite les écritures sont sérialisées par le verrou de la base ; sur PostgreSQL par
`select_for_update` sur la ligne du personnage. Ce test passe dans les deux cas.
"""
import threading

from django.db import connection
from django.test import TransactionTestCase
from rest_framework.test import APIClient

from game.models import Character, InventoryItem, LedgerEntry
from game.auth import create_player


class ConcurrencyTests(TransactionTestCase):
    def setUp(self):
        client = APIClient()
        self.token = create_player()[1]
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.token}")
        client.post("/api/character", {"name": "Kouadio", "profile": "etudiant"}, format="json")

    def _parallel(self, keys):
        statuses = []

        def worker(key):
            client = APIClient()
            client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.token}")
            res = client.post("/api/shop/buy", {"shop": "epicerie", "item": "casier_boissons",
                                                "pos": {"zone": "epicerie", "x": 100, "y": 100}},
                              format="json", HTTP_IDEMPOTENCY_KEY=key)
            statuses.append(res.status_code)
            connection.close()

        threads = [threading.Thread(target=worker, args=(k,)) for k in keys]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        return statuses

    def test_parallel_purchases_never_overspend(self):
        # 4 000 F permettent 2 casiers à 1 800 F ; 6 requêtes simultanées.
        statuses = self._parallel([f"parallel-key-{i}" for i in range(6)])
        char = Character.objects.get()
        self.assertEqual(statuses.count(200), 2, statuses)
        self.assertEqual(char.balance, 400)
        self.assertEqual(InventoryItem.objects.get(item_id="casier_boissons").quantity, 2)
        self.assertEqual(LedgerEntry.objects.filter(kind="purchase").count(), 2)

    def test_parallel_replays_of_one_request_charge_once(self):
        statuses = self._parallel(["same-key-parallel"] * 5)
        char = Character.objects.get()
        self.assertTrue(all(s == 200 for s in statuses), statuses)
        self.assertEqual(char.balance, 2200)
        self.assertEqual(LedgerEntry.objects.filter(kind="purchase").count(), 1)


class PlotConcurrencyTests(TransactionTestCase):
    def test_two_players_buying_the_same_plot(self):
        tokens = []
        for name in ("Kouadio", "Mariam", "Yao"):
            client = APIClient()
            token = create_player()[1]
            client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
            client.post("/api/character", {"name": name, "profile": "etudiant"}, format="json")
            tokens.append(token)
        Character.objects.update(balance=100000)
        statuses = []

        def worker(token):
            client = APIClient()
            client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
            res = client.post("/api/plots/buy", {"plot": "P04", "pos": {"zone": "quartier", "x": 100, "y": 100}},
                              format="json", HTTP_IDEMPOTENCY_KEY=f"plot-race-{token[:8]}")
            statuses.append(res.status_code)
            connection.close()

        threads = [threading.Thread(target=worker, args=(t,)) for t in tokens]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        from game.models import PlotClaim
        self.assertEqual(sorted(statuses), [200, 409, 409])
        self.assertEqual(PlotClaim.objects.count(), 1)
        # Seul l'acheteur a été débité.
        self.assertEqual(sorted(Character.objects.values_list("balance", flat=True)), [85000, 100000, 100000])


class CharacterCreationConcurrencyTests(TransactionTestCase):
    def test_same_player_creating_twice_at_once_gets_409(self):
        # Double appui sur « Créer » : une création réussit, les autres reçoivent un 409 propre.
        token = create_player()[1]
        statuses = []

        def worker(i):
            client = APIClient()
            client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
            res = client.post("/api/character", {"name": f"Kouadio {i}", "profile": "etudiant"}, format="json")
            statuses.append(res.status_code)
            connection.close()

        threads = [threading.Thread(target=worker, args=(i,)) for i in range(4)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        from game.models import Home
        self.assertEqual(sorted(statuses), [201, 409, 409, 409])
        self.assertEqual(Character.objects.count(), 1)
        self.assertEqual(Home.objects.count(), 1)
        self.assertEqual(LedgerEntry.objects.filter(kind="start").count(), 1)


class HomeConcurrencyTests(TransactionTestCase):
    def test_simultaneous_newcomers_get_distinct_houses(self):
        tokens = [create_player()[1] for _ in range(6)]
        statuses = []

        def worker(i, token):
            client = APIClient()
            client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
            res = client.post("/api/character", {"name": f"Joueur {i}", "profile": "etudiant"}, format="json")
            statuses.append(res.status_code)
            connection.close()

        threads = [threading.Thread(target=worker, args=(i, t)) for i, t in enumerate(tokens)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        from game.models import Home
        created = statuses.count(201)
        self.assertGreater(created, 0, statuses)
        # Chaque personnage créé a exactement une maison, et aucune n'en partage l'emplacement.
        self.assertEqual(Character.objects.count(), created)
        self.assertEqual(Home.objects.count(), created)
        self.assertEqual(len(set(Home.objects.values_list("slot", flat=True))), created)
        self.assertEqual(Home.objects.filter(player__character__isnull=True).count(), 0)
