// Modèles 3D de la ville : kits de Kenney (licence CC0, client/public/models/kit/, voir LICENCE.txt) pour les
// maisons et commerces, auvents, véhicules, lampadaires, manguiers, palmiers et buissons. Chargés une fois au
// lancement (pendant l'écran de connexion) ; tant qu'ils ne sont pas là, ou s'ils échouent, les builders gardent
// les volumes dessinés par le code. Couleurs d'Abidjan : toits, murs et carrosseries repeints dans la palette.
// Désactivables pour comparer : ?modeles=0 ou localStorage['babiverse.modeles'] = '0'.
import * as THREE from 'three';
import { HOUSES, houseChoice, isShop, PALETTE, recolor, treeVariation } from './kitPlan.js';

const DIR = '/models/kit/';
const VERSION = 1; // à changer quand un fichier du kit est remplacé (cache du navigateur et du service worker)
const FILES = {
  ...Object.fromEntries(Object.keys(HOUSES).map((n) => [n, `maisons/${n}.glb`])),
  awning: 'commerces/detail-awning-wide.glb',
  taxi: 'vehicules/taxi.glb',
  sedan: 'vehicules/sedan.glb',
  van: 'vehicules/van.glb',
  lamp: 'rue/light-curved.glb',
  mango: 'nature/tree_oak.glb',
  palm: 'nature/tree_palmDetailedTall.glb',
  bush: 'nature/plant_bushDetailed.glb',
};
// Modèles dont l'origine reste au pied (tronc, mât) au lieu d'être centrée sur leur emprise.
const ANCHORED = new Set(['lamp', 'mango', 'palm', 'bush']);

// Véhicules de la circulation : modèle, couleur de carrosserie (taxis orange, wôrô-wôrô verts, gbaka blancs).
const VEHICLES = {
  taxi: { model: 'taxi', paint: '#f39c12', len: 1.8, wid: 0.88 },
  woroworo: { model: 'sedan', paint: '#27ae60', len: 1.8, wid: 0.88 },
  voiture: { model: 'sedan', paint: '#c0392b', len: 1.8, wid: 0.88 },
  gbaka: { model: 'van', paint: '#ecf0f1', len: 2.8, wid: 0.98 },
};
// Végétation des cartes ASCII : modèle et hauteur visée (unités = cases).
const PLANTS = { T: { model: 'mango', height: 1.75 }, p: { model: 'palm', height: 2.3 }, '%': { model: 'bush', height: 0.5 } };
const LAMP_HEIGHT = 2.1;
const LAMP_PAINT = [[[224, 256, 64, 128], '#7f8c8d']]; // mât gris (violet dans la palette du kit)

const models = new Map(); // nom → { parts: [{ geometry, material, name }], size: {w, h, d} }
let state = 'idle';
let promise = null;

const enabled = () => {
  try {
    if (new URLSearchParams(globalThis.location?.search || '').get('modeles') === '0') return false;
    return globalThis.localStorage?.getItem('babiverse.modeles') !== '0';
  } catch { return true; }
};

export const cityKit = {
  get ready() { return state === 'ready'; },
  get state() { return state; },
};

/** Lance le chargement (une seule fois) ; la promesse donne true si le kit est prêt. */
export function loadCityKit() {
  if (promise) return promise;
  if (!enabled()) { state = 'off'; return (promise = Promise.resolve(false)); }
  state = 'loading';
  promise = import('three/addons/loaders/GLTFLoader.js').then(async ({ GLTFLoader }) => {
    const loader = new GLTFLoader();
    const loaded = await Promise.all(Object.entries(FILES).map(async ([name, file]) => [name, prepare(await loader.loadAsync(`${DIR}${file}?v=${VERSION}`), !ANCHORED.has(name))]));
    for (const [name, model] of loaded) models.set(name, model);
    state = 'ready';
    return true;
  }).catch((err) => {
    console.warn('Modèles de la ville indisponibles, volumes simples conservés :', err.message);
    models.clear();
    state = 'failed';
    return false;
  });
  return promise;
}

/** Attend le kit au plus `ms` millisecondes : le jeu démarre sans lui s'il tarde (réseau lent). */
export function cityKitReady(ms) {
  return Promise.race([loadCityKit(), new Promise((resolve) => setTimeout(() => resolve(false), ms))]);
}

/**
 * Un fichier chargé → pièces à géométrie partagée (transformations des nœuds appliquées), posées au sol
 * (y = 0) et centrées sur leur emprise (sauf `center` faux) ; matériaux Lambert comme le reste du jeu.
 */
function prepare(gltf, center) {
  gltf.scene.updateMatrixWorld(true);
  const parts = [];
  const box = new THREE.Box3();
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    const geometry = o.geometry.clone().applyMatrix4(o.matrixWorld);
    geometry.computeBoundingBox();
    box.union(geometry.boundingBox);
    const src = o.material;
    const material = new THREE.MeshLambertMaterial({ map: src.map || null, color: src.color?.clone() || 0xffffff });
    greener(material.color);
    parts.push({ geometry, material, name: o.name });
  });
  const shift = new THREE.Vector3(center ? -(box.min.x + box.max.x) / 2 : 0, -box.min.y, center ? -(box.min.z + box.max.z) / 2 : 0);
  for (const p of parts) {
    p.geometry.translate(shift.x, shift.y, shift.z);
    p.geometry.computeBoundingSphere();
    p.geometry.userData.shared = true; // jamais libérée au changement de zone (voir disposeGroup)
  }
  const size = box.getSize(new THREE.Vector3());
  return { parts, size: { w: size.x, h: size.y, d: size.z } };
}

/** Feuillage du kit nature : turquoise d'origine viré vers le vert tropical (troncs et couleurs ternes inchangés). */
function greener(color) {
  const hsl = color.getHSL({});
  if (hsl.s > 0.2 && hsl.h > 0.4 && hsl.h < 0.55) color.setHSL(hsl.h - 0.11, Math.min(1, hsl.s * 1.1), hsl.l * 1.15);
}

// Palettes repeintes, partagées par tous les objets de mêmes couleurs.
const palettes = new Map();
function palette(model, edits) {
  const key = `${model}|${JSON.stringify(edits)}`;
  if (!palettes.has(key)) {
    const src = models.get(model).parts.find((p) => p.material.map)?.material.map;
    const img = src.image;
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const pixels = ctx.getImageData(0, 0, img.width, img.height);
    for (const [rect, color] of edits) recolor(pixels.data, img.width, rect, color);
    ctx.putImageData(pixels, 0, 0);
    const tex = new THREE.CanvasTexture(canvas);
    tex.flipY = src.flipY;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = src.magFilter;
    tex.minFilter = src.minFilter;
    tex.anisotropy = 4;
    palettes.set(key, tex);
  }
  return palettes.get(key);
}

// Matériaux partagés d'une palette repeinte (véhicules, auvents).
const sharedMaterials = new Map();
function paintedMaterial(model, edits) {
  const key = `${model}|${JSON.stringify(edits)}`;
  if (!sharedMaterials.has(key)) sharedMaterials.set(key, new THREE.MeshLambertMaterial({ map: palette(model, edits) }));
  return sharedMaterials.get(key);
}

function instance(model, material) {
  const g = new THREE.Group();
  for (const p of models.get(model).parts) {
    const m = new THREE.Mesh(p.geometry, material || p.material);
    m.name = p.name;
    g.add(m);
  }
  return g;
}

/**
 * Bâtiment de la ville en modèle 3D, façade vers +z (l'appelant le tourne si elle donne au nord), ou null
 * si le kit n'est pas prêt. `colors` : { roof, wall, awning }. Le matériau est propre au bâtiment (il peut
 * devenir transparent quand il cache le joueur) mais sa palette est partagée.
 */
export function kitBuilding(b, colors) {
  if (state !== 'ready') return null;
  const pick = houseChoice(b, (m) => models.get(m).size);
  const material = new THREE.MeshLambertMaterial({ map: palette(pick.model, [[PALETTE.roof, colors.roof], [PALETTE.wall, colors.wall]]) });
  material.userData.owned = true;
  material.userData.sharedMap = true;
  const body = instance(pick.model, material);
  body.scale.set(pick.mirror ? -pick.scale.x : pick.scale.x, pick.scale.y, pick.scale.z);
  body.position.x = pick.shift;
  const g = new THREE.Group();
  g.add(body);
  const size = models.get(pick.model).size;
  const height = size.h * pick.scale.y;
  const front = (size.d / 2) * pick.scale.z;
  const materials = [material];
  if (isShop(b) && colors.awning) {
    const a = models.get('awning');
    const awning = instance('awning', paintedMaterial('awning', [[PALETTE.awning, colors.awning]]));
    const s = 1.1 / a.size.w;
    awning.scale.setScalar(s);
    awning.position.set(pick.door, height * 0.3, front + (a.size.d * s) / 2);
    g.add(awning);
  }
  return { group: g, height, front, door: pick.door, materials };
}

/** Véhicule de la circulation (avant vers +x, comme les volumes dessinés), ou null si le kit n'est pas prêt. */
export function kitVehicle(kind, color) {
  const v = VEHICLES[kind];
  if (state !== 'ready' || !v) return null;
  const size = models.get(v.model).size;
  const body = instance(v.model, paintedMaterial(v.model, [[PALETTE.paint[v.model], color || v.paint]]));
  // Longueur et largeur des voies (world/traffic.js) ; hauteur moyenne des deux : un gbaka reste un minibus.
  const sx = v.wid / size.w;
  const sz = v.len / size.d;
  body.scale.set(sx, (sx + sz) / 2, sz);
  body.rotation.y = Math.PI / 2; // avant du modèle (+z) vers +x
  const g = new THREE.Group();
  g.add(body);
  return g;
}

/** Lampadaire (mât à l'origine, bras vers +z) et position de sa tête, ou null si le kit n'est pas prêt. */
export function kitLamp() {
  if (state !== 'ready') return null;
  const size = models.get('lamp').size;
  const s = LAMP_HEIGHT / size.h;
  const g = instance('lamp', paintedMaterial('lamp', LAMP_PAINT));
  g.scale.setScalar(s);
  g.rotation.y = Math.PI; // bras du modèle vers -z
  return { group: g, head: new THREE.Vector3(0, LAMP_HEIGHT - 0.08, size.d * s - 0.12) };
}

/**
 * Végétation d'une carte (manguiers T, palmiers p, buissons %) en maillages instanciés : un appel de dessin
 * par pièce de modèle pour toute la zone. Retourne null si le kit n'est pas prêt (volumes dessinés gardés).
 */
export function kitPlants(cellsOf) {
  if (state !== 'ready') return null;
  const g = new THREE.Group();
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  for (const [ch, plant] of Object.entries(PLANTS)) {
    const cells = cellsOf(ch);
    if (!cells.length) continue;
    const model = models.get(plant.model);
    const base = plant.height / model.size.h;
    for (const part of model.parts) {
      const mesh = new THREE.InstancedMesh(part.geometry, part.material, cells.length);
      cells.forEach(([x, y], i) => {
        const v = treeVariation(x, y);
        const s = base * v.scale;
        m.compose(new THREE.Vector3(x + 0.5, 0, y + 0.5), q.setFromAxisAngle(up, v.rot), new THREE.Vector3(s, s, s));
        mesh.setMatrixAt(i, m);
      });
      mesh.computeBoundingSphere();
      g.add(mesh);
    }
  }
  return g;
}

export const PLANT_CELLS = Object.keys(PLANTS);
