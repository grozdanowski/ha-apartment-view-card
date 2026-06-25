/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  // Serve the dev harness from dev/ during `vite` (dev). The lib build below
  // still targets src/apartment-view-card.ts.
  root: resolve(__dirname, 'dev'),
  publicDir: resolve(__dirname, 'dev/assets'),
  resolve: {
    alias: {
      // let dev/index.html and harness import sources via @/...
      '@': resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 5174,
    open: true,
    fs: {
      // allow importing files outside dev/ (e.g. ../src/**)
      allow: [resolve(__dirname)],
    },
  },
  build: {
    lib: {
      entry: resolve(__dirname, 'src/apartment-view-card.ts'),
      formats: ['es'],
      fileName: () => 'apartment-view-card.js',
    },
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: false,
    rollupOptions: {
      output: { inlineDynamicImports: true },
    },
    target: 'es2022',
    minify: 'esbuild',
  },
  test: {
    // Single source of truth for Vitest (NO separate vitest.config.ts —
    // later phases EDIT this block, they do not create a new file).
    //
    // Environment convention:
    //   - Default environment is `node` (pure-logic tests).
    //   - Tests that use the DOM (Lit render(), querySelector, ResizeObserver,
    //     etc.) MUST declare `// @vitest-environment happy-dom` at the top of
    //     the file. Without that annotation the test runs in node and will fail.
    root: resolve(__dirname),
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
