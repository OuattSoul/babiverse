"""API du Babiverse Asset Studio — Cité Akwaba (FastAPI).

Toutes les routes /api (sauf connexion, santé et fichiers signés) exigent un jeton ; chaque route déclare
ses permissions (`need`), vérifiées côté serveur. Un bouton masqué dans l'interface n'est jamais une protection.
"""
from __future__ import annotations

import hmac
import json
import logging
import os
import sqlite3
import threading
import time

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from . import auth, bundle, config, gamepack, gameworld, media as md, runtime, service
from .behaviors import BEHAVIORS
from .db import connect, get_setting, recover, schema_version
from .models import (CategoryIn, CategoryPatch, ChannelAssignIn, CreateAssetIn, DuplicateIn, ExportIn, GameSettingsIn, ImportApplyIn, LoginIn,
                     LogoutIn, MediaPatch, MigrateIn, MovePatch, PasswordIn, PlaceIn, PlacementIn, PublishInhabitantsIn, RemovalIn, RevertIn, SceneIn, ScenePatch, UpdateDraftIn,
                     UserIn, UserPatch)
from .seed import seed
from .service import ServiceError
from .taxonomy import catalog_payload

log = logging.getLogger("babiverse.studio")
_lock = threading.RLock()  # SQLite + un seul processus : on sérialise les écritures
# Une seule requête à la fois sur la connexion partagée : des lectures simultanées sur le même objet sqlite3
# (bibliothèques de composants chargées en parallèle) produisaient des 404/500 aléatoires.
# Verrou simple (et non réentrant) : il peut être libéré par un autre fil que celui qui l'a pris.
_gate = threading.Lock()

SPA_CSP = ("default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
           "font-src 'self' https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; object-src 'none'; "
           "frame-ancestors 'none'; base-uri 'self'; form-action 'self'")
FILE_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox"


def create_app(db_path: str | None = None, with_content: bool = True) -> FastAPI:
    settings = config.load(db_path)
    auth.configure(settings.session_hours, settings.session_idle_min, settings.pbkdf2_iterations)
    os.makedirs(settings.media_dir, exist_ok=True)
    conn = connect(settings.db_path)
    service.CONTEXT.clear()
    service.CONTEXT.update({"settings": settings})
    with _lock:
        seed(conn, settings, with_content=with_content)
    secret = settings.secret or get_setting(conn, "secret")
    conn.commit()
    service.CONTEXT["secret"] = secret

    app = FastAPI(title="Babiverse Asset Studio — Cité Akwaba", version=bundle.STUDIO_VERSION,
                  docs_url=None if settings.production else "/api/docs", redoc_url=None, openapi_url=None if settings.production else "/api/openapi.json")
    app.state.conn = conn
    app.state.settings = settings

    @app.middleware("http")
    async def security_headers(request: Request, call_next):
        # chaque requête retrouve le contexte de CETTE application (plusieurs apps coexistent dans les tests)
        service.CONTEXT.update({"settings": settings, "secret": secret})
        resp = await call_next(request)
        resp.headers.setdefault("X-Content-Type-Options", "nosniff")
        resp.headers.setdefault("X-Frame-Options", "DENY")
        resp.headers.setdefault("Referrer-Policy", "same-origin")
        if not request.url.path.startswith("/api/"):
            resp.headers.setdefault("Content-Security-Policy", SPA_CSP)
        elif "/file" not in request.url.path:
            resp.headers.setdefault("Cache-Control", "no-store")
        return resp

    @app.exception_handler(ServiceError)
    async def _svc(_: Request, exc: ServiceError):
        return JSONResponse(status_code=exc.status, content={"detail": exc.message, "report": exc.report})

    @app.exception_handler(RequestValidationError)
    async def _val(_: Request, exc: RequestValidationError):
        items = [{"level": "error", "code": "schema", "message": e["msg"], "path": ".".join(str(p) for p in e["loc"][1:])}
                 for e in exc.errors()]
        msg = " · ".join(f"{i['path']} : {i['message']}" for i in items[:4])
        return JSONResponse(status_code=422, content={"detail": f"Données invalides — {msg}",
                                                      "report": {"ok": False, "errors": len(items), "warnings": 0, "items": items}})

    @app.exception_handler(Exception)
    async def _crash(request: Request, exc: Exception):
        log.exception("Erreur interne sur %s", request.url.path)
        return JSONResponse(status_code=500, content={"detail": "Erreur interne du serveur. L'opération n'a pas été enregistrée."})

    def db():
        # chaque requête se termine par un commit (ou un rollback si elle échoue) : sous PostgreSQL,
        # une lecture ouvre aussi une transaction qu'il ne faut pas laisser en suspens
        with _gate:
            c = app.state.conn
            recover(c)
            try:
                yield c
            except BaseException:
                c.rollback()
                raise
            c.commit()

    def bearer(authorization: str = Header(default="")) -> str:
        if not authorization.lower().startswith("bearer "):
            raise HTTPException(401, "Authentification requise.")
        return authorization[7:].strip()

    def current_user(token: str = Depends(bearer), conn: sqlite3.Connection = Depends(db)) -> dict:
        with _lock:
            user = auth.user_from_token(conn, token)
        if not user:
            raise HTTPException(401, "Session invalide ou expirée.")
        return user

    def need(*perms: str):
        def dep(user: dict = Depends(current_user)) -> dict:
            missing = [p for p in perms if p not in user["permissions"]]
            if missing:
                raise HTTPException(403, f"Permission refusée ({', '.join(missing)}).")
            return user
        return dep

    async def raw_body(request: Request, limit: int) -> bytes:
        cl = request.headers.get("content-length")
        if cl and cl.isdigit() and int(cl) > limit:
            raise HTTPException(413, f"Fichier trop volumineux (maximum {limit // 1048576} Mo).")
        data = await request.body()
        if len(data) > limit:
            raise HTTPException(413, f"Fichier trop volumineux (maximum {limit // 1048576} Mo).")
        return data

    # ------------------------------------------------------------ santé et système
    @app.get("/api/health")
    def health():
        return {"ok": True, "version": bundle.STUDIO_VERSION}

    @app.get("/api/system")
    def system(conn=Depends(db), _=Depends(need("admin.settings"))):
        def du(path):
            total = 0
            for root, _d, files in os.walk(path):
                total += sum(os.path.getsize(os.path.join(root, f)) for f in files)
            return total
        return {"env": settings.env, "production": settings.production, "schema_version": schema_version(conn),
                "db_path": settings.db_label, "db_engine": "postgresql" if settings.postgres else "sqlite",
                "media_storage": settings.media_storage,
                "media_bytes": int(conn.execute("SELECT COALESCE(SUM(LENGTH(data)), 0) FROM media_blobs").fetchone()[0])
                if settings.media_storage == "database" else du(settings.media_dir), "limits": {"upload_mb": settings.max_upload_bytes // 1048576,
                "import_mb": settings.max_import_bytes // 1048576, "image_px": settings.max_image_px},
                "sessions": {"hours": settings.session_hours, "idle_min": settings.session_idle_min},
                "dev_accounts": settings.dev_accounts, "version": bundle.STUDIO_VERSION,
                "counts": {t: conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
                           for t in ("assets", "asset_versions", "instances", "media", "scenes", "users", "audit")}}

    # ------------------------------------------------------------ auth
    @app.post("/api/auth/login")
    def login(body: LoginIn, conn=Depends(db)):
        with _lock:
            try:
                res = auth.login(conn, body.username, body.password)
            except PermissionError as exc:
                raise HTTPException(429, str(exc)) from exc
            if res:
                from .db import audit as _audit, tx
                with tx(conn):
                    _audit(conn, res[1]["username"], "auth.login", res[1]["username"])
        if not res:
            raise HTTPException(401, "Identifiants invalides.")
        return {"token": res[0], "user": res[1], "dev": settings.dev_accounts}

    @app.post("/api/auth/logout", status_code=204)
    def logout(body: LogoutIn | None = None, token: str = Depends(bearer), conn=Depends(db)):
        with _lock:
            auth.logout(conn, token, everywhere=bool(body and body.everywhere))

    @app.get("/api/auth/me")
    def me(user=Depends(current_user)):
        return {**user, "dev": settings.dev_accounts}

    @app.post("/api/auth/password", status_code=204)
    def password(body: PasswordIn, token: str = Depends(bearer), conn=Depends(db), user=Depends(current_user)):
        with _lock:
            service.change_own_password(conn, user, token, body.current_password, body.new_password)

    # ------------------------------------------------------------ référentiels
    @app.get("/api/taxonomy")
    def taxonomy(_=Depends(current_user)):
        return {**catalog_payload(), "behaviors": BEHAVIORS, "permissions": auth.PERMISSIONS,
                "roles": {r: {"label": auth.ROLE_LABELS[r], "permissions": sorted(p)} for r, p in auth.ROLE_PERMISSIONS.items()},
                "media_categories": md.MEDIA_CATEGORIES,
                "limits": {"upload_mb": settings.max_upload_bytes // 1048576, "import_mb": settings.max_import_bytes // 1048576,
                           "image_px": settings.max_image_px}}

    @app.get("/api/dashboard")
    def dashboard(conn=Depends(db), _=Depends(need("asset.read"))):
        return service.dashboard(conn)

    @app.get("/api/behaviors/usage")
    def behaviors_usage(conn=Depends(db), _=Depends(need("asset.read"))):
        out: dict[str, list] = {k: [] for k in BEHAVIORS}
        for a in service.list_assets(conn):
            for b in a["preview"].get("behaviors") or []:
                out.setdefault(b["id"], []).append({"id": a["id"], "name": a["name"], "family": a["family"], "status": a["status"]})
        return out

    # ------------------------------------------------------------ catégories
    @app.get("/api/categories")
    def categories(_=Depends(current_user)):
        return catalog_payload()["categories"]

    @app.post("/api/categories", status_code=201)
    def create_category(body: CategoryIn, conn=Depends(db), user=Depends(need("admin.settings"))):
        with _lock:
            return service.create_category(conn, user, body.model_dump())

    @app.patch("/api/categories/{key}")
    def update_category(key: str, body: CategoryPatch, conn=Depends(db), user=Depends(need("admin.settings"))):
        with _lock:
            return service.update_category(conn, user, key, body.model_dump())

    # ------------------------------------------------------------ catalogue d'administration
    @app.get("/api/assets")
    def list_assets(q: str = "", category: str = "", family: str = "", status: str = "", sort: str = "updated",
                    since: float | None = None, until: float | None = None, tag: str = "",
                    conn=Depends(db), _=Depends(need("asset.read"))):
        return service.list_assets(conn, q, category, family, status, sort, since, until, tag)

    @app.post("/api/assets", status_code=201)
    def create(body: CreateAssetIn, conn=Depends(db), user=Depends(need("asset.create"))):
        with _lock:
            return service.create_asset(conn, user, body.category, body.technical_name, body.definition.model_dump())

    @app.post("/api/validate")
    def validate_free(body: dict, conn=Depends(db), _=Depends(need("asset.read"))):
        """Vérifie une définition sans l'enregistrer (assistant de création)."""
        category = body.get("category")
        definition = body.get("definition")
        if not isinstance(category, str) or not isinstance(definition, dict):
            raise HTTPException(422, "Attendu : {category, definition}.")
        from .validation import normalize
        return service._validate(conn, normalize(definition, category), category).as_dict()

    @app.get("/api/assets/{asset_id}")
    def detail(asset_id: str, conn=Depends(db), _=Depends(need("asset.read"))):
        return service.asset_detail(conn, asset_id)

    @app.get("/api/assets/{asset_id}/versions/{version}")
    def version(asset_id: str, version: int, conn=Depends(db), _=Depends(need("asset.read"))):
        row = service.get_version_row(conn, asset_id, version)
        return {"version": version, "status": row["status"], "definition": json.loads(row["definition"]),
                "validation": json.loads(row["validation"]) if row["validation"] else None,
                "pins": json.loads(row["pins"]) if row["pins"] else None, "note": row["note"]}

    @app.get("/api/assets/{asset_id}/diff")
    def diff(asset_id: str, a: int, b: int, conn=Depends(db), _=Depends(need("asset.read"))):
        return service.diff(conn, asset_id, a, b)

    @app.get("/api/assets/{asset_id}/usage")
    def usage(asset_id: str, conn=Depends(db), _=Depends(need("asset.read"))):
        service.get_asset_row(conn, asset_id)
        return service.usage(conn, asset_id)

    @app.get("/api/assets/{asset_id}/render")
    def render(asset_id: str, version: int | None = None, conn=Depends(db), _=Depends(need("asset.read"))):
        return service.asset_render(conn, asset_id, version)

    @app.put("/api/assets/{asset_id}/draft")
    def update(asset_id: str, body: UpdateDraftIn, conn=Depends(db), user=Depends(need("asset.edit"))):
        with _lock:
            return service.update_draft(conn, user, asset_id, body.definition.model_dump(), body.note)

    @app.post("/api/assets/{asset_id}/new-draft")
    def new_draft(asset_id: str, conn=Depends(db), user=Depends(need("asset.edit"))):
        with _lock:
            return service.new_draft(conn, user, asset_id)

    @app.post("/api/assets/{asset_id}/revert")
    def revert(asset_id: str, body: RevertIn, conn=Depends(db), user=Depends(need("asset.edit", "asset.publish"))):
        with _lock:
            return service.revert(conn, user, asset_id, body.from_version)

    @app.post("/api/assets/{asset_id}/duplicate", status_code=201)
    def duplicate(asset_id: str, body: DuplicateIn, conn=Depends(db), user=Depends(need("asset.create"))):
        with _lock:
            return service.duplicate(conn, user, asset_id, body.technical_name, body.name)

    @app.post("/api/assets/{asset_id}/validate")
    def validate(asset_id: str, publish_check: bool = False, conn=Depends(db), user=Depends(need("asset.read"))):
        with _lock:
            return service.validate_latest(conn, user, asset_id, for_publish=publish_check)

    @app.post("/api/assets/{asset_id}/submit")
    def submit(asset_id: str, conn=Depends(db), user=Depends(need("asset.edit"))):
        with _lock:
            return service.submit(conn, user, asset_id)

    @app.post("/api/assets/{asset_id}/reject")
    def reject(asset_id: str, conn=Depends(db), user=Depends(need("asset.validate"))):
        with _lock:
            return service.reject(conn, user, asset_id)

    @app.post("/api/assets/{asset_id}/approve")
    def approve(asset_id: str, conn=Depends(db), user=Depends(need("asset.validate"))):
        with _lock:
            return service.approve(conn, user, asset_id)

    @app.post("/api/assets/{asset_id}/publish")
    def publish(asset_id: str, conn=Depends(db), user=Depends(need("asset.publish"))):
        with _lock:
            return service.publish(conn, user, asset_id)

    @app.post("/api/assets/{asset_id}/archive")
    def archive(asset_id: str, conn=Depends(db), user=Depends(need("asset.archive"))):
        with _lock:
            return service.set_archived(conn, user, asset_id, True)

    @app.post("/api/assets/{asset_id}/restore")
    def restore(asset_id: str, conn=Depends(db), user=Depends(need("asset.archive"))):
        with _lock:
            return service.set_archived(conn, user, asset_id, False)

    @app.get("/api/assets/{asset_id}/migration")
    def migration(asset_id: str, to: int, conn=Depends(db), _=Depends(need("asset.publish"))):
        return service.migration_preview(conn, asset_id, to)

    @app.post("/api/assets/{asset_id}/migrate")
    def migrate(asset_id: str, body: MigrateIn, conn=Depends(db), user=Depends(need("asset.publish"))):
        with _lock:
            return service.migrate(conn, user, asset_id, body.to_version, body.instance_ids)

    @app.get("/api/assets/{asset_id}/road-compatibility")
    def road_compat(asset_id: str, conn=Depends(db), _=Depends(need("asset.read"))):
        return service.road_compat(conn, asset_id)

    # ------------------------------------------------------------ personnages
    @app.get("/api/characters/parts")
    def parts(drafts: bool = True, conn=Depends(db), _=Depends(need("asset.read"))):
        return service.part_library(conn, include_drafts=drafts)

    # ------------------------------------------------------------ kits modulaires
    @app.get("/api/kits/parts")
    def kit_parts(kit: str = "", drafts: bool = True, conn=Depends(db), _=Depends(need("asset.read"))):
        return service.kit_library(conn, kit, include_drafts=drafts)

    # ------------------------------------------------------------ médiathèque
    @app.get("/api/media")
    def list_media(q: str = "", kind: str = "", category: str = "", archived: bool = False, conn=Depends(db), _=Depends(need("asset.read"))):
        return service.list_media(conn, q, kind, category, archived)

    @app.post("/api/media", status_code=201)
    async def upload_media(request: Request, filename: str = Query(..., max_length=200), name: str = Query("", max_length=80),
                           category: str = Query("other"), tags: str = Query("", max_length=400),
                           conn=Depends(db), user=Depends(need("media.upload"))):
        data = await raw_body(request, settings.max_upload_bytes)
        tag_list = [t.strip()[:30] for t in tags.split(",") if t.strip()][:20]
        with _lock:
            return service.upload_media(conn, user, data, filename, name or None, category, tag_list)

    @app.get("/api/media/{media_id}")
    def media_detail(media_id: str, conn=Depends(db), _=Depends(need("asset.read"))):
        return {**service.media_summary(conn, service.get_media_row(conn, media_id)),
                "usage": service.media_usage(conn, media_id), "revisions": service.media_revisions(conn, media_id)}

    @app.get("/api/media/{media_id}/svg")
    def media_svg(media_id: str, conn=Depends(db), _=Depends(need("asset.read"))):
        text = service.svg_text(conn, media_id)
        if text is None:
            raise HTTPException(404, "Pas un SVG.")
        return {"svg": text}

    @app.patch("/api/media/{media_id}")
    def media_patch(media_id: str, body: MediaPatch, conn=Depends(db), user=Depends(need("media.upload"))):
        with _lock:
            return service.update_media(conn, user, media_id, body.model_dump())

    @app.post("/api/media/{media_id}/replace")
    async def media_replace(media_id: str, request: Request, filename: str = Query(..., max_length=200),
                            conn=Depends(db), user=Depends(need("media.upload"))):
        data = await raw_body(request, settings.max_upload_bytes)
        with _lock:
            return service.replace_media(conn, user, media_id, data, filename)

    @app.post("/api/media/{media_id}/channels")
    def media_channels(media_id: str, body: ChannelAssignIn, conn=Depends(db), user=Depends(need("media.upload"))):
        with _lock:
            return service.assign_channels(conn, user, media_id, body.mapping)

    @app.post("/api/media/{media_id}/archive")
    def media_archive(media_id: str, conn=Depends(db), user=Depends(need("media.upload"))):
        with _lock:
            return service.set_media_archived(conn, user, media_id, True)

    @app.post("/api/media/{media_id}/restore")
    def media_restore(media_id: str, conn=Depends(db), user=Depends(need("media.upload"))):
        with _lock:
            return service.set_media_archived(conn, user, media_id, False)

    @app.get("/api/media/{media_id}/file")
    def media_file(media_id: str, rev: int, exp: int, sig: str = Query(..., max_length=64), conn=Depends(db)):
        if not md.check_signature(service.CONTEXT["secret"], media_id, rev, exp, sig):
            raise HTTPException(403, "Lien de fichier invalide ou expiré.")
        data, mime = service.media_file(conn, media_id, rev)
        return Response(content=data, media_type=mime, headers={
            "Content-Security-Policy": FILE_CSP, "Cache-Control": "private, max-age=3600", "Content-Disposition": "inline"})

    # ------------------------------------------------------------ jeu : catalogue publié, intégration
    @app.get("/api/catalog")
    def catalog(family: str = "", conn=Depends(db), _=Depends(current_user)):
        return service.catalog(conn, family)

    @app.get("/api/catalog/definitions")
    def definitions(keys: str = Query(""), conn=Depends(db), _=Depends(current_user)):
        return service.definitions(conn, [k for k in keys.split(",") if k])

    @app.get("/api/runtime/catalog")
    def runtime_catalog(conn=Depends(db), _=Depends(current_user)):
        return runtime.runtime_catalog(conn)

    @app.get("/api/runtime/game-pack")
    def game_pack(conn=Depends(db), authorization: str = Header(default=""), x_babiverse_game_key: str = Header(default="")):
        # Le serveur du jeu s'authentifie par la clé partagée ; un humain par sa session (permission d'export).
        key = settings.game_key
        if not (key and x_babiverse_game_key and hmac.compare_digest(x_babiverse_game_key, key)):
            if not authorization.lower().startswith("bearer "):
                raise HTTPException(401, "Clé du jeu ou session requise.")
            with _lock:
                user = auth.user_from_token(conn, authorization[7:].strip())
            if not user:
                raise HTTPException(401, "Session invalide ou expirée.")
            if "asset.export" not in user["permissions"]:
                raise HTTPException(403, "Permission refusée (asset.export).")
        return gamepack.game_pack(conn)

    @app.get("/api/game/settings")
    def game_settings(conn=Depends(db), _=Depends(need("asset.read"))):
        return gamepack.settings_view(conn)

    @app.put("/api/game/settings")
    def put_game_settings(body: GameSettingsIn, conn=Depends(db), user=Depends(need("asset.publish"))):
        with _lock:
            return gamepack.update_settings(conn, user, body.model_dump(exclude_none=True))

    @app.get("/api/game/placements")
    def game_placements(conn=Depends(db), _=Depends(need("asset.read"))):
        return gameworld.list_view(conn)

    @app.post("/api/game/placements", status_code=201)
    def add_game_placement(body: PlacementIn, conn=Depends(db), user=Depends(need("asset.publish"))):
        with _lock:
            return gameworld.add(conn, user, body.model_dump(exclude_none=True))

    @app.delete("/api/game/placements/{placement_id}")
    def remove_game_placement(placement_id: str, conn=Depends(db), user=Depends(need("asset.publish"))):
        with _lock:
            return gameworld.remove(conn, user, placement_id)

    @app.post("/api/game/removals", status_code=201)
    def remove_original(body: RemovalIn, conn=Depends(db), user=Depends(need("asset.publish"))):
        with _lock:
            return gameworld.remove_original(conn, user, body.key, body.label)

    @app.delete("/api/game/removals/{key}")
    def restore_original(key: str, conn=Depends(db), user=Depends(need("asset.publish"))):
        with _lock:
            return gameworld.restore_original(conn, user, key)

    @app.post("/api/game/publish-inhabitants")
    def publish_inhabitants(body: PublishInhabitantsIn | None = None, conn=Depends(db), user=Depends(need("asset.validate", "asset.publish"))):
        with _lock:
            return gamepack.publish_inhabitants(conn, user, body.ids if body else None)

    @app.get("/api/runtime/game-adapter")
    def game_adapter(conn=Depends(db), _=Depends(need("asset.export"))):
        return runtime.game_adapter(conn)

    # ------------------------------------------------------------ scènes de test
    @app.get("/api/scenes")
    def scenes(conn=Depends(db), _=Depends(current_user)):
        return service.list_scenes(conn)

    @app.post("/api/scenes", status_code=201)
    def create_scene(body: SceneIn, conn=Depends(db), user=Depends(need("scene.manage"))):
        with _lock:
            return service.create_scene(conn, user, body.name, body.description, body.width, body.height, body.template)

    @app.get("/api/scenes/{scene_id}")
    def scene(scene_id: str, conn=Depends(db), _=Depends(current_user)):
        return service.world_state(conn, scene_id)

    @app.patch("/api/scenes/{scene_id}")
    def patch_scene(scene_id: str, body: ScenePatch, conn=Depends(db), user=Depends(need("scene.manage"))):
        with _lock:
            return service.update_scene(conn, user, scene_id, body.model_dump())

    @app.delete("/api/scenes/{scene_id}", status_code=204)
    def delete_scene(scene_id: str, conn=Depends(db), user=Depends(need("scene.manage"))):
        with _lock:
            service.delete_scene(conn, user, scene_id)

    @app.post("/api/scenes/{scene_id}/clear", status_code=204)
    def clear_scene(scene_id: str, conn=Depends(db), user=Depends(need("scene.manage"))):
        with _lock:
            service.delete_scene(conn, user, scene_id, clear_only=True)

    @app.post("/api/scenes/{scene_id}/duplicate", status_code=201)
    def duplicate_scene(scene_id: str, body: ScenePatch, conn=Depends(db), user=Depends(need("scene.manage"))):
        with _lock:
            return service.duplicate_scene(conn, user, scene_id, body.name or "Copie de scène")

    @app.post("/api/scenes/{scene_id}/check")
    def scene_check(scene_id: str, body: PlaceIn, conn=Depends(db), _=Depends(need("world.place"))):
        return service.check(conn, body.asset_id, body.x, body.y, body.rotation, scene_id=scene_id)

    @app.post("/api/scenes/{scene_id}/instances", status_code=201)
    def scene_place(scene_id: str, body: PlaceIn, conn=Depends(db), user=Depends(need("world.place"))):
        with _lock:
            return service.place(conn, user, body.asset_id, body.x, body.y, body.rotation, body.variant_id, scene_id, body.label)

    @app.patch("/api/scenes/{scene_id}/instances/{instance_id}")
    def scene_move(scene_id: str, instance_id: str, body: MovePatch, conn=Depends(db), user=Depends(need("world.place"))):
        with _lock:
            return service.move(conn, user, instance_id, body.model_dump(), scene_id)

    @app.delete("/api/scenes/{scene_id}/instances/{instance_id}", status_code=204)
    def scene_remove(scene_id: str, instance_id: str, conn=Depends(db), user=Depends(need("world.place"))):
        with _lock:
            service.remove(conn, user, instance_id, scene_id)

    # Compatibilité v0.1 : /api/world = scène « main »
    @app.get("/api/world")
    def world(conn=Depends(db), _=Depends(current_user)):
        return service.world_state(conn, "main")

    @app.post("/api/world/check")
    def check(body: PlaceIn, conn=Depends(db), _=Depends(need("world.place"))):
        return service.check(conn, body.asset_id, body.x, body.y, body.rotation)

    @app.post("/api/world/instances", status_code=201)
    def place(body: PlaceIn, conn=Depends(db), user=Depends(need("world.place"))):
        with _lock:
            return service.place(conn, user, body.asset_id, body.x, body.y, body.rotation, body.variant_id, "main", body.label)

    @app.patch("/api/world/instances/{instance_id}")
    def move(instance_id: str, body: MovePatch, conn=Depends(db), user=Depends(need("world.place"))):
        with _lock:
            return service.move(conn, user, instance_id, body.model_dump())

    @app.delete("/api/world/instances/{instance_id}", status_code=204)
    def remove(instance_id: str, conn=Depends(db), user=Depends(need("world.place"))):
        with _lock:
            service.remove(conn, user, instance_id)

    # ------------------------------------------------------------ import / export
    @app.post("/api/export")
    def export(body: ExportIn, conn=Depends(db), user=Depends(need("asset.export"))):
        with _lock:
            data, manifest = bundle.export_bundle(conn, user, body.asset_ids, body.all_assets, body.include_dependencies,
                                                  body.versions, body.scene_ids)
        name = time.strftime("babiverse-export-%Y%m%d-%H%M%S.zip")
        return Response(content=data, media_type="application/zip", headers={
            "Content-Disposition": f'attachment; filename="{name}"',
            "X-Babiverse-Assets": str(len(manifest["assets"])), "X-Babiverse-Media": str(len(manifest["media"]))})

    @app.get("/api/imports")
    def imports(conn=Depends(db), _=Depends(need("asset.import"))):
        return bundle.list_imports(conn)

    @app.post("/api/imports", status_code=201)
    async def import_preview(request: Request, filename: str = Query("lot.zip", max_length=200), conn=Depends(db),
                             user=Depends(need("asset.import"))):
        data = await raw_body(request, settings.max_import_bytes)
        with _lock:
            return bundle.preview(conn, user, data, filename)

    @app.post("/api/imports/{import_id}/apply")
    def import_apply(import_id: str, body: ImportApplyIn, conn=Depends(db), user=Depends(need("asset.import"))):
        with _lock:
            return bundle.apply(conn, user, import_id, body.decisions, body.import_scenes)

    @app.post("/api/imports/{import_id}/rollback")
    def import_rollback(import_id: str, conn=Depends(db), user=Depends(need("asset.import"))):
        with _lock:
            return bundle.rollback(conn, user, import_id)

    # ------------------------------------------------------------ administration
    @app.get("/api/audit")
    def audit_log(limit: int = 100, action: str = "", target: str = "", username: str = "",
                  conn=Depends(db), _=Depends(need("admin.audit"))):
        q, args = "SELECT * FROM audit WHERE 1=1", []
        if action:
            q += " AND action LIKE ?"; args.append(f"{action}%")
        if target:
            q += " AND target = ?"; args.append(target)
        if username:
            q += " AND username = ?"; args.append(username)
        rows = conn.execute(q + " ORDER BY id DESC LIMIT ?", (*args, min(max(limit, 1), 500))).fetchall()
        return [{**dict(r), "detail": json.loads(r["detail"] or "{}")} for r in rows]

    @app.get("/api/users")
    def users(conn=Depends(db), _=Depends(need("admin.users"))):
        return service.list_users(conn)

    @app.post("/api/users", status_code=201)
    def create_user(body: UserIn, conn=Depends(db), user=Depends(need("admin.users"))):
        with _lock:
            return service.create_user(conn, user, body.username, body.password, body.role)

    @app.patch("/api/users/{user_id}")
    def update_user(user_id: int, body: UserPatch, conn=Depends(db), user=Depends(need("admin.users"))):
        with _lock:
            return service.update_user(conn, user, user_id, body.model_dump())

    # ------------------------------------------------------------ front compilé
    dist = os.environ.get("BABIVERSE_FRONTEND", os.path.join(os.path.dirname(__file__), "..", "..", "frontend", "dist"))
    if os.path.isdir(dist):
        app.mount("/assets", StaticFiles(directory=os.path.join(dist, "assets")), name="static")

        @app.get("/{path:path}")
        def spa(path: str):
            if path.startswith("api/"):
                raise HTTPException(404)
            return FileResponse(os.path.join(dist, "index.html"))

    return app


if os.environ.get("BABIVERSE_NO_AUTOAPP") != "1":
    config.load_env_file()
    app = create_app()
