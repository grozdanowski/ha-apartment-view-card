import { describe, it, expect } from 'vitest';
import { lightPatchMaskCss } from '../src/render/light-layer';
import type { EntityConfig } from '../src/core/config';

function cfg(partial: Partial<EntityConfig>): EntityConfig {
  return {
    entity: 'light.test',
    x: 40,
    y: 16,
    size: 'small',
    tap: 'toggle',
    orientation: null,
    ...partial,
  };
}

describe('lightPatchMaskCss', () => {
  it('omni light: radial mask only, no composite props', () => {
    // small=0.13, cardWidth 1000, b=1 => r = 0.13*1000*(0.45+0.55) = 130
    const s = lightPatchMaskCss(cfg({ orientation: null }), 1000, 1);
    expect(s['mask-image']).toBe(
      'radial-gradient(circle 130px at 40% 16%, black 0%, rgba(0,0,0,0.55) 40%, transparent 100%)'
    );
    expect(s['-webkit-mask-image']).toBe(s['mask-image']);
    expect(s['mask-composite']).toBeUndefined();
    expect(s['-webkit-mask-composite']).toBeUndefined();
  });

  it('directional light: radial∩cone with both composite props', () => {
    const s = lightPatchMaskCss(cfg({ orientation: 90 }), 1000, 1);
    expect(s['mask-image']).toContain('radial-gradient(circle 130px at 40% 16%');
    expect(s['mask-image']).toContain('conic-gradient(from 90deg at 40% 16%');
    expect(s['mask-composite']).toBe('intersect');
    expect(s['-webkit-mask-composite']).toBe('source-in');
    expect(s['-webkit-mask-image']).toBe(s['mask-image']);
  });

  it('radius shrinks with brightness (b=0 => 0.45 factor)', () => {
    // small=0.13, cardWidth 1000, b=0 => r = 0.13*1000*0.45 = 58.5
    const s = lightPatchMaskCss(cfg({}), 1000, 0);
    expect(s['mask-image']).toContain('circle 58.5px at');
  });
});
