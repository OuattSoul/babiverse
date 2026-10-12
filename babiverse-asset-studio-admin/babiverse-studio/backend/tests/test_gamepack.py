"""Pack de jeu : garde-robe, habitants qui remplacent les PNJ, intérieur de la maison, accès du serveur du jeu."""
import copy

from .conftest import Api

GAME_KEY = {"X-Babiverse-Game-Key": "babiverse-dev"}


def test_game_pack_access(api: Api):
    assert api.c.get("/api/runtime/game-pack").status_code == 401
    assert api.c.get("/api/runtime/game-pack", headers={"X-Babiverse-Game-Key": "mauvaise"}).status_code == 401
    assert api.get("joueur", "/api/runtime/game-pack").status_code == 403
    pack = api.c.get("/api/runtime/game-pack", headers=GAME_KEY).json()
    assert pack["format"] == "babiverse-game-pack" and pack["format_version"] == 1
    assert api.get("editeur", "/api/runtime/game-pack").status_code == 200


def test_wardrobe_lists_published_parts_with_face_defaults(api: Api):
    pack = api.c.get("/api/runtime/game-pack", headers=GAME_KEY).json()
    w = pack["wardrobe"]
    assert len(w["bodies"]) == 2
    assert {"hair", "top", "bottom", "shoes"} <= set(w["slots"])
    assert all(w["slots"][s] for s in ("hair", "top", "bottom", "shoes"))
    for e in [*w["bodies"], *[x for s in w["slots"].values() for x in s]]:
        assert e["key"] in pack["parts"], e["name"]
        assert pack["parts"][e["key"]]["front"] or pack["parts"][e["key"]]["back"]
    for b in w["bodies"]:
        face = w["face"][b["id"]]
        assert all(face[s] for s in ("eyes", "eyebrows", "nose", "mouth"))
    assert all(h["game_hint"] in ("short", "afro", "braids", "bald", None) for h in w["slots"]["hair"])


def test_wardrobe_exposes_accessories_and_genders(api: Api):
    """Tout ce qui se porte (robes, accessoires, maquillage…) avec le genre des silhouettes et des composants réservés."""
    w = api.c.get("/api/runtime/game-pack", headers=GAME_KEY).json()["wardrobe"]
    assert {b["gender"] for b in w["bodies"]} == {"male", "female"}
    assert all(w["slots"][s] for s in ("dress", "headwear", "jewelry", "bag", "beard", "makeup"))
    every = [x for s in w["slots"].values() for x in s]
    assert all(set(e["genders"]) <= {"male", "female"} for e in every)
    assert all(e["genders"] == ["female"] for e in w["slots"]["makeup"])
    assert all(e["genders"] == ["male"] for e in w["slots"]["beard"])
    # le visage par défaut respecte le genre de la silhouette
    by_id = {e["id"]: e for s in w["face_parts"].values() for e in s}
    for b in w["bodies"]:
        for pid in w["face"][b["id"]].values():
            assert not by_id[pid]["genders"] or b["gender"] in by_id[pid]["genders"]


def test_inhabitants_replace_npcs_automatically_and_by_choice(api: Api):
    pack = api.c.get("/api/runtime/game-pack", headers=GAME_KEY).json()
    by_tech = {x["technical_name"]: x for x in pack["inhabitants"]}
    assert {"habitant-kouadio", "habitante-awa", "habitant-yao"} <= set(by_tech)
    # assez de PNJ pour tous les habitants de départ : chacun en remplace un
    assert all(x["npc"] for x in pack["inhabitants"])
    npcs = {n["id"]: n["inhabitant"] for n in pack["npcs"]}
    assert len([a for a in npcs.values() if a]) == len(pack["inhabitants"])
    for x in pack["inhabitants"]:
        assert x["character"]["body"] in pack["parts"]
        assert all(layer["part"] in pack["parts"] for layer in x["character"]["layers"].values())
        assert set(x["appearance"]) == {"skin", "outfit", "hair"}

    yao = by_tech["habitant-yao"]["asset_id"]
    r = api.put("publieur", "/api/game/settings", {"npcs": {"koffi": yao, "aya": "keep"}})
    assert r.status_code == 200, r.text
    assert r.json()["resolved"]["koffi"] == yao and r.json()["resolved"]["aya"] is None
    pack = api.c.get("/api/runtime/game-pack", headers=GAME_KEY).json()
    assert {x["technical_name"]: x["npc"] for x in pack["inhabitants"]}["habitant-yao"] == "koffi"
    # contrôles : PNJ inconnu, doublon, non-personnage, droits
    assert api.put("publieur", "/api/game/settings", {"npcs": {"inconnu": yao}}).status_code == 422
    assert api.put("publieur", "/api/game/settings", {"npcs": {"koffi": yao, "fatou": yao}}).status_code == 422
    assert api.put("publieur", "/api/game/settings", {"npcs": {"koffi": api.by_tech("interieur-studio-base")["id"]}}).status_code == 422
    assert api.put("editeur", "/api/game/settings", {"npcs": {}}).status_code == 403


def test_extra_inhabitants_roam_when_enabled(api: Api):
    r = api.put("publieur", "/api/game/settings", {"npcs": {n: "keep" for n in ("koffi", "aya", "fofana", "adjoua", "diabate", "ibrahim",
                                                                             "seydou", "fatou", "awa", "kouassi", "bamba")}})
    assert r.status_code == 200
    pack = api.c.get("/api/runtime/game-pack", headers=GAME_KEY).json()
    assert all(x["npc"] is None and x["roams"] for x in pack["inhabitants"])
    api.put("publieur", "/api/game/settings", {"extra_inhabitants": False})
    pack = api.c.get("/api/runtime/game-pack", headers=GAME_KEY).json()
    assert not any(x["roams"] for x in pack["inhabitants"])


def test_home_interior_selection(api: Api):
    assert api.c.get("/api/runtime/game-pack", headers=GAME_KEY).json()["home"] is None
    studio = api.by_tech("interieur-studio-base")["id"]
    r = api.put("publieur", "/api/game/settings", {"home_interior": studio})
    assert r.status_code == 200 and r.json()["home"]["name"]
    home = api.c.get("/api/runtime/game-pack", headers=GAME_KEY).json()["home"]
    assert home["asset_id"] == studio
    assert any(f["action"] == "sleep" for f in home["interior"]["furniture"])
    assert all(f["item"] in home["furniture"] and home["furniture"][f["item"]]["shape"] for f in home["interior"]["furniture"])
    # un bâtiment n'est pas un intérieur
    building = next(a for a in api.get("admin", "/api/assets").json() if a["family"] == "building")
    assert api.put("publieur", "/api/game/settings", {"home_interior": building["id"]}).status_code == 422
    assert api.put("publieur", "/api/game/settings", {"home_interior": ""}).json()["home"] is None


def test_publish_generated_inhabitants_in_bulk(api: Api):
    awa = api.detail(api.by_tech("habitante-awa")["id"])
    src = api.get("admin", f"/api/assets/{awa['id']}/versions/{awa['published_version']}").json()["definition"]
    d = copy.deepcopy(src)
    d["name"] = "Habitante générée"
    r = api.post("editeur", "/api/assets", {"category": "characters", "technical_name": "habitante-generee", "definition": d})
    assert r.status_code == 201, r.text
    view = api.get("publieur", "/api/game/settings").json()
    assert view["drafts"] >= 1
    assert api.post("editeur", "/api/game/publish-inhabitants", {}).status_code == 403
    res = api.post("publieur", "/api/game/publish-inhabitants", {}).json()
    assert "habitante-generee" in res["published"] and not res["failed"]
    pack = api.c.get("/api/runtime/game-pack", headers=GAME_KEY).json()
    gen = {x["technical_name"]: x for x in pack["inhabitants"]}["habitante-generee"]
    # le dernier habitant ajouté remplace un PNJ en priorité
    assert gen["npc"] is not None


def test_newest_inhabitants_replace_npcs_first():
    from app.gamepack import NPC_IDS, assign_npcs
    settings = {"npcs": {}, "home_interior": "", "extra_inhabitants": True}
    newest = [{"id": f"new{i}", "name": f"N{i}", "silhouette": "f" if i % 2 else "m"} for i in range(11)]
    old = [{"id": f"old{i}", "name": f"O{i}", "silhouette": "m"} for i in range(5)]
    out = assign_npcs(settings, newest + old)
    assert set(out.values()) == {x["id"] for x in newest}
    assert set(out) == set(NPC_IDS)
    # choix explicite et « garder » respectés
    out = assign_npcs({**settings, "npcs": {"koffi": "old1", "aya": "keep"}}, newest + old)
    assert out["koffi"] == "old1" and out["aya"] is None
    assert "new10" not in out.values() and "new0" in out.values()
