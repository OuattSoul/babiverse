from django.contrib import admin

from .models import BugReport, ChatMessage, Friendship, SocialRequest, Business, Character, Home, JobShift, LedgerEntry, MissionState, Player

admin.site.register(Character, list_display=("name", "profile", "balance", "hunger", "energy", "zone", "updated_at"))
admin.site.register(LedgerEntry, list_display=("character", "kind", "amount", "balance_after", "created_at"))
admin.site.register(MissionState, list_display=("character", "mission_id", "status", "progress"))
admin.site.register(JobShift, list_display=("character", "job_id", "status", "started_at", "wage_paid"))
admin.site.register(Business, list_display=("character", "type_id", "stock", "units_sold", "revenue"))
admin.site.register(Home, list_display=("slot", "player", "x", "y", "template", "created_at"))
admin.site.register(SocialRequest, list_display=("created_at", "sender", "recipient", "kind", "status", "read_at"))
admin.site.register(Friendship, list_display=("low", "high", "created_at"))
admin.site.register(ChatMessage, list_display=("created_at", "sender", "recipient", "text"))
admin.site.register(BugReport, list_display=("created_at", "player", "zone", "message"))


@admin.register(Player)
class PlayerAdmin(admin.ModelAdmin):
    # Le mot de passe (empreinte) n'est jamais affiché ni modifiable ici.
    list_display = ("pk", "username", "email", "pending_email", "created_at", "last_seen_at", "locked_until")
    search_fields = ("username", "email", "pending_email")
    fields = ("username", "email", "email_verified_at", "pending_email", "failed_logins", "locked_until",
              "password_changed_at", "created_at", "last_seen_at")
    readonly_fields = ("email_verified_at", "password_changed_at", "created_at", "last_seen_at")
