// Infobulles des icônes sans libellé (barre du haut, panneau latéral) : texte dans `data-tip`.
// Ordinateur : survol ou focus clavier (CSS). Tactile : appui long sur un bouton (le clic qui suit est
// annulé), simple toucher sur un élément qui n'est pas un bouton (jauge, compteur).
const LONG_PRESS_MS = 450;
const SHOW_MS = 2200;

const timers = new Map();

function showTip(node, ms = SHOW_MS) {
  for (const other of document.querySelectorAll('[data-tip].tip-on')) if (other !== node) other.classList.remove('tip-on');
  node.classList.add('tip-on');
  clearTimeout(timers.get(node));
  timers.set(node, setTimeout(() => node.classList.remove('tip-on'), ms));
}

export function initTips() {
  let press = null; // { node, timer, shown }
  document.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') return;
    const node = e.target.closest?.('button[data-tip]');
    if (!node) return;
    press = { node, shown: false };
    press.timer = setTimeout(() => { press.shown = true; showTip(node); }, LONG_PRESS_MS);
  });
  const release = () => { if (press) clearTimeout(press.timer); };
  document.addEventListener('pointerup', release);
  document.addEventListener('pointercancel', () => { release(); press = null; });
  // Appui long : on a montré l'infobulle, on n'ouvre pas le panneau.
  document.addEventListener('click', (e) => {
    const node = e.target.closest?.('[data-tip]');
    if (press?.shown && node === press.node) {
      e.preventDefault();
      e.stopImmediatePropagation();
    } else if (node && !node.matches('button')) showTip(node);
    press = null;
  }, true);
  // Pas de menu contextuel du navigateur sur un appui long.
  document.addEventListener('contextmenu', (e) => { if (e.target.closest?.('[data-tip]')) e.preventDefault(); });
}
