from django.db import models
from django.db.models import Q


class Player(models.Model):
    """Compte d'un joueur : nom d'utilisateur + mot de passe (haché par Django), e-mail facultatif.

    On se connecte avec le nom d'utilisateur. L'e-mail ne sert qu'à récupérer le compte : `email` ne
    contient qu'une adresse **confirmée** (unique) ; une adresse saisie attend dans `pending_email`
    jusqu'au clic sur le lien de confirmation. Le pseudonyme affiché en jeu est `Character.name`.
    Les comptes créés avant les identifiants (anciens invités) ont `username` vide jusqu'à ce que le
    joueur sécurise son compte. Les sessions sont des jetons `AuthToken` (plusieurs appareils).
    """

    # Stockés en minuscules : l'unicité ne dépend pas de la casse saisie.
    username = models.CharField(max_length=20, unique=True, null=True, blank=True)
    email = models.EmailField(max_length=254, unique=True, null=True, blank=True)
    email_verified_at = models.DateTimeField(null=True, blank=True)
    pending_email = models.EmailField(max_length=254, null=True, blank=True)
    password = models.CharField(max_length=128, blank=True, default="")
    # Verrouillage temporaire après plusieurs mots de passe erronés (anti force brute).
    failed_logins = models.PositiveSmallIntegerField(default=0)
    locked_until = models.DateTimeField(null=True, blank=True)
    password_changed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    last_seen_at = models.DateTimeField(null=True, blank=True)

    # Interface attendue par DRF pour request.user.
    is_authenticated = True
    is_anonymous = False

    @property
    def registered(self):
        return bool(self.username and self.password)

    def __str__(self):
        return self.username or f"Player#{self.pk}"


class AuthToken(models.Model):
    """Session d'un appareil. Seule l'empreinte SHA-256 du jeton est stockée.

    Elle expire après une période d'inactivité ou une durée maximale (voir `game/auth.py`).
    """

    player = models.ForeignKey(Player, on_delete=models.CASCADE, related_name="tokens")
    token_hash = models.CharField(max_length=64, unique=True)
    created_at = models.DateTimeField()
    last_used_at = models.DateTimeField(null=True, blank=True)


class EmailVerification(models.Model):
    """Lien de confirmation d'une adresse e-mail : usage unique, durée limitée, empreinte seule."""

    player = models.ForeignKey(Player, on_delete=models.CASCADE, related_name="email_verifications")
    email = models.EmailField(max_length=254)
    token_hash = models.CharField(max_length=64, unique=True)
    created_at = models.DateTimeField()
    expires_at = models.DateTimeField()
    used_at = models.DateTimeField(null=True, blank=True)


class PasswordReset(models.Model):
    """Lien de réinitialisation envoyé par e-mail : usage unique, durée limitée, empreinte seule."""

    player = models.ForeignKey(Player, on_delete=models.CASCADE, related_name="password_resets")
    token_hash = models.CharField(max_length=64, unique=True)
    created_at = models.DateTimeField()
    expires_at = models.DateTimeField()
    used_at = models.DateTimeField(null=True, blank=True)


class Character(models.Model):
    PROFILES = [
        ("etudiant", "Étudiant"),
        ("salarie", "Salarié"),
        ("artisan", "Artisan"),
        ("independant", "Travailleur indépendant"),
        ("entrepreneur", "Entrepreneur débutant"),
    ]

    player = models.OneToOneField(Player, on_delete=models.CASCADE, related_name="character")
    name = models.CharField(max_length=24)
    profile = models.CharField(max_length=16, choices=PROFILES)
    appearance = models.JSONField(default=dict)

    balance = models.BigIntegerField(default=0)
    hunger = models.FloatField(default=0)
    energy = models.FloatField(default=100)
    needs_updated_at = models.DateTimeField()
    last_rest_at = models.DateTimeField(null=True, blank=True)

    zone = models.CharField(max_length=32)
    pos_x = models.FloatField(null=True, blank=True)
    pos_y = models.FloatField(null=True, blank=True)
    # Dernière position reçue par la boucle sociale (`POST /api/social/poll`, toutes les 2 s en jeu) :
    # un joueur n'est visible des autres que si elle est récente (voir services/social.py).
    seen_in_world_at = models.DateTimeField(null=True, blank=True)

    # Incrémenté à chaque mutation ; permet au client d'ignorer un état obsolète.
    version = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.CheckConstraint(condition=Q(balance__gte=0), name="character_balance_non_negative"),
        ]

    def __str__(self):
        return f"{self.name} ({self.profile})"


class InventoryItem(models.Model):
    character = models.ForeignKey(Character, on_delete=models.CASCADE, related_name="inventory")
    item_id = models.CharField(max_length=32)
    quantity = models.PositiveIntegerField(default=0)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["character", "item_id"], name="unique_inventory_item")]


class ShopStock(models.Model):
    """Stock d'un commerce PNJ, propre à chaque joueur (jeu solo), réinitialisé chaque jour virtuel."""

    character = models.ForeignKey(Character, on_delete=models.CASCADE, related_name="shop_stocks")
    shop_id = models.CharField(max_length=32)
    item_id = models.CharField(max_length=32)
    quantity = models.PositiveIntegerField()
    day = models.DateField()

    class Meta:
        constraints = [models.UniqueConstraint(fields=["character", "shop_id", "item_id"], name="unique_shop_stock")]


class LedgerEntry(models.Model):
    """Journal immuable de chaque mouvement de monnaie virtuelle."""

    KINDS = [
        ("start", "Capital de départ"),
        ("purchase", "Achat"),
        ("job_wage", "Salaire"),
        ("mission_reward", "Récompense de mission"),
        ("business_open", "Lancement d'entreprise"),
        ("business_sale", "Vente"),
        ("business_passive", "Ventes en ton absence"),
        ("plot_buy", "Achat de parcelle"),
        ("plot_build", "Construction"),
        ("ad_rental", "Publicité"),
    ]

    character = models.ForeignKey(Character, on_delete=models.CASCADE, related_name="ledger")
    kind = models.CharField(max_length=24, choices=KINDS)
    amount = models.BigIntegerField()
    balance_after = models.BigIntegerField()
    description = models.CharField(max_length=120)
    created_at = models.DateTimeField()

    class Meta:
        ordering = ["-id"]


class IdempotencyRecord(models.Model):
    """Résultat mémorisé d'une action critique : une requête rejouée n'a pas d'effet supplémentaire."""

    character = models.ForeignKey(Character, on_delete=models.CASCADE, related_name="idempotency_records")
    key = models.CharField(max_length=64)
    action = models.CharField(max_length=32)
    request_hash = models.CharField(max_length=64)
    status_code = models.PositiveSmallIntegerField()
    response = models.JSONField()
    created_at = models.DateTimeField()

    class Meta:
        constraints = [models.UniqueConstraint(fields=["character", "key"], name="unique_idempotency_key")]


class MissionState(models.Model):
    AVAILABLE, ACTIVE, COMPLETED, REWARDED = "available", "active", "completed", "rewarded"
    STATUSES = [(s, s) for s in (AVAILABLE, ACTIVE, COMPLETED, REWARDED)]

    character = models.ForeignKey(Character, on_delete=models.CASCADE, related_name="missions")
    mission_id = models.CharField(max_length=32)
    status = models.CharField(max_length=12, choices=STATUSES)
    progress = models.BigIntegerField(default=0)
    updated_at = models.DateTimeField()

    class Meta:
        constraints = [models.UniqueConstraint(fields=["character", "mission_id"], name="unique_mission_state")]


class JobShift(models.Model):
    ACTIVE, COMPLETED, EXPIRED, ABANDONED = "active", "completed", "expired", "abandoned"
    STATUSES = [(s, s) for s in (ACTIVE, COMPLETED, EXPIRED, ABANDONED)]

    character = models.ForeignKey(Character, on_delete=models.CASCADE, related_name="shifts")
    job_id = models.CharField(max_length=32)
    status = models.CharField(max_length=12, choices=STATUSES)
    targets = models.JSONField(default=list)
    delivered = models.JSONField(default=list)
    last_delivery_at = models.DateTimeField(null=True, blank=True)
    started_at = models.DateTimeField()
    ended_at = models.DateTimeField(null=True, blank=True)
    day = models.DateField()
    wage_paid = models.BigIntegerField(default=0)


class Business(models.Model):
    character = models.OneToOneField(Character, on_delete=models.CASCADE, related_name="business")
    type_id = models.CharField(max_length=32)
    stock = models.PositiveIntegerField(default=0)
    sale_price = models.PositiveIntegerField()
    opened_at = models.DateTimeField()
    last_settled_at = models.DateTimeField()
    passive_carry = models.FloatField(default=0)
    last_sale_at = models.DateTimeField(null=True, blank=True)
    units_sold = models.PositiveIntegerField(default=0)
    revenue = models.BigIntegerField(default=0)
    spent = models.BigIntegerField(default=0)


class PlotClaim(models.Model):
    """Parcelle de la ville attribuée à un joueur (unique : deux joueurs ne peuvent pas l'obtenir)."""

    plot_id = models.CharField(max_length=8, unique=True)
    owner = models.ForeignKey(Character, on_delete=models.CASCADE, related_name="plots")
    claimed_at = models.DateTimeField()
    # Bâtiment construit (vide tant que le terrain est nu). Position calculée par le serveur.
    template = models.CharField(max_length=24, blank=True, default="")
    x0 = models.IntegerField(null=True, blank=True)
    y0 = models.IntegerField(null=True, blank=True)
    facing = models.CharField(max_length=1, blank=True, default="")
    name = models.CharField(max_length=24, blank=True, default="")
    built_at = models.DateTimeField(null=True, blank=True)


class Home(models.Model):
    """Maison initiale d'un joueur et l'emplacement de 2×2 cases qu'elle occupe dans le lotissement.

    Emplacement et maison forment une seule ligne : l'un ne peut pas exister sans l'autre. Elle est
    créée une seule fois par joueur (à la création de son personnage) et n'est jamais déplacée.
    """

    player = models.OneToOneField(Player, on_delete=models.CASCADE, related_name="home")
    slot = models.PositiveIntegerField(unique=True)
    # Case nord-ouest de l'emplacement (coordonnées de la ville) ; la maison le remplit entièrement.
    x = models.IntegerField()
    y = models.IntegerField()
    template = models.CharField(max_length=24)
    facing = models.CharField(max_length=1)
    created_at = models.DateTimeField()

    class Meta:
        constraints = [models.UniqueConstraint(fields=["x", "y"], name="unique_home_position")]

    def __str__(self):
        return f"Maison #{self.slot} ({self.x}, {self.y})"


class BugReport(models.Model):
    """Signalement envoyé par un testeur depuis les réglages. Supprimé avec son compte."""

    player = models.ForeignKey(Player, on_delete=models.CASCADE, related_name="bug_reports")
    message = models.TextField(max_length=1000)
    zone = models.CharField(max_length=48, blank=True, default="")
    user_agent = models.CharField(max_length=200, blank=True, default="")
    created_at = models.DateTimeField()

    class Meta:
        ordering = ["-id"]

    def __str__(self):
        return f"Bug #{self.pk} ({self.created_at:%Y-%m-%d})"


class AdCampaign(models.Model):
    """Publicité d'un joueur sur un panneau de la ville (une ligne par panneau, réutilisée)."""

    slot = models.CharField(max_length=32, unique=True)
    owner = models.ForeignKey(Character, on_delete=models.CASCADE, related_name="ads")
    title = models.CharField(max_length=40)
    subtitle = models.CharField(max_length=60)
    bg = models.CharField(max_length=7)
    fg = models.CharField(max_length=7)
    starts_at = models.DateTimeField()
    ends_at = models.DateTimeField()


class SocialRequest(models.Model):
    """Demande envoyée à un autre joueur rencontré : discuter, appeler ou devenir amis.

    Elle reste dans les notifications du destinataire tant qu'elle n'est pas traitée ; s'il ne fait rien,
    elle est seulement marquée lue (`read_at`). Une demande d'appel sonne 30 s, puis devient « manquée »
    (la notification reste pour rappeler). Un appel accepté devient une communication, terminée par
    `ended_at`. L'expéditeur est prévenu de la réponse (`outcome_read_at` : réponse vue).
    """

    CHAT, CALL, FRIEND = "chat", "call", "friend"
    KINDS = [(CHAT, "Discussion"), (CALL, "Appel"), (FRIEND, "Ami")]
    PENDING, ACCEPTED, DECLINED, MISSED, CANCELLED = "pending", "accepted", "declined", "missed", "cancelled"
    STATUSES = [(s, s) for s in (PENDING, ACCEPTED, DECLINED, MISSED, CANCELLED)]

    sender = models.ForeignKey(Character, on_delete=models.CASCADE, related_name="sent_requests")
    recipient = models.ForeignKey(Character, on_delete=models.CASCADE, related_name="received_requests")
    kind = models.CharField(max_length=8, choices=KINDS)
    status = models.CharField(max_length=10, choices=STATUSES, default=PENDING)
    created_at = models.DateTimeField()
    answered_at = models.DateTimeField(null=True, blank=True)
    read_at = models.DateTimeField(null=True, blank=True)
    outcome_read_at = models.DateTimeField(null=True, blank=True)
    # Appel accepté : fin de la communication (raccroché, ou un des deux ne répond plus).
    ended_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-id"]
        indexes = [models.Index(fields=["recipient", "status"]), models.Index(fields=["sender", "status"])]


class CallSignal(models.Model):
    """Message de mise en relation WebRTC d'un appel (offre, réponse, candidats réseau), relayé par le serveur."""

    call = models.ForeignKey(SocialRequest, on_delete=models.CASCADE, related_name="signals")
    sender = models.ForeignKey(Character, on_delete=models.CASCADE, related_name="+")
    kind = models.CharField(max_length=8)
    payload = models.JSONField()
    created_at = models.DateTimeField()


class Friendship(models.Model):
    """Deux joueurs amis (une ligne par paire, `low` = plus petit identifiant de personnage)."""

    low = models.ForeignKey(Character, on_delete=models.CASCADE, related_name="+")
    high = models.ForeignKey(Character, on_delete=models.CASCADE, related_name="+")
    created_at = models.DateTimeField()

    class Meta:
        constraints = [models.UniqueConstraint(fields=["low", "high"], name="unique_friendship")]


class ChatMessage(models.Model):
    """Message d'une discussion entre deux joueurs (ouverte par une demande acceptée, ou entre amis)."""

    sender = models.ForeignKey(Character, on_delete=models.CASCADE, related_name="sent_messages")
    recipient = models.ForeignKey(Character, on_delete=models.CASCADE, related_name="received_messages")
    text = models.CharField(max_length=500)
    created_at = models.DateTimeField()
    read_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["id"]
