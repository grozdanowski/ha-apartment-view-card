# Apartment View Card v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the Home Assistant `apartment-view-card` as a Lit 3 card with render-free procedural lighting (one base render required), directional cones, per-domain effects, zones with zoom+focus, and a working `ha-form` visual editor.

**Architecture:** Two render layers — a transformed image layer (base render + per-light/effect overlays, pans/zooms) and a non-transformed interactive overlay (icon buttons, positioned by computed screen coordinates so they stay crisp). Lighting is procedural by default (`lit`); the original baked multi-image system is retained as the first-class high-fidelity `reveal` style; `glow` is a flat fallback.

**Tech Stack:** Lit 3, TypeScript, Vite (lib build), Vitest browser-mode (Playwright), `ha-form`/`custom-card-helpers`, `@mdi/js`.

## Global Constraints

- Lit `^3.3`. TypeScript: target `ES2022`, module `esnext`, `moduleResolution: bundler`, `experimentalDecorators: true`, NO `emitDecoratorMetadata`, `useDefineForClassFields: false` (required for Lit decorators on ES2022).
- Bundler: Vite lib build → single `dist/apartment-view-card.js`. `hacs.json`: `"filename": "apartment-view-card.js"`, `"content_in_root": false`, `"homeassistant": "2024.3.0"`.
- Filenames kebab-case. Toggle service is `homeassistant.toggle`. `brightness` in all formulas is normalized to `[0,1]` (HA `brightness`/255; off/absent = 0); clamp resulting opacities to `[0,1]`.
- Light styles are first-class and selectable globally (`options.lightStyle`) or per-entity (`lightStyle`): `lit` (default, render-free), `reveal` (original multi-image high-fidelity, needs `allLights`), `glow` (flat).
- Tuning constants (verbatim): fade `0.3s`; `zoomMax` default `1.5`; icon scale `min(scale, 2.0)`, baseline 24px; light cone `half=30°/feather=12°`, device cone `half=34°/feather=14°`; radar = 5 arcs, 4.5px, `2.4s linear infinite`, staggered 480ms; focus dims non-zone icons to opacity `.25`; press-and-hold `≥450ms`, movement `>8px` cancels hold→pan.
- Tests: Vitest browser mode (Playwright provider) in `test/`. Commit after each green task.

---

## Phase 1: Tooling, scaffold, config + mock-hass harness

### Task 1.1: Migrate webpack → Vite, modernize tsconfig/package.json/lint, fix hacs.json, remove dead artifacts
**Files:**
- Create: `/Users/matej/Work/Matej/ha-apartment-view-card/vite.config.ts`, `/Users/matej/Work/Matej/ha-apartment-view-card/.eslintrc.cjs`, `/Users/matej/Work/Matej/ha-apartment-view-card/.prettierrc.json`, `/Users/matej/Work/Matej/ha-apartment-view-card/.prettierignore`, `/Users/matej/Work/Matej/ha-apartment-view-card/.eslintignore`, `/Users/matej/Work/Matej/ha-apartment-view-card/src/apartment-view-card.ts` (placeholder entry).
- Modify: `/Users/matej/Work/Matej/ha-apartment-view-card/package.json`, `/Users/matej/Work/Matej/ha-apartment-view-card/tsconfig.json`, `/Users/matej/Work/Matej/ha-apartment-view-card/hacs.json`, `/Users/matej/Work/Matej/ha-apartment-view-card/.gitignore`.
- Delete: `/Users/matej/Work/Matej/ha-apartment-view-card/webpack.config.js`, `/Users/matej/Work/Matej/ha-apartment-view-card/apartment-view-card.js`, `/Users/matej/Work/Matej/ha-apartment-view-card/apartment-view-card.js.LICENSE.txt`, `/Users/matej/Work/Matej/ha-apartment-view-card/dist/apartment-view-card.js`, `/Users/matej/Work/Matej/ha-apartment-view-card/dist/apartment-view-card.js.LICENSE.txt`.
- Test: none (build-config task; verified by running `npm run build`, `npm run lint`, `npm run typecheck`).

**Interfaces:** Consumes: none. Produces: npm scripts `dev` / `build` / `test` / `lint` / `typecheck` / `format`; Vite lib build emitting single `dist/apartment-view-card.js`; the `vite.config.ts` `build` section is reused by Task 1.3's dev-server section (same file).

This task has no TDD test cycle (it is pure tooling). Verification is by command output as noted in each step.

- [ ] **Remove dead deps and install the new toolchain.** Run exactly:
  ```bash
  cd /Users/matej/Work/Matej/ha-apartment-view-card && \
  npm uninstall @lit-labs/virtualizer ts-loader webpack webpack-cli && \
  npm install --save-dev vite@^5.4.0 vitest@^2.1.0 @vitest/browser@^2.1.0 playwright@^1.47.0 \
    eslint@^8.57.0 @typescript-eslint/parser@^7.18.0 @typescript-eslint/eslint-plugin@^7.18.0 \
    eslint-plugin-lit@^1.15.0 eslint-config-prettier@^9.1.0 prettier@^3.3.0 && \
  npx playwright install chromium
  ```
  Expected: installs complete with no error; `@lit-labs/virtualizer`, `ts-loader`, `webpack`, `webpack-cli` are gone from `package.json`. (Keep `lit ^3.3.0`, `@mdi/js`, `custom-card-helpers`.)

- [ ] **Delete the v1 webpack build and stale dist/root artifacts.** Run exactly:
  ```bash
  cd /Users/matej/Work/Matej/ha-apartment-view-card && \
  rm -f webpack.config.js apartment-view-card.js apartment-view-card.js.LICENSE.txt \
        dist/apartment-view-card.js dist/apartment-view-card.js.LICENSE.txt
  ```
  Expected: files removed; `dist/.gitkeep` remains.

- [ ] **Rewrite `package.json`** to the Vite/Vitest/lint scripts. Write the full file `/Users/matej/Work/Matej/ha-apartment-view-card/package.json` (preserve installed dependency version ranges; if your installed ranges differ, keep the installed ones — only `scripts`, `main`, `type` are authoritative here):
  ```json
  {
    "name": "ha-apartment-view-card",
    "version": "2.0.0",
    "description": "Home Assistant custom Lovelace card overlaying interactive, state-aware device markers and procedural lighting on a floorplan render.",
    "type": "module",
    "main": "dist/apartment-view-card.js",
    "scripts": {
      "dev": "vite",
      "build": "tsc --noEmit && vite build",
      "test": "vitest run",
      "test:watch": "vitest",
      "typecheck": "tsc --noEmit",
      "lint": "eslint \"src/**/*.ts\" \"dev/**/*.ts\" \"test/**/*.ts\"",
      "format": "prettier --write \"src/**/*.ts\" \"dev/**/*.ts\" \"test/**/*.ts\""
    },
    "keywords": ["home-assistant", "lovelace", "custom-card", "lit"],
    "author": "grozdanowski",
    "license": "MIT",
    "dependencies": {
      "@mdi/js": "^7.4.47",
      "custom-card-helpers": "^1.9.0",
      "lit": "^3.3.0"
    },
    "devDependencies": {
      "@typescript-eslint/eslint-plugin": "^7.18.0",
      "@typescript-eslint/parser": "^7.18.0",
      "@vitest/browser": "^2.1.0",
      "eslint": "^8.57.0",
      "eslint-config-prettier": "^9.1.0",
      "eslint-plugin-lit": "^1.15.0",
      "playwright": "^1.47.0",
      "prettier": "^3.3.0",
      "typescript": "^5.8.3",
      "vite": "^5.4.0",
      "vitest": "^2.1.0"
    }
  }
  ```

- [ ] **Rewrite `tsconfig.json`** per the global constraints (target ES2022, module esnext, moduleResolution bundler, `experimentalDecorators: true`, NO `emitDecoratorMetadata`, NO `paths`). Write the full file `/Users/matej/Work/Matej/ha-apartment-view-card/tsconfig.json`:
  ```json
  {
    "compilerOptions": {
      "target": "ES2022",
      "module": "esnext",
      "lib": ["ES2022", "DOM", "DOM.Iterable"],
      "moduleResolution": "bundler",
      "strict": true,
      "noImplicitAny": true,
      "strictNullChecks": true,
      "noImplicitReturns": true,
      "noUnusedLocals": true,
      "noUnusedParameters": true,
      "esModuleInterop": true,
      "experimentalDecorators": true,
      "useDefineForClassFields": false,
      "skipLibCheck": true,
      "forceConsistentCasingInFileNames": true,
      "types": ["vite/client"]
    },
    "include": ["src/**/*.ts", "dev/**/*.ts", "test/**/*.ts", "vite.config.ts"],
    "exclude": [
      "node_modules",
      "dist",
      "src/ApartmentViewCard.ts",
      "src/ApartmentViewCardEditor.ts",
      "src/ApartmentViewCard.d.ts",
      "src/ApartmentViewCardEditor.d.ts"
    ]
  }
  ```
  Note: `useDefineForClassFields: false` is required for Lit decorators with TС targets ≥ ES2022 (otherwise `@property`/`@state` fields are clobbered by class-field initialization).

- [ ] **Create a placeholder entry module** so the lib build has a real input (the full card lands in Phase 2; this keeps Phase 1 building green). Write `/Users/matej/Work/Matej/ha-apartment-view-card/src/apartment-view-card.ts`:
  ```ts
  // Entry module. The full orchestrator LitElement is implemented in Phase 2.
  // Phase 1 only needs a valid build input and the global custom-cards registration.
  export const CARD_TYPE = 'apartment-view-card';

  if (!(window as any).customCards) {
    (window as any).customCards = [];
  }
  if (
    !(window as any).customCards.find(
      (card: any) => card.type === CARD_TYPE,
    )
  ) {
    (window as any).customCards.push({
      type: CARD_TYPE,
      name: 'Apartment View Card',
      description:
        'Interactive, state-aware device markers and procedural lighting on a floorplan render.',
      preview: true,
      documentationURL:
        'https://github.com/grozdanowski/ha-apartment-view-card',
    });
  }
  ```

- [ ] **Create `vite.config.ts`** with the lib build emitting the single canonical output. The dev-server `server`/`root` section is added in Task 1.3 — for now write the build-only config. Write `/Users/matej/Work/Matej/ha-apartment-view-card/vite.config.ts`:
  ```ts
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
  });
  ```
  Note `emptyOutDir: false` preserves `dist/.gitkeep` (avoids the Vite "outDir is not inside project root / will be emptied" wipe of the tracked keep-file).

- [ ] **Fix `hacs.json`** per the locked contract. Write the full file `/Users/matej/Work/Matej/ha-apartment-view-card/hacs.json`:
  ```json
  {
    "name": "Apartment View Card",
    "render_readme": true,
    "filename": "apartment-view-card.js",
    "content_in_root": false,
    "domains": ["light", "media_player", "climate"],
    "homeassistant": "2024.3.0",
    "iot_class": "calculated"
  }
  ```

- [ ] **Create ESLint config** with TypeScript + lit + prettier. Write `/Users/matej/Work/Matej/ha-apartment-view-card/.eslintrc.cjs`:
  ```js
  module.exports = {
    root: true,
    parser: '@typescript-eslint/parser',
    parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
    plugins: ['@typescript-eslint', 'lit'],
    extends: [
      'eslint:recommended',
      'plugin:@typescript-eslint/recommended',
      'plugin:lit/recommended',
      'prettier',
    ],
    env: { browser: true, es2022: true, node: true },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  };
  ```

- [ ] **Create `.eslintignore`** at `/Users/matej/Work/Matej/ha-apartment-view-card/.eslintignore`:
  ```
  node_modules
  dist
  dev/assets
  dev/prototype.html
  src/ApartmentViewCard.ts
  src/ApartmentViewCardEditor.ts
  ```
  (v1 sources are excluded from lint — they are reference-only and deleted in Phase 6; do not lint them.)

- [ ] **Create Prettier config.** Write `/Users/matej/Work/Matej/ha-apartment-view-card/.prettierrc.json`:
  ```json
  {
    "singleQuote": true,
    "trailingComma": "all",
    "printWidth": 80,
    "semi": true
  }
  ```
  And `/Users/matej/Work/Matej/ha-apartment-view-card/.prettierignore`:
  ```
  node_modules
  dist
  dev/assets
  package-lock.json
  ```

- [ ] **Update `.gitignore`** to stop tracking the root duplicate and keep dist contents ignored. Edit `/Users/matej/Work/Matej/ha-apartment-view-card/.gitignore` — append below the existing `Build output` block:
  ```
  # Root-level build duplicate (v1 webpack output — no longer produced)
  /apartment-view-card.js
  /apartment-view-card.js.LICENSE.txt
  ```

- [ ] **Verify typecheck passes.** Run:
  ```bash
  cd /Users/matej/Work/Matej/ha-apartment-view-card && npm run typecheck
  ```
  Expected: exits 0, no output. (The v1 `src/ApartmentViewCard.ts` / `ApartmentViewCardEditor.ts` are reference-only and replaced in Phase 2/6; they are already in the `tsconfig.json` `exclude` array above, so the stricter `noUnusedLocals`/`noUnusedParameters` config never typechecks them.)

- [ ] **Verify the lib build emits the single canonical output.** Run:
  ```bash
  cd /Users/matej/Work/Matej/ha-apartment-view-card && npm run build && ls -la dist
  ```
  Expected: build succeeds; `dist/apartment-view-card.js` exists (one JS file); `dist/.gitkeep` still present.

- [ ] **Verify lint passes.** Run:
  ```bash
  cd /Users/matej/Work/Matej/ha-apartment-view-card && npm run lint
  ```
  Expected: exits 0, no errors.

- [ ] **Commit.** Run:
  ```bash
  cd /Users/matej/Work/Matej/ha-apartment-view-card && \
  git add -A && \
  git commit -m "build: migrate webpack to Vite, add ESLint/Prettier/Vitest, fix hacs.json, remove dead artifacts"
  ```

---

### Task 1.2: `core/config.ts` — types, `normalizeConfig`, `zoneForPoint` with unit tests
**Files:**
- Create: `/Users/matej/Work/Matej/ha-apartment-view-card/src/core/config.ts`.
- Modify: `/Users/matej/Work/Matej/ha-apartment-view-card/vite.config.ts` (add Vitest `test` config block for Node-environment unit tests).
- Test: `/Users/matej/Work/Matej/ha-apartment-view-card/test/config.test.ts`.

**Interfaces:**
- Consumes: none (foundational module).
- Produces (CONTRACT, verbatim):
  - `type LightStyle = 'lit' | 'reveal' | 'glow';`
  - `type SizeTier = 'tiny' | 'small' | 'medium' | 'large' | 'huge';`
  - `type TapAction = 'toggle' | 'more-info' | 'none';`
  - `interface EntityConfig { entity: string; name?: string; icon?: string; x: number; y: number; size: SizeTier; tap: TapAction; orientation: number | null; lightStyle?: LightStyle; }`
  - `interface ZoneConfig { name: string; icon?: string; x: number; y: number; width: number; height: number; }`
  - `interface ImagesConfig { base: string; allLights?: string; night?: string; duskDawn?: string; }`
  - `interface CardOptions { view: 'auto'|'day'|'night'|'duskDawn'; lightStyle: LightStyle; freePanZoom: boolean; zoomMax: number; duskDawnOffsetMinutes: number; }`
  - `interface ApartmentViewConfig { type: string; images: ImagesConfig; entities: EntityConfig[]; zones: ZoneConfig[]; options: CardOptions; }`
  - `function normalizeConfig(raw: any): ApartmentViewConfig`
  - `function zoneForPoint(x: number, y: number, zones: ZoneConfig[]): ZoneConfig | null`

- [ ] **Add the Vitest config block to `vite.config.ts`** so unit tests run in a Node environment (browser-mode component tests come later; `config.ts` is pure logic and needs no DOM). Edit `/Users/matej/Work/Matej/ha-apartment-view-card/vite.config.ts`. First add the triple-slash directive as the very first line:
  ```ts
  /// <reference types="vitest/config" />
  ```
  Then add a `test` property to the `defineConfig` object (sibling of `build`):
  ```ts
    test: {
      environment: 'node',
      include: ['test/**/*.test.ts'],
    },
  ```
  So the full file now reads:
  ```ts
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
  ```
  > This is the INITIAL node-only test block; Task 1.3 grows it into two Vitest `projects` (a `node` project for pure-logic tests and a `browser` project using the Playwright provider) so the DOM/render tests written in Phases 2+ run. There is no separate `vitest.config.ts` — this `test` block in `vite.config.ts` is the single source of truth.

- [ ] **Write the failing test file** `/Users/matej/Work/Matej/ha-apartment-view-card/test/config.test.ts` (full content). This locks defaults, every legacy rename, unknown-key preservation, the missing-`images.base` throw, and `zoneForPoint` smallest-area semantics:
  ```ts
  import { describe, it, expect } from 'vitest';
  import {
    normalizeConfig,
    zoneForPoint,
    type ApartmentViewConfig,
    type ZoneConfig,
  } from '../src/core/config';

  describe('normalizeConfig', () => {
    it('throws when images.base is missing', () => {
      expect(() => normalizeConfig({ type: 'x' })).toThrow(/images\.base/);
      expect(() =>
        normalizeConfig({ type: 'x', images: {} }),
      ).toThrow(/images\.base/);
    });

    it('accepts legacy top-level dayImage as images.base', () => {
      const cfg = normalizeConfig({
        type: 'custom:apartment-view-card',
        dayImage: '/local/day.png',
      });
      expect(cfg.images.base).toBe('/local/day.png');
    });

    it('fills option defaults', () => {
      const cfg = normalizeConfig({ images: { base: '/b.png' } });
      expect(cfg.options).toEqual({
        view: 'auto',
        lightStyle: 'lit',
        freePanZoom: true,
        zoomMax: 1.5,
        duskDawnOffsetMinutes: 60,
      });
      expect(cfg.entities).toEqual([]);
      expect(cfg.zones).toEqual([]);
    });

    it('maps legacy image keys into images object', () => {
      const cfg = normalizeConfig({
        dayImage: '/d.png',
        allLightsImage: '/all.png',
        nightImage: '/n.png',
        duskdawnImage: '/dd.png',
      });
      expect(cfg.images).toEqual({
        base: '/d.png',
        allLights: '/all.png',
        night: '/n.png',
        duskDawn: '/dd.png',
      });
    });

    it('prefers explicit images.base over legacy dayImage', () => {
      const cfg = normalizeConfig({
        images: { base: '/new.png' },
        dayImage: '/old.png',
      });
      expect(cfg.images.base).toBe('/new.png');
    });

    it('maps legacy objects[] -> entities[] with per-field renames', () => {
      const cfg = normalizeConfig({
        images: { base: '/b.png' },
        objects: [
          {
            entityName: 'light.kitchen',
            customName: 'Kitchen',
            customIcon: 'mdi:ceiling-light',
            offsetX: 35,
            offsetY: 16,
            size: 'small',
            disableService: true,
          },
        ],
      });
      expect(cfg.entities).toHaveLength(1);
      expect(cfg.entities[0]).toEqual({
        entity: 'light.kitchen',
        name: 'Kitchen',
        icon: 'mdi:ceiling-light',
        x: 35,
        y: 16,
        size: 'small',
        tap: 'none',
        orientation: null,
      });
    });

    it('maps disableService:false -> tap:toggle', () => {
      const cfg = normalizeConfig({
        images: { base: '/b.png' },
        objects: [{ entityName: 'light.a', disableService: false }],
      });
      expect(cfg.entities[0].tap).toBe('toggle');
    });

    it('fills entity defaults for a v2 entity', () => {
      const cfg = normalizeConfig({
        images: { base: '/b.png' },
        entities: [{ entity: 'light.a', x: 10, y: 20 }],
      });
      expect(cfg.entities[0]).toEqual({
        entity: 'light.a',
        x: 10,
        y: 20,
        size: 'medium',
        tap: 'toggle',
        orientation: null,
      });
    });

    it('preserves a numeric orientation and lightStyle override', () => {
      const cfg = normalizeConfig({
        images: { base: '/b.png' },
        entities: [
          { entity: 'light.a', x: 1, y: 2, orientation: 90, lightStyle: 'glow' },
        ],
      });
      expect(cfg.entities[0].orientation).toBe(90);
      expect(cfg.entities[0].lightStyle).toBe('glow');
    });

    it('normalizes zones, defaulting absent name', () => {
      const cfg = normalizeConfig({
        images: { base: '/b.png' },
        zones: [{ x: 1, y: 2, width: 10, height: 20, icon: 'mdi:sofa' }],
      });
      expect(cfg.zones[0]).toEqual({
        name: 'Zone',
        icon: 'mdi:sofa',
        x: 1,
        y: 2,
        width: 10,
        height: 20,
      });
    });

    it('preserves unknown top-level keys (v1 columns/rows bug)', () => {
      const cfg = normalizeConfig({
        images: { base: '/b.png' },
        columns: 2,
        rows: 3,
        somethingFuture: { a: 1 },
      }) as ApartmentViewConfig & Record<string, unknown>;
      expect(cfg.columns).toBe(2);
      expect(cfg.rows).toBe(3);
      expect(cfg.somethingFuture).toEqual({ a: 1 });
    });

    it('sets type when absent', () => {
      const cfg = normalizeConfig({ images: { base: '/b.png' } });
      expect(cfg.type).toBe('custom:apartment-view-card');
    });

    it('preserves a provided type verbatim', () => {
      const cfg = normalizeConfig({
        type: 'custom:apartment-view-card',
        images: { base: '/b.png' },
      });
      expect(cfg.type).toBe('custom:apartment-view-card');
    });
  });

  describe('zoneForPoint', () => {
    const big: ZoneConfig = { name: 'big', x: 0, y: 0, width: 100, height: 100 };
    const small: ZoneConfig = { name: 'small', x: 40, y: 40, width: 20, height: 20 };

    it('returns null when no zone contains the point', () => {
      expect(zoneForPoint(5, 5, [small])).toBeNull();
    });

    it('returns the only containing zone', () => {
      expect(zoneForPoint(5, 5, [big])).toBe(big);
    });

    it('returns the smallest-AREA zone when multiple contain the point', () => {
      expect(zoneForPoint(50, 50, [big, small])).toBe(small);
      // order independent
      expect(zoneForPoint(50, 50, [small, big])).toBe(small);
    });

    it('treats rectangle edges as inside (inclusive bounds)', () => {
      expect(zoneForPoint(0, 0, [big])).toBe(big);
      expect(zoneForPoint(100, 100, [big])).toBe(big);
    });

    it('returns null for an empty zone list', () => {
      expect(zoneForPoint(50, 50, [])).toBeNull();
    });
  });
  ```

- [ ] **Run the test and expect failure** (module does not exist yet):
  ```bash
  cd /Users/matej/Work/Matej/ha-apartment-view-card && npx vitest run test/config.test.ts
  ```
  Expected: fails with a resolution error like `Failed to resolve import "../src/core/config"` / `Cannot find module`.

- [ ] **Implement `src/core/config.ts`** (full content; CONTRACT names verbatim). Legacy renames: `objects→entities`, `offsetX/offsetY→x/y`, `entityName→entity`, `customName→name`, `customIcon→icon`, `disableService→tap` (true→`'none'`, false/absent→`'toggle'`); legacy image keys `dayImage/allLightsImage/nightImage/duskdawnImage`. Unknown top-level keys are preserved by spreading `raw` first then overwriting the known shape. Throws if no `images.base` (after legacy fallback). Write `/Users/matej/Work/Matej/ha-apartment-view-card/src/core/config.ts`:
  ```ts
  export type LightStyle = 'lit' | 'reveal' | 'glow';
  export type SizeTier = 'tiny' | 'small' | 'medium' | 'large' | 'huge';
  export type TapAction = 'toggle' | 'more-info' | 'none';

  export interface EntityConfig {
    entity: string;
    name?: string;
    icon?: string;
    x: number;
    y: number;
    size: SizeTier;
    tap: TapAction;
    orientation: number | null;
    lightStyle?: LightStyle;
  }

  export interface ZoneConfig {
    name: string;
    icon?: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }

  export interface ImagesConfig {
    base: string;
    allLights?: string;
    night?: string;
    duskDawn?: string;
  }

  export interface CardOptions {
    view: 'auto' | 'day' | 'night' | 'duskDawn';
    lightStyle: LightStyle;
    freePanZoom: boolean;
    zoomMax: number;
    duskDawnOffsetMinutes: number;
  }

  export interface ApartmentViewConfig {
    type: string;
    images: ImagesConfig;
    entities: EntityConfig[];
    zones: ZoneConfig[];
    options: CardOptions;
  }

  const CARD_TYPE = 'custom:apartment-view-card';

  const VALID_SIZES: readonly SizeTier[] = [
    'tiny',
    'small',
    'medium',
    'large',
    'huge',
  ];
  const VALID_TAPS: readonly TapAction[] = ['toggle', 'more-info', 'none'];
  const VALID_STYLES: readonly LightStyle[] = ['lit', 'reveal', 'glow'];
  const VALID_VIEWS: readonly CardOptions['view'][] = [
    'auto',
    'day',
    'night',
    'duskDawn',
  ];

  function normalizeImages(raw: any): ImagesConfig {
    const src = raw?.images ?? {};
    const base = src.base ?? raw?.dayImage;
    if (typeof base !== 'string' || base.length === 0) {
      throw new Error(
        'apartment-view-card: images.base is required (a lights-off base render).',
      );
    }
    const images: ImagesConfig = { base };
    const allLights = src.allLights ?? raw?.allLightsImage;
    const night = src.night ?? raw?.nightImage;
    const duskDawn = src.duskDawn ?? raw?.duskdawnImage;
    if (typeof allLights === 'string') images.allLights = allLights;
    if (typeof night === 'string') images.night = night;
    if (typeof duskDawn === 'string') images.duskDawn = duskDawn;
    return images;
  }

  function normalizeSize(value: any): SizeTier {
    return VALID_SIZES.includes(value) ? value : 'medium';
  }

  function normalizeTapFromEntity(raw: any): TapAction {
    if (VALID_TAPS.includes(raw?.tap)) return raw.tap;
    // legacy disableService -> tap
    if (raw?.disableService === true) return 'none';
    if (raw?.disableService === false) return 'toggle';
    return 'toggle';
  }

  function normalizeOrientation(value: any): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }

  function normalizeEntity(raw: any): EntityConfig {
    const entity: EntityConfig = {
      entity: raw?.entity ?? raw?.entityName ?? '',
      x: typeof raw?.x === 'number' ? raw.x : (raw?.offsetX ?? 50),
      y: typeof raw?.y === 'number' ? raw.y : (raw?.offsetY ?? 50),
      size: normalizeSize(raw?.size),
      tap: normalizeTapFromEntity(raw),
      orientation: normalizeOrientation(raw?.orientation),
    };
    const name = raw?.name ?? raw?.customName;
    const icon = raw?.icon ?? raw?.customIcon;
    if (typeof name === 'string' && name.length > 0) entity.name = name;
    if (typeof icon === 'string' && icon.length > 0) entity.icon = icon;
    if (VALID_STYLES.includes(raw?.lightStyle)) {
      entity.lightStyle = raw.lightStyle;
    }
    return entity;
  }

  function normalizeZone(raw: any): ZoneConfig {
    const zone: ZoneConfig = {
      name: typeof raw?.name === 'string' && raw.name.length > 0 ? raw.name : 'Zone',
      x: Number(raw?.x) || 0,
      y: Number(raw?.y) || 0,
      width: Number(raw?.width) || 0,
      height: Number(raw?.height) || 0,
    };
    if (typeof raw?.icon === 'string' && raw.icon.length > 0) zone.icon = raw.icon;
    return zone;
  }

  function normalizeOptions(raw: any): CardOptions {
    const o = raw?.options ?? {};
    return {
      view: VALID_VIEWS.includes(o.view) ? o.view : 'auto',
      lightStyle: VALID_STYLES.includes(o.lightStyle) ? o.lightStyle : 'lit',
      freePanZoom: typeof o.freePanZoom === 'boolean' ? o.freePanZoom : true,
      zoomMax: typeof o.zoomMax === 'number' ? o.zoomMax : 1.5,
      duskDawnOffsetMinutes:
        typeof o.duskDawnOffsetMinutes === 'number'
          ? o.duskDawnOffsetMinutes
          : 60,
    };
  }

  /**
   * Normalize raw Lovelace config: fill defaults, migrate legacy keys, and
   * PRESERVE unknown top-level keys (v1 silently dropped columns/rows/zones).
   * Throws if no images.base can be resolved.
   */
  export function normalizeConfig(raw: any): ApartmentViewConfig {
    const source = raw ?? {};
    const rawEntities: any[] = Array.isArray(source.entities)
      ? source.entities
      : Array.isArray(source.objects)
        ? source.objects
        : [];
    const rawZones: any[] = Array.isArray(source.zones) ? source.zones : [];

    // Spread unknown keys first, then overwrite the canonical shape. Strip the
    // legacy flat keys we have folded into `images`/`entities`.
    const {
      objects: _objects,
      dayImage: _dayImage,
      allLightsImage: _allLightsImage,
      nightImage: _nightImage,
      duskdawnImage: _duskdawnImage,
      ...rest
    } = source;

    return {
      ...rest,
      type: typeof source.type === 'string' ? source.type : CARD_TYPE,
      images: normalizeImages(source),
      entities: rawEntities.map(normalizeEntity),
      zones: rawZones.map(normalizeZone),
      options: normalizeOptions(source),
    };
  }

  /**
   * Return the smallest-AREA zone whose rectangle contains (x, y), inclusive of
   * edges; null if none. Coordinates and dimensions are in the same percentage
   * space as the config.
   */
  export function zoneForPoint(
    x: number,
    y: number,
    zones: ZoneConfig[],
  ): ZoneConfig | null {
    let best: ZoneConfig | null = null;
    let bestArea = Infinity;
    for (const zone of zones) {
      const inside =
        x >= zone.x &&
        x <= zone.x + zone.width &&
        y >= zone.y &&
        y <= zone.y + zone.height;
      if (!inside) continue;
      const area = zone.width * zone.height;
      if (area < bestArea) {
        bestArea = area;
        best = zone;
      }
    }
    return best;
  }
  ```

- [ ] **Run the test and expect pass:**
  ```bash
  cd /Users/matej/Work/Matej/ha-apartment-view-card && npx vitest run test/config.test.ts
  ```
  Expected: all tests pass (2 suites, ~18 tests green).

- [ ] **Verify typecheck + lint stay green:**
  ```bash
  cd /Users/matej/Work/Matej/ha-apartment-view-card && npm run typecheck && npm run lint
  ```
  Expected: both exit 0.

- [ ] **Commit:**
  ```bash
  cd /Users/matej/Work/Matej/ha-apartment-view-card && \
  git add -A && \
  git commit -m "feat(config): add normalizeConfig + zoneForPoint with legacy migration, unknown-key preservation, and unit tests"
  ```

---

### Task 1.3: `dev/mock-hass.ts` factory + `dev/index.html` + Vite dev harness with control panel
**Files:**
- Create: `/Users/matej/Work/Matej/ha-apartment-view-card/dev/mock-hass.ts`, `/Users/matej/Work/Matej/ha-apartment-view-card/dev/index.html`, `/Users/matej/Work/Matej/ha-apartment-view-card/dev/harness.ts`.
- Modify: `/Users/matej/Work/Matej/ha-apartment-view-card/vite.config.ts` (add a dev `server`/`root`-aware setup so `npm run dev` serves `dev/index.html` with the repo root as a public source so `/src/...` and `/dev/assets/...` resolve).
- Test: `/Users/matej/Work/Matej/ha-apartment-view-card/test/mock-hass.test.ts`.

**Interfaces:**
- Consumes: none of the typed CONTRACT modules directly, but the mock must shape entities so downstream `isActive`/`intensity`/`resolveLightColor` (Phase 2) read them correctly: lights expose `state` + `attributes.brightness` + color attrs; `media_player` exposes `state`; `climate` exposes `state` + `attributes.hvac_action`; plus `sun.sun` with `next_rising`/`next_setting`.
- Produces (dev/test surface — these names are reused by Tier 2 component tests in later phases):
  - `interface MockHassEntity { entity_id: string; state: string; attributes: Record<string, any>; last_changed: string; last_updated: string; context: { id: string; parent_id: null; user_id: null }; }`
  - `interface ServiceCall { domain: string; service: string; data: Record<string, any>; }`
  - `interface MockHass { states: Record<string, MockHassEntity>; callService(domain: string, service: string, data?: Record<string, any>): Promise<void>; readonly serviceCalls: ServiceCall[]; }`
  - `function createMockHass(overrides?: Record<string, Partial<MockHassEntity>>): MockHass` — seeds `light.kitchen_ceiling`, `light.living_lamp`, `media_player.tv`, `media_player.kitchen_speaker`, `climate.bedroom_ac`, `sun.sun`; `callService` records into `serviceCalls` and applies `homeassistant.toggle` to the target light's `state`.
  - `function setSunForTimeOfDay(hass: MockHass, tod: 'day' | 'night' | 'duskDawn'): void` — sets `sun.sun` state + `next_rising`/`next_setting` so a `view:auto` resolver lands on the requested time-of-day.

- [ ] **Write the failing test file** `/Users/matej/Work/Matej/ha-apartment-view-card/test/mock-hass.test.ts` (full content). This pins the seeded entities, the `callService` spy behavior, the toggle side-effect, and `setSunForTimeOfDay`:
  ```ts
  import { describe, it, expect } from 'vitest';
  import { createMockHass, setSunForTimeOfDay } from '../dev/mock-hass';

  describe('createMockHass', () => {
    it('seeds the canonical entity set', () => {
      const hass = createMockHass();
      expect(hass.states['light.kitchen_ceiling']).toBeDefined();
      expect(hass.states['light.living_lamp']).toBeDefined();
      expect(hass.states['media_player.tv']).toBeDefined();
      expect(hass.states['media_player.kitchen_speaker']).toBeDefined();
      expect(hass.states['climate.bedroom_ac']).toBeDefined();
      expect(hass.states['sun.sun']).toBeDefined();
    });

    it('seeds a light with normalized-able brightness and rgb color', () => {
      const hass = createMockHass();
      const light = hass.states['light.kitchen_ceiling'];
      expect(light.state).toBe('on');
      expect(typeof light.attributes.brightness).toBe('number');
      expect(Array.isArray(light.attributes.rgb_color)).toBe(true);
    });

    it('seeds climate with an hvac_action attribute', () => {
      const hass = createMockHass();
      expect(hass.states['climate.bedroom_ac'].attributes.hvac_action).toBeDefined();
    });

    it('records every callService into serviceCalls (spy)', async () => {
      const hass = createMockHass();
      await hass.callService('homeassistant', 'toggle', {
        entity_id: 'light.kitchen_ceiling',
      });
      expect(hass.serviceCalls).toHaveLength(1);
      expect(hass.serviceCalls[0]).toEqual({
        domain: 'homeassistant',
        service: 'toggle',
        data: { entity_id: 'light.kitchen_ceiling' },
      });
    });

    it('homeassistant.toggle flips the target light state', async () => {
      const hass = createMockHass();
      expect(hass.states['light.kitchen_ceiling'].state).toBe('on');
      await hass.callService('homeassistant', 'toggle', {
        entity_id: 'light.kitchen_ceiling',
      });
      expect(hass.states['light.kitchen_ceiling'].state).toBe('off');
      await hass.callService('homeassistant', 'toggle', {
        entity_id: 'light.kitchen_ceiling',
      });
      expect(hass.states['light.kitchen_ceiling'].state).toBe('on');
    });

    it('applies overrides over seeded defaults', () => {
      const hass = createMockHass({
        'light.living_lamp': { state: 'off' },
      });
      expect(hass.states['light.living_lamp'].state).toBe('off');
      // unrelated seeded entities still present
      expect(hass.states['light.kitchen_ceiling'].state).toBe('on');
    });
  });

  describe('setSunForTimeOfDay', () => {
    it('night: sun below horizon', () => {
      const hass = createMockHass();
      setSunForTimeOfDay(hass, 'night');
      expect(hass.states['sun.sun'].state).toBe('below_horizon');
    });

    it('day: sun above horizon and not within the dusk/dawn window', () => {
      const hass = createMockHass();
      setSunForTimeOfDay(hass, 'day');
      expect(hass.states['sun.sun'].state).toBe('above_horizon');
      const now = Date.now();
      const rising = new Date(
        hass.states['sun.sun'].attributes.next_rising,
      ).getTime();
      const setting = new Date(
        hass.states['sun.sun'].attributes.next_setting,
      ).getTime();
      // next sunrise is far in the future, next sunset is > 60min away
      expect(rising - now).toBeGreaterThan(60 * 60_000);
      expect(setting - now).toBeGreaterThan(60 * 60_000);
    });

    it('duskDawn: next sunrise within the 60min default window', () => {
      const hass = createMockHass();
      setSunForTimeOfDay(hass, 'duskDawn');
      const now = Date.now();
      const rising = new Date(
        hass.states['sun.sun'].attributes.next_rising,
      ).getTime();
      expect(Math.abs(rising - now)).toBeLessThanOrEqual(60 * 60_000);
    });
  });
  ```

- [ ] **Run the test and expect failure** (module does not exist):
  ```bash
  cd /Users/matej/Work/Matej/ha-apartment-view-card && npx vitest run test/mock-hass.test.ts
  ```
  Expected: fails resolving `../dev/mock-hass`.

- [ ] **Implement `dev/mock-hass.ts`** (full content). Mirrors HA `hass.states` shape; `callService` is a spy that records calls and applies `homeassistant.toggle` to lights (and is harmless for other domains). `setSunForTimeOfDay` shapes `sun.sun` so a `view:auto` resolver (Phase 2) lands on the chosen mode under the 60-minute default window. Write `/Users/matej/Work/Matej/ha-apartment-view-card/dev/mock-hass.ts`:
  ```ts
  export interface MockHassEntity {
    entity_id: string;
    state: string;
    attributes: Record<string, any>;
    last_changed: string;
    last_updated: string;
    context: { id: string; parent_id: null; user_id: null };
  }

  export interface ServiceCall {
    domain: string;
    service: string;
    data: Record<string, any>;
  }

  export interface MockHass {
    states: Record<string, MockHassEntity>;
    callService(
      domain: string,
      service: string,
      data?: Record<string, any>,
    ): Promise<void>;
    readonly serviceCalls: ServiceCall[];
  }

  let ctxCounter = 0;
  function nowIso(): string {
    return new Date().toISOString();
  }

  function makeEntity(
    entity_id: string,
    state: string,
    attributes: Record<string, any>,
  ): MockHassEntity {
    const ts = nowIso();
    return {
      entity_id,
      state,
      attributes,
      last_changed: ts,
      last_updated: ts,
      context: { id: `mock-${ctxCounter++}`, parent_id: null, user_id: null },
    };
  }

  function seedStates(): Record<string, MockHassEntity> {
    return {
      'light.kitchen_ceiling': makeEntity('light.kitchen_ceiling', 'on', {
        friendly_name: 'Kitchen ceiling',
        brightness: 204, // ~0.8 normalized
        color_mode: 'rgb',
        rgb_color: [255, 244, 214],
        supported_color_modes: ['rgb', 'color_temp'],
      }),
      'light.living_lamp': makeEntity('light.living_lamp', 'on', {
        friendly_name: 'Living room lamp',
        brightness: 128, // ~0.5 normalized
        color_mode: 'color_temp',
        color_temp_kelvin: 2700,
        supported_color_modes: ['color_temp'],
      }),
      'media_player.tv': makeEntity('media_player.tv', 'playing', {
        friendly_name: 'Living room TV',
        device_class: 'tv',
      }),
      'media_player.kitchen_speaker': makeEntity(
        'media_player.kitchen_speaker',
        'playing',
        {
          friendly_name: 'Kitchen speaker',
          device_class: 'speaker',
        },
      ),
      'climate.bedroom_ac': makeEntity('climate.bedroom_ac', 'cool', {
        friendly_name: 'Bedroom A/C',
        hvac_action: 'cooling',
        current_temperature: 24,
        temperature: 21,
      }),
      'sun.sun': makeEntity('sun.sun', 'above_horizon', {
        friendly_name: 'Sun',
        // far-future placeholders; refined via setSunForTimeOfDay
        next_rising: new Date(Date.now() + 12 * 3_600_000).toISOString(),
        next_setting: new Date(Date.now() + 6 * 3_600_000).toISOString(),
      }),
    };
  }

  /** A light is a light whose entity_id is in the light domain. */
  function isLightId(entityId: string): boolean {
    return entityId.startsWith('light.');
  }

  /**
   * Create a mock `hass` with a canonical entity set and a recording
   * callService spy. `homeassistant.toggle` flips a target light's state so
   * the dev harness reflects taps; other services are recorded but inert.
   */
  export function createMockHass(
    overrides: Record<string, Partial<MockHassEntity>> = {},
  ): MockHass {
    const states = seedStates();
    for (const [id, patch] of Object.entries(overrides)) {
      const base = states[id] ?? makeEntity(id, 'unknown', {});
      states[id] = {
        ...base,
        ...patch,
        attributes: { ...base.attributes, ...(patch.attributes ?? {}) },
      };
    }

    const serviceCalls: ServiceCall[] = [];

    const hass: MockHass = {
      states,
      serviceCalls,
      async callService(domain, service, data = {}) {
        serviceCalls.push({ domain, service, data: { ...data } });
        if (domain === 'homeassistant' && service === 'toggle') {
          const ids = ([] as string[]).concat(data.entity_id ?? []);
          for (const id of ids) {
            const ent = states[id];
            if (!ent) continue;
            const next = ent.state === 'off' ? 'on' : 'off';
            states[id] = {
              ...ent,
              state: isLightId(id) ? next : next,
              last_changed: nowIso(),
              last_updated: nowIso(),
            };
          }
        }
      },
    };
    return hass;
  }

  /**
   * Shape sun.sun so a view:auto resolver under the 60-minute default window
   * lands on the requested time-of-day.
   *   night    -> below_horizon, next sunrise comfortably in the future
   *   day      -> above_horizon, next sunrise/sunset both > 60min away
   *   duskDawn -> above_horizon, next sunrise within the 60min window
   */
  export function setSunForTimeOfDay(
    hass: MockHass,
    tod: 'day' | 'night' | 'duskDawn',
  ): void {
    const now = Date.now();
    const min = 60_000;
    const sun = hass.states['sun.sun'];
    let state: string;
    let nextRising: number;
    let nextSetting: number;
    switch (tod) {
      case 'night':
        state = 'below_horizon';
        nextRising = now + 6 * 60 * min; // sunrise 6h away
        nextSetting = now + 18 * 60 * min;
        break;
      case 'duskDawn':
        state = 'above_horizon';
        nextRising = now + 30 * min; // within +/-60min window
        nextSetting = now + 10 * 60 * min;
        break;
      case 'day':
      default:
        state = 'above_horizon';
        nextRising = now + 18 * 60 * min;
        nextSetting = now + 8 * 60 * min; // > 60min away
        break;
    }
    hass.states['sun.sun'] = {
      ...sun,
      state,
      attributes: {
        ...sun.attributes,
        next_rising: new Date(nextRising).toISOString(),
        next_setting: new Date(nextSetting).toISOString(),
      },
      last_changed: nowIso(),
      last_updated: nowIso(),
    };
  }
  ```

- [ ] **Run the test and expect pass:**
  ```bash
  cd /Users/matej/Work/Matej/ha-apartment-view-card && npx vitest run test/mock-hass.test.ts
  ```
  Expected: all tests pass (2 suites, ~10 tests green).

- [ ] **Add the dev-server config to `vite.config.ts`** so `npm run dev` serves `dev/index.html` at the root URL while still resolving `/src/...` and `/dev/assets/...` (set `root: 'dev'` and an alias so HTML can import the harness, plus serve the repo for assets via `publicDir`). Edit `/Users/matej/Work/Matej/ha-apartment-view-card/vite.config.ts`. Add a `server`/`root` setup as a top-level sibling. Replace the `defineConfig({ ... })` body so it reads:
  ```ts
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
              'test/helpers/mock-hass.test.ts',
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
    },
  });
  ```
  Notes: `root: dev` makes `dev/index.html` the entry; `publicDir: dev/assets` serves the PNGs at `/day.png`, `/all-lights.png`, etc.; `server.fs.allow` + `test.root` keep `../src` imports and `test/**` globbing working despite the dev root. `build.outDir` is now absolute so it is unaffected by `root`. The two Vitest projects mean later phases' DOM/render tests run as soon as they are written — pure-logic files land in the `node` project, anything rendering into the DOM lands in the `browser` project; add new test files to the matching project's `include` glob when they are created.

- [ ] **Implement `dev/harness.ts`** — the script that builds the mock hass, mounts the (placeholder) card, and wires the control panel (toggle / dim / recolor / time-of-day). The card element is the Phase 2 deliverable; in Phase 1 the harness mounts whatever `<apartment-view-card>` resolves to and always renders a live "scene preview" (base image + per-light radial-masked tint) driven directly from the mock state, so the harness is independently demonstrable now and the same panel drives the real card later. Write `/Users/matej/Work/Matej/ha-apartment-view-card/dev/harness.ts`:
  ```ts
  import {
    createMockHass,
    setSunForTimeOfDay,
    type MockHass,
  } from './mock-hass';
  import { normalizeConfig, type ApartmentViewConfig } from '../src/core/config';
  // Import the card entry so it self-registers (Phase 1: placeholder module).
  import '../src/apartment-view-card';

  // ---- Demo config (v2 schema) -------------------------------------------
  const rawConfig = {
    type: 'custom:apartment-view-card',
    images: {
      base: '/day.png',
      allLights: '/all-lights.png',
      night: '/night.png',
      duskDawn: '/duskdawn.png',
    },
    entities: [
      { entity: 'light.kitchen_ceiling', x: 35, y: 16, size: 'small', tap: 'toggle' },
      { entity: 'light.living_lamp', x: 60, y: 55, size: 'medium', tap: 'toggle' },
      { entity: 'media_player.tv', x: 70, y: 40, size: 'small', tap: 'more-info', orientation: 180 },
      { entity: 'climate.bedroom_ac', x: 20, y: 70, size: 'small', tap: 'more-info' },
    ],
    zones: [
      { name: 'Kitchen', icon: 'mdi:silverware-fork-knife', x: 20, y: 5, width: 35, height: 35 },
      { name: 'Living room', icon: 'mdi:sofa', x: 50, y: 35, width: 45, height: 50 },
    ],
    options: { view: 'auto', lightStyle: 'lit' },
  };
  const config: ApartmentViewConfig = normalizeConfig(rawConfig);

  const hass: MockHass = createMockHass();
  const SIZE_FRACTION: Record<string, number> = {
    tiny: 0.09, small: 0.13, medium: 0.17, large: 0.22, huge: 0.28,
  };

  // ---- DOM refs ----------------------------------------------------------
  const stage = document.getElementById('scene') as HTMLDivElement;
  const baseImg = document.getElementById('base') as HTMLImageElement;
  const lightLayer = document.getElementById('lights') as HTMLDivElement;
  const callLog = document.getElementById('calls') as HTMLPreElement;
  const lightControls = document.getElementById('light-controls') as HTMLDivElement;
  const card = document.getElementById('card') as any; // <apartment-view-card>

  // ---- Helpers -----------------------------------------------------------
  function brightness01(id: string): number {
    const ent = hass.states[id];
    if (!ent || ent.state !== 'on') return 0;
    const b = ent.attributes.brightness;
    return typeof b === 'number' ? Math.max(0, Math.min(1, b / 255)) : 1;
  }
  function rgbCss(id: string): string {
    const c = hass.states[id]?.attributes?.rgb_color;
    return Array.isArray(c) ? `rgb(${c[0]}, ${c[1]}, ${c[2]})` : 'rgb(255,250,230)';
  }

  function renderScenePreview(): void {
    // base time-of-day filter (derived) — mirrors spec defaults
    const sun = hass.states['sun.sun'];
    const setting = new Date(sun.attributes.next_setting).getTime();
    const rising = new Date(sun.attributes.next_rising).getTime();
    const now = Date.now();
    const win = config.options.duskDawnOffsetMinutes * 60_000;
    let filter = 'none';
    if (sun.state === 'below_horizon') filter = 'brightness(0.4) saturate(0.9)';
    else if (Math.abs(rising - now) <= win || Math.abs(setting - now) <= win)
      filter = 'brightness(0.75) saturate(1.1) hue-rotate(20deg) sepia(0.15)';
    baseImg.style.filter = filter;

    // per-light radial-masked tint (a Phase-1 stand-in for light-layer.ts)
    lightLayer.innerHTML = '';
    const w = stage.clientWidth || 600;
    for (const e of config.entities) {
      if (!e.entity.startsWith('light.')) continue;
      const b = brightness01(e.entity);
      const r = SIZE_FRACTION[e.size] * w * (0.45 + 0.55 * b);
      const div = document.createElement('div');
      div.style.cssText = [
        'position:absolute', 'inset:0', 'pointer-events:none',
        `background:${rgbCss(e.entity)}`,
        'mix-blend-mode:soft-light',
        `opacity:${(0.55 + 0.3 * b) * (b > 0 ? 1 : 0)}`,
        'transition:opacity .3s ease, background .3s ease',
        `mask-image:radial-gradient(circle ${r}px at ${e.x}% ${e.y}%, black 0%, rgba(0,0,0,0.55) 40%, transparent 100%)`,
        `-webkit-mask-image:radial-gradient(circle ${r}px at ${e.x}% ${e.y}%, black 0%, rgba(0,0,0,0.55) 40%, transparent 100%)`,
      ].join(';');
      lightLayer.appendChild(div);
    }
  }

  function pushHass(): void {
    // re-trigger the (placeholder) card; reassigning hass mimics HA updates
    if (card) {
      card.hass = { ...hass, states: { ...hass.states } };
    }
    renderScenePreview();
  }

  function logCalls(): void {
    callLog.textContent = hass.serviceCalls
      .slice(-12)
      .map((c) => `${c.domain}.${c.service}(${JSON.stringify(c.data)})`)
      .join('\n');
  }

  // ---- Control panel: per-light toggle / dim / recolor -------------------
  function buildLightControls(): void {
    lightControls.innerHTML = '';
    for (const e of config.entities) {
      if (!e.entity.startsWith('light.')) continue;
      const ent = hass.states[e.entity];
      const row = document.createElement('div');
      row.className = 'lc-row';

      const label = document.createElement('div');
      label.className = 'lc-label';
      label.textContent = ent.attributes.friendly_name ?? e.entity;

      const toggle = document.createElement('button');
      toggle.className = 'b';
      const syncToggle = () => {
        toggle.textContent = hass.states[e.entity].state === 'on' ? 'On' : 'Off';
        toggle.classList.toggle('on', hass.states[e.entity].state === 'on');
      };
      toggle.addEventListener('click', async () => {
        await hass.callService('homeassistant', 'toggle', { entity_id: e.entity });
        syncToggle();
        logCalls();
        pushHass();
      });
      syncToggle();

      const dim = document.createElement('input');
      dim.type = 'range';
      dim.min = '0';
      dim.max = '255';
      dim.value = String(ent.attributes.brightness ?? 255);
      dim.addEventListener('input', () => {
        const cur = hass.states[e.entity];
        hass.states[e.entity] = {
          ...cur,
          state: Number(dim.value) > 0 ? 'on' : 'off',
          attributes: { ...cur.attributes, brightness: Number(dim.value) },
        };
        syncToggle();
        pushHass();
      });

      const color = document.createElement('input');
      color.type = 'color';
      const c = ent.attributes.rgb_color ?? [255, 250, 230];
      color.value =
        '#' +
        [c[0], c[1], c[2]]
          .map((v: number) => v.toString(16).padStart(2, '0'))
          .join('');
      color.addEventListener('input', () => {
        const hex = color.value.slice(1);
        const rgb = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
        const cur = hass.states[e.entity];
        hass.states[e.entity] = {
          ...cur,
          attributes: { ...cur.attributes, rgb_color: rgb, color_mode: 'rgb' },
        };
        pushHass();
      });

      row.append(label, toggle, dim, color);
      lightControls.appendChild(row);
    }
  }

  // ---- Control panel: time-of-day ---------------------------------------
  for (const btn of Array.from(
    document.querySelectorAll<HTMLButtonElement>('[data-tod]'),
  )) {
    btn.addEventListener('click', () => {
      const tod = btn.dataset.tod as 'day' | 'night' | 'duskDawn';
      setSunForTimeOfDay(hass, tod);
      for (const b of document.querySelectorAll('[data-tod]'))
        b.classList.toggle('on', b === btn);
      pushHass();
    });
  }

  // ---- Boot --------------------------------------------------------------
  if (card && typeof card.setConfig === 'function') {
    try {
      card.setConfig(rawConfig);
    } catch (err) {
      // Phase 1 placeholder card has no setConfig; ignore.
      console.warn('card.setConfig not available yet (Phase 1 placeholder):', err);
    }
  }
  setSunForTimeOfDay(hass, 'day');
  document.querySelector('[data-tod="day"]')?.classList.add('on');
  buildLightControls();
  pushHass();
  logCalls();
  ```

- [ ] **Implement `dev/index.html`** — the mounted page with the scene, a placeholder `<apartment-view-card>`, and the control panel layout the harness wires to. Write `/Users/matej/Work/Matej/ha-apartment-view-card/dev/index.html`:
  ```html
  <!DOCTYPE html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>Apartment View Card — dev harness</title>
      <link
        rel="stylesheet"
        href="https://cdn.jsdelivr.net/npm/@mdi/font@7.4.47/css/materialdesignicons.min.css"
      />
      <style>
        :root { color-scheme: dark; }
        * { box-sizing: border-box; }
        body {
          margin: 0; padding: 18px; background: #0b0d10; color: #e6ebf2;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          display: flex; flex-direction: column; gap: 14px; align-items: center;
        }
        .app { width: 100%; max-width: 1000px; display: flex; flex-direction: column; gap: 14px; }
        h1 { font-size: 16px; font-weight: 500; margin: 0; }
        .muted { color: #8b94a0; font-size: 13px; }
        .stage {
          position: relative; width: 100%; aspect-ratio: 1166 / 930;
          background: #07090b; border-radius: 12px; overflow: hidden;
          border: 1px solid rgba(255, 255, 255, 0.08);
        }
        .scene { position: absolute; inset: 0; transform-origin: 0 0; will-change: transform; }
        #base { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover;
          transition: filter 0.3s ease; user-select: none; -webkit-user-drag: none; }
        #lights { position: absolute; inset: 0; pointer-events: none; }
        /* the real card mounts here in Phase 2; harmless empty in Phase 1 */
        apartment-view-card { position: absolute; inset: 0; display: block; pointer-events: none; }
        .panel { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px; }
        .card { background: #12151a; border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 10px; padding: 12px 14px; }
        .card h2 { font-size: 12px; font-weight: 500; margin: 0 0 10px; color: #aab3bf;
          text-transform: uppercase; letter-spacing: 0.04em; }
        .seg { display: flex; gap: 6px; flex-wrap: wrap; }
        button.b { font-size: 13px; padding: 6px 11px; border-radius: 8px;
          border: 1px solid rgba(255, 255, 255, 0.16); background: transparent; color: #e6ebf2; cursor: pointer; }
        button.b:hover { background: rgba(255, 255, 255, 0.06); }
        button.b.on { background: #2f6fed; border-color: transparent; color: #fff; }
        .lc-row { display: grid; grid-template-columns: 1fr auto auto auto; gap: 8px;
          align-items: center; margin-bottom: 10px; }
        .lc-label { font-size: 13px; color: #cdd6e0; }
        .lc-row input[type='range'] { width: 90px; }
        .lc-row input[type='color'] { width: 34px; height: 26px; padding: 0; border: none; background: none; }
        pre#calls { margin: 0; font-size: 12px; color: #9fb4d6; white-space: pre-wrap;
          min-height: 60px; max-height: 180px; overflow: auto; }
      </style>
    </head>
    <body>
      <div class="app">
        <h1>Apartment View Card — dev harness</h1>
        <p class="muted">
          Mock <code>hass</code> (no live HA). Toggle / dim / recolor lights and
          switch time-of-day; service calls are logged below.
        </p>

        <div class="stage">
          <div class="scene" id="scene">
            <img id="base" src="/day.png" alt="floorplan base render" />
            <div id="lights"></div>
          </div>
          <apartment-view-card id="card"></apartment-view-card>
        </div>

        <div class="panel">
          <div class="card">
            <h2>Time of day</h2>
            <div class="seg">
              <button class="b" data-tod="day">Day</button>
              <button class="b" data-tod="duskDawn">Dusk / dawn</button>
              <button class="b" data-tod="night">Night</button>
            </div>
          </div>
          <div class="card">
            <h2>Lights</h2>
            <div id="light-controls"></div>
          </div>
          <div class="card">
            <h2>callService log</h2>
            <pre id="calls"></pre>
          </div>
        </div>
      </div>
      <script type="module" src="/harness.ts"></script>
    </body>
  </html>
  ```

- [ ] **Verify the full test suite, typecheck, and lint stay green:**
  ```bash
  cd /Users/matej/Work/Matej/ha-apartment-view-card && npm run test && npm run typecheck && npm run lint
  ```
  Expected: all three exit 0 (config + mock-hass suites pass; harness/index typecheck clean; lint clean).

- [ ] **Verify the dev harness boots and serves the scene** (start in background, probe, stop). Run:
  ```bash
  cd /Users/matej/Work/Matej/ha-apartment-view-card && \
  ( npx vite --port 5174 >/tmp/avc-vite.log 2>&1 & echo $! >/tmp/avc-vite.pid ) && \
  npx wait-on http://localhost:5174 -t 20000 || sleep 4 ; \
  curl -s http://localhost:5174/ | grep -q 'Apartment View Card — dev harness' && echo "INDEX_OK" ; \
  curl -s -o /dev/null -w '%{http_code}' http://localhost:5174/harness.ts && echo " HARNESS_TS" ; \
  curl -s -o /dev/null -w '%{http_code}' http://localhost:5174/day.png && echo " DAY_PNG" ; \
  kill "$(cat /tmp/avc-vite.pid)" 2>/dev/null
  ```
  Expected: `INDEX_OK`, `200 HARNESS_TS`, `200 DAY_PNG`. (If `wait-on` is absent the `|| sleep 4` covers startup.) This proves `index.html`, the harness module transform, and `dev/assets` static serving all resolve. If the harness `.ts` returns non-200, confirm `server.fs.allow` includes the repo root.

- [ ] **Commit:**
  ```bash
  cd /Users/matej/Work/Matej/ha-apartment-view-card && \
  git add -A && \
  git commit -m "feat(dev): add mock-hass factory + Vite dev harness (index.html, control panel) with tests"
  ```

---

Phase 1 complete: Vite toolchain replaces webpack with a single `dist/apartment-view-card.js` lib output, `hacs.json` fixed, dead deps/artifacts removed; `src/core/config.ts` provides the CONTRACT types plus `normalizeConfig` (legacy migration, unknown-key preservation, missing-`images.base` throw) and `zoneForPoint` (smallest-area, inclusive bounds), both fully unit-tested; and `dev/mock-hass.ts` + `dev/index.html` + the `vite.config.ts` dev-server section give an HMR mock-`hass` harness with a toggle/dim/recolor/time-of-day control panel and a `callService` spy.

Key files (all absolute):
- `/Users/matej/Work/Matej/ha-apartment-view-card/vite.config.ts` (build + dev-server + vitest config; grown across 1.1→1.3)
- `/Users/matej/Work/Matej/ha-apartment-view-card/src/core/config.ts`
- `/Users/matej/Work/Matej/ha-apartment-view-card/test/config.test.ts`, `/Users/matej/Work/Matej/ha-apartment-view-card/test/mock-hass.test.ts`
- `/Users/matej/Work/Matej/ha-apartment-view-card/dev/mock-hass.ts`, `/Users/matej/Work/Matej/ha-apartment-view-card/dev/harness.ts`, `/Users/matej/Work/Matej/ha-apartment-view-card/dev/index.html`

Cross-phase handoffs: Phase 2 implements the real `<apartment-view-card>` LitElement at `/Users/matej/Work/Matej/ha-apartment-view-card/src/apartment-view-card.ts` (currently a placeholder) consuming `normalizeConfig` in its `setConfig`; the harness already mounts `<apartment-view-card id="card">` and calls `card.setConfig(rawConfig)` / `card.hass = ...`, so Phase 2's card drops in with no harness changes. The mock-hass entity shapes (brightness/255, `rgb_color`/`color_temp_kelvin`, `hvac_action`, `sun.sun` rising/setting) are the inputs Phase 2's `intensity`/`resolveLightColor`/`isActive` and the `view:auto` resolver must read.

## Phase 2: Core render: base/time-of-day, light styles, color

This phase is render-only and entirely TDD. It assumes Phase 1 has produced `src/core/config.ts` (the locked TYPES + `normalizeConfig` + `zoneForPoint`) and `src/core/geometry.ts` (`sizeTierFraction`, `haloRadiusPx`), plus the Vite/Vitest/tsconfig tooling. All cross-task identifiers use the locked CONTRACT names verbatim. Pan/zoom, marker overlay, tap/hold, cones and per-domain effects are explicitly deferred to Phases 3–4 — this phase renders the static scene (base + light overlays) only.

A shared minimal HA type alias is introduced once in Task 2.1 (`src/core/ha-types.ts`) and reused by every later task so we don't depend on `custom-card-helpers`' exact shape.

---

### Task 2.1: Light color resolution (`light-color.ts`)
**Files:**
- Create `src/core/ha-types.ts`
- Create `src/core/light-color.ts`
- Test `test/light-color.test.ts`

**Interfaces:**
Consumes: nothing from other tasks (leaf module).
Produces:
- `src/core/ha-types.ts`: `interface HassEntity { entity_id: string; state: string; attributes: Record<string, any>; }`
- `src/core/light-color.ts`:
  - `interface Rgb { r: number; g: number; b: number; }`
  - `function resolveLightColor(state: HassEntity): Rgb`
  - `function kelvinToRgb(kelvin: number): Rgb`
  - `function hsToRgb(h: number, s: number): Rgb`
  - `function xyToRgb(x: number, y: number): Rgb`
  - `function rgbCss(c: Rgb): string`

Steps:

- [ ] **Create the shared HA type.** Write `src/core/ha-types.ts`:
  ```ts
  // Minimal local HA entity shape — avoids coupling to custom-card-helpers internals.
  export interface HassEntity {
    entity_id: string;
    state: string;
    attributes: Record<string, any>;
    last_changed?: string;
    last_updated?: string;
  }
  ```

- [ ] **Write the failing test file** `test/light-color.test.ts` (full code — covers every resolution mode + each converter + clamping):
  ```ts
  import { describe, it, expect } from 'vitest';
  import type { HassEntity } from '../src/core/ha-types';
  import {
    resolveLightColor,
    kelvinToRgb,
    hsToRgb,
    xyToRgb,
    rgbCss,
    type Rgb,
  } from '../src/core/light-color';

  function light(attributes: Record<string, any>, state = 'on'): HassEntity {
    return { entity_id: 'light.test', state, attributes };
  }
  function near(c: Rgb, r: number, g: number, b: number, tol = 4) {
    expect(Math.abs(c.r - r)).toBeLessThanOrEqual(tol);
    expect(Math.abs(c.g - g)).toBeLessThanOrEqual(tol);
    expect(Math.abs(c.b - b)).toBeLessThanOrEqual(tol);
  }

  describe('rgbCss', () => {
    it('formats as rgb(r, g, b)', () => {
      expect(rgbCss({ r: 1, g: 2, b: 3 })).toBe('rgb(1, 2, 3)');
    });
    it('rounds and clamps channels to 0..255', () => {
      expect(rgbCss({ r: -5, g: 127.6, b: 300 })).toBe('rgb(0, 128, 255)');
    });
  });

  describe('kelvinToRgb (Tanner-Helland)', () => {
    it('6600K is essentially white', () => {
      near(kelvinToRgb(6600), 255, 255, 255, 6);
    });
    it('warm 2700K is reddish-orange (r=255, g<r, b<g)', () => {
      const c = kelvinToRgb(2700);
      expect(c.r).toBe(255);
      expect(c.g).toBeLessThan(c.r);
      expect(c.b).toBeLessThan(c.g);
    });
    it('cool 10000K leans blue (b >= r)', () => {
      const c = kelvinToRgb(10000);
      expect(c.b).toBeGreaterThanOrEqual(c.r);
    });
    it('clamps channels into 0..255', () => {
      const c = kelvinToRgb(1000);
      for (const v of [c.r, c.g, c.b]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(255);
      }
    });
  });

  describe('hsToRgb', () => {
    it('red at h=0 s=100', () => near(hsToRgb(0, 100), 255, 0, 0));
    it('green at h=120 s=100', () => near(hsToRgb(120, 100), 0, 255, 0));
    it('blue at h=240 s=100', () => near(hsToRgb(240, 100), 0, 0, 255));
    it('s=0 is white regardless of hue', () => near(hsToRgb(200, 0), 255, 255, 255));
  });

  describe('xyToRgb', () => {
    it('D65 white point (0.3127, 0.3290) is near-white', () => {
      const c = xyToRgb(0.3127, 0.329);
      expect(c.r).toBeGreaterThan(230);
      expect(c.g).toBeGreaterThan(230);
      expect(c.b).toBeGreaterThan(230);
    });
    it('deep red primary skews red', () => {
      const c = xyToRgb(0.675, 0.322);
      expect(c.r).toBeGreaterThan(c.g);
      expect(c.r).toBeGreaterThan(c.b);
    });
  });

  describe('resolveLightColor priority', () => {
    it('rgb_color wins', () => {
      near(resolveLightColor(light({ rgb_color: [10, 20, 30] })), 10, 20, 30, 0);
    });
    it('rgbw_color uses RGB channels (ignores white)', () => {
      near(resolveLightColor(light({ rgbw_color: [10, 20, 30, 200] })), 10, 20, 30, 0);
    });
    it('rgbww_color uses RGB channels (ignores cw/ww)', () => {
      near(resolveLightColor(light({ rgbww_color: [10, 20, 30, 100, 150] })), 10, 20, 30, 0);
    });
    it('rgb_color takes precedence over rgbw_color', () => {
      near(resolveLightColor(light({ rgb_color: [1, 2, 3], rgbw_color: [9, 9, 9, 9] })), 1, 2, 3, 0);
    });
    it('hs_color used when no rgb present', () => {
      near(resolveLightColor(light({ hs_color: [0, 100] })), 255, 0, 0);
    });
    it('xy_color used when no rgb/hs present', () => {
      const c = resolveLightColor(light({ xy_color: [0.675, 0.322] }));
      expect(c.r).toBeGreaterThan(c.g);
      expect(c.r).toBeGreaterThan(c.b);
    });
    it('color_temp_kelvin used when no rgb/hs/xy', () => {
      near(resolveLightColor(light({ color_temp_kelvin: 6600 })), 255, 255, 255, 6);
    });
    it('color_temp (mireds) converted via 1e6/mireds', () => {
      // 370 mireds -> ~2703K -> warm; r=255, b<g
      const c = resolveLightColor(light({ color_temp: 370 }));
      expect(c.r).toBe(255);
      expect(c.b).toBeLessThan(c.g);
    });
    it('falls back to warm-white #fffae6 when no color attrs', () => {
      near(resolveLightColor(light({})), 255, 250, 230, 0);
    });
    it('ignores malformed rgb_color (not length-3 array) and falls through', () => {
      near(resolveLightColor(light({ rgb_color: [1, 2] })), 255, 250, 230, 0);
    });
  });
  ```

- [ ] **Run & expect fail:** `npx vitest run test/light-color.test.ts`. Expected failure: `Error: Failed to resolve import "../src/core/light-color"` (module does not exist yet).

- [ ] **Implement** `src/core/light-color.ts` (full code):
  ```ts
  import type { HassEntity } from './ha-types';

  export interface Rgb {
    r: number;
    g: number;
    b: number;
  }

  function clamp255(v: number): number {
    return Math.max(0, Math.min(255, v));
  }

  export function rgbCss(c: Rgb): string {
    return `rgb(${Math.round(clamp255(c.r))}, ${Math.round(
      clamp255(c.g),
    )}, ${Math.round(clamp255(c.b))})`;
  }

  // Tanner-Helland kelvin -> RGB approximation.
  // Reference: http://www.tannerhelland.com/4435/convert-temperature-rgb-algorithm-code/
  export function kelvinToRgb(kelvin: number): Rgb {
    const temp = kelvin / 100;
    let r: number;
    let g: number;
    let b: number;

    if (temp <= 66) {
      r = 255;
    } else {
      r = 329.698727446 * Math.pow(temp - 60, -0.1332047592);
    }

    if (temp <= 66) {
      g = 99.4708025861 * Math.log(temp) - 161.1195681661;
    } else {
      g = 288.1221695283 * Math.pow(temp - 60, -0.0755148492);
    }

    if (temp >= 66) {
      b = 255;
    } else if (temp <= 19) {
      b = 0;
    } else {
      b = 138.5177312231 * Math.log(temp - 10) - 305.0447927307;
    }

    return { r: clamp255(r), g: clamp255(g), b: clamp255(b) };
  }

  // HA hs_color: hue 0..360, saturation 0..100.
  export function hsToRgb(h: number, s: number): Rgb {
    const sat = s / 100;
    const hue = ((h % 360) + 360) % 360;
    const c = sat; // value (brightness) fixed at 1 — brightness maps to opacity, not color
    const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
    const m = 1 - c;
    let r = 0;
    let g = 0;
    let b = 0;
    if (hue < 60) {
      r = c;
      g = x;
    } else if (hue < 120) {
      r = x;
      g = c;
    } else if (hue < 180) {
      g = c;
      b = x;
    } else if (hue < 240) {
      g = x;
      b = c;
    } else if (hue < 300) {
      r = x;
      b = c;
    } else {
      r = c;
      b = x;
    }
    return {
      r: clamp255((r + m) * 255),
      g: clamp255((g + m) * 255),
      b: clamp255((b + m) * 255),
    };
  }

  // CIE 1931 xy -> sRGB (Y fixed at 1; result normalized so max channel = 255).
  export function xyToRgb(x: number, y: number): Rgb {
    const yLum = 1;
    const safeY = y === 0 ? 1e-6 : y;
    const X = (yLum / safeY) * x;
    const Z = (yLum / safeY) * (1 - x - y);

    // Wide RGB D65 conversion matrix.
    let r = X * 1.656492 - yLum * 0.354851 - Z * 0.255038;
    let g = -X * 0.707196 + yLum * 1.655397 + Z * 0.036152;
    let b = X * 0.051713 - yLum * 0.121364 + Z * 1.01153;

    // Reverse gamma.
    const gamma = (v: number) =>
      v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
    r = gamma(r);
    g = gamma(g);
    b = gamma(b);

    // Normalize so the brightest channel is full (preserve hue, drop luminance).
    const max = Math.max(r, g, b, 1e-6);
    r /= max;
    g /= max;
    b /= max;

    return { r: clamp255(r * 255), g: clamp255(g * 255), b: clamp255(b * 255) };
  }

  function isTriple(v: any): v is number[] {
    return Array.isArray(v) && v.length >= 3 && v.slice(0, 3).every((n) => typeof n === 'number');
  }
  function isPair(v: any): v is number[] {
    return Array.isArray(v) && v.length >= 2 && typeof v[0] === 'number' && typeof v[1] === 'number';
  }

  const WARM_WHITE: Rgb = { r: 255, g: 250, b: 230 }; // #fffae6

  export function resolveLightColor(state: HassEntity): Rgb {
    const a = state?.attributes ?? {};

    if (isTriple(a.rgb_color)) {
      return { r: a.rgb_color[0], g: a.rgb_color[1], b: a.rgb_color[2] };
    }
    if (isTriple(a.rgbw_color)) {
      return { r: a.rgbw_color[0], g: a.rgbw_color[1], b: a.rgbw_color[2] };
    }
    if (isTriple(a.rgbww_color)) {
      return { r: a.rgbww_color[0], g: a.rgbww_color[1], b: a.rgbww_color[2] };
    }
    if (isPair(a.hs_color)) {
      return hsToRgb(a.hs_color[0], a.hs_color[1]);
    }
    if (isPair(a.xy_color)) {
      return xyToRgb(a.xy_color[0], a.xy_color[1]);
    }
    if (typeof a.color_temp_kelvin === 'number') {
      return kelvinToRgb(a.color_temp_kelvin);
    }
    if (typeof a.color_temp === 'number' && a.color_temp > 0) {
      return kelvinToRgb(1e6 / a.color_temp);
    }
    return { ...WARM_WHITE };
  }
  ```

- [ ] **Run & expect pass:** `npx vitest run test/light-color.test.ts` — all cases green. If `hsToRgb`/`xyToRgb` tolerances trip, only adjust the converter math, never the contract signatures.

- [ ] **Commit:** `git add src/core/ha-types.ts src/core/light-color.ts test/light-color.test.ts && git commit -m "feat(color): resolveLightColor + kelvin/hs/xy converters with tests"`

---

### Task 2.2: Entity state (`entity-state.ts`)
**Files:**
- Create `src/core/entity-state.ts`
- Test `test/entity-state.test.ts`

**Interfaces:**
Consumes: `HassEntity` (`src/core/ha-types.ts`), `EntityConfig` (`src/core/config.ts`, from Phase 1).
Produces: `src/core/entity-state.ts`:
- `function isActive(state: HassEntity): boolean`
- `function intensity(state: HassEntity): number`
- `function iconForEntity(state: HassEntity, cfg: EntityConfig): string`

Steps:

- [ ] **Write the failing test** `test/entity-state.test.ts` (full code):
  ```ts
  import { describe, it, expect } from 'vitest';
  import type { HassEntity } from '../src/core/ha-types';
  import type { EntityConfig } from '../src/core/config';
  import { isActive, intensity, iconForEntity } from '../src/core/entity-state';

  function ent(
    entity_id: string,
    state: string,
    attributes: Record<string, any> = {},
  ): HassEntity {
    return { entity_id, state, attributes };
  }
  function cfg(over: Partial<EntityConfig> = {}): EntityConfig {
    return {
      entity: 'light.x',
      x: 50,
      y: 50,
      size: 'medium',
      tap: 'toggle',
      orientation: null,
      ...over,
    };
  }

  describe('isActive', () => {
    it('light on -> true', () => expect(isActive(ent('light.a', 'on'))).toBe(true));
    it('light off -> false', () => expect(isActive(ent('light.a', 'off'))).toBe(false));
    it('media_player playing -> true', () =>
      expect(isActive(ent('media_player.a', 'playing'))).toBe(true));
    it('media_player paused -> true', () =>
      expect(isActive(ent('media_player.a', 'paused'))).toBe(true));
    it('media_player off -> false', () =>
      expect(isActive(ent('media_player.a', 'off'))).toBe(false));
    it('media_player idle -> false', () =>
      expect(isActive(ent('media_player.a', 'idle'))).toBe(false));
    it('media_player unavailable -> false', () =>
      expect(isActive(ent('media_player.a', 'unavailable'))).toBe(false));
    it('climate cooling via hvac_action -> true', () =>
      expect(isActive(ent('climate.a', 'cool', { hvac_action: 'cooling' }))).toBe(true));
    it('climate idle via hvac_action -> false', () =>
      expect(isActive(ent('climate.a', 'cool', { hvac_action: 'idle' }))).toBe(false));
    it('climate state off -> false', () =>
      expect(isActive(ent('climate.a', 'off'))).toBe(false));
    it('climate heat with no hvac_action -> true (state not off/idle)', () =>
      expect(isActive(ent('climate.a', 'heat'))).toBe(true));
    it('other domain: state===on -> true', () =>
      expect(isActive(ent('switch.a', 'on'))).toBe(true));
  });

  describe('intensity', () => {
    it('off -> 0', () => expect(intensity(ent('light.a', 'off', { brightness: 200 }))).toBe(0));
    it('on with brightness 255 -> 1', () =>
      expect(intensity(ent('light.a', 'on', { brightness: 255 }))).toBe(1));
    it('on with brightness 128 -> ~0.5', () =>
      expect(intensity(ent('light.a', 'on', { brightness: 128 }))).toBeCloseTo(0.502, 2));
    it('on with no brightness attr -> 1 (on/off light reads as full)', () =>
      expect(intensity(ent('light.a', 'on'))).toBe(1));
    it('unavailable -> 0', () =>
      expect(intensity(ent('light.a', 'unavailable', { brightness: 255 }))).toBe(0));
    it('clamps above 1', () =>
      expect(intensity(ent('light.a', 'on', { brightness: 999 }))).toBe(1));
  });

  describe('iconForEntity', () => {
    it('config icon wins', () =>
      expect(iconForEntity(ent('light.a', 'on'), cfg({ icon: 'mdi:foo' }))).toBe('mdi:foo'));
    it('light domain default', () =>
      expect(iconForEntity(ent('light.a', 'on'), cfg({ entity: 'light.a' }))).toBe('mdi:lightbulb'));
    it('media_player default', () =>
      expect(iconForEntity(ent('media_player.a', 'playing'), cfg({ entity: 'media_player.a' }))).toBe(
        'mdi:cast',
      ));
    it('media_player tv device_class -> television', () =>
      expect(
        iconForEntity(ent('media_player.a', 'playing', { device_class: 'tv' }), cfg({ entity: 'media_player.a' })),
      ).toBe('mdi:television'));
    it('climate default', () =>
      expect(iconForEntity(ent('climate.a', 'cool'), cfg({ entity: 'climate.a' }))).toBe(
        'mdi:thermostat',
      ));
    it('switch default', () =>
      expect(iconForEntity(ent('switch.a', 'on'), cfg({ entity: 'switch.a' }))).toBe(
        'mdi:toggle-switch',
      ));
    it('unknown domain fallback', () =>
      expect(iconForEntity(ent('sensor.a', 'on'), cfg({ entity: 'sensor.a' }))).toBe(
        'mdi:checkbox-blank-circle',
      ));
  });
  ```

- [ ] **Run & expect fail:** `npx vitest run test/entity-state.test.ts`. Expected: `Error: Failed to resolve import "../src/core/entity-state"`.

- [ ] **Implement** `src/core/entity-state.ts` (full code):
  ```ts
  import type { HassEntity } from './ha-types';
  import type { EntityConfig } from './config';

  function domainOf(state: HassEntity): string {
    return (state.entity_id.split('.')[0] || '').toLowerCase();
  }

  const MEDIA_INACTIVE = new Set(['off', 'idle', 'unavailable', 'standby', 'unknown']);
  const CLIMATE_INACTIVE = new Set(['off', 'idle', 'unavailable', 'unknown']);

  export function isActive(state: HassEntity): boolean {
    if (!state) return false;
    const domain = domainOf(state);
    const s = state.state;

    if (domain === 'light') {
      return s === 'on';
    }
    if (domain === 'media_player') {
      return !MEDIA_INACTIVE.has(s);
    }
    if (domain === 'climate') {
      const action = state.attributes?.hvac_action;
      if (typeof action === 'string') {
        return !CLIMATE_INACTIVE.has(action);
      }
      return !CLIMATE_INACTIVE.has(s);
    }
    // Generic on/off entities (switch, fan, input_boolean, ...).
    return s === 'on';
  }

  export function intensity(state: HassEntity): number {
    if (!state) return 0;
    if (!isActive(state)) return 0;
    const b = state.attributes?.brightness;
    if (typeof b !== 'number') {
      // Active light with no brightness attribute (on/off mode) reads as full.
      return 1;
    }
    return Math.max(0, Math.min(1, b / 255));
  }

  // Domain/device_class defaults. cfg.icon always wins.
  const DOMAIN_DEFAULTS: Record<string, string> = {
    light: 'mdi:lightbulb',
    media_player: 'mdi:cast',
    climate: 'mdi:thermostat',
    switch: 'mdi:toggle-switch',
    fan: 'mdi:fan',
    cover: 'mdi:window-shutter',
    sensor: 'mdi:eye',
    binary_sensor: 'mdi:radiobox-blank',
    lock: 'mdi:lock',
  };

  const MEDIA_DEVICE_CLASS: Record<string, string> = {
    tv: 'mdi:television',
    speaker: 'mdi:speaker',
    receiver: 'mdi:audio-video',
  };

  export function iconForEntity(state: HassEntity, cfg: EntityConfig): string {
    if (cfg?.icon) return cfg.icon;

    const domain = state ? domainOf(state) : (cfg.entity.split('.')[0] || '').toLowerCase();
    const dc = state?.attributes?.device_class;

    if (domain === 'media_player' && typeof dc === 'string' && MEDIA_DEVICE_CLASS[dc]) {
      return MEDIA_DEVICE_CLASS[dc];
    }
    if (DOMAIN_DEFAULTS[domain]) {
      return DOMAIN_DEFAULTS[domain];
    }
    return 'mdi:checkbox-blank-circle';
  }
  ```

- [ ] **Run & expect pass:** `npx vitest run test/entity-state.test.ts` — all green.

- [ ] **Commit:** `git add src/core/entity-state.ts test/entity-state.test.ts && git commit -m "feat(state): isActive/intensity/iconForEntity with tests"`

---

### Task 2.3: Base layer + time-of-day (`base-layer.ts`)
**Files:**
- Create `src/render/base-layer.ts`
- Test `test/base-layer.test.ts`

**Interfaces:**
Consumes: `ImagesConfig`, `CardOptions` (`src/core/config.ts`), `HassEntity` (`src/core/ha-types.ts`).
Produces: `src/render/base-layer.ts`:
- `type TimeOfDay = 'day' | 'night' | 'duskDawn'`
- `function resolveTimeOfDay(options: CardOptions, sun: HassEntity | undefined, now?: Date): TimeOfDay` — honors `options.view` when not `'auto'`; for `'auto'`, uses `sun.sun` `next_rising`/`next_setting` with the `duskDawnOffsetMinutes` window. **Must clone dates before mutating** (v1 bug §10).
- `function baseImageSrc(images: ImagesConfig, tod: TimeOfDay): { src: string; derived: boolean }` — returns the explicit image if present, else `{ src: images.base, derived: true }`.
- `function derivedFilter(tod: TimeOfDay): string` — `''` for day; the §4.1 night/duskDawn filters otherwise.
- `function renderBaseLayer(images: ImagesConfig, options: CardOptions, sun: HassEntity | undefined, now?: Date): TemplateResult` — a Lit `<img class="base-image">` with `src` + (when derived) the TOD filter applied.

Steps:

- [ ] **Write the failing test** `test/base-layer.test.ts` (full code; pure-function tests + one render smoke test). The window logic is deterministic by injecting `now`:
  ```ts
  import { describe, it, expect } from 'vitest';
  import { render } from 'lit';
  import type { ImagesConfig, CardOptions } from '../src/core/config';
  import type { HassEntity } from '../src/core/ha-types';
  import {
    resolveTimeOfDay,
    baseImageSrc,
    derivedFilter,
    renderBaseLayer,
    type TimeOfDay,
  } from '../src/render/base-layer';

  function opts(over: Partial<CardOptions> = {}): CardOptions {
    return {
      view: 'auto',
      lightStyle: 'lit',
      freePanZoom: true,
      zoomMax: 1.5,
      duskDawnOffsetMinutes: 60,
      ...over,
    };
  }
  // Sun whose next sunrise is 07:00 and next sunset is 19:00 (on `day`).
  function sunAt(rising: string, setting: string): HassEntity {
    return {
      entity_id: 'sun.sun',
      state: 'above_horizon',
      attributes: { next_rising: rising, next_setting: setting },
    };
  }
  const day = '2026-06-25';

  describe('resolveTimeOfDay forced views', () => {
    it('view=day ignores sun', () =>
      expect(resolveTimeOfDay(opts({ view: 'day' }), undefined)).toBe('day'));
    it('view=night ignores sun', () =>
      expect(resolveTimeOfDay(opts({ view: 'night' }), undefined)).toBe('night'));
    it('view=duskDawn ignores sun', () =>
      expect(resolveTimeOfDay(opts({ view: 'duskDawn' }), undefined)).toBe('duskDawn'));
  });

  describe('resolveTimeOfDay auto', () => {
    const sun = sunAt(`${day}T07:00:00`, `${day}T19:00:00`);
    it('midday -> day', () =>
      expect(resolveTimeOfDay(opts(), sun, new Date(`${day}T12:00:00`))).toBe('day'));
    it('deep night -> night', () =>
      expect(resolveTimeOfDay(opts(), sun, new Date(`${day}T03:00:00`))).toBe('night'));
    it('just after midnight -> night', () =>
      expect(resolveTimeOfDay(opts(), sun, new Date(`${day}T23:30:00`))).toBe('night'));
    it('within +/-60min of sunrise -> duskDawn', () =>
      expect(resolveTimeOfDay(opts(), sun, new Date(`${day}T06:30:00`))).toBe('duskDawn'));
    it('within +/-60min of sunset -> duskDawn', () =>
      expect(resolveTimeOfDay(opts(), sun, new Date(`${day}T19:30:00`))).toBe('duskDawn'));
    it('custom offset narrows the window (15min): 06:30 is night', () =>
      expect(
        resolveTimeOfDay(opts({ duskDawnOffsetMinutes: 15 }), sun, new Date(`${day}T06:30:00`)),
      ).toBe('night'));
    it('no sun entity -> day', () =>
      expect(resolveTimeOfDay(opts(), undefined, new Date(`${day}T03:00:00`))).toBe('day'));
    it('does NOT mutate the passed sun entity dates', () => {
      const s = sunAt(`${day}T07:00:00`, `${day}T19:00:00`);
      resolveTimeOfDay(opts(), s, new Date(`${day}T12:00:00`));
      expect(s.attributes.next_rising).toBe(`${day}T07:00:00`);
      expect(s.attributes.next_setting).toBe(`${day}T19:00:00`);
    });
  });

  describe('baseImageSrc', () => {
    const imgs: ImagesConfig = {
      base: '/b.png',
      night: '/n.png',
      duskDawn: '/dd.png',
    };
    it('day always uses base, not derived', () =>
      expect(baseImageSrc(imgs, 'day')).toEqual({ src: '/b.png', derived: false }));
    it('night uses explicit night image', () =>
      expect(baseImageSrc(imgs, 'night')).toEqual({ src: '/n.png', derived: false }));
    it('duskDawn uses explicit dusk image', () =>
      expect(baseImageSrc(imgs, 'duskDawn')).toEqual({ src: '/dd.png', derived: false }));
    it('falls back to derived base when night image absent', () =>
      expect(baseImageSrc({ base: '/b.png' }, 'night')).toEqual({
        src: '/b.png',
        derived: true,
      }));
  });

  describe('derivedFilter', () => {
    it('day -> empty', () => expect(derivedFilter('day')).toBe(''));
    it('night filter', () =>
      expect(derivedFilter('night')).toBe('brightness(0.4) saturate(0.9)'));
    it('duskDawn filter', () =>
      expect(derivedFilter('duskDawn')).toBe(
        'brightness(0.75) saturate(1.1) hue-rotate(20deg) sepia(0.15)',
      ));
  });

  describe('renderBaseLayer', () => {
    it('renders an img with the resolved src and applies derived filter when derived', () => {
      const host = document.createElement('div');
      const sun = sunAt(`${day}T07:00:00`, `${day}T19:00:00`);
      // Force night via forced view; base-only images -> derived.
      render(
        renderBaseLayer({ base: '/b.png' }, opts({ view: 'night' }), sun, new Date(`${day}T12:00:00`)),
        host,
      );
      const img = host.querySelector('img.base-image') as HTMLImageElement;
      expect(img).toBeTruthy();
      expect(img.getAttribute('src')).toBe('/b.png');
      expect(img.style.filter).toBe('brightness(0.4) saturate(0.9)');
    });

    it('no filter when explicit night image provided', () => {
      const host = document.createElement('div');
      render(renderBaseLayer({ base: '/b.png', night: '/n.png' }, opts({ view: 'night' }), undefined), host);
      const img = host.querySelector('img.base-image') as HTMLImageElement;
      expect(img.getAttribute('src')).toBe('/n.png');
      expect(img.style.filter).toBe('');
    });
  });
  ```

- [ ] **Run & expect fail:** `npx vitest run test/base-layer.test.ts`. Expected: `Error: Failed to resolve import "../src/render/base-layer"`.

- [ ] **Implement** `src/render/base-layer.ts` (full code). Note the clone-before-mutate fix and the "anchor the next rising/setting to `now`'s date" approach so a single sun reading gives a stable day/night classification:
  ```ts
  import { html, type TemplateResult } from 'lit';
  import { styleMap } from 'lit/directives/style-map.js';
  import type { ImagesConfig, CardOptions } from '../core/config';
  import type { HassEntity } from '../core/ha-types';

  export type TimeOfDay = 'day' | 'night' | 'duskDawn';

  const MIN = 60_000;

  // Returns a NEW Date anchored to `ref`'s calendar day at `src`'s time-of-day.
  // Never mutates `src` (v1 bug: _getDayState mutated parsed sun.sun dates).
  function anchorToDay(src: Date, ref: Date): Date {
    const d = new Date(src.getTime());
    d.setFullYear(ref.getFullYear(), ref.getMonth(), ref.getDate());
    return d;
  }

  export function resolveTimeOfDay(
    options: CardOptions,
    sun: HassEntity | undefined,
    now: Date = new Date(),
  ): TimeOfDay {
    if (options.view !== 'auto') {
      return options.view;
    }
    const rising = sun?.attributes?.next_rising;
    const setting = sun?.attributes?.next_setting;
    if (!rising || !setting) {
      return 'day';
    }

    const sunrise = anchorToDay(new Date(rising), now);
    const sunset = anchorToDay(new Date(setting), now);
    const offset = (options.duskDawnOffsetMinutes ?? 60) * MIN;

    const t = now.getTime();
    if (
      Math.abs(t - sunrise.getTime()) <= offset ||
      Math.abs(t - sunset.getTime()) <= offset
    ) {
      return 'duskDawn';
    }
    if (t < sunrise.getTime() || t > sunset.getTime()) {
      return 'night';
    }
    return 'day';
  }

  export function baseImageSrc(
    images: ImagesConfig,
    tod: TimeOfDay,
  ): { src: string; derived: boolean } {
    if (tod === 'night' && images.night) {
      return { src: images.night, derived: false };
    }
    if (tod === 'duskDawn' && images.duskDawn) {
      return { src: images.duskDawn, derived: false };
    }
    // day always uses base; night/duskDawn fall through to derived base.
    return { src: images.base, derived: tod !== 'day' };
  }

  export function derivedFilter(tod: TimeOfDay): string {
    if (tod === 'night') return 'brightness(0.4) saturate(0.9)';
    if (tod === 'duskDawn') {
      return 'brightness(0.75) saturate(1.1) hue-rotate(20deg) sepia(0.15)';
    }
    return '';
  }

  export function renderBaseLayer(
    images: ImagesConfig,
    options: CardOptions,
    sun: HassEntity | undefined,
    now?: Date,
  ): TemplateResult {
    const tod = resolveTimeOfDay(options, sun, now);
    const { src, derived } = baseImageSrc(images, tod);
    const filter = derived ? derivedFilter(tod) : '';
    return html`<img
      class="base-image"
      src=${src}
      alt="Apartment base render"
      style=${styleMap({ filter })}
    />`;
  }
  ```

- [ ] **Run & expect pass:** `npx vitest run test/base-layer.test.ts` — all green.

- [ ] **Commit:** `git add src/render/base-layer.ts test/base-layer.test.ts && git commit -m "feat(render): base layer + real-or-derived time-of-day"`

---

### Task 2.4: Light layer — masks, halo, three styles, fade (`light-layer.ts`)
**Files:**
- Create `src/render/light-layer.ts`
- Test `test/light-layer.test.ts`

**Interfaces:**
Consumes: `EntityConfig`, `CardOptions`, `LightStyle`, `ImagesConfig` (`src/core/config.ts`); `HassEntity` (`src/core/ha-types.ts`); `resolveLightColor`, `rgbCss` (`src/core/light-color.ts`); `isActive`, `intensity` (`src/core/entity-state.ts`); `sizeTierFraction`, `haloRadiusPx` (`src/core/geometry.ts`, Phase 1).
Produces: `src/render/light-layer.ts`:
- `function radialMask(xPct: number, yPct: number, radiusPx: number): string` — verbatim CONTRACT mask string.
- `function effectiveLightStyle(cfg: EntityConfig, options: CardOptions): LightStyle` — per-entity override else global.
- `function renderLight(state: HassEntity | undefined, cfg: EntityConfig, options: CardOptions, images: ImagesConfig, cardWidth: number): TemplateResult` — one light overlay div implementing `lit`/`glow`/`reveal` with the §4 tuning and a card-owned 0.3s fade.
- `function renderLightLayer(hass: { states: Record<string, HassEntity> } | undefined, entities: EntityConfig[], options: CardOptions, images: ImagesConfig, cardWidth: number): TemplateResult` — the full `.light-layer` container mapping all entities.

The cone (`coneMask`, intersect) is intentionally out of scope here — Phase 4 adds it. This task renders the **omnidirectional** radial mask only. `haloRadiusPx` already folds in `sizeTierFraction`, so this task imports `haloRadiusPx` from geometry and does not recompute the fraction.

Steps:

- [ ] **Write the failing test** `test/light-layer.test.ts` (full code). Verifies mask string verbatim, style selection, the three opacity/blend formulas, off→zero-opacity (fade target), and the 0.3s transition:
  ```ts
  import { describe, it, expect } from 'vitest';
  import { render } from 'lit';
  import type {
    EntityConfig,
    CardOptions,
    ImagesConfig,
  } from '../src/core/config';
  import type { HassEntity } from '../src/core/ha-types';
  import {
    radialMask,
    effectiveLightStyle,
    renderLight,
    renderLightLayer,
  } from '../src/render/light-layer';

  function opts(over: Partial<CardOptions> = {}): CardOptions {
    return {
      view: 'auto',
      lightStyle: 'lit',
      freePanZoom: true,
      zoomMax: 1.5,
      duskDawnOffsetMinutes: 60,
      ...over,
    };
  }
  function cfg(over: Partial<EntityConfig> = {}): EntityConfig {
    return {
      entity: 'light.k',
      x: 35,
      y: 16,
      size: 'small',
      tap: 'toggle',
      orientation: null,
      ...over,
    };
  }
  const images: ImagesConfig = { base: '/b.png', allLights: '/all.png' };

  function lightOn(brightness = 255, attrs: Record<string, any> = {}): HassEntity {
    return { entity_id: 'light.k', state: 'on', attributes: { brightness, ...attrs } };
  }
  function lightOff(): HassEntity {
    return { entity_id: 'light.k', state: 'off', attributes: {} };
  }
  function firstDiv(t: ReturnType<typeof renderLight>): HTMLElement {
    const host = document.createElement('div');
    render(t, host);
    return host.firstElementChild as HTMLElement;
  }

  describe('radialMask', () => {
    it('emits the exact CONTRACT gradient', () => {
      expect(radialMask(35, 16, 120)).toBe(
        'radial-gradient(circle 120px at 35% 16%, black 0%, rgba(0,0,0,0.55) 40%, transparent 100%)',
      );
    });
  });

  describe('effectiveLightStyle', () => {
    it('falls back to global', () =>
      expect(effectiveLightStyle(cfg(), opts({ lightStyle: 'glow' }))).toBe('glow'));
    it('per-entity override wins', () =>
      expect(effectiveLightStyle(cfg({ lightStyle: 'reveal' }), opts({ lightStyle: 'glow' }))).toBe(
        'reveal',
      ));
  });

  describe('renderLight — fade & off-state', () => {
    it('always sets a 0.3s opacity/filter transition', () => {
      const el = firstDiv(renderLight(lightOn(), cfg(), opts(), images, 1000));
      expect(el.style.transition).toContain('0.3s');
    });
    it('off light renders at opacity 0 (fade target), not removed', () => {
      const el = firstDiv(renderLight(lightOff(), cfg(), opts(), images, 1000));
      expect(el).toBeTruthy();
      expect(parseFloat(el.style.opacity || '0')).toBe(0);
    });
    it('missing state renders at opacity 0', () => {
      const el = firstDiv(renderLight(undefined, cfg(), opts(), images, 1000));
      expect(parseFloat(el.style.opacity || '0')).toBe(0);
    });
  });

  describe('renderLight — lit style', () => {
    it('inner image has brightness/saturate/contrast filter + opacity 0.4+0.4b', () => {
      const el = firstDiv(renderLight(lightOn(255), cfg(), opts({ lightStyle: 'lit' }), images, 1000));
      const img = el.querySelector('img') as HTMLImageElement;
      expect(img.style.filter).toBe('brightness(1.08) saturate(1.12) contrast(0.97)');
      expect(parseFloat(img.style.opacity)).toBeCloseTo(0.8, 3); // 0.4 + 0.4*1
      const tint = el.querySelector('.tint') as HTMLElement;
      expect(tint.style.mixBlendMode).toBe('soft-light');
      expect(parseFloat(tint.style.opacity)).toBeCloseTo(0.85, 3); // 0.55 + 0.3*1
    });
    it('lit at brightness 0.5: img opacity 0.6, tint opacity 0.7', () => {
      const el = firstDiv(renderLight(lightOn(128), cfg(), opts({ lightStyle: 'lit' }), images, 1000));
      const img = el.querySelector('img') as HTMLImageElement;
      const tint = el.querySelector('.tint') as HTMLElement;
      expect(parseFloat(img.style.opacity)).toBeCloseTo(0.6, 1);
      expect(parseFloat(tint.style.opacity)).toBeCloseTo(0.7, 1);
    });
    it('lit inner image src is the base render', () => {
      const el = firstDiv(renderLight(lightOn(), cfg(), opts({ lightStyle: 'lit' }), images, 1000));
      expect((el.querySelector('img') as HTMLImageElement).getAttribute('src')).toBe('/b.png');
    });
  });

  describe('renderLight — glow style', () => {
    it('flat color tint, screen blend, opacity 0.4+0.55b, no image', () => {
      const el = firstDiv(
        renderLight(lightOn(255, { rgb_color: [10, 20, 30] }), cfg(), opts({ lightStyle: 'glow' }), images, 1000),
      );
      expect(el.querySelector('img')).toBeNull();
      const tint = el.querySelector('.tint') as HTMLElement;
      expect(tint.style.mixBlendMode).toBe('screen');
      expect(parseFloat(tint.style.opacity)).toBeCloseTo(0.95, 3); // 0.4 + 0.55*1
      expect(tint.style.backgroundColor.replace(/\s/g, '')).toBe('rgb(10,20,30)');
    });
  });

  describe('renderLight — reveal style', () => {
    it('all-lights image opacity = brightness, tint multiply', () => {
      const el = firstDiv(
        renderLight(lightOn(128), cfg(), opts({ lightStyle: 'reveal' }), images, 1000),
      );
      const img = el.querySelector('img') as HTMLImageElement;
      expect(img.getAttribute('src')).toBe('/all.png');
      expect(parseFloat(img.style.opacity)).toBeCloseTo(0.502, 2);
      const tint = el.querySelector('.tint') as HTMLElement;
      expect(tint.style.mixBlendMode).toBe('multiply');
    });
  });

  describe('renderLight — mask & geometry', () => {
    it('applies a radial mask sized by haloRadiusPx at the light position', () => {
      const el = firstDiv(renderLight(lightOn(255), cfg({ x: 35, y: 16, size: 'small' }), opts(), images, 1000));
      // haloRadiusPx(1000,'small',1) = 0.13*1000*(0.45+0.55) = 130
      const expected = radialMask(35, 16, 130);
      const mask = el.style.getPropertyValue('-webkit-mask-image') || el.style.maskImage;
      expect(mask).toBe(expected);
    });
  });

  describe('renderLightLayer', () => {
    it('renders one overlay per entity inside a .light-layer container', () => {
      const hass = { states: { 'light.k': lightOn(), 'light.j': { entity_id: 'light.j', state: 'on', attributes: { brightness: 200 } } } };
      const host = document.createElement('div');
      render(
        renderLightLayer(hass, [cfg({ entity: 'light.k' }), cfg({ entity: 'light.j' })], opts(), images, 1000),
        host,
      );
      const layer = host.querySelector('.light-layer') as HTMLElement;
      expect(layer).toBeTruthy();
      expect(layer.querySelectorAll('.light-overlay').length).toBe(2);
    });
  });
  ```

- [ ] **Run & expect fail:** `npx vitest run test/light-layer.test.ts`. Expected: `Error: Failed to resolve import "../src/render/light-layer"`.

- [ ] **Implement** `src/render/light-layer.ts` (full code). The radial mask is set on both `mask-image` and `-webkit-mask-image`. The fade is the card-owned `0.3s` transition on `opacity, filter`. `reveal` falls back to `images.base` only if `allLights` is missing (defensive — config still selected `reveal`):
  ```ts
  import { html, type TemplateResult } from 'lit';
  import { styleMap } from 'lit/directives/style-map.js';
  import type {
    EntityConfig,
    CardOptions,
    LightStyle,
    ImagesConfig,
  } from '../core/config';
  import type { HassEntity } from '../core/ha-types';
  import { resolveLightColor, rgbCss } from '../core/light-color';
  import { isActive, intensity } from '../core/entity-state';
  import { haloRadiusPx } from '../core/geometry';

  const FADE = 'opacity 0.3s ease, filter 0.3s ease';

  export function radialMask(xPct: number, yPct: number, radiusPx: number): string {
    return `radial-gradient(circle ${radiusPx}px at ${xPct}% ${yPct}%, black 0%, rgba(0,0,0,0.55) 40%, transparent 100%)`;
  }

  export function effectiveLightStyle(
    cfg: EntityConfig,
    options: CardOptions,
  ): LightStyle {
    return cfg.lightStyle ?? options.lightStyle;
  }

  function clamp01(v: number): number {
    return Math.max(0, Math.min(1, v));
  }

  export function renderLight(
    state: HassEntity | undefined,
    cfg: EntityConfig,
    options: CardOptions,
    images: ImagesConfig,
    cardWidth: number,
  ): TemplateResult {
    const on = !!state && isActive(state);
    const b = state ? intensity(state) : 0;
    const style = effectiveLightStyle(cfg, options);
    const color = state ? rgbCss(resolveLightColor(state)) : 'rgb(255, 250, 230)';

    // Halo grows with brightness; when off keep the last tier radius (b=0 -> base*0.45)
    // but the whole overlay fades to 0 opacity anyway.
    const radius = haloRadiusPx(cardWidth, cfg.size, b);
    const mask = radialMask(cfg.x, cfg.y, radius);

    const overlayStyle = {
      position: 'absolute',
      inset: '0',
      opacity: on ? '1' : '0',
      transition: FADE,
      'pointer-events': 'none',
      'mask-image': mask,
      '-webkit-mask-image': mask,
    };

    let inner: TemplateResult;
    if (style === 'lit') {
      const imgOpacity = clamp01(0.4 + 0.4 * b);
      const tintOpacity = clamp01(0.55 + 0.3 * b);
      inner = html`
        <img
          src=${images.base}
          alt=""
          style=${styleMap({
            position: 'absolute',
            inset: '0',
            width: '100%',
            height: '100%',
            'object-fit': 'contain',
            filter: 'brightness(1.08) saturate(1.12) contrast(0.97)',
            opacity: String(imgOpacity),
            transition: FADE,
          })}
        />
        <div
          class="tint"
          style=${styleMap({
            position: 'absolute',
            inset: '0',
            'background-color': color,
            'mix-blend-mode': 'soft-light',
            opacity: String(tintOpacity),
            transition: FADE,
          })}
        ></div>
      `;
    } else if (style === 'glow') {
      const tintOpacity = clamp01(0.4 + 0.55 * b);
      inner = html`
        <div
          class="tint"
          style=${styleMap({
            position: 'absolute',
            inset: '0',
            'background-color': color,
            'mix-blend-mode': 'screen',
            opacity: String(tintOpacity),
            transition: FADE,
          })}
        ></div>
      `;
    } else {
      // reveal: baked all-lights render, opacity = brightness, tint multiply (default).
      // §11 A/B (multiply vs screen) is DEFERRED for v2.0 — shipping multiply as
      // allowed; the dev harness has no reveal-blend toggle to compare yet.
      const revealSrc = images.allLights ?? images.base;
      inner = html`
        <img
          src=${revealSrc}
          alt=""
          style=${styleMap({
            position: 'absolute',
            inset: '0',
            width: '100%',
            height: '100%',
            'object-fit': 'contain',
            opacity: String(clamp01(b)),
            transition: FADE,
          })}
        />
        <div
          class="tint"
          style=${styleMap({
            position: 'absolute',
            inset: '0',
            'background-color': color,
            'mix-blend-mode': 'multiply',
            opacity: String(clamp01(b)),
            transition: FADE,
          })}
        ></div>
      `;
    }

    return html`<div
      class="light-overlay"
      data-light=${cfg.entity}
      style=${styleMap(overlayStyle)}
    >
      ${inner}
    </div>`;
  }

  export function renderLightLayer(
    hass: { states: Record<string, HassEntity> } | undefined,
    entities: EntityConfig[],
    options: CardOptions,
    images: ImagesConfig,
    cardWidth: number,
  ): TemplateResult {
    return html`<div
      class="light-layer"
      style=${styleMap({
        position: 'absolute',
        inset: '0',
        'pointer-events': 'none',
      })}
    >
      ${entities.map((cfg) =>
        renderLight(hass?.states?.[cfg.entity], cfg, options, images, cardWidth),
      )}
    </div>`;
  }
  ```

- [ ] **Run & expect pass:** `npx vitest run test/light-layer.test.ts` — all green. If the `mask-image`/`-webkit-mask-image` readback in the browser provider returns only one of the two, adjust the test to read `el.style.maskImage || el.style.getPropertyValue('-webkit-mask-image')` — do not change the implementation (both must be emitted).

- [ ] **Commit:** `git add src/render/light-layer.ts test/light-layer.test.ts && git commit -m "feat(render): light layer — radialMask, halo, lit/glow/reveal, 0.3s fade"`

---

### Task 2.5: Card skeleton — `apartment-view-card.ts` (base + light overlays)
**Files:**
- Create `src/apartment-view-card.ts`
- Delete `src/ApartmentViewCard.ts`, `src/ApartmentViewCard.d.ts`, `src/ApartmentViewCardEditor.d.ts` (v1 card files superseded; the editor is rewritten in Phase 6 — leave `src/ApartmentViewCardEditor.ts` in place but it is no longer imported by the card)
- Test `test/apartment-view-card.test.ts`

**Interfaces:**
Consumes: `ApartmentViewConfig`, `normalizeConfig` (`src/core/config.ts`); `HassEntity` (`src/core/ha-types.ts`); `renderBaseLayer` (`src/render/base-layer.ts`); `renderLightLayer` (`src/render/light-layer.ts`).
Produces: the registered custom element `apartment-view-card` (a `LitElement`):
- `@property({ attribute: false }) hass`
- `@property({ attribute: false }) config: ApartmentViewConfig`
- `setConfig(raw: any): void` (delegates to `normalizeConfig`)
- `render(): TemplateResult` — `.scene` containing base layer + light layer; warning card if no config.
- `getCardSize(): number`

Steps:

- [ ] **Write the failing test** `test/apartment-view-card.test.ts` (full code). Mounts the real element, asserts setConfig normalization is applied, the base image renders, one light overlay per entity renders, and an `on` light overlay is opaque while an `off` one is faded:
  ```ts
  import { describe, it, expect, beforeAll } from 'vitest';
  import type { HassEntity } from '../src/core/ha-types';
  import '../src/apartment-view-card';

  type Card = HTMLElement & {
    hass: any;
    config: any;
    setConfig: (raw: any) => void;
  };

  function mkHass(states: Record<string, HassEntity>) {
    return { states };
  }

  async function mount(raw: any, hass: any): Promise<Card> {
    const el = document.createElement('apartment-view-card') as Card;
    el.setConfig(raw);
    el.hass = hass;
    document.body.appendChild(el);
    await (el as any).updateComplete;
    return el;
  }

  beforeAll(() => {
    // jsdom/browser: ensure custom element defined
    expect(customElements.get('apartment-view-card')).toBeTruthy();
  });

  describe('setConfig', () => {
    it('throws when images.base is missing', () => {
      const el = document.createElement('apartment-view-card') as Card;
      expect(() => el.setConfig({ type: 'custom:apartment-view-card', images: {} })).toThrow();
    });
    it('normalizes legacy keys via normalizeConfig (objects/offsetX/entityName)', () => {
      const el = document.createElement('apartment-view-card') as Card;
      el.setConfig({
        type: 'custom:apartment-view-card',
        images: { base: '/b.png' },
        objects: [{ entityName: 'light.k', offsetX: 30, offsetY: 20, size: 'small' }],
      });
      expect(el.config.entities[0].entity).toBe('light.k');
      expect(el.config.entities[0].x).toBe(30);
      expect(el.config.entities[0].y).toBe(20);
    });
  });

  describe('render', () => {
    it('renders the base image inside .scene', async () => {
      const el = await mount(
        { type: 'custom:apartment-view-card', images: { base: '/b.png' }, entities: [] },
        mkHass({}),
      );
      const scene = el.shadowRoot!.querySelector('.scene');
      expect(scene).toBeTruthy();
      const base = el.shadowRoot!.querySelector('img.base-image') as HTMLImageElement;
      expect(base.getAttribute('src')).toBe('/b.png');
    });

    it('renders one light overlay per entity', async () => {
      const el = await mount(
        {
          type: 'custom:apartment-view-card',
          images: { base: '/b.png' },
          entities: [
            { entity: 'light.a', x: 10, y: 10, size: 'small' },
            { entity: 'light.b', x: 20, y: 20, size: 'small' },
          ],
        },
        mkHass({
          'light.a': { entity_id: 'light.a', state: 'on', attributes: { brightness: 255 } },
          'light.b': { entity_id: 'light.b', state: 'off', attributes: {} },
        }),
      );
      const overlays = el.shadowRoot!.querySelectorAll('.light-overlay');
      expect(overlays.length).toBe(2);
    });

    it('on light overlay opaque, off light overlay faded', async () => {
      const el = await mount(
        {
          type: 'custom:apartment-view-card',
          images: { base: '/b.png' },
          entities: [
            { entity: 'light.a', x: 10, y: 10, size: 'small' },
            { entity: 'light.b', x: 20, y: 20, size: 'small' },
          ],
        },
        mkHass({
          'light.a': { entity_id: 'light.a', state: 'on', attributes: { brightness: 255 } },
          'light.b': { entity_id: 'light.b', state: 'off', attributes: {} },
        }),
      );
      const overlays = Array.from(
        el.shadowRoot!.querySelectorAll('.light-overlay'),
      ) as HTMLElement[];
      expect(parseFloat(overlays[0].style.opacity)).toBe(1);
      expect(parseFloat(overlays[1].style.opacity)).toBe(0);
    });

    it('shows a warning card when config absent', async () => {
      const el = document.createElement('apartment-view-card') as Card;
      document.body.appendChild(el);
      await (el as any).updateComplete;
      expect(el.shadowRoot!.textContent).toContain('configure');
    });
  });
  ```

- [ ] **Run & expect fail:** `npx vitest run test/apartment-view-card.test.ts`. Expected: `Error: Failed to resolve import "../src/apartment-view-card"`.

- [ ] **Implement** `src/apartment-view-card.ts` (full code). It measures card width once on first render via `getBoundingClientRect` (falls back to 600 before layout), tracks it in a `@state`, and passes it to `renderLightLayer`. Pan/zoom/markers come in Phase 3 — for now the scene is untransformed:
  ```ts
  import { LitElement, html, css, type TemplateResult } from 'lit';
  import { customElement, property, state } from 'lit/decorators.js';
  import type { HassEntity } from './core/ha-types';
  import { normalizeConfig, type ApartmentViewConfig } from './core/config';
  import { renderBaseLayer } from './render/base-layer';
  import { renderLightLayer } from './render/light-layer';

  interface MinimalHass {
    states: Record<string, HassEntity>;
    // Needed by Phase 3 dispatchTapAction (tap:toggle -> homeassistant.toggle).
    callService(domain: string, service: string, data?: any): Promise<void>;
  }

  @customElement('apartment-view-card')
  export class ApartmentViewCard extends LitElement {
    @property({ attribute: false }) public hass?: MinimalHass;
    @property({ attribute: false }) public config!: ApartmentViewConfig;
    @state() private _cardWidth = 600;

    private _ro?: ResizeObserver;

    static styles = css`
      :host {
        display: block;
      }
      .wrapper {
        position: relative;
        width: 100%;
        overflow: hidden;
        touch-action: none;
      }
      .scene {
        position: relative;
        width: 100%;
        transform-origin: 0 0;
        will-change: transform;
      }
      .base-image {
        display: block;
        width: 100%;
        height: auto;
      }
      .warning {
        padding: 16px;
        color: var(--error-color, #db4437);
        text-align: center;
      }
    `;

    public setConfig(raw: any): void {
      this.config = normalizeConfig(raw);
    }

    public getCardSize(): number {
      return 8;
    }

    public connectedCallback(): void {
      super.connectedCallback();
      this._ro = new ResizeObserver((entries) => {
        const w = entries[0]?.contentRect?.width;
        if (w && Math.abs(w - this._cardWidth) > 0.5) {
          this._cardWidth = w;
        }
      });
    }

    public disconnectedCallback(): void {
      super.disconnectedCallback();
      this._ro?.disconnect();
      this._ro = undefined;
    }

    protected firstUpdated(): void {
      const wrapper = this.renderRoot.querySelector('.wrapper');
      if (wrapper) {
        const w = wrapper.getBoundingClientRect().width;
        if (w) this._cardWidth = w;
        this._ro?.observe(wrapper);
      }
    }

    /**
     * Base + light fragment, extracted so Phase 3 (gestures) and Phase 4
     * (effect layer) can call it inside the transformed scene. `cardWidth`
     * passed to renderLightLayer is always `this._cardWidth` (the scene
     * image-box width threaded everywhere — see Phase 5 `_viewport()`).
     */
    private _renderScene(): TemplateResult {
      const { images, options, entities } = this.config;
      const sun = this.hass?.states?.['sun.sun'];
      return html`${renderBaseLayer(images, options, sun)}
        ${renderLightLayer(this.hass, entities, options, images, this._cardWidth)}`;
    }

    protected render(): TemplateResult {
      if (!this.config) {
        return html`<ha-card
          ><div class="warning">Please configure the card.</div></ha-card
        >`;
      }
      return html`
        <ha-card>
          <div class="wrapper">
            <div class="scene">${this._renderScene()}</div>
          </div>
        </ha-card>
      `;
    }
  }

  // --- Registration ---------------------------------------------------------
  if (!(window as any).customCards) {
    (window as any).customCards = [];
  }
  if (
    !(window as any).customCards.find(
      (c: any) => c.type === 'apartment-view-card',
    )
  ) {
    (window as any).customCards.push({
      type: 'apartment-view-card',
      name: 'Apartment View Card',
      description:
        'Interactive, state-aware device markers and lighting over a floorplan render.',
      preview: true,
      documentationURL:
        'https://github.com/grozdanowski/ha-apartment-view-card',
    });
  }
  ```

- [ ] **Run & expect pass:** `npx vitest run test/apartment-view-card.test.ts` — all green. (If the test environment lacks `ResizeObserver`, add a guard `if (typeof ResizeObserver !== 'undefined')` around the `new ResizeObserver` — Playwright browser provider has it, so this is only relevant if a jsdom unit run is added later.)

- [ ] **Remove superseded v1 card files and repoint the build entry:**
  ```bash
  git rm src/ApartmentViewCard.ts src/ApartmentViewCard.d.ts src/ApartmentViewCardEditor.d.ts
  ```
  Then in `vite.config.ts` (created in Phase 1) confirm the lib `entry` points at `src/apartment-view-card.ts` (not the deleted v1 file); if Phase 1 set it to the old path, update it. Build to prove the entry resolves and the bundle emits to the single canonical output:
  ```bash
  npx vite build && ls -1 dist/apartment-view-card.js
  ```
  Expected: build succeeds and `dist/apartment-view-card.js` exists.

- [ ] **Full Phase 2 green check** — run every test added this phase together: `npx vitest run test/light-color.test.ts test/entity-state.test.ts test/base-layer.test.ts test/light-layer.test.ts test/apartment-view-card.test.ts`. Expected: all suites pass.

- [ ] **Commit:** `git add -A && git commit -m "feat(card): apartment-view-card skeleton — base + light overlays; drop v1 card files"`

---

**Phase 2 done when:** all five test files are green, `npx vite build` emits `dist/apartment-view-card.js`, and the card renders a base render with one omnidirectional light overlay per entity that fades over 0.3s on state change. Cones, pan/zoom, the marker overlay, per-domain effects, zones, and the editor are explicitly **not** in this phase.

Relevant files this phase creates/edits (all absolute):
- `/Users/matej/Work/Matej/ha-apartment-view-card/src/core/ha-types.ts`
- `/Users/matej/Work/Matej/ha-apartment-view-card/src/core/light-color.ts`
- `/Users/matej/Work/Matej/ha-apartment-view-card/src/core/entity-state.ts`
- `/Users/matej/Work/Matej/ha-apartment-view-card/src/render/base-layer.ts`
- `/Users/matej/Work/Matej/ha-apartment-view-card/src/render/light-layer.ts`
- `/Users/matej/Work/Matej/ha-apartment-view-card/src/apartment-view-card.ts`
- tests under `/Users/matej/Work/Matej/ha-apartment-view-card/test/`

Cross-phase dependency note for the plan author: Phase 2 consumes from Phase 1 `src/core/config.ts` (`ApartmentViewConfig`, `EntityConfig`, `CardOptions`, `ImagesConfig`, `LightStyle`, `SizeTier`, `normalizeConfig`) and `src/core/geometry.ts` (`sizeTierFraction`, `haloRadiusPx`). It introduces the shared `src/core/ha-types.ts` (`HassEntity`) — if Phase 1 already created it, fold Task 2.1's first step into a no-op/verification step instead of re-creating.

## Phase 3: Interaction: two-layer overlay, pan/zoom/pinch, tap/hold

### Task 3.1: Geometry primitives — `Viewport`, `ZoomTransform`, `markerScreenPos`, `clampIconScale`
**Files:**
- Create `src/core/geometry.ts`
- Test `test/geometry.test.ts`

**Interfaces:**
- Consumes: nothing (foundational).
- Produces:
  - `interface Viewport { width: number; height: number; }`
  - `interface ZoomTransform { scale: number; panX: number; panY: number; }`
  - `function markerScreenPos(xPct: number, yPct: number, t: ZoomTransform, vp: Viewport): { left: number; top: number }`
  - `function clampIconScale(scale: number): number` (intra-phase helper for `min(scale, 2.0)`; not in the locked contract but used by Task 3.2)

> Note: Phase 5 appends `zoomToZone`, `sizeTierFraction`, `haloRadiusPx` to this same file. Do not stub them here — only create the three locked names plus `clampIconScale`.

- [ ] **Write failing test** — create `test/geometry.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import {
  markerScreenPos,
  clampIconScale,
  type Viewport,
  type ZoomTransform,
} from '../src/core/geometry';

const vp: Viewport = { width: 800, height: 600 };

describe('markerScreenPos', () => {
  it('maps percent to screen px at identity transform', () => {
    const t: ZoomTransform = { scale: 1, panX: 0, panY: 0 };
    // 50% of 800 = 400, 25% of 600 = 150
    expect(markerScreenPos(50, 25, t, vp)).toEqual({ left: 400, top: 150 });
  });

  it('applies scale then pan: left = xPct/100*W*scale + panX', () => {
    const t: ZoomTransform = { scale: 1.5, panX: 30, panY: -20 };
    // left = 50/100*800*1.5 + 30 = 600 + 30 = 630
    // top  = 50/100*600*1.5 - 20 = 450 - 20 = 430
    expect(markerScreenPos(50, 50, t, vp)).toEqual({ left: 630, top: 430 });
  });

  it('handles 0% and 100% corners', () => {
    const t: ZoomTransform = { scale: 2, panX: 10, panY: 5 };
    expect(markerScreenPos(0, 0, t, vp)).toEqual({ left: 10, top: 5 });
    // 100/100*800*2 + 10 = 1610 ; 100/100*600*2 + 5 = 1205
    expect(markerScreenPos(100, 100, t, vp)).toEqual({ left: 1610, top: 1205 });
  });
});

describe('clampIconScale', () => {
  it('passes small scales through unchanged', () => {
    expect(clampIconScale(1)).toBe(1);
    expect(clampIconScale(1.5)).toBe(1.5);
  });

  it('caps icon scale at 2.0', () => {
    expect(clampIconScale(2.0)).toBe(2.0);
    expect(clampIconScale(3.7)).toBe(2.0);
  });
});
```

- [ ] **Run & expect fail:** `npx vitest run test/geometry.test.ts -t "markerScreenPos"`
  Expected failure: `Failed to resolve import "../src/core/geometry"` (module does not exist yet).

- [ ] **Minimal implementation** — create `src/core/geometry.ts`:
```ts
export interface Viewport {
  width: number;
  height: number;
}

export interface ZoomTransform {
  scale: number;
  panX: number;
  panY: number;
}

/**
 * Screen-pixel position of a marker on the NON-transformed overlay.
 * The image layer is transformed via `translate(panX,panY) scale(scale)`
 * with transform-origin 0 0; this reproduces that math in px so overlay
 * icons track the image while rendering at native resolution.
 */
export function markerScreenPos(
  xPct: number,
  yPct: number,
  t: ZoomTransform,
  vp: Viewport
): { left: number; top: number } {
  return {
    left: (xPct / 100) * vp.width * t.scale + t.panX,
    top: (yPct / 100) * vp.height * t.scale + t.panY,
  };
}

/** Icons grow with zoom but never beyond 2x baseline (spec §5/§6). */
export function clampIconScale(scale: number): number {
  return Math.min(scale, 2.0);
}
```

- [ ] **Run & expect pass:** `npx vitest run test/geometry.test.ts`
  Expected: 5 tests passed.

- [ ] **Commit:** `git add src/core/geometry.ts test/geometry.test.ts && git commit -m "feat(geometry): markerScreenPos + clampIconScale for two-layer overlay"`

---

### Task 3.2: `marker-overlay.ts` — non-transformed interactive icon layer
**Files:**
- Create `src/render/marker-overlay.ts`
- Test `test/marker-overlay.test.ts`

**Interfaces:**
- Consumes: `EntityConfig` (`src/core/config.ts`), `isActive`, `iconForEntity` (`src/core/entity-state.ts`), `markerScreenPos`, `clampIconScale`, `Viewport`, `ZoomTransform` (`src/core/geometry.ts`). `HassEntity` from `src/core/ha-types.ts`. `html`, `TemplateResult` from `lit`.
- Produces:
  - `interface MarkerView { entity: EntityConfig; state: HassEntity | undefined; left: number; top: number; iconScale: number; icon: string; active: boolean; focused: boolean; }`
  - `function computeMarkerViews(entities: EntityConfig[], states: Record<string, HassEntity>, t: ZoomTransform, vp: Viewport, focusedZoneEntityIds: Set<string> | null): MarkerView[]`
  - `function renderMarkerOverlay(views: MarkerView[], onPointerDown: (e: PointerEvent, m: MarkerView) => void): TemplateResult`

The overlay element itself is NOT transformed. `computeMarkerViews` turns config + state + current `ZoomTransform` into absolute screen-px placements; `renderMarkerOverlay` emits the Lit template. The host card (Task 3.4) wires `onPointerDown` to the gesture controller so tap/hold/drag are decided centrally. `focusedZoneEntityIds` is `null` in overview (no dimming); when a zone is focused (Phase 5), entities NOT in the set render at 0.25 opacity (`focused: false`).

- [ ] **Write failing test** — create `test/marker-overlay.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { computeMarkerViews } from '../src/render/marker-overlay';
import type { EntityConfig } from '../src/core/config';
import type { Viewport, ZoomTransform } from '../src/core/geometry';
import type { HassEntity } from '../src/core/ha-types';

function ent(partial: Partial<EntityConfig>): EntityConfig {
  return {
    entity: 'light.x',
    x: 50,
    y: 50,
    size: 'small',
    tap: 'toggle',
    orientation: null,
    ...partial,
  };
}

function lightState(on: boolean): HassEntity {
  return {
    entity_id: 'light.x',
    state: on ? 'on' : 'off',
    attributes: {},
  };
}

const vp: Viewport = { width: 1000, height: 800 };
const t: ZoomTransform = { scale: 1, panX: 0, panY: 0 };

describe('computeMarkerViews', () => {
  it('places markers at screen px and clamps icon scale', () => {
    const big: ZoomTransform = { scale: 3, panX: 0, panY: 0 };
    const views = computeMarkerViews(
      [ent({ entity: 'light.x', x: 50, y: 50 })],
      { 'light.x': lightState(true) },
      big,
      vp,
      null
    );
    expect(views).toHaveLength(1);
    // 50/100*1000*3 = 1500 ; 50/100*800*3 = 1200
    expect(views[0].left).toBe(1500);
    expect(views[0].top).toBe(1200);
    // scale 3 -> clamped to 2.0
    expect(views[0].iconScale).toBe(2.0);
  });

  it('marks active state from isActive', () => {
    const views = computeMarkerViews(
      [ent({ entity: 'light.x' })],
      { 'light.x': lightState(true) },
      t,
      vp,
      null
    );
    expect(views[0].active).toBe(true);

    const off = computeMarkerViews(
      [ent({ entity: 'light.x' })],
      { 'light.x': lightState(false) },
      t,
      vp,
      null
    );
    expect(off[0].active).toBe(false);
  });

  it('all markers focused when not in zone focus (null set)', () => {
    const views = computeMarkerViews(
      [ent({ entity: 'light.a', x: 10 }), ent({ entity: 'light.b', x: 90 })],
      { 'light.a': lightState(true), 'light.b': lightState(false) },
      t,
      vp,
      null
    );
    expect(views.every((v) => v.focused)).toBe(true);
  });

  it('dims markers outside the focused zone set', () => {
    const focus = new Set(['light.a']);
    const views = computeMarkerViews(
      [ent({ entity: 'light.a', x: 10 }), ent({ entity: 'light.b', x: 90 })],
      { 'light.a': lightState(true), 'light.b': lightState(true) },
      t,
      vp,
      focus
    );
    const a = views.find((v) => v.entity.entity === 'light.a')!;
    const b = views.find((v) => v.entity.entity === 'light.b')!;
    expect(a.focused).toBe(true);
    expect(b.focused).toBe(false);
  });

  it('tolerates a missing entity state (state undefined, not active)', () => {
    const views = computeMarkerViews(
      [ent({ entity: 'light.ghost' })],
      {},
      t,
      vp,
      null
    );
    expect(views[0].state).toBeUndefined();
    expect(views[0].active).toBe(false);
  });
});
```

- [ ] **Run & expect fail:** `npx vitest run test/marker-overlay.test.ts -t "computeMarkerViews"`
  Expected failure: `Failed to resolve import "../src/render/marker-overlay"`.

- [ ] **Minimal implementation** — create `src/render/marker-overlay.ts`:
```ts
import { html, type TemplateResult } from 'lit';
import type { HassEntity } from '../core/ha-types';
import type { EntityConfig } from '../core/config';
import { isActive, iconForEntity } from '../core/entity-state';
import {
  markerScreenPos,
  clampIconScale,
  type Viewport,
  type ZoomTransform,
} from '../core/geometry';

export interface MarkerView {
  entity: EntityConfig;
  state: HassEntity | undefined;
  left: number;
  top: number;
  iconScale: number;
  icon: string;
  active: boolean;
  focused: boolean;
}

/**
 * Project entity configs into absolute screen-px placements for the
 * NON-transformed overlay. `focusedZoneEntityIds === null` => overview
 * (no dimming); otherwise entities not in the set render unfocused (0.25).
 */
export function computeMarkerViews(
  entities: EntityConfig[],
  states: Record<string, HassEntity>,
  t: ZoomTransform,
  vp: Viewport,
  focusedZoneEntityIds: Set<string> | null
): MarkerView[] {
  return entities.map((entity) => {
    const state = states[entity.entity];
    const { left, top } = markerScreenPos(entity.x, entity.y, t, vp);
    return {
      entity,
      state,
      left,
      top,
      iconScale: clampIconScale(t.scale),
      icon: state ? iconForEntity(state, entity) : (entity.icon ?? 'mdi:checkbox-blank-circle'),
      active: state ? isActive(state) : false,
      focused:
        focusedZoneEntityIds === null
          ? true
          : focusedZoneEntityIds.has(entity.entity),
    };
  });
}

const BASE_ICON_PX = 24;

/**
 * Render the interactive overlay. The container is NOT transformed; each
 * marker is absolutely positioned in screen px. Pointer handling is delegated
 * to the host (gesture controller) via onPointerDown so tap/hold/drag are
 * decided in one place.
 */
export function renderMarkerOverlay(
  views: MarkerView[],
  onPointerDown: (e: PointerEvent, m: MarkerView) => void
): TemplateResult {
  return html`
    <div class="marker-overlay" part="marker-overlay">
      ${views.map((m) => {
        const px = BASE_ICON_PX * m.iconScale;
        const disabled = m.entity.tap === 'none';
        return html`
          <button
            class="marker ${m.active ? 'active' : ''} ${m.focused
              ? 'focused'
              : 'dimmed'}"
            ?disabled=${disabled}
            title=${m.entity.name ?? m.entity.entity}
            style="left:${m.left}px;top:${m.top}px;width:${px}px;height:${px}px;"
            @pointerdown=${(e: PointerEvent) => onPointerDown(e, m)}
          >
            <ha-icon icon=${m.icon}></ha-icon>
          </button>
        `;
      })}
    </div>
  `;
}
```

- [ ] **Run & expect pass:** `npx vitest run test/marker-overlay.test.ts`
  Expected: 5 tests passed.

- [ ] **Commit:** `git add src/render/marker-overlay.ts test/marker-overlay.test.ts && git commit -m "feat(marker-overlay): non-transformed interactive icon layer"`

---

### Task 3.3: `tap-hold.ts` — tap-vs-hold-vs-drag gesture decision
**Files:**
- Create `src/core/tap-hold.ts`
- Test `test/tap-hold.test.ts`

**Interfaces:**
- Consumes: nothing (pure state machine; constants only).
- Produces:
  - `type GestureOutcome = 'tap' | 'hold' | 'drag' | 'none'`
  - `const MOVE_THRESHOLD_PX = 8`
  - `const HOLD_MS = 450`
  - `class TapHoldTracker` with:
    - `constructor(opts?: { moveThresholdPx?: number; holdMs?: number })`
    - `start(x: number, y: number, t: number): void`
    - `move(x: number, y: number): { exceededThreshold: boolean }` (once exceeded it latches → becomes a drag, cancels hold)
    - `holdElapsed(t: number): boolean` (true when held past `holdMs` AND not yet moved past threshold)
    - `end(t: number): GestureOutcome` (`tap` if `<HOLD_MS` and `<threshold`; `hold` if held timer already fired; `drag` if moved past threshold; `none` if not started)
    - `reset(): void`

This is the spec §5 decision engine, isolated and time-injectable so the test does not depend on real timers. Task 3.4 wires it to pointer events and a `setTimeout(HOLD_MS)` for the live more-info trigger.

- [ ] **Write failing test** — create `test/tap-hold.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import {
  TapHoldTracker,
  MOVE_THRESHOLD_PX,
  HOLD_MS,
} from '../src/core/tap-hold';

describe('TapHoldTracker thresholds', () => {
  it('exposes the spec constants', () => {
    expect(MOVE_THRESHOLD_PX).toBe(8);
    expect(HOLD_MS).toBe(450);
  });

  it('quick small release is a tap (<8px, <450ms)', () => {
    const g = new TapHoldTracker();
    g.start(100, 100, 0);
    g.move(104, 103); // ~5px, under threshold
    expect(g.end(200)).toBe('tap'); // 200ms < 450ms
  });

  it('movement exactly at 8px is NOT yet a drag (strictly greater)', () => {
    const g = new TapHoldTracker();
    g.start(0, 0, 0);
    const r = g.move(8, 0); // dist == 8
    expect(r.exceededThreshold).toBe(false);
    expect(g.end(100)).toBe('tap');
  });

  it('movement >8px becomes a drag and cancels hold', () => {
    const g = new TapHoldTracker();
    g.start(0, 0, 0);
    const r = g.move(9, 0); // dist == 9 > 8
    expect(r.exceededThreshold).toBe(true);
    expect(g.holdElapsed(1000)).toBe(false); // moved -> no hold
    expect(g.end(1000)).toBe('drag');
  });

  it('threshold latches: a later return inside 8px stays a drag', () => {
    const g = new TapHoldTracker();
    g.start(0, 0, 0);
    g.move(20, 0); // far -> latch drag
    g.move(1, 0); // back near origin
    expect(g.end(100)).toBe('drag');
  });

  it('held past 450ms without moving is a hold', () => {
    const g = new TapHoldTracker();
    g.start(50, 50, 0);
    expect(g.holdElapsed(449)).toBe(false);
    expect(g.holdElapsed(450)).toBe(true); // >= 450ms
    expect(g.end(500)).toBe('hold');
  });

  it('release after 450ms with no movement and no fired hold still reads as hold', () => {
    const g = new TapHoldTracker();
    g.start(0, 0, 0);
    // never called holdElapsed (e.g. timer-less path) but end is late & still
    expect(g.end(600)).toBe('hold');
  });

  it('end without start is none; reset clears state', () => {
    const g = new TapHoldTracker();
    expect(g.end(100)).toBe('none');
    g.start(0, 0, 0);
    g.reset();
    expect(g.end(100)).toBe('none');
  });
});
```

- [ ] **Run & expect fail:** `npx vitest run test/tap-hold.test.ts -t "thresholds"`
  Expected failure: `Failed to resolve import "../src/core/tap-hold"`.

- [ ] **Minimal implementation** — create `src/core/tap-hold.ts`:
```ts
export type GestureOutcome = 'tap' | 'hold' | 'drag' | 'none';

/** Spec §5: movement >8px cancels hold and becomes a pan/drag. */
export const MOVE_THRESHOLD_PX = 8;
/** Spec §5: press-and-hold >=450ms opens more-info. */
export const HOLD_MS = 450;

/**
 * Pure, time-injectable decision engine for tap vs hold vs drag.
 * Caller feeds pointer coordinates and timestamps (ms); no real timers here.
 */
export class TapHoldTracker {
  private readonly moveThresholdPx: number;
  private readonly holdMs: number;

  private active = false;
  private startX = 0;
  private startY = 0;
  private startT = 0;
  private moved = false; // latches once the move threshold is exceeded

  constructor(opts?: { moveThresholdPx?: number; holdMs?: number }) {
    this.moveThresholdPx = opts?.moveThresholdPx ?? MOVE_THRESHOLD_PX;
    this.holdMs = opts?.holdMs ?? HOLD_MS;
  }

  start(x: number, y: number, t: number): void {
    this.active = true;
    this.startX = x;
    this.startY = y;
    this.startT = t;
    this.moved = false;
  }

  /** Returns whether the (latched) move threshold has been exceeded. */
  move(x: number, y: number): { exceededThreshold: boolean } {
    if (!this.active) return { exceededThreshold: this.moved };
    if (!this.moved) {
      const dx = x - this.startX;
      const dy = y - this.startY;
      if (Math.hypot(dx, dy) > this.moveThresholdPx) {
        this.moved = true;
      }
    }
    return { exceededThreshold: this.moved };
  }

  /** True once the press has been held past holdMs and has NOT moved. */
  holdElapsed(t: number): boolean {
    if (!this.active || this.moved) return false;
    return t - this.startT >= this.holdMs;
  }

  end(t: number): GestureOutcome {
    if (!this.active) return 'none';
    let outcome: GestureOutcome;
    if (this.moved) {
      outcome = 'drag';
    } else if (t - this.startT >= this.holdMs) {
      outcome = 'hold';
    } else {
      outcome = 'tap';
    }
    this.active = false;
    return outcome;
  }

  reset(): void {
    this.active = false;
    this.moved = false;
  }
}
```

- [ ] **Run & expect pass:** `npx vitest run test/tap-hold.test.ts`
  Expected: 8 tests passed.

- [ ] **Commit:** `git add src/core/tap-hold.ts test/tap-hold.test.ts && git commit -m "feat(tap-hold): tap/hold/drag decision engine with 8px/450ms thresholds"`

---

### Task 3.4: `pan-zoom.ts` — pointer pan + wheel zoom + pinch with freePanZoom gating
**Files:**
- Create `src/core/pan-zoom.ts`
- Test `test/pan-zoom.test.ts`

**Interfaces:**
- Consumes: `Viewport`, `ZoomTransform` (`src/core/geometry.ts`); `MOVE_THRESHOLD_PX` (`src/core/tap-hold.ts`).
- Produces:
  - `interface PanZoomOptions { zoomMax: number; minScale?: number; }`
  - `class PanZoomController` with:
    - `constructor(opts: PanZoomOptions)`
    - `transform: ZoomTransform` (getter; current value)
    - `setEnabled(enabled: boolean): void` (the `freePanZoom`/unfocused gate; when disabled all inputs are ignored and return the unchanged transform)
    - `panBy(dx: number, dy: number): ZoomTransform`
    - `wheelZoom(deltaY: number, anchorX: number, anchorY: number): ZoomTransform` (zoom toward cursor; clamps scale to `[minScale, zoomMax]`)
    - `pinchZoom(scaleFactor: number, anchorX: number, anchorY: number): ZoomTransform`
    - `pinchDistance(ax: number, ay: number, bx: number, by: number): number` (helper for two-pointer distance)
    - `reset(): ZoomTransform`

Pure math + an enabled flag — no DOM. `setEnabled(false)` is how a focused zone (Phase 5) and `options.freePanZoom: false` (overview) freeze the view; the controller never moves while disabled. Wheel/pinch anchor math keeps the point under the cursor fixed: `pan' = anchor - (anchor - pan) * (newScale/oldScale)`. `minScale` defaults to 1 (never zoom out past fit). Constants from the contract: `zoomMax` default 1.5 is passed in by the host, not hard-coded here.

- [ ] **Write failing test** — create `test/pan-zoom.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { PanZoomController } from '../src/core/pan-zoom';

describe('PanZoomController', () => {
  it('starts at identity transform', () => {
    const c = new PanZoomController({ zoomMax: 1.5 });
    expect(c.transform).toEqual({ scale: 1, panX: 0, panY: 0 });
  });

  it('panBy accumulates translation', () => {
    const c = new PanZoomController({ zoomMax: 1.5 });
    c.panBy(10, 5);
    c.panBy(-3, 2);
    expect(c.transform).toEqual({ scale: 1, panX: 7, panY: 7 });
  });

  it('wheelZoom in raises scale toward zoomMax and anchors to cursor', () => {
    const c = new PanZoomController({ zoomMax: 1.5 });
    // negative deltaY = zoom in
    const t = c.wheelZoom(-100, 0, 0);
    expect(t.scale).toBeGreaterThan(1);
    expect(t.scale).toBeLessThanOrEqual(1.5);
    // anchor at (0,0): pan stays 0 because anchor - (anchor-pan)*k = 0
    expect(t.panX).toBe(0);
    expect(t.panY).toBe(0);
  });

  it('wheelZoom clamps scale at zoomMax', () => {
    const c = new PanZoomController({ zoomMax: 1.5 });
    for (let i = 0; i < 50; i++) c.wheelZoom(-200, 100, 100);
    expect(c.transform.scale).toBe(1.5);
  });

  it('wheelZoom out clamps at minScale (default 1)', () => {
    const c = new PanZoomController({ zoomMax: 3 });
    for (let i = 0; i < 50; i++) c.wheelZoom(200, 100, 100);
    expect(c.transform.scale).toBe(1);
  });

  it('zoom anchored at a non-origin point keeps that point fixed', () => {
    const c = new PanZoomController({ zoomMax: 3 });
    const old = c.transform.scale; // 1
    const t = c.wheelZoom(-100, 200, 100);
    const k = t.scale / old;
    // expected pan = anchor - (anchor - oldPan) * k
    expect(t.panX).toBeCloseTo(200 - (200 - 0) * k, 6);
    expect(t.panY).toBeCloseTo(100 - (100 - 0) * k, 6);
  });

  it('pinchZoom multiplies scale by the factor, clamped', () => {
    const c = new PanZoomController({ zoomMax: 2 });
    c.pinchZoom(1.5, 0, 0); // 1 * 1.5 = 1.5
    expect(c.transform.scale).toBeCloseTo(1.5, 6);
    c.pinchZoom(2, 0, 0); // 1.5 * 2 = 3 -> clamp 2
    expect(c.transform.scale).toBe(2);
  });

  it('pinchDistance is euclidean between two pointers', () => {
    const c = new PanZoomController({ zoomMax: 2 });
    expect(c.pinchDistance(0, 0, 3, 4)).toBeCloseTo(5, 6);
  });

  it('setEnabled(false) freezes all inputs', () => {
    const c = new PanZoomController({ zoomMax: 2 });
    c.setEnabled(false);
    c.panBy(50, 50);
    c.wheelZoom(-100, 10, 10);
    c.pinchZoom(2, 0, 0);
    expect(c.transform).toEqual({ scale: 1, panX: 0, panY: 0 });
  });

  it('reset returns to identity', () => {
    const c = new PanZoomController({ zoomMax: 2 });
    c.panBy(40, 40);
    c.wheelZoom(-200, 5, 5);
    expect(c.reset()).toEqual({ scale: 1, panX: 0, panY: 0 });
    expect(c.transform).toEqual({ scale: 1, panX: 0, panY: 0 });
  });
});
```

- [ ] **Run & expect fail:** `npx vitest run test/pan-zoom.test.ts -t "PanZoomController"`
  Expected failure: `Failed to resolve import "../src/core/pan-zoom"`.

- [ ] **Minimal implementation** — create `src/core/pan-zoom.ts`:
```ts
import type { ZoomTransform } from './geometry';

export interface PanZoomOptions {
  zoomMax: number;
  minScale?: number;
}

/** Per-wheel-notch zoom step (multiplicative). */
const WHEEL_STEP = 1.1;

/**
 * Pure pan/zoom math with an `enabled` gate. No DOM. While disabled (used for
 * focused zones and options.freePanZoom:false) every input is a no-op and the
 * unchanged transform is returned. Anchored zoom keeps the point under the
 * cursor/pinch-center fixed: pan' = anchor - (anchor - pan) * (newScale/oldScale).
 */
export class PanZoomController {
  private readonly zoomMax: number;
  private readonly minScale: number;
  private _t: ZoomTransform = { scale: 1, panX: 0, panY: 0 };
  private enabled = true;

  constructor(opts: PanZoomOptions) {
    this.zoomMax = opts.zoomMax;
    this.minScale = opts.minScale ?? 1;
  }

  get transform(): ZoomTransform {
    return { ...this._t };
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  panBy(dx: number, dy: number): ZoomTransform {
    if (!this.enabled) return this.transform;
    this._t = { ...this._t, panX: this._t.panX + dx, panY: this._t.panY + dy };
    return this.transform;
  }

  wheelZoom(deltaY: number, anchorX: number, anchorY: number): ZoomTransform {
    if (!this.enabled) return this.transform;
    const factor = deltaY < 0 ? WHEEL_STEP : 1 / WHEEL_STEP;
    return this._applyZoom(factor, anchorX, anchorY);
  }

  pinchZoom(scaleFactor: number, anchorX: number, anchorY: number): ZoomTransform {
    if (!this.enabled) return this.transform;
    return this._applyZoom(scaleFactor, anchorX, anchorY);
  }

  pinchDistance(ax: number, ay: number, bx: number, by: number): number {
    return Math.hypot(bx - ax, by - ay);
  }

  reset(): ZoomTransform {
    this._t = { scale: 1, panX: 0, panY: 0 };
    return this.transform;
  }

  private _applyZoom(factor: number, anchorX: number, anchorY: number): ZoomTransform {
    const oldScale = this._t.scale;
    const newScale = Math.min(
      this.zoomMax,
      Math.max(this.minScale, oldScale * factor)
    );
    const k = newScale / oldScale;
    this._t = {
      scale: newScale,
      panX: anchorX - (anchorX - this._t.panX) * k,
      panY: anchorY - (anchorY - this._t.panY) * k,
    };
    return this.transform;
  }
}
```

- [ ] **Run & expect pass:** `npx vitest run test/pan-zoom.test.ts`
  Expected: 10 tests passed.

- [ ] **Commit:** `git add src/core/pan-zoom.ts test/pan-zoom.test.ts && git commit -m "feat(pan-zoom): pointer pan + wheel/pinch zoom with freePanZoom gating"`

---

### Task 3.5: Wire the two-layer card host — overlay + gestures + tap action dispatch
**Files:**
- Modify `src/apartment-view-card.ts` (created in Phase 1/2 as the orchestrator LitElement; add the interaction layer + handlers)
- Test `test/card-tap-action.test.ts`

**Interfaces:**
- Consumes: `PanZoomController` (`src/core/pan-zoom.ts`); `TapHoldTracker`, `HOLD_MS` (`src/core/tap-hold.ts`); `computeMarkerViews`, `renderMarkerOverlay`, `MarkerView` (`src/render/marker-overlay.ts`); `Viewport`, `ZoomTransform` (`src/core/geometry.ts`); `ApartmentViewConfig`, `EntityConfig` (`src/core/config.ts`); `fireEvent` from `custom-card-helpers`.
- Produces:
  - `function dispatchTapAction(card: { hass: HomeAssistant }, entity: EntityConfig, el: HTMLElement): void` (exported from `src/apartment-view-card.ts` for testability)
  - `function dispatchHoldAction(entity: EntityConfig, el: HTMLElement): void` (exported)
  - On the `ApartmentViewCard` class (private, no new contract surface): `_panZoom: PanZoomController`, `_tapHold: TapHoldTracker`, pointer/wheel handlers, `_viewport(): Viewport`, render of the non-transformed overlay alongside the transformed scene.

`dispatchTapAction`: `tap === 'toggle'` → `hass.callService('homeassistant', 'toggle', { entity_id })`; `tap === 'more-info'` → `fireEvent(el, 'hass-more-info', { entityId })`; `tap === 'none'` → no-op. `dispatchHoldAction`: always `fireEvent(el, 'hass-more-info', { entityId })`. These two pure functions are what the test exercises (per scope: "toggle fires homeassistant.toggle"); the class wires `_tapHold.end()` outcomes to them.

- [ ] **Write failing test** — create `test/card-tap-action.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import {
  dispatchTapAction,
  dispatchHoldAction,
} from '../src/apartment-view-card';
import type { EntityConfig } from '../src/core/config';

function ent(tap: EntityConfig['tap'], entity = 'light.kitchen'): EntityConfig {
  return { entity, x: 10, y: 10, size: 'small', tap, orientation: null };
}

describe('dispatchTapAction', () => {
  it('tap:toggle fires homeassistant.toggle with the entity id', () => {
    const callService = vi.fn();
    const card = { hass: { callService } } as any;
    const el = document.createElement('div');
    dispatchTapAction(card, ent('toggle'), el);
    expect(callService).toHaveBeenCalledTimes(1);
    expect(callService).toHaveBeenCalledWith('homeassistant', 'toggle', {
      entity_id: 'light.kitchen',
    });
  });

  it('tap:more-info fires hass-more-info with entityId and does NOT call a service', () => {
    const callService = vi.fn();
    const card = { hass: { callService } } as any;
    const el = document.createElement('div');
    document.body.appendChild(el);
    let detail: any;
    el.addEventListener('hass-more-info', (e: any) => {
      detail = e.detail;
    });
    dispatchTapAction(card, ent('more-info'), el);
    expect(detail).toEqual({ entityId: 'light.kitchen' });
    expect(callService).not.toHaveBeenCalled();
    el.remove();
  });

  it('tap:none does nothing', () => {
    const callService = vi.fn();
    const card = { hass: { callService } } as any;
    const el = document.createElement('div');
    let fired = false;
    el.addEventListener('hass-more-info', () => {
      fired = true;
    });
    dispatchTapAction(card, ent('none'), el);
    expect(callService).not.toHaveBeenCalled();
    expect(fired).toBe(false);
  });
});

describe('dispatchHoldAction', () => {
  it('always fires hass-more-info regardless of tap setting', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    let detail: any;
    el.addEventListener('hass-more-info', (e: any) => {
      detail = e.detail;
    });
    dispatchHoldAction(ent('toggle', 'media_player.tv'), el);
    expect(detail).toEqual({ entityId: 'media_player.tv' });
    el.remove();
  });
});
```

- [ ] **Run & expect fail:** `npx vitest run test/card-tap-action.test.ts -t "dispatchTapAction"`
  Expected failure: import error `dispatchTapAction is not exported` (or module resolution if the symbols are absent).

- [ ] **Add the two exported dispatchers to `src/apartment-view-card.ts`.** Add these imports near the top (merge with the existing import block created in earlier phases):
```ts
import { fireEvent } from 'custom-card-helpers';
import type { HomeAssistant } from 'custom-card-helpers';
import type { EntityConfig } from './core/config';
```
Then add (top-level, exported, near the bottom of the module before the `customElements.define` block):
```ts
/**
 * Spec §5 tap dispatch. toggle -> homeassistant.toggle; more-info -> native
 * dialog via fireEvent(el,'hass-more-info'); none -> no-op.
 */
export function dispatchTapAction(
  card: { hass: HomeAssistant },
  entity: EntityConfig,
  el: HTMLElement
): void {
  switch (entity.tap) {
    case 'toggle':
      card.hass.callService('homeassistant', 'toggle', {
        entity_id: entity.entity,
      });
      return;
    case 'more-info':
      fireEvent(el, 'hass-more-info', { entityId: entity.entity });
      return;
    case 'none':
    default:
      return;
  }
}

/** Press-and-hold (>=450ms) always opens the native more-info dialog. */
export function dispatchHoldAction(entity: EntityConfig, el: HTMLElement): void {
  fireEvent(el, 'hass-more-info', { entityId: entity.entity });
}
```

- [ ] **Run & expect pass:** `npx vitest run test/card-tap-action.test.ts`
  Expected: 4 tests passed.

- [ ] **Wire the interaction state into the `ApartmentViewCard` class.** Add the top-of-file imports (merge with the existing import block — these are static ESM imports; do NOT use `require()` or inline `import('...')` type expressions, which will not compile under the ESM/`tsc --noEmit` gate):
```ts
import { PanZoomController } from './core/pan-zoom';
import { TapHoldTracker, HOLD_MS } from './core/tap-hold';
import {
  computeMarkerViews,
  renderMarkerOverlay,
  type MarkerView,
} from './render/marker-overlay';
import type { Viewport, ZoomTransform } from './core/geometry';
```
and the fields:
```ts
@state() private _transform: ZoomTransform = { scale: 1, panX: 0, panY: 0 };
private _panZoom = new PanZoomController({ zoomMax: 1.5 });
private _tapHold = new TapHoldTracker();
private _activeMarker: MarkerView | null = null;
private _holdTimer: number | null = null;
private _holdFired = false;
private _activePointers = new Map<number, { x: number; y: number }>();
private _pinchStartDist = 0;
private _pinchStartScale = 1;
```

- [ ] **Add the viewport reader and pan/zoom gating in `updated()` / `setConfig`.** Add:
```ts
private _viewport(): Viewport {
  const r = this.getBoundingClientRect();
  return { width: r.width, height: r.height };
}

/** Apply zoomMax + freePanZoom gate whenever config changes. */
private _syncPanZoomFromConfig(): void {
  this._panZoom = new PanZoomController({
    zoomMax: this.config.options.zoomMax,
  });
  // Overview: free pan/zoom only when enabled in options (focus state in Phase 5).
  this._panZoom.setEnabled(this.config.options.freePanZoom);
  this._transform = this._panZoom.transform;
}
```
Call `this._syncPanZoomFromConfig()` at the end of `setConfig` (after `normalizeConfig` runs, created in Phase 1).

- [ ] **Add wheel + window-level pointer move/up listeners** in `connectedCallback`/`disconnectedCallback` (the scene element gets `pointerdown`/`wheel`; move/up bind to `window` so a drag that leaves the card still tracks). Insert handlers:
```ts
private _onWheel = (e: WheelEvent) => {
  e.preventDefault();
  const r = this.getBoundingClientRect();
  this._transform = this._panZoom.wheelZoom(
    e.deltaY,
    e.clientX - r.left,
    e.clientY - r.top
  );
};

private _onScenePointerDown = (e: PointerEvent) => {
  if (e.button !== 0 && e.pointerType === 'mouse') return;
  this._activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (this._activePointers.size === 2) {
    // begin pinch
    const [a, b] = [...this._activePointers.values()];
    this._pinchStartDist = this._panZoom.pinchDistance(a.x, a.y, b.x, b.y);
    this._pinchStartScale = this._panZoom.transform.scale;
    this._cancelHold();
    return;
  }
  // single pointer: candidate tap/hold/pan on the SCENE (not a marker)
  this._activeMarker = null;
  this._beginGesture(e);
};

private _onMarkerPointerDown = (e: PointerEvent, m: MarkerView) => {
  e.stopPropagation();
  if (e.button !== 0 && e.pointerType === 'mouse') return;
  this._activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  this._activeMarker = m;
  this._beginGesture(e);
};

private _beginGesture(e: PointerEvent) {
  this._tapHold.start(e.clientX, e.clientY, performance.now());
  this._holdFired = false;
  this._cancelHold();
  this._holdTimer = window.setTimeout(() => {
    // fire only if still pressed and not moved past threshold
    if (this._tapHold.holdElapsed(performance.now())) {
      this._holdFired = true;
      if (this._activeMarker) {
        dispatchHoldAction(this._activeMarker.entity, this);
      }
    }
  }, HOLD_MS);
}

private _onWindowPointerMove = (e: PointerEvent) => {
  if (!this._activePointers.has(e.pointerId)) return;
  this._activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  if (this._activePointers.size >= 2 && this._pinchStartDist > 0) {
    const [a, b] = [...this._activePointers.values()];
    const dist = this._panZoom.pinchDistance(a.x, a.y, b.x, b.y);
    const factor = dist / this._pinchStartDist;
    const r = this.getBoundingClientRect();
    const cx = (a.x + b.x) / 2 - r.left;
    const cy = (a.y + b.y) / 2 - r.top;
    // apply relative to the pinch-start scale
    const target = this._pinchStartScale * factor;
    this._transform = this._panZoom.pinchZoom(
      target / this._panZoom.transform.scale,
      cx,
      cy
    );
    return;
  }

  const moved = this._tapHold.move(e.clientX, e.clientY);
  if (moved.exceededThreshold) {
    this._cancelHold();
    // pan: translate by the per-event delta
    const prev = this._lastMove ?? { x: e.clientX, y: e.clientY };
    this._transform = this._panZoom.panBy(e.clientX - prev.x, e.clientY - prev.y);
  }
  this._lastMove = { x: e.clientX, y: e.clientY };
};

private _lastMove: { x: number; y: number } | null = null;

private _onWindowPointerUp = (e: PointerEvent) => {
  if (!this._activePointers.has(e.pointerId)) return;
  this._activePointers.delete(e.pointerId);
  this._lastMove = null;
  if (this._activePointers.size < 2) this._pinchStartDist = 0;

  const outcome = this._tapHold.end(performance.now());
  this._cancelHold();
  if (outcome === 'tap' && this._activeMarker) {
    dispatchTapAction(this, this._activeMarker.entity, this);
  } else if (outcome === 'hold' && this._activeMarker && !this._holdFired) {
    // hold timer didn't fire (e.g. test/no-timer path) but release is late
    dispatchHoldAction(this._activeMarker.entity, this);
  }
  this._activeMarker = null;
};

private _cancelHold() {
  if (this._holdTimer !== null) {
    window.clearTimeout(this._holdTimer);
    this._holdTimer = null;
  }
}
```
Bind/unbind in lifecycle:
```ts
connectedCallback() {
  super.connectedCallback();
  this.addEventListener('wheel', this._onWheel, { passive: false });
  window.addEventListener('pointermove', this._onWindowPointerMove);
  window.addEventListener('pointerup', this._onWindowPointerUp);
  window.addEventListener('pointercancel', this._onWindowPointerUp);
}
disconnectedCallback() {
  super.disconnectedCallback();
  this.removeEventListener('wheel', this._onWheel);
  window.removeEventListener('pointermove', this._onWindowPointerMove);
  window.removeEventListener('pointerup', this._onWindowPointerUp);
  window.removeEventListener('pointercancel', this._onWindowPointerUp);
  this._cancelHold();
}
```

- [ ] **Gate pinch start behind the >8px per-gesture threshold (spec §5: the >8px movement threshold applies to both drag AND pinch).** In `_onWindowPointerMove`, do NOT apply `pinchZoom` until the two-pointer distance has changed by more than `MOVE_THRESHOLD_PX` (8px) from `_pinchStartDist`. Add the guard inside the pinch branch:
```ts
    const dist = this._panZoom.pinchDistance(a.x, a.y, b.x, b.y);
    if (Math.abs(dist - this._pinchStartDist) <= MOVE_THRESHOLD_PX) return; // below per-gesture threshold
```
Import `MOVE_THRESHOLD_PX` from `./core/tap-hold`. This matches the single-pointer drag gate so neither gesture engages on sub-threshold jitter.

- [ ] **Render both layers.** In `render()`, wrap the scene (transformed) and overlay (NOT transformed). The scene `transform` uses the SAME math as `markerScreenPos` so the layers stay aligned. Replace the card body with:
```ts
render() {
  if (!this.config?.images?.base) {
    return html`<ha-card><div class="warning">Configure images.base.</div></ha-card>`;
  }
  const vp = this._viewport();
  const t = this._transform;
  const views = computeMarkerViews(
    this.config.entities,
    this.hass?.states ?? {},
    t,
    vp,
    null // overview: no zone focus until Phase 5
  );
  return html`
    <ha-card>
      <div class="wrapper">
        <div
          class="scene"
          style="transform: translate(${t.panX}px, ${t.panY}px) scale(${t.scale});"
          @pointerdown=${this._onScenePointerDown}
        >
          <!-- base-layer + light-layer come from Phase 2 render functions -->
          ${this._renderScene()}
        </div>
        ${renderMarkerOverlay(views, this._onMarkerPointerDown)}
      </div>
    </ha-card>
  `;
}
```
> `_renderScene()` is the Phase 2 base+light render method already on the class; this task only adds the wrapping `scene` div + overlay. KEEP Phase 2's `_cardWidth` `@state` + `ResizeObserver` + `firstUpdated` measurement — `_renderScene()` passes `this._cardWidth` (the scene image-box width) to `renderLightLayer` (and Phase 4's `renderEffect`). `vp = this._viewport()` is used ONLY for `markerScreenPos`/`computeMarkerViews`; the light/effect `cardWidth` is always `this._cardWidth`, NOT `vp.width`. (Phase 5 `_viewport()` makes `vp.width === this._cardWidth`, so the two agree.)

- [ ] **Add the layer CSS** to the existing `static styles` block:
```css
.wrapper {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  touch-action: none; /* let us own pinch/pan */
}
.scene {
  position: absolute;
  inset: 0;
  transform-origin: 0 0;
  will-change: transform;
  transition: transform 0.6s cubic-bezier(0.4, 0, 0.2, 1);
}
.marker-overlay {
  position: absolute;
  inset: 0;
  pointer-events: none; /* container transparent; buttons re-enable */
}
.marker-overlay .marker {
  position: absolute;
  transform: translate(-50%, -50%);
  display: grid;
  place-items: center;
  border: none;
  border-radius: 50%;
  padding: 0;
  cursor: pointer;
  pointer-events: auto;
  background: var(--card-background-color);
  color: var(--primary-text-color);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
  transition: opacity 0.3s ease, transform 0.6s cubic-bezier(0.4, 0, 0.2, 1),
    background-color 0.3s ease, color 0.3s ease;
}
.marker-overlay .marker.active {
  background: var(--primary-color);
  color: var(--text-primary-color);
}
.marker-overlay .marker.dimmed {
  opacity: 0.25;
}
.marker-overlay .marker[disabled] {
  cursor: default;
  color: var(--disabled-text-color);
}
```
> The `.scene` transition matches the overlay marker `transform` transition (both `0.6s cubic-bezier(.4,0,.2,1)`) so during a zone-zoom the image and icons animate in sync (spec §6).

- [ ] **Suppress the 0.6s transition during live pan/wheel (spec §6 — image must track the pointer, not lag).** The `0.6s` transition must apply ONLY to zone-zoom, never to active free pan/wheel. Add `@state private _animating = false;`, render the scene `style` with `transition: ${this._animating ? ApartmentViewCard.ZOOM_TRANSITION : 'none'}` (Phase 5 defines `ZOOM_TRANSITION`; in Phase 3 inline the `transform 0.6s cubic-bezier(.4,0,.2,1)` string). Set `this._animating = false` whenever `_activePointers.size > 0` or at the start of `_onWheel`; set `this._animating = true` only when entering/leaving zone focus (Phase 5 `_focusZone`/`_exitFocus`). The marker overlay transition follows the same flag so icons and image stay in sync.

- [ ] **Run & expect pass (full Phase 3 suite):**
  `npx vitest run test/geometry.test.ts test/marker-overlay.test.ts test/tap-hold.test.ts test/pan-zoom.test.ts test/card-tap-action.test.ts`
  Expected: all green (5 + 5 + 8 + 10 + 4 tests).

- [ ] **Manual smoke in the dev harness (Phase 1c).** Run `npm run dev`, open `dev/index.html`:
  - Mouse-drag the floorplan → it pans; icons stay crisp and track the image.
  - Wheel up → zooms in toward cursor, capped at 1.5x; wheel down → back to 1x, no further.
  - Trackpad pinch (or two-finger) → zooms toward pinch center.
  - Single click on a light marker → control panel `callService` spy shows `homeassistant.toggle`.
  - Press-and-hold a marker ~0.5s → `hass-more-info` event in the console.
  - Set `options.freePanZoom: false` → drag/wheel no longer move the scene.

- [ ] **Commit:** `git add src/apartment-view-card.ts test/card-tap-action.test.ts && git commit -m "feat(card): two-layer overlay + pan/zoom/pinch + tap/hold dispatch"`

---

Files produced by this phase (absolute paths):
- `/Users/matej/Work/Matej/ha-apartment-view-card/src/core/geometry.ts` (Viewport, ZoomTransform, markerScreenPos, clampIconScale — Phase 5 appends zone math)
- `/Users/matej/Work/Matej/ha-apartment-view-card/src/core/tap-hold.ts` (TapHoldTracker, MOVE_THRESHOLD_PX=8, HOLD_MS=450)
- `/Users/matej/Work/Matej/ha-apartment-view-card/src/core/pan-zoom.ts` (PanZoomController with freePanZoom gating)
- `/Users/matej/Work/Matej/ha-apartment-view-card/src/render/marker-overlay.ts` (non-transformed overlay)
- `/Users/matej/Work/Matej/ha-apartment-view-card/src/apartment-view-card.ts` (modified: two-layer render + gesture wiring + exported dispatchTapAction/dispatchHoldAction)
- Tests under `/Users/matej/Work/Matej/ha-apartment-view-card/test/`

Cross-phase contract notes for the orchestrator: Task 3.1 creates `geometry.ts` with only the three locked names (`Viewport`, `ZoomTransform`, `markerScreenPos`) plus the intra-phase `clampIconScale`; Phase 5 must APPEND `zoomToZone`, `sizeTierFraction`, `haloRadiusPx` to that same file, not recreate it. Task 3.5 assumes Phase 2 left a scene-render method on the class (referenced here as `_renderScene()`) and Phase 1 left `normalizeConfig`-populated `this.config` with `options.zoomMax`/`options.freePanZoom`.

## Phase 4: Cones + orientation; per-domain effects

This phase implements directional emission (§4.4) and per-domain non-light effects (§4.5). It builds on Phase 2's `src/render/light-layer.ts` (which already exports `radialMask`) and `src/render/effect-layer.ts` (created here). Cones are the blocking dependency; per-domain radar/TV effects layer on top.

Assumes the following already exist from earlier phases (used here, not created): `src/core/config.ts` (`EntityConfig`, `SizeTier`), `src/core/entity-state.ts` (`isActive`, `intensity`), `src/core/geometry.ts` (`haloRadiusPx`), `src/core/light-color.ts` (`Rgb`, `resolveLightColor`, `rgbCss`), and `src/render/light-layer.ts` (`radialMask`). All tests run in Vitest browser mode (Playwright provider) under `test/`.

---

### Task 4.1: `coneMask` helper + cone-mask composition (lights)

**Files:**
- Modify: `src/render/light-layer.ts` (add `coneMask`, `lightMaskStyles`)
- Test: `test/cone-mask.test.ts` (create)

**Interfaces:**
- Consumes: `radialMask` (from `light-layer.ts`), `haloRadiusPx` (from `geometry.ts`), `SizeTier` (from `config.ts`).
- Produces:
  - `function coneMask(o: number, half: number, feather: number, at: string): string`
  - `function lightMaskStyles(xPct: number, yPct: number, radiusPx: number, orientation: number | null): { maskImage: string; maskComposite: string; webkitMaskComposite: string }` — when `orientation === null`, returns just the radial mask with empty composite strings; when numeric, returns `"radialMask, coneMask(o,30,12,'x% y%')"` with `maskComposite: 'intersect'` and `webkitMaskComposite: 'source-in'`.

Steps:

- [ ] **Write failing test.** Create `test/cone-mask.test.ts` with the full stop-math + composition coverage:

```ts
import { describe, it, expect } from 'vitest';
import { coneMask, lightMaskStyles } from '../src/render/light-layer';

describe('coneMask', () => {
  it('produces a conic-gradient with the exact 6 stops for the light cone (half=30, feather=12)', () => {
    const m = coneMask(0, 30, 12, '40% 16%');
    expect(m).toBe(
      'conic-gradient(from 0deg at 40% 16%, ' +
        'black 0deg, black 30deg, ' +
        'transparent 42deg, transparent 318deg, ' +
        'black 330deg, black 360deg)'
    );
  });

  it('computes half+feather, 360-half-feather and 360-half for the device cone (half=34, feather=14)', () => {
    const m = coneMask(0, 34, 14, '50% 50%');
    expect(m).toContain('black 34deg');
    expect(m).toContain('transparent 48deg'); // half+feather
    expect(m).toContain('transparent 312deg'); // 360-half-feather
    expect(m).toContain('black 326deg'); // 360-half
    expect(m).toContain('black 360deg');
  });

  it('embeds the orientation in the "from" angle', () => {
    expect(coneMask(135, 30, 12, '50% 50%')).toContain('conic-gradient(from 135deg at 50% 50%');
  });

  it('embeds the at-position verbatim', () => {
    expect(coneMask(90, 34, 14, '50% 50%')).toContain('at 50% 50%');
  });
});

describe('lightMaskStyles', () => {
  it('returns only the radial mask and empty composites when orientation is null (omni)', () => {
    const s = lightMaskStyles(40, 16, 120, null);
    expect(s.maskImage).toBe(
      'radial-gradient(circle 120px at 40% 16%, black 0%, rgba(0,0,0,0.55) 40%, transparent 100%)'
    );
    expect(s.maskComposite).toBe('');
    expect(s.webkitMaskComposite).toBe('');
  });

  it('intersects radial + cone when orientation is numeric (including 0)', () => {
    const s = lightMaskStyles(40, 16, 120, 0);
    expect(s.maskImage).toBe(
      'radial-gradient(circle 120px at 40% 16%, black 0%, rgba(0,0,0,0.55) 40%, transparent 100%), ' +
        "conic-gradient(from 0deg at 40% 16%, black 0deg, black 30deg, transparent 42deg, transparent 318deg, black 330deg, black 360deg)"
    );
    expect(s.maskComposite).toBe('intersect');
    expect(s.webkitMaskComposite).toBe('source-in');
  });
});
```

- [ ] **Run & expect fail.** `npx vitest run test/cone-mask.test.ts -t "coneMask"`
  Expected: fails to import — `SyntaxError`/`No "coneMask" export is defined`, or `coneMask is not a function`.

- [ ] **Minimal implementation.** Append to `src/render/light-layer.ts` (do NOT change the existing `radialMask`):

```ts
/**
 * Conic-gradient cone mask, §4.4. `o` = orientation in degrees (0 = up, clockwise),
 * `half` = cone half-angle, `feather` = angular soft edge, `at` = gradient center
 * ("x% y%" for lights, "50% 50%" for device beams). Six stops produce a black wedge
 * of full width 2·half centered on `o`, feathering to transparent over `feather` on
 * each side.
 */
export function coneMask(o: number, half: number, feather: number, at: string): string {
  return (
    `conic-gradient(from ${o}deg at ${at}, ` +
    `black 0deg, black ${half}deg, ` +
    `transparent ${half + feather}deg, transparent ${360 - half - feather}deg, ` +
    `black ${360 - half}deg, black 360deg)`
  );
}

/**
 * Mask styles for a `lit`/`reveal`/`glow` light patch, §4.4.
 * Omnidirectional (orientation === null) = radial halo only.
 * Directional = radial ∩ cone, via mask-composite: intersect (-webkit: source-in).
 */
export function lightMaskStyles(
  xPct: number,
  yPct: number,
  radiusPx: number,
  orientation: number | null,
): { maskImage: string; maskComposite: string; webkitMaskComposite: string } {
  const radial = radialMask(xPct, yPct, radiusPx);
  if (orientation === null) {
    return { maskImage: radial, maskComposite: '', webkitMaskComposite: '' };
  }
  const cone = coneMask(orientation, 30, 12, `${xPct}% ${yPct}%`);
  return {
    maskImage: `${radial}, ${cone}`,
    maskComposite: 'intersect',
    webkitMaskComposite: 'source-in',
  };
}
```

- [ ] **Run & expect pass.** `npx vitest run test/cone-mask.test.ts`
  Expected: all tests in both `describe` blocks green.

- [ ] **Commit.** `git add src/render/light-layer.ts test/cone-mask.test.ts && git commit -m "feat(light-layer): coneMask helper + radial∩cone light mask composition"`

---

### Task 4.2: Wire cone masks into the light layer render

**Files:**
- Modify: `src/render/light-layer.ts` (apply `lightMaskStyles` in the per-light template; add `lightPatchMaskCss` helper that returns a `StyleInfo`-shaped record for `styleMap`)
- Test: `test/light-cone-render.test.ts` (create)

**Interfaces:**
- Consumes: `lightMaskStyles`, `haloRadiusPx` (geometry), `intensity` (entity-state), `EntityConfig`, `SizeTier`.
- Produces:
  - `function lightPatchMaskCss(cfg: EntityConfig, cardWidth: number, brightness: number): Record<string, string>` — returns the `style` record (kebab CSS prop → value) for a light patch element, computing radius via `haloRadiusPx(cardWidth, cfg.size, brightness)` and threading `cfg.orientation` into `lightMaskStyles`. Includes `mask-image`, `-webkit-mask-image`, and (when directional) `mask-composite` + `-webkit-mask-composite`.

> This task makes the mask actually consumable by the Lit template via `styleMap`. The existing Phase 2 light-layer render (`lit`/`reveal`/`glow` opacity + tint) is left intact; only the mask source changes from a bare radial to `lightPatchMaskCss`.

Steps:

- [ ] **Write failing test.** Create `test/light-cone-render.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { lightPatchMaskCss } from '../src/render/light-layer';
import type { EntityConfig } from '../src/core/config';

function cfg(partial: Partial<EntityConfig>): EntityConfig {
  return {
    entity: 'light.test',
    x: 40,
    y: 16,
    size: 'small',
    tap: 'toggle',
    orientation: null,
    ...partial,
  };
}

describe('lightPatchMaskCss', () => {
  it('omni light: radial mask only, no composite props', () => {
    // small=0.13, cardWidth 1000, b=1 => r = 0.13*1000*(0.45+0.55) = 130
    const s = lightPatchMaskCss(cfg({ orientation: null }), 1000, 1);
    expect(s['mask-image']).toBe(
      'radial-gradient(circle 130px at 40% 16%, black 0%, rgba(0,0,0,0.55) 40%, transparent 100%)'
    );
    expect(s['-webkit-mask-image']).toBe(s['mask-image']);
    expect(s['mask-composite']).toBeUndefined();
    expect(s['-webkit-mask-composite']).toBeUndefined();
  });

  it('directional light: radial∩cone with both composite props', () => {
    const s = lightPatchMaskCss(cfg({ orientation: 90 }), 1000, 1);
    expect(s['mask-image']).toContain('radial-gradient(circle 130px at 40% 16%');
    expect(s['mask-image']).toContain('conic-gradient(from 90deg at 40% 16%');
    expect(s['mask-composite']).toBe('intersect');
    expect(s['-webkit-mask-composite']).toBe('source-in');
    expect(s['-webkit-mask-image']).toBe(s['mask-image']);
  });

  it('radius shrinks with brightness (b=0 => 0.45 factor)', () => {
    // small=0.13, cardWidth 1000, b=0 => r = 0.13*1000*0.45 = 58.5
    const s = lightPatchMaskCss(cfg({}), 1000, 0);
    expect(s['mask-image']).toContain('circle 58.5px at');
  });
});
```

- [ ] **Run & expect fail.** `npx vitest run test/light-cone-render.test.ts`
  Expected: `No "lightPatchMaskCss" export is defined` / `lightPatchMaskCss is not a function`.

- [ ] **Minimal implementation.** Append to `src/render/light-layer.ts` (add the import for `haloRadiusPx` at the top of the file if not already present: `import { haloRadiusPx } from '../core/geometry';` and `import type { EntityConfig } from '../core/config';`):

```ts
/**
 * Build the `styleMap` record for a single light patch's mask, §4.4.
 * Radius from haloRadiusPx; cone threaded from cfg.orientation.
 * Returns kebab-cased CSS props so it can be spread into styleMap().
 *
 * v2.0 DEVIATION (spec §4.2): `reveal` should use a HARDER-edged mask while
 * `lit`/`glow` use the soft radial; this helper currently builds the soft
 * radial for every style, so `reveal` shares the soft mask. Branching mask
 * hardness by `effectiveLightStyle` is a deferred follow-up.
 */
export function lightPatchMaskCss(
  cfg: EntityConfig,
  cardWidth: number,
  brightness: number,
): Record<string, string> {
  const radiusPx = haloRadiusPx(cardWidth, cfg.size, brightness);
  const m = lightMaskStyles(cfg.x, cfg.y, radiusPx, cfg.orientation);
  const out: Record<string, string> = {
    'mask-image': m.maskImage,
    '-webkit-mask-image': m.maskImage,
  };
  if (m.maskComposite) {
    out['mask-composite'] = m.maskComposite;
    out['-webkit-mask-composite'] = m.webkitMaskComposite;
  }
  return out;
}
```

- [ ] **Run & expect pass.** `npx vitest run test/light-cone-render.test.ts`
  Expected: 3 tests green.

- [ ] **Wire into the existing render.** In `src/render/light-layer.ts`'s `renderLight` (Phase 2 Task 2.4), the mask lives on the OUTER `.light-overlay` element's `overlayStyle`. Replace the bare-radial `mask-image`/`-webkit-mask-image` lines in `overlayStyle` with the spread of `lightPatchMaskCss(cfg, cardWidth, b)` — this also adds the cone `mask-composite`/`-webkit-mask-composite` props on that SAME element when the light is directional. Do NOT introduce a separate `.light-patch` element or a `styleForStyle` map; the inner `lit`/`glow`/`reveal` `img`/`.tint` opacity styles stay exactly as Phase 2 wrote them. Concretely:

```ts
const overlayStyle = {
  position: 'absolute',
  inset: '0',
  opacity: on ? '1' : '0',
  transition: FADE,
  'pointer-events': 'none',
  ...lightPatchMaskCss(cfg, cardWidth, b), // replaces the bare radial mask-image lines; adds cone composite when directional
};
```
Add `import { styleMap } from 'lit/directives/style-map.js';` if absent (already used in Phase 2).

- [ ] **Run full light-layer test suite & expect pass.** `npx vitest run test/light-cone-render.test.ts test/cone-mask.test.ts`
  Expected: all green; no Phase 2 light-layer tests regress (run them too if present: `npx vitest run test/`).

- [ ] **Commit.** `git add src/render/light-layer.ts test/light-cone-render.test.ts && git commit -m "feat(light-layer): apply radial∩cone mask to light patches via styleMap"`

---

### Task 4.3: `effect-layer.ts` — TV blue cone + device beam cone

**Files:**
- Create: `src/render/effect-layer.ts`
- Test: `test/effect-tv-cone.test.ts` (create)

**Interfaces:**
- Consumes: `coneMask` (light-layer), `isActive` (entity-state), `HassEntity`, `EntityConfig`.
- Produces:
  - `function isTvLike(state: HassEntity): boolean` — `media_player` whose `device_class === 'tv'` OR `source`/`app_name` absent of audio hints; treat `device_class === 'tv'` as the authoritative signal, fall back to `attributes.device_class === undefined && domain === 'media_player'` being NOT tv-like only when `attributes.media_content_type === 'music'`. (Deterministic rule below.)
  - `function deviceConeBeamCss(orientation: number, colorCss: string): Record<string, string>` — the beam div's `styleMap` record: a radial `background` fading the color to transparent, masked by `coneMask(orientation,34,14,'50% 50%')` (both `mask-image` and `-webkit-mask-image`), `mix-blend-mode: screen`.
  - `function tvBeamCss(orientation: number): Record<string, string>` — `deviceConeBeamCss(orientation, 'rgba(95, 165, 255, 0.5)')` plus the `animation` for the weak pulse (`tv-pulse 2.4s ease-in-out infinite`).
  - `const TV_PULSE_KEYFRAMES: string` — the `@keyframes tv-pulse` CSS text (opacity 0.35 ↔ 0.55) for injection into the layer's `<style>`.

Deterministic `isTvLike` rule (codify, don't hand-wave): tv-like ⇔ domain is `media_player` AND `(attributes.device_class === 'tv' || attributes.media_content_type === 'tvshow' || attributes.media_content_type === 'video' || attributes.media_content_type === 'movie')`. Music/audio content types are NOT tv-like (those go to the speaker radar in Task 4.4).

Steps:

- [ ] **Write failing test.** Create `test/effect-tv-cone.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { isTvLike, deviceConeBeamCss, tvBeamCss, TV_PULSE_KEYFRAMES } from '../src/render/effect-layer';
import type { HassEntity } from '../src/core/ha-types';

function mp(attrs: Record<string, unknown>, state = 'playing'): HassEntity {
  return {
    entity_id: 'media_player.x',
    state,
    attributes: attrs,
  };
}

describe('isTvLike', () => {
  it('true when device_class is tv', () => {
    expect(isTvLike(mp({ device_class: 'tv' }))).toBe(true);
  });
  it('true for video/movie/tvshow content types', () => {
    expect(isTvLike(mp({ media_content_type: 'video' }))).toBe(true);
    expect(isTvLike(mp({ media_content_type: 'movie' }))).toBe(true);
    expect(isTvLike(mp({ media_content_type: 'tvshow' }))).toBe(true);
  });
  it('false for music content type (that is a speaker)', () => {
    expect(isTvLike(mp({ media_content_type: 'music' }))).toBe(false);
  });
  it('false for non-media_player domains', () => {
    const climate = { ...mp({ device_class: 'tv' }), entity_id: 'climate.x' } as HassEntity;
    expect(isTvLike(climate)).toBe(false);
  });
});

describe('deviceConeBeamCss', () => {
  it('builds a color radial masked by the 34/14 device cone with screen blend', () => {
    const s = deviceConeBeamCss(90, 'rgba(95, 165, 255, 0.5)');
    expect(s.background).toBe(
      'radial-gradient(circle at 50% 50%, rgba(95, 165, 255, 0.5) 0%, transparent 70%)'
    );
    expect(s['mask-image']).toBe(
      'conic-gradient(from 90deg at 50% 50%, black 0deg, black 34deg, transparent 48deg, transparent 312deg, black 326deg, black 360deg)'
    );
    expect(s['-webkit-mask-image']).toBe(s['mask-image']);
    expect(s['mix-blend-mode']).toBe('screen');
  });
});

describe('tvBeamCss', () => {
  it('uses the weak blue color and the tv-pulse animation', () => {
    const s = tvBeamCss(0);
    expect(s.background).toContain('rgba(95, 165, 255, 0.5)');
    expect(s.animation).toBe('tv-pulse 2.4s ease-in-out infinite');
    expect(s['mask-image']).toContain('conic-gradient(from 0deg at 50% 50%');
  });
  it('keyframes pulse weakly between 0.35 and 0.55 opacity', () => {
    expect(TV_PULSE_KEYFRAMES).toContain('@keyframes tv-pulse');
    expect(TV_PULSE_KEYFRAMES).toContain('opacity: 0.35');
    expect(TV_PULSE_KEYFRAMES).toContain('opacity: 0.55');
  });
});
```

- [ ] **Run & expect fail.** `npx vitest run test/effect-tv-cone.test.ts`
  Expected: `Failed to resolve import "../src/render/effect-layer"` (file does not exist yet).

- [ ] **Minimal implementation.** Create `src/render/effect-layer.ts`:

```ts
import type { HassEntity } from '../core/ha-types';
import { coneMask } from './light-layer';

/** §4.5 TV detection: media_player carrying video-ish content. */
export function isTvLike(state: HassEntity): boolean {
  const domain = state.entity_id.split('.')[0];
  if (domain !== 'media_player') return false;
  const a = state.attributes as Record<string, unknown>;
  if (a.device_class === 'tv') return true;
  const ct = a.media_content_type;
  return ct === 'video' || ct === 'movie' || ct === 'tvshow';
}

/**
 * §4.4/§4.5 device beam: a colored radial faded to transparent, masked into a
 * 34°/14° feather cone, screen-blended. `colorCss` is any CSS color.
 */
export function deviceConeBeamCss(
  orientation: number,
  colorCss: string,
): Record<string, string> {
  const mask = coneMask(orientation, 34, 14, '50% 50%');
  return {
    background: `radial-gradient(circle at 50% 50%, ${colorCss} 0%, transparent 70%)`,
    'mask-image': mask,
    '-webkit-mask-image': mask,
    'mix-blend-mode': 'screen',
  };
}

/** §4.5 TV cone: weak blue beam + gentle pulse, shown only when on. */
export function tvBeamCss(orientation: number): Record<string, string> {
  return {
    ...deviceConeBeamCss(orientation, 'rgba(95, 165, 255, 0.5)'),
    animation: 'tv-pulse 2.4s ease-in-out infinite',
  };
}

/** Injected into the effect layer's <style>; weak opacity pulse. */
export const TV_PULSE_KEYFRAMES = `@keyframes tv-pulse {
  0% { opacity: 0.35; }
  50% { opacity: 0.55; }
  100% { opacity: 0.35; }
}`;
```

- [ ] **Run & expect pass.** `npx vitest run test/effect-tv-cone.test.ts`
  Expected: all 4 `describe` groups green.

- [ ] **Commit.** `git add src/render/effect-layer.ts test/effect-tv-cone.test.ts && git commit -m "feat(effect-layer): TV blue cone beam + device cone beam helper"`

---

### Task 4.4: Radar arcs (speaker + AC) with AC color-by-hvac-mode

**Files:**
- Modify: `src/render/effect-layer.ts` (add `acRadarColor`, `radarArcsCss`, `RADAR_KEYFRAMES`, `RADAR_ARC_COUNT`)
- Test: `test/effect-radar.test.ts` (create)

**Interfaces:**
- Consumes: `coneMask` (light-layer), `HassEntity`.
- Produces:
  - `const RADAR_ARC_COUNT = 5`
  - `function acRadarColor(state: HassEntity): string` — `'rgb(95, 165, 255)'` when cooling, `'rgb(255, 95, 95)'` when heating, `'rgb(150, 150, 150)'` unknown. Mode resolved from `attributes.hvac_action` first (`'cooling'`/`'heating'`), then `state.state` (`'cool'`/`'heat'`/`'heat_cool'`/`'auto'`/`'dry'`/`'fan_only'`). Cooling-ish (`cool`/`dry`) → blue; heating-ish (`heat`) → red; ambiguous (`heat_cool`/`auto`/`fan_only`/anything else) → gray.
  - `function radarArcsCss(arcIndex: number, colorCss: string, orientation: number | null): { container: Record<string,string>; arc: Record<string,string> }` — per-arc style: `arc` carries `border: 4.5px solid colorCss`, `animation: radar-ripple 2.4s linear infinite` with `animation-delay: ${arcIndex * 480}ms`; `container` carries the cone mask (`coneMask(o,34,14,'50% 50%')`) when `orientation` is numeric, or no mask (full rings) when `null`.
  - `const RADAR_KEYFRAMES: string` — `@keyframes radar-ripple` growing scale 0→1 with opacity pulsing 0.3↔0.7 then fading (AC pulse band per §4.5).

Steps:

- [ ] **Write failing test.** Create `test/effect-radar.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  acRadarColor,
  radarArcsCss,
  RADAR_ARC_COUNT,
  RADAR_KEYFRAMES,
} from '../src/render/effect-layer';
import type { HassEntity } from '../src/core/ha-types';

function climate(state: string, attrs: Record<string, unknown> = {}): HassEntity {
  return {
    entity_id: 'climate.ac',
    state,
    attributes: attrs,
  };
}

describe('RADAR_ARC_COUNT', () => {
  it('is 5 arcs', () => {
    expect(RADAR_ARC_COUNT).toBe(5);
  });
});

describe('acRadarColor', () => {
  it('blue when hvac_action cooling', () => {
    expect(acRadarColor(climate('cool', { hvac_action: 'cooling' }))).toBe('rgb(95, 165, 255)');
  });
  it('red when hvac_action heating', () => {
    expect(acRadarColor(climate('heat', { hvac_action: 'heating' }))).toBe('rgb(255, 95, 95)');
  });
  it('blue when state cool and no hvac_action', () => {
    expect(acRadarColor(climate('cool'))).toBe('rgb(95, 165, 255)');
  });
  it('blue when state dry', () => {
    expect(acRadarColor(climate('dry'))).toBe('rgb(95, 165, 255)');
  });
  it('red when state heat and no hvac_action', () => {
    expect(acRadarColor(climate('heat'))).toBe('rgb(255, 95, 95)');
  });
  it('gray for heat_cool (ambiguous)', () => {
    expect(acRadarColor(climate('heat_cool'))).toBe('rgb(150, 150, 150)');
  });
  it('gray for auto (ambiguous)', () => {
    expect(acRadarColor(climate('auto'))).toBe('rgb(150, 150, 150)');
  });
  it('gray for fan_only (ambiguous)', () => {
    expect(acRadarColor(climate('fan_only'))).toBe('rgb(150, 150, 150)');
  });
  it('hvac_action wins over state (idle action while state heat => gray? no: action authoritative)', () => {
    // hvac_action 'idle' is not cooling/heating => falls through to state 'heat' => red
    expect(acRadarColor(climate('heat', { hvac_action: 'idle' }))).toBe('rgb(255, 95, 95)');
  });
});

describe('radarArcsCss', () => {
  it('arc style has 4.5px border in the given color and staggered 480ms delay', () => {
    const { arc } = radarArcsCss(2, 'rgb(95, 165, 255)', null);
    expect(arc.border).toBe('4.5px solid rgb(95, 165, 255)');
    expect(arc.animation).toBe('radar-ripple 2.4s linear infinite');
    expect(arc['animation-delay']).toBe('960ms'); // 2 * 480
  });
  it('arc 0 has zero delay', () => {
    const { arc } = radarArcsCss(0, 'rgb(150, 150, 150)', null);
    expect(arc['animation-delay']).toBe('0ms');
  });
  it('omni (orientation null) => container has no cone mask', () => {
    const { container } = radarArcsCss(0, 'rgb(95, 165, 255)', null);
    expect(container['mask-image']).toBeUndefined();
  });
  it('directional => container masked by the 34/14 device cone', () => {
    const { container } = radarArcsCss(0, 'rgb(95, 165, 255)', 90);
    expect(container['mask-image']).toBe(
      'conic-gradient(from 90deg at 50% 50%, black 0deg, black 34deg, transparent 48deg, transparent 312deg, black 326deg, black 360deg)'
    );
    expect(container['-webkit-mask-image']).toBe(container['mask-image']);
  });
});

describe('RADAR_KEYFRAMES', () => {
  it('defines radar-ripple growing scale with the 0.3-0.7 opacity band', () => {
    expect(RADAR_KEYFRAMES).toContain('@keyframes radar-ripple');
    expect(RADAR_KEYFRAMES).toContain('scale(0)');
    expect(RADAR_KEYFRAMES).toContain('scale(1)');
    expect(RADAR_KEYFRAMES).toContain('opacity: 0.7');
    expect(RADAR_KEYFRAMES).toContain('opacity: 0.3');
  });
});
```

- [ ] **Run & expect fail.** `npx vitest run test/effect-radar.test.ts`
  Expected: `No "acRadarColor" export is defined` / `radarArcsCss is not a function`.

- [ ] **Minimal implementation.** Append to `src/render/effect-layer.ts`:

```ts
/** §4.5 number of concentric radar arcs. */
export const RADAR_ARC_COUNT = 5;

/**
 * §4.5 AC tint: blue cooling, red heating, gray unknown.
 * hvac_action ('cooling'/'heating') is authoritative; else infer from state mode.
 * cool/dry -> blue; heat -> red; heat_cool/auto/fan_only/other -> gray.
 *
 * DESIGN NOTE: the contract names only cooling/heating/unknown. Mapping the
 * `dry` (dehumidify) mode to the cooling-blue family is a deliberate v2.0
 * interpretation (dry runs the compressor like cooling), not a contract rule.
 */
export function acRadarColor(state: HassEntity): string {
  const BLUE = 'rgb(95, 165, 255)';
  const RED = 'rgb(255, 95, 95)';
  const GRAY = 'rgb(150, 150, 150)';
  const action = (state.attributes as Record<string, unknown>).hvac_action;
  if (action === 'cooling') return BLUE;
  if (action === 'heating') return RED;
  switch (state.state) {
    case 'cool':
    case 'dry':
      return BLUE;
    case 'heat':
      return RED;
    default:
      return GRAY;
  }
}

/**
 * §4.5 radar arc styles for arc index `arcIndex` (0..RADAR_ARC_COUNT-1).
 * `arc` = the rippling ring (4.5px stroke, 2.4s linear infinite, +480ms/arc stagger).
 * `container` = wrapper, cone-masked when directional, unmasked (full rings) when omni.
 */
export function radarArcsCss(
  arcIndex: number,
  colorCss: string,
  orientation: number | null,
): { container: Record<string, string>; arc: Record<string, string> } {
  const container: Record<string, string> = {};
  if (orientation !== null) {
    const mask = coneMask(orientation, 34, 14, '50% 50%');
    container['mask-image'] = mask;
    container['-webkit-mask-image'] = mask;
  }
  const arc: Record<string, string> = {
    border: `4.5px solid ${colorCss}`,
    animation: 'radar-ripple 2.4s linear infinite',
    'animation-delay': `${arcIndex * 480}ms`,
  };
  return { container, arc };
}

/** Injected into the effect layer's <style>. Grow + opacity pulse 0.3..0.7. */
export const RADAR_KEYFRAMES = `@keyframes radar-ripple {
  0% { transform: translate(-50%, -50%) scale(0); opacity: 0.7; }
  50% { opacity: 0.3; }
  100% { transform: translate(-50%, -50%) scale(1); opacity: 0; }
}`;
```

- [ ] **Run & expect pass.** `npx vitest run test/effect-radar.test.ts`
  Expected: all groups green, including the 9 `acRadarColor` cases.

- [ ] **Commit.** `git add src/render/effect-layer.ts test/effect-radar.test.ts && git commit -m "feat(effect-layer): radar arcs + AC color-by-hvac-mode (blue/red/gray)"`

---

### Task 4.5: Omni fallbacks (light halo / device rings) + effect dispatch

**Files:**
- Modify: `src/render/effect-layer.ts` (add `effectKind`, `renderEffect` dispatch + omni-ring/halo helpers)
- Test: `test/effect-dispatch.test.ts` (create)

**Interfaces:**
- Consumes: `isActive` (entity-state), `isTvLike`, `acRadarColor`, `tvBeamCss`, `radarArcsCss`, `RADAR_ARC_COUNT`, `EntityConfig`, `HassEntity`.
- Produces:
  - `type EffectKind = 'none' | 'tv-cone' | 'speaker-radar' | 'ac-radar';`
  - `function effectKind(state: HassEntity): EffectKind` — `media_player` + tv-like → `'tv-cone'`; `media_player` non-tv (audio) → `'speaker-radar'`; `climate` → `'ac-radar'`; everything else (incl. `light`) → `'none'`. Domain from `entity_id`.
  - `interface EffectModel { kind: EffectKind; show: boolean; color: string; orientation: number | null; arcCount: number; }`
  - `function effectModel(state: HassEntity, cfg: EntityConfig): EffectModel` — resolves kind, `show = effectKind !== 'none' && isActive(state)`, picks color (TV weak blue / speaker neutral white `rgb(255,255,255)` / AC via `acRadarColor`), threads `cfg.orientation`, sets `arcCount = RADAR_ARC_COUNT` for radar kinds else 0. Omni when `orientation === null` (radar → full rings; TV cone with null orientation is suppressed: `show=false`, since a beam needs a direction).

> Rationale for TV-omni suppression: §4.4 says TV is a cone "projecting toward orientation"; with no orientation there is no beam. Lights still get an omni halo (handled in the light-layer, Task 4.2 with `orientation===null`), so this only affects the device beam. Speaker/AC radar legitimately fall back to full rings, so they are NOT suppressed when omni.

Steps:

- [ ] **Write failing test.** Create `test/effect-dispatch.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { effectKind, effectModel } from '../src/render/effect-layer';
import type { HassEntity } from '../src/core/ha-types';
import type { EntityConfig } from '../src/core/config';

function ent(entity_id: string, state: string, attrs: Record<string, unknown> = {}): HassEntity {
  return {
    entity_id,
    state,
    attributes: attrs,
  };
}
function cfg(partial: Partial<EntityConfig>): EntityConfig {
  return { entity: 'x', x: 50, y: 50, size: 'small', tap: 'toggle', orientation: null, ...partial };
}

describe('effectKind', () => {
  it('tv-cone for tv media_player', () => {
    expect(effectKind(ent('media_player.tv', 'playing', { device_class: 'tv' }))).toBe('tv-cone');
  });
  it('speaker-radar for audio media_player', () => {
    expect(effectKind(ent('media_player.spk', 'playing', { media_content_type: 'music' }))).toBe('speaker-radar');
  });
  it('ac-radar for climate', () => {
    expect(effectKind(ent('climate.ac', 'cool'))).toBe('ac-radar');
  });
  it('none for lights', () => {
    expect(effectKind(ent('light.k', 'on'))).toBe('none');
  });
});

describe('effectModel', () => {
  it('TV directional + playing => shown, weak blue, cone (no arcs)', () => {
    const m = effectModel(ent('media_player.tv', 'playing', { device_class: 'tv' }), cfg({ orientation: 0 }));
    expect(m.kind).toBe('tv-cone');
    expect(m.show).toBe(true);
    expect(m.color).toBe('rgba(95, 165, 255, 0.5)');
    expect(m.orientation).toBe(0);
    expect(m.arcCount).toBe(0);
  });
  it('TV omni (no orientation) => suppressed (no beam direction)', () => {
    const m = effectModel(ent('media_player.tv', 'playing', { device_class: 'tv' }), cfg({ orientation: null }));
    expect(m.kind).toBe('tv-cone');
    expect(m.show).toBe(false);
  });
  it('TV off => hidden', () => {
    const m = effectModel(ent('media_player.tv', 'off', { device_class: 'tv' }), cfg({ orientation: 0 }));
    expect(m.show).toBe(false);
  });
  it('speaker playing omni => full rings, neutral white, 5 arcs', () => {
    const m = effectModel(ent('media_player.spk', 'playing', { media_content_type: 'music' }), cfg({ orientation: null }));
    expect(m.kind).toBe('speaker-radar');
    expect(m.show).toBe(true);
    expect(m.color).toBe('rgb(255, 255, 255)');
    expect(m.orientation).toBeNull();
    expect(m.arcCount).toBe(5);
  });
  it('speaker idle => hidden', () => {
    const m = effectModel(ent('media_player.spk', 'idle', { media_content_type: 'music' }), cfg({ orientation: null }));
    expect(m.show).toBe(false);
  });
  it('AC cooling directional => shown, blue, cone, 5 arcs', () => {
    const m = effectModel(ent('climate.ac', 'cool', { hvac_action: 'cooling' }), cfg({ orientation: 270 }));
    expect(m.kind).toBe('ac-radar');
    expect(m.show).toBe(true);
    expect(m.color).toBe('rgb(95, 165, 255)');
    expect(m.orientation).toBe(270);
    expect(m.arcCount).toBe(5);
  });
  it('AC off => hidden', () => {
    const m = effectModel(ent('climate.ac', 'off'), cfg({ orientation: 270 }));
    expect(m.show).toBe(false);
  });
  it('light => none, never shown', () => {
    const m = effectModel(ent('light.k', 'on'), cfg({ orientation: 90 }));
    expect(m.kind).toBe('none');
    expect(m.show).toBe(false);
    expect(m.arcCount).toBe(0);
  });
});
```

- [ ] **Run & expect fail.** `npx vitest run test/effect-dispatch.test.ts`
  Expected: `No "effectKind" export is defined` / `effectModel is not a function`.

- [ ] **Minimal implementation.** Append to `src/render/effect-layer.ts` (add at top of file if missing: `import { isActive } from '../core/entity-state';` and `import type { EntityConfig } from '../core/config';`):

```ts
export type EffectKind = 'none' | 'tv-cone' | 'speaker-radar' | 'ac-radar';

/** §4.5 which effect a domain/entity drives. Lights => none (they use the light-layer). */
export function effectKind(state: HassEntity): EffectKind {
  const domain = state.entity_id.split('.')[0];
  if (domain === 'media_player') return isTvLike(state) ? 'tv-cone' : 'speaker-radar';
  if (domain === 'climate') return 'ac-radar';
  return 'none';
}

export interface EffectModel {
  kind: EffectKind;
  show: boolean;
  color: string;
  orientation: number | null;
  arcCount: number;
}

/**
 * §4.5 resolve the full render model for an entity's non-light effect.
 * TV: weak blue cone, suppressed when omni (no direction).
 * Speaker: neutral-white radar, full rings when omni.
 * AC: blue/red/gray radar by hvac mode, full rings when omni.
 */
export function effectModel(state: HassEntity, cfg: EntityConfig): EffectModel {
  const kind = effectKind(state);
  const orientation = cfg.orientation;
  if (kind === 'none') {
    return { kind, show: false, color: '', orientation, arcCount: 0 };
  }
  const active = isActive(state);
  if (kind === 'tv-cone') {
    return {
      kind,
      show: active && orientation !== null,
      color: 'rgba(95, 165, 255, 0.5)',
      orientation,
      arcCount: 0,
    };
  }
  if (kind === 'speaker-radar') {
    return {
      kind,
      show: active,
      color: 'rgb(255, 255, 255)',
      orientation,
      arcCount: RADAR_ARC_COUNT,
    };
  }
  // ac-radar
  return {
    kind,
    show: active,
    color: acRadarColor(state),
    orientation,
    arcCount: RADAR_ARC_COUNT,
  };
}
```

- [ ] **Run & expect pass.** `npx vitest run test/effect-dispatch.test.ts`
  Expected: both `describe` groups green.

- [ ] **Commit.** `git add src/render/effect-layer.ts test/effect-dispatch.test.ts && git commit -m "feat(effect-layer): effect dispatch + omni fallbacks + TV-omni suppression"`

---

### Task 4.6: Render the effect layer in the card (template wiring + fade)

**Files:**
- Modify: `src/render/effect-layer.ts` (add `renderEffectLayer(state, cfg, cardWidth)` returning a Lit `TemplateResult`, and exported `EFFECT_STYLES` css text)
- Modify: `src/apartment-view-card.ts` (mount effects inside the transformed `scene` layer, per §3 — alongside light overlays)
- Test: `test/effect-render.test.ts` (create)

**Interfaces:**
- Consumes: `effectModel`, `tvBeamCss`, `radarArcsCss`, `RADAR_ARC_COUNT`, `TV_PULSE_KEYFRAMES`, `RADAR_KEYFRAMES`.
- Produces:
  - `const EFFECT_STYLES: string` — combined `<style>` text = `TV_PULSE_KEYFRAMES + RADAR_KEYFRAMES` plus base classes (`.effect-overlay { position:absolute; ... transition: opacity 0.3s; }`, `.radar-arc`, `.device-beam`).
  - `function renderEffect(state: HassEntity | undefined, cfg: EntityConfig, cardWidth: number): TemplateResult | typeof nothing` — returns `nothing` when `state` is undefined (unmatched entity) or `model.show === false`; for `tv-cone` a single beam div with `tvBeamCss`; for radar kinds a cone-masked container holding `RADAR_ARC_COUNT` `.radar-arc` divs from `radarArcsCss`. Wraps each in `.effect-overlay` positioned at `cfg.x% cfg.y%` so it tracks the scene transform, with `opacity` transitioned over `0.3s`.

> `cardWidth` is threaded for parity with the light layer and future radius sizing; the radar ring max-size is currently driven by the keyframe `scale(1)` against a CSS-sized container (e.g. a fraction of card width set inline). Set the container size to `sizeTierFraction(cfg.size) * cardWidth` px square so rings/cone scale with the marker size tier (import `sizeTierFraction` from geometry).
>
> NOTE (spec §4.5): the spec describes the arc "radius grows 0 → cone radius then repeats". Sizing the arcs to the `sizeTierFraction*cardWidth` square with CSS `scale(0→1)` is an accepted approximation — no task verifies the arc's grown radius exactly equals the cone radius. Acceptable for v2.0; flagged here only.

Steps:

- [ ] **Write failing test.** Create `test/effect-render.test.ts` (browser-mode; renders the template into the DOM and asserts structure/classes):

```ts
import { describe, it, expect } from 'vitest';
import { render, nothing } from 'lit';
import { renderEffect, EFFECT_STYLES } from '../src/render/effect-layer';
import type { HassEntity } from '../src/core/ha-types';
import type { EntityConfig } from '../src/core/config';

function ent(entity_id: string, state: string, attrs: Record<string, unknown> = {}): HassEntity {
  return {
    entity_id, state, attributes: attrs,
  };
}
function cfg(partial: Partial<EntityConfig>): EntityConfig {
  return { entity: 'x', x: 30, y: 40, size: 'small', tap: 'toggle', orientation: null, ...partial };
}
function mount(tpl: unknown): HTMLDivElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  render(tpl as Parameters<typeof render>[0], host);
  return host;
}

describe('EFFECT_STYLES', () => {
  it('bundles both keyframe sets and a 0.3s opacity transition', () => {
    expect(EFFECT_STYLES).toContain('@keyframes tv-pulse');
    expect(EFFECT_STYLES).toContain('@keyframes radar-ripple');
    expect(EFFECT_STYLES).toContain('transition: opacity 0.3s');
  });
});

describe('renderEffect', () => {
  it('returns nothing for a hidden effect (TV off)', () => {
    expect(renderEffect(ent('media_player.tv', 'off', { device_class: 'tv' }), cfg({ orientation: 0 }), 1000)).toBe(nothing);
  });
  it('returns nothing for a light', () => {
    expect(renderEffect(ent('light.k', 'on'), cfg({ orientation: 0 }), 1000)).toBe(nothing);
  });
  it('renders a single device-beam div for an active directional TV', () => {
    const host = mount(renderEffect(ent('media_player.tv', 'playing', { device_class: 'tv' }), cfg({ orientation: 0 }), 1000));
    expect(host.querySelectorAll('.device-beam').length).toBe(1);
    expect(host.querySelectorAll('.radar-arc').length).toBe(0);
    const overlay = host.querySelector('.effect-overlay') as HTMLElement;
    expect(overlay.style.left).toBe('30%');
    expect(overlay.style.top).toBe('40%');
  });
  it('renders 5 radar-arc divs for an active speaker', () => {
    const host = mount(renderEffect(ent('media_player.spk', 'playing', { media_content_type: 'music' }), cfg({ orientation: null }), 1000));
    expect(host.querySelectorAll('.radar-arc').length).toBe(5);
  });
  it('renders 5 radar-arc divs for an active AC and tints them blue when cooling', () => {
    const host = mount(renderEffect(ent('climate.ac', 'cool', { hvac_action: 'cooling' }), cfg({ orientation: 90 }), 1000));
    const arcs = host.querySelectorAll('.radar-arc');
    expect(arcs.length).toBe(5);
    // border color carried through (browser normalizes rgb spacing)
    expect((arcs[0] as HTMLElement).style.borderColor).toBe('rgb(95, 165, 255)');
  });
});
```

- [ ] **Run & expect fail.** `npx vitest run test/effect-render.test.ts`
  Expected: `No "renderEffect" export is defined` / `No "EFFECT_STYLES" export is defined`.

- [ ] **Minimal implementation.** Append to `src/render/effect-layer.ts` (add imports at top: `import { html, nothing, type TemplateResult } from 'lit';`, `import { styleMap } from 'lit/directives/style-map.js';`, `import { sizeTierFraction } from '../core/geometry';`):

```ts
/** §3/§4.5 styles for the effect overlay; injected once into the scene layer. */
export const EFFECT_STYLES = `${TV_PULSE_KEYFRAMES}
${RADAR_KEYFRAMES}
.effect-overlay {
  position: absolute;
  transform: translate(-50%, -50%);
  pointer-events: none;
  transition: opacity 0.3s;
}
.device-beam {
  position: absolute;
  inset: 0;
}
.radar-arc {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 100%;
  height: 100%;
  border-radius: 50%;
  box-sizing: border-box;
  transform: translate(-50%, -50%) scale(0);
}`;

/**
 * §4.5 render a single entity's non-light effect into the (transformed) scene layer.
 * Returns `nothing` when not shown. Positioned at cfg.x%/cfg.y%; sized by size tier.
 */
export function renderEffect(
  state: HassEntity | undefined,
  cfg: EntityConfig,
  cardWidth: number,
): TemplateResult | typeof nothing {
  if (!state) return nothing; // unmatched/absent entity -> render nothing
  const model = effectModel(state, cfg);
  if (!model.show) return nothing;

  const sidePx = sizeTierFraction(cfg.size) * cardWidth;
  const overlayStyle = styleMap({
    left: `${cfg.x}%`,
    top: `${cfg.y}%`,
    width: `${sidePx}px`,
    height: `${sidePx}px`,
    opacity: '1',
  });

  if (model.kind === 'tv-cone') {
    return html`
      <div class="effect-overlay" style=${overlayStyle}>
        <div class="device-beam" style=${styleMap(tvBeamCss(model.orientation as number))}></div>
      </div>
    `;
  }

  // speaker-radar | ac-radar
  const arcs = Array.from({ length: model.arcCount }, (_, i) => {
    const { container, arc } = radarArcsCss(i, model.color, model.orientation);
    // container mask is applied to the overlay wrapper for the cone; arc carries stroke+anim
    return { container, arc };
  });
  // cone mask (if any) is identical across arcs -> take the first's container
  const containerStyle = arcs.length ? arcs[0].container : {};
  return html`
    <div
      class="effect-overlay"
      style=${styleMap({ ...containerStyle, left: `${cfg.x}%`, top: `${cfg.y}%`, width: `${sidePx}px`, height: `${sidePx}px`, opacity: '1' })}
    >
      ${arcs.map((a) => html`<div class="radar-arc" style=${styleMap(a.arc)}></div>`)}
    </div>
  `;
}
```

- [ ] **Run & expect pass.** `npx vitest run test/effect-render.test.ts`
  Expected: both `describe` groups green (5 arcs counted, beam div present, blue border on cooling AC, `nothing` for light/off).

- [ ] **Wire into the card.** In `src/apartment-view-card.ts`, anchor the effect map inside `_renderScene()` (the Phase 2 method — Fix 6), right next to the `renderLightLayer` call so effects share the transformed scene and the same `this._cardWidth`. Use optional chaining on `hass.states` so an unmatched/absent entity passes `undefined` (the card's `hass` may be undefined and `renderEffect` returns `nothing` for missing state). Concretely, `_renderScene()` returns:

```ts
private _renderScene(): TemplateResult {
  const { images, options, entities } = this.config;
  const sun = this.hass?.states?.['sun.sun'];
  return html`${renderBaseLayer(images, options, sun)}
    ${renderLightLayer(this.hass, entities, options, images, this._cardWidth)}
    ${entities.map((e) =>
      renderEffect(this.hass?.states?.[e.entity], e, this._cardWidth),
    )}`;
}
```

  Inject `EFFECT_STYLES` once: merge it into the component `static styles` via `unsafeCSS` (e.g. `css\`...\${unsafeCSS(EFFECT_STYLES)}\``) — import `unsafeCSS` from `lit` — or render a single `<style>${EFFECT_STYLES}</style>` inside the scene. Import `renderEffect` and `EFFECT_STYLES` from `./render/effect-layer`.

- [ ] **Run & expect pass (full suite, no regressions).** `npx vitest run test/`
  Expected: all Phase 4 tests plus existing Phase 1–3 tests green.

- [ ] **Build sanity check.** `npx vite build` (or `npm run build`)
  Expected: single `dist/apartment-view-card.js` emitted, no TS errors (cone/effect imports resolve, `experimentalDecorators` intact).

- [ ] **Commit.** `git add src/render/effect-layer.ts src/apartment-view-card.ts test/effect-render.test.ts && git commit -m "feat(card): render per-domain effect layer (TV cone + speaker/AC radar) with 0.3s fade"`

---

**Phase 4 exit criteria:** `coneMask` stop math is unit-tested; lights render a `radial ∩ cone` mask when `orientation` is numeric and a plain halo when `null`; the effect layer emits a weak-blue pulsing TV beam (34°/14° cone, suppressed when omni), speaker radar (5 arcs, 4.5px, 2.4s linear infinite, 480ms stagger; full rings when omni), and AC radar tinted blue/red/gray by hvac mode; all effects fade over 0.3s and live in the transformed scene layer. Files touched: `src/render/light-layer.ts`, `src/render/effect-layer.ts`, `src/apartment-view-card.ts`, and tests `test/cone-mask.test.ts`, `test/light-cone-render.test.ts`, `test/effect-tv-cone.test.ts`, `test/effect-radar.test.ts`, `test/effect-dispatch.test.ts`, `test/effect-render.test.ts`.

## Phase 5: Zones: zoom math, list UI, focus

This phase implements zone-zoom math (`geometry.ts zoomToZone`), the horizontal zone-controls list with tap-to-zoom and Back-to-All, focus dimming of non-zone icons via `zoneForPoint` membership, the 0.6s `cubic-bezier(.4,0,.2,1)` animation synced across the image layer and the non-transformed marker overlay, and `Escape`/back-to-exit. Zone definition boxes stay hidden except in editor edit mode. Implemented in strict TDD order; sequenced internally (zoom math → membership/focus selectors → list UI → orchestration wiring).

Phase 5 assumes the following are already in place from prior phases and are consumed verbatim:
- `src/core/geometry.ts` exporting `interface Viewport { width: number; height: number; }`, `interface ZoomTransform { scale: number; panX: number; panY: number; }`, `sizeTierFraction`, `haloRadiusPx`, `markerScreenPos`.
- `src/core/config.ts` exporting `ZoneConfig`, `EntityConfig`, `ApartmentViewConfig`, `normalizeConfig`, and `zoneForPoint(x, y, zones): ZoneConfig | null`.
- `src/apartment-view-card.ts` orchestrator LitElement holding `@state private _transform: ZoomTransform` (the live image-layer transform from Phase 3), `this.config: ApartmentViewConfig`, a `.scene` image-layer element with `transform-origin: 0 0`, and a non-transformed marker overlay rendered from `markerScreenPos`.
- `src/render/marker-overlay.ts` rendering one element per `EntityConfig`.

If `src/core/geometry.ts` does not yet exist in your tree, create it with the four already-shipped exports above before starting Task 5.1; the steps below only add `Viewport`/`ZoomTransform`/`zoomToZone` if missing and never redefine an existing export.

---

### Task 5.1: `geometry.ts` `zoomToZone` — fit-below-cap, center, clamp

**Files:**
- Modify: `/Users/matej/Work/Matej/ha-apartment-view-card/src/core/geometry.ts`
- Test: `/Users/matej/Work/Matej/ha-apartment-view-card/test/geometry.zoom-to-zone.test.ts`

**Interfaces:**
- Consumes: `ZoneConfig` (from `core/config.ts`), `Viewport`, `ZoomTransform` (from `core/geometry.ts`).
- Produces: `function zoomToZone(zone: ZoneConfig, vp: Viewport, maxScale: number): ZoomTransform`.

**Coordinate model (locked, used by every step below):** the image layer fills the viewport at `scale: 1` (image natural box = `vp.width × vp.height` CSS px). A zone's rect is given in percent of the image box: zone screen-space center at scale 1 is `(zone.x + zone.width/2)/100 · vp.width`, `(zone.y + zone.height/2)/100 · vp.height`. Transform maps image point `p` to screen `p·scale + pan`. The image-layer CSS transform is `translate(panX px, panY px) scale(scale)` with `transform-origin: 0 0`, matching `markerScreenPos`.

**`zoomToZone` algorithm (locked):**
1. `fitScale = min(vp.width / (zone.width/100 · vp.width), vp.height / (zone.height/100 · vp.height))` = `min(100/zone.width, 100/zone.height)`.
2. `scale = min(maxScale, fitScale)` — if the zone fits below the cap, use the smaller scale (no letterboxing).
3. Center: place the zone center at the viewport center. `cx = (zone.x + zone.width/2)/100 · vp.width`; `panX = vp.width/2 − cx·scale`; same for Y.
4. Clamp pan so the scaled image still covers the viewport (no empty gutters): scaled image width = `vp.width·scale ≥ vp.width`, so `panX ∈ [vp.width − vp.width·scale, 0]`, i.e. `panX = clamp(panX, vp.width·(1−scale), 0)`. Same for Y. Clamping runs after centering.

- [ ] **Write the failing test.** Create `/Users/matej/Work/Matej/ha-apartment-view-card/test/geometry.zoom-to-zone.test.ts` with full content:

```ts
import { describe, it, expect } from 'vitest';
import { zoomToZone } from '../src/core/geometry';
import type { Viewport } from '../src/core/geometry';
import type { ZoneConfig } from '../src/core/config';

const vp: Viewport = { width: 1000, height: 800 };

function zone(partial: Partial<ZoneConfig>): ZoneConfig {
  return { name: 'z', x: 0, y: 0, width: 50, height: 50, ...partial };
}

describe('zoomToZone', () => {
  it('uses the zone-fit scale when it is below the cap (no letterboxing)', () => {
    // 50%-wide / 50%-tall zone fits at scale 2 (100/50); cap is higher.
    const t = zoomToZone(zone({ width: 50, height: 50 }), vp, 3);
    expect(t.scale).toBeCloseTo(2, 6);
  });

  it('takes the limiting (larger) percent dimension for fit scale', () => {
    // width 50 -> 2x, height 25 -> 4x; fit = min(2,4) = 2 (width-limited).
    const t = zoomToZone(zone({ width: 50, height: 25 }), vp, 10);
    expect(t.scale).toBeCloseTo(2, 6);
  });

  it('clamps scale to maxScale when the zone would zoom in further', () => {
    // 10% zone wants 10x; cap at 1.5.
    const t = zoomToZone(zone({ x: 45, y: 45, width: 10, height: 10 }), vp, 1.5);
    expect(t.scale).toBeCloseTo(1.5, 6);
  });

  it('centers the zone center in the viewport when away from edges', () => {
    // Zone center at 50%,50% => image px (500,400). At scale 1.5 the pan that
    // centers it is 500 - 500*1.5 = -250 (x), 400 - 400*1.5 = -200 (y), both
    // within clamp range [1000*(1-1.5),0]=[-500,0] and [800*(-0.5),0]=[-400,0].
    const t = zoomToZone(zone({ x: 40, y: 40, width: 20, height: 20 }), vp, 1.5);
    expect(t.scale).toBeCloseTo(1.5, 6);
    expect(t.panX).toBeCloseTo(-250, 6);
    expect(t.panY).toBeCloseTo(-200, 6);
  });

  it('clamps pan to keep the scaled image covering the viewport (top-left zone)', () => {
    // Zone hugging top-left; centering would push pan positive (gutter on left),
    // clamp to 0.
    const t = zoomToZone(zone({ x: 0, y: 0, width: 20, height: 20 }), vp, 1.5);
    expect(t.scale).toBeCloseTo(1.5, 6);
    expect(t.panX).toBeCloseTo(0, 6);
    expect(t.panY).toBeCloseTo(0, 6);
  });

  it('clamps pan to keep the scaled image covering the viewport (bottom-right zone)', () => {
    // Zone hugging bottom-right; centering would expose right/bottom gutter,
    // clamp to the minimum pan = vp * (1 - scale).
    const t = zoomToZone(zone({ x: 80, y: 80, width: 20, height: 20 }), vp, 1.5);
    expect(t.panX).toBeCloseTo(1000 * (1 - 1.5), 6); // -500
    expect(t.panY).toBeCloseTo(800 * (1 - 1.5), 6); // -400
  });

  it('at scale 1 (zone fills image) pan is exactly 0', () => {
    const t = zoomToZone(zone({ x: 0, y: 0, width: 100, height: 100 }), vp, 1.5);
    expect(t.scale).toBeCloseTo(1, 6);
    expect(t.panX).toBeCloseTo(0, 6);
    expect(t.panY).toBeCloseTo(0, 6);
  });
});
```

- [ ] **Run & expect fail.** `npx vitest run test/geometry.zoom-to-zone.test.ts -t "zoomToZone"`. Expect failure: `No "zoomToZone" export is defined on the "../src/core/geometry"` (or a TypeScript error that `zoomToZone` does not exist). If `Viewport`/`ZoomTransform` are also missing, you will see export errors for those too — the next step adds them.

- [ ] **Implement.** In `/Users/matej/Work/Matej/ha-apartment-view-card/src/core/geometry.ts`, ensure these exports exist (add `Viewport`/`ZoomTransform` only if not already present from Phase 3 — do not duplicate), and add `zoomToZone`. Add this import at the top if not present: `import type { ZoneConfig } from './config';`. Append:

```ts
// If not already declared earlier in this file (Phase 3), add:
// export interface Viewport { width: number; height: number; }
// export interface ZoomTransform { scale: number; panX: number; panY: number; }

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

export function zoomToZone(
  zone: ZoneConfig,
  vp: Viewport,
  maxScale: number,
): ZoomTransform {
  // Fit scale: largest zoom that still shows the whole zone. The wider/taller
  // (in %) dimension limits the zoom; percent-based so viewport aspect cancels.
  const fitScale = Math.min(100 / zone.width, 100 / zone.height);
  const scale = Math.min(maxScale, fitScale);

  // Center the zone center at the viewport center.
  const cx = ((zone.x + zone.width / 2) / 100) * vp.width;
  const cy = ((zone.y + zone.height / 2) / 100) * vp.height;
  let panX = vp.width / 2 - cx * scale;
  let panY = vp.height / 2 - cy * scale;

  // Clamp so the scaled image still covers the viewport (no gutters).
  panX = clamp(panX, vp.width * (1 - scale), 0);
  panY = clamp(panY, vp.height * (1 - scale), 0);

  return { scale, panX, panY };
}
```

- [ ] **Run & expect pass.** `npx vitest run test/geometry.zoom-to-zone.test.ts -t "zoomToZone"`. Expect all 7 assertions green.

- [ ] **Commit.** `git add src/core/geometry.ts test/geometry.zoom-to-zone.test.ts && git commit -m "feat(geometry): zoomToZone fit-below-cap, center, clamp to bounds"`

---

### Task 5.2: Zone focus selector — `zoneForFocus` + per-entity dim map

**Files:**
- Create: `/Users/matej/Work/Matej/ha-apartment-view-card/src/render/zone-focus.ts`
- Test: `/Users/matej/Work/Matej/ha-apartment-view-card/test/zone-focus.test.ts`

**Interfaces:**
- Consumes: `EntityConfig`, `ZoneConfig` (from `core/config.ts`), `zoneForPoint` (from `core/config.ts`).
- Produces:
  - `function entityInFocusedZone(entity: EntityConfig, focused: ZoneConfig | null, zones: ZoneConfig[]): boolean`
  - `function focusOpacityFor(entity: EntityConfig, focused: ZoneConfig | null, zones: ZoneConfig[]): number`

**Rules (locked from §2/§5):** When no zone is focused (`focused === null`), every entity is fully visible (`opacity 1`). When a zone is focused, an entity is "in focus" iff its membership zone — `zoneForPoint(entity.x, entity.y, zones)` (smallest-area containing zone) — is reference-equal to `focused`. In-focus entities get opacity `1`; all others (including entities in zero zones) dim to `0.25`. An entity in zero zones is therefore **not** in focus and dims when any zone is focused — but is **never** dimmed in overview. We dim by membership (`zoneForPoint`), not by raw rectangle containment, so an entity sitting in an overlapping outer zone but belonging (by smallest area) to an inner zone is treated as a member of the inner zone only.

- [ ] **Write the failing test.** Create `/Users/matej/Work/Matej/ha-apartment-view-card/test/zone-focus.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { entityInFocusedZone, focusOpacityFor } from '../src/render/zone-focus';
import type { EntityConfig, ZoneConfig } from '../src/core/config';

function ent(x: number, y: number): EntityConfig {
  return {
    entity: 'light.test',
    x,
    y,
    size: 'small',
    tap: 'toggle',
    orientation: null,
  };
}

// living (big) fully contains study (small, inner). Point (55,55) is inside both;
// smallest-area = study, so its membership is study.
const living: ZoneConfig = { name: 'living', x: 40, y: 40, width: 50, height: 50 };
const study: ZoneConfig = { name: 'study', x: 50, y: 50, width: 15, height: 15 };
const kitchen: ZoneConfig = { name: 'kitchen', x: 0, y: 0, width: 30, height: 30 };
const zones = [living, study, kitchen];

describe('entityInFocusedZone', () => {
  it('is true for any entity when no zone is focused', () => {
    expect(entityInFocusedZone(ent(55, 55), null, zones)).toBe(true);
    expect(entityInFocusedZone(ent(95, 95), null, zones)).toBe(true);
  });

  it('matches on smallest-area membership, not raw containment', () => {
    // (55,55) is in living AND study; membership is study (smaller area).
    expect(entityInFocusedZone(ent(55, 55), study, zones)).toBe(true);
    expect(entityInFocusedZone(ent(55, 55), living, zones)).toBe(false);
  });

  it('matches living for a point only inside living', () => {
    // (43,80) inside living (40..90 x, 40..90 y) but not study.
    expect(entityInFocusedZone(ent(43, 80), living, zones)).toBe(true);
    expect(entityInFocusedZone(ent(43, 80), study, zones)).toBe(false);
  });

  it('is false for an entity in zero zones when a zone is focused', () => {
    expect(entityInFocusedZone(ent(98, 5), kitchen, zones)).toBe(false);
  });
});

describe('focusOpacityFor', () => {
  it('returns 1 for all entities in overview (no focus)', () => {
    expect(focusOpacityFor(ent(98, 5), null, zones)).toBe(1);
    expect(focusOpacityFor(ent(55, 55), null, zones)).toBe(1);
  });

  it('returns 1 for in-focus entities and 0.25 for others', () => {
    expect(focusOpacityFor(ent(55, 55), study, zones)).toBe(1);
    expect(focusOpacityFor(ent(43, 80), study, zones)).toBe(0.25); // in living, not study
    expect(focusOpacityFor(ent(98, 5), study, zones)).toBe(0.25); // no membership
  });
});
```

- [ ] **Run & expect fail.** `npx vitest run test/zone-focus.test.ts -t "focusOpacityFor"`. Expect failure: `Failed to resolve import "../src/render/zone-focus"` (file does not exist yet).

- [ ] **Implement.** Create `/Users/matej/Work/Matej/ha-apartment-view-card/src/render/zone-focus.ts`:

```ts
import type { EntityConfig, ZoneConfig } from '../core/config';
import { zoneForPoint } from '../core/config';

/** Opacity applied to non-focused markers (spec §5: dim to 25%). */
export const FOCUS_DIM_OPACITY = 0.25;

/**
 * True when the entity's membership zone (smallest-area containing zone) is the
 * focused zone. In overview (focused === null) every entity is "in focus".
 */
export function entityInFocusedZone(
  entity: EntityConfig,
  focused: ZoneConfig | null,
  zones: ZoneConfig[],
): boolean {
  if (focused === null) return true;
  return zoneForPoint(entity.x, entity.y, zones) === focused;
}

/**
 * Marker opacity under focus: 1 in overview, 1 for in-focus entities when a zone
 * is focused, FOCUS_DIM_OPACITY for everything else (including zero-membership).
 */
export function focusOpacityFor(
  entity: EntityConfig,
  focused: ZoneConfig | null,
  zones: ZoneConfig[],
): number {
  if (focused === null) return 1;
  return entityInFocusedZone(entity, focused, zones) ? 1 : FOCUS_DIM_OPACITY;
}
```

- [ ] **Run & expect pass.** `npx vitest run test/zone-focus.test.ts`. Expect all assertions green.

- [ ] **Commit.** `git add src/render/zone-focus.ts test/zone-focus.test.ts && git commit -m "feat(zones): focus membership + dim-to-0.25 opacity selectors"`

---

### Task 5.3: `zone-controls.ts` — render model (chips, Back-to-All when zoomed, no Overview)

**Files:**
- Create: `/Users/matej/Work/Matej/ha-apartment-view-card/src/render/zone-controls.ts`
- Test: `/Users/matej/Work/Matej/ha-apartment-view-card/test/zone-controls.test.ts`

**Interfaces:**
- Consumes: `ZoneConfig` (from `core/config.ts`).
- Produces:
  - `interface ZoneChip { kind: 'back' | 'zone'; label: string; icon: string; zone: ZoneConfig | null; index: number; }`
  - `function buildZoneChips(zones: ZoneConfig[], focused: ZoneConfig | null): ZoneChip[]`
  - `const BACK_TO_ALL_LABEL: string` (= `'← Back to All'`)
  - `const ZONE_DEFAULT_ICON: string` (= `'mdi:select-marker'`)

**Rules (locked from §5):** Chips render as a horizontal list. In **overview** (`focused === null`) there is exactly one chip per zone, in config order, each labeled with the zone name and its `icon` (or `ZONE_DEFAULT_ICON` when `icon` is unset/empty). There is **no "Overview" chip** in overview. When **zoomed** (`focused !== null`) a **"← Back to All"** chip is prepended as the first list item (`kind: 'back'`, `zone: null`, `icon: 'mdi:arrow-left'`), followed by the zone chips in config order. `index` is the chip's position in the returned array (back chip = 0 when present). This task produces only the data model; the LitElement template and styling are wired in Task 5.5.

- [ ] **Write the failing test.** Create `/Users/matej/Work/Matej/ha-apartment-view-card/test/zone-controls.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  buildZoneChips,
  BACK_TO_ALL_LABEL,
  ZONE_DEFAULT_ICON,
} from '../src/render/zone-controls';
import type { ZoneConfig } from '../src/core/config';

const living: ZoneConfig = { name: 'Living', icon: 'mdi:sofa', x: 0, y: 0, width: 50, height: 50 };
const bath: ZoneConfig = { name: 'Bath', x: 60, y: 0, width: 20, height: 20 }; // no icon
const zones = [living, bath];

describe('buildZoneChips', () => {
  it('overview: one chip per zone, in order, no Overview chip, no Back chip', () => {
    const chips = buildZoneChips(zones, null);
    expect(chips.map((c) => c.kind)).toEqual(['zone', 'zone']);
    expect(chips.map((c) => c.label)).toEqual(['Living', 'Bath']);
    expect(chips[0].zone).toBe(living);
    expect(chips[1].zone).toBe(bath);
    expect(chips.map((c) => c.index)).toEqual([0, 1]);
  });

  it('overview: falls back to ZONE_DEFAULT_ICON when a zone has no icon', () => {
    const chips = buildZoneChips(zones, null);
    expect(chips[0].icon).toBe('mdi:sofa');
    expect(chips[1].icon).toBe(ZONE_DEFAULT_ICON);
  });

  it('zoomed: prepends a Back-to-All chip as index 0, then zones', () => {
    const chips = buildZoneChips(zones, living);
    expect(chips[0].kind).toBe('back');
    expect(chips[0].label).toBe(BACK_TO_ALL_LABEL);
    expect(chips[0].icon).toBe('mdi:arrow-left');
    expect(chips[0].zone).toBeNull();
    expect(chips[0].index).toBe(0);
    expect(chips.slice(1).map((c) => c.label)).toEqual(['Living', 'Bath']);
    expect(chips.slice(1).map((c) => c.index)).toEqual([1, 2]);
  });

  it('zoomed: still includes the focused zone chip (re-tap is a no-op upstream)', () => {
    const chips = buildZoneChips(zones, living);
    expect(chips.find((c) => c.zone === living)).toBeTruthy();
  });

  it('empty zones, overview: produces no chips', () => {
    expect(buildZoneChips([], null)).toEqual([]);
  });
});
```

- [ ] **Run & expect fail.** `npx vitest run test/zone-controls.test.ts -t "buildZoneChips"`. Expect failure: `Failed to resolve import "../src/render/zone-controls"`.

- [ ] **Implement.** Create `/Users/matej/Work/Matej/ha-apartment-view-card/src/render/zone-controls.ts`:

```ts
import type { ZoneConfig } from '../core/config';

export const BACK_TO_ALL_LABEL = '← Back to All';
export const ZONE_DEFAULT_ICON = 'mdi:select-marker';
export const BACK_CHIP_ICON = 'mdi:arrow-left';

export interface ZoneChip {
  kind: 'back' | 'zone';
  label: string;
  icon: string;
  zone: ZoneConfig | null;
  index: number;
}

/**
 * Horizontal zone-control model (spec §5).
 *  - overview (focused === null): one chip per zone in config order, no Overview chip.
 *  - zoomed (focused !== null): a "← Back to All" chip first, then the zone chips.
 * `index` is the position in the returned array.
 */
export function buildZoneChips(
  zones: ZoneConfig[],
  focused: ZoneConfig | null,
): ZoneChip[] {
  const chips: ZoneChip[] = [];

  if (focused !== null) {
    chips.push({
      kind: 'back',
      label: BACK_TO_ALL_LABEL,
      icon: BACK_CHIP_ICON,
      zone: null,
      index: 0,
    });
  }

  for (const zone of zones) {
    chips.push({
      kind: 'zone',
      label: zone.name,
      icon: zone.icon && zone.icon.length > 0 ? zone.icon : ZONE_DEFAULT_ICON,
      zone,
      index: chips.length,
    });
  }

  return chips;
}
```

- [ ] **Run & expect pass.** `npx vitest run test/zone-controls.test.ts`. Expect all assertions green.

- [ ] **Commit.** `git add src/render/zone-controls.ts test/zone-controls.test.ts && git commit -m "feat(zones): zone-controls chip model with Back-to-All, no Overview"`

---

### Task 5.4: Zone-box edit-mode visibility predicate + edit-mode flag plumbing

**Files:**
- Modify: `/Users/matej/Work/Matej/ha-apartment-view-card/src/render/zone-controls.ts`
- Test: `/Users/matej/Work/Matej/ha-apartment-view-card/test/zone-box-visibility.test.ts`

**Interfaces:**
- Consumes: none new.
- Produces: `function showZoneBoxes(editMode: boolean): boolean` (zone definition rectangles render on the scene **only** in editor edit mode — §5: "not drawn on the render in normal view — only as dashed outlines in editor edit mode").

This is a one-line predicate, but it locks the single source of truth the orchestrator (Task 5.5) and the editor preview (Phase 6) both call, preventing zone boxes from ever leaking into the live card. The orchestrator passes `editMode = false` always (the card never edits); only the Phase 6 editor preview passes `true`.

- [ ] **Write the failing test.** Create `/Users/matej/Work/Matej/ha-apartment-view-card/test/zone-box-visibility.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { showZoneBoxes } from '../src/render/zone-controls';

describe('showZoneBoxes', () => {
  it('hides zone boxes in the live card (not edit mode)', () => {
    expect(showZoneBoxes(false)).toBe(false);
  });
  it('shows zone boxes only in editor edit mode', () => {
    expect(showZoneBoxes(true)).toBe(true);
  });
});
```

- [ ] **Run & expect fail.** `npx vitest run test/zone-box-visibility.test.ts -t "showZoneBoxes"`. Expect failure: `No "showZoneBoxes" export is defined on the "../src/render/zone-controls"`.

- [ ] **Implement.** Append to `/Users/matej/Work/Matej/ha-apartment-view-card/src/render/zone-controls.ts`:

```ts
/**
 * Zone definition rectangles render on the scene ONLY in editor edit mode
 * (spec §5). The live card always passes `false` (so it never renders zone
 * boxes — the predicate's only true caller is the Phase 6 editor preview,
 * which passes `editMode === true`).
 */
export function showZoneBoxes(editMode: boolean): boolean {
  return editMode;
}
```

- [ ] **Run & expect pass.** `npx vitest run test/zone-box-visibility.test.ts -t "showZoneBoxes"`. Expect both green.

- [ ] **Commit.** `git add src/render/zone-controls.ts test/zone-box-visibility.test.ts && git commit -m "feat(zones): showZoneBoxes edit-mode-only visibility predicate"`

---

### Task 5.5: Wire zone-controls + focus + synced 0.6s animation + Escape into the card

**Files:**
- Modify: `/Users/matej/Work/Matej/ha-apartment-view-card/src/apartment-view-card.ts`
- Test: `/Users/matej/Work/Matej/ha-apartment-view-card/test/apartment-view-card.zone-focus.test.ts`

**Interfaces:**
- Consumes: `zoomToZone`, `Viewport`, `ZoomTransform` (from `core/geometry.ts`); `buildZoneChips`, `ZoneChip` (from `render/zone-controls.ts`); `entityInFocusedZone` (from `render/zone-focus.ts`); `ZoneConfig`, `ApartmentViewConfig` (from `core/config.ts`).
- Produces (private members on `ApartmentViewCard`, names locked so later phases/tests reference them): `@state private _focusedZone: ZoneConfig | null`, `private _focusZone(zone: ZoneConfig): void`, `private _exitFocus(): void`, `private _onZoneChip(chip: ZoneChip): void`, the CSS class `is-focused` on `:host`, and the constant `private static readonly ZOOM_TRANSITION = 'transform 0.6s cubic-bezier(.4,0,.2,1)'`.

**Behavior contract (locked, from §5 / §6):**
- `_focusedZone` defaults to `null` (overview). Tapping a zone chip (`_onZoneChip` with `kind: 'zone'`) calls `_focusZone(zone)`: sets `_focusedZone = zone` and `_transform = zoomToZone(zone, this._viewport(), this.config.options.zoomMax)`. Tapping Back (`kind: 'back'`) or pressing `Escape` calls `_exitFocus()`: sets `_focusedZone = null` and `_transform = { scale: 1, panX: 0, panY: 0 }`.
- While focused (`_focusedZone !== null`), free pan/zoom is disabled — the existing Phase 3 wheel/pointer handlers must early-return when `this._focusedZone !== null`. (Add the guard; do not remove Phase 3 behavior.)
- Both the transformed scene layer and the non-transformed marker overlay apply `transition: ZOOM_TRANSITION` while a focus change is animating, so icons track the image in sync (§6). Apply it whenever `_focusedZone` transitions (entering or leaving focus); the simplest correct approach is to set the transition on both layers permanently for the `transform`/`left`/`top` properties — locked here as: scene gets `transition: transform 0.6s cubic-bezier(.4,0,.2,1)`, each marker gets `transition: left 0.6s cubic-bezier(.4,0,.2,1), top 0.6s cubic-bezier(.4,0,.2,1), transform 0.6s cubic-bezier(.4,0,.2,1)`.
- Marker dimming flows through the existing Phase 3 `focused` flag: build `focusedZoneEntityIds: Set<string> | null` (the entity ids whose membership zone is `this._focusedZone`, via the Task 5.2 `entityInFocusedZone` helper; `null` in overview) and pass it into `computeMarkerViews`. The overlay's `focused` flag then drives the 0.25 dim CSS — no separate per-marker inline opacity.
- Zone definition boxes are NOT rendered by the live card (the only true caller of `showZoneBoxes` is the Phase 6 editor preview). The card still renders the zone-controls list unconditionally below the scene.
- `_viewport()` returns the scene/`.wrapper` image-box size, i.e. `{ width, height }` where `width === this._cardWidth === scene image-box width` (the same width used by `markerScreenPos` and `renderLightLayer`); in the unit test it is stubbed.

**Test note:** Browser-mode component mounting of the full card with `hass` is exercised in Phase 7. Here we test the focus state machine and the transform it produces by driving the public-to-phase methods directly on an instance with a minimal injected config and a stubbed viewport — no DOM render required.

- [ ] **Write the failing test.** Create `/Users/matej/Work/Matej/ha-apartment-view-card/test/apartment-view-card.zone-focus.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import '../src/apartment-view-card';
import type { ApartmentViewCard } from '../src/apartment-view-card';
import type { ApartmentViewConfig, ZoneConfig } from '../src/core/config';

const living: ZoneConfig = { name: 'Living', x: 40, y: 40, width: 20, height: 20 };
const kitchen: ZoneConfig = { name: 'Kitchen', x: 0, y: 0, width: 30, height: 30 };

function makeConfig(): ApartmentViewConfig {
  return {
    type: 'custom:apartment-view-card',
    images: { base: '/x.png' },
    entities: [],
    zones: [living, kitchen],
    options: {
      view: 'auto',
      lightStyle: 'lit',
      freePanZoom: true,
      zoomMax: 1.5,
      duskDawnOffsetMinutes: 60,
    },
  };
}

function makeCard(): ApartmentViewCard {
  const el = document.createElement('apartment-view-card') as ApartmentViewCard;
  // Inject config + a deterministic viewport without a full HA mount.
  (el as any).config = makeConfig();
  (el as any)._viewport = () => ({ width: 1000, height: 800 });
  return el;
}

describe('ApartmentViewCard zone focus state machine', () => {
  let card: ApartmentViewCard;
  beforeEach(() => {
    card = makeCard();
  });

  it('starts in overview (no focused zone, identity transform)', () => {
    expect((card as any)._focusedZone).toBeNull();
  });

  it('_focusZone sets the focused zone and a zoomToZone transform', () => {
    (card as any)._focusZone(living);
    expect((card as any)._focusedZone).toBe(living);
    // 20% zone -> fit 5x, capped at zoomMax 1.5.
    expect((card as any)._transform.scale).toBeCloseTo(1.5, 6);
    // center 50%,50% => px (500,400); pan -250,-200 within clamp [-500,0]/[-400,0].
    expect((card as any)._transform.panX).toBeCloseTo(-250, 6);
    expect((card as any)._transform.panY).toBeCloseTo(-200, 6);
  });

  it('_exitFocus returns to overview with identity transform', () => {
    (card as any)._focusZone(living);
    (card as any)._exitFocus();
    expect((card as any)._focusedZone).toBeNull();
    expect((card as any)._transform).toEqual({ scale: 1, panX: 0, panY: 0 });
  });

  it('_onZoneChip routes a zone chip to focus and a back chip to exit', () => {
    (card as any)._onZoneChip({ kind: 'zone', label: 'Living', icon: '', zone: living, index: 0 });
    expect((card as any)._focusedZone).toBe(living);
    (card as any)._onZoneChip({ kind: 'back', label: '← Back to All', icon: '', zone: null, index: 0 });
    expect((card as any)._focusedZone).toBeNull();
  });

  it('Escape exits focus', () => {
    (card as any)._focusZone(living);
    (card as any)._handleKeyDown(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect((card as any)._focusedZone).toBeNull();
  });

  it('free pan/zoom is suppressed while focused', () => {
    (card as any)._focusZone(living);
    const before = { ...(card as any)._transform };
    // Wheel must not mutate transform while focused.
    (card as any)._onWheel(new WheelEvent('wheel', { deltaY: -100 }));
    expect((card as any)._transform).toEqual(before);
  });
});
```

- [ ] **Run & expect fail.** `npx vitest run test/apartment-view-card.zone-focus.test.ts -t "zone focus state machine"`. Expect failure — either the element does not yet expose `_focusedZone`/`_focusZone`/`_onZoneChip`/`_exitFocus`/`_handleKeyDown` (assertions read `undefined` / call a non-function), or a resolve error if `apartment-view-card.ts` does not yet exist. (If the orchestrator file does not exist from Phase 1/3 in your tree, stop and confirm Phase 3 landed before continuing — Phase 5 extends it, it does not create it.)

- [ ] **Implement — add focus state + methods.** In `/Users/matej/Work/Matej/ha-apartment-view-card/src/apartment-view-card.ts`, add imports at the top (merge with existing import lines; do not duplicate the lit/decorator imports already present):

```ts
import { zoomToZone } from './core/geometry';
import type { Viewport } from './core/geometry';
import type { ZoneConfig } from './core/config';
import { buildZoneChips } from './render/zone-controls';
import type { ZoneChip } from './render/zone-controls';
import { entityInFocusedZone } from './render/zone-focus';
```

Inside the `ApartmentViewCard` class, add the state field and constant (place near the other `@state` fields and the existing `_transform` state):

```ts
  private static readonly ZOOM_TRANSITION =
    'transform 0.6s cubic-bezier(.4,0,.2,1)';

  @state() private _focusedZone: ZoneConfig | null = null;
```

Add the methods (place with the other private handlers):

```ts
  /**
   * Viewport (CSS px) of the SCENE/`.wrapper` image box — NOT the host. Its
   * `width` MUST equal `this._cardWidth` (the same width threaded to
   * `markerScreenPos` and `renderLightLayer`) so `zoomToZone`'s clamp and the
   * marker mapping agree on one image-box width. Overridable in tests.
   */
  private _viewport(): Viewport {
    const wrapper = this.renderRoot?.querySelector('.wrapper') as HTMLElement | null;
    const r = wrapper?.getBoundingClientRect();
    return { width: r?.width ?? this._cardWidth, height: r?.height ?? 0 };
  }

  private _focusZone(zone: ZoneConfig): void {
    this._focusedZone = zone;
    this._transform = zoomToZone(
      zone,
      this._viewport(),
      this.config.options.zoomMax,
    );
  }

  private _exitFocus(): void {
    this._focusedZone = null;
    this._transform = { scale: 1, panX: 0, panY: 0 };
  }

  private _onZoneChip(chip: ZoneChip): void {
    if (chip.kind === 'back') {
      this._exitFocus();
      return;
    }
    if (chip.zone) {
      // Re-tapping the already-focused zone is a no-op (idempotent re-zoom is fine).
      this._focusZone(chip.zone);
    }
  }

  private _handleKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && this._focusedZone !== null) {
      e.preventDefault();
      this._exitFocus();
    }
  };
```

- [ ] **Implement — register/unregister the Escape listener.** In the existing `connectedCallback()` add (alongside the Phase 3 listeners): `window.addEventListener('keydown', this._handleKeyDown);` and in `disconnectedCallback()` add `window.removeEventListener('keydown', this._handleKeyDown);`. Set `tabindex="0"` on the host so back-button/keyboard focus works: in `connectedCallback()` add `if (!this.hasAttribute('tabindex')) this.setAttribute('tabindex', '0');`.

- [ ] **Implement — guard free pan/zoom while focused.** At the very top of the Phase 3 `_onWheel`, `_onScenePointerDown`, `_onMarkerPointerDown`, `_onWindowPointerMove`, and `_onWindowPointerUp` handlers, add an early return so focus locks the view:

```ts
    if (this._focusedZone !== null) return;
```

(Keep the existing `e.preventDefault()` for wheel only if it currently runs before state mutation — move the guard to be the first statement of each handler so a focused card never pans/zooms.)

- [ ] **Run & expect pass (state machine).** `npx vitest run test/apartment-view-card.zone-focus.test.ts -t "zone focus state machine"`. Expect all 6 assertions green.

- [ ] **Implement — render the zone-controls list, synced animation, and focus dimming.** In `render()`:
  - Add `transition: ${ApartmentViewCard.ZOOM_TRANSITION}` to the scene layer's inline style (the element with `transform-origin: 0 0` that already applies `translate(${this._transform.panX}px, ${this._transform.panY}px) scale(${this._transform.scale})`).
  - Drive marker dimming through `computeMarkerViews`: build `focusedZoneEntityIds` and pass it in, so the overlay's existing Phase 3 `focused` flag renders out-of-zone markers at 0.25:

```ts
    const focusedZoneEntityIds =
      this._focusedZone === null
        ? null
        : new Set(
            this.config.entities
              .filter((e) =>
                entityInFocusedZone(e, this._focusedZone, this.config.zones),
              )
              .map((e) => e.entity),
          );
    // ...computeMarkerViews(this.config.entities, this.hass?.states ?? {}, this._transform, vp, focusedZoneEntityIds)
```

    Keep the per-marker `transition: left 0.6s cubic-bezier(.4,0,.2,1), top 0.6s cubic-bezier(.4,0,.2,1), transform 0.6s cubic-bezier(.4,0,.2,1)` in `marker-overlay.ts` (the `focused` flag already maps to the 0.25 dim CSS — do NOT add a separate inline opacity here).
  - Reflect focus on the host for styling hooks: add `class=${classMap({ 'is-focused': this._focusedZone !== null })}` to the top-level wrapper (import `classMap` from `lit/directives/class-map.js`).
  - Do NOT render scene zone boxes in the live card (the `showZoneBoxes` predicate's only true caller is the Phase 6 editor preview, where `editMode === true`). Omit the dead `showZoneBoxes(false)` branch entirely.
  - Render the horizontal controls list **below** the scene:

```ts
    <div class="zone-controls" role="toolbar" aria-label="Zones">
      ${buildZoneChips(this.config.zones, this._focusedZone).map(
        (chip) => html`
          <button
            class="zone-chip ${chip.kind === 'back' ? 'zone-chip--back' : ''}"
            @click=${() => this._onZoneChip(chip)}
          >
            <ha-icon .icon=${chip.icon}></ha-icon>
            <span>${chip.label}</span>
          </button>
        `,
      )}
    </div>
```

- [ ] **Implement — add zone-controls + focus styles.** Append to the static `css`:

```css
    .zone-controls {
      display: flex;
      flex-direction: row;
      gap: 8px;
      overflow-x: auto;
      padding: 8px;
      scrollbar-width: thin;
    }
    .zone-chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      flex: 0 0 auto;
      padding: 6px 12px;
      border: none;
      border-radius: 16px;
      background: var(--secondary-background-color);
      color: var(--primary-text-color);
      cursor: pointer;
      white-space: nowrap;
      font: inherit;
    }
    .zone-chip:hover {
      background: var(--primary-color);
      color: var(--text-primary-color);
    }
    .zone-chip--back {
      background: var(--primary-color);
      color: var(--text-primary-color);
    }
    .zone-chip ha-icon {
      --mdc-icon-size: 18px;
    }
    :host(.is-focused) .wrapper {
      /* free pan/zoom is suppressed in JS; this is a styling hook only */
    }
```

- [ ] **Run & expect pass (full file).** `npx vitest run test/apartment-view-card.zone-focus.test.ts`. Expect all assertions green. Then run the full suite to confirm no regression: `npx vitest run`. Expect every prior test (geometry, zone-focus, zone-controls, zone-box-visibility, plus earlier phases) green.

- [ ] **Manual harness check (no test, fast visual confirm).** Start the dev harness: `npm run dev`. In the browser, confirm: zone chips appear below the card; tapping a chip animates image + icons together over ~0.6s; non-zone icons dim to 25%; a "← Back to All" chip appears only while zoomed; pressing `Escape` returns to overview; no dashed zone boxes are visible in the live card; wheel/drag do nothing while focused.

- [ ] **Commit.** `git add src/apartment-view-card.ts test/apartment-view-card.zone-focus.test.ts && git commit -m "feat(card): zone focus — tap-to-zoom, 0.6s synced animation, dim, Escape/Back-to-All exit"`

---

### Task 5.6: Migration note — v1 zoom/pan superseded by zone focus

**Files:**
- Modify: `/Users/matej/Work/Matej/ha-apartment-view-card/src/apartment-view-card.ts` (doc comment only)

**Interfaces:** Consumes: none. Produces: none (documentation).

Document the migration so the v1 ad-hoc `_scale`/`_position` model (in `src/ApartmentViewCard.ts` lines 44–48, 179–224, clamped `0.5..3`, mouse-anchored wheel zoom, no zone awareness) is unambiguously superseded by the Phase 3 `ZoomTransform` + Phase 5 zone-focus model. No tests; this is a 2-minute doc step folded here so the rewrite's intent is captured at the call site.

- [ ] **Add the doc comment.** At the top of the `ApartmentViewCard` class body in `src/apartment-view-card.ts`, add:

```ts
  // MIGRATION (v1 -> v2): v1 used ad-hoc `_scale` (clamped 0.5..3) + `_position`
  // with mouse-anchored wheel zoom and no zone awareness (old src/ApartmentViewCard.ts).
  // v2 unifies this into a single `_transform: ZoomTransform`. Free pan/zoom (Phase 3)
  // drives `_transform` directly; zone focus (Phase 5) drives it via geometry.zoomToZone
  // and disables free pan/zoom while `_focusedZone !== null`. Legacy keys (offsetX/Y,
  // columns/rows) are normalized/preserved in core/config.ts, not handled here.
```

- [ ] **Verify build still typechecks.** `npx tsc --noEmit`. Expect no errors. (If `tsc` script is not configured, use `npx vitest run` as the green gate from Task 5.5.)

- [ ] **Commit.** `git add src/apartment-view-card.ts && git commit -m "docs(card): note v1 zoom/pan superseded by ZoomTransform + zone focus"`

## Phase 6: Visual editor (ha-form + live preview + zone draw)

This phase builds the from-scratch visual editor (v1's editor is a non-functional stub). It produces `src/editor/apartment-view-card-editor.ts` (ha-form sections for images+options, an entities list, and a zones list, all using idiomatic HA selectors with the entity selector NOT domain-limited), `src/editor/preview-canvas.ts` (a live preview with draggable markers bidirectionally bound to X/Y sliders plus crosshair zone drawing), and wires `getConfigElement`/`getStubConfig` onto the card. All config mutations are emitted via `fireEvent(this, 'config-changed', { config })`.

Phase boundary assumptions (produced by earlier phases, consumed here):
- `src/core/config.ts` exports the CONTRACT types (`EntityConfig`, `ZoneConfig`, `ImagesConfig`, `CardOptions`, `ApartmentViewConfig`, `LightStyle`, `SizeTier`, `TapAction`) and `normalizeConfig(raw)`.
- `src/apartment-view-card.ts` is the registered card element (`apartment-view-card`).
- Vitest browser-mode (Playwright provider) is configured; tests live in `test/`.
- `fireEvent` is available from `custom-card-helpers`.

A small editor-local helper module (`src/editor/editor-helpers.ts`) is introduced in Task 6.1 to hold pure functions that are unit-testable without rendering a Lit component (default factories + the schema builders). This keeps every later task TDD-able against pure functions.

---

### Task 6.1: Editor pure helpers — default factories + ha-form schema builders
**Files:**
- Create: `src/editor/editor-helpers.ts`
- Test: `test/editor-helpers.test.ts`

**Interfaces:**
Consumes: `EntityConfig`, `ZoneConfig`, `ImagesConfig`, `CardOptions`, `LightStyle`, `SizeTier`, `TapAction` (from `src/core/config.ts`).
Produces:
- `function defaultEntity(): EntityConfig` — `{ entity: '', x: 50, y: 50, size: 'small', tap: 'toggle', orientation: null }`
- `function defaultZone(): ZoneConfig` — `{ name: 'New zone', x: 25, y: 25, width: 50, height: 50 }`
- `interface HaFormSchema { name: string; selector?: any; type?: string; required?: boolean; default?: any; }` (loose structural type used only by the editor)
- `function imagesOptionsSchema(): HaFormSchema[]`
- `function entitySchema(directional: boolean): HaFormSchema[]` — when `directional` is false the `orientation` slider is omitted; the `entity` selector is NOT domain-limited.
- `function zoneSchema(): HaFormSchema[]`
- `function isDirectional(orientation: number | null | undefined): boolean` — `typeof orientation === 'number'`

Steps:

- [ ] Write the failing test file `test/editor-helpers.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import {
  defaultEntity,
  defaultZone,
  imagesOptionsSchema,
  entitySchema,
  zoneSchema,
  isDirectional,
} from '../src/editor/editor-helpers';

describe('defaultEntity', () => {
  it('matches the EntityConfig contract defaults', () => {
    expect(defaultEntity()).toEqual({
      entity: '',
      x: 50,
      y: 50,
      size: 'small',
      tap: 'toggle',
      orientation: null,
    });
  });
  it('returns a fresh object each call (no shared reference)', () => {
    expect(defaultEntity()).not.toBe(defaultEntity());
  });
});

describe('defaultZone', () => {
  it('matches the ZoneConfig contract defaults', () => {
    expect(defaultZone()).toEqual({
      name: 'New zone',
      x: 25,
      y: 25,
      width: 50,
      height: 50,
    });
  });
});

describe('isDirectional', () => {
  it('is true only for a numeric orientation', () => {
    expect(isDirectional(0)).toBe(true);
    expect(isDirectional(180)).toBe(true);
    expect(isDirectional(null)).toBe(false);
    expect(isDirectional(undefined)).toBe(false);
  });
});

describe('imagesOptionsSchema', () => {
  const schema = imagesOptionsSchema();
  const names = schema.map((s) => s.name);

  it('includes all image keys and all options keys', () => {
    expect(names).toEqual(
      expect.arrayContaining([
        'base',
        'allLights',
        'night',
        'duskDawn',
        'view',
        'lightStyle',
        'freePanZoom',
        'zoomMax',
        'duskDawnOffsetMinutes',
      ])
    );
  });

  it('marks only images.base as required', () => {
    expect(schema.find((s) => s.name === 'base')!.required).toBe(true);
    expect(schema.find((s) => s.name === 'allLights')!.required).toBeFalsy();
  });

  it('uses a select selector for view with the four TOD modes', () => {
    const view = schema.find((s) => s.name === 'view')!;
    const opts = view.selector.select.options.map((o: any) => o.value ?? o);
    expect(opts).toEqual(['auto', 'day', 'night', 'duskDawn']);
  });

  it('uses a slider number selector for zoomMax', () => {
    const zoomMax = schema.find((s) => s.name === 'zoomMax')!;
    expect(zoomMax.selector.number.mode).toBe('slider');
    expect(zoomMax.selector.number.min).toBe(1);
  });

  it('uses a boolean selector for freePanZoom', () => {
    const fpz = schema.find((s) => s.name === 'freePanZoom')!;
    expect(fpz.selector.boolean).toBeDefined();
  });
});

describe('entitySchema', () => {
  it('uses a non-domain-limited entity selector', () => {
    const entity = entitySchema(false).find((s) => s.name === 'entity')!;
    // selector.entity must be an empty object — NO domain key
    expect(entity.selector.entity).toEqual({});
  });

  it('uses an icon selector for icon', () => {
    const icon = entitySchema(false).find((s) => s.name === 'icon')!;
    expect(icon.selector.icon).toBeDefined();
  });

  it('uses slider number selectors clamped 0-100 for x and y', () => {
    const x = entitySchema(false).find((s) => s.name === 'x')!;
    expect(x.selector.number.mode).toBe('slider');
    expect(x.selector.number.min).toBe(0);
    expect(x.selector.number.max).toBe(100);
  });

  it('select selectors for size and tap carry the contract values', () => {
    const schema = entitySchema(false);
    const size = schema.find((s) => s.name === 'size')!;
    expect(size.selector.select.options.map((o: any) => o.value)).toEqual([
      'tiny',
      'small',
      'medium',
      'large',
      'huge',
    ]);
    const tap = schema.find((s) => s.name === 'tap')!;
    expect(tap.selector.select.options.map((o: any) => o.value)).toEqual([
      'toggle',
      'more-info',
      'none',
    ]);
  });

  it('always includes the directional boolean toggle', () => {
    expect(entitySchema(false).some((s) => s.name === 'directional')).toBe(true);
    expect(entitySchema(true).some((s) => s.name === 'directional')).toBe(true);
  });

  it('omits the orientation slider when not directional', () => {
    expect(entitySchema(false).some((s) => s.name === 'orientation')).toBe(false);
  });

  it('includes an orientation slider 0-359 when directional', () => {
    const orientation = entitySchema(true).find((s) => s.name === 'orientation')!;
    expect(orientation.selector.number.mode).toBe('slider');
    expect(orientation.selector.number.min).toBe(0);
    expect(orientation.selector.number.max).toBe(359);
  });
});

describe('zoneSchema', () => {
  it('has name (text), icon (icon selector), and slider x/y/width/height', () => {
    const schema = zoneSchema();
    const names = schema.map((s) => s.name);
    expect(names).toEqual(
      expect.arrayContaining(['name', 'icon', 'x', 'y', 'width', 'height'])
    );
    expect(schema.find((s) => s.name === 'icon')!.selector.icon).toBeDefined();
    expect(schema.find((s) => s.name === 'width')!.selector.number.mode).toBe(
      'slider'
    );
  });
});
```

- [ ] Run and expect fail:
```
npx vitest run test/editor-helpers.test.ts -t "defaultEntity"
```
Expected failure: `Failed to resolve import "../src/editor/editor-helpers"` (module does not exist yet).

- [ ] Create `src/editor/editor-helpers.ts` with the full implementation:
```ts
import type {
  CardOptions,
  EntityConfig,
  ImagesConfig,
  LightStyle,
  SizeTier,
  TapAction,
  ZoneConfig,
} from '../core/config';

/**
 * Loose structural type for a single ha-form schema row. ha-form accepts a much
 * wider shape; we only model the keys the editor sets.
 */
export interface HaFormSchema {
  name: string;
  selector?: any;
  type?: string;
  required?: boolean;
  default?: any;
}

export function defaultEntity(): EntityConfig {
  return {
    entity: '',
    x: 50,
    y: 50,
    size: 'small',
    tap: 'toggle',
    orientation: null,
  };
}

export function defaultZone(): ZoneConfig {
  return {
    name: 'New zone',
    x: 25,
    y: 25,
    width: 50,
    height: 50,
  };
}

export function isDirectional(
  orientation: number | null | undefined
): boolean {
  return typeof orientation === 'number';
}

const LIGHT_STYLE_OPTIONS: { value: LightStyle; label: string }[] = [
  { value: 'lit', label: 'Lit (render-free)' },
  { value: 'reveal', label: 'Reveal (needs all-lights)' },
  { value: 'glow', label: 'Glow (flat color)' },
];

const VIEW_OPTIONS: { value: CardOptions['view']; label: string }[] = [
  { value: 'auto', label: 'Auto (sun-based)' },
  { value: 'day', label: 'Day' },
  { value: 'night', label: 'Night' },
  { value: 'duskDawn', label: 'Dusk / Dawn' },
];

const SIZE_OPTIONS: { value: SizeTier; label: string }[] = [
  { value: 'tiny', label: 'Tiny' },
  { value: 'small', label: 'Small' },
  { value: 'medium', label: 'Medium' },
  { value: 'large', label: 'Large' },
  { value: 'huge', label: 'Huge' },
];

const TAP_OPTIONS: { value: TapAction; label: string }[] = [
  { value: 'toggle', label: 'Toggle' },
  { value: 'more-info', label: 'More info' },
  { value: 'none', label: 'None' },
];

export function imagesOptionsSchema(): HaFormSchema[] {
  return [
    { name: 'base', required: true, selector: { text: {} } },
    { name: 'allLights', selector: { text: {} } },
    { name: 'night', selector: { text: {} } },
    { name: 'duskDawn', selector: { text: {} } },
    {
      name: 'view',
      selector: { select: { mode: 'dropdown', options: VIEW_OPTIONS } },
    },
    {
      name: 'lightStyle',
      selector: { select: { mode: 'dropdown', options: LIGHT_STYLE_OPTIONS } },
    },
    { name: 'freePanZoom', selector: { boolean: {} } },
    {
      name: 'zoomMax',
      selector: { number: { min: 1, max: 5, step: 0.1, mode: 'slider' } },
    },
    {
      name: 'duskDawnOffsetMinutes',
      selector: {
        number: { min: 0, max: 180, step: 5, mode: 'slider', unit_of_measurement: 'min' },
      },
    },
  ];
}

export function entitySchema(directional: boolean): HaFormSchema[] {
  const schema: HaFormSchema[] = [
    // Entity selector is intentionally NOT domain-limited (spec §7).
    { name: 'entity', required: true, selector: { entity: {} } },
    { name: 'name', selector: { text: {} } },
    { name: 'icon', selector: { icon: {} } },
    {
      name: 'size',
      selector: { select: { mode: 'dropdown', options: SIZE_OPTIONS } },
    },
    {
      name: 'tap',
      selector: { select: { mode: 'dropdown', options: TAP_OPTIONS } },
    },
    {
      name: 'lightStyle',
      selector: { select: { mode: 'dropdown', options: LIGHT_STYLE_OPTIONS } },
    },
    {
      name: 'x',
      selector: { number: { min: 0, max: 100, step: 0.5, mode: 'slider' } },
    },
    {
      name: 'y',
      selector: { number: { min: 0, max: 100, step: 0.5, mode: 'slider' } },
    },
    { name: 'directional', selector: { boolean: {} } },
  ];
  if (directional) {
    schema.push({
      name: 'orientation',
      selector: {
        number: { min: 0, max: 359, step: 1, mode: 'slider', unit_of_measurement: '°' },
      },
    });
  }
  return schema;
}

export function zoneSchema(): HaFormSchema[] {
  return [
    { name: 'name', required: true, selector: { text: {} } },
    { name: 'icon', selector: { icon: {} } },
    {
      name: 'x',
      selector: { number: { min: 0, max: 100, step: 0.5, mode: 'slider' } },
    },
    {
      name: 'y',
      selector: { number: { min: 0, max: 100, step: 0.5, mode: 'slider' } },
    },
    {
      name: 'width',
      selector: { number: { min: 1, max: 100, step: 0.5, mode: 'slider' } },
    },
    {
      name: 'height',
      selector: { number: { min: 1, max: 100, step: 0.5, mode: 'slider' } },
    },
  ];
}
```

- [ ] Run and expect pass:
```
npx vitest run test/editor-helpers.test.ts
```
Expected: all describe blocks green (`defaultEntity`, `defaultZone`, `isDirectional`, `imagesOptionsSchema`, `entitySchema`, `zoneSchema`).

- [ ] Commit:
```
git add src/editor/editor-helpers.ts test/editor-helpers.test.ts && git commit -m "feat(editor): pure schema builders + default factories for visual editor"
```

---

### Task 6.2: Entity↔form-data mapping (directional toggle ↔ nullable orientation)
**Files:**
- Modify: `src/editor/editor-helpers.ts`
- Test: `test/editor-helpers.test.ts` (append)

**Interfaces:**
Consumes: `EntityConfig` (from `src/core/config.ts`), `isDirectional`.
Produces:
- `interface EntityFormData { entity: string; name?: string; icon?: string; size: SizeTier; tap: TapAction; lightStyle?: LightStyle; x: number; y: number; directional: boolean; orientation?: number; }`
- `function entityToForm(e: EntityConfig): EntityFormData` — collapses `orientation: null` to `directional:false` (no `orientation` key); a numeric orientation → `directional:true` + that `orientation`.
- `function formToEntity(prev: EntityConfig, data: Partial<EntityFormData>): EntityConfig` — merges a partial ha-form `value` back onto the previous entity. The directional toggle is authoritative: `directional:false` ⇒ `orientation:null`; turning `directional:true` with no orientation yet ⇒ `orientation:0`. PRESERVES unknown keys already on `prev`.

This mapping is the crux of "orientation directional-toggle+slider matching nullable-number schema" — it must round-trip cleanly so the slider only appears when `directional` is on, and toggling it off restores `null` rather than leaving a stale angle.

Steps:

- [ ] Append failing tests to `test/editor-helpers.test.ts`:
```ts
import { entityToForm, formToEntity } from '../src/editor/editor-helpers';
import type { EntityConfig } from '../src/core/config';

describe('entityToForm', () => {
  it('null orientation -> directional false, no orientation key', () => {
    const e: EntityConfig = {
      entity: 'light.a',
      x: 10,
      y: 20,
      size: 'small',
      tap: 'toggle',
      orientation: null,
    };
    const form = entityToForm(e);
    expect(form.directional).toBe(false);
    expect('orientation' in form).toBe(false);
    expect(form).toMatchObject({ entity: 'light.a', x: 10, y: 20 });
  });

  it('numeric orientation -> directional true + orientation', () => {
    const e: EntityConfig = {
      entity: 'light.a',
      x: 0,
      y: 0,
      size: 'small',
      tap: 'toggle',
      orientation: 90,
    };
    const form = entityToForm(e);
    expect(form.directional).toBe(true);
    expect(form.orientation).toBe(90);
  });
});

describe('formToEntity', () => {
  const base: EntityConfig = {
    entity: 'light.a',
    x: 10,
    y: 20,
    size: 'small',
    tap: 'toggle',
    orientation: null,
  };

  it('turning directional on with no angle defaults orientation to 0', () => {
    const out = formToEntity(base, { directional: true });
    expect(out.orientation).toBe(0);
  });

  it('directional on + slider value sets that orientation', () => {
    const out = formToEntity(base, { directional: true, orientation: 145 });
    expect(out.orientation).toBe(145);
  });

  it('turning directional off forces orientation back to null', () => {
    const lit: EntityConfig = { ...base, orientation: 200 };
    const out = formToEntity(lit, { directional: false, orientation: 200 });
    expect(out.orientation).toBeNull();
  });

  it('merges scalar fields and drops the transient directional key', () => {
    const out = formToEntity(base, { x: 33, name: 'Lamp' });
    expect(out.x).toBe(33);
    expect(out.name).toBe('Lamp');
    expect('directional' in out).toBe(false);
  });

  it('preserves unknown keys already on the entity', () => {
    const withExtra = { ...base, _legacy: 'keep' } as unknown as EntityConfig;
    const out = formToEntity(withExtra, { x: 5 });
    expect((out as any)._legacy).toBe('keep');
  });
});
```

- [ ] Run and expect fail:
```
npx vitest run test/editor-helpers.test.ts -t "entityToForm"
```
Expected failure: `entityToForm is not a function` / import resolves but symbol undefined.

- [ ] Append implementation to `src/editor/editor-helpers.ts`:
```ts
export interface EntityFormData {
  entity: string;
  name?: string;
  icon?: string;
  size: SizeTier;
  tap: TapAction;
  lightStyle?: LightStyle;
  x: number;
  y: number;
  directional: boolean;
  orientation?: number;
}

export function entityToForm(e: EntityConfig): EntityFormData {
  const directional = isDirectional(e.orientation);
  const form: EntityFormData = {
    entity: e.entity,
    name: e.name,
    icon: e.icon,
    size: e.size,
    tap: e.tap,
    lightStyle: e.lightStyle,
    x: e.x,
    y: e.y,
    directional,
  };
  if (directional) {
    form.orientation = e.orientation as number;
  }
  return form;
}

export function formToEntity(
  prev: EntityConfig,
  data: Partial<EntityFormData>
): EntityConfig {
  // Start from prev (preserves unknown keys), overlay the form patch.
  const merged: any = { ...prev, ...data };

  // The directional toggle is authoritative over the nullable orientation.
  const directional =
    'directional' in data ? data.directional : isDirectional(prev.orientation);

  if (directional) {
    const angle =
      typeof data.orientation === 'number'
        ? data.orientation
        : typeof prev.orientation === 'number'
          ? prev.orientation
          : 0;
    merged.orientation = angle;
  } else {
    merged.orientation = null;
  }

  // 'directional' is a transient UI-only field; never persist it.
  delete merged.directional;
  return merged as EntityConfig;
}
```

- [ ] Run and expect pass:
```
npx vitest run test/editor-helpers.test.ts
```
Expected: `entityToForm` and `formToEntity` blocks green alongside all earlier blocks.

- [ ] Commit:
```
git add src/editor/editor-helpers.ts test/editor-helpers.test.ts && git commit -m "feat(editor): entity<->form mapping for directional toggle / nullable orientation"
```

---

### Task 6.3: preview-canvas — geometry math (px↔% and rect normalization)
**Files:**
- Create: `src/editor/preview-geometry.ts`
- Test: `test/preview-geometry.test.ts`

**Interfaces:**
Consumes: `ZoneConfig` (from `src/core/config.ts`).
Produces:
- `interface PreviewRect { left: number; top: number; width: number; height: number; }` (the preview image's bounding box in screen px)
- `function pointToPercent(clientX: number, clientY: number, rect: PreviewRect): { x: number; y: number }` — clamps to 0–100.
- `function percentToPoint(xPct: number, yPct: number, rect: PreviewRect): { x: number; y: number }` — screen px relative to the rect origin.
- `function rectFromDrag(startXPct: number, startYPct: number, endXPct: number, endYPct: number): { x: number; y: number; width: number; height: number }` — normalizes a draw drag into a `ZoneConfig`-shaped rect (top-left + positive w/h), clamped so the rect stays within 0–100.

This is the pure math behind preview-canvas drag/draw, separated so it's testable without a DOM. `preview-canvas.ts` (Task 6.4) imports these.

Steps:

- [ ] Write failing test `test/preview-geometry.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import {
  pointToPercent,
  percentToPoint,
  rectFromDrag,
} from '../src/editor/preview-geometry';

const rect = { left: 100, top: 50, width: 400, height: 200 };

describe('pointToPercent', () => {
  it('maps a screen point to image percentages', () => {
    expect(pointToPercent(300, 150, rect)).toEqual({ x: 50, y: 50 });
  });
  it('clamps below the origin to 0', () => {
    expect(pointToPercent(0, 0, rect)).toEqual({ x: 0, y: 0 });
  });
  it('clamps past the far edge to 100', () => {
    expect(pointToPercent(9999, 9999, rect)).toEqual({ x: 100, y: 100 });
  });
});

describe('percentToPoint', () => {
  it('maps percentages back to px relative to the rect origin', () => {
    expect(percentToPoint(50, 50, rect)).toEqual({ x: 200, y: 100 });
  });
  it('round-trips with pointToPercent at the center', () => {
    const p = percentToPoint(25, 75, rect);
    const back = pointToPercent(p.x + rect.left, p.y + rect.top, rect);
    expect(back.x).toBeCloseTo(25);
    expect(back.y).toBeCloseTo(75);
  });
});

describe('rectFromDrag', () => {
  it('normalizes a top-left -> bottom-right drag', () => {
    expect(rectFromDrag(10, 20, 40, 60)).toEqual({
      x: 10,
      y: 20,
      width: 30,
      height: 40,
    });
  });
  it('normalizes a reversed (bottom-right -> top-left) drag', () => {
    expect(rectFromDrag(40, 60, 10, 20)).toEqual({
      x: 10,
      y: 20,
      width: 30,
      height: 40,
    });
  });
  it('clamps the rect within 0-100 bounds', () => {
    expect(rectFromDrag(-10, -10, 120, 130)).toEqual({
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    });
  });
});
```

- [ ] Run and expect fail:
```
npx vitest run test/preview-geometry.test.ts -t "pointToPercent"
```
Expected failure: `Failed to resolve import "../src/editor/preview-geometry"`.

- [ ] Create `src/editor/preview-geometry.ts`:
```ts
export interface PreviewRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export function pointToPercent(
  clientX: number,
  clientY: number,
  rect: PreviewRect
): { x: number; y: number } {
  const x = ((clientX - rect.left) / rect.width) * 100;
  const y = ((clientY - rect.top) / rect.height) * 100;
  return { x: clamp(x, 0, 100), y: clamp(y, 0, 100) };
}

export function percentToPoint(
  xPct: number,
  yPct: number,
  rect: PreviewRect
): { x: number; y: number } {
  return {
    x: (xPct / 100) * rect.width,
    y: (yPct / 100) * rect.height,
  };
}

export function rectFromDrag(
  startXPct: number,
  startYPct: number,
  endXPct: number,
  endYPct: number
): { x: number; y: number; width: number; height: number } {
  const x0 = clamp(Math.min(startXPct, endXPct), 0, 100);
  const y0 = clamp(Math.min(startYPct, endYPct), 0, 100);
  const x1 = clamp(Math.max(startXPct, endXPct), 0, 100);
  const y1 = clamp(Math.max(startYPct, endYPct), 0, 100);
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}
```

- [ ] Run and expect pass:
```
npx vitest run test/preview-geometry.test.ts
```
Expected: all three describe blocks green.

- [ ] Commit:
```
git add src/editor/preview-geometry.ts test/preview-geometry.test.ts && git commit -m "feat(editor): preview-canvas px<->% geometry + drag-rect normalization"
```

---

### Task 6.4: preview-canvas component — markers, drag, zone draw, selection
**Files:**
- Create: `src/editor/preview-canvas.ts`
- Test: `test/preview-canvas.test.ts`

**Interfaces:**
Consumes: `EntityConfig`, `ZoneConfig`, `ImagesConfig` (from `src/core/config.ts`); `pointToPercent`, `percentToPoint`, `rectFromDrag`, `PreviewRect` (from `./preview-geometry`).
Produces the `<preview-canvas>` custom element with:
- `@property() entities: EntityConfig[]`
- `@property() zones: ZoneConfig[]`
- `@property() base: string` (the `images.base` URL)
- `@property() selectedEntity: number` (index; `-1` = none)
- `@property() drawingZone: boolean` (when true, the canvas is in crosshair zone-draw mode)
- Events (composed, bubbling):
  - `preview-entity-moved` → `detail: { index: number; x: number; y: number }` (fired live during drag, bidirectional with the X/Y sliders)
  - `preview-entity-selected` → `detail: { index: number }`
  - `preview-zone-drawn` → `detail: { x: number; y: number; width: number; height: number }`
  - `preview-zone-draw-cancelled` → `detail: {}` (empty drag / no movement)

Behavior:
- Renders the `base` image; if no `base`, shows an empty-state hint.
- Each entity is an absolutely-positioned marker at its `x%/y%`; the marker for `selectedEntity` gets a `.selected` class.
- Pointer-down on a marker selects it and begins dragging; pointer-move updates the marker live and fires `preview-entity-moved`; cursor becomes `grabbing` and the marker drops to 50% opacity while dragging (spec §7).
- When `drawingZone` is true: the canvas shows a `crosshair` cursor; pointer-down on the image (not a marker) starts a dashed rubber-band rectangle that follows the pointer; on release with non-trivial size, fires `preview-zone-drawn` with a normalized rect; a zero/near-zero drag fires `preview-zone-draw-cancelled`.
- Existing zones render as dashed outlines (solid for the selected/just-drawn one is handled by the parent re-render; here all stored zones are dashed reference outlines).

Steps:

- [ ] Write failing browser-mode test `test/preview-canvas.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import '../src/editor/preview-canvas';
import type { PreviewCanvas } from '../src/editor/preview-canvas';
import type { EntityConfig } from '../src/core/config';

function makeEntity(x: number, y: number): EntityConfig {
  return { entity: 'light.a', x, y, size: 'small', tap: 'toggle', orientation: null };
}

async function mount(): Promise<PreviewCanvas> {
  const el = document.createElement('preview-canvas') as PreviewCanvas;
  el.base = 'data:image/gif;base64,R0lGODlhAQABAAAAACw='; // 1x1 transparent
  el.entities = [makeEntity(20, 30), makeEntity(70, 80)];
  el.zones = [];
  el.selectedEntity = -1;
  el.drawingZone = false;
  // Force a deterministic preview rect so geometry math is predictable.
  (el as any).style.position = 'absolute';
  (el as any).style.left = '0px';
  (el as any).style.top = '0px';
  (el as any).style.width = '400px';
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

describe('preview-canvas', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders one marker per entity', async () => {
    const el = await mount();
    const markers = el.shadowRoot!.querySelectorAll('.marker');
    expect(markers.length).toBe(2);
  });

  it('clicking a marker fires preview-entity-selected with its index', async () => {
    const el = await mount();
    const events: number[] = [];
    el.addEventListener('preview-entity-selected', (e) =>
      events.push((e as CustomEvent).detail.index)
    );
    const marker = el.shadowRoot!.querySelectorAll('.marker')[1] as HTMLElement;
    marker.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, clientX: 0, clientY: 0 })
    );
    expect(events).toEqual([1]);
  });

  it('applies .selected to the selected marker only', async () => {
    const el = await mount();
    el.selectedEntity = 0;
    await el.updateComplete;
    const markers = el.shadowRoot!.querySelectorAll('.marker');
    expect(markers[0].classList.contains('selected')).toBe(true);
    expect(markers[1].classList.contains('selected')).toBe(false);
  });

  it('dragging a marker fires preview-entity-moved with clamped %', async () => {
    const el = await mount();
    const moves: { index: number; x: number; y: number }[] = [];
    el.addEventListener('preview-entity-moved', (e) =>
      moves.push((e as CustomEvent).detail)
    );
    const surface = el.shadowRoot!.querySelector('.surface') as HTMLElement;
    const rect = surface.getBoundingClientRect();
    const marker = el.shadowRoot!.querySelectorAll('.marker')[0] as HTMLElement;
    marker.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        clientX: rect.left + rect.width * 0.2,
        clientY: rect.top + rect.height * 0.3,
      })
    );
    surface.dispatchEvent(
      new PointerEvent('pointermove', {
        bubbles: true,
        clientX: rect.left + rect.width * 0.6,
        clientY: rect.top + rect.height * 0.4,
      })
    );
    surface.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    expect(moves.length).toBeGreaterThan(0);
    const last = moves[moves.length - 1];
    expect(last.index).toBe(0);
    expect(last.x).toBeCloseTo(60, 0);
    expect(last.y).toBeCloseTo(40, 0);
  });

  it('drawing a zone fires preview-zone-drawn with a normalized rect', async () => {
    const el = await mount();
    el.drawingZone = true;
    await el.updateComplete;
    const drawn: any[] = [];
    el.addEventListener('preview-zone-drawn', (e) =>
      drawn.push((e as CustomEvent).detail)
    );
    const surface = el.shadowRoot!.querySelector('.surface') as HTMLElement;
    const rect = surface.getBoundingClientRect();
    surface.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        clientX: rect.left + rect.width * 0.1,
        clientY: rect.top + rect.height * 0.2,
      })
    );
    surface.dispatchEvent(
      new PointerEvent('pointermove', {
        bubbles: true,
        clientX: rect.left + rect.width * 0.5,
        clientY: rect.top + rect.height * 0.7,
      })
    );
    surface.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    expect(drawn.length).toBe(1);
    expect(drawn[0].x).toBeCloseTo(10, 0);
    expect(drawn[0].y).toBeCloseTo(20, 0);
    expect(drawn[0].width).toBeCloseTo(40, 0);
    expect(drawn[0].height).toBeCloseTo(50, 0);
  });

  it('shows crosshair cursor while in zone-draw mode', async () => {
    const el = await mount();
    el.drawingZone = true;
    await el.updateComplete;
    const surface = el.shadowRoot!.querySelector('.surface') as HTMLElement;
    expect(getComputedStyle(surface).cursor).toBe('crosshair');
  });

  it('an empty zone drag fires preview-zone-draw-cancelled', async () => {
    const el = await mount();
    el.drawingZone = true;
    await el.updateComplete;
    const cancelled: any[] = [];
    el.addEventListener('preview-zone-draw-cancelled', () => cancelled.push(1));
    const surface = el.shadowRoot!.querySelector('.surface') as HTMLElement;
    const rect = surface.getBoundingClientRect();
    surface.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        clientX: rect.left + 5,
        clientY: rect.top + 5,
      })
    );
    surface.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    expect(cancelled.length).toBe(1);
  });
});
```

- [ ] Run and expect fail:
```
npx vitest run test/preview-canvas.test.ts -t "renders one marker per entity"
```
Expected failure: `Failed to resolve import "../src/editor/preview-canvas"`.

- [ ] Create `src/editor/preview-canvas.ts`:
```ts
import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { EntityConfig, ZoneConfig } from '../core/config';
import {
  pointToPercent,
  rectFromDrag,
  type PreviewRect,
} from './preview-geometry';

type DragMode = 'none' | 'marker' | 'zone';

@customElement('preview-canvas')
export class PreviewCanvas extends LitElement {
  @property({ attribute: false }) entities: EntityConfig[] = [];
  @property({ attribute: false }) zones: ZoneConfig[] = [];
  @property() base = '';
  @property({ type: Number }) selectedEntity = -1;
  @property({ type: Boolean }) drawingZone = false;

  @state() private _dragMode: DragMode = 'none';
  @state() private _dragIndex = -1;
  @state() private _drawStart: { x: number; y: number } | null = null;
  @state() private _drawCurrent: { x: number; y: number } | null = null;

  static styles = css`
    :host {
      display: block;
      width: 100%;
    }
    .surface {
      position: relative;
      width: 100%;
      user-select: none;
      touch-action: none;
      overflow: hidden;
      border-radius: 8px;
    }
    .surface.drawing {
      cursor: crosshair;
    }
    .base {
      display: block;
      width: 100%;
      height: auto;
      pointer-events: none;
    }
    .empty {
      padding: 32px 16px;
      text-align: center;
      color: var(--secondary-text-color);
      border: 1px dashed var(--divider-color);
      border-radius: 8px;
    }
    .marker {
      position: absolute;
      width: 22px;
      height: 22px;
      margin: -11px 0 0 -11px;
      border-radius: 50%;
      background: var(--primary-color);
      border: 2px solid var(--card-background-color);
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
      cursor: grab;
      transition: opacity 0.1s ease;
    }
    .marker.selected {
      background: var(--accent-color, var(--primary-color));
      box-shadow: 0 0 0 3px var(--primary-color);
    }
    .marker.dragging {
      cursor: grabbing;
      opacity: 0.5;
    }
    .zone {
      position: absolute;
      border: 2px dashed var(--accent-color, var(--primary-color));
      background: color-mix(in srgb, var(--primary-color) 12%, transparent);
      pointer-events: none;
    }
    .zone.drawing {
      border-style: dashed;
    }
  `;

  private get _surface(): HTMLElement | null {
    return this.shadowRoot?.querySelector('.surface') ?? null;
  }

  private _rect(): PreviewRect {
    const r = this._surface!.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  }

  private _onMarkerDown(ev: PointerEvent, index: number) {
    ev.stopPropagation();
    this._emit('preview-entity-selected', { index });
    this._dragMode = 'marker';
    this._dragIndex = index;
    (ev.currentTarget as HTMLElement).setPointerCapture?.(ev.pointerId);
  }

  private _onSurfaceDown(ev: PointerEvent) {
    if (!this.drawingZone) return;
    const p = pointToPercent(ev.clientX, ev.clientY, this._rect());
    this._dragMode = 'zone';
    this._drawStart = p;
    this._drawCurrent = p;
    this._surface!.setPointerCapture?.(ev.pointerId);
  }

  private _onMove = (ev: PointerEvent) => {
    if (this._dragMode === 'marker') {
      const p = pointToPercent(ev.clientX, ev.clientY, this._rect());
      this._emit('preview-entity-moved', {
        index: this._dragIndex,
        x: p.x,
        y: p.y,
      });
    } else if (this._dragMode === 'zone' && this._drawStart) {
      this._drawCurrent = pointToPercent(ev.clientX, ev.clientY, this._rect());
    }
  };

  private _onUp = () => {
    if (this._dragMode === 'zone' && this._drawStart && this._drawCurrent) {
      const r = rectFromDrag(
        this._drawStart.x,
        this._drawStart.y,
        this._drawCurrent.x,
        this._drawCurrent.y
      );
      if (r.width < 2 || r.height < 2) {
        this._emit('preview-zone-draw-cancelled', {});
      } else {
        this._emit('preview-zone-drawn', r);
      }
    }
    this._dragMode = 'none';
    this._dragIndex = -1;
    this._drawStart = null;
    this._drawCurrent = null;
  };

  private _emit(type: string, detail: any) {
    this.dispatchEvent(
      new CustomEvent(type, { detail, bubbles: true, composed: true })
    );
  }

  protected render() {
    if (!this.base) {
      return html`<div class="empty">
        Set <code>images.base</code> to enable the live preview.
      </div>`;
    }

    const rubber =
      this._dragMode === 'zone' && this._drawStart && this._drawCurrent
        ? rectFromDrag(
            this._drawStart.x,
            this._drawStart.y,
            this._drawCurrent.x,
            this._drawCurrent.y
          )
        : null;

    return html`
      <div
        class="surface ${this.drawingZone ? 'drawing' : ''}"
        @pointerdown=${this._onSurfaceDown}
        @pointermove=${this._onMove}
        @pointerup=${this._onUp}
        @pointercancel=${this._onUp}
      >
        <img class="base" src=${this.base} alt="Apartment preview" />
        ${this.zones.map(
          (z) => html`<div
            class="zone"
            style="left:${z.x}%;top:${z.y}%;width:${z.width}%;height:${z.height}%;"
          ></div>`
        )}
        ${rubber
          ? html`<div
              class="zone drawing"
              style="left:${rubber.x}%;top:${rubber.y}%;width:${rubber.width}%;height:${rubber.height}%;"
            ></div>`
          : nothing}
        ${this.entities.map(
          (e, i) => html`<div
            class="marker ${i === this.selectedEntity ? 'selected' : ''} ${this
              ._dragMode === 'marker' && this._dragIndex === i
              ? 'dragging'
              : ''}"
            style="left:${e.x}%;top:${e.y}%;"
            @pointerdown=${(ev: PointerEvent) => this._onMarkerDown(ev, i)}
          ></div>`
        )}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'preview-canvas': PreviewCanvas;
  }
}
```

- [ ] Run and expect pass:
```
npx vitest run test/preview-canvas.test.ts
```
Expected: all 7 it blocks green (markers, selection, .selected, drag-move, zone-drawn, crosshair cursor, zone-draw-cancelled).

- [ ] Commit:
```
git add src/editor/preview-canvas.ts test/preview-canvas.test.ts && git commit -m "feat(editor): preview-canvas with draggable markers + crosshair zone drawing"
```

---

### Task 6.5: editor component — images+options ha-form section (config-changed)
**Files:**
- Create: `src/editor/apartment-view-card-editor.ts`
- Test: `test/apartment-view-card-editor.test.ts`

**Interfaces:**
Consumes: `ApartmentViewConfig`, `normalizeConfig` (from `src/core/config.ts`); `imagesOptionsSchema` (from `./editor-helpers`); `fireEvent` (`custom-card-helpers`).
Produces the `<apartment-view-card-editor>` element with:
- `@property() hass: HomeAssistant`
- `@property() config: ApartmentViewConfig`
- `setConfig(config): void` — runs `normalizeConfig` and stores it (preserves unknown keys).
- Renders an `<ha-form>` for the flattened images+options data and emits `config-changed` with the merged, un-flattened config on change.

This task delivers ONLY the images+options section; entities (6.6) and zones (6.7) layer on top of the same component.

Steps:

- [ ] Write failing test `test/apartment-view-card-editor.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import '../src/editor/apartment-view-card-editor';
import type { ApartmentViewConfig } from '../src/core/config';

function baseConfig(): ApartmentViewConfig {
  return {
    type: 'custom:apartment-view-card',
    images: { base: '/local/day.png' },
    entities: [],
    zones: [],
    options: {
      view: 'auto',
      lightStyle: 'lit',
      freePanZoom: true,
      zoomMax: 1.5,
      duskDawnOffsetMinutes: 60,
    },
  };
}

async function mount() {
  const el = document.createElement('apartment-view-card-editor') as any;
  el.hass = { states: {}, localize: (k: string) => k };
  el.setConfig(baseConfig());
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

describe('apartment-view-card-editor: images + options', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('setConfig preserves unknown keys', async () => {
    const el = document.createElement('apartment-view-card-editor') as any;
    el.hass = { states: {} };
    el.setConfig({ ...baseConfig(), _legacy: 'keep' });
    expect(el.config._legacy).toBe('keep');
  });

  it('renders an ha-form whose data is the flattened images+options', async () => {
    const el = await mount();
    const form = el.shadowRoot.querySelector('ha-form.images-options') as any;
    expect(form).toBeTruthy();
    expect(form.data.base).toBe('/local/day.png');
    expect(form.data.view).toBe('auto');
    expect(form.data.zoomMax).toBe(1.5);
  });

  it('a form value-changed re-nests into images/options and fires config-changed', async () => {
    const el = await mount();
    let fired: ApartmentViewConfig | null = null;
    el.addEventListener('config-changed', (e: CustomEvent) => {
      fired = e.detail.config;
    });
    const form = el.shadowRoot.querySelector('ha-form.images-options') as any;
    form.dispatchEvent(
      new CustomEvent('value-changed', {
        detail: {
          value: {
            base: '/local/new.png',
            allLights: '/local/all.png',
            night: undefined,
            duskDawn: undefined,
            view: 'night',
            lightStyle: 'glow',
            freePanZoom: false,
            zoomMax: 2,
            duskDawnOffsetMinutes: 45,
          },
        },
        bubbles: true,
        composed: true,
      })
    );
    expect(fired).not.toBeNull();
    expect(fired!.images.base).toBe('/local/new.png');
    expect(fired!.images.allLights).toBe('/local/all.png');
    expect(fired!.options.view).toBe('night');
    expect(fired!.options.freePanZoom).toBe(false);
    expect(fired!.options.zoomMax).toBe(2);
  });

  it('config-changed preserves entities, zones, and unknown keys', async () => {
    const el = document.createElement('apartment-view-card-editor') as any;
    el.hass = { states: {} };
    el.setConfig({
      ...baseConfig(),
      entities: [
        { entity: 'light.a', x: 1, y: 2, size: 'small', tap: 'toggle', orientation: null },
      ],
      _legacy: 'keep',
    });
    document.body.appendChild(el);
    await el.updateComplete;
    let fired: any = null;
    el.addEventListener('config-changed', (e: CustomEvent) => (fired = e.detail.config));
    const form = el.shadowRoot.querySelector('ha-form.images-options') as any;
    form.dispatchEvent(
      new CustomEvent('value-changed', {
        detail: { value: { ...form.data, view: 'day' } },
        bubbles: true,
        composed: true,
      })
    );
    expect(fired.entities.length).toBe(1);
    expect(fired._legacy).toBe('keep');
  });
});
```

- [ ] Run and expect fail:
```
npx vitest run test/apartment-view-card-editor.test.ts -t "renders an ha-form"
```
Expected failure: `Failed to resolve import "../src/editor/apartment-view-card-editor"`.

- [ ] Create `src/editor/apartment-view-card-editor.ts`:
```ts
import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { fireEvent, type HomeAssistant } from 'custom-card-helpers';
import { normalizeConfig, type ApartmentViewConfig } from '../core/config';
import { imagesOptionsSchema } from './editor-helpers';

@customElement('apartment-view-card-editor')
export class ApartmentViewCardEditor extends LitElement {
  @property({ attribute: false }) public hass!: HomeAssistant;
  @state() private _config!: ApartmentViewConfig;

  static styles = css`
    .section {
      margin-bottom: 24px;
    }
    .section-title {
      font-weight: 600;
      margin: 16px 0 8px;
    }
  `;

  public get config(): ApartmentViewConfig {
    return this._config;
  }

  public setConfig(config: any): void {
    // normalizeConfig fills defaults, applies breaking renames, preserves unknown keys.
    this._config = normalizeConfig(config);
  }

  /** Flatten images + options into a single ha-form data object. */
  private _imagesOptionsData(): Record<string, unknown> {
    return { ...this._config.images, ...this._config.options };
  }

  private _imagesOptionsLabel = (schema: { name: string }): string => {
    const labels: Record<string, string> = {
      base: 'Base render (required)',
      allLights: 'All-lights render (enables "reveal")',
      night: 'Night render (optional)',
      duskDawn: 'Dusk/Dawn render (optional)',
      view: 'Time-of-day view',
      lightStyle: 'Light style',
      freePanZoom: 'Free pan / zoom',
      zoomMax: 'Max zone-zoom scale',
      duskDawnOffsetMinutes: 'Dusk/Dawn offset',
    };
    return labels[schema.name] ?? schema.name;
  };

  private _onImagesOptionsChanged(ev: CustomEvent): void {
    ev.stopPropagation();
    const v = ev.detail.value as Record<string, any>;
    const images = {
      base: v.base,
      allLights: v.allLights || undefined,
      night: v.night || undefined,
      duskDawn: v.duskDawn || undefined,
    };
    const options = {
      view: v.view,
      lightStyle: v.lightStyle,
      freePanZoom: v.freePanZoom,
      zoomMax: v.zoomMax,
      duskDawnOffsetMinutes: v.duskDawnOffsetMinutes,
    };
    // Spread _config first so entities/zones/unknown keys survive.
    const config: ApartmentViewConfig = {
      ...this._config,
      images: { ...this._config.images, ...images },
      options: { ...this._config.options, ...options },
    };
    this._config = config;
    fireEvent(this, 'config-changed', { config });
  }

  protected render() {
    if (!this.hass || !this._config) {
      return html``;
    }
    return html`
      <div class="section">
        <div class="section-title">Images &amp; options</div>
        <ha-form
          class="images-options"
          .hass=${this.hass}
          .data=${this._imagesOptionsData()}
          .schema=${imagesOptionsSchema()}
          .computeLabel=${this._imagesOptionsLabel}
          @value-changed=${this._onImagesOptionsChanged}
        ></ha-form>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'apartment-view-card-editor': ApartmentViewCardEditor;
  }
}
```

> Note: `ha-form` is provided by the HA frontend at runtime; in the Vitest browser harness it is an unregistered custom element, which still renders as a plain element with its `.data`/`.schema` properties set and forwards the dispatched `value-changed`. The tests assert against those properties and the resulting `config-changed`, so no `ha-form` stub is required.

- [ ] Run and expect pass:
```
npx vitest run test/apartment-view-card-editor.test.ts
```
Expected: the 4 it blocks under "images + options" green.

- [ ] Commit:
```
git add src/editor/apartment-view-card-editor.ts test/apartment-view-card-editor.test.ts && git commit -m "feat(editor): images+options ha-form section with config-changed"
```

---

### Task 6.6: editor — entities list (add/remove/select + per-entity ha-form + preview wiring)
**Files:**
- Modify: `src/editor/apartment-view-card-editor.ts`
- Test: `test/apartment-view-card-editor.test.ts` (append)

**Interfaces:**
Consumes: `EntityConfig` (from `src/core/config.ts`); `entitySchema`, `entityToForm`, `formToEntity`, `defaultEntity`, `isDirectional` (from `./editor-helpers`); the `<preview-canvas>` element + its `preview-entity-moved` / `preview-entity-selected` events (from `./preview-canvas`).
Produces (on the editor component, all private; the externally observable contract is the rendered DOM + emitted `config-changed`):
- An entities list where each row is selectable, an "Add entity" button, a per-entity remove button, and a per-entity `<ha-form class="entity-form">` driven by `entitySchema(isDirectional(...))` + `entityToForm(...)`.
- `<preview-canvas>` rendered with `.entities/.zones/.base/.selectedEntity`; `preview-entity-moved` updates the selected entity's `x/y` (bidirectional with the X/Y sliders) and fires `config-changed`; `preview-entity-selected` sets the selected index.

Steps:

- [ ] Append failing tests to `test/apartment-view-card-editor.test.ts`:
```ts
describe('apartment-view-card-editor: entities', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  async function mountWithEntities() {
    const el = document.createElement('apartment-view-card-editor') as any;
    el.hass = { states: {}, localize: (k: string) => k };
    el.setConfig({
      type: 'custom:apartment-view-card',
      images: { base: '/local/day.png' },
      entities: [
        { entity: 'light.a', x: 10, y: 20, size: 'small', tap: 'toggle', orientation: null },
        { entity: 'light.b', x: 30, y: 40, size: 'small', tap: 'toggle', orientation: 90 },
      ],
      zones: [],
      options: {
        view: 'auto',
        lightStyle: 'lit',
        freePanZoom: true,
        zoomMax: 1.5,
        duskDawnOffsetMinutes: 60,
      },
    });
    document.body.appendChild(el);
    await el.updateComplete;
    return el;
  }

  it('renders one entity row per configured entity', async () => {
    const el = await mountWithEntities();
    expect(el.shadowRoot.querySelectorAll('.entity-row').length).toBe(2);
  });

  it('Add entity appends a default entity and fires config-changed', async () => {
    const el = await mountWithEntities();
    let fired: any = null;
    el.addEventListener('config-changed', (e: CustomEvent) => (fired = e.detail.config));
    (el.shadowRoot.querySelector('.add-entity') as HTMLElement).click();
    expect(fired.entities.length).toBe(3);
    expect(fired.entities[2]).toMatchObject({
      entity: '',
      x: 50,
      y: 50,
      size: 'small',
      tap: 'toggle',
      orientation: null,
    });
  });

  it('Remove entity drops that index and fires config-changed', async () => {
    const el = await mountWithEntities();
    let fired: any = null;
    el.addEventListener('config-changed', (e: CustomEvent) => (fired = e.detail.config));
    const remove = el.shadowRoot.querySelectorAll('.remove-entity')[0] as HTMLElement;
    remove.click();
    expect(fired.entities.length).toBe(1);
    expect(fired.entities[0].entity).toBe('light.b');
  });

  it('the per-entity form schema includes orientation only when directional', async () => {
    const el = await mountWithEntities();
    const forms = el.shadowRoot.querySelectorAll('ha-form.entity-form');
    const namesA = (forms[0] as any).schema.map((s: any) => s.name);
    const namesB = (forms[1] as any).schema.map((s: any) => s.name);
    expect(namesA.includes('orientation')).toBe(false); // light.a orientation null
    expect(namesB.includes('orientation')).toBe(true); // light.b orientation 90
    // entity selector NOT domain-limited
    const entityRow = (forms[0] as any).schema.find((s: any) => s.name === 'entity');
    expect(entityRow.selector.entity).toEqual({});
  });

  it('turning the directional toggle on writes orientation 0 (nullable->0)', async () => {
    const el = await mountWithEntities();
    let fired: any = null;
    el.addEventListener('config-changed', (e: CustomEvent) => (fired = e.detail.config));
    const form = el.shadowRoot.querySelectorAll('ha-form.entity-form')[0] as any;
    form.dispatchEvent(
      new CustomEvent('value-changed', {
        detail: { value: { ...form.data, directional: true } },
        bubbles: true,
        composed: true,
      })
    );
    expect(fired.entities[0].orientation).toBe(0);
  });

  it('turning the directional toggle off restores orientation null', async () => {
    const el = await mountWithEntities();
    let fired: any = null;
    el.addEventListener('config-changed', (e: CustomEvent) => (fired = e.detail.config));
    const form = el.shadowRoot.querySelectorAll('ha-form.entity-form')[1] as any;
    form.dispatchEvent(
      new CustomEvent('value-changed', {
        detail: { value: { ...form.data, directional: false } },
        bubbles: true,
        composed: true,
      })
    );
    expect(fired.entities[1].orientation).toBeNull();
  });

  it('preview-entity-moved updates the moved entity x/y and fires config-changed', async () => {
    const el = await mountWithEntities();
    let fired: any = null;
    el.addEventListener('config-changed', (e: CustomEvent) => (fired = e.detail.config));
    const preview = el.shadowRoot.querySelector('preview-canvas') as HTMLElement;
    preview.dispatchEvent(
      new CustomEvent('preview-entity-moved', {
        detail: { index: 0, x: 66, y: 77 },
        bubbles: true,
        composed: true,
      })
    );
    expect(fired.entities[0].x).toBe(66);
    expect(fired.entities[0].y).toBe(77);
  });

  it('preview-entity-selected sets the selected index on the preview', async () => {
    const el = await mountWithEntities();
    const preview = el.shadowRoot.querySelector('preview-canvas') as any;
    preview.dispatchEvent(
      new CustomEvent('preview-entity-selected', {
        detail: { index: 1 },
        bubbles: true,
        composed: true,
      })
    );
    await el.updateComplete;
    expect((el.shadowRoot.querySelector('preview-canvas') as any).selectedEntity).toBe(1);
  });
});
```

- [ ] Run and expect fail:
```
npx vitest run test/apartment-view-card-editor.test.ts -t "renders one entity row per configured entity"
```
Expected failure: `el.shadowRoot.querySelectorAll('.entity-row')` is empty (length 0 ≠ 2) — the entities section does not exist yet.

- [ ] Update the imports at the top of `src/editor/apartment-view-card-editor.ts`:
```ts
import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { fireEvent, type HomeAssistant } from 'custom-card-helpers';
import {
  normalizeConfig,
  type ApartmentViewConfig,
  type EntityConfig,
} from '../core/config';
import {
  imagesOptionsSchema,
  entitySchema,
  entityToForm,
  formToEntity,
  defaultEntity,
  isDirectional,
} from './editor-helpers';
import './preview-canvas';
```

- [ ] Add a `_selectedEntity` state field next to `_config` in the class body:
```ts
  @state() private _selectedEntity = -1;
```

- [ ] Append the entities styles to the `static styles` css block (insert before the closing backtick):
```css
    .entity-row {
      border: 1px solid var(--divider-color);
      border-radius: 8px;
      padding: 8px;
      margin-bottom: 8px;
    }
    .entity-row.selected {
      border-color: var(--primary-color);
    }
    .row-header {
      display: flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
    }
    .row-title {
      flex: 1;
      font-weight: 500;
    }
    .add-entity,
    .add-zone {
      margin-top: 8px;
    }
```

- [ ] Add the entities helper methods + the preview wiring to the class body (place after `_onImagesOptionsChanged`):
```ts
  private _commitEntities(entities: EntityConfig[]): void {
    const config: ApartmentViewConfig = { ...this._config, entities };
    this._config = config;
    fireEvent(this, 'config-changed', { config });
  }

  private _addEntity(): void {
    this._commitEntities([...this._config.entities, defaultEntity()]);
    this._selectedEntity = this._config.entities.length - 1;
  }

  private _removeEntity(index: number): void {
    const entities = this._config.entities.filter((_, i) => i !== index);
    if (this._selectedEntity === index) this._selectedEntity = -1;
    this._commitEntities(entities);
  }

  private _selectEntity(index: number): void {
    this._selectedEntity = this._selectedEntity === index ? -1 : index;
  }

  private _entityLabel = (schema: { name: string }): string => {
    const labels: Record<string, string> = {
      entity: 'Entity',
      name: 'Name (optional)',
      icon: 'Icon (optional)',
      size: 'Size',
      tap: 'Tap action',
      lightStyle: 'Light style override',
      x: 'X position',
      y: 'Y position',
      directional: 'Directional (cone)',
      orientation: 'Orientation',
    };
    return labels[schema.name] ?? schema.name;
  };

  private _onEntityChanged(ev: CustomEvent, index: number): void {
    ev.stopPropagation();
    const prev = this._config.entities[index];
    const next = formToEntity(prev, ev.detail.value);
    const entities = this._config.entities.map((e, i) =>
      i === index ? next : e
    );
    this._commitEntities(entities);
  }

  private _onPreviewEntityMoved(ev: CustomEvent): void {
    const { index, x, y } = ev.detail as {
      index: number;
      x: number;
      y: number;
    };
    const entities = this._config.entities.map((e, i) =>
      i === index ? { ...e, x, y } : e
    );
    this._commitEntities(entities);
  }

  private _onPreviewEntitySelected(ev: CustomEvent): void {
    this._selectedEntity = (ev.detail as { index: number }).index;
  }

  private _renderEntities() {
    return html`
      <div class="section">
        <div class="section-title">Entities</div>
        ${this._config.entities.map((e, i) => {
          const directional = isDirectional(e.orientation);
          return html`
            <div class="entity-row ${i === this._selectedEntity ? 'selected' : ''}">
              <div class="row-header" @click=${() => this._selectEntity(i)}>
                <span class="row-title">${e.name || e.entity || 'New entity'}</span>
                <ha-icon-button
                  class="remove-entity"
                  .path=${'M19,4H15.5L14.5,3H9.5L8.5,4H5V6H19M6,19A2,2 0 0,0 8,21H16A2,2 0 0,0 18,19V7H6V19Z'}
                  @click=${(ev: Event) => {
                    ev.stopPropagation();
                    this._removeEntity(i);
                  }}
                ></ha-icon-button>
              </div>
              <ha-form
                class="entity-form"
                .hass=${this.hass}
                .data=${entityToForm(e)}
                .schema=${entitySchema(directional)}
                .computeLabel=${this._entityLabel}
                @value-changed=${(ev: CustomEvent) =>
                  this._onEntityChanged(ev, i)}
              ></ha-form>
            </div>
          `;
        })}
        <ha-button class="add-entity" @click=${this._addEntity}>Add entity</ha-button>
      </div>
    `;
  }
```

> The per-entity `<ha-form class="entity-form">` is rendered for ALL rows (not only the selected one), so the entities tests' `querySelectorAll('ha-form.entity-form')` returns one per entity. Selection still highlights the row via `.selected`; the form is always present so it round-trips per-row regardless of selection.

- [ ] Wire the entities section and the preview into `render()`. Replace the existing `render()` return with:
```ts
  protected render() {
    if (!this.hass || !this._config) {
      return html``;
    }
    return html`
      <preview-canvas
        .base=${this._config.images.base}
        .entities=${this._config.entities}
        .zones=${this._config.zones}
        .selectedEntity=${this._selectedEntity}
        @preview-entity-moved=${this._onPreviewEntityMoved}
        @preview-entity-selected=${this._onPreviewEntitySelected}
      ></preview-canvas>
      <div class="section">
        <div class="section-title">Images &amp; options</div>
        <ha-form
          class="images-options"
          .hass=${this.hass}
          .data=${this._imagesOptionsData()}
          .schema=${imagesOptionsSchema()}
          .computeLabel=${this._imagesOptionsLabel}
          @value-changed=${this._onImagesOptionsChanged}
        ></ha-form>
      </div>
      ${this._renderEntities()}
    `;
  }
```

> Spec §7 (row → marker highlight): clicking an entity row sets `_selectedEntity`, which is passed to `<preview-canvas .selectedEntity=...>`, so the preview marker highlights — functionally covered by this wiring + the preview-canvas selection tests (Task 6.4). A dedicated "row-click highlights preview marker" assertion is an OPTIONAL follow-up test, not added here.

- [ ] Run and expect pass:
```
npx vitest run test/apartment-view-card-editor.test.ts -t "entities"
```
Expected: the 8 "entities" it blocks green; the earlier "images + options" blocks remain green.

- [ ] Run the full file to confirm no regressions:
```
npx vitest run test/apartment-view-card-editor.test.ts
```
Expected: all blocks green.

- [ ] Commit:
```
git add src/editor/apartment-view-card-editor.ts test/apartment-view-card-editor.test.ts && git commit -m "feat(editor): entities list with per-entity ha-form, directional toggle, preview drag wiring"
```

---

### Task 6.7: editor — zones list (add/remove + per-zone ha-form + crosshair draw wiring)
**Files:**
- Modify: `src/editor/apartment-view-card-editor.ts`
- Test: `test/apartment-view-card-editor.test.ts` (append)

**Interfaces:**
Consumes: `ZoneConfig` (from `src/core/config.ts`); `zoneSchema`, `defaultZone` (from `./editor-helpers`); the `<preview-canvas>` `drawingZone` property + `preview-zone-drawn` / `preview-zone-draw-cancelled` events.
Produces (on the editor component, private; observable via DOM + `config-changed`):
- A zones list with an "Add zone" button that flips the preview into crosshair draw mode (`drawingZone=true`); on `preview-zone-drawn` a new `ZoneConfig` (merging `defaultZone()` name/icon with the drawn rect) is appended and draw mode exits; `preview-zone-draw-cancelled` just exits draw mode.
- Per-zone `<ha-form class="zone-form">` for name/icon/x/y/width/height, plus per-zone remove and reorder (move up / move down).

Steps:

- [ ] Append failing tests to `test/apartment-view-card-editor.test.ts`:
```ts
describe('apartment-view-card-editor: zones', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  async function mountWithZones() {
    const el = document.createElement('apartment-view-card-editor') as any;
    el.hass = { states: {}, localize: (k: string) => k };
    el.setConfig({
      type: 'custom:apartment-view-card',
      images: { base: '/local/day.png' },
      entities: [],
      zones: [
        { name: 'Living', x: 5, y: 5, width: 40, height: 40 },
        { name: 'Kitchen', x: 50, y: 5, width: 30, height: 30 },
      ],
      options: {
        view: 'auto',
        lightStyle: 'lit',
        freePanZoom: true,
        zoomMax: 1.5,
        duskDawnOffsetMinutes: 60,
      },
    });
    document.body.appendChild(el);
    await el.updateComplete;
    return el;
  }

  it('renders one zone row per configured zone with a zone-form each', async () => {
    const el = await mountWithZones();
    expect(el.shadowRoot.querySelectorAll('.zone-row').length).toBe(2);
    expect(el.shadowRoot.querySelectorAll('ha-form.zone-form').length).toBe(2);
  });

  it('Add zone puts the preview into crosshair draw mode', async () => {
    const el = await mountWithZones();
    (el.shadowRoot.querySelector('.add-zone') as HTMLElement).click();
    await el.updateComplete;
    expect((el.shadowRoot.querySelector('preview-canvas') as any).drawingZone).toBe(true);
  });

  it('preview-zone-drawn appends a zone, exits draw mode, fires config-changed', async () => {
    const el = await mountWithZones();
    (el.shadowRoot.querySelector('.add-zone') as HTMLElement).click();
    await el.updateComplete;
    let fired: any = null;
    el.addEventListener('config-changed', (e: CustomEvent) => (fired = e.detail.config));
    const preview = el.shadowRoot.querySelector('preview-canvas') as HTMLElement;
    preview.dispatchEvent(
      new CustomEvent('preview-zone-drawn', {
        detail: { x: 12, y: 15, width: 22, height: 18 },
        bubbles: true,
        composed: true,
      })
    );
    await el.updateComplete;
    expect(fired.zones.length).toBe(3);
    expect(fired.zones[2]).toMatchObject({ x: 12, y: 15, width: 22, height: 18 });
    expect((el.shadowRoot.querySelector('preview-canvas') as any).drawingZone).toBe(false);
  });

  it('preview-zone-draw-cancelled just exits draw mode (no new zone)', async () => {
    const el = await mountWithZones();
    (el.shadowRoot.querySelector('.add-zone') as HTMLElement).click();
    await el.updateComplete;
    let fired: any = null;
    el.addEventListener('config-changed', (e: CustomEvent) => (fired = e.detail.config));
    const preview = el.shadowRoot.querySelector('preview-canvas') as HTMLElement;
    preview.dispatchEvent(
      new CustomEvent('preview-zone-draw-cancelled', {
        detail: {},
        bubbles: true,
        composed: true,
      })
    );
    await el.updateComplete;
    expect(fired).toBeNull();
    expect((el.shadowRoot.querySelector('preview-canvas') as any).drawingZone).toBe(false);
  });

  it('Remove zone drops that index and fires config-changed', async () => {
    const el = await mountWithZones();
    let fired: any = null;
    el.addEventListener('config-changed', (e: CustomEvent) => (fired = e.detail.config));
    (el.shadowRoot.querySelectorAll('.remove-zone')[0] as HTMLElement).click();
    expect(fired.zones.length).toBe(1);
    expect(fired.zones[0].name).toBe('Kitchen');
  });

  it('editing a zone form re-nests x/y/w/h and fires config-changed', async () => {
    const el = await mountWithZones();
    let fired: any = null;
    el.addEventListener('config-changed', (e: CustomEvent) => (fired = e.detail.config));
    const form = el.shadowRoot.querySelectorAll('ha-form.zone-form')[0] as any;
    form.dispatchEvent(
      new CustomEvent('value-changed', {
        detail: { value: { ...form.data, name: 'Lounge', width: 55 } },
        bubbles: true,
        composed: true,
      })
    );
    expect(fired.zones[0].name).toBe('Lounge');
    expect(fired.zones[0].width).toBe(55);
  });

  it('move-down reorders zones', async () => {
    const el = await mountWithZones();
    let fired: any = null;
    el.addEventListener('config-changed', (e: CustomEvent) => (fired = e.detail.config));
    (el.shadowRoot.querySelectorAll('.zone-down')[0] as HTMLElement).click();
    expect(fired.zones.map((z: any) => z.name)).toEqual(['Kitchen', 'Living']);
  });
});
```

- [ ] Run and expect fail:
```
npx vitest run test/apartment-view-card-editor.test.ts -t "renders one zone row per configured zone"
```
Expected failure: `querySelectorAll('.zone-row')` length 0 ≠ 2 — no zones section yet.

- [ ] Add the zones imports to the existing `editor-helpers` import in `src/editor/apartment-view-card-editor.ts` (extend the import list):
```ts
import {
  imagesOptionsSchema,
  entitySchema,
  entityToForm,
  formToEntity,
  defaultEntity,
  isDirectional,
  zoneSchema,
  defaultZone,
} from './editor-helpers';
```
And extend the config types import:
```ts
import {
  normalizeConfig,
  type ApartmentViewConfig,
  type EntityConfig,
  type ZoneConfig,
} from '../core/config';
```

- [ ] Add a `_drawingZone` state field next to `_selectedEntity`:
```ts
  @state() private _drawingZone = false;
```

- [ ] Append zones styles to the `static styles` css block (before the closing backtick):
```css
    .zone-row {
      border: 1px solid var(--divider-color);
      border-radius: 8px;
      padding: 8px;
      margin-bottom: 8px;
    }
    .zone-actions {
      display: flex;
      gap: 4px;
      margin-left: auto;
    }
```

- [ ] Add the zones helper methods to the class body (after the entities methods):
```ts
  private _commitZones(zones: ZoneConfig[]): void {
    const config: ApartmentViewConfig = { ...this._config, zones };
    this._config = config;
    fireEvent(this, 'config-changed', { config });
  }

  private _startDrawZone(): void {
    this._drawingZone = true;
  }

  private _onZoneDrawn(ev: CustomEvent): void {
    const rect = ev.detail as {
      x: number;
      y: number;
      width: number;
      height: number;
    };
    const base = defaultZone();
    const zone: ZoneConfig = {
      name: base.name,
      icon: base.icon,
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    };
    this._drawingZone = false;
    this._commitZones([...this._config.zones, zone]);
  }

  private _onZoneDrawCancelled(): void {
    this._drawingZone = false;
  }

  private _removeZone(index: number): void {
    this._commitZones(this._config.zones.filter((_, i) => i !== index));
  }

  private _moveZone(index: number, delta: number): void {
    const target = index + delta;
    if (target < 0 || target >= this._config.zones.length) return;
    const zones = [...this._config.zones];
    const [z] = zones.splice(index, 1);
    zones.splice(target, 0, z);
    this._commitZones(zones);
  }

  private _zoneLabel = (schema: { name: string }): string => {
    const labels: Record<string, string> = {
      name: 'Name',
      icon: 'Icon (optional)',
      x: 'X',
      y: 'Y',
      width: 'Width',
      height: 'Height',
    };
    return labels[schema.name] ?? schema.name;
  };

  private _onZoneChanged(ev: CustomEvent, index: number): void {
    ev.stopPropagation();
    const v = ev.detail.value as Partial<ZoneConfig>;
    const zones = this._config.zones.map((z, i) =>
      i === index ? { ...z, ...v } : z
    );
    this._commitZones(zones);
  }

  private _renderZones() {
    return html`
      <div class="section">
        <div class="section-title">Zones</div>
        ${this._config.zones.map(
          (z, i) => html`
            <div class="zone-row">
              <div class="row-header">
                <span class="row-title">${z.name}</span>
                <div class="zone-actions">
                  <ha-icon-button
                    class="zone-up"
                    .path=${'M7,15L12,10L17,15H7Z'}
                    @click=${() => this._moveZone(i, -1)}
                  ></ha-icon-button>
                  <ha-icon-button
                    class="zone-down"
                    .path=${'M7,10L12,15L17,10H7Z'}
                    @click=${() => this._moveZone(i, 1)}
                  ></ha-icon-button>
                  <ha-icon-button
                    class="remove-zone"
                    .path=${'M19,4H15.5L14.5,3H9.5L8.5,4H5V6H19M6,19A2,2 0 0,0 8,21H16A2,2 0 0,0 18,19V7H6V19Z'}
                    @click=${() => this._removeZone(i)}
                  ></ha-icon-button>
                </div>
              </div>
              <ha-form
                class="zone-form"
                .hass=${this.hass}
                .data=${z}
                .schema=${zoneSchema()}
                .computeLabel=${this._zoneLabel}
                @value-changed=${(ev: CustomEvent) => this._onZoneChanged(ev, i)}
              ></ha-form>
            </div>
          `
        )}
        <ha-button class="add-zone" @click=${this._startDrawZone}>Add zone</ha-button>
      </div>
    `;
  }
```

- [ ] Wire the zones section + the draw-mode property/events into `render()`. Update the `<preview-canvas>` element and append `${this._renderZones()}`:
```ts
  protected render() {
    if (!this.hass || !this._config) {
      return html``;
    }
    return html`
      <preview-canvas
        .base=${this._config.images.base}
        .entities=${this._config.entities}
        .zones=${this._config.zones}
        .selectedEntity=${this._selectedEntity}
        .drawingZone=${this._drawingZone}
        @preview-entity-moved=${this._onPreviewEntityMoved}
        @preview-entity-selected=${this._onPreviewEntitySelected}
        @preview-zone-drawn=${this._onZoneDrawn}
        @preview-zone-draw-cancelled=${this._onZoneDrawCancelled}
      ></preview-canvas>
      <div class="section">
        <div class="section-title">Images &amp; options</div>
        <ha-form
          class="images-options"
          .hass=${this.hass}
          .data=${this._imagesOptionsData()}
          .schema=${imagesOptionsSchema()}
          .computeLabel=${this._imagesOptionsLabel}
          @value-changed=${this._onImagesOptionsChanged}
        ></ha-form>
      </div>
      ${this._renderEntities()}
      ${this._renderZones()}
    `;
  }
```

- [ ] Run and expect pass:
```
npx vitest run test/apartment-view-card-editor.test.ts -t "zones"
```
Expected: the 7 "zones" it blocks green.

- [ ] Run the full file to confirm no regressions:
```
npx vitest run test/apartment-view-card-editor.test.ts
```
Expected: all blocks (images+options, entities, zones) green.

- [ ] Commit:
```
git add src/editor/apartment-view-card-editor.ts test/apartment-view-card-editor.test.ts && git commit -m "feat(editor): zones list with crosshair draw, per-zone form, reorder/remove"
```

---

### Task 6.8: wire getConfigElement / getStubConfig onto the card
**Files:**
- Modify: `src/apartment-view-card.ts`
- Test: `test/card-config-element.test.ts`

**Interfaces:**
Consumes: `ApartmentViewConfig`, `normalizeConfig` (from `src/core/config.ts`); the registered `apartment-view-card-editor` element (from `./editor/apartment-view-card-editor`).
Produces (static on the card class):
- `static getConfigElement(): HTMLElement` — returns a fresh `apartment-view-card-editor` element (side-effect import ensures it is registered).
- `static getStubConfig(): ApartmentViewConfig` — a minimal valid v2 config (`images.base` set; empty `entities`/`zones`; default `options`). Must pass `normalizeConfig` without throwing.

Steps:

- [ ] Write failing test `test/card-config-element.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import '../src/apartment-view-card';
import { normalizeConfig } from '../src/core/config';

describe('apartment-view-card config element + stub', () => {
  it('getConfigElement returns the editor element', () => {
    const Card = customElements.get('apartment-view-card') as any;
    const el = Card.getConfigElement();
    expect(el).toBeInstanceOf(HTMLElement);
    expect(el.localName).toBe('apartment-view-card-editor');
  });

  it('the editor custom element is registered as a side effect', () => {
    expect(customElements.get('apartment-view-card-editor')).toBeDefined();
  });

  it('getStubConfig returns a valid v2 config that normalizeConfig accepts', () => {
    const Card = customElements.get('apartment-view-card') as any;
    const stub = Card.getStubConfig();
    expect(stub.type).toContain('apartment-view-card');
    expect(stub.images.base).toBeTruthy();
    expect(Array.isArray(stub.entities)).toBe(true);
    expect(Array.isArray(stub.zones)).toBe(true);
    expect(() => normalizeConfig(stub)).not.toThrow();
  });

  it('getStubConfig options carry the documented defaults', () => {
    const Card = customElements.get('apartment-view-card') as any;
    const stub = Card.getStubConfig();
    expect(stub.options.view).toBe('auto');
    expect(stub.options.lightStyle).toBe('lit');
    expect(stub.options.zoomMax).toBe(1.5);
    expect(stub.options.duskDawnOffsetMinutes).toBe(60);
    expect(stub.options.freePanZoom).toBe(true);
  });
});
```

- [ ] Run and expect fail:
```
npx vitest run test/card-config-element.test.ts -t "getConfigElement returns the editor element"
```
Expected failure: either `getStubConfig` returns the legacy v1 shape (no `images.base`, has `allLightsImage`) so the v2 assertions fail, or `apartment-view-card-editor` is not registered / `getConfigElement` returns the wrong element. (The exact message depends on the card state at this point in the rewrite; the assertion that fails first is `el.localName` ≠ `apartment-view-card-editor` or `stub.images.base` is undefined.)

- [ ] Ensure the card imports the editor for its registration side effect. Add ONLY the side-effect import near the top of `src/apartment-view-card.ts`, merged into the existing import block:
```ts
import './editor/apartment-view-card-editor';
```
> `normalizeConfig` and `ApartmentViewConfig` are already imported in `src/apartment-view-card.ts` from Phase 2 Task 2.5 (`import { normalizeConfig, type ApartmentViewConfig } from './core/config';`). Do NOT re-import them here — a duplicate import fails compilation.

- [ ] Replace the card's static `getConfigElement` / `getStubConfig` with the v2 versions:
```ts
  static getConfigElement(): HTMLElement {
    return document.createElement('apartment-view-card-editor');
  }

  static getStubConfig(): ApartmentViewConfig {
    return normalizeConfig({
      type: 'custom:apartment-view-card',
      images: { base: '/local/apartment/day.png' },
      entities: [],
      zones: [],
      options: {
        view: 'auto',
        lightStyle: 'lit',
        freePanZoom: true,
        zoomMax: 1.5,
        duskDawnOffsetMinutes: 60,
      },
    });
  }
```

> If the card body still references the legacy editor import (`import { ApartmentViewCardEditor } from "./ApartmentViewCardEditor"`) or registers the old editor at the bottom of the file, remove those lines — the side-effect `import './editor/apartment-view-card-editor'` is now the single registration path. (The legacy `src/ApartmentViewCardEditor.ts` is dead after this phase and is deleted in Phase 7 cleanup, or here if it is already unreferenced.)

- [ ] Run and expect pass:
```
npx vitest run test/card-config-element.test.ts
```
Expected: all 4 it blocks green.

- [ ] Commit:
```
git add src/apartment-view-card.ts test/card-config-element.test.ts && git commit -m "feat(card): wire getConfigElement to v2 editor + v2 getStubConfig"
```

---

### Task 6.9: phase verification — full editor + card suite green; manual harness smoke
**Files:**
- Test: run existing files (no new test file)
- Modify (only if a cross-file regression surfaces): the file the regression points at.

**Interfaces:** Consumes: everything produced in 6.1–6.8. Produces: nothing new — this is the phase gate.

Steps:

- [ ] Run the complete Phase 6 test surface and expect all green:
```
npx vitest run test/editor-helpers.test.ts test/preview-geometry.test.ts test/preview-canvas.test.ts test/apartment-view-card-editor.test.ts test/card-config-element.test.ts
```
Expected: 5 files, 0 failures.

- [ ] Run the full repo test suite to confirm Phase 6 did not regress earlier phases:
```
npx vitest run
```
Expected: 0 failures across all test files.

- [ ] Type-check the editor + preview modules (no `any`-leak / signature drift against the contract):
```
npx tsc --noEmit
```
Expected: no errors. (If `ha-form`/`ha-icon-button`/`ha-button` JSX-less template usages trip the checker, they are runtime HA elements with no local typings — confirm the only diagnostics, if any, are pre-existing and unrelated to `src/editor/*`; otherwise fix in the offending editor file.)

- [ ] Manual smoke in the dev harness (uses the Vite mock-hass from Phase 1c): start the dev server and confirm the editor renders end-to-end:
```
npm run dev
```
Then in a browser at the dev URL, mount the card's editor (the harness exposes `apartment-view-card.getConfigElement()`); verify: images+options form shows, "Add entity" adds a marker, dragging a marker moves the X slider live, the directional toggle reveals/hides the orientation slider, "Add zone" → crosshair → drawing a rectangle adds a zone. (Visual confirmation only; no assertion — the automated coverage is in 6.1–6.8.)

- [ ] No code commit if everything was already green. If a regression was fixed, commit it:
```
git add -A && git commit -m "test(editor): phase 6 verification fixes"
```
```

The above is my complete Phase 6 output. Key files produced: `/Users/matej/Work/Matej/ha-apartment-view-card/src/editor/editor-helpers.ts`, `/Users/matej/Work/Matej/ha-apartment-view-card/src/editor/preview-geometry.ts`, `/Users/matej/Work/Matej/ha-apartment-view-card/src/editor/preview-canvas.ts`, `/Users/matej/Work/Matej/ha-apartment-view-card/src/editor/apartment-view-card-editor.ts`, and modifications to `/Users/matej/Work/Matej/ha-apartment-view-card/src/apartment-view-card.ts`.

## Phase 7: Tests, docs, release

This phase assumes Phases 1–6 have landed the new structure: `src/apartment-view-card.ts` orchestrator, `src/core/{config,light-color,entity-state,geometry}.ts`, `src/render/{base-layer,light-layer,effect-layer,marker-overlay,zone-controls}.ts`, `src/editor/*`, `dev/mock-hass.ts` + `dev/index.html`, Vite lib build to `dist/apartment-view-card.js`, ESLint/Prettier, and a Vitest browser config. Phase 7 rounds out the Tier 2 component test suite reusing the mock-`hass` factory, rewrites the README for the new schema, finalizes `hacs.json` + GitHub release notes, and proves the build/lint/test gate is green.

If any prerequisite file is missing when you start a task, that is a signal an earlier phase is incomplete — stop and report rather than stubbing it here.

---

### Task 7.1: Shared test mock-hass factory and component-test harness helper

**Files:**
- Create `test/helpers/mock-hass.ts`
- Create `test/helpers/render.ts`
- Test (self-verifying): `test/helpers/mock-hass.test.ts`
- Modify (only if a new test file is missing from a project glob): the `test` block in `vite.config.ts` (the single Vitest config from Phase 1 — node + browser projects; do NOT create a separate `vitest.config.ts`)

**Interfaces:** Consumes: `HassEntity` (from `src/core/ha-types.ts`), `ApartmentViewConfig`, `EntityConfig`, `normalizeConfig`. Produces:
- `function makeLight(opts?: Partial<{ entity_id: string; state: string; brightness: number; rgb_color: [number,number,number]; rgbw_color: [number,number,number,number]; hs_color: [number,number]; xy_color: [number,number]; color_temp_kelvin: number; color_temp: number }>): HassEntity`
- `function makeMediaPlayer(opts?: Partial<{ entity_id: string; state: string }>): HassEntity`
- `function makeClimate(opts?: Partial<{ entity_id: string; state: string; hvac_action: string }>): HassEntity`
- `function makeSun(opts?: Partial<{ next_rising: string; next_setting: string; elevation: number }>): HassEntity`
- `interface MockHass { states: Record<string, HassEntity>; callService: (domain: string, service: string, data: any) => void; calls: Array<{ domain: string; service: string; data: any }>; }`
- `function makeHass(entities?: HassEntity[]): MockHass`
- `function mountCard(config: ApartmentViewConfig, hass: MockHass): Promise<HTMLElement>` (in `render.ts`)

**Why this exists:** The spec (§8 Tier 2) mandates that component tests reuse "the mock-`hass` factory." Phase 1c built `dev/mock-hass.ts` for the *runtime control panel*; that file is wired to DOM controls and is not import-clean for tests. This task extracts a pure, dependency-free factory under `test/helpers/` so tests are deterministic and don't drag the dev harness UI in. Keep the shapes identical to what `dev/mock-hass.ts` emits.

Steps:

- [ ] Confirm the Vitest config (the `test` block in `vite.config.ts` from Phase 1 Task 1.3 — there is NO separate `vitest.config.ts`) already defines the two projects with browser mode. Do NOT create a `vitest.config.ts` (Vitest would prefer it and silently drop the dev-server-aware `test.root`/`include` from `vite.config.ts`). EDIT the existing `vite.config.ts` `test` block only if a needed test file is missing from a project `include` glob. The `browser` project must read:
```ts
        // inside vite.config.ts -> test.projects[browser].test
        browser: {
          enabled: true,
          provider: 'playwright',
          headless: true,
          instances: [{ browser: 'chromium' }],
        },
```
This task's new files — `test/helpers/mock-hass.test.ts` (pure-logic → `node` project) and any card-mount DOM tests written via `mountCard` (→ `browser` project) — must appear in the matching project's `include` glob.

- [ ] Write the failing self-test `test/helpers/mock-hass.test.ts` (full code):
```ts
import { describe, it, expect } from 'vitest';
import { makeLight, makeMediaPlayer, makeClimate, makeSun, makeHass } from './mock-hass';

describe('mock-hass factory', () => {
  it('builds a light with defaults and brightness', () => {
    const l = makeLight({ entity_id: 'light.k', state: 'on', brightness: 128 });
    expect(l.entity_id).toBe('light.k');
    expect(l.state).toBe('on');
    expect(l.attributes.brightness).toBe(128);
  });

  it('builds media_player and climate', () => {
    expect(makeMediaPlayer({ state: 'playing' }).state).toBe('playing');
    expect(makeClimate({ hvac_action: 'cooling' }).attributes.hvac_action).toBe('cooling');
  });

  it('builds sun with rising/setting attributes', () => {
    const s = makeSun({ next_rising: '2026-06-25T05:00:00+00:00' });
    expect(s.entity_id).toBe('sun.sun');
    expect(s.attributes.next_rising).toBe('2026-06-25T05:00:00+00:00');
  });

  it('makeHass indexes states by entity_id and records callService', () => {
    const hass = makeHass([makeLight({ entity_id: 'light.a' })]);
    expect(hass.states['light.a']).toBeDefined();
    hass.callService('homeassistant', 'toggle', { entity_id: 'light.a' });
    expect(hass.calls).toEqual([
      { domain: 'homeassistant', service: 'toggle', data: { entity_id: 'light.a' } },
    ]);
  });
});
```

- [ ] Run and expect failure (module not found):
```
npx vitest run test/helpers/mock-hass.test.ts -t "mock-hass factory"
```
Expected: `Failed to resolve import "./mock-hass"` (or `Cannot find module`).

- [ ] Implement `test/helpers/mock-hass.ts` (full code):
```ts
import type { HassEntity } from '../../src/core/ha-types';

function entity(
  entity_id: string,
  state: string,
  attributes: Record<string, unknown> = {},
): HassEntity {
  return {
    entity_id,
    state,
    attributes,
  };
}

export function makeLight(
  opts: Partial<{
    entity_id: string;
    state: string;
    brightness: number;
    rgb_color: [number, number, number];
    rgbw_color: [number, number, number, number];
    rgbww_color: [number, number, number, number, number];
    hs_color: [number, number];
    xy_color: [number, number];
    color_temp_kelvin: number;
    color_temp: number;
  }> = {},
): HassEntity {
  const { entity_id = 'light.test', state = 'on', ...attrs } = opts;
  return entity(entity_id, state, { ...attrs });
}

export function makeMediaPlayer(
  opts: Partial<{ entity_id: string; state: string; device_class: string }> = {},
): HassEntity {
  const { entity_id = 'media_player.test', state = 'playing', ...attrs } = opts;
  return entity(entity_id, state, { ...attrs });
}

export function makeClimate(
  opts: Partial<{ entity_id: string; state: string; hvac_action: string }> = {},
): HassEntity {
  const { entity_id = 'climate.test', state = 'cool', ...attrs } = opts;
  return entity(entity_id, state, { ...attrs });
}

export function makeSun(
  opts: Partial<{ next_rising: string; next_setting: string; elevation: number }> = {},
): HassEntity {
  const {
    next_rising = '2026-06-25T05:00:00+00:00',
    next_setting = '2026-06-25T21:00:00+00:00',
    elevation = 30,
  } = opts;
  return entity('sun.sun', elevation > 0 ? 'above_horizon' : 'below_horizon', {
    next_rising,
    next_setting,
    elevation,
  });
}

export interface MockHass {
  states: Record<string, HassEntity>;
  callService: (domain: string, service: string, data: unknown) => void;
  calls: Array<{ domain: string; service: string; data: unknown }>;
}

export function makeHass(entities: HassEntity[] = []): MockHass {
  const states: Record<string, HassEntity> = {};
  for (const e of entities) states[e.entity_id] = e;
  const calls: MockHass['calls'] = [];
  return {
    states,
    calls,
    callService(domain, service, data) {
      calls.push({ domain, service, data });
    },
  };
}
```

- [ ] Run and expect pass:
```
npx vitest run test/helpers/mock-hass.test.ts -t "mock-hass factory"
```
Expected: `4 passed`.

- [ ] Implement the card-mount helper `test/helpers/render.ts` (full code). It imports the built card module so `customElements.define('apartment-view-card', …)` runs, mounts it into `document.body`, assigns `config` via `setConfig` and `hass`, waits for the first `updateComplete`, and returns the element:
```ts
import '../../src/apartment-view-card';
import type { ApartmentViewConfig } from '../../src/core/config';
import type { MockHass } from './mock-hass';

interface CardElement extends HTMLElement {
  setConfig(config: ApartmentViewConfig): void;
  hass: MockHass;
  updateComplete: Promise<boolean>;
}

export async function mountCard(
  config: ApartmentViewConfig,
  hass: MockHass,
): Promise<CardElement> {
  const el = document.createElement('apartment-view-card') as CardElement;
  el.setConfig(config);
  el.hass = hass;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}
```

- [ ] Commit:
```
git add test/helpers/mock-hass.ts test/helpers/render.ts test/helpers/mock-hass.test.ts vite.config.ts && git commit -m "test: add shared mock-hass factory and card-mount helper"
```

---

### Task 7.2: `resolveLightColor` mode-coverage tests

**Files:**
- Test: `test/light-color.test.ts`
- Modify only if a bug surfaces: `src/core/light-color.ts`

**Interfaces:** Consumes: `resolveLightColor`, `kelvinToRgb`, `hsToRgb`, `xyToRgb`, `rgbCss`, `Rgb`, `makeLight`. Produces: none.

**Why this exists:** §10 lists the v1 `_calculateColor` bug — only `rgb_color` was read, every other mode fell through to warm-white. These tests pin the full priority chain from the contract: `rgb_color → rgbw/rgbww → hs_color → xy_color → color_temp_kelvin → color_temp(mireds k=1e6/mireds) → #fffae6 (255,250,230)`.

Steps:

- [ ] Write the failing test `test/light-color.test.ts` (full code):
```ts
import { describe, it, expect } from 'vitest';
import {
  resolveLightColor,
  kelvinToRgb,
  hsToRgb,
  xyToRgb,
  rgbCss,
} from '../src/core/light-color';
import { makeLight } from './helpers/mock-hass';

describe('resolveLightColor priority chain', () => {
  it('prefers rgb_color when present', () => {
    const c = resolveLightColor(makeLight({ rgb_color: [10, 20, 30] }));
    expect(c).toEqual({ r: 10, g: 20, b: 30 });
  });

  it('uses RGB channels of rgbw_color', () => {
    const c = resolveLightColor(makeLight({ rgbw_color: [40, 50, 60, 200] }));
    expect(c).toEqual({ r: 40, g: 50, b: 60 });
  });

  it('uses RGB channels of rgbww_color', () => {
    const c = resolveLightColor(makeLight({ rgbww_color: [70, 80, 90, 10, 20] }));
    expect(c).toEqual({ r: 70, g: 80, b: 90 });
  });

  it('falls to hs_color when no rgb present', () => {
    const c = resolveLightColor(makeLight({ hs_color: [0, 100] }));
    expect(c).toEqual({ r: 255, g: 0, b: 0 });
  });

  it('falls to xy_color', () => {
    const c = resolveLightColor(makeLight({ xy_color: [0.3, 0.3] }));
    expect(c.r).toBeGreaterThanOrEqual(0);
    expect(c.r).toBeLessThanOrEqual(255);
    expect(c.g).toBeLessThanOrEqual(255);
    expect(c.b).toBeLessThanOrEqual(255);
  });

  it('uses color_temp_kelvin', () => {
    const c = resolveLightColor(makeLight({ color_temp_kelvin: 6600 }));
    const k = kelvinToRgb(6600);
    expect(c).toEqual(k);
  });

  it('converts color_temp mireds via k = 1e6 / mireds', () => {
    const c = resolveLightColor(makeLight({ color_temp: 250 }));
    expect(c).toEqual(kelvinToRgb(1e6 / 250));
  });

  it('defaults to warm white #fffae6 when no color attributes', () => {
    const c = resolveLightColor(makeLight({}));
    expect(c).toEqual({ r: 255, g: 250, b: 230 });
  });
});

describe('color conversion units', () => {
  it('hsToRgb red at hue 0 sat 100', () => {
    expect(hsToRgb(0, 100)).toEqual({ r: 255, g: 0, b: 0 });
  });

  it('kelvinToRgb clamps each channel into [0,255]', () => {
    for (const k of [1000, 4000, 6600, 10000]) {
      const c = kelvinToRgb(k);
      for (const v of [c.r, c.g, c.b]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(255);
      }
    }
  });

  it('xyToRgb returns in-range channels', () => {
    const c = xyToRgb(0.45, 0.41);
    for (const v of [c.r, c.g, c.b]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(255);
    }
  });

  it('rgbCss formats as "rgb(r, g, b)"', () => {
    expect(rgbCss({ r: 1, g: 2, b: 3 })).toBe('rgb(1, 2, 3)');
  });
});
```

- [ ] Run and expect pass (the implementation already exists from Phase 2):
```
npx vitest run test/light-color.test.ts -t "resolveLightColor priority chain"
```
Expected: all assertions pass. **If `hsToRgb(0,100)` does not equal `{r:255,g:0,b:0}` or the mireds case fails**, the bug is real — fix `src/core/light-color.ts` to satisfy the contract (do NOT loosen the test), then re-run. Then run the full file:
```
npx vitest run test/light-color.test.ts
```
Expected: `12 passed`.

- [ ] Commit:
```
git add test/light-color.test.ts src/core/light-color.ts && git commit -m "test: cover resolveLightColor across all HA color modes"
```

---

### Task 7.3: `intensity` → opacity and `isActive` entity-state tests

**Files:**
- Test: `test/entity-state.test.ts`
- Modify only if a bug surfaces: `src/core/entity-state.ts`

**Interfaces:** Consumes: `isActive`, `intensity`, `iconForEntity`, `EntityConfig`, `makeLight`, `makeMediaPlayer`, `makeClimate`. Produces: none.

**Why this exists:** §4 conventions: brightness is normalized `HA brightness/255`, off/absent = 0, clamp [0,1]. The light-layer opacity formulas (`lit` image `0.4 + 0.4·b`, `glow` `0.4 + 0.55·b`, `reveal` `= b`) all consume `intensity()`, so this is the upstream value the overlay-opacity test (7.5) depends on. Also pins the `isActive` domain rules used to gate effects.

Steps:

- [ ] Write the failing test `test/entity-state.test.ts` (full code):
```ts
import { describe, it, expect } from 'vitest';
import { isActive, intensity, iconForEntity } from '../src/core/entity-state';
import type { EntityConfig } from '../src/core/config';
import { makeLight, makeMediaPlayer, makeClimate } from './helpers/mock-hass';

const baseCfg: EntityConfig = {
  entity: 'light.test',
  x: 50,
  y: 50,
  size: 'small',
  tap: 'toggle',
  orientation: null,
};

describe('intensity (normalized brightness)', () => {
  it('returns 0 when light is off', () => {
    expect(intensity(makeLight({ state: 'off', brightness: 200 }))).toBe(0);
  });

  it('returns 1 when brightness attribute absent', () => {
    expect(intensity(makeLight({ state: 'on' }))).toBe(1);
  });

  it('maps brightness 255 -> 1', () => {
    expect(intensity(makeLight({ state: 'on', brightness: 255 }))).toBe(1);
  });

  it('maps brightness 128 -> ~0.502', () => {
    expect(intensity(makeLight({ state: 'on', brightness: 128 }))).toBeCloseTo(128 / 255, 5);
  });

  it('clamps into [0,1]', () => {
    const v = intensity(makeLight({ state: 'on', brightness: 999 }));
    expect(v).toBeLessThanOrEqual(1);
    expect(v).toBeGreaterThanOrEqual(0);
  });
});

describe('isActive', () => {
  it('light on is active, off is not', () => {
    expect(isActive(makeLight({ state: 'on' }))).toBe(true);
    expect(isActive(makeLight({ state: 'off' }))).toBe(false);
  });

  it('media_player playing active; off/idle/unavailable not', () => {
    expect(isActive(makeMediaPlayer({ state: 'playing' }))).toBe(true);
    expect(isActive(makeMediaPlayer({ state: 'off' }))).toBe(false);
    expect(isActive(makeMediaPlayer({ state: 'idle' }))).toBe(false);
    expect(isActive(makeMediaPlayer({ state: 'unavailable' }))).toBe(false);
  });

  it('climate active unless hvac off/idle', () => {
    expect(isActive(makeClimate({ state: 'cool' }))).toBe(true);
    expect(isActive(makeClimate({ state: 'off' }))).toBe(false);
    expect(isActive(makeClimate({ state: 'idle' }))).toBe(false);
  });
});

describe('iconForEntity', () => {
  it('uses configured icon first', () => {
    expect(iconForEntity(makeLight({}), { ...baseCfg, icon: 'mdi:ceiling-light' })).toBe(
      'mdi:ceiling-light',
    );
  });

  it('falls back to a non-empty default when no icon configured', () => {
    const out = iconForEntity(makeLight({}), baseCfg);
    expect(typeof out).toBe('string');
    expect(out.startsWith('mdi:')).toBe(true);
  });
});
```

- [ ] Run and expect pass (implementation exists from Phase 2):
```
npx vitest run test/entity-state.test.ts
```
Expected: all pass. **If `intensity` does not clamp >255 to 1 or returns non-zero for `state:'off'`**, fix `src/core/entity-state.ts` per the contract, then re-run. Expected final: `10 passed`.

- [ ] Commit:
```
git add test/entity-state.test.ts src/core/entity-state.ts && git commit -m "test: cover intensity normalization and isActive domain rules"
```

---

### Task 7.4: `geometry` tests — `zoomToZone`, fractions, halo, marker pos

**Files:**
- Test: `test/geometry.test.ts`
- Modify only if a bug surfaces: `src/core/geometry.ts`

**Interfaces:** Consumes: `zoomToZone`, `sizeTierFraction`, `haloRadiusPx`, `markerScreenPos`, `Viewport`, `ZoomTransform`, `ZoneConfig`. Produces: none.

**Why this exists:** §5 zoom math and §6 marker mapping are pure geometry — the most leverage-per-test in the suite. Pins: scale capped at `maxScale` and at viewport-fit; pan clamps the view inside image bounds; the five size-tier fractions; the halo formula `sizeTierFraction·cardWidth·(0.45+0.55·b)`; and `markerScreenPos = (xPct/100·W·scale+panX, yPct/100·H·scale+panY)`.

Steps:

- [ ] Write the failing test `test/geometry.test.ts` (full code):
```ts
import { describe, it, expect } from 'vitest';
import {
  zoomToZone,
  sizeTierFraction,
  haloRadiusPx,
  markerScreenPos,
} from '../src/core/geometry';
import type { ZoneConfig, Viewport, ZoomTransform } from '../src/core/geometry';

const vp: Viewport = { width: 1000, height: 800 };
const zone: ZoneConfig = { name: 'Living', x: 50, y: 50, width: 40, height: 40 };

describe('zoomToZone', () => {
  it('never exceeds maxScale', () => {
    const t = zoomToZone({ name: 'tiny', x: 50, y: 50, width: 5, height: 5 }, vp, 1.5);
    expect(t.scale).toBeLessThanOrEqual(1.5);
  });

  it('uses fit scale when the zone fits below maxScale (no letterboxing)', () => {
    // zone is 40% wide, 40% tall -> fit-by-width 100/40=2.5, fit-by-height 100/40=2.5
    // both above cap, so capped at maxScale
    const t = zoomToZone(zone, vp, 1.5);
    expect(t.scale).toBeCloseTo(1.5, 5);
  });

  it('a large zone yields the smaller fit scale, not the cap', () => {
    // zone 90% wide -> fit-by-width 100/90 ~= 1.111 < cap 1.5
    const wide: ZoneConfig = { name: 'wide', x: 50, y: 50, width: 90, height: 50 };
    const t = zoomToZone(wide, vp, 1.5);
    expect(t.scale).toBeCloseTo(100 / 90, 3);
  });

  it('clamps pan so the scaled image stays within viewport bounds', () => {
    const t = zoomToZone(zone, vp, 1.5);
    const scaledW = vp.width * t.scale;
    const scaledH = vp.height * t.scale;
    // top-left cannot be positive (would reveal gap on left/top)
    expect(t.panX).toBeLessThanOrEqual(0);
    expect(t.panY).toBeLessThanOrEqual(0);
    // bottom-right cannot be inside the viewport (would reveal gap on right/bottom)
    expect(t.panX + scaledW).toBeGreaterThanOrEqual(vp.width - 1e-6);
    expect(t.panY + scaledH).toBeGreaterThanOrEqual(vp.height - 1e-6);
  });
});

describe('sizeTierFraction', () => {
  it('matches the five-tier table', () => {
    expect(sizeTierFraction('tiny')).toBeCloseTo(0.09, 5);
    expect(sizeTierFraction('small')).toBeCloseTo(0.13, 5);
    expect(sizeTierFraction('medium')).toBeCloseTo(0.17, 5);
    expect(sizeTierFraction('large')).toBeCloseTo(0.22, 5);
    expect(sizeTierFraction('huge')).toBeCloseTo(0.28, 5);
  });
});

describe('haloRadiusPx', () => {
  it('= sizeTierFraction*cardWidth*(0.45+0.55*brightness)', () => {
    // medium 0.17, width 1000, brightness 0.5 -> 0.17*1000*(0.45+0.275)=0.17*1000*0.725=123.25
    expect(haloRadiusPx(1000, 'medium', 0.5)).toBeCloseTo(123.25, 3);
  });

  it('brightness 0 still gives the 0.45 floor', () => {
    expect(haloRadiusPx(1000, 'small', 0)).toBeCloseTo(0.13 * 1000 * 0.45, 3);
  });
});

describe('markerScreenPos', () => {
  it('maps percentage to screen px with scale and pan', () => {
    const t: ZoomTransform = { scale: 2, panX: 100, panY: -50 };
    // x 25% of W 1000 *2 +100 = 0.25*1000*2+100 = 600 ; y 10% of 800 *2 -50 = 110
    const p = markerScreenPos(25, 10, t, vp);
    expect(p.left).toBeCloseTo(600, 5);
    expect(p.top).toBeCloseTo(110, 5);
  });

  it('identity transform returns plain percentage position', () => {
    const t: ZoomTransform = { scale: 1, panX: 0, panY: 0 };
    const p = markerScreenPos(50, 50, t, vp);
    expect(p.left).toBeCloseTo(500, 5);
    expect(p.top).toBeCloseTo(400, 5);
  });
});
```

- [ ] Run and expect pass (implementation exists from Phase 5):
```
npx vitest run test/geometry.test.ts
```
Expected: all pass. **If a clamp or fit assertion fails**, the bug is in `zoomToZone` — fix `src/core/geometry.ts` against the contract semantics ("scale=min(maxScale, fit); center zone, clamp into image bounds"), then re-run. Expected final: `11 passed`.

- [ ] Commit:
```
git add test/geometry.test.ts src/core/geometry.ts && git commit -m "test: cover zoomToZone, size tiers, halo radius, marker mapping"
```

---

### Task 7.5: `config` normalization + zone membership tests (legacy migration)

**Files:**
- Test: `test/config.test.ts`
- Modify only if a bug surfaces: `src/core/config.ts`

**Interfaces:** Consumes: `normalizeConfig`, `zoneForPoint`, `ApartmentViewConfig`, `ZoneConfig`. Produces: none.

**Why this exists:** §10's headline v1 bug — `setConfig` dropped unknown keys (`columns`/`rows`, and would drop `zones`). This pins (a) legacy-key migration (`objects→entities`, `offsetX/Y→x/y`, `entityName→entity`, `customName→name`, `customIcon→icon`, `disableService→tap`), (b) unknown-key preservation, (c) throw when `images.base` missing, and (d) `zoneForPoint` smallest-area-wins. The README's "one re-paste" migration claim rests on this passing.

Steps:

- [ ] Write the failing test `test/config.test.ts` (full code). The legacy block mirrors the actual v1 README config so the migration is realistic:
```ts
import { describe, it, expect } from 'vitest';
import { normalizeConfig, zoneForPoint } from '../src/core/config';
import type { ZoneConfig } from '../src/core/config';

describe('normalizeConfig — legacy migration', () => {
  it('migrates objects[] to entities[] with renamed keys', () => {
    const cfg = normalizeConfig({
      type: 'custom:apartment-view-card',
      images: { base: '/local/day.png' },
      objects: [
        {
          offsetX: 52,
          offsetY: 72,
          size: 'small',
          customName: 'Bedroom ceiling',
          entityName: 'light.bar_1',
          customIcon: 'mdi:ceiling-light',
        },
        {
          offsetX: 54,
          offsetY: 46,
          size: 'small',
          customName: 'Living Room A/C',
          entityName: 'climate.living_room_a_c',
          customIcon: 'mdi:air-conditioner',
          disableService: true,
        },
      ],
    });
    expect(cfg.entities).toHaveLength(2);
    const a = cfg.entities[0];
    expect(a.entity).toBe('light.bar_1');
    expect(a.name).toBe('Bedroom ceiling');
    expect(a.icon).toBe('mdi:ceiling-light');
    expect(a.x).toBe(52);
    expect(a.y).toBe(72);
    expect(a.tap).toBe('toggle');
    // disableService:true -> tap 'none'
    expect(cfg.entities[1].tap).toBe('none');
  });

  it('fills entity defaults (size, tap, orientation null)', () => {
    const cfg = normalizeConfig({
      images: { base: '/b.png' },
      entities: [{ entity: 'light.x', x: 10, y: 20 }],
    });
    const e = cfg.entities[0];
    expect(e.size).toBe('medium');
    expect(e.tap).toBe('toggle');
    expect(e.orientation).toBeNull();
  });

  it('fills options defaults', () => {
    const cfg = normalizeConfig({ images: { base: '/b.png' } });
    expect(cfg.options.view).toBe('auto');
    expect(cfg.options.lightStyle).toBe('lit');
    expect(cfg.options.freePanZoom).toBe(true);
    expect(cfg.options.zoomMax).toBe(1.5);
    expect(cfg.options.duskDawnOffsetMinutes).toBe(60);
  });

  it('preserves unknown keys (the v1 columns/rows + grid_options bug)', () => {
    const cfg = normalizeConfig({
      images: { base: '/b.png' },
      entities: [],
      view_layout: { position: 'main' },
      grid_options: { rows: 8, columns: 18 },
    }) as Record<string, unknown>;
    expect(cfg.view_layout).toEqual({ position: 'main' });
    expect(cfg.grid_options).toEqual({ rows: 8, columns: 18 });
  });

  it('preserves zones array', () => {
    const zones = [{ name: 'Living', x: 50, y: 50, width: 40, height: 40 }];
    const cfg = normalizeConfig({ images: { base: '/b.png' }, zones });
    expect(cfg.zones).toHaveLength(1);
    expect(cfg.zones[0].name).toBe('Living');
  });

  it('throws when images.base is missing', () => {
    expect(() => normalizeConfig({ images: {} })).toThrow();
    expect(() => normalizeConfig({})).toThrow();
  });
});

describe('zoneForPoint — smallest-area wins', () => {
  const big: ZoneConfig = { name: 'big', x: 50, y: 50, width: 80, height: 80 };
  const small: ZoneConfig = { name: 'small', x: 50, y: 50, width: 20, height: 20 };

  it('returns the smaller-area zone when both contain the point', () => {
    const z = zoneForPoint(50, 50, [big, small]);
    expect(z?.name).toBe('small');
  });

  it('order-independent (smaller still wins when listed first)', () => {
    const z = zoneForPoint(50, 50, [small, big]);
    expect(z?.name).toBe('small');
  });

  it('returns the only containing zone', () => {
    // point at x=15 is inside big (50±40 => 10..90) but outside small (50±10 => 40..60)
    const z = zoneForPoint(15, 50, [big, small]);
    expect(z?.name).toBe('big');
  });

  it('returns null when no zone contains the point', () => {
    expect(zoneForPoint(99, 99, [small])).toBeNull();
  });
});
```

- [ ] Run and expect pass (implementation exists from Phase 1b):
```
npx vitest run test/config.test.ts
```
Expected: all pass. **If `disableService:true` does not map to `tap:'none'`, or unknown keys are dropped, or `zoneForPoint` picks the larger zone**, fix `src/core/config.ts` against the contract, then re-run. Expected final: `10 passed`.

- [ ] Commit:
```
git add test/config.test.ts src/core/config.ts && git commit -m "test: cover config legacy migration, unknown-key preservation, zone membership"
```

---

### Task 7.6: Component test — markers render at correct `%` and `homeassistant.toggle` fires on tap

**Files:**
- Test: `test/marker-overlay.dom.test.ts`
- Modify only if a bug surfaces: `src/render/marker-overlay.ts` or `src/apartment-view-card.ts`

**Interfaces:** Consumes: `mountCard`, `makeHass`, `makeLight`, `normalizeConfig`. Produces: none.

**Why this exists:** §8 Tier 2 explicitly requires "overlays at correct %" and "`homeassistant.toggle` fires on tap" as browser-mode component tests. This is the one task that mounts the real card (via `render.ts`) and reads the shadow DOM, exercising the two-layer overlay (§6) end to end. Markers carry `data-entity` and inline `left/top` in px; at identity transform with a known card width, `left = x/100·W`.

> Implementation note for the assertion to be stable: the marker overlay (Phase 3) must stamp each interactive marker with `data-entity="<entity_id>"`. If markers are not currently queryable by entity id, that is a missing test-affordance — add the `data-entity` attribute in `marker-overlay.ts` as the minimal implementation step below, then re-run.

Steps:

- [ ] Write the failing test `test/marker-overlay.dom.test.ts` (full code). It forces a deterministic card width via inline style and identity transform (no zone focus), then asserts marker screen position and toggle dispatch:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mountCard } from './helpers/render';
import { makeHass, makeLight } from './helpers/mock-hass';
import { normalizeConfig } from '../src/core/config';

function shadow(el: HTMLElement): ShadowRoot {
  const sr = el.shadowRoot;
  if (!sr) throw new Error('no shadowRoot');
  return sr;
}

describe('marker overlay DOM', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('positions a marker at x%/y% of the card width/height', async () => {
    const config = normalizeConfig({
      images: { base: '/local/base.png' },
      entities: [
        { entity: 'light.k', x: 25, y: 10, size: 'small', tap: 'toggle' },
      ],
    });
    const hass = makeHass([makeLight({ entity_id: 'light.k', state: 'off' })]);
    const el = await mountCard(config, hass);
    // Force a known, deterministic layout box.
    el.style.display = 'block';
    el.style.width = '1000px';
    el.style.height = '800px';
    (el as unknown as { requestUpdate(): void }).requestUpdate();
    await el.updateComplete;

    const marker = shadow(el).querySelector<HTMLElement>('[data-entity="light.k"]');
    expect(marker).toBeTruthy();
    const left = parseFloat(marker!.style.left);
    const top = parseFloat(marker!.style.top);
    // identity transform: left = 25% * 1000 = 250 ; top = 10% * 800 = 80
    expect(left).toBeCloseTo(250, 0);
    expect(top).toBeCloseTo(80, 0);
  });

  it('fires homeassistant.toggle with the entity id on tap', async () => {
    const config = normalizeConfig({
      images: { base: '/local/base.png' },
      entities: [
        { entity: 'light.k', x: 50, y: 50, size: 'small', tap: 'toggle' },
      ],
    });
    const hass = makeHass([makeLight({ entity_id: 'light.k', state: 'off' })]);
    const el = await mountCard(config, hass);

    const marker = shadow(el).querySelector<HTMLElement>('[data-entity="light.k"]');
    expect(marker).toBeTruthy();
    // A clean click below the 8px / 450ms thresholds = a tap.
    marker!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 0, clientY: 0 }));
    marker!.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 1, clientY: 1 }));
    await el.updateComplete;

    expect(hass.calls).toContainEqual({
      domain: 'homeassistant',
      service: 'toggle',
      data: { entity_id: 'light.k' },
    });
  });

  it('tap: none does not fire any service', async () => {
    const config = normalizeConfig({
      images: { base: '/local/base.png' },
      entities: [
        { entity: 'light.k', x: 50, y: 50, size: 'small', tap: 'none' },
      ],
    });
    const hass = makeHass([makeLight({ entity_id: 'light.k', state: 'off' })]);
    const el = await mountCard(config, hass);
    const marker = shadow(el).querySelector<HTMLElement>('[data-entity="light.k"]');
    marker!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 0, clientY: 0 }));
    marker!.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 1, clientY: 1 }));
    await el.updateComplete;
    expect(hass.calls).toHaveLength(0);
  });
});
```

- [ ] Run and expect failure:
```
npx vitest run test/marker-overlay.dom.test.ts -t "marker overlay DOM"
```
Expected first failure: `marker` is `null` because markers lack `data-entity` (or the tap path / threshold gating dispatches differently).

- [ ] Minimal implementation: in `src/render/marker-overlay.ts`, ensure each interactive marker button is rendered with `data-entity=${cfg.entity}` and that its inline style sets `left`/`top` in px from `markerScreenPos(...)`. The tap handler must invoke `hass.callService('homeassistant', 'toggle', { entity_id: cfg.entity })` only when `cfg.tap === 'toggle'` and the gesture is a tap (movement <8px, <450ms), and do nothing when `cfg.tap === 'none'`. Do not add new public exports. Example marker template fragment (adapt to the existing render structure — do NOT duplicate the overlay):
```ts
html`<button
  class="marker"
  data-entity=${cfg.entity}
  style="left:${pos.left}px; top:${pos.top}px; transform: translate(-50%, -50%) scale(${iconScale});"
  @pointerdown=${(e: PointerEvent) => this._onMarkerDown(e, cfg)}
  @pointerup=${(e: PointerEvent) => this._onMarkerUp(e, cfg)}
>
  <ha-icon .icon=${iconForEntity(state, cfg)}></ha-icon>
</button>`
```

- [ ] Run and expect pass:
```
npx vitest run test/marker-overlay.dom.test.ts
```
Expected: `3 passed`.

- [ ] Commit:
```
git add test/marker-overlay.dom.test.ts src/render/marker-overlay.ts src/apartment-view-card.ts && git commit -m "test: component test for marker positioning and toggle-on-tap"
```

---

### Task 7.7: Component test — light-layer overlay opacity tracks `intensity` per style

**Files:**
- Test: `test/light-layer.dom.test.ts`
- Modify only if a bug surfaces: `src/render/light-layer.ts`

**Interfaces:** Consumes: `mountCard`, `makeHass`, `makeLight`, `normalizeConfig`, `radialMask`, `coneMask`. Produces: none.

**Why this exists:** §4.1 tuning constants must hold at the DOM level — this is the "intensity→opacity" Tier 2 case. We verify the *rendered* opacity of the light overlay element for each style at known brightness, and verify the `lit`/`glow` radial mask is present and the cone mask appears only when `orientation` is set. Reuses the same `data-light="<entity_id>"` affordance pattern as 7.6.

> Implementation note: the light overlay element produced in `light-layer.ts` (Phase 2/4) must stamp `data-light="<entity_id>"` so the test can target it. If absent, add it as the minimal step below.

Steps:

- [ ] Write the failing test `test/light-layer.dom.test.ts` (full code). It also includes two pure-function checks for the mask string builders from the contract:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mountCard } from './helpers/render';
import { makeHass, makeLight } from './helpers/mock-hass';
import { normalizeConfig } from '../src/core/config';
import { radialMask, coneMask } from '../src/render/light-layer';

function lightEl(el: HTMLElement, id: string): HTMLElement {
  const sr = el.shadowRoot;
  if (!sr) throw new Error('no shadowRoot');
  const node = sr.querySelector<HTMLElement>(`[data-light="${id}"]`);
  if (!node) throw new Error(`no light overlay for ${id}`);
  return node;
}

// Per-style opacity lives on the INNER element (img/.tint); the OUTER
// .light-overlay only carries the on?1:0 fade (Phase 2 Task 2.4).
function lightInner(el: HTMLElement, id: string, sel: string): HTMLElement {
  const node = lightEl(el, id).querySelector<HTMLElement>(sel);
  if (!node) throw new Error(`no ${sel} inside light overlay ${id}`);
  return node;
}

function baseConfig(lightStyle: 'lit' | 'reveal' | 'glow', extra: Record<string, unknown> = {}) {
  return normalizeConfig({
    images: { base: '/local/base.png', allLights: '/local/all.png' },
    options: { lightStyle },
    entities: [{ entity: 'light.k', x: 50, y: 50, size: 'small', tap: 'toggle', ...extra }],
  });
}

describe('light-layer overlay opacity', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('lit style: inner img opacity = 0.4 + 0.4*brightness at b=0.5 -> 0.6', async () => {
    const hass = makeHass([makeLight({ entity_id: 'light.k', state: 'on', brightness: 128 })]);
    const el = await mountCard(baseConfig('lit'), hass);
    const img = lightInner(el, 'light.k', 'img');
    expect(parseFloat(img.style.opacity)).toBeCloseTo(0.4 + 0.4 * (128 / 255), 2);
  });

  it('glow style: inner tint opacity = 0.4 + 0.55*brightness at b=1 -> 0.95', async () => {
    const hass = makeHass([makeLight({ entity_id: 'light.k', state: 'on', brightness: 255 })]);
    const el = await mountCard(baseConfig('glow'), hass);
    const tint = lightInner(el, 'light.k', '.tint');
    expect(parseFloat(tint.style.opacity)).toBeCloseTo(0.4 + 0.55 * 1, 2);
  });

  it('reveal style: inner img opacity = brightness', async () => {
    const hass = makeHass([makeLight({ entity_id: 'light.k', state: 'on', brightness: 64 })]);
    const el = await mountCard(baseConfig('reveal'), hass);
    const img = lightInner(el, 'light.k', 'img');
    expect(parseFloat(img.style.opacity)).toBeCloseTo(64 / 255, 2);
  });

  it('off light -> outer overlay opacity ~0 (faded out, 0.3s)', async () => {
    const hass = makeHass([makeLight({ entity_id: 'light.k', state: 'off' })]);
    const el = await mountCard(baseConfig('lit'), hass);
    const node = lightEl(el, 'light.k');
    // .light-overlay opacity is on?1:0 -> off light fades to 0 (Phase 2 Task 2.4/2.5).
    expect(parseFloat(node.style.opacity || '0')).toBeCloseTo(0, 2);
  });
});

describe('mask string builders', () => {
  it('radialMask renders the soft-dropoff radial gradient', () => {
    const m = radialMask(50, 50, 100);
    expect(m).toBe(
      'radial-gradient(circle 100px at 50% 50%, black 0%, rgba(0,0,0,0.55) 40%, transparent 100%)',
    );
  });

  it('coneMask renders a conic gradient anchored at the given point', () => {
    const m = coneMask(0, 30, 12, '50% 50%');
    expect(m).toContain('conic-gradient(from 0deg at 50% 50%');
    expect(m).toContain('black 0deg');
    expect(m).toContain('black 30deg');
    expect(m).toContain('transparent 42deg'); // half+feather
    expect(m).toContain('black 360deg');
  });
});
```

- [ ] Run and expect failure:
```
npx vitest run test/light-layer.dom.test.ts -t "light-layer overlay opacity"
```
Expected first failure: `no light overlay for light.k` (missing `data-light`) or an opacity off the formula.

- [ ] Minimal implementation: in `src/render/light-layer.ts`, ensure the OUTER `.light-overlay` div is stamped `data-light=${cfg.entity}` (Phase 2 Task 2.4 / Fix 12) — its own `opacity` is the `on ? 1 : 0` fade. The per-style opacity lives on the INNER element consuming `intensity(state)` (this test queries the inner `img`/`.tint`):
  - `lit`: inner `img` opacity `0.4 + 0.4 * b`
  - `glow`: inner `.tint` opacity `0.4 + 0.55 * b`
  - `reveal`: inner `img` opacity `b`
  all clamped to `[0,1]`. Do not change `radialMask`/`coneMask` signatures — only add the `data-light` attribute if missing. If `radialMask`/`coneMask` output strings differ from the asserted format, the contract format is authoritative — fix the builder.

- [ ] Run and expect pass:
```
npx vitest run test/light-layer.dom.test.ts
```
Expected: `6 passed`.

- [ ] **Integration: mock-hass `setSunForTimeOfDay` ↔ `resolveTimeOfDay` end-to-end (coverage gap).** Append to `test/light-layer.dom.test.ts` a test that mounts the card with the DEV mock-hass shaped to night (the dev factory owns `setSunForTimeOfDay`; its `{ states, callService }` shape is `mountCard`-compatible) and asserts the night base treatment, proving `next_rising`/`next_setting` offsets do not flip day/night near midnight:
```ts
import { createMockHass, setSunForTimeOfDay } from '../dev/mock-hass';

it('night sun (auto view) drives the night base-layer filter end-to-end', async () => {
  const hass = createMockHass();
  setSunForTimeOfDay(hass, 'night'); // shapes sun.sun next_rising/next_setting
  const cfg = normalizeConfig({
    images: { base: '/local/base.png' }, // base-only -> derived night filter
    options: { view: 'auto' },
    entities: [],
  });
  const el = await mountCard(cfg, hass as unknown as Parameters<typeof mountCard>[1]);
  const img = el.shadowRoot!.querySelector<HTMLImageElement>('img.base-image')!;
  expect(img.style.filter).toBe('brightness(0.4) saturate(0.9)');
});
```
Run it under the browser project (`npx vitest run test/light-layer.dom.test.ts`); expect green.

- [ ] Commit:
```
git add test/light-layer.dom.test.ts src/render/light-layer.ts && git commit -m "test: component test for per-style light overlay opacity and mask builders"
```

---

### Task 7.8: README rewrite — new schema, render-free onboarding, install/HACS

**Files:**
- Modify: `README.md` (full replacement)

**Interfaces:** Consumes: the §2 config schema and §4 rendering model (documentation only — no code). Produces: none.

**Why this exists:** §12.7 + §9. The current README documents the dead v1 schema (`objects`, `allLightsImage`, etc.) and a "not functional" editor. It must teach the *new* contract: one required base render, render-free `lit` default, the three light styles, zones, orientation, and the legacy→v2 migration (`objects→entities`, etc.). The "one-render onboarding" framing is the headline selling point per §1.

Steps:

- [ ] Confirm the screenshots referenced still exist (the README links them): `screenshots/card-screenshot-01.png` and `screenshots/card-screenshot-02.jpeg` are present (verified in repo). Keep these references.

- [ ] Replace the entire `README.md` with the following (full file):
````markdown
# Apartment View Card

A Home Assistant Lovelace card that overlays interactive, state-aware device markers and procedural lighting on a 2D/3D floorplan render of your home.

**Lighting is render-free by default.** Each light is drawn procedurally from its position, color, brightness, and orientation directly on top of a single base render — so **adding or moving a light is pure config, no re-rendering required.**

### Desktop View

![Desktop View](screenshots/card-screenshot-01.png)

### Mobile View

![Mobile View](screenshots/card-screenshot-02.jpeg)

## Highlights

- **One render to start.** A single lights-off image (`images.base`) is all you need. Everything else is optional.
- **Correct light color** across every HA color mode (`rgb`, `rgbw/rgbww`, `hs`, `xy`, `color_temp`, kelvin).
- **Directional emission.** Give an entity an `orientation` and it projects a cone (lights, TV beams, speaker/A/C radar).
- **Tappable zones** that zoom and focus a room, dimming the rest.
- **Visual editor** with entity/icon pickers, X/Y sliders, drag-on-preview marker placement, and zone drawing.
- **Pan / zoom / pinch** with tap-to-toggle and press-and-hold for more-info.

## Installation

### HACS (recommended)

1. In HACS, add this repository as a custom repository (category: *Dashboard*).
2. Install **Apartment View Card**.
3. HACS serves `apartment-view-card.js` automatically; no manual `extra_module_url` is needed.

### Manual

1. Download `apartment-view-card.js` from the latest [release](https://github.com/grozdanowski/ha-apartment-view-card/releases).
2. Copy it into your Home Assistant `/config/www/` directory.
3. Register it as a resource:

```yaml
# configuration.yaml
frontend:
  extra_module_url:
    - /local/apartment-view-card.js
```

Minimum Home Assistant version: **2024.3.0** (first release with `color_temp_kelvin`).

## Quick start (one render)

The only required asset is a single lights-off render of your floorplan.

1. Create one image of your apartment with all lights **off** (e.g. with [Sweet Home 3D](http://www.sweethome3d.com/), a free interior-design app — draw walls/rooms, place furniture, export the top-down or angled view as PNG). Use a consistent camera angle and resolution.
2. Upload it to `/config/www/apartment/day.png`.
3. Add the card and point `images.base` at it. Add your lights with `x`/`y` percentages:

```yaml
type: custom:apartment-view-card
images:
  base: /local/apartment/day.png
entities:
  - entity: light.kitchen_ceiling
    x: 35
    y: 16
    size: small
```

That's it — lit lights now brighten and tint their patch of the render procedurally. Adding another light is one more `entities:` entry; no new image required.

## Configuration

```yaml
type: custom:apartment-view-card
images:
  base: /local/apartment/day.png             # REQUIRED — a lights-off render
  allLights: /local/apartment/all-lights.png # optional — enables the "reveal" light style
  night: /local/apartment/night.png          # optional — else derived from base by darkening
  duskDawn: /local/apartment/duskdawn.png    # optional — else derived from base
entities:
  - entity: light.kitchen_ceiling   # any HA entity (light / media_player / climate / switch / ...)
    name: Kitchen ceiling           # optional; defaults to friendly_name, then entity_id
    icon: mdi:ceiling-light         # optional; auto-derived from domain; fallback mdi:checkbox-blank-circle
    x: 35                           # % horizontal (0-100)
    y: 16                           # % vertical (0-100)
    size: small                     # tiny | small | medium | large | huge
    tap: toggle                     # toggle | more-info | none
    orientation: null               # 0-359 (0 = up, clockwise) | null = omnidirectional
    lightStyle: lit                 # optional per-entity override of options.lightStyle
zones:
  - name: Living room
    icon: mdi:sofa
    x: 52
    y: 44
    width: 43
    height: 50
options:
  view: auto                 # auto (sun-based) | day | night | duskDawn
  lightStyle: lit            # global default: lit | reveal | glow
  freePanZoom: true          # wheel / drag / pinch when not focused
  zoomMax: 1.5               # zone-zoom scale cap
  duskDawnOffsetMinutes: 60  # ± window around sunrise/sunset for the duskDawn view
```

### Light styles

| Style    | Needs               | Look                                                                 |
| -------- | ------------------- | -------------------------------------------------------------------- |
| `lit`    | nothing (default)   | Brightens + color-tints the base render inside each light's halo. Render-free. |
| `glow`   | nothing             | Flat color glow, no surface detail. Most abstract.                   |
| `reveal` | `images.allLights`  | Reveals a baked all-lights render inside the halo. Most photoreal.   |

Brightness drives both the halo size and its opacity. Color comes from the entity's current HA color attributes.

### Zones

Each zone is a rectangle (`x`/`y` center, `width`/`height`, all in %). Zones appear as a chip list below the card; tapping a chip zooms to that room and dims icons outside it to 25%. A **"← Back to All"** chip (or `Escape`) returns to the overview. Zone membership is automatic: an entity belongs to whichever zone rectangle contains its `(x, y)` point; if several do, the smallest by area wins.

### Time of day

With `view: auto`, the card picks day / night / duskDawn from `sun.sun`, using a `duskDawnOffsetMinutes` window around sunrise and sunset. If you don't supply `night`/`duskDawn` images they're derived from `base` via CSS filters. Force a fixed look with `view: day | night | duskDawn`.

### Orientation and effects

- Any entity with a numeric `orientation` emits a **cone** in that direction (0 = up, clockwise).
- **Lights:** cone-shaped halo.
- **TV** (`media_player`): a soft blue beam toward `orientation`, shown when on.
- **Speakers** (`media_player`): radar rings rippling outward, shown when playing.
- **A/C** (`climate`): radar rings — blue when cooling, red when heating — shown when active.

Omit `orientation` (or set `null`) for an omnidirectional halo / full rings.

## Migrating from v1

The config schema changed. Re-paste your config once, applying these renames:

| v1 key                  | v2 key                                  |
| ----------------------- | --------------------------------------- |
| `objects:`              | `entities:`                             |
| `entityName`            | `entity`                                |
| `offsetX` / `offsetY`   | `x` / `y`                               |
| `customName`            | `name`                                  |
| `customIcon`            | `icon`                                  |
| `disableService: true`  | `tap: none`                             |
| `dayImage`              | `images.base`                           |
| `allLightsImage`        | `images.allLights` (only for `reveal`)  |
| `nightImage`            | `images.night`                          |
| `duskdawnImage`         | `images.duskDawn`                       |

The card also reads legacy keys for backward compatibility and preserves any unknown keys (e.g. `grid_options`) untouched.

## Development

This card is built with Lit + TypeScript and bundled with Vite.

```bash
npm install
npm run dev     # Vite dev server + mock-hass harness (no Home Assistant needed)
npm run build   # produces dist/apartment-view-card.js
npm run test    # Vitest browser-mode component tests
npm run lint    # ESLint + Prettier
```

The `dev/` harness mounts the real card against a hand-written mock `hass` with a control panel to toggle/dim/recolor lights and switch time-of-day, so you can iterate without a live HA instance.

## Contributing

Contributions are welcome. For major changes, open an issue first to discuss the approach.

## License

MIT — see [LICENSE](LICENSE).
````

- [ ] Verify there are no remaining v1 schema terms in the README (should print nothing):
```
grep -nE 'allLightsImage|dayImage|nightImage|duskdawnImage|offsetX|offsetY|customName|customIcon|entityName|objects:' README.md
```
Expected: only the rows inside the **Migrating from v1** table mention these as *v1* keys (the grep will match those table cells — confirm by eye that every hit is inside that table, and that no live `yaml` example block uses them).

- [ ] Commit:
```
git add README.md && git commit -m "docs: rewrite README for v2 schema, render-free onboarding, HACS install"
```

---

### Task 7.9: Finalize `hacs.json` and bump `package.json` for release

**Files:**
- Modify: `hacs.json`
- Modify: `package.json` (version bump + ensure `dev`/`build`/`test`/`lint` scripts exist)
- Delete: stale root `apartment-view-card.js` and `apartment-view-card.js.LICENSE.txt` (the v1 webpack duplicate, per §9/§10)

**Interfaces:** Consumes: §9/§11 distribution rules. Produces: none.

**Why this exists:** §9 requires `hacs.json` to declare `"filename": "apartment-view-card.js"`, set `"content_in_root": false`, bump min HA to `2024.3.0`, and delete the stale root-level bundle duplicate. The current `hacs.json` has none of `filename`/`content_in_root` and pins `2023.1.0`.

Steps:

- [ ] Overwrite `hacs.json` with exactly:
```json
{
  "name": "Apartment View Card",
  "render_readme": true,
  "filename": "apartment-view-card.js",
  "content_in_root": false,
  "domains": [
    "light",
    "media_player",
    "climate"
  ],
  "homeassistant": "2024.3.0",
  "iot_class": "calculated"
}
```

- [ ] Delete the stale root-level v1 bundle and its license sidecar (these were the webpack output checked into the repo root; the canonical artifact now lives in `dist/`):
```
git rm apartment-view-card.js apartment-view-card.js.LICENSE.txt
```

- [ ] Confirm (do NOT overwrite) `package.json` scripts and version. Phase 1 Task 1.1 already migrated `scripts`/`devDependencies` to Vite/Vitest/ESLint and set `"version": "2.0.0"`. Specifically, KEEP Phase 1's `"build": "tsc --noEmit && vite build"` (the `tsc --noEmit` typecheck gate that Task 7.10 relies on) and Phase 1's `"lint": "eslint \"src/**/*.ts\" \"dev/**/*.ts\" \"test/**/*.ts\""`. Do NOT replace `build` with `vite build` or `lint` with `eslint . && prettier --check .` — that would drop the typecheck gate and re-define two authoritative scripts blocks. Just verify the block already contains `dev`, `build`, `test`, `lint` and that `"version"` is `"2.0.0"`; only ADD a missing script (e.g. `dev`/`test`) if absent, without touching `build`/`lint`.

- [ ] Validate `hacs.json` parses and `package.json` parses:
```
node -e "JSON.parse(require('fs').readFileSync('hacs.json','utf8')); JSON.parse(require('fs').readFileSync('package.json','utf8')); console.log('json ok')"
```
Expected: `json ok`.

- [ ] Confirm the stale root bundle is gone but `dist/` is the build target (dir is gitignored; that's fine — release attaches the built file):
```
test ! -f apartment-view-card.js && echo "root bundle removed"
```
Expected: `root bundle removed`.

- [ ] Commit:
```
git add hacs.json package.json && git commit -m "build: finalize hacs.json (filename, content_in_root, min HA 2024.3.0) and bump to v2.0.0"
```

---

### Task 7.10: Green gate — full build, lint, and entire test suite pass

**Files:**
- No new files. Modify whatever the gate surfaces as broken (smallest possible change).

**Interfaces:** Consumes: all of the above. Produces: a verified-green tree.

**Why this exists:** Per the global constraint "Commit after each green task" and the user's "Verification Before Done" rule, the release must not ship on an unverified tree. This task runs the canonical commands and fixes any failure at the root cause before tagging.

Steps:

- [ ] Run the full test suite (all `test/**/*.test.ts`):
```
npx vitest run
```
Expected: every file passes. Tally should be the sum of prior tasks (helpers 4 + light-color 12 + entity-state 10 + geometry 11 + config 10 + marker DOM 3 + light-layer DOM 6 = **56 passing**, plus any tests added in earlier phases). If anything fails, fix the root cause in `src/` (never weaken a test), re-run, and note the fix.

- [ ] Run the production build and confirm the single canonical output exists:
```
npm run build && test -f dist/apartment-view-card.js && echo "build artifact present"
```
Expected: Vite builds with no errors and prints `build artifact present`. If the build emits more than one JS chunk, fix `vite.config.ts` lib options (from Phase 1) so output is the single `dist/apartment-view-card.js` — do not paper over it here.

- [ ] Run lint and formatting:
```
npm run lint
```
Expected: ESLint and Prettier both clean (exit 0). Fix any real lint errors; auto-fix formatting with `npx prettier --write .` if only formatting differs, then re-run `npm run lint`.

- [ ] Sanity-check the built bundle registers the custom element (the file should contain the element name and the `customCards` registration string):
```
grep -c "apartment-view-card" dist/apartment-view-card.js
```
Expected: a count `>= 1` (registration present).

- [ ] If the gate required any fix, commit it:
```
git add -A && git commit -m "chore: fix build/lint/test gate failures for v2 release"
```
If nothing needed fixing, skip this commit (do not create an empty commit).

---

### Task 7.11: Tag v2.0.0 and write the GitHub release notes

**Files:**
- No source files. Produces a git tag and a GitHub release.

**Interfaces:** Consumes: the verified-green tree from 7.10. Produces: tag `v2.0.0` and a GitHub release with the built `dist/apartment-view-card.js` attached.

**Why this exists:** §9/§12.7 — distribution. HACS installs from a GitHub release; the release must attach the canonical `apartment-view-card.js` artifact and carry breaking-change notes so existing users know to re-paste config. Latest existing tags are `v1.0.0`/`v1.0.1`, so `v2.0.0` is the next.

Steps:

- [ ] Confirm the working tree is clean and on the default branch (or, if working on a feature branch per the global git rule, that it is merged to `main` first — do not tag a feature branch):
```
git status --porcelain && git rev-parse --abbrev-ref HEAD
```
Expected: empty porcelain output (clean) and branch `main`. If not clean, resolve before tagging.

- [ ] Rebuild fresh so the attached artifact matches the tag exactly:
```
npm run build && test -f dist/apartment-view-card.js && echo ok
```
Expected: `ok`.

- [ ] Create the annotated tag:
```
git tag -a v2.0.0 -m "Apartment View Card v2.0.0"
git push origin v2.0.0
```

- [ ] Write the release notes to a temp file `/tmp/avc-v2-release.md` (used only as the `gh release create --notes-file` body — this is not a repo file):
```
cat > /tmp/avc-v2-release.md <<'EOF'
## Apartment View Card v2.0.0

A clean rewrite. Lighting is now **render-free by default** — each light is drawn procedurally from its position, color, brightness, and orientation on top of a single base render, so adding or moving a light is pure config with no re-rendering.

### Breaking changes
The config schema changed. **Re-paste your config once** using the renames below (the card also reads legacy keys and preserves unknown keys):

- `objects:` -> `entities:`
- `entityName` -> `entity`, `offsetX`/`offsetY` -> `x`/`y`, `customName` -> `name`, `customIcon` -> `icon`
- `disableService: true` -> `tap: none`
- Images grouped under `images:` (`dayImage` -> `images.base`, `allLightsImage` -> `images.allLights`, `nightImage` -> `images.night`, `duskdawnImage` -> `images.duskDawn`)

### New
- Three light styles: `lit` (default, render-free), `glow`, `reveal` (needs `images.allLights`).
- Correct light color across all HA modes (rgb / rgbw / rgbww / hs / xy / color_temp / kelvin).
- Directional cones via `orientation`; TV beams and speaker/A/C radar effects.
- Tappable, zoom-to-focus `zones`.
- A working visual editor (entity + icon pickers, X/Y sliders, drag-on-preview, zone drawing).
- Pan / zoom / pinch with tap-to-toggle and press-and-hold for more-info.

### Fixes
- `setConfig` no longer drops unknown keys (v1 silently discarded `columns`/`rows`).
- Light color now honors every color mode (v1 read only `rgb_color`).
- The `medium` size tier is now reachable; `sun.sun` dates are no longer mutated.

### Requirements
- Home Assistant **2024.3.0** or newer.

### Install
Install via HACS, or download `apartment-view-card.js` below and register it under `frontend.extra_module_url`.
EOF
echo "notes written"
```
Expected: `notes written`.

- [ ] Create the GitHub release attaching the built bundle:
```
gh release create v2.0.0 dist/apartment-view-card.js --title "v2.0.0" --notes-file /tmp/avc-v2-release.md
```
Expected: `gh` prints the release URL.

- [ ] Verify the release exists and has the asset attached:
```
gh release view v2.0.0 --json tagName,assets --jq '{tag: .tagName, assets: [.assets[].name]}'
```
Expected: `{"tag":"v2.0.0","assets":["apartment-view-card.js"]}`.

---

### Task 7.12: Note Tier 3 deferral (no implementation)

**Files:**
- Modify: `docs/superpowers/specs/2026-06-25-apartment-view-card-v2-design.md` (append a one-line status note under §8 Tier 3) — documentation only.

**Interfaces:** Consumes: §8 Tier 3 / §11. Produces: none.

**Why this exists:** §8 Tier 3 (`hass-taste-test` screenshot regression in CI) is explicitly deferred and "not a gate." We record that it was intentionally skipped in v2.0.0 so a future maintainer doesn't assume it was forgotten. No CI workflow, no `hass-taste-test` dependency is added in this phase.

Steps:

- [ ] In the spec file, append to the **Tier 3** bullet (line that begins `- **Tier 3 (deferred):**`) a status note. Edit so it reads:
```
- **Tier 3 (deferred):** `hass-taste-test` screenshot regression in CI (pre-release; not a gate). **Status: deferred out of v2.0.0** — Tier 1 (mock-hass harness) + Tier 2 (Vitest browser component tests in `test/`) ship; screenshot regression is a future follow-up and intentionally not wired into CI for this release.
```

- [ ] Confirm no `hass-taste-test` dependency leaked into the project (should print nothing):
```
grep -Rn "hass-taste-test" package.json package-lock.json .github 2>/dev/null
```
Expected: no output.

- [ ] Commit:
```
git add docs/superpowers/specs/2026-06-25-apartment-view-card-v2-design.md && git commit -m "docs: note Tier 3 screenshot regression deferred out of v2.0.0"
```

---

**Phase 7 done when:** `npx vitest run` is fully green across `test/**`, `npm run build` emits the single `dist/apartment-view-card.js`, `npm run lint` is clean, the README documents only the v2 schema, `hacs.json` carries `filename`/`content_in_root:false`/`homeassistant:2024.3.0`, the stale root bundle is deleted, and GitHub release `v2.0.0` exists with the built bundle attached and breaking-change notes. Tier 3 is documented as deferred.

Relevant paths (all absolute): spec `/Users/matej/Work/Matej/ha-apartment-view-card/docs/superpowers/specs/2026-06-25-apartment-view-card-v2-design.md`; tests `/Users/matej/Work/Matej/ha-apartment-view-card/test/`; README `/Users/matej/Work/Matej/ha-apartment-view-card/README.md`; HACS manifest `/Users/matej/Work/Matej/ha-apartment-view-card/hacs.json`; stale duplicate to delete `/Users/matej/Work/Matej/ha-apartment-view-card/apartment-view-card.js`.
