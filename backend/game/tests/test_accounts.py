"""Comptes : inscription, connexion, sessions, adresse e-mail confirmée, mot de passe."""
import re
from datetime import timedelta
from io import StringIO
from unittest import mock

from django.core import mail
from django.core.cache import cache
from django.core.management import call_command
from django.test import override_settings
from rest_framework.test import APIClient

from game import auth
from game.auth import create_player
from game.mail import ResendEmailBackend
from game.models import AuthToken, EmailVerification, PasswordReset, Player
from game.services import accounts

from .base import PASSWORD, GameTestCase, register

NEW_PASSWORD = "Garba-Alloco-77"


def link_token(kind, message=None):
    message = message or mail.outbox[-1]
    return re.search(rf"#{kind}=([\w-]+)", message.body).group(1)


def verify(token):
    return APIClient().post("/api/auth/email/verify", {"token": token}, format="json")


class AccountTestCase(GameTestCase):
    def login(self, username, password=PASSWORD):
        return APIClient().post("/api/auth/login", {"username": username, "password": password}, format="json")

    def authed(self, username, password=PASSWORD):
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.login(username, password).json()['token']}")
        return client

    def account(self, client):
        return client.get("/api/account").json()["account"]


class RegisterTests(AccountTestCase):
    def test_register_without_email(self):
        client = APIClient()
        res = client.post("/api/auth/register", {"username": "Aya.K", "password": PASSWORD}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual(res.json()["account"],
                         {"registered": True, "username": "aya.k", "email": None, "pending_email": None})
        player = Player.objects.get(username="aya.k")
        self.assertNotIn(PASSWORD, player.password)
        self.assertTrue(player.password.startswith("md5$"))  # hacheur de test ; PBKDF2 hors tests
        self.assertEqual(len(mail.outbox), 0)

    def test_register_with_email_sends_a_confirmation_link(self):
        mail.outbox.clear()
        client = APIClient()
        register(client, username="aya", email="Aya@Exemple.ci")
        self.assertEqual(self.account(client), {"registered": True, "username": "aya", "email": None,
                                                "pending_email": "aya@exemple.ci"})
        self.assertEqual(mail.outbox[-1].to, ["aya@exemple.ci"])
        res = verify(link_token("verify"))
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(self.account(client)["email"], "aya@exemple.ci")
        self.assertIsNone(self.account(client)["pending_email"])
        # Seule l'empreinte du lien est stockée, et il ne sert qu'une fois.
        self.assertFalse(EmailVerification.objects.filter(token_hash=link_token("verify")).exists())
        self.assertEqual(verify(link_token("verify")).json()["error"]["code"], "invalid_verify_link")

    def test_validation_errors(self):
        cases = [
            ({"username": "a", "password": PASSWORD}, "invalid_username"),
            ({"username": "aya kone", "password": PASSWORD}, "invalid_username"),
            ({"username": "admin", "password": PASSWORD}, "username_taken"),
            ({"username": "aya", "email": "pas-un-email", "password": PASSWORD}, "invalid_email"),
            ({"username": "aya", "password": "court"}, "weak_password"),
            ({"username": "aya", "password": "12345678901"}, "weak_password"),
            ({"username": "aya", "password": "password123"}, "weak_password"),
            ({"username": "aya", "password": "x" * 200}, "invalid_password"),
        ]
        for body, code in cases:
            res = APIClient().post("/api/auth/register", body, format="json")
            self.assertEqual(res.json()["error"]["code"], code, body)
        self.assertFalse(Player.objects.filter(username="aya").exists())

    def test_username_is_unique_regardless_of_case(self):
        register(APIClient(), username="mariam")
        res = APIClient().post("/api/auth/register", {"username": "MARIAM", "password": PASSWORD}, format="json")
        self.assertEqual(res.json()["error"]["code"], "username_taken")

    def test_a_taken_email_is_never_revealed(self):
        owner = APIClient()
        register(owner, username="mariam", email="mariam@exemple.ci")
        verify(link_token("verify"))
        mail.outbox.clear()
        other = APIClient()
        res = other.post("/api/auth/register", {"username": "intrus", "email": "Mariam@Exemple.CI",
                                                "password": PASSWORD}, format="json")
        # Même réponse qu'avec une adresse libre…
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.json()["account"]["pending_email"], "mariam@exemple.ci")
        # …mais aucun lien de confirmation : la propriétaire est prévenue à la place.
        self.assertEqual(len(mail.outbox), 1)
        self.assertNotIn("#verify=", mail.outbox[0].body)
        self.assertIn("autre compte", mail.outbox[0].body)
        self.assertEqual(Player.objects.get(username="mariam").email, "mariam@exemple.ci")

    def test_former_guest_secures_the_account_and_keeps_the_game(self):
        _, token = create_player()
        guest = APIClient()
        guest.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
        self.create_character(guest, name="Mariam")
        self.assertFalse(self.account(guest)["registered"])
        res = guest.post("/api/auth/register", {"username": "mariam", "password": PASSWORD}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        self.assertNotIn("token", res.json())  # même session, même partie
        self.assertEqual(guest.get("/api/state").json()["state"]["character"]["name"], "Mariam")
        res = guest.post("/api/auth/register", {"username": "autre", "password": PASSWORD}, format="json")
        self.assertEqual(res.status_code, 409)


class LoginTests(AccountTestCase):
    def setUp(self):
        super().setUp()
        register(APIClient(), username="kouame", email="kouame@exemple.ci")
        verify(link_token("verify"))

    def test_login_with_username_opens_a_new_session(self):
        for identifier in ("kouame", "KOUAME", " kouame "):
            self.assertEqual(self.login(identifier).status_code, 200, identifier)
        self.assertEqual(AuthToken.objects.filter(player__username="kouame").count(), 4)

    def test_email_is_not_a_login_identifier(self):
        self.assertEqual(self.login("kouame@exemple.ci").json()["error"]["code"], "invalid_credentials")

    def test_same_message_for_unknown_account_and_wrong_password(self):
        self.assertEqual(self.login("personne").json()["error"], self.login("kouame", "mauvais-mdp").json()["error"])

    def test_account_locks_after_repeated_failures_and_warns_by_email(self):
        mail.outbox.clear()
        for _ in range(accounts.MAX_FAILED_LOGINS):
            self.login("kouame", "mauvais-mdp")
        self.assertEqual(self.login("kouame").json()["error"]["code"], "account_locked")
        self.assertIn("bloquée", mail.outbox[-1].subject)
        self.advance(minutes=16)
        self.assertEqual(self.login("kouame").status_code, 200)

    def test_ip_rate_limit(self):
        cache.clear()
        statuses = [self.login("kouame", "mauvais-mdp").status_code for _ in range(12)]
        self.assertIn(429, statuses)

    def test_logout_closes_only_this_session_unless_everywhere(self):
        a, b = self.authed("kouame"), self.authed("kouame")
        a.post("/api/auth/logout")
        self.assertEqual(a.get("/api/account").status_code, 401)
        self.assertEqual(b.get("/api/account").status_code, 200)
        b.post("/api/auth/logout", {"everywhere": True}, format="json")
        self.assertFalse(AuthToken.objects.filter(player__username="kouame").exists())


class SessionExpiryTests(AccountTestCase):
    def setUp(self):
        super().setUp()
        register(APIClient(), username="kouame")

    def test_session_expires_after_inactivity(self):
        client = self.authed("kouame")
        self.advance(days=29)
        self.assertEqual(client.get("/api/account").status_code, 200)  # l'utilisation prolonge la session
        self.advance(days=29)
        self.assertEqual(client.get("/api/account").status_code, 200)
        self.advance(days=31)
        self.assertEqual(client.get("/api/account").status_code, 401)

    def test_session_has_a_maximum_age_even_when_used(self):
        client = self.authed("kouame")
        for _ in range(9):
            self.advance(days=20)
            self.assertEqual(client.get("/api/account").status_code, 200)
        self.advance(days=1)  # 181 jours après la connexion
        self.assertEqual(client.get("/api/account").status_code, 401)

    def test_purge_command_removes_expired_sessions_and_old_links(self):
        self.authed("kouame")
        APIClient().post("/api/auth/password/forgot", {"login": "kouame"}, format="json")
        self.advance(days=40)
        out = StringIO()
        call_command("purge_comptes", stdout=out)
        self.assertIn("session(s) expirée(s)", out.getvalue())
        self.assertFalse(AuthToken.objects.filter(player__username="kouame").exists())
        self.assertFalse(PasswordReset.objects.exists())


class EmailTests(AccountTestCase):
    def setUp(self):
        super().setUp()
        self.me = APIClient()
        register(self.me, username="kouame")
        mail.outbox.clear()

    def set_email(self, email, password=PASSWORD, client=None):
        return (client or self.me).post("/api/auth/email", {"email": email, "password": password}, format="json")

    def test_adding_an_email_requires_the_password(self):
        self.assertEqual(self.set_email("k@exemple.ci", "faux").json()["error"]["code"], "wrong_password")
        self.assertEqual(self.set_email("k@exemple.ci").status_code, 200)
        self.assertEqual(verify(link_token("verify")).status_code, 200)
        self.assertEqual(self.account(self.me)["email"], "k@exemple.ci")

    def test_changing_the_email_keeps_the_old_one_until_confirmed_and_warns_it(self):
        self.set_email("ancien@exemple.ci")
        verify(link_token("verify"))
        mail.outbox.clear()
        self.set_email("nouveau@exemple.ci")
        recipients = sorted(m.to[0] for m in mail.outbox)
        self.assertEqual(recipients, ["ancien@exemple.ci", "nouveau@exemple.ci"])
        warning = next(m for m in mail.outbox if m.to == ["ancien@exemple.ci"])
        self.assertIn("n******@exemple.ci", warning.body)  # adresse masquée
        self.assertEqual(self.account(self.me)["email"], "ancien@exemple.ci")
        token = link_token("verify", next(m for m in mail.outbox if m.to == ["nouveau@exemple.ci"]))
        self.assertEqual(verify(token).status_code, 200)
        self.assertEqual(self.account(self.me)["email"], "nouveau@exemple.ci")
        self.assertEqual(mail.outbox[-1].to, ["ancien@exemple.ci"])  # remplacement signalé à l'ancienne adresse

    def test_a_newer_request_invalidates_the_previous_link(self):
        self.set_email("un@exemple.ci")
        first = link_token("verify")
        self.set_email("deux@exemple.ci")
        self.assertEqual(verify(first).json()["error"]["code"], "invalid_verify_link")

    def test_link_expires(self):
        self.set_email("k@exemple.ci")
        self.advance(seconds=accounts.VERIFY_TTL.total_seconds() + 1)
        self.assertEqual(verify(link_token("verify")).json()["error"]["code"], "invalid_verify_link")

    def test_email_confirmed_elsewhere_in_the_meantime(self):
        self.set_email("convoitee@exemple.ci")
        mine = link_token("verify")
        other = APIClient()
        register(other, username="rival", email="convoitee@exemple.ci")
        verify(link_token("verify"))
        self.assertEqual(verify(mine).json()["error"]["code"], "email_taken")

    def test_removing_the_email(self):
        self.set_email("k@exemple.ci")
        verify(link_token("verify"))
        self.assertEqual(self.set_email("").status_code, 200)
        self.assertEqual(self.account(self.me), {"registered": True, "username": "kouame", "email": None,
                                                 "pending_email": None})
        self.assertEqual(mail.outbox[-1].to, ["k@exemple.ci"])

    def test_resend_is_limited(self):
        self.set_email("k@exemple.ci")
        for _ in range(accounts.MAX_VERIFICATIONS_PER_HOUR - 1):
            res = self.me.post("/api/auth/email/resend")
            self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(self.me.post("/api/auth/email/resend").json()["error"]["code"], "too_many_emails")
        self.advance(hours=1, seconds=1)
        self.assertEqual(self.me.post("/api/auth/email/resend").status_code, 200)


class PasswordTests(AccountTestCase):
    def setUp(self):
        super().setUp()
        self.me = APIClient()
        register(self.me, username="kouame", email="kouame@exemple.ci")
        verify(link_token("verify"))
        self.other_device = self.authed("kouame")
        mail.outbox.clear()

    def forgot(self, login="kouame"):
        res = APIClient().post("/api/auth/password/forgot", {"login": login}, format="json")
        self.assertEqual(res.status_code, 200)
        return res.json()

    def test_change_password_requires_the_current_one_and_closes_other_sessions(self):
        res = self.me.post("/api/auth/password/change", {"current_password": "faux", "new_password": NEW_PASSWORD},
                           format="json")
        self.assertEqual(res.json()["error"]["code"], "wrong_password")
        res = self.me.post("/api/auth/password/change", {"current_password": PASSWORD, "new_password": NEW_PASSWORD},
                           format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(self.me.get("/api/account").status_code, 200)
        self.assertEqual(self.other_device.get("/api/account").status_code, 401)
        self.assertEqual(len(mail.outbox), 1)  # alerte de sécurité
        self.assertEqual(self.login("kouame", NEW_PASSWORD).status_code, 200)

    def test_forgot_password_by_username_or_email_answers_the_same_for_everyone(self):
        answers = {str(self.forgot(x)) for x in ("inconnu", "inconnu@exemple.ci", "kouame", "KOUAME@exemple.ci")}
        self.assertEqual(len(answers), 1)
        self.assertEqual([m.to for m in mail.outbox], [["kouame@exemple.ci"], ["kouame@exemple.ci"]])
        self.assertFalse(PasswordReset.objects.filter(token_hash=link_token("reset")).exists())

    def test_no_reset_without_a_confirmed_email(self):
        register(APIClient(), username="sansmail", email="sansmail@exemple.ci")  # adresse jamais confirmée
        register(APIClient(), username="vraimentsans")
        mail.outbox.clear()
        for login in ("sansmail", "sansmail@exemple.ci", "vraimentsans"):
            self.forgot(login)
        self.assertEqual(len(mail.outbox), 0)

    def test_reset_sets_a_new_password_once_and_closes_every_session(self):
        self.forgot()
        token = link_token("reset")
        res = APIClient().post("/api/auth/password/reset", {"token": token, "password": NEW_PASSWORD}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertIn("token", res.json())
        self.assertEqual(self.me.get("/api/account").status_code, 401)
        self.assertEqual(self.other_device.get("/api/account").status_code, 401)
        res = APIClient().post("/api/auth/password/reset", {"token": token, "password": "Encore-1-Autre"}, format="json")
        self.assertEqual(res.json()["error"]["code"], "invalid_reset_link")
        self.assertEqual(self.login("kouame", NEW_PASSWORD).status_code, 200)

    def test_reset_link_expires(self):
        self.forgot()
        self.advance(seconds=accounts.RESET_TTL.total_seconds() + 1)
        res = APIClient().post("/api/auth/password/reset", {"token": link_token("reset"), "password": NEW_PASSWORD},
                               format="json")
        self.assertEqual(res.json()["error"]["code"], "invalid_reset_link")

    def test_weak_password_keeps_the_link_usable(self):
        self.forgot()
        token = link_token("reset")
        res = APIClient().post("/api/auth/password/reset", {"token": token, "password": "123"}, format="json")
        self.assertEqual(res.json()["error"]["code"], "weak_password")
        res = APIClient().post("/api/auth/password/reset", {"token": token, "password": NEW_PASSWORD}, format="json")
        self.assertEqual(res.status_code, 200)

    def test_reset_unlocks_a_locked_account(self):
        Player.objects.filter(username="kouame").update(locked_until=self.now + timedelta(minutes=10))
        self.forgot()
        APIClient().post("/api/auth/password/reset", {"token": link_token("reset"), "password": NEW_PASSWORD},
                         format="json")
        self.assertEqual(self.login("kouame", NEW_PASSWORD).status_code, 200)

    def test_reset_requests_are_limited_per_hour(self):
        for _ in range(accounts.MAX_RESETS_PER_HOUR + 2):
            self.forgot()
        self.assertEqual(len(mail.outbox), accounts.MAX_RESETS_PER_HOUR)


class ResendBackendTests(GameTestCase):
    @override_settings(RESEND_API_KEY="re_test")
    def test_messages_are_sent_through_the_resend_api(self):
        from django.core.mail import EmailMultiAlternatives
        backend = ResendEmailBackend()
        message = EmailMultiAlternatives("Sujet", "Texte", "BabiVerse <no-reply@exemple.ci>", ["a@exemple.ci"])
        message.attach_alternative("<p>Texte</p>", "text/html")
        with mock.patch("resend.Emails.send", return_value={"id": "49a3999c"}) as send:
            self.assertEqual(backend.send_messages([message]), 1)
        send.assert_called_once_with({"from": "BabiVerse <no-reply@exemple.ci>", "to": ["a@exemple.ci"],
                                      "subject": "Sujet", "text": "Texte", "html": "<p>Texte</p>"})
        import resend
        self.assertEqual(resend.api_key, "re_test")

    @override_settings(RESEND_API_KEY="re_test")
    def test_resend_failure_is_raised_unless_silent(self):
        from django.core.mail import EmailMessage
        from resend.exceptions import ResendError
        error = ResendError(code=500, error_type="application_error", message="panne", suggested_action="")
        message = EmailMessage("Sujet", "Texte", "x@exemple.ci", ["a@exemple.ci"])
        with mock.patch("resend.Emails.send", side_effect=error):
            with self.assertRaises(ResendError):
                ResendEmailBackend().send_messages([message])
            self.assertEqual(ResendEmailBackend(fail_silently=True).send_messages([message]), 0)

    def test_session_helpers(self):
        self.assertEqual(auth.SESSION_IDLE_TTL, timedelta(days=30))
        self.assertEqual(auth.SESSION_MAX_AGE, timedelta(days=180))
