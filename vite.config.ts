/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/apartment-view-card.ts'),
      formats: ['es'],
      fileName: () => 'apartment-view-card.js',
    },
    outDir: 'dist',
    emptyOutDir: false,
    rollupOptions: {
      // Lit is bundled (HA does not provide it); no externals.
      output: { inlineDynamicImports: true },
    },
    target: 'es2022',
    minify: 'esbuild',
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
