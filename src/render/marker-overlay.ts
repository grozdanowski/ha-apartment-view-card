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

/**
 * Render the interactive overlay. The container is NOT transformed; each
 * marker is absolutely positioned in screen px via computed left/top.
 * Unfocused markers (focused=false) are dimmed to 0.25 opacity and
 * pointer-events:none. Pointer handling is delegated to the host via
 * onPointerDown so tap/hold/drag are decided in one place.
 */
export function renderMarkerOverlay(
  views: MarkerView[],
  onPointerDown: (e: PointerEvent, m: MarkerView) => void
): TemplateResult {
  return html`
    <div class="marker-overlay" part="marker-overlay">
      ${views.map((m) => {
        const style = [
          `left:${m.left}px`,
          `top:${m.top}px`,
          `transform:translate(-50%,-50%) scale(${m.iconScale})`,
          m.focused ? '' : 'opacity:0.25',
          m.focused ? '' : 'pointer-events:none',
        ]
          .filter(Boolean)
          .join(';');
        return html`
          <button
            class="marker${m.active ? ' active' : ''}"
            title=${m.entity.name ?? m.entity.entity}
            style=${style}
            @pointerdown=${(e: PointerEvent) => onPointerDown(e, m)}
          >
            <ha-icon icon=${m.icon}></ha-icon>
          </button>
        `;
      })}
    </div>
  `;
}
