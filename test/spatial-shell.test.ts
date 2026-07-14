import { describe, expect, it } from 'vitest';
import type { SpatialShellConfig } from '../src/core/config';
import { assignShellOpenings, moveShellPoint, shellSegmentById } from '../src/core/spatial-shell';

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
});
