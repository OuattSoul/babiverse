"""Nettoyage des comptes, à lancer chaque jour (cron) : `python manage.py purge_comptes`."""
from django.core.management.base import BaseCommand

from game import clock
from game.services import accounts


class Command(BaseCommand):
    help = "Supprime les sessions expirées et les liens (confirmation, réinitialisation) périmés."

    def handle(self, *args, **options):
        sessions, links = accounts.purge(clock.now())
        self.stdout.write(f"{sessions} session(s) expirée(s) et {links} lien(s) périmé(s) supprimés.")
