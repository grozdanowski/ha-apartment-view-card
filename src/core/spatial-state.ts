import type { HassEntity } from './ha-types';

export type SpatialEffectKind =
  | 'light'
  | 'media'
  | 'air'
  | 'vacuum'
  | 'security'
  | 'presence'
  | 'none';

export type SpatialActivity = 'active' | 'attention' | 'idle' | 'off' | 'unavailable';
export type SpatialLightingMode = 'realistic' | 'balanced' | 'presentation';

export interface ResolvedSpatialState {
  state?: HassEntity;
  sourceEntityId: string;
  usedGroupFallback: boolean;
  activity: SpatialActivity;
  effect: SpatialEffectKind;
}

export interface SpatialEnvironment {
  daylight: number;
  cloudFactor: number;
  sunIntensity: number;
  skyIntensity: number;
  fillIntensity: number;
  bounceIntensity: number;
  exposure: number;
  elevationDegrees: number;
  azimuthDegrees: number;
  illuminance?: number;
  illuminanceEntityId?: string;
  weatherEntityId?: string;
  weatherState?: string;
  activeLightCount: number;
}

const OFF_STATES = new Set(['off', 'closed', 'locked', 'not_home']);
const UNAVAILABLE_STATES = new Set(['unknown', 'unavailable']);
const IDLE_STATES = new Set(['idle', 'standby', 'docked', 'paused']);
const ATTENTION_STATES = new Set(['on', 'open', 'opening', 'unlocked', 'jammed', 'problem', 'detected']);

function domainOf(entityId: string): string {
  return entityId.split('.')[0]?.toLowerCase() ?? '';
}

function effectFor(entityId: string, state?: HassEntity): SpatialEffectKind {
  const domain = domainOf(entityId);
  if (domain === 'light') return 'light';
  if (domain === 'media_player') return 'media';
  if (domain === 'climate' || domain === 'fan' || domain === 'humidifier') return 'air';
  if (domain === 'vacuum') return 'vacuum';
  if (domain === 'lock' || domain === 'cover' || domain === 'alarm_control_panel') return 'security';
  if (domain === 'binary_sensor') {
    const deviceClass = String(state?.attributes?.device_class ?? '');
    if (['motion', 'occupancy', 'presence', 'moving'].includes(deviceClass)) return 'presence';
    if (['door', 'window', 'opening', 'lock', 'safety', 'problem'].includes(deviceClass)) return 'security';
  }
  return 'none';
}

function activityFor(entityId: string, state?: HassEntity): SpatialActivity {
  if (!state || UNAVAILABLE_STATES.has(state.state)) return 'unavailable';
  const domain = domainOf(entityId);
  const value = state.state.toLowerCase();
  if (OFF_STATES.has(value)) return 'off';
  if (IDLE_STATES.has(value)) return 'idle';
  if (domain === 'sensor' || domain === 'person' || domain === 'device_tracker') return 'idle';
  if (domain === 'lock' || domain === 'cover' || domain === 'binary_sensor') {
    return ATTENTION_STATES.has(value) ? 'attention' : 'idle';
  }
  if (domain === 'vacuum') {
    if (['error', 'stuck'].includes(value)) return 'attention';
    return ['cleaning', 'returning', 'spot_cleaning'].includes(value) ? 'active' : 'idle';
  }
  return 'active';
}

/**
 * Resolve a configured entity against live HA state. Integrations often expose
 * unavailable child lights while a stable HA light group remains authoritative;
 * use that group as a read-only state fallback without changing the user's config.
 */
export function resolveSpatialEntityState(
  states: Record<string, HassEntity>,
  entityId: string,
): ResolvedSpatialState {
  const direct = states[entityId];
  let resolved = direct;
  let sourceEntityId = entityId;
  let usedGroupFallback = false;
  if (!direct || UNAVAILABLE_STATES.has(direct.state)) {
    const domain = domainOf(entityId);
    const fallback = Object.values(states)
      .filter((candidate) => domainOf(candidate.entity_id) === domain)
      .filter((candidate) => !UNAVAILABLE_STATES.has(candidate.state))
      .filter((candidate) => Array.isArray(candidate.attributes?.entity_id))
      .find((candidate) => candidate.attributes.entity_id.includes(entityId));
    if (fallback) {
      resolved = fallback;
      sourceEntityId = fallback.entity_id;
      usedGroupFallback = true;
    }
  }
  return {
    state: resolved,
    sourceEntityId,
    usedGroupFallback,
    activity: activityFor(entityId, resolved),
    effect: effectFor(entityId, resolved),
  };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function smoothstep(value: number, from: number, to: number): number {
  const t = clamp01((value - from) / (to - from));
  return t * t * (3 - 2 * t);
}

function findOutdoorIlluminance(
  states: Record<string, HassEntity>,
  configured?: string,
): HassEntity | undefined {
  if (configured && states[configured]) return states[configured];
  return Object.values(states).find((state) => {
    const unit = String(state.attributes?.unit_of_measurement ?? '').toLowerCase();
    const deviceClass = String(state.attributes?.device_class ?? '').toLowerCase();
    const name = `${state.entity_id} ${state.attributes?.friendly_name ?? ''}`.toLowerCase();
    return (unit === 'lx' || deviceClass === 'illuminance')
      && /outdoor|outside|exterior|balcony|terrace|weather/.test(name);
  });
}

function weatherFactor(value: string): number {
  if (['pouring', 'rainy', 'snowy-rainy', 'snowy', 'hail', 'lightning-rainy'].includes(value)) return 0.34;
  if (['cloudy', 'fog'].includes(value)) return 0.5;
  if (['partlycloudy', 'partly-cloudy'].includes(value)) return 0.74;
  return 1;
}

export function resolveSpatialEnvironment(args: {
  states: Record<string, HassEntity>;
  entityIds: string[];
  fallbackElevationRadians: number;
  fallbackAzimuthRadians: number;
  weatherEntity?: string;
  illuminanceEntity?: string;
  mode?: SpatialLightingMode;
}): SpatialEnvironment {
  const { states } = args;
  const sun = states['sun.sun'];
  const elevationDegrees = Number.isFinite(Number(sun?.attributes?.elevation))
    ? Number(sun.attributes.elevation)
    : args.fallbackElevationRadians * 180 / Math.PI;
  const azimuthDegrees = Number.isFinite(Number(sun?.attributes?.azimuth))
    ? Number(sun.attributes.azimuth)
    : (args.fallbackAzimuthRadians * 180 / Math.PI + 180 + 360) % 360;
  const illuminanceState = findOutdoorIlluminance(states, args.illuminanceEntity);
  const illuminance = Number(illuminanceState?.state);
  const sunDaylight = smoothstep(elevationDegrees, -6, 32);
  const luxDaylight = Number.isFinite(illuminance) && illuminance >= 0
    ? clamp01(Math.log10(illuminance + 1) / Math.log10(20_001))
    : undefined;
  const daylight = luxDaylight === undefined ? sunDaylight : Math.min(sunDaylight + 0.12, luxDaylight);
  const weather = args.weatherEntity
    ? states[args.weatherEntity]
    : Object.values(states).find((state) => state.entity_id.startsWith('weather.'));
  const cloudFactor = weatherFactor(weather?.state ?? '');
  const configured = new Set(args.entityIds);
  const activeLightSources = new Set(args.entityIds.flatMap((entityId) => {
    if (domainOf(entityId) !== 'light') return [];
    const direct = states[entityId];
    if (Array.isArray(direct?.attributes?.entity_id)
      && direct.attributes.entity_id.some((member: string) => configured.has(member))) return [];
    const resolved = resolveSpatialEntityState(states, entityId);
    return resolved.activity === 'active' ? [resolved.sourceEntityId] : [];
  }));
  const activeLightCount = activeLightSources.size;
  const mode = args.mode ?? 'realistic';
  const floor = mode === 'presentation' ? 0.3 : mode === 'balanced' ? 0.21 : 0.15;
  const nightExposure = mode === 'presentation' ? 1.02 : mode === 'balanced' ? 0.93 : 0.86;
  const activeLift = Math.min(0.18, activeLightCount * 0.035);
  return {
    daylight,
    cloudFactor,
    sunIntensity: daylight * 3.25 * cloudFactor,
    skyIntensity: floor + daylight * (0.88 + cloudFactor * 0.18),
    fillIntensity: floor * 0.6 + daylight * 0.42,
    bounceIntensity: activeLightCount ? Math.min(0.42, 0.07 + activeLightCount * 0.055) : 0,
    exposure: nightExposure + daylight * (1.02 - nightExposure) + activeLift,
    elevationDegrees,
    azimuthDegrees,
    ...(Number.isFinite(illuminance) ? { illuminance } : {}),
    ...(illuminanceState ? { illuminanceEntityId: illuminanceState.entity_id } : {}),
    ...(weather ? { weatherEntityId: weather.entity_id, weatherState: weather.state } : {}),
    activeLightCount,
  };
}
