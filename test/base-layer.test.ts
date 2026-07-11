// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { render } from 'lit';
import type { ImagesConfig, CardOptions } from '../src/core/config';
import type { HassEntity } from '../src/core/ha-types';
import {
  resolveTimeOfDay,
  baseImageSrc,
  derivedFilter,
  renderBaseLayer,
} from '../src/render/base-layer';

function opts(over: Partial<CardOptions> = {}): CardOptions {
  return {
    view: 'auto',
    lightStyle: 'lit',
    freePanZoom: true,
    zoomMax: 1.5,
    duskDawnOffsetMinutes: 60,
    labels: { source: 'none', visibility: 'auto', densityCap: 14 },
      iconSize: 44,
      iconSizeMax: 88,
    aspectMobile: 1,
    interaction: { wheel: 'modifier', doubleTapZoom: true, roomSwipe: true, inertia: true },
    idleTimeout: 0,
    ...over,
  };
}
// Sun whose next sunrise is 07:00 and next sunset is 19:00 (on `day`).
function sunAt(rising: string, setting: string): HassEntity {
  return {
    entity_id: 'sun.sun',
    state: 'above_horizon',
    attributes: { next_rising: rising, next_setting: setting },
  };
}
const day = '2026-06-25';

describe('resolveTimeOfDay forced views', () => {
  it('view=day ignores sun', () =>
    expect(resolveTimeOfDay(opts({ view: 'day' }), undefined)).toBe('day'));
  it('view=night ignores sun', () =>
    expect(resolveTimeOfDay(opts({ view: 'night' }), undefined)).toBe('night'));
  it('view=duskDawn ignores sun', () =>
    expect(resolveTimeOfDay(opts({ view: 'duskDawn' }), undefined)).toBe('duskDawn'));
});

describe('resolveTimeOfDay auto', () => {
  const sun = sunAt(`${day}T07:00:00`, `${day}T19:00:00`);
  it('midday -> day', () =>
    expect(resolveTimeOfDay(opts(), sun, new Date(`${day}T12:00:00`))).toBe('day'));
  it('deep night -> night', () =>
    expect(resolveTimeOfDay(opts(), sun, new Date(`${day}T03:00:00`))).toBe('night'));
  it('just after midnight -> night', () =>
    expect(resolveTimeOfDay(opts(), sun, new Date(`${day}T23:30:00`))).toBe('night'));
  it('within +/-60min of sunrise -> duskDawn', () =>
    expect(resolveTimeOfDay(opts(), sun, new Date(`${day}T06:30:00`))).toBe('duskDawn'));
  it('within +/-60min of sunset -> duskDawn', () =>
    expect(resolveTimeOfDay(opts(), sun, new Date(`${day}T19:30:00`))).toBe('duskDawn'));
  it('custom offset narrows the window (15min): 06:30 is night', () =>
    expect(
      resolveTimeOfDay(opts({ duskDawnOffsetMinutes: 15 }), sun, new Date(`${day}T06:30:00`)),
    ).toBe('night'));
  it('no sun entity -> day', () =>
    expect(resolveTimeOfDay(opts(), undefined, new Date(`${day}T03:00:00`))).toBe('day'));
  it('does NOT mutate the passed sun entity dates', () => {
    const s = sunAt(`${day}T07:00:00`, `${day}T19:00:00`);
    resolveTimeOfDay(opts(), s, new Date(`${day}T12:00:00`));
    expect(s.attributes.next_rising).toBe(`${day}T07:00:00`);
    expect(s.attributes.next_setting).toBe(`${day}T19:00:00`);
  });
});

describe('baseImageSrc', () => {
  const imgs: ImagesConfig = {
    base: '/b.png',
    night: '/n.png',
    duskDawn: '/dd.png',
  };
  it('day always uses base, not derived', () =>
    expect(baseImageSrc(imgs, 'day')).toEqual({ src: '/b.png', derived: false }));
  it('night uses explicit night image', () =>
    expect(baseImageSrc(imgs, 'night')).toEqual({ src: '/n.png', derived: false }));
  it('duskDawn uses explicit dusk image', () =>
    expect(baseImageSrc(imgs, 'duskDawn')).toEqual({ src: '/dd.png', derived: false }));
  it('falls back to derived base when night image absent', () =>
    expect(baseImageSrc({ base: '/b.png' }, 'night')).toEqual({
      src: '/b.png',
      derived: true,
    }));
});

describe('derivedFilter', () => {
  it('day -> empty', () => expect(derivedFilter('day')).toBe(''));
  it('night filter', () =>
    expect(derivedFilter('night')).toBe('brightness(0.4) saturate(0.9)'));
  it('duskDawn filter', () =>
    expect(derivedFilter('duskDawn')).toBe(
      'brightness(0.75) saturate(1.1) hue-rotate(20deg) sepia(0.15)',
    ));
});

describe('renderBaseLayer', () => {
  it('renders an img with the resolved src and applies derived filter when derived', () => {
    const host = document.createElement('div');
    const sun = sunAt(`${day}T07:00:00`, `${day}T19:00:00`);
    // Force night via forced view; base-only images -> derived.
    render(
      renderBaseLayer({ base: '/b.png' }, opts({ view: 'night' }), sun, new Date(`${day}T12:00:00`)),
      host,
    );
    const img = host.querySelector('img.base-image') as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(img.getAttribute('src')).toBe('/b.png');
    expect(img.style.filter).toBe('brightness(0.4) saturate(0.9)');
  });

  it('no filter when explicit night image provided', () => {
    const host = document.createElement('div');
    render(renderBaseLayer({ base: '/b.png', night: '/n.png' }, opts({ view: 'night' }), undefined), host);
    const img = host.querySelector('img.base-image') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('/n.png');
    expect(img.style.filter).toBe('');
  });
});

import { weatherTint } from '../src/render/base-layer';

describe('weatherTint', () => {
  const w = (state: string) => ({ entity_id: 'weather.home', state, attributes: {} });
  it('returns a tint for known conditions, null otherwise', () => {
    expect(weatherTint(w('rainy'))).toMatch(/rgba/);
    expect(weatherTint(w('sunny'))).toMatch(/rgba/);
    expect(weatherTint(w('snowy'))).toMatch(/rgba/);
    expect(weatherTint(w('totally-unknown'))).toBeNull();
    expect(weatherTint(undefined)).toBeNull();
  });
});
