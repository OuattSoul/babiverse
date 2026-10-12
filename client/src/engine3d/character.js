// Personnages low-poly articulés (joueur, PNJ, clients) avec animation de marche procédurale.
// Une apparence composée dans l'atelier (`look.svg` ou `look.studio`) est un pantin articulé découpé dans ses vues
// SVG (face, dos, profil) : il se voit de tous les côtés et marche (jambes et bras qui balancent) comme le modèle 3D.
import * as THREE from 'three';
import { svgDataUrl } from '../atelier/compose.js';
import { atelier, svgCharacter } from '../atelier/pack.js';
import { characterViews, pickView, SIDE_BODY } from '../atelier/views.js';
import { mat } from './materials.js';

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

// --- Personnages de l'atelier (pantins articulés) ------------------------------------------
// Trois vues composées à partir des mêmes composants (atelier/views.js) : face, dos (en miroir) et profil
// (tourné vers la droite, en miroir pour la gauche). La vue suit l'angle entre le cap du personnage et la
// caméra, comme le modèle 3D qu'on voit de face, de dos ou de côté selon qu'il vient, s'en va ou passe.
// Chaque vue est rastérisée puis découpée en cinq pièces (tronc et tête, deux bras, deux jambes) posées sur
// des plans toujours tournés vers la caméra (rotation autour de la verticale seulement). Chaque membre pivote
// à l'épaule ou à la hanche : à l'arrêt, les pièces se recomposent exactement en l'image de la vue.
// Repère SVG 0 0 200 380 : pieds à y ≈ 362, sommet du crâne à y ≈ 22 → même taille que le modèle 3D (0,95).
const UNIT = 0.95 / 340;
const FEET_Y = 362;
const RES = 1.2; // pixels de texture par unité SVG
// Les bras débordent de 2 unités sur la zone retirée du tronc : pas de fente à la jointure (filtrage de texture).
const grow = ([x0, y0, x1, y1], d) => [x0 - d, y0 - d, x1 + d, y1 + d];
const thin = (x) => 100 + (x - 100) * SIDE_BODY; // abscisse de face → abscisse de profil (corps aminci)
const thinRect = ([x0, y0, x1, y1]) => [thin(x0), y0, thin(x1), y1];

// Pièces d'une vue. rect [x0, y0, x1, y1] et pivot [x, y] dans le repère SVG de la vue ; joint : abscisse où
// le pivot est posé (défaut : celle du pivot) ; z : ordre d'affichage ; at : place dans l'atlas (une texture
// par vue), pièces espacées de 4 unités ; swing : amplitude de la marche (rad).
function frontPieces() {
  const ARM_L = [20, 116, 70, 280];
  const ARM_R = [130, 116, 180, 280];
  const cut = [ARM_L, ARM_R];
  return {
    legL: { rect: [0, 230, 100, 380], pivot: [86, 236], z: -0.004, cut, at: [0, 246], swing: 0.34 },
    legR: { rect: [100, 230, 200, 380], pivot: [114, 236], z: -0.004, cut, at: [104, 246], swing: -0.34 },
    torso: { rect: [0, 0, 200, 242], pivot: [100, 236], z: 0, cut, at: [0, 0] },
    armL: { rect: grow(ARM_L, 2), pivot: [64, 128], z: 0.004, cut: [], at: [208, 0], swing: -0.16 },
    armR: { rect: grow(ARM_R, 2), pivot: [136, 128], z: 0.004, cut: [], at: [266, 0], swing: 0.16 },
  };
}
function sidePieces() {
  // De profil, jambes et bras sont l'un derrière l'autre au milieu du corps : ils balancent d'avant en arrière
  // dans le plan de l'image (vraie marche de profil), avec plus d'amplitude ; le bras éloigné passe derrière.
  const ARM_L = thinRect([20, 116, 70, 280]);
  const ARM_R = thinRect([130, 116, 180, 280]);
  const cut = [ARM_L, ARM_R];
  return {
    legL: { rect: [0, 230, 100, 380], pivot: [thin(86), 236], joint: 100, z: -0.006, cut, at: [0, 246], swing: 0.42 },
    legR: { rect: [100, 230, 200, 380], pivot: [thin(114), 236], joint: 100, z: -0.004, cut, at: [104, 246], swing: -0.42 },
    torso: { rect: [0, 0, 200, 242], pivot: [100, 236], z: 0, cut, at: [0, 0] },
    armL: { rect: grow(ARM_L, 2), pivot: [thin(64), 128], joint: 99, z: -0.008, cut: [], at: [208, 0], swing: -0.38 },
    armR: { rect: grow(ARM_R, 2), pivot: [thin(136), 128], joint: 101, z: 0.004, cut: [], at: [244, 0], swing: 0.38 },
  };
}
const VIEWS = {
  front: { pieces: frontPieces() },
  back: { pieces: frontPieces(), mirror: true },
  side: { pieces: sidePieces() },
};
const ATLAS = [320, 400];
for (const view of Object.values(VIEWS)) {
  for (const piece of Object.values(view.pieces)) {
    const { rect: [x0, y0, x1, y1], pivot: [px, py], at: [ax, ay] } = piece;
    const g = new THREE.PlaneGeometry((x1 - x0) * UNIT, (y1 - y0) * UNIT);
    g.translate(((x0 + x1) / 2 - px) * UNIT, (py - (y0 + y1) / 2) * UNIT, 0);
    // coordonnées de texture : la pièce dans l'atlas (v = 1 en haut du canvas)
    const [u0, u1] = [ax / ATLAS[0], (ax + x1 - x0) / ATLAS[0]];
    const [v0, v1] = [1 - (ay + y1 - y0) / ATLAS[1], 1 - ay / ATLAS[1]];
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
    g.userData.shared = true;
    piece.geometry = g;
  }
}
const puppets = new Map(); // SVG d'une vue → matériau (atlas) partagé par tous les personnages identiques
let night = 0;

// Vues de dos et de profil rastérisées à la demande (première fois qu'elles servent), une à la fois :
// l'entrée en ville ne paie que les vues de face. En attendant, le pantin garde la vue précédente.
const queue = [];
let loading = false;
function requestView(material) {
  if (material.userData.state) return;
  material.userData.state = 'queued';
  queue.push(material);
  pump();
}
function pump() {
  if (loading || !queue.length) return;
  loading = true;
  queue.shift().userData.load(() => { loading = false; pump(); });
}

function puppetMaterial(svg, view, lazy = false) {
  const known = puppets.get(svg);
  if (known) return known;
  const atlas = document.createElement('canvas');
  atlas.width = ATLAS[0] * RES;
  atlas.height = Math.round(ATLAS[1] * RES);
  const tex = new THREE.CanvasTexture(atlas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshBasicMaterial({ map: tex, alphaTest: 0.4, side: THREE.DoubleSide });
  material.color.setScalar(1 - night);
  material.visible = false; // jusqu'au chargement de l'image
  material.userData.load = (done) => {
    material.userData.state = 'loading';
    const img = new Image();
    img.onload = () => {
      // Une seule rastérisation du SVG (retourné pour le dos), puis copie de chaque pièce à sa place dans l'atlas.
      const full = document.createElement('canvas');
      full.width = 200 * RES;
      full.height = 380 * RES;
      const fctx = full.getContext('2d');
      if (view.mirror) { fctx.translate(full.width, 0); fctx.scale(-1, 1); }
      fctx.drawImage(img, 0, 0, full.width, full.height);
      const ctx = atlas.getContext('2d');
      for (const { rect: [x0, y0, x1, y1], cut, at: [ax, ay] } of Object.values(view.pieces)) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(ax * RES, ay * RES, (x1 - x0) * RES, (y1 - y0) * RES);
        ctx.clip();
        ctx.drawImage(full, (ax - x0) * RES, (ay - y0) * RES);
        // les bras sont des pièces à part : on les retire du tronc et des jambes
        for (const [bx0, by0, bx1, by1] of cut) ctx.clearRect((ax + bx0 - x0) * RES, (ay + by0 - y0) * RES, (bx1 - bx0) * RES, (by1 - by0) * RES);
        ctx.restore();
      }
      tex.needsUpdate = true;
      material.visible = true;
      material.userData.state = 'ready';
      done?.();
    };
    img.onerror = () => { material.userData.state = 'failed'; done?.(); };
    img.src = svgDataUrl(svg);
  };
  if (!lazy) material.userData.load();
  puppets.set(svg, material);
  return material;
}

const _pos = new THREE.Vector3();
const _cam = new THREE.Vector3();
const _parent = new THREE.Quaternion();
const _yaw = new THREE.Quaternion();
const _fwd = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/**
 * Une fois par image, juste avant le rendu : tourne le pantin vers la caméra (autour de la verticale) et
 * affiche la vue qui correspond à l'angle entre son cap et la caméra (face, dos, profil gauche ou droit).
 */
function faceCamera(puppet, renderer, camera) {
  const { holder } = puppet;
  const frame = renderer.info.render.frame;
  if (holder.userData.frame === frame) return;
  holder.userData.frame = frame;
  holder.parent.getWorldPosition(_pos);
  camera.getWorldPosition(_cam);
  const toward = Math.atan2(_cam.x - _pos.x, _cam.z - _pos.z);
  _yaw.setFromAxisAngle(UP, toward);
  holder.parent.getWorldQuaternion(_parent);
  _fwd.set(0, 0, 1).applyQuaternion(_parent); // regard du personnage (+z local)
  const pick = pickView(Math.atan2(_fwd.x, _fwd.z) - toward, puppet.view);
  const ready = puppet.materials[pick.view].userData.state === 'ready';
  if (!ready) requestView(puppet.materials[pick.view]);
  if (ready && (pick.view !== puppet.view || pick.mirror !== puppet.mirror)) {
    for (const [name, group] of Object.entries(puppet.views)) group.visible = name === pick.view;
    puppet.views.side.scale.x = pick.mirror ? -1 : 1;
    puppet.view = pick.view;
    puppet.mirror = pick.mirror;
  }
  holder.quaternion.copy(_parent.invert().multiply(_yaw));
  holder.updateMatrixWorld(true);
}

const composed = new WeakMap();

function buildSvgCharacter(props) {
  // SVG des vues composés une fois par définition (les passants réutilisent les habitants)
  let svgs = composed.get(props);
  if (!svgs) { svgs = characterViews(props, atelier.pack.parts); composed.set(props, svgs); }
  const g = new THREE.Group();
  const holder = new THREE.Group();
  // joints : ceux de la vue de face (tests) ; all : ceux de toutes les vues (animés ensemble)
  const puppet = { holder, views: {}, materials: {}, joints: null, all: [], view: 'front', mirror: false };
  for (const [viewName, view] of Object.entries(VIEWS)) {
    const material = puppetMaterial(svgs[viewName], view, viewName !== 'front');
    puppet.materials[viewName] = material;
    const group = new THREE.Group();
    group.visible = viewName === 'front';
    const joints = {};
    for (const [name, piece] of Object.entries(view.pieces)) {
      const { pivot: [px, py], joint: jx = px, z } = piece;
      const joint = new THREE.Group();
      joint.position.set((jx - 100) * UNIT, (FEET_Y - py) * UNIT, z);
      joint.userData.swing = piece.swing || 0;
      const mesh = new THREE.Mesh(piece.geometry, material);
      mesh.onBeforeRender = (renderer, _scene, camera) => faceCamera(puppet, renderer, camera);
      joint.add(mesh);
      group.add(joint);
      joints[name] = joint;
      puppet.all.push(joint);
    }
    holder.add(group);
    puppet.views[viewName] = group;
    if (viewName === 'front') puppet.joints = joints;
  }
  g.add(holder);
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.26, 16), SHADOW);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.01;
  g.add(shadow);
  g.userData.puppet = puppet;
  g.userData.phase = 0;
  return g;
}

/** Assombrit les personnages de l'atelier la nuit (leurs plans ne reçoivent pas l'éclairage). */
export function setCharacterNight(darkness) {
  night = Math.min(0.55, darkness * 0.6);
  for (const m of puppets.values()) m.color.setScalar(1 - night);
}

/** Construit un personnage (~0,95 unité de haut, pieds en y = 0, regard vers +z). */
export function buildCharacter(look) {
  const svgProps = svgCharacter(look);
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

  // Ombre portée simplifiée (disque) : bien moins coûteux que des ombres temps réel.
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.26, 16), SHADOW);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.01;
  g.add(shadow);

  g.userData.limbs = { legL, legR, armL, armR };
  g.userData.phase = 0;
  return g;
}

const SHADOW = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25, depthWrite: false });

/** Anime la marche : balancement des jambes et des bras proportionnel à la vitesse. */
export function animateCharacter(g, dt, speed) {
  const moving = speed > 0.05;
  if (g.userData.puppet) {
    // Pantin : jambes en ciseaux, bras en opposition (toutes les vues), léger appui à chaque pas ; repos à l'arrêt.
    const { all, holder } = g.userData.puppet;
    g.userData.phase += dt * (moving ? 9 * Math.min(1.4, speed) : 0);
    const s = moving ? Math.sin(g.userData.phase) : 0;
    const k = Math.min(1, dt * 14);
    for (const j of all) if (j.userData.swing) j.rotation.z += (s * j.userData.swing - j.rotation.z) * k;
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
