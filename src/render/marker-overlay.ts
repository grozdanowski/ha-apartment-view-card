import { html, nothing, type TemplateResult } from 'lit';
import { ifDefined } from 'lit/directives/if-defined.js';
import type { HassEntity, HassLike } from '../core/ha-types';
import type { EntityConfig } from '../core/config';
import { isActive, intensity, iconForEntity } from '../core/entity-state';
import { resolveLightColor, rgbCss } from '../core/light-color';
import {
  effectiveLabel,
  formatLabel,
  DEFAULT_LABELS,
  type LabelDefaults,
  type LabelVisibility,
} from '../core/label';
import { attentionFor, ATTENTION_ICON, type Attention } from '../core/attention';
import {
  markerScreenPos,
  clampIconScale,
  type Viewport,
  type ZoomTransform,
} from '../core/geometry';

export type LabelAnchor = 'start' | 'center' | 'end';

/** A label decision snapshotted at gesture start (spec P0-2): while a gesture
 * is active the collision cull is skipped and these are reused verbatim. */
export interface FrozenLabel {
  text: string | null;
  anchor: LabelAnchor;
}

export interface MarkerView {
  entity: EntityConfig;
  state: HassEntity | undefined;
  left: number;
  top: number;
  iconScale: number;
  icon: string;
  /** Accessibility name: config name -> entity friendly_name -> entity id. */
  label: string;
  active: boolean;
  focused: boolean;
  /** Resolved light colour (rgb css) when an active light, else undefined — drives the color-matched glow. */
  glowColor?: string;
  /** Brightness 0..1 for active lights (drives the glow strength + brightness ring); 0 otherwise. */
  brightness: number;
  /** "Lights control" multi-select mode is active. */
  selectMode: boolean;
  /** This marker can be checked in select mode (a light, in the focused zone if any). */
  selectable: boolean;
  /** Currently checked in the selection. */
  selected: boolean;
  /** Device offline (unavailable/unknown): desaturated chip, dashed ring, no glow, no value label. */
  offline: boolean;
  /** Dynamic value label text to paint on the floorplan, or null (after visibility + collision cull). */
  labelText: string | null;
  /** Horizontal anchoring of the label relative to the marker point (edge-aware). */
  labelAnchor: LabelAnchor;
  /** Auto-derived "needs attention" state (open door, leak, unlocked, low battery, offline), or null. */
  attention: Attention | null;
}

function isLight(entity: EntityConfig, state: HassEntity | undefined): boolean {
  return (state?.entity_id ?? entity.entity).split('.')[0] === 'light';
}

/** config name -> entity friendly_name -> raw entity id (never the raw id when a friendly name exists). */
function markerLabel(
  entity: EntityConfig,
  state: HassEntity | undefined,
): string {
  const friendly = state?.attributes?.friendly_name;
  return (
    entity.name ??
    (typeof friendly === 'string' && friendly.length > 0 ? friendly : undefined) ??
    entity.entity
  );
}

function anchorFor(xPercent: number): LabelAnchor {
  return xPercent < 28 ? 'start' : xPercent > 72 ? 'end' : 'center';
}

interface LabelBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}
/** Estimate a label's screen box (below the chip), matching the CSS anchoring. */
function labelBoxFor(view: MarkerView, text: string): LabelBox {
  const w = Math.min(120, text.length * 7.2 + 16);
  const h = 19;
  const y1 = view.top + 20 * view.iconScale + 6; // just below the chip
  let x1: number;
  if (view.labelAnchor === 'start') x1 = view.left - 12;
  else if (view.labelAnchor === 'end') x1 = view.left + 12 - w;
  else x1 = view.left - w / 2;
  return { x1, y1, x2: x1 + w, y2: y1 + h };
}
function boxesOverlap(a: LabelBox, b: LabelBox): boolean {
  return a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;
}

/**
 * Project entity configs into absolute screen-px placements for the
 * NON-transformed overlay. `focusedZoneEntityIds === null` => overview
 * (no dimming); otherwise entities not in the set render unfocused (0.25).
 *
 * Dynamic value labels are resolved here (visibility engine + spatial-collision
 * cull) so the render stays a pure projection of MarkerView.
 *
 * `frozenLabels` (spec P0-2): while a gesture is active the caller supplies
 * the label decisions snapshotted at gesture start — formatting and the
 * O(n²) collision cull are skipped entirely, so per-frame calls stay cheap.
 */
export function computeMarkerViews(
  entities: EntityConfig[],
  states: Record<string, HassEntity>,
  t: ZoomTransform,
  vp: Viewport,
  focusedZoneEntityIds: Set<string> | null,
  selectMode = false,
  selectedIds: ReadonlySet<string> = new Set(),
  labelDefaults: LabelDefaults = DEFAULT_LABELS,
  hass?: HassLike,
  maxIconScale = 2.0,
  frozenLabels?: ReadonlyMap<string, FrozenLabel>,
): MarkerView[] {
  const zoneFocused = focusedZoneEntityIds !== null;

  // First pass: base views + tentative (pre-collision) label decision.
  const records = entities.map((entity) => {
    const state = states[entity.entity];
    const { left, top } = markerScreenPos(entity.x, entity.y, t, vp);
    const active = state ? isActive(state) : false;
    const light = isLight(entity, state);
    const brightness = light && state ? intensity(state) : 0;
    const focused =
      focusedZoneEntityIds === null ? true : focusedZoneEntityIds.has(entity.entity);
    const offline = !state || state.state === 'unavailable' || state.state === 'unknown';

    const cfg = effectiveLabel(entity.label, labelDefaults, entity.entity);
    const vis: LabelVisibility = cfg?.visibility ?? labelDefaults.visibility;
    // Offline / select-mode / dimmed markers never paint a value label.
    // Frozen mode skips formatting — the snapshot is applied wholesale below.
    const text =
      !frozenLabels && cfg && !offline && !selectMode && focused
        ? formatLabel(cfg, state, hass)
        : null;
    let show = false;
    if (text) {
      if (vis === 'always') show = true;
      else if (vis === 'active') show = active;
      else if (vis === 'auto') show = t.scale >= 1.25 || (zoneFocused && focused);
    }

    const view: MarkerView = {
      entity,
      state,
      left,
      top,
      iconScale: clampIconScale(t.scale, maxIconScale),
      icon: state ? iconForEntity(state, entity) : (entity.icon ?? 'mdi:checkbox-blank-circle'),
      label: markerLabel(entity, state),
      active,
      focused,
      glowColor: light && active && state ? rgbCss(resolveLightColor(state)) : undefined,
      brightness,
      selectMode,
      selectable: selectMode && light && focused,
      selected: selectedIds.has(entity.entity),
      offline,
      labelText: null, // set after the collision cull below
      labelAnchor: anchorFor(entity.x),
      attention: attentionFor(state),
    };
    return { view, text, vis, show, active };
  });

  // Gesture freeze: reuse the snapshotted decisions verbatim — no cull.
  if (frozenLabels) {
    for (const r of records) {
      const f = frozenLabels.get(r.view.entity.entity);
      if (f) {
        r.view.labelText = f.text;
        r.view.labelAnchor = f.anchor;
      }
    }
    return records.map((r) => r.view);
  }

  // Second pass: cull overlapping AUTO labels by priority; explicit always/active
  // labels are never culled and reserve their boxes first. densityCap is a final ceiling.
  const cx = vp.width / 2;
  const cy = vp.height / 2;
  const shown = records.filter((r) => r.show && r.text);
  const kept: LabelBox[] = [];
  for (const r of shown.filter((r) => r.vis !== 'auto')) {
    kept.push(labelBoxFor(r.view, r.text as string));
  }
  const auto = shown
    .filter((r) => r.vis === 'auto')
    .sort((a, b) => {
      if (a.active !== b.active) return a.active ? -1 : 1; // active first
      const da = (a.view.left - cx) ** 2 + (a.view.top - cy) ** 2;
      const db = (b.view.left - cx) ** 2 + (b.view.top - cy) ** 2;
      return da - db; // then nearest to centre
    });
  let autoCount = 0;
  for (const r of auto) {
    const box = labelBoxFor(r.view, r.text as string);
    if (autoCount >= labelDefaults.densityCap || kept.some((b) => boxesOverlap(b, box))) {
      r.show = false;
    } else {
      kept.push(box);
      autoCount++;
    }
  }

  for (const r of records) r.view.labelText = r.show && r.text ? r.text : null;
  return records.map((r) => r.view);
}

/**
 * Render the interactive overlay. The container is NOT transformed; each
 * marker is positioned in screen px via an inline translate3d transform
 * (compositor path, spec P0-2 — left/top stay 0 so per-frame position
 * updates never touch layout). Unfocused markers (focused=false) are dimmed
 * to 0.25 opacity and pointer-events:none. Pointer handling is delegated to
 * the host via onPointerDown so tap/hold/drag are decided in one place.
 */
const LABEL_ANCHOR_X: Record<LabelAnchor, string> = {
  // Mirrors the pre-compositor CSS anchor rules: centered below the chip,
  // or left/right-aligned near the viewport edges (folded into the inline
  // transform because inline `transform` would override anchor classes).
  start: '-12px',
  center: '-50%',
  end: 'calc(-100% + 12px)',
};
export function renderMarkerOverlay(
  views: MarkerView[],
  onPointerDown: (e: PointerEvent, m: MarkerView) => void,
  onActivate: (m: MarkerView) => void,
  pulse = false,
  ready = true,
): TemplateResult {
  return html`
    <div
      class="marker-overlay ${pulse ? 'pulse' : ''} ${ready ? 'ready' : ''}"
      part="marker-overlay"
    >
      ${views.map((m) => {
        const style = [
          `transform:translate3d(${m.left}px, ${m.top}px, 0) translate(-50%,-50%) scale(${m.iconScale})`,
          ...(m.glowColor ? [`--marker-glow:${m.glowColor}`] : []),
        ].join(';');
        const ariaLabel = m.state ? `${m.label}, ${m.state.state}` : m.label;
        const interactive = m.selectMode ? m.selectable : m.focused;
        const cls = ['marker'];
        if (m.active) cls.push('active');
        if (m.offline) cls.push('offline');
        if (m.attention && !m.selectMode) cls.push('has-attention');
        if (!m.focused) cls.push('dimmed');
        if (m.selectMode) {
          cls.push(m.selectable ? 'selectable' : 'select-dim');
          if (m.selected) cls.push('selected');
        }
        // aria-pressed reflects selection in select mode, else the on/off toggle.
        const pressed = m.selectMode
          ? m.selectable
            ? String(m.selected)
            : undefined
          : m.entity.tap === 'toggle'
            ? String(m.active)
            : undefined;
        return html`
          <button
            class=${cls.join(' ')}
            title=${m.label}
            aria-label=${ariaLabel}
            aria-pressed=${ifDefined(pressed)}
            tabindex=${interactive ? '0' : '-1'}
            aria-hidden=${ifDefined(interactive ? undefined : 'true')}
            style=${style}
            @pointerdown=${(e: PointerEvent) => onPointerDown(e, m)}
            @click=${(e: MouseEvent) => {
              // Keyboard (Enter/Space) fires click with detail 0; pointer taps
              // (detail >= 1) are already handled by the gesture machinery.
              if (e.detail === 0) onActivate(m);
            }}
          >
            <ha-icon icon=${m.icon}></ha-icon>
            ${m.selectMode && (m.selectable || m.selected)
              ? html`<span class="marker-check"><ha-icon icon="mdi:check"></ha-icon></span>`
              : m.attention
                ? html`<span class="marker-badge sev-${m.attention.severity}" title=${m.attention.label}
                    ><ha-icon icon=${ATTENTION_ICON[m.attention.kind]}></ha-icon></span>`
                : nothing}
          </button>
          ${m.labelText
            ? html`<span
                class="marker-label anchor-${m.labelAnchor}"
                aria-hidden="true"
                title=${m.labelText}
                style="--label-dy:${Math.round(20 * m.iconScale + 6)}px;transform:translate3d(${m.left}px, ${m.top}px, 0) translate(${LABEL_ANCHOR_X[m.labelAnchor]}, var(--label-dy, 26px))"
                >${m.labelText}</span>`
            : nothing}
        `;
      })}
    </div>
  `;
}
