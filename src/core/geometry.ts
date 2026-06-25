import type { SizeTier } from './config';

export interface Viewport {
  width: number;
  height: number;
}

export interface ZoomTransform {
  scale: number;
  panX: number;
  panY: number;
}

const SIZE_TIER_FRACTION: Record<SizeTier, number> = {
  tiny: 0.09,
  small: 0.13,
  medium: 0.17,
  large: 0.22,
  huge: 0.28,
};

export function sizeTierFraction(size: SizeTier): number {
  return SIZE_TIER_FRACTION[size] ?? SIZE_TIER_FRACTION.medium;
}

export function haloRadiusPx(
  cardWidth: number,
  size: SizeTier,
  brightness: number,
): number {
  return sizeTierFraction(size) * cardWidth * (0.45 + 0.55 * brightness);
}

/**
 * Screen-pixel position of a marker on the NON-transformed overlay.
 * The image layer is transformed via `translate(panX,panY) scale(scale)`
 * with transform-origin 0 0; this reproduces that math in px so overlay
 * icons track the image while rendering at native resolution.
 */
export function markerScreenPos(
  xPct: number,
  yPct: number,
  t: ZoomTransform,
  vp: Viewport,
): { left: number; top: number } {
  return {
    left: (xPct / 100) * vp.width * t.scale + t.panX,
    top: (yPct / 100) * vp.height * t.scale + t.panY,
  };
}

/** Icons grow with zoom but never beyond 2x baseline (spec §5/§6). */
export function clampIconScale(scale: number): number {
  return Math.min(scale, 2.0);
}
