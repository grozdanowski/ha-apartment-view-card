# v2.2 "Your Home at a Glance" — P0 build

Spec: docs/design/2026-06-27-world-class-card.md
Approach: sequential increments, each TDD + green gate + real-HA verify (frontend) + commit.

## Track A — glance layer (sequential; shared marker-overlay)
- [x] A1 `src/core/label.ts`: LabelSource/LabelConfig/LabelDefaults types + pure resolver
      table (presets) + `state` locale fallback chain + battery tiebreak. Unit tests.
- [x] A2 config: EntityConfig.label + CardOptions.labels (+ `smart` map) + normalize/migrate. Tests.
- [x] A3 marker-overlay render: MarkerView gains label/offline; visibility engine
      (auto/always/active/never); spatial-collision cull; edge-aware auto-flip; frosted plate;
      values OUT of aria-label; RTL logical props; reduced-motion. Tests + harness + real-HA.
- [ ] A4 attention badges + "N need attention" + unavailable/offline marker treatment. Tests + verify.
- [ ] A5 presence/motion pulse (capped ~3, decaying, reduced-motion). Tests + verify.

## Track B — controls (independent; control-surface + entity-capabilities)
- [x] B1 entity-capabilities: extend ControlKind (cover/fan/lock + switch/toggle); coverCaps/
      fanCaps/lockCaps; group resolution (group.*/light.all_* -> members). Tests.
- [x] B2 control-surface bodies: cover (open/stop/close + position), fan (speed/preset/oscillate),
      lock (lock/unlock + jammed, confirm guard). Tests + harness + real-HA.
- [x] B3 tap disambiguation (honor tap: more-info on controllable) + invisible >=44px hit target. Tests.

## Track C — editor (sequential; editor files; real-HA verify each)
- [ ] C1 4-tab shell (Floorplan/Devices/Lighting/Zones) over pinned preview; native ha-form only.
- [ ] C2 per-entity Basic/Advanced expandable groups incl. the Label sub-schema; smart-defaults-on-pick.
- [ ] C3 Devices search/filter/bulk at >=6; Import-from-Area drag tray; empty-state dropzone;
      one-click `smart` upsell.

## Order
A1 -> A2 -> A3 -> A4 -> A5, then B1 -> B2 -> B3, then C1 -> C2 -> C3.
(Labels are YAML-configurable + harness-testable before the editor exposes them.)

## Review notes
(filled as we go)
