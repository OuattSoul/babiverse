import copy
import os
import shutil
import sys

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


@pytest.fixture(scope="session")
def template_dir(tmp_path_factory):
    """Base initialisée une seule fois (≈ 7 s), puis copiée pour chaque test : chaque test reste isolé."""
    d = tmp_path_factory.mktemp("template")
    app = create_app(str(d / "test.db"))
    app.state.conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    app.state.conn.close()
    return d


def clone(template_dir, target):
    shutil.copy(template_dir / "test.db", target / "test.db")
    shutil.copytree(template_dir / "media", target / "media")
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
