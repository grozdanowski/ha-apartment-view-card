import { describe, it, expect } from 'vitest';
import {
  lightCaps,
  mediaCaps,
  climateCaps,
  controlKind,
  MEDIA_FEATURE,
  CLIMATE_FEATURE,
} from '../src/core/entity-capabilities';
import type { HassEntity } from '../src/core/ha-types';

const ent = (entity_id: string, attributes: Record<string, any> = {}, state = 'on'): HassEntity => ({
  entity_id,
  state,
  attributes,
});

// Attribute shapes below mirror real HA demo entities observed live.
describe('lightCaps', () => {
  it('color_temp + hs (bed_light): brightness + color + colorTemp with kelvin range', () => {
    const c = lightCaps(ent('light.bed', { supported_color_modes: ['color_temp', 'hs'], brightness: 230, min_color_temp_kelvin: 2000, max_color_temp_kelvin: 6535 }));
    expect(c).toMatchObject({ brightness: true, color: true, colorTemp: true, minKelvin: 2000, maxKelvin: 6535 });
  });
  it('rgbw: color but no colorTemp', () => {
    expect(lightCaps(ent('light.office', { supported_color_modes: ['rgbw'], brightness: 180 }))).toMatchObject({ brightness: true, color: true, colorTemp: false });
  });
  it('rgbww: color', () => {
    expect(lightCaps(ent('light.lr', { supported_color_modes: ['rgbww'] })).color).toBe(true);
  });
  it('hs + white: color', () => {
    expect(lightCaps(ent('light.entry', { supported_color_modes: ['hs', 'white'] })).color).toBe(true);
  });
  it('color_temp only: colorTemp but not color', () => {
    expect(lightCaps(ent('light.ct', { supported_color_modes: ['color_temp'] }))).toMatchObject({ brightness: true, color: false, colorTemp: true });
  });
  it('onoff only: no brightness/color/colorTemp', () => {
    expect(lightCaps(ent('light.dumb', { supported_color_modes: ['onoff'] }))).toMatchObject({ brightness: false, color: false, colorTemp: false });
  });
  it('undefined state: all false (defensive)', () => {
    expect(lightCaps(undefined)).toMatchObject({ brightness: false, color: false, colorTemp: false });
  });
});

describe('mediaCaps', () => {
  it('no features: everything off', () => {
    expect(mediaCaps(ent('media_player.x', { supported_features: 0 }))).toMatchObject({ play: false, pause: false, next: false, previous: false, volume: false, source: false });
  });
  it('full transport + volume + source', () => {
    const f = MEDIA_FEATURE.PLAY | MEDIA_FEATURE.PAUSE | MEDIA_FEATURE.NEXT_TRACK | MEDIA_FEATURE.PREVIOUS_TRACK | MEDIA_FEATURE.VOLUME_SET | MEDIA_FEATURE.SELECT_SOURCE;
    expect(mediaCaps(ent('media_player.tv', { supported_features: f }))).toMatchObject({ play: true, pause: true, next: true, previous: true, volume: true, source: true });
  });
  it('volume-only speaker: volume true, transport false', () => {
    expect(mediaCaps(ent('media_player.spk', { supported_features: MEDIA_FEATURE.VOLUME_SET }))).toMatchObject({ volume: true, play: false, next: false });
  });
  it('real walkman value (914877): supports volume + pause', () => {
    const c = mediaCaps(ent('media_player.walkman', { supported_features: 914877 }));
    expect(c.volume).toBe(true);
    expect(c.pause).toBe(true);
  });
});

describe('climateCaps', () => {
  it('heatpump (385): single target temp, modes from entity, no range', () => {
    const c = climateCaps(ent('climate.heatpump', { supported_features: 385, hvac_modes: ['heat', 'off'], min_temp: 7, max_temp: 35, current_temperature: 25, temperature: 20 }, 'heat'));
    expect(c).toMatchObject({ targetTemp: true, targetRange: false, modes: ['heat', 'off'], min: 7, max: 35 });
  });
  it('ecobee (442): range setpoint + fan + preset modes', () => {
    const c = climateCaps(ent('climate.ecobee', { supported_features: 442, hvac_modes: ['off', 'cool', 'heat_cool', 'auto'], fan_modes: ['auto_low'], preset_modes: ['home', 'eco'], target_temp_high: 24, target_temp_low: 21 }, 'heat_cool'));
    expect(c).toMatchObject({ targetRange: true, fan: true, preset: true });
    expect(c.modes).toContain('heat_cool');
    expect(c.presetModes).toEqual(['home', 'eco']);
  });
  it('defaults when range attrs missing', () => {
    const c = climateCaps(ent('climate.bare', { supported_features: CLIMATE_FEATURE.TARGET_TEMPERATURE, hvac_modes: ['off', 'cool'] }));
    expect(c).toMatchObject({ min: 7, max: 35, step: 0.5, fan: false, preset: false });
  });
});

describe('controlKind', () => {
  it('maps domains to control bodies', () => {
    expect(controlKind('light.a')).toBe('light');
    expect(controlKind('media_player.tv')).toBe('media');
    expect(controlKind('climate.ac')).toBe('climate');
    expect(controlKind('switch.x')).toBe('none');
  });
});
