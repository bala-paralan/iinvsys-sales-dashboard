import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The API stays on :5001 (see backend). Proxying /api keeps the app
// same-origin in dev, which is exactly the shape production has behind
// nginx/vercel — so no CORS special-casing creeps into the client code.
// Cutover base path (B5/F6). During the parallel period the new app is served
// at /v2 alongside the still-deployed legacy app; at cutover this becomes '/'.
// It must match the route prefix in vercel.json, or the built HTML asks for
// /assets/... , which falls through the catch-all to the LEGACY index.html and
// the page silently renders the old app.
// Dev serves at '/' — applying the cutover prefix to the dev server would
// make http://localhost:5173/ a 404 and break every bookmark and launch entry
// for the sake of a path that only matters to the deployed build.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? (process.env.APP_BASE || '/v2/') : '/',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:5001', changeOrigin: true },
    },
  },
}));
