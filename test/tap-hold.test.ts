import { describe, it, expect } from 'vitest';
import {
  TapHoldTracker,
  MOVE_THRESHOLD_PX,
  HOLD_MS,
} from '../src/core/tap-hold';

describe('TapHoldTracker thresholds', () => {
  it('exposes the spec constants', () => {
    expect(MOVE_THRESHOLD_PX).toBe(8);
    expect(HOLD_MS).toBe(450);
  });

  it('quick small release is a tap (<8px, <450ms)', () => {
    const g = new TapHoldTracker();
    g.start(100, 100, 0);
    g.move(104, 103); // ~5px, under threshold
    expect(g.end(200)).toBe('tap'); // 200ms < 450ms
  });

  it('movement exactly at 8px is NOT yet a drag (strictly greater)', () => {
    const g = new TapHoldTracker();
    g.start(0, 0, 0);
    const r = g.move(8, 0); // dist == 8
    expect(r.exceededThreshold).toBe(false);
    expect(g.end(100)).toBe('tap');
  });

  it('movement >8px becomes a drag and cancels hold', () => {
    const g = new TapHoldTracker();
    g.start(0, 0, 0);
    const r = g.move(9, 0); // dist == 9 > 8
    expect(r.exceededThreshold).toBe(true);
    expect(g.holdElapsed(1000)).toBe(false); // moved -> no hold
    expect(g.end(1000)).toBe('drag');
  });

  it('threshold latches: a later return inside 8px stays a drag', () => {
    const g = new TapHoldTracker();
    g.start(0, 0, 0);
    g.move(20, 0); // far -> latch drag
    g.move(1, 0); // back near origin
    expect(g.end(100)).toBe('drag');
  });

  it('held past 450ms without moving is a hold', () => {
    const g = new TapHoldTracker();
    g.start(50, 50, 0);
    expect(g.holdElapsed(449)).toBe(false);
    expect(g.holdElapsed(450)).toBe(true); // >= 450ms
    expect(g.end(500)).toBe('hold');
  });

  it('release after 450ms with no movement and no fired hold still reads as hold', () => {
    const g = new TapHoldTracker();
    g.start(0, 0, 0);
    // never called holdElapsed (e.g. timer-less path) but end is late & still
    expect(g.end(600)).toBe('hold');
  });

  it('end without start is none; reset clears state', () => {
    const g = new TapHoldTracker();
    expect(g.end(100)).toBe('none');
    g.start(0, 0, 0);
    g.reset();
    expect(g.end(100)).toBe('none');
  });
});
