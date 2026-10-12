"""Configuration par variables d'environnement (aucun secret dans le code).

| Variable | Rôle | Défaut |
|---|---|---|
| BABIVERSE_ENV | `development`, `test` ou `production` | development |
| BABIVERSE_DATABASE_URL | base **PostgreSQL** (`postgres://rôle:mdp@hôte:5432/base`, `?sslmode=require` pour une base managée) ; prioritaire sur BABIVERSE_DB | — |
| BABIVERSE_DB | chemin de la base SQLite (repli sans BABIVERSE_DATABASE_URL ; accepte aussi une URL PostgreSQL) | backend/babiverse.db |
| BABIVERSE_MEDIA_DIR | dossier des fichiers importés (hors base) | backend/media (à côté du fichier SQLite) |
| BABIVERSE_MEDIA_STORAGE | `disk` (fichiers dans BABIVERSE_MEDIA_DIR) ou `database` (table `media_blobs`, pour un hébergeur sans disque persistant) | disk |
| BABIVERSE_SECRET | clé de signature des liens de fichiers | générée et conservée en base |
| BABIVERSE_ADMIN_USER / BABIVERSE_ADMIN_PASSWORD | compte administrateur initial (obligatoire en production) | — |
| BABIVERSE_MAX_UPLOAD_MB | taille maximale d'un fichier importé | 5 |
| BABIVERSE_MAX_IMPORT_MB | taille maximale d'un lot importé (zip) | 50 |
| BABIVERSE_MAX_IMAGE_PX | côté maximal d'une image matricielle | 4096 |
| BABIVERSE_SESSION_HOURS | durée maximale d'une session | 12 |
| BABIVERSE_SESSION_IDLE_MIN | expiration après inactivité | 120 |
| BABIVERSE_PBKDF2_ITERATIONS | coût du hachage des mots de passe | 200000 |
| BABIVERSE_GAME_KEY | clé partagée avec le jeu pour lire le pack de jeu (`GET /api/runtime/game-pack`) | `babiverse-dev` hors production, aucune en production |
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from urllib.parse import urlsplit

_BACKEND = os.path.normpath(os.path.join(os.path.dirname(__file__), ".."))


def load_env_file(path: str = os.path.join(_BACKEND, ".env")) -> None:
    """Lit `backend/.env` (lignes `CLÉ=valeur`, `#` = commentaire) sans écraser les variables déjà définies."""
    if not os.path.isfile(path):
        return
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, value = line.split("=", 1)
                os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def _int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        return default


@dataclass(frozen=True)
class Settings:
    env: str
    db_path: str
    media_dir: str
    secret: str | None
    admin_user: str | None
    admin_password: str | None
    max_upload_bytes: int
    max_import_bytes: int
    max_image_px: int
    session_hours: int
    session_idle_min: int
    pbkdf2_iterations: int
    game_key: str | None = None
    media_storage: str = "disk"

    @property
    def production(self) -> bool:
        return self.env == "production"

    @property
    def postgres(self) -> bool:
        return self.db_path.startswith(("postgres://", "postgresql://"))

    @property
    def db_label(self) -> str:
        """Base affichable : URL sans mot de passe, ou nom du fichier SQLite en production."""
        if self.postgres:
            u = urlsplit(self.db_path)
            host = u.hostname or ""
            return f"{u.scheme}://{u.username or ''}@{host}{':' + str(u.port) if u.port else ''}{u.path}"
        return os.path.basename(self.db_path) if self.production else self.db_path

    @property
    def dev_accounts(self) -> bool:
        """Comptes de développement (mot de passe = identifiant) : jamais en production."""
        return not self.production


def load(db_path: str | None = None) -> Settings:
    env = os.environ.get("BABIVERSE_ENV", "development").strip().lower()
    db = (db_path or os.environ.get("BABIVERSE_DATABASE_URL") or os.environ.get("BABIVERSE_DB")
          or os.path.join(_BACKEND, "babiverse.db"))
    media = os.environ.get("BABIVERSE_MEDIA_DIR")
    if not media:
        # une base SQLite temporaire garde ses fichiers à côté d'elle ; PostgreSQL ou mémoire : backend/media
        local = db != ":memory:" and not db.startswith(("postgres://", "postgresql://"))
        media = os.path.join(os.path.dirname(os.path.abspath(db)) if local else _BACKEND, "media")
    s = Settings(
        env=env, db_path=db, media_dir=media,
        secret=os.environ.get("BABIVERSE_SECRET") or None,
        admin_user=os.environ.get("BABIVERSE_ADMIN_USER") or None,
        admin_password=os.environ.get("BABIVERSE_ADMIN_PASSWORD") or None,
        max_upload_bytes=_int("BABIVERSE_MAX_UPLOAD_MB", 5) * 1024 * 1024,
        max_import_bytes=_int("BABIVERSE_MAX_IMPORT_MB", 50) * 1024 * 1024,
        max_image_px=_int("BABIVERSE_MAX_IMAGE_PX", 4096),
        session_hours=_int("BABIVERSE_SESSION_HOURS", 12),
        session_idle_min=_int("BABIVERSE_SESSION_IDLE_MIN", 120),
        pbkdf2_iterations=_int("BABIVERSE_PBKDF2_ITERATIONS", 200_000),
        game_key=os.environ.get("BABIVERSE_GAME_KEY") or (None if env == "production" else "babiverse-dev"),
        media_storage=os.environ.get("BABIVERSE_MEDIA_STORAGE", "disk").strip().lower(),
    )
    if s.media_storage not in ("disk", "database"):
        raise RuntimeError("BABIVERSE_MEDIA_STORAGE doit valoir « disk » ou « database ».")
    if s.production:
        missing = [n for n, v in (("BABIVERSE_SECRET", s.secret), ("BABIVERSE_ADMIN_USER", s.admin_user),
                                  ("BABIVERSE_ADMIN_PASSWORD", s.admin_password)) if not v]
        if missing:
            raise RuntimeError(f"Production : variables obligatoires manquantes : {', '.join(missing)}.")
        if len(s.admin_password or "") < 12:
            raise RuntimeError("Production : BABIVERSE_ADMIN_PASSWORD doit faire au moins 12 caractères.")
    return s
