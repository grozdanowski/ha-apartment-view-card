import type { HassEntity } from './ha-types';

/**
 * Capability detection for the on-floorplan control surface. The panel renders
 * ONLY what an entity actually supports, read from its real attributes /
 * supported_features — so it works across varied models (an on/off-only light,
 * a speaker with no transport, a single-setpoint vs range thermostat) rather
 * than assuming a happy-path shape. Bit values mirror Home Assistant's
 * *EntityFeature enums; attribute names mirror the live state attributes.
 */

const COLOR_MODES = ['hs', 'rgb', 'rgbw', 'rgbww', 'xy'] as const;

export interface LightCaps {
  brightness: boolean;
  color: boolean;
  colorTemp: boolean;
  minKelvin?: number;
  maxKelvin?: number;
}

export function lightCaps(state: HassEntity | undefined): LightCaps {
  const a = state?.attributes ?? {};
  const modes: string[] = Array.isArray(a.supported_color_modes) ? a.supported_color_modes : [];
  // Brightness is supported by any color mode except the pure on/off ones.
  const brightness =
    modes.some((m) => m !== 'onoff' && m !== 'unknown') || typeof a.brightness === 'number';
  return {
    brightness,
    color: modes.some((m) => (COLOR_MODES as readonly string[]).includes(m)),
    colorTemp: modes.includes('color_temp'),
    minKelvin: typeof a.min_color_temp_kelvin === 'number' ? a.min_color_temp_kelvin : undefined,
    maxKelvin: typeof a.max_color_temp_kelvin === 'number' ? a.max_color_temp_kelvin : undefined,
  };
}

/** MediaPlayerEntityFeature bits (subset the surface uses). */
export const MEDIA_FEATURE = {
  PAUSE: 1,
  VOLUME_SET: 4,
  VOLUME_MUTE: 8,
  PREVIOUS_TRACK: 16,
  NEXT_TRACK: 32,
  TURN_ON: 128,
  TURN_OFF: 256,
  SELECT_SOURCE: 2048,
  PLAY: 16384,
} as const;

export interface MediaCaps {
  play: boolean;
  pause: boolean;
  next: boolean;
  previous: boolean;
  volume: boolean;
  source: boolean;
  turnOnOff: boolean;
}

export function mediaCaps(state: HassEntity | undefined): MediaCaps {
  const f = Number(state?.attributes?.supported_features) || 0;
  const has = (bit: number) => (f & bit) !== 0;
  return {
    play: has(MEDIA_FEATURE.PLAY),
    pause: has(MEDIA_FEATURE.PAUSE),
    next: has(MEDIA_FEATURE.NEXT_TRACK),
    previous: has(MEDIA_FEATURE.PREVIOUS_TRACK),
    volume: has(MEDIA_FEATURE.VOLUME_SET),
    source: has(MEDIA_FEATURE.SELECT_SOURCE),
    turnOnOff: has(MEDIA_FEATURE.TURN_ON) || has(MEDIA_FEATURE.TURN_OFF),
  };
}

/** ClimateEntityFeature bits (subset the surface uses). */
export const CLIMATE_FEATURE = {
  TARGET_TEMPERATURE: 1,
  TARGET_TEMPERATURE_RANGE: 2,
  FAN_MODE: 8,
  PRESET_MODE: 16,
  TURN_OFF: 128,
  TURN_ON: 256,
} as const;

export interface ClimateCaps {
  targetTemp: boolean;
  targetRange: boolean;
  fan: boolean;
  preset: boolean;
  modes: string[];
  fanModes: string[];
  presetModes: string[];
  min: number;
  max: number;
  step: number;
}

export function climateCaps(state: HassEntity | undefined): ClimateCaps {
  const a = state?.attributes ?? {};
  const f = Number(a.supported_features) || 0;
  const has = (bit: number) => (f & bit) !== 0;
  const arr = (v: unknown): string[] => (Array.isArray(v) ? v : []);
  return {
    targetTemp: has(CLIMATE_FEATURE.TARGET_TEMPERATURE),
    targetRange: has(CLIMATE_FEATURE.TARGET_TEMPERATURE_RANGE),
    fan: has(CLIMATE_FEATURE.FAN_MODE),
    preset: has(CLIMATE_FEATURE.PRESET_MODE),
    modes: arr(a.hvac_modes),
    fanModes: arr(a.fan_modes),
    presetModes: arr(a.preset_modes),
    min: typeof a.min_temp === 'number' ? a.min_temp : 7,
    max: typeof a.max_temp === 'number' ? a.max_temp : 35,
    step: typeof a.target_temp_step === 'number' ? a.target_temp_step : 0.5,
  };
}

/** CoverEntityFeature bits. */
export const COVER_FEATURE = {
  OPEN: 1,
  CLOSE: 2,
  SET_POSITION: 4,
  STOP: 8,
  OPEN_TILT: 16,
  CLOSE_TILT: 32,
  STOP_TILT: 64,
  SET_TILT_POSITION: 128,
} as const;

export interface CoverCaps {
  open: boolean;
  close: boolean;
  stop: boolean;
  position: boolean;
  tilt: boolean;
  setTilt: boolean;
  deviceClass?: string;
}

export function coverCaps(state: HassEntity | undefined): CoverCaps {
  const a = state?.attributes ?? {};
  const f = Number(a.supported_features) || 0;
  const has = (bit: number) => (f & bit) !== 0;
  return {
    open: has(COVER_FEATURE.OPEN),
    close: has(COVER_FEATURE.CLOSE),
    stop: has(COVER_FEATURE.STOP),
    position: has(COVER_FEATURE.SET_POSITION),
    tilt: has(COVER_FEATURE.OPEN_TILT) || has(COVER_FEATURE.CLOSE_TILT),
    setTilt: has(COVER_FEATURE.SET_TILT_POSITION),
    deviceClass: typeof a.device_class === 'string' ? a.device_class : undefined,
  };
}

/** FanEntityFeature bits. */
export const FAN_FEATURE = {
  SET_SPEED: 1,
  OSCILLATE: 2,
  DIRECTION: 4,
  PRESET_MODE: 8,
} as const;

export interface FanCaps {
  speed: boolean;
  oscillate: boolean;
  direction: boolean;
  preset: boolean;
  presetModes: string[];
}

export function fanCaps(state: HassEntity | undefined): FanCaps {
  const a = state?.attributes ?? {};
  const f = Number(a.supported_features) || 0;
  const has = (bit: number) => (f & bit) !== 0;
  return {
    speed: has(FAN_FEATURE.SET_SPEED),
    oscillate: has(FAN_FEATURE.OSCILLATE),
    direction: has(FAN_FEATURE.DIRECTION),
    preset: has(FAN_FEATURE.PRESET_MODE),
    presetModes: Array.isArray(a.preset_modes) ? a.preset_modes : [],
  };
}

/** LockEntityFeature bits. */
export const LOCK_FEATURE = { OPEN: 1 } as const;

export interface LockCaps {
  /** Supports a separate "open latch" action beyond lock/unlock. */
  openLatch: boolean;
}

export function lockCaps(state: HassEntity | undefined): LockCaps {
  const f = Number(state?.attributes?.supported_features) || 0;
  return { openLatch: (f & LOCK_FEATURE.OPEN) !== 0 };
}

/** Which control-surface body an entity drives. */
export type ControlKind = 'light' | 'media' | 'climate' | 'cover' | 'fan' | 'lock' | 'none';

const DOMAIN_KIND: Record<string, ControlKind> = {
  light: 'light',
  media_player: 'media',
  climate: 'climate',
  cover: 'cover',
  fan: 'fan',
  lock: 'lock',
};

export function controlKind(entityId: string): ControlKind {
  return DOMAIN_KIND[entityId.split('.')[0]] ?? 'none';
}

/**
 * Resolve a marker entity to the entity ids the control surface should drive.
 * A group (a `group.*` helper, or any entity exposing an `attributes.entity_id`
 * member list) expands to its members so the surface controls the whole group
 * instead of silently vanishing. Everything else resolves to itself.
 */
export function resolveControlEntities(
  entityId: string,
  states: Record<string, HassEntity>,
): string[] {
  const members = states[entityId]?.attributes?.entity_id;
  if (entityId.split('.')[0] === 'group' && Array.isArray(members) && members.length) {
    return members.filter((m): m is string => typeof m === 'string');
  }
  return [entityId];
}

/**
 * The control target for a tapped marker: the kind of surface to show and the
 * entity ids it drives. Returns kind 'none' when nothing is controllable.
 * Homogeneous groups (e.g. a group of lights) take their members' kind.
 */
export function controlTarget(
  entityId: string,
  states: Record<string, HassEntity>,
): { kind: ControlKind; ids: string[] } {
  const ids = resolveControlEntities(entityId, states);
  if (ids.length === 1) return { kind: controlKind(ids[0]), ids };
  // group: use the members' common kind, else 'none'
  const kinds = new Set(ids.map((id) => controlKind(id)));
  const kind = kinds.size === 1 ? [...kinds][0] : 'none';
  return { kind, ids };
}
