"""Monde du jeu : villes, zones (communes, quartiers), cartes jouables, brouillons et versions publiées.

Séparation des responsabilités (audit 2026-10-13, ADR 0012) :
- la **ressource** est un modèle 3D de la médiathèque (`media`, kind « model ») avec ses révisions ;
- l'**instance** (`landscapes` d'une carte) dit où et comment la poser : position, rotation, échelle, emprise solide ;
  elle fige la révision du fichier, donc remplacer le fichier ne change pas une carte publiée ;
- l'**objet interactif** (`interactives`) cible une zone de cases tracée à la main, ou déduite d'un objet nommé du
  modèle ; son **comportement** est un type connu du jeu (`shop`, `info`, `door`), jamais du code ;
- l'**état du jeu** (joueurs, positions, possessions) reste dans le serveur du jeu : rien ici ne le touche.

Cycle d'une carte : `draft` (brouillon seul) → `published` (le jeu reçoit `published_version`) ↔ `disabled`.
Enregistrer un brouillon ne change jamais la version publiée ; publier crée une version immuable (`map_versions`).
Les cartes intégrées au jeu (shared/maps.json : quartier, maison, epicerie) restent hors de ces tables.
"""
from __future__ import annotations

import json
import math
import time

from .db import audit, tx
from .service import ServiceError, get_media_row

RESERVED_MAPS = ("quartier", "maison", "epicerie")  # cartes intégrées au jeu (catalogue shared/maps.json)
ENTRANCE_ZONES = ("quartier",)
# Points d'arrivée des cartes intégrées (client/src/world/zones.js) ; la Cité Akwaba a aussi from_<carte> par accès.
BUILTIN_SPAWNS = {"quartier": {"default"}, "maison": {"default", "entree"}, "epicerie": {"default", "entree"}}
# Missions du jeu utilisables comme condition de passage (miroir de backend/game/rules.py MISSIONS, vérifié par un
# test du jeu : backend/game/tests/test_cartes.py).
GAME_MISSIONS = ("m_bienvenue", "m_courses", "m_manger", "m_sieste", "m_livraison", "m_epargne", "m_kiosque",
                 "m_premiere_vente", "m_dix_ventes", "m_terrain", "m_construire")
CONDITION_TYPES = ("mission_completed", "min_balance")
GROUNDS = {"grass": ",", "dirt": ".", "paving": ":", "sand": "."}
# Budget indicatif d'une carte pour un téléphone modeste (avertissement, pas de refus) : téléchargement et géométrie.
MOBILE_BUDGET = {"bytes": 8 * 1024 * 1024, "triangles": 300_000, "models": 12}
EPS = 1e-6


def _now() -> float:
    return time.time()


def _row(conn, sql: str, args=()):
    return conn.execute(sql, args).fetchone()


# ---------------------------------------------------------------- géométrie (même règle que client/src/world/dataMaps.js)

def footprint(inst: dict, bbox: list[float]) -> dict:
    """Cases couvertes au sol par une instance : boîte du modèle mise à l'échelle, tournée (sens horaire, quarts de
    tour) puis posée en (x, z). Retourne {x, y, w, h} en cases. 1 unité du modèle = 1 case à l'échelle 1."""
    s = inst.get("scale", 1.0)
    r = math.radians(inst.get("rotation", 0))
    c, n = round(math.cos(r)), round(math.sin(r))
    xs, zs = [], []
    for x in (bbox[0] * s, bbox[3] * s):
        for z in (bbox[2] * s, bbox[5] * s):
            xs.append(inst["x"] + x * c - z * n)
            zs.append(inst["z"] + x * n + z * c)
    x0, z0 = math.floor(min(xs) + EPS), math.floor(min(zs) + EPS)
    x1, z1 = math.ceil(max(xs) - EPS), math.ceil(max(zs) - EPS)
    return {"x": x0, "y": z0, "w": max(1, x1 - x0), "h": max(1, z1 - z0)}


def _inside(a: dict, w: int, h: int) -> bool:
    """Dans la carte, hors de l'enceinte (rangée de bord)."""
    return a["x"] >= 1 and a["y"] >= 1 and a["x"] + a["w"] <= w - 1 and a["y"] + a["h"] <= h - 1


def _covers(a: dict, x: int, y: int) -> bool:
    return a["x"] <= x < a["x"] + a["w"] and a["y"] <= y < a["y"] + a["h"]


# ---------------------------------------------------------------- villes et zones

def _city_view(conn, c) -> dict:
    districts = []
    for d in conn.execute("SELECT * FROM districts WHERE city_id=? ORDER BY name", (c["id"],)).fetchall():
        maps = [_map_summary(conn, m) for m in conn.execute("SELECT * FROM game_maps WHERE district_id=? ORDER BY name", (d["id"],)).fetchall()]
        districts.append({"id": d["id"], "city_id": d["city_id"], "name": d["name"], "description": d["description"],
                          "status": d["status"], "maps": maps})
    return {"id": c["id"], "name": c["name"], "description": c["description"], "status": c["status"], "districts": districts}


def world(conn) -> dict:
    """Villes → zones → cartes, plus les cartes intégrées au jeu (non modifiables ici)."""
    cities = [_city_view(conn, c) for c in conn.execute("SELECT * FROM cities ORDER BY name").fetchall()]
    return {"cities": cities, "builtin_maps": list(RESERVED_MAPS), "entrance_zones": list(ENTRANCE_ZONES)}


def create_city(conn, user: dict, body: dict) -> dict:
    if _row(conn, "SELECT 1 FROM cities WHERE id=?", (body["id"],)):
        raise ServiceError(409, f"La ville « {body['id']} » existe déjà.")
    now = _now()
    with tx(conn):
        conn.execute("INSERT INTO cities (id, name, description, status, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
                     (body["id"], body["name"].strip(), body.get("description", ""), "published", user["username"], now, now))
        audit(conn, user["username"], "world.city.create", body["id"], {"name": body["name"]})
    return world(conn)


def create_district(conn, user: dict, body: dict) -> dict:
    if not _row(conn, "SELECT 1 FROM cities WHERE id=?", (body["city_id"],)):
        raise ServiceError(404, "Ville introuvable.")
    if _row(conn, "SELECT 1 FROM districts WHERE id=?", (body["id"],)):
        raise ServiceError(409, f"La zone « {body['id']} » existe déjà.")
    now = _now()
    with tx(conn):
        conn.execute("INSERT INTO districts (id, city_id, name, description, status, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)",
                     (body["id"], body["city_id"], body["name"].strip(), body.get("description", ""), "published", user["username"], now, now))
        audit(conn, user["username"], "world.district.create", body["id"], {"city": body["city_id"], "name": body["name"]})
    return world(conn)


# ---------------------------------------------------------------- cartes

def _map_row(conn, map_id: str):
    m = _row(conn, "SELECT * FROM game_maps WHERE id=?", (map_id,))
    if not m:
        raise ServiceError(404, "Carte introuvable.")
    return m


def _published_content(conn, m) -> dict | None:
    if not m["published_version"]:
        return None
    v = _row(conn, "SELECT content FROM map_versions WHERE map_id=? AND version=?", (m["id"], m["published_version"]))
    return json.loads(v["content"]) if v else None


def _map_summary(conn, m) -> dict:
    draft = json.loads(m["draft"])
    pub = _published_content(conn, m)
    return {"id": m["id"], "district_id": m["district_id"], "name": m["name"], "description": m["description"],
            "status": m["status"], "published_version": m["published_version"],
            # le brouillon diffère-t-il de la version publiée ? (édition en cours non visible dans le jeu)
            "draft_pending": pub is None or pub.get("draft") != draft,
            "updated_at": m["updated_at"]}


def create_map(conn, user: dict, body: dict) -> dict:
    mid = body["id"]
    if mid in RESERVED_MAPS or mid.startswith("int_"):
        raise ServiceError(422, f"« {mid} » est réservé aux cartes intégrées au jeu ou aux intérieurs générés.")
    if not _row(conn, "SELECT 1 FROM districts WHERE id=?", (body["district_id"],)):
        raise ServiceError(404, "Zone introuvable.")
    if _row(conn, "SELECT 1 FROM game_maps WHERE id=?", (mid,)):
        raise ServiceError(409, f"La carte « {mid} » existe déjà.")
    w, h = body.get("width", 24), body.get("height", 18)
    draft = {"width": w, "height": h, "ground": body.get("ground", "grass"), "spawn": [w // 2, h - 3],
             "landscapes": [], "interactives": [], "arrivals": [], "entrance": None}
    now = _now()
    with tx(conn):
        conn.execute("INSERT INTO game_maps (id, district_id, name, description, status, draft, published_version, created_by, created_at, updated_at) "
                     "VALUES (?,?,?,?,?,?,NULL,?,?,?)",
                     (mid, body["district_id"], body["name"].strip(), body.get("description", ""), "draft", json.dumps(draft), user["username"], now, now))
        audit(conn, user["username"], "world.map.create", mid, {"district": body["district_id"]})
    return map_detail(conn, mid)


def _model(conn, media_id: str, revision: int | None) -> tuple[dict, dict]:
    """Média modèle 3D et sa révision ; erreur explicite sinon."""
    try:
        m = get_media_row(conn, media_id)
    except ServiceError as exc:
        raise ServiceError(422, f"Paysage introuvable dans la médiathèque : {media_id}.") from exc
    if m["kind"] != "model":
        raise ServiceError(422, f"« {m['name']} » n'est pas un modèle 3D (GLB / glTF).")
    rev = revision or m["revision"]
    r = _row(conn, "SELECT * FROM media_revisions WHERE media_id=? AND revision=?", (media_id, rev))
    if not r:
        raise ServiceError(422, f"Révision {rev} introuvable pour « {m['name']} ».")
    return m, r


def _resolve(conn, content: dict) -> dict:
    """Complète le brouillon : révision figée, emprise de chaque instance, zone des objets ciblés par un nœud."""
    out = json.loads(json.dumps(content))
    models = {}
    for inst in out["landscapes"]:
        m, r = _model(conn, inst["media_id"], inst.get("revision"))
        inst["revision"] = r["revision"]
        meta = json.loads(r["meta"])
        models[inst["id"]] = meta
        inst["footprint"] = footprint(inst, meta["bbox"])
    for it in out["interactives"]:
        if it.get("node"):
            if not it.get("landscape") or it["landscape"] not in models:
                raise ServiceError(422, f"« {it['name']} » : choisir le paysage qui contient l'objet « {it['node']} ».")
            objs = [o for o in models[it["landscape"]].get("objects") or [] if o["name"] == it["node"]]
            if len(objs) != 1 or not objs[0].get("box"):
                raise ServiceError(422, f"« {it['name']} » : l'objet « {it['node']} » est absent du modèle ou son nom n'est pas unique ; "
                                        "tracer la zone à la main.")
            inst = next(i for i in out["landscapes"] if i["id"] == it["landscape"])
            it["area"] = footprint(inst, objs[0]["box"])
        elif not it.get("area"):
            raise ServiceError(422, f"« {it['name']} » : tracer une zone ou choisir un objet du modèle.")
    return out


def save_draft(conn, user: dict, map_id: str, body: dict) -> dict:
    """Enregistre le brouillon (la version publiée et le jeu ne changent pas)."""
    m = _map_row(conn, map_id)
    content = _resolve(conn, body)
    with tx(conn):
        conn.execute("UPDATE game_maps SET draft=?, updated_at=? WHERE id=?", (json.dumps(content), _now(), m["id"]))
        audit(conn, user["username"], "world.map.draft", m["id"], {"landscapes": len(content["landscapes"]), "interactives": len(content["interactives"])})
    return map_detail(conn, map_id)


def _known_targets(conn, map_id: str) -> set[str]:
    rows = conn.execute("SELECT id FROM game_maps WHERE status='published' OR id=?", (map_id,)).fetchall()
    return set(RESERVED_MAPS) | {r["id"] for r in rows}


def _published_maps(conn, exclude: str | None = None) -> list[tuple]:
    rows = conn.execute("SELECT * FROM game_maps WHERE status='published'").fetchall()
    return [(r, (_published_content(conn, r) or {}).get("draft") or {}) for r in rows if r["id"] != exclude]


def allowed_spawns(conn, map_id: str, content: dict, zone: str) -> set[str]:
    """Points d'arrivée possibles sur la carte `zone` (vue depuis la carte `map_id` dont `content` est le brouillon)."""
    entrances = {f"from_{r['id']}" for r, d in _published_maps(conn, map_id) if d.get("entrance")}
    if content.get("entrance"):
        entrances.add(f"from_{map_id}")
    if zone == "quartier":
        return BUILTIN_SPAWNS["quartier"] | entrances
    if zone in BUILTIN_SPAWNS:
        return BUILTIN_SPAWNS[zone]
    target = content if zone == map_id else next((d for r, d in _published_maps(conn) if r["id"] == zone), {})
    return {"default", "entree"} | {a["id"] for a in target.get("arrivals") or []}


def condition_issue(c: dict) -> str | None:
    if c.get("type") not in CONDITION_TYPES:
        return f"condition inconnue « {c.get('type')} »"
    if c["type"] == "mission_completed" and c.get("mission") not in GAME_MISSIONS:
        return f"mission inconnue « {c.get('mission')} »"
    if c["type"] == "min_balance" and not isinstance(c.get("amount"), int):
        return "montant manquant"
    return None


def issues(conn, map_id: str, content: dict) -> list[str]:
    """Problèmes qui empêchent la publication (le brouillon peut en avoir)."""
    out = []
    w, h = content["width"], content["height"]
    seen = set()
    solids = []
    for inst in content["landscapes"]:
        if inst["id"] in seen:
            out.append(f"Identifiant de paysage en double : {inst['id']}.")
        seen.add(inst["id"])
        try:
            m, _ = _model(conn, inst["media_id"], inst.get("revision"))
            if m["archived"]:
                out.append(f"Paysage {inst['id']} : le fichier « {m['name']} » est archivé.")
        except ServiceError as exc:
            out.append(f"Paysage {inst['id']} : {exc.message}")
            continue
        fp = inst.get("footprint")
        if not fp or not _inside(fp, w, h):
            out.append(f"Paysage {inst['id']} : son emprise {fp} dépasse de la carte ({w}×{h}, enceinte comprise).")
        elif inst.get("solid", True):
            solids.append(fp)
    sx, sy = content["spawn"]
    if not (1 <= sx < w - 1 and 1 <= sy < h - 1):
        out.append("Point d'arrivée hors de la carte.")
    elif any(_covers(a, sx, sy) for a in solids):
        out.append("Point d'arrivée dans l'emprise d'un paysage solide : le joueur y serait bloqué.")
    arrival_ids = set()
    for a in content.get("arrivals") or []:
        if a["id"] in arrival_ids or a["id"] in ("default", "entree"):
            out.append(f"Point d'arrivée « {a['id']} » : identifiant en double ou réservé.")
        arrival_ids.add(a["id"])
        if not (1 <= a["x"] < w - 1 and 1 <= a["y"] < h - 1):
            out.append(f"Point d'arrivée « {a['id']} » hors de la carte.")
        elif any(_covers(f, a["x"], a["y"]) for f in solids):
            out.append(f"Point d'arrivée « {a['id']} » dans l'emprise d'un paysage solide.")
    ids = set()
    targets = _known_targets(conn, map_id)
    active = 0
    for it in content["interactives"]:
        if it["id"] in ids:
            out.append(f"Identifiant d'objet interactif en double : {it['id']}.")
        ids.add(it["id"])
        a = it.get("area")
        if not a or not _inside(a, w, h):
            out.append(f"« {it['name']} » : zone hors de la carte.")
        if it["type"] == "door":
            t = it.get("target")
            if not t:
                out.append(f"« {it['name']} » : une porte doit indiquer sa destination.")
            elif t["zone"] not in targets:
                out.append(f"« {it['name']} » : destination inconnue ou non publiée « {t['zone']} ».")
            elif t.get("spawn", "default") not in allowed_spawns(conn, map_id, content, t["zone"]):
                out.append(f"« {it['name']} » : point d'arrivée « {t.get('spawn')} » absent de « {t['zone']} ».")
            for c in it.get("conditions") or []:
                problem = condition_issue(c)
                if problem:
                    out.append(f"« {it['name']} » : {problem}.")
        active += 1 if it.get("active", True) else 0
    has_exit = any(it["type"] == "door" and it.get("active", True) for it in content["interactives"])
    if not has_exit:
        out.append("Aucune porte de sortie active : le joueur ne pourrait pas quitter la carte.")
    e = content.get("entrance")
    if not e:
        out.append("Aucun accès depuis la Cité Akwaba : la carte serait inaccessible.")
    else:
        # deux cartes publiées ne partagent pas la même case d'accès (le jeu n'afficherait que la première)
        for other in conn.execute("SELECT * FROM game_maps WHERE status='published' AND id<>?", (map_id,)).fetchall():
            oe = ((_published_content(conn, other) or {}).get("draft") or {}).get("entrance")
            if oe and (oe.get("zone"), oe.get("x"), oe.get("y")) == (e.get("zone"), e.get("x"), e.get("y")):
                out.append(f"La case d'accès ({e['x']}, {e['y']}) est déjà celle de la carte publiée « {other['name']} ».")
    return out


def connections(conn) -> dict:
    """Graphe des passages entre cartes publiées (et cartes intégrées) : accès depuis la ville et portes."""
    nodes = [{"id": z, "name": z, "builtin": True} for z in RESERVED_MAPS]
    edges = []
    for r, d in _published_maps(conn):
        nodes.append({"id": r["id"], "name": r["name"], "builtin": False, "district": r["district_id"]})
        e = d.get("entrance")
        if e:
            edges.append({"from": e.get("zone", "quartier"), "to": r["id"], "spawn": "default", "kind": "entrance",
                          "label": e.get("label"), "tile": [e["x"], e["y"]], "conditions": [], "mode": "walk"})
        for it in d.get("interactives") or []:
            if it["type"] == "door" and it.get("active", True) and it.get("target"):
                edges.append({"from": r["id"], "to": it["target"]["zone"], "spawn": it["target"].get("spawn", "default"),
                              "kind": "door", "label": it.get("label") or it["name"], "object": it["id"],
                              "conditions": it.get("conditions") or [], "mode": it.get("mode", "walk")})
    return {"nodes": nodes, "edges": edges, "missions": list(GAME_MISSIONS), "condition_types": list(CONDITION_TYPES)}


def changes(before: dict | None, after: dict) -> list[str]:
    """Ce que la publication du brouillon changerait dans le jeu (aperçu lisible ; vide = rien ne change)."""
    if before is None:
        return ["Première publication : la carte apparaîtra dans le jeu."]
    out = []
    for key, label in (("width", "largeur"), ("height", "profondeur"), ("ground", "sol"), ("spawn", "point d'arrivée")):
        if before.get(key) != after.get(key):
            out.append(f"{label.capitalize()} : {before.get(key)} → {after.get(key)}.")
    if before.get("entrance") != after.get("entrance"):
        out.append("Accès depuis la Cité Akwaba modifié.")

    def diff(kind, a_list, b_list, keys):
        a = {x["id"]: x for x in a_list or []}
        b = {x["id"]: x for x in b_list or []}
        for i in b.keys() - a.keys():
            out.append(f"{kind} ajouté : {i}.")
        for i in a.keys() - b.keys():
            out.append(f"{kind} retiré : {i}.")
        for i in sorted(a.keys() & b.keys()):
            moved = [k for k in keys if a[i].get(k) != b[i].get(k)]
            if moved:
                out.append(f"{kind} {i} modifié ({', '.join(moved)}).")

    diff("Paysage", before.get("landscapes"), after.get("landscapes"), ("media_id", "revision", "x", "z", "rotation", "scale", "solid"))
    diff("Objet interactif", before.get("interactives"), after.get("interactives"),
         ("name", "type", "active", "area", "node", "label", "text", "target", "conditions", "mode"))
    diff("Point d'arrivée", before.get("arrivals"), after.get("arrivals"), ("x", "y"))
    return out


def map_version(conn, map_id: str, version: int) -> dict:
    _map_row(conn, map_id)
    v = _row(conn, "SELECT * FROM map_versions WHERE map_id=? AND version=?", (map_id, version))
    if not v:
        raise ServiceError(404, "Version introuvable.")
    return {"map_id": map_id, "version": version, "note": v["note"], "published_by": v["published_by"],
            "published_at": v["published_at"], **json.loads(v["content"])}


def restore(conn, user: dict, map_id: str, version: int) -> dict:
    """Reprend une version publiée dans le brouillon (rien n'est publié : la carte active ne change pas)."""
    content = map_version(conn, map_id, version)["draft"]
    with tx(conn):
        conn.execute("UPDATE game_maps SET draft=?, updated_at=? WHERE id=?", (json.dumps(content), _now(), map_id))
        audit(conn, user["username"], "world.map.restore", map_id, {"version": version})
    return map_detail(conn, map_id)


def map_usage(conn, media_id: str) -> list[dict]:
    """Cartes qui utilisent un fichier (brouillon ou versions publiées), avec la révision figée."""
    out = []
    for m in conn.execute("SELECT * FROM game_maps ORDER BY id").fetchall():
        uses = [("brouillon", i.get("revision")) for i in json.loads(m["draft"]).get("landscapes", []) if i.get("media_id") == media_id]
        for v in conn.execute("SELECT version, content FROM map_versions WHERE map_id=?", (m["id"],)).fetchall():
            for i in json.loads(v["content"])["draft"].get("landscapes", []):
                if i.get("media_id") == media_id:
                    uses.append((f"version {v['version']}" + (" (publiée)" if v["version"] == m["published_version"] else ""), i.get("revision")))
        if uses:
            out.append({"map_id": m["id"], "name": m["name"], "status": m["status"],
                        "uses": [{"where": w, "revision": r} for w, r in uses]})
    return out


def weight(conn, content: dict) -> dict:
    """Poids d'une carte pour le jeu : fichiers distincts à télécharger (une instance réutilisée ne compte qu'une
    fois), triangles affichés (chaque instance compte), et avertissements au-delà du budget mobile."""
    files, triangles = {}, 0
    for inst in content.get("landscapes") or []:
        r = _row(conn, "SELECT size, meta FROM media_revisions WHERE media_id=? AND revision=?",
                 (inst["media_id"], inst.get("revision") or 0))
        if not r:
            continue
        files[(inst["media_id"], inst.get("revision"))] = r["size"]
        triangles += int(json.loads(r["meta"]).get("triangles", 0))
    total = sum(files.values())
    warnings = []
    if total > MOBILE_BUDGET["bytes"]:
        warnings.append(f"Téléchargement lourd : {total / 1048576:.1f} Mo (budget mobile {MOBILE_BUDGET['bytes'] // 1048576} Mo).")
    if triangles > MOBILE_BUDGET["triangles"]:
        warnings.append(f"Géométrie lourde : {triangles:,} triangles (budget mobile {MOBILE_BUDGET['triangles']:,}).".replace(",", " "))
    if len(files) > MOBILE_BUDGET["models"]:
        warnings.append(f"{len(files)} fichiers 3D différents (budget mobile {MOBILE_BUDGET['models']}) : réutiliser les mêmes modèles.")
    return {"bytes": total, "files": len(files), "instances": len(content.get("landscapes") or []), "triangles": triangles,
            "budget": MOBILE_BUDGET, "warnings": warnings}


def map_detail(conn, map_id: str) -> dict:
    m = _map_row(conn, map_id)
    draft = json.loads(m["draft"])
    versions = [{"version": v["version"], "note": v["note"], "published_by": v["published_by"], "published_at": v["published_at"]}
                for v in conn.execute("SELECT version, note, published_by, published_at FROM map_versions WHERE map_id=? ORDER BY version DESC", (map_id,))]
    d = _row(conn, "SELECT * FROM districts WHERE id=?", (m["district_id"],))
    targets = {z: sorted(allowed_spawns(conn, map_id, draft, z)) for z in sorted(_known_targets(conn, map_id))}
    latest = {}
    for inst in draft.get("landscapes", []):
        row = _row(conn, "SELECT revision FROM media WHERE id=?", (inst["media_id"],))
        if row and inst.get("revision") and row["revision"] > inst["revision"]:
            latest[inst["id"]] = row["revision"]  # révision plus récente du fichier, à adopter explicitement
    published = _published_content(conn, m)
    return {**_map_summary(conn, m), "city_id": d["city_id"], "draft": draft, "issues": issues(conn, map_id, draft),
            "versions": versions, "published": published,
            "changes": changes(published["draft"] if published else None, draft) if (published is None or published["draft"] != draft) else [],
            "newer_revisions": latest, "targets": targets, "missions": list(GAME_MISSIONS), "weight": weight(conn, draft)}


def publish(conn, user: dict, map_id: str, note: str = "") -> dict:
    """Valide le brouillon puis en fait la version publiée suivante (immuable)."""
    m = _map_row(conn, map_id)
    draft = _resolve(conn, json.loads(m["draft"]))  # révisions et fichiers revérifiés au moment de publier
    problems = issues(conn, map_id, draft)
    if problems:
        raise ServiceError(422, "Publication impossible : " + " ".join(problems))
    models = {}
    for inst in draft["landscapes"]:
        _, r = _model(conn, inst["media_id"], inst["revision"])
        meta = json.loads(r["meta"])
        models[inst["id"]] = {"media_id": inst["media_id"], "revision": inst["revision"], "mime": r["mime"], "bytes": r["size"],
                              "sha256": r["sha256"], "bbox": meta["bbox"], "triangles": meta.get("triangles", 0)}
    version = (_row(conn, "SELECT MAX(version) AS v FROM map_versions WHERE map_id=?", (map_id,))["v"] or 0) + 1
    content = {"draft": draft, "models": models}
    now = _now()
    with tx(conn):
        conn.execute("INSERT INTO map_versions (map_id, version, content, note, published_by, published_at) VALUES (?,?,?,?,?,?)",
                     (map_id, version, json.dumps(content), note, user["username"], now))
        conn.execute("UPDATE game_maps SET status='published', published_version=?, updated_at=? WHERE id=?", (version, now, map_id))
        audit(conn, user["username"], "world.map.publish", map_id, {"version": version})
    return map_detail(conn, map_id)


def set_status(conn, user: dict, map_id: str, status: str) -> dict:
    """Désactive (le jeu cesse de la proposer, les données des joueurs restent) ou réactive une carte publiée."""
    m = _map_row(conn, map_id)
    if status == "published" and not m["published_version"]:
        raise ServiceError(422, "Cette carte n'a jamais été publiée.")
    with tx(conn):
        conn.execute("UPDATE game_maps SET status=?, updated_at=? WHERE id=?", (status, _now(), map_id))
        audit(conn, user["username"], f"world.map.{'enable' if status == 'published' else 'disable'}", map_id, None)
    return map_detail(conn, map_id)


# ---------------------------------------------------------------- diffusion vers le jeu

def pack_maps(conn) -> list[dict]:
    """Cartes publiées et actives, telles que le jeu les charge (version publiée seulement, jamais le brouillon)."""
    out = []
    for m in conn.execute("SELECT * FROM game_maps WHERE status='published' AND published_version IS NOT NULL ORDER BY id").fetchall():
        content = _published_content(conn, m)
        if not content:
            continue
        d = _row(conn, "SELECT * FROM districts WHERE id=?", (m["district_id"],))
        c = _row(conn, "SELECT * FROM cities WHERE id=?", (d["city_id"],))
        out.append({"id": m["id"], "name": m["name"], "version": m["published_version"],
                    "district": {"id": d["id"], "name": d["name"]}, "city": {"id": c["id"], "name": c["name"]},
                    **content["draft"], "models": content["models"]})
    return out


def published_model(conn, media_id: str, revision: int) -> tuple[bytes, str]:
    """Fichier d'un modèle utilisé par une carte publiée (le jeu ne peut rien lire d'autre par cette voie)."""
    for m in conn.execute("SELECT * FROM game_maps WHERE status='published' AND published_version IS NOT NULL").fetchall():
        content = _published_content(conn, m) or {}
        if any(x["media_id"] == media_id and x["revision"] == revision for x in (content.get("models") or {}).values()):
            from .service import media_file
            return media_file(conn, media_id, revision)
    raise ServiceError(404, "Modèle non utilisé par une carte publiée.")
