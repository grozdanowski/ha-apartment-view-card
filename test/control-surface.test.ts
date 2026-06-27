// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import '../src/render/control-surface';
import { MEDIA_FEATURE } from '../src/core/entity-capabilities';
import type { AvControlSurface } from '../src/render/control-surface';
import type { HassEntity } from '../src/core/ha-types';

type Call = { domain: string; service: string; data: any };
function mockHass(states: Record<string, HassEntity>) {
  const calls: Call[] = [];
  return {
    states,
    callService: (domain: string, service: string, data: any) => {
      calls.push({ domain, service, data });
      return Promise.resolve();
    },
    calls,
  };
}
const ent = (id: string, state: string, attributes: Record<string, any>): HassEntity => ({ entity_id: id, state, attributes });

async function mount(entityIds: string[], states: Record<string, HassEntity>, selectMode = false) {
  const hass = mockHass(states);
  const el = document.createElement('av-control-surface') as AvControlSurface & HTMLElement;
  el.hass = hass as any;
  el.entityIds = entityIds;
  el.selectMode = selectMode;
  document.body.appendChild(el);
  await el.updateComplete;
  return { el, hass, sr: el.shadowRoot! };
}

beforeEach(() => { document.body.innerHTML = ''; });

describe('control-surface: light capability gating', () => {
  it('full-capability light shows brightness slider + color swatches', async () => {
    const { sr } = await mount(['light.a'], { 'light.a': ent('light.a', 'on', { supported_color_modes: ['rgb'], brightness: 128, friendly_name: 'Lamp' }) });
    expect(sr.querySelector('[aria-label="Brightness"]')).toBeTruthy();
    expect(sr.querySelectorAll('.sw').length).toBeGreaterThan(0);
  });
  it('on/off-only light shows NO brightness slider and NO color swatches', async () => {
    const { sr } = await mount(['light.b'], { 'light.b': ent('light.b', 'on', { supported_color_modes: ['onoff'] }) });
    expect(sr.querySelector('[aria-label="Brightness"]')).toBeNull();
    expect(sr.querySelector('.sw')).toBeNull();
  });
  it('color_temp-only light shows brightness but NO rgb swatches', async () => {
    const { sr } = await mount(['light.c'], { 'light.c': ent('light.c', 'on', { supported_color_modes: ['color_temp'], brightness: 100 }) });
    expect(sr.querySelector('[aria-label="Brightness"]')).toBeTruthy();
    expect(sr.querySelector('.sw')).toBeNull();
  });
  it('a swatch click calls light.turn_on with rgb_color for the entity', async () => {
    const { sr, hass } = await mount(['light.a'], { 'light.a': ent('light.a', 'on', { supported_color_modes: ['rgb'], brightness: 128 }) });
    (sr.querySelector('.sw') as HTMLElement).click();
    const c = hass.calls.at(-1)!;
    expect(c).toMatchObject({ domain: 'light', service: 'turn_on' });
    expect(c.data.entity_id).toEqual(['light.a']);
    expect(Array.isArray(c.data.rgb_color)).toBe(true);
  });
  it('keyboard arrow on the brightness slider calls light.turn_on with brightness_pct', async () => {
    const { sr, hass } = await mount(['light.a'], { 'light.a': ent('light.a', 'on', { supported_color_modes: ['rgb'], brightness: 128 }) });
    sr.querySelector('[aria-label="Brightness"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    const c = hass.calls.at(-1)!;
    expect(c).toMatchObject({ domain: 'light', service: 'turn_on' });
    expect(typeof c.data.brightness_pct).toBe('number');
  });
  it('a group of lights titles "N lights" and applies to all ids', async () => {
    const states = {
      'light.a': ent('light.a', 'on', { supported_color_modes: ['rgb'], brightness: 200 }),
      'light.b': ent('light.b', 'on', { supported_color_modes: ['rgb'], brightness: 100 }),
    };
    const { sr, hass } = await mount(['light.a', 'light.b'], states);
    expect(sr.querySelector('.h-title')!.textContent).toContain('2 lights');
    (sr.querySelector('.sw') as HTMLElement).click();
    expect(hass.calls.at(-1)!.data.entity_id).toEqual(['light.a', 'light.b']);
  });
});

describe('control-surface: media capability gating', () => {
  it('full media shows transport + volume; play/pause calls media_play_pause', async () => {
    const f = MEDIA_FEATURE.PLAY | MEDIA_FEATURE.PAUSE | MEDIA_FEATURE.NEXT_TRACK | MEDIA_FEATURE.PREVIOUS_TRACK | MEDIA_FEATURE.VOLUME_SET;
    const { sr, hass } = await mount(['media_player.tv'], { 'media_player.tv': ent('media_player.tv', 'playing', { supported_features: f, volume_level: 0.4, media_title: 'Show' }) });
    expect(sr.querySelector('[aria-label="Volume"]')).toBeTruthy();
    expect(sr.querySelectorAll('.tbtn').length).toBe(3); // prev, play/pause, next
    (sr.querySelector('[aria-label="Play or pause"]') as HTMLElement).click();
    expect(hass.calls.at(-1)).toMatchObject({ domain: 'media_player', service: 'media_play_pause' });
  });
  it('a speaker with no volume support shows no volume slider', async () => {
    const { sr } = await mount(['media_player.spk'], { 'media_player.spk': ent('media_player.spk', 'idle', { supported_features: MEDIA_FEATURE.PLAY }) });
    expect(sr.querySelector('[aria-label="Volume"]')).toBeNull();
  });
  it('keyboard arrow on the volume slider calls volume_set (relative to current)', async () => {
    const { sr, hass } = await mount(['media_player.tv'], { 'media_player.tv': ent('media_player.tv', 'playing', { supported_features: MEDIA_FEATURE.VOLUME_SET, volume_level: 0.4 }) });
    (sr.querySelector('[aria-label="Volume"]') as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    const c = hass.calls.at(-1)!;
    expect(c).toMatchObject({ domain: 'media_player', service: 'volume_set' });
    expect(c.data.volume_level).toBeCloseTo(0.45, 5);
  });
  it('SELECT_SOURCE + source_list renders a source picker with the current source selected', async () => {
    const f = MEDIA_FEATURE.SELECT_SOURCE | MEDIA_FEATURE.PLAY;
    const { sr } = await mount(['media_player.av'], { 'media_player.av': ent('media_player.av', 'on', { supported_features: f, source: 'HDMI 2', source_list: ['TV', 'HDMI 1', 'HDMI 2'] }) });
    const select = sr.querySelector('select.src') as HTMLSelectElement;
    expect(select).toBeTruthy();
    const opts = Array.from(select.options);
    expect(opts.map((o) => o.value)).toEqual(['TV', 'HDMI 1', 'HDMI 2']);
    // updated() reflects the current source onto the picker value
    expect(select.value).toBe('HDMI 2');
  });
  it('changing the source picker calls media_player.select_source', async () => {
    const f = MEDIA_FEATURE.SELECT_SOURCE;
    const { sr, hass } = await mount(['media_player.av'], { 'media_player.av': ent('media_player.av', 'on', { supported_features: f, source: 'TV', source_list: ['TV', 'HDMI 1'] }) });
    const select = sr.querySelector('select.src') as HTMLSelectElement;
    select.value = 'HDMI 1';
    select.dispatchEvent(new Event('change'));
    expect(hass.calls.at(-1)).toMatchObject({ domain: 'media_player', service: 'select_source' });
    expect(hass.calls.at(-1)!.data.source).toBe('HDMI 1');
  });
  it('no SELECT_SOURCE -> no source picker; SELECT_SOURCE but empty source_list -> none', async () => {
    const { sr: noFeat } = await mount(['media_player.x'], { 'media_player.x': ent('media_player.x', 'on', { supported_features: MEDIA_FEATURE.PLAY }) });
    expect(noFeat.querySelector('select.src')).toBeNull();
    const { sr: noList } = await mount(['media_player.y'], { 'media_player.y': ent('media_player.y', 'on', { supported_features: MEDIA_FEATURE.SELECT_SOURCE, source_list: [] }) });
    expect(noList.querySelector('select.src')).toBeNull();
  });
});

describe('control-surface: climate capability gating', () => {
  it('single-setpoint climate shows temp + stepper + modes from hvac_modes', async () => {
    const { sr, hass } = await mount(['climate.ac'], { 'climate.ac': ent('climate.ac', 'cool', { supported_features: 1, hvac_modes: ['off', 'cool', 'heat'], temperature: 21, current_temperature: 24, min_temp: 7, max_temp: 35, target_temp_step: 1 }) });
    expect(sr.querySelectorAll('.mode').length).toBe(3);
    (sr.querySelector('[aria-label="Warmer"]') as HTMLElement).click();
    expect(hass.calls.at(-1)).toMatchObject({ domain: 'climate', service: 'set_temperature' });
    expect(hass.calls.at(-1)!.data.temperature).toBe(22);
    (sr.querySelectorAll('.mode')[1] as HTMLElement).click();
    expect(hass.calls.at(-1)).toMatchObject({ domain: 'climate', service: 'set_hvac_mode' });
    expect(hass.calls.at(-1)!.data.hvac_mode).toBe('cool');
  });
  it('range thermostat (heat_cool) shows the range and no single stepper', async () => {
    const { sr } = await mount(['climate.eco'], { 'climate.eco': ent('climate.eco', 'heat_cool', { supported_features: 2, hvac_modes: ['off', 'heat_cool'], target_temp_high: 24, target_temp_low: 21, current_temperature: 23 }) });
    expect(sr.querySelector('[aria-label="Warmer"]')).toBeNull();
    expect(sr.querySelector('.tval')!.textContent).toContain('21');
  });
});

describe('control-surface: panel states', () => {
  it('empty + selectMode renders a disabled prompt', async () => {
    const { sr } = await mount([], {}, true);
    expect(sr.querySelector('.panel.disabled')).toBeTruthy();
    expect(sr.querySelector('.h-sub')!.textContent).toContain('Select lights');
  });
  it('empty + not selectMode renders nothing', async () => {
    const { sr } = await mount([], {});
    expect(sr.querySelector('.panel')).toBeNull();
  });
  it('close button emits surface-close', async () => {
    const { el, sr } = await mount(['light.a'], { 'light.a': ent('light.a', 'on', { supported_color_modes: ['rgb'] }) });
    let closed = false;
    el.addEventListener('surface-close', () => (closed = true));
    (sr.querySelector('.close') as HTMLElement).click();
    expect(closed).toBe(true);
  });
  it('power toggles via homeassistant.turn_off when on', async () => {
    const { sr, hass } = await mount(['light.a'], { 'light.a': ent('light.a', 'on', { supported_color_modes: ['rgb'] }) });
    (sr.querySelector('.pwr') as HTMLElement).click();
    expect(hass.calls.at(-1)).toMatchObject({ domain: 'homeassistant', service: 'turn_off' });
  });
});
