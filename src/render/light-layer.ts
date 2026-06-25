import { html, type TemplateResult } from 'lit';
import { styleMap } from 'lit/directives/style-map.js';
import type {
  EntityConfig,
  CardOptions,
  LightStyle,
  ImagesConfig,
} from '../core/config';
import type { HassEntity } from '../core/ha-types';
import { resolveLightColor, rgbCss } from '../core/light-color';
import { isActive, intensity } from '../core/entity-state';
import { haloRadiusPx } from '../core/geometry';

const FADE = 'opacity 0.3s ease, filter 0.3s ease';

export function radialMask(xPct: number, yPct: number, radiusPx: number): string {
  return `radial-gradient(circle ${radiusPx}px at ${xPct}% ${yPct}%, black 0%, rgba(0,0,0,0.55) 40%, transparent 100%)`;
}

export function effectiveLightStyle(
  cfg: EntityConfig,
  options: CardOptions,
): LightStyle {
  return cfg.lightStyle ?? options.lightStyle;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

export function renderLight(
  state: HassEntity | undefined,
  cfg: EntityConfig,
  options: CardOptions,
  images: ImagesConfig,
  cardWidth: number,
): TemplateResult {
  const on = !!state && isActive(state);
  const b = state ? intensity(state) : 0;
  const style = effectiveLightStyle(cfg, options);
  const color = state ? rgbCss(resolveLightColor(state)) : 'rgb(255, 250, 230)';

  // Halo grows with brightness; when off keep the last tier radius (b=0 -> base*0.45)
  // but the whole overlay fades to 0 opacity anyway.
  const radius = haloRadiusPx(cardWidth, cfg.size, b);
  const mask = radialMask(cfg.x, cfg.y, radius);

  const overlayStyle = {
    position: 'absolute',
    inset: '0',
    opacity: on ? '1' : '0',
    transition: FADE,
    'pointer-events': 'none',
    'mask-image': mask,
    '-webkit-mask-image': mask,
  };

  let inner: TemplateResult;
  if (style === 'lit') {
    const imgOpacity = clamp01(0.4 + 0.4 * b);
    const tintOpacity = clamp01(0.55 + 0.3 * b);
    inner = html`
      <img
        src=${images.base}
        alt=""
        style=${styleMap({
          position: 'absolute',
          inset: '0',
          width: '100%',
          height: '100%',
          'object-fit': 'contain',
          filter: 'brightness(1.08) saturate(1.12) contrast(0.97)',
          opacity: String(imgOpacity),
          transition: FADE,
        })}
      />
      <div
        class="tint"
        style=${styleMap({
          position: 'absolute',
          inset: '0',
          'background-color': color,
          'mix-blend-mode': 'soft-light',
          opacity: String(tintOpacity),
          transition: FADE,
        })}
      ></div>
    `;
  } else if (style === 'glow') {
    const tintOpacity = clamp01(0.4 + 0.55 * b);
    inner = html`
      <div
        class="tint"
        style=${styleMap({
          position: 'absolute',
          inset: '0',
          'background-color': color,
          'mix-blend-mode': 'screen',
          opacity: String(tintOpacity),
          transition: FADE,
        })}
      ></div>
    `;
  } else {
    // reveal: baked all-lights render, opacity = brightness, tint multiply (default).
    const revealSrc = images.allLights ?? images.base;
    inner = html`
      <img
        src=${revealSrc}
        alt=""
        style=${styleMap({
          position: 'absolute',
          inset: '0',
          width: '100%',
          height: '100%',
          'object-fit': 'contain',
          opacity: String(clamp01(b)),
          transition: FADE,
        })}
      />
      <div
        class="tint"
        style=${styleMap({
          position: 'absolute',
          inset: '0',
          'background-color': color,
          'mix-blend-mode': 'multiply',
          opacity: String(clamp01(b)),
          transition: FADE,
        })}
      ></div>
    `;
  }

  return html`<div
    class="light-overlay"
    data-light=${cfg.entity}
    style=${styleMap(overlayStyle)}
  >
    ${inner}
  </div>`;
}

export function renderLightLayer(
  hass: { states: Record<string, HassEntity> } | undefined,
  entities: EntityConfig[],
  options: CardOptions,
  images: ImagesConfig,
  cardWidth: number,
): TemplateResult {
  return html`<div
    class="light-layer"
    style=${styleMap({
      position: 'absolute',
      inset: '0',
      'pointer-events': 'none',
    })}
  >
    ${entities.map((cfg) =>
      renderLight(hass?.states?.[cfg.entity], cfg, options, images, cardWidth),
    )}
  </div>`;
}
