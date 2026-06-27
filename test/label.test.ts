import { describe, it, expect } from 'vitest';
import {
  effectiveLabel,
  smartSource,
  formatLabel,
  relativeTime,
  DEFAULT_LABELS,
  type LabelDefaults,
} from '../src/core/label';
import type { HassEntity, HassLike } from '../src/core/ha-types';

const ent = (id: string, state: string, attributes: Record<string, any> = {}, last_changed?: string): HassEntity => ({
  entity_id: id, state, attributes, last_changed,
});
const defaults = (over: Partial<LabelDefaults> = {}): LabelDefaults => ({ ...DEFAULT_LABELS, ...over });

describe('label: effectiveLabel inheritance', () => {
  it('a per-entity label fully replaces the global default', () => {
    const r = effectiveLabel({ source: 'static', text: 'Hi' }, defaults({ source: 'smart' }), 'climate.x');
    expect(r).toEqual({ source: 'static', text: 'Hi' });
  });
  it('a per-entity source:none overrides the default back to off (null)', () => {
    expect(effectiveLabel({ source: 'none' }, defaults({ source: 'state' }), 'light.x')).toBeNull();
  });
  it('no per-entity label inherits the global default source + visibility', () => {
    expect(effectiveLabel(undefined, defaults({ source: 'state', visibility: 'always' }), 'sensor.x'))
      .toEqual({ source: 'state', visibility: 'always' });
  });
  it('global default of none yields null', () => {
    expect(effectiveLabel(undefined, defaults({ source: 'none' }), 'light.x')).toBeNull();
  });
  it('smart expands to the per-domain preset; lights stay silent', () => {
    const d = defaults({ source: 'smart', visibility: 'auto' });
    expect(effectiveLabel(undefined, d, 'climate.lr')).toEqual({ source: 'climate-current', visibility: 'auto' });
    expect(effectiveLabel(undefined, d, 'media_player.tv')).toEqual({ source: 'media-title', visibility: 'auto' });
    expect(effectiveLabel(undefined, d, 'cover.blind')).toEqual({ source: 'cover-position', visibility: 'auto' });
    expect(effectiveLabel(undefined, d, 'sensor.power')).toEqual({ source: 'sensor', visibility: 'auto' });
    expect(effectiveLabel(undefined, d, 'light.lamp')).toBeNull(); // ring already shows it
    expect(effectiveLabel(undefined, d, 'switch.fan')).toBeNull();
  });
  it('smartSource maps the known domains and falls back to none', () => {
    expect(smartSource('climate')).toBe('climate-current');
    expect(smartSource('vacuum')).toBe('none');
  });
});

describe('label: formatLabel presets', () => {
  it('static returns text, or null when empty', () => {
    expect(formatLabel({ source: 'static', text: 'Movie Night' }, ent('scene.m', 'on'))).toBe('Movie Night');
    expect(formatLabel({ source: 'static', text: '' }, ent('scene.m', 'on'))).toBeNull();
  });
  it('state uses formatEntityState when present, else capitalizes', () => {
    const st = ent('climate.x', 'heat');
    const hass = { formatEntityState: () => 'Heating' } as unknown as HassLike;
    expect(formatLabel({ source: 'state' }, st, hass)).toBe('Heating');
    expect(formatLabel({ source: 'state' }, st)).toBe('Heat'); // fallback on old cores
  });
  it('attribute reads the named key (number gets unit), null when absent', () => {
    const st = ent('sensor.x', '1', { power: 412, unit_of_measurement: 'W' });
    expect(formatLabel({ source: 'attribute', attribute: 'power' }, st)).toBe('412 W');
    expect(formatLabel({ source: 'attribute', attribute: 'missing' }, st)).toBeNull();
    expect(formatLabel({ source: 'attribute' }, st)).toBeNull(); // no key configured
  });
  it('climate-current / climate-target (single + range)', () => {
    const hass = { config: { unit_system: { temperature: '°C' } } } as unknown as HassLike;
    expect(formatLabel({ source: 'climate-current' }, ent('climate.x', 'heat', { current_temperature: 21 }), hass)).toBe('21°C');
    expect(formatLabel({ source: 'climate-target' }, ent('climate.x', 'heat', { temperature: 22 }), hass)).toBe('22°C');
    expect(formatLabel({ source: 'climate-target' }, ent('climate.x', 'heat_cool', { target_temp_low: 21, target_temp_high: 24 }), hass)).toBe('21–24°C');
    expect(formatLabel({ source: 'climate-current' }, ent('climate.x', 'heat', {}), hass)).toBeNull();
  });
  it('media-title (with/without artist) and media-source', () => {
    expect(formatLabel({ source: 'media-title' }, ent('media_player.x', 'playing', { media_title: 'Awake', media_artist: 'Tycho' }))).toBe('Awake — Tycho');
    expect(formatLabel({ source: 'media-title' }, ent('media_player.x', 'playing', { media_title: 'Awake' }))).toBe('Awake');
    expect(formatLabel({ source: 'media-title' }, ent('media_player.x', 'idle', {}))).toBeNull();
    expect(formatLabel({ source: 'media-source' }, ent('media_player.x', 'on', { source: 'Spotify' }))).toBe('Spotify');
    expect(formatLabel({ source: 'media-source' }, ent('media_player.x', 'on', { app_name: 'Netflix' }))).toBe('Netflix');
    expect(formatLabel({ source: 'media-source' }, ent('media_player.x', 'on', {}))).toBeNull();
  });
  it('light-brightness only when on + has brightness', () => {
    expect(formatLabel({ source: 'light-brightness' }, ent('light.x', 'on', { brightness: 128 }))).toBe('50%');
    expect(formatLabel({ source: 'light-brightness' }, ent('light.x', 'off', { brightness: 128 }))).toBeNull();
    expect(formatLabel({ source: 'light-brightness' }, ent('light.x', 'on', {}))).toBeNull();
  });
  it('cover-position and fan-percentage', () => {
    expect(formatLabel({ source: 'cover-position' }, ent('cover.x', 'open', { current_position: 40 }))).toBe('40%');
    expect(formatLabel({ source: 'fan-percentage' }, ent('fan.x', 'on', { percentage: 60 }))).toBe('60%');
    expect(formatLabel({ source: 'cover-position' }, ent('cover.x', 'open', {}))).toBeNull();
  });
  it('battery: own attribute wins, else a battery-class sensor state', () => {
    expect(formatLabel({ source: 'battery' }, ent('sensor.phone', '50', { battery_level: 87, device_class: 'battery' }))).toBe('87%'); // attr wins
    expect(formatLabel({ source: 'battery' }, ent('sensor.b', '63', { device_class: 'battery' }))).toBe('63%');
    expect(formatLabel({ source: 'battery' }, ent('sensor.x', '20', {}))).toBeNull();
  });
  it('sensor: numeric value + unit, null when non-numeric', () => {
    expect(formatLabel({ source: 'sensor' }, ent('sensor.p', '412', { unit_of_measurement: 'W' }))).toBe('412 W');
    expect(formatLabel({ source: 'sensor' }, ent('sensor.s', 'home', {}))).toBeNull();
  });
  it('numbers format through the HA locale (comma decimals)', () => {
    const de = { locale: { language: 'de-DE' } } as unknown as HassLike;
    expect(formatLabel({ source: 'sensor' }, ent('sensor.t', '21.5', { unit_of_measurement: 'kWh' }), de)).toBe('21,5 kWh');
  });
  it('returns null for a missing state object', () => {
    expect(formatLabel({ source: 'sensor' }, undefined)).toBeNull();
  });
  it('last-changed renders relative time via the injected now', () => {
    const past = new Date(1_000_000_000_000).toISOString();
    expect(formatLabel({ source: 'last-changed' }, ent('x.y', 'on', {}, past), undefined, 1_000_000_180_000)).toBe('3 min ago');
  });
});

describe('label: relativeTime', () => {
  const now = 1_000_000_000_000;
  it('buckets seconds/minutes/hours/days', () => {
    expect(relativeTime(new Date(now - 10_000).toISOString(), now)).toBe('just now');
    expect(relativeTime(new Date(now - 3 * 60_000).toISOString(), now)).toBe('3 min ago');
    expect(relativeTime(new Date(now - 2 * 3_600_000).toISOString(), now)).toBe('2 hr ago');
    expect(relativeTime(new Date(now - 24 * 3_600_000).toISOString(), now)).toBe('1 day ago');
    expect(relativeTime(new Date(now - 5 * 24 * 3_600_000).toISOString(), now)).toBe('5 days ago');
  });
  it('null for missing/invalid input', () => {
    expect(relativeTime(undefined, now)).toBeNull();
    expect(relativeTime('not-a-date', now)).toBeNull();
  });
});
