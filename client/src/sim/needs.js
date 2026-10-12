// Prédiction locale des besoins entre deux réponses du serveur (affichage uniquement).
// Le serveur reste l'autorité : chaque réponse remplace la valeur prédite.

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

export function predictNeeds(base, elapsedSeconds, cfg) {
  const minutes = Math.max(0, Math.min(elapsedSeconds, cfg.max_active_gap_seconds)) / 60;
  return {
    hunger: clamp(base.hunger + minutes * cfg.hunger_per_minute, cfg.min, cfg.max),
    energy: clamp(base.energy - minutes * cfg.energy_per_minute, cfg.min, cfg.max),
  };
}

/** Phase de la journée virtuelle (1 jour virtuel = 24 h réelles, heure d'Abidjan = UTC). */
export function dayPhase(date) {
  const h = date.getUTCHours() + date.getUTCMinutes() / 60;
  if (h >= 19.5 || h < 5.5) return { name: 'nuit', darkness: 0.45 };
  if (h >= 18) return { name: 'soir', darkness: 0.25 };
  if (h < 7) return { name: 'aube', darkness: 0.2 };
  return { name: 'jour', darkness: 0 };
}
