// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import {
  dispatchTapAction,
  dispatchHoldAction,
} from '../src/apartment-view-card';
import type { EntityConfig } from '../src/core/config';

function ent(tap: EntityConfig['tap'], entity = 'light.kitchen'): EntityConfig {
  return { entity, x: 10, y: 10, size: 'small', tap, orientation: null };
}

describe('dispatchTapAction', () => {
  it('tap:toggle fires homeassistant.toggle with the entity id', () => {
    const callService = vi.fn();
    const card = { hass: { callService } } as any;
    const el = document.createElement('div');
    dispatchTapAction(card, ent('toggle'), el);
    expect(callService).toHaveBeenCalledTimes(1);
    expect(callService).toHaveBeenCalledWith('homeassistant', 'toggle', {
      entity_id: 'light.kitchen',
    });
  });

  it('tap:more-info fires hass-more-info with entityId and does NOT call a service', () => {
    const callService = vi.fn();
    const card = { hass: { callService } } as any;
    const el = document.createElement('div');
    document.body.appendChild(el);
    let detail: any;
    el.addEventListener('hass-more-info', (e: any) => {
      detail = e.detail;
    });
    dispatchTapAction(card, ent('more-info'), el);
    expect(detail).toEqual({ entityId: 'light.kitchen' });
    expect(callService).not.toHaveBeenCalled();
    el.remove();
  });

  it('tap:none does nothing', () => {
    const callService = vi.fn();
    const card = { hass: { callService } } as any;
    const el = document.createElement('div');
    let fired = false;
    el.addEventListener('hass-more-info', () => {
      fired = true;
    });
    dispatchTapAction(card, ent('none'), el);
    expect(callService).not.toHaveBeenCalled();
    expect(fired).toBe(false);
  });
});

describe('dispatchHoldAction', () => {
  it('always fires hass-more-info regardless of tap setting', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    let detail: any;
    el.addEventListener('hass-more-info', (e: any) => {
      detail = e.detail;
    });
    dispatchHoldAction(ent('toggle', 'media_player.tv'), el);
    expect(detail).toEqual({ entityId: 'media_player.tv' });
    el.remove();
  });
});
