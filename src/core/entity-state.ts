import type { HassEntity } from './ha-types';
import type { EntityConfig } from './config';

function domainOf(state: HassEntity): string {
  return (state.entity_id.split('.')[0] || '').toLowerCase();
}

const MEDIA_INACTIVE = new Set(['off', 'idle', 'unavailable', 'standby', 'unknown']);
const CLIMATE_INACTIVE = new Set(['off', 'idle', 'unavailable', 'unknown']);

export function isActive(state: HassEntity): boolean {
  if (!state) return false;
  const domain = domainOf(state);
  const s = state.state;

  if (domain === 'light') {
    return s === 'on';
  }
  if (domain === 'media_player') {
    return !MEDIA_INACTIVE.has(s);
  }
  if (domain === 'climate') {
    const action = state.attributes?.hvac_action;
    if (typeof action === 'string') {
      return !CLIMATE_INACTIVE.has(action);
    }
    return !CLIMATE_INACTIVE.has(s);
  }
  // Generic on/off entities (switch, fan, input_boolean, ...).
  return s === 'on';
}

export function intensity(state: HassEntity): number {
  if (!state) return 0;
  if (!isActive(state)) return 0;
  const b = state.attributes?.brightness;
  if (typeof b !== 'number') {
    // Active light with no brightness attribute (on/off mode) reads as full.
    return 1;
  }
  return Math.max(0, Math.min(1, b / 255));
}

// Domain/device_class defaults. cfg.icon always wins.
const DOMAIN_DEFAULTS: Record<string, string> = {
  light: 'mdi:lightbulb',
  media_player: 'mdi:cast',
  climate: 'mdi:thermostat',
  switch: 'mdi:toggle-switch',
  fan: 'mdi:fan',
  cover: 'mdi:window-shutter',
  binary_sensor: 'mdi:radiobox-blank',
  lock: 'mdi:lock',
};

const MEDIA_DEVICE_CLASS: Record<string, string> = {
  tv: 'mdi:television',
  speaker: 'mdi:speaker',
  receiver: 'mdi:audio-video',
};

export function iconForEntity(state: HassEntity, cfg: EntityConfig): string {
  if (cfg?.icon) return cfg.icon;

  const domain = state ? domainOf(state) : (cfg.entity.split('.')[0] || '').toLowerCase();
  const dc = state?.attributes?.device_class;

  if (domain === 'media_player' && typeof dc === 'string' && MEDIA_DEVICE_CLASS[dc]) {
    return MEDIA_DEVICE_CLASS[dc];
  }
  if (DOMAIN_DEFAULTS[domain]) {
    return DOMAIN_DEFAULTS[domain];
  }
  return 'mdi:checkbox-blank-circle';
}
