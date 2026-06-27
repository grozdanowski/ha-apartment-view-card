import { html, nothing, type TemplateResult } from 'lit';
import { ifDefined } from 'lit/directives/if-defined.js';
import type { HassEntity } from '../core/ha-types';
import type { EntityConfig } from '../core/config';
import { isActive, intensity, iconForEntity } from '../core/entity-state';
import { resolveLightColor, rgbCss } from '../core/light-color';
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
  /** Human label: config name -> entity friendly_name -> entity id. */
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
  focusedZoneEntityIds: Set<string> | null,
  selectMode = false,
  selectedIds: ReadonlySet<string> = new Set(),
): MarkerView[] {
  return entities.map((entity) => {
    const state = states[entity.entity];
    const { left, top } = markerScreenPos(entity.x, entity.y, t, vp);
    const active = state ? isActive(state) : false;
    const light = isLight(entity, state);
    const brightness = light && state ? intensity(state) : 0;
    const focused =
      focusedZoneEntityIds === null ? true : focusedZoneEntityIds.has(entity.entity);
    return {
      entity,
      state,
      left,
      top,
      iconScale: clampIconScale(t.scale),
      icon: state ? iconForEntity(state, entity) : (entity.icon ?? 'mdi:checkbox-blank-circle'),
      label: markerLabel(entity, state),
      active,
      focused,
      glowColor: light && active && state ? rgbCss(resolveLightColor(state)) : undefined,
      brightness,
      selectMode,
      // only lights are selectable, and only within the focused zone when one is focused
      selectable: selectMode && light && focused,
      selected: selectedIds.has(entity.entity),
    };
  });
}

/**
 * Render the interactive overlay. The container is NOT transformed; each
 * marker is absolutely positioned in screen px via computed left/top.
 * Unfocused markers (focused=false) are dimmed to 0.25 opacity and
 * pointer-events:none. Pointer handling is delegated to the host via
 * onPointerDown so tap/hold/drag are decided in one place.
 */
export function renderMarkerOverlay(
  views: MarkerView[],
  onPointerDown: (e: PointerEvent, m: MarkerView) => void,
  onActivate: (m: MarkerView) => void
): TemplateResult {
  return html`
    <div class="marker-overlay" part="marker-overlay">
      ${views.map((m) => {
        const style = [
          `left:${m.left}px`,
          `top:${m.top}px`,
          `transform:translate(-50%,-50%) scale(${m.iconScale})`,
          ...(m.glowColor ? [`--marker-glow:${m.glowColor}`] : []),
        ].join(';');
        const ariaLabel = m.state ? `${m.label}, ${m.state.state}` : m.label;
        const interactive = m.selectMode ? m.selectable : m.focused;
        const cls = ['marker'];
        if (m.active) cls.push('active');
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
              : nothing}
          </button>
        `;
      })}
    </div>
  `;
}
