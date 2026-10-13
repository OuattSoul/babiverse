"""Synchronisation du contenu de l'atelier : `python manage.py sync_atelier [--url … --key …] [--file chemin]`.

Télécharge le pack de jeu de l'atelier d'assets et l'enregistre dans ATELIER_PACK_FILE. Le jeu s'en sert quand
l'atelier n'est pas joignable en direct (production : l'atelier reste un outil interne). Les modèles 3D des cartes
publiées sont copiés à côté (`models/<média>-<révision>.glb`), après contrôle de leur empreinte.
"""
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from game import atelier


class Command(BaseCommand):
    help = "Télécharge le pack de jeu de l'atelier d'assets (garde-robe, habitants, maison du joueur)."

    def add_arguments(self, parser):
        parser.add_argument("--url", default=None, help="Adresse de l'atelier (défaut : ATELIER_URL)")
        parser.add_argument("--key", default=None, help="Clé partagée (défaut : ATELIER_KEY)")
        parser.add_argument("--file", default=None, help="Fichier de destination (défaut : ATELIER_PACK_FILE)")

    def handle(self, *args, **options):
        url = options["url"] or settings.ATELIER_URL
        if not url:
            raise CommandError("Aucune adresse d'atelier : passer --url ou définir ATELIER_URL.")
        pack = atelier.fetch(url, options["key"], timeout=15)
        if not pack:
            raise CommandError(f"Pack de jeu introuvable sur {url} (atelier arrêté, clé refusée ou format inconnu).")
        path = atelier.write_file(pack, options["file"])
        atelier.reset_cache()
        import hashlib
        import os
        saved = 0
        for model in atelier.published_models(pack).values():
            data = atelier.fetch_model(model, url, options["key"])
            if data is None or hashlib.sha256(data).hexdigest() != model.get("sha256"):
                raise CommandError(f"Modèle {model['media_id']} r{model['revision']} illisible ou altéré.")
            target = atelier.model_path(model)
            os.makedirs(os.path.dirname(target), exist_ok=True)
            with open(target, "wb") as f:
                f.write(data)
            saved += 1
        self.stdout.write(f"Pack {pack['revision']} enregistré dans {path} : {len(pack['inhabitants'])} habitant(s), "
                          f"maison : {pack['home']['name'] if pack['home'] else 'studio d’origine'}, {len(pack.get('maps') or [])} carte(s), "
                          f"{saved} modèle(s) 3D.")
