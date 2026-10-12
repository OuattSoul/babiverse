"""Import / export de lots d'assets (format « babiverse-studio-bundle », version 1).

Archive zip :
    manifest.json            format, version, contenu, dépendances
    assets/<asset_id>.json   identité stable + versions exportées (définition, statut, dépendances figées)
    media/<sha256>.<ext>     fichiers (SVG assainis, images) — une entrée par révision utile
    scenes/<scene_id>.json   scène de test et ses instances (asset_id@version)

Garanties :
- les identifiants d'assets et de médias sont conservés : réimporter un export retrouve les mêmes références ;
- rien n'est écrasé : un conflit se résout par « ignorer », « importer comme copie » (nouvel identifiant, références
  internes renommées) ou « nouvelle version » (ajoutée en brouillon à l'asset existant) ;
- tout est revérifié à l'import (schéma, signature et assainissement des fichiers, empreintes) ;
- un import appliqué peut être annulé tant que ses éléments n'ont pas été réutilisés ailleurs.
"""
from __future__ import annotations

import hashlib
import io
import json
import os
import time
import uuid
import zipfile

from pydantic import ValidationError

from . import media as md
from .db import audit, tx
from .models import AssetDefinition
from .refs import asset_refs, media_refs, remap
from .service import CONTEXT, ServiceError, _validate, get_asset_row, read_file, store_file, world_state
from .taxonomy import CATEGORY_BY_KEY, FAMILIES, reload as reload_categories

FORMAT = "babiverse-studio-bundle"
FORMAT_VERSION = 1
STUDIO_VERSION = "1.0.0"
MAX_FILES = 5000
MAX_UNCOMPRESSED = 300 * 1024 * 1024
FAMILY_ORDER = ["character_part", "component", "furniture", "interior", "surface", "road", "prop", "vehicle", "building", "character"]


# ---------------------------------------------------------------- export

def _closure(conn, ids: set[str], versions_mode: str) -> set[str]:
    todo, seen = list(ids), set()
    while todo:
        aid = todo.pop()
        if aid in seen:
            continue
        a = conn.execute("SELECT * FROM assets WHERE id=?", (aid,)).fetchone()
        if not a:
            continue
        seen.add(aid)
        for v in _versions(conn, a, versions_mode):
            todo.extend(asset_refs(json.loads(v["definition"]), a["family"]) - seen)
    return seen


def _versions(conn, a, mode: str, extra: set[int] | None = None):
    rows = conn.execute("SELECT * FROM asset_versions WHERE asset_id=? ORDER BY version", (a["id"],)).fetchall()
    if mode == "all":
        keep = {r["version"] for r in rows}
    elif mode == "published":
        keep = {a["published_version"] or a["latest_version"]}
    else:
        keep = {a["latest_version"]}
    keep |= extra or set()
    return [r for r in rows if r["version"] in keep]


def export_bundle(conn, user, asset_ids: list[str], all_assets: bool, include_dependencies: bool, versions: str,
                  scene_ids: list[str]) -> tuple[bytes, dict]:
    ids = {r["id"] for r in conn.execute("SELECT id FROM assets")} if all_assets else set(asset_ids)
    for aid in ids:
        get_asset_row(conn, aid)
    scenes = []
    needed_versions: dict[str, set[int]] = {}
    for sid in scene_ids:
        ws = world_state(conn, sid)
        scenes.append(ws)
        for i in ws["instances"]:
            ids.add(i["asset_id"])
            needed_versions.setdefault(i["asset_id"], set()).add(i["version"])
    if include_dependencies:
        ids = _closure(conn, ids, versions)
    if not ids and not scenes:
        raise ServiceError(422, "Rien à exporter : choisissez au moins un asset ou une scène.")

    buf = io.BytesIO()
    manifest = {"format": FORMAT, "format_version": FORMAT_VERSION, "studio_version": STUDIO_VERSION,
                "exported_at": time.time(), "exported_by": user["username"], "versions_mode": versions,
                "assets": [], "media": [], "categories": [], "scenes": [], "dependencies": {}}
    media_revs: dict[str, set[int]] = {}
    cats = set()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for aid in sorted(ids):
            a = get_asset_row(conn, aid)
            vers = _versions(conn, a, versions, needed_versions.get(aid))
            deps = set()
            out_versions = []
            for v in vers:
                d = json.loads(v["definition"])
                deps |= asset_refs(d, a["family"])
                pins = json.loads(v["pins"]) if v["pins"] else None
                for mid in media_refs(d, a["family"]):
                    rev = (pins or {}).get("media", {}).get(mid)
                    cur = conn.execute("SELECT revision FROM media WHERE id=?", (mid,)).fetchone()
                    if cur:
                        media_revs.setdefault(mid, set()).add(rev or cur["revision"])
                        media_revs[mid].add(cur["revision"])
                out_versions.append({"version": v["version"], "status": v["status"], "definition": d, "pins": pins,
                                     "note": v["note"], "created_at": v["created_at"], "published_at": v["published_at"]})
            cats.add(a["category"])
            doc = {"asset": {"id": a["id"], "technical_name": a["technical_name"], "family": a["family"], "category": a["category"],
                             "archived": bool(a["archived"]), "derived_from": a["derived_from"], "created_by": a["created_by"],
                             "created_at": a["created_at"], "published_version": a["published_version"]},
                   "versions": out_versions}
            z.writestr(f"assets/{aid}.json", json.dumps(doc, ensure_ascii=False, indent=1))
            manifest["assets"].append({"asset_id": aid, "technical_name": a["technical_name"], "family": a["family"],
                                       "category": a["category"], "versions": [v["version"] for v in vers],
                                       "published_version": a["published_version"], "file": f"assets/{aid}.json"})
            manifest["dependencies"][aid] = sorted(deps)
        for mid, revs in sorted(media_revs.items()):
            m = conn.execute("SELECT * FROM media WHERE id=?", (mid,)).fetchone()
            entry = {"id": mid, "name": m["name"], "kind": m["kind"], "category": m["category"], "tags": json.loads(m["tags"]),
                     "current_revision": m["revision"], "archived": bool(m["archived"]), "revisions": []}
            for rev in sorted(revs):
                r = conn.execute("SELECT * FROM media_revisions WHERE media_id=? AND revision=?", (mid, rev)).fetchone()
                if not r:
                    continue
                ext = "svg" if r["mime"] == "image/svg+xml" else md.RASTER.get(r["mime"], "bin")
                name = f"media/{r['sha256']}.{ext}"
                if name not in z.namelist():
                    z.writestr(name, read_file(conn, r["sha256"], r["mime"]))
                entry["revisions"].append({"revision": rev, "sha256": r["sha256"], "mime": r["mime"], "filename": r["filename"], "file": name})
            manifest["media"].append(entry)
        for key in sorted(cats):
            c = CATEGORY_BY_KEY.get(key)
            if c:
                manifest["categories"].append({k: c[k] for k in ("key", "label", "family", "rules", "subcategories", "description")})
        for ws in scenes:
            z.writestr(f"scenes/{ws['id']}.json", json.dumps({k: ws[k] for k in ("id", "name", "description", "width", "height", "terrain", "instances")},
                                                            ensure_ascii=False))
            manifest["scenes"].append({"id": ws["id"], "name": ws["name"], "instances": len(ws["instances"]), "file": f"scenes/{ws['id']}.json"})
        z.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=1))
    with tx(conn):
        audit(conn, user["username"], "bundle.export", None, {"assets": len(manifest["assets"]), "media": len(manifest["media"]),
                                                             "scenes": len(manifest["scenes"])})
    return buf.getvalue(), manifest


# ---------------------------------------------------------------- lecture et vérification d'une archive

def _open(data: bytes) -> tuple[zipfile.ZipFile, dict]:
    s = CONTEXT["settings"]
    if len(data) > s.max_import_bytes:
        raise ServiceError(422, f"Archive trop volumineuse (maximum {s.max_import_bytes // 1048576} Mo).")
    try:
        z = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as exc:
        raise ServiceError(422, "Archive zip illisible.") from exc
    infos = z.infolist()
    if len(infos) > MAX_FILES:
        raise ServiceError(422, "Archive : trop de fichiers.")
    if sum(i.file_size for i in infos) > MAX_UNCOMPRESSED:
        raise ServiceError(422, "Archive : contenu décompressé trop volumineux.")
    for i in infos:
        n = i.filename
        if n.startswith("/") or "\\" in n or ".." in n.split("/") or ":" in n:
            raise ServiceError(422, f"Archive : chemin interdit ({n}).")
    try:
        manifest = json.loads(z.read("manifest.json"))
    except KeyError as exc:
        raise ServiceError(422, "Archive : manifest.json manquant.") from exc
    except ValueError as exc:
        raise ServiceError(422, "Archive : manifest.json illisible.") from exc
    if manifest.get("format") != FORMAT:
        raise ServiceError(422, f"Format inconnu : {manifest.get('format')!r} (attendu : {FORMAT}).")
    if manifest.get("format_version") != FORMAT_VERSION:
        raise ServiceError(422, f"Version de format non prise en charge : {manifest.get('format_version')}.")
    return z, manifest


def _read_assets(z, manifest) -> dict[str, dict]:
    out = {}
    for entry in manifest.get("assets", []):
        try:
            doc = json.loads(z.read(entry["file"]))
        except (KeyError, ValueError):
            out[entry["asset_id"]] = {"entry": entry, "error": "fichier d'asset manquant ou illisible"}
            continue
        problems = []
        a = doc.get("asset") or {}
        if a.get("id") != entry["asset_id"]:
            problems.append("identifiant incohérent avec le manifeste")
        if a.get("family") not in FAMILIES:
            problems.append(f"famille inconnue : {a.get('family')}")
        for v in doc.get("versions", []):
            try:
                AssetDefinition.model_validate(v["definition"])
            except (ValidationError, KeyError, TypeError) as exc:
                problems.append(f"v{v.get('version')} : schéma invalide ({str(exc).splitlines()[0][:120]})")
        if not doc.get("versions"):
            problems.append("aucune version")
        out[entry["asset_id"]] = {"entry": entry, "doc": doc, "error": "; ".join(problems) if problems else None}
    return out


def _check_media(z, manifest) -> dict[str, dict]:
    s = CONTEXT["settings"]
    out = {}
    for m in manifest.get("media", []):
        problems, revs = [], []
        for r in m.get("revisions", []):
            try:
                data = z.read(r["file"])
            except KeyError:
                problems.append(f"révision {r.get('revision')} : fichier manquant")
                continue
            if hashlib.sha256(data).hexdigest() != r.get("sha256"):
                problems.append(f"révision {r.get('revision')} : empreinte incorrecte (fichier altéré)")
                continue
            try:
                info = md.inspect(data, r.get("filename", "fichier"), s.max_upload_bytes, s.max_image_px)
            except md.MediaError as exc:
                problems.append(f"révision {r.get('revision')} : {exc}")
                continue
            revs.append({**r, "info": info})
        out[m["id"]] = {"entry": m, "revisions": revs, "error": "; ".join(problems) if problems else None}
    return out


def _canon(d: dict) -> str:
    return json.dumps(d, sort_keys=True, ensure_ascii=False)


ALLOWED = {"new": ["create", "copy", "skip"], "identical": ["skip", "copy"], "conflict_id": ["skip", "copy", "new_version"],
           "conflict_name": ["skip", "copy"], "invalid": ["skip"]}


def analyze(conn, data: bytes) -> dict:
    z, manifest = _open(data)
    assets = _read_assets(z, manifest)
    medias = _check_media(z, manifest)
    items = []
    for aid, a in assets.items():
        e = a["entry"]
        row = {"asset_id": aid, "technical_name": e.get("technical_name"), "family": e.get("family"), "category": e.get("category"),
               "versions": e.get("versions", []), "name": None, "status": "new", "message": ""}
        if a["error"]:
            row.update(status="invalid", message=a["error"])
        else:
            latest = a["doc"]["versions"][-1]["definition"]
            row["name"] = latest.get("name")
            existing = conn.execute("SELECT * FROM assets WHERE id=?", (aid,)).fetchone()
            by_name = conn.execute("SELECT * FROM assets WHERE technical_name=?", (e["technical_name"],)).fetchone()
            if e["category"] not in CATEGORY_BY_KEY and not any(c["key"] == e["category"] for c in manifest.get("categories", [])):
                row.update(status="invalid", message=f"catégorie absente : {e['category']}")
            elif existing:
                cur = conn.execute("SELECT definition FROM asset_versions WHERE asset_id=? AND version=?", (aid, existing["latest_version"])).fetchone()
                if _canon(json.loads(cur["definition"])) == _canon(latest):
                    row.update(status="identical", message="déjà présent à l'identique")
                else:
                    row.update(status="conflict_id", message=f"un asset avec cet identifiant existe déjà (v{existing['latest_version']}) avec un contenu différent")
            elif by_name:
                row.update(status="conflict_name", message=f"le nom technique « {e['technical_name']} » est déjà utilisé par un autre asset")
        row["options"] = ALLOWED[row["status"]]
        row["default"] = {"new": "create", "identical": "skip", "conflict_id": "skip", "conflict_name": "skip", "invalid": "skip"}[row["status"]]
        items.append(row)
    media_items = []
    for mid, m in medias.items():
        existing = conn.execute("SELECT * FROM media WHERE id=?", (mid,)).fetchone()
        shas = [r["sha256"] for r in m["entry"].get("revisions", [])]
        same = bool(existing and existing["sha256"] in shas)
        media_items.append({"id": mid, "name": m["entry"].get("name"), "kind": m["entry"].get("kind"),
                            "status": "invalid" if m["error"] else "identical" if same else "conflict" if existing else "new",
                            "message": m["error"] or ("déjà présent" if same else "identifiant déjà utilisé : importé sous un nouvel identifiant" if existing else "")})
    cats = [c for c in manifest.get("categories", []) if c["key"] not in CATEGORY_BY_KEY]
    return {"manifest": {k: manifest.get(k) for k in ("format", "format_version", "studio_version", "exported_at", "exported_by", "versions_mode")},
            "assets": sorted(items, key=lambda i: (FAMILY_ORDER.index(i["family"]) if i["family"] in FAMILY_ORDER else 99, i["technical_name"] or "")),
            "media": media_items, "new_categories": cats, "scenes": manifest.get("scenes", []),
            "summary": {s: sum(1 for i in items if i["status"] == s) for s in ALLOWED}}


def preview(conn, user, data: bytes, filename: str) -> dict:
    analysis = analyze(conn, data)
    iid = f"imp-{uuid.uuid4().hex[:12]}"
    folder = os.path.join(CONTEXT["settings"].media_dir, "imports")
    os.makedirs(folder, exist_ok=True)
    with open(os.path.join(folder, f"{iid}.zip"), "wb") as f:
        f.write(data)
    now = time.time()
    with tx(conn):
        conn.execute("INSERT INTO imports (id, status, filename, manifest, analysis, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)",
                     (iid, "pending", md.safe_filename(filename), json.dumps(analysis["manifest"], ensure_ascii=False),
                      json.dumps(analysis, ensure_ascii=False), user["username"], now, now))
        audit(conn, user["username"], "bundle.preview", iid, analysis["summary"])
    return {"id": iid, "status": "pending", **analysis}


# ---------------------------------------------------------------- application

def _unique_name(conn, base: str) -> str:
    base = base[:40]
    n, cand = 1, f"{base}-import"
    while conn.execute("SELECT 1 FROM assets WHERE technical_name=?", (cand,)).fetchone():
        n += 1
        cand = f"{base}-import-{n}"
    return cand


def _remap_pins(pins, amap, mmap):
    if not pins:
        return pins
    return {"assets": {amap.get(k, k): v for k, v in (pins.get("assets") or {}).items()},
            "media": {mmap.get(k, k): v for k, v in (pins.get("media") or {}).items()}}


def apply(conn, user, import_id: str, decisions: dict[str, str], import_scenes: bool = True) -> dict:
    row = conn.execute("SELECT * FROM imports WHERE id=?", (import_id,)).fetchone()
    if not row:
        raise ServiceError(404, "Import introuvable.")
    if row["status"] != "pending":
        raise ServiceError(409, f"Cet import est déjà « {row['status']} ».")
    path = os.path.join(CONTEXT["settings"].media_dir, "imports", f"{import_id}.zip")
    with open(path, "rb") as f:
        data = f.read()
    analysis = analyze(conn, data)  # recalculée : la base a pu changer depuis l'aperçu
    z, manifest = _open(data)
    assets = _read_assets(z, manifest)
    medias = _check_media(z, manifest)
    s = CONTEXT["settings"]
    now = time.time()
    result = {"created_assets": [], "copied_assets": [], "new_versions": [], "skipped": [], "errors": [], "warnings": [],
              "created_media": [], "reused_media": [], "created_categories": [], "created_scenes": [], "instances": 0}
    plan = {}
    for item in analysis["assets"]:
        choice = decisions.get(item["asset_id"], item["default"])
        if choice not in item["options"]:
            raise ServiceError(422, f"Décision « {choice} » impossible pour {item['technical_name']} ({item['status']}).")
        plan[item["asset_id"]] = (choice, item)

    with tx(conn):
        # 1. catégories manquantes
        for c in analysis["new_categories"]:
            if c["family"] not in FAMILIES:
                result["errors"].append(f"Catégorie « {c['key']} » : famille inconnue.")
                continue
            conn.execute("INSERT INTO categories (key, label, family, rules, subcategories, description, builtin, archived, position, created_at, updated_at) "
                         "VALUES (?,?,?,?,?,?,0,0,999,?,?)", (c["key"], c["label"], c["family"], json.dumps(c.get("rules", [])),
                                                             json.dumps(c.get("subcategories", []), ensure_ascii=False), c.get("description", ""), now, now))
            result["created_categories"].append(c["key"])
        reload_categories(conn)

        # 2. médias : même identifiant si libre, sinon réutilisation par empreinte, sinon nouvel identifiant
        mmap: dict[str, str] = {}
        for mid, m in medias.items():
            if m["error"] or not m["revisions"]:
                if m["error"]:
                    result["warnings"].append(f"Fichier « {m['entry'].get('name')} » ignoré : {m['error']}")
                continue
            existing = conn.execute("SELECT * FROM media WHERE id=?", (mid,)).fetchone()
            last = m["revisions"][-1]
            last_sha_stored = hashlib.sha256(last["info"]["data"]).hexdigest()
            if existing and existing["sha256"] in (last["sha256"], last_sha_stored):
                mmap[mid] = mid
                result["reused_media"].append(mid)
                continue
            same = conn.execute("SELECT id FROM media WHERE sha256 IN (?,?) AND archived=0", (last["sha256"], last_sha_stored)).fetchone()
            if same:
                mmap[mid] = same["id"]
                result["reused_media"].append(same["id"])
                continue
            new_id = mid if not existing else f"m-{uuid.uuid4().hex[:16]}"
            mmap[mid] = new_id
            e = m["entry"]
            stored = []
            for r in m["revisions"]:
                info = r["info"]
                sha = store_file(conn, info["data"], info["ext"])
                stored.append((r, info, sha, json.dumps(info["meta"], ensure_ascii=False), md.safe_filename(r.get("filename", "fichier"))))
            r, info, sha, meta, fname = stored[-1]  # la ligne du média décrit la dernière révision
            conn.execute("INSERT INTO media (id, name, filename, kind, mime, size, sha256, width, height, meta, tags, category, revision, archived, created_by, created_at, updated_at) "
                         "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,?)",
                         (new_id, (e.get("name") or fname)[:80], fname, info["kind"], info["mime"], len(info["data"]), sha, info["width"],
                          info["height"], meta, json.dumps(e.get("tags") or [], ensure_ascii=False),
                          e.get("category") if e.get("category") in md.MEDIA_CATEGORIES else "other", r["revision"], user["username"], now, now))
            for r, info, sha, meta, fname in stored:
                conn.execute("INSERT INTO media_revisions (media_id, revision, filename, mime, size, sha256, width, height, meta, created_by, created_at) "
                             "VALUES (?,?,?,?,?,?,?,?,?,?,?)", (new_id, r["revision"], fname, info["mime"], len(info["data"]), sha,
                                                               info["width"], info["height"], meta, user["username"], now))
            result["created_media"].append(new_id)

        # 3. table de correspondance des assets
        amap: dict[str, str] = {}
        names: dict[str, str] = {}
        for aid, (choice, item) in plan.items():
            if choice == "copy":
                amap[aid] = str(uuid.uuid4())
                names[aid] = _unique_name(conn, item["technical_name"])

        # 4. création dans l'ordre des dépendances
        order = sorted(plan, key=lambda k: FAMILY_ORDER.index(plan[k][1]["family"]) if plan[k][1]["family"] in FAMILY_ORDER else 99)
        for aid in order:
            choice, item = plan[aid]
            if choice == "skip":
                result["skipped"].append({"asset_id": aid, "technical_name": item["technical_name"], "reason": item["message"] or "ignoré"})
                continue
            doc = assets[aid]["doc"]
            meta = doc["asset"]
            fam = meta["family"]
            versions = doc["versions"]
            if choice == "create":
                if conn.execute("SELECT 1 FROM assets WHERE id=? OR technical_name=?", (aid, meta["technical_name"])).fetchone():
                    result["errors"].append(f"« {meta['technical_name']} » existe déjà : création impossible.")
                    continue
                pub = None
                for v in versions:
                    if v["status"] == "published":
                        pub = v["version"]
                latest = versions[-1]["version"]
                conn.execute("INSERT INTO assets (id, technical_name, category, family, created_by, created_at, updated_at, archived, published_version, latest_version, derived_from) "
                             "VALUES (?,?,?,?,?,?,?,0,?,?,?)", (aid, meta["technical_name"], meta["category"], fam, user["username"], now, now, pub, latest, meta.get("derived_from")))
                for v in versions:
                    d = remap(v["definition"], fam, amap, mmap)
                    status = "draft" if v["status"] == "in_review" else v["status"]
                    rep = _validate(conn, d, meta["category"], for_publish=status in ("published", "validated")).as_dict()
                    if not rep["ok"] and status in ("published", "validated"):
                        result["warnings"].append(f"« {meta['technical_name']} » v{v['version']} ({status}) : {rep['errors']} erreur(s) dans cet environnement.")
                    conn.execute("INSERT INTO asset_versions (asset_id, version, status, definition, validation, created_by, created_at, updated_at, published_at, pins, note) "
                                 "VALUES (?,?,?,?,?,?,?,?,?,?,?)", (aid, v["version"], status, json.dumps(d, ensure_ascii=False), json.dumps(rep, ensure_ascii=False),
                                                                   user["username"], now, now, v.get("published_at"), json.dumps(_remap_pins(v.get("pins"), amap, mmap)) if v.get("pins") else None,
                                                                   v.get("note") or "Importé"))
                result["created_assets"].append({"asset_id": aid, "technical_name": meta["technical_name"], "versions": [v["version"] for v in versions]})
            elif choice == "copy":
                new_id, tech = amap[aid], names[aid]
                d = remap(versions[-1]["definition"], fam, amap, mmap)
                rep = _validate(conn, d, meta["category"]).as_dict()
                conn.execute("INSERT INTO assets (id, technical_name, category, family, created_by, created_at, updated_at, latest_version, derived_from) "
                             "VALUES (?,?,?,?,?,?,?,1,?)", (new_id, tech, meta["category"], fam, user["username"], now, now, aid))
                conn.execute("INSERT INTO asset_versions (asset_id, version, status, definition, validation, created_by, created_at, updated_at, note) "
                             "VALUES (?,1,'draft',?,?,?,?,?,?)", (new_id, json.dumps(d, ensure_ascii=False), json.dumps(rep, ensure_ascii=False),
                                                                 user["username"], now, now, f"Copie importée de {meta['technical_name']}"))
                result["copied_assets"].append({"asset_id": new_id, "technical_name": tech, "from": aid})
            elif choice == "new_version":
                a = conn.execute("SELECT * FROM assets WHERE id=?", (aid,)).fetchone()
                cur = conn.execute("SELECT status FROM asset_versions WHERE asset_id=? AND version=?", (aid, a["latest_version"])).fetchone()
                if cur["status"] in ("draft", "in_review"):
                    result["errors"].append(f"« {a['technical_name']} » : un brouillon ou une version en validation existe déjà.")
                    continue
                d = remap(versions[-1]["definition"], fam, amap, mmap)
                rep = _validate(conn, d, a["category"]).as_dict()
                nv = a["latest_version"] + 1
                conn.execute("INSERT INTO asset_versions (asset_id, version, status, definition, validation, created_by, created_at, updated_at, note) "
                             "VALUES (?,?,'draft',?,?,?,?,?,?)", (aid, nv, json.dumps(d, ensure_ascii=False), json.dumps(rep, ensure_ascii=False),
                                                                 user["username"], now, now, "Version importée"))
                conn.execute("UPDATE assets SET latest_version=?, updated_at=? WHERE id=?", (nv, now, aid))
                result["new_versions"].append({"asset_id": aid, "technical_name": a["technical_name"], "version": nv})

        # 5. scènes : toujours créées sous un nouvel identifiant (jamais d'écrasement)
        if import_scenes:
            from . import placement as pl
            for sc in manifest.get("scenes", []):
                try:
                    sdoc = json.loads(z.read(sc["file"]))
                except (KeyError, ValueError):
                    result["errors"].append(f"Scène « {sc.get('name')} » illisible.")
                    continue
                sid = f"scene-{uuid.uuid4().hex[:10]}"
                w, h = int(sdoc["width"]), int(sdoc["height"])
                terrain = sdoc["terrain"]
                if not (8 <= w <= 120 and 8 <= h <= 120) or len(terrain) != h or any(len(r) != w or set(r) - set("gsw") for r in terrain):
                    result["errors"].append(f"Scène « {sc.get('name')} » : dimensions ou terrain invalides.")
                    continue
                conn.execute("INSERT INTO scenes (id, name, description, width, height, terrain, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
                             (sid, f"{sdoc['name']} (import)"[:60], sdoc.get("description", ""), w, h, json.dumps(terrain), user["username"], now, now))
                result["created_scenes"].append(sid)
                world = pl.WorldState(conn, scene_id=sid)
                for inst in sdoc.get("instances", []):
                    tid = amap.get(inst["asset_id"], inst["asset_id"])
                    vrow = conn.execute("SELECT v.definition, a.family FROM asset_versions v JOIN assets a ON a.id=v.asset_id WHERE v.asset_id=? AND v.version=?",
                                        (tid, inst["version"])).fetchone()
                    if not vrow:
                        result["warnings"].append(f"Instance ignorée : {inst['asset_id']}@{inst['version']} absent.")
                        continue
                    d = json.loads(vrow["definition"])
                    rep = pl.check_placement(world, d, vrow["family"], inst["x"], inst["y"], inst["rotation"])
                    if not rep.ok:
                        result["warnings"].append(f"Instance ignorée : « {d['name']} » en ({inst['x']}, {inst['y']}) — {rep.items[0]['message']}")
                        continue
                    nid = str(uuid.uuid4())
                    conn.execute("INSERT INTO instances (id, asset_id, version, x, y, rotation, variant_id, owner_id, created_at, scene_id, data) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                                 (nid, tid, inst["version"], inst["x"], inst["y"], inst["rotation"], inst.get("variant_id"), user["id"], now, sid,
                                  json.dumps(inst.get("data") or {}, ensure_ascii=False)))
                    world.add({"id": nid, "asset_id": tid, "version": inst["version"], "family": vrow["family"], "x": inst["x"], "y": inst["y"],
                               "rotation": inst["rotation"], "def": d})
                    result["instances"] += 1

        conn.execute("UPDATE imports SET status='applied', result=?, updated_at=? WHERE id=?", (json.dumps(result, ensure_ascii=False), time.time(), import_id))
        audit(conn, user["username"], "asset.import", import_id, {"created": len(result["created_assets"]), "copies": len(result["copied_assets"]),
                                                                  "versions": len(result["new_versions"]), "media": len(result["created_media"])})
    return {"id": import_id, "status": "applied", "result": result}


def rollback(conn, user, import_id: str) -> dict:
    row = conn.execute("SELECT * FROM imports WHERE id=?", (import_id,)).fetchone()
    if not row:
        raise ServiceError(404, "Import introuvable.")
    if row["status"] != "applied":
        raise ServiceError(409, "Seul un import appliqué peut être annulé.")
    res = json.loads(row["result"])
    scenes = set(res["created_scenes"])
    created = [a["asset_id"] for a in res["created_assets"]] + [a["asset_id"] for a in res["copied_assets"]]
    blockers = []
    for aid in created:
        q = "SELECT COUNT(*) FROM instances WHERE asset_id=?" + (f" AND scene_id NOT IN ({','.join('?' * len(scenes))})" if scenes else "")
        if conn.execute(q, (aid, *scenes)).fetchone()[0]:
            blockers.append(f"{aid} est placé dans une scène qui ne vient pas de cet import")
        for ref in conn.execute("SELECT a.id, a.technical_name, a.family, v.definition FROM assets a JOIN asset_versions v ON v.asset_id=a.id").fetchall():
            if ref["id"] not in created and aid in asset_refs(json.loads(ref["definition"]), ref["family"]):
                blockers.append(f"{aid} est utilisé par « {ref['technical_name']} »")
    for nv in res["new_versions"]:
        a = conn.execute("SELECT latest_version FROM assets WHERE id=?", (nv["asset_id"],)).fetchone()
        st = conn.execute("SELECT status FROM asset_versions WHERE asset_id=? AND version=?", (nv["asset_id"], nv["version"])).fetchone()
        if not a or a["latest_version"] != nv["version"] or not st or st["status"] != "draft":
            blockers.append(f"la version {nv['version']} de « {nv['technical_name']} » a déjà évolué")
    if blockers:
        raise ServiceError(409, "Annulation impossible : " + " ; ".join(sorted(set(blockers))[:8]))
    with tx(conn):
        for sid in scenes:
            conn.execute("DELETE FROM instances WHERE scene_id=?", (sid,))
            conn.execute("DELETE FROM scenes WHERE id=?", (sid,))
        for aid in created:
            conn.execute("DELETE FROM instances WHERE asset_id=?", (aid,))
            conn.execute("DELETE FROM asset_versions WHERE asset_id=?", (aid,))
            conn.execute("DELETE FROM assets WHERE id=?", (aid,))
        for nv in res["new_versions"]:
            conn.execute("DELETE FROM asset_versions WHERE asset_id=? AND version=?", (nv["asset_id"], nv["version"]))
            conn.execute("UPDATE assets SET latest_version=? WHERE id=?", (nv["version"] - 1, nv["asset_id"]))
        kept_media = []
        for mid in res["created_media"]:
            in_use = any(mid in media_refs(json.loads(r["definition"]), r["family"])
                         for r in conn.execute("SELECT a.family, v.definition FROM assets a JOIN asset_versions v ON v.asset_id=a.id"))
            if in_use:
                kept_media.append(mid)
                continue
            conn.execute("DELETE FROM media_revisions WHERE media_id=?", (mid,))
            conn.execute("DELETE FROM media WHERE id=?", (mid,))
        for key in res["created_categories"]:
            if not conn.execute("SELECT 1 FROM assets WHERE category=?", (key,)).fetchone():
                conn.execute("DELETE FROM categories WHERE key=?", (key,))
        conn.execute("UPDATE imports SET status='rolled_back', updated_at=? WHERE id=?", (time.time(), import_id))
        audit(conn, user["username"], "bundle.rollback", import_id, {"assets": len(created), "versions": len(res["new_versions"])})
    reload_categories(conn)
    return {"id": import_id, "status": "rolled_back", "kept_media": kept_media}


def list_imports(conn) -> list[dict]:
    return [{"id": r["id"], "status": r["status"], "filename": r["filename"], "created_by": r["created_by"], "created_at": r["created_at"],
             "summary": json.loads(r["analysis"]).get("summary"), "result": json.loads(r["result"]) if r["result"] else None}
            for r in conn.execute("SELECT * FROM imports ORDER BY created_at DESC LIMIT 50")]
