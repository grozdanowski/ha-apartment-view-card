// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { render } from 'lit';
import { effectKind, effectModel, renderEffect } from '../src/render/effect-layer';
import type { HassEntity } from '../src/core/ha-types';
import type { EntityConfig } from '../src/core/config';

function ent(entity_id: string, state: string, attrs: Record<string, unknown> = {}): HassEntity {
  return {
    entity_id,
    state,
    attributes: attrs,
  };
}
function cfg(partial: Partial<EntityConfig>): EntityConfig {
  return { entity: 'x', x: 50, y: 50, size: 'small', tap: 'toggle', orientation: null, ...partial };
}

describe('effectKind', () => {
  it('tv-cone for tv media_player', () => {
    expect(effectKind(ent('media_player.tv', 'playing', { device_class: 'tv' }))).toBe('tv-cone');
  });
  it('speaker-radar for audio media_player', () => {
    expect(effectKind(ent('media_player.spk', 'playing', { media_content_type: 'music' }))).toBe('speaker-radar');
  });
  it('ac-radar for climate', () => {
    expect(effectKind(ent('climate.ac', 'cool'))).toBe('ac-radar');
  });
  it('none for lights', () => {
    expect(effectKind(ent('light.k', 'on'))).toBe('none');
  });
});

describe('effectModel', () => {
  it('TV directional + playing => shown, weak blue, cone (no arcs)', () => {
    const m = effectModel(ent('media_player.tv', 'playing', { device_class: 'tv' }), cfg({ orientation: 0 }));
    expect(m.kind).toBe('tv-cone');
    expect(m.show).toBe(true);
    expect(m.color).toBe('rgba(95, 165, 255, 0.5)');
    expect(m.orientation).toBe(0);
    expect(m.arcCount).toBe(0);
  });
  it('TV omni (no orientation) => suppressed (no beam direction)', () => {
    const m = effectModel(ent('media_player.tv', 'playing', { device_class: 'tv' }), cfg({ orientation: null }));
    expect(m.kind).toBe('tv-cone');
    expect(m.show).toBe(false);
  });
  it('TV off => hidden', () => {
    const m = effectModel(ent('media_player.tv', 'off', { device_class: 'tv' }), cfg({ orientation: 0 }));
    expect(m.show).toBe(false);
  });
  it('speaker playing omni => full rings, neutral white, 5 arcs', () => {
    const m = effectModel(ent('media_player.spk', 'playing', { media_content_type: 'music' }), cfg({ orientation: null }));
    expect(m.kind).toBe('speaker-radar');
    expect(m.show).toBe(true);
    expect(m.color).toBe('rgb(255, 255, 255)');
    expect(m.orientation).toBeNull();
    expect(m.arcCount).toBe(5);
  });
  it('speaker idle => hidden', () => {
    const m = effectModel(ent('media_player.spk', 'idle', { media_content_type: 'music' }), cfg({ orientation: null }));
    expect(m.show).toBe(false);
  });
  it('AC cooling directional => shown, blue, cone, 5 arcs', () => {
    const m = effectModel(ent('climate.ac', 'cool', { hvac_action: 'cooling' }), cfg({ orientation: 270 }));
    expect(m.kind).toBe('ac-radar');
    expect(m.show).toBe(true);
    expect(m.color).toBe('rgb(95, 165, 255)');
    expect(m.orientation).toBe(270);
    expect(m.arcCount).toBe(5);
  });
  it('AC off => hidden', () => {
    const m = effectModel(ent('climate.ac', 'off'), cfg({ orientation: 270 }));
    expect(m.show).toBe(false);
  });
  it('light => none, never shown', () => {
    const m = effectModel(ent('light.k', 'on'), cfg({ orientation: 90 }));
    expect(m.kind).toBe('none');
    expect(m.show).toBe(false);
    expect(m.arcCount).toBe(0);
  });
});

describe('renderEffect', () => {
  function mount(template: ReturnType<typeof renderEffect>): HTMLElement {
    const host = document.createElement('div');
    render(template, host);
    return host;
  }

  it('renderEffect(undefined, ...) => nothing (no DOM output)', () => {
    const host = mount(renderEffect(undefined, cfg({}), 1000));
    // Lit `nothing` renders as an empty comment node — no element children
    expect(host.children.length).toBe(0);
  });

  it('TV inactive => nothing rendered', () => {
    const host = mount(renderEffect(ent('media_player.tv', 'off', { device_class: 'tv' }), cfg({ orientation: 90 }), 1000));
    expect(host.children.length).toBe(0);
  });

  it('TV omni (no orientation) => nothing rendered', () => {
    const host = mount(renderEffect(ent('media_player.tv', 'playing', { device_class: 'tv' }), cfg({ orientation: null }), 1000));
    expect(host.children.length).toBe(0);
  });

  it('TV active + directional => renders a beam div', () => {
    const host = mount(renderEffect(ent('media_player.tv', 'playing', { device_class: 'tv' }), cfg({ orientation: 90 }), 1000));
    const beam = host.querySelector('.effect-beam');
    expect(beam).toBeTruthy();
  });

  it('TV beam renders keyframes style', () => {
    const host = mount(renderEffect(ent('media_player.tv', 'playing', { device_class: 'tv' }), cfg({ orientation: 90 }), 1000));
    const style = host.querySelector('style');
    expect(style?.textContent).toContain('tv-pulse');
  });

  it('speaker active omni => renders arc elements (5 arcs)', () => {
    const host = mount(renderEffect(ent('media_player.spk', 'playing', { media_content_type: 'music' }), cfg({ orientation: null }), 1000));
    const arcs = host.querySelectorAll('.effect-arc');
    expect(arcs.length).toBe(5);
  });

  it('speaker radar renders keyframes style', () => {
    const host = mount(renderEffect(ent('media_player.spk', 'playing', { media_content_type: 'music' }), cfg({ orientation: null }), 1000));
    const style = host.querySelector('style');
    expect(style?.textContent).toContain('radar-ripple');
  });

  it('AC active => renders arc elements (5 arcs)', () => {
    const host = mount(renderEffect(ent('climate.ac', 'cool', { hvac_action: 'cooling' }), cfg({ orientation: null }), 1000));
    const arcs = host.querySelectorAll('.effect-arc');
    expect(arcs.length).toBe(5);
  });

  it('light => nothing rendered', () => {
    const host = mount(renderEffect(ent('light.k', 'on'), cfg({ orientation: 90 }), 1000));
    expect(host.children.length).toBe(0);
  });
});
