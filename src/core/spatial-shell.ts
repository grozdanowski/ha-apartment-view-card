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

export interface SpatialShellIssue {
  code:
    | 'invalid-shell-floor'
    | 'invalid-shell-outline'
    | 'invalid-shell-wall'
    | 'unknown-shell-room'
    | 'duplicate-shell-room'
    | 'invalid-shell-room-floor'
    | 'orphan-shell-opening'
    | 'oversized-shell-opening';
  severity: 'error' | 'warning';
  message: string;
  wallId?: string;
  openingId?: string;
  zoneId?: string;
}

function polygonArea(points: [number, number][]): number {
  return Math.abs(points.reduce((area, point, index) => {
    const next = points[(index + 1) % points.length];
    return area + point[0] * next[1] - next[0] * point[1];
  }, 0) / 2);
}

function pointInShellPolygon(point: [number, number], polygon: [number, number][]): boolean {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const current = polygon[index];
    const before = polygon[previous];
    const intersects = ((current[1] > point[1]) !== (before[1] > point[1]))
      && point[0] < (before[0] - current[0]) * (point[1] - current[1])
        / ((before[1] - current[1]) || Number.EPSILON) + current[0];
    if (intersects) inside = !inside;
  }
  return inside;
}

function polygonCentroid(points: [number, number][]): [number, number] {
  if (!points.length) return [0, 0];
  return [
    points.reduce((sum, point) => sum + point[0], 0) / points.length,
    points.reduce((sum, point) => sum + point[1], 0) / points.length,
  ];
}

/** Recompute which semantic rooms touch each physical wall segment. */
export function reconcileShellWallZones(shell: SpatialShellConfig): SpatialShellConfig {
  if (!shell.walls?.length || !shell.rooms?.length) return shell;
  const walls = shell.walls.map((wall) => {
    const segmentZoneIds = wall.points.slice(0, -1).map((start, index) => {
      const end = wall.points[index + 1];
      const dx = end[0] - start[0];
      const dz = end[1] - start[1];
      const length = Math.hypot(dx, dz);
      if (length < 0.01) return wall.segmentZoneIds?.[index] ?? [];
      const offset = Math.max(0.06, (wall.segmentThicknesses?.[index] ?? wall.thickness ?? 0.12) * 0.72);
      const middle: [number, number] = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2];
      const normal: [number, number] = [-dz / length * offset, dx / length * offset];
      const samples: [number, number][] = [
        [middle[0] + normal[0], middle[1] + normal[1]],
        [middle[0] - normal[0], middle[1] - normal[1]],
      ];
      const ids = shell.rooms!.flatMap((room) => (
        samples.some((sample) => [room.floor, ...(room.floors ?? [])].some((floor) => pointInShellPolygon(sample, floor)))
          ? [room.zoneId]
          : []
      ));
      return [...new Set(ids)];
    });
    return { ...wall, segmentZoneIds, zoneIds: [...new Set(segmentZoneIds.flat())] };
  });
  return { ...shell, walls };
}

/** Validate the exact surveyed model used by the 3D runtime. */
export function validateSpatialShell(shell: SpatialShellConfig, knownZoneIds?: Set<string>): SpatialShellIssue[] {
  const issues: SpatialShellIssue[] = [];
  const validatePolygon = (points: [number, number][], label: string, code: SpatialShellIssue['code']): void => {
    if (points.length < 3 || polygonArea(points) < 0.005) {
      issues.push({ code, severity: 'error', message: `${label} does not form a valid surface.` });
    }
  };
  validatePolygon(shell.outer, 'The apartment outline', 'invalid-shell-outline');
  validatePolygon(shell.floor, 'The apartment floor', 'invalid-shell-floor');
  shell.floors?.forEach((floor, index) => validatePolygon(floor, `Floor surface ${index + 2}`, 'invalid-shell-floor'));
  shell.holes.forEach((hole, index) => validatePolygon(hole, `Floor opening ${index + 1}`, 'invalid-shell-floor'));

  const wallIds = new Set<string>();
  (shell.walls ?? []).forEach((wall) => {
    const duplicate = wallIds.has(wall.id);
    wallIds.add(wall.id);
    const hasShortSegment = wall.points.slice(0, -1).some((point, index) => (
      Math.hypot(wall.points[index + 1][0] - point[0], wall.points[index + 1][1] - point[1]) < 0.01
    ));
    if (duplicate || wall.points.length < 2 || hasShortSegment) {
      issues.push({
        code: 'invalid-shell-wall', severity: 'error', wallId: wall.id,
        message: `Wall ${wall.id} ${duplicate ? 'uses a duplicate identifier' : 'contains a missing or zero-length segment'}.`,
      });
    }
  });

  const roomIds = new Set<string>();
  (shell.rooms ?? []).forEach((room) => {
    if (knownZoneIds && !knownZoneIds.has(room.zoneId)) {
      issues.push({ code: 'unknown-shell-room', severity: 'error', zoneId: room.zoneId, message: `Room ${room.zoneId} is not mapped to a card room.` });
    }
    if (roomIds.has(room.zoneId)) {
      issues.push({ code: 'duplicate-shell-room', severity: 'error', zoneId: room.zoneId, message: `Room ${room.zoneId} is mapped more than once.` });
    }
    roomIds.add(room.zoneId);
    const polygons = [room.floor, ...(room.floors ?? [])];
    polygons.forEach((floor, index) => {
      if (floor.length < 3 || polygonArea(floor) < 0.005) {
        issues.push({ code: 'invalid-shell-room-floor', severity: 'error', zoneId: room.zoneId, message: `${room.zoneId} floor ${index + 1} is not a valid surface.` });
        return;
      }
      if (!pointInShellPolygon(polygonCentroid(floor), shell.floor)) {
        issues.push({ code: 'invalid-shell-room-floor', severity: 'warning', zoneId: room.zoneId, message: `${room.zoneId} extends beyond the apartment floor.` });
      }
    });
  });

  const assignments = new Map(assignShellOpenings(shell).map((assignment) => [assignment.opening.id, assignment]));
  shell.openings.forEach((opening) => {
    const assignment = assignments.get(opening.id);
    if (!assignment) {
      issues.push({ code: 'orphan-shell-opening', severity: 'error', openingId: opening.id, message: `${opening.kind} ${opening.id} is not attached to a wall.` });
    } else if (opening.width > assignment.segment.length + 0.001) {
      issues.push({
        code: 'oversized-shell-opening', severity: 'error', openingId: opening.id, wallId: assignment.segment.id,
        message: `${opening.kind} ${opening.id} is wider than its wall segment.`,
      });
    }
  });
  return issues;
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

function nextShellWallId(shell: SpatialShellConfig, base = 'wall'): string {
  const ids = new Set((shell.walls ?? []).map((wall) => wall.id));
  let index = 1;
  while (ids.has(`${base}-${index}`)) index += 1;
  return `${base}-${index}`;
}

/** Add an editable wall run and map it to the room surfaces on either side. */
export function addShellWall(
  shell: SpatialShellConfig,
  start: [number, number],
  end: [number, number],
): SpatialShellConfig {
  if (Math.hypot(end[0] - start[0], end[1] - start[1]) < 0.05) return shell;
  const duplicate = shellSegments(shell).some((segment) => (
    (sameShellPoint(segment.start, start) && sameShellPoint(segment.end, end))
    || (sameShellPoint(segment.start, end) && sameShellPoint(segment.end, start))
  ));
  if (duplicate) return shell;
  return reconcileShellWallZones({
    ...shell,
    walls: [...(shell.walls ?? []), {
      id: nextShellWallId(shell, 'wall'),
      points: [[...start], [...end]],
      thickness: 0.12,
      smooth: false,
      zoneIds: [],
    }],
  });
}

/** Remove one physical segment, splitting a longer wall run around the new gap. */
export function removeShellWallSegment(shell: SpatialShellConfig, segmentId: string): SpatialShellConfig {
  const segment = shellSegmentById(shell, segmentId);
  if (!segment || !shell.walls) return shell;
  const assignments = assignShellOpenings(shell);
  const removedOpeningIds = new Set(assignments
    .filter((assignment) => assignment.segment.id === segmentId)
    .map((assignment) => assignment.opening.id));
  const source = segment.wall;
  const before = source.points.slice(0, segment.segmentIndex + 1);
  const after = source.points.slice(segment.segmentIndex + 1);
  const thicknesses = source.segmentThicknesses;
  const zoneIds = source.segmentZoneIds;
  const runs: SpatialShellWall[] = [];
  if (before.length >= 2) runs.push({
    ...source,
    points: before,
    ...(thicknesses ? { segmentThicknesses: thicknesses.slice(0, segment.segmentIndex) } : {}),
    ...(zoneIds ? { segmentZoneIds: zoneIds.slice(0, segment.segmentIndex) } : {}),
  });
  if (after.length >= 2) runs.push({
    ...source,
    id: runs.length ? nextShellWallId({ ...shell, walls: [...shell.walls, ...runs] }, `${source.id}-split`) : source.id,
    points: after,
    ...(thicknesses ? { segmentThicknesses: thicknesses.slice(segment.segmentIndex + 1) } : {}),
    ...(zoneIds ? { segmentZoneIds: zoneIds.slice(segment.segmentIndex + 1) } : {}),
  });
  return reconcileShellWallZones({
    ...shell,
    walls: shell.walls.flatMap((wall, index) => index === segment.wallIndex ? runs : [wall]),
    openings: shell.openings.filter((opening) => !removedOpeningIds.has(opening.id)),
  });
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
  return reconcileShellWallZones(next);
}
