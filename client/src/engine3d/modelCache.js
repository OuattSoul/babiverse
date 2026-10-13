// Cache des modèles 3D (GLB / glTF) des paysages : un téléchargement et une analyse par fichier, puis des clones
// légers par instance (géométries et matériaux partagés). Les adresses contiennent la révision du fichier, qui ne
// change jamais : une entrée du cache reste valable.
//
// Mémoire : les géométries partagées sont marquées `userData.shared` (disposeGroup ne les libère pas en quittant
// une carte) ; `release(urls)` libère les modèles qu'aucune carte chargée n'utilise plus.

/** Charge un fichier avec le GLTFLoader de Three.js (import à la demande : la carte historique ne le charge jamais). */
async function gltfLoad(url) {
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const gltf = await new GLTFLoader().loadAsync(url);
  return gltf.scene;
}

/** Échec si le chargement dépasse `ms` (réseau mobile lent, serveur bloqué) : la carte reste jouable sans le modèle. */
export function withTimeout(promise, ms, url) {
  if (!ms) return promise;
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Délai dépassé (${ms / 1000} s) : ${url}`)), ms); })])
    .finally(() => clearTimeout(timer));
}

export function createModelCache(load = gltfLoad, { timeoutMs = 30000, concurrency = 2, now = () => performance.now() } = {}) {
  const entries = new Map(); // url → { promise, scene, error }
  const stats = { requests: 0, loaded: 0, failed: 0, active: 0, maxActive: 0, timings: {} };
  // File d'attente : au plus `concurrency` téléchargements à la fois (téléphones, réseau mobile), dans l'ordre demandé.
  const queue = [];
  const pump = () => {
    while (stats.active < concurrency && queue.length) {
      const job = queue.shift();
      stats.active++;
      stats.maxActive = Math.max(stats.maxActive, stats.active);
      const t0 = now();
      Promise.resolve().then(() => load(job.url)).then(job.resolve, job.reject).finally(() => {
        stats.timings[job.url] = Math.round(now() - t0);
        stats.active--;
        pump();
      });
    }
  };
  const limited = (url) => new Promise((resolve, reject) => { queue.push({ url, resolve, reject }); pump(); });

  function markShared(scene) {
    scene.traverse((o) => {
      if (o.geometry) o.geometry.userData.shared = true;
      for (const m of [].concat(o.material || [])) if (m?.userData) m.userData.owned = false;
    });
    return scene;
  }

  /** Promesse du modèle source (jamais ajouté à la scène). */
  function get(url) {
    if (!entries.has(url)) {
      stats.requests++;
      const entry = {};
      entry.promise = withTimeout(limited(url), timeoutMs, url).then((scene) => {
        entry.scene = markShared(scene);
        stats.loaded++;
        return entry.scene;
      }, (err) => {
        entry.error = err;
        stats.failed++;
        entries.delete(url); // un nouvel essai reste possible à la prochaine entrée sur la carte
        throw err;
      });
      entries.set(url, entry);
    }
    return entries.get(url).promise;
  }

  /** Copie d'un modèle chargée pour une instance (mêmes géométries et matériaux que la source). */
  async function instantiate(url) {
    const scene = await get(url);
    return scene.clone(true);
  }

  /** Libère les modèles dont l'adresse n'est pas dans `keep`. */
  function release(keep = []) {
    const wanted = new Set(keep);
    for (const [url, entry] of entries) {
      if (wanted.has(url) || !entry.scene) continue;
      entry.scene.traverse((o) => {
        o.geometry?.dispose();
        for (const m of [].concat(o.material || [])) { for (const v of Object.values(m || {})) if (v?.isTexture) v.dispose(); m?.dispose?.(); }
      });
      entries.delete(url);
    }
  }

  return { get, instantiate, release, stats, has: (url) => entries.has(url), size: () => entries.size };
}

/** Cache partagé par le jeu. */
export const modelCache = createModelCache();
