// Paysages 3D d'une carte publiée par l'atelier (zone.landscapes, voir world/dataMaps.js).
//
// Chaque instance est posée tout de suite sous forme d'un volume provisoire (la boîte du modèle, translucide), puis
// remplacée par le modèle dès qu'il est chargé : la carte est jouable sans attendre le téléchargement, et un fichier
// introuvable laisse un volume rouge au lieu de bloquer la carte. Les collisions ne dépendent pas du chargement
// (emprises au sol dans zone.blocked).
import * as THREE from 'three';

const PENDING = 0xbfc9ca;
const FAILED = 0xe74c3c;

function placeholder(bbox, color) {
  const [x0, y0, z0, x1, y1, z1] = bbox;
  const material = new THREE.MeshLambertMaterial({ color, transparent: true, opacity: 0.45 });
  material.userData.owned = true;
  const box = new THREE.Mesh(new THREE.BoxGeometry(Math.max(x1 - x0, 0.05), Math.max(y1 - y0, 0.05), Math.max(z1 - z0, 0.05)), material);
  box.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  box.userData.placeholder = true;
  return box;
}

/**
 * Groupe des paysages de la zone. `status` suit le chargement : { total, loaded, failed, done (promesse) }.
 * Rotation : quarts de tour dans le sens horaire vu du dessus (même règle que l'emprise au sol).
 */
export function buildLandscapes(zone, cache, { onError, origin } = {}) {
  const group = new THREE.Group();
  group.name = 'landscapes';
  const status = { total: zone.landscapes.length, loaded: 0, failed: 0, errors: [] };
  // Les paysages proches du joueur se chargent en premier (la file du cache respecte cet ordre).
  const [ox, oz] = origin || zone.spawns?.default || [0, 0];
  const centre = (l) => [l.footprint.x + l.footprint.w / 2, l.footprint.y + l.footprint.h / 2];
  const ordered = [...zone.landscapes].sort((a, b) => Math.hypot(...centre(a).map((v, i) => v - [ox, oz][i])) - Math.hypot(...centre(b).map((v, i) => v - [ox, oz][i])));
  status.order = ordered.map((l) => l.id);
  const jobs = ordered.map((inst) => {
    const holder = new THREE.Group();
    holder.name = `landscape:${inst.id}`;
    holder.userData.landscape = inst.id;
    holder.position.set(inst.x, 0, inst.z);
    holder.rotation.y = -((inst.rotation || 0) * Math.PI) / 180;
    holder.scale.setScalar(inst.scale ?? 1);
    const box = placeholder(inst.bbox, PENDING);
    holder.add(box);
    group.add(holder);
    return cache.instantiate(inst.url).then((model) => {
      if (group.userData.disposed) return;
      holder.remove(box);
      box.geometry.dispose();
      box.material.dispose();
      model.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
      holder.add(model);
      status.loaded++;
    }, (err) => {
      status.failed++;
      status.errors.push({ id: inst.id, message: String(err?.message || err) });
      box.material.color.setHex(FAILED);
      onError?.(inst, err);
    });
  });
  status.done = Promise.all(jobs);
  group.userData.status = status;
  return { group, status, urls: [...new Set(zone.landscapes.map((l) => l.url))] };
}

/** À appeler en quittant la zone : les chargements encore en cours n'ajouteront plus rien. */
export function detachLandscapes(built) {
  if (built) built.group.userData.disposed = true;
}
