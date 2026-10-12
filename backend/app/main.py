"""Expose l'application Django en ASGI sous le nom `app`, attendu par uvicorn.

Lancer depuis backend/ : python -m uvicorn app.main:app --host 127.0.0.1 --port 8010
"""
from config.asgi import application as app

__all__ = ["app"]
