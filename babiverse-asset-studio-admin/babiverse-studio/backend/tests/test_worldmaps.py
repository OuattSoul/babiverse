"""Monde du jeu : villes, zones, cartes, paysages 3D, objets interactifs, publication et diffusion au jeu."""
import base64
import json

import pytest

from app import gltf
from app.worldmaps import footprint

from .conftest import Api

GAME_KEY = {"X-Babiverse-Game-Key": "babiverse-dev"}
# Paysage de démonstration : une boutique (2×2×1) et un mur, en unités du modèle (1 unité = 1 case à l'échelle 1).
GLB = gltf.build_box_glb([("Boutique", (1, 1, 0.5), (2, 2, 1)), ("Mur", (4, 0.5, 0), (1, 1, 4))])


def pack(api: Api) -> dict:
    return api.c.get("/api/runtime/game-pack", headers=GAME_KEY).json()


def upload(api: Api, data=GLB, filename="marche.glb", user="editeur"):
    return api.upload(user, "/api/media", data, filename=filename, name="Marché de Treichville", category="landscape")


def city_and_map(api: Api, user="editeur") -> None:
    assert api.post(user, "/api/game/world/cities", {"id": "abidjan_sud", "name": "Abidjan Sud"}).status_code == 201
    assert api.post(user, "/api/game/world/districts", {"id": "treichville", "city_id": "abidjan_sud", "name": "Treichville"}).status_code == 201
    r = api.post(user, "/api/game/maps", {"id": "marche_treichville", "district_id": "treichville", "name": "Marché de Treichville",
                                           "width": 20, "height": 16})
    assert r.status_code == 201, r.text


def draft(media_id: str, **over) -> dict:
    body = {
        "width": 20, "height": 16, "ground": "paving", "spawn": [10, 13],
        "landscapes": [{"id": "marche", "media_id": media_id, "x": 6, "z": 6, "rotation": 0, "scale": 1, "solid": True}],
        "interactives": [
            {"id": "boutique", "name": "Boutique d'Awa", "type": "shop", "landscape": "marche", "node": "Boutique",
             "label": "Regarder la boutique", "text": "Pagnes et wax du marché."},
            {"id": "etal", "name": "Étal de fruits", "type": "info", "area": {"x": 14, "y": 10, "w": 2, "h": 1}, "text": "Mangues et ananas."},
            {"id": "sortie", "name": "Retour à la Cité Akwaba", "type": "door", "area": {"x": 10, "y": 14, "w": 1, "h": 1},
             "label": "Rentrer à la Cité Akwaba", "target": {"zone": "quartier", "spawn": "from_marche_treichville"}},
        ],
        "entrance": {"zone": "quartier", "x": 41, "y": 3, "label": "→ TREICHVILLE"},
    }
    body.update(over)
    return body


# ---------------------------------------------------------------- modèles 3D dans la médiathèque

def test_glb_import_reports_size_objects_and_warnings(api: Api):
    r = upload(api)
    assert r.status_code == 201, r.text
    m = r.json()
    assert m["kind"] == "model" and m["mime"] == "model/gltf-binary" and m["category"] == "landscape"
    meta = m["meta"]
    assert meta["size"] == [4.5, 2.0, 4.0] and meta["triangles"] == 24 and meta["warnings"] == []
    assert [(o["name"], o["unique"]) for o in meta["objects"]] == [("Boutique", True), ("Mur", True)]
    assert api.c.get(m["url"]).content == GLB  # lien signé de la médiathèque


def test_invalid_or_incomplete_models_are_refused(api: Api):
    assert upload(api, b"glTF" + bytes(30)).status_code == 422                      # version / taille incohérentes
    assert upload(api, GLB[:-8]).status_code == 422                                  # tronqué
    external = json.dumps({"asset": {"version": "2.0"}, "buffers": [{"uri": "scene.bin", "byteLength": 10}], "meshes": [{}]}).encode()
    r = upload(api, external, "scene.gltf")
    assert r.status_code == 422 and "scene.bin" in r.json()["detail"]                # dépendance externe absente
    draco = json.dumps({"asset": {"version": "2.0"}, "extensionsRequired": ["KHR_draco_mesh_compression"], "meshes": [{}]}).encode()
    assert "Draco" in upload(api, draco, "d.gltf").json()["detail"]
    v1 = json.dumps({"asset": {"version": "1.0"}, "meshes": [{}]}).encode()
    assert upload(api, v1, "old.gltf").status_code == 422
    assert upload(api, GLB, user="lecteur").status_code == 403


def test_self_contained_gltf_accepted_and_duplicate_names_flagged(api: Api):
    glb = gltf.build_box_glb([("Toit", (0, 0, 0), (1, 1, 1)), ("Toit", (2, 0, 0), (1, 1, 1))])
    # glTF JSON autonome : même contenu, tampon intégré en data:
    jlen = int.from_bytes(glb[12:16], "little")
    doc = json.loads(glb[20:20 + jlen])
    blob = glb[20 + jlen + 8:]
    doc["buffers"] = [{"byteLength": len(blob), "uri": "data:application/octet-stream;base64," + base64.b64encode(blob).decode()}]
    r = upload(api, json.dumps(doc).encode(), "toits.gltf")
    assert r.status_code == 201, r.text
    meta = r.json()["meta"]
    assert r.json()["mime"] == "model/gltf+json" and meta["format"] == "gltf"
    assert all(not o["unique"] for o in meta["objects"]) and "double" in meta["warnings"][0]


# ---------------------------------------------------------------- villes, zones, cartes

def test_create_city_district_map_and_permissions(api: Api):
    assert api.post("lecteur", "/api/game/world/cities", {"id": "bouake", "name": "Bouaké"}).status_code == 403
    assert api.post("joueur", "/api/game/world/cities", {"id": "bouake", "name": "Bouaké"}).status_code == 403
    city_and_map(api)
    w = api.get("lecteur", "/api/game/world").json()
    city = next(c for c in w["cities"] if c["id"] == "abidjan_sud")
    m = city["districts"][0]["maps"][0]
    assert (m["id"], m["status"], m["published_version"], m["draft_pending"]) == ("marche_treichville", "draft", None, True)
    assert w["builtin_maps"] == ["quartier", "maison", "epicerie"]
    # doublons, parents inconnus, identifiants réservés ou invalides
    assert api.post("editeur", "/api/game/world/cities", {"id": "abidjan_sud", "name": "x"}).status_code == 409
    assert api.post("editeur", "/api/game/world/districts", {"id": "cocody", "city_id": "inconnue", "name": "x"}).status_code == 404
    for bad in ("quartier", "int_marche", "Marche", "x" * 33):
        r = api.post("editeur", "/api/game/maps", {"id": bad, "district_id": "treichville", "name": "x"})
        assert r.status_code == 422, bad
    assert api.post("editeur", "/api/game/maps", {"id": "m2", "district_id": "inconnue", "name": "x"}).status_code == 404


def test_draft_publish_cycle_and_pack(api: Api):
    city_and_map(api)
    media = upload(api).json()
    # brouillon : révision figée, emprise calculée, zone de la boutique déduite de l'objet nommé du modèle
    r = api.put("editeur", "/api/game/maps/marche_treichville/draft", draft(media["id"]))
    assert r.status_code == 200, r.text
    d = r.json()
    inst = d["draft"]["landscapes"][0]
    assert inst["revision"] == 1 and inst["footprint"] == {"x": 6, "y": 4, "w": 5, "h": 4}
    shop = d["draft"]["interactives"][0]
    assert shop["area"] == {"x": 6, "y": 6, "w": 2, "h": 1}
    assert d["issues"] == []
    # le brouillon n'atteint jamais le jeu
    assert pack(api)["maps"] == []
    assert api.post("editeur", "/api/game/maps/marche_treichville/publish").status_code == 403  # éditeur : pas de publication
    r = api.post("publieur", "/api/game/maps/marche_treichville/publish", {"note": "Première version"})
    assert r.status_code == 200, r.text
    assert r.json()["published_version"] == 1 and r.json()["status"] == "published" and not r.json()["draft_pending"]
    maps = pack(api)["maps"]
    assert [m["id"] for m in maps] == ["marche_treichville"]
    m = maps[0]
    assert m["city"] == {"id": "abidjan_sud", "name": "Abidjan Sud"} and m["district"]["id"] == "treichville"
    assert m["models"]["marche"]["revision"] == 1 and m["models"]["marche"]["bbox"] == [0.0, 0.0, -2.0, 4.5, 2.0, 2.0]
    assert m["entrance"]["label"] == "→ TREICHVILLE" and m["spawn"] == [10, 13]
    # une modification du brouillon ne change pas la carte publiée
    changed = draft(media["id"], spawn=[3, 3])
    api.put("editeur", "/api/game/maps/marche_treichville/draft", changed)
    assert pack(api)["maps"][0]["spawn"] == [10, 13]
    assert api.get("lecteur", "/api/game/maps/marche_treichville").json()["draft_pending"] is True


def test_replacing_the_file_does_not_change_the_published_map(api: Api):
    city_and_map(api)
    media = upload(api).json()
    api.put("editeur", "/api/game/maps/marche_treichville/draft", draft(media["id"]))
    api.post("publieur", "/api/game/maps/marche_treichville/publish")
    bigger = gltf.build_box_glb([("Boutique", (2, 1, 1), (4, 2, 2))])
    r = api.c.post(f"/api/media/{media['id']}/replace", params={"filename": "v2.glb"}, content=bigger,
                   headers={**api.as_("editeur"), "Content-Type": "application/octet-stream"})
    assert r.status_code == 200 and r.json()["revision"] == 2
    m = pack(api)["maps"][0]
    assert m["models"]["marche"]["revision"] == 1  # la carte publiée garde la révision figée
    assert api.c.get(f"/api/runtime/models/{media['id']}/1", headers=GAME_KEY).content == GLB


def test_publication_refused_with_explicit_reasons(api: Api):
    city_and_map(api)
    media = upload(api).json()
    bad = draft(media["id"], spawn=[7, 5], entrance=None)  # arrivée dans l'emprise solide, aucun accès
    bad["interactives"][2]["target"] = {"zone": "carte_inconnue", "spawn": "default"}
    bad["landscapes"].append({"id": "loin", "media_id": media["id"], "x": 19, "z": 2})
    assert api.put("editeur", "/api/game/maps/marche_treichville/draft", bad).status_code == 200
    issues = api.get("lecteur", "/api/game/maps/marche_treichville").json()["issues"]
    text = " ".join(issues)
    assert "Point d'arrivée" in text and "accès" in text and "carte_inconnue" in text and "loin" in text
    r = api.post("publieur", "/api/game/maps/marche_treichville/publish")
    assert r.status_code == 422 and "Publication impossible" in r.json()["detail"]
    assert pack(api)["maps"] == []
    # objet absent du modèle, image au lieu d'un modèle
    wrong_node = draft(media["id"])
    wrong_node["interactives"][0]["node"] = "Inexistant"
    assert api.put("editeur", "/api/game/maps/marche_treichville/draft", wrong_node).status_code == 422
    png = api.get("lecteur", "/api/media", params={"kind": "raster"}).json()
    if png:
        r = api.put("editeur", "/api/game/maps/marche_treichville/draft", draft(png[0]["id"]))
        assert r.status_code == 422 and "modèle 3D" in r.json()["detail"]


def test_disable_keeps_versions_and_model_access_is_restricted(api: Api):
    city_and_map(api)
    media = upload(api).json()
    other = upload(api, gltf.build_box_glb([("X", (0, 0, 0), (1, 1, 1))]), "autre.glb").json()
    api.put("editeur", "/api/game/maps/marche_treichville/draft", draft(media["id"]))
    api.post("publieur", "/api/game/maps/marche_treichville/publish")
    url = f"/api/runtime/models/{media['id']}/1"
    assert api.c.get(url).status_code == 401                                          # sans la clé du jeu
    assert api.c.get(url, headers={"X-Babiverse-Game-Key": "mauvaise"}).status_code == 401
    ok = api.c.get(url, headers=GAME_KEY)
    assert ok.status_code == 200 and ok.headers["content-type"] == "model/gltf-binary" and "immutable" in ok.headers["cache-control"]
    assert api.c.get(f"/api/runtime/models/{other['id']}/1", headers=GAME_KEY).status_code == 404  # pas sur une carte publiée
    r = api.post("publieur", "/api/game/maps/marche_treichville/disable")
    assert r.json()["status"] == "disabled" and r.json()["published_version"] == 1
    assert pack(api)["maps"] == [] and api.c.get(url, headers=GAME_KEY).status_code == 404
    assert api.post("publieur", "/api/game/maps/marche_treichville/enable").json()["status"] == "published"
    assert [m["id"] for m in pack(api)["maps"]] == ["marche_treichville"]


def test_door_to_another_published_map(api: Api):
    city_and_map(api)
    media = upload(api).json()
    api.put("editeur", "/api/game/maps/marche_treichville/draft", draft(media["id"]))
    api.post("publieur", "/api/game/maps/marche_treichville/publish")
    api.post("editeur", "/api/game/maps", {"id": "port_bouet", "district_id": "treichville", "name": "Port-Bouët"})
    d = draft(media["id"])
    d["interactives"][2]["target"] = {"zone": "marche_treichville", "spawn": "default"}
    api.put("editeur", "/api/game/maps/port_bouet/draft", d)
    # même case d'accès que le marché publié : refusé
    issues = api.get("lecteur", "/api/game/maps/port_bouet").json()["issues"]
    assert len(issues) == 1 and "déjà celle de la carte publiée" in issues[0]
    d["entrance"] = {"zone": "quartier", "x": 36, "y": 31, "label": "→ PORT-BOUËT"}
    api.put("editeur", "/api/game/maps/port_bouet/draft", d)
    assert api.get("lecteur", "/api/game/maps/port_bouet").json()["issues"] == []


@pytest.mark.parametrize("inst,expected", [
    ({"x": 6, "z": 6, "rotation": 0, "scale": 1}, {"x": 6, "y": 4, "w": 5, "h": 4}),
    ({"x": 6, "z": 6, "rotation": 90, "scale": 1}, {"x": 4, "y": 6, "w": 4, "h": 5}),
    ({"x": 6, "z": 6, "rotation": 180, "scale": 1}, {"x": 1, "y": 4, "w": 5, "h": 4}),
    ({"x": 6, "z": 6, "rotation": 270, "scale": 2}, {"x": 2, "y": -3, "w": 8, "h": 9}),
    ({"x": 2.5, "z": 3.25, "rotation": 0, "scale": 0.5}, {"x": 2, "y": 2, "w": 3, "h": 3}),
])
def test_footprint_same_rule_as_the_game(inst, expected):
    # mêmes cas dans client/tests/dataMaps.test.js
    assert footprint(inst, [0.0, 0.0, -2.0, 4.5, 2.0, 2.0]) == expected


def test_migration_adds_world_tables_without_touching_existing_data(api: Api):
    conn = api.c.app.state.conn
    tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()} if not hasattr(conn, "pg") else None
    if tables is not None:
        assert {"cities", "districts", "game_maps", "map_versions"} <= tables
    assert api.get("lecteur", "/api/assets").json()  # catalogue existant intact


# ---------------------------------------------------------------- connexions entre cartes

def two_connected_maps(api: Api):
    """Marché publié + Port-Bouët relié au marché par un gbaka réservé aux joueurs ayant fini « m_livraison »."""
    city_and_map(api)
    media = upload(api).json()
    market = draft(media["id"], arrivals=[{"id": "gare", "x": 15, "y": 13}])
    api.put("editeur", "/api/game/maps/marche_treichville/draft", market)
    assert api.post("publieur", "/api/game/maps/marche_treichville/publish").status_code == 200
    api.post("editeur", "/api/game/maps", {"id": "port_bouet", "district_id": "treichville", "name": "Port-Bouët"})
    d = draft(media["id"], entrance={"zone": "quartier", "x": 36, "y": 31, "label": "→ PORT-BOUËT"})
    d["interactives"].append({"id": "gbaka", "name": "Gbaka pour Treichville", "type": "door", "mode": "transport",
                              "area": {"x": 2, "y": 2, "w": 2, "h": 1}, "target": {"zone": "marche_treichville", "spawn": "gare"},
                              "conditions": [{"type": "mission_completed", "mission": "m_livraison"}, {"type": "min_balance", "amount": 500}]})
    d["interactives"][2]["target"]["spawn"] = "from_port_bouet"
    return media, d


def test_door_targets_an_existing_arrival_and_valid_conditions(api: Api):
    media, d = two_connected_maps(api)
    r = api.put("editeur", "/api/game/maps/port_bouet/draft", d)
    assert r.status_code == 200 and r.json()["issues"] == [], r.json()["issues"]
    bad = json.loads(json.dumps(d))
    bad["interactives"][3]["target"]["spawn"] = "quai_inexistant"
    bad["interactives"][3]["conditions"] = [{"type": "mission_completed", "mission": "m_inconnue"}, {"type": "min_balance"}]
    bad["interactives"][2]["target"]["spawn"] = "from_autre_carte"
    bad["arrivals"] = [{"id": "default", "x": 3, "y": 3}, {"id": "quai", "x": 7, "y": 5}]  # réservé ; dans le paysage
    text = " ".join(api.put("editeur", "/api/game/maps/port_bouet/draft", bad).json()["issues"])
    for expected in ("quai_inexistant", "m_inconnue", "montant manquant", "from_autre_carte", "« default »", "« quai » dans l'emprise"):
        assert expected in text, expected
    # type de condition inconnu : refusé dès la saisie (schéma)
    worse = json.loads(json.dumps(d))
    worse["interactives"][3]["conditions"] = [{"type": "script", "code": "x"}]
    assert api.put("editeur", "/api/game/maps/port_bouet/draft", worse).status_code == 422


def test_connection_graph_and_pack(api: Api):
    media, d = two_connected_maps(api)
    api.put("editeur", "/api/game/maps/port_bouet/draft", d)
    assert api.post("publieur", "/api/game/maps/port_bouet/publish").status_code == 200
    g = api.get("lecteur", "/api/game/connections").json()
    edges = {(e["from"], e["to"], e["spawn"], e["kind"]) for e in g["edges"]}
    assert ("quartier", "port_bouet", "default", "entrance") in edges
    assert ("port_bouet", "marche_treichville", "gare", "door") in edges
    assert ("marche_treichville", "quartier", "from_marche_treichville", "door") in edges
    gbaka = next(e for e in g["edges"] if e.get("object") == "gbaka")
    assert gbaka["mode"] == "transport" and len(gbaka["conditions"]) == 2
    assert "m_livraison" in g["missions"]
    port = next(m for m in pack(api)["maps"] if m["id"] == "port_bouet")
    door = next(i for i in port["interactives"] if i["id"] == "gbaka")
    assert door["conditions"][0] == {"type": "mission_completed", "mission": "m_livraison", "amount": None}
    market = next(m for m in pack(api)["maps"] if m["id"] == "marche_treichville")
    assert market["arrivals"] == [{"id": "gare", "x": 15, "y": 13}]


# ---------------------------------------------------------------- versions, restauration, aperçu des changements

def test_versions_restore_and_change_preview(api: Api):
    city_and_map(api)
    media = upload(api).json()
    v1 = draft(media["id"])
    api.put("editeur", "/api/game/maps/marche_treichville/draft", v1)
    api.post("publieur", "/api/game/maps/marche_treichville/publish", {"note": "v1"})
    assert api.get("lecteur", "/api/game/maps/marche_treichville").json()["changes"] == []
    v2 = draft(media["id"], spawn=[12, 13])
    v2["landscapes"][0]["x"] = 7
    v2["interactives"] = [i for i in v2["interactives"] if i["id"] != "etal"]
    d = api.put("editeur", "/api/game/maps/marche_treichville/draft", v2).json()
    text = " ".join(d["changes"])
    assert "[10, 13] → [12, 13]" in text and "Paysage marche modifié (x)" in text and "Objet interactif retiré : etal" in text
    api.post("publieur", "/api/game/maps/marche_treichville/publish", {"note": "v2"})
    assert pack(api)["maps"][0]["spawn"] == [12, 13]
    old = api.get("lecteur", "/api/game/maps/marche_treichville/versions/1").json()
    assert old["note"] == "v1" and old["draft"]["spawn"] == [10, 13] and old["models"]["marche"]["revision"] == 1
    assert api.get("lecteur", "/api/game/maps/marche_treichville/versions/9").status_code == 404
    # restaurer la version 1 : brouillon seulement, la carte active reste la version 2
    assert api.post("lecteur", "/api/game/maps/marche_treichville/restore", {"version": 1}).status_code == 403
    r = api.post("editeur", "/api/game/maps/marche_treichville/restore", {"version": 1}).json()
    assert r["draft"] == old["draft"] and r["published_version"] == 2 and r["draft_pending"]
    assert pack(api)["maps"][0]["spawn"] == [12, 13]
    r = api.post("publieur", "/api/game/maps/marche_treichville/publish", {"note": "retour à la v1"}).json()
    assert r["published_version"] == 3 and [v["version"] for v in r["versions"]] == [3, 2, 1]
    assert pack(api)["maps"][0]["spawn"] == [10, 13]


def test_replaced_file_is_visible_in_maps_and_media(api: Api):
    city_and_map(api)
    media = upload(api).json()
    api.put("editeur", "/api/game/maps/marche_treichville/draft", draft(media["id"]))
    api.post("publieur", "/api/game/maps/marche_treichville/publish")
    api.c.post(f"/api/media/{media['id']}/replace", params={"filename": "v2.glb"}, content=GLB,
               headers={**api.as_("editeur"), "Content-Type": "application/octet-stream"})
    d = api.get("lecteur", "/api/game/maps/marche_treichville").json()
    assert d["newer_revisions"] == {"marche": 2}           # signalé, jamais appliqué tout seul
    usage = api.get("lecteur", f"/api/media/{media['id']}").json()["map_usage"]
    assert usage[0]["map_id"] == "marche_treichville"
    assert {"where": "version 1 (publiée)", "revision": 1} in usage[0]["uses"]
    # adopter la révision 2 : nouveau brouillon, puis publication
    d2 = draft(media["id"])
    d2["landscapes"][0]["revision"] = 2
    assert api.put("editeur", "/api/game/maps/marche_treichville/draft", d2).json()["newer_revisions"] == {}


# ---------------------------------------------------------------- permissions administrateur

ROLES = ("admin", "publieur", "editeur", "lecteur", "joueur")


def test_role_matrix_on_every_world_route(api: Api):
    """Qui peut quoi : lire (asset.read), préparer (world.manage), publier (world.publish). Sans session : rien."""
    city_and_map(api, user="admin")
    media = upload(api, user="admin").json()
    api.put("admin", "/api/game/maps/marche_treichville/draft", draft(media["id"]))
    api.post("admin", "/api/game/maps/marche_treichville/publish")
    n = iter(range(100))
    routes = {
        "lire le monde": ("GET", "/api/game/world", None, {"admin", "publieur", "editeur", "lecteur"}),
        "lire une carte": ("GET", "/api/game/maps/marche_treichville", None, {"admin", "publieur", "editeur", "lecteur"}),
        "lire une version": ("GET", "/api/game/maps/marche_treichville/versions/1", None, {"admin", "publieur", "editeur", "lecteur"}),
        "lire les connexions": ("GET", "/api/game/connections", None, {"admin", "publieur", "editeur", "lecteur"}),
        "créer une ville": ("POST", "/api/game/world/cities", lambda: {"id": f"v{next(n)}", "name": "V"}, {"admin", "publieur", "editeur"}),
        "créer une zone": ("POST", "/api/game/world/districts", lambda: {"id": f"z{next(n)}", "city_id": "abidjan_sud", "name": "Z"}, {"admin", "publieur", "editeur"}),
        "créer une carte": ("POST", "/api/game/maps", lambda: {"id": f"c{next(n)}", "district_id": "treichville", "name": "C"}, {"admin", "publieur", "editeur"}),
        "enregistrer un brouillon": ("PUT", "/api/game/maps/marche_treichville/draft", lambda: draft(media["id"]), {"admin", "publieur", "editeur"}),
        "restaurer": ("POST", "/api/game/maps/marche_treichville/restore", lambda: {"version": 1}, {"admin", "publieur", "editeur"}),
        "publier": ("POST", "/api/game/maps/marche_treichville/publish", lambda: {"note": ""}, {"admin", "publieur"}),
        "désactiver": ("POST", "/api/game/maps/marche_treichville/disable", None, {"admin", "publieur"}),
        "réactiver": ("POST", "/api/game/maps/marche_treichville/enable", None, {"admin", "publieur"}),
    }
    for label, (method, url, body, allowed) in routes.items():
        r = api.c.request(method, url, json=body() if body else None)
        assert r.status_code == 401, (label, "sans session", r.status_code)
        for role in ROLES:
            r = api.c.request(method, url, json=body() if body else None, headers=api.as_(role))
            assert (r.status_code < 400) == (role in allowed), (label, role, r.status_code, r.text[:200])
            assert r.status_code < 400 or r.status_code == 403, (label, role, r.status_code)
    # importer un modèle : media.upload (éditeur, publieur, admin)
    for role in ROLES:
        assert (upload(api, user=role).status_code == 201) == (role in {"admin", "publieur", "editeur"}), role


def test_world_actions_are_audited(api: Api):
    city_and_map(api)
    media = upload(api).json()
    api.put("editeur", "/api/game/maps/marche_treichville/draft", draft(media["id"]))
    api.post("publieur", "/api/game/maps/marche_treichville/publish")
    api.post("publieur", "/api/game/maps/marche_treichville/disable")
    log = api.get("admin", "/api/audit", params={"action": "world."}).json()
    rows = log["items"] if isinstance(log, dict) else log
    seen = {(e["action"], e["username"]) for e in rows}
    for expected in (("world.city.create", "editeur"), ("world.map.create", "editeur"), ("world.map.draft", "editeur"),
                     ("world.map.publish", "publieur"), ("world.map.disable", "publieur")):
        assert expected in seen, expected
    assert api.get("editeur", "/api/audit").status_code == 403


# ---------------------------------------------------------------- poids d'une carte (performance)

def test_map_weight_counts_shared_files_once_and_warns_over_budget(api: Api, monkeypatch):
    city_and_map(api)
    media = upload(api).json()
    d = draft(media["id"])
    d["landscapes"].append({"id": "marche_bis", "media_id": media["id"], "x": 13, "z": 11})
    w = api.put("editeur", "/api/game/maps/marche_treichville/draft", d).json()["weight"]
    assert (w["files"], w["instances"], w["bytes"], w["triangles"]) == (1, 2, len(GLB), 48) and w["warnings"] == []
    from app import worldmaps
    monkeypatch.setitem(worldmaps.MOBILE_BUDGET, "triangles", 40)
    monkeypatch.setitem(worldmaps.MOBILE_BUDGET, "bytes", 100)
    w = api.get("lecteur", "/api/game/maps/marche_treichville").json()["weight"]
    assert len(w["warnings"]) == 2 and "Géométrie lourde" in w["warnings"][1]
    assert api.get("lecteur", "/api/game/maps/marche_treichville").json()["issues"] == []  # avertissement, pas de refus
