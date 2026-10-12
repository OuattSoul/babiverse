"""Opérations métier du catalogue : cycle de vie, versions, duplication, migration, placement, scènes,
catégories, médiathèque, personnages, utilisateurs.

Le serveur est l'autorité : toute définition est revalidée à chaque écriture et à chaque transition.
"""
from __future__ import annotations

import json
import time
import uuid

from . import auth, media as md, placement as pl, svgsafe
from .db import audit, tx
from .refs import asset_refs, media_refs
from .taxonomy import (CATEGORY_BY_KEY, CATEGORY_RULES, CHARACTER_SLOTS, FAMILIES, KITS, MODULAR_FAMILIES, PLACEABLE,
                       REFERENCE_ANCHORS, reload as reload_categories)
from .validation import Report, normalize, validate_definition

# draft -> in_review -> validated -> published -> superseded
EDITABLE = {"draft"}

# Réglages d'exécution (dossier des médias, secret, limites), fixés par main.create_app
CONTEXT: dict = {}


class ServiceError(Exception):
    def __init__(self, status: int, message: str, report: dict | None = None):
        super().__init__(message)
        self.status, self.message, self.report = status, message, report


def _now() -> float:
    return time.time()


def _j(row, key, default=None):
    v = row[key] if key in row.keys() else None
    return json.loads(v) if v else default


def get_asset_row(conn, asset_id: str):
    row = conn.execute("SELECT * FROM assets WHERE id = ?", (asset_id,)).fetchone()
    if not row:
        raise ServiceError(404, "Asset introuvable.")
    return row


def get_version_row(conn, asset_id: str, version: int):
    row = conn.execute("SELECT * FROM asset_versions WHERE asset_id = ? AND version = ?", (asset_id, version)).fetchone()
    if not row:
        raise ServiceError(404, f"Version {version} introuvable.")
    return row


def resolver(conn):
    def resolve(asset_id: str):
        a = conn.execute("SELECT * FROM assets WHERE id = ?", (asset_id,)).fetchone()
        if not a:
            return None
        latest = get_version_row(conn, a["id"], a["latest_version"])
        pub = get_version_row(conn, a["id"], a["published_version"]) if a["published_version"] else None
        return {"family": a["family"], "category": a["category"], "archived": bool(a["archived"]),
                "technical_name": a["technical_name"],
                "latest_definition": json.loads(latest["definition"]),
                "published_definition": json.loads(pub["definition"]) if pub else None,
                "published_version": a["published_version"]}
    return resolve


def media_resolver(conn):
    def get(media_id: str):
        m = conn.execute("SELECT * FROM media WHERE id = ?", (media_id,)).fetchone()
        if not m:
            return None
        return {"kind": m["kind"], "archived": bool(m["archived"]), "meta": json.loads(m["meta"]), "name": m["name"],
                "revision": m["revision"]}
    return get


def _validate(conn, definition: dict, category: str, for_publish: bool = False) -> Report:
    return validate_definition(definition, category, resolver(conn), for_publish=for_publish, media=media_resolver(conn))


def display_status(asset_row, latest_row) -> str:
    if asset_row["archived"]:
        return "archived"
    return latest_row["status"]


def summarize(conn, a, latest=None) -> dict:
    latest = latest or get_version_row(conn, a["id"], a["latest_version"])
    d = json.loads(latest["definition"])
    used = conn.execute("SELECT COUNT(*) FROM instances WHERE asset_id = ?", (a["id"],)).fetchone()[0]
    val = json.loads(latest["validation"]) if latest["validation"] else None
    return {
        "id": a["id"], "technical_name": a["technical_name"], "category": a["category"], "family": a["family"],
        "name": d["name"], "subcategory": d.get("subcategory"), "tags": d.get("tags", []),
        "footprint": d["footprint"], "height_m": d["height_m"],
        "status": display_status(a, latest), "latest_version": a["latest_version"],
        "published_version": a["published_version"], "archived": bool(a["archived"]),
        "derived_from": a["derived_from"], "instances": used,
        "created_at": a["created_at"], "updated_at": a["updated_at"], "created_by": a["created_by"],
        "errors": val["errors"] if val else None, "warnings": val["warnings"] if val else None,
        "variants": len(d.get("variants") or []),
        "preview": d,  # définition courante, utilisée pour la vignette procédurale
    }


def list_assets(conn, q: str = "", category: str = "", family: str = "", status: str = "", sort: str = "updated",
                since: float | None = None, until: float | None = None, tag: str = "") -> list[dict]:
    rows = conn.execute("SELECT a.*, v.status AS v_status, v.definition AS v_definition, v.validation AS v_validation, "
                        "v.version AS v_version FROM assets a JOIN asset_versions v ON v.asset_id = a.id AND v.version = a.latest_version").fetchall()
    counts = dict(conn.execute("SELECT asset_id, COUNT(*) FROM instances GROUP BY asset_id").fetchall())
    out = []
    for a in rows:
        d = json.loads(a["v_definition"])
        val = json.loads(a["v_validation"]) if a["v_validation"] else None
        out.append({
            "id": a["id"], "technical_name": a["technical_name"], "category": a["category"], "family": a["family"],
            "name": d["name"], "subcategory": d.get("subcategory"), "tags": d.get("tags", []),
            "footprint": d["footprint"], "height_m": d["height_m"],
            "status": "archived" if a["archived"] else a["v_status"], "latest_version": a["latest_version"],
            "published_version": a["published_version"], "archived": bool(a["archived"]),
            "derived_from": a["derived_from"], "instances": counts.get(a["id"], 0),
            "created_at": a["created_at"], "updated_at": a["updated_at"], "created_by": a["created_by"],
            "errors": val["errors"] if val else None, "warnings": val["warnings"] if val else None,
            "variants": len(d.get("variants") or []), "preview": d,
        })
    ql = q.lower().strip()
    if ql:
        out = [s for s in out if ql in s["name"].lower() or ql in s["technical_name"] or ql in s["id"]
               or any(ql in t.lower() for t in s["tags"]) or ql in (s["subcategory"] or "").lower()
               or ql in CATEGORY_BY_KEY.get(s["category"], {}).get("label", "").lower()]
    if tag:
        out = [s for s in out if tag.lower() in [t.lower() for t in s["tags"]]]
    if category:
        out = [s for s in out if s["category"] == category]
    if family:
        out = [s for s in out if s["family"] in family.split(",")]
    if status:
        out = [s for s in out if s["status"] in status.split(",")]
    if since:
        out = [s for s in out if s["updated_at"] >= since]
    if until:
        out = [s for s in out if s["updated_at"] <= until]
    key = {"name": lambda s: s["name"].lower(), "category": lambda s: (s["category"], s["name"].lower()),
           "created": lambda s: -s["created_at"], "updated": lambda s: -s["updated_at"]}.get(sort, lambda s: -s["updated_at"])
    return sorted(out, key=key)


def usage(conn, asset_id: str) -> dict:
    """Où l'asset est utilisé : instances par scène et par version, assets qui le référencent."""
    inst = conn.execute("SELECT i.scene_id, i.version, COUNT(*) AS n, s.name AS scene_name FROM instances i "
                        "LEFT JOIN scenes s ON s.id = i.scene_id WHERE i.asset_id = ? GROUP BY i.scene_id, i.version, s.name "
                        "ORDER BY i.scene_id, i.version",
                        (asset_id,)).fetchall()
    refs = []
    for row in conn.execute("SELECT a.id, a.technical_name, a.family, a.archived, a.published_version, a.latest_version, v.version, v.definition, v.status "
                            "FROM assets a JOIN asset_versions v ON v.asset_id = a.id "
                            "WHERE v.version = a.latest_version OR v.version = a.published_version"):
        if row["id"] == asset_id:
            continue
        d = json.loads(row["definition"])
        if asset_id in asset_refs(d, row["family"]):
            refs.append({"asset_id": row["id"], "technical_name": row["technical_name"], "name": d["name"],
                         "family": row["family"], "version": row["version"], "status": row["status"],
                         "archived": bool(row["archived"])})
    return {"instances": [dict(r) for r in inst], "referenced_by": refs}


def asset_detail(conn, asset_id: str) -> dict:
    a = get_asset_row(conn, asset_id)
    versions = conn.execute("SELECT * FROM asset_versions WHERE asset_id = ? ORDER BY version", (asset_id,)).fetchall()
    latest = versions[-1]
    counts = dict(conn.execute("SELECT version, COUNT(*) FROM instances WHERE asset_id=? GROUP BY version", (asset_id,)).fetchall())
    return {
        **summarize(conn, a, latest),
        "definition": json.loads(latest["definition"]),
        "validation": json.loads(latest["validation"]) if latest["validation"] else None,
        "versions": [{"version": v["version"], "status": v["status"], "created_by": v["created_by"],
                      "created_at": v["created_at"], "updated_at": v["updated_at"], "published_at": v["published_at"],
                      "note": v["note"], "pins": _j(v, "pins"), "instances": counts.get(v["version"], 0)} for v in versions],
        "usage": usage(conn, asset_id),
    }


def _check_category(category: str) -> dict:
    cat = CATEGORY_BY_KEY.get(category)
    if not cat:
        raise ServiceError(422, f"Catégorie inconnue : {category}")
    if cat["archived"]:
        raise ServiceError(422, f"La catégorie « {cat['label']} » est archivée.")
    if not FAMILIES[cat["family"]]["implemented"]:
        raise ServiceError(422, f"La famille « {FAMILIES[cat['family']]['label']} » n'est pas encore disponible.")
    return cat


def create_asset(conn, user: dict, category: str, technical_name: str, definition: dict, derived_from: str | None = None,
                 asset_id: str | None = None) -> dict:
    cat = _check_category(category)
    if conn.execute("SELECT 1 FROM assets WHERE technical_name = ?", (technical_name,)).fetchone():
        raise ServiceError(409, f"Le nom technique « {technical_name} » existe déjà.")
    definition = normalize(definition, category)
    asset_id = asset_id or str(uuid.uuid4())
    now = _now()
    report = _validate(conn, definition, category).as_dict()
    with tx(conn):
        conn.execute("INSERT INTO assets (id, technical_name, category, family, created_by, created_at, updated_at, latest_version, derived_from) "
                     "VALUES (?,?,?,?,?,?,?,1,?)", (asset_id, technical_name, category, cat["family"], user["username"], now, now, derived_from))
        conn.execute("INSERT INTO asset_versions (asset_id, version, status, definition, validation, created_by, created_at, updated_at) "
                     "VALUES (?,1,'draft',?,?,?,?,?)", (asset_id, json.dumps(definition, ensure_ascii=False),
                                                         json.dumps(report, ensure_ascii=False), user["username"], now, now))
        audit(conn, user["username"], "asset.create", asset_id, {"technical_name": technical_name, "derived_from": derived_from})
    return asset_detail(conn, asset_id)


def update_draft(conn, user: dict, asset_id: str, definition: dict, note: str | None = None) -> dict:
    a = get_asset_row(conn, asset_id)
    if a["archived"]:
        raise ServiceError(409, "Asset archivé : restaurez-le avant de le modifier.")
    v = get_version_row(conn, asset_id, a["latest_version"])
    if v["status"] not in EDITABLE:
        raise ServiceError(409, f"La version {v['version']} est « {v['status']} » : créez une nouvelle version brouillon pour la modifier.")
    definition = normalize(definition, a["category"])
    report = _validate(conn, definition, a["category"]).as_dict()
    with tx(conn):
        conn.execute("UPDATE asset_versions SET definition=?, validation=?, updated_at=?, note=COALESCE(?, note) WHERE asset_id=? AND version=?",
                     (json.dumps(definition, ensure_ascii=False), json.dumps(report, ensure_ascii=False), _now(), note, asset_id, v["version"]))
        conn.execute("UPDATE assets SET updated_at=? WHERE id=?", (_now(), asset_id))
        audit(conn, user["username"], "asset.update_draft", asset_id, {"version": v["version"]})
    return asset_detail(conn, asset_id)


def new_draft(conn, user: dict, asset_id: str, definition: dict | None = None, note: str | None = None) -> dict:
    a = get_asset_row(conn, asset_id)
    if a["archived"]:
        raise ServiceError(409, "Asset archivé.")
    v = get_version_row(conn, asset_id, a["latest_version"])
    if v["status"] == "draft" and definition is None:
        return asset_detail(conn, asset_id)
    if v["status"] in ("draft", "in_review"):
        raise ServiceError(409, "Une version est déjà en brouillon ou en cours de validation.")
    nv = v["version"] + 1
    now = _now()
    body = json.dumps(normalize(definition, a["category"]), ensure_ascii=False) if definition is not None else v["definition"]
    report = json.dumps(_validate(conn, json.loads(body), a["category"]).as_dict(), ensure_ascii=False)
    with tx(conn):
        conn.execute("INSERT INTO asset_versions (asset_id, version, status, definition, validation, created_by, created_at, updated_at, note) "
                     "VALUES (?,?,'draft',?,?,?,?,?,?)", (asset_id, nv, body, report, user["username"], now, now, note))
        conn.execute("UPDATE assets SET latest_version=?, updated_at=? WHERE id=?", (nv, now, asset_id))
        audit(conn, user["username"], "asset.new_draft", asset_id, {"version": nv, "note": note})
    return asset_detail(conn, asset_id)


def revert(conn, user: dict, asset_id: str, from_version: int) -> dict:
    """Retour contrôlé : la définition d'une version antérieure devient le brouillon courant (jamais d'écrasement
    d'une version publiée ; la publication suit le circuit normal de validation)."""
    a = get_asset_row(conn, asset_id)
    src = get_version_row(conn, asset_id, from_version)
    latest = get_version_row(conn, asset_id, a["latest_version"])
    if latest["status"] == "in_review":
        raise ServiceError(409, "Une version est en cours de validation : renvoyez-la en brouillon d'abord.")
    definition = json.loads(src["definition"])
    note = f"Retour à la version {from_version}"
    if latest["status"] == "draft":
        if latest["version"] == from_version:
            raise ServiceError(409, "Cette version est déjà le brouillon courant.")
        res = update_draft(conn, user, asset_id, definition, note=note)
    else:
        res = new_draft(conn, user, asset_id, definition, note=note)
    with tx(conn):
        audit(conn, user["username"], "asset.revert", asset_id, {"from_version": from_version, "version": res["latest_version"]})
    return res


def _flatten(o, prefix="") -> dict:
    out = {}
    if isinstance(o, dict):
        for k, v in o.items():
            out.update(_flatten(v, f"{prefix}{k}."))
    elif isinstance(o, list) and o and all(isinstance(x, dict) and "id" in x for x in o):
        for x in o:
            out.update(_flatten(x, f"{prefix}[{x['id']}]."))
    else:
        out[prefix[:-1]] = o
    return out


def diff(conn, asset_id: str, a: int, b: int) -> dict:
    da = _flatten(json.loads(get_version_row(conn, asset_id, a)["definition"]))
    db_ = _flatten(json.loads(get_version_row(conn, asset_id, b)["definition"]))
    changes = []
    for k in sorted(set(da) | set(db_)):
        if da.get(k, "∅") != db_.get(k, "∅"):
            changes.append({"path": k, "before": da.get(k), "after": db_.get(k),
                            "kind": "added" if k not in da else "removed" if k not in db_ else "changed"})
    return {"from": a, "to": b, "changes": changes}


def duplicate(conn, user: dict, asset_id: str, technical_name: str, name: str) -> dict:
    a = get_asset_row(conn, asset_id)
    src = get_version_row(conn, asset_id, a["published_version"] or a["latest_version"])
    d = json.loads(src["definition"])
    d["name"] = name
    return create_asset(conn, user, a["category"], technical_name, d, derived_from=asset_id)


def validate_latest(conn, user: dict, asset_id: str, for_publish: bool = False) -> dict:
    a = get_asset_row(conn, asset_id)
    v = get_version_row(conn, asset_id, a["latest_version"])
    defn = json.loads(v["definition"])
    report = _validate(conn, defn, a["category"], for_publish=for_publish)
    if for_publish and report.ok:
        _sandbox_placement(conn, a, defn, report)
    rd = report.as_dict()
    with tx(conn):
        conn.execute("UPDATE asset_versions SET validation=? WHERE asset_id=? AND version=?",
                     (json.dumps(rd, ensure_ascii=False), asset_id, v["version"]))
    return rd


def _sandbox_placement(conn, a, defn: dict, report: Report):
    """Vérifie que l'asset est plaçable au moins quelque part sur un terrain vide autorisé de la scène principale."""
    if a["family"] not in PLACEABLE:
        return
    world = pl.WorldState(conn, scene_id="main", empty=True)
    if a["family"] == "vehicle" and (defn.get("properties") or {}).get("parking") != "anywhere":
        # un véhicule de voirie est vérifié sur une route droite fictive couvrant toute la scène
        return
    allowed = set(defn["placement"]["allowed_terrain"])
    terrains = {pl.TERRAIN.get(ch, "ground") for row in world.terrain for ch in row}
    if not allowed & terrains:
        report.error("placement.impossible", "Aucun terrain autorisé n'existe dans la scène de test.")
        return
    for y in range(world.height):
        for x in range(world.width):
            for rot in (0, 90, 180, 270):
                rr = pl.check_placement(world, defn, a["family"], x, y, rot)
                # l'accès routier dépend du voisinage : il n'est pas exigé dans le bac à sable vide
                if all(i["level"] != "error" or i["code"] in ("entrance.road_access", "vehicle.off_road") for i in rr.items):
                    return
    report.error("placement.impossible", "Aucun emplacement valide dans le monde (terrain, dimensions ou limites).")


def compute_pins(conn, family: str, defn: dict) -> dict:
    """Versions et révisions exactes des dépendances au moment de la publication."""
    pins = {"assets": {}, "media": {}}
    for aid in sorted(asset_refs(defn, family)):
        row = conn.execute("SELECT published_version, latest_version FROM assets WHERE id=?", (aid,)).fetchone()
        if row:
            pins["assets"][aid] = row["published_version"] or row["latest_version"]
    for mid in sorted(media_refs(defn, family)):
        row = conn.execute("SELECT revision FROM media WHERE id=?", (mid,)).fetchone()
        if row:
            pins["media"][mid] = row["revision"]
    return pins


def _transition(conn, user, asset_id, expected: tuple, new_status: str, action: str, need_valid: bool, for_publish=False):
    a = get_asset_row(conn, asset_id)
    if a["archived"]:
        raise ServiceError(409, "Asset archivé.")
    v = get_version_row(conn, asset_id, a["latest_version"])
    if v["status"] not in expected:
        raise ServiceError(409, f"Transition impossible depuis « {v['status']} » (attendu : {', '.join(expected)}).")
    if need_valid:
        rep = validate_latest(conn, user, asset_id, for_publish=for_publish)
        if not rep["ok"]:
            raise ServiceError(422, f"Validation échouée : {rep['errors']} erreur(s).", rep)
    now = _now()
    with tx(conn):
        conn.execute("UPDATE asset_versions SET status=?, updated_at=? WHERE asset_id=? AND version=?",
                     (new_status, now, asset_id, v["version"]))
        if new_status == "published":
            if a["published_version"]:
                conn.execute("UPDATE asset_versions SET status='superseded' WHERE asset_id=? AND version=?",
                             (asset_id, a["published_version"]))
            pins = compute_pins(conn, a["family"], json.loads(v["definition"]))
            conn.execute("UPDATE asset_versions SET published_at=?, pins=? WHERE asset_id=? AND version=?",
                         (now, json.dumps(pins), asset_id, v["version"]))
            conn.execute("UPDATE assets SET published_version=? WHERE id=?", (v["version"], asset_id))
        conn.execute("UPDATE assets SET updated_at=? WHERE id=?", (now, asset_id))
        audit(conn, user["username"], action, asset_id, {"version": v["version"]})
    return asset_detail(conn, asset_id)


def submit(conn, user, asset_id):
    return _transition(conn, user, asset_id, ("draft",), "in_review", "asset.submit", True)


def reject(conn, user, asset_id):
    return _transition(conn, user, asset_id, ("in_review", "validated"), "draft", "asset.reject", False)


def approve(conn, user, asset_id):
    return _transition(conn, user, asset_id, ("in_review",), "validated", "asset.approve", True, for_publish=True)


def publish(conn, user, asset_id):
    return _transition(conn, user, asset_id, ("validated",), "published", "asset.publish", True, for_publish=True)


def set_archived(conn, user, asset_id: str, archived: bool) -> dict:
    get_asset_row(conn, asset_id)
    if archived:
        # un asset encore référencé par un asset publié non archivé ne peut pas être archivé
        refs = [r for r in usage(conn, asset_id)["referenced_by"] if not r["archived"] and r["status"] in ("published", "validated", "in_review")]
        if refs:
            raise ServiceError(409, f"Utilisé par des assets publiés ou en validation : {', '.join(sorted({r['technical_name'] for r in refs}))}.")
    with tx(conn):
        conn.execute("UPDATE assets SET archived=?, updated_at=? WHERE id=?", (1 if archived else 0, _now(), asset_id))
        audit(conn, user["username"], "asset.archive" if archived else "asset.restore", asset_id)
    return asset_detail(conn, asset_id)


# ---------------------------------------------------------------- catalogue de jeu

def catalog(conn, family: str = "") -> list[dict]:
    out = []
    q = "SELECT a.*, v.definition, v.pins FROM assets a JOIN asset_versions v ON v.asset_id=a.id AND v.version=a.published_version " \
        "WHERE a.archived = 0 AND a.published_version IS NOT NULL ORDER BY a.category"
    for a in conn.execute(q):
        if family and a["family"] not in family.split(","):
            continue
        out.append({"asset_id": a["id"], "technical_name": a["technical_name"], "category": a["category"],
                    "family": a["family"], "version": a["published_version"], "definition": json.loads(a["definition"]),
                    "pins": json.loads(a["pins"]) if a["pins"] else None})
    return out


def definitions(conn, keys: list[str]) -> dict:
    """keys = ['asset_id@version', …] : chargement à la demande des seules versions nécessaires."""
    out = {}
    for k in keys[:200]:
        try:
            aid, ver = k.rsplit("@", 1)
            v = get_version_row(conn, aid, int(ver))
            a = get_asset_row(conn, aid)
        except (ValueError, ServiceError):
            continue
        if v["status"] not in ("published", "superseded"):
            continue
        out[k] = {"family": a["family"], "category": a["category"], "definition": json.loads(v["definition"]),
                  "pins": json.loads(v["pins"]) if v["pins"] else None}
    return out


# ---------------------------------------------------------------- scènes de test

def terrain_template(width: int, height: int, template: str = "coast") -> list[str]:
    rows = []
    for y in range(height):
        if template == "blank":
            rows.append("g" * width)
        elif template == "lagoon":
            rows.append("".join("w" if (x - width / 2) ** 2 / (width / 4) ** 2 + (y - height / 2) ** 2 / (height / 5) ** 2 < 1
                                else "s" if (x - width / 2) ** 2 / (width / 3.3) ** 2 + (y - height / 2) ** 2 / (height / 4) ** 2 < 1
                                else "g" for x in range(width)))
        elif y >= height - 4:
            rows.append("w" * width)  # lagune
        elif y >= height - 6:
            rows.append("s" * width)  # plage
        else:
            rows.append("g" * width)
    return rows


def _scene_row(conn, scene_id: str):
    s = conn.execute("SELECT * FROM scenes WHERE id=?", (scene_id,)).fetchone()
    if not s:
        raise ServiceError(404, "Scène introuvable.")
    return s


def list_scenes(conn) -> list[dict]:
    counts = dict(conn.execute("SELECT scene_id, COUNT(*) FROM instances GROUP BY scene_id").fetchall())
    return [{"id": s["id"], "name": s["name"], "description": s["description"], "width": s["width"], "height": s["height"],
             "instances": counts.get(s["id"], 0), "updated_at": s["updated_at"], "created_by": s["created_by"]}
            for s in conn.execute("SELECT * FROM scenes ORDER BY created_at")]


def create_scene(conn, user, name: str, description: str, width: int, height: int, template: str, scene_id: str | None = None,
                 terrain: list[str] | None = None) -> dict:
    sid = scene_id or f"scene-{uuid.uuid4().hex[:10]}"
    now = _now()
    terr = terrain or terrain_template(width, height, template)
    with tx(conn):
        conn.execute("INSERT INTO scenes (id, name, description, width, height, terrain, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
                     (sid, name, description, width, height, json.dumps(terr), user["username"], now, now))
        audit(conn, user["username"], "scene.create", sid, {"name": name})
    return world_state(conn, sid)


def update_scene(conn, user, scene_id: str, patch: dict) -> dict:
    _scene_row(conn, scene_id)
    with tx(conn):
        for k in ("name", "description"):
            if patch.get(k) is not None:
                conn.execute(f"UPDATE scenes SET {k}=?, updated_at=? WHERE id=?", (patch[k], _now(), scene_id))
        audit(conn, user["username"], "scene.update", scene_id, patch)
    return world_state(conn, scene_id)


def duplicate_scene(conn, user, scene_id: str, name: str) -> dict:
    s = _scene_row(conn, scene_id)
    new = create_scene(conn, user, name, s["description"], s["width"], s["height"], "blank", terrain=json.loads(s["terrain"]))
    with tx(conn):
        for i in conn.execute("SELECT * FROM instances WHERE scene_id=?", (scene_id,)).fetchall():
            conn.execute("INSERT INTO instances (id, asset_id, version, x, y, rotation, variant_id, owner_id, created_at, scene_id, data) "
                         "VALUES (?,?,?,?,?,?,?,?,?,?,?)", (str(uuid.uuid4()), i["asset_id"], i["version"], i["x"], i["y"], i["rotation"],
                                                           i["variant_id"], user["id"], _now(), new["id"], i["data"]))
    return world_state(conn, new["id"])


def delete_scene(conn, user, scene_id: str, clear_only: bool = False) -> None:
    _scene_row(conn, scene_id)
    if scene_id == "main" and not clear_only:
        raise ServiceError(409, "La scène principale ne peut pas être supprimée (elle peut être vidée).")
    with tx(conn):
        conn.execute("DELETE FROM instances WHERE scene_id=?", (scene_id,))
        if not clear_only:
            conn.execute("DELETE FROM scenes WHERE id=?", (scene_id,))
        audit(conn, user["username"], "scene.clear" if clear_only else "scene.delete", scene_id)


def _inst_dict(row) -> dict:
    d = dict(row)
    d["data"] = json.loads(d.get("data") or "{}")
    return d


def world_state(conn, scene_id: str = "main") -> dict:
    s = _scene_row(conn, scene_id)
    inst = [_inst_dict(r) for r in conn.execute("SELECT * FROM instances WHERE scene_id=? ORDER BY created_at", (scene_id,))]
    return {"id": s["id"], "name": s["name"], "description": s["description"], "width": s["width"], "height": s["height"],
            "terrain": json.loads(s["terrain"]), "instances": inst, "kind": "test",
            "notice": "Scène de prévisualisation de l'atelier : ce n'est pas le monde de production du jeu."}


def _published_def(conn, asset_id: str):
    a = get_asset_row(conn, asset_id)
    if a["archived"] or not a["published_version"]:
        raise ServiceError(409, "Seuls les assets publiés et non archivés peuvent être placés.")
    v = get_version_row(conn, asset_id, a["published_version"])
    return a, a["published_version"], json.loads(v["definition"])


def _world(conn, scene_id: str, ignore: str | None = None) -> pl.WorldState:
    _scene_row(conn, scene_id)
    return pl.WorldState(conn, ignore, scene_id=scene_id)


def check(conn, asset_id: str, x: int, y: int, rotation: int, ignore: str | None = None, version: int | None = None,
          scene_id: str = "main") -> dict:
    a, ver, d = _published_def(conn, asset_id)
    if version is not None:
        d = json.loads(get_version_row(conn, asset_id, version)["definition"])
    return pl.check_placement(_world(conn, scene_id, ignore), d, a["family"], x, y, rotation).as_dict()


def _check_variant(d: dict, variant_id: str | None):
    if variant_id and variant_id not in {v["id"] for v in d.get("variants", [])}:
        raise ServiceError(422, f"Variante inconnue : {variant_id}")


def place(conn, user: dict, asset_id: str, x: int, y: int, rotation: int, variant_id: str | None, scene_id: str = "main",
          label: str | None = None) -> dict:
    a, ver, d = _published_def(conn, asset_id)
    if a["family"] not in PLACEABLE:
        msg = {"interior": "Un intérieur ne se place pas dans la ville : associez-le à un bâtiment.",
               "furniture": "Un meuble se place dans un intérieur (éditeur de plan), pas en ville.",
               "character_part": "Un composant se place sur un personnage, pas en ville.",
               "component": "Un composant modulaire s'assemble dans un bâtiment, un véhicule, un objet, un meuble ou une surface."}.get(a["family"], "Cet asset ne se place pas en ville.")
        raise ServiceError(422, msg)
    _check_variant(d, variant_id)
    rep = pl.check_placement(_world(conn, scene_id), d, a["family"], x, y, rotation)
    if not rep.ok:
        raise ServiceError(422, "Placement refusé.", rep.as_dict())
    iid = str(uuid.uuid4())
    data = json.dumps({"label": label} if label else {}, ensure_ascii=False)
    with tx(conn):
        conn.execute("INSERT INTO instances (id, asset_id, version, x, y, rotation, variant_id, owner_id, created_at, scene_id, data) "
                     "VALUES (?,?,?,?,?,?,?,?,?,?,?)", (iid, asset_id, ver, x, y, rotation, variant_id, user["id"], _now(), scene_id, data))
        conn.execute("UPDATE scenes SET updated_at=? WHERE id=?", (_now(), scene_id))
        audit(conn, user["username"], "world.place", iid, {"asset_id": asset_id, "version": ver, "x": x, "y": y, "rotation": rotation, "scene": scene_id})
    return {"instance": _inst_dict(conn.execute("SELECT * FROM instances WHERE id=?", (iid,)).fetchone()), "report": rep.as_dict()}


def _instance_for_edit(conn, user, instance_id, scene_id: str | None = None):
    row = conn.execute("SELECT * FROM instances WHERE id=?", (instance_id,)).fetchone()
    if not row or (scene_id and row["scene_id"] != scene_id):
        raise ServiceError(404, "Instance introuvable.")
    if row["owner_id"] != user["id"] and "world.edit_any" not in user["permissions"]:
        raise ServiceError(403, "Vous ne pouvez modifier que vos propres objets.")
    return row


def move(conn, user, instance_id: str, patch: dict, scene_id: str | None = None) -> dict:
    row = _instance_for_edit(conn, user, instance_id, scene_id)
    x = patch.get("x") if patch.get("x") is not None else row["x"]
    y = patch.get("y") if patch.get("y") is not None else row["y"]
    rot = patch.get("rotation") if patch.get("rotation") is not None else row["rotation"]
    variant = patch.get("variant_id", row["variant_id"])
    a = get_asset_row(conn, row["asset_id"])
    d = json.loads(get_version_row(conn, row["asset_id"], row["version"])["definition"])
    _check_variant(d, variant)
    rep = pl.check_placement(_world(conn, row["scene_id"], instance_id), d, a["family"], x, y, rot)
    if not rep.ok:
        raise ServiceError(422, "Déplacement refusé.", rep.as_dict())
    data = json.loads(row["data"] or "{}")
    if "label" in patch and patch["label"] is not None:
        data["label"] = patch["label"]
    with tx(conn):
        conn.execute("UPDATE instances SET x=?, y=?, rotation=?, variant_id=?, data=? WHERE id=?",
                     (x, y, rot, variant, json.dumps(data, ensure_ascii=False), instance_id))
        audit(conn, user["username"], "world.move", instance_id, {"x": x, "y": y, "rotation": rot})
    return _inst_dict(conn.execute("SELECT * FROM instances WHERE id=?", (instance_id,)).fetchone())


def remove(conn, user, instance_id: str, scene_id: str | None = None):
    _instance_for_edit(conn, user, instance_id, scene_id)
    with tx(conn):
        conn.execute("DELETE FROM instances WHERE id=?", (instance_id,))
        audit(conn, user["username"], "world.remove", instance_id)


# ---------------------------------------------------------------- migration contrôlée

def migration_preview(conn, asset_id: str, to_version: int) -> dict:
    a = get_asset_row(conn, asset_id)
    target = get_version_row(conn, asset_id, to_version)
    if target["status"] not in ("published",):
        raise ServiceError(409, "La migration ne vise que la version publiée courante.")
    d = json.loads(target["definition"])
    out = []
    for row in conn.execute("SELECT * FROM instances WHERE asset_id=? AND version<>?", (asset_id, to_version)).fetchall():
        rep = pl.check_placement(_world(conn, row["scene_id"], row["id"]), d, a["family"], row["x"], row["y"], row["rotation"])
        variant_ok = not row["variant_id"] or row["variant_id"] in {v["id"] for v in d.get("variants", [])}
        if not variant_ok:
            rep.error("variant.removed", f"La variante « {row['variant_id']} » n'existe plus dans la version {to_version}.")
        out.append({"instance_id": row["id"], "scene_id": row["scene_id"], "from_version": row["version"], "x": row["x"], "y": row["y"],
                    "compatible": rep.ok, "report": rep.as_dict()})
    return {"asset_id": asset_id, "to_version": to_version, "instances": out,
            "compatible": sum(i["compatible"] for i in out), "blocked": sum(not i["compatible"] for i in out)}


def migrate(conn, user, asset_id: str, to_version: int, instance_ids: list[str] | None) -> dict:
    prev = migration_preview(conn, asset_id, to_version)
    done, skipped = [], []
    with tx(conn):
        for i in prev["instances"]:
            if instance_ids is not None and i["instance_id"] not in instance_ids:
                continue
            if i["compatible"]:
                conn.execute("UPDATE instances SET version=? WHERE id=?", (to_version, i["instance_id"]))
                done.append(i["instance_id"])
            else:
                skipped.append(i["instance_id"])
        audit(conn, user["username"], "asset.migrate", asset_id, {"to": to_version, "migrated": len(done), "skipped": len(skipped)})
    return {"migrated": done, "skipped": skipped}


def road_compat(conn, asset_id: str) -> list[dict]:
    a = get_asset_row(conn, asset_id)
    if a["family"] != "road":
        raise ServiceError(422, "Disponible uniquement pour les segments routiers.")
    d = json.loads(get_version_row(conn, asset_id, a["latest_version"])["definition"])
    others = [c for c in catalog(conn) if c["family"] == "road" and c["asset_id"] != asset_id]
    return pl.road_compatibility(d, others)


# ---------------------------------------------------------------- catégories (administrables)

def create_category(conn, user, data: dict) -> dict:
    if data["key"] in CATEGORY_BY_KEY:
        raise ServiceError(409, f"La catégorie « {data['key']} » existe déjà.")
    if data["family"] not in FAMILIES:
        raise ServiceError(422, f"Famille technique inconnue : {data['family']}")
    bad = [r for r in data["rules"] if r not in CATEGORY_RULES]
    if bad:
        raise ServiceError(422, f"Règle inconnue : {', '.join(bad)}")
    now = _now()
    pos = (conn.execute("SELECT MAX(position) FROM categories").fetchone()[0] or 0) + 10
    with tx(conn):
        conn.execute("INSERT INTO categories (key, label, family, rules, subcategories, description, builtin, archived, position, created_at, updated_at) "
                     "VALUES (?,?,?,?,?,?,0,0,?,?,?)", (data["key"], data["label"], data["family"], json.dumps(data["rules"]),
                                                       json.dumps(data["subcategories"], ensure_ascii=False), data.get("description", ""), pos, now, now))
        audit(conn, user["username"], "category.create", data["key"], {"family": data["family"], "label": data["label"]})
    reload_categories(conn)
    return CATEGORY_BY_KEY[data["key"]]


def update_category(conn, user, key: str, patch: dict) -> dict:
    if key not in CATEGORY_BY_KEY:
        raise ServiceError(404, "Catégorie introuvable.")
    if patch.get("rules") is not None:
        bad = [r for r in patch["rules"] if r not in CATEGORY_RULES]
        if bad:
            raise ServiceError(422, f"Règle inconnue : {', '.join(bad)}")
    sets, vals = [], []
    for k in ("label", "description"):
        if patch.get(k) is not None:
            sets.append(f"{k}=?"); vals.append(patch[k])
    for k in ("rules", "subcategories"):
        if patch.get(k) is not None:
            sets.append(f"{k}=?"); vals.append(json.dumps(patch[k], ensure_ascii=False))
    if patch.get("archived") is not None:
        sets.append("archived=?"); vals.append(1 if patch["archived"] else 0)
    if sets:
        with tx(conn):
            conn.execute(f"UPDATE categories SET {', '.join(sets)}, updated_at=? WHERE key=?", (*vals, _now(), key))
            audit(conn, user["username"], "category.update", key, {k: v for k, v in patch.items() if v is not None})
        reload_categories(conn)
    return CATEGORY_BY_KEY[key]


# ---------------------------------------------------------------- médiathèque

def media_summary(conn, m) -> dict:
    secret = CONTEXT.get("secret", "")
    return {"id": m["id"], "name": m["name"], "filename": m["filename"], "kind": m["kind"], "mime": m["mime"], "size": m["size"],
            "sha256": m["sha256"], "width": m["width"], "height": m["height"], "meta": json.loads(m["meta"]),
            "tags": json.loads(m["tags"]), "category": m["category"], "revision": m["revision"], "archived": bool(m["archived"]),
            "created_by": m["created_by"], "created_at": m["created_at"], "updated_at": m["updated_at"],
            "url": md.signed_url(secret, m["id"], m["revision"])}


def get_media_row(conn, media_id: str):
    m = conn.execute("SELECT * FROM media WHERE id=?", (media_id,)).fetchone()
    if not m:
        raise ServiceError(404, "Fichier introuvable.")
    return m


def list_media(conn, q: str = "", kind: str = "", category: str = "", archived: bool = False) -> list[dict]:
    rows = conn.execute("SELECT * FROM media ORDER BY updated_at DESC").fetchall()
    out = [media_summary(conn, m) for m in rows if bool(m["archived"]) == archived]
    if q:
        ql = q.lower()
        out = [m for m in out if ql in m["name"].lower() or ql in m["filename"].lower() or any(ql in t.lower() for t in m["tags"])]
    if kind:
        out = [m for m in out if m["kind"] == kind]
    if category:
        out = [m for m in out if m["category"] == category]
    return out


def media_usage(conn, media_id: str) -> list[dict]:
    out = []
    for row in conn.execute("SELECT a.id, a.technical_name, a.family, a.archived, v.version, v.status, v.definition, v.pins FROM assets a "
                            "JOIN asset_versions v ON v.asset_id = a.id"):
        d = json.loads(row["definition"])
        if media_id in media_refs(d, row["family"]):
            pins = json.loads(row["pins"]) if row["pins"] else {}
            out.append({"asset_id": row["id"], "technical_name": row["technical_name"], "name": d["name"], "family": row["family"],
                        "version": row["version"], "status": row["status"], "archived": bool(row["archived"]),
                        "pinned_revision": (pins.get("media") or {}).get(media_id)})
    return out


def upload_media(conn, user, data: bytes, filename: str, name: str | None = None, category: str = "other",
                 tags: list[str] | None = None, media_id: str | None = None) -> dict:
    s = CONTEXT["settings"]
    if category not in md.MEDIA_CATEGORIES:
        raise ServiceError(422, f"Classement inconnu : {category}")
    try:
        info = md.inspect(data, filename, s.max_upload_bytes, s.max_image_px)
    except md.MediaError as exc:
        raise ServiceError(422, str(exc)) from exc
    sha = store_file(conn, info["data"], info["ext"])
    mid = media_id or f"m-{uuid.uuid4().hex[:16]}"
    now = _now()
    fname = md.safe_filename(filename)
    meta = json.dumps(info["meta"], ensure_ascii=False)
    with tx(conn):
        conn.execute("INSERT INTO media (id, name, filename, kind, mime, size, sha256, width, height, meta, tags, category, revision, archived, created_by, created_at, updated_at) "
                     "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1,0,?,?,?)",
                     (mid, (name or fname.rsplit(".", 1)[0])[:80], fname, info["kind"], info["mime"], len(info["data"]), sha,
                      info["width"], info["height"], meta, json.dumps(tags or [], ensure_ascii=False), category, user["username"], now, now))
        conn.execute("INSERT INTO media_revisions (media_id, revision, filename, mime, size, sha256, width, height, meta, created_by, created_at) "
                     "VALUES (?,1,?,?,?,?,?,?,?,?,?)", (mid, fname, info["mime"], len(info["data"]), sha, info["width"], info["height"], meta, user["username"], now))
        audit(conn, user["username"], "media.upload", mid, {"filename": fname, "mime": info["mime"], "size": len(info["data"])})
    return media_summary(conn, get_media_row(conn, mid))


def _can_manage_media(user, m):
    if m["created_by"] != user["username"] and "media.manage" not in user["permissions"]:
        raise ServiceError(403, "Seul l'auteur du fichier ou un gestionnaire de la médiathèque peut le modifier.")


def replace_media(conn, user, media_id: str, data: bytes, filename: str) -> dict:
    m = get_media_row(conn, media_id)
    _can_manage_media(user, m)
    s = CONTEXT["settings"]
    try:
        info = md.inspect(data, filename, s.max_upload_bytes, s.max_image_px)
    except md.MediaError as exc:
        raise ServiceError(422, str(exc)) from exc
    if info["kind"] != m["kind"]:
        raise ServiceError(422, "Le fichier de remplacement doit être du même type (SVG ou image matricielle).")
    sha = store_file(conn, info["data"], info["ext"])
    rev = m["revision"] + 1
    now = _now()
    fname = md.safe_filename(filename)
    meta = json.dumps(info["meta"], ensure_ascii=False)
    with tx(conn):
        conn.execute("INSERT INTO media_revisions (media_id, revision, filename, mime, size, sha256, width, height, meta, created_by, created_at) "
                     "VALUES (?,?,?,?,?,?,?,?,?,?,?)", (media_id, rev, fname, info["mime"], len(info["data"]), sha, info["width"], info["height"], meta, user["username"], now))
        conn.execute("UPDATE media SET filename=?, mime=?, size=?, sha256=?, width=?, height=?, meta=?, revision=?, updated_at=? WHERE id=?",
                     (fname, info["mime"], len(info["data"]), sha, info["width"], info["height"], meta, rev, now, media_id))
        audit(conn, user["username"], "media.replace", media_id, {"revision": rev, "filename": fname})
    return media_summary(conn, get_media_row(conn, media_id))


def assign_channels(conn, user, media_id: str, mapping: dict[str, str]) -> dict:
    """Associe des couleurs du SVG à des canaux recolorables : crée une nouvelle révision du fichier."""
    m = get_media_row(conn, media_id)
    if m["kind"] != "svg":
        raise ServiceError(422, "Seuls les SVG peuvent recevoir des canaux de couleur.")
    s = CONTEXT["settings"]
    svg = read_file(conn, m["sha256"], m["mime"]).decode("utf-8")
    try:
        res = svgsafe.assign_channels(svg, mapping)
    except svgsafe.SvgError as exc:
        raise ServiceError(422, str(exc)) from exc
    return replace_media(conn, user, media_id, res["svg"].encode("utf-8"), m["filename"])


def update_media(conn, user, media_id: str, patch: dict) -> dict:
    m = get_media_row(conn, media_id)
    _can_manage_media(user, m)
    if patch.get("category") is not None and patch["category"] not in md.MEDIA_CATEGORIES:
        raise ServiceError(422, "Classement inconnu.")
    with tx(conn):
        if patch.get("name") is not None:
            conn.execute("UPDATE media SET name=?, updated_at=? WHERE id=?", (patch["name"], _now(), media_id))
        if patch.get("tags") is not None:
            conn.execute("UPDATE media SET tags=?, updated_at=? WHERE id=?", (json.dumps(patch["tags"], ensure_ascii=False), _now(), media_id))
        if patch.get("category") is not None:
            conn.execute("UPDATE media SET category=?, updated_at=? WHERE id=?", (patch["category"], _now(), media_id))
        audit(conn, user["username"], "media.update", media_id, {k: v for k, v in patch.items() if v is not None})
    return media_summary(conn, get_media_row(conn, media_id))


def set_media_archived(conn, user, media_id: str, archived: bool) -> dict:
    m = get_media_row(conn, media_id)
    _can_manage_media(user, m)
    if archived:
        users = [u for u in media_usage(conn, media_id) if not u["archived"] and u["status"] in ("draft", "in_review", "validated", "published")]
        if users:
            raise ServiceError(409, f"Fichier encore utilisé par : {', '.join(sorted({u['technical_name'] for u in users}))}.")
    with tx(conn):
        conn.execute("UPDATE media SET archived=?, updated_at=? WHERE id=?", (1 if archived else 0, _now(), media_id))
        audit(conn, user["username"], "media.archive" if archived else "media.restore", media_id)
    return media_summary(conn, get_media_row(conn, media_id))


def media_revisions(conn, media_id: str) -> list[dict]:
    secret = CONTEXT.get("secret", "")
    return [{**dict(r), "meta": json.loads(r["meta"]), "url": md.signed_url(secret, media_id, r["revision"])}
            for r in conn.execute("SELECT * FROM media_revisions WHERE media_id=? ORDER BY revision DESC", (media_id,))]


def store_file(conn, data: bytes, ext: str) -> str:
    """Range le contenu (sur disque ou en base selon `media_storage`) ; retourne son empreinte."""
    s = CONTEXT["settings"]
    if s.media_storage == "database":
        sha = md.sha256(data)
        conn.execute("INSERT INTO media_blobs (sha256, data) VALUES (?, ?) ON CONFLICT DO NOTHING", (sha, data))
        return sha
    return md.store(s.media_dir, data, ext)[0]


def read_file(conn, sha: str, mime: str) -> bytes:
    s = CONTEXT["settings"]
    if s.media_storage == "database":
        row = conn.execute("SELECT data FROM media_blobs WHERE sha256=?", (sha,)).fetchone()
        if not row:
            raise ServiceError(404, "Fichier introuvable dans la base.")
        return bytes(row["data"])
    return md.read(s.media_dir, sha, mime)


def media_file(conn, media_id: str, revision: int) -> tuple[bytes, str]:
    r = conn.execute("SELECT * FROM media_revisions WHERE media_id=? AND revision=?", (media_id, revision)).fetchone()
    if not r:
        raise ServiceError(404, "Révision introuvable.")
    return read_file(conn, r["sha256"], r["mime"]), r["mime"]


def svg_text(conn, media_id: str, revision: int | None = None) -> str | None:
    m = conn.execute("SELECT * FROM media WHERE id=?", (media_id,)).fetchone()
    if not m or m["kind"] != "svg":
        return None
    data, _ = media_file(conn, media_id, revision or m["revision"])
    return data.decode("utf-8")


# ---------------------------------------------------------------- personnages

def part_payload(conn, part_id: str, version: int | None = None, media_revision: int | None = None) -> dict | None:
    """Données d'un composant pour le compositeur : définition + calques SVG découpés (defs/back/front)."""
    a = conn.execute("SELECT * FROM assets WHERE id=?", (part_id,)).fetchone()
    if not a or a["family"] not in ("character_part", "component"):
        return None
    v = get_version_row(conn, part_id, version or a["latest_version"])
    d = json.loads(v["definition"])
    p = d["properties"]
    svg = svg_text(conn, p.get("svg_media", ""), media_revision)
    layers = svgsafe.split_layers(svg) if svg else {"defs": "", "back": "", "front": ""}
    m = conn.execute("SELECT meta FROM media WHERE id=?", (p.get("svg_media", ""),)).fetchone()
    meta = json.loads(m["meta"]) if m else {}
    kit = p.get("kit") if a["family"] == "component" else None
    slot = (KITS.get(kit, {}).get("slots", {}) if kit else CHARACTER_SLOTS).get(p.get("slot"), {})
    out = {"id": part_id, "technical_name": a["technical_name"], "name": d["name"], "version": v["version"], "status": v["status"],
           "published_version": a["published_version"], "archived": bool(a["archived"]), "slot": p.get("slot"),
           "props": p, "tags": d.get("tags", []), "view_box": meta.get("view_box"), "channels": meta.get("channels", {}),
           "z": p.get("z") if p.get("z") is not None else slot.get("z", 50), "back_z": slot.get("back_z", 0), **layers}
    if kit:
        out["kit"] = kit
    return out


def part_library(conn, include_drafts: bool = True, family: str = "character_part", kit: str = "") -> list[dict]:
    out = []
    for a in conn.execute("SELECT * FROM assets WHERE family=? AND archived=0 ORDER BY technical_name", (family,)):
        if not include_drafts and not a["published_version"]:
            continue
        p = part_payload(conn, a["id"], None if include_drafts else a["published_version"])
        if p and (not kit or p.get("kit") == kit):
            out.append(p)
    return out


def kit_library(conn, kit: str = "", include_drafts: bool = True) -> list[dict]:
    """Composants modulaires (tous les kits, ou un seul)."""
    if kit and kit not in KITS:
        raise ServiceError(404, f"Kit inconnu : {kit}")
    return part_library(conn, include_drafts, "component", kit)


def asset_render(conn, asset_id: str, version: int | None = None) -> dict:
    """Rendu d'un personnage ou d'un assemblage modulaire : définition + composants exacts."""
    a = get_asset_row(conn, asset_id)
    if a["family"] == "character":
        return character_render(conn, asset_id, version)
    if a["family"] not in MODULAR_FAMILIES:
        raise ServiceError(422, "Cet asset n'est ni un personnage ni un assemblage modulaire.")
    return character_render(conn, asset_id, version, family=a["family"])


def character_render(conn, asset_id: str, version: int | None = None, family: str = "character") -> dict:
    """Définition d'un personnage (ou d'un assemblage modulaire) + composants exacts (versions figées si publiée)."""
    a = get_asset_row(conn, asset_id)
    if a["family"] != family:
        raise ServiceError(422, "Cet asset n'est pas un personnage.")
    v = get_version_row(conn, asset_id, version or a["latest_version"])
    d = json.loads(v["definition"])
    pins = json.loads(v["pins"]) if v["pins"] else None
    parts = {}
    for pid in asset_refs(d, family):
        pv = (pins or {}).get("assets", {}).get(pid)
        payload = part_payload(conn, pid, pv)
        if payload and pins:
            mrev = (pins.get("media") or {}).get(payload["props"].get("svg_media"))
            pv_row = get_version_row(conn, pid, payload["version"])
            ppins = json.loads(pv_row["pins"]) if pv_row["pins"] else {}
            mrev = (ppins.get("media") or {}).get(payload["props"].get("svg_media"), mrev)
            if mrev:
                payload = part_payload(conn, pid, pv, mrev)
        if payload:
            parts[pid] = payload
    return {"asset_id": asset_id, "version": v["version"], "status": v["status"], "definition": d, "parts": parts,
            "pinned": pins is not None, "reference_anchors": REFERENCE_ANCHORS}


# ---------------------------------------------------------------- utilisateurs

def list_users(conn) -> list[dict]:
    sessions = dict(conn.execute("SELECT user_id, COUNT(*) FROM sessions GROUP BY user_id").fetchall())
    return [{"id": r["id"], "username": r["username"], "role": r["role"], "role_label": auth.ROLE_LABELS.get(r["role"], r["role"]),
             "active": bool(r["active"]), "created_at": r["created_at"], "sessions": sessions.get(r["id"], 0)}
            for r in conn.execute("SELECT * FROM users ORDER BY username")]


def create_user(conn, user, username: str, password: str, role: str) -> dict:
    username = username.strip().lower()
    if not auth.USERNAME.match(username):
        raise ServiceError(422, "Identifiant : 2 à 40 caractères, minuscules, chiffres, « . », « _ » ou « - ».")
    if role not in auth.ROLE_PERMISSIONS:
        raise ServiceError(422, "Rôle inconnu.")
    weak = auth.check_password_strength(password)
    if weak:
        raise ServiceError(422, weak)
    if conn.execute("SELECT 1 FROM users WHERE username=?", (username,)).fetchone():
        raise ServiceError(409, "Cet identifiant existe déjà.")
    with tx(conn):
        auth.create_user(conn, username, password, role, commit=False)
        audit(conn, user["username"], "user.create", username, {"role": role})
    return next(u for u in list_users(conn) if u["username"] == username)


def _active_admins(conn, excluding: int | None = None) -> int:
    return conn.execute("SELECT COUNT(*) FROM users WHERE role='admin' AND active=1 AND id<>?", (excluding or -1,)).fetchone()[0]


def update_user(conn, user, user_id: int, patch: dict) -> dict:
    row = conn.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
    if not row:
        raise ServiceError(404, "Utilisateur introuvable.")
    demote = patch.get("role") is not None and patch["role"] != "admin"
    disable = patch.get("active") is False
    if row["role"] == "admin" and (demote or disable) and _active_admins(conn, user_id) == 0:
        raise ServiceError(409, "Il doit rester au moins un administrateur actif.")
    if patch.get("role") is not None and patch["role"] not in auth.ROLE_PERMISSIONS:
        raise ServiceError(422, "Rôle inconnu.")
    if patch.get("password") is not None:
        weak = auth.check_password_strength(patch["password"])
        if weak:
            raise ServiceError(422, weak)
    with tx(conn):
        if patch.get("role") is not None:
            conn.execute("UPDATE users SET role=? WHERE id=?", (patch["role"], user_id))
        if patch.get("active") is not None:
            conn.execute("UPDATE users SET active=? WHERE id=?", (1 if patch["active"] else 0, user_id))
            if not patch["active"]:
                conn.execute("DELETE FROM sessions WHERE user_id=?", (user_id,))
        if patch.get("password") is not None:
            auth.set_password(conn, user_id, patch["password"])
        audit(conn, user["username"], "user.update", row["username"],
              {k: ("***" if k == "password" else v) for k, v in patch.items() if v is not None})
    return next(u for u in list_users(conn) if u["id"] == user_id)


def change_own_password(conn, user, token: str, current: str, new: str) -> None:
    row = conn.execute("SELECT * FROM users WHERE id=?", (user["id"],)).fetchone()
    if not auth.verify_password(current, row["pw_hash"]):
        raise ServiceError(403, "Mot de passe actuel incorrect.")
    weak = auth.check_password_strength(new)
    if weak:
        raise ServiceError(422, weak)
    with tx(conn):
        auth.set_password(conn, user["id"], new, keep_token=token)
        audit(conn, user["username"], "user.password", user["username"])


# ---------------------------------------------------------------- tableau de bord

ASSET_ACTIONS = ("asset.create", "asset.update_draft", "asset.new_draft", "asset.submit", "asset.approve", "asset.reject",
                 "asset.publish", "asset.archive", "asset.restore", "asset.revert", "asset.migrate", "asset.import")


def dashboard(conn) -> dict:
    items = list_assets(conn)
    by_status: dict[str, int] = {}
    by_family: dict[str, int] = {}
    by_category: dict[str, int] = {}
    for a in items:
        by_status[a["status"]] = by_status.get(a["status"], 0) + 1
        by_family[a["family"]] = by_family.get(a["family"], 0) + 1
        by_category[a["category"]] = by_category.get(a["category"], 0) + 1
    names = {a["id"]: a["name"] for a in items}
    recent = []
    for r in conn.execute(f"SELECT * FROM audit WHERE action IN ({','.join('?' * len(ASSET_ACTIONS))}) ORDER BY id DESC LIMIT 12", ASSET_ACTIONS):
        recent.append({"ts": r["ts"], "username": r["username"], "action": r["action"], "asset_id": r["target"],
                       "name": names.get(r["target"], r["target"]), "detail": json.loads(r["detail"] or "{}")})
    slim = lambda a: {k: a[k] for k in ("id", "name", "family", "category", "status", "latest_version", "errors", "warnings", "created_at", "updated_at", "created_by")}  # noqa: E731
    return {
        "total": len(items), "by_status": by_status, "by_family": by_family, "by_category": by_category,
        "recent_changes": recent,
        "recent_created": [slim(a) for a in sorted(items, key=lambda a: -a["created_at"])[:6]],
        "with_errors": [slim(a) for a in items if a["errors"] and not a["archived"]][:12],
        "waiting": [slim(a) for a in items if a["status"] in ("in_review", "validated")][:12],
        "media": conn.execute("SELECT COUNT(*) FROM media WHERE archived=0").fetchone()[0],
        "scenes": conn.execute("SELECT COUNT(*) FROM scenes").fetchone()[0],
    }
