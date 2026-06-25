import { describe, it, expect } from 'vitest';
import type { HassEntity } from '../src/core/ha-types';
import {
  resolveLightColor,
  kelvinToRgb,
  hsToRgb,
  xyToRgb,
  rgbCss,
  type Rgb,
} from '../src/core/light-color';

function light(attributes: Record<string, any>, state = 'on'): HassEntity {
  return { entity_id: 'light.test', state, attributes };
}
function near(c: Rgb, r: number, g: number, b: number, tol = 4) {
  expect(Math.abs(c.r - r)).toBeLessThanOrEqual(tol);
  expect(Math.abs(c.g - g)).toBeLessThanOrEqual(tol);
  expect(Math.abs(c.b - b)).toBeLessThanOrEqual(tol);
}

describe('rgbCss', () => {
  it('formats as rgb(r, g, b)', () => {
    expect(rgbCss({ r: 1, g: 2, b: 3 })).toBe('rgb(1, 2, 3)');
  });
  it('rounds and clamps channels to 0..255', () => {
    expect(rgbCss({ r: -5, g: 127.6, b: 300 })).toBe('rgb(0, 128, 255)');
  });
});

describe('kelvinToRgb (Tanner-Helland)', () => {
  it('6600K is essentially white', () => {
    near(kelvinToRgb(6600), 255, 255, 255, 6);
  });
  it('warm 2700K is reddish-orange (r=255, g<r, b<g)', () => {
    const c = kelvinToRgb(2700);
    expect(c.r).toBe(255);
    expect(c.g).toBeLessThan(c.r);
    expect(c.b).toBeLessThan(c.g);
  });
  it('cool 10000K leans blue (b >= r)', () => {
    const c = kelvinToRgb(10000);
    expect(c.b).toBeGreaterThanOrEqual(c.r);
  });
  it('clamps channels into 0..255', () => {
    const c = kelvinToRgb(1000);
    for (const v of [c.r, c.g, c.b]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(255);
    }
  });
});

describe('hsToRgb', () => {
  it('red at h=0 s=100', () => near(hsToRgb(0, 100), 255, 0, 0));
  it('green at h=120 s=100', () => near(hsToRgb(120, 100), 0, 255, 0));
  it('blue at h=240 s=100', () => near(hsToRgb(240, 100), 0, 0, 255));
  it('s=0 is white regardless of hue', () => near(hsToRgb(200, 0), 255, 255, 255));
});

describe('xyToRgb', () => {
  it('D65 white point (0.3127, 0.3290) is near-white', () => {
    const c = xyToRgb(0.3127, 0.329);
    expect(c.r).toBeGreaterThan(230);
    expect(c.g).toBeGreaterThan(230);
    expect(c.b).toBeGreaterThan(230);
  });
  it('deep red primary skews red', () => {
    const c = xyToRgb(0.675, 0.322);
    expect(c.r).toBeGreaterThan(c.g);
    expect(c.r).toBeGreaterThan(c.b);
  });
});

describe('resolveLightColor priority', () => {
  it('rgb_color wins', () => {
    near(resolveLightColor(light({ rgb_color: [10, 20, 30] })), 10, 20, 30, 0);
  });
  it('rgbw_color uses RGB channels (ignores white)', () => {
    near(resolveLightColor(light({ rgbw_color: [10, 20, 30, 200] })), 10, 20, 30, 0);
  });
  it('rgbww_color uses RGB channels (ignores cw/ww)', () => {
    near(resolveLightColor(light({ rgbww_color: [10, 20, 30, 100, 150] })), 10, 20, 30, 0);
  });
  it('rgb_color takes precedence over rgbw_color', () => {
    near(resolveLightColor(light({ rgb_color: [1, 2, 3], rgbw_color: [9, 9, 9, 9] })), 1, 2, 3, 0);
  });
  it('hs_color used when no rgb present', () => {
    near(resolveLightColor(light({ hs_color: [0, 100] })), 255, 0, 0);
  });
  it('xy_color used when no rgb/hs present', () => {
    const c = resolveLightColor(light({ xy_color: [0.675, 0.322] }));
    expect(c.r).toBeGreaterThan(c.g);
    expect(c.r).toBeGreaterThan(c.b);
  });
  it('color_temp_kelvin used when no rgb/hs/xy', () => {
    near(resolveLightColor(light({ color_temp_kelvin: 6600 })), 255, 255, 255, 6);
  });
  it('color_temp (mireds) converted via 1e6/mireds', () => {
    // 370 mireds -> ~2703K -> warm; r=255, b<g
    const c = resolveLightColor(light({ color_temp: 370 }));
    expect(c.r).toBe(255);
    expect(c.b).toBeLessThan(c.g);
  });
  it('falls back to warm-white #fffae6 when no color attrs', () => {
    near(resolveLightColor(light({})), 255, 250, 230, 0);
  });
  it('ignores malformed rgb_color (not length-3 array) and falls through', () => {
    near(resolveLightColor(light({ rgb_color: [1, 2] })), 255, 250, 230, 0);
  });
});
