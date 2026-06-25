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
