// Matériaux partagés (un seul par couleur) et petites textures canvas.
import * as THREE from 'three';

const cache = new Map();

/** Matériau Lambert mis en cache : bon marché à éclairer, adapté aux mobiles modestes. */
export function mat(color, opts = {}) {
  const key = `${color}|${JSON.stringify(opts)}`;
  if (!cache.has(key)) cache.set(key, new THREE.MeshLambertMaterial({ color, ...opts }));
  return cache.get(key);
}

export function canvasTexture(w, h, paint) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  paint(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Sprite de texte toujours tourné vers la caméra (noms des PNJ, textes flottants). */
export function textSprite(text, { size = 26, color = '#fff', bg = null, scale = 0.011 } = {}) {
  const font = `600 ${size}px system-ui, sans-serif`;
  const probe = document.createElement('canvas').getContext('2d');
  probe.font = font;
  const w = Math.ceil(probe.measureText(text).width) + 16;
  const h = size + 14;
  const tex = canvasTexture(w, h, (ctx) => {
    if (bg) { ctx.fillStyle = bg; ctx.beginPath(); ctx.roundRect(0, 0, w, h, h / 2); ctx.fill(); }
    ctx.font = font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 5;
    ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    if (!bg) ctx.strokeText(text, w / 2, h / 2 + 1);
    ctx.fillStyle = color;
    ctx.fillText(text, w / 2, h / 2 + 1);
  });
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sprite.scale.set(w * scale, h * scale, 1);
  sprite.renderOrder = 10;
  return sprite;
}

export const EMOJI_FONT = '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", system-ui, sans-serif';

/** Pastille ronde portant une icône (emoji), toujours tournée vers la caméra (lieux sur la carte). */
export function iconSprite(icon, { size = 44, bg = '#fffaf2', ring = '#2b2118', scale = 0.009 } = {}) {
  const d = size + 22;
  const tex = canvasTexture(d, d, (ctx) => {
    ctx.fillStyle = ring;
    ctx.beginPath(); ctx.arc(d / 2, d / 2, d / 2 - 1, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = bg;
    ctx.beginPath(); ctx.arc(d / 2, d / 2, d / 2 - 5, 0, Math.PI * 2); ctx.fill();
    ctx.font = `${size}px ${EMOJI_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(icon, d / 2, d / 2 + size * 0.06);
  });
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sprite.scale.set(d * scale, d * scale, 1);
  sprite.renderOrder = 10;
  return sprite;
}

/** Libère les géométries et textures propres à un groupe (les matériaux partagés restent en cache). */
export function disposeGroup(group) {
  group.traverse((o) => {
    if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose();
    if (o.isSprite && !o.userData.sharedMaterial) { o.material.map?.dispose(); o.material.dispose(); }
    // sharedMap : matériau propre à l'objet mais palette partagée (modèles du kit), la texture reste.
    for (const m of [].concat(o.material || [])) if (m.userData?.owned) { if (!m.userData.sharedMap) m.map?.dispose(); m.dispose(); }
  });
}
