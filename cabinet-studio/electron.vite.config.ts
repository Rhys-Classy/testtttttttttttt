import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';

const alias = {
  '@engine': resolve(__dirname, 'src/engine'),
  '@shared': resolve(__dirname, 'src/shared'),
};

export default defineConfig({
  main: { resolve: { alias } },
  preload: { resolve: { alias } },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: { alias },
    plugins: [react()],
    build: { target: 'chrome140', chunkSizeWarningLimit: 4000 },
  },
});
