import type { Viewport, ZoomTransform } from './geometry';

export interface PanZoomOptions {
  zoomMax: number;
  minScale?: number;
  /**
   * When provided, pan clamps to image-cover bounds (spec P0-4):
   * panX ∈ [w(1−s), 0], panY ∈ [h(1−s), 0] — the same clamp zoomToZone
   * proves out. Drag overshoot rubber-bands; zoom applies hard clamp.
   * Absent = the original unclamped math, byte-for-byte.
   */
  viewport?: () => Viewport;
}

/** Fraction of the overshoot excess that survives during a drag. */
const DRAG_RESISTANCE = 0.45;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

/** Rubber-band: past a bound only DRAG_RESISTANCE of the excess is shown. */
function resist(v: number, lo: number, hi: number): number {
  if (v < lo) return lo + (v - lo) * DRAG_RESISTANCE;
  if (v > hi) return hi + (v - hi) * DRAG_RESISTANCE;
  return v;
}

/**
 * Inverse of resist(): recover the raw finger position from a displayed one,
 * so successive drag deltas accumulate 1:1 in finger-space instead of
 * re-compressing the already-resisted excess.
 */
function unresist(v: number, lo: number, hi: number): number {
  if (v < lo) return lo + (v - lo) / DRAG_RESISTANCE;
  if (v > hi) return hi + (v - hi) / DRAG_RESISTANCE;
  return v;
}

/**
 * Pure pan/zoom math with an `enabled` gate. No DOM. While disabled (used for
 * focused zones and options.freePanZoom:false) every input is a no-op and the
 * unchanged transform is returned. Anchored zoom keeps the point under the
 * cursor/pinch-center fixed: pan' = anchor - (anchor - pan) * (newScale/oldScale).
 */
export class PanZoomController {
  private readonly zoomMax: number;
  private readonly minScale: number;
  private readonly viewport?: () => Viewport;
  private _t: ZoomTransform = { scale: 1, panX: 0, panY: 0 };
  private enabled = true;

  constructor(opts: PanZoomOptions) {
    this.zoomMax = opts.zoomMax;
    this.minScale = opts.minScale ?? 1;
    this.viewport = opts.viewport;
  }

  get transform(): ZoomTransform {
    return { ...this._t };
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  panBy(dx: number, dy: number): ZoomTransform {
    if (!this.enabled) return this.transform;
    if (!this.viewport) {
      this._t = { ...this._t, panX: this._t.panX + dx, panY: this._t.panY + dy };
      return this.transform;
    }
    // Clamped drag (spec P0-4): apply the delta in raw finger-space, then
    // display bound + excess × DRAG_RESISTANCE past either cover-bound.
    const { minX, minY } = this._bounds(this._t.scale);
    this._t = {
      ...this._t,
      panX: resist(unresist(this._t.panX, minX, 0) + dx, minX, 0),
      panY: resist(unresist(this._t.panY, minY, 0) + dy, minY, 0),
    };
    return this.transform;
  }

  /**
   * End-of-drag settle (spec P0-4): the fully-clamped rest transform with NO
   * resistance, plus whether the drag was left overshot. Syncs the internal
   * transform to the target so controller and card agree after the snap-back.
   */
  release(): { target: ZoomTransform; overshot: boolean } {
    if (!this.viewport) return { target: this.transform, overshot: false };
    const { minX, minY } = this._bounds(this._t.scale);
    const target: ZoomTransform = {
      scale: this._t.scale,
      panX: clamp(this._t.panX, minX, 0),
      panY: clamp(this._t.panY, minY, 0),
    };
    const overshot =
      target.panX !== this._t.panX || target.panY !== this._t.panY;
    this._t = target;
    return { target: { ...target }, overshot };
  }

  /**
   * Anchored wheel zoom. `deltaY` is in NORMALIZED PIXELS — the card converts
   * deltaMode-1 line scrolls (Firefox) to px before calling. The exp curve
   * gives proportional per-device feel (spec P0-3 / F6): a ±100px mouse notch
   * is ×/÷1.246, and one event can never jump more than ×1.25 / ×0.8.
   */
  wheelZoom(deltaY: number, anchorX: number, anchorY: number): ZoomTransform {
    if (!this.enabled) return this.transform;
    const factor = clamp(Math.exp(-deltaY * 0.0022), 0.8, 1.25);
    return this._applyZoom(factor, anchorX, anchorY);
  }

  pinchZoom(scaleFactor: number, anchorX: number, anchorY: number): ZoomTransform {
    if (!this.enabled) return this.transform;
    return this._applyZoom(scaleFactor, anchorX, anchorY);
  }

  pinchDistance(ax: number, ay: number, bx: number, by: number): number {
    return Math.hypot(bx - ax, by - ay);
  }

  reset(): ZoomTransform {
    this._t = { scale: 1, panX: 0, panY: 0 };
    return this.transform;
  }

  /**
   * Adopt an externally-computed transform (a machine camera move, e.g. the
   * attention camera — spec P0-6) so the next gesture continues from what is
   * on screen instead of a stale internal state.
   */
  syncTo(t: ZoomTransform): void {
    this._t = { ...t };
  }

  private _applyZoom(factor: number, anchorX: number, anchorY: number): ZoomTransform {
    const oldScale = this._t.scale;
    const newScale = Math.min(
      this.zoomMax,
      Math.max(this.minScale, oldScale * factor)
    );
    const k = newScale / oldScale;
    let panX = anchorX - (anchorX - this._t.panX) * k;
    let panY = anchorY - (anchorY - this._t.panY) * k;
    if (this.viewport) {
      // Zoom is a discrete step, not a drag — hard clamp, no rubber-band.
      const { minX, minY } = this._bounds(newScale);
      panX = clamp(panX, minX, 0);
      panY = clamp(panY, minY, 0);
    }
    this._t = { scale: newScale, panX, panY };
    return this.transform;
  }

  /** Cover-bounds for a scale: pan may never expose a gutter (spec P0-4). */
  private _bounds(scale: number): { minX: number; minY: number } {
    const vp = this.viewport!();
    return { minX: vp.width * (1 - scale), minY: vp.height * (1 - scale) };
  }
}
