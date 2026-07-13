import type { EntityConfig, ZoneConfig } from '../core/config';
import { zoneForEntity } from '../core/config';

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
  const membership = zoneForEntity(entity, zones);
  if (membership === null) return false;
  return focused.id && membership.id ? membership.id === focused.id : membership === focused;
}
