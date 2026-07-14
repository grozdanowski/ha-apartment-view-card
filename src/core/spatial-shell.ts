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
