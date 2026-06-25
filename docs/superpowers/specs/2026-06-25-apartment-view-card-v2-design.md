# Apartment View Card v2 — Design Spec

**Date:** 2026-06-25
**Status:** Approved for planning (design validated via interactive prototype at `dev/prototype.html`; spec adversarially reviewed)

## 1. Overview

A Home Assistant custom Lovelace card that overlays interactive, state-aware device markers and lighting effects on a 2D/3D floorplan render. v1 ("works but rough") is replaced by a clean rewrite. Breaking config changes are acceptable — the user re-pastes config once.

The headline change vs v1: **lighting is render-free by default.** Each light is rendered procedurally from its position + color + brightness + orientation, so **adding or moving a light is pure config — no re-rendering.** The original multi-image system is **retained as the highest-fidelity tier** (the `reveal` light style) — fully supported, just no longer required. Both systems coexist; `lit` is the default, `reveal` is opt-in (global or per-entity).

### Goals
- Working visual editor: add/remove/edit entities (entity + icon picker, X/Y sliders + drag-on-preview), zones, and per-entity orientation.
- Correct light color across all HA color modes.
- Directional emission (cones) for lights and devices, driven by an `orientation` field.
- Tappable zones that zoom + focus.
- Render-free lighting (one base render required; everything else optional/derived).
- A local mock-`hass` dev harness so iteration never touches a live HA instance.
- Modern HA/Lit conventions and tooling; fix the real v1 bugs.

### Non-goals
- Photorealism beyond what the chosen render provides. The base image is raster; it softens when zoomed past native resolution (icons stay crisp — see §6).
- 3D/WebGL. Everything is CSS masks/gradients + DOM.
- Multi-floor / multi-view switching (future).

## 2. Config schema (breaking)

```yaml
type: custom:apartment-view-card
images:
  base: /local/apartment/day.png            # REQUIRED — a lights-off render
  allLights: /local/apartment/all-lights.png # optional — everything-on render; enables the "reveal" light style
  night: /local/apartment/night.png          # optional — else derived from base by darkening
  duskDawn: /local/apartment/duskdawn.png     # optional — else derived from base
entities:
  - entity: light.kitchen_ceiling   # any HA entity (light / media_player / climate / switch / ...)
    name: Kitchen ceiling           # optional; defaults to friendly_name, then entity_id
    icon: mdi:ceiling-light          # optional; auto-derived from domain/device_class; fallback mdi:checkbox-blank-circle
    x: 35                            # % horizontal (0-100)
    y: 16                            # % vertical (0-100)
    size: small                      # tiny | small | medium | large | huge
    tap: toggle                      # toggle | more-info | none
    orientation: null                # 0-359 (0 = up, clockwise) | null = omnidirectional
    lightStyle: lit                  # optional per-entity override of options.lightStyle
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

Renamed/removed vs v1: `objects`→`entities`, `entityName`→`entity`, `offsetX/Y`→`x/y`, `customName`→`name`, `customIcon`→`icon`, `disableService`→`tap`, images grouped under `images`. New: `orientation`, `lightStyle`, `zones`, `options`.

**Zone membership is automatic and derived (read-only, not per-entity editable):** an entity belongs to whichever zone rectangle contains its (x,y) point. When multiple zones contain the point, the smallest by rectangle **area** wins. An entity in zero zones has no membership and is **not** dimmed on focus.

`setConfig` MUST normalize defaults without dropping unknown keys (see §10 — this was a real v1 bug that silently discarded `columns`/`rows` and would discard `zones`).

## 3. Architecture

Two render layers (critical for crisp icons — see §6):

1. **Image layer** (`scene`) — transformed (pan/zoom): base render + per-light overlays + per-device effect overlays + zone definition boxes (edit mode only). `transform-origin: 0 0; will-change: transform`.
2. **Interactive overlay** — NOT transformed: icon buttons (and edit-mode zone hotspots). Positioned in screen px computed from the scene transform so it tracks pan/zoom while rendering at native resolution.

```
src/
  apartment-view-card.ts        # thin orchestrator LitElement (renamed from v1 src/ApartmentViewCard.ts; use kebab-case filenames)
  core/
    config.ts                   # types + setConfig normalization (preserves unknown keys) + breaking renames + zone membership
    light-color.ts              # resolveLightColor(), kelvinToRgb (Tanner-Helland), hs/xy -> rgb
    geometry.ts                 # zoomToZone(zone, viewport, maxScale) -> {scale, panX, panY}; screen<->scene mapping; hit-testing
    entity-state.ts             # isActive(), intensity(), iconForEntity()
  render/
    base-layer.ts               # base render + time-of-day (real or derived)
    light-layer.ts              # the 3 light styles (lit / reveal / glow), masks, cones
    effect-layer.ts             # TV cone, A/C + speaker radar, omni fallbacks
    marker-overlay.ts           # non-transformed interactive icon layer
    zone-controls.ts            # horizontal zone list + focus logic
  editor/
    apartment-view-card-editor.ts  # ha-form sections
    preview-canvas.ts              # live preview: drag markers, draw zones
dev/
  index.html, mock-hass.ts, vite.config.ts   # Vite mock-hass harness (prototype.html is its seed)
test/                           # Vitest browser-mode (e.g. test/light-color.test.ts; run via npm run test)
```

## 4. Rendering model

**Conventions:** `brightness` in all formulas below is **normalized to [0,1]** (HA `brightness` attribute ÷ 255; off or attribute-absent = 0). All resulting opacities are clamped to [0,1]. Example: brightness 0.5 → `lit` image opacity = 0.6, halo radius = `sizeTier · 0.725`.

### 4.1 Image / render tiers (render-free by default)
- **Required:** `images.base` — a single lights-off render.
- **Time of day:** `night` / `duskDawn` used if provided; otherwise derived from `base` via CSS filters. Default derivation filters (tuning subject to field feedback): night `brightness(0.4) saturate(0.9)`; duskDawn `brightness(0.75) saturate(1.1) hue-rotate(20deg) sepia(0.15)`. `view: auto` selects by `sun.sun` with a `duskDawnOffsetMinutes` window around sunrise/sunset.
- **Light fidelity** is set by `lightStyle` (global `options.lightStyle`, per-entity override):
  - **`lit`** (default, render-free): inside each light's mask, reveal the `base` render brightened + color-tinted. Adding a light just brightens its patch of the existing render → no re-render. Validated tuning: `filter: brightness(1.08) saturate(1.12) contrast(0.97)`, image opacity `0.4 + 0.4·brightness`, tint blend `soft-light` at opacity `0.55 + 0.3·brightness`. (Higher image brightness, e.g. 1.65, overexposes — rejected.)
  - **`reveal`** (photoreal, requires `allLights`): reveal the baked `all-lights` render at the light's mask; opacity = brightness; tint via configurable blend, **default `multiply`** (A/B `multiply` vs `screen` in the harness; ship `multiply` if the test is still pending). **This is the original v1 high-fidelity path, kept as a first-class alternative** — set globally via `options.lightStyle: reveal` or per-entity via `lightStyle`. Providing real `night`/`duskDawn` + `allLights` with `lightStyle: reveal` reproduces the original multi-render look exactly. `lit` and `reveal` may be mixed per-entity (e.g. reveal for lights in the baked render, lit for ones added later).
  - **`glow`** (most abstract): a flat color glow (no surface detail), `screen`-blended; opacity `0.4 + 0.55·brightness`.

### 4.2 Masked reveal (the core trick)
Each light is a mask-shaped region over the base. The mask is a radial gradient centered at the light, sized by brightness:
- radius `r = sizeTier · (0.45 + 0.55·brightness)` (brightness drives halo size as well as intensity).
- soft dropoff (applies to `lit`/`glow`): `radial-gradient(circle r at x% y%, black 0%, rgba(0,0,0,0.55) 40%, transparent 100%)`. `reveal` uses a harder-edged mask over the baked render. The angular feather (cone) applies to all styles only when `orientation` is set.
- on/off and brightness changes animate via a **card-owned 0.3s CSS transition** on opacity/color (do NOT rely on HA streaming intermediate states).

Size tiers (fraction of card width): tiny 0.09, small 0.13, medium 0.17, large 0.22, huge 0.28.

### 4.3 Light color resolution
`resolveLightColor(entity)` priority: `rgb_color` → `rgbw/rgbww` (use RGB channels) → `hs_color` → `xy_color` → `color_temp_kelvin` → `color_temp` (mireds: `kelvin = 1e6 / mireds`) → warm-white default `#fffae6`. Use the Tanner-Helland kelvin→RGB algorithm. Brightness maps to **opacity**, never RGB multiplication (preserves hue).

### 4.4 Directional emission — cones
Per-entity `orientation` (0–359, 0 = up, clockwise; `null`/absent = omnidirectional). **Any entity with a numeric `orientation` renders a cone regardless of domain.** Omnidirectional fallback: lights → radial halo; speakers/AC → concentric rings. Directional rendering uses a **`conic-gradient ∩ radial` mask** (NOT an offset circle — explicitly rejected):
- `coneMask(o, half, feather, at) = conic-gradient(from {o}deg at {at}, black 0deg, black {half}deg, transparent {half+feather}deg, transparent {360-half-feather}deg, black {360-half}deg, black 360deg)`.
- **Lights:** mask = `radial , coneMask(o,30,12,"x% y%")` with `mask-composite: intersect` (`-webkit-mask-composite: source-in`). Yields a cone-shaped `lit`/`reveal`/`glow` reveal.
- **Devices (media_player/climate):** a colored beam div, `background: radial-gradient(color → transparent)`, masked by `coneMask(o,34,14,"50% 50%")`, `mix-blend-mode: screen`.
- The 30°/34° half-angles and 12°/14° feathers are opinionated v2.0 defaults; may become config options in a later patch if field testing shows mis-sizing.

### 4.5 Per-domain effects (non-light)
- **TV** (`media_player`, TV-like): soft **blue cone** glow projecting toward `orientation`; intentionally weak (`rgba(95,165,255,~0.5)`); gentle pulse. Shows only when state is on.
- **Speaker / radio** (`media_player` audio): **radar** — concentric arcs rippling outward, clipped to the cone. Spec: 5 arcs, 4.5px stroke, `2.4s linear infinite`, staggered 480ms apart; radius grows 0 → cone radius then repeats. Omni (no orientation) → full rings. Shows only when playing.
- **A/C** (`climate`): same **radar** arcs, shown only when active (`hvac_action`/state not off/idle): **blue when cooling, red when heating, gray if unknown**; arc opacity pulses 0.3–0.7 over 2.4s; omni when no orientation, else clipped to the 34°/14px-feather cone.
- All effects fade in/out over `0.3s`.

## 5. Interaction
- **Tap** a marker → `homeassistant.toggle` (works across light/media_player/climate; keep v1 service). `tap: more-info` opens the native more-info dialog; `tap: none` disables.
- **Press-and-hold** ≥450ms → native more-info dialog. Movement >8px before the hold timer fires cancels the hold and is treated as a pan. **Tap** = <8px movement released in <450ms.
- **Pan/zoom**: wheel + pointer drag + pinch. Pinch-to-zoom is enabled by default on multitouch (mobile + trackpad). The >8px movement threshold is applied per-gesture to both drag and pinch. `freePanZoom` gates pan/zoom in the **unfocused/overview** state only.
- **Zones**: a horizontal list below the card, each chip showing its icon + name.
  - Tap a zone chip → animate (`translate+scale`, 0.6s, `cubic-bezier(.4,0,.2,1)`) to the zone. Scale = `min(zoomMax, viewport-fit-scale for the zone)` (if the zone fits below `zoomMax`, use the smaller scale — no letterboxing). Pan maps the zone center to viewport center after scaling, clamped so the view stays within image bounds (`geometry.ts zoomToZone`). Other zones' icons **dim to 25%** (focus). During focus the view is fixed (free pan/zoom disabled).
  - Icons **grow with zoom**: icon scale = `min(imageZoomScale, 2.0)`; baseline `ha-icon` 24px (scale 1.5 → 36px).
  - When zoomed, a **"← Back to All"** chip appears as the first list item (and `Escape`/back-button exits). No "Overview" chip when zoomed out.
  - Zone rectangles/labels are **not drawn on the render** in normal view — only as dashed outlines in editor edit mode.

## 6. Two-layer rendering (icon crispness)
The image layer is GPU-rasterized and bitmap-scaled on zoom (so the raster render softens — inherent). Interactive icons must NOT live inside it or they pixelate. They live on a separate non-transformed overlay; on every pan/zoom, each marker's screen position = `(x/100·W·scale + panX, y/100·H·scale + panY)`, with icon scale `min(scale, 2.0)`. Image transform and overlay both use the same `0.6s cubic-bezier(.4,0,.2,1)` during zone-zoom so icons animate in sync. Icons are `ha-icon` SVG (vector, crisp at any zoom).

## 7. Visual editor (`ha-form`)
Built from scratch (v1's editor is a non-functional stub). Idiomatic HA selectors:
- **Sections:** images + options (text/number/select), entities list, zones list.
- **Per entity:** entity selector (all domains — NOT light-only), icon selector (`ha-icon-picker`), name (text), size (select), tap (select), **orientation** (optional number slider 0–359; a "directional" toggle controls whether the slider is shown — off = `null` = omnidirectional), and **X/Y `number` sliders (mode: slider)**.
- **Live preview:** render `base` with draggable markers (drag → `grabbing` cursor + 50%-opacity clone); dragging updates X/Y and the sliders bidirectionally; selecting a row highlights its marker.
- **Zones:** "Add zone" → drag a rectangle on the preview (`crosshair` cursor + dashed outline while drawing, solid when complete); numeric x/y/w/h; per-zone icon picker; add/remove/reorder.
- Emit changes via `fireEvent(this, 'config-changed', { config })`.

## 8. Local dev + testing
- **Tier 1 (daily loop):** Vite dev server serving `dev/index.html`, which mounts the real card against a hand-written mock `hass` (light/media_player/climate + `sun.sun`, `callService` spy) with a control panel to toggle/dim/recolor and switch time-of-day. HMR; no HA. (`dev/prototype.html` is the seed.)
- **Tier 1b:** point a real HA `extra_module_url` at the Vite server, or symlink `dist/` into `config/www/`, for occasional real-state checks.
- **Tier 2:** Vitest browser-mode (Playwright provider) component tests in `test/` (e.g. `test/light-color.test.ts`, run via `npm run test`), reusing the mock-`hass` factory: overlays at correct %, intensity→opacity, `homeassistant.toggle` fires on tap, `zoomToZone` math, `resolveLightColor` across modes.
- **Tier 3 (deferred):** `hass-taste-test` screenshot regression in CI (pre-release; not a gate).

## 9. Build / tooling / distribution
- Migrate webpack → **Vite** (`vite.config.ts`, lib build → `dist/apartment-view-card.js`, single canonical output).
- `tsconfig`: target ES2022, module esnext, `moduleResolution: bundler`, keep `experimentalDecorators: true` (Lit recommendation), drop `emitDecoratorMetadata` and the `paths` mapping.
- Bundle Lit. Remove dead `@lit-labs/virtualizer`. Define minimal local HA types or bump `custom-card-helpers`.
- Add ESLint + Prettier + `eslint-plugin-lit`.
- `hacs.json`: add `"filename": "apartment-view-card.js"` (matching the Vite lib output), set `"content_in_root": false`, bump min `homeassistant` (see §11), and delete the stale root-level `apartment-view-card.js` duplicate.

## 10. v1 bugs fixed by the rewrite
- `setConfig` (card + editor) rebuilds config and **drops unknown keys** — already loses `columns`/`rows`; would silently discard `zones`. Fix: preserve unknown keys.
- `_calculateColor` reads ONLY `rgb_color`, ignoring `color_temp`/`hs`/`xy` entirely → those modes render with no tint (fall through to `#fffae6`). Replaced by `resolveLightColor`.
- `_getSizeInPixels` has no `medium` case (default ~0.2 ≈ large), so true medium (0.17) is unreachable → fixed via the five-tier table.
- `_getDayState` mutates parsed `sun.sun` dates. Fix: clone before mutating, e.g. `new Date(new Date(sunrise).setDate(now.getDate()))`, so `hass.states` is not mutated.
- Dead code: editor add/delete/expand methods are unwired; `@lit-labs/virtualizer` unused; stale `dist/`/root duplicate.
- `hacs.json` missing `filename`.

## 11. Resolved defaults
- Minimum HA version: `hacs.json "homeassistant": "2024.3.0"` (first release with `color_temp_kelvin`). If 2023.12–2024.2 support is later required, fall back to `color_temp` mireds in `resolveLightColor`.
- Pinch-to-zoom: enabled by default on multitouch (mobile + trackpad).
- `reveal` tint blend: ship `multiply` as the implementation default; A/B vs `screen` in the harness before release.
- Testing scope to build now: Tier 1 harness + a few Tier 2 tests; defer Tier 3.

## 12. Phasing (for the implementation plan)
1. **Tooling + scaffold + config:**
   - 1a Tooling: webpack→Vite migration, `vite.config.ts`, tsconfig, ESLint/Prettier, `hacs.json`.
   - 1b `core/config.ts`: types + `setConfig` normalization with unknown-key preservation and breaking renames (objects→entities, offsetX/Y→x/y, etc.) + zone membership.
   - 1c `dev/mock-hass.ts` (light/media_player/climate + `sun.sun` + `callService` spy) + control panel (toggle/dim/recolor/time-of-day) + `dev/index.html` HMR.
2. Core render: base/time-of-day layer, light-layer (`lit` default + `glow` + `reveal`), `resolveLightColor`, masked reveal + 0.3s fade.
3. Interaction: two-layer overlay, pan/zoom/pinch, tap/hold (with the §5 thresholds).
4. Cones + orientation (cones blocking); per-domain effects (TV cone, A/C + speaker radar — parallelizable).
5. Zones: zoom math (`geometry.ts`) then zone list UI + focus + Back-to-All + membership (sequence internally).
6. Visual editor (ha-form + live preview + zone draw).
7. Tests (Tier 2) + docs/README + HACS release.
```
