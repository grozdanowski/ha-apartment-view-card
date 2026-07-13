import { LitElement, css, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SunCalc from 'suncalc';
import { wallIdFor, type EntityConfig, type OpeningConfig, type SiteConfig, type SpatialDimensions, type SpatialFloorFinish, type SpatialPlan, type SpatialShellConfig, type SpatialShellOpening, type SpatialShellWall, type WallConfig, type ZoneConfig } from '../core/config';
import type { HassLike } from '../core/ha-types';
import { spatialAsset, spatialAssetFinish } from '../core/spatial-assets';

export interface SpatialPoint {
  x: number;
  y: number;
}

export interface SpatialZoneConfig extends ZoneConfig {
  /** Optional room outline in floorplan coordinates. Rectangles remain the editor default. */
  footprint?: SpatialPoint[];
  floorColor?: number;
}

export type FurnishingKind =
  | 'sofa'
  | 'armchair'
  | 'bed'
  | 'table'
  | 'chair'
  | 'tv'
  | 'console'
  | 'cabinet'
  | 'vanity'
  | 'bathtub'
  | 'island'
  | 'rug'
  | 'plant'
  | 'floorlamp'
  | 'window'
  | 'door';

export interface FurnishingConfig {
  id: string;
  kind: FurnishingKind;
  x: number;
  y: number;
  width: number;
  depth: number;
  rotation?: number;
  height?: number;
  color?: number;
  zoneId?: string;
}

interface CameraTween {
  started: number;
  duration: number;
  fromPosition: THREE.Vector3;
  toPosition: THREE.Vector3;
  fromTarget: THREE.Vector3;
  toTarget: THREE.Vector3;
}

const WALL_DEPTH = 0.09;
const FLOOR_HEIGHT = 0.06;

/** Shared generated 3D home surface used by both the editor and runtime. */
@customElement('spatial-preview')
export class SpatialPreview extends LitElement {
  @property({ attribute: false }) zones: SpatialZoneConfig[] = [];
  @property({ attribute: false }) entities: EntityConfig[] = [];
  @property({ attribute: false }) openings: OpeningConfig[] = [];
  @property({ attribute: false }) walls: WallConfig[] = [];
  @property({ attribute: false }) site: SiteConfig = { north: 0 };
  @property({ attribute: false }) dimensions: SpatialDimensions = { width: 10, aspectRatio: 1, wallHeight: 2.6 };
  @property({ attribute: false }) plan: SpatialPlan | null = null;
  @property({ attribute: false }) hass?: HassLike;
  @property({ attribute: false }) furnishings: FurnishingConfig[] = [];
  @property({ attribute: false }) shell: SpatialShellConfig | null = null;
  @property() modelUrl = '';
  @property({ attribute: false }) focusedZoneId: string | null = null;
  @property({ type: Boolean }) showRoomControls = true;
  @property({ type: Boolean }) hideWalls = false;
  @property({ type: Number }) latitude = 0;
  @property({ type: Number }) longitude = 0;
  @state() private _error = '';
  @state() private _loadingModel = false;

  private _renderer?: THREE.WebGLRenderer;
  private _scene?: THREE.Scene;
  private _camera?: THREE.PerspectiveCamera;
  private _controls?: OrbitControls;
  private _model?: THREE.Group;
  private _observer?: ResizeObserver;
  private _frame = 0;
  private _objectLoadGeneration = 0;
  private _cameraTween?: CameraTween;
  private _sun?: THREE.DirectionalLight;
  private _importedModel?: THREE.Group;
  private _activeShell: SpatialShellConfig | null = null;
  private _overviewBounds?: THREE.Box3;
  private _overviewResetTimer?: number;
  private _modelRadius = 7;
  private _pointerStart?: THREE.Vector2;
  private readonly _raycaster = new THREE.Raycaster();
  private readonly _pointer = new THREE.Vector2();

  static styles = css`
    :host { display: block; color: #eef2f3; container-type: inline-size; }
    .viewport {
      position: relative;
      box-sizing: border-box;
      width: 100%;
      min-height: 360px;
      aspect-ratio: 16 / 10;
      overflow: hidden;
      border: 0;
      background: transparent;
    }
    canvas { display: block; width: 100%; height: 100%; touch-action: none; }
    button {
      appearance: none;
      border: 1px solid rgba(255, 255, 255, 0.11);
      color: #eef2f3;
      background: rgba(12, 17, 19, 0.76);
      font: inherit;
      cursor: pointer;
      backdrop-filter: blur(14px);
      -webkit-backdrop-filter: blur(14px);
      transition: color 160ms ease-out, background-color 160ms ease-out, border-color 160ms ease-out, transform 160ms ease-out;
    }
    button:hover { border-color: rgba(255, 255, 255, 0.22); }
    button:active { transform: scale(0.97); }
    button:focus-visible {
      outline: 2px solid #d8e5e7;
      outline-offset: 2px;
    }
    .room-rail {
      display: flex;
      box-sizing: border-box;
      width: 100%;
      gap: 5px;
      margin-bottom: 8px;
      padding: 0;
      overflow-x: auto;
      border: 0;
      background: transparent;
      scrollbar-width: none;
    }
    .room-rail::-webkit-scrollbar { display: none; }
    .room-rail button {
      flex: 0 0 auto;
      min-height: 38px;
      padding: 0 14px;
      border: 0;
      border-radius: 6px;
      color: rgba(238, 242, 243, 0.65);
      background: transparent;
      font-size: 13px;
      font-weight: 610;
      white-space: nowrap;
    }
    .room-rail button[aria-pressed='true'] {
      color: #101617;
      background: #c7d4d7;
    }
    .entity-shortcuts { position: relative; height: 0; overflow: visible; }
    .entity-shortcuts button {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
    .entity-shortcuts button:focus-visible {
      position: relative;
      width: auto;
      height: 40px;
      padding: 0 12px;
      overflow: visible;
      clip-path: none;
      white-space: normal;
    }
    .empty, .error {
      position: absolute;
      inset: 0;
      display: grid;
      place-items: center;
      padding: 24px;
      color: #c7d0d4;
      text-align: center;
      line-height: 1.45;
    }
    @container (max-width: 600px) {
      .viewport { min-height: 0; aspect-ratio: 4 / 5; }
      .room-rail button { min-height: 44px; padding: 0 13px; font-size: 14px; }
    }
    @media (prefers-reduced-motion: reduce) {
      button { transition: none; }
    }
  `;

  protected firstUpdated(): void {
    const canvas = this.renderRoot.querySelector('canvas');
    if (!(canvas instanceof HTMLCanvasElement)) return;
    try {
      this._renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
      this._renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      this._renderer.outputColorSpace = THREE.SRGBColorSpace;
      this._renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this._renderer.toneMappingExposure = 0.98;
      this._renderer.localClippingEnabled = true;
      this._renderer.shadowMap.enabled = true;
      this._renderer.shadowMap.type = THREE.PCFShadowMap;

      this._scene = new THREE.Scene();
      this._scene.background = null;
      this._camera = new THREE.PerspectiveCamera(34, 1, 0.1, 50);
      this._camera.position.set(8.8, 10.5, 11.5);

      this._controls = new OrbitControls(this._camera, canvas);
      this._controls.enableDamping = true;
      this._controls.dampingFactor = 0.06;
      this._controls.minDistance = 4;
      this._controls.maxDistance = 24;
      this._controls.maxPolarAngle = Math.PI * 0.47;
      this._controls.target.set(0, 0, 0);
      this._controls.autoRotate = false;
      this._controls.addEventListener('start', () => {
        this._cameraTween = undefined;
        this._clearOverviewReset();
        if (this._controls) this._controls.autoRotate = false;
      });
      this._controls.addEventListener('end', this._scheduleOverviewReset);

      canvas.addEventListener('pointerdown', this._onPointerDown);
      canvas.addEventListener('pointerup', this._onPointerUp);

      this._scene.add(new THREE.HemisphereLight(0xe7eff1, 0x232b2e, 2.15));
      this._sun = new THREE.DirectionalLight(0xfff3d8, 2.6);
      this._sun.castShadow = true;
      const shadowSize = this.clientWidth < 600 ? 1024 : 2048;
      this._sun.shadow.mapSize.set(shadowSize, shadowSize);
      this._sun.shadow.camera.left = -8;
      this._sun.shadow.camera.right = 8;
      this._sun.shadow.camera.top = 8;
      this._sun.shadow.camera.bottom = -8;
      this._sun.shadow.bias = -0.00035;
      this._scene.add(this._sun);
      this._updateSun();
      const fill = new THREE.DirectionalLight(0x86bbc5, 0.72);
      fill.position.set(8, 4, -6);
      this._scene.add(fill);

      this._observer = new ResizeObserver(() => this._resize());
      this._observer.observe(this);
      this._buildModel();
      this._resize();
      this._moveCameraTo(null);
      if (this.modelUrl) void this._loadModel();
      this._animate();
    } catch (error) {
      this._error = error instanceof Error ? error.message : '3D preview is unavailable.';
    }
  }

  protected updated(changed: Map<PropertyKey, unknown>): void {
    if (this._scene && (changed.has('zones') || changed.has('entities') || changed.has('openings') || changed.has('walls') || changed.has('dimensions') || changed.has('furnishings') || changed.has('shell') || changed.has('plan'))) {
      this._buildModel();
    }
    if (changed.has('modelUrl') && this._scene) void this._loadModel();
    if (changed.has('site') || changed.has('latitude') || changed.has('longitude')) this._updateSun();
    if (changed.has('focusedZoneId') && this._scene) {
      this._applyFocus();
      this._moveCameraTo(this.focusedZoneId);
    }
    if (changed.has('hideWalls') && this._scene) this._applyWallCutaway();
    if (changed.has('hass')) this._updateEntityStateVisuals();
  }

  private _entityIsActive(entityId: string): boolean {
    const value = this.hass?.states?.[entityId]?.state;
    return Boolean(value && !['off', 'closed', 'unavailable', 'unknown', 'idle', 'standby', 'not_home'].includes(value));
  }

  private _updateEntityStateVisuals(): void {
    this._model?.traverse((node) => {
      if (!(node instanceof THREE.Mesh) || !node.userData.entityId) return;
      const active = this._entityIsActive(node.userData.entityId as string);
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      materials.forEach((material) => {
        if (!(material instanceof THREE.MeshStandardMaterial)) return;
        material.emissiveIntensity = active ? 1.15 : 0.18;
        material.opacity = active ? 1 : 0.72;
        material.transparent = !active;
      });
    });
  }

  disconnectedCallback(): void {
    const canvas = this.renderRoot.querySelector('canvas');
    canvas?.removeEventListener('pointerdown', this._onPointerDown);
    canvas?.removeEventListener('pointerup', this._onPointerUp);
    super.disconnectedCallback();
    cancelAnimationFrame(this._frame);
    this._observer?.disconnect();
    this._clearOverviewReset();
    this._controls?.dispose();
    this._disposeModel();
    this._renderer?.dispose();
  }

  private _disposeModel(): void {
    if (!this._model) return;
    this._model.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      if (node.userData.importedModel) return;
      node.geometry.dispose();
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      materials.forEach((material) => {
        const mapped = material as THREE.MeshStandardMaterial;
        mapped.map?.dispose();
        material.dispose();
      });
    });
    this._scene?.remove(this._model);
    this._model = undefined;
  }

  private _zonePoints(zone: SpatialZoneConfig): SpatialPoint[] {
    return zone.footprint?.length && zone.footprint.length >= 3
      ? zone.footprint
      : [
          { x: zone.x, y: zone.y },
          { x: zone.x + zone.width, y: zone.y },
          { x: zone.x + zone.width, y: zone.y + zone.height },
          { x: zone.x, y: zone.y + zone.height },
        ];
  }

  private _worldPoint(point: SpatialPoint): THREE.Vector2 {
    return new THREE.Vector2(
      (point.x - 50) * this.dimensions.width / 100,
      (point.y - 50) * this.dimensions.width / this.dimensions.aspectRatio / 100,
    );
  }

  private _shellFromPlan(plan: SpatialPlan): SpatialShellConfig {
    const vertices = new Map(plan.vertices.map((vertex) => [vertex.id, vertex]));
    const roomsByWall = new Map<string, string[]>();
    plan.rooms.forEach((room) => {
      room.boundary.forEach(({ wallId }) => {
        const zoneIds = roomsByWall.get(wallId) ?? [];
        zoneIds.push(room.zoneId ?? room.id);
        roomsByWall.set(wallId, zoneIds);
      });
    });
    const wallPoint = (wall: SpatialPlan['walls'][number], t: number): [number, number] => {
      const start = vertices.get(wall.start);
      const end = vertices.get(wall.end);
      if (!start || !end) return [0, 0];
      const dx = end.x - start.x;
      const dz = end.z - start.z;
      const length = Math.hypot(dx, dz) || 1;
      const normalX = -dz / length;
      const normalZ = dx / length;
      const bend = wall.curve * length * 0.76;
      const controlX = (start.x + end.x) / 2 + normalX * bend;
      const controlZ = (start.z + end.z) / 2 + normalZ * bend;
      const inverse = 1 - t;
      return [
        inverse * inverse * start.x + 2 * inverse * t * controlX + t * t * end.x,
        inverse * inverse * start.z + 2 * inverse * t * controlZ + t * t * end.z,
      ];
    };
    const walls: SpatialShellWall[] = plan.walls.flatMap((wall) => {
      const start = vertices.get(wall.start);
      const end = vertices.get(wall.end);
      if (!start || !end) return [];
      const curved = Math.abs(wall.curve) >= 0.01;
      const points: [number, number][] = curved
        ? Array.from({ length: 17 }, (_, index) => wallPoint(wall, index / 16))
        : [[start.x, start.z], [end.x, end.z]];
      return [{
        id: wall.id,
        points,
        thickness: wall.thickness,
        smooth: curved,
        zoneIds: roomsByWall.get(wall.id) ?? [],
      }];
    });
    const openings: SpatialShellOpening[] = this.openings.flatMap((opening) => {
      const wall = plan.walls.find((candidate) => candidate.id === opening.wallId);
      const start = wall ? vertices.get(wall.start) : undefined;
      const end = wall ? vertices.get(wall.end) : undefined;
      if (!wall || !start || !end) return [];
      const position = wallPoint(wall, opening.position);
      const before = wallPoint(wall, Math.max(0, opening.position - 0.005));
      const after = wallPoint(wall, Math.min(1, opening.position + 0.005));
      const length = Math.hypot(end.x - start.x, end.z - start.z);
      return [{
        id: opening.id,
        kind: opening.kind,
        x: position[0],
        z: position[1],
        width: opening.widthMeters ?? opening.width * length,
        depth: wall.thickness,
        rotation: THREE.MathUtils.radToDeg(Math.atan2(after[1] - before[1], after[0] - before[0])),
        bottom: opening.bottom ?? (opening.kind === 'door' ? 0 : 0.9),
        height: opening.height ?? (opening.kind === 'door' ? 2.1 : 1.2),
      }];
    });
    const rooms = plan.rooms.flatMap((room) => {
      const floor = room.boundary.flatMap(({ wallId, reversed }) => {
        const wall = plan.walls.find((candidate) => candidate.id === wallId);
        if (!wall) return [];
        const vertex = vertices.get(reversed ? wall.end : wall.start);
        return vertex ? [[vertex.x, vertex.z] as [number, number]] : [];
      });
      return floor.length >= 3 ? [{
        zoneId: room.zoneId ?? room.id,
        floor,
        finish: room.floorFinish,
        color: room.floorColor,
      }] : [];
    });
    const all = plan.vertices.length ? plan.vertices : [{ id: 'origin', x: 0, z: 0 }];
    const minX = Math.min(...all.map((vertex) => vertex.x));
    const maxX = Math.max(...all.map((vertex) => vertex.x));
    const minZ = Math.min(...all.map((vertex) => vertex.z));
    const maxZ = Math.max(...all.map((vertex) => vertex.z));
    return {
      outer: [[minX, minZ], [maxX, minZ], [maxX, maxZ], [minX, maxZ]],
      holes: [],
      floor: [],
      rooms,
      walls,
      openings,
    };
  }

  private _planCenter(plan: SpatialPlan): THREE.Vector2 {
    if (!plan.vertices.length) return new THREE.Vector2();
    const minX = Math.min(...plan.vertices.map((vertex) => vertex.x));
    const maxX = Math.max(...plan.vertices.map((vertex) => vertex.x));
    const minZ = Math.min(...plan.vertices.map((vertex) => vertex.z));
    const maxZ = Math.max(...plan.vertices.map((vertex) => vertex.z));
    return new THREE.Vector2((minX + maxX) / 2, (minZ + maxZ) / 2);
  }

  private _spatialCenter(): THREE.Vector2 {
    const shellPoints = this.shell ? [
      ...this.shell.outer,
      ...this.shell.floor,
      ...(this.shell.floors ?? []).flat(),
    ] : [];
    if (shellPoints.length) {
      const minX = Math.min(...shellPoints.map(([x]) => x));
      const maxX = Math.max(...shellPoints.map(([x]) => x));
      const minZ = Math.min(...shellPoints.map(([, z]) => z));
      const maxZ = Math.max(...shellPoints.map(([, z]) => z));
      return new THREE.Vector2((minX + maxX) / 2, (minZ + maxZ) / 2);
    }
    return this.plan ? this._planCenter(this.plan) : new THREE.Vector2();
  }

  private _createPlanObject(item: SpatialPlan['objects'][number], generation: number): THREE.Group {
    const knownKinds = new Set<FurnishingKind>([
      'sofa', 'armchair', 'bed', 'table', 'chair', 'tv', 'console', 'cabinet',
      'vanity', 'bathtub', 'island', 'rug', 'plant', 'floorlamp', 'window', 'door',
    ]);
    const defaults: Record<string, [number, number, number]> = {
      sofa: [2.2, 0.95, 0.82], armchair: [0.9, 0.9, 0.86], bed: [1.8, 2, 0.62],
      table: [1.6, 0.9, 0.76], chair: [0.48, 0.52, 0.88], tv: [1.4, 0.16, 0.82],
      console: [1.5, 0.42, 0.58], cabinet: [1.2, 0.5, 1.8], vanity: [1.1, 0.52, 0.86],
      bathtub: [1.7, 0.75, 0.58], island: [1.8, 0.9, 0.92], rug: [2.2, 1.6, 0.025],
      plant: [0.55, 0.55, 1.25], floorlamp: [0.5, 0.5, 1.55], window: [1.2, 0.12, 1.2], door: [0.9, 0.12, 2.1],
    };
    const asset = spatialAsset(item.assetId);
    const kind = knownKinds.has((asset?.kind ?? item.kind) as FurnishingKind) ? (asset?.kind ?? item.kind) as FurnishingKind : 'cabinet';
    const [width, depth, height] = asset?.dimensions ?? defaults[kind] ?? defaults.cabinet;
    const finish = spatialAssetFinish(item.assetId, item.finishId);
    const group = this._createFurnishing({
      id: item.id,
      kind,
      x: 0,
      y: 0,
      width: width * 100 / this.dimensions.width,
      depth: depth * 100 / (this.dimensions.width / this.dimensions.aspectRatio),
      height,
      color: finish?.color,
      zoneId: item.zoneId,
    });
    if (item.modelUrl) {
      const loader = new GLTFLoader();
      loader.load(item.modelUrl, (gltf) => {
        if (generation !== this._objectLoadGeneration || !group.parent) return;
        group.traverse((node) => {
          if (!(node instanceof THREE.Mesh)) return;
          node.geometry.dispose();
          const materials = Array.isArray(node.material) ? node.material : [node.material];
          materials.forEach((material) => material.dispose());
        });
        group.clear();
        const model = gltf.scene;
        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        const longest = Math.max(size.x, size.y, size.z, 0.001);
        model.position.set(-center.x, -box.min.y, -center.z);
        model.scale.setScalar(1 / longest);
        model.traverse((node) => {
          if (!(node instanceof THREE.Mesh)) return;
          node.castShadow = true;
          node.receiveShadow = true;
        });
        group.add(model);
      }, undefined, () => undefined);
    }
    return group;
  }

  private _buildModel(): void {
    if (!this._scene) return;
    const objectLoadGeneration = ++this._objectLoadGeneration;
    this._disposeModel();
    const group = new THREE.Group();
    const usesImportedModel = Boolean(this._importedModel);
    const activeShell = this.shell ?? (this.plan ? this._shellFromPlan(this.plan) : null);
    this._activeShell = activeShell;
    if (this._importedModel) group.add(this._importedModel);
    if (activeShell && !usesImportedModel) group.add(this._createSurveyShell(activeShell));
    const wallMaterial = new THREE.MeshStandardMaterial({
      color: 0xd6dcdd,
      roughness: 0.87,
      metalness: 0,
      clippingPlanes: [new THREE.Plane(new THREE.Vector3(0, -1, 0), 1.32)],
      clipShadows: true,
    });
    const palette = [0x725f4d, 0x66594b, 0x746856, 0x5d554c, 0x6f6252, 0x686055];
    const rectangularWalls = new Map<string, { length: number; x: number; z: number; rotation: number; ids: string[] }>();
    const addWallRecord = (key: string, record: { length: number; x: number; z: number; rotation: number; id: string }) => {
      const existing = rectangularWalls.get(key);
      if (existing) existing.ids.push(record.id);
      else rectangularWalls.set(key, { length: record.length, x: record.x, z: record.z, rotation: record.rotation, ids: [record.id] });
    };
    const keyNumber = (value: number) => value.toFixed(3);

    this.zones.forEach((zone, index) => {
      const room = new THREE.Group();
      room.userData.zoneId = zone.id;
      const points = this._zonePoints(zone).map((point) => this._worldPoint(point));
      if (!activeShell?.rooms?.length) {
        const floorShape = new THREE.Shape();
        floorShape.moveTo(points[0].x, points[0].y);
        points.slice(1).forEach((point) => floorShape.lineTo(point.x, point.y));
        floorShape.closePath();
        const floor = new THREE.Mesh(
          new THREE.ExtrudeGeometry(floorShape, { depth: FLOOR_HEIGHT, bevelEnabled: false }),
          new THREE.MeshStandardMaterial({
            color: zone.floorColor ?? palette[index % palette.length],
            roughness: 0.88,
            transparent: usesImportedModel || Boolean(activeShell),
            opacity: usesImportedModel || activeShell ? 0.001 : 1,
            depthWrite: !usesImportedModel && !activeShell,
          }),
        );
        floor.geometry.rotateX(Math.PI / 2);
        floor.position.y = -FLOOR_HEIGHT;
        floor.receiveShadow = true;
        floor.userData.zoneId = zone.id;
        floor.userData.roomFloor = true;
        room.add(floor);
      }

      if (usesImportedModel || activeShell) {
        // Invisible room footprints remain as interaction targets over imported geometry.
      } else if (zone.footprint?.length) {
        points.forEach((start, pointIndex) => {
          const end = points[(pointIndex + 1) % points.length];
          const dx = end.x - start.x;
          const dz = end.y - start.y;
          const length = Math.hypot(dx, dz);
          const wall = new THREE.Mesh(new THREE.BoxGeometry(length, this.dimensions.wallHeight, WALL_DEPTH), wallMaterial.clone());
          wall.position.set((start.x + end.x) / 2, this.dimensions.wallHeight / 2, (start.y + end.y) / 2);
          wall.rotation.y = -Math.atan2(dz, dx);
          wall.castShadow = true;
          wall.receiveShadow = true;
          room.add(wall);
        });
      } else if (zone.id) {
        const width = Math.max(0.2, zone.width * this.dimensions.width / 100);
        const depth = Math.max(0.2, zone.height * this.dimensions.width / this.dimensions.aspectRatio / 100);
        const x = (zone.x + zone.width / 2 - 50) * this.dimensions.width / 100;
        const z = (zone.y + zone.height / 2 - 50) * this.dimensions.width / this.dimensions.aspectRatio / 100;
        const xStart = x - width / 2;
        const xEnd = x + width / 2;
        const zStart = z - depth / 2;
        const zEnd = z + depth / 2;
        addWallRecord(`h:${keyNumber(zStart)}:${keyNumber(xStart)}:${keyNumber(xEnd)}`, { length: width + WALL_DEPTH, id: wallIdFor(zone.id, 'top'), x: xStart - WALL_DEPTH / 2, z: zStart, rotation: 0 });
        addWallRecord(`h:${keyNumber(zEnd)}:${keyNumber(xStart)}:${keyNumber(xEnd)}`, { length: width + WALL_DEPTH, id: wallIdFor(zone.id, 'bottom'), x: xStart - WALL_DEPTH / 2, z: zEnd, rotation: 0 });
        addWallRecord(`v:${keyNumber(xStart)}:${keyNumber(zStart)}:${keyNumber(zEnd)}`, { length: depth, id: wallIdFor(zone.id, 'left'), x: xStart, z: zStart, rotation: -Math.PI / 2 });
        addWallRecord(`v:${keyNumber(xEnd)}:${keyNumber(zStart)}:${keyNumber(zEnd)}`, { length: depth, id: wallIdFor(zone.id, 'right'), x: xEnd, z: zStart, rotation: -Math.PI / 2 });
      }
      group.add(room);
    });

    if (!usesImportedModel && !activeShell) rectangularWalls.forEach((record) => {
      const openings = this.openings.filter((opening) => record.ids.includes(opening.wallId));
      const curve = this.walls.find((candidate) => record.ids.includes(candidate.wallId))?.curve ?? 0;
      const wallGroup = Math.abs(curve) >= 0.01
        ? this._curvedWall(record.length, this.dimensions.wallHeight, WALL_DEPTH, curve, openings, wallMaterial)
        : this._wallWithOpenings(record.length, this.dimensions.wallHeight, WALL_DEPTH, openings, wallMaterial);
      wallGroup.position.set(record.x, 0, record.z);
      wallGroup.rotation.y = record.rotation;
      group.add(wallGroup);
    });

    this.furnishings.forEach((furnishing) => {
      const object = this._createFurnishing(furnishing);
      object.userData.zoneId = furnishing.zoneId;
      object.position.set(
        (furnishing.x - 50) * this.dimensions.width / 100,
        0,
        (furnishing.y - 50) * this.dimensions.width / this.dimensions.aspectRatio / 100,
      );
      object.rotation.y = THREE.MathUtils.degToRad(furnishing.rotation ?? 0);
      object.traverse((node) => {
        node.userData.zoneId = furnishing.zoneId;
        if (node instanceof THREE.Mesh) {
          node.castShadow = true;
          node.receiveShadow = true;
        }
      });
      group.add(object);
    });

    if (this.plan) {
      const center = this._spatialCenter();
      this.plan.objects.forEach((item) => {
        const object = this._createPlanObject(item, objectLoadGeneration);
        object.position.set(item.position.x - center.x, item.position.y, item.position.z - center.y);
        object.rotation.set(
          THREE.MathUtils.degToRad(item.rotation.x),
          THREE.MathUtils.degToRad(item.rotation.y),
          THREE.MathUtils.degToRad(item.rotation.z),
        );
        object.scale.set(item.scale.x, item.scale.y, item.scale.z);
        object.userData.spatialObjectId = item.id;
        object.userData.entityId = item.entityId;
        object.traverse((node) => {
          node.userData.zoneId = item.zoneId;
          node.userData.spatialObjectId = item.id;
          node.userData.entityId = item.entityId;
        });
        group.add(object);
      });
    }

    this.entities.forEach((entity) => {
      const marker = new THREE.Mesh(
        new THREE.CylinderGeometry(0.055, 0.07, 0.075, 20),
        new THREE.MeshStandardMaterial({ color: entity.entity.startsWith('light.') ? 0xe6c982 : 0x8db8c1, roughness: 0.3, emissive: entity.entity.startsWith('light.') ? 0x4b3914 : 0x183237 }),
      );
      const center = this._spatialCenter();
      marker.position.set(
        entity.spatial ? entity.spatial.position.x - center.x : (entity.x - 50) * this.dimensions.width / 100,
        entity.spatial ? entity.spatial.position.y : 0.16,
        entity.spatial ? entity.spatial.position.z - center.y : (entity.y - 50) * this.dimensions.width / this.dimensions.aspectRatio / 100,
      );
      marker.rotation.set(
        THREE.MathUtils.degToRad(entity.spatial?.rotation.x ?? 0),
        THREE.MathUtils.degToRad(entity.spatial?.rotation.y ?? 0),
        THREE.MathUtils.degToRad(entity.spatial?.rotation.z ?? 0),
      );
      marker.visible = entity.spatial?.visible ?? true;
      marker.userData.zoneId = entity.zoneId;
      marker.userData.entityId = entity.entity;
      marker.castShadow = true;
      group.add(marker);
    });

    group.updateMatrixWorld(true);
    const contentBounds = new THREE.Box3().setFromObject(group);
    if (!contentBounds.isEmpty()) {
      this._overviewBounds = contentBounds.clone();
      const contentSize = contentBounds.getSize(new THREE.Vector3());
      this._modelRadius = Math.max(1, Math.hypot(contentSize.x, contentSize.z) / 2);
    }

    this._model = group;
    this._scene.add(group);
    this._updateEntityStateVisuals();
    this._applyFocus();
    this._moveCameraTo(this.focusedZoneId);
  }

  private _createSurveyShell(shell: SpatialShellConfig): THREE.Group {
    const result = new THREE.Group();
    const cutawayPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1.32);
    const allPoints = shell.outer;
    const minX = Math.min(...allPoints.map(([x]) => x));
    const maxX = Math.max(...allPoints.map(([x]) => x));
    const minZ = Math.min(...allPoints.map(([, z]) => z));
    const maxZ = Math.max(...allPoints.map(([, z]) => z));
    const centerX = (minX + maxX) / 2;
    const centerZ = (minZ + maxZ) / 2;
    const project = ([x, z]: [number, number]): THREE.Vector2 => new THREE.Vector2(x - centerX, z - centerZ);
    const pathFrom = (points: [number, number][]): THREE.Path => {
      const path = new THREE.Path();
      const first = project(points[0]);
      path.moveTo(first.x, first.y);
      points.slice(1).forEach((point) => {
        const projected = project(point);
        path.lineTo(projected.x, projected.y);
      });
      path.closePath();
      return path;
    };
    if (shell.walls?.length) {
      result.add(this._createSurveyWalls(shell, centerX, centerZ));
    } else {
      const wallShape = new THREE.Shape();
      const outer = project(shell.outer[0]);
      wallShape.moveTo(outer.x, outer.y);
      shell.outer.slice(1).forEach((point) => {
        const projected = project(point);
        wallShape.lineTo(projected.x, projected.y);
      });
      wallShape.closePath();
      shell.holes.forEach((hole) => wallShape.holes.push(pathFrom(hole)));
      const wallGeometry = new THREE.ExtrudeGeometry(wallShape, {
        depth: this.dimensions.wallHeight,
        bevelEnabled: false,
        curveSegments: 12,
      });
      wallGeometry.rotateX(Math.PI / 2);
      wallGeometry.translate(0, this.dimensions.wallHeight, 0);
      const walls = new THREE.Mesh(
        wallGeometry,
        new THREE.MeshStandardMaterial({
          color: 0xd7dcdb,
          roughness: 0.9,
          clippingPlanes: [cutawayPlane],
          clipShadows: true,
        }),
      );
      walls.castShadow = true;
      walls.receiveShadow = true;
      result.add(walls);
    }

    const baseFloors = [shell.floor, ...(shell.floors ?? [])].filter((floorPoints) => floorPoints.length >= 3);
    const hasBaseFloor = baseFloors.length > 0;
    baseFloors.forEach((floorPoints) => {
      const floorShape = new THREE.Shape();
      const floorStart = project(floorPoints[0]);
      floorShape.moveTo(floorStart.x, floorStart.y);
      floorPoints.slice(1).forEach((point) => {
        const projected = project(point);
        floorShape.lineTo(projected.x, projected.y);
      });
      floorShape.closePath();
      const floorGeometry = new THREE.ExtrudeGeometry(floorShape, { depth: FLOOR_HEIGHT, bevelEnabled: false, curveSegments: 12 });
      floorGeometry.rotateX(Math.PI / 2);
      const floor = new THREE.Mesh(floorGeometry, this._surveyFloorMaterial());
      floor.receiveShadow = true;
      floor.userData.surveyFloor = true;
      result.add(floor);
    });

    shell.rooms?.forEach((room) => {
      [room.floor, ...(room.floors ?? [])].forEach((floorPoints) => {
        const centroid = floorPoints.reduce((total, [x, z]) => ({ x: total.x + x, z: total.z + z }), { x: 0, z: 0 });
        centroid.x /= floorPoints.length;
        centroid.z /= floorPoints.length;
        const expandedPoints = floorPoints.map(([x, z]) => {
          const direction = new THREE.Vector2(x - centroid.x, z - centroid.z);
          if (direction.lengthSq() === 0) return [x, z] as [number, number];
          direction.normalize().multiplyScalar(0.015);
          return [x + direction.x, z + direction.y] as [number, number];
        });
        const floorShape = new THREE.Shape();
        const first = project(expandedPoints[0]);
        floorShape.moveTo(first.x, first.y);
        expandedPoints.slice(1).forEach((point) => {
          const projected = project(point);
          floorShape.lineTo(projected.x, projected.y);
        });
        floorShape.closePath();
        const geometry = new THREE.ExtrudeGeometry(floorShape, { depth: FLOOR_HEIGHT, bevelEnabled: false });
        geometry.rotateX(Math.PI / 2);
        const zone = this.zones.find((candidate) => candidate.id === room.zoneId);
        const material = this._roomFloorMaterial(room.finish, room.color, zone?.floorColor);
        material.transparent = hasBaseFloor;
        material.opacity = hasBaseFloor ? 0.001 : 1;
        material.depthWrite = !hasBaseFloor;
        const floor = new THREE.Mesh(geometry, material);
        floor.receiveShadow = true;
        floor.userData.zoneId = room.zoneId;
        floor.userData.roomFloor = true;
        floor.userData.architecturalRoomFloor = true;
        result.add(floor);
      });
    });

    if (!shell.walls?.length) shell.openings.forEach((opening) => {
      const angle = THREE.MathUtils.degToRad(opening.rotation);
      const x = opening.x - centerX;
      const z = opening.z - centerZ;
      const top = opening.bottom + opening.height;
      if (opening.kind === 'door' && top < this.dimensions.wallHeight) {
        const lintelHeight = this.dimensions.wallHeight - top;
        const lintel = this._box(opening.width, lintelHeight, opening.depth, 0xd7dcdb, top + lintelHeight / 2);
        lintel.position.x = x;
        lintel.position.z = z;
        lintel.rotation.y = -angle;
        const lintelMaterial = lintel.material as THREE.MeshStandardMaterial;
        lintelMaterial.clippingPlanes = [cutawayPlane];
        lintelMaterial.clipShadows = true;
        result.add(lintel);
      }
      if (opening.kind === 'window') {
        const visibleHeight = Math.max(0.2, Math.min(opening.height, 1.28 - opening.bottom));
        const glass = this._box(opening.width * 0.92, visibleHeight, 0.025, 0x8db9c3, opening.bottom + visibleHeight / 2);
        glass.position.x = x;
        glass.position.z = z;
        glass.rotation.y = -angle;
        const glassMaterial = glass.material as THREE.MeshStandardMaterial;
        glassMaterial.transparent = true;
        glassMaterial.opacity = 0.62;
        glassMaterial.emissive.setHex(0x17343a);
        glassMaterial.clippingPlanes = [cutawayPlane];
        glassMaterial.clipShadows = true;
        result.add(glass);
      }
    });
    result.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        node.castShadow = true;
        node.receiveShadow = true;
      }
    });
    return result;
  }

  private _createSurveyWalls(
    shell: SpatialShellConfig,
    centerX: number,
    centerZ: number,
  ): THREE.Group {
    const result = new THREE.Group();
    const sectionHeight = this.dimensions.wallHeight;
    const wallMaterial = () => new THREE.MeshStandardMaterial({
      color: 0xd7dcdb,
      roughness: 0.9,
    });
    const angleDistance = (left: number, right: number): number => {
      const delta = Math.abs(((left - right + 90) % 180 + 180) % 180 - 90);
      return Math.min(delta, 180 - delta);
    };

    shell.walls?.forEach((wall) => {
      const defaultThickness = wall.thickness ?? 0.3;
      if (wall.smooth) {
        const ribbon = this._createSurveyWallRibbon(wall.points, defaultThickness, sectionHeight, centerX, centerZ);
        const anchor = wall.points.reduce((total, [x, z]) => total.add(new THREE.Vector2(x - centerX, z - centerZ)), new THREE.Vector2()).divideScalar(wall.points.length);
        ribbon.traverse((node) => {
          if (node instanceof THREE.Mesh) node.userData.architecturalWall = true;
        });
        this._setObjectZoneIds(ribbon, wall.zoneIds ?? [], anchor);
        result.add(ribbon);
        const cutawayRibbon = this._createSurveyWallRibbon(
          wall.points,
          defaultThickness,
          sectionHeight * 0.1,
          centerX,
          centerZ,
        );
        cutawayRibbon.visible = false;
        cutawayRibbon.traverse((node) => {
          if (!(node instanceof THREE.Mesh)) return;
          node.userData.cutawayReplacement = true;
          node.visible = false;
        });
        this._setObjectZoneIds(cutawayRibbon, wall.zoneIds ?? [], anchor);
        result.add(cutawayRibbon);
        shell.openings.filter((opening) => opening.kind === 'window').forEach((opening) => {
          const angle = THREE.MathUtils.degToRad(opening.rotation);
          const matchingSegment = wall.points.slice(0, -1).some(([startX, startZ], index) => {
            const [endX, endZ] = wall.points[index + 1];
            const dx = endX - startX;
            const dz = endZ - startZ;
            const length = Math.hypot(dx, dz);
            const ux = dx / length;
            const uz = dz / length;
            const relativeX = opening.x - startX;
            const relativeZ = opening.z - startZ;
            const along = relativeX * ux + relativeZ * uz;
            const distance = Math.abs(relativeX * -uz + relativeZ * ux);
            const segmentAngle = THREE.MathUtils.radToDeg(Math.atan2(dz, dx));
            return along >= -0.06 && along <= length + 0.06 && distance <= defaultThickness && angleDistance(segmentAngle, opening.rotation) <= 18;
          });
          if (!matchingSegment) return;
          const visibleTop = Math.min(opening.bottom + opening.height, sectionHeight - 0.01);
          const visibleHeight = Math.max(0.02, visibleTop - opening.bottom);
          const recess = this._box(opening.width, visibleHeight, defaultThickness * 1.08, 0x20292b, opening.bottom + visibleHeight / 2);
          recess.position.x = opening.x - centerX;
          recess.position.z = opening.z - centerZ;
          recess.rotation.y = -angle;
          recess.userData.wallOpening = true;
          this._setObjectZoneIds(recess, wall.zoneIds ?? [], anchor);
          result.add(recess);
          const glass = this._box(opening.width * 0.88, visibleHeight * 0.94, 0.025, 0x658f99, opening.bottom + visibleHeight / 2);
          glass.position.x = opening.x - centerX;
          glass.position.z = opening.z - centerZ;
          glass.rotation.y = -angle;
          const material = glass.material as THREE.MeshStandardMaterial;
          material.emissive.setHex(0x112b30);
          material.roughness = 0.2;
          material.transparent = true;
          material.opacity = 0.7;
          glass.userData.wallOpening = true;
          this._setObjectZoneIds(glass, wall.zoneIds ?? [], anchor);
          result.add(glass);
        });
        return;
      }
      for (let index = 0; index < wall.points.length - 1; index += 1) {
        const thickness = wall.segmentThicknesses?.[index] ?? defaultThickness;
        const [startX, startZ] = wall.points[index];
        const [endX, endZ] = wall.points[index + 1];
        const dx = endX - startX;
        const dz = endZ - startZ;
        const length = Math.hypot(dx, dz);
        if (length < 0.01) continue;
        const ux = dx / length;
        const uz = dz / length;
        const segmentAngle = THREE.MathUtils.radToDeg(Math.atan2(dz, dx));
        const openings = shell.openings.map((opening) => {
          const relativeX = opening.x - startX;
          const relativeZ = opening.z - startZ;
          const along = relativeX * ux + relativeZ * uz;
          const distance = Math.abs(relativeX * -uz + relativeZ * ux);
          return { opening, along, distance };
        }).filter(({ opening, along, distance }) => (
          along >= -0.06
          && along <= length + 0.06
          && distance <= Math.max(thickness * 0.85, opening.depth * 0.65)
          && angleDistance(segmentAngle, opening.rotation) <= 18
        )).sort((left, right) => left.along - right.along);

        const segmentGroup = new THREE.Group();
        const addWallBox = (from: number, to: number, bottom = 0, height = sectionHeight): void => {
          if (to - from <= 0.015 || height <= 0.015) return;
          const mesh = new THREE.Mesh(new THREE.BoxGeometry(to - from, height, thickness), wallMaterial());
          mesh.position.set((from + to) / 2 - length / 2, bottom + height / 2, 0);
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          mesh.userData.architecturalWall = true;
          segmentGroup.add(mesh);
        };
        let cursor = 0;
        openings.forEach(({ opening, along }) => {
          const from = Math.max(cursor, along - opening.width / 2);
          const to = Math.min(length, along + opening.width / 2);
          addWallBox(cursor, from);
          const top = Math.min(sectionHeight, opening.bottom + opening.height);
          addWallBox(from, to, 0, Math.max(0, opening.bottom));
          addWallBox(from, to, top, sectionHeight - top);

          const openingCenter = (from + to) / 2 - length / 2;
          if (opening.kind === 'window') {
            const visibleTop = Math.min(top, sectionHeight - 0.01);
            const visibleHeight = Math.max(0.02, visibleTop - opening.bottom);
            const glass = new THREE.Mesh(
              new THREE.BoxGeometry(Math.max(0.04, to - from - 0.06), visibleHeight, 0.025),
              new THREE.MeshStandardMaterial({
                color: 0x79a8b2,
                emissive: 0x142f34,
                roughness: 0.18,
                metalness: 0.08,
                transparent: true,
                opacity: 0.58,
              }),
            );
            glass.position.set(openingCenter, opening.bottom + visibleHeight / 2, 0);
            glass.userData.wallOpening = true;
            segmentGroup.add(glass);
            [-1, 1].forEach((side) => {
              const jamb = new THREE.Mesh(new THREE.BoxGeometry(0.035, visibleHeight, thickness * 1.04), wallMaterial());
              jamb.position.set(openingCenter + side * (to - from - 0.035) / 2, opening.bottom + visibleHeight / 2, 0);
              jamb.userData.wallOpening = true;
              segmentGroup.add(jamb);
            });
          } else {
            const panelHeight = Math.min(opening.height, sectionHeight - 0.01);
            const panel = new THREE.Mesh(
              new THREE.BoxGeometry(Math.max(0.04, to - from - 0.045), panelHeight, 0.045),
              new THREE.MeshStandardMaterial({ color: 0x8f887d, roughness: 0.78 }),
            );
            panel.position.set(openingCenter, panelHeight / 2, 0);
            panel.userData.wallOpening = true;
            segmentGroup.add(panel);
          }
          cursor = Math.max(cursor, to);
        });
        addWallBox(cursor, length);
        segmentGroup.position.set((startX + endX) / 2 - centerX, 0, (startZ + endZ) / 2 - centerZ);
        segmentGroup.rotation.y = -Math.atan2(dz, dx);
        segmentGroup.userData.wallId = `${wall.id}:${index}`;
        this._setObjectZoneIds(
          segmentGroup,
          wall.segmentZoneIds?.[index] ?? wall.zoneIds ?? [],
          new THREE.Vector2(segmentGroup.position.x, segmentGroup.position.z),
        );
        result.add(segmentGroup);

        const cutaway = new THREE.Group();
        const addCutawayBox = (from: number, to: number): void => {
          if (to - from <= 0.015) return;
          const mesh = new THREE.Mesh(
            new THREE.BoxGeometry(to - from, sectionHeight * 0.1, thickness),
            wallMaterial(),
          );
          mesh.position.set((from + to) / 2 - length / 2, sectionHeight * 0.05, 0);
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          mesh.visible = false;
          mesh.userData.cutawayReplacement = true;
          cutaway.add(mesh);
        };
        let cutawayCursor = 0;
        openings
          .filter(({ opening }) => opening.kind === 'door')
          .forEach(({ opening, along }) => {
            const from = Math.max(cutawayCursor, along - opening.width / 2);
            const to = Math.min(length, along + opening.width / 2);
            addCutawayBox(cutawayCursor, from);
            cutawayCursor = Math.max(cutawayCursor, to);
          });
        addCutawayBox(cutawayCursor, length);
        cutaway.position.set(
          (startX + endX) / 2 - centerX,
          0,
          (startZ + endZ) / 2 - centerZ,
        );
        cutaway.rotation.y = -Math.atan2(dz, dx);
        cutaway.visible = true;
        cutaway.userData.wallId = `${wall.id}:${index}:cutaway`;
        this._setObjectZoneIds(
          cutaway,
          wall.segmentZoneIds?.[index] ?? wall.zoneIds ?? [],
          new THREE.Vector2(cutaway.position.x, cutaway.position.z),
        );
        result.add(cutaway);
      }
    });
    return result;
  }

  private _createSurveyWallRibbon(
    points: [number, number][],
    thickness: number,
    height: number,
    centerX: number,
    centerZ: number,
  ): THREE.Mesh {
    const half = thickness / 2;
    const offsets = points.map(([x, z], index) => {
      const previous = points[Math.max(0, index - 1)];
      const next = points[Math.min(points.length - 1, index + 1)];
      const previousDirection = new THREE.Vector2(x - previous[0], z - previous[1]).normalize();
      const nextDirection = new THREE.Vector2(next[0] - x, next[1] - z).normalize();
      if (index === 0) previousDirection.copy(nextDirection);
      if (index === points.length - 1) nextDirection.copy(previousDirection);
      const previousNormal = new THREE.Vector2(-previousDirection.y, previousDirection.x);
      const nextNormal = new THREE.Vector2(-nextDirection.y, nextDirection.x);
      const miter = previousNormal.clone().add(nextNormal).normalize();
      const denominator = Math.max(0.3, Math.abs(miter.dot(nextNormal)));
      return miter.multiplyScalar(Math.min(half / denominator, thickness));
    });
    const outer = points.map(([x, z], index) => [x + offsets[index].x - centerX, z + offsets[index].y - centerZ] as [number, number]);
    const inner = points.map(([x, z], index) => [x - offsets[index].x - centerX, z - offsets[index].y - centerZ] as [number, number]).reverse();
    const contour = [...outer, ...inner];
    const shape = new THREE.Shape();
    shape.moveTo(contour[0][0], contour[0][1]);
    contour.slice(1).forEach(([x, z]) => shape.lineTo(x, z));
    shape.closePath();
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false });
    geometry.rotateX(Math.PI / 2);
    geometry.translate(0, height, 0);
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
      color: 0xd7dcdb,
      roughness: 0.9,
    }));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  private async _loadModel(): Promise<void> {
    if (!this.modelUrl) {
      this._importedModel = undefined;
      this._buildModel();
      return;
    }
    this._loadingModel = true;
    this._error = '';
    try {
      const gltf = await new GLTFLoader().loadAsync(this.modelUrl);
      const imported = gltf.scene;
      imported.updateMatrixWorld(true);
      const initialBounds = new THREE.Box3().setFromObject(imported);
      const center = initialBounds.getCenter(new THREE.Vector3());
      imported.position.x -= center.x;
      imported.position.z -= center.z;
      imported.position.y -= initialBounds.min.y;
      imported.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(imported);
      const size = bounds.getSize(new THREE.Vector3());
      this._modelRadius = Math.max(size.x, size.z) * 0.64;
      imported.traverse((node) => {
        if (!(node instanceof THREE.Mesh)) return;
        node.userData.importedModel = true;
        node.castShadow = true;
        node.receiveShadow = true;
        const materials = Array.isArray(node.material) ? node.material : [node.material];
        materials.forEach((material) => {
          material.side = THREE.DoubleSide;
          material.needsUpdate = true;
        });
      });
      this._importedModel = imported;
      this._buildModel();
      this._moveCameraTo(this.focusedZoneId);
      this.dispatchEvent(new CustomEvent('spatial-model-loaded', {
        detail: { size: { x: size.x, y: size.y, z: size.z } },
        bubbles: true,
        composed: true,
      }));
    } catch (error) {
      this._error = error instanceof Error ? error.message : 'The 3D model could not be loaded.';
    } finally {
      this._loadingModel = false;
    }
  }

  private _material(color: number, roughness = 0.78): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.02 });
  }

  private _surveyFloorMaterial(): THREE.MeshStandardMaterial {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const context = canvas.getContext('2d');
    if (context) {
      context.fillStyle = '#8c795f';
      context.fillRect(0, 0, canvas.width, canvas.height);
      const plankHeight = 32;
      for (let row = 0; row < canvas.height / plankHeight; row += 1) {
        const offset = row % 2 ? -96 : 0;
        for (let x = offset; x < canvas.width; x += 128) {
          const variation = ((row * 17 + x * 7) % 19) - 9;
          context.fillStyle = `rgba(${variation > 0 ? 255 : 30}, ${variation > 0 ? 244 : 24}, ${variation > 0 ? 224 : 18}, ${Math.abs(variation) / 210})`;
          context.fillRect(x + 1, row * plankHeight + 1, 126, plankHeight - 2);
        }
      }
      context.strokeStyle = 'rgba(24, 20, 16, 0.16)';
      context.lineWidth = 1;
      for (let y = plankHeight; y < canvas.height; y += plankHeight) {
        context.beginPath();
        context.moveTo(0, y);
        context.lineTo(canvas.width, y);
        context.stroke();
      }
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(2.4, 2.4);
    return new THREE.MeshStandardMaterial({ map: texture, color: 0xc6b79f, roughness: 0.88, metalness: 0 });
  }

  private _tileFloorMaterial(color: number): THREE.MeshStandardMaterial {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const context = canvas.getContext('2d');
    if (context) {
      context.fillStyle = '#c7cdcb';
      context.fillRect(0, 0, 512, 512);
      context.strokeStyle = 'rgba(43, 54, 55, 0.18)';
      context.lineWidth = 3;
      for (let offset = 0; offset <= 512; offset += 128) {
        context.beginPath();
        context.moveTo(offset, 0);
        context.lineTo(offset, 512);
        context.moveTo(0, offset);
        context.lineTo(512, offset);
        context.stroke();
      }
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(2.2, 2.2);
    return new THREE.MeshStandardMaterial({ map: texture, color, roughness: 0.94, metalness: 0 });
  }

  private _roomFloorMaterial(
    finish: SpatialFloorFinish | undefined,
    color: string | undefined,
    fallbackColor: number | undefined,
  ): THREE.MeshStandardMaterial {
    const parsedColor = color ? new THREE.Color(color).getHex() : fallbackColor;
    if (finish === 'tile') return this._tileFloorMaterial(parsedColor ?? 0x8b9695);
    if (finish === 'stone') return new THREE.MeshStandardMaterial({ color: parsedColor ?? 0x929796, roughness: 0.96, metalness: 0 });
    if (finish === 'carpet') return new THREE.MeshStandardMaterial({ color: parsedColor ?? 0x6f7473, roughness: 1, metalness: 0 });
    if (finish === 'custom') return new THREE.MeshStandardMaterial({ color: parsedColor ?? 0x787f7e, roughness: 0.9, metalness: 0 });
    const material = this._surveyFloorMaterial();
    if (parsedColor !== undefined) material.color.setHex(parsedColor);
    return material;
  }

  private _box(width: number, height: number, depth: number, color: number, y = height / 2, radius = 0): THREE.Mesh {
    const geometry = radius > 0
      ? new THREE.BoxGeometry(Math.max(0.02, width - radius), height, Math.max(0.02, depth - radius), 2, 2, 2)
      : new THREE.BoxGeometry(width, height, depth);
    const mesh = new THREE.Mesh(geometry, this._material(color));
    mesh.position.y = y;
    return mesh;
  }

  private _createFurnishing(item: FurnishingConfig): THREE.Group {
    const group = new THREE.Group();
    const width = Math.max(0.08, item.width * this.dimensions.width / 100);
    const depth = Math.max(0.08, item.depth * this.dimensions.width / this.dimensions.aspectRatio / 100);
    const height = item.height ?? 0.75;
    const color = item.color ?? 0xbfc5c4;
    if (item.kind === 'rug') {
      group.add(this._box(width, 0.018, depth, color, 0.012));
    } else if (item.kind === 'sofa') {
      group.add(this._box(width, height * 0.42, depth, color, height * 0.21, 0.04));
      group.add(this._box(width, height * 0.72, depth * 0.24, color, height * 0.58, 0.03));
      const cushionCount = Math.max(2, Math.round(item.width / 8));
      for (let index = 0; index < cushionCount; index += 1) {
        const cushion = this._box(width / cushionCount * 0.9, height * 0.18, depth * 0.68, 0xd8dcdb, height * 0.47, 0.03);
        cushion.position.x = -width / 2 + (index + 0.5) * (width / cushionCount);
        cushion.position.z = depth * 0.08;
        group.add(cushion);
      }
      const armWidth = Math.min(width * 0.12, 0.18);
      const left = this._box(armWidth, height * 0.62, depth, color, height * 0.34);
      left.position.x = -width / 2 + armWidth / 2;
      const right = left.clone();
      right.position.x = width / 2 - armWidth / 2;
      group.add(left, right);
    } else if (item.kind === 'armchair') {
      const sofa: FurnishingConfig = { ...item, kind: 'sofa', width: item.width, depth: item.depth };
      return this._createFurnishing(sofa);
    } else if (item.kind === 'bed') {
      group.add(this._box(width, height * 0.38, depth, 0xa38d73, height * 0.19));
      group.add(this._box(width * 0.94, height * 0.34, depth * 0.9, color, height * 0.42));
      const headboard = this._box(width, height * 1.25, depth * 0.08, 0x81766d, height * 0.63);
      headboard.position.z = -depth / 2 + depth * 0.04;
      group.add(headboard);
      [-0.24, 0.24].forEach((offset) => {
        const pillow = this._box(width * 0.39, height * 0.16, depth * 0.22, 0xe2e3df, height * 0.64);
        pillow.position.set(width * offset, height * 0.64, -depth * 0.28);
        group.add(pillow);
      });
    } else if (item.kind === 'table' || item.kind === 'island') {
      const topHeight = item.kind === 'island' ? Math.max(height, 0.42) : Math.max(height, 0.32);
      group.add(this._box(width, 0.08, depth, color, topHeight));
      const inset = Math.min(width, depth) * 0.16;
      [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([x, z]) => {
        const leg = this._box(0.055, topHeight, 0.055, 0x3a3e3e, topHeight / 2);
        leg.position.set(x * (width / 2 - inset), topHeight / 2, z * (depth / 2 - inset));
        group.add(leg);
      });
    } else if (item.kind === 'chair') {
      group.add(this._box(width, height * 0.12, depth, color, height * 0.54));
      const back = this._box(width, height * 0.78, depth * 0.12, color, height * 0.87);
      back.position.z = -depth / 2 + depth * 0.06;
      group.add(back);
      [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([x, z]) => {
        const leg = this._box(0.035, height * 0.54, 0.035, 0x414545, height * 0.27);
        leg.position.set(x * width * 0.36, height * 0.27, z * depth * 0.36);
        group.add(leg);
      });
    } else if (item.kind === 'tv') {
      const screen = this._box(width, Math.max(height, depth * 0.62), 0.035, 0x07090a, Math.max(height, depth * 0.62) / 2 + 0.22);
      const display = new THREE.Mesh(
        new THREE.PlaneGeometry(width * 0.92, Math.max(height, depth * 0.62) * 0.84),
        new THREE.MeshStandardMaterial({ color: 0x16272b, emissive: 0x071417, emissiveIntensity: 0.5, roughness: 0.22 }),
      );
      display.position.set(0, screen.position.y, 0.019);
      group.add(screen, display);
    } else if (item.kind === 'bathtub') {
      const rimHeight = Math.max(0.46, height);
      const rim = 0.09;
      group.add(this._box(width, rimHeight * 0.76, depth, 0xd8dedc, rimHeight * 0.38, 0.05));
      const basin = this._box(width - rim * 2, 0.025, depth - rim * 2, 0x6f8587, rimHeight * 0.77);
      const basinMaterial = basin.material as THREE.MeshStandardMaterial;
      basinMaterial.roughness = 0.28;
      basinMaterial.metalness = 0.08;
      group.add(basin);
      const longRimDepth = Math.max(0.04, rim);
      [-1, 1].forEach((side) => {
        const edge = this._box(width, 0.055, longRimDepth, 0xf1f3f1, rimHeight * 0.82);
        edge.position.z = side * (depth / 2 - longRimDepth / 2);
        group.add(edge);
      });
      [-1, 1].forEach((side) => {
        const edge = this._box(rim, 0.055, depth - rim * 2, 0xf1f3f1, rimHeight * 0.82);
        edge.position.x = side * (width / 2 - rim / 2);
        group.add(edge);
      });
    } else if (item.kind === 'vanity') {
      const cabinetHeight = Math.max(0.68, height);
      group.add(this._box(width, cabinetHeight, depth, color, cabinetHeight / 2));
      group.add(this._box(width * 1.03, 0.045, depth * 1.08, 0xe7e9e6, cabinetHeight + 0.022));
      const sink = new THREE.Mesh(
        new THREE.CylinderGeometry(Math.min(width * 0.18, 0.19), Math.min(width * 0.16, 0.17), 0.035, 24),
        new THREE.MeshStandardMaterial({ color: 0xc4d0cf, roughness: 0.24, metalness: 0.05 }),
      );
      sink.position.set(0, cabinetHeight + 0.05, 0);
      group.add(sink);
    } else if (item.kind === 'console' || item.kind === 'cabinet') {
      group.add(this._box(width, Math.max(height, 0.24), depth, color, Math.max(height, 0.24) / 2));
      if (item.kind === 'console') {
        const seam = this._box(0.012, Math.max(height, 0.24) * 0.72, depth * 1.01, 0x303535, Math.max(height, 0.24) / 2);
        group.add(seam);
      }
    } else if (item.kind === 'plant') {
      const pot = new THREE.Mesh(new THREE.CylinderGeometry(width * 0.24, width * 0.34, Math.max(0.16, height * 0.45), 16), this._material(0x66605a));
      pot.position.y = Math.max(0.16, height * 0.45) / 2;
      group.add(pot);
      for (let index = 0; index < 9; index += 1) {
        const leaf = new THREE.Mesh(new THREE.SphereGeometry(width * (0.18 + (index % 3) * 0.04), 10, 8), this._material(index % 2 ? 0x52664f : 0x65765c, 0.9));
        const angle = (index / 9) * Math.PI * 2;
        leaf.scale.set(0.75, 1.45, 0.65);
        leaf.position.set(Math.cos(angle) * width * 0.24, height * (0.5 + (index % 3) * 0.17), Math.sin(angle) * width * 0.24);
        group.add(leaf);
      }
    } else if (item.kind === 'floorlamp') {
      const metal = this._material(color, 0.52);
      const base = new THREE.Mesh(new THREE.CylinderGeometry(width * 0.3, width * 0.34, 0.045, 24), metal);
      base.position.y = 0.023;
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, height * 0.78, 16), metal);
      stem.position.y = height * 0.39;
      const shade = new THREE.Mesh(
        new THREE.CylinderGeometry(width * 0.24, width * 0.38, height * 0.22, 24, 1, true),
        new THREE.MeshStandardMaterial({ color: 0xd9d5c9, roughness: 0.84, emissive: 0x362f20, emissiveIntensity: 0.18, side: THREE.DoubleSide }),
      );
      shade.position.y = height * 0.84;
      group.add(base, stem, shade);
    } else if (item.kind === 'window') {
      const glass = this._box(width, Math.max(height, 0.48), 0.025, 0x8eb8c2, Math.max(height, 0.48) / 2 + 0.14);
      (glass.material as THREE.MeshStandardMaterial).transparent = true;
      (glass.material as THREE.MeshStandardMaterial).opacity = 0.42;
      group.add(glass);
      [-0.5, 0, 0.5].forEach((offset) => {
        const mullion = this._box(0.025, Math.max(height, 0.48) + 0.05, 0.035, 0x424a4c, Math.max(height, 0.48) / 2 + 0.14);
        mullion.position.x = offset * width;
        group.add(mullion);
      });
    } else if (item.kind === 'door') {
      group.add(this._box(width, Math.max(height, 0.64), 0.04, color, Math.max(height, 0.64) / 2));
    }
    return group;
  }

  private _wallWithOpenings(
    length: number,
    height: number,
    depth: number,
    openings: OpeningConfig[],
    material: THREE.MeshStandardMaterial,
  ): THREE.Group {
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(length, 0);
    shape.lineTo(length, height);
    shape.lineTo(0, height);
    shape.closePath();

    const normalized = openings.map((opening) => {
      const width = Math.min(length * 0.8, Math.max(0.18, length * opening.width));
      const center = Math.min(length - width / 2 - 0.04, Math.max(width / 2 + 0.04, length * opening.position));
      const bottom = opening.kind === 'door' ? -0.01 : height * 0.3;
      const top = opening.kind === 'door' ? height * 0.84 : height * 0.72;
      const hole = new THREE.Path();
      hole.moveTo(center - width / 2, bottom);
      hole.lineTo(center - width / 2, top);
      hole.lineTo(center + width / 2, top);
      hole.lineTo(center + width / 2, bottom);
      hole.closePath();
      shape.holes.push(hole);
      return { opening, width, center, bottom, top };
    });

    const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 1 });
    geometry.translate(0, 0, -depth / 2);
    const wallMesh = new THREE.Mesh(geometry, material.clone());
    wallMesh.castShadow = true;
    wallMesh.receiveShadow = true;
    const result = new THREE.Group();
    result.add(wallMesh);

    normalized.forEach(({ opening, width, center, bottom, top }) => {
      const insertHeight = top - bottom;
      if (opening.kind === 'window') {
        const glass = new THREE.Mesh(
          new THREE.BoxGeometry(width * 0.92, insertHeight * 0.9, depth * 0.28),
          new THREE.MeshPhysicalMaterial({ color: 0x9cc6cf, transparent: true, opacity: 0.34, roughness: 0.12, metalness: 0.05 }),
        );
        glass.position.set(center, bottom + insertHeight / 2, 0);
        result.add(glass);
      } else {
        const door = new THREE.Mesh(
          new THREE.BoxGeometry(width * 0.92, insertHeight * 0.96, depth * 0.34),
          new THREE.MeshStandardMaterial({ color: 0x8a8277, roughness: 0.76 }),
        );
        door.position.set(center, bottom + insertHeight / 2, 0);
        result.add(door);
      }
    });
    return result;
  }

  private _curvedWall(
    length: number,
    height: number,
    depth: number,
    curve: number,
    openings: OpeningConfig[],
    material: THREE.MeshStandardMaterial,
  ): THREE.Group {
    const result = new THREE.Group();
    const segments = 36;
    const bulge = curve * length * 0.38;
    const point = (t: number) => new THREE.Vector2(length * t, 2 * (1 - t) * t * bulge);
    const blocked = (t: number) => openings.some((opening) => Math.abs(t - opening.position) <= opening.width / 2);
    for (let index = 0; index < segments; index += 1) {
      const startT = index / segments;
      const endT = (index + 1) / segments;
      const midT = (startT + endT) / 2;
      if (blocked(midT)) continue;
      const start = point(startT);
      const end = point(endT);
      const dx = end.x - start.x;
      const dz = end.y - start.y;
      const wall = new THREE.Mesh(new THREE.BoxGeometry(Math.hypot(dx, dz) + 0.01, height, depth), material.clone());
      wall.position.set((start.x + end.x) / 2, height / 2, (start.y + end.y) / 2);
      wall.rotation.y = -Math.atan2(dz, dx);
      wall.castShadow = true;
      wall.receiveShadow = true;
      result.add(wall);
    }
    openings.forEach((opening) => {
      const center = point(opening.position);
      const before = point(Math.max(0, opening.position - 0.01));
      const after = point(Math.min(1, opening.position + 0.01));
      const width = Math.max(0.18, length * opening.width * 0.92);
      const insertHeight = opening.kind === 'door' ? height * 0.84 : height * 0.42;
      const insert = new THREE.Mesh(
        new THREE.BoxGeometry(width, insertHeight, depth * 0.3),
        opening.kind === 'window'
          ? new THREE.MeshPhysicalMaterial({ color: 0x9cc6cf, transparent: true, opacity: 0.34, roughness: 0.1 })
          : new THREE.MeshStandardMaterial({ color: 0x8a8277, roughness: 0.76 }),
      );
      insert.position.set(center.x, opening.kind === 'door' ? insertHeight / 2 : height * 0.3 + insertHeight / 2, center.y);
      insert.rotation.y = -Math.atan2(after.y - before.y, after.x - before.x);
      result.add(insert);
    });
    return result;
  }

  private _updateSun(): void {
    if (!this._sun) return;
    const latitude = this.site.latitude ?? this.latitude;
    const longitude = this.site.longitude ?? this.longitude;
    const solar = SunCalc.getPosition(new Date(), latitude, longitude);
    const altitude = Math.max(0.04, solar.altitude);
    const bearing = solar.azimuth + Math.PI + THREE.MathUtils.degToRad(this.site.north);
    const horizontal = Math.cos(altitude) * 13;
    this._sun.position.set(
      Math.sin(bearing) * horizontal,
      Math.max(0.7, Math.sin(altitude) * 13),
      -Math.cos(bearing) * horizontal,
    );
    this._sun.intensity = solar.altitude > 0 ? 2.55 : 0.28;
  }

  private _surveyRoomMetrics(zoneId: string): { center: THREE.Vector3; radius: number } | undefined {
    const room = this._activeShell?.rooms?.find((candidate) => candidate.zoneId === zoneId);
    if (!room || !this._activeShell) return undefined;
    const regions = [room.floor, ...(room.floors ?? [])];
    const allPoints = regions.flat();
    const shellMinX = Math.min(...this._activeShell.outer.map(([x]) => x));
    const shellMaxX = Math.max(...this._activeShell.outer.map(([x]) => x));
    const shellMinZ = Math.min(...this._activeShell.outer.map(([, z]) => z));
    const shellMaxZ = Math.max(...this._activeShell.outer.map(([, z]) => z));
    const shellCenterX = (shellMinX + shellMaxX) / 2;
    const shellCenterZ = (shellMinZ + shellMaxZ) / 2;
    let weightedX = 0;
    let weightedZ = 0;
    let totalArea = 0;
    regions.forEach((points) => {
      let crossSum = 0;
      let centroidX = 0;
      let centroidZ = 0;
      points.forEach(([x, z], index) => {
        const [nextX, nextZ] = points[(index + 1) % points.length];
        const cross = x * nextZ - nextX * z;
        crossSum += cross;
        centroidX += (x + nextX) * cross;
        centroidZ += (z + nextZ) * cross;
      });
      const area = Math.abs(crossSum) / 2;
      if (area < 0.0001) return;
      weightedX += centroidX / (3 * crossSum) * area;
      weightedZ += centroidZ / (3 * crossSum) * area;
      totalArea += area;
    });
    const centerX = totalArea > 0 ? weightedX / totalArea : (Math.min(...allPoints.map(([x]) => x)) + Math.max(...allPoints.map(([x]) => x))) / 2;
    const centerZ = totalArea > 0 ? weightedZ / totalArea : (Math.min(...allPoints.map(([, z]) => z)) + Math.max(...allPoints.map(([, z]) => z))) / 2;
    const width = Math.max(...allPoints.map(([x]) => x)) - Math.min(...allPoints.map(([x]) => x));
    const depth = Math.max(...allPoints.map(([, z]) => z)) - Math.min(...allPoints.map(([, z]) => z));
    return {
      center: new THREE.Vector3(centerX - shellCenterX, 0.12, centerZ - shellCenterZ),
      radius: Math.max(1.2, Math.hypot(width, depth) / 2),
    };
  }

  private _zoneCenter(zone: SpatialZoneConfig): THREE.Vector3 {
    const shellMetrics = zone.id ? this._surveyRoomMetrics(zone.id) : undefined;
    if (shellMetrics) return shellMetrics.center;
    const points = this._zonePoints(zone);
    const center = points.reduce((total, point) => ({ x: total.x + point.x, y: total.y + point.y }), { x: 0, y: 0 });
    return new THREE.Vector3(
      (center.x / points.length - 50) * this.dimensions.width / 100,
      0.12,
      (center.y / points.length - 50) * this.dimensions.width / this.dimensions.aspectRatio / 100,
    );
  }

  private _zoneRadius(zone: SpatialZoneConfig): number {
    const shellMetrics = zone.id ? this._surveyRoomMetrics(zone.id) : undefined;
    if (shellMetrics) return shellMetrics.radius;
    const points = this._zonePoints(zone).map((point) => this._worldPoint(point));
    const minX = Math.min(...points.map((point) => point.x));
    const maxX = Math.max(...points.map((point) => point.x));
    const minZ = Math.min(...points.map((point) => point.y));
    const maxZ = Math.max(...points.map((point) => point.y));
    return Math.max(1.4, Math.hypot(maxX - minX, maxZ - minZ) / 2);
  }

  private _moveCameraTo(zoneId: string | null): void {
    if (!this._camera || !this._controls) return;
    this._clearOverviewReset();
    const zone = this.zones.find((candidate) => candidate.id === zoneId);
    const overviewPose = zone ? undefined : this._overviewPose();
    const target = zone ? this._zoneCenter(zone) : overviewPose?.target ?? new THREE.Vector3(0, 0, 0);
    const mobile = this.clientWidth < 600;
    const focusDistance = zone ? this._zoneRadius(zone) * (mobile ? 3.15 : 2.35) : 0;
    const position = zone
      ? target.clone().add(new THREE.Vector3(focusDistance * 0.55, focusDistance * 0.9, focusDistance * 0.82))
      : overviewPose?.position ?? new THREE.Vector3(
          this._modelRadius * (mobile ? 0.72 : 0.78),
          this._modelRadius * (mobile ? 2.15 : 1.54),
          this._modelRadius * (mobile ? 1.4 : 1.04),
        );
    this._cameraTween = {
      started: performance.now(),
      duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 1 : 520,
      fromPosition: this._camera.position.clone(),
      toPosition: position,
      fromTarget: this._controls.target.clone(),
      toTarget: target,
    };
    this._controls.autoRotate = false;
  }

  private _overviewPose(): { target: THREE.Vector3; position: THREE.Vector3 } | undefined {
    if (!this._camera || !this._overviewBounds || this._overviewBounds.isEmpty()) return undefined;
    const bounds = this._overviewBounds;
    const center = bounds.getCenter(new THREE.Vector3());
    const target = center.clone();
    target.y = Math.max(0, bounds.min.y) + 0.1;
    const mobile = this.clientWidth < 600;
    const direction = new THREE.Vector3(
      mobile ? 0.72 : 0.78,
      mobile ? 2.15 : 1.54,
      mobile ? 1.4 : 1.04,
    ).normalize();
    const forward = direction.clone().negate();
    const right = new THREE.Vector3().crossVectors(forward, this._camera.up).normalize();
    const up = new THREE.Vector3().crossVectors(right, forward).normalize();
    const verticalTangent = Math.tan(THREE.MathUtils.degToRad(this._camera.fov) / 2);
    const horizontalTangent = verticalTangent * Math.max(this._camera.aspect, 0.2);
    const corners = [bounds.min.x, bounds.max.x].flatMap((x) =>
      [bounds.min.y, bounds.max.y].flatMap((y) =>
        [bounds.min.z, bounds.max.z].map((z) => new THREE.Vector3(x, y, z))));
    const fitDistance = (): number => corners.reduce((distance, corner) => {
      const relative = corner.clone().sub(target);
      return Math.max(
        distance,
        relative.dot(direction) + Math.abs(relative.dot(right)) / horizontalTangent,
        relative.dot(direction) + Math.abs(relative.dot(up)) / verticalTangent,
      );
    }, this._camera!.near * 2) * 1.12;
    let distance = fitDistance();
    const projectedY = corners.map((corner) => {
      const relative = corner.clone().sub(target);
      const depth = distance - relative.dot(direction);
      return relative.dot(up) / (depth * verticalTangent);
    });
    const projectedCenter = (Math.min(...projectedY) + Math.max(...projectedY)) / 2;
    target.addScaledVector(up, THREE.MathUtils.clamp(projectedCenter * distance * verticalTangent, -2.5, 2.5));
    distance = fitDistance();
    return { target, position: target.clone().addScaledVector(direction, distance) };
  }

  private _clearOverviewReset(): void {
    if (this._overviewResetTimer === undefined) return;
    window.clearTimeout(this._overviewResetTimer);
    this._overviewResetTimer = undefined;
  }

  private _scheduleOverviewReset = (): void => {
    this._clearOverviewReset();
    if (this.focusedZoneId !== null) return;
    this._overviewResetTimer = window.setTimeout(() => {
      this._overviewResetTimer = undefined;
      if (this.focusedZoneId === null) this._moveCameraTo(null);
    }, 10_000);
  };

  private _applyFocus(): void {
    if (!this._model) return;
    this._model.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      if (node.userData.cutawayAnchor) this._setWallCutaway(node, false);
      node.userData.focusVisible = true;
      node.visible = true;
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      materials.forEach((material) => {
        if (material.userData.baseOpacity === undefined) material.userData.baseOpacity = material.opacity;
        if (material.userData.baseDepthWrite === undefined) material.userData.baseDepthWrite = material.depthWrite;
        if (material.userData.baseTransparent === undefined) material.userData.baseTransparent = material.transparent;
        material.transparent = material.userData.baseTransparent;
        material.opacity = material.userData.baseOpacity;
        material.depthWrite = material.userData.baseDepthWrite;
      });
    });
    this._applyWallCutaway();
  }

  private _applyWallCutaway(): void {
    if (!this._model) return;
    const reduced = this.hideWalls || Boolean(this.focusedZoneId);
    this._model.traverse((node) => {
      if (!(node instanceof THREE.Mesh) || !node.userData.cutawayAnchor) return;
      const focusVisible = Boolean(node.userData.focusVisible);
      if (node.userData.cutawayReplacement) {
        node.visible = focusVisible && reduced;
        return;
      }
      if (node.userData.architecturalWall || node.userData.wallOpening) {
        node.visible = focusVisible && !reduced;
        this._setWallCutaway(node, false);
        return;
      }
      node.visible = focusVisible;
      this._setWallCutaway(node, reduced);
    });
  }

  private _setWallCutaway(node: THREE.Mesh, reduced: boolean): void {
    if (node.userData.cutawayBaseScaleY === undefined) node.userData.cutawayBaseScaleY = node.scale.y;
    if (node.userData.cutawayBasePositionY === undefined) node.userData.cutawayBasePositionY = node.position.y;
    const factor = reduced ? 0.1 : 1;
    node.scale.y = (node.userData.cutawayBaseScaleY as number) * factor;
    node.position.y = (node.userData.cutawayBasePositionY as number) * factor;
    node.updateMatrix();
  }

  private _setObjectZoneIds(object: THREE.Object3D, zoneIds: string[], anchor?: THREE.Vector2): void {
    object.traverse((node) => {
      if (zoneIds.length) node.userData.zoneIds = zoneIds;
      if (anchor) node.userData.cutawayAnchor = [anchor.x, anchor.y];
    });
  }

  private _focusZone(zoneId: string | null): void {
    if (this.focusedZoneId === zoneId) return;
    this.focusedZoneId = zoneId;
    this.dispatchEvent(new CustomEvent('spatial-room-selected', { detail: { zoneId }, bubbles: true, composed: true }));
  }

  private _stopControlEvent(event: Event): void {
    event.stopPropagation();
  }

  private _selectEntity(entityId: string): void {
    this.dispatchEvent(new CustomEvent('spatial-entity-selected', {
      detail: { entityId }, bubbles: true, composed: true,
    }));
  }

  private _onPointerDown = (event: PointerEvent): void => {
    this._pointerStart = new THREE.Vector2(event.clientX, event.clientY);
  };

  private _onPointerUp = (event: PointerEvent): void => {
    if (!this._pointerStart || !this._camera || !this._model || !this._renderer) return;
    if (this._pointerStart.distanceTo(new THREE.Vector2(event.clientX, event.clientY)) > 7) return;
    const canvas = this._renderer.domElement;
    const rect = canvas.getBoundingClientRect();
    this._pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    this._raycaster.setFromCamera(this._pointer, this._camera);
    const hits = this._raycaster.intersectObjects(this._model.children, true);
    const entity = hits.find((hit) => hit.object.userData.entityId);
    if (entity) {
      this._selectEntity(entity.object.userData.entityId as string);
      return;
    }
    const floor = hits.find((hit) => hit.object.userData.roomFloor);
    if (floor) this._focusZone(floor.object.userData.zoneId as string);
  };

  private _resize(): void {
    if (!this._renderer || !this._camera) return;
    const width = Math.max(1, this.clientWidth);
    const height = Math.max(1, this.clientHeight);
    const previousAspect = this._camera.aspect;
    this._renderer.setSize(width, height, false);
    this._camera.aspect = width / height;
    this._camera.updateProjectionMatrix();
    if (
      this.focusedZoneId === null
      && this._overviewBounds
      && Math.abs(previousAspect - this._camera.aspect) > 0.01
    ) this._moveCameraTo(null);
  }

  private _animate = () => {
    this._frame = requestAnimationFrame(this._animate);
    if (this._cameraTween && this._camera && this._controls) {
      const elapsed = (performance.now() - this._cameraTween.started) / this._cameraTween.duration;
      const progress = Math.min(1, elapsed);
      const eased = 1 - Math.pow(1 - progress, 3);
      this._camera.position.lerpVectors(this._cameraTween.fromPosition, this._cameraTween.toPosition, eased);
      this._controls.target.lerpVectors(this._cameraTween.fromTarget, this._cameraTween.toTarget, eased);
      if (progress >= 1) this._cameraTween = undefined;
    }
    this._controls?.update();
    if (this._renderer && this._scene && this._camera) this._renderer.render(this._scene, this._camera);
  };

  protected render() {
    return html`${this.showRoomControls && this.zones.length ? html`<nav class="room-rail" aria-label="Rooms" @pointerdown=${this._stopControlEvent} @pointerup=${this._stopControlEvent} @click=${this._stopControlEvent}>
      <button aria-pressed=${this.focusedZoneId === null} @click=${() => this._focusZone(null)}>Overview</button>
      ${this.zones.map((zone) => html`<button aria-pressed=${this.focusedZoneId === zone.id} @click=${() => this._focusZone(zone.id ?? null)}>${zone.name}</button>`)}
    </nav>` : ''}
    <div class="viewport">
      <canvas aria-label="Generated interactive 3D apartment preview"></canvas>
      ${!this.zones.length ? html`<div class="empty">Name the enclosed rooms to unlock room navigation and Home Assistant devices.</div>` : ''}
      ${this._loadingModel ? html`<div class="empty">Loading spatial model…</div>` : ''}
      ${this._error ? html`<div class="error">${this._error}</div>` : ''}
    </div>
    <div class="entity-shortcuts" role="group" aria-label="Devices">
      ${this.entities.filter((entity) => entity.spatial?.visible ?? true).map((entity) => html`<button @click=${() => this._selectEntity(entity.entity)}>${entity.name ?? entity.entity}</button>`)}
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'spatial-preview': SpatialPreview;
  }
}
