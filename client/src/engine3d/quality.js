// Qualité d'affichage : anticrénelage, finesse de l'image, ombres du soleil, cadence.
// Le joueur peut choisir l'« économie de batterie » (⚙️ Réglages → Affichage) : image moins fine,
// sans ombres, 30 images par seconde. Module sans Three.js : testé avec Vitest.
import { bus } from '../state/store.js';

const KEY = 'babiverse.economie';
const SHADOW = { map: 2048, mobileMap: 1024, min: 12, max: 60, perDist: 0.8 };
// Ombres coupées d'office si l'image reste saccadée : au moins 12 des 15 dernières secondes sous 24 images
// par seconde. Une saccade passagère (zone qui entre dans le champ, préparation d'un habitant) ne suffit pas.
const SMOOTH = { fps: 24, seconds: 15, slow: 12 };

const storage = () => { try { return globalThis.localStorage || null; } catch { return null; } };

/**
 * Réglages du rendu pour un écran donné. L'anticrénelage n'est coupé que sur les téléphones à écran
 * très dense (≥ 2 pixels par point), où il coûte cher et se voit peu ; il ne change qu'au lancement.
 */
export function qualityFor({ dpr = 1, mobile = false, saver = false } = {}) {
  return {
    antialias: !mobile || dpr < 2,
    pixelRatio: saver ? 1 : Math.min(dpr, mobile ? 1.75 : 2),
    shadows: !saver,
    shadowMapSize: mobile ? SHADOW.mobileMap : SHADOW.map,
    maxFps: saver ? 30 : 0,
  };
}

export const quality = {
  get saver() { try { return storage()?.getItem(KEY) === '1'; } catch { return false; } },
  /** Change l'économie de batterie : mémorisée sur l'appareil, appliquée tout de suite par la scène. */
  setSaver(on) {
    try { on ? storage()?.setItem(KEY, '1') : storage()?.removeItem(KEY); } catch { /* navigation privée */ }
    bus.emit('quality', on);
  },
};

/** Les dernières mesures (images par seconde, une par seconde) montrent-elles un jeu durablement saccadé ? */
export function tooSlow(samples) {
  const last = samples.slice(-SMOOTH.seconds);
  return last.length === SMOOTH.seconds && last.filter((f) => f < SMOOTH.fps).length >= SMOOTH.slow;
}

/**
 * Demi-côté (en cases) de la zone couverte par les ombres autour du point visé par la caméra :
 * elle grandit avec le dézoom pour que les ombres ne s'arrêtent pas au milieu de l'écran.
 */
export const shadowExtent = (dist) => Math.min(SHADOW.max, Math.max(SHADOW.min, Math.round(dist * SHADOW.perDist)));

/** Arrondit une coordonnée à la taille d'un pixel de la carte des ombres : évite qu'elles scintillent en marchant. */
export const snapToTexel = (v, extent, mapSize = SHADOW.map) => {
  const texel = (2 * extent) / mapSize;
  return Math.round(v / texel) * texel;
};

const casts = (m) => !m.isMeshBasicMaterial && !m.isLineBasicMaterial && !(m.transparent && m.opacity < 1);

/**
 * Marque les maillages d'un objet pour les ombres : tout volume opaque projette et reçoit une ombre ;
 * le sol la reçoit seulement ; repères, étiquettes et objets translucides (non éclairés) sont ignorés.
 * Sans effet tant que les ombres sont coupées dans le moteur. Retourne l'objet.
 */
export function castShadows(root) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    if (!mats.some(casts)) return;
    const ground = o.name === 'ground' || o.name === 'outer';
    o.castShadow = !ground;
    o.receiveShadow = true;
  });
  return root;
}
