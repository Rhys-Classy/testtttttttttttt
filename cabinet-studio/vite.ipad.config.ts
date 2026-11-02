// iPad build of the renderer (touch-first, no 3D).
// Entry: src/renderer/ipad.html -> out/ipad/ipad.html.
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
  build: { outDir: resolve(__dirname, 'out/ipad'), emptyOutDir: true, chunkSizeWarningLimit: 4000, rollupOptions: { input: resolve(__dirname, 'src/renderer/ipad.html') } },
  server: { port: 5198, strictPort: true },
});
