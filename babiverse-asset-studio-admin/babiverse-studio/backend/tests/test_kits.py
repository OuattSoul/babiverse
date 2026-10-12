"""Kits modulaires (bâtiments, véhicules, végétation, mobilier urbain, meubles, surfaces) : bibliothèque de départ,
règles d'assemblage, composants, rendu figé, placement, export/import, catalogue d'exécution."""
import io
import json
import zipfile

from fastapi.testclient import TestClient

from app.main import create_app
from app.taxonomy import KITS

from .conftest import Api

SVG_BUILDING = b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 280"><rect x="30" y="210" width="140" height="60" style="fill:var(--babi-primary,#eeddcc)"/></svg>'


def tid(api, tech):
    return api.by_tech(tech)["id"]


def codes(res):
    return {i["code"] for i in res["validation"]["items"]}


def test_kit_library_and_examples_are_seeded(api):
    tax = api.get("lecteur", "/api/taxonomy").json()
    assert set(tax["kits"]) == {"building", "vehicle", "vegetation", "street", "furniture", "surface"}
    for f in ("building", "vehicle", "prop", "furniture", "surface"):
        assert "modular" in tax["families"][f]["representations"]
    lib = api.get("lecteur", "/api/kits/parts").json()
    assert len(lib) >= 200 and all(p["status"] == "published" for p in lib)
    for key, kit in KITS.items():
        mine = [p for p in lib if p["kit"] == key]
        bases = [p for p in mine if p["slot"] == "base"]
        assert len(bases) >= 3, key
        for b in bases:
            assert set(kit["required_anchors"]) <= set(b["props"]["anchors"]), b["name"]
        for slot, spec in kit["slots"].items():
            assert sum(p["slot"] == slot for p in mine) >= (1 if spec.get("required") else 3), (key, slot)
        assert all("var(--babi-" in p["front"] + p["back"] for p in mine if p["slot"] != "base") or key == "surface"
    assert api.get("lecteur", "/api/kits/parts", params={"kit": "inconnu"}).status_code == 404
    only = api.get("lecteur", "/api/kits/parts", params={"kit": "vehicle"}).json()
    assert only and {p["kit"] for p in only} == {"vehicle"}
    for tech in ("kit-boutique-tantie", "kit-taxi-compteur", "kit-cocotier", "kit-etal-fruits", "kit-lit-moustiquaire", "kit-place-pavee"):
        a = api.by_tech(tech)
        assert a["status"] == "published" and a["preview"]["representation"] == "modular", tech


def test_modular_assembly_rules(api, deep):
    taxi = api.detail(tid(api, "kit-taxi-compteur"))
    d = deep(taxi["definition"])
    ids = {k: tid(api, f"kit-vehicle-{k}") for k in ("moto", "bande", "galerie", "bagages", "enseigne-taxi", "pare-chocs-chrome", "roue-acier")}
    r = api.post("editeur", "/api/assets", {"category": "vehicles", "technical_name": "taxi-test", "definition": d}).json()
    assert r["validation"]["ok"], r["validation"]
    aid = r["id"]

    def check(defn):
        return codes(api.put("editeur", f"/api/assets/{aid}/draft", {"definition": defn}).json())

    m = lambda x: x["properties"]["modular"]  # noqa: E731
    bad = deep(d); m(bad)["base"] = ids["moto"]
    got = check(bad)
    assert "modular.anchor_missing" in got           # enseigne de toit sur une moto : pas de point « roof »
    assert "modular.base_incompatible" in got        # livrée et pare-chocs réservés aux voitures
    bad = deep(d); m(bad)["layers"]["cargo"] = {"part": ids["bagages"]}
    assert "modular.incompatible" in check(bad)      # bagages + enseigne de taxi
    bad = deep(d); m(bad)["layers"]["roof"] = None; m(bad)["layers"]["cargo"] = {"part": ids["bagages"]}
    del m(bad)["layers"]["roof"]
    assert "modular.requires" in check(bad)          # chargement sans équipement de toit
    bad = deep(d); del m(bad)["layers"]["wheels"]
    assert "modular.required" in check(bad)
    bad = deep(d); m(bad)["layers"]["wheels"] = {"part": tid(api, "kit-building-porte-bois")}
    assert "modular.part_kit" in check(bad)
    bad = deep(d); m(bad)["layers"]["bumper"]["pattern"] = {"part": tid(api, "kit-vehicle-motif-damier")}
    assert "modular.pattern_slot" in check(bad)
    bad = deep(d); m(bad)["colors"] = {"leaf": "#00ff00"}
    assert "modular.global" in check(bad)
    bad = deep(d); bad["variants"] = [{"id": "v", "name": "Moto", "props": {"layers": {"wheels": None}}}]
    assert "modular.required" in check(bad)          # la variante est vérifiée aussi
    bad = deep(d); bad["representation"] = "modular"; del bad["properties"]["modular"]
    assert "modular.missing" in check(bad)
    api.put("editeur", f"/api/assets/{aid}/draft", {"definition": d})
    api.publish_flow(aid)
    render = api.get("lecteur", f"/api/assets/{aid}/render").json()
    assert render["pinned"] and ids["roue-acier"] in render["parts"] and render["parts"][ids["roue-acier"]]["kit"] == "vehicle"
    assert set(render["definition"]["properties"]["modular"]["layers"]) <= set(KITS["vehicle"]["slots"])


def test_unpublished_component_blocks_publication_and_floors_warning(api, deep):
    m = api.upload("editeur", "/api/media", SVG_BUILDING, filename="mur.svg").json()
    base_def = {"name": "Base incomplète", "representation": "svg", "footprint": {"kind": "rect", "w": 1, "d": 1},
                "properties": {"kit": "building", "slot": "base", "svg_media": m["id"], "anchors": {"door": [[100, 270]]}}}
    r = api.post("editeur", "/api/assets", {"category": "kit_components", "technical_name": "base-incomplete", "definition": base_def}).json()
    assert "component.base_anchors" in codes(r)
    bad = deep(base_def); bad["properties"]["slot"] = "aile"
    assert "component.slot" in codes(api.post("editeur", "/api/assets", {"category": "kit_components", "technical_name": "slot-faux", "definition": bad}).json())
    bad = deep(base_def); bad["properties"].update(slot="door", anchor="nulle-part", anchors={})
    assert "component.anchor" in codes(api.post("editeur", "/api/assets", {"category": "kit_components", "technical_name": "ancre-fausse", "definition": bad}).json())
    door_def = deep(base_def); door_def["properties"].update(slot="door", anchor="door", anchors={}); door_def["name"] = "Porte brouillon"
    door = api.post("editeur", "/api/assets", {"category": "kit_components", "technical_name": "porte-brouillon", "definition": door_def}).json()
    assert door["validation"]["ok"], door["validation"]
    house = api.detail(tid(api, "kit-maison-akwaba"))["definition"]
    d = deep(house); d["properties"]["modular"]["layers"]["door"] = {"part": door["id"]}; d["properties"]["floors"] = 2
    d["height_m"] = 7.5
    c = api.post("editeur", "/api/assets", {"category": "residential", "technical_name": "maison-brouillon", "definition": d}).json()
    assert {"modular.unpublished", "modular.floors"} <= codes(c)
    assert api.post("editeur", f"/api/assets/{c['id']}/submit").status_code == 200
    rej = api.post("publieur", f"/api/assets/{c['id']}/approve")
    assert rej.status_code == 422 and "modular.unpublished" in {i["code"] for i in rej.json()["report"]["items"]}
    # un composant utilisé par un élément publié ne s'archive pas
    assert api.post("publieur", f"/api/assets/{tid(api, 'kit-building-porte-bois')}/archive").status_code == 409


def test_modular_placement_runtime_and_roundtrip(api, tmp_path):
    gbaka = tid(api, "kit-gbaka")
    scene = api.post("editeur", "/api/scenes", {"name": "Rue modulaire", "width": 20, "height": 20, "template": "blank"}).json()
    placed = api.post("editeur", f"/api/scenes/{scene['id']}/instances", {"asset_id": tid(api, "kit-moto-livreur"), "x": 3, "y": 3})
    assert placed.status_code == 201, placed.json()
    assert api.post("editeur", f"/api/scenes/{scene['id']}/instances", {"asset_id": tid(api, "kit-building-porte-bois"), "x": 8, "y": 8}).status_code == 422
    rt = api.get("admin", "/api/runtime/catalog").json()
    assert rt["kits"]["vehicle"]["frame"] == [0, 0, 240, 140]
    assert any(p["kit"] == "vehicle" and p["slot"] == "base" for p in rt["kit_parts"].values())
    assert all("kit" not in p for p in rt["character_parts"].values())
    r = api.post("editeur", "/api/export", {"asset_ids": [gbaka], "include_dependencies": True})
    manifest = json.loads(zipfile.ZipFile(io.BytesIO(r.content)).read("manifest.json"))
    exported = {a["asset_id"] for a in manifest["assets"]}
    assert {gbaka, tid(api, "kit-vehicle-minibus"), tid(api, "kit-vehicle-bagages"), tid(api, "kit-vehicle-galerie")} <= exported
    other = create_app(str(tmp_path / "other.db"), with_content=False)
    with TestClient(other) as client:
        api2 = Api(client)
        prev = api2.upload("publieur", "/api/imports", r.content, filename="lot.zip").json()
        assert prev["summary"]["invalid"] == 0
        res = api2.post("publieur", f"/api/imports/{prev['id']}/apply", {}).json()
        assert res["status"] == "applied" and not res["result"]["errors"], res
        r1 = api.get("admin", f"/api/assets/{gbaka}/render").json()
        r2 = api2.get("admin", f"/api/assets/{gbaka}/render").json()
        assert set(r1["parts"]) == set(r2["parts"]) and r2["pinned"]
        assert r2["parts"][tid(api, "kit-vehicle-minibus")]["front"] == r1["parts"][tid(api, "kit-vehicle-minibus")]["front"]
