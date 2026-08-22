import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'frontend-src',
  publicDir: '../public',
  plugins: [react()],
  build: {
    outDir: '../frontend',
    emptyOutDir: true,
    sourcemap: false,
  },
});
