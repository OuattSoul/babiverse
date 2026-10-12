"""Persistance SQLite : entités relationnelles + définitions JSON validées.

Le schéma évolue par **migrations explicites et numérotées** (`MIGRATIONS`), appliquées au démarrage
dans l'ordre et tracées par `PRAGMA user_version`. Une base créée par le prototype v0.1 (version 0,
tables déjà présentes) est reprise telle quelle : la migration 1 est idempotente, la 2 ajoute
colonnes et tables sans rien supprimer. Les fichiers importés ne sont pas stockés en base
(voir `media.py`) : la base ne contient que leurs métadonnées et empreintes.
"""
from __future__ import annotations

import json
import os
import sqlite3
import time
from contextlib import contextmanager

SCHEMA_V1 = """
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  pw_hash TEXT NOT NULL,
  role TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  technical_name TEXT UNIQUE NOT NULL,
  category TEXT NOT NULL,
  family TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at REAL NOT NULL,
  updated_at REAL NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0,
  published_version INTEGER,
  latest_version INTEGER NOT NULL,
  derived_from TEXT
);
CREATE TABLE IF NOT EXISTS asset_versions (
  asset_id TEXT NOT NULL REFERENCES assets(id),
  version INTEGER NOT NULL,
  status TEXT NOT NULL,
  definition TEXT NOT NULL,
  validation TEXT,
  created_by TEXT NOT NULL,
  created_at REAL NOT NULL,
  updated_at REAL NOT NULL,
  published_at REAL,
  PRIMARY KEY (asset_id, version)
);
CREATE TABLE IF NOT EXISTS instances (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES assets(id),
  version INTEGER NOT NULL,
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  rotation INTEGER NOT NULL,
  variant_id TEXT,
  owner_id INTEGER,
  created_at REAL NOT NULL,
  FOREIGN KEY (asset_id, version) REFERENCES asset_versions(asset_id, version)
);
CREATE TABLE IF NOT EXISTS world (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  terrain TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts REAL NOT NULL,
  username TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT,
  detail TEXT
);
CREATE INDEX IF NOT EXISTS idx_assets_category ON assets(category);
CREATE INDEX IF NOT EXISTS idx_instances_asset ON instances(asset_id, version);
"""

SCHEMA_V2_TABLES = """
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS categories (
  key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  family TEXT NOT NULL,
  rules TEXT NOT NULL DEFAULT '[]',
  subcategories TEXT NOT NULL DEFAULT '[]',
  description TEXT NOT NULL DEFAULT '',
  builtin INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0,
  created_at REAL NOT NULL,
  updated_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS media (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  filename TEXT NOT NULL,
  kind TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  width REAL,
  height REAL,
  meta TEXT NOT NULL DEFAULT '{}',
  tags TEXT NOT NULL DEFAULT '[]',
  category TEXT NOT NULL DEFAULT 'other',
  revision INTEGER NOT NULL DEFAULT 1,
  archived INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL,
  created_at REAL NOT NULL,
  updated_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS media_revisions (
  media_id TEXT NOT NULL REFERENCES media(id),
  revision INTEGER NOT NULL,
  filename TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  width REAL,
  height REAL,
  meta TEXT NOT NULL DEFAULT '{}',
  created_by TEXT NOT NULL,
  created_at REAL NOT NULL,
  PRIMARY KEY (media_id, revision)
);
CREATE TABLE IF NOT EXISTS scenes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  terrain TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at REAL NOT NULL,
  updated_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS imports (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  filename TEXT NOT NULL,
  manifest TEXT NOT NULL,
  analysis TEXT NOT NULL,
  result TEXT,
  created_by TEXT NOT NULL,
  created_at REAL NOT NULL,
  updated_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_media_sha ON media(sha256);
"""


def _columns(conn: sqlite3.Connection, table: str) -> set[str]:
    return {r["name"] for r in conn.execute(f"PRAGMA table_info({table})")}


def _add_column(conn: sqlite3.Connection, table: str, ddl: str) -> None:
    name = ddl.split()[0]
    if name not in _columns(conn, table):
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {ddl}")


def _m1(conn: sqlite3.Connection) -> None:
    conn.executescript(SCHEMA_V1)


def _m2(conn: sqlite3.Connection) -> None:
    """Studio v1 : utilisateurs actifs, sessions glissantes, médiathèque, catégories en base,
    scènes de test multiples, dépendances figées à la publication, journal d'imports."""
    conn.executescript(SCHEMA_V2_TABLES)
    now = time.time()
    _add_column(conn, "users", "active INTEGER NOT NULL DEFAULT 1")
    _add_column(conn, "users", "created_at REAL")
    _add_column(conn, "users", "password_changed_at REAL")
    _add_column(conn, "sessions", "last_used REAL")
    _add_column(conn, "asset_versions", "pins TEXT")
    _add_column(conn, "asset_versions", "note TEXT")
    _add_column(conn, "instances", "scene_id TEXT NOT NULL DEFAULT 'main'")
    _add_column(conn, "instances", "data TEXT NOT NULL DEFAULT '{}'")
    conn.execute("UPDATE users SET created_at = ? WHERE created_at IS NULL", (now,))
    conn.execute("UPDATE sessions SET last_used = created_at WHERE last_used IS NULL")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_instances_scene ON instances(scene_id)")
    # l'ancien monde unique devient la scène de test « main »
    w = conn.execute("SELECT * FROM world WHERE id = 1").fetchone()
    if w and not conn.execute("SELECT 1 FROM scenes WHERE id = 'main'").fetchone():
        conn.execute("INSERT INTO scenes (id, name, description, width, height, terrain, created_by, created_at, updated_at) "
                     "VALUES ('main', 'Quartier de test', 'Scène reprise du prototype v0.1.', ?, ?, ?, 'system', ?, ?)",
                     (w["width"], w["height"], w["terrain"], now, now))


MIGRATIONS = [_m1, _m2]
SCHEMA_VERSION = len(MIGRATIONS)


def db_path() -> str:
    return os.environ.get("BABIVERSE_DB", os.path.join(os.path.dirname(__file__), "..", "babiverse.db"))


def connect(path: str | None = None) -> sqlite3.Connection:
    conn = sqlite3.connect(path or db_path(), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    return conn


def schema_version(conn: sqlite3.Connection) -> int:
    return conn.execute("PRAGMA user_version").fetchone()[0]


def migrate(conn: sqlite3.Connection) -> list[int]:
    """Applique les migrations manquantes ; retourne les numéros appliqués."""
    applied = []
    current = schema_version(conn)
    for n, step in enumerate(MIGRATIONS, start=1):
        if n <= current:
            continue
        try:
            step(conn)
            conn.execute(f"PRAGMA user_version = {n}")
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        applied.append(n)
    return applied


def init_schema(conn: sqlite3.Connection) -> None:
    migrate(conn)


@contextmanager
def tx(conn: sqlite3.Connection):
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise


def get_setting(conn: sqlite3.Connection, key: str) -> str | None:
    row = conn.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
    return row["value"] if row else None


def set_setting(conn: sqlite3.Connection, key: str, value: str) -> None:
    conn.execute("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", (key, value))


def audit(conn: sqlite3.Connection, username: str, action: str, target: str | None = None, detail: dict | None = None):
    conn.execute(
        "INSERT INTO audit (ts, username, action, target, detail) VALUES (?,?,?,?,?)",
        (time.time(), username, action, target, json.dumps(detail or {}, ensure_ascii=False)),
    )
