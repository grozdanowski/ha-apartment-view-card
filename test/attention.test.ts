import { describe, it, expect } from 'vitest';
import { attentionFor } from '../src/core/attention';
import type { HassEntity } from '../src/core/ha-types';

const ent = (entity_id: string, state: string, attributes: Record<string, any> = {}): HassEntity => ({ entity_id, state, attributes });

describe('attentionFor', () => {
  it('offline for missing / unavailable / unknown', () => {
    expect(attentionFor(undefined)).toMatchObject({ kind: 'offline' });
    expect(attentionFor(ent('light.x', 'unavailable'))).toMatchObject({ kind: 'offline' });
    expect(attentionFor(ent('sensor.x', 'unknown'))).toMatchObject({ kind: 'offline' });
  });

  it('open door/window binary_sensor when on; silent when off', () => {
    expect(attentionFor(ent('binary_sensor.door', 'on', { device_class: 'door' }))).toMatchObject({ kind: 'open', severity: 'warning' });
    expect(attentionFor(ent('binary_sensor.win', 'on', { device_class: 'window' }))).toMatchObject({ kind: 'open' });
    expect(attentionFor(ent('binary_sensor.door', 'off', { device_class: 'door' }))).toBeNull();
  });

  it('leak + smoke are critical', () => {
    expect(attentionFor(ent('binary_sensor.leak', 'on', { device_class: 'moisture' }))).toMatchObject({ kind: 'leak', severity: 'critical' });
    expect(attentionFor(ent('binary_sensor.smoke', 'on', { device_class: 'smoke' }))).toMatchObject({ kind: 'smoke', severity: 'critical' });
    expect(attentionFor(ent('binary_sensor.co', 'on', { device_class: 'carbon_monoxide' }))).toMatchObject({ kind: 'smoke' });
  });

  it('unlocked lock; silent when locked', () => {
    expect(attentionFor(ent('lock.front', 'unlocked'))).toMatchObject({ kind: 'unlocked' });
    expect(attentionFor(ent('lock.front', 'locked'))).toBeNull();
  });

  it('low battery across domains; silent above threshold', () => {
    expect(attentionFor(ent('sensor.bat', '12', { device_class: 'battery' }))).toMatchObject({ kind: 'battery' });
    expect(attentionFor(ent('device_tracker.phone', 'home', { battery_level: 8 }))).toMatchObject({ kind: 'battery' });
    expect(attentionFor(ent('sensor.bat', '80', { device_class: 'battery' }))).toBeNull();
    expect(attentionFor(ent('binary_sensor.lb', 'on', { device_class: 'battery' }))).toMatchObject({ kind: 'battery' });
  });

  it('problem binary_sensor; generic on-states are silent', () => {
    expect(attentionFor(ent('binary_sensor.p', 'on', { device_class: 'problem' }))).toMatchObject({ kind: 'problem' });
    expect(attentionFor(ent('binary_sensor.motion', 'on', { device_class: 'motion' }))).toBeNull();
    expect(attentionFor(ent('light.x', 'on'))).toBeNull();
  });
});
