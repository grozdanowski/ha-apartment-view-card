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

## Increment C — On-floorplan light control (the killer feature)
- [ ] `light-control` popover component: brightness slider + color swatches + on/off
- [ ] Anchor popover to the tapped marker (screen-space geometry, stays on-screen)
- [ ] Live service calls (brightness_pct, rgb_color, toggle); room glow updates live
- [ ] Open on press/hold for controllable lights; dismiss on outside tap/Esc
- [ ] Tests for popover placement geometry + the control→service mapping
- [ ] a11y: focus trap, keyboard, aria

## Wrap
- [ ] Full suite green, lint, build; README + screenshots refresh
- [ ] Verify in Docker HA; tag + release 2.1.0 (asset attached)

## Review notes
(to be filled in as we go)
