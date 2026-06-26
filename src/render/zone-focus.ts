import type { EntityConfig, ZoneConfig } from '../core/config';
import { zoneForPoint } from '../core/config';

/**
 * True when the entity's membership zone (smallest-area containing zone) is the
 * focused zone. In overview (focused === null) every entity is "in focus".
 * Drives marker dimming: in-focus markers render normally, the rest get the
 * `.dimmed` class (opacity 0.25, pointer-events:none) from the card stylesheet.
 */
export function entityInFocusedZone(
  entity: EntityConfig,
  focused: ZoneConfig | null,
  zones: ZoneConfig[],
): boolean {
  if (focused === null) return true;
  return zoneForPoint(entity.x, entity.y, zones) === focused;
}
