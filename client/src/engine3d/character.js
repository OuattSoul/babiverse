// Personnages low-poly articulés (joueur, PNJ, clients) avec animation de marche procédurale.
// Une apparence composée dans l'atelier (`look.svg` ou `look.studio`) devient un personnage en volume : ses vues
// SVG (face, dos, profil) sont projetées sur des formes rondes articulées qui marchent comme le modèle 3D.
import * as THREE from 'three';
import { composeCharacter, svgDataUrl } from '../atelier/compose.js';
import { atelier, svgCharacter } from '../atelier/pack.js';
import { characterViews } from '../atelier/views.js';
import { alphaSpans, ATLAS_W, loftPiece, pieceRows, PIECES, VIEW_H, VIEW_W } from './characterVolume.js';
import { mat } from './materials.js';
import { castShadows } from './quality.js';
import { animateKit, characterKit, kitCharacter } from './characterKit.js';

const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const HAIR = '#1b1b1b';

function limb(geometry, material, pivotY, offsetX) {
  // Membre suspendu à un pivot (hanche ou épaule) pour pouvoir le faire balancer.
  const pivot = new THREE.Group();
  pivot.position.set(offsetX, pivotY, 0);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = -geometry.parameters.height / 2;
  pivot.add(mesh);
  return pivot;
}

// --- Personnages de l'atelier (volumes articulés) -----------------------------------------
// Trois vues composées à partir des mêmes composants (atelier/views.js) : face, dos et profil. Elles sont
// rastérisées une fois par apparence dans un atlas (face | dos | profil), dont on lit les silhouettes pour
// construire cinq volumes (characterVolume.js) : tronc et tête, deux bras, deux jambes, chacun suspendu à
// l'épaule ou à la hanche. Les vues sont projetées sur ces volumes, éclairés comme le reste de la scène :
// le personnage a une vraie épaisseur sous tous les angles et marche comme le modèle 3D.
// Repère SVG 0 0 200 380 : pieds à y ≈ 362, sommet du crâne à y ≈ 22 → même taille que le modèle 3D (0,95).
const UNIT = 0.95 / 340;
const FEET_Y = 362;
const RES = 1.5; // pixels de texture par unité SVG
const STEP = 4; // hauteur d'une rangée du volume (unités SVG)

// Projection des trois vues : poids par sommet (face, dos, profil) ; le dos est un tiers plus loin dans l'atlas.
function projectViews(shader) {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nattribute vec2 uvSide;\nattribute vec3 viewWeight;\nvarying vec2 vUvSide;\nvarying vec3 vViewWeight;')
    .replace('#include <uv_vertex>', '#include <uv_vertex>\nvUvSide = uvSide;\nvViewWeight = viewWeight;');
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nvarying vec2 vUvSide;\nvarying vec3 vViewWeight;')
    .replace('#include <map_fragment>', `diffuseColor *= vViewWeight.x * texture2D(map, vMapUv)
      + vViewWeight.y * texture2D(map, vMapUv + vec2(${(1 / 3).toFixed(7)}, 0.0))
      + vViewWeight.z * texture2D(map, vUvSide);`);
}

const models = new Map(); // SVG des trois vues → { material, geometries, waiting } partagé par les personnages identiques

// Apparences préparées une à la fois (rastérisation + lecture des silhouettes) : l'entrée en ville reste fluide.
const queue = [];
let loading = false;
function pump() {
  if (loading || !queue.length) return;
  loading = true;
  prepare(queue.shift()).finally(() => { loading = false; pump(); });
}

const loadImage = (svg) => new Promise((ok, ko) => {
  const img = new Image();
  img.onload = () => ok(img);
  img.onerror = ko;
  img.src = svgDataUrl(svg);
});

async function prepare(model) {
  let images;
  try {
    images = await Promise.all([model.svgs.front, model.svgs.back, model.svgs.side].map(loadImage));
  } catch {
    model.waiting = null; // apparence illisible : le personnage reste invisible (seule l'ombre)
    return;
  }
  const atlas = document.createElement('canvas');
  atlas.width = ATLAS_W * RES;
  atlas.height = VIEW_H * RES;
  const ctx = atlas.getContext('2d', { willReadFrequently: true });
  images.forEach((img, i) => ctx.drawImage(img, i * VIEW_W * RES, 0, VIEW_W * RES, VIEW_H * RES));
  let span;
  let cutout = false;
  try {
    span = alphaSpans(ctx.getImageData(0, 0, atlas.width, atlas.height).data, atlas.width, RES);
  } catch {
    // canvas illisible (navigateur qui le considère « souillé ») : volumes aux bornes des pièces, détourés
    // par la transparence de l'image
    span = (_view, _y, x0, x1) => [x0, x1];
    cutout = true;
  }
  const geometries = {};
  for (const [name, piece] of Object.entries(PIECES)) {
    const mesh = loftPiece(pieceRows(piece, span, STEP), piece, { step: STEP });
    if (!mesh) continue;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(mesh.position.map((v) => v * UNIT), 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(mesh.uv, 2));
    g.setAttribute('uvSide', new THREE.Float32BufferAttribute(mesh.uvSide, 2));
    g.setAttribute('viewWeight', new THREE.Float32BufferAttribute(mesh.weight, 3));
    g.setIndex(mesh.index);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    g.userData.shared = true;
    geometries[name] = g;
  }
  const tex = new THREE.CanvasTexture(atlas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const material = new THREE.MeshLambertMaterial({
    map: tex,
    alphaTest: cutout ? 0.4 : 0,
    side: cutout ? THREE.DoubleSide : THREE.FrontSide,
  });
  material.onBeforeCompile = projectViews;
  material.customProgramCacheKey = () => 'babi-volume';
  model.material = material;
  model.geometries = geometries;
  const waiting = model.waiting;
  model.waiting = null;
  for (const attach of waiting) attach(model);
}

function volumeModel(svgs) {
  const key = `${svgs.front}\n${svgs.back}\n${svgs.side}`;
  let model = models.get(key);
  if (!model) {
    model = { svgs, material: null, geometries: null, waiting: [] };
    models.set(key, model);
    queue.push(model);
    pump();
  }
  return model;
}

const composed = new WeakMap();

// Vue de face SVG d'une apparence de l'atelier (visage et vêtements reportés sur le personnage animé).
const fronts = new Map();
function frontView(props) {
  const key = JSON.stringify(props);
  if (!fronts.has(key)) fronts.set(key, composeCharacter(props, atelier.pack.parts, { idPrefix: 'k' }).svg);
  return fronts.get(key);
}

function buildSvgCharacter(props) {
  // SVG des vues composés une fois par définition (les passants réutilisent les habitants)
  let svgs = composed.get(props);
  if (!svgs) { svgs = characterViews(props, atelier.pack.parts); composed.set(props, svgs); }
  const g = new THREE.Group();
  const holder = new THREE.Group();
  // joints : épaules et hanches (animés), ready : volumes posés (apparence préparée)
  const puppet = { holder, joints: {}, all: [], ready: false };
  for (const [name, piece] of Object.entries(PIECES)) {
    const [px, py] = piece.pivot;
    const joint = new THREE.Group();
    joint.position.set((px - 100) * UNIT, (FEET_Y - py) * UNIT, 0);
    joint.userData.swing = piece.swing || 0;
    holder.add(joint);
    puppet.joints[name] = joint;
    puppet.all.push(joint);
  }
  const attach = (model) => {
    for (const [name, geometry] of Object.entries(model.geometries)) puppet.joints[name].add(castShadows(new THREE.Mesh(geometry, model.material)));
    puppet.ready = true;
  };
  const model = volumeModel(svgs);
  if (model.geometries) attach(model);
  else model.waiting?.push(attach);
  g.add(holder, disc());
  g.userData.puppet = puppet;
  g.userData.phase = 0;
  return g;
}

// Habitants habillés quelques-uns par image (~6 ms) : l'entrée dans une zone n'attend pas leurs textures.
const dressQueue = [];
let dressing = false;
function pumpDress() {
  const start = performance.now();
  while (dressQueue.length && performance.now() - start < 6) dressQueue.shift()();
  if (dressQueue.length) requestAnimationFrame(pumpDress);
  else dressing = false;
}
const inScene = (o) => { while (o.parent) o = o.parent; return o.isScene; };

/**
 * Construit un personnage (pieds en y = 0, regard vers +z) : animé (Kenney, 1,35 de haut) habillé d'après la
 * tenue, sinon en volumes (0,95). Le groupe rendu est stable (position, rotation, étiquettes) ; le corps animé
 * d'un habitant y arrive un peu plus tard (`hd` : joueur et aperçu, tout de suite et en texture fine).
 */
export function buildCharacter(look, { hd = false } = {}) {
  const svgProps = svgCharacter(look);
  const pieceOf = (key) => atelier.byId.get(String(key).split('@')[0]) || null;
  const dress = () => kitCharacter(look, svgProps, pieceOf, svgProps ? frontView(svgProps) : null, hd);
  if (characterKit.ready) {
    if (hd) return castShadows(dress().add(disc()));
    const g = new THREE.Group();
    g.add(disc());
    g.userData.dressing = true;
    dressQueue.push(() => {
      if (!inScene(g)) return; // zone quittée entre-temps
      const kit = dress();
      for (const c of [...kit.children]) g.add(c);
      g.userData.kit = kit.userData.kit;
      g.userData.dressing = false;
      castShadows(g);
    });
    if (!dressing) { dressing = true; requestAnimationFrame(pumpDress); }
    return g;
  }
  if (svgProps) return buildSvgCharacter(svgProps);
  const skin = mat(look.skin || '#c68642');
  const outfit = mat(look.outfit || '#e67e22');
  const pants = mat(look.pants || '#2c3e50');
  const hair = mat(HAIR);
  const g = new THREE.Group();

  const legL = limb(box(0.13, 0.42, 0.14), pants, 0.42, -0.08);
  const legR = limb(box(0.13, 0.42, 0.14), pants, 0.42, 0.08);
  const torso = new THREE.Mesh(box(0.36, 0.36, 0.2), outfit);
  torso.position.y = 0.6;
  const armL = limb(box(0.09, 0.34, 0.1), skin, 0.76, -0.235);
  const armR = limb(box(0.09, 0.34, 0.1), skin, 0.76, 0.235);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 10), skin);
  head.position.y = 0.95;
  g.add(legL, legR, torso, armL, armR, head);

  // Yeux (face avant, +z)
  const eyeGeo = box(0.035, 0.035, 0.02);
  for (const x of [-0.055, 0.055]) {
    const eye = new THREE.Mesh(eyeGeo, mat('#111'));
    eye.position.set(x, 0.97, 0.142);
    g.add(eye);
  }

  // Coiffure
  if (look.hair === 'afro') {
    const afro = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 10), hair);
    afro.position.set(0, 1.02, -0.03);
    g.add(afro);
  } else if (look.hair === 'short' || look.hair === 'braids') {
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.158, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2.1), hair);
    cap.position.y = 0.96;
    cap.rotation.x = -0.25;
    g.add(cap);
    if (look.hair === 'braids') {
      for (const x of [-0.12, 0.12]) {
        const braid = new THREE.Mesh(box(0.05, 0.28, 0.05), hair);
        braid.position.set(x, 0.8, -0.06);
        g.add(braid);
      }
    }
  }

  g.add(disc());

  g.userData.limbs = { legL, legR, armL, armR };
  g.userData.phase = 0;
  return castShadows(g);
}

// Disque sombre sous les pieds : remplace l'ombre du soleil quand elle est coupée (économie de batterie).
const SHADOW = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25, depthWrite: false });
export function setDiscShadows(on) { SHADOW.visible = on; }
function disc() {
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.26, 16), SHADOW);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.01;
  return shadow;
}

/** Anime la marche : balancement des jambes et des bras proportionnel à la vitesse. */
export function animateCharacter(g, dt, speed, near = false) {
  if (g.userData.kit) { animateKit(g, dt, speed, near); return; }
  if (g.userData.dressing) return; // corps animé pas encore arrivé
  const moving = speed > 0.05;
  if (g.userData.puppet) {
    // Volumes : jambes et bras balancent d'avant en arrière en opposition, léger appui à chaque pas ; repos à l'arrêt.
    const { all, holder } = g.userData.puppet;
    g.userData.phase += dt * (moving ? 9 * Math.min(1.4, speed) : 0);
    const s = moving ? Math.sin(g.userData.phase) : 0;
    const k = Math.min(1, dt * 14);
    for (const j of all) if (j.userData.swing) j.rotation.x += (s * j.userData.swing - j.rotation.x) * k;
    holder.position.y += ((moving ? Math.abs(Math.cos(g.userData.phase)) * 0.018 : 0) - holder.position.y) * k;
    return;
  }
  const { legL, legR, armL, armR } = g.userData.limbs;
  g.userData.phase += dt * (moving ? 9 * Math.min(1.4, speed) : 0);
  const amp = moving ? 0.6 : 0;
  const s = Math.sin(g.userData.phase) * amp;
  const ease = (o, v) => { o.rotation.x += (v - o.rotation.x) * Math.min(1, dt * 14); };
  ease(legL, s); ease(legR, -s); ease(armL, -s * 0.8); ease(armR, s * 0.8);
}

/** Tourne le personnage vers une direction au sol, en douceur. */
export function faceTowards(g, dx, dz, dt) {
  if (Math.abs(dx) + Math.abs(dz) < 1e-4) return;
  const target = Math.atan2(dx, dz);
  let d = target - g.rotation.y;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  g.rotation.y += d * Math.min(1, dt * 12);
}
