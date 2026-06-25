import type { HassEntity } from './ha-types';

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

function clamp255(v: number): number {
  return Math.max(0, Math.min(255, v));
}

export function rgbCss(c: Rgb): string {
  return `rgb(${Math.round(clamp255(c.r))}, ${Math.round(
    clamp255(c.g),
  )}, ${Math.round(clamp255(c.b))})`;
}

// Tanner-Helland kelvin -> RGB approximation.
// Reference: http://www.tannerhelland.com/4435/convert-temperature-rgb-algorithm-code/
export function kelvinToRgb(kelvin: number): Rgb {
  const temp = kelvin / 100;
  let r: number;
  let g: number;
  let b: number;

  if (temp <= 66) {
    r = 255;
  } else {
    r = 329.698727446 * Math.pow(temp - 60, -0.1332047592);
  }

  if (temp <= 66) {
    g = 99.4708025861 * Math.log(temp) - 161.1195681661;
  } else {
    g = 288.1221695283 * Math.pow(temp - 60, -0.0755148492);
  }

  if (temp >= 66) {
    b = 255;
  } else if (temp <= 19) {
    b = 0;
  } else {
    b = 138.5177312231 * Math.log(temp - 10) - 305.0447927307;
  }

  return { r: clamp255(r), g: clamp255(g), b: clamp255(b) };
}

// HA hs_color: hue 0..360, saturation 0..100.
export function hsToRgb(h: number, s: number): Rgb {
  const sat = s / 100;
  const hue = ((h % 360) + 360) % 360;
  const c = sat; // value (brightness) fixed at 1 — brightness maps to opacity, not color
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = 1 - c;
  let r = 0;
  let g = 0;
  let b = 0;
  if (hue < 60) {
    r = c;
    g = x;
  } else if (hue < 120) {
    r = x;
    g = c;
  } else if (hue < 180) {
    g = c;
    b = x;
  } else if (hue < 240) {
    g = x;
    b = c;
  } else if (hue < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }
  return {
    r: clamp255((r + m) * 255),
    g: clamp255((g + m) * 255),
    b: clamp255((b + m) * 255),
  };
}

// CIE 1931 xy -> sRGB (Y fixed at 1; result normalized so max channel = 255).
export function xyToRgb(x: number, y: number): Rgb {
  const yLum = 1;
  const safeY = y === 0 ? 1e-6 : y;
  const X = (yLum / safeY) * x;
  const Z = (yLum / safeY) * (1 - x - y);

  // Wide RGB D65 conversion matrix.
  let r = X * 1.656492 - yLum * 0.354851 - Z * 0.255038;
  let g = -X * 0.707196 + yLum * 1.655397 + Z * 0.036152;
  let b = X * 0.051713 - yLum * 0.121364 + Z * 1.01153;

  // Reverse gamma.
  const gamma = (v: number) =>
    v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  r = gamma(r);
  g = gamma(g);
  b = gamma(b);

  // Normalize so the brightest channel is full (preserve hue, drop luminance).
  const max = Math.max(r, g, b, 1e-6);
  r /= max;
  g /= max;
  b /= max;

  return { r: clamp255(r * 255), g: clamp255(g * 255), b: clamp255(b * 255) };
}

function isTriple(v: any): v is number[] {
  return Array.isArray(v) && v.length >= 3 && v.slice(0, 3).every((n) => typeof n === 'number');
}
function isPair(v: any): v is number[] {
  return Array.isArray(v) && v.length >= 2 && typeof v[0] === 'number' && typeof v[1] === 'number';
}

const WARM_WHITE: Rgb = { r: 255, g: 250, b: 230 }; // #fffae6

export function resolveLightColor(state: HassEntity): Rgb {
  const a = state?.attributes ?? {};

  if (isTriple(a.rgb_color)) {
    return { r: a.rgb_color[0], g: a.rgb_color[1], b: a.rgb_color[2] };
  }
  if (isTriple(a.rgbw_color)) {
    return { r: a.rgbw_color[0], g: a.rgbw_color[1], b: a.rgbw_color[2] };
  }
  if (isTriple(a.rgbww_color)) {
    return { r: a.rgbww_color[0], g: a.rgbww_color[1], b: a.rgbww_color[2] };
  }
  if (isPair(a.hs_color)) {
    return hsToRgb(a.hs_color[0], a.hs_color[1]);
  }
  if (isPair(a.xy_color)) {
    return xyToRgb(a.xy_color[0], a.xy_color[1]);
  }
  if (typeof a.color_temp_kelvin === 'number') {
    return kelvinToRgb(a.color_temp_kelvin);
  }
  if (typeof a.color_temp === 'number' && a.color_temp > 0) {
    return kelvinToRgb(1e6 / a.color_temp);
  }
  return { ...WARM_WHITE };
}
