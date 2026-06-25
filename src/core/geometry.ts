import type { SizeTier } from './config';

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
