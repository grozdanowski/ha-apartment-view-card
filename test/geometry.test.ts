import { describe, it, expect } from 'vitest';
import { sizeTierFraction, haloRadiusPx } from '../src/core/geometry';

describe('sizeTierFraction', () => {
  it('tiny -> 0.09', () => expect(sizeTierFraction('tiny')).toBe(0.09));
  it('small -> 0.13', () => expect(sizeTierFraction('small')).toBe(0.13));
  it('medium -> 0.17', () => expect(sizeTierFraction('medium')).toBe(0.17));
  it('large -> 0.22', () => expect(sizeTierFraction('large')).toBe(0.22));
  it('huge -> 0.28', () => expect(sizeTierFraction('huge')).toBe(0.28));
});

describe('haloRadiusPx', () => {
  it('medium at cardWidth=1000, brightness=1 -> 170', () => {
    expect(haloRadiusPx(1000, 'medium', 1)).toBeCloseTo(170, 5);
  });
  it('medium at cardWidth=1000, brightness=0 -> 76.5', () => {
    expect(haloRadiusPx(1000, 'medium', 0)).toBeCloseTo(76.5, 5);
  });
  it('small at cardWidth=1000, brightness=1 -> 130', () => {
    expect(haloRadiusPx(1000, 'small', 1)).toBeCloseTo(130, 5);
  });
  it('tiny at cardWidth=500, brightness=0.5 -> 0.09*500*(0.45+0.275)', () => {
    expect(haloRadiusPx(500, 'tiny', 0.5)).toBeCloseTo(0.09 * 500 * 0.725, 5);
  });
});
