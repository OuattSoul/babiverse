import copy
import os
import shutil
import sys
import uuid
from urllib.parse import urlsplit, urlunsplit

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
os.environ.setdefault("BABIVERSE_DB", ":memory:")
os.environ.setdefault("BABIVERSE_FRONTEND", "/nonexistent")
os.environ["BABIVERSE_NO_AUTOAPP"] = "1"          # pas d'application globale à l'import
os.environ.setdefault("BABIVERSE_PBKDF2_ITERATIONS", "1000")  # hachage rapide en tests seulement
os.environ.pop("BABIVERSE_MEDIA_DIR", None)
os.environ.pop("BABIVERSE_ENV", None)

from fastapi.testclient import TestClient  # noqa: E402

from app import auth  # noqa: E402
from app.main import create_app  # noqa: E402


class Api:
    def __init__(self, client: TestClient):
        self.c = client
        self.tokens = {}

    def as_(self, user: str) -> dict:
        if user not in self.tokens:
            r = self.c.post("/api/auth/login", json={"username": user, "password": user})
            assert r.status_code == 200, r.text
            self.tokens[user] = r.json()["token"]
        return {"Authorization": f"Bearer {self.tokens[user]}"}

    def get(self, user, url, **kw):
        return self.c.get(url, headers=self.as_(user), **kw)

    def post(self, user, url, json=None, **kw):
        return self.c.post(url, headers=self.as_(user), json=json, **kw)

    def put(self, user, url, json=None):
        return self.c.put(url, headers=self.as_(user), json=json)

    def patch(self, user, url, json=None):
        return self.c.patch(url, headers=self.as_(user), json=json)

    def delete(self, user, url):
        return self.c.delete(url, headers=self.as_(user))

    def upload(self, user, url, data: bytes, **params):
        return self.c.post(url, headers={**self.as_(user), "Content-Type": "application/octet-stream"}, content=data, params=params)

    def by_tech(self, tech: str) -> dict:
        items = self.get("admin", "/api/assets", params={"q": tech}).json()
        return next(i for i in items if i["technical_name"] == tech)

    def publish_flow(self, asset_id: str, editor="editeur", publisher="publieur"):
        r = self.post(editor, f"/api/assets/{asset_id}/submit"); assert r.status_code == 200, r.json()
        r = self.post(publisher, f"/api/assets/{asset_id}/approve"); assert r.status_code == 200, r.json()
        r = self.post(publisher, f"/api/assets/{asset_id}/publish"); assert r.status_code == 200, r.json()
        return r.json()

    def detail(self, asset_id):
        return self.get("admin", f"/api/assets/{asset_id}").json()


# ---------------------------------------------------------------- bases de test
# SQLite par défaut (un fichier par test). Avec BABIVERSE_TEST_DATABASE_URL (URL PostgreSQL d'un rôle
# ayant CREATEDB, par exemple postgres://babiverse:…@localhost:5432/postgres), chaque test reçoit une
# base PostgreSQL neuve, copiée côté serveur depuis la base modèle ; toutes sont supprimées à la fin.
PG_URL = os.environ.get("BABIVERSE_TEST_DATABASE_URL")
_PG_DBS: list[str] = []


def _pg_url(name: str) -> str:
    u = urlsplit(PG_URL)
    return urlunsplit((u.scheme, u.netloc, "/" + name, u.query, u.fragment))


def _pg_admin(sql: str) -> None:
    import psycopg
    with psycopg.connect(PG_URL, autocommit=True) as c:
        c.execute(sql)


def new_db(tmp_path, name: str = "test.db", template: str | None = None) -> str:
    """Adresse d'une base vide (ou copiée de `template`) propre à ce test."""
    if not PG_URL:
        return str(tmp_path / name)
    db = f"bvs_test_{uuid.uuid4().hex[:16]}"
    _pg_admin(f'CREATE DATABASE "{db}"' + (f' TEMPLATE "{template}"' if template else ""))
    _PG_DBS.append(db)
    return _pg_url(db)


@pytest.fixture(autouse=PG_URL is not None)
def _pg_media(tmp_path, monkeypatch):
    # sous SQLite les fichiers suivent la base (même dossier) ; sous PostgreSQL on les range dans le dossier du test
    monkeypatch.setenv("BABIVERSE_MEDIA_DIR", str(tmp_path / "media"))


@pytest.fixture(scope="session", autouse=True)
def _pg_cleanup():
    yield
    for db in _PG_DBS:
        _pg_admin(f'DROP DATABASE IF EXISTS "{db}" WITH (FORCE)')


@pytest.fixture(scope="session")
def template_dir(tmp_path_factory):
    """Base initialisée une seule fois (≈ 7 s), puis copiée pour chaque test : chaque test reste isolé."""
    d = tmp_path_factory.mktemp("template")
    if PG_URL:
        os.environ["BABIVERSE_MEDIA_DIR"] = str(d / "media")
        url = new_db(d)
        app = create_app(url)
        os.environ.pop("BABIVERSE_MEDIA_DIR")
        d.joinpath("pg_template").write_text(url.rsplit("/", 1)[1].split("?")[0])
    else:
        app = create_app(str(d / "test.db"))
        app.state.conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    app.state.conn.close()
    return d


def clone(template_dir, target):
    shutil.copytree(template_dir / "media", target / "media")
    if PG_URL:
        return new_db(target, template=(template_dir / "pg_template").read_text())
    shutil.copy(template_dir / "test.db", target / "test.db")
    return str(target / "test.db")


@pytest.fixture()
def api(tmp_path, template_dir):
    auth.reset_failures()
    app = create_app(clone(template_dir, tmp_path))
    with TestClient(app) as client:
        yield Api(client)
    app.state.conn.close()


@pytest.fixture()
def deep():
    return copy.deepcopy
