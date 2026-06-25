export type LightStyle = 'lit' | 'reveal' | 'glow';
export type SizeTier = 'tiny' | 'small' | 'medium' | 'large' | 'huge';
export type TapAction = 'toggle' | 'more-info' | 'none';

export interface EntityConfig {
  entity: string;
  name?: string;
  icon?: string;
  x: number;
  y: number;
  size: SizeTier;
  tap: TapAction;
  orientation: number | null;
  lightStyle?: LightStyle;
}

export interface ZoneConfig {
  name: string;
  icon?: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ImagesConfig {
  base: string;
  allLights?: string;
  night?: string;
  duskDawn?: string;
}

export interface CardOptions {
  view: 'auto' | 'day' | 'night' | 'duskDawn';
  lightStyle: LightStyle;
  freePanZoom: boolean;
  zoomMax: number;
  duskDawnOffsetMinutes: number;
}

export interface ApartmentViewConfig {
  type: string;
  images: ImagesConfig;
  entities: EntityConfig[];
  zones: ZoneConfig[];
  options: CardOptions;
}

const CARD_TYPE = 'custom:apartment-view-card';

const VALID_SIZES: readonly SizeTier[] = [
  'tiny',
  'small',
  'medium',
  'large',
  'huge',
];
const VALID_TAPS: readonly TapAction[] = ['toggle', 'more-info', 'none'];
const VALID_STYLES: readonly LightStyle[] = ['lit', 'reveal', 'glow'];
const VALID_VIEWS: readonly CardOptions['view'][] = [
  'auto',
  'day',
  'night',
  'duskDawn',
];

function normalizeImages(raw: any): ImagesConfig {
  const src = raw?.images ?? {};
  const base = src.base ?? raw?.dayImage;
  if (typeof base !== 'string' || base.length === 0) {
    throw new Error(
      'apartment-view-card: images.base is required (a lights-off base render).',
    );
  }
  const images: ImagesConfig = { base };
  const allLights = src.allLights ?? raw?.allLightsImage;
  const night = src.night ?? raw?.nightImage;
  const duskDawn = src.duskDawn ?? raw?.duskdawnImage;
  if (typeof allLights === 'string') images.allLights = allLights;
  if (typeof night === 'string') images.night = night;
  if (typeof duskDawn === 'string') images.duskDawn = duskDawn;
  return images;
}

function normalizeSize(value: any): SizeTier {
  return VALID_SIZES.includes(value) ? value : 'medium';
}

function normalizeTapFromEntity(raw: any): TapAction {
  if (VALID_TAPS.includes(raw?.tap)) return raw.tap;
  // legacy disableService -> tap
  if (raw?.disableService === true) return 'none';
  if (raw?.disableService === false) return 'toggle';
  return 'toggle';
}

function normalizeOrientation(value: any): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function normalizeEntity(raw: any): EntityConfig {
  const entity: EntityConfig = {
    entity: raw?.entity ?? raw?.entityName ?? '',
    x: typeof raw?.x === 'number' ? raw.x : (raw?.offsetX ?? 50),
    y: typeof raw?.y === 'number' ? raw.y : (raw?.offsetY ?? 50),
    size: normalizeSize(raw?.size),
    tap: normalizeTapFromEntity(raw),
    orientation: normalizeOrientation(raw?.orientation),
  };
  const name = raw?.name ?? raw?.customName;
  const icon = raw?.icon ?? raw?.customIcon;
  if (typeof name === 'string' && name.length > 0) entity.name = name;
  if (typeof icon === 'string' && icon.length > 0) entity.icon = icon;
  if (VALID_STYLES.includes(raw?.lightStyle)) {
    entity.lightStyle = raw.lightStyle;
  }
  return entity;
}

function normalizeZone(raw: any): ZoneConfig {
  const zone: ZoneConfig = {
    name: typeof raw?.name === 'string' && raw.name.length > 0 ? raw.name : 'Zone',
    x: Number(raw?.x) || 0,
    y: Number(raw?.y) || 0,
    width: Number(raw?.width) || 0,
    height: Number(raw?.height) || 0,
  };
  if (typeof raw?.icon === 'string' && raw.icon.length > 0) zone.icon = raw.icon;
  return zone;
}

function normalizeOptions(raw: any): CardOptions {
  const o = raw?.options ?? {};
  return {
    view: VALID_VIEWS.includes(o.view) ? o.view : 'auto',
    lightStyle: VALID_STYLES.includes(o.lightStyle) ? o.lightStyle : 'lit',
    freePanZoom: typeof o.freePanZoom === 'boolean' ? o.freePanZoom : true,
    zoomMax: typeof o.zoomMax === 'number' ? o.zoomMax : 1.5,
    duskDawnOffsetMinutes:
      typeof o.duskDawnOffsetMinutes === 'number'
        ? o.duskDawnOffsetMinutes
        : 60,
  };
}

/**
 * Normalize raw Lovelace config: fill defaults, migrate legacy keys, and
 * PRESERVE unknown top-level keys (v1 silently dropped columns/rows/zones).
 * Throws if no images.base can be resolved.
 */
export function normalizeConfig(raw: any): ApartmentViewConfig {
  const source = raw ?? {};
  const rawEntities: any[] = Array.isArray(source.entities)
    ? source.entities
    : Array.isArray(source.objects)
      ? source.objects
      : [];
  const rawZones: any[] = Array.isArray(source.zones) ? source.zones : [];

  // Spread unknown keys first, then overwrite the canonical shape. Strip the
  // legacy flat keys we have folded into `images`/`entities`.
  const {
    objects: _objects,
    dayImage: _dayImage,
    allLightsImage: _allLightsImage,
    nightImage: _nightImage,
    duskdawnImage: _duskdawnImage,
    ...rest
  } = source;

  return {
    ...rest,
    type: typeof source.type === 'string' ? source.type : CARD_TYPE,
    images: normalizeImages(source),
    entities: rawEntities.map(normalizeEntity),
    zones: rawZones.map(normalizeZone),
    options: normalizeOptions(source),
  };
}

/**
 * Return the smallest-AREA zone whose rectangle contains (x, y), inclusive of
 * edges; null if none. Coordinates and dimensions are in the same percentage
 * space as the config.
 */
export function zoneForPoint(
  x: number,
  y: number,
  zones: ZoneConfig[],
): ZoneConfig | null {
  let best: ZoneConfig | null = null;
  let bestArea = Infinity;
  for (const zone of zones) {
    const inside =
      x >= zone.x &&
      x <= zone.x + zone.width &&
      y >= zone.y &&
      y <= zone.y + zone.height;
    if (!inside) continue;
    const area = zone.width * zone.height;
    if (area < bestArea) {
      bestArea = area;
      best = zone;
    }
  }
  return best;
}
