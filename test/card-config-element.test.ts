// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import '../src/apartment-view-card';
import { normalizeConfig } from '../src/core/config';

describe('apartment-view-card config element + stub', () => {
  it('getConfigElement returns the editor element', () => {
    const Card = customElements.get('apartment-view-card') as any;
    const el = Card.getConfigElement();
    expect(el).toBeInstanceOf(HTMLElement);
    expect(el.localName).toBe('apartment-view-card-editor');
  });

  it('the editor custom element is registered as a side effect', () => {
    expect(customElements.get('apartment-view-card-editor')).toBeDefined();
  });

  it('getStubConfig returns a valid 3D config that normalizeConfig accepts', () => {
    const Card = customElements.get('apartment-view-card') as any;
    const stub = Card.getStubConfig();
    expect(stub.type).toContain('apartment-view-card');
    expect(stub.images.base).toBe('');
    expect(stub.spatial.plan.rooms).toHaveLength(1);
    expect(Array.isArray(stub.entities)).toBe(true);
    expect(Array.isArray(stub.zones)).toBe(true);
    expect(() => normalizeConfig(stub)).not.toThrow();
  });

  it('getStubConfig needs no placeholder image', () => {
    const Card = customElements.get('apartment-view-card') as any;
    const stub = Card.getStubConfig();
    expect(stub.images.base).toBe('');
  });

  it('getStubConfig options carry the documented defaults', () => {
    const Card = customElements.get('apartment-view-card') as any;
    const stub = Card.getStubConfig();
    expect(stub.options.view).toBe('auto');
    expect(stub.options.lightStyle).toBe('lit');
    expect(stub.options.zoomMax).toBe(1.5);
    expect(stub.options.duskDawnOffsetMinutes).toBe(60);
    expect(stub.options.freePanZoom).toBe(true);
  });
});
