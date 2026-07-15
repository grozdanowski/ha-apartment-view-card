import { describe, expect, it } from 'vitest';
import type { SpatialShellConfig } from '../src/core/config';
import { addShellWall, assignShellOpenings, moveShellPoint, reconcileShellWallZones, removeShellWallSegment, shellSegmentById, shellSegments, validateSpatialShell } from '../src/core/spatial-shell';

describe('surveyed architecture', () => {
  const shell: SpatialShellConfig = {
    outer: [[0, 0], [5, 0], [5, 4], [0, 4]],
    holes: [],
    floor: [[0, 0], [5, 0], [5, 4], [0, 4]],
    walls: [
      { id: 'facade', smooth: true, thickness: 0.3, points: [[0, 0], [2.5, -0.18], [5, 0]] },
      { id: 'side', thickness: 0.2, points: [[5, 0], [5, 4]] },
    ],
    openings: [
      { id: 'curve-window', kind: 'window', x: 1.25, z: -0.09, width: 0.8, depth: 0.3, rotation: -4, bottom: 0.9, height: 1.1 },
      { id: 'balcony-door', kind: 'window', x: 3.75, z: -0.09, width: 0.92, depth: 0.3, rotation: 4, bottom: 0, height: 2.24 },
      { id: 'side-window', kind: 'window', x: 5, z: 2, width: 1, depth: 0.2, rotation: 89, bottom: 1, height: 1 },
    ],
  };

  it('anchors every opening to exactly one best wall segment', () => {
    const assigned = assignShellOpenings(shell);
    expect(assigned.map(({ opening }) => opening.id).sort()).toEqual(['balcony-door', 'curve-window', 'side-window']);
    expect(new Set(assigned.map(({ opening }) => opening.id))).toHaveLength(3);
  });

  it('exposes stable segment ids for editor updates', () => {
    expect(shellSegmentById(shell, 'shell:facade:1')).toMatchObject({ length: expect.any(Number), rotation: expect.any(Number) });
  });

  it('moves shared wall, floor, room, and opening geometry as one architectural point', () => {
    const editable: SpatialShellConfig = {
      ...shell,
      rooms: [{ zoneId: 'living', floor: [[0, 0], [5, 0], [5, 4], [0, 4]] }],
    };
    const moved = moveShellPoint(editable, [5, 0], [6, 0.5]);

    expect(moved.outer).toContainEqual([6, 0.5]);
    expect(moved.floor).toContainEqual([6, 0.5]);
    expect(moved.rooms?.[0].floor).toContainEqual([6, 0.5]);
    expect(moved.walls?.[0].points.at(-1)).toEqual([6, 0.5]);
    expect(moved.walls?.[1].points[0]).toEqual([6, 0.5]);
    const sideWindow = moved.openings.find((opening) => opening.id === 'side-window');
    expect(sideWindow?.x).toBeCloseTo(5.5);
    expect(sideWindow?.z).toBeCloseTo(2.25);
    expect(sideWindow?.rotation).not.toBe(89);
  });

  it('adds a new wall run and rejects the same segment in either direction', () => {
    const added = addShellWall(shell, [1, 1], [3, 1]);
    expect(added.walls).toHaveLength(3);
    expect(added.walls?.at(-1)).toMatchObject({ points: [[1, 1], [3, 1]], thickness: 0.12 });
    expect(addShellWall(added, [1, 1], [3, 1])).toBe(added);
    expect(addShellWall(added, [3, 1], [1, 1])).toBe(added);
  });

  it('removes one wall segment and only its attached openings', () => {
    const removed = removeShellWallSegment(shell, 'shell:facade:0');
    expect(removed.openings.map((opening) => opening.id).sort()).toEqual(['balcony-door', 'side-window']);
    expect(shellSegments(removed).some((segment) => (
      segment.start[0] === 2.5 && segment.end[0] === 5
    ))).toBe(true);
    expect(shellSegments(removed).some((segment) => segment.id === 'shell:side:0')).toBe(true);
  });

  it('splits a longer run around a deleted middle segment without bridging the gap', () => {
    const long: SpatialShellConfig = {
      ...shell,
      walls: [{ id: 'long', points: [[0, 0], [1, 0], [2, 0], [3, 0]], thickness: 0.2 }],
      openings: [],
    };
    const removed = removeShellWallSegment(long, 'shell:long:1');
    expect(removed.walls).toHaveLength(2);
    expect(removed.walls?.map((wall) => wall.points)).toEqual([
      [[0, 0], [1, 0]],
      [[2, 0], [3, 0]],
    ]);
    expect(shellSegments(removed)).toHaveLength(2);
  });

  it('reconciles each wall segment with the rooms physically touching it', () => {
    const divided: SpatialShellConfig = {
      outer: [[0, 0], [6, 0], [6, 4], [0, 4]], holes: [], floor: [[0, 0], [6, 0], [6, 4], [0, 4]], openings: [],
      rooms: [
        { zoneId: 'left', floor: [[0, 0], [3, 0], [3, 4], [0, 4]] },
        { zoneId: 'right', floor: [[3, 0], [6, 0], [6, 4], [3, 4]] },
      ],
      walls: [{ id: 'divider', points: [[3, 0], [3, 4]], thickness: 0.12, zoneIds: ['stale'] }],
    };
    const reconciled = reconcileShellWallZones(divided);
    expect(reconciled.walls?.[0].zoneIds?.sort()).toEqual(['left', 'right']);
    expect(reconciled.walls?.[0].segmentZoneIds?.[0].sort()).toEqual(['left', 'right']);
  });

  it('reports broken room mappings, wall runs, and orphaned openings', () => {
    const broken: SpatialShellConfig = {
      outer: [[0, 0], [4, 0], [4, 3], [0, 3]], holes: [], floor: [[0, 0], [4, 0], [4, 3], [0, 3]],
      rooms: [{ zoneId: 'missing', floor: [[0, 0], [0, 0], [0, 0]] }],
      walls: [{ id: 'bad', points: [[0, 0], [0, 0]], thickness: 0.12 }],
      openings: [{ id: 'lost', kind: 'door', x: 20, z: 20, width: 0.9, depth: 0.12, rotation: 0, bottom: 0, height: 2.1 }],
    };
    const codes = validateSpatialShell(broken, new Set(['living'])).map((issue) => issue.code);
    expect(codes).toEqual(expect.arrayContaining([
      'unknown-shell-room', 'invalid-shell-room-floor', 'invalid-shell-wall', 'orphan-shell-opening',
    ]));
  });
});
