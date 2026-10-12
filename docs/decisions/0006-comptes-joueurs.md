# ADR 0006 — Comptes joueurs (e-mail, nom d'utilisateur, mot de passe)

Statut : accepté, complété et en partie modifié par l'ADR 0007 (connexion par nom d'utilisateur seulement, e-mail facultatif et confirmé, Resend, expiration des sessions).

## Contexte

Jusqu'ici, chaque appareil recevait un jeton invité (`POST /api/auth/guest`). Ce jeton faisait aussi office de « code de récupération » : il fallait le recopier pour changer d'appareil, et le perdre (navigateur vidé) faisait perdre la partie. Un même jeton était lié à un seul `Player`, sans révocation possible.

## Décision

1. **Compte = `Player`**, enrichi de `username` (3 à 20 caractères `[a-z0-9_.]`, stocké en minuscules, unique), `email` (unique, en minuscules) et `password` (empreinte Django : PBKDF2 salé, validée par `AUTH_PASSWORD_VALIDATORS` : 8 caractères minimum, pas trop proche des identifiants, pas courant, pas uniquement des chiffres). Le **pseudonyme** affiché en jeu reste le nom du personnage (`Character.name`), choisi juste après l'inscription.
2. **Sessions multiples** : modèle `AuthToken` (empreinte SHA-256 d'un jeton de 192 bits, une ligne par appareil). Connexion = nouvelle session ; déconnexion = suppression de la session (ou de toutes).
3. **Connexion** par nom d'utilisateur **ou** e-mail. Message d'échec identique que le compte existe ou non, temps de calcul comparable (hachage factice). Verrouillage du compte 15 min après 5 échecs ; limite de 10 requêtes/min par IP sur les routes sensibles (`AuthRateThrottle`, scope `auth`).
4. **Récupération par e-mail** : `PasswordReset` (jeton de 256 bits, seule l'empreinte est stockée, usage unique, 30 min, 3 demandes/heure/compte). La demande répond toujours la même chose (on ne révèle pas quelles adresses sont inscrites). Le lien est de la forme `PUBLIC_URL/#reset=<jeton>` : le fragment n'est envoyé ni au serveur web ni dans `Referer`, et le client le retire de la barre d'adresse. Réinitialiser ferme **toutes** les sessions, lève le verrouillage et prévient par e-mail.
5. **Changement de mot de passe** (mot de passe actuel exigé) : ferme les sessions des autres appareils et prévient par e-mail.
6. **Migration des invités** : la migration 0006 convertit chaque ancien jeton en première session. Au démarrage, un compte sans identifiants doit les choisir (« Sécurise ton compte ») et garde sa partie. La route `auth/guest` et le code de récupération disparaissent.

## Conséquences

- Il faut un serveur SMTP en production (`EMAIL_*`, `DEFAULT_FROM_EMAIL`, `PUBLIC_URL`). En local (`DJANGO_DEBUG=1`), les e-mails s'affichent dans la console du backend.
- L'inscription indique si un nom d'utilisateur ou un e-mail est déjà pris : c'est nécessaire au formulaire, mais cela permet de tester l'existence d'une adresse (atténué par la limite par IP).
- L'adresse e-mail n'est pas encore vérifiée : une faute de frappe rend la récupération impossible. Prochaine étape : e-mail de confirmation, et changement d'e-mail depuis les réglages.
- Les sessions n'expirent pas d'elles-mêmes (seulement par déconnexion, changement ou réinitialisation du mot de passe).
