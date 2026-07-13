import { describe, expect, it } from 'vitest';
import {
  markerIsVisible,
  suggestedOverviewVisibility,
  suggestedTapAction,
  withSuggestedEntityPolicy,
} from '../src/core/entity-policy';
import type { EntityConfig } from '../src/core/config';

const entity = (id: string): EntityConfig => ({
  entity: id,
  x: 50,
  y: 50,
  size: 'small',
  tap: 'toggle',
  orientation: null,
});

describe('entity presentation policy', () => {
  it('uses detail views for informational and safety domains', () => {
    expect(suggestedTapAction('sensor.temperature')).toBe('more-info');
    expect(suggestedTapAction('lock.front_door')).toBe('more-info');
    expect(suggestedTapAction('light.sofa')).toBe('toggle');
  });

  it('keeps calm overviews quiet while preserving active and attention states', () => {
    expect(suggestedOverviewVisibility('light.sofa')).toBe('hidden');
    expect(suggestedOverviewVisibility('media_player.tv')).toBe('active');
    expect(suggestedOverviewVisibility('binary_sensor.leak')).toBe('attention');
  });

  it('applies safe defaults to newly imported devices', () => {
    const result = withSuggestedEntityPolicy(entity('sensor.air_quality'));
    expect(result.tap).toBe('more-info');
    expect(result.overviewVisibility).toBe('attention');
    expect(result.roomVisibility).toBe('attention');
  });

  it('honors explicit visibility overrides before preset defaults', () => {
    const light = { ...entity('light.sofa'), overviewVisibility: 'always' as const };
    const context = { state: undefined, active: false, attention: null, roomFocused: false, selectMode: false };
    expect(markerIsVisible(light, 'calm', context)).toBe(true);
    expect(markerIsVisible({ ...light, overviewVisibility: 'hidden' }, 'control-heavy', { ...context, active: true })).toBe(false);
  });
});
