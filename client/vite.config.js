import { defineConfig } from 'vite';

const api = { '/api': { target: process.env.API_URL || 'http://127.0.0.1:8010', changeOrigin: false } };

export default defineConfig({
  // `..` : autorise l'import de shared/city.json (données communes au serveur et au client).
  server: { host: true, port: 5173, proxy: api, fs: { allow: ['..'] } },
  preview: { host: true, port: 4173, proxy: api },
  build: {
    target: 'es2019',
    chunkSizeWarningLimit: 1500,
    rollupOptions: { output: { manualChunks: { three: ['three'] } } },
  },
  test: { include: ['tests/**/*.test.js'] },
});
