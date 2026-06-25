import { describe, it, expect } from 'vitest';
import {
  acRadarColor,
  radarArcsCss,
  RADAR_ARC_COUNT,
  RADAR_KEYFRAMES,
} from '../src/render/effect-layer';
import type { HassEntity } from '../src/core/ha-types';

function climate(state: string, attrs: Record<string, unknown> = {}): HassEntity {
  return {
    entity_id: 'climate.ac',
    state,
    attributes: attrs,
  };
}

describe('RADAR_ARC_COUNT', () => {
  it('is 5 arcs', () => {
    expect(RADAR_ARC_COUNT).toBe(5);
  });
});

describe('acRadarColor', () => {
  it('blue when hvac_action cooling', () => {
    expect(acRadarColor(climate('cool', { hvac_action: 'cooling' }))).toBe('rgb(95, 165, 255)');
  });
  it('red when hvac_action heating', () => {
    expect(acRadarColor(climate('heat', { hvac_action: 'heating' }))).toBe('rgb(255, 95, 95)');
  });
  it('blue when state cool and no hvac_action', () => {
    expect(acRadarColor(climate('cool'))).toBe('rgb(95, 165, 255)');
  });
  it('blue when state dry', () => {
    expect(acRadarColor(climate('dry'))).toBe('rgb(95, 165, 255)');
  });
  it('red when state heat and no hvac_action', () => {
    expect(acRadarColor(climate('heat'))).toBe('rgb(255, 95, 95)');
  });
  it('gray for heat_cool (ambiguous)', () => {
    expect(acRadarColor(climate('heat_cool'))).toBe('rgb(150, 150, 150)');
  });
  it('gray for auto (ambiguous)', () => {
    expect(acRadarColor(climate('auto'))).toBe('rgb(150, 150, 150)');
  });
  it('gray for fan_only (ambiguous)', () => {
    expect(acRadarColor(climate('fan_only'))).toBe('rgb(150, 150, 150)');
  });
  it('hvac_action wins over state (idle action while state heat => gray? no: action authoritative)', () => {
    // hvac_action 'idle' is not cooling/heating => falls through to state 'heat' => red
    expect(acRadarColor(climate('heat', { hvac_action: 'idle' }))).toBe('rgb(255, 95, 95)');
  });
});

describe('radarArcsCss', () => {
  it('arc style has 4.5px border in the given color and staggered 480ms delay', () => {
    const { arc } = radarArcsCss(2, 'rgb(95, 165, 255)', null);
    expect(arc.border).toBe('4.5px solid rgb(95, 165, 255)');
    expect(arc.animation).toBe('radar-ripple 2.4s linear infinite');
    expect(arc['animation-delay']).toBe('960ms'); // 2 * 480
  });
  it('arc 0 has zero delay', () => {
    const { arc } = radarArcsCss(0, 'rgb(150, 150, 150)', null);
    expect(arc['animation-delay']).toBe('0ms');
  });
  it('omni (orientation null) => container has no cone mask', () => {
    const { container } = radarArcsCss(0, 'rgb(95, 165, 255)', null);
    expect(container['mask-image']).toBeUndefined();
  });
  it('directional => container masked by the 34/14 device cone', () => {
    const { container } = radarArcsCss(0, 'rgb(95, 165, 255)', 90);
    expect(container['mask-image']).toBe(
      'conic-gradient(from 90deg at 50% 50%, black 0deg, black 34deg, transparent 48deg, transparent 312deg, black 326deg, black 360deg)'
    );
    expect(container['-webkit-mask-image']).toBe(container['mask-image']);
  });
});

describe('RADAR_KEYFRAMES', () => {
  it('defines radar-ripple growing scale with the 0.3-0.7 opacity band', () => {
    expect(RADAR_KEYFRAMES).toContain('@keyframes radar-ripple');
    expect(RADAR_KEYFRAMES).toContain('scale(0)');
    expect(RADAR_KEYFRAMES).toContain('scale(1)');
    expect(RADAR_KEYFRAMES).toContain('opacity: 0.7');
    expect(RADAR_KEYFRAMES).toContain('opacity: 0.3');
  });
});
