// Caméra orbitale : suit le joueur, ou se promène librement dans la ville.
//
// Gestes (mobile) : 1 doigt glissé = naviguer (la carte suit le doigt), 2 doigts = pincer pour
// zoomer + tourner pour pivoter, toucher bref = clic.
// Souris : glisser = naviguer, clic droit glissé = pivoter / incliner, molette = zoom, clic = clic.
// Pavé tactile : pincer = zoom, défilement horizontal à deux doigts = naviguer.
// La caméra ne décide pas de ce que fait un clic : elle le transmet (onTap) au monde, qui applique
// la politique de la zone (voir world/selectables.js). Seuils clic / glissement : world/pointer.js.
import * as THREE from 'three';
import { exceedsSlop, isTap, wheelIntent } from '../world/pointer.js';
import { angleDelta, clamp, clampToBounds, LIMITS, mapBounds, orbitPosition, panDelta, TARGET_Y, zoomProgress } from './cameraMath.js';

export class CameraRig {
  constructor(canvas, { onTap, onFreeChange }) {
    this.canvas = canvas;
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 400);
    this.onTap = onTap;
    this.onFreeChange = onFreeChange;
    // Valeurs visées (gestes) et valeurs courantes (lissées).
    this.goal = { yaw: 0.35, tilt: 0, dist: 14, target: new THREE.Vector3() };
    this.cur = { yaw: 0.35, pitch: 1.0, dist: 14, target: new THREE.Vector3() };
    this.free = false;
    this.bounds = { minX: 0, maxX: 40, minZ: 0, maxZ: 22 };
    this.range = { min: LIMITS.distMin, max: LIMITS.distMax };
    this.pointers = new Map();
    this.dragged = false;
    this.multi = false;
    this.enabled = true;
    this.bind();
  }

  // --- Réglages ------------------------------------------------------------------
  setBounds(w, h) {
    this.bounds = mapBounds(w, h);
    clampToBounds(this.goal.target, this.bounds);
  }

  /** Plage de zoom de la zone : { min, max } en unités de distance. */
  setZoomRange({ min, max }) {
    this.range = { min, max };
    this.goal.dist = clamp(this.goal.dist, min, max);
  }

  setDefaults({ dist, yaw }) {
    this.goal.dist = this.cur.dist = dist;
    if (yaw !== undefined) this.goal.yaw = this.cur.yaw = yaw;
  }

  snapTo(x, z) {
    this.goal.target.set(x, TARGET_Y, z);
    this.cur.target.copy(this.goal.target);
  }

  setFree(free) {
    if (this.free === free) return;
    this.free = free;
    this.onFreeChange?.(free);
  }

  recenter() { this.setFree(false); }
  rotateBy(angle) { this.goal.yaw += angle; }
  zoomBy(factor) { this.goal.dist = clamp(this.goal.dist * factor, this.range.min, this.range.max); }

  /** Vue libre centrée sur un point du sol (x, z), à la distance demandée. */
  lookAt(x, z, dist) {
    this.goal.target.set(x, TARGET_Y, z);
    clampToBounds(this.goal.target, this.bounds);
    if (dist !== undefined) this.goal.dist = clamp(dist, this.range.min, this.range.max);
    this.setFree(true);
  }

  /** Avancement du zoom : 0 au plus près, 1 au plus loin. */
  get zoomLevel() { return zoomProgress(this.cur.dist, this.range); }
  resetNorth() { this.goal.yaw = 0; }

  /** Inclinaison automatique : plus on zoome, plus la vue devient « à hauteur d'homme ». */
  pitchFor(dist) {
    // Courbe absolue (pas relative à la zone) : même inclinaison à distance égale, vue de dessus au-delà.
    const t = zoomProgress(dist, { min: LIMITS.distMin, max: LIMITS.distMax });
    // Basse de près (on voit les personnages de trois quarts), vue de dessus en s'éloignant.
    return clamp(0.42 + t * 0.95 + this.goal.tilt, LIMITS.pitchMin, LIMITS.pitchMax);
  }

  // --- Gestes ----------------------------------------------------------------------
  /** Un glissement (ou un geste à deux doigts) est en cours : aucune sélection ne doit partir. */
  get gestureActive() { return this.dragged && this.pointers.size > 0; }

  bind() {
    const el = this.canvas;
    el.style.touchAction = 'none';
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return;
      el.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now(), button: e.button, shift: e.shiftKey, type: e.pointerType });
      if (this.pointers.size === 1) this.multi = false;
      // Un deuxième doigt transforme le geste en pincement : il ne sera jamais un clic.
      if (this.pointers.size > 1) this.multi = true;
      this.dragged = this.multi;
      this.pinch = null;
    });
    el.addEventListener('pointermove', (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p || !this.enabled) return;
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      p.x = e.clientX;
      p.y = e.clientY;
      if (this.pointers.size === 1) {
        if (!this.dragged && exceedsSlop(p.type, p.x - p.sx, p.y - p.sy)) this.dragged = true;
        if (!this.dragged) return;
        if (p.button === 2 || p.shift) {
          // Pivoter (horizontal) et incliner (vertical).
          this.goal.yaw -= dx * 0.008;
          this.goal.tilt = clamp(this.goal.tilt + dy * 0.004, -0.6, 0.6);
        } else this.pan(dx, dy);
      } else if (this.pointers.size === 2) this.twoFinger();
    });
    const end = (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      this.pointers.delete(e.pointerId);
      this.pinch = null;
      const tap = e.type === 'pointerup' && this.pointers.size === 0
        && isTap({ button: p.button, dragged: this.dragged, multi: this.multi, ms: performance.now() - p.t });
      if (tap) this.onTap?.(e.clientX, e.clientY);
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (!this.enabled) return;
      if (wheelIntent(e) === 'pan') this.pan(-e.deltaX, -e.deltaY);
      else this.zoomBy(1 + clamp(e.deltaY, -200, 200) * 0.0015);
    }, { passive: false });
  }

  pan(dx, dy) {
    const d = panDelta(dx, dy, this.cur.yaw, this.cur.dist, this.canvas.clientHeight);
    clampToBounds(this.goal.target.set(this.goal.target.x + d.x, this.goal.target.y, this.goal.target.z + d.z), this.bounds);
    clampToBounds(this.cur.target.set(this.cur.target.x + d.x, this.cur.target.y, this.cur.target.z + d.z), this.bounds);
    this.setFree(true);
  }

  twoFinger() {
    const [a, b] = [...this.pointers.values()];
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    if (this.pinch) {
      this.goal.dist = clamp(this.goal.dist * (this.pinch.dist / Math.max(dist, 1)), this.range.min, this.range.max);
      this.goal.yaw -= angleDelta(this.pinch.angle, angle);
      const mdx = mid.x - this.pinch.mid.x;
      const mdy = mid.y - this.pinch.mid.y;
      if (Math.hypot(mdx, mdy) > 0.5) this.pan(mdx, mdy);
    }
    this.pinch = { dist, angle, mid };
  }

  // --- Mise à jour par image -----------------------------------------------------------
  update(dt, follow) {
    if (follow && !this.free) clampToBounds(this.goal.target.set(follow.x, TARGET_Y, follow.z), this.bounds);
    const k = 1 - Math.exp(-dt * 7);
    const c = this.cur;
    c.target.lerp(this.goal.target, k);
    c.yaw += angleDelta(c.yaw, this.goal.yaw) * k;
    c.dist += (this.goal.dist - c.dist) * k;
    c.pitch += (this.pitchFor(this.goal.dist) - c.pitch) * k;
    const pos = orbitPosition(c.target, c.yaw, c.pitch, c.dist);
    this.camera.position.set(pos.x, pos.y, pos.z);
    this.camera.lookAt(c.target);
  }

  resize(w, h) {
    this.camera.aspect = w / h;
    // Écran en portrait : champ plus large pour voir autant de rue qu'en paysage.
    this.camera.fov = w < h ? 55 : 42;
    this.camera.updateProjectionMatrix();
  }

  /** Point du sol (y = 0) sous une position écran, ou null. */
  groundPoint(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const hit = new THREE.Vector3();
    return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit) ? hit : null;
  }

  raycaster(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1), this.camera);
    return ray;
  }
}
