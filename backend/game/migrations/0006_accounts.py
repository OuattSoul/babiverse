"""Comptes joueurs : identifiants, sessions multiples et réinitialisation du mot de passe.

Le jeton invité de chaque joueur existant devient sa première session (`AuthToken`) : les
parties en cours restent accessibles, le joueur sera invité à sécuriser son compte.
"""
import django.db.models.deletion
from django.db import migrations, models
from django.utils import timezone


def tokens_to_sessions(apps, schema_editor):
    Player = apps.get_model("game", "Player")
    AuthToken = apps.get_model("game", "AuthToken")
    now = timezone.now()
    AuthToken.objects.bulk_create(
        AuthToken(player_id=pk, token_hash=token_hash, created_at=now, last_used_at=last_seen)
        for pk, token_hash, last_seen in Player.objects.values_list("pk", "token_hash", "last_seen_at"))


class Migration(migrations.Migration):

    dependencies = [
        ('game', '0005_bug_reports'),
    ]

    operations = [
        migrations.AddField(
            model_name='player',
            name='email',
            field=models.EmailField(blank=True, max_length=254, null=True, unique=True),
        ),
        migrations.AddField(
            model_name='player',
            name='failed_logins',
            field=models.PositiveSmallIntegerField(default=0),
        ),
        migrations.AddField(
            model_name='player',
            name='locked_until',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='player',
            name='password',
            field=models.CharField(blank=True, default='', max_length=128),
        ),
        migrations.AddField(
            model_name='player',
            name='password_changed_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='player',
            name='username',
            field=models.CharField(blank=True, max_length=20, null=True, unique=True),
        ),
        migrations.CreateModel(
            name='AuthToken',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('token_hash', models.CharField(max_length=64, unique=True)),
                ('created_at', models.DateTimeField()),
                ('last_used_at', models.DateTimeField(blank=True, null=True)),
                ('player', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='tokens', to='game.player')),
            ],
        ),
        migrations.CreateModel(
            name='PasswordReset',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('token_hash', models.CharField(max_length=64, unique=True)),
                ('created_at', models.DateTimeField()),
                ('expires_at', models.DateTimeField()),
                ('used_at', models.DateTimeField(blank=True, null=True)),
                ('player', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='password_resets', to='game.player')),
            ],
        ),
        migrations.RunPython(tokens_to_sessions, migrations.RunPython.noop),
        migrations.RemoveField(
            model_name='player',
            name='token_hash',
        ),
    ]
