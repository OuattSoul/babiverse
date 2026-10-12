"""Contenu de l'atelier d'assets : lecture du pack, apparence composée à la création du personnage."""
import io
import json
import tempfile
from pathlib import Path
from unittest import mock

from django.core.management import call_command
from django.test import override_settings
from rest_framework.test import APIClient

from game import atelier
from game.models import Character

from .base import GameTestCase, register


def entry(pid, slot, **kw):
    return {"id": pid, "key": f"{pid}@1", "name": pid, "slot": slot, "bodies": [], "palette": {}, "default_colors": {},
            "channels": ["primary"], **kw}


PACK = {
    "format": "babiverse-game-pack", "format_version": 1, "revision": "abc123", "frame": [0, 0, 200, 380],
    "parts": {}, "inhabitants": [], "npcs": [], "home": None,
    "wardrobe": {
        "bodies": [entry("corps-h", "body", gender="male"), entry("corps-f", "body", gender="female")],
        "slots": {
            "hair": [entry("afro", "hair", game_hint="afro"), entry("chignon", "hair", bodies=["corps-f"], game_hint="short")],
            "top": [entry("tshirt", "top", default_colors={"primary": "#2980b9"})],
            "bottom": [entry("jean", "bottom"), entry("pagne", "bottom", palette={"primary": ["#e67e22", "#c0392b"]})],
            "shoes": [entry("baskets", "shoes"), entry("talons", "shoes", genders=["female"])],
            "dress": [entry("robe", "dress", genders=["female"])],
            "headwear": [entry("casquette", "headwear")],
            "makeup": [entry("rouge", "makeup", genders=["female"])],
            "beard": [entry("barbe", "beard", genders=["male"])],
        },
        "face": {"corps-h": {"eyes": "yeux", "eyebrows": "sourcils", "nose": "nez", "mouth": "bouche"},
                 "corps-f": {"eyes": "yeux", "eyebrows": None, "nose": "nez", "mouth": "bouche"}},
        "skin_tones": ["#f1c27d", "#8d5524", "#3f2716"], "hair_colors": ["#111111", "#b0b0b0"],
        "cloth_colors": ["#e67e22"],
    },
}


class AtelierBase(GameTestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.file = str(Path(self.tmp.name) / "game-pack.json")
        ov = override_settings(ATELIER_URL="", ATELIER_PACK_FILE=self.file, ATELIER_CACHE_S=0)
        ov.enable()
        self.addCleanup(ov.disable)
        atelier.reset_cache()
        self.addCleanup(atelier.reset_cache)
        super().setUp()

    def write_pack(self, pack=PACK):
        Path(self.file).write_text(json.dumps(pack), encoding="utf-8")
        atelier.reset_cache()

    def new_char(self, studio, name="Mariam"):
        client = APIClient()
        register(client)
        res = client.post("/api/character", {"name": name, "profile": "etudiant",
                                             "appearance": {"skin": "#c68642", "studio": studio}}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        return res.json()["state"]["character"]["appearance"]

class AtelierPackTests(AtelierBase):
    def test_pack_endpoint_open_and_cached_by_revision(self):
        self.assertIsNone(APIClient().get("/api/atelier/pack").json()["pack"])
        self.write_pack()
        res = APIClient().get("/api/atelier/pack")
        self.assertEqual(res.json()["pack"]["revision"], "abc123")
        self.assertEqual(res["ETag"], '"abc123"')
        self.assertEqual(APIClient().get("/api/atelier/pack", HTTP_IF_NONE_MATCH='"abc123"').status_code, 304)
        # fichier d'un autre format : ignoré
        self.write_pack({"format": "autre"})
        self.assertIsNone(APIClient().get("/api/atelier/pack").json()["pack"])

    def test_studio_look_is_validated_and_gets_face_and_fallback(self):
        self.write_pack()
        look = self.new_char({"body": "corps-f", "skin": "#3f2716", "hair_color": "#b0b0b0", "layers": {
            "hair": {"part": "chignon", "colors": {}},
            "top": {"part": "tshirt", "colors": {"primary": "#C0392B", "accent": "pas-une-couleur", "x": "#ffffff"}},
            "bottom": {"part": "pagne", "colors": {"primary": "#c0392b"}},
            "shoes": {"part": "baskets"},
        }})
        s = look["studio"]
        self.assertEqual(s["body"], "corps-f")
        self.assertEqual(s["skin"], "#3f2716")
        self.assertEqual(s["layers"]["top"]["colors"], {"primary": "#c0392b"})
        self.assertEqual(s["layers"]["bottom"]["colors"], {"primary": "#c0392b"})
        self.assertEqual(s["layers"]["eyes"]["part"], "yeux")
        self.assertNotIn("eyebrows", s["layers"])
        # repli vers l'apparence 3D d'origine : couleurs les plus proches
        self.assertEqual(look["skin"], "#5c3a1e")
        self.assertEqual(look["outfit"], "#c0392b")
        self.assertEqual(look["hair"], "short")

    def test_invalid_choices_are_dropped(self):
        self.write_pack()
        look = self.new_char({"body": "corps-h", "skin": "#123456", "layers": {
            "hair": {"part": "chignon"},  # réservé à la silhouette féminine
            "top": {"part": "tshirt"},
            "bottom": {"part": "pagne", "colors": {"primary": "#00ff00"}},  # hors palette
            "shoes": {"part": "inconnu"},
        }})
        s = look["studio"]
        self.assertEqual(s["skin"], "#f1c27d")
        self.assertNotIn("hair", s["layers"])
        self.assertNotIn("shoes", s["layers"])
        self.assertEqual(s["layers"]["bottom"]["colors"], {})
        self.assertEqual(look["hair"], "bald")
        self.assertEqual(look["outfit"], "#2980b9")  # couleur par défaut du t-shirt

    def test_incomplete_or_unknown_look_keeps_classic_appearance(self):
        self.write_pack()
        look = self.new_char({"body": "corps-h", "layers": {"top": {"part": "tshirt"}}})
        self.assertNotIn("studio", look)
        look = self.new_char({"body": "inconnu", "layers": {"top": {"part": "tshirt"}, "bottom": {"part": "jean"}}}, name="Awa")
        self.assertNotIn("studio", look)
        self.assertEqual(look["skin"], "#c68642")

    def test_accessories_kept_and_gender_reserved_parts_dropped(self):
        self.write_pack()
        look = self.new_char({"body": "corps-h", "layers": {
            "top": {"part": "tshirt"}, "bottom": {"part": "jean"}, "headwear": {"part": "casquette"},
            "beard": {"part": "barbe"}, "makeup": {"part": "rouge"}, "shoes": {"part": "talons"},  # réservés aux femmes
        }})
        layers = look["studio"]["layers"]
        self.assertEqual(layers["headwear"]["part"], "casquette")
        self.assertEqual(layers["beard"]["part"], "barbe")
        self.assertNotIn("makeup", layers)
        self.assertNotIn("shoes", layers)
        look = self.new_char({"body": "corps-f", "layers": {
            "dress": {"part": "robe"}, "top": {"part": "tshirt"}, "makeup": {"part": "rouge"},
            "shoes": {"part": "talons"}, "beard": {"part": "barbe"},  # réservée aux hommes
        }}, name="Awa")
        layers = look["studio"]["layers"]
        # une robe suffit (elle remplace haut et bas)
        self.assertEqual(layers["dress"]["part"], "robe")
        self.assertNotIn("top", layers)
        self.assertEqual(layers["makeup"]["part"], "rouge")
        self.assertEqual(layers["shoes"]["part"], "talons")
        self.assertNotIn("beard", layers)
        # une robe portée par une silhouette masculine est écartée : sans haut ni bas, apparence classique
        look = self.new_char({"body": "corps-h", "layers": {"dress": {"part": "robe"}}}, name="Yao")
        self.assertNotIn("studio", look)

    def test_without_pack_studio_look_is_ignored(self):
        look = self.new_char({"body": "corps-h", "layers": {"top": {"part": "tshirt"}, "bottom": {"part": "jean"}}})
        self.assertNotIn("studio", look)

    def test_live_atelier_preferred_and_last_pack_kept_when_it_stops(self):
        self.write_pack()
        live = {**PACK, "revision": "live"}
        with override_settings(ATELIER_URL="http://atelier.test"), mock.patch.object(atelier, "fetch", return_value=live):
            self.assertEqual(atelier.current()["revision"], "live")
        with override_settings(ATELIER_URL="http://atelier.test"), mock.patch.object(atelier, "fetch", return_value=None):
            self.assertEqual(atelier.current()["revision"], "live")
        atelier.reset_cache()
        with override_settings(ATELIER_URL="http://atelier.test"), mock.patch.object(atelier, "fetch", return_value=None):
            self.assertEqual(atelier.current()["revision"], "abc123")

    def test_sync_command_writes_file(self):
        with override_settings(ATELIER_URL="http://atelier.test"), mock.patch.object(atelier, "fetch", return_value=PACK):
            call_command("sync_atelier", stdout=io.StringIO())
        self.assertEqual(json.loads(Path(self.file).read_text(encoding="utf-8"))["revision"], "abc123")
        self.assertTrue(Character.objects.exists())


class ChangeAppearanceTests(AtelierBase):
    """Changement d'apparence après la création (route d'action, idempotente)."""

    STUDIO = {"body": "corps-h", "skin": "#8d5524", "layers": {"top": {"part": "tshirt", "colors": {"primary": "#e67e22"}},
                                                               "bottom": {"part": "jean"}, "hair": {"part": "afro"}}}

    def test_player_can_switch_to_studio_look_and_back(self):
        self.write_pack()
        before = self.char().balance
        res = self.act("character/appearance", {"appearance": {"studio": self.STUDIO}}, expect=200)
        look = res["state"]["character"]["appearance"]
        self.assertEqual(look["studio"]["layers"]["hair"]["part"], "afro")
        self.assertEqual(look["hair"], "afro")
        self.assertEqual(self.char().appearance["studio"]["body"], "corps-h")
        self.assertEqual(self.char().balance, before)  # gratuit
        # retour à l'apparence classique
        res = self.act("character/appearance", {"appearance": {"skin": "#f1c27d", "outfit": "#27ae60", "hair": "bald"}}, expect=200)
        self.assertEqual(res["state"]["character"]["appearance"], {"skin": "#f1c27d", "outfit": "#27ae60", "hair": "bald"})

    def test_unavailable_studio_look_is_refused_and_keeps_current(self):
        self.write_pack()
        current = self.char().appearance
        res = self.act("character/appearance", {"appearance": {"studio": {**self.STUDIO, "body": "disparu"}}}, expect=400)
        self.assertEqual(res["error"]["code"], "invalid_appearance")
        self.act("character/appearance", {"appearance": {}}, expect=400)
        self.assertEqual(self.char().appearance, current)

    def test_replay_with_same_key_is_idempotent(self):
        self.write_pack()
        body = {"appearance": {"studio": self.STUDIO}}
        first = self.act("character/appearance", body, key="test-key-look-000001", expect=200)
        again = self.act("character/appearance", body, key="test-key-look-000001", expect=200)
        self.assertTrue(again.get("replayed"))
        self.assertEqual(first["state"]["version"], again["state"]["version"])
