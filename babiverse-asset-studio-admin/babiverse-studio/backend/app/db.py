"""Persistance PostgreSQL (ou SQLite) : entités relationnelles + définitions JSON validées.

**PostgreSQL** dès que l'adresse de la base est une URL `postgres://` / `postgresql://`
(`BABIVERSE_DATABASE_URL`) ; sinon un fichier SQLite. Le code applicatif écrit un seul dialecte
(paramètres `?`, `ON CONFLICT`) : `PgConnection` le traduit pour PostgreSQL et rend des lignes qui se
lisent comme `sqlite3.Row` (`row["col"]`, `row[0]`, `row.keys()`, `dict(row)`).

Le schéma évolue par **migrations explicites et numérotées** (`MIGRATIONS`), appliquées au démarrage
dans l'ordre et tracées par `PRAGMA user_version` (SQLite) ou la table `schema_version` (PostgreSQL). Une base créée par le prototype v0.1 (version 0,
tables déjà présentes) est reprise telle quelle : la migration 1 est idempotente, la 2 ajoute
colonnes et tables sans rien supprimer. Les fichiers importés ne sont pas stockés en base
(voir `media.py`) : la base ne contient que leurs métadonnées et empreintes.
"""
from __future__ import annotations

import json
import os
import re
import sqlite3
import time
from contextlib import contextmanager
from typing import Any

try:  # pilote PostgreSQL, facultatif tant qu'on reste sur SQLite
    import psycopg
    from psycopg.adapt import Dumper
except ImportError:  # pragma: no cover
    psycopg = None

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


def _columns(conn, table: str) -> set[str]:
    if is_pg(conn):
        return {r["name"] for r in conn.execute(
            "SELECT column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ?", (table,))}
    return {r["name"] for r in conn.execute(f"PRAGMA table_info({table})")}


def _add_column(conn, table: str, ddl: str) -> None:
    name = ddl.split()[0]
    if name not in _columns(conn, table):
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {pg_ddl(ddl) if is_pg(conn) else ddl}")


def _m1(conn) -> None:
    conn.executescript(SCHEMA_V1)


def _m2(conn) -> None:
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


def _m3(conn) -> None:
    """Fichiers de la médiathèque en base (`BABIVERSE_MEDIA_STORAGE=database`), pour un hébergement sans disque
    persistant : contenu adressé par empreinte, comme sur disque."""
    conn.executescript("CREATE TABLE IF NOT EXISTS media_blobs (sha256 TEXT PRIMARY KEY, data BLOB NOT NULL)")


def _m4(conn) -> None:
    """Monde multi-villes (phase 2) : villes, zones (communes, quartiers), cartes jouables et leurs versions publiées.

    Une carte a un brouillon (`draft`, JSON) modifiable sans effet sur le jeu, et des versions publiées immuables
    (`map_versions`) ; `published_version` désigne celle que reçoit le jeu. Les cartes intégrées au jeu (catalogue
    shared/maps.json : quartier, maison, epicerie) ne sont pas copiées ici. Migration additive : rien n'est modifié."""
    conn.executescript("""
CREATE TABLE IF NOT EXISTS cities (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'published',
  created_by TEXT NOT NULL,
  created_at REAL NOT NULL,
  updated_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS districts (
  id TEXT PRIMARY KEY,
  city_id TEXT NOT NULL REFERENCES cities(id),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'published',
  created_by TEXT NOT NULL,
  created_at REAL NOT NULL,
  updated_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS game_maps (
  id TEXT PRIMARY KEY,
  district_id TEXT NOT NULL REFERENCES districts(id),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  draft TEXT NOT NULL,
  published_version INTEGER,
  created_by TEXT NOT NULL,
  created_at REAL NOT NULL,
  updated_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS map_versions (
  map_id TEXT NOT NULL REFERENCES game_maps(id),
  version INTEGER NOT NULL,
  content TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  published_by TEXT NOT NULL,
  published_at REAL NOT NULL,
  PRIMARY KEY (map_id, version)
);
CREATE INDEX IF NOT EXISTS idx_districts_city ON districts(city_id);
CREATE INDEX IF NOT EXISTS idx_maps_district ON game_maps(district_id);
""")


MIGRATIONS = [_m1, _m2, _m3, _m4]
SCHEMA_VERSION = len(MIGRATIONS)


# ---------------------------------------------------------------- PostgreSQL

def is_pg_url(target: str | None) -> bool:
    return bool(target) and target.startswith(("postgres://", "postgresql://"))


def is_pg(conn) -> bool:
    return getattr(conn, "dialect", "sqlite") == "postgresql"


def pg_ddl(sql: str) -> str:
    """Schéma SQLite → PostgreSQL : identité à la place d'AUTOINCREMENT, BYTEA pour BLOB, flottants sur 8 octets
    (`REAL` n'en fait que 4 sous PostgreSQL : les horodatages perdraient leurs secondes)."""
    sql = re.sub(r"\bINTEGER PRIMARY KEY AUTOINCREMENT\b", "BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY", sql)
    sql = re.sub(r"\bBLOB\b", "BYTEA", sql)
    return re.sub(r"\bREAL\b", "DOUBLE PRECISION", sql)


_TOKENS = re.compile(r"'(?:[^']|'')*'|\?|%")


def pg_sql(sql: str) -> str:
    """Paramètres `?` → `%s` (hors chaînes littérales) ; `%` littéral doublé."""
    def sub(m):
        t = m.group()
        return "%s" if t == "?" else "%%" if t == "%" else t.replace("%", "%%")
    return _TOKENS.sub(sub, sql)


class Row:
    """Ligne lisible comme `sqlite3.Row` : par nom, par position, `keys()`, `dict(row)`, déballage."""
    __slots__ = ("_names", "_index", "_values")

    def __init__(self, names: list[str], index: dict[str, int], values: tuple):
        self._names, self._index, self._values = names, index, values

    def keys(self) -> list[str]:
        return list(self._names)

    def __getitem__(self, key):
        return self._values[self._index[key] if isinstance(key, str) else key]

    def __iter__(self):
        return iter(self._values)

    def __len__(self) -> int:
        return len(self._values)

    def __repr__(self) -> str:
        return f"Row({dict(zip(self._names, self._values))!r})"


def _row_factory(cursor):
    names = [c.name for c in cursor.description or []]
    index = {n: i for i, n in enumerate(names)}
    return lambda values: Row(names, index, values)


if psycopg is not None:
    class _BoolAsInt(Dumper):
        """Les booléens Python vont dans des colonnes INTEGER (0/1), comme sous SQLite."""
        oid = psycopg.adapters.types["int4"].oid

        def dump(self, obj):
            return b"1" if obj else b"0"


class PgConnection:
    """Connexion PostgreSQL présentée comme une connexion `sqlite3` (execute / commit / rollback)."""
    dialect = "postgresql"

    def __init__(self, url: str):
        if psycopg is None:
            raise RuntimeError('PostgreSQL demandé mais le pilote est absent : pip install "psycopg[binary]".')
        self.raw = psycopg.connect(url, row_factory=_row_factory)
        self.raw.adapters.register_dumper(bool, _BoolAsInt)

    def execute(self, sql: str, params: Any = ()):
        cur = self.raw.cursor()
        # sans paramètres, psycopg envoie la requête telle quelle (pas de `%` à doubler)
        cur.execute(pg_sql(sql), tuple(params)) if params else cur.execute(sql)
        return cur

    def executescript(self, script: str) -> None:
        for stmt in pg_ddl(script).split(";"):
            if stmt.strip():
                self.raw.execute(stmt)

    def recover(self) -> None:
        """Après une erreur, PostgreSQL refuse toute requête jusqu'au rollback : on le fait ici."""
        if self.raw.info.transaction_status == psycopg.pq.TransactionStatus.INERROR:
            self.raw.rollback()

    def commit(self) -> None:
        self.raw.commit()

    def rollback(self) -> None:
        self.raw.rollback()

    def close(self) -> None:
        self.raw.close()


# ---------------------------------------------------------------- connexion et migrations

def db_path() -> str:
    return (os.environ.get("BABIVERSE_DATABASE_URL") or os.environ.get("BABIVERSE_DB")
            or os.path.join(os.path.dirname(__file__), "..", "babiverse.db"))


def connect(path: str | None = None):
    """`path` : URL PostgreSQL ou chemin d'un fichier SQLite."""
    target = path or db_path()
    if is_pg_url(target):
        return PgConnection(target)
    conn = sqlite3.connect(target, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    return conn


def recover(conn) -> None:
    if is_pg(conn):
        conn.recover()


def schema_version(conn) -> int:
    if is_pg(conn):
        conn.execute("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)")
        row = conn.execute("SELECT version FROM schema_version").fetchone()
        return row[0] if row else 0
    return conn.execute("PRAGMA user_version").fetchone()[0]


def _set_schema_version(conn, n: int) -> None:
    if is_pg(conn):
        conn.execute("DELETE FROM schema_version")
        conn.execute("INSERT INTO schema_version (version) VALUES (?)", (n,))
    else:
        conn.execute(f"PRAGMA user_version = {n}")


def migrate(conn) -> list[int]:
    """Applique les migrations manquantes ; retourne les numéros appliqués."""
    applied = []
    current = schema_version(conn)
    conn.commit()
    for n, step in enumerate(MIGRATIONS, start=1):
        if n <= current:
            continue
        try:
            step(conn)
            _set_schema_version(conn, n)
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        applied.append(n)
    return applied


def init_schema(conn) -> None:
    migrate(conn)


@contextmanager
def tx(conn):
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise


def get_setting(conn, key: str) -> str | None:
    row = conn.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
    return row["value"] if row else None


def set_setting(conn, key: str, value: str) -> None:
    conn.execute("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", (key, value))


def audit(conn, username: str, action: str, target: str | None = None, detail: dict | None = None):
    conn.execute(
        "INSERT INTO audit (ts, username, action, target, detail) VALUES (?,?,?,?,?)",
        (time.time(), username, action, target, json.dumps(detail or {}, ensure_ascii=False)),
    )
