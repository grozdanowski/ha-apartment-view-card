import { describe, expect, it } from 'vitest';
import type { SpatialPlan } from '../src/core/config';
import { pointInPolygon, roomForSpatialPosition, roomPolygon, spatialBounds, validateSpatialPlan } from '../src/core/spatial-geometry';

function plan(): SpatialPlan {
  return {
    version: 1,
    vertices: [
      { id: 'a', x: 0, z: 0 }, { id: 'b', x: 4, z: 0 },
      { id: 'c', x: 4, z: 3 }, { id: 'd', x: 0, z: 3 },
    ],
    walls: [
      { id: 'south', start: 'a', end: 'b', thickness: 0.12, curve: 0 },
      { id: 'east', start: 'b', end: 'c', thickness: 0.12, curve: 0 },
      { id: 'north', start: 'c', end: 'd', thickness: 0.12, curve: 0 },
      { id: 'west', start: 'd', end: 'a', thickness: 0.12, curve: 0 },
    ],
    rooms: [{
      id: 'room', zoneId: 'room', floorFinish: 'wood',
      boundary: [
        { wallId: 'south', reversed: false }, { wallId: 'east', reversed: false },
        { wallId: 'north', reversed: false }, { wallId: 'west', reversed: false },
      ],
    }],
    elements: [],
  };
}

describe('spatial geometry', () => {
  it('computes physical bounds and ordered room polygons', () => {
    const value = plan();
    expect(spatialBounds(value)).toEqual({ minX: 0, minZ: 0, maxX: 4, maxZ: 3, width: 4, depth: 3, centerX: 2, centerZ: 1.5 });
    expect(roomPolygon(value, value.rooms[0])).toEqual([
      { x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 3 }, { x: 0, z: 3 },
    ]);
  });

  it('finds the smallest containing room from a 3D position', () => {
    const value = plan();
    expect(pointInPolygon({ x: 2, z: 1 }, roomPolygon(value, value.rooms[0])!)).toBe(true);
    expect(roomForSpatialPosition(value, { x: 2, z: 1 })?.id).toBe('room');
    expect(roomForSpatialPosition(value, { x: 7, z: 1 })).toBeNull();
  });

  it('validates a closed graph and physical opening', () => {
    const value = plan();
    expect(validateSpatialPlan(value, [{
      id: 'door', kind: 'door', wallId: 'south', position: 0.5, width: 0.2, widthMeters: 0.9,
    }])).toEqual([]);
  });

  it('reports disconnected room traversal and invalid openings', () => {
    const value = plan();
    value.rooms[0].boundary[2].reversed = true;
    const issues = validateSpatialPlan(value, [
      { id: 'wide', kind: 'window', wallId: 'south', position: 0.5, width: 0.5, widthMeters: 8 },
      { id: 'lost', kind: 'door', wallId: 'missing', position: 0.5, width: 0.2 },
    ]);
    expect(issues.map((issue) => issue.code)).toEqual([
      'open-room-boundary', 'oversized-opening', 'missing-opening-wall',
    ]);
  });
});
