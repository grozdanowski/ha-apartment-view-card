import type { HassEntity } from '../core/ha-types';
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
