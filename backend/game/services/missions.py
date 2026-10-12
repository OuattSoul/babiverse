"""Missions pilotées par événements : disponible -> en cours -> terminée -> récompensée."""
from game import rules
from game.models import MissionState

from .core import credit
from .errors import GameError


def refresh_availability(char, now):
    """Crée les missions dont les prérequis viennent d'être remplis."""
    states = {m.mission_id: m for m in char.missions.all()}
    rewarded = {mid for mid, m in states.items() if m.status == MissionState.REWARDED}
    for mission in rules.MISSIONS:
        if mission["id"] in states:
            continue
        if all(req in rewarded for req in mission["requires"]):
            status = MissionState.ACTIVE if mission.get("auto_accept") else MissionState.AVAILABLE
            MissionState.objects.create(character=char, mission_id=mission["id"], status=status, updated_at=now)
    # Une mission d'épargne peut être déjà remplie au moment où elle devient active.
    emit(char, "balance", {}, now)


def _matches(mission, data):
    return all(data.get(key) == value for key, value in mission["filter"].items())


def emit(char, event, data, now):
    """Fait progresser les missions actives qui écoutent cet événement."""
    for state in char.missions.filter(status=MissionState.ACTIVE):
        mission = rules.MISSIONS_BY_ID.get(state.mission_id)
        if mission is None or mission["event"] != event or not _matches(mission, data):
            continue
        if event == "balance":
            state.progress = min(char.balance, mission["target"])
        else:
            state.progress = min(state.progress + data.get("count", 1), mission["target"])
        if state.progress >= mission["target"]:
            state.status = MissionState.COMPLETED
        state.updated_at = now
        state.save()


def accept(char, mission_id, now):
    state = char.missions.filter(mission_id=mission_id).first()
    if state is None:
        raise GameError("mission_locked", "Cette mission n'est pas encore disponible.", 404)
    if state.status != MissionState.AVAILABLE:
        return
    state.status = MissionState.ACTIVE
    state.updated_at = now
    state.save()
    emit(char, "balance", {}, now)


def claim(char, mission_id, now):
    state = char.missions.filter(mission_id=mission_id).first()
    if state is None:
        raise GameError("mission_locked", "Cette mission n'est pas disponible.", 404)
    if state.status == MissionState.REWARDED:
        raise GameError("already_rewarded", "Récompense déjà reçue.")
    if state.status != MissionState.COMPLETED:
        raise GameError("mission_not_completed", "Mission pas encore terminée.")
    mission = rules.MISSIONS_BY_ID[mission_id]
    state.status = MissionState.REWARDED
    state.updated_at = now
    state.save()
    credit(char, mission["reward"], "mission_reward", f"Mission : {mission['title']}", now)
    refresh_availability(char, now)
    return {"reward": mission["reward"]}


def snapshot(char):
    out = []
    for state in char.missions.all():
        mission = rules.MISSIONS_BY_ID.get(state.mission_id)
        if mission:
            out.append({"id": state.mission_id, "status": state.status, "progress": state.progress,
                        "target": mission["target"]})
    order = {m["id"]: i for i, m in enumerate(rules.MISSIONS)}
    return sorted(out, key=lambda m: order[m["id"]])
