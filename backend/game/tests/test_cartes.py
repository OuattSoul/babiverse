"""Non-régression des cartes : zones reconnues par le serveur et positions des joueurs.

Référence figée le 2026-10-13, avant la migration de la carte historique vers le catalogue de cartes
(shared/maps.json). Ces tests décrivent le comportement que la migration doit conserver à l'identique.
"""
import copy
import hashlib
import os
import re
import tempfile
from unittest import mock

from django.test import override_settings

from game import atelier, maps, rules
from game.models import Character, MissionState

from .base import GameTestCase

HISTORIC_ZONES = ("quartier", "maison", "epicerie")


class CartesHistoriquesTests(GameTestCase):
    def sync(self, zone, x, y):
        res = self.client.post("/api/sync", {"pos": {"zone": zone, "x": x, "y": y}}, format="json",
                               HTTP_IDEMPOTENCY_KEY=f"sync-{zone}-{x}-{y}")
        self.assertEqual(res.status_code, 200, res.content)
        return self.char()

    def test_zones_historiques_reconnues(self):
        self.assertEqual(rules.ZONES, HISTORIC_ZONES)
        for zone in (*HISTORIC_ZONES, "int_maquis", "int_pb_P03", "int_home_4"):
            self.assertTrue(rules.zone_known(zone), zone)
        for zone in ("", "Quartier", "inconnue", "int_", "int_a b", None, 3):
            self.assertFalse(rules.zone_known(zone), zone)

    def test_config_publique_inchangee(self):
        self.assertEqual(self.client.get("/api/config").json()["zones"], list(HISTORIC_ZONES))

    def test_position_conservee_dans_chaque_zone_publique(self):
        for i, zone in enumerate((*HISTORIC_ZONES, "int_maquis", "int_epicerie_inexistant")):
            char = self.sync(zone, 1234.5 + i, 2048 + i)
            self.assertEqual((char.zone, char.pos_x, char.pos_y), (zone, 1234.5 + i, 2048 + i))

    def test_zone_inconnue_ignoree_sans_effacer_la_position(self):
        self.sync("quartier", 320, 416)
        char = self.sync("ville_qui_n_existe_pas", 999, 999)
        self.assertEqual((char.zone, char.pos_x, char.pos_y), ("quartier", 320, 416))

    def test_position_absurde_effacee_mais_zone_gardee(self):
        char = self.sync("quartier", -5, 10)
        self.assertEqual((char.zone, char.pos_x, char.pos_y), ("quartier", None, None))


class CatalogueDesCartesTests(GameTestCase):
    """Catalogue shared/maps.json : la carte historique y est référencée, sans rien changer à son comportement."""

    def catalogue(self, **changes):
        cat = copy.deepcopy(maps.CATALOGUE)
        for key, value in changes.items():
            cat[key] = value
        return cat

    def test_carte_historique_referencee(self):
        self.assertEqual(maps.published_ids(), HISTORIC_ZONES)
        self.assertEqual(rules.INTERIOR_ZONE_RE.pattern, r"^int_[A-Za-z0-9_]{1,40}$")
        self.assertEqual(rules.START_ZONE, "maison")
        self.assertEqual(maps.map_info("quartier"),
                         {"id": "quartier", "district": "cite_akwaba", "city": "abidjan", "kind": "outdoor"})
        self.assertEqual(maps.map_info("int_maquis")["kind"], "interior")
        self.assertIsNone(maps.map_info("inconnue"))
        self.assertIsNone(maps.map_info(None))

    def test_catalogue_invalide_refuse(self):
        first = maps.CATALOGUE["maps"][0]
        cases = {
            "identifiant trop long": [dict(first, id="x" * 33)],
            "majuscules": [dict(first, id="Quartier")],
            "doublon": [first, first],
            "préfixe réservé": [dict(first, id="int_marche")],
            "zone inconnue": [dict(first, district="cocody")],
            "statut inconnu": [dict(first, status="en_ligne")],
            "source inconnue": [dict(first, source={"type": "script", "code": "alert(1)"})],
        }
        for label, items in cases.items():
            with self.subTest(label), self.assertRaises(maps.CatalogueError):
                maps.check_catalogue(self.catalogue(maps=items, start_map=items[0]["id"]))
        with self.assertRaises(maps.CatalogueError):
            maps.check_catalogue(self.catalogue(start_map="inconnue"))
        with self.assertRaises(maps.CatalogueError):
            maps.check_catalogue(self.catalogue(districts=[{"id": "cite_akwaba", "city": "bouake", "name": "x",
                                                            "status": "published"}]))

    def test_carte_desactivee_ignoree_sans_effacer_les_donnees(self):
        cat = copy.deepcopy(maps.CATALOGUE)
        next(m for m in cat["maps"] if m["id"] == "epicerie")["status"] = "disabled"
        self.assertEqual(maps.published_ids(cat), ("quartier", "maison"))
        self.client.post("/api/sync", {"pos": {"zone": "epicerie", "x": 160, "y": 224}}, format="json",
                         HTTP_IDEMPOTENCY_KEY="sync-avant")
        with mock.patch.object(rules, "ZONES", maps.published_ids(cat)):
            self.client.post("/api/sync", {"pos": {"zone": "epicerie", "x": 96, "y": 96}}, format="json",
                             HTTP_IDEMPOTENCY_KEY="sync-pendant")
            char = self.char()
            self.assertEqual((char.zone, char.pos_x, char.pos_y), ("epicerie", 160, 224))


GLB = b"glTF\x02\x00\x00\x00" + b"\x14\x00\x00\x00" + b"\x00" * 8  # contenu factice : le serveur ne l'interprète pas
ATELIER_PACK = {
    "format": "babiverse-game-pack", "format_version": 1, "revision": "r1", "wardrobe": {}, "parts": {},
    "maps": [
        {"id": "marche_treichville", "name": "Marché de Treichville", "version": 1,
         "city": {"id": "abidjan_sud", "name": "Abidjan Sud"}, "district": {"id": "treichville", "name": "Treichville"},
         "width": 20, "height": 16, "spawn": [10, 13], "landscapes": [], "interactives": [],
         "entrance": {"zone": "quartier", "x": 42, "y": 39, "label": "→ MARCHÉ"},
         "models": {"marche": {"media_id": "m-abc", "revision": 1, "mime": "model/gltf-binary",
                               "sha256": hashlib.sha256(GLB).hexdigest(), "bytes": len(GLB)}}},
        {"id": "port_bouet", "name": "Port-Bouët", "version": 1, "city": {"id": "abidjan_sud"}, "district": {"id": "treichville"},
         "width": 20, "height": 16, "spawn": [3, 3], "landscapes": [], "models": {}, "entrance": None,
         "interactives": [
             {"id": "ferme", "type": "door", "active": False, "target": {"zone": "marche_treichville", "spawn": "default"}},
         ]},
        {"id": "quartier", "name": "Usurpation de la carte historique"},
        {"id": "int_piege", "name": "Intérieur réservé"},
        {"id": "Mauvais Nom", "name": "Identifiant invalide"},
    ],
}


class CartesDeLAtelierTests(GameTestCase):
    """Cartes publiées par l'atelier : reconnues par le serveur, données des joueurs préservées."""

    def setUp(self):
        super().setUp()
        self.pack = copy.deepcopy(ATELIER_PACK)
        patcher = mock.patch("game.atelier.current", side_effect=lambda: self.pack)
        patcher.start()
        self.addCleanup(patcher.stop)

    def sync(self, zone, x, y, key):
        res = self.client.post("/api/sync", {"pos": {"zone": zone, "x": x, "y": y}}, format="json", HTTP_IDEMPOTENCY_KEY=key)
        self.assertEqual(res.status_code, 200, res.content)
        return self.char()

    def test_carte_publiee_reconnue_les_autres_ecartees(self):
        self.assertEqual(list(maps.atelier_maps()), ["marche_treichville", "port_bouet"])
        self.assertTrue(rules.zone_known("marche_treichville"))
        for zone in ("int_piege", "Mauvais Nom"):
            self.assertEqual(rules.zone_known(zone), zone == "int_piege")  # int_* reste un intérieur générique
        self.assertEqual(maps.map_info("marche_treichville")["city"], "abidjan_sud")
        self.assertEqual(maps.map_info("quartier")["district"], "cite_akwaba")  # le catalogue intégré a priorité

    def test_changement_de_carte_conserve_les_donnees_du_joueur(self):
        self.sync("quartier", 1360, 1264, "ville")
        before = self.state()
        char = self.sync("marche_treichville", 336, 432, "aller")
        self.assertEqual((char.zone, char.pos_x, char.pos_y), ("marche_treichville", 336, 432))
        after = self.state()
        moved = ("zone", "x", "y")  # seuls la carte et la position changent
        for key in before:
            a, b = before[key], after[key]
            if key in ("server_time", "version"):
                continue
            if isinstance(a, dict):
                a = {k: v for k, v in a.items() if k not in moved}
                b = {k: v for k, v in b.items() if k not in moved}
            self.assertEqual(a, b, key)
        self.assertEqual(self.sync("quartier", 1500, 600, "retour").zone, "quartier")
        self.assertEqual(self.state()["character"]["balance"], before["character"]["balance"])

    def test_carte_retiree_du_pack_position_conservee(self):
        self.sync("quartier", 1360, 1264, "ville")
        self.sync("marche_treichville", 336, 432, "aller")
        self.pack["maps"] = []  # carte désactivée dans l'atelier
        char = self.sync("marche_treichville", 100, 100, "ignore")
        self.assertEqual((char.zone, char.pos_x, char.pos_y), ("marche_treichville", 336, 432))

    def test_rencontres_possibles_sur_une_carte_de_l_atelier(self):
        from game.services import social
        self.assertTrue(social.shared_zone("marche_treichville"))
        self.pack["maps"] = []
        self.assertFalse(social.shared_zone("marche_treichville"))

    def test_modele_relaye_seulement_s_il_est_publie_et_intact(self):
        with tempfile.TemporaryDirectory() as d, override_settings(ATELIER_PACK_FILE=os.path.join(d, "game-pack.json")):
            atelier.reset_cache()
            model = self.pack["maps"][0]["models"]["marche"]
            os.makedirs(atelier.models_dir())
            with open(atelier.model_path(model), "wb") as f:
                f.write(GLB)
            res = self.client.get("/api/atelier/models/m-abc/1")
            self.assertEqual(res.status_code, 200)
            self.assertEqual(res.content, GLB)
            self.assertEqual(res["Content-Type"], "model/gltf-binary")
            self.assertIn("immutable", res["Cache-Control"])
            self.assertEqual(self.client.get("/api/atelier/models/m-abc/2").status_code, 404)    # révision non publiée
            self.assertEqual(self.client.get("/api/atelier/models/m-autre/1").status_code, 404)  # absent du pack
            atelier.reset_cache()
            with open(atelier.model_path(model), "wb") as f:
                f.write(GLB + b"altere")
            altered = self.client.get("/api/atelier/models/m-abc/1")
            self.assertEqual(altered.status_code, 503)    # empreinte différente : jamais servi, nouvel essai plus tard
            self.assertEqual(altered["Cache-Control"], "no-store")
            os.remove(atelier.model_path(model))
            atelier.reset_cache()
            with override_settings(ATELIER_URL=""):       # ni fichier ni atelier joignable
                gone = self.client.get("/api/atelier/models/m-abc/1")
            self.assertEqual((gone.status_code, gone["Retry-After"]), (503, "30"))
            atelier.reset_cache()


class ConnexionsEntreCartesTests(CartesDeLAtelierTests):
    """Le serveur n'accepte l'arrivée sur une carte de l'atelier que par un passage existant et autorisé."""

    def setUp(self):
        super().setUp()
        self.pack["maps"][1]["interactives"].append(
            {"id": "gbaka", "type": "door", "active": True, "mode": "transport",
             "target": {"zone": "marche_treichville", "spawn": "gare"},
             "conditions": [{"type": "mission_completed", "mission": "m_livraison"}, {"type": "min_balance", "amount": 1000}]})

    def put_in(self, zone):
        Character.objects.filter(pk=self.char().pk).update(zone=zone, pos_x=96, pos_y=96)

    def test_acces_depuis_la_ville_seulement_par_le_panneau(self):
        self.put_in("maison")
        self.assertEqual(self.sync("marche_treichville", 320, 320, "depuis-maison").zone, "maison")  # pas de passage
        self.put_in("quartier")
        self.assertEqual(self.sync("port_bouet", 96, 96, "sans-acces").zone, "quartier")  # carte sans accès en ville
        self.assertEqual(self.sync("marche_treichville", 320, 320, "panneau").zone, "marche_treichville")
        self.assertEqual(self.sync("marche_treichville", 330, 320, "sur-place").pos_x, 330)  # déplacement sur la carte

    def test_porte_avec_conditions_verifiees_par_le_serveur(self):
        self.put_in("port_bouet")
        self.set_char(balance=5000)
        self.assertEqual(self.sync("marche_treichville", 480, 416, "sans-mission").zone, "port_bouet")
        MissionState.objects.update_or_create(character=self.char(), mission_id="m_livraison",
                                           defaults={"status": "completed", "updated_at": self.now})
        self.set_char(balance=999)
        self.assertEqual(self.sync("marche_treichville", 480, 416, "pas-assez").zone, "port_bouet")
        self.set_char(balance=1000)
        char = self.sync("marche_treichville", 480, 416, "autorise")
        self.assertEqual((char.zone, char.balance), ("marche_treichville", 1000))  # aucun prélèvement

    def test_porte_desactivee_ou_condition_inconnue_refusee(self):
        self.pack["maps"][1]["interactives"] = [
            {"id": "ferme", "type": "door", "active": False, "target": {"zone": "marche_treichville"}},
            {"id": "bizarre", "type": "door", "target": {"zone": "marche_treichville"}, "conditions": [{"type": "script"}]},
        ]
        self.put_in("port_bouet")
        self.assertEqual(self.sync("marche_treichville", 480, 416, "refus").zone, "port_bouet")
        self.assertEqual(self.sync("quartier", 1360, 1264, "retour").zone, "quartier")  # revenir en ville reste permis

    def test_missions_connues_de_l_atelier_identiques_au_jeu(self):
        path = os.path.join(os.path.dirname(rules.SHARED), "babiverse-asset-studio-admin", "babiverse-studio", "backend", "app", "worldmaps.py")
        with open(path, encoding="utf-8") as f:
            text = f.read()
        block = text[text.index("GAME_MISSIONS = ("):text.index(")", text.index("GAME_MISSIONS = ("))]
        self.assertEqual(sorted(re.findall(r'"(m_[a-z0-9_]+)"', block)), sorted(m["id"] for m in rules.MISSIONS))


class SecuriteDuContenuDeLAtelierTests(CartesDeLAtelierTests):
    """Un joueur ne peut rien modifier du monde depuis le jeu : seules des lectures du contenu publié existent."""

    def test_routes_de_l_atelier_en_lecture_seule(self):
        for url in ("/api/atelier/pack", "/api/atelier/models/m-abc/1"):
            for method in ("post", "put", "patch", "delete"):
                self.assertEqual(getattr(self.client, method)(url, {}, format="json").status_code, 405, (method, url))

    def test_identifiants_pieges_refuses(self):
        for url in ("/api/atelier/models/..%2F..%2Fconfig%2Fsettings/1", "/api/atelier/models/m-abc;ls/1",
                    "/api/atelier/models/m-abc/-1", "/api/atelier/models/" + "x" * 80 + "/1"):
            self.assertEqual(self.client.get(url).status_code, 404, url)

    def test_aucune_route_d_ecriture_du_monde_dans_le_jeu(self):
        from game.urls import urlpatterns
        routes = [str(p.pattern) for p in urlpatterns]
        self.assertFalse([r for r in routes if r.startswith(("world", "maps", "game/maps"))], routes)


class OrdreDesPositionsTests(GameTestCase):
    """Une position envoyée avant un changement de zone mais arrivée après ne ramène pas le joueur en arrière."""

    def send(self, zone, t=None, c="onglet-a", path="sync"):
        pos = {"zone": zone, "x": 100, "y": 100}
        if t is not None:
            pos.update(t=t, c=c)
        res = self.client.post(f"/api/{path}", {"pos": pos}, format="json", HTTP_IDEMPOTENCY_KEY=f"k-{zone}-{t}-{c}")
        self.assertEqual(res.status_code, 200, res.content)
        return self.char().zone

    def test_position_perimee_ignoree(self):
        self.assertEqual(self.send("quartier", t=1000), "quartier")
        self.assertEqual(self.send("epicerie", t=3000), "epicerie")
        self.assertEqual(self.send("quartier", t=2000), "epicerie")   # partie avant, arrivée après : ignorée
        self.assertEqual(self.send("quartier", t=4000), "quartier")

    def test_autre_onglet_et_anciens_clients_acceptes(self):
        self.send("epicerie", t=5000)
        self.assertEqual(self.send("quartier", t=10, c="onglet-b"), "quartier")  # autre onglet ou appareil
        self.assertEqual(self.send("maison"), "maison")                          # sans horodatage : comme avant

    def test_rencontres_soumises_au_meme_ordre(self):
        self.send("epicerie", t=3000)
        self.client.post("/api/social/poll", {"pos": {"zone": "quartier", "x": 1, "y": 1, "t": 2000, "c": "onglet-a"}}, format="json")
        self.assertEqual(self.char().zone, "epicerie")
