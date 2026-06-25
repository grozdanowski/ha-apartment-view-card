import { describe, it, expect } from 'vitest';
import { createMockHass, setSunForTimeOfDay } from '../dev/mock-hass';

describe('createMockHass', () => {
  it('seeds the canonical entity set', () => {
    const hass = createMockHass();
    expect(hass.states['light.kitchen_ceiling']).toBeDefined();
    expect(hass.states['light.living_lamp']).toBeDefined();
    expect(hass.states['media_player.tv']).toBeDefined();
    expect(hass.states['media_player.kitchen_speaker']).toBeDefined();
    expect(hass.states['climate.bedroom_ac']).toBeDefined();
    expect(hass.states['sun.sun']).toBeDefined();
  });

  it('seeds a light with normalized-able brightness and rgb color', () => {
    const hass = createMockHass();
    const light = hass.states['light.kitchen_ceiling'];
    expect(light.state).toBe('on');
    expect(typeof light.attributes.brightness).toBe('number');
    expect(Array.isArray(light.attributes.rgb_color)).toBe(true);
  });

  it('seeds climate with an hvac_action attribute', () => {
    const hass = createMockHass();
    expect(hass.states['climate.bedroom_ac'].attributes.hvac_action).toBeDefined();
  });

  it('records every callService into serviceCalls (spy)', async () => {
    const hass = createMockHass();
    await hass.callService('homeassistant', 'toggle', {
      entity_id: 'light.kitchen_ceiling',
    });
    expect(hass.serviceCalls).toHaveLength(1);
    expect(hass.serviceCalls[0]).toEqual({
      domain: 'homeassistant',
      service: 'toggle',
      data: { entity_id: 'light.kitchen_ceiling' },
    });
  });

  it('homeassistant.toggle flips the target light state', async () => {
    const hass = createMockHass();
    expect(hass.states['light.kitchen_ceiling'].state).toBe('on');
    await hass.callService('homeassistant', 'toggle', {
      entity_id: 'light.kitchen_ceiling',
    });
    expect(hass.states['light.kitchen_ceiling'].state).toBe('off');
    await hass.callService('homeassistant', 'toggle', {
      entity_id: 'light.kitchen_ceiling',
    });
    expect(hass.states['light.kitchen_ceiling'].state).toBe('on');
  });

  it('homeassistant.toggle does not flip non-light entities', async () => {
    const hass = createMockHass();
    const initialMediaState = hass.states['media_player.tv'].state;
    expect(initialMediaState).toBe('playing');
    await hass.callService('homeassistant', 'toggle', {
      entity_id: 'media_player.tv',
    });
    // media_player.tv state should remain unchanged
    expect(hass.states['media_player.tv'].state).toBe('playing');
    // but the call should be recorded
    expect(hass.serviceCalls).toContainEqual({
      domain: 'homeassistant',
      service: 'toggle',
      data: { entity_id: 'media_player.tv' },
    });
  });

  it('homeassistant.toggle still flips light entities after regression', async () => {
    const hass = createMockHass();
    expect(hass.states['light.kitchen_ceiling'].state).toBe('on');
    await hass.callService('homeassistant', 'toggle', {
      entity_id: 'light.kitchen_ceiling',
    });
    expect(hass.states['light.kitchen_ceiling'].state).toBe('off');
  });

  it('applies overrides over seeded defaults', () => {
    const hass = createMockHass({
      'light.living_lamp': { state: 'off' },
    });
    expect(hass.states['light.living_lamp'].state).toBe('off');
    // unrelated seeded entities still present
    expect(hass.states['light.kitchen_ceiling'].state).toBe('on');
  });
});

describe('setSunForTimeOfDay', () => {
  it('night: sun below horizon', () => {
    const hass = createMockHass();
    setSunForTimeOfDay(hass, 'night');
    expect(hass.states['sun.sun'].state).toBe('below_horizon');
  });

  it('day: sun above horizon and not within the dusk/dawn window', () => {
    const hass = createMockHass();
    setSunForTimeOfDay(hass, 'day');
    expect(hass.states['sun.sun'].state).toBe('above_horizon');
    const now = Date.now();
    const rising = new Date(
      hass.states['sun.sun'].attributes.next_rising,
    ).getTime();
    const setting = new Date(
      hass.states['sun.sun'].attributes.next_setting,
    ).getTime();
    // next sunrise is far in the future, next sunset is > 60min away
    expect(rising - now).toBeGreaterThan(60 * 60_000);
    expect(setting - now).toBeGreaterThan(60 * 60_000);
  });

  it('duskDawn: next sunrise within the 60min default window', () => {
    const hass = createMockHass();
    setSunForTimeOfDay(hass, 'duskDawn');
    const now = Date.now();
    const rising = new Date(
      hass.states['sun.sun'].attributes.next_rising,
    ).getTime();
    expect(Math.abs(rising - now)).toBeLessThanOrEqual(60 * 60_000);
  });
});
