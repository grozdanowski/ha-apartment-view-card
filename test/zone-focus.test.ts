import { describe, it, expect } from 'vitest';
import { entityInFocusedZone } from '../src/render/zone-focus';
import type { EntityConfig, ZoneConfig } from '../src/core/config';

function ent(x: number, y: number): EntityConfig {
  return {
    entity: 'light.test',
    x,
    y,
    size: 'small',
    tap: 'toggle',
    orientation: null,
  };
}

// living (big) fully contains study (small, inner). Point (55,55) is inside both;
// smallest-area = study, so its membership is study.
const living: ZoneConfig = { name: 'living', x: 40, y: 40, width: 50, height: 50 };
const study: ZoneConfig = { name: 'study', x: 50, y: 50, width: 15, height: 15 };
const kitchen: ZoneConfig = { name: 'kitchen', x: 0, y: 0, width: 30, height: 30 };
const zones = [living, study, kitchen];

describe('entityInFocusedZone', () => {
  it('is true for any entity when no zone is focused', () => {
    expect(entityInFocusedZone(ent(55, 55), null, zones)).toBe(true);
    expect(entityInFocusedZone(ent(95, 95), null, zones)).toBe(true);
  });

  it('matches on smallest-area membership, not raw containment', () => {
    // (55,55) is in living AND study; membership is study (smaller area).
    expect(entityInFocusedZone(ent(55, 55), study, zones)).toBe(true);
    expect(entityInFocusedZone(ent(55, 55), living, zones)).toBe(false);
  });

  it('matches living for a point only inside living', () => {
    // (43,80) inside living (40..90 x, 40..90 y) but not study.
    expect(entityInFocusedZone(ent(43, 80), living, zones)).toBe(true);
    expect(entityInFocusedZone(ent(43, 80), study, zones)).toBe(false);
  });

  it('is false for an entity in zero zones when a zone is focused', () => {
    expect(entityInFocusedZone(ent(98, 5), kitchen, zones)).toBe(false);
  });
});
