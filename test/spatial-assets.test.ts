import { describe, expect, it } from 'vitest';
import { SPATIAL_ASSETS, SPATIAL_ASSET_CATEGORIES, spatialAsset, spatialAssetFinish } from '../src/core/spatial-assets';

describe('Scandinavian spatial asset catalog', () => {
  it('uses stable unique ids and valid real-world dimensions', () => {
    expect(new Set(SPATIAL_ASSETS.map((asset) => asset.id)).size).toBe(SPATIAL_ASSETS.length);
    SPATIAL_ASSETS.forEach((asset) => {
      expect(SPATIAL_ASSET_CATEGORIES).toContain(asset.category);
      expect(asset.dimensions.every((dimension) => dimension > 0)).toBe(true);
      expect(asset.finishes.some((finish) => finish.id === asset.defaultFinish)).toBe(true);
    });
  });

  it('resolves designs and their selected or default finish', () => {
    expect(spatialAsset('fjord-sofa-3')?.dimensions).toEqual([2.24, 0.94, 0.82]);
    expect(spatialAssetFinish('fjord-sofa-3')?.id).toBe('mist');
    expect(spatialAssetFinish('fjord-sofa-3', 'lichen')?.label).toBe('Lichen');
  });
});
