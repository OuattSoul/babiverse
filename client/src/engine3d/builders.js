// Construction en volume d'une zone à partir de ses données (cartes ASCII + décors).
// 1 unité = 1 case ; x = colonne, z = ligne de la grille.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { cellsOf, findBuildings, wallRects } from '../world/structures.js';
import { placeholderFor } from '../world/ads.js';
import { paintGround } from './groundPainter.js';
import { canvasTexture, mat } from './materials.js';
import { placeIcon } from '../world/icons.js';
import { buildAtelierBuilding, buildAtelierProp, buildAtelierSurface } from './atelierBuilders.js';
import { castShadows } from './quality.js';
import { kitBuilding, kitLamp, kitPlants, kitVehicle, PLANT_CELLS } from './cityKit.js';

const geoCache = new Map();
function geo(key, make) {
  if (!geoCache.has(key)) {
    const g = make();
    g.userData.shared = true; // partagée entre zones : jamais libérée au changement de zone
    geoCache.set(key, g);
  }
  return geoCache.get(key);
}
const boxGeo = (w, h, d) => geo(`b${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d));
const cylGeo = (rt, rb, h, s = 8) => geo(`c${rt},${rb},${h},${s}`, () => new THREE.CylinderGeometry(rt, rb, h, s));

function mesh(geometry, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(x, y, z);
  return m;
}
const flat = (color) => mat(color, { flatShading: true });

// --- Sol --------------------------------------------------------------------------

function buildGround(zone) {
  const h = zone.map.length;
  const w = zone.map[0].length;
  const tex = new THREE.CanvasTexture(paintGround(zone));
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const material = new THREE.MeshLambertMaterial({ map: tex });
  material.userData.owned = true;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(w, h), material);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(w / 2, 0, h / 2);
  ground.name = 'ground';
  return ground;
}

// --- Bâtiments -----------------------------------------------------------------------

const FACADE = { W: '#efe3c8', H: '#efe3c8', Y: '#f2c14e', h: '#f2c14e' };
const ROOF = { r: '#9c5b3c', o: '#c8874a', g: '#6d8ea8' };
// Bâtiments en modèles réduits : murs de 1,05 unité (porte à hauteur d'un personnage de 0,95),
// toit bas, volume en retrait de sa parcelle de cases pour dégager rues et cours.
export const WALL_H = 1.05;
const INSET = 0.3; // retrait total (largeur et profondeur) par rapport aux cases occupées
export const ROOF_MAX = 0.5;
const PX = 64; // résolution des façades : pixels par case
const FH = Math.round(WALL_H * PX);

function paintFacade(ctx, facade, base) {
  [...facade].forEach((ch, i) => {
    const ox = i * PX;
    ctx.fillStyle = FACADE[ch] || base;
    ctx.fillRect(ox, 0, PX, FH);
    if (ch === 'H' || ch === 'h') {
      ctx.fillStyle = '#34495e'; ctx.fillRect(ox + 14, 20, 36, 28);
      ctx.fillStyle = '#7fb3d5'; ctx.fillRect(ox + 18, 24, 12, 20); ctx.fillRect(ox + 34, 24, 12, 20);
      ctx.fillStyle = '#ecf0f1'; ctx.fillRect(ox + 12, 48, 40, 4);
    }
    if (ch === 'D') {
      ctx.fillStyle = '#6e3b1f'; ctx.fillRect(ox + 14, 6, 36, FH - 6);
      ctx.fillStyle = '#8a4b28'; ctx.fillRect(ox + 18, 10, 28, FH - 12);
      ctx.fillStyle = '#f1c40f'; ctx.fillRect(ox + 38, 38, 4, 6);
    }
  });
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  ctx.fillRect(0, FH - 10, facade.length * PX, 10); // soubassement
}

/**
 * Bâtiment en volume. `b` : rectangle de cases (x0..x1, y0..y1), rangée de façade, toit,
 * orientation (S : façade côté +z, N : côté -z) et enseigne facultative.
 */
export function buildBuilding(b) {
  if (b.atelier) return castShadows(buildAtelierBuilding(b));
  const cw = b.x1 - b.x0 + 1;
  const cd = b.y1 - b.y0 + 1;
  const w = cw - INSET;
  const d = cd - INSET;
  const north = b.facing === 'N';
  const g = new THREE.Group();
  g.position.set(b.x0 + cw / 2, 0, b.y0 + cd / 2);
  const counts = {};
  for (const ch of b.facade) if (FACADE[ch]) counts[FACADE[ch]] = (counts[FACADE[ch]] || 0) + 1;
  const base = Object.entries(counts).sort((a, c) => c[1] - a[1])[0]?.[0] || '#efe3c8';
  const kit = kitBuilding(b, { roof: ROOF[b.roof], wall: base, awning: b.sign?.bg });
  if (kit) return castShadows(dressKitBuilding(b, g, kit));

  const front = new THREE.MeshLambertMaterial({ map: canvasTexture(cw * PX, FH, (ctx) => paintFacade(ctx, b.facade, base)) });
  front.userData.owned = true;
  const side = new THREE.MeshLambertMaterial({
    map: canvasTexture(PX, FH, (ctx) => {
      ctx.fillStyle = base; ctx.fillRect(0, 0, PX, FH);
      ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.fillRect(0, FH - 10, PX, 10);
    }),
  });
  side.userData.owned = true;
  const top = new THREE.MeshLambertMaterial({ color: base });
  top.userData.owned = true;
  // Ordre des faces d'une boîte : +x, -x, +y, -y, +z (sud), -z (nord).
  const faces = north ? [side, side, top, top, side, front] : [side, side, top, top, front, side];
  const walls = new THREE.Mesh(new THREE.BoxGeometry(w, WALL_H, d), faces);
  walls.position.y = WALL_H / 2;
  g.add(walls);

  // Toit à quatre pans, bas et débordant : un cône à 4 segments tourné de 45° a une base carrée.
  const roofMat = new THREE.MeshLambertMaterial({ color: ROOF[b.roof], flatShading: true });
  roofMat.userData.owned = true;
  const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1), roofMat);
  roof.rotation.y = Math.PI / 4;
  roof.scale.set(w + 0.16, Math.min(ROOF_MAX, 0.25 + Math.min(w, d) * 0.14), d + 0.16);
  roof.position.y = WALL_H + roof.scale.y / 2;
  g.add(roof);
  const fade = [side, top, front, roofMat];

  if (b.sign) {
    // Enseigne en saillie au-dessus de la porte, sous le débord du toit : l'icône du lieu pour les bâtiments du
    // jeu, le nom choisi par le joueur pour sa boutique.
    const own = 'owner' in b;
    const text = own ? b.sign.text : placeIcon(b);
    const sw = own ? Math.min(w - 0.2, 0.35 + text.length * 0.12) : 0.62;
    const sign = signBoard(text, b.sign.bg, b.sign.fg, sw, own ? 0.22 : 0.3);
    sign.position.set(0, WALL_H - 0.16, (north ? -1 : 1) * (d / 2 + 0.12));
    if (north) sign.rotation.y = Math.PI;
    g.add(sign);
    fade.push(...sign.material.filter((m) => m.userData.owned));
  }
  g.userData.kind = 'building';
  // Matériaux propres au bâtiment : il peut devenir transparent s'il cache le joueur.
  g.userData.fadeMaterials = fade;
  return castShadows(g);
}

/** Bâtiment en modèle du kit : tourné si sa façade donne au nord, enseigne au-dessus de la porte. */
function dressKitBuilding(b, g, kit) {
  const holder = new THREE.Group();
  if (b.facing === 'N') holder.rotation.y = Math.PI;
  holder.add(kit.group);
  const fade = [...kit.materials];
  if (b.sign) {
    const own = 'owner' in b;
    const text = own ? b.sign.text : placeIcon(b);
    const sw = own ? Math.min(b.facade.length - INSET - 0.2, 0.35 + text.length * 0.12) : 0.62;
    const sign = signBoard(text, b.sign.bg, b.sign.fg, sw, own ? 0.22 : 0.3);
    sign.position.set(kit.door, Math.min(kit.height * 0.62, WALL_H - 0.16), kit.front + 0.06);
    holder.add(sign);
    fade.push(...sign.material.filter((m) => m.userData.owned));
  }
  g.add(holder);
  g.userData.kind = 'building';
  g.userData.fadeMaterials = fade;
  return g;
}

function buildWalls(zone, ch, height, color) {
  const g = new THREE.Group();
  for (const r of wallRects(zone.map, ch)) {
    const w = r.x1 - r.x0 + 1;
    const d = r.y1 - r.y0 + 1;
    g.add(mesh(new THREE.BoxGeometry(w, height, d), mat(color), r.x0 + w / 2, height / 2, r.y0 + d / 2));
  }
  return g;
}

// --- Végétation et mobilier (une case) ------------------------------------------------

const CELL_BUILDERS = {
  T: () => {
    const g = new THREE.Group();
    g.add(mesh(cylGeo(0.08, 0.12, 0.9, 6), flat('#6b4226'), 0, 0.45, 0));
    g.add(mesh(geo('canopy', () => new THREE.IcosahedronGeometry(0.62, 0)), flat('#2f6b2f'), 0, 1.25, 0));
    g.add(mesh(geo('canopy2', () => new THREE.IcosahedronGeometry(0.38, 0)), flat('#3d8a3d'), -0.25, 1.55, 0.15));
    for (const [x, y, z] of [[0.35, 1.0, 0.3], [-0.3, 1.1, 0.35], [0.1, 0.95, -0.4]]) {
      g.add(mesh(geo('mango', () => new THREE.SphereGeometry(0.07, 6, 5)), mat('#f0a020'), x, y, z));
    }
    return g;
  },
  p: () => {
    const g = new THREE.Group();
    const trunk = mesh(cylGeo(0.05, 0.09, 1.9, 6), flat('#8b6b3e'), 0, 0.95, 0);
    trunk.rotation.z = 0.08;
    g.add(trunk);
    for (let i = 0; i < 6; i++) {
      const leaf = mesh(boxGeo(0.95, 0.03, 0.2), flat('#2e7d32'));
      const pivot = new THREE.Group();
      pivot.position.set(0.08, 1.9, 0);
      pivot.rotation.y = (i / 6) * Math.PI * 2;
      leaf.position.x = 0.45;
      leaf.rotation.z = -0.45;
      pivot.add(leaf);
      g.add(pivot);
    }
    return g;
  },
  '%': () => {
    const g = new THREE.Group();
    g.add(mesh(geo('bush', () => new THREE.IcosahedronGeometry(0.42, 0)), flat('#2e7d32'), 0, 0.35, 0));
    for (const [x, z] of [[0.25, 0.2], [-0.2, 0.25], [0.05, -0.3]]) g.add(mesh(boxGeo(0.08, 0.08, 0.08), mat('#e91e63'), x, 0.62, z));
    return g;
  },
  L: (map, x, y) => {
    const g = new THREE.Group();
    g.add(mesh(boxGeo(1, 0.3, 0.9), mat('#5d4037'), 0, 0.15, 0));
    g.add(mesh(boxGeo(0.96, 0.12, 0.84), mat('#f5f5f5'), 0, 0.36, 0));
    g.add(mesh(boxGeo(0.97, 0.06, 0.5), mat('#e67e22'), 0, 0.43, 0.17));
    if (map[y][x - 1] !== 'L') g.add(mesh(boxGeo(0.3, 0.1, 0.6), mat('#ffffff'), -0.3, 0.46, -0.05));
    return g;
  },
  S: () => {
    const g = new THREE.Group();
    g.add(mesh(boxGeo(0.95, 1.4, 0.42), mat('#7b5232'), 0, 0.7, -0.25));
    const colors = ['#e74c3c', '#f1c40f', '#27ae60', '#3498db', '#ecf0f1', '#e67e22'];
    let k = 0;
    for (const y of [0.35, 0.75, 1.15]) {
      for (const x of [-0.3, -0.1, 0.1, 0.3]) g.add(mesh(boxGeo(0.14, 0.22, 0.12), mat(colors[k++ % colors.length]), x, y, -0.02));
    }
    return g;
  },
  Q: () => {
    const g = new THREE.Group();
    g.add(mesh(boxGeo(1, 0.85, 0.7), mat('#8d6e63'), 0, 0.425, 0));
    g.add(mesh(boxGeo(1.02, 0.06, 0.74), mat('#a1887f'), 0, 0.88, 0));
    return g;
  },
  K: () => {
    const g = new THREE.Group();
    g.add(mesh(boxGeo(0.95, 0.06, 0.8), mat('#795548'), 0, 0.7, 0));
    for (const [x, z] of [[-0.4, -0.33], [0.4, -0.33], [-0.4, 0.33], [0.4, 0.33]]) g.add(mesh(boxGeo(0.06, 0.7, 0.06), mat('#5d4037'), x, 0.35, z));
    return g;
  },
  Z: () => {
    const g = new THREE.Group();
    g.add(mesh(boxGeo(0.8, 1.5, 0.6), mat('#ecf0f1'), 0, 0.75, -0.15));
    g.add(mesh(boxGeo(0.04, 0.3, 0.04), mat('#95a5a6'), 0.3, 1.0, 0.16));
    return g;
  },
};

function buildCells(zone) {
  const g = new THREE.Group();
  // Manguiers, palmiers et buissons du kit : maillages instanciés (gardés hors de la fusion du décor).
  const plants = kitPlants((ch) => cellsOf(zone.map, ch));
  if (plants) g.add(plants);
  for (const [ch, make] of Object.entries(CELL_BUILDERS)) {
    if (plants && PLANT_CELLS.includes(ch)) continue;
    for (const [x, y] of cellsOf(zone.map, ch)) {
      const obj = make(zone.map, x, y);
      obj.position.set(x + 0.5, 0, y + 0.5);
      g.add(obj);
    }
  }
  return g;
}

// --- Décors multi-cases ---------------------------------------------------------------

function wheels(g, xs, z, r = 0.15) {
  for (const x of xs) {
    for (const s of [-1, 1]) {
      const w = mesh(cylGeo(r, r, 0.1, 10), mat('#222'), x, r, s * z);
      w.rotation.x = Math.PI / 2;
      g.add(w);
    }
  }
}

function signBoard(text, bg, fg, w = 0.9, h = 0.38) {
  const material = new THREE.MeshLambertMaterial({
    map: canvasTexture(320, Math.round(320 * (h / w)), (ctx, cw, ch) => {
      ctx.fillStyle = bg; ctx.fillRect(0, 0, cw, ch);
      // Taille de police ajustée pour que le texte tienne toujours sur le panneau.
      let size = Math.round(ch * 0.55);
      ctx.font = `800 ${size}px system-ui, sans-serif`;
      while (size > 8 && ctx.measureText(text).width > cw - 16) { size -= 1; ctx.font = `800 ${size}px system-ui, sans-serif`; }
      ctx.fillStyle = fg; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, cw / 2, ch / 2 + 2);
    }),
  });
  material.userData.owned = true;
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.04), [mat(bg), mat(bg), mat(bg), mat(bg), material, mat(bg)]);
}

// Meuble d'un intérieur conçu dans l'atelier : forme simple à la couleur du meuble, sur toute son emprise.
// def : { shape, color, height (px de l'atelier, 16 px ≈ 1 unité), w, h (cases) }.
function buildFurniture(def) {
  const g = new THREE.Group();
  const w = (def.w || 1) - 0.1;
  const d = (def.h || 1) - 0.1;
  const color = def.color || '#a07a4a';
  const H = Math.max(0.15, Math.min(1.8, (def.height || 10) / 16));
  const dark = new THREE.Color(color).multiplyScalar(0.7).getStyle();
  switch (def.shape) {
    case 'bed':
      g.add(mesh(boxGeo(w, 0.3, d), mat('#5d4037'), 0, 0.15, 0));
      g.add(mesh(boxGeo(w - 0.06, 0.12, d - 0.06), mat('#f5f5f5'), 0, 0.36, 0));
      g.add(mesh(boxGeo(w - 0.04, 0.06, d * 0.55), mat(color), 0, 0.43, d * 0.2));
      g.add(mesh(boxGeo(w * 0.6, 0.1, 0.3), mat('#ffffff'), 0, 0.46, -d / 2 + 0.25));
      break;
    case 'table':
      g.add(mesh(boxGeo(w, 0.06, d), mat(color), 0, 0.7, 0));
      for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) g.add(mesh(boxGeo(0.06, 0.7, 0.06), mat(dark), x * (w / 2 - 0.06), 0.35, z * (d / 2 - 0.06)));
      break;
    case 'seat':
      g.add(mesh(boxGeo(w, 0.4, d), mat(color), 0, 0.2, 0));
      g.add(mesh(boxGeo(w, 0.45, Math.min(0.2, d / 3)), mat(dark), 0, 0.55, -d / 2 + 0.1));
      break;
    case 'screen':
      g.add(mesh(boxGeo(w, 0.45, d * 0.8), mat('#5a4632'), 0, 0.225, 0));
      g.add(mesh(boxGeo(w * 0.8, 0.5, 0.06), mat('#1f1f22'), 0, 0.75, 0));
      break;
    case 'plant':
      g.add(mesh(cylGeo(0.16, 0.12, 0.3, 8), mat('#a0522d'), 0, 0.15, 0));
      g.add(mesh(geo('bush', () => new THREE.IcosahedronGeometry(0.42, 0)), flat(color), 0, 0.6, 0));
      break;
    case 'lamp':
      g.add(mesh(cylGeo(0.03, 0.03, 1.1, 6), mat('#555'), 0, 0.55, 0));
      g.add(mesh(cylGeo(0.12, 0.2, 0.22, 8), mat(color), 0, 1.15, 0));
      break;
    case 'counter':
      g.add(mesh(boxGeo(w, Math.max(0.8, H), d), mat(color), 0, Math.max(0.8, H) / 2, 0));
      g.add(mesh(boxGeo(w + 0.02, 0.06, d + 0.02), mat(dark), 0, Math.max(0.8, H) + 0.03, 0));
      break;
    default: // cabinet, box
      g.add(mesh(boxGeo(w, H, d), mat(color), 0, H / 2, 0));
      if (H > 0.9) g.add(mesh(boxGeo(0.04, H * 0.6, 0.02), mat(dark), 0, H / 2, d / 2 + 0.01));
  }
  return g;
}

// Véhicules de l'atelier : modèles du jeu (longueur selon x), tournés pour que l'avant suive l'orientation choisie.
const VEHICLE_KINDS = { taxi: 'taxi', car: 'voiture', moto: 'moto', bike: 'moto', gbaka: 'gbaka', bus: 'gbaka', utility: 'gbaka', emergency: 'gbaka' };
const FACING_ROT = { S: 0, E: Math.PI / 2, N: Math.PI, W: -Math.PI / 2 };

const PROP_BUILDERS = {
  furniture: (_state, def) => buildFurniture(def),
  atl_prop: (_state, def) => buildAtelierProp(def),
  atl_surface: (_state, def) => buildAtelierSurface(def),
  atl_vehicle: (state, def) => {
    const r = def.render || {};
    const model = PROP_BUILDERS[VEHICLE_KINDS[r.kind] || 'voiture'](state, { color: r.materials?.body });
    model.rotation.y = -Math.PI / 2; // avant du modèle (+x) vers +z
    const g = new THREE.Group();
    g.rotation.y = FACING_ROT[def.facing] ?? 0;
    g.add(model);
    return g;
  },
  taxi: () => {
    const kit = kitVehicle('taxi');
    if (kit) return kit;
    const g = new THREE.Group();
    g.add(mesh(boxGeo(1.8, 0.4, 0.85), flat('#f39c12'), 0, 0.37, 0));
    g.add(mesh(boxGeo(1.0, 0.32, 0.78), mat('#2c3e50'), -0.1, 0.73, 0));
    g.add(mesh(boxGeo(0.3, 0.1, 0.16), mat('#ffffff'), -0.1, 0.94, 0));
    wheels(g, [-0.58, 0.58], 0.4);
    return g;
  },
  // Taxi communal : vert, bande blanche.
  woroworo: () => {
    const kit = kitVehicle('woroworo');
    if (kit) return kit;
    const g = new THREE.Group();
    g.add(mesh(boxGeo(1.8, 0.4, 0.85), flat('#27ae60'), 0, 0.37, 0));
    g.add(mesh(boxGeo(1.82, 0.08, 0.87), mat('#ecf0f1'), 0, 0.42, 0));
    g.add(mesh(boxGeo(1.0, 0.32, 0.78), mat('#2c3e50'), -0.1, 0.73, 0));
    wheels(g, [-0.58, 0.58], 0.4);
    return g;
  },
  voiture: (state, def) => {
    const kit = kitVehicle('voiture', def.color);
    if (kit) return kit;
    const g = new THREE.Group();
    g.add(mesh(boxGeo(1.8, 0.38, 0.85), flat(def.color || '#c0392b'), 0, 0.36, 0));
    g.add(mesh(boxGeo(0.95, 0.3, 0.76), mat('#34495e'), -0.15, 0.7, 0));
    wheels(g, [-0.58, 0.58], 0.4);
    return g;
  },
  moto: (state, def) => {
    const g = new THREE.Group();
    g.add(mesh(boxGeo(0.7, 0.18, 0.14), flat(def.color || '#c0392b'), 0, 0.32, 0));
    for (const x of [-0.32, 0.32]) {
      const w = mesh(cylGeo(0.14, 0.14, 0.06, 10), mat('#222'), x, 0.14, 0);
      w.rotation.x = Math.PI / 2;
      g.add(w);
    }
    // Conducteur stylisé : buste, tête casquée, bras vers le guidon.
    g.add(mesh(boxGeo(0.2, 0.32, 0.26), flat('#2980b9'), -0.08, 0.6, 0));
    g.add(mesh(boxGeo(0.16, 0.16, 0.16), mat('#111'), -0.06, 0.86, 0));
    g.add(mesh(boxGeo(0.26, 0.06, 0.3), mat('#7f8c8d'), 0.22, 0.52, 0));
    return g;
  },
  gbaka: () => {
    const kit = kitVehicle('gbaka');
    if (kit) return kit;
    const g = new THREE.Group();
    g.add(mesh(boxGeo(2.8, 0.95, 0.92), flat('#ecf0f1'), 0, 0.62, 0));
    g.add(mesh(boxGeo(2.82, 0.12, 0.94), mat('#2980b9'), 0, 0.5, 0));
    g.add(mesh(boxGeo(2.2, 0.28, 0.94), mat('#34495e'), -0.2, 0.88, 0));
    g.add(mesh(boxGeo(0.06, 0.4, 0.8), mat('#85c1e9'), 1.41, 0.85, 0));
    wheels(g, [-0.95, 0.95], 0.45, 0.17);
    return g;
  },
  parasol: () => {
    const g = new THREE.Group();
    g.add(mesh(cylGeo(0.025, 0.025, 1.35, 6), mat('#7f8c8d'), 0, 0.68, 0));
    g.add(mesh(geo('parasol', () => new THREE.ConeGeometry(0.62, 0.3, 8)), flat('#c0392b'), 0, 1.42, 0));
    g.add(mesh(cylGeo(0.3, 0.3, 0.05, 12), mat('#f5f5f5'), 0, 0.55, 0));
    for (const a of [0, Math.PI]) g.add(mesh(boxGeo(0.22, 0.4, 0.22), mat('#e74c3c'), Math.cos(a) * 0.45, 0.2, Math.sin(a) * 0.45));
    return g;
  },
  crates: () => {
    const g = new THREE.Group();
    for (const [x, y, z, c] of [[-0.18, 0.18, 0.1, '#a0522d'], [0.2, 0.18, 0.05, '#8b4513'], [0, 0.54, 0.08, '#cd853f']]) g.add(mesh(boxGeo(0.36, 0.36, 0.36), flat(c), x, y, z));
    return g;
  },
  kiosk: (state) => {
    const g = new THREE.Group();
    const posts = (h) => {
      for (const [x, z] of [[-0.95, -0.4], [0.95, -0.4], [-0.95, 0.4], [0.95, 0.4]]) g.add(mesh(cylGeo(0.03, 0.03, h, 6), mat('#6d4c41'), x, h / 2, z));
    };
    if (!state.open) {
      posts(1.1);
      const sign = signBoard('À LOUER', '#fdf2e9', '#c0392b', 1.0, 0.4);
      sign.position.set(0, 1.25, 0.42);
      g.add(sign);
      return g;
    }
    posts(1.65);
    g.add(mesh(boxGeo(1.9, 0.85, 0.55), flat('#8d6e63'), 0, 0.43, 0.15));
    const awning = new THREE.MeshLambertMaterial({
      map: canvasTexture(128, 32, (ctx) => { for (let i = 0; i < 8; i++) { ctx.fillStyle = i % 2 ? '#ffffff' : '#1f6feb'; ctx.fillRect(i * 16, 0, 16, 32); } }),
    });
    awning.userData.owned = true;
    g.add(mesh(new THREE.BoxGeometry(2.15, 0.07, 1.15), awning, 0, 1.68, 0));
    const bottles = ['#27ae60', '#c0392b', '#f39c12', '#8e44ad'];
    for (let i = 0; i < 8; i++) g.add(mesh(boxGeo(0.07, 0.22, 0.07), mat(bottles[i % 4]), -0.75 + i * 0.21, 0.97, 0.15));
    const sign = signBoard('BOISSONS', '#1f6feb', '#ffffff', 1.2, 0.3);
    sign.position.set(0, 1.9, 0.5);
    g.add(sign);
    return g;
  },
  garba_stand: () => {
    const g = new THREE.Group();
    g.add(mesh(boxGeo(1.9, 0.08, 0.8), flat('#a0522d'), 0, 0.72, 0));
    for (const [x, z] of [[-0.85, -0.33], [0.85, -0.33], [-0.85, 0.33], [0.85, 0.33]]) g.add(mesh(boxGeo(0.06, 0.72, 0.06), mat('#6d4c41'), x, 0.36, z));
    for (const x of [-0.6, -0.15]) {
      g.add(mesh(cylGeo(0.22, 0.16, 0.12, 12), mat('#ecf0f1'), x, 0.82, 0));
      g.add(mesh(cylGeo(0.18, 0.18, 0.02, 12), mat('#f7dc6f'), x, 0.885, 0));
    }
    g.add(mesh(cylGeo(0.26, 0.22, 0.16, 12), mat('#2c3e50'), 0.5, 0.84, 0));
    g.add(mesh(cylGeo(0.2, 0.2, 0.02, 12), mat('#e59866'), 0.5, 0.92, 0));
    return g;
  },
  bench: () => {
    const g = new THREE.Group();
    g.add(mesh(boxGeo(0.9, 0.06, 0.32), flat('#8d5a2b'), 0, 0.4, 0));
    g.add(mesh(boxGeo(0.9, 0.26, 0.05), flat('#8d5a2b'), 0, 0.62, -0.15));
    for (const x of [-0.38, 0.38]) g.add(mesh(boxGeo(0.06, 0.4, 0.3), mat('#4a4a4f'), x, 0.2, 0));
    return g;
  },
  bin: () => {
    const g = new THREE.Group();
    g.add(mesh(cylGeo(0.17, 0.15, 0.5, 10), mat('#1e8449'), 0, 0.25, 0));
    g.add(mesh(cylGeo(0.19, 0.19, 0.05, 10), mat('#145a32'), 0, 0.52, 0));
    return g;
  },
  stop: () => {
    const g = new THREE.Group();
    g.add(mesh(cylGeo(0.03, 0.03, 1.5, 6), mat('#95a5a6'), 0, 0.75, 0));
    const octo = mesh(cylGeo(0.22, 0.22, 0.03, 8), mat('#c0392b'), 0, 1.5, 0.03);
    octo.rotation.x = Math.PI / 2;
    octo.rotation.y = Math.PI / 8;
    g.add(octo);
    g.add(mesh(boxGeo(0.26, 0.06, 0.035), mat('#ffffff'), 0, 1.5, 0.05));
    return g;
  },
  roadsign: (state, def) => {
    const g = new THREE.Group();
    g.add(mesh(cylGeo(0.035, 0.035, 1.7, 6), mat('#95a5a6'), 0, 0.85, 0));
    const s = signBoard(def.text, '#1f6feb', '#ffffff', 1.2, 0.3);
    s.position.set(0, 1.62, 0.04);
    g.add(s);
    return g;
  },
  pole: () => {
    const g = new THREE.Group();
    g.add(mesh(cylGeo(0.05, 0.07, 2.6, 6), flat('#6b4f3a'), 0, 1.3, 0));
    g.add(mesh(boxGeo(0.7, 0.06, 0.06), flat('#6b4f3a'), 0, 2.42, 0));
    for (const x of [-0.3, 0.3]) g.add(mesh(boxGeo(0.05, 0.08, 0.05), mat('#ecf0f1'), x, 2.49, 0));
    return g;
  },
  lamp: () => {
    const kit = kitLamp();
    if (kit) {
      // Tête allumée la nuit (matériau partagé LAMP, voir setNight) au bout du bras du modèle.
      const g = new THREE.Group();
      g.add(kit.group, mesh(boxGeo(0.2, 0.06, 0.14), LAMP, kit.head.x, kit.head.y, kit.head.z));
      return g;
    }
    const g = new THREE.Group();
    g.add(mesh(cylGeo(0.035, 0.05, 2.1, 6), mat('#5d6d7e'), 0, 1.05, 0));
    g.add(mesh(boxGeo(0.06, 0.05, 0.45), mat('#5d6d7e'), 0, 2.08, 0.2));
    g.add(mesh(boxGeo(0.24, 0.07, 0.16), LAMP, 0, 2.03, 0.4));
    return g;
  },
  // Support publicitaire : panneau sur poteaux (bord de route) ou totem (zone commerciale).
  // Le support ne connaît que ses dimensions ; le visuel affiché dépend de l'état résolu
  // (world/ads.js) et peut changer sans reconstruire la géométrie du reste de la scène.
  billboard: (state, def) => {
    const g = new THREE.Group();
    const board = def.board || { w: 1.9, h: 0.95 };
    const totem = def.support === 'totem';
    const bottom = totem ? 0.35 : 1.28;
    if (totem) g.add(mesh(boxGeo(board.w + 0.12, 0.35, 0.3), flat('#5d6d7e'), 0, 0.175, 0));
    else for (const x of [-board.w * 0.37, board.w * 0.37]) g.add(mesh(cylGeo(0.05, 0.05, bottom + 0.05, 6), mat('#5d6d7e'), x, (bottom + 0.05) / 2, 0));
    const material = adMaterial(state.view || { status: 'free' }, board);
    const frame = mat('#2c3e50');
    const panel = new THREE.Mesh(new THREE.BoxGeometry(board.w, board.h, 0.08), [frame, frame, frame, frame, material, frame]);
    panel.position.set(0, bottom + board.h / 2 + 0.02, 0);
    g.add(panel);
    if (def.facing === 'N') g.rotation.y = Math.PI;
    return g;
  },
  plot: (state, def) => {
    // Contour de la parcelle : bandes blanches au sol et piquets aux angles.
    const g = new THREE.Group();
    const w = def.w;
    const h = def.h;
    const stripe = mat('#fdfefe');
    for (const [x, z, sx, sz] of [[0, -h / 2 + 0.04, w - 0.1, 0.06], [0, h / 2 - 0.04, w - 0.1, 0.06], [-w / 2 + 0.04, 0, 0.06, h - 0.1], [w / 2 - 0.04, 0, 0.06, h - 0.1]]) {
      g.add(mesh(new THREE.BoxGeometry(sx, 0.02, sz), stripe, x, 0.012, z));
    }
    for (const [x, z] of [[-w / 2 + 0.1, -h / 2 + 0.1], [w / 2 - 0.1, -h / 2 + 0.1], [-w / 2 + 0.1, h / 2 - 0.1], [w / 2 - 0.1, h / 2 - 0.1]]) {
      g.add(mesh(boxGeo(0.07, 0.35, 0.07), mat('#e67e22'), x, 0.175, z));
    }
    return g;
  },
  plotsign: (state, def) => {
    const g = new THREE.Group();
    g.add(mesh(boxGeo(0.06, 0.9, 0.06), mat('#6d4c41'), 0, 0.45, 0));
    // Libre : panneau jaune. Achetée : nom du propriétaire (vert si c'est la mienne). Non disponible : gris.
    const owner = state.owner;
    let text = owner ? `TERRAIN DE ${owner.toUpperCase()}` : `PARCELLE ${def.plot} · LIBRE`;
    let bg = owner ? (state.mine ? '#27ae60' : '#ecf0f1') : '#f1c40f';
    if (state.unavailable) { text = `PARCELLE ${def.plot} · NON DISPONIBLE`; bg = '#bdc3c7'; }
    const s = signBoard(text, bg, owner && state.mine ? '#ffffff' : '#2b2118', 1.1, 0.32);
    s.position.set(0, 0.95, 0.04);
    g.add(s);
    if (def.facing === 'N') g.rotation.y = Math.PI;
    return g;
  },
  sign_maquis: () => {
    const g = new THREE.Group();
    g.add(mesh(boxGeo(0.08, 1.2, 0.08), mat('#4e342e'), 0, 0.6, 0.3));
    const s = signBoard('MAQUIS', '#27ae60', '#ffffff');
    s.position.set(0, 1.35, 0.34);
    g.add(s);
    return g;
  },
};

// --- Visuels publicitaires ---------------------------------------------------------------

const AD_PX = 256; // pixels par unité de panneau
const imageCache = new Map();

/** Image d'annonce chargée une seule fois (promesse partagée ; null si le chargement échoue). */
function loadImage(src) {
  if (!imageCache.has(src)) {
    imageCache.set(src, new Promise((resolve) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    }));
  }
  return imageCache.get(src);
}

/**
 * Face avant d'un support : visuel de l'annonce (entier, centré, jamais déformé) ou visuel neutre.
 * Une annonce diffusée porte toujours la mention « PUB » pour être reconnue comme publicité.
 */
function adMaterial(view, board) {
  const cw = Math.round(board.w * AD_PX);
  const ch = Math.round(board.h * AD_PX);
  const ad = view.status === 'active' ? view.ad : null;
  const paintBase = (ctx) => {
    if (ad) {
      ctx.fillStyle = ad.bg; ctx.fillRect(0, 0, cw, ch);
      if (!ad.image) {
        ctx.fillStyle = ad.fg; ctx.textAlign = 'center';
        fitText(ctx, ad.title, cw, Math.round(ch * 0.2), 900); ctx.fillText(ad.title, cw / 2, ch * 0.45, cw - 24);
        fitText(ctx, ad.description || '', cw, Math.round(ch * 0.1), 500); ctx.fillText(ad.description || '', cw / 2, ch * 0.68, cw - 24);
      }
      return;
    }
    const p = placeholderFor(view);
    ctx.fillStyle = p.bg; ctx.fillRect(0, 0, cw, ch);
    ctx.fillStyle = p.fg; ctx.textAlign = 'center';
    fitText(ctx, p.title, cw, Math.round(Math.min(ch, cw) * 0.18), 900); ctx.fillText(p.title, cw / 2, ch * 0.47, cw - 24);
    fitText(ctx, p.subtitle, cw, Math.round(Math.min(ch, cw) * 0.08), 500); ctx.fillText(p.subtitle, cw / 2, ch * 0.66, cw - 24);
    if (p.dashed) { ctx.strokeStyle = p.fg; ctx.setLineDash([10, 8]); ctx.lineWidth = 4; ctx.strokeRect(10, 10, cw - 20, ch - 20); }
  };
  const tag = (ctx) => {
    if (!ad) return;
    ctx.font = '800 18px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(cw - 52, ch - 26, 48, 22);
    ctx.fillStyle = '#ffd166'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('PUB', cw - 28, ch - 15);
  };
  const tex = canvasTexture(cw, ch, (ctx) => { paintBase(ctx); tag(ctx); });
  const material = new THREE.MeshLambertMaterial({ map: tex });
  material.userData.owned = true;
  if (ad?.image) {
    loadImage(ad.image).then((img) => {
      if (!img) return; // image indisponible : le support garde son fond de couleur
      const ctx = tex.image.getContext('2d');
      paintBase(ctx);
      const k = Math.min(cw / img.naturalWidth, ch / img.naturalHeight);
      const w = img.naturalWidth * k;
      const h = img.naturalHeight * k;
      ctx.drawImage(img, (cw - w) / 2, (ch - h) / 2, w, h);
      tag(ctx);
      tex.needsUpdate = true;
    });
  }
  return material;
}

function fitText(ctx, text, cw, size, weight) {
  let s = size;
  ctx.font = `${weight} ${s}px system-ui, sans-serif`;
  while (s > 8 && ctx.measureText(text).width > cw - 24) { s -= 1; ctx.font = `${weight} ${s}px system-ui, sans-serif`; }
}

// Tête de lampadaire : partagée par tous, allumée la nuit (voir setNight).
const LAMP = new THREE.MeshBasicMaterial({ color: '#d5d8dc' });
export function setNight(darkness) {
  LAMP.color.set(darkness > 0.15 ? '#ffe9a8' : '#d5d8dc');
}

export function buildProp(def, state = {}) {
  const g = PROP_BUILDERS[def.kind](state, def);
  g.position.set(def.tile[0] + (def.w || 1) / 2, 0, def.tile[1] + (def.h || 1) / 2);
  if (def.rot) g.rotation.y = (def.rot * Math.PI) / 180;
  g.userData.kind = 'prop';
  return castShadows(g);
}

/**
 * Fusionne le décor immobile : une seule géométrie par matériau.
 * Les rayons de l'épicerie passent ainsi de ~200 objets à une dizaine d'appels de dessin.
 */
function mergeStatic(statics) {
  statics.updateMatrixWorld(true);
  const byMaterial = new Map();
  const keep = [];
  statics.traverse((o) => {
    if (!o.isMesh) return;
    if (Array.isArray(o.material) || o.isInstancedMesh || o.name === 'ground' || o.name === 'outer') { keep.push(o); return; }
    const g = o.geometry.clone().applyMatrix4(o.matrixWorld);
    // Uniformise les attributs (certaines géométries n'ont pas d'UV) pour pouvoir fusionner ; un matériau
    // texturé (modèles du kit) garde ses UV, regroupé à part de ses éventuelles géométries sans UV.
    const uv = !!o.material.map && !!g.attributes.uv;
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && !(uv && name === 'uv')) g.deleteAttribute(name);
    const geo = g.index ? g.toNonIndexed() : g;
    const key = `${o.material.uuid}|${uv}`;
    if (!byMaterial.has(key)) byMaterial.set(key, { material: o.material, geos: [] });
    byMaterial.get(key).geos.push(geo);
  });
  const out = new THREE.Group();
  for (const o of keep) {
    // Conserve la position finale (le parent, un décor, est dissous par la fusion).
    const world = o.matrixWorld.clone();
    o.removeFromParent();
    world.decompose(o.position, o.quaternion, o.scale);
    out.add(o);
  }
  for (const { material, geos } of byMaterial.values()) {
    const merged = mergeGeometries(geos);
    for (const g of geos) g.dispose();
    out.add(new THREE.Mesh(merged, material));
  }
  out.updateMatrixWorld(true);
  out.traverse((o) => { o.matrixAutoUpdate = false; o.matrixWorldAutoUpdate = false; });
  return out;
}

// Décors qui dépendent de l'état partagé de la ville : reconstruits quand il change.
export const DYNAMIC_PROPS = new Set(['kiosk', 'billboard', 'plotsign']);
// Petit mobilier : dessiné seulement quand la caméra est proche (niveau de détail).
export const DETAIL_PROPS = new Set(['bench', 'bin', 'crates', 'parasol', 'stop']);

/** Câbles électriques entre poteaux voisins d'une même rangée (un seul objet, légère courbure). */
function buildWires(props) {
  const groups = {};
  for (const p of props) if (p.wireGroup) (groups[p.wireGroup] ||= []).push(p);
  const pts = [];
  for (const list of Object.values(groups)) {
    list.sort((a, b) => a.tile[0] - b.tile[0]);
    for (let i = 0; i + 1 < list.length; i++) {
      const a = list[i].tile;
      const b = list[i + 1].tile;
      for (const off of [-0.3, 0.3]) {
        const N = 8;
        for (let k = 0; k < N; k++) {
          const seg = (t) => {
            const x = a[0] + 0.5 + off + (b[0] - a[0]) * t;
            const z = a[1] + 0.5 + (b[1] - a[1]) * t;
            const sag = Math.sin(Math.PI * t) * 0.35;
            return new THREE.Vector3(x, 2.5 - sag, z);
          };
          pts.push(seg(k / N), seg((k + 1) / N));
        }
      }
    }
  }
  if (!pts.length) return null;
  return new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: '#222222' }));
}

/**
 * Construit toute la zone. Retourne le groupe, les décors (pour mises à jour d'état) et le groupe
 * des détails (petit mobilier, câbles), masqué par la scène quand la caméra s'éloigne.
 */
export function buildZone(zone, propState) {
  const group = new THREE.Group();
  // Décor immobile : matrices calculées une fois pour toutes (gain CPU sur mobile).
  const statics = new THREE.Group();
  statics.add(buildGround(zone));
  if (zone.outdoor) {
    // Sol au-delà de l'enceinte, pour que la vue libre ne montre pas le vide (suit la taille de la carte).
    const span = Math.max(zone.map[0].length, zone.map.length) + 200;
    const outer = mesh(new THREE.PlaneGeometry(span, span), mat('#6f8f4a'), zone.map[0].length / 2, -0.02, zone.map.length / 2);
    outer.rotation.x = -Math.PI / 2;
    outer.name = 'outer';
    statics.add(outer);
  }
  // Bâtiments explicites (ville générée) ou déduits de la carte (zones dessinées à la main).
  const buildings = zone.buildings || findBuildings(zone.map).map((b) => ({ ...b, facing: 'S' }));
  for (const b of buildings) group.add(buildBuilding(b));
  statics.add(buildWalls(zone, '#', 0.7, '#a9a093'));
  statics.add(buildWalls(zone, 'w', 1.05, zone.palette?.wall || '#d9cbb0'));
  statics.add(buildCells(zone));
  // Décors : ceux qui changent avec la partie (kiosque) restent à part, les autres sont fusionnés.
  const props = [];
  const smalls = new THREE.Group();
  for (const def of zone.props || []) {
    const object = buildProp(def, propState(def));
    if (DYNAMIC_PROPS.has(def.kind)) { group.add(object); props.push({ def, object }); } else if (def.noMerge) group.add(object); else (DETAIL_PROPS.has(def.kind) ? smalls : statics).add(object);
  }
  group.add(mergeStatic(statics));
  const details = new THREE.Group();
  details.name = 'details';
  if (smalls.children.length) details.add(mergeStatic(smalls));
  const wires = buildWires(zone.props || []);
  if (wires) details.add(wires);
  group.add(details);
  // Fusion faite : les maillages fusionnés sont marqués à leur tour (le sol reçoit seulement).
  castShadows(group);
  return { group, props, details };
}

// --- Lotissement ---------------------------------------------------------------------

/**
 * Emplacements libres du lotissement (sans maison) : bordure, fond blanc semi-transparent et
 * symbole « + ». Un seul maillage instancié pour tous (jusqu'à 1 024 par bloc) : un appel de dessin.
 */
export function buildFreeLots(lots, size = 2) {
  const material = new THREE.MeshBasicMaterial({
    map: canvasTexture(128, 128, (ctx) => {
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillRect(0, 0, 128, 128);
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.lineWidth = 6;
      ctx.strokeRect(5, 5, 118, 118);
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.fillRect(56, 34, 16, 60);
      ctx.fillRect(34, 56, 60, 16);
    }),
    transparent: true,
    depthWrite: false,
  });
  material.userData.owned = true;
  const plane = new THREE.PlaneGeometry(size - 0.12, size - 0.12).rotateX(-Math.PI / 2);
  const inst = new THREE.InstancedMesh(plane, material, Math.max(1, lots.length));
  inst.count = lots.length;
  const m = new THREE.Matrix4();
  lots.forEach((l, i) => inst.setMatrixAt(i, m.makeTranslation(l.x + size / 2, 0.02, l.y + size / 2)));
  inst.instanceMatrix.needsUpdate = true;
  inst.computeBoundingSphere();
  inst.name = 'free-lots';
  return inst;
}

/** Repère jaune (cône pointe en bas) au-dessus d'une cible. */
export function makeMarker(scale = 1, color = 0xf1c40f) {
  const m = new THREE.Mesh(geo('marker', () => new THREE.ConeGeometry(0.14, 0.32, 4).rotateX(Math.PI)), new THREE.MeshBasicMaterial({ color }));
  m.scale.setScalar(scale);
  m.renderOrder = 5;
  return m;
}

/** Anneau au sol indiquant la destination d'un « toucher pour aller ». */
export function makeRing() {
  const m = new THREE.Mesh(new THREE.RingGeometry(0.18, 0.28, 24), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.03;
  return m;
}
