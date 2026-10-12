"""Adresse e-mail confirmée par lien.

Les adresses saisies avant cette migration n'ont jamais été vérifiées : elles passent « à confirmer »
(`pending_email`) et `email` ne garde désormais que des adresses confirmées.
"""
import django.db.models.deletion
from django.db import migrations, models


def emails_to_pending(apps, schema_editor):
    Player = apps.get_model("game", "Player")
    for player in Player.objects.exclude(email=None):
        player.pending_email, player.email = player.email, None
        player.save(update_fields=["pending_email", "email"])


def pending_to_emails(apps, schema_editor):
    Player = apps.get_model("game", "Player")
    for player in Player.objects.filter(email=None).exclude(pending_email=None):
        player.email, player.pending_email = player.pending_email, None
        player.save(update_fields=["pending_email", "email"])


class Migration(migrations.Migration):

    dependencies = [
        ('game', '0006_accounts'),
    ]

    operations = [
        migrations.AddField(
            model_name='player',
            name='email_verified_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='player',
            name='pending_email',
            field=models.EmailField(blank=True, max_length=254, null=True),
        ),
        migrations.CreateModel(
            name='EmailVerification',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('email', models.EmailField(max_length=254)),
                ('token_hash', models.CharField(max_length=64, unique=True)),
                ('created_at', models.DateTimeField()),
                ('expires_at', models.DateTimeField()),
                ('used_at', models.DateTimeField(blank=True, null=True)),
                ('player', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='email_verifications', to='game.player')),
            ],
        ),
        migrations.RunPython(emails_to_pending, pending_to_emails),
    ]
