// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { render, nothing } from 'lit';
import { renderEffect, EFFECT_STYLES } from '../src/render/effect-layer';
import type { HassEntity } from '../src/core/ha-types';
import type { EntityConfig } from '../src/core/config';

function ent(entity_id: string, state: string, attrs: Record<string, unknown> = {}): HassEntity {
  return {
    entity_id, state, attributes: attrs,
  };
}
function cfg(partial: Partial<EntityConfig>): EntityConfig {
  return { entity: 'x', x: 30, y: 40, size: 'small', tap: 'toggle', orientation: null, ...partial };
}
function mount(tpl: unknown): HTMLDivElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  render(tpl as Parameters<typeof render>[0], host);
  return host;
}

describe('EFFECT_STYLES', () => {
  it('bundles both keyframe sets and a 0.3s opacity transition', () => {
    expect(EFFECT_STYLES).toContain('@keyframes tv-pulse');
    expect(EFFECT_STYLES).toContain('@keyframes radar-ripple');
    expect(EFFECT_STYLES).toContain('transition: opacity 0.3s');
  });
});

describe('renderEffect', () => {
  it('returns nothing for a hidden effect (TV off)', () => {
    expect(renderEffect(ent('media_player.tv', 'off', { device_class: 'tv' }), cfg({ orientation: 0 }), 1000)).toBe(nothing);
  });
  it('returns nothing for a light', () => {
    expect(renderEffect(ent('light.k', 'on'), cfg({ orientation: 0 }), 1000)).toBe(nothing);
  });
  it('renders a single device-beam div for an active directional TV', () => {
    const host = mount(renderEffect(ent('media_player.tv', 'playing', { device_class: 'tv' }), cfg({ orientation: 0 }), 1000));
    expect(host.querySelectorAll('.device-beam').length).toBe(1);
    expect(host.querySelectorAll('.radar-arc').length).toBe(0);
    const overlay = host.querySelector('.effect-overlay') as HTMLElement;
    expect(overlay.style.left).toBe('30%');
    expect(overlay.style.top).toBe('40%');
  });
  it('renders 5 radar-arc divs for an active speaker', () => {
    const host = mount(renderEffect(ent('media_player.spk', 'playing', { media_content_type: 'music' }), cfg({ orientation: null }), 1000));
    expect(host.querySelectorAll('.radar-arc').length).toBe(5);
  });
  it('renders 5 radar-arc divs for an active AC and tints them blue when cooling', () => {
    const host = mount(renderEffect(ent('climate.ac', 'cool', { hvac_action: 'cooling' }), cfg({ orientation: 90 }), 1000));
    const arcs = host.querySelectorAll('.radar-arc');
    expect(arcs.length).toBe(5);
    // border color carried through (browser normalizes rgb spacing)
    expect((arcs[0] as HTMLElement).style.borderColor).toBe('rgb(95, 165, 255)');
  });
});
