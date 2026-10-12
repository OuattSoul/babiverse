"""Carte du jeu : éléments publiés placés par l'administrateur, transmis au jeu dans le pack."""
from .conftest import Api

GAME_KEY = {"X-Babiverse-Game-Key": "babiverse-dev"}


def pack(api: Api):
    return api.c.get("/api/runtime/game-pack", headers=GAME_KEY).json()


def asset(api: Api, tech: str) -> dict:
    return next(a for a in api.get("publieur", "/api/game/placements").json()["assets"] if a["technical_name"] == tech)


def test_placeable_assets_are_published_buildings_props_vehicles_surfaces(api: Api):
    view = api.get("lecteur", "/api/game/placements").json()
    assert view["placements"] == []
    families = {a["family"] for a in view["assets"]}
    assert families <= {"building", "prop", "vehicle", "surface"} and "building" in families
    assert all(a["definition"]["name"] for a in view["assets"])


def test_place_building_with_footprint_and_orientation(api: Api):
    b = asset(api, "maison-moderne-etage")
    r = api.post("publieur", "/api/game/placements", {"asset_id": b["id"], "x": 60, "y": 5, "facing": "E"})
    assert r.status_code == 201, r.text
    p = r.json()["placements"][0]
    assert (p["w"], p["h"]) == (b["d"], b["w"]) and p["facing"] == "E" and p["id"].startswith("atl_")
    assert p["name"] == b["name"] and p["available"]
    placed = pack(api)["placements"]
    assert len(placed) == 1
    render = placed[0]["render"]
    assert render["floors"] == 2 and render["style"]["roof"] == "hip" and render["materials"]["wall"]
    # l'intérieur associé au bâtiment voyage avec lui (plan + meubles)
    assert render["interior"]["interior"]["rooms"] and render["interior"]["furniture"]


def test_overlap_and_invalid_requests_are_refused(api: Api):
    b = asset(api, "boutique-quartier")
    assert api.post("publieur", "/api/game/placements", {"asset_id": b["id"], "x": 60, "y": 5}).status_code == 201
    r = api.post("publieur", "/api/game/placements", {"asset_id": b["id"], "x": 61, "y": 6})
    assert r.status_code == 409
    # une surface peut passer sous un bâtiment, pas sous une autre surface
    s = asset(api, "pelouse")
    assert api.post("publieur", "/api/game/placements", {"asset_id": s["id"], "x": 59, "y": 4, "w": 6, "h": 5}).status_code == 201
    assert api.post("publieur", "/api/game/placements", {"asset_id": s["id"], "x": 60, "y": 5, "w": 2, "h": 2}).status_code == 409
    assert api.post("publieur", "/api/game/placements", {"asset_id": s["id"], "x": 80, "y": 5}).status_code == 422  # taille manquante
    interior = api.by_tech("interieur-studio-base")["id"]
    assert api.post("publieur", "/api/game/placements", {"asset_id": interior, "x": 70, "y": 5}).status_code == 422
    assert api.post("publieur", "/api/game/placements", {"asset_id": b["id"], "x": 70, "y": 5, "facing": "X"}).status_code == 422
    assert api.post("editeur", "/api/game/placements", {"asset_id": b["id"], "x": 70, "y": 5}).status_code == 403


def test_remove_placement_and_modular_prop_brings_its_kit(api: Api):
    tree = asset(api, "kit-manguier")
    p = api.post("publieur", "/api/game/placements", {"asset_id": tree["id"], "x": 70, "y": 5}).json()["placements"][0]
    data = pack(api)
    placed = data["placements"][0]
    assert placed["render"]["modular"]["kit"] in data["kits"]
    assert placed["render"]["modular"]["base"] in data["parts"]
    assert all(layer["part"] in data["parts"] for layer in placed["render"]["modular"]["layers"].values())
    r = api.delete("publieur", f"/api/game/placements/{p['id']}")
    assert r.status_code == 200 and r.json()["placements"] == []
    assert api.delete("publieur", f"/api/game/placements/{p['id']}").status_code == 404
    assert pack(api)["placements"] == []


def test_remove_and_restore_original_city_elements(api: Api):
    r = api.post("publieur", "/api/game/removals", {"key": "bld:pharmacie", "label": "Pharmacie"})
    assert r.status_code == 201, r.text
    assert [x["key"] for x in r.json()["removals"]] == ["bld:pharmacie"]
    api.post("publieur", "/api/game/removals", {"key": "tree:22,8", "label": "Manguier"})
    assert pack(api)["removals"] == ["bld:pharmacie", "tree:22,8"]
    assert api.post("publieur", "/api/game/removals", {"key": "bld:pharmacie"}).status_code == 409  # déjà retiré
    assert api.post("publieur", "/api/game/removals", {"key": "n'importe quoi"}).status_code == 422
    assert api.post("editeur", "/api/game/removals", {"key": "bld:couture"}).status_code == 403
    r = api.delete("publieur", "/api/game/removals/bld:pharmacie")
    assert r.status_code == 200 and [x["key"] for x in r.json()["removals"]] == ["tree:22,8"]
    assert api.delete("publieur", "/api/game/removals/bld:pharmacie").status_code == 404
    assert pack(api)["removals"] == ["tree:22,8"]
