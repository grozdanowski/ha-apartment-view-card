import { html, type TemplateResult } from 'lit';
import { styleMap } from 'lit/directives/style-map.js';
import type { ImagesConfig, CardOptions } from '../core/config';
import type { HassEntity } from '../core/ha-types';

export type TimeOfDay = 'day' | 'night' | 'duskDawn';

const MIN = 60_000;

// Returns a NEW Date anchored to `ref`'s calendar day at `src`'s time-of-day.
// Never mutates `src` (v1 bug: _getDayState mutated parsed sun.sun dates).
function anchorToDay(src: Date, ref: Date): Date {
  const d = new Date(src.getTime());
  d.setFullYear(ref.getFullYear(), ref.getMonth(), ref.getDate());
  return d;
}

export function resolveTimeOfDay(
  options: CardOptions,
  sun: HassEntity | undefined,
  now: Date = new Date(),
): TimeOfDay {
  if (options.view !== 'auto') {
    return options.view;
  }
  const rising = sun?.attributes?.next_rising;
  const setting = sun?.attributes?.next_setting;
  if (!rising || !setting) {
    return 'day';
  }

  const sunrise = anchorToDay(new Date(rising), now);
  const sunset = anchorToDay(new Date(setting), now);
  const offset = (options.duskDawnOffsetMinutes ?? 60) * MIN;

  const t = now.getTime();
  if (
    Math.abs(t - sunrise.getTime()) <= offset ||
    Math.abs(t - sunset.getTime()) <= offset
  ) {
    return 'duskDawn';
  }
  if (t < sunrise.getTime() || t > sunset.getTime()) {
    return 'night';
  }
  return 'day';
}

export function baseImageSrc(
  images: ImagesConfig,
  tod: TimeOfDay,
): { src: string; derived: boolean } {
  if (tod === 'night' && images.night) {
    return { src: images.night, derived: false };
  }
  if (tod === 'duskDawn' && images.duskDawn) {
    return { src: images.duskDawn, derived: false };
  }
  // day always uses base; night/duskDawn fall through to derived base.
  return { src: images.base, derived: tod !== 'day' };
}

export function derivedFilter(tod: TimeOfDay): string {
  if (tod === 'night') return 'brightness(0.4) saturate(0.9)';
  if (tod === 'duskDawn') {
    return 'brightness(0.75) saturate(1.1) hue-rotate(20deg) sepia(0.15)';
  }
  return '';
}

export function renderBaseLayer(
  images: ImagesConfig,
  options: CardOptions,
  sun: HassEntity | undefined,
  now?: Date,
): TemplateResult {
  const tod = resolveTimeOfDay(options, sun, now);
  const { src, derived } = baseImageSrc(images, tod);
  const filter = derived ? derivedFilter(tod) : '';
  return html`<img
    class="base-image"
    src=${src}
    alt="Apartment base render"
    style=${styleMap({ filter })}
  />`;
}
