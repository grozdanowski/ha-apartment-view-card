import { describe, it, expect } from 'vitest';
import {
  pointToPercent,
  percentToPoint,
  rectFromDrag,
} from '../src/editor/preview-geometry';

const rect = { left: 100, top: 50, width: 400, height: 200 };

describe('pointToPercent', () => {
  it('maps a screen point to image percentages', () => {
    expect(pointToPercent(300, 150, rect)).toEqual({ x: 50, y: 50 });
  });
  it('clamps below the origin to 0', () => {
    expect(pointToPercent(0, 0, rect)).toEqual({ x: 0, y: 0 });
  });
  it('clamps past the far edge to 100', () => {
    expect(pointToPercent(9999, 9999, rect)).toEqual({ x: 100, y: 100 });
  });
});

describe('percentToPoint', () => {
  it('maps percentages back to px relative to the rect origin', () => {
    expect(percentToPoint(50, 50, rect)).toEqual({ x: 200, y: 100 });
  });
  it('round-trips with pointToPercent at the center', () => {
    const p = percentToPoint(25, 75, rect);
    const back = pointToPercent(p.x + rect.left, p.y + rect.top, rect);
    expect(back.x).toBeCloseTo(25);
    expect(back.y).toBeCloseTo(75);
  });
});

describe('rectFromDrag', () => {
  it('normalizes a top-left -> bottom-right drag', () => {
    expect(rectFromDrag(10, 20, 40, 60)).toEqual({
      x: 10,
      y: 20,
      width: 30,
      height: 40,
    });
  });
  it('normalizes a reversed (bottom-right -> top-left) drag', () => {
    expect(rectFromDrag(40, 60, 10, 20)).toEqual({
      x: 10,
      y: 20,
      width: 30,
      height: 40,
    });
  });
  it('clamps the rect within 0-100 bounds', () => {
    expect(rectFromDrag(-10, -10, 120, 130)).toEqual({
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    });
  });
});
