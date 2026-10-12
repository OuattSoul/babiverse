// Classification des gestes du pointeur (module pur, testé).
// Un appui devient un « glissement » dès qu'il dépasse le seuil de son type de pointeur ; seul un
// appui bref, sans glissement, d'un seul doigt ou du bouton principal, compte comme un clic.

export const POINTER = {
  // Déplacement maximal (pixels écran) d'un clic. Plus large au doigt, moins précis qu'une souris.
  tapSlop: { mouse: 6, pen: 8, touch: 12 },
  // Au-delà, l'appui est un appui long : ni clic, ni sélection.
  tapMaxMs: 500,
};

export function exceedsSlop(pointerType, dx, dy, cfg = POINTER) {
  return Math.hypot(dx, dy) > (cfg.tapSlop[pointerType] ?? cfg.tapSlop.touch);
}

/** Appui relâché : clic / toucher bref ? */
export function isTap({ button = 0, dragged = false, multi = false, ms = 0 }, cfg = POINTER) {
  return button === 0 && !dragged && !multi && ms <= cfg.tapMaxMs;
}

/**
 * Molette : la molette de souris et le pincement du pavé tactile (ctrlKey) zooment ;
 * un défilement horizontal du pavé tactile (deux doigts) déplace la carte.
 */
export function wheelIntent({ deltaX = 0, ctrlKey = false, deltaMode = 0 }) {
  if (ctrlKey) return 'zoom';
  if (deltaMode === 0 && Math.abs(deltaX) > 0.5) return 'pan';
  return 'zoom';
}
