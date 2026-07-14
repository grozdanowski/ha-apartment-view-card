import type { LabelConfig, LabelDefaults, LabelSource } from './label';
import { DEFAULT_LABELS, VALID_LABEL_SOURCES, VALID_LABEL_VISIBILITIES } from './label';

export type LightStyle = 'lit' | 'reveal' | 'glow';
export type SizeTier = 'tiny' | 'small' | 'medium' | 'large' | 'huge';
export type TapAction = 'toggle' | 'more-info' | 'none';
export type WheelMode = 'modifier' | 'plain';
export type PresentationPreset = 'calm' | 'informative' | 'control-heavy';
export type SpatialLightingMode = 'realistic' | 'balanced' | 'presentation';
export type MarkerVisibility = 'auto' | 'always' | 'active' | 'attention' | 'hidden';
export type WallSide = 'top' | 'right' | 'bottom' | 'left';
export type OpeningKind = 'door' | 'window';
export type SpatialMount = 'floor' | 'wall' | 'ceiling' | 'surface' | 'free';
export type SpatialFloorFinish = 'wood' | 'tile' | 'stone' | 'carpet' | 'custom';

export const CURRENT_MODEL_VERSION = 6;
export const CURRENT_SPATIAL_VERSION = 1;

export interface SpatialVector3 {
  /** Horizontal position in metres along the plan's x-axis. */
  x: number;
  /** Height above finished floor level in metres. */
  y: number;
  /** Horizontal position in metres along the plan's z-axis. */
  z: number;
}

export interface SpatialRotation {
  /** Pitch in degrees. */
  x: number;
  /** Yaw in degrees. */
  y: number;
  /** Roll in degrees. */
  z: number;
}

export interface SpatialPlacement {
  position: SpatialVector3;
  rotation: SpatialRotation;
  mount: SpatialMount;
  /** Wall, room, or furniture id used for semantic snapping. */
  parentId?: string;
  /** A bound object can carry state without rendering a separate marker. */
  visible: boolean;
}

export interface SpatialVertex {
  id: string;
  x: number;
  z: number;
}

export interface SpatialWallSegment {
  id: string;
  start: string;
  end: string;
  /** Wall thickness in metres. */
  thickness: number;
  /** Signed arch amount. -1 bends left, +1 bends right. */
  curve: number;
  /** Optional per-wall override; otherwise the plan wall height is used. */
  height?: number;
}

export interface SpatialRoomBoundary {
  wallId: string;
  reversed: boolean;
}

export interface SpatialRoom {
  id: string;
  /** Existing card zone / Home Assistant room relationship. */
  zoneId?: string;
  boundary: SpatialRoomBoundary[];
  floorFinish: SpatialFloorFinish;
  floorColor?: string;
}

export interface SpatialObject {
  id: string;
  kind: string;
  name?: string;
  zoneId?: string;
  modelUrl?: string;
  position: SpatialVector3;
  rotation: SpatialRotation;
  scale: SpatialVector3;
  /** Optional entity whose state is represented by this object. */
  entityId?: string;
  /** Built-in catalog design and selected material finish. */
  assetId?: string;
  finishId?: string;
}

export interface SpatialShellOpening {
  id: string;
  kind: OpeningKind;
  x: number;
  z: number;
  width: number;
  depth: number;
  rotation: number;
  bottom: number;
  height: number;
  /** Solid panel color used when this opening is a door. */
  color?: string;
}

export interface SpatialShellWall {
  id: string;
  points: [number, number][];
  thickness?: number;
  smooth?: boolean;
  zoneIds?: string[];
  segmentZoneIds?: string[][];
  segmentThicknesses?: number[];
}

export interface SpatialShellRoom {
  zoneId: string;
  floor: [number, number][];
  floors?: [number, number][][];
  finish?: SpatialFloorFinish;
  color?: string;
}

/** Exact survey geometry, used when a simple wall graph would lose fidelity. */
export interface SpatialShellConfig {
  outer: [number, number][];
  holes: [number, number][][];
  floor: [number, number][];
  floors?: [number, number][][];
  rooms?: SpatialShellRoom[];
  walls?: SpatialShellWall[];
  openings: SpatialShellOpening[];
}

export interface SpatialPlan {
  version: number;
  vertices: SpatialVertex[];
  walls: SpatialWallSegment[];
  rooms: SpatialRoom[];
  objects: SpatialObject[];
}

/** Input-behavior toggles (spec v2.5 §7). All optional in YAML; defaulted here. */
export interface InteractionOptions {
  /** 'modifier' (default): ctrl/cmd-wheel zooms, plain wheel scrolls the page.
   *  'plain': v2.4 behavior — wheel always zooms (kiosks / wall tablets). */
  wheel: WheelMode;
  /** Scene double-tap toggle-zoom. */
  doubleTapZoom: boolean;
  /** Horizontal swipe between zones while focused. */
  roomSwipe: boolean;
  /** Flick deceleration when free-zoomed (auto-off under reduced motion). */
  inertia: boolean;
}

export interface EntityConfig {
  entity: string;
  name?: string;
  icon?: string;
  x: number;
  y: number;
  size: SizeTier;
  tap: TapAction;
  orientation: number | null;
  lightStyle?: LightStyle;
  /** Emit procedural floor-light when active. Defaults to true for `light.*`
   *  entities, false otherwise — set true for a switch/plug driving a lamp,
   *  or false to silence a light. (Fixes non-lights — climate/media/fan —
   *  glowing on the floorplan when merely "active".) */
  light?: boolean;
  label?: LabelConfig;
  /** Stable room relationship. Geometry remains the migration fallback. */
  zoneId?: string;
  /** Optional per-context marker visibility overrides. */
  overviewVisibility?: MarkerVisibility;
  roomVisibility?: MarkerVisibility;
  /** Optional physical placement used by the 3D renderer. */
  spatial?: SpatialPlacement;
}

export interface ZoneConfig {
  /** Stable internal identity, independent of display name. */
  id?: string;
  /** Home Assistant Area registry id, when this room is linked to an Area. */
  areaId?: string;
  name: string;
  icon?: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OpeningConfig {
  id: string;
  kind: OpeningKind;
  /** `${zoneId}:${side}`; stable across room renames and geometry edits. */
  wallId: string;
  /** Opening center along the wall, from 0 to 1. */
  position: number;
  /** Opening width as a fraction of the wall length. */
  width: number;
  /** Physical opening width in metres for wall-graph plans. */
  widthMeters?: number;
  /** Physical opening height in metres. */
  height?: number;
  /** Height above finished floor level in metres. */
  bottom?: number;
  /** Door hinge side when viewed from the wall's start vertex. */
  hinge?: 'left' | 'right';
  /** Signed door swing direction. */
  swing?: 'in' | 'out';
  /** Solid panel color used when this opening is a door. */
  color?: string;
}

export interface WallConfig {
  /** `${zoneId}:${side}`; matches openings and survives room renames. */
  wallId: string;
  /** Signed arch amount. -1 bends inward, +1 outward, 0 is straight. */
  curve: number;
}

export interface SiteConfig {
  /** Clockwise rotation from the top of the floorplan to true north. */
  north: number;
  /** Optional override; the editor otherwise uses Home Assistant's location. */
  latitude?: number;
  longitude?: number;
}

export interface SpatialDimensions {
  /** Real apartment width represented by the floorplan image. */
  width: number;
  /** Floorplan image width divided by image height. */
  aspectRatio: number;
  /** Finished floor-to-ceiling height. */
  wallHeight: number;
}

export interface SpatialConfig {
  openings: OpeningConfig[];
  walls: WallConfig[];
  site: SiteConfig;
  dimensions: SpatialDimensions;
  /** Authoritative editable architecture; absent configs use legacy zones. */
  plan?: SpatialPlan;
  /** Optional exact survey mesh. The plan remains the editable semantic model. */
  shell?: SpatialShellConfig;
}

export interface ImagesConfig {
  base: string;
  allLights?: string;
  night?: string;
  duskDawn?: string;
}

export interface CardOptions {
  view: 'auto' | 'day' | 'night' | 'duskDawn';
  lightStyle: LightStyle;
  /** Keep architectural walls at 10% height in the apartment overview. */
  hideWalls: boolean;
  freePanZoom: boolean;
  zoomMax: number;
  duskDawnOffsetMinutes: number;
  labels: LabelDefaults;
  /** Marker size (px) at overview (zoom = 1). */
  iconSize: number;
  /** Max marker size (px) when zoomed in — icons grow with zoom but never beyond this. */
  iconSizeMax: number;
  /** Mobile-screen overrides (viewport ≤ 768px). Fall back to the desktop
   *  values above when unset, so a single number stays valid. */
  iconSizeMobile?: number;
  iconSizeMaxMobile?: number;
  /** Mobile-screen floorplan frame aspect (width/height), applied only under
   *  the mobile breakpoint. A wide floorplan renders as a short box at
   *  width:100%; a taller frame (default 4/5 = 0.8) gives the plan real
   *  vertical space. The whole floorplan is CONTAINED in the taller box — it
   *  keeps its natural aspect, fills the width minus a small cushion, and is
   *  centered vertically (extra height becomes top/bottom breathing room).
   *  Nothing is cropped and nothing is up-scaled — every edge and every marker
   *  stays visible. Accepts a "w/h" string ("4/5", "1/1", "3/4") or a bare
   *  number; stored as the numeric width/height ratio. Markers stay pinned
   *  (the coordinate box is the contained plan; viewport math is unchanged). */
  aspectMobile: number;
  /** A weather.* entity to drive a subtle ambient tint over the floorplan. */
  weatherEntity?: string;
  /** Optional outdoor illuminance sensor. Outdoor lx is auto-detected when possible. */
  illuminanceEntity?: string;
  /** How faithfully the 3D scene follows low real-world light levels. */
  spatialLightingMode: SpatialLightingMode;
  /** Input-behavior toggles (spec v2.5 §7). */
  interaction: InteractionOptions;
  /** Seconds of inactivity before returning to overview; 0 = off (wall tablets). */
  idleTimeout: number;
  /** High-level information-density policy for the floorplan. */
  presentation?: PresentationPreset;
}

export interface QuickAction {
  name: string;
  icon?: string;
  /** A scene/script/etc. to activate (homeassistant.turn_on), when no explicit service. */
  entity?: string;
  /** An explicit "domain.service" call. */
  service?: string;
  /** Service data / target for `service`. */
  data?: Record<string, unknown>;
}

export interface FloorConfig {
  name: string;
  icon?: string;
  images: ImagesConfig;
  entities: EntityConfig[];
  zones: ZoneConfig[];
  spatial?: SpatialConfig;
}

export interface ApartmentViewConfig {
  modelVersion?: number;
  type: string;
  images: ImagesConfig;
  entities: EntityConfig[];
  zones: ZoneConfig[];
  options: CardOptions;
  quickActions: QuickAction[];
  spatial?: SpatialConfig;
  /** Optional multi-floor. When non-empty, each floor has its own images/entities/zones;
   *  the top-level images/entities/zones mirror floor 0 for backward-compatible reads. */
  floors?: FloorConfig[];
}

const CARD_TYPE = 'custom:apartment-view-card';

const VALID_SIZES: readonly SizeTier[] = [
  'tiny',
  'small',
  'medium',
  'large',
  'huge',
];
const VALID_TAPS: readonly TapAction[] = ['toggle', 'more-info', 'none'];
const VALID_STYLES: readonly LightStyle[] = ['lit', 'reveal', 'glow'];
const VALID_VIEWS: readonly CardOptions['view'][] = [
  'auto',
  'day',
  'night',
  'duskDawn',
];
const VALID_WHEEL_MODES: readonly WheelMode[] = ['modifier', 'plain'];
const VALID_PRESENTATIONS: readonly PresentationPreset[] = ['calm', 'informative', 'control-heavy'];
const VALID_SPATIAL_LIGHTING_MODES: readonly SpatialLightingMode[] = ['realistic', 'balanced', 'presentation'];
const VALID_MARKER_VISIBILITIES: readonly MarkerVisibility[] = [
  'auto',
  'always',
  'active',
  'attention',
  'hidden',
];
const VALID_WALL_SIDES: readonly WallSide[] = ['top', 'right', 'bottom', 'left'];
const VALID_OPENING_KINDS: readonly OpeningKind[] = ['door', 'window'];
const VALID_SPATIAL_MOUNTS: readonly SpatialMount[] = ['floor', 'wall', 'ceiling', 'surface', 'free'];
const VALID_FLOOR_FINISHES: readonly SpatialFloorFinish[] = ['wood', 'tile', 'stone', 'carpet', 'custom'];

function slugId(value: string, fallback: string): string {
  const slug = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || fallback;
}

function uniqueId(base: string, used: Set<string>): string {
  let value = base;
  let suffix = 2;
  while (used.has(value)) value = `${base}-${suffix++}`;
  used.add(value);
  return value;
}

/** Create a stable, human-readable room id for editor-authored rooms. */
export function roomIdFor(name: string, zones: ZoneConfig[]): string {
  const used = new Set(zones.map((zone) => zone.id).filter((id): id is string => Boolean(id)));
  return uniqueId(slugId(name, `room-${zones.length + 1}`), used);
}

export function wallIdFor(zoneId: string, side: WallSide): string {
  return `${zoneId}:${side}`;
}

export function wallParts(wallId: string): { zoneId: string; side: WallSide } | null {
  const separator = wallId.lastIndexOf(':');
  if (separator <= 0) return null;
  const zoneId = wallId.slice(0, separator);
  const side = wallId.slice(separator + 1) as WallSide;
  return VALID_WALL_SIDES.includes(side) ? { zoneId, side } : null;
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

function normalizeSpatialVector(
  raw: any,
  fallback: SpatialVector3,
  min = -1000,
  max = 1000,
): SpatialVector3 {
  return {
    x: clamp(raw?.x, min, max, fallback.x),
    y: clamp(raw?.y, min, max, fallback.y),
    z: clamp(raw?.z, min, max, fallback.z),
  };
}

function normalizeSpatialRotation(raw: any): SpatialRotation {
  return {
    x: clamp(raw?.x, -360, 360, 0),
    y: clamp(raw?.y, -360, 360, 0),
    z: clamp(raw?.z, -360, 360, 0),
  };
}

function normalizeSpatialPlacement(raw: any): SpatialPlacement | undefined {
  if (!raw || typeof raw !== 'object' || !raw.position || typeof raw.position !== 'object') return undefined;
  const placement: SpatialPlacement = {
    position: normalizeSpatialVector(raw.position, { x: 0, y: 0, z: 0 }),
    rotation: normalizeSpatialRotation(raw.rotation),
    mount: VALID_SPATIAL_MOUNTS.includes(raw.mount) ? raw.mount : 'free',
    visible: typeof raw.visible === 'boolean' ? raw.visible : true,
  };
  if (typeof raw.parentId === 'string' && raw.parentId.length) placement.parentId = raw.parentId;
  return placement;
}

function normalizeSpatialPlan(raw: any, zoneIds: Set<string>): SpatialPlan | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const usedVertices = new Set<string>();
  const vertexIdMap = new Map<string, string>();
  const vertices: SpatialVertex[] = (Array.isArray(raw.vertices) ? raw.vertices : [])
    .map((item: any, index: number): SpatialVertex | null => {
      if (!Number.isFinite(item?.x) || !Number.isFinite(item?.z)) return null;
      const sourceId = typeof item.id === 'string' ? item.id : `vertex-${index + 1}`;
      const id = uniqueId(slugId(sourceId, `vertex-${index + 1}`), usedVertices);
      if (!vertexIdMap.has(sourceId)) vertexIdMap.set(sourceId, id);
      return { id, x: clamp(item.x, -1000, 1000, 0), z: clamp(item.z, -1000, 1000, 0) };
    })
    .filter((vertex: SpatialVertex | null): vertex is SpatialVertex => vertex !== null);
  const vertexIds = new Set(vertices.map((vertex) => vertex.id));
  const usedWalls = new Set<string>();
  const wallIdMap = new Map<string, string>();
  const walls: SpatialWallSegment[] = (Array.isArray(raw.walls) ? raw.walls : [])
    .map((item: any, index: number): SpatialWallSegment | null => {
      const start = vertexIdMap.get(item?.start) ?? item?.start;
      const end = vertexIdMap.get(item?.end) ?? item?.end;
      if (!vertexIds.has(start) || !vertexIds.has(end) || start === end) return null;
      const sourceId = typeof item.id === 'string' ? item.id : `wall-${index + 1}`;
      const id = uniqueId(slugId(sourceId, `wall-${index + 1}`), usedWalls);
      if (!wallIdMap.has(sourceId)) wallIdMap.set(sourceId, id);
      const wall: SpatialWallSegment = {
        id,
        start,
        end,
        thickness: clamp(item.thickness, 0.03, 2, 0.12),
        curve: clamp(item.curve, -1, 1, 0),
      };
      if (Number.isFinite(item.height)) wall.height = clamp(item.height, 0.2, 10, 2.6);
      return wall;
    })
    .filter((wall: SpatialWallSegment | null): wall is SpatialWallSegment => wall !== null);
  const wallIds = new Set(walls.map((wall) => wall.id));
  const usedRooms = new Set<string>();
  const rooms: SpatialRoom[] = (Array.isArray(raw.rooms) ? raw.rooms : [])
    .map((item: any, index: number): SpatialRoom | null => {
      const boundary = (Array.isArray(item?.boundary) ? item.boundary : [])
        .map((edge: any) => ({ ...edge, wallId: wallIdMap.get(edge?.wallId) ?? edge?.wallId }))
        .filter((edge: any) => wallIds.has(edge?.wallId))
        .map((edge: any): SpatialRoomBoundary => ({ wallId: edge.wallId, reversed: Boolean(edge.reversed) }));
      if (boundary.length < 3) return null;
      const id = uniqueId(slugId(typeof item.id === 'string' ? item.id : `room-${index + 1}`, `room-${index + 1}`), usedRooms);
      const room: SpatialRoom = {
        id,
        boundary,
        floorFinish: VALID_FLOOR_FINISHES.includes(item.floorFinish) ? item.floorFinish : 'wood',
      };
      if (typeof item.zoneId === 'string' && zoneIds.has(item.zoneId)) room.zoneId = item.zoneId;
      if (typeof item.floorColor === 'string' && item.floorColor.length) room.floorColor = item.floorColor;
      return room;
    })
    .filter((room: SpatialRoom | null): room is SpatialRoom => room !== null);
  const usedObjects = new Set<string>();
  const objects: SpatialObject[] = (Array.isArray(raw.objects) ? raw.objects : [])
    .map((item: any, index: number): SpatialObject | null => {
      if (typeof item?.kind !== 'string' || !item.kind.length) return null;
      const id = uniqueId(slugId(typeof item.id === 'string' ? item.id : `object-${index + 1}`, `object-${index + 1}`), usedObjects);
      const object: SpatialObject = {
        id,
        kind: item.kind,
        position: normalizeSpatialVector(item.position, { x: 0, y: 0, z: 0 }),
        rotation: normalizeSpatialRotation(item.rotation),
        scale: normalizeSpatialVector(item.scale, { x: 1, y: 1, z: 1 }, 0.05, 20),
      };
      if (typeof item.name === 'string' && item.name.length) object.name = item.name;
      if (typeof item.zoneId === 'string' && zoneIds.has(item.zoneId)) object.zoneId = item.zoneId;
      if (typeof item.modelUrl === 'string' && item.modelUrl.length) object.modelUrl = item.modelUrl;
      if (typeof item.entityId === 'string' && item.entityId.length) object.entityId = item.entityId;
      if (typeof item.assetId === 'string' && item.assetId.length) object.assetId = item.assetId;
      if (typeof item.finishId === 'string' && item.finishId.length) object.finishId = item.finishId;
      return object;
    })
    .filter((object: SpatialObject | null): object is SpatialObject => object !== null);
  return {
    version: CURRENT_SPATIAL_VERSION,
    vertices,
    walls,
    rooms,
    objects,
  };
}

function normalizeShellPoint(raw: any): [number, number] | null {
  if (!Array.isArray(raw) || !Number.isFinite(raw[0]) || !Number.isFinite(raw[1])) return null;
  return [clamp(raw[0], -1000, 1000, 0), clamp(raw[1], -1000, 1000, 0)];
}

function normalizeShellPolygon(raw: any): [number, number][] {
  return (Array.isArray(raw) ? raw : [])
    .map(normalizeShellPoint)
    .filter((point: [number, number] | null): point is [number, number] => point !== null);
}

function normalizeSpatialShell(raw: any, zoneIds: Set<string>): SpatialShellConfig | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const outer = normalizeShellPolygon(raw.outer);
  const floor = normalizeShellPolygon(raw.floor);
  if (outer.length < 3 && floor.length < 3) return undefined;
  const holes = (Array.isArray(raw.holes) ? raw.holes : [])
    .map(normalizeShellPolygon)
    .filter((polygon: [number, number][]) => polygon.length >= 3);
  const floors = (Array.isArray(raw.floors) ? raw.floors : [])
    .map(normalizeShellPolygon)
    .filter((polygon: [number, number][]) => polygon.length >= 3);
  const rooms: SpatialShellRoom[] = (Array.isArray(raw.rooms) ? raw.rooms : [])
    .map((item: any): SpatialShellRoom | null => {
      if (typeof item?.zoneId !== 'string' || !zoneIds.has(item.zoneId)) return null;
      const roomFloor = normalizeShellPolygon(item.floor);
      if (roomFloor.length < 3) return null;
      const room: SpatialShellRoom = { zoneId: item.zoneId, floor: roomFloor };
      const roomFloors = (Array.isArray(item.floors) ? item.floors : [])
        .map(normalizeShellPolygon)
        .filter((polygon: [number, number][]) => polygon.length >= 3);
      if (roomFloors.length) room.floors = roomFloors;
      if (VALID_FLOOR_FINISHES.includes(item.finish)) room.finish = item.finish;
      if (typeof item.color === 'string' && item.color.length) room.color = item.color;
      return room;
    })
    .filter((room: SpatialShellRoom | null): room is SpatialShellRoom => room !== null);
  const usedWalls = new Set<string>();
  const walls: SpatialShellWall[] = (Array.isArray(raw.walls) ? raw.walls : [])
    .map((item: any, index: number): SpatialShellWall | null => {
      const points = normalizeShellPolygon(item?.points);
      if (points.length < 2) return null;
      const wall: SpatialShellWall = {
        id: uniqueId(slugId(typeof item.id === 'string' ? item.id : `survey-wall-${index + 1}`, `survey-wall-${index + 1}`), usedWalls),
        points,
      };
      if (Number.isFinite(item.thickness)) wall.thickness = clamp(item.thickness, 0.03, 2, 0.12);
      if (typeof item.smooth === 'boolean') wall.smooth = item.smooth;
      if (Array.isArray(item.zoneIds)) wall.zoneIds = item.zoneIds.filter((id: unknown): id is string => typeof id === 'string' && zoneIds.has(id));
      if (Array.isArray(item.segmentZoneIds)) wall.segmentZoneIds = item.segmentZoneIds.map((ids: unknown) => Array.isArray(ids) ? ids.filter((id: unknown): id is string => typeof id === 'string' && zoneIds.has(id)) : []);
      if (Array.isArray(item.segmentThicknesses)) wall.segmentThicknesses = item.segmentThicknesses.map((value: unknown) => clamp(value, 0.03, 2, wall.thickness ?? 0.12));
      return wall;
    })
    .filter((wall: SpatialShellWall | null): wall is SpatialShellWall => wall !== null);
  const usedOpenings = new Set<string>();
  const openings: SpatialShellOpening[] = (Array.isArray(raw.openings) ? raw.openings : [])
    .map((item: any, index: number): SpatialShellOpening | null => {
      if (!VALID_OPENING_KINDS.includes(item?.kind) || !Number.isFinite(item?.x) || !Number.isFinite(item?.z)) return null;
      const opening: SpatialShellOpening = {
        id: uniqueId(slugId(typeof item.id === 'string' ? item.id : `${item.kind}-${index + 1}`, `${item.kind}-${index + 1}`), usedOpenings),
        kind: item.kind,
        x: clamp(item.x, -1000, 1000, 0),
        z: clamp(item.z, -1000, 1000, 0),
        width: clamp(item.width, 0.2, 10, item.kind === 'door' ? 0.9 : 1.2),
        depth: clamp(item.depth, 0.02, 2, 0.12),
        rotation: clamp(item.rotation, -360, 360, 0),
        bottom: clamp(item.bottom, 0, 5, item.kind === 'door' ? 0 : 0.9),
        height: clamp(item.height, 0.2, 5, item.kind === 'door' ? 2.1 : 1.2),
      };
      if (item.kind === 'door' && /^#[0-9a-f]{6}$/i.test(item.color)) opening.color = item.color.toLowerCase();
      return opening;
    })
    .filter((opening: SpatialShellOpening | null): opening is SpatialShellOpening => opening !== null);
  return {
    outer: outer.length >= 3 ? outer : floor,
    holes,
    floor: floor.length >= 3 ? floor : outer,
    openings,
    ...(floors.length ? { floors } : {}),
    ...(rooms.length ? { rooms } : {}),
    ...(walls.length ? { walls } : {}),
  };
}

function normalizeSpatial(raw: any, zones: ZoneConfig[]): SpatialConfig {
  const zoneIds = new Set(zones.map((zone) => zone.id).filter((id): id is string => Boolean(id)));
  const plan = normalizeSpatialPlan(raw?.spatial?.plan, zoneIds);
  const shell = normalizeSpatialShell(raw?.spatial?.shell, zoneIds);
  const planWallIds = new Set(plan?.walls.map((wall) => wall.id) ?? []);
  const used = new Set<string>();
  const openings = (Array.isArray(raw?.spatial?.openings) ? raw.spatial.openings : [])
    .map((item: any, index: number): OpeningConfig | null => {
      const parts = typeof item?.wallId === 'string' ? wallParts(item.wallId) : null;
      const planWallId = typeof item?.wallId === 'string' ? slugId(item.wallId, '') : '';
      const wallId = parts && zoneIds.has(parts.zoneId)
        ? wallIdFor(parts.zoneId, parts.side)
        : planWallIds.has(planWallId) ? planWallId : null;
      if (!wallId || !VALID_OPENING_KINDS.includes(item?.kind)) return null;
      const baseId = slugId(typeof item.id === 'string' ? item.id : `${item.kind}-${index + 1}`, `${item.kind}-${index + 1}`);
      const width = clamp(item.width, 0.08, 0.8, item.kind === 'door' ? 0.22 : 0.3);
      const position = clamp(item.position, width / 2, 1 - width / 2, 0.5);
      const opening: OpeningConfig = {
        id: uniqueId(baseId, used),
        kind: item.kind,
        wallId,
        position,
        width,
      };
      if (Number.isFinite(item.widthMeters)) opening.widthMeters = clamp(item.widthMeters, 0.2, 10, item.kind === 'door' ? 0.9 : 1.2);
      if (Number.isFinite(item.height)) opening.height = clamp(item.height, 0.2, 5, item.kind === 'door' ? 2.1 : 1.2);
      if (Number.isFinite(item.bottom)) opening.bottom = clamp(item.bottom, 0, 5, item.kind === 'door' ? 0 : 0.9);
      if (item.hinge === 'left' || item.hinge === 'right') opening.hinge = item.hinge;
      if (item.swing === 'in' || item.swing === 'out') opening.swing = item.swing;
      if (item.kind === 'door' && /^#[0-9a-f]{6}$/i.test(item.color)) opening.color = item.color.toLowerCase();
      return opening;
    })
    .filter((opening: OpeningConfig | null): opening is OpeningConfig => opening !== null);
  const walls = (Array.isArray(raw?.spatial?.walls) ? raw.spatial.walls : [])
    .map((item: any): WallConfig | null => {
      const parts = typeof item?.wallId === 'string' ? wallParts(item.wallId) : null;
      if (!parts || !zoneIds.has(parts.zoneId)) return null;
      const curve = clamp(item.curve, -1, 1, 0);
      return Math.abs(curve) < 0.001 ? null : { wallId: wallIdFor(parts.zoneId, parts.side), curve };
    })
    .filter((wall: WallConfig | null): wall is WallConfig => wall !== null);
  const rawSite = raw?.spatial?.site ?? {};
  const north = ((clamp(rawSite.north, -360, 360, 0) % 360) + 360) % 360;
  const site: SiteConfig = { north };
  if (typeof rawSite.latitude === 'number' && Number.isFinite(rawSite.latitude)) {
    site.latitude = Math.min(90, Math.max(-90, rawSite.latitude));
  }
  if (typeof rawSite.longitude === 'number' && Number.isFinite(rawSite.longitude)) {
    site.longitude = Math.min(180, Math.max(-180, rawSite.longitude));
  }
  const rawDimensions = raw?.spatial?.dimensions ?? {};
  const dimensions: SpatialDimensions = {
    width: clamp(rawDimensions.width, 2, 100, 10),
    aspectRatio: clamp(rawDimensions.aspectRatio, 0.25, 4, 1),
    wallHeight: clamp(rawDimensions.wallHeight, 1.8, 5, 2.6),
  };
  const spatial: SpatialConfig = { openings, walls, site, dimensions };
  if (plan) spatial.plan = plan;
  if (shell) spatial.shell = shell;
  return spatial;
}

function withoutInvalidZone(entity: EntityConfig, zoneIds: Set<string>): EntityConfig {
  if (!entity.zoneId || zoneIds.has(entity.zoneId)) return entity;
  const { zoneId: _zoneId, ...rest } = entity;
  return rest;
}

function normalizeImages(raw: any, allowEmpty = false): ImagesConfig {
  const src = raw?.images ?? {};
  const base = src.base ?? raw?.dayImage;
  if (typeof base !== 'string' || base.length === 0) {
    if (allowEmpty) return { base: '' };
    throw new Error(
      'apartment-view-card: images.base is required (a lights-off base render).',
    );
  }
  const images: ImagesConfig = { base };
  const allLights = src.allLights ?? raw?.allLightsImage;
  const night = src.night ?? raw?.nightImage;
  const duskDawn = src.duskDawn ?? raw?.duskdawnImage;
  if (typeof allLights === 'string') images.allLights = allLights;
  if (typeof night === 'string') images.night = night;
  if (typeof duskDawn === 'string') images.duskDawn = duskDawn;
  return images;
}

function normalizeSize(value: any): SizeTier {
  return VALID_SIZES.includes(value) ? value : 'medium';
}

function normalizeTapFromEntity(raw: any): TapAction {
  if (VALID_TAPS.includes(raw?.tap)) return raw.tap;
  // legacy disableService -> tap
  if (raw?.disableService === true) return 'none';
  if (raw?.disableService === false) return 'toggle';
  return 'toggle';
}

function normalizeOrientation(value: any): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Parse a per-entity label. Accepts the object form, or a string shorthand:
 * a known source name ('climate-current'), 'off'/'none', or any other string
 * as static text ('Movie Night').
 */
function normalizeLabel(raw: any): LabelConfig | undefined {
  if (raw == null) return undefined;
  if (typeof raw === 'string') {
    if (raw === 'off' || raw === 'none') return { source: 'none' };
    if ((VALID_LABEL_SOURCES as readonly string[]).includes(raw)) return { source: raw as LabelSource };
    return { source: 'static', text: raw };
  }
  if (typeof raw !== 'object') return undefined;
  const source: LabelSource = (VALID_LABEL_SOURCES as readonly string[]).includes(raw.source)
    ? raw.source
    : 'none';
  const cfg: LabelConfig = { source };
  if (typeof raw.text === 'string') cfg.text = raw.text;
  if (typeof raw.attribute === 'string') cfg.attribute = raw.attribute;
  if ((VALID_LABEL_VISIBILITIES as readonly string[]).includes(raw.visibility)) cfg.visibility = raw.visibility;
  return cfg;
}

function normalizeLabelDefaults(raw: any): LabelDefaults {
  const o = raw ?? {};
  const source =
    o.source === 'smart' || (VALID_LABEL_SOURCES as readonly string[]).includes(o.source)
      ? o.source
      : DEFAULT_LABELS.source;
  return {
    source,
    visibility: (VALID_LABEL_VISIBILITIES as readonly string[]).includes(o.visibility)
      ? o.visibility
      : DEFAULT_LABELS.visibility,
    densityCap: typeof o.densityCap === 'number' && o.densityCap > 0 ? o.densityCap : DEFAULT_LABELS.densityCap,
  };
}

function normalizeEntity(raw: any): EntityConfig {
  const entity: EntityConfig = {
    entity: raw?.entity ?? raw?.entityName ?? '',
    x: typeof raw?.x === 'number' ? raw.x : (raw?.offsetX ?? 50),
    y: typeof raw?.y === 'number' ? raw.y : (raw?.offsetY ?? 50),
    size: normalizeSize(raw?.size),
    tap: normalizeTapFromEntity(raw),
    orientation: normalizeOrientation(raw?.orientation),
  };
  const name = raw?.name ?? raw?.customName;
  const icon = raw?.icon ?? raw?.customIcon;
  if (typeof name === 'string' && name.length > 0) entity.name = name;
  if (typeof icon === 'string' && icon.length > 0) entity.icon = icon;
  if (VALID_STYLES.includes(raw?.lightStyle)) {
    entity.lightStyle = raw.lightStyle;
  }
  if (typeof raw?.light === 'boolean') entity.light = raw.light;
  if (typeof raw?.zoneId === 'string' && raw.zoneId.length) entity.zoneId = raw.zoneId;
  if (VALID_MARKER_VISIBILITIES.includes(raw?.overviewVisibility)) {
    entity.overviewVisibility = raw.overviewVisibility;
  }
  if (VALID_MARKER_VISIBILITIES.includes(raw?.roomVisibility)) {
    entity.roomVisibility = raw.roomVisibility;
  }
  const spatial = normalizeSpatialPlacement(raw?.spatial);
  if (spatial) entity.spatial = spatial;
  const label = normalizeLabel(raw?.label);
  if (label) entity.label = label;
  return entity;
}

function normalizeQuickAction(raw: any): QuickAction | null {
  const name = typeof raw?.name === 'string' && raw.name.length ? raw.name : undefined;
  const entity = typeof raw?.entity === 'string' ? raw.entity : undefined;
  const service = typeof raw?.service === 'string' ? raw.service : undefined;
  if (!name || (!entity && !service)) return null;
  const qa: QuickAction = { name };
  if (typeof raw.icon === 'string') qa.icon = raw.icon;
  if (entity) qa.entity = entity;
  if (service) qa.service = service;
  if (raw.data && typeof raw.data === 'object') qa.data = raw.data;
  return qa;
}

function normalizeZone(raw: any, index: number, used: Set<string>): ZoneConfig {
  const name = typeof raw?.name === 'string' && raw.name.length > 0 ? raw.name : 'Zone';
  const requestedId = typeof raw?.id === 'string' && raw.id.length
    ? slugId(raw.id, `room-${index + 1}`)
    : slugId(name, `room-${index + 1}`);
  const zone: ZoneConfig = {
    id: uniqueId(requestedId, used),
    name,
    x: Number(raw?.x) || 0,
    y: Number(raw?.y) || 0,
    width: Number(raw?.width) || 0,
    height: Number(raw?.height) || 0,
  };
  if (typeof raw?.areaId === 'string' && raw.areaId.length > 0) zone.areaId = raw.areaId;
  if (typeof raw?.icon === 'string' && raw.icon.length > 0) zone.icon = raw.icon;
  return zone;
}

function normalizeZones(raw: any[]): ZoneConfig[] {
  const used = new Set<string>();
  return raw.map((zone, index) => normalizeZone(zone, index, used));
}

/** Fill interaction defaults; any invalid field falls back individually. */
function normalizeInteraction(raw: any): InteractionOptions {
  const o = raw ?? {};
  return {
    wheel: VALID_WHEEL_MODES.includes(o.wheel) ? o.wheel : 'modifier',
    doubleTapZoom: typeof o.doubleTapZoom === 'boolean' ? o.doubleTapZoom : true,
    roomSwipe: typeof o.roomSwipe === 'boolean' ? o.roomSwipe : true,
    inertia: typeof o.inertia === 'boolean' ? o.inertia : true,
  };
}

/**
 * Parse a floorplan frame aspect into a numeric width/height ratio.
 * Accepts "w/h" strings ("4/5", "1/1", "3/4"), "w:h", or a bare positive
 * number. Falls back to `fallback` (the caller passes the default) for
 * anything invalid or non-positive.
 */
function parseAspect(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  if (typeof value === 'string') {
    const m = /^\s*([\d.]+)\s*[/:]\s*([\d.]+)\s*$/.exec(value);
    if (m) {
      const w = parseFloat(m[1]);
      const h = parseFloat(m[2]);
      if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) return w / h;
    }
    const n = parseFloat(value);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return fallback;
}

function normalizeOptions(raw: any): CardOptions {
  const o = raw?.options ?? {};
  return {
    view: VALID_VIEWS.includes(o.view) ? o.view : 'auto',
    lightStyle: VALID_STYLES.includes(o.lightStyle) ? o.lightStyle : 'lit',
    hideWalls: typeof o.hideWalls === 'boolean' ? o.hideWalls : false,
    freePanZoom: typeof o.freePanZoom === 'boolean' ? o.freePanZoom : true,
    zoomMax: typeof o.zoomMax === 'number' ? o.zoomMax : 1.5,
    duskDawnOffsetMinutes:
      typeof o.duskDawnOffsetMinutes === 'number'
        ? o.duskDawnOffsetMinutes
        : 60,
    labels: normalizeLabelDefaults(o.labels),
    iconSize: typeof o.iconSize === 'number' && o.iconSize > 0 ? o.iconSize : 44,
    iconSizeMax: typeof o.iconSizeMax === 'number' && o.iconSizeMax > 0 ? o.iconSizeMax : 88,
    ...(typeof o.iconSizeMobile === 'number' && o.iconSizeMobile > 0
      ? { iconSizeMobile: o.iconSizeMobile }
      : {}),
    ...(typeof o.iconSizeMaxMobile === 'number' && o.iconSizeMaxMobile > 0
      ? { iconSizeMaxMobile: o.iconSizeMaxMobile }
      : {}),
    aspectMobile: parseAspect(o.aspectMobile, 0.8),
    interaction: normalizeInteraction(o.interaction),
    idleTimeout:
      typeof o.idleTimeout === 'number' &&
      Number.isFinite(o.idleTimeout) &&
      o.idleTimeout >= 0
        ? o.idleTimeout
        : 0,
    presentation: VALID_PRESENTATIONS.includes(o.presentation)
      ? o.presentation
      : 'control-heavy',
    spatialLightingMode: VALID_SPATIAL_LIGHTING_MODES.includes(o.spatialLightingMode)
      ? o.spatialLightingMode
      : 'realistic',
    ...(typeof o.weatherEntity === 'string' && o.weatherEntity.length
      ? { weatherEntity: o.weatherEntity }
      : {}),
    ...(typeof o.illuminanceEntity === 'string' && o.illuminanceEntity.length
      ? { illuminanceEntity: o.illuminanceEntity }
      : {}),
  };
}

function normalizeFloor(raw: any): FloorConfig {
  const rawZones = Array.isArray(raw?.zones) ? raw.zones : [];
  const zones = normalizeZones(rawZones);
  const zoneIds = new Set(zones.map((zone) => zone.id).filter((id): id is string => Boolean(id)));
  const floor: FloorConfig = {
    name: typeof raw?.name === 'string' && raw.name.length ? raw.name : 'Floor',
    images: normalizeImages(raw, Boolean(raw?.spatial?.plan || raw?.spatial?.shell)),
    entities: (Array.isArray(raw?.entities) ? raw.entities : [])
      .map(normalizeEntity)
      .map((entity: EntityConfig) => withoutInvalidZone(entity, zoneIds)),
    zones,
    spatial: normalizeSpatial(raw, zones),
  };
  if (typeof raw?.icon === 'string' && raw.icon.length) floor.icon = raw.icon;
  return floor;
}

/**
 * Normalize raw Lovelace config: fill defaults, migrate legacy keys, and
 * PRESERVE unknown top-level keys (v1 silently dropped columns/rows/zones).
 * Legacy image configs still require images.base. A spatial-plan config is a
 * complete 3D source of truth and therefore needs no raster floorplan.
 */
export function normalizeConfig(raw: any): ApartmentViewConfig {
  const source = raw ?? {};
  const rawEntities: any[] = Array.isArray(source.entities)
    ? source.entities
    : Array.isArray(source.objects)
      ? source.objects
      : [];
  const rawZones: any[] = Array.isArray(source.zones) ? source.zones : [];

  // Spread unknown keys first, then overwrite the canonical shape. Strip the
  // legacy flat keys we have folded into `images`/`entities`.
  const {
    objects: _objects,
    dayImage: _dayImage,
    allLightsImage: _allLightsImage,
    nightImage: _nightImage,
    duskdawnImage: _duskdawnImage,
    ...rest
  } = source;

  const rawFloors: any[] = Array.isArray(source.floors) ? source.floors : [];
  const floors = rawFloors.map(normalizeFloor);
  // Multi-floor: the top-level images/entities/zones mirror floor 0 so the base
  // guard and all single-floor read paths keep working unchanged.
  const base = floors.length
    ? { images: floors[0].images, entities: floors[0].entities, zones: floors[0].zones }
    : { images: normalizeImages(source, Boolean(source?.spatial?.plan || source?.spatial?.shell)), entities: rawEntities.map(normalizeEntity), zones: normalizeZones(rawZones) };

  const zoneIds = new Set(base.zones.map((zone) => zone.id).filter((id): id is string => Boolean(id)));
  const entities = base.entities.map((entity) => withoutInvalidZone(entity, zoneIds));

  return {
    ...rest,
    modelVersion: CURRENT_MODEL_VERSION,
    type: typeof source.type === 'string' ? source.type : CARD_TYPE,
    images: base.images,
    entities,
    zones: base.zones,
    options: normalizeOptions(source),
    quickActions: (Array.isArray(source.quickActions) ? source.quickActions : [])
      .map(normalizeQuickAction)
      .filter((q: QuickAction | null): q is QuickAction => q !== null),
    spatial: normalizeSpatial(source, base.zones),
    floors,
  };
}

/**
 * Return the smallest-AREA zone whose rectangle contains (x, y), inclusive of
 * edges; null if none. Coordinates and dimensions are in the same percentage
 * space as the config.
 */
export function zoneForPoint(
  x: number,
  y: number,
  zones: ZoneConfig[],
): ZoneConfig | null {
  let best: ZoneConfig | null = null;
  let bestArea = Infinity;
  for (const zone of zones) {
    const inside =
      x >= zone.x &&
      x <= zone.x + zone.width &&
      y >= zone.y &&
      y <= zone.y + zone.height;
    if (!inside) continue;
    const area = zone.width * zone.height;
    if (area < bestArea) {
      bestArea = area;
      best = zone;
    }
  }
  return best;
}

/** Resolve explicit room membership first, then fall back to point geometry. */
export function zoneForEntity(
  entity: Pick<EntityConfig, 'x' | 'y' | 'zoneId'>,
  zones: ZoneConfig[],
): ZoneConfig | null {
  if (entity.zoneId) {
    const linked = zones.find((zone) => zone.id === entity.zoneId);
    if (linked) return linked;
  }
  return zoneForPoint(entity.x, entity.y, zones);
}
