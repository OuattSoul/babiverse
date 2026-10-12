// Entrées : joystick tactile fixe (bas gauche), bouton d'action, clavier.
// `x`, `y` : entrée relative à l'écran (droite, bas), convertie selon l'angle de la caméra.
// `forced` : direction imposée dans le repère du monde (tests automatisés).
export const touchInput = { x: 0, y: 0, actionQueued: false, forced: null };

const RADIUS = 44;
const keys = new Set();

export function keyboardVector() {
  let x = 0;
  let y = 0;
  if (keys.has('arrowleft') || keys.has('a') || keys.has('q')) x -= 1;
  if (keys.has('arrowright') || keys.has('d')) x += 1;
  if (keys.has('arrowup') || keys.has('w') || keys.has('z')) y -= 1;
  if (keys.has('arrowdown') || keys.has('s')) y += 1;
  return { x, y };
}

export function initControls({ onInteract, isModal }) {
  const typing = (e) => /input|textarea/i.test(e.target?.tagName);
  window.addEventListener('keydown', (e) => {
    if (typing(e)) return;
    const k = e.key.toLowerCase();
    if ((k === 'e' || k === ' ' || k === 'enter') && !e.repeat && !isModal()) { onInteract(); e.preventDefault(); return; }
    keys.add(k);
    if (k.startsWith('arrow')) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
  window.addEventListener('blur', () => keys.clear());

  const zone = document.getElementById('joystick-zone');
  const thumb = zone.querySelector('.thumb');
  let pointerId = null;
  let ox = 0;
  let oy = 0;
  const reset = () => {
    pointerId = null;
    touchInput.x = touchInput.y = 0;
    thumb.style.transform = 'translate(-50%, -50%)';
    zone.classList.remove('active');
  };
  zone.addEventListener('pointerdown', (e) => {
    if (pointerId !== null) return;
    pointerId = e.pointerId;
    const r = zone.getBoundingClientRect();
    ox = r.left + r.width / 2;
    oy = r.top + r.height / 2;
    zone.setPointerCapture(e.pointerId);
    zone.classList.add('active');
    move(e);
  });
  const move = (e) => {
    if (e.pointerId !== pointerId) return;
    let dx = e.clientX - ox;
    let dy = e.clientY - oy;
    const len = Math.hypot(dx, dy);
    if (len > RADIUS) { dx = (dx / len) * RADIUS; dy = (dy / len) * RADIUS; }
    thumb.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    const strength = Math.min(1, len / RADIUS);
    touchInput.x = strength > 0.15 ? dx / RADIUS : 0;
    touchInput.y = strength > 0.15 ? dy / RADIUS : 0;
  };
  zone.addEventListener('pointermove', move);
  for (const evt of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    zone.addEventListener(evt, (e) => { if (e.pointerId === pointerId) reset(); });
  }
  document.getElementById('action-btn').addEventListener('pointerdown', (e) => {
    e.preventDefault();
    touchInput.actionQueued = true;
  });
  reset();
}
