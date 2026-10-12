// Rendu 3D des éléments placés depuis l'atelier (bâtiments, objets, surfaces) ; les véhicules réutilisent les
// modèles du jeu (builders.js). Même style que la ville : volumes low-poly, façades peintes sur canvas.
// Repère local : façade (ou avant) vers +z, puis rotation selon l'orientation choisie dans l'atelier.
import * as THREE from 'three';
import { svgDataUrl } from '../atelier/compose.js';
import { composeKit } from '../atelier/composeKit.js';
import { atelier } from '../atelier/pack.js';
import { canvasTexture, mat } from './materials.js';

const ROT = { S: 0, E: Math.PI / 2, N: Math.PI, W: -Math.PI / 2 };
const WALL_H = 1.05; // rez-de-chaussée, comme les bâtiments du jeu
const FLOOR_H = 0.8; // étages suivants
const INSET = 0.3;
const PX = 64; // pixels de façade par unité
const M = 0.32; // unités du jeu par mètre (objets : le jeu est en modèle réduit)
const DOOR = { wood: '#6b4226', glass: '#8fc3d6', metal: '#7f8c8d' };

const owned = (m) => { m.userData.owned = true; return m; };
const box = (w, h, d, material, x = 0, y = 0, z = 0) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  return m;
};
const shade = (hex, k) => new THREE.Color(hex).multiplyScalar(k).getStyle();
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** Façade peinte : fenêtres par étage et par case, porte et vitrine au rez-de-chaussée. */
function paintWall(ctx, { cells, floors, height, wall, trim, style, door = -1, shopfront = false }) {
  const W = cells * PX;
  const Hp = height * PX;
  ctx.fillStyle = wall; ctx.fillRect(0, 0, W, Hp);
  ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.fillRect(0, Hp - 8, W, 8); // soubassement
  const floorTop = (f) => Hp - (f === 0 ? WALL_H : WALL_H + f * FLOOR_H) * PX;
  for (let f = 0; f < floors; f++) {
    const top = floorTop(f);
    const fh = (f === 0 ? WALL_H : FLOOR_H) * PX;
    if (f > 0) { ctx.fillStyle = trim; ctx.fillRect(0, top + fh - 3, W, 3); }
    for (let c = 0; c < cells; c++) {
      const x = c * PX;
      if (f === 0 && c === door) {
        ctx.fillStyle = trim; ctx.fillRect(x + 18, top + fh * 0.22, 28, fh * 0.78);
        ctx.fillStyle = DOOR[style.door_style] || DOOR.wood; ctx.fillRect(x + 21, top + fh * 0.26, 22, fh * 0.74);
        continue;
      }
      if (f === 0 && shopfront) {
        ctx.fillStyle = trim; ctx.fillRect(x + 4, top + fh * 0.25, PX - 8, fh * 0.6);
        ctx.fillStyle = '#9fd0df'; ctx.fillRect(x + 7, top + fh * 0.28, PX - 14, fh * 0.54);
        continue;
      }
      if (style.window_style === 'none') continue;
      ctx.fillStyle = trim;
      if (style.window_style === 'band') { ctx.fillRect(x, top + fh * 0.3, PX, fh * 0.32); ctx.fillStyle = '#9fc4d6'; ctx.fillRect(x, top + fh * 0.33, PX, fh * 0.26); continue; }
      for (const wx of [10, 36]) {
        ctx.fillStyle = trim; ctx.fillRect(x + wx - 2, top + fh * 0.28 - 2, 22, fh * 0.42 + 4);
        ctx.fillStyle = '#9fc4d6'; ctx.fillRect(x + wx, top + fh * 0.28, 18, fh * 0.42);
      }
    }
  }
}

function signMesh(text, bg, w) {
  const material = owned(new THREE.MeshLambertMaterial({
    map: canvasTexture(320, 80, (ctx, cw, ch) => {
      ctx.fillStyle = bg; ctx.fillRect(0, 0, cw, ch);
      let size = 44;
      ctx.font = `800 ${size}px system-ui, sans-serif`;
      while (size > 10 && ctx.measureText(text).width > cw - 16) { size -= 1; ctx.font = `800 ${size}px system-ui, sans-serif`; }
      ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, cw / 2, ch / 2 + 2);
    }),
  }));
  return { mesh: new THREE.Mesh(new THREE.PlaneGeometry(w, w / 4), material), material };
}

/** Bâtiment de l'atelier : b = { x0, y0, x1, y1, facing, door: [x, y], render } (voir atelier/world.js). */
export function buildAtelierBuilding(b) {
  const r = b.render || {};
  const mats = r.materials || {};
  const style = r.style || {};
  const wall = mats.wall || '#efe3c8';
  const trim = mats.trim || '#5b3a29';
  const roofColor = mats.roof || '#9c5b3c';
  const cw = b.x1 - b.x0 + 1;
  const cd = b.y1 - b.y0 + 1;
  const sideways = b.facing === 'E' || b.facing === 'W';
  const fw = sideways ? cd : cw; // cases le long de la façade
  const fd = sideways ? cw : cd;
  const floors = clamp(Math.round(r.floors || 1), 1, 6);
  const H = WALL_H + (floors - 1) * FLOOR_H;
  const w = fw - INSET;
  const d = fd - INSET;
  const doorCell = clamp(r.door ?? Math.floor(fw / 2), 0, fw - 1);
  const shopfront = !!r.shop?.shopfront;

  const g = new THREE.Group();
  g.position.set(b.x0 + cw / 2, 0, b.y0 + cd / 2);
  g.rotation.y = ROT[b.facing] ?? 0;
  const front = owned(new THREE.MeshLambertMaterial({ map: canvasTexture(fw * PX, Math.round(H * PX), (ctx) => paintWall(ctx, { cells: fw, floors, height: H, wall, trim, style, door: doorCell, shopfront })) }));
  const back = owned(new THREE.MeshLambertMaterial({ map: canvasTexture(fw * PX, Math.round(H * PX), (ctx) => paintWall(ctx, { cells: fw, floors, height: H, wall, trim, style })) }));
  const side = owned(new THREE.MeshLambertMaterial({ map: canvasTexture(fd * PX, Math.round(H * PX), (ctx) => paintWall(ctx, { cells: fd, floors, height: H, wall, trim, style })) }));
  const top = owned(new THREE.MeshLambertMaterial({ color: shade(wall, 0.9) }));
  // Ordre des faces d'une boîte : +x, -x, +y, -y, +z (façade), -z.
  g.add(box(w, H, d, [side, side, top, top, front, back], 0, H / 2, 0));
  const fade = [front, back, side, top];

  const roofMat = owned(new THREE.MeshLambertMaterial({ color: roofColor, flatShading: true }));
  fade.push(roofMat);
  if (style.roof === 'gable') {
    const rh = clamp(0.3 + d * 0.18, 0.3, 0.8);
    const shape = new THREE.Shape([new THREE.Vector2(-d / 2 - 0.1, 0), new THREE.Vector2(d / 2 + 0.1, 0), new THREE.Vector2(0, rh)]);
    const geo = new THREE.ExtrudeGeometry(shape, { depth: w + 0.16, bevelEnabled: false });
    geo.translate(0, 0, -(w + 0.16) / 2);
    const roof = new THREE.Mesh(geo, roofMat);
    roof.rotation.y = Math.PI / 2;
    roof.position.y = H;
    g.add(roof);
  } else if (style.roof === 'hip') {
    const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1), roofMat);
    roof.rotation.y = Math.PI / 4;
    roof.scale.set(w + 0.16, clamp(0.25 + Math.min(w, d) * 0.14, 0.25, 0.6), d + 0.16);
    roof.position.y = H + roof.scale.y / 2;
    g.add(roof);
  } else {
    g.add(box(w + 0.06, 0.1, d + 0.06, roofMat, 0, H + 0.05, 0));
  }

  const doorX = -w / 2 + (doorCell + 0.5) * (w / fw);
  if (r.shop?.awning) {
    const awningMat = owned(new THREE.MeshLambertMaterial({ color: trim, flatShading: true }));
    // sous l'enseigne, au-dessus de la vitrine
    const awning = box(w * 0.92, 0.05, 0.42, awningMat, 0, WALL_H * 0.66, d / 2 + 0.2);
    awning.rotation.x = 0.35;
    g.add(awning);
    fade.push(awningMat);
  }
  if (b.sign?.text) {
    const { mesh, material } = signMesh(b.sign.text, trim, Math.min(w - 0.1, 0.4 + b.sign.text.length * 0.11));
    // bandeau en haut du rez-de-chaussée (au-dessus de l'auvent s'il y en a un)
    mesh.position.set(r.shop?.awning ? 0 : doorX, WALL_H - 0.15, d / 2 + 0.01);
    g.add(mesh);
    fade.push(material);
  }
  g.userData.kind = 'building';
  g.userData.fadeMaterials = fade;
  return g;
}

// --- Objets ------------------------------------------------------------------------------------

const _pos = new THREE.Vector3();
const _cam = new THREE.Vector3();
const _parent = new THREE.Quaternion();
const _yaw = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);
const svgTextures = new Map();

function svgMaterial(svg, w, h) {
  let m = svgTextures.get(svg);
  if (m) return m;
  const c = document.createElement('canvas');
  c.width = Math.round(w);
  c.height = Math.round(h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  m = new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.4, side: THREE.DoubleSide });
  m.visible = false;
  const img = new Image();
  img.onload = () => { c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); tex.needsUpdate = true; m.visible = true; };
  img.src = svgDataUrl(svg);
  svgTextures.set(svg, m);
  return m;
}

/** Objet modulaire : image de l'assemblage (vue de face) sur un plan tourné vers la caméra. */
function modularBillboard(r) {
  const kit = atelier.pack?.kits?.[r.modular.kit];
  if (!kit) return null;
  const { svg } = composeKit(r.modular, atelier.pack.parts, kit, { idPrefix: 'o' });
  const [, , fw, fh] = kit.frame;
  const height = clamp((r.height_m || 3) * M, 0.4, 3.2);
  const k = height / kit.ground; // unités par pixel du repère du kit
  const plane = new THREE.PlaneGeometry(fw * k, fh * k);
  plane.translate(0, fh * k / 2 - (fh - kit.ground) * k, 0);
  const mesh = new THREE.Mesh(plane, svgMaterial(svg, fw * 1.5, fh * 1.5));
  const holder = new THREE.Group();
  holder.add(mesh);
  mesh.onBeforeRender = (renderer, _scene, camera) => {
    const frame = renderer.info.render.frame;
    if (holder.userData.frame === frame) return;
    holder.userData.frame = frame;
    holder.parent.getWorldPosition(_pos);
    camera.getWorldPosition(_cam);
    _yaw.setFromAxisAngle(UP, Math.atan2(_cam.x - _pos.x, _cam.z - _pos.z));
    holder.parent.getWorldQuaternion(_parent);
    holder.quaternion.copy(_parent.invert().multiply(_yaw));
    holder.updateMatrixWorld(true);
  };
  return holder;
}

/** Objet de l'atelier (mobilier urbain, végétation, décor) : forme procédurale aux couleurs de l'atelier. */
export function buildAtelierProp(def) {
  const r = def.render || {};
  const outer = new THREE.Group();
  if (r.modular) {
    const b = modularBillboard(r);
    if (b) { outer.add(b); return outer; }
  }
  // Repère local (avant vers +z), tourné selon l'orientation : un banc 2×1 posé « E » occupe 1×2 cases.
  const g = new THREE.Group();
  g.rotation.y = ROT[def.facing] ?? 0;
  outer.add(g);
  const sideways = def.facing === 'E' || def.facing === 'W';
  const p = r.materials?.primary || '#3f8f4a';
  const s = r.materials?.secondary || '#6b4423';
  const h = clamp((r.height_m || 1) * M, 0.25, 3);
  const w = (sideways ? def.h : def.w || 1) - 0.2;
  const d = (sideways ? def.w : def.h || 1) - 0.2;
  const flat = (c) => mat(c, { flatShading: true });
  const cyl = (rt, rb, hh, c, y, x = 0, z = 0) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, hh, 7), mat(c)); m.position.set(x, y, z); return m; };
  switch (r.shape) {
    case 'tree': {
      g.add(cyl(0.08, 0.12, h * 0.45, s, h * 0.225));
      const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(Math.min(0.7, h * 0.32), 0), flat(p));
      crown.position.y = h * 0.68;
      g.add(crown);
      break;
    }
    case 'palm': {
      g.add(cyl(0.05, 0.09, h, s, h / 2));
      for (let i = 0; i < 6; i++) {
        const pivot = new THREE.Group();
        pivot.position.y = h;
        pivot.rotation.y = (i / 6) * Math.PI * 2;
        const leaf = box(0.9, 0.03, 0.2, flat(p), 0.45, 0, 0);
        leaf.rotation.z = -0.45;
        pivot.add(leaf);
        g.add(pivot);
      }
      break;
    }
    case 'bush': {
      const b = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 0), flat(p));
      b.position.y = 0.35;
      g.add(b);
      break;
    }
    case 'lamp_post':
      g.add(cyl(0.035, 0.05, h, s === '#6b4423' ? '#5d6d7e' : p, h / 2));
      g.add(box(0.26, 0.08, 0.18, mat(s), 0, h, 0.12));
      break;
    case 'bench':
      g.add(box(w, 0.06, 0.32, flat(p), 0, 0.4, 0));
      g.add(box(w, 0.26, 0.05, flat(p), 0, 0.62, -0.15));
      for (const x of [-w / 2 + 0.08, w / 2 - 0.08]) g.add(box(0.06, 0.4, 0.3, mat(s), x, 0.2, 0));
      break;
    case 'bin':
      g.add(cyl(0.17, 0.15, 0.5, p, 0.25));
      g.add(cyl(0.19, 0.19, 0.05, s, 0.52));
      break;
    case 'bus_stop':
      g.add(box(w, 0.06, d + 0.3, mat(p), 0, h, 0));
      for (const x of [-w / 2 + 0.05, w / 2 - 0.05]) g.add(box(0.06, h, 0.06, mat(p), x, h / 2, -d / 2));
      g.add(box(w - 0.1, h * 0.6, 0.03, mat(s), 0, h * 0.5, -d / 2 - 0.05));
      g.add(box(w * 0.7, 0.06, 0.3, flat('#8d5a2b'), 0, 0.4, -d / 2 + 0.15));
      break;
    default:
      g.add(box(w, h, d, flat(p), 0, h / 2, 0));
  }
  return outer;
}

// --- Surfaces ----------------------------------------------------------------------------------

/** Surface de l'atelier (pelouse, pavés, parking, eau…) : revêtement peint posé sur le sol. */
export function buildAtelierSurface(def) {
  const r = def.render || {};
  const base = r.materials?.base || '#8fbf6a';
  const detail = r.materials?.detail || shade(base, 0.85);
  const w = def.w || 1;
  const h = def.h || 1;
  const tex = canvasTexture(w * 32, h * 32, (ctx, cw, ch) => {
    ctx.fillStyle = base; ctx.fillRect(0, 0, cw, ch);
    ctx.fillStyle = detail; ctx.strokeStyle = detail; ctx.lineWidth = 2;
    if (r.pattern === 'dots') for (let y = 6; y < ch; y += 11) for (let x = (y % 22) ? 4 : 9; x < cw; x += 11) ctx.fillRect(x, y, 2, 2);
    else if (r.pattern === 'stripes') for (let x = 16; x < cw; x += 32) ctx.fillRect(x - 1, 4, 2, ch * 0.45);
    else if (r.pattern === 'waves') for (let y = 8; y < ch; y += 12) { ctx.beginPath(); for (let x = 0; x <= cw; x += 4) ctx.lineTo(x, y + Math.sin(x / 6) * 2); ctx.stroke(); }
    ctx.strokeRect(1, 1, cw - 2, ch - 2);
  });
  const material = owned(new THREE.MeshLambertMaterial({ map: tex }));
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(w, h), material);
  plane.rotation.x = -Math.PI / 2;
  plane.position.y = 0.012;
  const g = new THREE.Group();
  g.add(plane);
  return g;
}
