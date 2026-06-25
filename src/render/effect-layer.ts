import { html, nothing, type TemplateResult } from 'lit';
import { styleMap } from 'lit/directives/style-map.js';
import type { HassEntity } from '../core/ha-types';
import type { EntityConfig } from '../core/config';
import { isActive } from '../core/entity-state';
import { coneMask } from './light-layer';

/** §4.5 TV detection: media_player carrying video-ish content. */
export function isTvLike(state: HassEntity): boolean {
  const domain = state.entity_id.split('.')[0];
  if (domain !== 'media_player') return false;
  const a = state.attributes as Record<string, unknown>;
  if (a.device_class === 'tv') return true;
  const ct = a.media_content_type;
  return ct === 'video' || ct === 'movie' || ct === 'tvshow';
}

/**
 * §4.4/§4.5 device beam: a colored radial faded to transparent, masked into a
 * 34°/14° feather cone, screen-blended. `colorCss` is any CSS color.
 */
export function deviceConeBeamCss(
  orientation: number,
  colorCss: string,
): Record<string, string> {
  const mask = coneMask(orientation, 34, 14, '50% 50%');
  return {
    background: `radial-gradient(circle at 50% 50%, ${colorCss} 0%, transparent 70%)`,
    'mask-image': mask,
    '-webkit-mask-image': mask,
    'mix-blend-mode': 'screen',
  };
}

/** §4.5 TV cone: weak blue beam + gentle pulse, shown only when on. */
export function tvBeamCss(orientation: number): Record<string, string> {
  return {
    ...deviceConeBeamCss(orientation, 'rgba(95, 165, 255, 0.5)'),
    animation: 'tv-pulse 2.4s ease-in-out infinite',
  };
}

/** Injected into the effect layer's <style>; weak opacity pulse. */
export const TV_PULSE_KEYFRAMES = `@keyframes tv-pulse {
  0% { opacity: 0.35; }
  50% { opacity: 0.55; }
  100% { opacity: 0.35; }
}`;

/** §4.5 number of concentric radar arcs. */
export const RADAR_ARC_COUNT = 5;

/**
 * §4.5 AC tint: blue cooling, red heating, gray unknown.
 * hvac_action ('cooling'/'heating') is authoritative; else infer from state mode.
 * cool/dry -> blue; heat -> red; heat_cool/auto/fan_only/other -> gray.
 *
 * DESIGN NOTE: the contract names only cooling/heating/unknown. Mapping the
 * `dry` (dehumidify) mode to the cooling-blue family is a deliberate v2.0
 * interpretation (dry runs the compressor like cooling), not a contract rule.
 */
export function acRadarColor(state: HassEntity): string {
  const BLUE = 'rgb(95, 165, 255)';
  const RED = 'rgb(255, 95, 95)';
  const GRAY = 'rgb(150, 150, 150)';
  const action = (state.attributes as Record<string, unknown>).hvac_action;
  if (action === 'cooling') return BLUE;
  if (action === 'heating') return RED;
  switch (state.state) {
    case 'cool':
    case 'dry':
      return BLUE;
    case 'heat':
      return RED;
    default:
      return GRAY;
  }
}

/**
 * §4.5 radar arc styles for arc index `arcIndex` (0..RADAR_ARC_COUNT-1).
 * `arc` = the rippling ring (4.5px stroke, 2.4s linear infinite, +480ms/arc stagger).
 * `container` = wrapper, cone-masked when directional, unmasked (full rings) when omni.
 */
export function radarArcsCss(
  arcIndex: number,
  colorCss: string,
  orientation: number | null,
): { container: Record<string, string>; arc: Record<string, string> } {
  const container: Record<string, string> = {};
  if (orientation !== null) {
    const mask = coneMask(orientation, 34, 14, '50% 50%');
    container['mask-image'] = mask;
    container['-webkit-mask-image'] = mask;
  }
  const arc: Record<string, string> = {
    border: `4.5px solid ${colorCss}`,
    animation: 'radar-ripple 2.4s linear infinite',
    'animation-delay': `${arcIndex * 480}ms`,
  };
  return { container, arc };
}

/** Injected into the effect layer's <style>. Grow + opacity pulse 0.3..0.7. */
export const RADAR_KEYFRAMES = `@keyframes radar-ripple {
  0% { transform: translate(-50%, -50%) scale(0); opacity: 0.7; }
  50% { opacity: 0.3; }
  100% { transform: translate(-50%, -50%) scale(1); opacity: 0; }
}`;

// ─── §4.5 Effect dispatch ────────────────────────────────────────────────────

export type EffectKind = 'none' | 'tv-cone' | 'speaker-radar' | 'ac-radar';

/** §4.5 which effect a domain/entity drives. Lights => none (they use the light-layer). */
export function effectKind(state: HassEntity): EffectKind {
  const domain = state.entity_id.split('.')[0];
  if (domain === 'media_player') return isTvLike(state) ? 'tv-cone' : 'speaker-radar';
  if (domain === 'climate') return 'ac-radar';
  return 'none';
}

export interface EffectModel {
  kind: EffectKind;
  show: boolean;
  color: string;
  orientation: number | null;
  arcCount: number;
}

/**
 * §4.5 resolve the full render model for an entity's non-light effect.
 * TV: weak blue cone, suppressed when omni (no direction).
 * Speaker: neutral-white radar, full rings when omni.
 * AC: blue/red/gray radar by hvac mode, full rings when omni.
 */
export function effectModel(state: HassEntity, cfg: EntityConfig): EffectModel {
  const kind = effectKind(state);
  const orientation = cfg.orientation;
  if (kind === 'none') {
    return { kind, show: false, color: '', orientation, arcCount: 0 };
  }
  const active = isActive(state);
  if (kind === 'tv-cone') {
    return {
      kind,
      show: active && orientation !== null,
      color: 'rgba(95, 165, 255, 0.5)',
      orientation,
      arcCount: 0,
    };
  }
  if (kind === 'speaker-radar') {
    return {
      kind,
      show: active,
      color: 'rgb(255, 255, 255)',
      orientation,
      arcCount: RADAR_ARC_COUNT,
    };
  }
  // ac-radar
  return {
    kind,
    show: active,
    color: acRadarColor(state),
    orientation,
    arcCount: RADAR_ARC_COUNT,
  };
}

/**
 * §4.5 render the effect overlay for a single entity.
 * Returns `nothing` when state is undefined or the model says !show.
 */
export function renderEffect(
  state: HassEntity | undefined,
  cfg: EntityConfig,
  _cardWidth: number,
): TemplateResult {
  if (!state) return nothing as unknown as TemplateResult;
  const model = effectModel(state, cfg);
  if (!model.show) return nothing as unknown as TemplateResult;

  if (model.kind === 'tv-cone') {
    const beamStyle = tvBeamCss(model.orientation as number);
    return html`
      <style>${TV_PULSE_KEYFRAMES}</style>
      <div class="effect-beam" style=${styleMap(beamStyle)}></div>
    `;
  }

  // speaker-radar or ac-radar
  const arcs = Array.from({ length: model.arcCount }, (_, i) => {
    const { arc } = radarArcsCss(i, model.color, model.orientation);
    return html`<div class="effect-arc" style=${styleMap(arc)}></div>`;
  });
  return html`
    <style>${RADAR_KEYFRAMES}</style>
    ${arcs}
  `;
}
