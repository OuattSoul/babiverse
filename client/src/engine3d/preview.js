// Aperçu 3D du personnage sur l'écran de création (il tourne lentement sur lui-même).
import * as THREE from 'three';
import { buildCharacter } from './character.js';
import { disposeGroup } from './materials.js';

export function createPreview(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(canvas.clientWidth || 96, canvas.clientHeight || 120, false);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a7a66, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.2);
  sun.position.set(2, 3, 4);
  scene.add(sun);
  const camera = new THREE.PerspectiveCamera(30, (canvas.clientWidth || 96) / (canvas.clientHeight || 120), 0.1, 20);
  camera.position.set(0, 0.9, 3);
  camera.lookAt(0, 0.55, 0);
  let model = null;
  let running = true;
  const loop = () => {
    if (!running) return;
    if (model) model.rotation.y += 0.012;
    renderer.render(scene, camera);
    requestAnimationFrame(loop);
  };
  loop();
  return {
    setLook(look) {
      const angle = model?.rotation.y ?? 0.4;
      if (model) { scene.remove(model); disposeGroup(model); }
      model = buildCharacter(look);
      model.rotation.y = angle;
      scene.add(model);
    },
    dispose() {
      running = false;
      renderer.dispose();
      renderer.forceContextLoss(); // libère le contexte WebGL (le navigateur en limite le nombre)
    },
  };
}
