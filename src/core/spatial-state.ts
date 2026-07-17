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

export interface SpatialEntityPresentation {
  name: string;
  status: string;
  strength: number;
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

function numericAttribute(state: HassEntity | undefined, key: string): number | undefined {
  const value = Number(state?.attributes?.[key]);
  return Number.isFinite(value) ? value : undefined;
}

/** Normalized live output for effects such as fans and air purifiers. */
export function spatialEntityStrength(entityId: string, state?: HassEntity): number {
  if (!state || activityFor(entityId, state) === 'off' || activityFor(entityId, state) === 'unavailable') return 0;
  const domain = domainOf(entityId);
  if (domain === 'fan') {
    const percentage = numericAttribute(state, 'percentage');
    if (percentage !== undefined) return clamp01(percentage / 100);
    const speed = String(state.attributes?.speed ?? state.attributes?.preset_mode ?? '').toLowerCase();
    if (/max|turbo|boost|high/.test(speed)) return 1;
    if (/medium|mid/.test(speed)) return 0.62;
    if (/low|quiet|sleep/.test(speed)) return 0.3;
    return 0.5;
  }
  if (domain === 'humidifier') {
    const humidity = numericAttribute(state, 'humidity');
    return humidity === undefined ? 0.5 : clamp01(humidity / 100);
  }
  if (domain === 'climate') {
    const fanMode = String(state.attributes?.fan_mode ?? '').toLowerCase();
    if (/max|turbo|boost|high/.test(fanMode)) return 1;
    if (/medium|mid/.test(fanMode)) return 0.62;
    if (/low|quiet/.test(fanMode)) return 0.32;
    return 0.5;
  }
  if (domain === 'light') {
    const brightness = numericAttribute(state, 'brightness');
    return brightness === undefined ? 1 : clamp01(brightness / 255);
  }
  return activityFor(entityId, state) === 'active' || activityFor(entityId, state) === 'attention' ? 1 : 0;
}

function sentenceCase(value: string): string {
  const normalized = value.replaceAll('_', ' ').trim();
  return normalized ? normalized.charAt(0).toUpperCase() + normalized.slice(1) : '';
}

/** Concise copy for spatial beacons; no actions or state mutation. */
export function spatialEntityPresentation(
  entityId: string,
  state?: HassEntity,
  configuredName?: string,
  formatState?: (state: HassEntity) => string,
): SpatialEntityPresentation {
  const explicitName = configuredName || String(state?.attributes?.friendly_name ?? '').trim();
  const name = explicitName || String(entityId.split('.')[1] ?? entityId)
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
  if (!state) return { name, status: 'Unavailable', strength: 0 };
  const domain = domainOf(entityId);
  const activity = activityFor(entityId, state);
  if (activity === 'unavailable') return { name, status: 'Unavailable', strength: 0 };
  if (domain === 'media_player') {
    const title = String(state.attributes?.media_title ?? '').trim();
    const artist = String(state.attributes?.media_artist ?? '').trim();
    const source = String(state.attributes?.source ?? state.attributes?.app_name ?? '').trim();
    const playing = [title, artist].filter(Boolean).join(' · ');
    const detail = [playing, source].filter(Boolean).join(' · ');
    return { name, status: detail || sentenceCase(state.state), strength: spatialEntityStrength(entityId, state) };
  }
  if (domain === 'fan') {
    const percentage = numericAttribute(state, 'percentage');
    const preset = String(state.attributes?.preset_mode ?? '').trim();
    const status = activity === 'off' ? 'Off' : [percentage !== undefined ? `${Math.round(percentage)}%` : '', preset].filter(Boolean).join(' · ') || 'On';
    return { name, status, strength: spatialEntityStrength(entityId, state) };
  }
  if (domain === 'light') {
    const brightness = numericAttribute(state, 'brightness');
    const status = activity === 'off' ? 'Off' : brightness === undefined ? 'On' : `On · ${Math.round(brightness / 255 * 100)}%`;
    return { name, status, strength: spatialEntityStrength(entityId, state) };
  }
  if (domain === 'climate') {
    const action = String(state.attributes?.hvac_action ?? state.state);
    const current = numericAttribute(state, 'current_temperature');
    const target = numericAttribute(state, 'temperature');
    const temperatures = current !== undefined
      ? `${current}°${target !== undefined ? ` → ${target}°` : ''}`
      : '';
    return { name, status: [sentenceCase(action), temperatures].filter(Boolean).join(' · '), strength: spatialEntityStrength(entityId, state) };
  }
  const formatted = formatState?.(state);
  return {
    name,
    status: formatted || sentenceCase(state.state),
    strength: spatialEntityStrength(entityId, state),
  };
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
  const directResolved = resolveDirectSpatialEntityState(states, entityId);
  const direct = directResolved.state;
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

/**
 * Resolve only the configured entity itself. Spatial effects must use this
 * stricter form: a group can describe an unavailable child, but it cannot tell
 * us which physical fixture is emitting light or what colour it is emitting.
 */
export function resolveDirectSpatialEntityState(
  states: Record<string, HassEntity>,
  entityId: string,
): ResolvedSpatialState {
  const state = states[entityId];
  return {
    state,
    sourceEntityId: entityId,
    usedGroupFallback: false,
    activity: activityFor(entityId, state),
    effect: effectFor(entityId, state),
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
    const resolved = resolveDirectSpatialEntityState(states, entityId);
    return resolved.activity === 'active' ? [resolved.sourceEntityId] : [];
  }));
  const activeLightCount = activeLightSources.size;
  const mode = args.mode ?? 'realistic';
  // Keep an unlit night visibly legible without inventing practical light.
  // The sun remains at zero; this is only the soft ambient floor of the room.
  const floor = mode === 'presentation' ? 0.2 : mode === 'balanced' ? 0.12 : 0.09;
  const nightExposure = mode === 'presentation' ? 0.94 : mode === 'balanced' ? 0.9 : 0.88;
  const activeLift = mode === 'realistic' ? 0 : Math.min(mode === 'balanced' ? 0.045 : 0.08, activeLightCount * 0.012);
  const bounceIntensity = mode === 'realistic'
    ? 0
    : activeLightCount
      ? Math.min(mode === 'balanced' ? 0.07 : 0.14, 0.018 + activeLightCount * 0.014)
      : 0;
  return {
    daylight,
    cloudFactor,
    sunIntensity: daylight * 3.25 * cloudFactor,
    skyIntensity: floor + daylight * (0.88 + cloudFactor * 0.18),
    fillIntensity: floor * 0.6 + daylight * 0.42,
    bounceIntensity,
    exposure: nightExposure + daylight * (1.02 - nightExposure) + activeLift,
    elevationDegrees,
    azimuthDegrees,
    ...(Number.isFinite(illuminance) ? { illuminance } : {}),
    ...(illuminanceState ? { illuminanceEntityId: illuminanceState.entity_id } : {}),
    ...(weather ? { weatherEntityId: weather.entity_id, weatherState: weather.state } : {}),
    activeLightCount,
  };
}
