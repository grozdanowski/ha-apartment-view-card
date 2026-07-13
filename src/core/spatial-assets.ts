export type SpatialAssetCategory = 'Lounge' | 'Dining' | 'Bedroom' | 'Storage' | 'Media & lighting' | 'Kitchen & bath' | 'Decor';

export interface SpatialAssetFinish {
  id: string;
  label: string;
  color: number;
}

export interface SpatialAssetDefinition {
  id: string;
  label: string;
  kind: string;
  category: SpatialAssetCategory;
  icon: string;
  /** Real-world width, depth, and height in metres. */
  dimensions: readonly [number, number, number];
  defaultFinish: string;
  finishes: readonly SpatialAssetFinish[];
}

const textile: readonly SpatialAssetFinish[] = [
  { id: 'mist', label: 'Mist', color: 0xbfc7c5 },
  { id: 'graphite', label: 'Graphite', color: 0x4e5555 },
  { id: 'lichen', label: 'Lichen', color: 0x758177 },
];
const timber: readonly SpatialAssetFinish[] = [
  { id: 'oak', label: 'Natural oak', color: 0xa48a68 },
  { id: 'smoked-oak', label: 'Smoked oak', color: 0x665647 },
  { id: 'black', label: 'Black ash', color: 0x363a39 },
];
const pale: readonly SpatialAssetFinish[] = [
  { id: 'soft-white', label: 'Soft white', color: 0xd9ddda },
  { id: 'stone', label: 'Stone', color: 0x9c9c94 },
  { id: 'graphite', label: 'Graphite', color: 0x414746 },
];

export const SPATIAL_ASSETS: readonly SpatialAssetDefinition[] = [
  { id: 'fjord-sofa-3', label: 'Fjord 3-seat sofa', kind: 'sofa', category: 'Lounge', icon: 'mdi:sofa-outline', dimensions: [2.24, 0.94, 0.82], defaultFinish: 'mist', finishes: textile },
  { id: 'fjord-sofa-2', label: 'Fjord 2-seat sofa', kind: 'sofa', category: 'Lounge', icon: 'mdi:sofa-single-outline', dimensions: [1.72, 0.94, 0.82], defaultFinish: 'lichen', finishes: textile },
  { id: 'holm-chair', label: 'Holm lounge chair', kind: 'armchair', category: 'Lounge', icon: 'mdi:seat-outline', dimensions: [0.86, 0.88, 0.84], defaultFinish: 'graphite', finishes: textile },
  { id: 'aska-table', label: 'Aska dining table', kind: 'table', category: 'Dining', icon: 'mdi:table-furniture', dimensions: [1.8, 0.9, 0.75], defaultFinish: 'oak', finishes: timber },
  { id: 'linea-chair', label: 'Linea dining chair', kind: 'chair', category: 'Dining', icon: 'mdi:chair-school', dimensions: [0.48, 0.52, 0.82], defaultFinish: 'oak', finishes: timber },
  { id: 'aska-bench', label: 'Aska bench', kind: 'console', category: 'Dining', icon: 'mdi:seat', dimensions: [1.35, 0.38, 0.46], defaultFinish: 'oak', finishes: timber },
  { id: 'sund-bed-double', label: 'Sund double bed', kind: 'bed', category: 'Bedroom', icon: 'mdi:bed-king-outline', dimensions: [1.8, 2.08, 0.62], defaultFinish: 'mist', finishes: textile },
  { id: 'sund-bed-single', label: 'Sund single bed', kind: 'bed', category: 'Bedroom', icon: 'mdi:bed-single-outline', dimensions: [1, 2.08, 0.6], defaultFinish: 'mist', finishes: textile },
  { id: 'natt-bedside', label: 'Natt bedside table', kind: 'cabinet', category: 'Bedroom', icon: 'mdi:table-furniture', dimensions: [0.46, 0.38, 0.5], defaultFinish: 'oak', finishes: timber },
  { id: 'low-media-console', label: 'Low media console', kind: 'console', category: 'Storage', icon: 'mdi:television-classic', dimensions: [1.8, 0.42, 0.48], defaultFinish: 'smoked-oak', finishes: timber },
  { id: 'form-sideboard', label: 'Form sideboard', kind: 'cabinet', category: 'Storage', icon: 'mdi:cupboard-outline', dimensions: [1.6, 0.48, 0.78], defaultFinish: 'oak', finishes: timber },
  { id: 'havn-tall-cabinet', label: 'Havn tall cabinet', kind: 'cabinet', category: 'Storage', icon: 'mdi:locker', dimensions: [0.8, 0.48, 1.9], defaultFinish: 'soft-white', finishes: pale },
  { id: 'arc-floor-lamp', label: 'Arc floor lamp', kind: 'floorlamp', category: 'Media & lighting', icon: 'mdi:floor-lamp', dimensions: [0.5, 0.5, 1.55], defaultFinish: 'graphite', finishes: pale },
  { id: 'studio-tv', label: 'Studio television', kind: 'tv', category: 'Media & lighting', icon: 'mdi:television', dimensions: [1.42, 0.08, 0.84], defaultFinish: 'graphite', finishes: pale },
  { id: 'holme-island', label: 'Holme kitchen island', kind: 'island', category: 'Kitchen & bath', icon: 'mdi:countertop-outline', dimensions: [1.8, 0.9, 0.92], defaultFinish: 'soft-white', finishes: pale },
  { id: 'fjord-bath', label: 'Fjord bath', kind: 'bathtub', category: 'Kitchen & bath', icon: 'mdi:bathtub-outline', dimensions: [1.7, 0.76, 0.58], defaultFinish: 'soft-white', finishes: pale },
  { id: 'sten-vanity', label: 'Sten vanity', kind: 'vanity', category: 'Kitchen & bath', icon: 'mdi:countertop', dimensions: [1.1, 0.52, 0.86], defaultFinish: 'oak', finishes: timber },
  { id: 'ull-rug', label: 'Ull wool rug', kind: 'rug', category: 'Decor', icon: 'mdi:rug', dimensions: [2.3, 1.7, 0.025], defaultFinish: 'stone', finishes: pale },
  { id: 'greenery', label: 'Indoor greenery', kind: 'plant', category: 'Decor', icon: 'mdi:flower-outline', dimensions: [0.55, 0.55, 1.25], defaultFinish: 'lichen', finishes: textile },
];

export const SPATIAL_ASSET_CATEGORIES: readonly SpatialAssetCategory[] = ['Lounge', 'Dining', 'Bedroom', 'Storage', 'Media & lighting', 'Kitchen & bath', 'Decor'];

export function spatialAsset(assetId?: string): SpatialAssetDefinition | undefined {
  return assetId ? SPATIAL_ASSETS.find((asset) => asset.id === assetId) : undefined;
}

export function spatialAssetFinish(assetId?: string, finishId?: string): SpatialAssetFinish | undefined {
  const asset = spatialAsset(assetId);
  return asset?.finishes.find((finish) => finish.id === (finishId ?? asset.defaultFinish));
}
