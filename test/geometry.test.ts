import { describe, it, expect } from 'vitest';
import {
  sizeTierFraction,
  haloRadiusPx,
  markerScreenPos,
  clampIconScale,
  type Viewport,
  type ZoomTransform,
} from '../src/core/geometry';

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

const vp: Viewport = { width: 800, height: 600 };

describe('markerScreenPos', () => {
  it('maps percent to screen px at identity transform', () => {
    const t: ZoomTransform = { scale: 1, panX: 0, panY: 0 };
    // 50% of 800 = 400, 25% of 600 = 150
    expect(markerScreenPos(50, 25, t, vp)).toEqual({ left: 400, top: 150 });
  });

  it('applies scale then pan: left = xPct/100*W*scale + panX', () => {
    const t: ZoomTransform = { scale: 1.5, panX: 30, panY: -20 };
    // left = 50/100*800*1.5 + 30 = 600 + 30 = 630
    // top  = 50/100*600*1.5 - 20 = 450 - 20 = 430
    expect(markerScreenPos(50, 50, t, vp)).toEqual({ left: 630, top: 430 });
  });

  it('handles 0% and 100% corners', () => {
    const t: ZoomTransform = { scale: 2, panX: 10, panY: 5 };
    expect(markerScreenPos(0, 0, t, vp)).toEqual({ left: 10, top: 5 });
    // 100/100*800*2 + 10 = 1610 ; 100/100*600*2 + 5 = 1205
    expect(markerScreenPos(100, 100, t, vp)).toEqual({ left: 1610, top: 1205 });
  });
});

describe('clampIconScale', () => {
  it('passes small scales through unchanged', () => {
    expect(clampIconScale(1)).toBe(1);
    expect(clampIconScale(1.5)).toBe(1.5);
  });

  it('caps icon scale at 2.0 by default', () => {
    expect(clampIconScale(2.0)).toBe(2.0);
    expect(clampIconScale(3.7)).toBe(2.0);
  });

  it('honours a custom max scale (configurable max icon size)', () => {
    expect(clampIconScale(3, 1.5)).toBe(1.5); // capped lower
    expect(clampIconScale(3, 3)).toBe(3); // allowed higher
    expect(clampIconScale(1.2, 3)).toBe(1.2); // below the cap passes through
  });

  it('never lets the max drop the icon below its base size', () => {
    expect(clampIconScale(2, 0.5)).toBe(1); // maxScale floored at 1
  });
});
