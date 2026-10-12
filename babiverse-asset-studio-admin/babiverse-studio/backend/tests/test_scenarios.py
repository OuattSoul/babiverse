"""Scénarios d'acceptation A, B, C, F, G, H + contrôles du cycle de vie et du placement."""
import copy


def player_house(interior_id: str) -> dict:
    return {
        "name": "Maison de joueur — Cocody", "description": "Maison 2×2 attribuable à un joueur.",
        "subcategory": "Maison de joueur", "tags": ["joueur"], "representation": "procedural",
        "footprint": {"kind": "rect", "w": 2, "d": 2}, "height_m": 4.5,
        "entrances": [{"id": "porte", "cell": [0, 1], "side": "S", "kind": "main"}],
        "materials": {"wall": "#f3d9b1", "roof": "#2f5d8a", "trim": "#ffffff"},
        "variants": [{"id": "ocre", "name": "Ocre", "materials": {"wall": "#d9a066"}}],
        "placement": {"allowed_terrain": ["ground"], "road_access": "preferred"},
        "properties": {"floors": 1, "occupancy": 3, "ownership": "player", "assignable_to_player": True,
                       "interiors": [{"interior_id": interior_id, "label": "Base"}],
                       "style": {"roof": "hip", "window_style": "grid", "door_style": "wood"}},
    }


# ------------------------------------------------------------------ Scénario A
def test_scenario_a_player_house(api):
    studio = api.by_tech("interieur-studio-base")
    r = api.post("editeur", "/api/assets", {"category": "residential", "technical_name": "maison-joueur-cocody",
                                            "definition": player_house(studio["id"])})
    assert r.status_code == 201, r.json()
    house = r.json()
    assert house["status"] == "draft" and house["validation"]["ok"], house["validation"]

    api.publish_flow(house["id"])
    cat = api.get("joueur", "/api/catalog").json()
    entry = next(c for c in cat if c["asset_id"] == house["id"])
    assert entry["definition"]["properties"]["interiors"][0]["interior_id"] == studio["id"]

    # le joueur place sa maison au bord de l'avenue (y=10) ; l'intérieur est chargeable
    r = api.post("joueur", "/api/world/instances", {"asset_id": house["id"], "x": 24, "y": 8, "rotation": 0, "variant_id": "ocre"})
    assert r.status_code == 201, r.json()
    assert not any(i["code"] == "entrance.road_access" for i in r.json()["report"]["items"])
    defs = api.get("joueur", "/api/catalog/definitions", params={"keys": f"{studio['id']}@1"}).json()
    assert defs[f"{studio['id']}@1"]["family"] == "interior"


def test_player_house_requires_interior(api):
    d = player_house("x")
    d["properties"]["interiors"] = []
    r = api.post("editeur", "/api/assets", {"category": "residential", "technical_name": "maison-sans-interieur", "definition": d})
    codes = {i["code"] for i in r.json()["validation"]["items"]}
    assert "player.interior_missing" in codes
    assert api.post("editeur", f"/api/assets/{r.json()['id']}/submit").status_code == 422


# ------------------------------------------------------------------ Scénario B
def test_scenario_b_shop_variant_without_code(api):
    shop = api.by_tech("boutique-quartier")
    r = api.post("editeur", f"/api/assets/{shop['id']}/duplicate", {"technical_name": "maquis-chez-tantie", "name": "Maquis Chez Tantie"})
    assert r.status_code == 201, r.json()
    dup = r.json()
    assert dup["derived_from"] == shop["id"]
    d = dup["definition"]
    d["subcategory"] = "Maquis"
    d["materials"]["wall"] = "#f2b134"
    d["properties"]["shop"]["sign_text"] = "MAQUIS TANTIE"
    d["properties"]["style"]["roof"] = "gable"
    d["variants"].append({"id": "nuit", "name": "Enseigne de nuit", "materials": {"trim": "#c0392b"}, "props": {"sign_text": "OUVERT 24H"}})
    r = api.put("editeur", f"/api/assets/{dup['id']}/draft", {"definition": d})
    assert r.status_code == 200 and r.json()["validation"]["ok"], r.json()
    api.publish_flow(dup["id"])

    cat = {c["technical_name"]: c for c in api.get("joueur", "/api/catalog").json()}
    assert cat["maquis-chez-tantie"]["definition"]["properties"]["shop"]["sign_text"] == "MAQUIS TANTIE"
    assert cat["boutique-quartier"]["definition"]["properties"]["shop"]["sign_text"] == "BOUTIQUE"  # original intact


def test_commerce_without_shopfront_rejected(api):
    shop = api.by_tech("boutique-quartier")
    d = api.detail(shop["id"])["definition"]
    d["properties"]["shop"] = None
    r = api.post("editeur", "/api/assets", {"category": "commerce", "technical_name": "boutique-cassee", "definition": d})
    assert "commerce.shop_missing" in {i["code"] for i in r.json()["validation"]["items"]}


def test_variant_cannot_touch_unknown_slot(api):
    shop = api.by_tech("boutique-quartier")
    d = api.detail(shop["id"])["definition"]
    d["variants"] = [{"id": "x", "name": "X", "materials": {"vitre": "#ffffff"}, "props": {"floors": 9}}]
    r = api.post("editeur", "/api/assets", {"category": "commerce", "technical_name": "boutique-variante-bad", "definition": d})
    codes = {i["code"] for i in r.json()["validation"]["items"]}
    assert {"variant.slot", "variant.prop"} <= codes


# ------------------------------------------------------------------ Scénario C
def road(kind, lanes=2, width=2, sides=None, flows=None, oneway=False):
    from app.seed import road_def
    return road_def(kind, f"Test {kind} {lanes}v", lanes=lanes, width=width, sides=sides, flows=flows, oneway=oneway)


def test_scenario_c_new_road_segment_and_connections(api):
    # Nouveau boulevard 3 voies : valide, mais non raccordable aux routes 2 voies
    r = api.post("editeur", "/api/assets", {"category": "road", "technical_name": "boulevard-3v", "definition": road("straight", 3, 3)})
    assert r.status_code == 201 and r.json()["validation"]["ok"], r.json()["validation"]
    compat = api.get("editeur", f"/api/assets/{r.json()['id']}/road-compatibility").json()
    assert compat and not any(c["compatible"] for c in compat)
    assert "largeurs" in compat[0]["reason"]

    # Nouvelle rue 2 voies en sens unique : raccordable aux 2 voies ? non (flux in/out vs both)
    r2 = api.post("editeur", "/api/assets", {"category": "road", "technical_name": "rue-sens-unique",
                                             "definition": road("straight", 2, 2, oneway=True, flows={"N": "out", "S": "in"})})
    assert r2.json()["validation"]["ok"], r2.json()["validation"]
    compat2 = {c["name"]: c for c in api.get("editeur", f"/api/assets/{r2.json()['id']}/road-compatibility").json()}
    assert not compat2["Route 2 voies — droite"]["compatible"]

    # Nouvelle droite 2 voies double sens : raccordable à la droite et au carrefour existants
    r3 = api.post("editeur", "/api/assets", {"category": "road", "technical_name": "rue-residentielle", "definition": road("straight")})
    compat3 = {c["name"]: c for c in api.get("editeur", f"/api/assets/{r3.json()['id']}/road-compatibility").json()}
    assert compat3["Route 2 voies — carrefour en croix"]["compatible"]
    api.publish_flow(r3.json()["id"])

    # Placement réel : sous le carrefour (20,10) -> raccord S du carrefour / N de la rue
    ok = api.post("editeur", "/api/world/instances", {"asset_id": r3.json()["id"], "x": 20, "y": 12, "rotation": 0})
    assert ok.status_code == 201, ok.json()
    # Sous une droite horizontale (pas de raccord S) -> connexion impossible
    bad = api.post("editeur", "/api/world/instances", {"asset_id": r3.json()["id"], "x": 24, "y": 12, "rotation": 0})
    assert bad.status_code == 422
    assert "road.no_counterpart" in {i["code"] for i in bad.json()["report"]["items"]}


def test_road_layout_rules(api):
    d = road("tee", sides=["N", "S"])
    r = api.post("editeur", "/api/assets", {"category": "road", "technical_name": "t-faux", "definition": d})
    assert "road.connector_layout" in {i["code"] for i in r.json()["validation"]["items"]}
    d = road("straight", lanes=2, width=2)
    d["connectors"][0]["lanes"] = 3
    r = api.post("editeur", "/api/assets", {"category": "road", "technical_name": "voies-incoherentes", "definition": d})
    assert "road.connector_lanes" in {i["code"] for i in r.json()["validation"]["items"]}


def test_misaligned_wider_road_rejected(api):
    r = api.post("editeur", "/api/assets", {"category": "road", "technical_name": "boulevard-3v-b", "definition": road("straight", 3, 3)})
    api.publish_flow(r.json()["id"])
    bad = api.post("editeur", "/api/world/instances", {"asset_id": r.json()["id"], "x": 20, "y": 12, "rotation": 0})
    assert bad.status_code == 422
    assert {"road.misaligned"} & {i["code"] for i in bad.json()["report"]["items"]}


# ------------------------------------------------------------------ Scénario F
def test_scenario_f_interior_reused_by_several_buildings(api):
    studio = api.by_tech("interieur-studio-base")
    ids = []
    for i in range(2):
        d = player_house(studio["id"])
        d["name"] = f"Maison joueur {i}"
        r = api.post("editeur", "/api/assets", {"category": "residential", "technical_name": f"maison-j-{i}", "definition": d})
        api.publish_flow(r.json()["id"])
        ids.append(r.json()["id"])
    cat = {c["asset_id"]: c for c in api.get("joueur", "/api/catalog").json()}
    users = [aid for aid, c in cat.items() if c["family"] == "building"
             and any(l["interior_id"] == studio["id"] for l in c["definition"]["properties"]["interiors"])]
    assert set(ids) <= set(users) and len(users) >= 3  # + la maison économique du kit
    # un intérieur utilisé par des bâtiments publiés ne peut pas être archivé
    assert api.post("publieur", f"/api/assets/{studio['id']}/archive").status_code == 409


def test_interior_integrity_checks(api):
    studio = api.by_tech("interieur-studio-base")
    d = copy.deepcopy(api.detail(studio["id"])["definition"])
    p = d["properties"]
    p["doors"] = [x for x in p["doors"] if x["id"] != "p-sdb"]                       # salle d'eau inaccessible
    p["doors"].append({"id": "mur", "cell": [0, 0], "side": "E", "connects": ["salon", "chambre"]})  # porte bloquée
    p["furniture"].append({"id": "hors", "item": "plant", "x": 9, "y": 9, "w": 1, "d": 1})        # hors limites
    p["furniture"].append({"id": "bloque", "item": "chair", "x": 2, "y": 4, "w": 1, "d": 1})     # sur une porte
    r = api.post("editeur", "/api/assets", {"category": "interior", "technical_name": "interieur-casse", "definition": d})
    codes = {i["code"] for i in r.json()["validation"]["items"]}
    assert {"room.unreachable", "door.blocked", "furniture.outside", "furniture.door"} <= codes


def test_interior_too_big_for_building(api):
    studio = api.by_tech("interieur-studio-base")
    d = copy.deepcopy(api.detail(studio["id"])["definition"])
    d["properties"]["width"] = 12
    d["properties"]["rooms"][0]["w"] = 12
    r = api.post("editeur", "/api/assets", {"category": "interior", "technical_name": "grand-interieur", "definition": d})
    api.publish_flow(r.json()["id"])
    h = player_house(r.json()["id"])
    r2 = api.post("editeur", "/api/assets", {"category": "residential", "technical_name": "maison-trop-petite", "definition": h})
    assert "interior.too_big" in {i["code"] for i in r2.json()["validation"]["items"]}


# ------------------------------------------------------------------ Scénario G
def test_scenario_g_published_versions_protect_instances(api):
    house = api.by_tech("maison-economique")
    inst = next(i for i in api.get("admin", "/api/world").json()["instances"] if i["asset_id"] == house["id"])
    assert inst["version"] == 1

    # publié -> non modifiable directement
    d = api.detail(house["id"])["definition"]
    assert api.put("editeur", f"/api/assets/{house['id']}/draft", {"definition": d}).status_code == 409

    # v2 : agrandissement 3×3 -> incompatible avec l'emplacement actuel (chevauche l'avenue)
    api.post("editeur", f"/api/assets/{house['id']}/new-draft")
    d2 = copy.deepcopy(d); d2["footprint"] = {"kind": "rect", "w": 3, "d": 3, "cells": None}
    # l'entrée [1,1] deviendrait intérieure sur 3×3 : le validateur l'interdit
    r = api.put("editeur", f"/api/assets/{house['id']}/draft", {"definition": d2})
    assert "entrance.inner" in {i["code"] for i in r.json()["validation"]["items"]}
    d2["entrances"][0]["cell"] = [1, 2]
    assert api.put("editeur", f"/api/assets/{house['id']}/draft", {"definition": d2}).status_code == 200
    api.publish_flow(house["id"])
    world = api.get("admin", "/api/world").json()
    assert next(i for i in world["instances"] if i["id"] == inst["id"])["version"] == 1  # instance inchangée
    old = api.get("joueur", "/api/catalog/definitions", params={"keys": f"{house['id']}@1"}).json()
    assert old[f"{house['id']}@1"]["definition"]["footprint"]["w"] == 2  # ancienne version toujours servie
    prev = api.get("publieur", f"/api/assets/{house['id']}/migration", params={"to": 2}).json()
    assert prev["blocked"] == 1
    res = api.post("publieur", f"/api/assets/{house['id']}/migrate", {"to_version": 2}).json()
    assert res["migrated"] == [] and res["skipped"] == [inst["id"]]

    # v3 : changement de couleur seulement -> migration possible
    api.post("editeur", f"/api/assets/{house['id']}/new-draft")
    d3 = copy.deepcopy(d); d3["materials"]["wall"] = "#ffffff"
    api.put("editeur", f"/api/assets/{house['id']}/draft", {"definition": d3})
    api.publish_flow(house["id"])
    res = api.post("publieur", f"/api/assets/{house['id']}/migrate", {"to_version": 3}).json()
    assert res["migrated"] == [inst["id"]]
    versions = {v["version"]: v["status"] for v in api.detail(house["id"])["versions"]}
    assert versions == {1: "superseded", 2: "superseded", 3: "published"}


# ------------------------------------------------------------------ Scénario H
def test_scenario_h_unauthorized(api):
    shop = api.by_tech("boutique-quartier")
    d = api.detail(shop["id"])["definition"]
    assert api.c.get("/api/assets").status_code == 401
    assert api.get("joueur", "/api/assets").status_code == 403
    assert api.post("joueur", "/api/assets", {"category": "commerce", "technical_name": "pirate", "definition": d}).status_code == 403
    assert api.post("joueur", f"/api/assets/{shop['id']}/duplicate", {"technical_name": "p2", "name": "P2"}).status_code == 403
    assert api.post("joueur", f"/api/assets/{shop['id']}/publish").status_code == 403
    assert api.post("joueur", f"/api/assets/{shop['id']}/archive").status_code == 403
    assert api.post("editeur", f"/api/assets/{shop['id']}/publish").status_code == 403   # séparation des rôles
    assert api.post("editeur", f"/api/assets/{shop['id']}/approve").status_code == 403
    assert api.post("publieur", "/api/assets", {"category": "commerce", "technical_name": "p3", "definition": d}).status_code == 403
    inst = api.get("joueur", "/api/world").json()["instances"][0]
    assert api.c.delete(f"/api/world/instances/{inst['id']}", headers=api.as_("joueur")).status_code == 403
    assert api.c.post("/api/auth/login", json={"username": "admin", "password": "faux"}).status_code == 401


# ------------------------------------------------------------------ cycle de vie, placement, catalogue
def test_status_transitions(api):
    studio = api.by_tech("interieur-studio-base")
    r = api.post("editeur", "/api/assets", {"category": "residential", "technical_name": "m-trans", "definition": player_house(studio["id"])})
    aid = r.json()["id"]
    assert api.post("publieur", f"/api/assets/{aid}/publish").status_code == 409     # brouillon -> publié interdit
    assert api.post("publieur", f"/api/assets/{aid}/approve").status_code == 409
    api.post("editeur", f"/api/assets/{aid}/submit")
    assert api.put("editeur", f"/api/assets/{aid}/draft", {"definition": r.json()["definition"]}).status_code == 409
    assert api.post("publieur", f"/api/assets/{aid}/reject").json()["status"] == "draft"


def test_family_mismatch_archived_and_unknown_category(api):
    # Depuis le Studio v1, toutes les familles sont implémentées : une définition de bâtiment posée dans une
    # catégorie « véhicule » est acceptée en brouillon mais rejetée par la validation de la famille.
    shop = api.by_tech("boutique-quartier")
    d = api.detail(shop["id"])["definition"]
    r = api.post("editeur", "/api/assets", {"category": "vehicles", "technical_name": "woro-woro", "definition": d})
    assert r.status_code == 201
    codes = {i["code"] for i in r.json()["validation"]["items"]}
    assert {"representation", "vehicle.entrances"} <= codes or "schema" in codes
    assert api.post("editeur", f"/api/assets/{r.json()['id']}/submit").status_code == 422
    # catégorie archivée : plus de création
    assert api.patch("admin", "/api/categories/vehicles", {"archived": True}).status_code == 200
    r = api.post("editeur", "/api/assets", {"category": "vehicles", "technical_name": "woro-woro-2", "definition": d})
    assert r.status_code == 422 and "archivée" in r.json()["detail"]
    assert api.post("editeur", "/api/assets", {"category": "nope", "technical_name": "x", "definition": d}).status_code == 422


def test_duplicate_technical_name(api):
    shop = api.by_tech("boutique-quartier")
    assert api.post("editeur", f"/api/assets/{shop['id']}/duplicate", {"technical_name": "boutique-quartier", "name": "Copie"}).status_code == 409


def test_placement_rules(api):
    shop = api.by_tech("boutique-quartier")["id"]
    chk = lambda x, y, rot=0: {i["code"] for i in api.post("admin", "/api/world/check", {"asset_id": shop, "x": x, "y": y, "rotation": rot}).json()["items"]}
    assert "bounds" in chk(39, 5)
    assert "terrain" in chk(5, 37)              # lagune
    assert "collision" in chk(12, 9)            # boutique existante / route
    assert "entrance.blocked" in chk(12, 6)     # l'entrée donne sur la boutique existante
    assert "entrance.road_access" in chk(4, 2)  # avertissement : loin de la route
    assert chk(4, 8) == set() or chk(4, 8) <= {"road.dead_end"}


def test_rotation_moves_entrance(api):
    from app import geometry as g
    d = {"footprint": {"kind": "rect", "w": 3, "d": 2}, "entrances": [{"id": "p", "cell": [0, 1], "side": "S", "kind": "main"}]}
    e = g.placed_entrances(d, 10, 10, 90)[0]
    assert e["side"] == "W" and e["cell"] == (10, 10) and e["front"] == (9, 10)
    assert sorted(g.placed_cells(d, 10, 10, 90)) == [(10, 10), (10, 11), (10, 12), (11, 10), (11, 11), (11, 12)]


def test_archive_removes_from_catalog_but_keeps_instances(api):
    shop = api.by_tech("boutique-quartier")
    assert api.post("publieur", f"/api/assets/{shop['id']}/archive").status_code == 200
    assert shop["id"] not in {c["asset_id"] for c in api.get("joueur", "/api/catalog").json()}
    assert any(i["asset_id"] == shop["id"] for i in api.get("joueur", "/api/world").json()["instances"])
    assert api.post("joueur", "/api/world/instances", {"asset_id": shop["id"], "x": 4, "y": 8}).status_code == 409
    assert api.post("publieur", f"/api/assets/{shop['id']}/restore").json()["status"] == "published"


def test_composite_footprint(api):
    shop = api.by_tech("boutique-quartier")
    d = api.detail(shop["id"])["definition"]
    d["footprint"] = {"kind": "cells", "w": 1, "d": 1, "cells": [[0, 0], [1, 0], [0, 1], [2, 2]]}
    r = api.post("editeur", "/api/assets", {"category": "commerce", "technical_name": "en-l", "definition": d})
    assert "footprint.disconnected" in {i["code"] for i in r.json()["validation"]["items"]}


def test_audit_log(api):
    shop = api.by_tech("boutique-quartier")
    api.post("editeur", f"/api/assets/{shop['id']}/duplicate", {"technical_name": "audit-dup", "name": "Audit dup"})
    log = api.get("admin", "/api/audit").json()
    assert any(e["action"] == "asset.create" and e["username"] == "editeur" for e in log)
    assert api.get("editeur", "/api/audit").status_code == 403
