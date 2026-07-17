import { describe, expect, it } from 'vitest';
import { resolveDirectSpatialEntityState, resolveSpatialEntityState, resolveSpatialEnvironment, spatialEntityPresentation, spatialEntityStrength } from '../src/core/spatial-state';
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

  it('keeps practical light state unavailable when only its parent group is on', () => {
    const states = {
      'light.ceiling_1': entity('light.ceiling_1', 'unavailable'),
      'light.living_room': entity('light.living_room', 'on', { entity_id: ['light.ceiling_1'] }),
    };
    const resolved = resolveDirectSpatialEntityState(states, 'light.ceiling_1');
    expect(resolved.usedGroupFallback).toBe(false);
    expect(resolved.activity).toBe('unavailable');
    expect(resolved.sourceEntityId).toBe('light.ceiling_1');
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
    expect(environment.skyIntensity).toBeLessThan(0.2);
    expect(environment.fillIntensity).toBeLessThan(0.12);
    expect(environment.bounceIntensity).toBe(0);
    expect(environment.exposure).toBeLessThan(0.92);
    expect(environment.activeLightCount).toBe(0);
  });

  it('keeps realistic ambient light local even when several fixtures are on', () => {
    const environment = resolveSpatialEnvironment({
      states: {
        'sun.sun': entity('sun.sun', 'below_horizon', { elevation: -20.79, azimuth: 341.17 }),
        'light.living': entity('light.living', 'on', { brightness: 230 }),
        'light.hallway': entity('light.hallway', 'on', { brightness: 254 }),
        'light.office': entity('light.office', 'off'),
      },
      entityIds: ['light.living', 'light.hallway', 'light.office'],
      fallbackElevationRadians: -0.36,
      fallbackAzimuthRadians: 5.95,
      mode: 'realistic',
    });
    expect(environment.daylight).toBe(0);
    expect(environment.activeLightCount).toBe(2);
    expect(environment.bounceIntensity).toBe(0);
    expect(environment.exposure).toBe(0.88);
    expect(environment.skyIntensity).toBe(0.09);
  });

  it('does not turn unavailable child fixtures into emitters from a parent group', () => {
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
    expect(environment.activeLightCount).toBe(0);
    expect(environment.bounceIntensity).toBe(0);
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

  it('maps a fan percentage to spatial effect strength', () => {
    const purifier = entity('fan.air_purifier', 'on', { percentage: 72, preset_mode: 'Manual' });
    expect(spatialEntityStrength(purifier.entity_id, purifier)).toBeCloseTo(0.72);
    expect(spatialEntityStrength(purifier.entity_id, { ...purifier, state: 'off' })).toBe(0);
  });

  it('describes media with title, artist, and source', () => {
    const media = entity('media_player.naim', 'playing', {
      friendly_name: 'Naim Mu-so',
      media_title: 'All The Stars',
      media_artist: 'Kendrick Lamar & SZA',
      source: 'Spotify',
    });
    expect(spatialEntityPresentation(media.entity_id, media)).toMatchObject({
      name: 'Naim Mu-so',
      status: 'All The Stars · Kendrick Lamar & SZA · Spotify',
    });
  });
});
