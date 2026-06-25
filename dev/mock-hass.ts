export interface MockHassEntity {
  entity_id: string;
  state: string;
  attributes: Record<string, any>;
  last_changed: string;
  last_updated: string;
  context: { id: string; parent_id: null; user_id: null };
}

export interface ServiceCall {
  domain: string;
  service: string;
  data: Record<string, any>;
}

export interface MockHass {
  states: Record<string, MockHassEntity>;
  callService(
    domain: string,
    service: string,
    data?: Record<string, any>,
  ): Promise<void>;
  readonly serviceCalls: ServiceCall[];
}

let ctxCounter = 0;
function nowIso(): string {
  return new Date().toISOString();
}

function makeEntity(
  entity_id: string,
  state: string,
  attributes: Record<string, any>,
): MockHassEntity {
  const ts = nowIso();
  return {
    entity_id,
    state,
    attributes,
    last_changed: ts,
    last_updated: ts,
    context: { id: `mock-${ctxCounter++}`, parent_id: null, user_id: null },
  };
}

function seedStates(): Record<string, MockHassEntity> {
  return {
    'light.kitchen_ceiling': makeEntity('light.kitchen_ceiling', 'on', {
      friendly_name: 'Kitchen ceiling',
      brightness: 204, // ~0.8 normalized
      color_mode: 'rgb',
      rgb_color: [255, 244, 214],
      supported_color_modes: ['rgb', 'color_temp'],
    }),
    'light.living_lamp': makeEntity('light.living_lamp', 'on', {
      friendly_name: 'Living room lamp',
      brightness: 128, // ~0.5 normalized
      color_mode: 'color_temp',
      color_temp_kelvin: 2700,
      supported_color_modes: ['color_temp'],
    }),
    'media_player.tv': makeEntity('media_player.tv', 'playing', {
      friendly_name: 'Living room TV',
      device_class: 'tv',
    }),
    'media_player.kitchen_speaker': makeEntity(
      'media_player.kitchen_speaker',
      'playing',
      {
        friendly_name: 'Kitchen speaker',
        device_class: 'speaker',
      },
    ),
    'climate.bedroom_ac': makeEntity('climate.bedroom_ac', 'cool', {
      friendly_name: 'Bedroom A/C',
      hvac_action: 'cooling',
      current_temperature: 24,
      temperature: 21,
    }),
    'sun.sun': makeEntity('sun.sun', 'above_horizon', {
      friendly_name: 'Sun',
      // far-future placeholders; refined via setSunForTimeOfDay
      next_rising: new Date(Date.now() + 12 * 3_600_000).toISOString(),
      next_setting: new Date(Date.now() + 6 * 3_600_000).toISOString(),
    }),
  };
}

/** A light is a light whose entity_id is in the light domain. */
function isLightId(entityId: string): boolean {
  return entityId.startsWith('light.');
}

/**
 * Create a mock `hass` with a canonical entity set and a recording
 * callService spy. `homeassistant.toggle` flips a target light's state so
 * the dev harness reflects taps; other services are recorded but inert.
 */
export function createMockHass(
  overrides: Record<string, Partial<MockHassEntity>> = {},
): MockHass {
  const states = seedStates();
  for (const [id, patch] of Object.entries(overrides)) {
    const base = states[id] ?? makeEntity(id, 'unknown', {});
    states[id] = {
      ...base,
      ...patch,
      attributes: { ...base.attributes, ...(patch.attributes ?? {}) },
    };
  }

  const serviceCalls: ServiceCall[] = [];

  const hass: MockHass = {
    states,
    serviceCalls,
    async callService(domain, service, data = {}) {
      serviceCalls.push({ domain, service, data: { ...data } });
      if (domain === 'homeassistant' && service === 'toggle') {
        const ids = ([] as string[]).concat(data.entity_id ?? []);
        for (const id of ids) {
          const ent = states[id];
          if (!ent) continue;
          const next = ent.state === 'off' ? 'on' : 'off';
          states[id] = {
            ...ent,
            state: isLightId(id) ? next : ent.state,
            last_changed: nowIso(),
            last_updated: nowIso(),
          };
        }
      }
    },
  };
  return hass;
}

/**
 * Shape sun.sun so a view:auto resolver under the 60-minute default window
 * lands on the requested time-of-day.
 *   night    -> below_horizon, next sunrise comfortably in the future
 *   day      -> above_horizon, next sunrise/sunset both > 60min away
 *   duskDawn -> above_horizon, next sunrise within the 60min window
 */
export function setSunForTimeOfDay(
  hass: MockHass,
  tod: 'day' | 'night' | 'duskDawn',
): void {
  const now = Date.now();
  const min = 60_000;
  const sun = hass.states['sun.sun'];
  let state: string;
  let nextRising: number;
  let nextSetting: number;
  switch (tod) {
    case 'night':
      state = 'below_horizon';
      nextRising = now + 6 * 60 * min; // sunrise 6h away
      nextSetting = now + 18 * 60 * min;
      break;
    case 'duskDawn':
      state = 'above_horizon';
      nextRising = now + 30 * min; // within +/-60min window
      nextSetting = now + 10 * 60 * min;
      break;
    case 'day':
    default:
      state = 'above_horizon';
      nextRising = now + 18 * 60 * min;
      nextSetting = now + 8 * 60 * min; // > 60min away
      break;
  }
  hass.states['sun.sun'] = {
    ...sun,
    state,
    attributes: {
      ...sun.attributes,
      next_rising: new Date(nextRising).toISOString(),
      next_setting: new Date(nextSetting).toISOString(),
    },
    last_changed: nowIso(),
    last_updated: nowIso(),
  };
}
