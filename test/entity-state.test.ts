import { describe, it, expect } from 'vitest';
import type { HassEntity } from '../src/core/ha-types';
import type { EntityConfig } from '../src/core/config';
import { isActive, intensity, iconForEntity } from '../src/core/entity-state';

function ent(
  entity_id: string,
  state: string,
  attributes: Record<string, any> = {},
): HassEntity {
  return { entity_id, state, attributes };
}
function cfg(over: Partial<EntityConfig> = {}): EntityConfig {
  return {
    entity: 'light.x',
    x: 50,
    y: 50,
    size: 'medium',
    tap: 'toggle',
    orientation: null,
    ...over,
  };
}

describe('isActive', () => {
  it('light on -> true', () => expect(isActive(ent('light.a', 'on'))).toBe(true));
  it('light off -> false', () => expect(isActive(ent('light.a', 'off'))).toBe(false));
  it('media_player playing -> true', () =>
    expect(isActive(ent('media_player.a', 'playing'))).toBe(true));
  it('media_player paused -> true', () =>
    expect(isActive(ent('media_player.a', 'paused'))).toBe(true));
  it('media_player off -> false', () =>
    expect(isActive(ent('media_player.a', 'off'))).toBe(false));
  it('media_player idle -> false', () =>
    expect(isActive(ent('media_player.a', 'idle'))).toBe(false));
  it('media_player unavailable -> false', () =>
    expect(isActive(ent('media_player.a', 'unavailable'))).toBe(false));
  it('climate cooling via hvac_action -> true', () =>
    expect(isActive(ent('climate.a', 'cool', { hvac_action: 'cooling' }))).toBe(true));
  it('climate idle via hvac_action -> false', () =>
    expect(isActive(ent('climate.a', 'cool', { hvac_action: 'idle' }))).toBe(false));
  it('climate state off -> false', () =>
    expect(isActive(ent('climate.a', 'off'))).toBe(false));
  it('climate heat with no hvac_action -> true (state not off/idle)', () =>
    expect(isActive(ent('climate.a', 'heat'))).toBe(true));
  it('other domain: state===on -> true', () =>
    expect(isActive(ent('switch.a', 'on'))).toBe(true));
});

describe('intensity', () => {
  it('off -> 0', () => expect(intensity(ent('light.a', 'off', { brightness: 200 }))).toBe(0));
  it('on with brightness 255 -> 1', () =>
    expect(intensity(ent('light.a', 'on', { brightness: 255 }))).toBe(1));
  it('on with brightness 128 -> ~0.5', () =>
    expect(intensity(ent('light.a', 'on', { brightness: 128 }))).toBeCloseTo(0.502, 2));
  it('on with no brightness attr -> 1 (on/off light reads as full)', () =>
    expect(intensity(ent('light.a', 'on'))).toBe(1));
  it('unavailable -> 0', () =>
    expect(intensity(ent('light.a', 'unavailable', { brightness: 255 }))).toBe(0));
  it('clamps above 1', () =>
    expect(intensity(ent('light.a', 'on', { brightness: 999 }))).toBe(1));
});

describe('iconForEntity', () => {
  it('config icon wins', () =>
    expect(iconForEntity(ent('light.a', 'on'), cfg({ icon: 'mdi:foo' }))).toBe('mdi:foo'));
  it('light domain default', () =>
    expect(iconForEntity(ent('light.a', 'on'), cfg({ entity: 'light.a' }))).toBe('mdi:lightbulb'));
  it('media_player default', () =>
    expect(iconForEntity(ent('media_player.a', 'playing'), cfg({ entity: 'media_player.a' }))).toBe(
      'mdi:cast',
    ));
  it('media_player tv device_class -> television', () =>
    expect(
      iconForEntity(ent('media_player.a', 'playing', { device_class: 'tv' }), cfg({ entity: 'media_player.a' })),
    ).toBe('mdi:television'));
  it('climate default', () =>
    expect(iconForEntity(ent('climate.a', 'cool'), cfg({ entity: 'climate.a' }))).toBe(
      'mdi:thermostat',
    ));
  it('switch default', () =>
    expect(iconForEntity(ent('switch.a', 'on'), cfg({ entity: 'switch.a' }))).toBe(
      'mdi:toggle-switch',
    ));
  it('unknown domain fallback', () =>
    expect(iconForEntity(ent('sensor.a', 'on'), cfg({ entity: 'sensor.a' }))).toBe(
      'mdi:checkbox-blank-circle',
    ));
});
