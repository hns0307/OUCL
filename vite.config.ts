import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src/ui',
  base: './',
  build: { outDir: '../../dist/renderer', emptyOutDir: false, target: 'es2023', sourcemap: false },
});
