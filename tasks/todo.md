# 2.1.0 — "Spectacular" pass

Goal: turn the card from a status display into a delightful spatial control surface.
Scope approved by user: (1) on-floorplan light control, (2) marker + lighting polish,
(3) glanceable state + zones. (Editor overhaul deferred.)

Build in the stable Vite dev harness with visual iteration; verify milestones in the
Docker HA; keep logic test-backed. Ship as 2.1.0. (Includes the verified 2.0.2 upload fix.)

## Increment A — Marker + lighting polish (visual foundation)
- [ ] dev harness: add a minimal `ha-icon` stub so markers render glyphs (dev-only)
- [ ] MarkerView gains `glowColor` (resolved light color when on) + brightness
- [ ] Marker chrome: frosted/dimensional base, color-matched glow when on, spring press
- [ ] Lighting: softer bloom + brighter core, refined on-ramp, warm/cool accuracy
- [ ] Tests for glowColor computation; visual check in harness + Docker HA

## Increment B — Glanceable state + zones
- [ ] Brightness ring around markers (arc = brightness %); off lights softly dimmed
- [ ] Climate marker shows temp inline; media shows playing state
- [ ] Zone zoom: spring easing + vignette dim of surroundings + breadcrumb
- [ ] Tests for ring geometry / state formatting

## Increment C — On-floorplan control surface (validated via prototype-multilight.html)
Interaction model (signed off via the interactive prototype):
- Tap any device -> its control panel opens BELOW the floorplan (never overlays markers); close on the right.
- Panel is KIND-AWARE + CAPABILITY-DRIVEN (must work with real models, not happy path):
  - light: brightness only if supported; color swatches only if rgb/hs/xy; color-temp slider if color_temp; on/off-only -> just toggle.
  - media_player: transport buttons gated per supported_features bit; volume only if VOLUME_SET; now-playing from media_title/artist; source if SELECT_SOURCE.
  - climate: target temp clamped to min/max/step; modes from real hvac_modes (not hardcoded); show current_temperature; target_temp_high/low for ranges.
- "Lights control" pill -> multi-LIGHT select: lights get checkboxes, non-lights dim/unclickable; panel opens but DISABLED until >=1 checked; group brightness/color (color only if all support it).
- Zone focus pre-checks that zone's lights; selection scoped to focused zone.
- Zone zoom gets a slight animated PERSPECTIVE tilt (rotateX ~6deg + perspective); markers stay flat in the real card (separate overlay).
- [ ] control-surface component (light/media/climate bodies) + capability detection
- [ ] selection mode (checkboxes, disabled-until-selected, dim non-lights)
- [ ] live service calls per domain; room glow updates live
- [ ] dismiss on close/Esc; a11y (focus, keyboard, aria)
- [ ] tests: capability gating, control->service mapping, selection scoping
- [ ] VERIFY each panel against varied real demo entities in Docker HA

## Wrap
- [ ] Full suite green, lint, build; README + screenshots refresh
- [ ] Verify in Docker HA; tag + release 2.1.0 (asset attached)

## Review notes
(to be filled in as we go)

## 2.1.0 BUILD STATUS (done + verified)
- [x] Capability detection (light/media/climate) — 15 tests vs real attr shapes
- [x] av-control-surface element — 14 tests (capability gating + service mapping)
- [x] Phase 1: tap controllable -> surface (card wired)
- [x] Phase 2: "Lights control" multi-select (checkboxes, disabled-until-checked, zone pre-check)
- [x] Phase 3: zone-zoom perspective tilt (markers aligned, reduced-motion off)
- [x] Harness flows real card; dev ha-icon stub
- [x] VERIFIED in Docker HA vs REAL entities: bed_light (brightness+color), living_room media (play/pause+volume, no prev/next), ecobee (6 modes + 21-24 range, no stepper); power toggle flipped a real light off->on
- deferred polish: optimistic glow during drag, media source picker, climate fan/preset
