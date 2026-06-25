import type { ZoneConfig } from '../core/config';

export const BACK_TO_ALL_LABEL = '← Back to All';
export const ZONE_DEFAULT_ICON = 'mdi:select-marker';
export const BACK_CHIP_ICON = 'mdi:arrow-left';

export interface ZoneChip {
  kind: 'back' | 'zone';
  label: string;
  icon: string;
  zone: ZoneConfig | null;
  index: number;
}

/**
 * Horizontal zone-control model (spec §5).
 *  - overview (focused === null): one chip per zone in config order, no Overview chip.
 *  - zoomed (focused !== null): a "← Back to All" chip first, then the zone chips.
 * `index` is the position in the returned array.
 */
export function buildZoneChips(
  zones: ZoneConfig[],
  focused: ZoneConfig | null,
): ZoneChip[] {
  const chips: ZoneChip[] = [];

  if (focused !== null) {
    chips.push({
      kind: 'back',
      label: BACK_TO_ALL_LABEL,
      icon: BACK_CHIP_ICON,
      zone: null,
      index: 0,
    });
  }

  for (const zone of zones) {
    chips.push({
      kind: 'zone',
      label: zone.name,
      icon: zone.icon && zone.icon.length > 0 ? zone.icon : ZONE_DEFAULT_ICON,
      zone,
      index: chips.length,
    });
  }

  return chips;
}
