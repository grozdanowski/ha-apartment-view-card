export type GestureOutcome = 'tap' | 'hold' | 'drag' | 'none';

/** Spec §5: movement >8px cancels hold and becomes a pan/drag. */
export const MOVE_THRESHOLD_PX = 8;
/** Spec §5: press-and-hold >=450ms opens more-info. */
export const HOLD_MS = 450;

/**
 * Pure, time-injectable decision engine for tap vs hold vs drag.
 * Caller feeds pointer coordinates and timestamps (ms); no real timers here.
 */
export class TapHoldTracker {
  private readonly moveThresholdPx: number;
  private readonly holdMs: number;

  private active = false;
  private startX = 0;
  private startY = 0;
  private startT = 0;
  private moved = false; // latches once the move threshold is exceeded

  constructor(opts?: { moveThresholdPx?: number; holdMs?: number }) {
    this.moveThresholdPx = opts?.moveThresholdPx ?? MOVE_THRESHOLD_PX;
    this.holdMs = opts?.holdMs ?? HOLD_MS;
  }

  start(x: number, y: number, t: number): void {
    this.active = true;
    this.startX = x;
    this.startY = y;
    this.startT = t;
    this.moved = false;
  }

  /** Returns whether the (latched) move threshold has been exceeded. */
  move(x: number, y: number): { exceededThreshold: boolean } {
    if (!this.active) return { exceededThreshold: this.moved };
    if (!this.moved) {
      const dx = x - this.startX;
      const dy = y - this.startY;
      if (Math.hypot(dx, dy) > this.moveThresholdPx) {
        this.moved = true;
      }
    }
    return { exceededThreshold: this.moved };
  }

  /** True once the press has been held past holdMs and has NOT moved. */
  holdElapsed(t: number): boolean {
    if (!this.active || this.moved) return false;
    return t - this.startT >= this.holdMs;
  }

  end(t: number): GestureOutcome {
    if (!this.active) return 'none';
    let outcome: GestureOutcome;
    if (this.moved) {
      outcome = 'drag';
    } else if (t - this.startT >= this.holdMs) {
      outcome = 'hold';
    } else {
      outcome = 'tap';
    }
    this.active = false;
    return outcome;
  }

  reset(): void {
    this.active = false;
    this.moved = false;
  }
}
