// Affichage sûr d'un SVG composé : toujours via <img> (un SVG chargé en image n'exécute aucun script).
const cache = new Map<string, HTMLImageElement>();
const listeners = new Set<() => void>();

export const svgDataUrl = (svg: string) => "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);

export function svgImage(svg: string, alt = ""): HTMLImageElement {
  const img = document.createElement("img");
  img.src = svgDataUrl(svg);
  img.alt = alt;
  img.decoding = "async";
  return img;
}

/** Image chargée (pour le rendu canvas/Phaser) ; null tant qu'elle charge, puis les écouteurs sont prévenus. */
export function loadedImage(src: string): HTMLImageElement | null {
  let img = cache.get(src);
  if (!img) {
    img = new Image();
    img.decoding = "async";
    img.onload = () => listeners.forEach((fn) => fn());
    img.src = src;
    cache.set(src, img);
    if (cache.size > 400) cache.delete(cache.keys().next().value as string);
  }
  return img.complete && img.naturalWidth ? img : null;
}

export function onImagesLoaded(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
