import type { ZoomTransform } from './geometry';

export interface PanZoomOptions {
  zoomMax: number;
  minScale?: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
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
  private _t: ZoomTransform = { scale: 1, panX: 0, panY: 0 };
  private enabled = true;

  constructor(opts: PanZoomOptions) {
    this.zoomMax = opts.zoomMax;
    this.minScale = opts.minScale ?? 1;
  }

  get transform(): ZoomTransform {
    return { ...this._t };
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  panBy(dx: number, dy: number): ZoomTransform {
    if (!this.enabled) return this.transform;
    this._t = { ...this._t, panX: this._t.panX + dx, panY: this._t.panY + dy };
    return this.transform;
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

  private _applyZoom(factor: number, anchorX: number, anchorY: number): ZoomTransform {
    const oldScale = this._t.scale;
    const newScale = Math.min(
      this.zoomMax,
      Math.max(this.minScale, oldScale * factor)
    );
    const k = newScale / oldScale;
    this._t = {
      scale: newScale,
      panX: anchorX - (anchorX - this._t.panX) * k,
      panY: anchorY - (anchorY - this._t.panY) * k,
    };
    return this.transform;
  }
}
