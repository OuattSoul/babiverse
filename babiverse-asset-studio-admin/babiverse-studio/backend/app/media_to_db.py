"""Verse les fichiers de la médiathèque du disque vers la base (table `media_blobs`).

    python -m app.media_to_db [URL ou chemin de la base] [dossier des médias]

Défauts : `BABIVERSE_DATABASE_URL` / `BABIVERSE_DB` (lues aussi dans `backend/.env`) et `backend/media`.
À lancer avant de passer à `BABIVERSE_MEDIA_STORAGE=database` sur une base qui a déjà des fichiers (par exemple
après `copy_to_postgres` vers une base hébergée). Les fichiers déjà en base sont ignorés ; rien n'est supprimé.
"""
from __future__ import annotations

import os
import sys

from . import config, media as md
from .db import connect, db_path, migrate


def copy(target: str, media_dir: str) -> tuple[int, list[str]]:
    """Retourne (fichiers ajoutés, empreintes introuvables sur disque)."""
    conn = connect(target)
    migrate(conn)
    added, missing = 0, []
    try:
        revs = conn.execute("SELECT DISTINCT sha256, mime FROM media_revisions").fetchall()
        known = {r[0] for r in conn.execute("SELECT sha256 FROM media_blobs")}
        for sha, mime in revs:
            if sha in known:
                continue
            path = md.path_for(media_dir, sha, mime)
            if not os.path.isfile(path):
                missing.append(sha)
                continue
            with open(path, "rb") as f:
                conn.execute("INSERT INTO media_blobs (sha256, data) VALUES (?, ?) ON CONFLICT DO NOTHING", (sha, f.read()))
            added += 1
        conn.commit()
    finally:
        conn.close()
    return added, missing


def main(argv: list[str]) -> None:
    config.load_env_file()
    target = argv[0] if argv else db_path()
    media_dir = argv[1] if len(argv) > 1 else os.environ.get("BABIVERSE_MEDIA_DIR") or os.path.join(os.path.dirname(__file__), "..", "media")
    added, missing = copy(target, media_dir)
    print(f"{added} fichier(s) ajouté(s) à la base.")
    if missing:
        print(f"{len(missing)} fichier(s) introuvable(s) sur disque : {', '.join(missing[:5])}{' …' if len(missing) > 5 else ''}")
        sys.exit(1)


if __name__ == "__main__":
    main(sys.argv[1:])
