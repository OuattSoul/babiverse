"""Tests du Studio v1 : migration, persistance, permissions, médiathèque, personnages, nouvelles familles,
comportements, façades, versions, import/export, intégration au jeu."""
import copy
import io
import json
import sqlite3
import time
import zipfile

import pytest
from fastapi.testclient import TestClient

from app import auth
from app.db import SCHEMA_V1, SCHEMA_VERSION, schema_version
from app.main import create_app

from .conftest import PG_URL, Api, clone, new_db

PNG_1x1 = bytes.fromhex("89504e470d0a1a0a0000000d4948445200000001000000010806000000"
                        "1f15c4890000000d49444154789c6300010000000500010d0a2db40000000049454e44ae426082")
SVG_OK = b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 380"><path d="M70 220 L130 220 L130 300 L70 300 Z" fill="#336699"/>' \
         b'<circle cx="100" cy="260" r="10" fill="#ffcc00"/></svg>'


def upload(api: Api, data: bytes, filename="f.svg", user="editeur", **params):
    return api.upload(user, "/api/media", data, filename=filename, **params)


def part_def(name, slot, media_id, **props):
    return {"name": name, "representation": "svg", "footprint": {"kind": "rect", "w": 1, "d": 1},
            "properties": {"slot": slot, "svg_media": media_id, **props}}


def tech_id(api, tech):
    return api.by_tech(tech)["id"]


# ---------------------------------------------------------------- migration et persistance

@pytest.mark.skipif(PG_URL is not None, reason="le prototype v0.1 n'a existé qu'en SQLite")
def test_migration_from_prototype_v01_database(tmp_path):
    path = tmp_path / "old.db"
    c = sqlite3.connect(path)
    c.executescript(SCHEMA_V1)
    c.execute("INSERT INTO users (username, pw_hash, role) VALUES ('admin', ?, 'admin')", (auth.hash_password("admin"),))
    c.execute("INSERT INTO world (id, width, height, terrain) VALUES (1, 12, 12, ?)", (json.dumps(["g" * 12] * 12),))
    d = {"name": "Vieille maison", "representation": "procedural", "footprint": {"kind": "rect", "w": 2, "d": 2}, "height_m": 4,
         "entrances": [{"id": "p", "cell": [0, 1], "side": "S", "kind": "main"}], "materials": {"wall": "#ffffff", "roof": "#aa0000", "trim": "#000000"},
         "properties": {"floors": 1}}
    c.execute("INSERT INTO assets VALUES ('old-1','vieille-maison','commerce','building','x',1,1,0,1,1,NULL)")
    c.execute("INSERT INTO asset_versions VALUES ('old-1',1,'published',?,NULL,'x',1,1,1)", (json.dumps(d),))
    c.execute("INSERT INTO instances VALUES ('i-1','old-1',1,2,2,0,NULL,1,1)")
    c.commit(); c.close()
    app = create_app(str(path), with_content=False)
    conn = app.state.conn
    assert schema_version(conn) == SCHEMA_VERSION
    row = conn.execute("SELECT scene_id, data FROM instances WHERE id='i-1'").fetchone()
    assert row["scene_id"] == "main" and row["data"] == "{}"
    scene = conn.execute("SELECT * FROM scenes WHERE id='main'").fetchone()
    assert (scene["width"], scene["height"]) == (12, 12)
    assert conn.execute("SELECT active FROM users WHERE username='admin'").fetchone()[0] == 1
    with TestClient(app) as client:
        api = Api(client)
        detail = api.detail("old-1")
        assert detail["published_version"] == 1 and detail["definition"]["name"] == "Vieille maison"
        assert detail["usage"]["instances"][0]["scene_id"] == "main"
        # l'ancien hachage (3 segments) reste accepté
        assert client.post("/api/auth/login", json={"username": "admin", "password": "admin"}).status_code == 200
    # une seconde ouverture n'applique rien de plus
    from app.db import migrate
    assert migrate(conn) == []


def test_persistence_after_restart(tmp_path, template_dir):
    db = clone(template_dir, tmp_path)
    app = create_app(db)
    with TestClient(app) as client:
        api = Api(client)
        m = upload(api, SVG_OK, "jupe.svg", name="Jupe test").json()
        r = api.post("editeur", "/api/assets", {"category": "character_parts", "technical_name": "jupe-test",
                                                "definition": part_def("Jupe test", "bottom", m["id"], anchor="waist")})
        aid = r.json()["id"]
        d = r.json()["definition"]
        d["variants"] = []
        d["description"] = "brouillon modifié"
        assert api.put("editeur", f"/api/assets/{aid}/draft", {"definition": d}).status_code == 200
        scene = api.post("editeur", "/api/scenes", {"name": "Ma scène", "width": 20, "height": 20, "template": "blank"}).json()
    app.state.conn.close()
    app2 = create_app(db)  # « redémarrage »
    with TestClient(app2) as client:
        api = Api(client)
        a = api.detail(aid)
        assert a["status"] == "draft" and a["definition"]["description"] == "brouillon modifié"
        med = api.get("admin", f"/api/media/{m['id']}").json()
        f = client.get(med["url"])
        assert f.status_code == 200 and f.headers["content-type"].startswith("image/svg+xml") and b"<svg" in f.content
        assert f.headers["content-security-policy"].startswith("default-src 'none'")
        assert any(s["id"] == scene["id"] for s in api.get("admin", "/api/scenes").json())


def test_media_stored_in_database_survive_without_media_dir(tmp_path, monkeypatch):
    """Hébergeur sans disque persistant : les fichiers vivent en base et le dossier des médias peut disparaître."""
    monkeypatch.setenv("BABIVERSE_MEDIA_STORAGE", "database")
    monkeypatch.setenv("BABIVERSE_MEDIA_DIR", str(tmp_path / "ephemere"))
    db = new_db(tmp_path, "blobs.db")
    app = create_app(db, with_content=False)
    with TestClient(app) as client:
        api = Api(client)
        m = upload(api, SVG_OK, "jupe.svg", name="Jupe base").json()
        png = upload(api, PNG_1x1, "p.png", name="Point").json()
        assert api.get("admin", "/api/system").json()["media_storage"] == "database"
    app.state.conn.close()
    assert not any(f.is_file() for f in (tmp_path / "ephemere").rglob("*"))  # rien sur disque
    app2 = create_app(db, with_content=False)  # « redémarrage » sur un disque vierge
    with TestClient(app2) as client:
        api = Api(client)
        for mid, needle in ((m["id"], b"<svg"), (png["id"], b"PNG")):
            f = client.get(api.get("admin", f"/api/media/{mid}").json()["url"])
            assert f.status_code == 200 and needle in f.content
        sha = api.get("admin", f"/api/media/{m['id']}").json()["sha256"]
        assert app2.state.conn.execute("SELECT COUNT(*) FROM media_blobs WHERE sha256=?", (sha,)).fetchone()[0] == 1
    app2.state.conn.close()


# ---------------------------------------------------------------- authentification et permissions

def test_permissions_by_role(api):
    shop = tech_id(api, "boutique-quartier")
    assert api.get("lecteur", "/api/assets").status_code == 200
    assert api.post("lecteur", f"/api/assets/{shop}/duplicate", {"technical_name": "copie-lecteur", "name": "Copie"}).status_code == 403
    assert api.get("joueur", "/api/assets").status_code == 403
    assert api.get("joueur", "/api/catalog").status_code == 200
    assert upload(api, SVG_OK, user="lecteur").status_code == 403
    assert api.post("editeur", "/api/export", {"asset_ids": [shop]}).status_code == 200
    assert api.upload("editeur", "/api/imports", b"x").status_code == 403
    assert api.get("editeur", "/api/users").status_code == 403
    assert api.post("editeur", "/api/categories", {"key": "x-cat", "label": "X cat", "family": "prop"}).status_code == 403
    assert api.get("publieur", "/api/audit").status_code == 200
    assert api.post("editeur", f"/api/assets/{shop}/revert", {"from_version": 1}).status_code == 403
    assert api.c.get("/api/assets").status_code == 401


def test_session_logout_lockout_and_user_management(api):
    h = api.as_("admin")
    assert api.c.post("/api/auth/logout", headers=h).status_code == 204
    assert api.c.get("/api/auth/me", headers=h).status_code == 401
    api.tokens.pop("admin")
    for _ in range(5):
        assert api.c.post("/api/auth/login", json={"username": "publieur", "password": "faux"}).status_code == 401
    assert api.c.post("/api/auth/login", json={"username": "publieur", "password": "publieur"}).status_code == 429
    auth.reset_failures()
    # gestion des utilisateurs
    assert api.post("admin", "/api/users", {"username": "awa", "password": "court", "role": "editor"}).status_code == 422
    u = api.post("admin", "/api/users", {"username": "awa", "password": "Akwaba-2026-ok", "role": "editor"})
    assert u.status_code == 201
    tok = api.c.post("/api/auth/login", json={"username": "awa", "password": "Akwaba-2026-ok"}).json()["token"]
    assert api.c.get("/api/auth/me", headers={"Authorization": f"Bearer {tok}"}).json()["role"] == "editor"
    assert api.patch("admin", f"/api/users/{u.json()['id']}", {"active": False}).status_code == 200
    assert api.c.get("/api/auth/me", headers={"Authorization": f"Bearer {tok}"}).status_code == 401
    admin_id = next(x["id"] for x in api.get("admin", "/api/users").json() if x["username"] == "admin")
    assert api.patch("admin", f"/api/users/{admin_id}", {"role": "editor"}).status_code == 409  # dernier administrateur
    # changement de mot de passe : les autres sessions sont fermées
    other = api.c.post("/api/auth/login", json={"username": "editeur", "password": "editeur"}).json()["token"]
    r = api.c.post("/api/auth/password", headers=api.as_("editeur"), json={"current_password": "editeur", "new_password": "Nouveau-Mot-2026"})
    assert r.status_code == 204
    assert api.c.get("/api/auth/me", headers={"Authorization": f"Bearer {other}"}).status_code == 401
    assert api.c.get("/api/auth/me", headers=api.as_("editeur")).status_code == 200
    actions = {e["action"] for e in api.get("admin", "/api/audit").json()}
    assert {"user.create", "user.update", "user.password", "auth.login"} <= actions


def test_production_refuses_missing_secrets(tmp_path, monkeypatch):
    monkeypatch.setenv("BABIVERSE_ENV", "production")
    db = new_db(tmp_path, "p.db")
    with pytest.raises(RuntimeError):
        create_app(db)
    monkeypatch.setenv("BABIVERSE_SECRET", "s" * 40)
    monkeypatch.setenv("BABIVERSE_ADMIN_USER", "chef")
    monkeypatch.setenv("BABIVERSE_ADMIN_PASSWORD", "Un-Mot-De-Passe-Long-2026")
    app = create_app(db, with_content=False)
    names = {r[0] for r in app.state.conn.execute("SELECT username FROM users")}
    assert names == {"chef"}  # aucun compte de développement en production
    app.state.conn.close()


def test_production_disables_dev_accounts_of_a_dev_database(tmp_path, template_dir, monkeypatch):
    db = clone(template_dir, tmp_path)
    monkeypatch.setenv("BABIVERSE_ENV", "production")
    monkeypatch.setenv("BABIVERSE_SECRET", "s" * 40)
    monkeypatch.setenv("BABIVERSE_ADMIN_USER", "chef")
    monkeypatch.setenv("BABIVERSE_ADMIN_PASSWORD", "Un-Mot-De-Passe-Long-2026")
    app = create_app(db, with_content=False)
    active = {r[0] for r in app.state.conn.execute("SELECT username FROM users WHERE active=1")}
    assert active == {"chef"}
    with TestClient(app) as client:
        assert client.post("/api/auth/login", json={"username": "admin", "password": "admin"}).status_code == 401
        assert client.post("/api/auth/login", json={"username": "chef", "password": "Un-Mot-De-Passe-Long-2026"}).status_code == 200


# ---------------------------------------------------------------- catégories configurables

def test_admin_creates_category_without_code(api):
    r = api.post("admin", "/api/categories", {"key": "marche-couvert", "label": "Marchés", "family": "building",
                                              "rules": ["shop_required"], "subcategories": ["Marché de Treichville"]})
    assert r.status_code == 201
    assert api.post("admin", "/api/categories", {"key": "x-y", "label": "X", "family": "spaceship"}).status_code == 422
    assert api.post("admin", "/api/categories", {"key": "x-z", "label": "Xz", "family": "prop", "rules": ["inconnue"]}).status_code == 422
    shop = api.detail(tech_id(api, "boutique-quartier"))["definition"]
    shop["subcategory"] = "Marché de Treichville"
    a = api.post("editeur", "/api/assets", {"category": "marche-couvert", "technical_name": "marche-treichville", "definition": shop}).json()
    assert a["validation"]["ok"], a["validation"]
    api.publish_flow(a["id"])
    assert any(c["asset_id"] == a["id"] and c["category"] == "marche-couvert" for c in api.get("joueur", "/api/catalog").json())
    tax = api.get("lecteur", "/api/taxonomy").json()
    assert any(c["key"] == "marche-couvert" for c in tax["categories"])
    assert all(set(f["capabilities"]) >= {"create", "edit", "preview", "place", "variants", "import", "export", "behaviors", "publish"}
               for f in tax["families"].values())


# ---------------------------------------------------------------- médiathèque et sécurité des fichiers

def test_svg_sanitization_and_type_checks(api):
    evil = (b'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 10 10" onload="alert(1)">'
            b'<script>alert(1)</script><foreignObject><div>x</div></foreignObject>'
            b'<image href="https://evil.example/x.png"/><a href="javascript:alert(1)"><rect width="5" height="5"/></a>'
            b'<rect width="10" height="10" style="fill:url(https://evil.example/p);stroke:#000"/>'
            b'<use xlink:href="https://evil.example/s.svg#x"/><circle cx="5" cy="5" r="4" fill="#ff0000"/></svg>')
    r = upload(api, evil, "evil.svg")
    assert r.status_code == 201, r.text
    m = r.json()
    svg = api.get("editeur", f"/api/media/{m['id']}/svg").json()["svg"]
    for bad in ("script", "onload", "foreignObject", "evil.example", "javascript", "<image", "<a "):
        assert bad not in svg
    assert "<circle" in svg and m["meta"]["warnings"]
    assert upload(api, b'<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x "y">]><svg viewBox="0 0 1 1"/>').status_code == 422
    assert upload(api, b'<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>').status_code == 422  # pas de viewBox
    assert upload(api, b"glTF\x02\x00\x00\x00rest", "x.glb").status_code == 422
    assert upload(api, b"not an image at all", "x.png").status_code == 422
    png = upload(api, PNG_1x1, "pixel.png", category="sprite")
    assert png.status_code == 201 and png.json()["kind"] == "raster" and (png.json()["width"], png.json()["height"]) == (1, 1)
    big = upload(api, b"\x89PNG\r\n\x1a\n" + b"0" * (6 * 1024 * 1024), "big.png")
    assert big.status_code == 413
    url = png.json()["url"]
    assert api.c.get(url.replace("sig=", "sig=0")).status_code == 403
    assert api.c.get(url).status_code == 200


def test_media_replace_keeps_references_and_published_pins(api):
    m = upload(api, SVG_OK, "jupe.svg", category="character_part").json()
    assert m["meta"]["recolorable"] is False and set(m["meta"]["colors"]) == {"#336699", "#ffcc00"}
    # convention de couleurs : #336699 devient le canal « primary »
    m2 = api.post("editeur", f"/api/media/{m['id']}/channels", {"mapping": {"#336699": "primary"}}).json()
    assert m2["revision"] == 2 and "primary" in m2["meta"]["channels"]
    a = api.post("editeur", "/api/assets", {"category": "character_parts", "technical_name": "jupe-pin",
                                            "definition": part_def("Jupe", "bottom", m["id"], anchor="waist")}).json()
    api.publish_flow(a["id"])
    pins = api.detail(a["id"])["versions"][0]["pins"]
    assert pins["media"][m["id"]] == 2
    # remplacement : même identifiant, nouvelle révision ; la version publiée garde la révision 2
    r = api.upload("editeur", f"/api/media/{m['id']}/replace", SVG_OK.replace(b"#ffcc00", b"#00aa00"), filename="jupe-v3.svg")
    assert r.status_code == 200 and r.json()["revision"] == 3
    usage = api.get("admin", f"/api/media/{m['id']}").json()["usage"]
    assert usage[0]["asset_id"] == a["id"] and usage[0]["pinned_revision"] == 2
    # archivage refusé tant que le fichier est utilisé
    assert api.post("publieur", f"/api/media/{m['id']}/archive").status_code == 409
    other = upload(api, SVG_OK, "libre.svg").json()
    assert api.post("editeur", f"/api/media/{other['id']}/archive").json()["archived"] is True
    assert api.patch("editeur", f"/api/media/{other['id']}", {"name": "Renommé", "tags": ["test"]}).json()["name"] == "Renommé"


# ---------------------------------------------------------------- personnages modulaires

def character_def(api, **over):
    ids = {k: tech_id(api, f"part-{k}") for k in ("corps-homme", "yeux-ronds", "coiffure-afro", "tshirt", "short", "baskets",
                                                   "casquette", "robe", "boubou", "corps-femme", "chaussures-ville", "motif-rayures")}
    d = {"name": "Habitant test", "representation": "svg", "footprint": {"kind": "rect", "w": 1, "d": 1},
         "placement": {"allowed_terrain": ["ground"], "road_access": "none"},
         "properties": {"body": ids["corps-homme"], "skin": "#8d5524",
                        "layers": {"eyes": {"part": ids["yeux-ronds"]}, "hair": {"part": ids["coiffure-afro"]},
                                   "top": {"part": ids["tshirt"], "colors": {"primary": "#123456"},
                                           "pattern": {"part": ids["motif-rayures"], "colors": {"secondary": "#ffffff"}}},
                                   "bottom": {"part": ids["short"]}, "shoes": {"part": ids["baskets"]}}}}
    d.update(over)
    return d, ids


def test_character_composition_rules(api, deep):
    d, ids = character_def(api)
    r = api.post("editeur", "/api/assets", {"category": "characters", "technical_name": "habitant-test", "definition": d}).json()
    assert r["validation"]["ok"], r["validation"]
    assert r["definition"]["height_m"] == 1.75 and r["definition"]["collision"] == "none"
    aid = r["id"]

    def codes(defn):
        res = api.put("editeur", f"/api/assets/{aid}/draft", {"definition": defn}).json()
        return {i["code"] for i in res["validation"]["items"]}

    bad = deep(d); bad["properties"]["layers"]["headwear"] = {"part": ids["casquette"]}
    assert "character.incompatible" in codes(bad)                      # casquette + afro
    bad = deep(d); bad["properties"]["layers"]["dress"] = {"part": ids["robe"]}
    assert "character.incompatible" in codes(bad)                      # robe + haut + bas
    bad = deep(d); del bad["properties"]["layers"]["bottom"]
    assert "character.outfit" in codes(bad)                            # tenue incomplète
    bad = deep(d); bad["properties"]["layers"]["top"] = {"part": ids["short"]}
    assert "character.part_slot" in codes(bad)                         # mauvais emplacement
    bad = deep(d); bad["properties"]["layers"]["shoes"] = {"part": ids["chaussures-ville"], "colors": {"primary": "#00ff00"}}
    assert "character.palette" in codes(bad)                           # couleur hors palette
    bad = deep(d); bad["properties"]["layers"]["beard"] = {"part": tech_id(api, "part-barbe-courte")}
    bad["properties"]["body"] = ids["corps-femme"]
    assert "character.gender" in codes(bad)                            # barbe : réservée aux silhouettes masculines
    # variante : la tenue de la variante est vérifiée aussi
    var = deep(d); var["variants"] = [{"id": "boubou", "name": "Boubou", "props": {"layers": {"dress": {"part": ids["boubou"]}, "top": None}}}]
    assert "character.incompatible" in codes(var)
    var["variants"][0]["props"]["layers"]["bottom"] = None
    assert codes(var) <= {"behavior.preview_only"}
    api.publish_flow(aid)
    # rendu : composants exacts, versions figées
    render = api.get("lecteur", f"/api/assets/{aid}/render").json()
    assert render["pinned"] and ids["tshirt"] in render["parts"] and ids["motif-rayures"] in render["parts"]
    tshirt = render["parts"][ids["tshirt"]]
    assert "var(--babi-primary" in tshirt["front"] and tshirt["slot"] == "top"
    assert "data-babi-layer" in render["parts"][ids["coiffure-afro"]]["back"]
    # un composant non publié bloque la publication d'un personnage
    m = upload(api, SVG_OK).json()
    p = api.post("editeur", "/api/assets", {"category": "character_parts", "technical_name": "short-brouillon",
                                            "definition": part_def("Short brouillon", "bottom", m["id"])}).json()
    d2 = deep(d); d2["properties"]["layers"]["bottom"] = {"part": p["id"]}
    c2 = api.post("editeur", "/api/assets", {"category": "characters", "technical_name": "habitant-2", "definition": d2}).json()
    assert "character.unpublished" in {i["code"] for i in c2["validation"]["items"]}
    assert api.post("editeur", f"/api/assets/{c2['id']}/submit").status_code == 200
    rej = api.post("publieur", f"/api/assets/{c2['id']}/approve")
    assert rej.status_code == 422 and "character.unpublished" in {i["code"] for i in rej.json()["report"]["items"]}
    # archivage d'un composant utilisé par un personnage publié : refusé
    assert api.post("publieur", f"/api/assets/{ids['tshirt']}/archive").status_code == 409


def test_part_validation_body_anchors_and_library(api):
    m = upload(api, SVG_OK).json()
    r = api.post("editeur", "/api/assets", {"category": "character_parts", "technical_name": "corps-incomplet",
                                            "definition": part_def("Corps incomplet", "body", m["id"], anchors={"eyes": [100, 60]})}).json()
    assert "part.body_anchors" in {i["code"] for i in r["validation"]["items"]}
    r = api.post("editeur", "/api/assets", {"category": "character_parts", "technical_name": "slot-faux",
                                            "definition": part_def("Faux", "aile", m["id"])}).json()
    assert "part.slot" in {i["code"] for i in r["validation"]["items"]}
    png = upload(api, PNG_1x1, "p.png").json()
    r = api.post("editeur", "/api/assets", {"category": "character_parts", "technical_name": "png-part",
                                            "definition": part_def("PNG", "top", png["id"])}).json()
    assert "part.svg" in {i["code"] for i in r["validation"]["items"]}
    lib = api.get("lecteur", "/api/characters/parts").json()
    slots = {p["slot"] for p in lib}
    assert {"body", "hair", "eyes", "eyebrows", "nose", "mouth", "beard", "top", "bottom", "dress", "outerwear", "shoes",
            "headwear", "glasses", "bag", "watch", "jewelry", "pattern", "hair_accessory"} <= slots
    body = next(p for p in lib if p["technical_name"] == "part-corps-femme")
    assert body["props"]["anchors"]["eyes"] == [100, 64]


# ---------------------------------------------------------------- nouvelles familles et placement

def test_vehicle_surface_prop_character_placement(api):
    taxi = tech_id(api, "taxi-compteur")
    car = tech_id(api, "voiture-particuliere")
    lawn = tech_id(api, "pelouse")
    parking = tech_id(api, "parking-4-places")
    tree = tech_id(api, "arbre-fromager")
    shop = tech_id(api, "boutique-quartier")
    kouadio = tech_id(api, "habitant-kouadio")
    chk = lambda aid, x, y, rot=0: {i["code"] for i in api.post("admin", "/api/world/check", {"asset_id": aid, "x": x, "y": y, "rotation": rot}).json()["items"]}
    assert "vehicle.off_road" in chk(taxi, 3, 3)
    assert chk(taxi, 14, 10, 90) == set()                                    # sur l'avenue
    assert "vehicle.off_road" not in chk(car, 35, 13)                        # sur le parking
    assert "vehicle.off_road" in chk(car, 3, 3)
    assert "collision" in chk(lawn, 4, 15)                                    # chevauche la pelouse existante
    assert "collision" in chk(lawn, 0, 9)                                     # sur la route
    assert "surface.not_buildable" in chk(shop, 33, 13)                       # parking non constructible
    assert chk(tree, 4, 16) == set()                                          # pelouse constructible
    assert "character.inside" in chk(kouadio, 12, 8)                          # dans la boutique
    assert "terrain" in chk(kouadio, 5, 38)                                   # dans la lagune
    r = api.post("joueur", "/api/world/instances", {"asset_id": taxi, "x": 14, "y": 10, "rotation": 90, "variant_id": "woro-woro-vert"})
    assert r.status_code == 201
    # bassin de lagune : l'eau remplace le terrain sous lui
    basin = tech_id(api, "bassin-lagune")
    assert api.post("admin", "/api/world/instances", {"asset_id": basin, "x": 2, "y": 2}).status_code == 201
    assert "terrain" in chk(kouadio, 3, 3)
    # meuble, intérieur et composant ne se placent pas en ville
    for tech in ("lit-medical", "interieur-studio-base", "part-tshirt"):
        assert api.post("admin", "/api/world/instances", {"asset_id": tech_id(api, tech), "x": 1, "y": 30}).status_code == 422


def test_scenes_are_separate_test_worlds(api):
    s = api.post("editeur", "/api/scenes", {"name": "Plage test", "width": 16, "height": 12, "template": "lagoon"}).json()
    assert s["kind"] == "test" and "production" in s["notice"]
    tree = tech_id(api, "palmier")
    r = api.post("editeur", f"/api/scenes/{s['id']}/instances", {"asset_id": tree, "x": 0, "y": 0, "label": "Palmier du coin"})
    assert r.status_code == 201 and r.json()["instance"]["data"]["label"] == "Palmier du coin"
    iid = r.json()["instance"]["id"]
    assert api.patch("editeur", f"/api/scenes/{s['id']}/instances/{iid}", {"x": 1, "rotation": 90}).json()["x"] == 1
    main_count = len(api.get("admin", "/api/world").json()["instances"])
    dup = api.post("editeur", f"/api/scenes/{s['id']}/duplicate", {"name": "Plage bis"}).json()
    assert len(dup["instances"]) == 1
    assert len(api.get("admin", "/api/world").json()["instances"]) == main_count  # la scène principale n'a pas bougé
    assert api.c.delete(f"/api/scenes/{s['id']}/instances/{iid}", headers=api.as_("joueur")).status_code == 403  # pas son objet
    assert api.delete("editeur", f"/api/scenes/{s['id']}").status_code == 204
    assert api.get("admin", f"/api/scenes/{s['id']}").status_code == 404
    assert api.delete("admin", "/api/scenes/main").status_code == 409


def test_furniture_assets_and_interior_circulation(api, deep):
    bed = tech_id(api, "lit-medical")
    clinic = api.by_tech("interieur-cabinet-medical")
    assert clinic["status"] == "published"
    assert api.post("publieur", f"/api/assets/{bed}/archive").status_code == 409  # utilisé par un intérieur publié
    studio = api.detail(tech_id(api, "interieur-studio-base"))
    api.post("editeur", f"/api/assets/{studio['id']}/new-draft")
    d = deep(studio["definition"])
    # mur de meubles devant la porte de la chambre : la chambre devient inatteignable à pied
    d["properties"]["furniture"].append({"id": "mur", "item": "sofa", "x": 0, "y": 4, "w": 2, "d": 1})
    d["properties"]["furniture"].append({"id": "mur2", "item": "sofa", "x": 3, "y": 4, "w": 2, "d": 1})
    d["properties"]["furniture"].append({"id": "mur3", "item": bed, "x": 7, "y": 2, "w": 1, "d": 2, "interactive": True, "action": "sleep"})
    rep = api.put("editeur", f"/api/assets/{studio['id']}/draft", {"definition": d}).json()["validation"]
    codes = {i["code"] for i in rep["items"]}
    assert "furniture.unreachable" in codes or "room.blocked" in codes
    d["properties"]["furniture"][-1]["action"] = "cook"
    rep = api.put("editeur", f"/api/assets/{studio['id']}/draft", {"definition": d}).json()["validation"]
    assert "furniture.action" in {i["code"] for i in rep["items"]}


def test_behaviors_and_facade_modules(api, deep):
    house = api.detail(tech_id(api, "maison-moderne-etage"))
    assert house["status"] == "published"
    api.post("editeur", f"/api/assets/{house['id']}/new-draft")
    d = deep(house["definition"])

    def codes(defn):
        return {i["code"] for i in api.put("editeur", f"/api/assets/{house['id']}/draft", {"definition": defn}).json()["validation"]["items"]}

    x = deep(d); x["behaviors"].append({"id": "teleport", "params": {}})
    assert "behavior.unknown" in codes(x)
    x = deep(d); x["behaviors"].append({"id": "sleep", "params": {}})
    assert "behavior.family" in codes(x)
    x = deep(d); x["behaviors"].append({"id": "shop", "params": {"goods_slots": 999}})
    assert "behavior.param" in codes(x)
    x = deep(d); x["properties"]["interiors"] = []; x["properties"]["ownership"] = "npc"
    assert "behavior.requires" in codes(x)
    # zone d'interaction : identifiant vide (cas de l'assistant avant correctif) puis zone déclarée
    x = deep(d); x["behaviors"].append({"id": "interaction_zone", "params": {"zone_id": ""}})
    items = api.put("editeur", f"/api/assets/{house['id']}/draft", {"definition": x}).json()["validation"]["items"]
    assert any(i["code"] == "behavior.requires" and "choisissez" in i["message"] for i in items)
    x["zones"].append({"id": "accueil", "kind": "interaction", "label": "Accueil", "cells": [[0, 2]]})
    x["behaviors"][-1]["params"]["zone_id"] = "accueil"
    assert "behavior.requires" not in codes(x)
    x = deep(d); x["properties"]["facade"].append({"cell": [0, 1], "side": "S", "floor": 0, "module": "balcony"})
    c = codes(x)
    assert "facade.upper_only" in c and "facade.duplicate" in c
    x = deep(d); x["properties"]["facade"].append({"cell": [0, 0], "side": "N", "floor": 1, "module": "door"})
    assert "facade.ground_only" in codes(x)
    x = deep(d); x["properties"]["facade"].append({"cell": [0, 0], "side": "S", "floor": 0, "module": "window"})
    assert "facade.inner" in codes(x)
    x = deep(d); x["properties"]["facade"].append({"cell": [0, 0], "side": "W", "floor": 5, "module": "window"})
    assert "facade.floor" in codes(x)
    x = deep(d); x["default_variant"] = "inexistante"
    assert "variant.default" in codes(x)
    x = deep(d); x["default_variant"] = "ocre"
    assert codes(x) <= {"entrance.road_access"}
    usage = api.get("lecteur", "/api/behaviors/usage").json()
    assert any(a["id"] == house["id"] for a in usage["assignable_home"])


# ---------------------------------------------------------------- versions

def test_revert_and_diff(api, deep):
    shop = api.detail(tech_id(api, "boutique-quartier"))
    api.post("editeur", f"/api/assets/{shop['id']}/new-draft")
    d = deep(shop["definition"]); d["materials"]["wall"] = "#000000"; d["properties"]["shop"]["sign_text"] = "MAQUIS"
    api.put("editeur", f"/api/assets/{shop['id']}/draft", {"definition": d})
    api.publish_flow(shop["id"])
    diff = api.get("lecteur", f"/api/assets/{shop['id']}/diff", params={"a": 1, "b": 2}).json()
    paths = {c["path"] for c in diff["changes"]}
    assert {"materials.wall", "properties.shop.sign_text"} <= paths
    r = api.post("admin", f"/api/assets/{shop['id']}/revert", {"from_version": 1}).json()
    assert r["latest_version"] == 3 and r["status"] == "draft" and r["definition"]["materials"]["wall"] == shop["definition"]["materials"]["wall"]
    assert r["versions"][-1]["note"] == "Retour à la version 1"
    assert r["published_version"] == 2  # la version publiée n'est pas touchée
    api.publish_flow(shop["id"])
    v = api.detail(shop["id"])["versions"]
    assert [x["status"] for x in v] == ["superseded", "superseded", "published"]


# ---------------------------------------------------------------- import / export

def test_export_import_roundtrip_into_new_environment(api, tmp_path):
    kouadio = tech_id(api, "habitant-kouadio")
    house = tech_id(api, "maison-moderne-etage")
    scene = api.post("editeur", "/api/scenes", {"name": "Scène exportée", "width": 20, "height": 20, "template": "blank"}).json()
    assert api.post("editeur", f"/api/scenes/{scene['id']}/instances", {"asset_id": house, "x": 2, "y": 2}).status_code == 201
    assert api.post("editeur", f"/api/scenes/{scene['id']}/instances", {"asset_id": kouadio, "x": 6, "y": 6}).status_code == 201
    r = api.post("editeur", "/api/export", {"asset_ids": [kouadio], "include_dependencies": True, "scene_ids": [scene["id"]]})
    assert r.status_code == 200 and r.headers["content-type"] == "application/zip"
    z = zipfile.ZipFile(io.BytesIO(r.content))
    manifest = json.loads(z.read("manifest.json"))
    assert manifest["format"] == "babiverse-studio-bundle" and manifest["format_version"] == 1
    exported = {a["asset_id"] for a in manifest["assets"]}
    assert {kouadio, house, tech_id(api, "part-chemise"), tech_id(api, "part-motif-wax"), tech_id(api, "interieur-studio-base")} <= exported
    assert any(n.startswith("media/") and n.endswith(".svg") for n in z.namelist())

    # environnement neuf, sans contenu
    other = create_app(new_db(tmp_path, "other.db"), with_content=False)
    with TestClient(other) as client:
        api2 = Api(client)
        prev = api2.upload("publieur", "/api/imports", r.content, filename="lot.zip").json()
        assert prev["summary"]["new"] == len(manifest["assets"]) and prev["summary"]["invalid"] == 0
        res = api2.post("publieur", f"/api/imports/{prev['id']}/apply", {}).json()
        assert res["status"] == "applied" and not res["result"]["errors"], res
        assert res["result"]["instances"] == 2
        k2 = api2.detail(kouadio)
        assert k2["published_version"] == api.detail(kouadio)["published_version"]  # identifiants et versions conservés
        render = api2.get("admin", f"/api/assets/{kouadio}/render").json()
        assert set(render["parts"]) == set(api.get("admin", f"/api/assets/{kouadio}/render").json()["parts"])
        part = render["parts"][tech_id(api, "part-chemise")]
        assert "<path" in part["front"]
        scene2 = next(s for s in api2.get("admin", "/api/scenes").json() if s["name"].startswith("Scène exportée"))
        assert scene2["instances"] == 2
        assert api2.get("joueur", "/api/catalog").status_code == 200
        # réimport : tout est identique → ignoré par défaut, rien n'est écrasé
        prev2 = api2.upload("publieur", "/api/imports", r.content).json()
        assert prev2["summary"]["identical"] == len(manifest["assets"])
        res2 = api2.post("publieur", f"/api/imports/{prev2['id']}/apply", {"import_scenes": False}).json()
        assert not res2["result"]["created_assets"] and len(res2["result"]["skipped"]) == len(manifest["assets"])
        # conflit : modifie Kouadio côté cible, réimporte en copie → nouvel identifiant, références renommées
        d = api2.detail(kouadio)["definition"]; d["name"] = "Kouadio modifié"
        api2.post("editeur", f"/api/assets/{kouadio}/new-draft")
        api2.put("editeur", f"/api/assets/{kouadio}/draft", {"definition": d})
        prev3 = api2.upload("publieur", "/api/imports", r.content).json()
        row = next(a for a in prev3["assets"] if a["asset_id"] == kouadio)
        assert row["status"] == "conflict_id" and row["default"] == "skip"
        res3 = api2.post("publieur", f"/api/imports/{prev3['id']}/apply", {"decisions": {kouadio: "copy"}, "import_scenes": False}).json()
        copy_id = res3["result"]["copied_assets"][0]["asset_id"]
        assert copy_id != kouadio and api2.detail(copy_id)["technical_name"].startswith("habitant-kouadio-import")
        assert api2.detail(kouadio)["definition"]["name"] == "Kouadio modifié"  # l'existant n'a pas été écrasé
        # annulation de l'import en copie
        rb = api2.post("publieur", f"/api/imports/{prev3['id']}/rollback").json()
        assert rb["status"] == "rolled_back" and api2.get("admin", f"/api/assets/{copy_id}").status_code == 404
        assert api2.post("publieur", f"/api/imports/{prev3['id']}/rollback").status_code == 409
        # le premier import ne peut plus être annulé : ses assets sont utilisés hors de l'import ? Non : seulement ses scènes.
        hist = api2.get("publieur", "/api/imports").json()
        assert {h["status"] for h in hist} >= {"applied", "rolled_back"}


def test_import_rejects_tampered_or_malicious_archives(api):
    def mk(files: dict) -> bytes:
        b = io.BytesIO()
        with zipfile.ZipFile(b, "w") as z:
            for n, c in files.items():
                z.writestr(n, c)
        return b.getvalue()
    assert api.upload("publieur", "/api/imports", b"pas un zip").status_code == 422
    assert api.upload("publieur", "/api/imports", mk({"x.txt": "x"})).status_code == 422
    assert api.upload("publieur", "/api/imports", mk({"manifest.json": json.dumps({"format": "autre"})})).status_code == 422
    assert api.upload("publieur", "/api/imports", mk({"manifest.json": "{}", "../evil.txt": "x"})).status_code == 422
    shop = tech_id(api, "boutique-quartier")
    good = api.post("editeur", "/api/export", {"asset_ids": [tech_id(api, "part-tshirt")]}).content
    z = zipfile.ZipFile(io.BytesIO(good))
    files = {n: z.read(n) for n in z.namelist()}
    media_name = next(n for n in files if n.startswith("media/"))
    files[media_name] = files[media_name].replace(b"</svg>", b"<script>alert(1)</script></svg>")
    prev = api.upload("publieur", "/api/imports", mk(files)).json()
    assert any(m["status"] == "invalid" and "empreinte" in m["message"] for m in prev["media"])
    assert shop


# ---------------------------------------------------------------- intégration jeu et tableau de bord

def test_game_adapter_and_runtime_catalog(api):
    adapter = api.get("editeur", "/api/runtime/game-adapter").json()
    k = next(c for c in adapter["characters"] if c["technical_name"] == "habitant-kouadio")
    assert k["appearance"]["skin"] in ("#f1c27d", "#c68642", "#8d5524", "#5c3a1e") and k["appearance"]["hair"] == "short"
    assert k["lossy"] and k["lost"]
    yao = next(c for c in adapter["characters"] if c["technical_name"] == "habitant-yao")
    assert yao["appearance"]["hair"] == "afro"
    house = next(b for b in adapter["building_templates"] if b["technical_name"] == "maison-moderne-etage")
    assert house["compatible"] and len(house["template"]["facade"]) == 2 and "D" in house["template"]["facade"]
    assert house["template"]["roof"] in ("r", "o", "g")
    assert "vehicle" in adapter["unsupported_families"]
    rt = api.get("joueur", "/api/runtime/catalog").json()
    assert rt["format"] == "babiverse-runtime-catalog"
    kouadio = next(a for a in rt["assets"] if a["technical_name"] == "habitant-kouadio")
    for pid, ver in kouadio["pins"]["assets"].items():
        assert f"{pid}@{ver}" in rt["character_parts"]
    assert api.get("joueur", "/api/runtime/game-adapter").status_code == 403


def test_dashboard_and_validate_endpoint(api):
    dash = api.get("lecteur", "/api/dashboard").json()
    assert dash["total"] >= 70 and dash["by_status"]["published"] >= 70
    assert {"building", "character", "character_part", "vehicle", "surface", "prop", "furniture"} <= set(dash["by_family"])
    assert dash["recent_changes"] and dash["recent_created"]
    shop = api.detail(tech_id(api, "boutique-quartier"))["definition"]
    shop["properties"]["shop"] = None
    rep = api.post("lecteur", "/api/validate", {"category": "commerce", "definition": shop}).json()
    assert "commerce.shop_missing" in {i["code"] for i in rep["items"]}
    assert dash["media"] > 40 and dash["scenes"] >= 1


def test_gender_rules_and_female_wardrobe(api, deep):
    """Un homme ne porte ni rouge à lèvres ni talons ; une femme ne porte pas de barbe. La garde-robe féminine est complète."""
    lib = api.get("lecteur", "/api/characters/parts").json()
    bodies = {p["technical_name"]: p for p in lib if p["slot"] == "body"}
    assert bodies["part-corps-homme"]["props"]["gender"] == "male" and bodies["part-corps-femme"]["props"]["gender"] == "female"
    fits = lambda p, g: not p["props"].get("genders") or g in p["props"]["genders"]  # noqa: E731
    for slot in ("eyes", "eyebrows", "nose", "mouth", "hair", "hair_accessory", "headwear", "glasses", "jewelry", "watch", "bag",
                 "top", "outerwear", "bottom", "dress", "shoes", "makeup"):
        assert any(p["slot"] == slot and fits(p, "female") for p in lib), slot          # tout est disponible pour une femme
    assert not any(p["slot"] == "makeup" and fits(p, "male") for p in lib)            # maquillage réservé aux femmes
    assert not any(p["slot"] == "beard" and fits(p, "female") for p in lib)            # barbe réservée aux hommes
    d, ids = character_def(api)
    aid = api.post("editeur", "/api/assets", {"category": "characters", "technical_name": "habitant-genre", "definition": d}).json()["id"]

    def codes(defn):
        res = api.put("editeur", f"/api/assets/{aid}/draft", {"definition": defn}).json()
        return {i["code"]: i["message"] for i in res["validation"]["items"]}

    man = deep(d); man["properties"]["layers"]["makeup"] = {"part": tech_id(api, "part-rouge-a-levres")}
    got = codes(man)
    assert "character.gender" in got and "féminines" in got["character.gender"]
    man = deep(d); man["properties"]["layers"]["shoes"] = {"part": tech_id(api, "part-escarpins")}
    assert "character.gender" in codes(man)
    woman = deep(d); woman["properties"]["body"] = ids["corps-femme"]
    woman["properties"]["layers"].update(makeup={"part": tech_id(api, "part-rouge-a-levres")}, shoes={"part": tech_id(api, "part-escarpins")},
                                         bottom={"part": tech_id(api, "part-jupe")})
    assert "character.gender" not in codes(woman)
    woman["properties"]["layers"]["beard"] = {"part": tech_id(api, "part-moustache")}
    assert "character.gender" in codes(woman)
    for tech in ("habitante-aminata", "habitante-adjoua", "habitant-konan"):
        assert api.by_tech(tech)["status"] == "published", tech
