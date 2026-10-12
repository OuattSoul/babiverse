# ADR 0007 — E-mail de récupération confirmé, envoi par Resend, expiration des sessions

Statut : accepté. Complète et modifie l'ADR 0006.

## Contexte

L'ADR 0006 laissait quatre limites : adresse e-mail jamais vérifiée, inscription qui révélait qu'une adresse était déjà inscrite, sessions sans expiration, envoi d'e-mails jamais branché sur un vrai service. Par ailleurs, les joueurs se connectent avec leur **nom d'utilisateur** (sans espace) et leur mot de passe ; l'e-mail est **facultatif** mais sert à récupérer le compte en cas de perte ou de piratage.

## Décision

1. **Identifiants de connexion** : nom d'utilisateur + mot de passe uniquement. L'e-mail n'est plus accepté comme identifiant de connexion (`auth/login` attend `username`). Le nom d'utilisateur est corrigé à la saisie (minuscules, espaces retirés).
2. **E-mail facultatif et confirmé** :
   - `Player.email` ne contient qu'une adresse **confirmée** (unique) ; une adresse saisie attend dans `pending_email` jusqu'au clic sur le lien `PUBLIC_URL/#verify=<jeton>` (modèle `EmailVerification` : empreinte seule, 24 h, usage unique, 3 envois/heure, une nouvelle demande annule l'ancienne).
   - Ajouter, changer ou retirer l'adresse (`auth/email`) exige le mot de passe. Lors d'un changement, l'ancienne adresse reste active jusqu'à confirmation de la nouvelle, et elle est prévenue (demande, puis remplacement ; adresse nouvelle masquée).
   - Seule une adresse confirmée reçoit un lien « mot de passe oublié » ; la demande accepte le nom d'utilisateur ou l'adresse.
   - Le jeu rappelle à chaque lancement d'ajouter/confirmer une adresse ; l'inscription sans e-mail demande une confirmation explicite.
   - La migration 0007 met les adresses existantes (jamais vérifiées) « à confirmer ».
3. **Aucune révélation d'adresse** : saisir une adresse déjà confirmée sur un autre compte donne exactement la même réponse ; aucun lien n'est créé et c'est la propriétaire de l'adresse qui est prévenue. Les e-mails partent dans un fil séparé (`game/mail.send_async`) pour que le temps de réponse ne trahisse rien. Seule l'unicité du **nom d'utilisateur** reste visible : c'est l'identifiant de connexion, il doit pouvoir être refusé ; la limite de 10 requêtes/min par IP freine l'énumération.
4. **Envoi par Resend** (`resend` Python, https://resend.com/docs/send-with-python) via un backend Django (`game.mail.ResendEmailBackend`) : `send_mail` reste l'API utilisée partout, les tests gardent la boîte mémoire de Django. Choix du backend : `EMAIL_BACKEND` explicite, sinon Resend si `RESEND_API_KEY`, sinon console en DEBUG ; en production sans clé, le serveur refuse de démarrer (jamais de liens de récupération dans les journaux).
5. **Expiration des sessions** : une session expire après 30 jours sans utilisation et au plus 180 jours après la connexion. Les sessions expirées sont supprimées à l'usage, à la connexion, et par `python manage.py purge_comptes` (à lancer chaque jour), qui supprime aussi les liens périmés depuis plus de 7 jours. Une alerte e-mail part aussi quand le compte est bloqué après des échecs de connexion.

## Conséquences

- Il faut un domaine vérifié dans Resend pour `DEFAULT_FROM_EMAIL` (`onboarding@resend.dev` ne livre qu'à l'adresse du compte Resend) et une tâche planifiée pour `purge_comptes`.
- Un joueur sans adresse confirmée qui oublie son mot de passe perd son compte : c'est accepté, et rappelé clairement dans le jeu.
- Les fils d'envoi sont de simples threads : un redémarrage du serveur au mauvais moment peut perdre un e-mail (le joueur peut le redemander). Une file de tâches sera à prévoir si le volume grandit.
