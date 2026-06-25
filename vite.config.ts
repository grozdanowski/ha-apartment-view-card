/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// `projects` is a Vitest v3 runtime feature not yet in Vitest v2 types.
// The cast below silences the type gap while keeping the config readable.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyTestConfig = any;

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
    root: resolve(__dirname),
    // Split into projects: pure-logic tests run in node; DOM/render tests
    // (anything that calls lit `render()` into document, reads .style /
    // querySelector, or uses ResizeObserver) run in a Playwright browser.
    // Browser mode deps (@vitest/browser, playwright) are installed in 1.1.
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: [
            'test/config.test.ts',
            'test/geometry.test.ts',
            'test/light-color.test.ts',
            'test/entity-state.test.ts',
            'test/tap-hold.test.ts',
            'test/pan-zoom.test.ts',
            'test/zone-focus.test.ts',
            'test/zone-controls.test.ts',
            'test/zone-box-visibility.test.ts',
            'test/cone-mask.test.ts',
            'test/light-cone-render.test.ts',
            'test/effect-tv-cone.test.ts',
            'test/effect-radar.test.ts',
            'test/effect-dispatch.test.ts',
            'test/editor-helpers.test.ts',
            'test/preview-geometry.test.ts',
            'test/mock-hass.test.ts',
          ],
        },
      },
      {
        extends: true,
        test: {
          name: 'browser',
          include: [
            'test/base-layer.test.ts',
            'test/light-layer.test.ts',
            'test/marker-overlay.test.ts',
            'test/apartment-view-card.test.ts',
            'test/apartment-view-card.zone-focus.test.ts',
            'test/card-tap-action.test.ts',
            'test/effect-render.test.ts',
            'test/marker-overlay.dom.test.ts',
            'test/light-layer.dom.test.ts',
            'test/preview-canvas.test.ts',
            'test/apartment-view-card-editor.test.ts',
            'test/card-config-element.test.ts',
          ],
          browser: {
            enabled: true,
            provider: 'playwright',
            headless: true,
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],
  } as AnyTestConfig,
});
