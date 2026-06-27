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

import { coverCaps, fanCaps, lockCaps, resolveControlEntities, controlTarget, COVER_FEATURE, FAN_FEATURE } from '../src/core/entity-capabilities';

describe('controlKind (extended domains)', () => {
  it('maps cover/fan/lock to their kinds; switch/sensor -> none', () => {
    expect(controlKind('cover.garage')).toBe('cover');
    expect(controlKind('fan.bedroom')).toBe('fan');
    expect(controlKind('lock.front')).toBe('lock');
    expect(controlKind('switch.x')).toBe('none');
    expect(controlKind('sensor.x')).toBe('none');
  });
});

describe('coverCaps', () => {
  it('reads open/close/stop/position + tilt from supported_features', () => {
    const f = COVER_FEATURE.OPEN | COVER_FEATURE.CLOSE | COVER_FEATURE.STOP | COVER_FEATURE.SET_POSITION;
    expect(coverCaps(ent('cover.blind', { supported_features: f, device_class: 'blind' }))).toMatchObject({ open: true, close: true, stop: true, position: true, tilt: false, deviceClass: 'blind' });
  });
  it('detects tilt support', () => {
    const f = COVER_FEATURE.OPEN_TILT | COVER_FEATURE.SET_TILT_POSITION;
    expect(coverCaps(ent('cover.shade', { supported_features: f }))).toMatchObject({ tilt: true, setTilt: true });
  });
  it('garage with only open/close/stop has no position slider', () => {
    const f = COVER_FEATURE.OPEN | COVER_FEATURE.CLOSE | COVER_FEATURE.STOP;
    expect(coverCaps(ent('cover.garage', { supported_features: f, device_class: 'garage' })).position).toBe(false);
  });
});

describe('fanCaps', () => {
  it('reads speed/oscillate/direction/preset + preset list', () => {
    const f = FAN_FEATURE.SET_SPEED | FAN_FEATURE.OSCILLATE | FAN_FEATURE.PRESET_MODE;
    expect(fanCaps(ent('fan.bedroom', { supported_features: f, preset_modes: ['auto', 'sleep'] }))).toMatchObject({ speed: true, oscillate: true, direction: false, preset: true, presetModes: ['auto', 'sleep'] });
  });
});

describe('lockCaps', () => {
  it('detects the open-latch feature', () => {
    expect(lockCaps(ent('lock.a', { supported_features: 1 })).openLatch).toBe(true);
    expect(lockCaps(ent('lock.b', { supported_features: 0 })).openLatch).toBe(false);
  });
});

describe('group resolution', () => {
  const states: Record<string, HassEntity> = {
    'group.lights': ent('group.lights', { entity_id: ['light.a', 'light.b'] }),
    'group.mixed': ent('group.mixed', { entity_id: ['light.a', 'switch.x'] }),
    'light.a': ent('light.a'),
  };
  it('resolveControlEntities expands a group to its members, else self', () => {
    expect(resolveControlEntities('group.lights', states)).toEqual(['light.a', 'light.b']);
    expect(resolveControlEntities('light.a', states)).toEqual(['light.a']);
  });
  it('controlTarget gives a homogeneous group its members kind', () => {
    expect(controlTarget('group.lights', states)).toEqual({ kind: 'light', ids: ['light.a', 'light.b'] });
  });
  it('controlTarget is none for a heterogeneous group', () => {
    expect(controlTarget('group.mixed', states).kind).toBe('none');
  });
  it('controlTarget for a single controllable entity', () => {
    expect(controlTarget('light.a', states)).toEqual({ kind: 'light', ids: ['light.a'] });
  });
});

import { vacuumCaps, alarmCaps, VACUUM_FEATURE, ALARM_FEATURE } from '../src/core/entity-capabilities';

describe('controlKind (vacuum/number/select/alarm)', () => {
  it('maps the new domains', () => {
    expect(controlKind('vacuum.robot')).toBe('vacuum');
    expect(controlKind('number.x')).toBe('number');
    expect(controlKind('input_number.x')).toBe('number');
    expect(controlKind('select.x')).toBe('select');
    expect(controlKind('input_select.x')).toBe('select');
    expect(controlKind('alarm_control_panel.home')).toBe('alarm');
  });
});

describe('vacuumCaps', () => {
  it('reads start/pause/stop/return/locate/fanSpeed + battery', () => {
    const f = VACUUM_FEATURE.START | VACUUM_FEATURE.PAUSE | VACUUM_FEATURE.STOP | VACUUM_FEATURE.RETURN_HOME | VACUUM_FEATURE.LOCATE | VACUUM_FEATURE.FAN_SPEED;
    expect(vacuumCaps(ent('vacuum.r', { supported_features: f, fan_speed_list: ['quiet', 'turbo'], battery_level: 80 })))
      .toMatchObject({ start: true, pause: true, stop: true, returnHome: true, locate: true, fanSpeed: true, fanSpeeds: ['quiet', 'turbo'], battery: true });
  });
});

describe('alarmCaps', () => {
  it('reads arm modes + code format', () => {
    const f = ALARM_FEATURE.ARM_HOME | ALARM_FEATURE.ARM_AWAY | ALARM_FEATURE.ARM_NIGHT;
    expect(alarmCaps(ent('alarm_control_panel.a', { supported_features: f, code_format: 'number' })))
      .toMatchObject({ armHome: true, armAway: true, armNight: true, armVacation: false, codeFormat: 'number' });
  });
});
