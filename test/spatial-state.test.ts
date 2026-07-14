import { describe, expect, it } from 'vitest';
import { resolveSpatialEntityState, resolveSpatialEnvironment } from '../src/core/spatial-state';
import type { HassEntity } from '../src/core/ha-types';

function entity(entityId: string, state: string, attributes: Record<string, unknown> = {}): HassEntity {
  return { entity_id: entityId, state, attributes };
}

describe('spatial Home Assistant state', () => {
  it('uses a stable group when a configured child entity is unavailable', () => {
    const states = {
      'light.ceiling_1': entity('light.ceiling_1', 'unavailable'),
      'light.living_room': entity('light.living_room', 'on', { entity_id: ['light.ceiling_1'] }),
    };
    const resolved = resolveSpatialEntityState(states, 'light.ceiling_1');
    expect(resolved.usedGroupFallback).toBe(true);
    expect(resolved.sourceEntityId).toBe('light.living_room');
    expect(resolved.activity).toBe('active');
    expect(resolved.effect).toBe('light');
  });

  it('keeps a real night dark when no configured lights are active', () => {
    const environment = resolveSpatialEnvironment({
      states: {
        'sun.sun': entity('sun.sun', 'below_horizon', { elevation: -21.12, azimuth: 14.95 }),
        'light.living': entity('light.living', 'off'),
        'weather.home': entity('weather.home', 'clear-night'),
      },
      entityIds: ['light.living'],
      fallbackElevationRadians: 0.5,
      fallbackAzimuthRadians: 1,
      mode: 'realistic',
    });
    expect(environment.daylight).toBe(0);
    expect(environment.sunIntensity).toBe(0);
    expect(environment.skyIntensity).toBeLessThan(0.16);
    expect(environment.fillIntensity).toBeLessThan(0.1);
    expect(environment.bounceIntensity).toBe(0);
    expect(environment.exposure).toBeLessThan(0.9);
    expect(environment.activeLightCount).toBe(0);
  });

  it('counts a fallback light group once even when several unavailable children use it', () => {
    const states = {
      'sun.sun': entity('sun.sun', 'below_horizon', { elevation: -12, azimuth: 250 }),
      'light.one': entity('light.one', 'unavailable'),
      'light.two': entity('light.two', 'unavailable'),
      'light.living': entity('light.living', 'on', { entity_id: ['light.one', 'light.two'] }),
    };
    const environment = resolveSpatialEnvironment({
      states,
      entityIds: ['light.one', 'light.two', 'light.living'],
      fallbackElevationRadians: -0.2,
      fallbackAzimuthRadians: 1,
    });
    expect(environment.activeLightCount).toBe(1);
    expect(environment.bounceIntensity).toBeGreaterThan(0);
  });

  it('uses live outdoor illuminance as an upper-bounded daylight input', () => {
    const environment = resolveSpatialEnvironment({
      states: {
        'sun.sun': entity('sun.sun', 'above_horizon', { elevation: 25, azimuth: 120 }),
        'sensor.outdoor_lux': entity('sensor.outdoor_lux', '8500', { device_class: 'illuminance', unit_of_measurement: 'lx' }),
      },
      entityIds: [],
      fallbackElevationRadians: 0,
      fallbackAzimuthRadians: 0,
    });
    expect(environment.illuminanceEntityId).toBe('sensor.outdoor_lux');
    expect(environment.illuminance).toBe(8500);
    expect(environment.daylight).toBeGreaterThan(0.5);
    expect(environment.daylight).toBeLessThanOrEqual(1);
  });
});
