import { describe, it, expect } from 'vitest';
import {
  normalizeConfig,
  zoneForPoint,
  type ApartmentViewConfig,
  type ZoneConfig,
} from '../src/core/config';
import { rectangularSpatialPlan } from '../src/core/spatial-plan';

describe('normalizeConfig', () => {
  it('throws when images.base is missing', () => {
    expect(() => normalizeConfig({ type: 'x' })).toThrow(/images\.base/);
    expect(() =>
      normalizeConfig({ type: 'x', images: {} }),
    ).toThrow(/images\.base/);
  });

  it('accepts an authoritative 3D spatial plan without a floorplan image', () => {
    const cfg = normalizeConfig({
      type: 'custom:apartment-view-card',
      spatial: { plan: rectangularSpatialPlan(8, 6) },
    });
    expect(cfg.images.base).toBe('');
    expect(cfg.spatial?.plan?.rooms).toHaveLength(1);
  });

  it('normalizes per-context tooltip content and defaults it to none', () => {
    const cfg = normalizeConfig({
      type: 'custom:apartment-view-card',
      spatial: { plan: rectangularSpatialPlan(8, 6) },
      entities: [{
        entity: 'media_player.naim', x: 50, y: 50, size: 'medium', tap: 'more-info', orientation: null,
        tooltipContentInOverview: 'state', tooltipContentInRoom: 'state',
      }],
    });
    expect(cfg.entities[0]).toMatchObject({
      tooltipContentInOverview: 'state',
      tooltipContentInRoom: 'state',
    });

    const defaults = normalizeConfig({
      type: 'custom:apartment-view-card',
      spatial: { plan: rectangularSpatialPlan(8, 6) },
      entities: [{ entity: 'media_player.kef', x: 50, y: 50, size: 'medium', tap: 'more-info', orientation: null }],
    });
    expect(defaults.entities[0].tooltipContentInOverview ?? 'none').toBe('none');
    expect(defaults.entities[0].tooltipContentInRoom ?? 'none').toBe('none');
  });

  it('preserves exact survey geometry without requiring a floorplan image', () => {
    const cfg = normalizeConfig({
      type: 'custom:apartment-view-card',
      zones: [{ id: 'living', name: 'Living Room', x: 0, y: 0, width: 100, height: 100 }],
      spatial: {
        shell: {
          outer: [[0, 0], [8, 0], [8, 6], [0, 6]],
          holes: [],
          floor: [[0, 0], [8, 0], [8, 6], [0, 6]],
          rooms: [{ zoneId: 'living', floor: [[0, 0], [8, 0], [8, 6], [0, 6]], finish: 'wood' }],
          walls: [{ id: 'survey wall', points: [[0, 0], [8, 0]], thickness: 0.18, zoneIds: ['living'] }],
          openings: [{ id: 'front door', kind: 'door', x: 4, z: 0, width: 0.9, depth: 0.18, rotation: 0, bottom: 0, height: 2.1, color: '#2F5962' }],
        },
      },
    });
    expect(cfg.images.base).toBe('');
    expect(cfg.spatial?.shell?.rooms?.[0].zoneId).toBe('living');
    expect(cfg.spatial?.shell?.walls?.[0].id).toBe('survey-wall');
    expect(cfg.spatial?.shell?.openings[0]).toMatchObject({ id: 'front-door', kind: 'door', width: 0.9, color: '#2f5962' });
  });

  it('accepts legacy top-level dayImage as images.base', () => {
    const cfg = normalizeConfig({
      type: 'custom:apartment-view-card',
      dayImage: '/local/day.png',
    });
    expect(cfg.images.base).toBe('/local/day.png');
  });

  it('fills option defaults', () => {
    const cfg = normalizeConfig({ images: { base: '/b.png' } });
    expect(cfg.options).toEqual({
      view: 'auto',
      lightStyle: 'lit',
      hideWalls: false,
      freePanZoom: true,
      zoomMax: 1.5,
      duskDawnOffsetMinutes: 60,
      labels: { source: 'none', visibility: 'auto', densityCap: 14 },
      iconSize: 44,
      iconSizeMax: 88,
      aspectMobile: 0.8,
      interaction: {
        wheel: 'modifier',
        doubleTapZoom: true,
        roomSwipe: true,
        inertia: true,
      },
      idleTimeout: 0,
      presentation: 'control-heavy',
      spatialLightingMode: 'realistic',
    });
    expect(cfg.entities).toEqual([]);
    expect(cfg.zones).toEqual([]);
  });

  it('parses options.aspectMobile from a w/h string, ratio, or bare number', () => {
    const s = (v: unknown) =>
      normalizeConfig({ images: { base: '/b.png' }, options: { aspectMobile: v } }).options.aspectMobile;
    expect(s('1/1')).toBe(1);
    expect(s('4/5')).toBeCloseTo(0.8, 6);
    expect(s('3/4')).toBeCloseTo(0.75, 6);
    expect(s('3:4')).toBeCloseTo(0.75, 6);
    expect(s(0.75)).toBe(0.75);
    // Invalid / non-positive → default (4/5 = 0.8) fallback.
    expect(s('garbage')).toBeCloseTo(0.8, 6);
    expect(s(0)).toBeCloseTo(0.8, 6);
    expect(s(-2)).toBeCloseTo(0.8, 6);
    expect(s(undefined)).toBeCloseTo(0.8, 6);
  });

  it('parses a per-entity label object + string shorthands', () => {
    const cfg = normalizeConfig({
      images: { base: '/b.png' },
      entities: [
        { entity: 'climate.a', label: { source: 'climate-current', visibility: 'always' } },
        { entity: 'scene.b', label: 'Movie Night' },         // arbitrary string -> static
        { entity: 'cover.c', label: 'cover-position' },        // known source name
        { entity: 'light.d', label: 'off' },                   // off -> none
        { entity: 'light.e', label: { source: 'bogus' } },     // invalid source -> none
        { entity: 'light.f' },                                 // no label
      ],
    });
    expect(cfg.entities[0].label).toEqual({ source: 'climate-current', visibility: 'always' });
    expect(cfg.entities[1].label).toEqual({ source: 'static', text: 'Movie Night' });
    expect(cfg.entities[2].label).toEqual({ source: 'cover-position' });
    expect(cfg.entities[3].label).toEqual({ source: 'none' });
    expect(cfg.entities[4].label).toEqual({ source: 'none' });
    expect(cfg.entities[5].label).toBeUndefined();
  });

  it('parses global label defaults incl. smart, falling back on invalid', () => {
    const smart = normalizeConfig({ images: { base: '/b.png' }, options: { labels: { source: 'smart', visibility: 'always', densityCap: 20 } } });
    expect(smart.options.labels).toEqual({ source: 'smart', visibility: 'always', densityCap: 20 });
    const bad = normalizeConfig({ images: { base: '/b.png' }, options: { labels: { source: 'nope', visibility: 'sideways', densityCap: -3 } } });
    expect(bad.options.labels).toEqual({ source: 'none', visibility: 'auto', densityCap: 14 });
  });

  it('maps legacy image keys into images object', () => {
    const cfg = normalizeConfig({
      dayImage: '/d.png',
      allLightsImage: '/all.png',
      nightImage: '/n.png',
      duskdawnImage: '/dd.png',
    });
    expect(cfg.images).toEqual({
      base: '/d.png',
      allLights: '/all.png',
      night: '/n.png',
      duskDawn: '/dd.png',
    });
  });

  it('prefers explicit images.base over legacy dayImage', () => {
    const cfg = normalizeConfig({
      images: { base: '/new.png' },
      dayImage: '/old.png',
    });
    expect(cfg.images.base).toBe('/new.png');
  });

  it('fills entity defaults for a v2 entity', () => {
    const cfg = normalizeConfig({
      images: { base: '/b.png' },
      entities: [{ entity: 'light.a', x: 10, y: 20 }],
    });
    expect(cfg.entities[0]).toEqual({
      entity: 'light.a',
      x: 10,
      y: 20,
      size: 'medium',
      tap: 'toggle',
      orientation: null,
    });
  });

  it('preserves a numeric orientation and lightStyle override', () => {
    const cfg = normalizeConfig({
      images: { base: '/b.png' },
      entities: [
        { entity: 'light.a', x: 1, y: 2, orientation: 90, lightStyle: 'glow' },
      ],
    });
    expect(cfg.entities[0].orientation).toBe(90);
    expect(cfg.entities[0].lightStyle).toBe('glow');
  });

  it('normalizes zones, defaulting absent name', () => {
    const cfg = normalizeConfig({
      images: { base: '/b.png' },
      zones: [{ x: 1, y: 2, width: 10, height: 20, icon: 'mdi:sofa' }],
    });
    expect(cfg.zones[0]).toEqual({
      id: 'zone',
      name: 'Zone',
      icon: 'mdi:sofa',
      x: 1,
      y: 2,
      width: 10,
      height: 20,
    });
  });

  it('migrates rooms to stable unique ids and preserves Area links', () => {
    const cfg = normalizeConfig({
      images: { base: '/b.png' },
      zones: [
        { name: 'Living Room', areaId: 'living_room', x: 0, y: 0, width: 50, height: 50 },
        { name: 'Living Room', x: 50, y: 0, width: 50, height: 50 },
      ],
    });
    expect(cfg.modelVersion).toBe(7);
    expect(cfg.zones.map((zone) => zone.id)).toEqual(['living-room', 'living-room-2']);
    expect(cfg.zones[0].areaId).toBe('living_room');
  });

  it('normalizes wall openings and drops openings whose wall no longer exists', () => {
    const cfg = normalizeConfig({
      images: { base: '/b.png' },
      zones: [{ id: 'living', name: 'Living Room', x: 0, y: 0, width: 80, height: 80 }],
      spatial: {
        openings: [
          { id: 'balcony-door', kind: 'door', wallId: 'living:right', position: 2, width: 0.01 },
          { id: 'window', kind: 'window', wallId: 'deleted:top', position: 0.5, width: 0.3 },
        ],
      },
    });
    expect(cfg.spatial?.openings).toEqual([
      { id: 'balcony-door', kind: 'door', wallId: 'living:right', position: 0.96, width: 0.08 },
    ]);
  });

  it('normalizes curved walls, north, location, and real dimensions', () => {
    const cfg = normalizeConfig({
      images: { base: '/b.png' },
      zones: [{ id: 'living', name: 'Living Room', x: 0, y: 0, width: 80, height: 80 }],
      spatial: {
        openings: [],
        walls: [
          { wallId: 'living:right', curve: 1.8 },
          { wallId: 'deleted:left', curve: 0.4 },
          { wallId: 'living:top', curve: 0 },
        ],
        site: { north: -25, latitude: 95, longitude: -190 },
        dimensions: { width: 11.7, aspectRatio: 1.158, wallHeight: 2.65 },
      },
    });
    expect(cfg.spatial).toEqual({
      openings: [],
      walls: [{ wallId: 'living:right', curve: 1 }],
      site: { north: 335, latitude: 90, longitude: -180 },
      dimensions: { width: 11.7, aspectRatio: 1.158, wallHeight: 2.65 },
    });
  });

  it('normalizes an authoritative metre-based spatial plan', () => {
    const cfg = normalizeConfig({
      images: { base: '/b.png' },
      zones: [{ id: 'living', name: 'Living Room', x: 0, y: 0, width: 100, height: 100 }],
      entities: [{
        entity: 'light.pendant', x: 50, y: 50,
        spatial: {
          position: { x: 2.4, y: 2.35, z: 1.8 },
          rotation: { x: 0, y: 45, z: 0 },
          mount: 'ceiling', parentId: 'living', visible: false,
        },
      }],
      spatial: {
        openings: [{
          id: 'balcony', kind: 'door', wallId: 'South Wall', position: 0.5, width: 0.2,
          widthMeters: 0.92, height: 2.15, bottom: 0, hinge: 'right', swing: 'in',
        }],
        plan: {
          version: 99,
          vertices: [
            { id: 'A', x: 0, z: 0 }, { id: 'B', x: 5, z: 0 },
            { id: 'C', x: 5, z: 4 }, { id: 'D', x: 0, z: 4 },
          ],
          walls: [
            { id: 'South Wall', start: 'A', end: 'B', thickness: 0.18, curve: 0 },
            { id: 'East Wall', start: 'B', end: 'C', thickness: 0.12, curve: 0.2 },
            { id: 'North Wall', start: 'C', end: 'D', thickness: 0.12, curve: 0 },
            { id: 'West Wall', start: 'D', end: 'A', thickness: 0.12, curve: 0 },
          ],
          rooms: [{
            id: 'Lounge', zoneId: 'living', floorFinish: 'wood',
            boundary: [
              { wallId: 'South Wall' }, { wallId: 'East Wall' },
              { wallId: 'North Wall' }, { wallId: 'West Wall' },
            ],
          }],
          elements: [{
            id: 'Sofa', type: 'custom', name: 'Main sofa', zoneId: 'living', entityId: 'sensor.sofa',
            position: { x: 2, y: 0, z: 3 }, rotation: { y: 180 }, scale: { x: 2.2, y: 1, z: 0.9 },
            primitives: [{
              id: 'Seat', kind: 'cube', size: { x: 1.8, y: 0.35, z: 0.8 }, bevel: 0.08,
              color: { base: '#445566', rules: [{ operator: 'equals', compare: 'on', value: '#ffffff' }] },
              luminosity: { base: 0, rules: [] }, waves: { base: 0, rules: [] },
            }],
          }],
        },
      },
    });
    expect(cfg.spatial?.plan?.version).toBe(1);
    expect(cfg.spatial?.plan?.vertices).toHaveLength(4);
    expect(cfg.spatial?.plan?.vertices[0]).toEqual({ id: 'a', x: 0, z: 0 });
    expect(cfg.spatial?.plan?.walls).toHaveLength(4);
    expect(cfg.spatial?.plan?.walls[0]).toEqual({ id: 'south-wall', start: 'a', end: 'b', thickness: 0.18, curve: 0 });
    expect(cfg.spatial?.plan?.rooms[0]).toMatchObject({ id: 'lounge', zoneId: 'living', floorFinish: 'wood' });
    expect(cfg.spatial?.plan?.elements[0]).toEqual({
      id: 'sofa', type: 'custom', name: 'Main sofa', zoneId: 'living', entityId: 'sensor.sofa',
      position: { x: 2, y: 0, z: 3 }, rotation: { x: 0, y: 180, z: 0 }, scale: { x: 2.2, y: 1, z: 0.9 },
      primitives: [{
        id: 'seat', kind: 'cube', position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 },
        size: { x: 1.8, y: 0.35, z: 0.8 }, bevel: 0.08,
        color: { base: '#445566', rules: [{ operator: 'equals', compare: 'on', value: '#ffffff' }] },
        luminosity: { base: 0, rules: [] }, waves: { base: 0, rules: [] },
      }],
    });
    expect(cfg.spatial?.openings[0]).toEqual({
      id: 'balcony', kind: 'door', wallId: 'south-wall', position: 0.5, width: 0.2,
      widthMeters: 0.92, height: 2.15, bottom: 0, hinge: 'right', swing: 'in',
    });
    expect(cfg.entities[0].spatial).toEqual({
      position: { x: 2.4, y: 2.35, z: 1.8 },
      rotation: { x: 0, y: 45, z: 0 },
      mount: 'ceiling', parentId: 'living', visible: false,
    });
  });

  it('drops broken spatial graph references and clamps unsafe transforms', () => {
    const cfg = normalizeConfig({
      images: { base: '/b.png' },
      entities: [{
        entity: 'camera.test',
        spatial: { position: { x: 5000, y: -5000, z: 2 }, rotation: { y: 900 }, mount: 'magic' },
      }],
      spatial: {
        plan: {
          vertices: [{ id: 'a', x: 0, z: 0 }, { id: 'bad' }],
          walls: [
            { id: 'dangling', start: 'a', end: 'missing' },
            { id: 'same', start: 'a', end: 'a' },
          ],
          rooms: [{ id: 'broken', boundary: [{ wallId: 'dangling' }] }],
          elements: [{
            id: 'lamp', type: 'custom', scale: { x: 0, y: 99, z: 1 },
            primitives: [{
              id: 'body', kind: 'cube', size: { x: 0, y: 400, z: 1 }, bevel: 9,
              color: { base: 'invalid', rules: [] },
              luminosity: { base: -2, rules: [{ operator: 'above', compare: 10, value: 4 }] },
              waves: { base: 2, rules: [] },
            }],
          }],
        },
      },
    });
    expect(cfg.spatial?.plan).toEqual({ version: 1, vertices: [{ id: 'a', x: 0, z: 0 }], walls: [], rooms: [], elements: [{
      id: 'lamp', type: 'custom', position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 0.001, y: 20, z: 1 }, primitives: [{
        id: 'body', kind: 'cube', position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, size: { x: 0.01, y: 100, z: 1 }, bevel: 2,
        color: { base: '#d6dcda', rules: [] }, luminosity: { base: 0, rules: [{ operator: 'above', compare: 10, value: 1 }] }, waves: { base: 1, rules: [] },
      }],
    }] });
    expect(cfg.entities[0].spatial).toEqual({
      position: { x: 1000, y: -1000, z: 2 }, rotation: { x: 0, y: 360, z: 0 }, mount: 'free', visible: true,
    });
  });

  it('keeps explicit room membership and removes only broken room links', () => {
    const cfg = normalizeConfig({
      images: { base: '/b.png' },
      zones: [{ id: 'lounge', name: 'Renamed Lounge', x: 0, y: 0, width: 50, height: 50 }],
      entities: [
        { entity: 'media_player.tv', zoneId: 'lounge', x: 90, y: 90 },
        { entity: 'light.orphan', zoneId: 'deleted-room', x: 10, y: 10 },
      ],
    });
    expect(cfg.entities[0].zoneId).toBe('lounge');
    expect(cfg.entities[1]).not.toHaveProperty('zoneId');
  });

  it('preserves unknown top-level keys (v1 columns/rows bug)', () => {
    const cfg = normalizeConfig({
      images: { base: '/b.png' },
      columns: 2,
      rows: 3,
      somethingFuture: { a: 1 },
    }) as ApartmentViewConfig & Record<string, unknown>;
    expect(cfg.columns).toBe(2);
    expect(cfg.rows).toBe(3);
    expect(cfg.somethingFuture).toEqual({ a: 1 });
  });

  it('sets type when absent', () => {
    const cfg = normalizeConfig({ images: { base: '/b.png' } });
    expect(cfg.type).toBe('custom:apartment-view-card');
  });

  it('preserves a provided type verbatim', () => {
    const cfg = normalizeConfig({
      type: 'custom:apartment-view-card',
      images: { base: '/b.png' },
    });
    expect(cfg.type).toBe('custom:apartment-view-card');
  });
});

describe('zoneForPoint', () => {
  const big: ZoneConfig = { name: 'big', x: 0, y: 0, width: 100, height: 100 };
  const small: ZoneConfig = { name: 'small', x: 40, y: 40, width: 20, height: 20 };

  it('returns null when no zone contains the point', () => {
    expect(zoneForPoint(5, 5, [small])).toBeNull();
  });

  it('returns the only containing zone', () => {
    expect(zoneForPoint(5, 5, [big])).toBe(big);
  });

  it('returns the smallest-AREA zone when multiple contain the point', () => {
    expect(zoneForPoint(50, 50, [big, small])).toBe(small);
    // order independent
    expect(zoneForPoint(50, 50, [small, big])).toBe(small);
  });

  it('treats rectangle edges as inside (inclusive bounds)', () => {
    expect(zoneForPoint(0, 0, [big])).toBe(big);
    expect(zoneForPoint(100, 100, [big])).toBe(big);
  });

  it('returns null for an empty zone list', () => {
    expect(zoneForPoint(50, 50, [])).toBeNull();
  });
});

describe('normalizeConfig quickActions', () => {
  it('normalizes valid actions and drops invalid ones', () => {
    const cfg = normalizeConfig({ images: { base: '/b.png' }, quickActions: [
      { name: 'Movie', entity: 'scene.movie', icon: 'mdi:movie' },
      { name: 'All off', service: 'light.turn_off', data: { entity_id: 'all' } },
      { name: 'Bad' },        // no entity/service -> dropped
      { entity: 'scene.x' },  // no name -> dropped
      'nope',                 // not an object -> dropped
    ] });
    expect(cfg.quickActions).toEqual([
      { name: 'Movie', icon: 'mdi:movie', entity: 'scene.movie' },
      { name: 'All off', service: 'light.turn_off', data: { entity_id: 'all' } },
    ]);
  });
  it('defaults quickActions to []', () => {
    expect(normalizeConfig({ images: { base: '/b.png' } }).quickActions).toEqual([]);
  });
});

describe('normalizeConfig weatherEntity', () => {
  it('keeps a string weatherEntity, omits otherwise', () => {
    expect(normalizeConfig({ images: { base: '/b.png' }, options: { weatherEntity: 'weather.home' } }).options.weatherEntity).toBe('weather.home');
    expect('weatherEntity' in normalizeConfig({ images: { base: '/b.png' } }).options).toBe(false);
  });
});

describe('normalizeConfig hideWalls', () => {
  it('defaults overview walls to full height and preserves an explicit cutaway preference', () => {
    expect(normalizeConfig({ images: { base: '/b.png' } }).options.hideWalls).toBe(false);
    expect(normalizeConfig({ images: { base: '/b.png' }, options: { hideWalls: true } }).options.hideWalls).toBe(true);
    expect(normalizeConfig({ images: { base: '/b.png' }, options: { hideWalls: 'yes' } }).options.hideWalls).toBe(false);
  });
});

describe('normalizeConfig floors (multi-floor)', () => {
  it('normalizes floors; top-level mirrors floor 0', () => {
    const cfg = normalizeConfig({ images: { base: '/ignored.png' }, floors: [
      { name: 'Ground', icon: 'mdi:home', images: { base: '/g.png' }, entities: [{ entity: 'light.a', x: 1, y: 2 }] },
      { name: 'Upstairs', images: { base: '/u.png' }, entities: [{ entity: 'light.b', x: 3, y: 4 }], zones: [{ name: 'Bed', x: 0, y: 0, width: 10, height: 10 }] },
    ] });
    expect(cfg.floors).toHaveLength(2);
    expect(cfg.floors![0]).toMatchObject({ name: 'Ground', icon: 'mdi:home', images: { base: '/g.png' } });
    expect(cfg.floors![1].zones).toHaveLength(1);
    expect(cfg.images.base).toBe('/g.png');      // top-level mirrors floor 0
    expect(cfg.entities[0].entity).toBe('light.a');
  });
  it('single-floor config has floors: []', () => {
    expect(normalizeConfig({ images: { base: '/b.png' } }).floors).toEqual([]);
  });
  it('a floor without a base throws', () => {
    expect(() => normalizeConfig({ floors: [{ name: 'X', images: {} }] })).toThrow(/images\.base/);
  });
});

describe('normalizeConfig interaction + idleTimeout (spec v2.5 §7)', () => {
  it('keeps valid interaction values', () => {
    const cfg = normalizeConfig({
      images: { base: '/b.png' },
      options: {
        interaction: { wheel: 'plain', doubleTapZoom: false, roomSwipe: false, inertia: false },
        idleTimeout: 300,
      },
    });
    expect(cfg.options.interaction).toEqual({
      wheel: 'plain',
      doubleTapZoom: false,
      roomSwipe: false,
      inertia: false,
    });
    expect(cfg.options.idleTimeout).toBe(300);
  });

  it('invalid interaction fields fall back individually to defaults', () => {
    const cfg = normalizeConfig({
      images: { base: '/b.png' },
      options: {
        interaction: { wheel: 'scrolly', doubleTapZoom: 'yes', roomSwipe: 1, inertia: null },
      },
    });
    expect(cfg.options.interaction).toEqual({
      wheel: 'modifier',
      doubleTapZoom: true,
      roomSwipe: true,
      inertia: true,
    });
  });

  it('a non-object interaction and a bad idleTimeout yield full defaults', () => {
    const cfg = normalizeConfig({
      images: { base: '/b.png' },
      options: { interaction: 'nope', idleTimeout: -5 },
    });
    expect(cfg.options.interaction).toEqual({
      wheel: 'modifier',
      doubleTapZoom: true,
      roomSwipe: true,
      inertia: true,
    });
    expect(cfg.options.idleTimeout).toBe(0);
    expect(normalizeConfig({ images: { base: '/b.png' }, options: { idleTimeout: 'x' } }).options.idleTimeout).toBe(0);
    expect(normalizeConfig({ images: { base: '/b.png' }, options: { idleTimeout: NaN } }).options.idleTimeout).toBe(0);
  });
});

describe('normalizeConfig icon sizing', () => {
  it('keeps valid iconSize/iconSizeMax; falls back to 44/88', () => {
    const cfg = normalizeConfig({ images: { base: '/b.png' }, options: { iconSize: 60, iconSizeMax: 120 } });
    expect(cfg.options.iconSize).toBe(60);
    expect(cfg.options.iconSizeMax).toBe(120);
    const bad = normalizeConfig({ images: { base: '/b.png' }, options: { iconSize: -5, iconSizeMax: 'x' } });
    expect(bad.options.iconSize).toBe(44);
    expect(bad.options.iconSizeMax).toBe(88);
  });

  it('keeps optional mobile overrides only when a positive number', () => {
    const cfg = normalizeConfig({
      images: { base: '/b.png' },
      options: { iconSizeMobile: 56, iconSizeMaxMobile: 72 },
    });
    expect(cfg.options.iconSizeMobile).toBe(56);
    expect(cfg.options.iconSizeMaxMobile).toBe(72);
    const none = normalizeConfig({ images: { base: '/b.png' }, options: { iconSizeMobile: -1 } });
    expect('iconSizeMobile' in none.options).toBe(false);
    expect('iconSizeMaxMobile' in none.options).toBe(false);
  });
});

describe('normalizeConfig GLB Elements', () => {
  it('keeps portable model metadata and validates surface mappings', () => {
    const cfg = normalizeConfig({
      type: 'custom:apartment-view-card',
      spatial: {
        plan: {
          vertices: [], walls: [], rooms: [],
          elements: [{
            id: 'television', type: 'glb', primitives: [],
            glb: {
              fileName: 'television.glb',
              uri: 'data:model/gltf-binary;base64,AAAA',
              byteLength: 3,
              size: { x: 1.4, y: 0.8, z: 0.12 },
              surfaces: [{
                id: 'screen', name: 'Screen', nodePath: '0/2', materialIndex: 1,
                sourceMaterialKey: 'name:display', sourceColor: '#111111',
                entityId: 'media_player.tv',
                color: { base: '#111111', rules: [{ operator: 'equals', compare: 'playing', value: '#ffffff' }] },
                luminosity: { base: 0, rules: [{ operator: 'equals', compare: 'playing', value: 0.7 }] },
              }],
            },
          }],
        },
      },
    });

    expect(cfg.spatial?.plan?.elements[0]).toMatchObject({
      type: 'glb',
      glb: {
        fileName: 'television.glb',
        size: { x: 1.4, y: 0.8, z: 0.12 },
        surfaces: [{ id: 'screen', nodePath: '0/2', materialIndex: 1, sourceMaterialKey: 'name:display', sourceColor: '#111111', entityId: 'media_player.tv' }],
      },
    });
  });
});
