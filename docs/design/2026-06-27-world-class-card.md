# Apartment View Card — World-Class Design

> Source: multi-agent design workflow (landscape survey of Mushroom / Bubble / Tile /
> mini-media-player → 3 competing visions → adversarial power-user + HI-designer
> critique → synthesis). Captured 2026-06-27. This is a proposal to prioritize from,
> not a committed plan.

## 1. Vision

The Apartment View Card is a **glass cockpit for your home**: one floorplan you glance at
and instantly know everything — temperatures, what's playing, what's open, what's offline —
rendered in ambient procedural light and quiet text, with full controls that appear only
when you touch. **Reading is the product; touching is the fallback.** It ships calm and
silent by default, rewards configuration generously, and never *lies* — an offline device
must look offline, not identical to a working one. Every feature degrades gracefully
(reduced-motion, RTL, unsupported capabilities, 80-entity floorplans) so it stays beautiful
and legible at any density.

## 2. Marker + Label System (the headline of v2.2)

A marker can carry an optional **text label** that reads a live value; `auto` visibility
keeps the overview silent and **blooms labels only where you zoom or focus a zone**.

### Schema

```ts
export type LabelSource =
  | 'none' | 'static' | 'state' | 'attribute'
  | 'climate-current' | 'climate-target'   // 21°C  / 21–24°C
  | 'media-title' | 'media-source'         // Tycho — Awake / Spotify
  | 'light-brightness'                      // 64%
  | 'cover-position' | 'fan-percentage'     // 40% / 60%
  | 'battery'                               // 87% (attr OR battery-class sensor)
  | 'sensor'                                // 412 W
  | 'last-changed';                         // 3 min ago

export type LabelVisibility = 'auto' | 'always' | 'active' | 'never';

export interface LabelConfig {
  source: LabelSource;
  text?: string;        // when source: static
  attribute?: string;   // when source: attribute
  visibility?: LabelVisibility; // inherits global, else 'auto'
}

export interface EntityConfig {
  // …entity, name, icon, size, tap, orientation, x, y…
  label?: LabelConfig;          // NEW — absent ⇒ inherit global default
  badges?: BadgeRule[];         // NEW (§5)
}

export interface LabelDefaults {        // CardOptions.labels
  source: LabelSource | 'smart';        // 'smart' = per-domain preset
  visibility: LabelVisibility;          // default 'auto'
  densityCap: number;                   // safety ceiling, default 14
}
// Shipping default: { source: 'none', visibility: 'auto', densityCap: 14 }
```

Per-entity `label` **fully replaces** the global default (matches `lightStyle`). Each preset
is a pure `(state, hass) => { text, ariaText } | null` in a new `src/core/label.ts`. Numbers
format through **HA locale** (comma vs dot). Hard fallback chain for `state`:
`hass.formatEntityState?.() ?? computeStateDisplay?.() ?? capitalize(state.state)` (HACS users
run old cores).

### Non-negotiables that make it honest at scale

- **`unavailable`/`unknown` override** wins over every preset: desaturated chip, dashed ring,
  no glow, label suppressed, aria says "…, unavailable". The line between glass cockpit and a
  lying dashboard.
- **`smart` map** only emits a label where the ambient layer doesn't already say it:
  climate→current temp, media→title, cover→position, sensor→value; **light→none** (the
  brightness ring already says it); switch/lock/binary_sensor→none.
- **Visibility `auto`** = `scale ≥ 1.25` OR (zone focused & this marker) OR hover/focus.
- **Density via spatial collision**, not a count: drop overlapping `auto` labels by priority
  (active > has-badge > nearest-focus > config order). `always`/`active` never culled.
- **Edge-aware auto-flip** (right-half markers open leftward, clamped to card rect).
- **a11y:** live values are NOT in `aria-label` (NVDA/VoiceOver would re-announce endlessly);
  `aria-label` is identity+action, visible label is `aria-hidden`. Frosted plate guarantees
  AA contrast (not text-shadow). RTL via logical properties. Reduced-motion disables fades.

### Examples

```yaml
- entity: climate.living_room
  label: { source: climate-current, visibility: always }   # 21°C, pinned
- entity: media_player.kitchen
  label: { source: media-title }                            # blooms on zoom
- entity: scene.movie_night
  label: { source: static, text: Movie Night }
- entity: sensor.washing_machine_power
  label: { source: sensor, visibility: active }             # 412 W only when on
options:
  labels: { source: smart, visibility: auto }               # one-tap living board
```

## 3. Controls — what a user actually needs

Capability-driven; render only what `supported_features` + list attributes prove. Extend
`ControlKind` beyond `light|media|climate|none` and add `*Caps()` builders. **Group
resolution (P0):** `group.*` / `light.all_*` must resolve to members — today the surface
silently vanishes on them. **Tap disambiguation (P0):** honor `tap: more-info` as an explicit
override on controllable entities (today `tap` is silently ignored on them). Confirm guards on
irreversible actions.

**P0 — seven core domains:** light *(done)* · switch · media_player *(done)* · climate
*(done)* · **cover** (open/stop/close + position, garage vs blind by device_class) · **fan**
(speed % + preset/oscillate/direction) · **lock** (lock/unlock + jammed; confirm on latch).

**P1:** input_boolean · vacuum · humidifier · water_heater · scene/script/button · number ·
select · alarm_control_panel · sensor/binary_sensor (read-only, device_class-aware).

**P2:** lawn_mower · valve · update · camera (snapshot marker).

**Touch (P0):** every marker gets an invisible ≥44px hit target regardless of zoom scale.

## 4. Settings / Editor — organized so anyone can navigate

**4 tabs over a pinned live preview**, native `ha-form` only (`type:"expandable"` for
Basic/Advanced, `type:"grid"` for rows):

- **Floorplan** — base + variant images, time-of-day, dusk/dawn, pan/zoom. The static stage.
- **Devices** — entity list + inspector (90% of editing). Search/filter/bulk at ≥6 entities;
  Import-from-Area + unplaced drag tray.
- **Lighting** — global light style (moved out of Options) + **global label defaults &
  one-click `smart`** + cone defaults.
- **Zones** — draw/drag/resize on preview.

**Per-entity Basic:** entity (auto-fills name/icon/tap on pick) · name · icon · place-on-floorplan.
**Advanced (collapsed `expandable` groups):** ▸ Label (one `source` dropdown that
progressively discloses; live-preview shows the resolved value) · ▸ Appearance (size, light
override relabeled "Inherit from Lighting tab") · ▸ Controls & Actions (tap, with the
controllable-entity annotation) · ▸ Directional lighting (cone + orientation slider) · ▸
Position (X/Y sliders — the mobile-primary path).

**Scale:** search dims non-matching preview markers; domain/state filter chips; bulk set
size/style/tap/label/delete; **Import-from-Area** stages an HA Area's entities as draggable
chips. **Narrow (<480px):** preview becomes a collapsible strip, X/Y sliders documented as the
mobile path (no Figma promises on a phone modal). **Onboarding:** empty-state dropzone → import
→ one-click smart labels. Persistent `⟨/⟩` YAML toggle round-trips `normalizeConfig`.

## 5. Signature differentiators (the "wow")

1. **Dynamic labels with reveal-on-interest** — calm overview that blooms detail where you
   look. Impossible on a tile grid. *The headline.*
2. **Attention badges + "N need attention"** — corner badges (open door/window, unlocked,
   leak/smoke, low battery, unavailable) + a card-level "3 need attention" that pulses those
   markers. Turns pretty into a daily habit.
3. **Presence/motion pulse** — a one-shot ripple at a sensor's x/y when motion fires; capped
   at ~3 concurrent, decaying, reduced-motion-aware. Restraint *is* the differentiator.
4. **Import-from-Area drag-to-place onboarding** — your real home assembles itself under your
   fingers. The adoption lever.

## 6. Phased roadmap

### P0 — v2.2 "Your Home at a Glance"
1. Editor 4-tab shell + Basic/Advanced expandable + smart-defaults-on-pick — **M**
2. `label.ts`: schema + resolver + unavailable override + `smart` map + locale fallback — **M**
3. Label render in `computeMarkerViews`: visibility + spatial collision + auto-flip + RTL +
   plate + values-out-of-aria — **M**
4. Attention badges + "N need attention" + offline marker treatment — **M**
5. Presence/motion pulse (capped, decaying, reduced-motion) — **S–M**
6. Control surface P0: cover/fan/lock + group resolution + ≥44px hit + tap disambiguation +
   confirm guards — **M**
7. Import-from-Area + drag tray + empty-state dropzone + one-click smart upsell — **M**

### P1 — premium polish
8. Control P1 domains (vacuum, humidifier, water_heater, scene/script/button, number, select,
   alarm, input_boolean) — **M–L** · 9. media artwork + progress, light effects — **M** ·
10. animated state transitions — **S–M** · 11. long-press radial quick actions — **M** ·
12. scene activation on map — **M** · 13. devices search/filter/bulk + reorder — **M** ·
14. live preview reflects labels/badges — **M** · 15. theming + RTL CI audit — **S** ·
16. `template` mini-language (deferred from P0 as YAGNI, build on demand) — **M**

### P2 — ambitious
17. Control P2 (lawn_mower, valve, update, camera) — **M** · 18. multi-floor switcher — **L** ·
19. perf hardening at 50+ entities — **M** · 20. spatial keyboard nav + per-zone SR summaries
— **M–L** · 21. in-place drag-dial markers (experiment, must not regress glance) — **M–L** ·
22. history sparkline + weather/sun ambient tint — **M**

---

**Three fixes make this defensible on an 80-entity install:** the unavailable-state story,
spatial-collision label density, and the a11y live-value fix — all in P0.
**Cut as YAGNI:** the template mini-language (deferred behind demand), nested badge-in-label
(§5 badges cover it), per-entity placement/unit/maxChars overrides (global + auto-flip + one
`em` truncation cover it).
