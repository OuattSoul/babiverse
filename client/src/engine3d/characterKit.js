// Personnages 3D animés : Animated Characters de Kenney (CC0, client/public/models/personnages/, voir LICENCE.txt).
// Un corps humain unique (repos, course, saut) habillé par une texture peinte d'après la tenue de l'atelier :
// couleurs de la garde-robe, puis visage, haut et jupe découpés dans la vue de face SVG (motifs compris).
// Chargé pendant la connexion ; sans lui (échec, retard, ?modeles=0), les personnages gardent leurs volumes.
import * as THREE from 'three';
import { svgDataUrl } from '../atelier/compose.js';
import { gaitFor, outfitKey, outfitOf, skinPaint, SVG_CROPS } from './charPlan.js';

const FILE = '/models/personnages/humain.glb';
const VERSION = 2; // à changer quand le fichier est remplacé (cache du navigateur et du service worker)
export const CHARACTER_HEIGHT = 1.35; // unités (1 = une case) : nettement plus grand que les volumes (0,95)
// Texture peinte (repère de référence 1024) : fine pour le joueur et l'aperçu, légère pour les habitants
// (petits à l'écran, nombreux : quatre fois moins de pixels à peindre et à envoyer à la carte graphique).
const TEX = { hd: 512, sd: 256 };
const BLEND = 6; // vitesse du passage repos ↔ marche ↔ course

let source = null; // { scene, clips, scale, lift }
let cloneSkinned = null;
let state = 'idle';
let promise = null;

const enabled = () => {
  try {
    if (new URLSearchParams(globalThis.location?.search || '').get('modeles') === '0') return false;
    return globalThis.localStorage?.getItem('babiverse.modeles') !== '0';
  } catch { return true; }
};

export const characterKit = {
  get ready() { return state === 'ready'; },
  get state() { return state; },
};

/** Lance le chargement (une seule fois) ; la promesse donne true si les personnages sont prêts. */
export function loadCharacterKit() {
  if (promise) return promise;
  if (!enabled()) { state = 'off'; return (promise = Promise.resolve(false)); }
  state = 'loading';
  promise = Promise.all([import('three/addons/loaders/GLTFLoader.js'), import('three/addons/utils/SkeletonUtils.js')])
    .then(async ([{ GLTFLoader }, SkeletonUtils]) => {
      cloneSkinned = SkeletonUtils.clone;
      const gltf = await new GLTFLoader().loadAsync(`${FILE}?v=${VERSION}`);
      source = measure(gltf);
      state = 'ready';
      return true;
    })
    .catch((err) => {
      console.warn('Personnages 3D indisponibles, volumes conservés :', err.message);
      state = 'failed';
      return false;
    });
  return promise;
}

/** Attend les personnages au plus `ms` millisecondes : le jeu démarre sans eux s'ils tardent. */
export function characterKitReady(ms) {
  return Promise.race([loadCharacterKit(), new Promise((resolve) => setTimeout(() => resolve(false), ms))]);
}

/** Échelle et hauteur des pieds mesurées sur la pose de repos (le fichier est en pose en T, en centimètres). */
function measure(gltf) {
  const clips = Object.fromEntries(gltf.animations.map((c) => [c.name, c]));
  const scene = gltf.scene;
  const mixer = new THREE.AnimationMixer(scene);
  mixer.clipAction(clips.idle).play();
  mixer.update(0);
  scene.updateMatrixWorld(true);
  let skinned = null;
  scene.traverse((o) => { if (o.isSkinnedMesh) skinned = o; });
  skinned.computeBoundingBox();
  const box = skinned.boundingBox.clone().applyMatrix4(skinned.matrixWorld);
  mixer.stopAllAction();
  const scale = CHARACTER_HEIGHT / (box.max.y - box.min.y);
  return { scene, clips, scale, lift: -box.min.y * scale };
}

// --- Texture des vêtements -----------------------------------------------------------------

function paint(ctx, op) {
  ctx.fillStyle = op.color;
  ctx.strokeStyle = op.color;
  if (op.rect) ctx.fillRect(...op.rect);
  else if (op.ellipse) { const [x, y, rx, ry] = op.ellipse; ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.fill(); }
  else if (op.ring) { const [x, y, r, w] = op.ring; ctx.lineWidth = w; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke(); }
}

const SVG_SCALE = 2; // vue SVG rastérisée en 400 × 760 (repère 200 × 380) : découpes nettes

/** Canvas peint : couleurs de la tenue, puis découpes de la vue de face SVG si elle est prête. */
function paintCanvas(outfit, img, size) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  // Canvas en mémoire (et non accéléré) : envoyé tel quel à la carte graphique, sans dessin perdu.
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.scale(size / 1024, size / 1024);
  for (const op of skinPaint(outfit, { face: !img })) paint(ctx, op);
  if (img) {
    // Vue de face de l'atelier : visage (coiffure, yeux, barbe, lunettes, maquillage), haut et jupe à motifs.
    const crops = [SVG_CROPS.face, SVG_CROPS.torso, ...(outfit.style.skirt ? [SVG_CROPS.skirt] : [])];
    for (const { from, to } of crops) ctx.drawImage(img, ...from.map((v) => v * SVG_SCALE), ...to);
  }
  return canvas;
}

const materials = new Map(); // tenue (+ vue SVG) → matériau partagé
function outfitMaterial(outfit, front, hd) {
  const size = hd ? TEX.hd : TEX.sd;
  const key = `${size}|${outfitKey(outfit, front || '')}`;
  if (materials.has(key)) return materials.get(key);
  // Visage simple tant que la vue SVG n'est pas rastérisée ; une texture neuve la remplace ensuite
  // (un canvas déjà envoyé à la carte graphique n'est jamais redessiné).
  const map = new THREE.CanvasTexture(paintCanvas(outfit, null, size));
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  const material = new THREE.MeshLambertMaterial({ map });
  materials.set(key, material);
  if (front) {
    const img = new Image();
    img.onload = () => {
      const next = new THREE.CanvasTexture(paintCanvas(outfit, img, size));
      next.colorSpace = THREE.SRGBColorSpace;
      next.anisotropy = 4;
      material.map = next;
      material.needsUpdate = true;
      map.dispose();
    };
    const [w, h] = [200 * SVG_SCALE, 380 * SVG_SCALE];
    img.src = svgDataUrl(front.replace('<svg ', `<svg width="${w}" height="${h}" `));
  }
  return material;
}

// --- Personnages ---------------------------------------------------------------------------

/**
 * Personnage animé d'après une apparence (classique, ou de l'atelier : `svg` et `entry(clé)` → pièce de la
 * garde-robe ; `front` = vue de face SVG composée), ou null si le modèle n'est pas prêt. Regard vers +z.
 */
export function kitCharacter(look, svg, entry, front, hd = false) {
  if (state !== 'ready') return null;
  return dressedCharacter(outfitOf(look, svg, entry), front, hd);
}

/** Corps habillé d'une tenue {colors, style}, animé (repos au départ) ; `hd` : texture fine (joueur, aperçu). */
export function dressedCharacter(outfit, front = null, hd = false) {
  const material = outfitMaterial(outfit, front, hd);
  const body = cloneSkinned(source.scene);
  body.traverse((o) => {
    if (!o.isMesh) return;
    o.material = material;
    o.frustumCulled = false; // boîte englobante de la pose en T, fausse une fois animé
  });
  body.scale.setScalar(source.scale);
  body.position.y = source.lift;
  const g = new THREE.Group();
  g.add(body);
  const mixer = new THREE.AnimationMixer(body);
  const actions = Object.fromEntries(Object.entries(source.clips).map(([n, c]) => [n, mixer.clipAction(c)]));
  actions.idle.play();
  actions.run.play().setEffectiveWeight(0);
  const kit = { mixer, actions, run: 0, current: 'idle' };
  g.userData.kit = kit;
  mixer.update(Math.random() * 1.2); // une foule ne respire ni ne court au même rythme
  return g;
}

// Niveau de détail des animations (coût processeur) : chaque image près de la caméra, une sur deux puis une
// sur quatre en s'éloignant, plus rien au-delà (ni pour un personnage caché).
const viewer = new THREE.Vector3();
let hasViewer = false;
const ANIM_LOD = [[10, 1], [18, 2], [40, 4]]; // [distance max, une image sur n]

/** Position de la caméra du monde, mise à jour à chaque image (World3D). */
export function setAnimationViewer(position) {
  viewer.copy(position);
  hasViewer = true;
}

/**
 * Repos, marche ou course selon la vitesse (normalisée ou booléenne) : mélange progressif repos / course.
 * `near` : toujours animer (aperçu du profil, hors du monde).
 */
export function animateKit(g, dt, speed, near = false) {
  const kit = g.userData.kit;
  const gait = gaitFor(speed);
  kit.current = gait.name;
  kit.pending = (kit.pending || 0) + dt;
  if (!near) {
    if (!g.visible) return;
    const d = hasViewer ? Math.hypot(g.position.x - viewer.x, g.position.z - viewer.z) : 0;
    const every = ANIM_LOD.find(([max]) => d <= max)?.[1];
    if (!every) return;
    kit.tick = ((kit.tick || 0) + 1) % every;
    if (kit.tick) return;
  }
  const step = Math.min(kit.pending, 0.5);
  kit.pending = 0;
  kit.run += (gait.run - kit.run) * Math.min(1, step * BLEND);
  kit.actions.run.setEffectiveWeight(kit.run);
  kit.actions.idle.setEffectiveWeight(1 - kit.run);
  kit.actions.run.timeScale = gait.rate;
  kit.mixer.update(step);
}
