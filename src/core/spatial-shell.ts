import type { SpatialShellConfig, SpatialShellOpening, SpatialShellWall } from './config';

export interface SpatialShellSegment {
  id: string;
  wall: SpatialShellWall;
  wallIndex: number;
  segmentIndex: number;
  start: [number, number];
  end: [number, number];
  length: number;
  thickness: number;
  rotation: number;
}

export interface AssignedShellOpening {
  opening: SpatialShellOpening;
  segment: SpatialShellSegment;
  along: number;
  distance: number;
}

export function shellSegments(shell: SpatialShellConfig): SpatialShellSegment[] {
  return (shell.walls ?? []).flatMap((wall, wallIndex) => wall.points.slice(0, -1).flatMap((start, segmentIndex) => {
    const end = wall.points[segmentIndex + 1];
    const length = Math.hypot(end[0] - start[0], end[1] - start[1]);
    if (length < 0.01) return [];
    return [{
      id: `shell:${wall.id}:${segmentIndex}`,
      wall,
      wallIndex,
      segmentIndex,
      start,
      end,
      length,
      thickness: wall.segmentThicknesses?.[segmentIndex] ?? wall.thickness ?? 0.3,
      rotation: Math.atan2(end[1] - start[1], end[0] - start[0]) * 180 / Math.PI,
    }];
  }));
}

export function angleDistance(left: number, right: number): number {
  return Math.abs(((left - right + 90) % 180 + 180) % 180 - 90);
}

/** Assign every opening to one best wall segment. This prevents duplicates at corners
 * and keeps slightly imperfect imported rotations from dropping real openings. */
export function assignShellOpenings(shell: SpatialShellConfig): AssignedShellOpening[] {
  const segments = shellSegments(shell);
  return shell.openings.flatMap((opening) => {
    let best: (AssignedShellOpening & { score: number }) | undefined;
    segments.forEach((segment) => {
      const dx = segment.end[0] - segment.start[0];
      const dz = segment.end[1] - segment.start[1];
      const ux = dx / segment.length;
      const uz = dz / segment.length;
      const relativeX = opening.x - segment.start[0];
      const relativeZ = opening.z - segment.start[1];
      const along = relativeX * ux + relativeZ * uz;
      const distance = Math.abs(relativeX * -uz + relativeZ * ux);
      const angle = angleDistance(segment.rotation, opening.rotation);
      const endAllowance = Math.max(0.2, opening.width / 2);
      const distanceAllowance = Math.max(0.35, segment.thickness * 1.5, opening.depth * 1.2);
      if (along < -endAllowance || along > segment.length + endAllowance || distance > distanceAllowance || angle > 42) return;
      const outside = Math.max(0, -along, along - segment.length);
      const score = distance + outside * 1.5 + angle * 0.012;
      if (!best || score < best.score) best = { opening, segment, along, distance, score };
    });
    return best ? [{ opening: best.opening, segment: best.segment, along: best.along, distance: best.distance }] : [];
  });
}

export function shellSegmentById(shell: SpatialShellConfig, id: string): SpatialShellSegment | undefined {
  return shellSegments(shell).find((segment) => segment.id === id);
}

function sameShellPoint(left: [number, number], right: [number, number], tolerance = 0.025): boolean {
  return Math.hypot(left[0] - right[0], left[1] - right[1]) <= tolerance;
}

function movePolygonPoint(
  polygon: [number, number][],
  from: [number, number],
  to: [number, number],
): [number, number][] {
  return polygon.map((point) => sameShellPoint(point, from) ? [to[0], to[1]] : point);
}

/** Move one shared architectural point through the entire surveyed model.
 * Floors, room boundaries, wall runs, and wall-mounted openings remain coherent. */
export function moveShellPoint(
  shell: SpatialShellConfig,
  from: [number, number],
  to: [number, number],
): SpatialShellConfig {
  const assignments = assignShellOpenings(shell).map(({ opening, segment, along }) => ({
    openingId: opening.id,
    segmentId: segment.id,
    position: segment.length > 0 ? Math.min(1, Math.max(0, along / segment.length)) : 0.5,
  }));
  const next: SpatialShellConfig = {
    ...shell,
    outer: movePolygonPoint(shell.outer, from, to),
    holes: shell.holes.map((polygon) => movePolygonPoint(polygon, from, to)),
    floor: movePolygonPoint(shell.floor, from, to),
    ...(shell.floors ? { floors: shell.floors.map((polygon) => movePolygonPoint(polygon, from, to)) } : {}),
    ...(shell.rooms ? {
      rooms: shell.rooms.map((room) => ({
        ...room,
        floor: movePolygonPoint(room.floor, from, to),
        ...(room.floors ? { floors: room.floors.map((polygon) => movePolygonPoint(polygon, from, to)) } : {}),
      })),
    } : {}),
    ...(shell.walls ? {
      walls: shell.walls.map((wall) => ({ ...wall, points: movePolygonPoint(wall.points, from, to) })),
    } : {}),
  };
  const nextSegments = new Map(shellSegments(next).map((segment) => [segment.id, segment]));
  const assignmentByOpening = new Map(assignments.map((assignment) => [assignment.openingId, assignment]));
  next.openings = shell.openings.map((opening) => {
    const assignment = assignmentByOpening.get(opening.id);
    const segment = assignment ? nextSegments.get(assignment.segmentId) : undefined;
    if (!assignment || !segment) return opening;
    return {
      ...opening,
      x: segment.start[0] + (segment.end[0] - segment.start[0]) * assignment.position,
      z: segment.start[1] + (segment.end[1] - segment.start[1]) * assignment.position,
      rotation: segment.rotation,
      depth: segment.thickness,
    };
  });
  return next;
}
