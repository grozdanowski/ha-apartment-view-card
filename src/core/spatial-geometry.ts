import type {
  OpeningConfig,
  SpatialPlan,
  SpatialRoom,
  SpatialVector3,
  SpatialVertex,
  SpatialWallSegment,
} from './config';
import { isValidSimplePolygon } from './polygon';

export interface SpatialBounds {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
  width: number;
  depth: number;
  centerX: number;
  centerZ: number;
}

export type SpatialIssueCode =
  | 'missing-vertex'
  | 'zero-length-wall'
  | 'broken-room-edge'
  | 'open-room-boundary'
  | 'invalid-room-floor'
  | 'missing-opening-wall'
  | 'oversized-opening';

export interface SpatialIssue {
  code: SpatialIssueCode;
  severity: 'error' | 'warning';
  message: string;
  roomId?: string;
  wallId?: string;
  openingId?: string;
}

export interface SpatialPoint2D {
  x: number;
  z: number;
}

const EPSILON = 0.0001;

export function spatialBounds(plan: Pick<SpatialPlan, 'vertices'>): SpatialBounds {
  if (!plan.vertices.length) {
    return { minX: 0, minZ: 0, maxX: 0, maxZ: 0, width: 0, depth: 0, centerX: 0, centerZ: 0 };
  }
  const minX = Math.min(...plan.vertices.map((vertex) => vertex.x));
  const maxX = Math.max(...plan.vertices.map((vertex) => vertex.x));
  const minZ = Math.min(...plan.vertices.map((vertex) => vertex.z));
  const maxZ = Math.max(...plan.vertices.map((vertex) => vertex.z));
  return {
    minX,
    minZ,
    maxX,
    maxZ,
    width: maxX - minX,
    depth: maxZ - minZ,
    centerX: (minX + maxX) / 2,
    centerZ: (minZ + maxZ) / 2,
  };
}

export function wallLength(wall: SpatialWallSegment, vertices: Map<string, SpatialVertex>): number {
  const start = vertices.get(wall.start);
  const end = vertices.get(wall.end);
  return start && end ? Math.hypot(end.x - start.x, end.z - start.z) : 0;
}

export function roomPolygon(plan: SpatialPlan, room: SpatialRoom): SpatialPoint2D[] | null {
  if (room.floor && room.floor.length >= 3) return room.floor.map(([x, z]) => ({ x, z }));
  const vertices = new Map(plan.vertices.map((vertex) => [vertex.id, vertex]));
  const walls = new Map(plan.walls.map((wall) => [wall.id, wall]));
  const polygon: SpatialPoint2D[] = [];
  for (const edge of room.boundary) {
    const wall = walls.get(edge.wallId);
    if (!wall) return null;
    const vertex = vertices.get(edge.reversed ? wall.end : wall.start);
    if (!vertex) return null;
    polygon.push({ x: vertex.x, z: vertex.z });
  }
  return polygon.length >= 3 ? polygon : null;
}

export function pointInPolygon(point: SpatialPoint2D, polygon: SpatialPoint2D[]): boolean {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const currentPoint = polygon[index];
    const previousPoint = polygon[previous];
    const intersects = ((currentPoint.z > point.z) !== (previousPoint.z > point.z))
      && point.x < (previousPoint.x - currentPoint.x) * (point.z - currentPoint.z)
        / ((previousPoint.z - currentPoint.z) || Number.EPSILON) + currentPoint.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

export function roomForSpatialPosition(plan: SpatialPlan, position: Pick<SpatialVector3, 'x' | 'z'>): SpatialRoom | null {
  let match: SpatialRoom | null = null;
  let smallestArea = Number.POSITIVE_INFINITY;
  plan.rooms.forEach((room) => {
    const polygon = roomPolygon(plan, room);
    if (!polygon || !pointInPolygon(position, polygon)) return;
    let area = 0;
    polygon.forEach((point, index) => {
      const next = polygon[(index + 1) % polygon.length];
      area += point.x * next.z - next.x * point.z;
    });
    area = Math.abs(area) / 2;
    if (area < smallestArea) {
      smallestArea = area;
      match = room;
    }
  });
  return match;
}

export function validateSpatialPlan(plan: SpatialPlan, openings: OpeningConfig[] = []): SpatialIssue[] {
  const issues: SpatialIssue[] = [];
  const vertices = new Map(plan.vertices.map((vertex) => [vertex.id, vertex]));
  const walls = new Map(plan.walls.map((wall) => [wall.id, wall]));
  plan.walls.forEach((wall) => {
    const start = vertices.get(wall.start);
    const end = vertices.get(wall.end);
    if (!start || !end) {
      issues.push({ code: 'missing-vertex', severity: 'error', wallId: wall.id, message: `Wall ${wall.id} has a missing endpoint.` });
    } else if (Math.hypot(end.x - start.x, end.z - start.z) < EPSILON) {
      issues.push({ code: 'zero-length-wall', severity: 'error', wallId: wall.id, message: `Wall ${wall.id} has no length.` });
    }
  });
  plan.rooms.forEach((room) => {
    if (room.floor) {
      if (!isValidSimplePolygon(room.floor)) {
        issues.push({ code: 'invalid-room-floor', severity: 'error', roomId: room.id, message: `Room ${room.id} has an invalid floor polygon.` });
      }
      return;
    }
    const oriented = room.boundary.map((edge) => {
      const wall = walls.get(edge.wallId);
      return wall ? {
        wall,
        start: edge.reversed ? wall.end : wall.start,
        end: edge.reversed ? wall.start : wall.end,
      } : null;
    });
    if (oriented.some((edge) => edge === null)) {
      issues.push({ code: 'broken-room-edge', severity: 'error', roomId: room.id, message: `Room ${room.id} references a missing wall.` });
      return;
    }
    for (let index = 0; index < oriented.length; index += 1) {
      const edge = oriented[index]!;
      const next = oriented[(index + 1) % oriented.length]!;
      if (edge.end !== next.start) {
        issues.push({
          code: 'open-room-boundary',
          severity: 'error',
          roomId: room.id,
          wallId: edge.wall.id,
          message: `Room ${room.id} has a disconnected boundary after wall ${edge.wall.id}.`,
        });
        break;
      }
    }
  });
  openings.forEach((opening) => {
    const wall = walls.get(opening.wallId);
    if (!wall) {
      issues.push({ code: 'missing-opening-wall', severity: 'error', openingId: opening.id, message: `Opening ${opening.id} is not attached to a wall.` });
      return;
    }
    const length = wallLength(wall, vertices);
    const width = opening.widthMeters ?? opening.width * length;
    if (width > length + EPSILON) {
      issues.push({
        code: 'oversized-opening',
        severity: 'error',
        wallId: wall.id,
        openingId: opening.id,
        message: `Opening ${opening.id} is wider than wall ${wall.id}.`,
      });
    }
  });
  return issues;
}
