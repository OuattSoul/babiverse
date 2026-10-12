"""Recopie une base SQLite de l'atelier dans une base PostgreSQL vide.

    python -m app.copy_to_postgres [chemin.db] [URL]

Défauts : `backend/babiverse.db` et `BABIVERSE_DATABASE_URL` (lue aussi dans `backend/.env`).
Le schéma est créé dans la cible par les migrations habituelles ; la source n'est jamais modifiée et
doit être à jour (ouvrir l'atelier une fois sur elle sinon). Les médias restent dans `backend/media/`.
"""
from __future__ import annotations

import os
import sys

from . import config
from .db import SCHEMA_VERSION, _columns, connect, is_pg, is_pg_url, migrate, pg_sql, schema_version

# ordre compatible avec les clés étrangères
TABLES = ["users", "sessions", "assets", "asset_versions", "instances", "world", "audit", "settings",
          "categories", "media", "media_revisions", "scenes", "imports", "media_blobs"]
IDENTITIES = ["users", "audit"]


def copy(src_path: str, url: str) -> dict[str, int]:
    """Copie toutes les lignes ; retourne le nombre de lignes par table."""
    if not is_pg_url(url):
        raise SystemExit("La cible doit être une URL postgres:// ou postgresql://.")
    if not os.path.isfile(src_path):
        raise SystemExit(f"Base SQLite introuvable : {src_path}")
    src = connect(src_path)
    if schema_version(src) != SCHEMA_VERSION:
        raise SystemExit(f"Base SQLite en version {schema_version(src)} (attendu {SCHEMA_VERSION}) : ouvrir l'atelier une fois dessus.")
    dst = connect(url)
    assert is_pg(dst)
    migrate(dst)
    full = [t for t in TABLES if dst.execute(f"SELECT 1 FROM {t} LIMIT 1").fetchone()]
    if full:
        raise SystemExit(f"La base PostgreSQL n'est pas vide ({', '.join(full)}) : rien n'a été copié.")
    counts = {}
    try:
        for t in TABLES:
            dst_cols = _columns(dst, t)
            cols = [c for c in (r["name"] for r in src.execute(f"PRAGMA table_info({t})")) if c in dst_cols]
            rows = [tuple(r) for r in src.execute(f"SELECT {', '.join(cols)} FROM {t}")]
            if rows:
                sql = pg_sql(f"INSERT INTO {t} ({', '.join(cols)}) VALUES ({', '.join('?' * len(cols))})")
                with dst.raw.cursor() as cur:
                    cur.executemany(sql, rows)
            counts[t] = len(rows)
        for t in IDENTITIES:  # les prochains identifiants partent après les lignes copiées
            dst.execute(f"SELECT setval(pg_get_serial_sequence('{t}', 'id'), COALESCE(MAX(id), 0) + 1, false) FROM {t}")
        dst.commit()
    except Exception:
        dst.rollback()
        raise
    finally:
        src.close()
    mismatch = [t for t in TABLES if dst.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] != counts[t]]
    dst.close()
    if mismatch:
        raise SystemExit(f"Effectifs différents après copie : {', '.join(mismatch)}")
    return counts


def main(argv: list[str]) -> None:
    config.load_env_file()
    src = argv[0] if argv else os.path.join(os.path.dirname(__file__), "..", "babiverse.db")
    url = argv[1] if len(argv) > 1 else os.environ.get("BABIVERSE_DATABASE_URL", "")
    counts = copy(src, url)
    for t, n in counts.items():
        print(f"{t:16} {n:6}")
    print(f"Copie terminée : {sum(counts.values())} lignes.")


if __name__ == "__main__":
    main(sys.argv[1:])
