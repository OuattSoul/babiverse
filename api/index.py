"""
Point d'entree WSGI pour Vercel (Python serverless).
Vercel cherche une variable `app` dans ce fichier.

Structure monorepo : ce fichier est a la racine /api/index.py,
et importe le WSGI Django situe dans /backend/.
"""
import os
import sys

# Ajouter le dossier backend au PYTHONPATH pour que Django trouve ses modules.
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BACKEND = os.path.join(ROOT, "backend")
if BACKEND not in sys.path:
    sys.path.insert(0, BACKEND)

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

from django.core.wsgi import get_wsgi_application  # noqa: E402

app = get_wsgi_application()
