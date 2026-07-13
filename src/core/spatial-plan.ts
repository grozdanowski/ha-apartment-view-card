import {
  CURRENT_SPATIAL_VERSION,
  type SpatialPlan,
  type SpatialRoom,
  type SpatialRoomBoundary,
  type SpatialObject,
  type SpatialVertex,
  type SpatialWallSegment,
} from './config';

export interface SpatialPlanPoint {
  x: number;
  z: number;
}

function nextId(prefix: string, ids: Iterable<string>): string {
  const used = new Set(ids);
  let index = 1;
  while (used.has(`${prefix}-${index}`)) index += 1;
  return `${prefix}-${index}`;
}

interface DirectedWall {
  key: string;
  wallId: string;
  from: string;
  to: string;
  reversed: boolean;
  angle: number;
}

function boundaryKey(boundary: SpatialRoomBoundary[]): string {
  return [...boundary].map((edge) => edge.wallId).sort().join('|');
}

/** Rebuild every enclosed face from the shared wall graph. */
export function deriveSpatialRooms(plan: SpatialPlan): SpatialRoom[] {
  const vertices = new Map(plan.vertices.map((vertex) => [vertex.id, vertex]));
  const outgoing = new Map<string, DirectedWall[]>();
  const directed: DirectedWall[] = [];
  plan.walls.forEach((wall) => {
    const start = vertices.get(wall.start);
    const end = vertices.get(wall.end);
    if (!start || !end || (start.x === end.x && start.z === end.z)) return;
    const forward: DirectedWall = {
      key: `${wall.id}:forward`, wallId: wall.id, from: wall.start, to: wall.end, reversed: false,
      angle: Math.atan2(end.z - start.z, end.x - start.x),
    };
    const reverse: DirectedWall = {
      key: `${wall.id}:reverse`, wallId: wall.id, from: wall.end, to: wall.start, reversed: true,
      angle: Math.atan2(start.z - end.z, start.x - end.x),
    };
    directed.push(forward, reverse);
    outgoing.set(forward.from, [...(outgoing.get(forward.from) ?? []), forward]);
    outgoing.set(reverse.from, [...(outgoing.get(reverse.from) ?? []), reverse]);
  });
  outgoing.forEach((edges) => edges.sort((a, b) => a.angle - b.angle));

  const visited = new Set<string>();
  const detected: SpatialRoomBoundary[][] = [];
  directed.forEach((startEdge) => {
    if (visited.has(startEdge.key)) return;
    const boundary: SpatialRoomBoundary[] = [];
    const polygon: SpatialVertex[] = [];
    let edge: DirectedWall | undefined = startEdge;
    let closed = false;
    for (let guard = 0; edge && guard <= directed.length; guard += 1) {
      if (visited.has(edge.key)) {
        closed = edge.key === startEdge.key;
        break;
      }
      visited.add(edge.key);
      boundary.push({ wallId: edge.wallId, reversed: edge.reversed });
      const point = vertices.get(edge.from);
      if (point) polygon.push(point);
      const current = edge;
      const candidates: DirectedWall[] = outgoing.get(current.to) ?? [];
      const reverseIndex = candidates.findIndex((candidate: DirectedWall) => candidate.wallId === current.wallId && candidate.to === current.from);
      if (reverseIndex < 0 || !candidates.length) break;
      const nextEdge = candidates[(reverseIndex - 1 + candidates.length) % candidates.length];
      if (nextEdge.key === startEdge.key) {
        closed = true;
        break;
      }
      edge = nextEdge;
    }
    if (!closed || boundary.length < 3 || new Set(polygon.map((point) => point.id)).size !== polygon.length) return;
    const signedArea = polygon.reduce((area, point, index) => {
      const next = polygon[(index + 1) % polygon.length];
      return area + point.x * next.z - next.x * point.z;
    }, 0) / 2;
    if (signedArea > 0.0001) detected.push(boundary);
  });

  const existing = new Map(plan.rooms.map((room) => [boundaryKey(room.boundary), room]));
  const usedIds = new Set<string>();
  return detected.map((boundary) => {
    const match = existing.get(boundaryKey(boundary));
    let id = match?.id ?? nextId('room', [...plan.rooms.map((room) => room.id), ...usedIds]);
    if (usedIds.has(id)) id = nextId('room', [...plan.rooms.map((room) => room.id), ...usedIds]);
    usedIds.add(id);
    return {
      id,
      boundary,
      floorFinish: match?.floorFinish ?? 'wood',
      ...(match?.zoneId ? { zoneId: match.zoneId } : {}),
      ...(match?.floorColor ? { floorColor: match.floorColor } : {}),
    };
  });
}

export function withDerivedSpatialRooms(plan: SpatialPlan): SpatialPlan {
  return { ...plan, rooms: deriveSpatialRooms(plan) };
}

export function emptySpatialPlan(): SpatialPlan {
  return { version: CURRENT_SPATIAL_VERSION, vertices: [], walls: [], rooms: [], objects: [] };
}

export function rectangularSpatialPlan(width = 8, depth = 6): SpatialPlan {
  const safeWidth = Math.max(1, width);
  const safeDepth = Math.max(1, depth);
  return {
    version: CURRENT_SPATIAL_VERSION,
    vertices: [
      { id: 'vertex-1', x: 0, z: 0 },
      { id: 'vertex-2', x: safeWidth, z: 0 },
      { id: 'vertex-3', x: safeWidth, z: safeDepth },
      { id: 'vertex-4', x: 0, z: safeDepth },
    ],
    walls: [
      { id: 'wall-1', start: 'vertex-1', end: 'vertex-2', thickness: 0.18, curve: 0 },
      { id: 'wall-2', start: 'vertex-2', end: 'vertex-3', thickness: 0.18, curve: 0 },
      { id: 'wall-3', start: 'vertex-3', end: 'vertex-4', thickness: 0.18, curve: 0 },
      { id: 'wall-4', start: 'vertex-4', end: 'vertex-1', thickness: 0.18, curve: 0 },
    ],
    rooms: [{
      id: 'room-1',
      boundary: [
        { wallId: 'wall-1', reversed: false },
        { wallId: 'wall-2', reversed: false },
        { wallId: 'wall-3', reversed: false },
        { wallId: 'wall-4', reversed: false },
      ],
      floorFinish: 'wood',
    }],
    objects: [],
  };
}

export function snapSpatialPoint(point: SpatialPlanPoint, step = 0.1): SpatialPlanPoint {
  const safeStep = Math.max(0.001, step);
  return {
    x: Math.round(point.x / safeStep) * safeStep,
    z: Math.round(point.z / safeStep) * safeStep,
  };
}

export function nearestSpatialVertex(
  plan: SpatialPlan,
  point: SpatialPlanPoint,
  threshold = 0.2,
): SpatialVertex | null {
  let nearest: SpatialVertex | null = null;
  let distance = threshold;
  plan.vertices.forEach((vertex) => {
    const candidate = Math.hypot(vertex.x - point.x, vertex.z - point.z);
    if (candidate <= distance) {
      distance = candidate;
      nearest = vertex;
    }
  });
  return nearest;
}

export function addSpatialVertex(plan: SpatialPlan, point: SpatialPlanPoint): { plan: SpatialPlan; vertex: SpatialVertex } {
  const vertex: SpatialVertex = {
    id: nextId('vertex', plan.vertices.map((item) => item.id)),
    x: point.x,
    z: point.z,
  };
  return { plan: { ...plan, vertices: [...plan.vertices, vertex] }, vertex };
}

export function moveSpatialVertex(plan: SpatialPlan, vertexId: string, point: SpatialPlanPoint): SpatialPlan {
  return withDerivedSpatialRooms({
    ...plan,
    vertices: plan.vertices.map((vertex) => vertex.id === vertexId ? { ...vertex, ...point } : vertex),
  });
}

export function addSpatialWall(
  plan: SpatialPlan,
  start: string,
  end: string,
  patch: Partial<Pick<SpatialWallSegment, 'thickness' | 'curve' | 'height'>> = {},
): SpatialPlan {
  if (start === end || !plan.vertices.some((vertex) => vertex.id === start) || !plan.vertices.some((vertex) => vertex.id === end)) return plan;
  const duplicate = plan.walls.some((wall) => (
    (wall.start === start && wall.end === end) || (wall.start === end && wall.end === start)
  ));
  if (duplicate) return plan;
  const wall: SpatialWallSegment = {
    id: nextId('wall', plan.walls.map((item) => item.id)),
    start,
    end,
    thickness: patch.thickness ?? 0.12,
    curve: patch.curve ?? 0,
    ...(patch.height !== undefined ? { height: patch.height } : {}),
  };
  return withDerivedSpatialRooms({ ...plan, walls: [...plan.walls, wall] });
}

export function removeSpatialWall(plan: SpatialPlan, wallId: string): SpatialPlan {
  return withDerivedSpatialRooms({
    ...plan,
    walls: plan.walls.filter((wall) => wall.id !== wallId),
  });
}

export function updateSpatialWall(
  plan: SpatialPlan,
  wallId: string,
  patch: Partial<Pick<SpatialWallSegment, 'thickness' | 'curve' | 'height'>>,
): SpatialPlan {
  return {
    ...plan,
    walls: plan.walls.map((wall) => wall.id === wallId ? { ...wall, ...patch } : wall),
  };
}

export function addSpatialObject(
  plan: SpatialPlan,
  kind: string,
  position: SpatialPlanPoint = { x: 0, z: 0 },
  patch: Partial<Omit<SpatialObject, 'id' | 'kind' | 'position' | 'rotation' | 'scale'>> = {},
): SpatialPlan {
  const object: SpatialObject = {
    id: nextId(kind || 'object', plan.objects.map((item) => item.id)),
    kind: kind || 'cabinet',
    position: { x: position.x, y: 0, z: position.z },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    ...patch,
  };
  return { ...plan, objects: [...plan.objects, object] };
}

export function updateSpatialObject(plan: SpatialPlan, objectId: string, patch: Partial<SpatialObject>): SpatialPlan {
  return {
    ...plan,
    objects: plan.objects.map((item) => item.id === objectId ? {
      ...item,
      ...patch,
      position: patch.position ? { ...item.position, ...patch.position } : item.position,
      rotation: patch.rotation ? { ...item.rotation, ...patch.rotation } : item.rotation,
      scale: patch.scale ? { ...item.scale, ...patch.scale } : item.scale,
    } : item),
  };
}

export function removeSpatialObject(plan: SpatialPlan, objectId: string): SpatialPlan {
  return { ...plan, objects: plan.objects.filter((item) => item.id !== objectId) };
}
