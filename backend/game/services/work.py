"""Emploi : services de livraison rémunérés pour M. Diabaté."""
import random
from datetime import timedelta

from game import rules
from game.clock import virtual_day
from game.models import JobShift

from . import missions
from .core import change_needs, credit, require_zone
from .errors import GameError


def active_shift(char):
    return char.shifts.filter(status=JobShift.ACTIVE).first()


def expire_shifts(char, now, notices):
    """Un service qui exige la présence du joueur ne se termine jamais tout seul hors ligne."""
    for shift in char.shifts.filter(status=JobShift.ACTIVE):
        job = rules.JOBS[shift.job_id]
        if now - shift.started_at > timedelta(seconds=job["max_duration_seconds"]):
            shift.status, shift.ended_at = JobShift.EXPIRED, now
            shift.save()
            notices.append({"type": "shift_expired", "message": "Ton service de livraison a expiré, sans paiement."})


def shifts_today(char, job_id, now):
    return char.shifts.filter(job_id=job_id, day=virtual_day(now), status=JobShift.COMPLETED).count()


def wage_for(char, job):
    return int(round(job["base_wage"] * rules.PROFILES[char.profile]["wage_multiplier"]))


def start(char, data, now):
    job_id = data.get("job")
    job = rules.JOBS.get(job_id)
    if job is None:
        raise GameError("unknown_job", "Ce travail n'existe pas.", 400)
    require_zone(char, job["zone"], "Va voir ton employeur pour commencer.")
    if active_shift(char):
        raise GameError("shift_in_progress", "Tu as déjà un service en cours.")
    if shifts_today(char, job_id, now) >= job["max_shifts_per_day"]:
        raise GameError("daily_limit", "Tu as assez travaillé aujourd'hui. Reviens demain.")
    needs = rules.NEEDS
    if char.energy < needs["work_min_energy"]:
        raise GameError("too_tired", "Tu es trop fatigué pour travailler. Va te reposer.")
    if char.hunger > needs["work_max_hunger"]:
        raise GameError("too_hungry", "Tu as trop faim pour travailler. Mange d'abord.")
    targets = random.sample(job["targets"], job["deliveries"])
    shift = JobShift.objects.create(character=char, job_id=job_id, status=JobShift.ACTIVE,
                                    targets=targets, started_at=now, day=virtual_day(now))
    return {"shift_id": shift.pk, "targets": targets, "wage": wage_for(char, job)}


def _get_active(char, shift_id):
    # Filtrer par personnage : un joueur ne peut jamais toucher au service d'un autre.
    shift = char.shifts.filter(pk=shift_id).first() if isinstance(shift_id, int) else None
    if shift is None:
        raise GameError("unknown_shift", "Service introuvable.", 404)
    if shift.status != JobShift.ACTIVE:
        raise GameError("shift_closed", "Ce service est déjà terminé.")
    return shift


def deliver(char, data, now):
    shift = _get_active(char, data.get("shift_id"))
    job = rules.JOBS[shift.job_id]
    target = data.get("target")
    if target not in shift.targets:
        raise GameError("wrong_target", "Ce colis n'est pas pour ici.")
    if target in shift.delivered:
        return {"delivered": shift.delivered}
    if shift.last_delivery_at and (now - shift.last_delivery_at).total_seconds() < job["min_seconds_between_deliveries"]:
        raise GameError("too_fast", "Doucement ! Une livraison à la fois.")
    shift.delivered = shift.delivered + [target]
    shift.last_delivery_at = now
    shift.save()
    return {"delivered": shift.delivered}


def complete(char, data, now):
    shift = _get_active(char, data.get("shift_id"))
    job = rules.JOBS[shift.job_id]
    require_zone(char, job["zone"], "Retourne voir ton employeur pour être payé.")
    if set(shift.delivered) != set(shift.targets):
        raise GameError("deliveries_missing", f"Il reste {len(shift.targets) - len(shift.delivered)} colis à livrer.")
    if (now - shift.started_at).total_seconds() < job["min_duration_seconds"]:
        raise GameError("too_fast", "Service trop rapide pour être crédible.")
    wage = wage_for(char, job)
    shift.status, shift.ended_at, shift.wage_paid = JobShift.COMPLETED, now, wage
    shift.save()
    credit(char, wage, "job_wage", job["name"], now)
    change_needs(char, hunger=job["hunger_cost"], energy=-job["energy_cost"])
    missions.emit(char, "job_complete", {"job": shift.job_id}, now)
    return {"wage": wage}


def abandon(char, data, now):
    shift = _get_active(char, data.get("shift_id"))
    shift.status, shift.ended_at = JobShift.ABANDONED, now
    shift.save()
    return {}


def snapshot(char, now):
    job_id = "livraison"
    job = rules.JOBS[job_id]
    shift = active_shift(char)
    return {
        "shifts_today": shifts_today(char, job_id, now),
        "max_shifts_per_day": job["max_shifts_per_day"],
        "wage": wage_for(char, job),
        "completed_total": char.shifts.filter(status=JobShift.COMPLETED).count(),
        "active": None if shift is None else {
            "shift_id": shift.pk, "job": shift.job_id, "targets": shift.targets,
            "delivered": shift.delivered, "started_at": shift.started_at.isoformat(),
        },
    }
