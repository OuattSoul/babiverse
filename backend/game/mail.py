"""Envoi des e-mails du jeu.

- `ResendEmailBackend` : backend Django qui envoie par l'API Resend (https://resend.com/docs/send-with-python).
  Activé quand `RESEND_API_KEY` est défini ; `send_mail` s'utilise ensuite normalement.
- `send_async` : envoie hors de la requête, pour que le temps de réponse ne révèle pas si un e-mail
  est parti (mot de passe oublié, adresse déjà utilisée). Synchrone dans les tests (`EMAIL_ASYNC`).
"""
import logging
import threading

from django.conf import settings
from django.core.mail import send_mail
from django.core.mail.backends.base import BaseEmailBackend

log = logging.getLogger("game")


class ResendEmailBackend(BaseEmailBackend):
    def __init__(self, fail_silently=False, **kwargs):
        super().__init__(fail_silently=fail_silently, **kwargs)
        import resend  # importé ici : le paquet n'est requis que si ce backend est choisi

        resend.api_key = settings.RESEND_API_KEY
        self.resend = resend

    def send_messages(self, email_messages):
        from resend.exceptions import ResendError

        sent = 0
        for message in email_messages:
            params = {"from": message.from_email, "to": list(message.to), "subject": message.subject, "text": message.body}
            for content, mimetype in getattr(message, "alternatives", []):
                if mimetype == "text/html":
                    params["html"] = content
            if message.reply_to:
                params["reply_to"] = list(message.reply_to)
            try:
                self.resend.Emails.send(params)
                sent += 1
            except (ResendError, ValueError):
                if not self.fail_silently:
                    raise
                log.exception("Resend : envoi impossible (%s)", message.subject)
        return sent


def _send(subject, body, to):
    try:
        send_mail(subject, body, settings.DEFAULT_FROM_EMAIL, [to])
    except Exception:  # noqa: BLE001 — service d'envoi indisponible : on journalise, l'action reste valide
        log.exception("envoi d'e-mail impossible (%s)", subject)


def send_async(subject, body, to):
    """Envoie un e-mail sans bloquer la réponse HTTP (fil d'exécution séparé hors tests)."""
    if settings.EMAIL_ASYNC:
        threading.Thread(target=_send, args=(subject, body, to), daemon=True).start()
    else:
        _send(subject, body, to)
