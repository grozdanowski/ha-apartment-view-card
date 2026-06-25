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
