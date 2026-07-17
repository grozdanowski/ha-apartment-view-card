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

  it('drops malformed independent room polygons during normalization', () => {
    const Card = customElements.get('apartment-view-card') as any;
    const stub = Card.getStubConfig();
    stub.spatial.plan = {
      ...stub.spatial.plan,
      vertices: [], walls: [],
      rooms: [{
        id: 'crossed', boundary: [], floorFinish: 'wood',
        floor: [[0, 0], [3, 3], [0, 3], [3, 0]],
      }],
    };

    expect(normalizeConfig(stub).spatial?.plan?.rooms).toEqual([]);
  });

  it('drops malformed surveyed room polygons and preserves explicit wall-free shells', () => {
    const Card = customElements.get('apartment-view-card') as any;
    const stub = Card.getStubConfig();
    stub.zones = [{ id: 'reading', name: 'Reading', x: 0, y: 0, width: 100, height: 100 }];
    stub.spatial.shell = {
      outer: [[0, 0], [6, 0], [6, 4], [0, 4]],
      floor: [[0, 0], [6, 0], [6, 4], [0, 4]],
      holes: [], openings: [], walls: [],
      rooms: [{ zoneId: 'reading', floor: [[0, 0], [3, 3], [0, 3], [3, 0]] }],
    };

    const normalized = normalizeConfig(stub);
    expect(normalized.spatial?.shell?.rooms).toBeUndefined();
    expect(normalized.spatial?.shell?.walls).toEqual([]);
  });
});
