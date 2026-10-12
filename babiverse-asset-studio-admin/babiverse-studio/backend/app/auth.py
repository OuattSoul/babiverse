"""Authentification par jeton opaque + contrôle d'accès par rôle.

Seule l'empreinte SHA-256 du jeton est stockée. Une session expire après `session_hours` ou après
`session_idle_min` sans activité ; la déconnexion la supprime. Après 5 échecs de connexion pour un
même identifiant, les tentatives sont refusées pendant 5 minutes. Les permissions sont vérifiées
côté serveur sur chaque route (voir `main.need`).
"""
from __future__ import annotations

import hashlib
import hmac
import os
import re
import secrets
import sqlite3
import threading
import time

PERMISSIONS = {
    "asset.read": "Consulter le catalogue et la médiathèque",
    "asset.create": "Créer et dupliquer des assets",
    "asset.edit": "Modifier les brouillons, soumettre à validation",
    "asset.validate": "Approuver ou renvoyer en brouillon",
    "asset.publish": "Publier, revenir à une version, migrer les instances",
    "asset.archive": "Archiver et restaurer",
    "asset.export": "Exporter des assets et des scènes",
    "asset.import": "Importer des lots d'assets",
    "media.upload": "Importer des fichiers dans la médiathèque",
    "media.manage": "Remplacer et archiver les fichiers des autres",
    "world.place": "Placer des objets dans les scènes de test",
    "world.edit_any": "Modifier les objets placés par d'autres",
    "scene.manage": "Créer, dupliquer et supprimer des scènes de test",
    "admin.audit": "Consulter le journal d'audit",
    "admin.users": "Gérer les utilisateurs",
    "admin.settings": "Administrer les paramètres (catégories)",
}

ROLE_PERMISSIONS = {
    # Administrateur : tout
    "admin": set(PERMISSIONS),
    # Éditeur de contenu : crée et modifie des brouillons, les soumet, importe des fichiers
    "editor": {"asset.read", "asset.create", "asset.edit", "asset.export", "media.upload", "world.place", "scene.manage"},
    # Publieur : relit, valide, publie, archive, importe des lots
    "publisher": {"asset.read", "asset.validate", "asset.publish", "asset.archive", "asset.export", "asset.import",
                  "media.upload", "media.manage", "world.place", "world.edit_any", "scene.manage", "admin.audit"},
    # Lecteur : consulte sans rien modifier
    "viewer": {"asset.read"},
    # Joueur : consulte le catalogue publié et place ses objets dans les scènes de test
    "player": {"world.place"},
}

ROLE_LABELS = {"admin": "Administrateur", "editor": "Éditeur de contenu", "publisher": "Publieur",
               "viewer": "Lecteur", "player": "Joueur (test)"}

USERNAME = re.compile(r"^[a-z0-9][a-z0-9_.\-]{1,39}$")
MAX_FAILURES = 5
LOCK_S = 300

_failures: dict[str, list[float]] = {}
_flock = threading.Lock()

# Réglés par main.create_app à partir de la configuration
SESSION_TTL_S = 12 * 3600
SESSION_IDLE_S = 120 * 60
PBKDF2_ITERATIONS = 200_000


def configure(session_hours: int, idle_min: int, iterations: int) -> None:
    global SESSION_TTL_S, SESSION_IDLE_S, PBKDF2_ITERATIONS
    SESSION_TTL_S, SESSION_IDLE_S, PBKDF2_ITERATIONS = session_hours * 3600, idle_min * 60, iterations


def hash_password(password: str, salt: bytes | None = None) -> str:
    salt = salt or os.urandom(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, PBKDF2_ITERATIONS)
    return f"pbkdf2${PBKDF2_ITERATIONS}${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    parts = stored.split("$")
    try:
        if len(parts) == 3:  # format du prototype v0.1 : 200 000 itérations implicites
            _, salt_hex, digest_hex = parts
            iterations = 200_000
        else:
            _, it, salt_hex, digest_hex = parts
            iterations = int(it)
    except ValueError:
        return False
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt_hex), iterations)
    return hmac.compare_digest(digest.hex(), digest_hex)


def check_password_strength(password: str) -> str | None:
    if len(password) < 10:
        return "Le mot de passe doit contenir au moins 10 caractères."
    if password.lower() == password or not any(c.isdigit() for c in password):
        return "Le mot de passe doit mélanger majuscules, minuscules et chiffres."
    return None


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def locked(username: str) -> bool:
    with _flock:
        recent = [t for t in _failures.get(username, []) if time.time() - t < LOCK_S]
        _failures[username] = recent
        return len(recent) >= MAX_FAILURES


def _fail(username: str) -> None:
    with _flock:
        _failures.setdefault(username, []).append(time.time())


def reset_failures() -> None:
    with _flock:
        _failures.clear()


def login(conn: sqlite3.Connection, username: str, password: str) -> tuple[str, dict] | None:
    """Retourne (jeton, utilisateur), None si refusé. Lève PermissionError si verrouillé."""
    username = username.strip().lower()
    if locked(username):
        raise PermissionError("Trop de tentatives : réessayez dans quelques minutes.")
    row = conn.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
    if not row or not verify_password(password, row["pw_hash"]) or not row["active"]:
        _fail(username)
        return None
    token = secrets.token_urlsafe(32)
    now = time.time()
    conn.execute("INSERT INTO sessions (token_hash, user_id, created_at, last_used) VALUES (?,?,?,?)",
                 (_token_hash(token), row["id"], now, now))
    conn.execute("DELETE FROM sessions WHERE created_at < ?", (now - SESSION_TTL_S,))
    conn.commit()
    return token, user_dict(row)


def user_from_token(conn: sqlite3.Connection, token: str) -> dict | None:
    th = _token_hash(token)
    row = conn.execute(
        "SELECT u.*, s.created_at AS s_created, s.last_used AS s_used FROM sessions s JOIN users u ON u.id = s.user_id "
        "WHERE s.token_hash = ?", (th,)).fetchone()
    if not row:
        return None
    now = time.time()
    if not row["active"] or now - row["s_created"] > SESSION_TTL_S or now - (row["s_used"] or row["s_created"]) > SESSION_IDLE_S:
        conn.execute("DELETE FROM sessions WHERE token_hash = ?", (th,))
        conn.commit()
        return None
    if now - (row["s_used"] or 0) > 60:  # rafraîchi au plus une fois par minute
        conn.execute("UPDATE sessions SET last_used = ? WHERE token_hash = ?", (now, th))
        conn.commit()
    return user_dict(row)


def logout(conn: sqlite3.Connection, token: str, everywhere: bool = False) -> None:
    th = _token_hash(token)
    if everywhere:
        row = conn.execute("SELECT user_id FROM sessions WHERE token_hash = ?", (th,)).fetchone()
        if row:
            conn.execute("DELETE FROM sessions WHERE user_id = ?", (row["user_id"],))
    conn.execute("DELETE FROM sessions WHERE token_hash = ?", (th,))
    conn.commit()


def user_dict(row) -> dict:
    keys = row.keys()
    return {"id": row["id"], "username": row["username"], "role": row["role"],
            "role_label": ROLE_LABELS.get(row["role"], row["role"]),
            "active": bool(row["active"]) if "active" in keys else True,
            "permissions": sorted(ROLE_PERMISSIONS.get(row["role"], set()))}


def create_user(conn: sqlite3.Connection, username: str, password: str, role: str, commit: bool = True) -> None:
    if role not in ROLE_PERMISSIONS:
        raise ValueError("rôle inconnu")
    conn.execute("INSERT INTO users (username, pw_hash, role, active, created_at, password_changed_at) VALUES (?,?,?,1,?,?) "
                 "ON CONFLICT DO NOTHING",
                 (username, hash_password(password), role, time.time(), time.time()))
    if commit:
        conn.commit()


def set_password(conn: sqlite3.Connection, user_id: int, password: str, keep_token: str | None = None) -> None:
    conn.execute("UPDATE users SET pw_hash = ?, password_changed_at = ? WHERE id = ?", (hash_password(password), time.time(), user_id))
    # les autres sessions sont fermées
    if keep_token:
        conn.execute("DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?", (user_id, _token_hash(keep_token)))
    else:
        conn.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
