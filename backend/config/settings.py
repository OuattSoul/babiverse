import json
import os
import sys
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

BASE_DIR = Path(__file__).resolve().parent.parent


def _load_dotenv(path):
    """Chargeur .env minimal (clé=valeur), sans dépendance externe."""
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip())


_load_dotenv(BASE_DIR / ".env")

# DEBUG est désactivé par défaut : un oubli de configuration en production ne l'active jamais.
# En local, backend/.env (copié depuis .env.example) met DJANGO_DEBUG=1.
DEBUG = os.environ.get("DJANGO_DEBUG", "0") == "1"
TESTING = sys.argv[1:2] == ["test"]
SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "")
if not SECRET_KEY:
    if not (DEBUG or TESTING):
        raise RuntimeError("DJANGO_SECRET_KEY doit être défini en production.")
    SECRET_KEY = "dev-only-insecure-key"

ALLOWED_HOSTS = [h for h in os.environ.get("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1").split(",") if h]
if DEBUG:
    # Permet de tester depuis un téléphone sur le réseau local.
    ALLOWED_HOSTS.append("*")

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "game",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]


def _database_from_url(url):
    parsed = urlparse(url)
    if parsed.scheme in ("postgres", "postgresql"):
        # Les paramètres de l'URL (?sslmode=require, exigé par la plupart des PostgreSQL managés)
        # sont transmis tels quels au pilote.
        options = {k: v[-1] for k, v in parse_qs(parsed.query).items()}
        return {
            "ENGINE": "django.db.backends.postgresql",
            "NAME": parsed.path.lstrip("/"),
            "USER": unquote(parsed.username or ""),
            "PASSWORD": unquote(parsed.password or ""),
            "HOST": parsed.hostname or "localhost",
            "PORT": str(parsed.port or 5432),
            "OPTIONS": options,
            # Connexions réutilisées entre requêtes ; mettre 0 derrière PgBouncer en mode transaction.
            "CONN_MAX_AGE": int(os.environ.get("DB_CONN_MAX_AGE", "60")),
            "CONN_HEALTH_CHECKS": True,
        }
    if parsed.scheme == "sqlite":
        return _sqlite(parsed.path.lstrip("/") or BASE_DIR / "db.sqlite3")
    raise RuntimeError(f"DATABASE_URL non supportée : {parsed.scheme}")


def _sqlite(name):
    # IMMEDIATE : le verrou d'écriture est pris dès le début de la transaction, ce qui évite
    # les « database is locked » quand deux requêtes du même joueur arrivent en même temps.
    return {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": name,
        "OPTIONS": {"transaction_mode": "IMMEDIATE", "timeout": 20, "init_command": "PRAGMA journal_mode=WAL;"},
        # Base de test sur fichier (et non en mémoire) pour tester de vraies requêtes concurrentes.
        "TEST": {"NAME": str(BASE_DIR / "test_db.sqlite3")},
    }


DATABASES = {
    "default": _database_from_url(os.environ["DATABASE_URL"])
    if os.environ.get("DATABASE_URL")
    else _sqlite(BASE_DIR / "db.sqlite3")
}

# Cache partagé : compteurs de limitation de débit (DRF).
# Sans REDIS_URL, cache en mémoire propre à chaque processus : suffisant en local, mais avec
# plusieurs workers gunicorn chaque processus compte de son côté (limites contournables).
if os.environ.get("REDIS_URL") and not TESTING:
    CACHES = {"default": {"BACKEND": "django.core.cache.backends.redis.RedisCache",
                          "LOCATION": os.environ["REDIS_URL"], "KEY_PREFIX": "babiverse"}}
else:
    CACHES = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator",
     "OPTIONS": {"user_attributes": ("username", "email", "pending_email")}},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator", "OPTIONS": {"min_length": 8}},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]
if TESTING:
    # Hachage rapide pour les tests uniquement (PBKDF2 par défaut ailleurs).
    PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]

# E-mails (confirmation d'adresse, mot de passe oublié, alertes de sécurité), envoyés par Resend.
# En local sans clé, ils s'affichent dans la console du backend ; en tests, ils restent en mémoire.
PUBLIC_URL = os.environ.get("PUBLIC_URL", "http://localhost:5173")
DEFAULT_FROM_EMAIL = os.environ.get("DEFAULT_FROM_EMAIL", "BabiVerse <onboarding@resend.dev>")
RESEND_API_KEY = os.environ.get("RESEND_API_KEY", "")
if os.environ.get("EMAIL_BACKEND"):
    EMAIL_BACKEND = os.environ["EMAIL_BACKEND"]
elif RESEND_API_KEY and not TESTING:
    EMAIL_BACKEND = "game.mail.ResendEmailBackend"
elif DEBUG or TESTING:
    EMAIL_BACKEND = "django.core.mail.backends.console.EmailBackend"
else:
    # Jamais de repli sur la console en production : les liens de récupération finiraient dans les journaux.
    raise RuntimeError("RESEND_API_KEY doit être défini en production (envoi des e-mails de récupération).")
# Envoi hors de la requête : le temps de réponse ne révèle pas si un e-mail est parti.
EMAIL_ASYNC = not TESTING

# Atelier d'assets (babiverse-asset-studio-admin) : le jeu lit son « pack de jeu » (garde-robe, habitants,
# intérieur de la maison). En direct depuis ATELIER_URL (relu toutes les ATELIER_CACHE_S secondes), sinon depuis
# le dernier fichier synchronisé (`manage.py sync_atelier`). Sans l'un ni l'autre, le jeu garde son contenu d'origine.
ATELIER_URL = os.environ.get("ATELIER_URL", "http://127.0.0.1:8000" if DEBUG and not TESTING else "").rstrip("/")
ATELIER_KEY = os.environ.get("ATELIER_KEY", "babiverse-dev" if DEBUG else "")
ATELIER_PACK_FILE = os.environ.get("ATELIER_PACK_FILE", str(BASE_DIR.parent / "shared" / "atelier" / "game-pack.json"))
ATELIER_CACHE_S = int(os.environ.get("ATELIER_CACHE_S", "15"))

LANGUAGE_CODE = "fr-fr"
TIME_ZONE = "Africa/Abidjan"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": ["game.auth.PlayerTokenAuthentication"],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "DEFAULT_THROTTLE_CLASSES": [
        "rest_framework.throttling.AnonRateThrottle",
        "rest_framework.throttling.UserRateThrottle",
    ],
    "DEFAULT_THROTTLE_RATES": {
        "anon": os.environ.get("THROTTLE_ANON", "30/minute"),
        "user": os.environ.get("THROTTLE_USER", "240/minute"),
        # Connexion, inscription, mot de passe : par adresse IP, en plus du verrouillage par compte.
        "auth": os.environ.get("THROTTLE_AUTH", "10/minute"),
    },
    "EXCEPTION_HANDLER": "game.views.api_exception_handler",
    # Nombre de proxys devant Django (1 derrière Caddy/Nginx) : sinon X-Forwarded-For est pris tel quel.
    "NUM_PROXIES": int(os.environ["NUM_PROXIES"]) if os.environ.get("NUM_PROXIES") else None,
    "UNAUTHENTICATED_USER": None,
}

# Serveurs ICE des appels vocaux entre joueurs (WebRTC), en JSON. Le STUN trouve l'adresse publique de
# chaque joueur ; derrière certains réseaux mobiles, un relais TURN (avec identifiants) est nécessaire.
# « [] » = appels possibles seulement sur le même réseau.
WEBRTC_ICE_SERVERS = json.loads(os.environ.get("WEBRTC_ICE_SERVERS") or '[{"urls": "stun:stun.l.google.com:19302"}]')

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {"simple": {"format": "%(asctime)s %(levelname)s %(name)s %(message)s"}},
    "handlers": {"console": {"class": "logging.StreamHandler", "formatter": "simple"}},
    "loggers": {"game": {"handlers": ["console"], "level": os.environ.get("GAME_LOG_LEVEL", "WARNING" if "test" in sys.argv else "INFO")}},
}

if not (DEBUG or TESTING):
    # Production derrière un proxy HTTPS (Caddy/Nginx) qui transmet X-Forwarded-Proto.
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    SECURE_SSL_REDIRECT = os.environ.get("SECURE_SSL_REDIRECT", "1") == "1"
    # HSTS : un jour par défaut pour la bêta, à allonger une fois HTTPS validé sur le domaine.
    SECURE_HSTS_SECONDS = int(os.environ.get("SECURE_HSTS_SECONDS", "86400"))
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
