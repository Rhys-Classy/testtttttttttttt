// Browser-only build of the renderer (no Electron). Used for quick UI work and
// automated viewport tests; the desktop app is the primary target.
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  resolve: {
    alias: {
      '@engine': resolve(__dirname, 'src/engine'),
      '@shared': resolve(__dirname, 'src/shared'),
    },
  },
  // Relative asset URLs so the build works from any folder or host.
  base: './',
  plugins: [react()],
  build: { outDir: resolve(__dirname, 'out/web'), emptyOutDir: true, chunkSizeWarningLimit: 4000 },
  server: { port: 5199, strictPort: true },
});
