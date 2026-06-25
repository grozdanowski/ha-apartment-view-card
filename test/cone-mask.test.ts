import { describe, it, expect } from 'vitest';
import { coneMask, lightMaskStyles } from '../src/render/light-layer';

describe('coneMask', () => {
  it('produces a conic-gradient with the exact 6 stops for the light cone (half=30, feather=12)', () => {
    const m = coneMask(0, 30, 12, '40% 16%');
    expect(m).toBe(
      'conic-gradient(from 0deg at 40% 16%, ' +
        'black 0deg, black 30deg, ' +
        'transparent 42deg, transparent 318deg, ' +
        'black 330deg, black 360deg)'
    );
  });

  it('computes half+feather, 360-half-feather and 360-half for the device cone (half=34, feather=14)', () => {
    const m = coneMask(0, 34, 14, '50% 50%');
    expect(m).toContain('black 34deg');
    expect(m).toContain('transparent 48deg'); // half+feather
    expect(m).toContain('transparent 312deg'); // 360-half-feather
    expect(m).toContain('black 326deg'); // 360-half
    expect(m).toContain('black 360deg');
  });

  it('embeds the orientation in the "from" angle', () => {
    expect(coneMask(135, 30, 12, '50% 50%')).toContain('conic-gradient(from 135deg at 50% 50%');
  });

  it('embeds the at-position verbatim', () => {
    expect(coneMask(90, 34, 14, '50% 50%')).toContain('at 50% 50%');
  });
});

describe('lightMaskStyles', () => {
  it('returns only the radial mask and empty composites when orientation is null (omni)', () => {
    const s = lightMaskStyles(40, 16, 120, null);
    expect(s.maskImage).toBe(
      'radial-gradient(circle 120px at 40% 16%, black 0%, rgba(0,0,0,0.55) 40%, transparent 100%)'
    );
    expect(s.maskComposite).toBe('');
    expect(s.webkitMaskComposite).toBe('');
  });

  it('intersects radial + cone when orientation is numeric (including 0)', () => {
    const s = lightMaskStyles(40, 16, 120, 0);
    expect(s.maskImage).toBe(
      'radial-gradient(circle 120px at 40% 16%, black 0%, rgba(0,0,0,0.55) 40%, transparent 100%), ' +
        "conic-gradient(from 0deg at 40% 16%, black 0deg, black 30deg, transparent 42deg, transparent 318deg, black 330deg, black 360deg)"
    );
    expect(s.maskComposite).toBe('intersect');
    expect(s.webkitMaskComposite).toBe('source-in');
  });
});
