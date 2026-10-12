// Peinture du sol des zones à partir des motifs de tuiles (canvas 2D, aucune image).
// Les cases solides (bâtiments, arbres, meubles) reçoivent le sol qui les entoure :
// leur volume est construit en 3D par builders.js.
import { LEGEND, TILE } from '../world/grid.js';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

// Générateur pseudo-aléatoire déterministe pour les textures (même rendu à chaque chargement).
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function speckle(ctx, ox, color, count, seed, size = 1) {
  // Graine variée par case pour éviter un motif répétitif sur les grandes surfaces.
  const r = rng(seed * 997 + ox * 13 + ctx.getTransform().f * 7);
  ctx.fillStyle = color;
  for (let i = 0; i < count; i++) ctx.fillRect(ox + Math.floor(r() * TILE), Math.floor(r() * TILE), size, size);
}

function fill(ctx, ox, color) {
  ctx.fillStyle = color;
  ctx.fillRect(ox, 0, TILE, TILE);
}

function roof(ctx, ox, base, line) {
  fill(ctx, ox, base);
  ctx.fillStyle = line;
  for (let x = 0; x < TILE; x += 6) ctx.fillRect(ox + x, 0, 2, TILE);
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  ctx.fillRect(ox, TILE - 3, TILE, 3);
}

function facade(ctx, ox, base) {
  fill(ctx, ox, base);
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.fillRect(ox, 0, TILE, 4); // ombre du toit
  ctx.fillStyle = 'rgba(0,0,0,0.08)';
  ctx.fillRect(ox, TILE - 6, TILE, 6); // soubassement
}

function windowOn(ctx, ox) {
  ctx.fillStyle = '#34495e';
  ctx.fillRect(ox + 8, 9, 16, 13);
  ctx.fillStyle = '#7fb3d5';
  ctx.fillRect(ox + 10, 11, 5, 9);
  ctx.fillRect(ox + 17, 11, 5, 9);
  ctx.fillStyle = '#ecf0f1';
  ctx.fillRect(ox + 7, 22, 18, 2);
}

const TILE_PAINTERS = [
  /* 0 terre */ (c, ox) => { fill(c, ox, '#c9a27a'); speckle(c, ox, '#b48a62', 26, 1); speckle(c, ox, '#d8b893', 14, 2); },
  /* 1 trottoir */ (c, ox) => {
    fill(c, ox, '#b8b2a7');
    c.fillStyle = '#a19b90';
    c.fillRect(ox, 15, TILE, 1); c.fillRect(ox + 15, 0, 1, 15); c.fillRect(ox + 7, 16, 1, 16); c.fillRect(ox + 23, 16, 1, 16);
  },
  /* 2 goudron */ (c, ox) => { fill(c, ox, '#4a4a4f'); speckle(c, ox, '#56565c', 30, 3); },
  /* 3 goudron ligne */ (c, ox) => {
    fill(c, ox, '#4a4a4f'); speckle(c, ox, '#56565c', 30, 4);
    c.fillStyle = '#f4f1e8'; c.fillRect(ox + 4, 14, 16, 4);
  },
  /* 4 herbe */ (c, ox) => { fill(c, ox, '#7aa450'); speckle(c, ox, '#6a9444', 30, 5, 2); speckle(c, ox, '#8cb862', 18, 6); },
  /* 5 toit tôle */ (c, ox) => roof(c, ox, '#9c5b3c', '#874b30'),
  /* 6 toit ocre */ (c, ox) => roof(c, ox, '#c8874a', '#b5763c'),
  /* 7 toit bleu */ (c, ox) => roof(c, ox, '#6d8ea8', '#5c7d96'),
  /* 8 façade crème */ (c, ox) => facade(c, ox, '#efe3c8'),
  /* 9 façade jaune */ (c, ox) => facade(c, ox, '#f2c14e'),
  /* 10 fenêtre crème */ (c, ox) => { facade(c, ox, '#efe3c8'); windowOn(c, ox); },
  /* 11 fenêtre jaune */ (c, ox) => { facade(c, ox, '#f2c14e'); windowOn(c, ox); },
  /* 12 porte */ (c, ox) => {
    facade(c, ox, '#efe3c8');
    c.fillStyle = '#6e3b1f'; c.fillRect(ox + 7, 5, 18, 27);
    c.fillStyle = '#8a4b28'; c.fillRect(ox + 9, 7, 14, 23);
    c.fillStyle = '#f1c40f'; c.fillRect(ox + 19, 18, 2, 3);
  },
  /* 13 manguier */ (c, ox) => {
    TILE_PAINTERS[4](c, ox);
    c.fillStyle = 'rgba(0,0,0,0.2)'; c.beginPath(); c.ellipse(ox + 17, 25, 13, 6, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#6b4226'; c.fillRect(ox + 14, 18, 5, 10);
    c.fillStyle = '#2f6b2f'; c.beginPath(); c.arc(ox + 16, 12, 12, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#3d8a3d'; c.beginPath(); c.arc(ox + 12, 9, 7, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#f0a020'; c.fillRect(ox + 20, 14, 3, 4); c.fillRect(ox + 10, 16, 3, 4);
  },
  /* 14 palmier */ (c, ox) => {
    TILE_PAINTERS[4](c, ox);
    c.fillStyle = '#8b6b3e'; c.fillRect(ox + 15, 12, 3, 18);
    c.strokeStyle = '#2e7d32'; c.lineWidth = 3;
    for (const [dx, dy] of [[-12, -2], [12, -2], [-8, 8], [8, 8], [0, -10]]) {
      c.beginPath(); c.moveTo(ox + 16, 12); c.quadraticCurveTo(ox + 16 + dx / 2, 4, ox + 16 + dx, 12 + dy); c.stroke();
    }
  },
  /* 15 mur de clôture */ (c, ox) => {
    fill(c, ox, '#a9a093');
    c.fillStyle = '#958c7f';
    for (let y = 0; y < TILE; y += 8) {
      c.fillRect(ox, y, TILE, 1);
      const off = (y / 8) % 2 ? 0 : 8;
      for (let x = off; x < TILE; x += 16) c.fillRect(ox + x, y, 1, 8);
    }
  },
  /* 16 mur intérieur */ (c, ox) => {
    fill(c, ox, '#d9cbb0');
    c.fillStyle = '#c4b597'; c.fillRect(ox, TILE - 8, TILE, 8);
    c.fillStyle = '#b3a385'; c.fillRect(ox, TILE - 8, TILE, 1);
  },
  /* 17 carrelage */ (c, ox) => {
    fill(c, ox, '#e8e2d6');
    c.fillStyle = '#d3cbbb'; c.fillRect(ox, 0, TILE, 1); c.fillRect(ox, 16, TILE, 1); c.fillRect(ox, 0, 1, TILE); c.fillRect(ox + 16, 0, 1, TILE);
  },
  /* 18 ciment */ (c, ox) => { fill(c, ox, '#bdb7ad'); speckle(c, ox, '#aca69c', 20, 7); },
  /* 19 paillasson */ (c, ox) => {
    TILE_PAINTERS[17](c, ox);
    c.fillStyle = '#a0522d'; c.fillRect(ox + 4, 8, 24, 18);
    c.fillStyle = '#c0703d'; for (let x = 6; x < 28; x += 4) c.fillRect(ox + x, 10, 2, 14);
  },
  /* 20 lit */ (c, ox) => {
    TILE_PAINTERS[17](c, ox);
    c.fillStyle = '#5d4037'; c.fillRect(ox, 2, TILE, 28);
    c.fillStyle = '#f5f5f5'; c.fillRect(ox + 2, 4, TILE - 4, 24);
    c.fillStyle = '#e67e22'; c.fillRect(ox + 2, 14, TILE - 4, 14);
    c.fillStyle = '#d35400'; for (let x = 4; x < TILE; x += 6) c.fillRect(ox + x, 14, 2, 14);
  },
  /* 21 étagère */ (c, ox) => {
    TILE_PAINTERS[17](c, ox);
    c.fillStyle = '#7b5232'; c.fillRect(ox + 1, 2, TILE - 2, 26);
    const colors = ['#e74c3c', '#f1c40f', '#27ae60', '#3498db', '#ecf0f1', '#e67e22'];
    const r = rng(ox + 11);
    for (const y of [5, 13, 21]) {
      c.fillStyle = '#5e3d23'; c.fillRect(ox + 1, y + 6, TILE - 2, 2);
      for (let x = 3; x < TILE - 4; x += 5) { c.fillStyle = colors[Math.floor(r() * colors.length)]; c.fillRect(ox + x, y, 4, 6); }
    }
  },
  /* 22 comptoir */ (c, ox) => {
    TILE_PAINTERS[17](c, ox);
    c.fillStyle = '#8d6e63'; c.fillRect(ox, 6, TILE, 22);
    c.fillStyle = '#a1887f'; c.fillRect(ox, 6, TILE, 6);
    c.fillStyle = '#6d4c41'; c.fillRect(ox, 26, TILE, 2);
  },
  /* 23 table */ (c, ox) => {
    TILE_PAINTERS[17](c, ox);
    c.fillStyle = '#795548'; c.fillRect(ox + 1, 6, TILE - 2, 20);
    c.fillStyle = '#ffffff'; c.beginPath(); c.arc(ox + 12, 15, 4, 0, Math.PI * 2); c.fill();
  },
  /* 24 frigo */ (c, ox) => {
    TILE_PAINTERS[17](c, ox);
    c.fillStyle = '#ecf0f1'; c.fillRect(ox + 4, 1, 24, 29);
    c.fillStyle = '#bdc3c7'; c.fillRect(ox + 4, 12, 24, 1); c.fillRect(ox + 23, 4, 2, 6); c.fillRect(ox + 23, 15, 2, 8);
  },
  /* 25 tapis */ (c, ox) => {
    TILE_PAINTERS[17](c, ox);
    c.fillStyle = '#16a085'; c.fillRect(ox, 0, TILE, TILE);
    c.fillStyle = '#f1c40f'; c.fillRect(ox, 6, TILE, 2); c.fillRect(ox, 24, TILE, 2);
    c.fillStyle = '#e74c3c'; for (let x = 2; x < TILE; x += 8) c.fillRect(ox + x, 13, 4, 6);
  },
  /* 26 buisson */ (c, ox) => {
    TILE_PAINTERS[4](c, ox);
    c.fillStyle = '#2e7d32'; c.beginPath(); c.arc(ox + 16, 17, 12, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#e91e63'; for (const [x, y] of [[10, 12], [20, 10], [16, 20], [23, 19]]) c.fillRect(ox + x, y, 3, 3);
  },
];

// Nouveaux sols urbains (ajoutés après les tuiles d'origine pour garder leurs index).
TILE_PAINTERS.push(
  /* 27 passage piéton */ (c, ox) => {
    TILE_PAINTERS[2](c, ox);
    c.fillStyle = '#f4f1e8';
    for (let x = 2; x < TILE; x += 8) c.fillRect(ox + x, 2, 5, TILE - 4);
  },
  /* 28 goudron, ligne verticale */ (c, ox) => {
    fill(c, ox, '#4a4a4f'); speckle(c, ox, '#56565c', 30, 8);
    c.fillStyle = '#f4f1e8'; c.fillRect(ox + 14, 4, 4, 16);
  },
  /* 29 parcelle à bâtir */ (c, ox) => { fill(c, ox, '#d9bf96'); speckle(c, ox, '#c7a87b', 22, 9); speckle(c, ox, '#e6d0ad', 10, 10); },
  /* 30 pavés de la place */ (c, ox) => {
    fill(c, ox, '#c9b8a0');
    c.fillStyle = '#b3a189';
    for (let y = 0; y < TILE; y += 8) { c.fillRect(ox, y, TILE, 1); for (let x = (y / 8) % 2 ? 4 : 0; x < TILE; x += 8) c.fillRect(ox + x, y, 1, 8); }
  },
);

const GROUND_UNDER = {
  // Extérieur : terre sous les bâtiments et murs, herbe sous la végétation.
  r: '.', o: '.', g: '.', W: '.', Y: '.', H: '.', h: '.', D: '.', '#': '.',
  T: ',', p: ',', '%': ',',
  // Intérieur : carrelage sous les murs et les meubles.
  w: 'f', L: 'f', S: 'f', Q: 'f', K: 'f', Z: 'f',
};

// Côté maximal du canvas du sol : limite de taille de texture sûre sur mobile.
const MAX_GROUND_PX = 4096;

/** Carrelage à la couleur choisie dans l'atelier (intérieur de la maison du joueur). */
function paintFloor(c, ox, color) {
  fill(c, ox, color);
  c.fillStyle = 'rgba(0,0,0,0.09)';
  c.fillRect(ox, 0, TILE, 1); c.fillRect(ox, 16, TILE, 1); c.fillRect(ox, 0, 1, TILE); c.fillRect(ox + 16, 0, 1, TILE);
}

/** Canvas du sol complet d'une zone (1 case = 32 px, réduit si la carte dépasserait MAX_GROUND_PX). */
export function paintGround(zone) {
  const h = zone.map.length;
  const w = zone.map[0].length;
  const k = Math.min(1, MAX_GROUND_PX / (Math.max(w, h) * TILE));
  const c = canvas(Math.floor(w * TILE * k), Math.floor(h * TILE * k));
  const ctx = c.getContext('2d');
  ctx.scale(k, k);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = GROUND_UNDER[zone.map[y][x]] || zone.map[y][x];
      ctx.save();
      ctx.translate(0, y * TILE);
      if (ch === 'f' && zone.palette?.floor) paintFloor(ctx, x * TILE, zone.palette.floor);
      else TILE_PAINTERS[LEGEND[ch].index](ctx, x * TILE);
      ctx.restore();
    }
  }
  return c;
}

export { canvas };
