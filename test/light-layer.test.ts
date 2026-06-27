// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { render } from 'lit';
import type {
  EntityConfig,
  CardOptions,
  ImagesConfig,
} from '../src/core/config';
import type { HassEntity } from '../src/core/ha-types';
import {
  radialMask,
  effectiveLightStyle,
  renderLight,
  renderLightLayer,
} from '../src/render/light-layer';

function opts(over: Partial<CardOptions> = {}): CardOptions {
  return {
    view: 'auto',
    lightStyle: 'lit',
    freePanZoom: true,
    zoomMax: 1.5,
    duskDawnOffsetMinutes: 60,
    labels: { source: 'none', visibility: 'auto', densityCap: 14 },
    ...over,
  };
}
function cfg(over: Partial<EntityConfig> = {}): EntityConfig {
  return {
    entity: 'light.k',
    x: 35,
    y: 16,
    size: 'small',
    tap: 'toggle',
    orientation: null,
    ...over,
  };
}
const images: ImagesConfig = { base: '/b.png', allLights: '/all.png' };

function lightOn(brightness = 255, attrs: Record<string, any> = {}): HassEntity {
  return { entity_id: 'light.k', state: 'on', attributes: { brightness, ...attrs } };
}
function lightOff(): HassEntity {
  return { entity_id: 'light.k', state: 'off', attributes: {} };
}
function firstDiv(t: ReturnType<typeof renderLight>): HTMLElement {
  const host = document.createElement('div');
  render(t, host);
  return host.firstElementChild as HTMLElement;
}

describe('radialMask', () => {
  it('emits the exact CONTRACT gradient', () => {
    expect(radialMask(35, 16, 120)).toBe(
      'radial-gradient(circle 120px at 35% 16%, black 0%, rgba(0,0,0,0.55) 40%, transparent 100%)',
    );
  });
});

describe('effectiveLightStyle', () => {
  it('falls back to global', () =>
    expect(effectiveLightStyle(cfg(), opts({ lightStyle: 'glow' }))).toBe('glow'));
  it('per-entity override wins', () =>
    expect(effectiveLightStyle(cfg({ lightStyle: 'reveal' }), opts({ lightStyle: 'glow' }))).toBe(
      'reveal',
    ));
});

describe('renderLight — fade & off-state', () => {
  it('always sets a 0.3s opacity/filter transition', () => {
    const el = firstDiv(renderLight(lightOn(), cfg(), opts(), images, 1000));
    expect(el.style.transition).toContain('0.3s');
  });
  it('off light renders at opacity 0 (fade target), not removed', () => {
    const el = firstDiv(renderLight(lightOff(), cfg(), opts(), images, 1000));
    expect(el).toBeTruthy();
    expect(parseFloat(el.style.opacity || '0')).toBe(0);
  });
  it('missing state renders at opacity 0', () => {
    const el = firstDiv(renderLight(undefined, cfg(), opts(), images, 1000));
    expect(parseFloat(el.style.opacity || '0')).toBe(0);
  });
});

describe('renderLight — lit style', () => {
  it('inner image has brightness/saturate/contrast filter + opacity 0.4+0.4b', () => {
    const el = firstDiv(renderLight(lightOn(255), cfg(), opts({ lightStyle: 'lit' }), images, 1000));
    const img = el.querySelector('img') as HTMLImageElement;
    expect(img.style.filter).toBe('brightness(1.08) saturate(1.12) contrast(0.97)');
    expect(parseFloat(img.style.opacity)).toBeCloseTo(0.8, 3); // 0.4 + 0.4*1
    const tint = el.querySelector('.tint') as HTMLElement;
    expect(tint.style.mixBlendMode).toBe('soft-light');
    expect(parseFloat(tint.style.opacity)).toBeCloseTo(0.85, 3); // 0.55 + 0.3*1
  });
  it('lit at brightness 0.5: img opacity 0.6, tint opacity 0.7', () => {
    const el = firstDiv(renderLight(lightOn(128), cfg(), opts({ lightStyle: 'lit' }), images, 1000));
    const img = el.querySelector('img') as HTMLImageElement;
    const tint = el.querySelector('.tint') as HTMLElement;
    expect(parseFloat(img.style.opacity)).toBeCloseTo(0.6, 1);
    expect(parseFloat(tint.style.opacity)).toBeCloseTo(0.7, 1);
  });
  it('lit inner image src is the base render', () => {
    const el = firstDiv(renderLight(lightOn(), cfg(), opts({ lightStyle: 'lit' }), images, 1000));
    expect((el.querySelector('img') as HTMLImageElement).getAttribute('src')).toBe('/b.png');
  });
});

describe('renderLight — glow style', () => {
  it('flat color tint, screen blend, opacity 0.4+0.55b, no image', () => {
    const el = firstDiv(
      renderLight(lightOn(255, { rgb_color: [10, 20, 30] }), cfg(), opts({ lightStyle: 'glow' }), images, 1000),
    );
    expect(el.querySelector('img')).toBeNull();
    const tint = el.querySelector('.tint') as HTMLElement;
    expect(tint.style.mixBlendMode).toBe('screen');
    expect(parseFloat(tint.style.opacity)).toBeCloseTo(0.95, 3); // 0.4 + 0.55*1
    expect(tint.style.backgroundColor.replace(/\s/g, '')).toBe('rgb(10,20,30)');
  });
});

describe('renderLight — reveal style', () => {
  it('all-lights image opacity = brightness, tint multiply', () => {
    const el = firstDiv(
      renderLight(lightOn(128), cfg(), opts({ lightStyle: 'reveal' }), images, 1000),
    );
    const img = el.querySelector('img') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('/all.png');
    expect(parseFloat(img.style.opacity)).toBeCloseTo(0.502, 2);
    const tint = el.querySelector('.tint') as HTMLElement;
    expect(tint.style.mixBlendMode).toBe('multiply');
  });
});

describe('renderLight — mask & geometry', () => {
  it('applies a radial mask sized by haloRadiusPx at the light position', () => {
    const el = firstDiv(renderLight(lightOn(255), cfg({ x: 35, y: 16, size: 'small' }), opts(), images, 1000));
    // haloRadiusPx(1000,'small',1) = 0.13*1000*(0.45+0.55) = 130
    const expected = radialMask(35, 16, 130);
    const mask = el.style.getPropertyValue('-webkit-mask-image') || el.style.maskImage;
    expect(mask).toBe(expected);
  });
});

describe('renderLightLayer', () => {
  it('renders one overlay per entity inside a .light-layer container', () => {
    const hass = { states: { 'light.k': lightOn(), 'light.j': { entity_id: 'light.j', state: 'on', attributes: { brightness: 200 } } } };
    const host = document.createElement('div');
    render(
      renderLightLayer(hass, [cfg({ entity: 'light.k' }), cfg({ entity: 'light.j' })], opts(), images, 1000),
      host,
    );
    const layer = host.querySelector('.light-layer') as HTMLElement;
    expect(layer).toBeTruthy();
    expect(layer.querySelectorAll('.light-overlay').length).toBe(2);
  });
});
