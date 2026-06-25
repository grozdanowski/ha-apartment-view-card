import { describe, it, expect } from 'vitest';
import { zoomToZone } from '../src/core/geometry';
import type { Viewport } from '../src/core/geometry';
import type { ZoneConfig } from '../src/core/config';

const vp: Viewport = { width: 1000, height: 800 };

function zone(partial: Partial<ZoneConfig>): ZoneConfig {
  return { name: 'z', x: 0, y: 0, width: 50, height: 50, ...partial };
}

describe('zoomToZone', () => {
  it('uses the zone-fit scale when it is below the cap (no letterboxing)', () => {
    // 50%-wide / 50%-tall zone fits at scale 2 (100/50); cap is higher.
    const t = zoomToZone(zone({ width: 50, height: 50 }), vp, 3);
    expect(t.scale).toBeCloseTo(2, 6);
  });

  it('takes the limiting (larger) percent dimension for fit scale', () => {
    // width 50 -> 2x, height 25 -> 4x; fit = min(2,4) = 2 (width-limited).
    const t = zoomToZone(zone({ width: 50, height: 25 }), vp, 10);
    expect(t.scale).toBeCloseTo(2, 6);
  });

  it('clamps scale to maxScale when the zone would zoom in further', () => {
    // 10% zone wants 10x; cap at 1.5.
    const t = zoomToZone(zone({ x: 45, y: 45, width: 10, height: 10 }), vp, 1.5);
    expect(t.scale).toBeCloseTo(1.5, 6);
  });

  it('centers the zone center in the viewport when away from edges', () => {
    // Zone center at 50%,50% => image px (500,400). At scale 1.5 the pan that
    // centers it is 500 - 500*1.5 = -250 (x), 400 - 400*1.5 = -200 (y), both
    // within clamp range [1000*(1-1.5),0]=[-500,0] and [800*(-0.5),0]=[-400,0].
    const t = zoomToZone(zone({ x: 40, y: 40, width: 20, height: 20 }), vp, 1.5);
    expect(t.scale).toBeCloseTo(1.5, 6);
    expect(t.panX).toBeCloseTo(-250, 6);
    expect(t.panY).toBeCloseTo(-200, 6);
  });

  it('clamps pan to keep the scaled image covering the viewport (top-left zone)', () => {
    // Zone hugging top-left; centering would push pan positive (gutter on left),
    // clamp to 0.
    const t = zoomToZone(zone({ x: 0, y: 0, width: 20, height: 20 }), vp, 1.5);
    expect(t.scale).toBeCloseTo(1.5, 6);
    expect(t.panX).toBeCloseTo(0, 6);
    expect(t.panY).toBeCloseTo(0, 6);
  });

  it('clamps pan to keep the scaled image covering the viewport (bottom-right zone)', () => {
    // Zone hugging bottom-right; centering would expose right/bottom gutter,
    // clamp to the minimum pan = vp * (1 - scale).
    const t = zoomToZone(zone({ x: 80, y: 80, width: 20, height: 20 }), vp, 1.5);
    expect(t.panX).toBeCloseTo(1000 * (1 - 1.5), 6); // -500
    expect(t.panY).toBeCloseTo(800 * (1 - 1.5), 6); // -400
  });

  it('at scale 1 (zone fills image) pan is exactly 0', () => {
    const t = zoomToZone(zone({ x: 0, y: 0, width: 100, height: 100 }), vp, 1.5);
    expect(t.scale).toBeCloseTo(1, 6);
    expect(t.panX).toBeCloseTo(0, 6);
    expect(t.panY).toBeCloseTo(0, 6);
  });
});
