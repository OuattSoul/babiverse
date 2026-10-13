// Mathématiques de la caméra orbitale (module pur, testé).
// Repère : x vers l'est, z vers le sud (= y de la grille), y vers le haut. 1 unité = 1 case.

export const LIMITS = {
  pitchMin: 0.38, // ~22° au-dessus de l'horizon (vue proche, derrière le personnage)
  pitchMax: 1.4, // presque vue de dessus
  distMin: 5,
  distMax: 30,
};

// Caméra de départ proche, derrière le joueur (vue « à la troisième personne ») : les personnages, grands,
// occupent l'écran ; on dézoome jusqu'à la vue d'ensemble.
export const START_DIST = { outdoor: 7, indoor: 6.5 };
// Hauteur visée au-dessus du sol : la poitrine des personnages plutôt que leurs pieds.
export const TARGET_Y = 0.9;

/** Distance correspondant à un pourcentage de zoom dans la plage { min, max }. */
export const distForZoom = (range, zoom) => range.max - zoom * (range.max - range.min);

// Plage de zoom par type de zone : la ville se dézoome jusqu'à une vue d'ensemble de plusieurs îlots.
const OUTDOOR = { min: 5, max: 62, overview: 50 };
const INDOOR = { min: 5, max: 18 };
export const ZOOM = {
  outdoor: { ...OUTDOOR, default: START_DIST.outdoor },
  indoor: { ...INDOOR, default: START_DIST.indoor },
};

/**
 * Plage de zoom de la ville adaptée à sa taille : la vue d'ensemble (et le dézoom maximal) grandit
 * avec la carte, qui n'a pas de taille fixe. Jamais en dessous des valeurs de base (carte 56×40).
 */
export function outdoorZoomFor(w, h) {
  const overview = Math.max(OUTDOOR.overview, Math.round(Math.max(w / 56, h / 40) * OUTDOOR.overview));
  return { ...ZOOM.outdoor, overview, max: Math.max(OUTDOOR.max, overview + (OUTDOOR.max - OUTDOOR.overview)) };
}

/** Avancement du zoom entre le plus proche (0) et le plus éloigné (1). */
export const zoomProgress = (dist, range) => clamp((dist - range.min) / (range.max - range.min), 0, 1);

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** Position de la caméra autour de la cible. yaw = 0 : la caméra est au sud et regarde le nord. */
export function orbitPosition(target, yaw, pitch, dist) {
  const flat = Math.cos(pitch) * dist;
  return {
    x: target.x + Math.sin(yaw) * flat,
    y: target.y + Math.sin(pitch) * dist,
    z: target.z + Math.cos(yaw) * flat,
  };
}

/** Axes au sol de l'écran : « droite » et « haut de l'écran » pour un angle donné. */
export function screenAxes(yaw) {
  return {
    right: { x: Math.cos(yaw), z: -Math.sin(yaw) },
    up: { x: -Math.sin(yaw), z: -Math.cos(yaw) },
  };
}

/** Convertit une entrée écran (x droite, y bas) en direction au sol dans le repère du monde. */
export function inputToWorld(ix, iy, yaw) {
  const { right, up } = screenAxes(yaw);
  return { x: right.x * ix - up.x * iy, z: right.z * ix - up.z * iy };
}

/** Déplacement de la cible pour un glissement de (dx, dy) pixels écran (« la carte suit le doigt »). */
export function panDelta(dx, dy, yaw, dist, viewportHeight) {
  const k = (dist * 1.1) / Math.max(1, viewportHeight);
  const w = inputToWorld(-dx * k, -dy * k, yaw);
  return w;
}

/** Limites de la cible de la caméra : la carte, avec une petite marge pour voir ses bords. */
export function mapBounds(w, h, margin = 2) {
  return { minX: -margin, maxX: w + margin, minZ: -margin, maxZ: h + margin };
}

/** Ramène un point (x, z) dans les limites, en place. */
export function clampToBounds(p, b) {
  p.x = clamp(p.x, b.minX, b.maxX);
  p.z = clamp(p.z, b.minZ, b.maxZ);
  return p;
}

/** Angle le plus court entre deux angles (pour lisser la rotation). */
export function angleDelta(from, to) {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
