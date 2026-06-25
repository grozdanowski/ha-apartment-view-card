import { describe, it, expect } from 'vitest';
import {
  buildZoneChips,
  BACK_TO_ALL_LABEL,
  ZONE_DEFAULT_ICON,
} from '../src/render/zone-controls';
import type { ZoneConfig } from '../src/core/config';

const living: ZoneConfig = { name: 'Living', icon: 'mdi:sofa', x: 0, y: 0, width: 50, height: 50 };
const bath: ZoneConfig = { name: 'Bath', x: 60, y: 0, width: 20, height: 20 }; // no icon
const zones = [living, bath];

describe('buildZoneChips', () => {
  it('overview: one chip per zone, in order, no Overview chip, no Back chip', () => {
    const chips = buildZoneChips(zones, null);
    expect(chips.map((c) => c.kind)).toEqual(['zone', 'zone']);
    expect(chips.map((c) => c.label)).toEqual(['Living', 'Bath']);
    expect(chips[0].zone).toBe(living);
    expect(chips[1].zone).toBe(bath);
    expect(chips.map((c) => c.index)).toEqual([0, 1]);
  });

  it('overview: falls back to ZONE_DEFAULT_ICON when a zone has no icon', () => {
    const chips = buildZoneChips(zones, null);
    expect(chips[0].icon).toBe('mdi:sofa');
    expect(chips[1].icon).toBe(ZONE_DEFAULT_ICON);
  });

  it('zoomed: prepends a Back-to-All chip as index 0, then zones', () => {
    const chips = buildZoneChips(zones, living);
    expect(chips[0].kind).toBe('back');
    expect(chips[0].label).toBe(BACK_TO_ALL_LABEL);
    expect(chips[0].icon).toBe('mdi:arrow-left');
    expect(chips[0].zone).toBeNull();
    expect(chips[0].index).toBe(0);
    expect(chips.slice(1).map((c) => c.label)).toEqual(['Living', 'Bath']);
    expect(chips.slice(1).map((c) => c.index)).toEqual([1, 2]);
  });

  it('zoomed: still includes the focused zone chip (re-tap is a no-op upstream)', () => {
    const chips = buildZoneChips(zones, living);
    expect(chips.find((c) => c.zone === living)).toBeTruthy();
  });

  it('empty zones, overview: produces no chips', () => {
    expect(buildZoneChips([], null)).toEqual([]);
  });
});
