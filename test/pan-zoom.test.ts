import { describe, it, expect } from 'vitest';
import { PanZoomController } from '../src/core/pan-zoom';

describe('PanZoomController', () => {
  it('starts at identity transform', () => {
    const c = new PanZoomController({ zoomMax: 1.5 });
    expect(c.transform).toEqual({ scale: 1, panX: 0, panY: 0 });
  });

  it('panBy accumulates translation', () => {
    const c = new PanZoomController({ zoomMax: 1.5 });
    c.panBy(10, 5);
    c.panBy(-3, 2);
    expect(c.transform).toEqual({ scale: 1, panX: 7, panY: 7 });
  });

  it('wheelZoom in raises scale toward zoomMax and anchors to cursor', () => {
    const c = new PanZoomController({ zoomMax: 1.5 });
    // negative deltaY = zoom in
    const t = c.wheelZoom(-100, 0, 0);
    expect(t.scale).toBeGreaterThan(1);
    expect(t.scale).toBeLessThanOrEqual(1.5);
    // anchor at (0,0): pan stays 0 because anchor - (anchor-pan)*k = 0
    expect(t.panX).toBe(0);
    expect(t.panY).toBe(0);
  });

  it('wheelZoom clamps scale at zoomMax', () => {
    const c = new PanZoomController({ zoomMax: 1.5 });
    for (let i = 0; i < 50; i++) c.wheelZoom(-200, 100, 100);
    expect(c.transform.scale).toBe(1.5);
  });

  it('wheelZoom out clamps at minScale (default 1)', () => {
    const c = new PanZoomController({ zoomMax: 3 });
    for (let i = 0; i < 50; i++) c.wheelZoom(200, 100, 100);
    expect(c.transform.scale).toBe(1);
  });

  it('zoom anchored at a non-origin point keeps that point fixed', () => {
    const c = new PanZoomController({ zoomMax: 3 });
    const old = c.transform.scale; // 1
    const t = c.wheelZoom(-100, 200, 100);
    const k = t.scale / old;
    // expected pan = anchor - (anchor - oldPan) * k
    expect(t.panX).toBeCloseTo(200 - (200 - 0) * k, 6);
    expect(t.panY).toBeCloseTo(100 - (100 - 0) * k, 6);
  });

  it('pinchZoom multiplies scale by the factor, clamped', () => {
    const c = new PanZoomController({ zoomMax: 2 });
    c.pinchZoom(1.5, 0, 0); // 1 * 1.5 = 1.5
    expect(c.transform.scale).toBeCloseTo(1.5, 6);
    c.pinchZoom(2, 0, 0); // 1.5 * 2 = 3 -> clamp 2
    expect(c.transform.scale).toBe(2);
  });

  it('pinchDistance is euclidean between two pointers', () => {
    const c = new PanZoomController({ zoomMax: 2 });
    expect(c.pinchDistance(0, 0, 3, 4)).toBeCloseTo(5, 6);
  });

  it('setEnabled(false) freezes all inputs', () => {
    const c = new PanZoomController({ zoomMax: 2 });
    c.setEnabled(false);
    c.panBy(50, 50);
    c.wheelZoom(-100, 10, 10);
    c.pinchZoom(2, 0, 0);
    expect(c.transform).toEqual({ scale: 1, panX: 0, panY: 0 });
  });

  it('reset returns to identity', () => {
    const c = new PanZoomController({ zoomMax: 2 });
    c.panBy(40, 40);
    c.wheelZoom(-200, 5, 5);
    expect(c.reset()).toEqual({ scale: 1, panX: 0, panY: 0 });
    expect(c.transform).toEqual({ scale: 1, panX: 0, panY: 0 });
  });
});

describe('PanZoomController viewport clamp + rubber-band (spec P0-4)', () => {
  const vp = () => ({ width: 100, height: 100 });

  it('the zoom-apply path hard-clamps pan to cover-bounds', () => {
    const c = new PanZoomController({ zoomMax: 3, viewport: vp });
    // Anchor far outside: unclamped pan would be -200; bounds at scale 2 are [-100, 0].
    const t = c.pinchZoom(2, 200, 200);
    expect(t).toEqual({ scale: 2, panX: -100, panY: -100 });
    // Zooming out re-clamps to the tighter bounds of the smaller scale.
    const out = c.pinchZoom(0.75, 0, 0); // scale 1.5 → bounds [-50, 0]
    expect(out.scale).toBeCloseTo(1.5, 6);
    expect(out.panX).toBe(-50);
    expect(out.panY).toBe(-50);
  });

  it('panBy is 1:1 inside bounds; overshoot displays excess × 0.45', () => {
    const c = new PanZoomController({ zoomMax: 3, viewport: vp });
    c.pinchZoom(2, 0, 0); // scale 2 anchored at origin: pan stays 0,0
    expect(c.panBy(-40, -60)).toEqual({ scale: 2, panX: -40, panY: -60 });
    // Push past the min bound: raw -140 → -100 + (-40 × 0.45).
    const t = c.panBy(-100, 0);
    expect(t.panX).toBeCloseTo(-100 + -40 * 0.45, 6);
    expect(t.panY).toBe(-60);
  });

  it('overshoot deltas accumulate in finger-space (resistance never compounds)', () => {
    const c = new PanZoomController({ zoomMax: 3, viewport: vp });
    c.pinchZoom(2, 0, 0);
    c.panBy(20, 0); // raw 20 past the 0 bound → shows 9
    expect(c.transform.panX).toBeCloseTo(20 * 0.45, 6);
    c.panBy(20, 0); // raw 40 → shows 18 (NOT 9 + 20×0.45 re-compressed)
    expect(c.transform.panX).toBeCloseTo(40 * 0.45, 6);
    c.panBy(-40, 0); // finger returns exactly → back on the bound
    expect(c.transform.panX).toBeCloseTo(0, 6);
  });

  it('release() reports overshoot and settles on the clamped rest transform', () => {
    const c = new PanZoomController({ zoomMax: 3, viewport: vp });
    c.pinchZoom(2, 0, 0);
    c.panBy(30, 40); // overshoots the 0,0 bound on both axes
    const { target, overshot } = c.release();
    expect(overshot).toBe(true);
    expect(target).toEqual({ scale: 2, panX: 0, panY: 0 });
    expect(c.transform).toEqual(target); // controller synced to the target
  });

  it('release() without overshoot returns the current transform untouched', () => {
    const c = new PanZoomController({ zoomMax: 3, viewport: vp });
    c.pinchZoom(2, 0, 0);
    c.panBy(-25, -35);
    const { target, overshot } = c.release();
    expect(overshot).toBe(false);
    expect(target).toEqual({ scale: 2, panX: -25, panY: -35 });
  });

  it('no viewport = the original unclamped math and a no-op release()', () => {
    const c = new PanZoomController({ zoomMax: 3 });
    c.pinchZoom(2, 200, 200);
    expect(c.transform).toEqual({ scale: 2, panX: -200, panY: -200 });
    c.panBy(500, 500);
    const { target, overshot } = c.release();
    expect(overshot).toBe(false);
    expect(target).toEqual({ scale: 2, panX: 300, panY: 300 });
  });
});

describe('PanZoomController wheel normalization (spec P0-3 / F6)', () => {
  it('applies the exp curve over normalized pixels: ±100px notch is ×/÷1.246', () => {
    const cIn = new PanZoomController({ zoomMax: 3 });
    expect(cIn.wheelZoom(-100, 0, 0).scale).toBeCloseTo(Math.exp(0.22), 6);
    const cOut = new PanZoomController({ zoomMax: 3, minScale: 0.5 });
    expect(cOut.wheelZoom(100, 0, 0).scale).toBeCloseTo(Math.exp(-0.22), 6);
  });

  it('a 3-line Firefox notch (normalized to 48px by the card) is a gentle step', () => {
    const c = new PanZoomController({ zoomMax: 3 });
    // The card converts deltaMode 1 → px (×16) BEFORE calling wheelZoom.
    expect(c.wheelZoom(-3 * 16, 0, 0).scale).toBeCloseTo(Math.exp(0.1056), 6);
  });

  it('one event never jumps more than ×1.25 / ×0.8 regardless of delta', () => {
    const c = new PanZoomController({ zoomMax: 10, minScale: 0.1 });
    expect(c.wheelZoom(-5000, 0, 0).scale).toBeCloseTo(1.25, 6); // capped in
    c.reset();
    expect(c.wheelZoom(5000, 0, 0).scale).toBeCloseTo(0.8, 6); // capped out
  });
});
