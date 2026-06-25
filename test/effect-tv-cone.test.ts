import { describe, it, expect } from 'vitest';
import { isTvLike, deviceConeBeamCss, tvBeamCss, TV_PULSE_KEYFRAMES } from '../src/render/effect-layer';
import type { HassEntity } from '../src/core/ha-types';

function mp(attrs: Record<string, unknown>, state = 'playing'): HassEntity {
  return {
    entity_id: 'media_player.x',
    state,
    attributes: attrs,
  };
}

describe('isTvLike', () => {
  it('true when device_class is tv', () => {
    expect(isTvLike(mp({ device_class: 'tv' }))).toBe(true);
  });
  it('true for video/movie/tvshow content types', () => {
    expect(isTvLike(mp({ media_content_type: 'video' }))).toBe(true);
    expect(isTvLike(mp({ media_content_type: 'movie' }))).toBe(true);
    expect(isTvLike(mp({ media_content_type: 'tvshow' }))).toBe(true);
  });
  it('false for music content type (that is a speaker)', () => {
    expect(isTvLike(mp({ media_content_type: 'music' }))).toBe(false);
  });
  it('false for non-media_player domains', () => {
    const climate = { ...mp({ device_class: 'tv' }), entity_id: 'climate.x' } as HassEntity;
    expect(isTvLike(climate)).toBe(false);
  });
});

describe('deviceConeBeamCss', () => {
  it('builds a color radial masked by the 34/14 device cone with screen blend', () => {
    const s = deviceConeBeamCss(90, 'rgba(95, 165, 255, 0.5)');
    expect(s.background).toBe(
      'radial-gradient(circle at 50% 50%, rgba(95, 165, 255, 0.5) 0%, transparent 70%)'
    );
    expect(s['mask-image']).toBe(
      'conic-gradient(from 90deg at 50% 50%, black 0deg, black 34deg, transparent 48deg, transparent 312deg, black 326deg, black 360deg)'
    );
    expect(s['-webkit-mask-image']).toBe(s['mask-image']);
    expect(s['mix-blend-mode']).toBe('screen');
  });
});

describe('tvBeamCss', () => {
  it('uses the weak blue color and the tv-pulse animation', () => {
    const s = tvBeamCss(0);
    expect(s.background).toContain('rgba(95, 165, 255, 0.5)');
    expect(s.animation).toBe('tv-pulse 2.4s ease-in-out infinite');
    expect(s['mask-image']).toContain('conic-gradient(from 0deg at 50% 50%');
  });
  it('keyframes pulse weakly between 0.35 and 0.55 opacity', () => {
    expect(TV_PULSE_KEYFRAMES).toContain('@keyframes tv-pulse');
    expect(TV_PULSE_KEYFRAMES).toContain('opacity: 0.35');
    expect(TV_PULSE_KEYFRAMES).toContain('opacity: 0.55');
  });
});
