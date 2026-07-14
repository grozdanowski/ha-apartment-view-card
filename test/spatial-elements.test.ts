import { describe, expect, it } from 'vitest';
import { createSpatialPrimitive, elementPrimitivesForType, resolveSpatialValue } from '../src/core/spatial-elements';

describe('spatial Elements', () => {
  it('uses one shared light-emission model and a neutral custom part', () => {
    const ceiling = elementPrimitivesForType('ceiling-light')[0];
    const bulb = elementPrimitivesForType('light-bulb')[0];
    expect(ceiling).toMatchObject({
      id: 'emission',
      kind: 'sphere',
      size: { x: 0.1, y: 0.1, z: 0.1 },
      luminosity: { base: 0, rules: [{ compare: 'on', value: 1 }] },
    });
    expect(bulb).toEqual(ceiling);
    expect(elementPrimitivesForType('custom')).toEqual([expect.objectContaining({ kind: 'cube' })]);
    expect(elementPrimitivesForType('glb')).toEqual([]);
    expect(createSpatialPrimitive('soft', 'cube').bevel).toBeGreaterThan(0);
  });

  it('resolves primary-state and attribute rules in order', () => {
    const states = {
      'fan.purifier': {
        entity_id: 'fan.purifier',
        state: 'on',
        attributes: { percentage: 72 },
        last_changed: '',
        last_updated: '',
        context: { id: '', parent_id: null, user_id: null },
      },
    };
    expect(resolveSpatialValue({
      base: 0,
      rules: [
        { operator: 'equals', compare: 'on', value: 0.2 },
        { attribute: 'percentage', operator: 'above', compare: 50, value: 0.75 },
      ],
    }, states, 'fan.purifier')).toBe(0.75);
  });

  it('supports a rule-specific entity without a parent entity binding', () => {
    const states = {
      'sensor.mode': {
        entity_id: 'sensor.mode', state: 'movie', attributes: {},
        last_changed: '', last_updated: '', context: { id: '', parent_id: null, user_id: null },
      },
    };
    expect(resolveSpatialValue({
      base: '#101010',
      rules: [{ entityId: 'sensor.mode', operator: 'equals', compare: 'movie', value: '#ffffff' }],
    }, states)).toBe('#ffffff');
  });
});
