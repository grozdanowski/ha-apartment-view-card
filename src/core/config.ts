import type { LabelConfig, LabelDefaults, LabelSource } from './label';
import { DEFAULT_LABELS, VALID_LABEL_SOURCES, VALID_LABEL_VISIBILITIES } from './label';

export type LightStyle = 'lit' | 'reveal' | 'glow';
export type SizeTier = 'tiny' | 'small' | 'medium' | 'large' | 'huge';
export type TapAction = 'toggle' | 'more-info' | 'none';
export type WheelMode = 'modifier' | 'plain';

/** Input-behavior toggles (spec v2.5 §7). All optional in YAML; defaulted here. */
export interface InteractionOptions {
  /** 'modifier' (default): ctrl/cmd-wheel zooms, plain wheel scrolls the page.
   *  'plain': v2.4 behavior — wheel always zooms (kiosks / wall tablets). */
  wheel: WheelMode;
  /** Scene double-tap toggle-zoom. */
  doubleTapZoom: boolean;
  /** Horizontal swipe between zones while focused. */
  roomSwipe: boolean;
  /** Flick deceleration when free-zoomed (auto-off under reduced motion). */
  inertia: boolean;
}

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
  /** Emit procedural floor-light when active. Defaults to true for `light.*`
   *  entities, false otherwise — set true for a switch/plug driving a lamp,
   *  or false to silence a light. (Fixes non-lights — climate/media/fan —
   *  glowing on the floorplan when merely "active".) */
  light?: boolean;
  label?: LabelConfig;
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
  labels: LabelDefaults;
  /** Marker size (px) at overview (zoom = 1). */
  iconSize: number;
  /** Max marker size (px) when zoomed in — icons grow with zoom but never beyond this. */
  iconSizeMax: number;
  /** Mobile-screen overrides (viewport ≤ 768px). Fall back to the desktop
   *  values above when unset, so a single number stays valid. */
  iconSizeMobile?: number;
  iconSizeMaxMobile?: number;
  /** A weather.* entity to drive a subtle ambient tint over the floorplan. */
  weatherEntity?: string;
  /** Input-behavior toggles (spec v2.5 §7). */
  interaction: InteractionOptions;
  /** Seconds of inactivity before returning to overview; 0 = off (wall tablets). */
  idleTimeout: number;
}

export interface QuickAction {
  name: string;
  icon?: string;
  /** A scene/script/etc. to activate (homeassistant.turn_on), when no explicit service. */
  entity?: string;
  /** An explicit "domain.service" call. */
  service?: string;
  /** Service data / target for `service`. */
  data?: Record<string, unknown>;
}

export interface FloorConfig {
  name: string;
  icon?: string;
  images: ImagesConfig;
  entities: EntityConfig[];
  zones: ZoneConfig[];
}

export interface ApartmentViewConfig {
  type: string;
  images: ImagesConfig;
  entities: EntityConfig[];
  zones: ZoneConfig[];
  options: CardOptions;
  quickActions: QuickAction[];
  /** Optional multi-floor. When non-empty, each floor has its own images/entities/zones;
   *  the top-level images/entities/zones mirror floor 0 for backward-compatible reads. */
  floors?: FloorConfig[];
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
const VALID_WHEEL_MODES: readonly WheelMode[] = ['modifier', 'plain'];

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

/**
 * Parse a per-entity label. Accepts the object form, or a string shorthand:
 * a known source name ('climate-current'), 'off'/'none', or any other string
 * as static text ('Movie Night').
 */
function normalizeLabel(raw: any): LabelConfig | undefined {
  if (raw == null) return undefined;
  if (typeof raw === 'string') {
    if (raw === 'off' || raw === 'none') return { source: 'none' };
    if ((VALID_LABEL_SOURCES as readonly string[]).includes(raw)) return { source: raw as LabelSource };
    return { source: 'static', text: raw };
  }
  if (typeof raw !== 'object') return undefined;
  const source: LabelSource = (VALID_LABEL_SOURCES as readonly string[]).includes(raw.source)
    ? raw.source
    : 'none';
  const cfg: LabelConfig = { source };
  if (typeof raw.text === 'string') cfg.text = raw.text;
  if (typeof raw.attribute === 'string') cfg.attribute = raw.attribute;
  if ((VALID_LABEL_VISIBILITIES as readonly string[]).includes(raw.visibility)) cfg.visibility = raw.visibility;
  return cfg;
}

function normalizeLabelDefaults(raw: any): LabelDefaults {
  const o = raw ?? {};
  const source =
    o.source === 'smart' || (VALID_LABEL_SOURCES as readonly string[]).includes(o.source)
      ? o.source
      : DEFAULT_LABELS.source;
  return {
    source,
    visibility: (VALID_LABEL_VISIBILITIES as readonly string[]).includes(o.visibility)
      ? o.visibility
      : DEFAULT_LABELS.visibility,
    densityCap: typeof o.densityCap === 'number' && o.densityCap > 0 ? o.densityCap : DEFAULT_LABELS.densityCap,
  };
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
  if (typeof raw?.light === 'boolean') entity.light = raw.light;
  const label = normalizeLabel(raw?.label);
  if (label) entity.label = label;
  return entity;
}

function normalizeQuickAction(raw: any): QuickAction | null {
  const name = typeof raw?.name === 'string' && raw.name.length ? raw.name : undefined;
  const entity = typeof raw?.entity === 'string' ? raw.entity : undefined;
  const service = typeof raw?.service === 'string' ? raw.service : undefined;
  if (!name || (!entity && !service)) return null;
  const qa: QuickAction = { name };
  if (typeof raw.icon === 'string') qa.icon = raw.icon;
  if (entity) qa.entity = entity;
  if (service) qa.service = service;
  if (raw.data && typeof raw.data === 'object') qa.data = raw.data;
  return qa;
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

/** Fill interaction defaults; any invalid field falls back individually. */
function normalizeInteraction(raw: any): InteractionOptions {
  const o = raw ?? {};
  return {
    wheel: VALID_WHEEL_MODES.includes(o.wheel) ? o.wheel : 'modifier',
    doubleTapZoom: typeof o.doubleTapZoom === 'boolean' ? o.doubleTapZoom : true,
    roomSwipe: typeof o.roomSwipe === 'boolean' ? o.roomSwipe : true,
    inertia: typeof o.inertia === 'boolean' ? o.inertia : true,
  };
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
    labels: normalizeLabelDefaults(o.labels),
    iconSize: typeof o.iconSize === 'number' && o.iconSize > 0 ? o.iconSize : 44,
    iconSizeMax: typeof o.iconSizeMax === 'number' && o.iconSizeMax > 0 ? o.iconSizeMax : 88,
    ...(typeof o.iconSizeMobile === 'number' && o.iconSizeMobile > 0
      ? { iconSizeMobile: o.iconSizeMobile }
      : {}),
    ...(typeof o.iconSizeMaxMobile === 'number' && o.iconSizeMaxMobile > 0
      ? { iconSizeMaxMobile: o.iconSizeMaxMobile }
      : {}),
    interaction: normalizeInteraction(o.interaction),
    idleTimeout:
      typeof o.idleTimeout === 'number' &&
      Number.isFinite(o.idleTimeout) &&
      o.idleTimeout >= 0
        ? o.idleTimeout
        : 0,
    ...(typeof o.weatherEntity === 'string' && o.weatherEntity.length
      ? { weatherEntity: o.weatherEntity }
      : {}),
  };
}

function normalizeFloor(raw: any): FloorConfig {
  const floor: FloorConfig = {
    name: typeof raw?.name === 'string' && raw.name.length ? raw.name : 'Floor',
    images: normalizeImages(raw),
    entities: (Array.isArray(raw?.entities) ? raw.entities : []).map(normalizeEntity),
    zones: (Array.isArray(raw?.zones) ? raw.zones : []).map(normalizeZone),
  };
  if (typeof raw?.icon === 'string' && raw.icon.length) floor.icon = raw.icon;
  return floor;
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

  const rawFloors: any[] = Array.isArray(source.floors) ? source.floors : [];
  const floors = rawFloors.map(normalizeFloor);
  // Multi-floor: the top-level images/entities/zones mirror floor 0 so the base
  // guard and all single-floor read paths keep working unchanged.
  const base = floors.length
    ? { images: floors[0].images, entities: floors[0].entities, zones: floors[0].zones }
    : { images: normalizeImages(source), entities: rawEntities.map(normalizeEntity), zones: rawZones.map(normalizeZone) };

  return {
    ...rest,
    type: typeof source.type === 'string' ? source.type : CARD_TYPE,
    images: base.images,
    entities: base.entities,
    zones: base.zones,
    options: normalizeOptions(source),
    quickActions: (Array.isArray(source.quickActions) ? source.quickActions : [])
      .map(normalizeQuickAction)
      .filter((q: QuickAction | null): q is QuickAction => q !== null),
    floors,
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
