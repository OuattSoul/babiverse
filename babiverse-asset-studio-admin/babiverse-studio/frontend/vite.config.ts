import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// La page « Carte du jeu » affiche la vraie ville : elle importe les modules purs du jeu (client/src/world/*),
// dans le même dépôt, sous l'alias @jeu. Reconstruire l'atelier quand la ville du jeu change.
const jeu = fileURLToPath(new URL("../../../client/src", import.meta.url));
const repo = fileURLToPath(new URL("../../..", import.meta.url));

export default defineConfig({
  resolve: { alias: { "@jeu": jeu } },
  server: { proxy: { "/api": "http://127.0.0.1:8000" }, fs: { allow: [repo] } },
  build: { chunkSizeWarningLimit: 2000 },
});
