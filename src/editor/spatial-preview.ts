import { LitElement, css, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';
import * as SunCalc from 'suncalc';
import { wallIdFor, type EntityConfig, type OpeningConfig, type SiteConfig, type SpatialDimensions, type SpatialFloorFinish, type SpatialPlan, type SpatialShellConfig, type SpatialShellOpening, type SpatialShellWall, type WallConfig, type ZoneConfig } from '../core/config';
import type { HassLike } from '../core/ha-types';
import { iconForEntity } from '../core/entity-state';
import { spatialAsset, spatialAssetFinish } from '../core/spatial-assets';
import { assignShellOpenings, shellSegments } from '../core/spatial-shell';
import { resolveSpatialEntityState, resolveSpatialEnvironment, spatialEntityPresentation, type SpatialEffectKind, type SpatialEnvironment, type SpatialLightingMode } from '../core/spatial-state';

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

interface SmoothWallPathSegment {
  start: THREE.Vector2;
  end: THREE.Vector2;
  tangent: THREE.Vector2;
  length: number;
  startDistance: number;
  endDistance: number;
  thickness: number;
}

interface SmoothWallPath {
  wall: SpatialShellWall;
  segments: SmoothWallPathSegment[];
  knots: number[];
  totalLength: number;
}

interface SmoothWallOpening {
  opening: SpatialShellOpening;
  center: number;
  from: number;
  to: number;
}

interface SmoothWallSample {
  point: THREE.Vector2;
  tangent: THREE.Vector2;
  normal: THREE.Vector2;
  thickness: number;
}

const WALL_DEPTH = 0.09;
const FLOOR_HEIGHT = 0.06;
const OVERVIEW_ZOOM_OUT_MARGIN = 1.16;
const ARCHITECTURAL_WALL = 0xd4dad8;
const WINDOW_GLASS = 0x9ebfc4;
const DEFAULT_DOOR_COLOR = '#8f887d';
const GRAIN_SHADER = {
  uniforms: {
    tDiffuse: { value: null },
    time: { value: 0 },
    amount: { value: 0.011 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float time;
    uniform float amount;
    varying vec2 vUv;
    float noise(vec2 point) {
      return fract(sin(dot(point, vec2(12.9898, 78.233)) + time * 0.71) * 43758.5453);
    }
    void main() {
      vec4 color = texture2D(tDiffuse, vUv);
      float luminance = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));
      float grain = noise(gl_FragCoord.xy) - 0.5;
      float strength = amount * mix(1.15, 0.55, luminance);
      color.rgb += grain * strength;
      gl_FragColor = color;
    }
  `,
};

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
  @property() weatherEntity = '';
  @property() illuminanceEntity = '';
  @property() spatialLightingMode: SpatialLightingMode = 'realistic';
  @state() private _error = '';
  @state() private _loadingModel = false;

  private _renderer?: THREE.WebGLRenderer;
  private _composer?: EffectComposer;
  private _grainPass?: ShaderPass;
  private _scene?: THREE.Scene;
  private _camera?: THREE.PerspectiveCamera;
  private _controls?: OrbitControls;
  private _model?: THREE.Group;
  private _observer?: ResizeObserver;
  private _frame = 0;
  private _objectLoadGeneration = 0;
  private _cameraTween?: CameraTween;
  private _sun?: THREE.DirectionalLight;
  private _sky?: THREE.HemisphereLight;
  private _fill?: THREE.DirectionalLight;
  private _warmBounce?: THREE.RectAreaLight;
  private _importedModel?: THREE.Group;
  private _activeShell: SpatialShellConfig | null = null;
  private _overviewBounds?: THREE.Box3;
  private _overviewResetTimer?: number;
  private _modelRadius = 7;
  private _pointerStart?: THREE.Vector2;
  private _environment?: SpatialEnvironment;
  private _effectMeshes: THREE.Mesh[] = [];
  private readonly _entityVisuals = new Map<string, THREE.Object3D>();
  private _prefersReducedMotion = false;
  private readonly _raycaster = new THREE.Raycaster();
  private readonly _pointer = new THREE.Vector2();

  /** Latest resolved scene environment, exposed for editor diagnostics and tests. */
  public get environment(): SpatialEnvironment | undefined {
    return this._environment;
  }

  static styles = css`
    :host {
      display: block;
      color: #f1f4f4;
      container-type: inline-size;
      --spatial-accent: #a9d2d8;
      --spatial-muted: rgba(241, 244, 244, 0.55);
    }
    .viewport {
      position: relative;
      box-sizing: border-box;
      width: 100%;
      min-height: 360px;
      aspect-ratio: var(--spatial-aspect, 16 / 10);
      overflow: hidden;
      border: 0;
      background: transparent;
    }
    canvas { display: block; width: 100%; height: 100%; touch-action: none; }
    button {
      appearance: none;
      border: 0;
      color: inherit;
      background: transparent;
      font: inherit;
      cursor: pointer;
      transition: color 180ms cubic-bezier(0.22, 1, 0.36, 1), transform 180ms cubic-bezier(0.22, 1, 0.36, 1);
    }
    button:hover { color: #fff; }
    button:active { transform: translateY(1px); }
    button:focus-visible {
      outline: 2px solid #d8e5e7;
      outline-offset: 2px;
    }
    .room-navigation {
      display: flex;
      align-items: stretch;
      gap: 14px;
      width: 100%;
      min-width: 0;
      margin-bottom: 4px;
    }
    .room-back {
      display: grid;
      flex: 0 0 48px;
      width: 48px;
      height: 48px;
      place-items: center;
      padding: 0;
      color: #f8fbfb;
    }
    .room-back ha-icon { --mdc-icon-size: 24px; }
    .room-rail {
      display: flex;
      box-sizing: border-box;
      flex: 1 1 auto;
      min-width: 0;
      gap: 24px;
      margin-bottom: 4px;
      padding: 0;
      overflow-x: auto;
      border: 0;
      background: transparent;
      scrollbar-width: none;
      scroll-snap-type: x proximity;
    }
    .room-rail::-webkit-scrollbar { display: none; }
    .room-rail button {
      flex: 0 0 auto;
      min-height: 48px;
      padding: 2px 0 9px;
      border: 0;
      border-bottom: 2px solid transparent;
      border-radius: 0;
      color: var(--spatial-muted);
      background: transparent;
      font-size: 17px;
      font-weight: 470;
      line-height: 1;
      white-space: nowrap;
      scroll-snap-align: start;
    }
    .room-rail button[aria-pressed='true'] {
      color: #f8fbfb;
      border-bottom-color: var(--spatial-accent);
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
    .entity-layer {
      position: absolute;
      inset: 0;
      overflow: hidden;
      pointer-events: none;
    }
    .entity-beacon {
      position: absolute;
      top: 0;
      left: 0;
      display: flex;
      align-items: center;
      width: 36px;
      max-width: min(260px, calc(100% - 20px));
      height: 36px;
      padding: 0;
      overflow: hidden;
      border-radius: 18px;
      color: #e9eeee;
      background: rgba(10, 15, 16, 0.9);
      box-shadow: 0 3px 8px rgba(0, 0, 0, 0.28);
      pointer-events: auto;
      translate: calc(var(--entity-x, -100px) - 18px) calc(var(--entity-y, -100px) - 18px);
      opacity: var(--entity-visible, 0);
      transition: width 200ms cubic-bezier(0.22, 1, 0.36, 1), opacity 160ms ease-out, color 160ms ease-out;
      will-change: translate;
    }
    .entity-beacon[data-activity='active'] { color: #bce7ec; }
    .entity-beacon[data-activity='attention'] { color: #ffc8bf; }
    .entity-beacon[data-activity='unavailable'] { color: #8a9496; opacity: calc(var(--entity-visible, 0) * 0.68); }
    .entity-beacon[data-side='end'] {
      flex-direction: row-reverse;
      translate: calc(var(--entity-x, -100px) - 100% + 18px) calc(var(--entity-y, -100px) - 18px);
    }
    .entity-beacon:hover,
    .entity-beacon:focus-visible,
    .entity-beacon.expanded {
      width: min(var(--entity-width, 220px), calc(100% - 20px));
      z-index: 2;
    }
    .entity-icon {
      display: grid;
      flex: 0 0 36px;
      width: 36px;
      height: 36px;
      place-items: center;
    }
    .entity-icon ha-icon { --mdc-icon-size: 19px; }
    .entity-copy {
      display: grid;
      min-width: 0;
      padding: 0 12px 0 2px;
      text-align: left;
      line-height: 1.2;
      opacity: 0;
      transition: opacity 120ms ease-out 20ms;
    }
    .entity-beacon[data-side='end'] .entity-copy { padding: 0 2px 0 12px; }
    .entity-beacon:hover .entity-copy,
    .entity-beacon:focus-visible .entity-copy,
    .entity-beacon.expanded .entity-copy { opacity: 1; }
    .entity-copy strong,
    .entity-copy span {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .entity-copy strong { color: #f5f7f7; font-size: 12px; font-weight: 650; }
    .entity-copy span { margin-top: 1px; color: #aebabc; font-size: 10px; }
    .empty, .error {
      position: absolute;
      inset: 0;
      display: grid;
      place-items: center;
      padding: 24px;
      justify-items: start;
      align-content: end;
      color: #d4dcde;
      text-align: left;
      line-height: 1.45;
      background: #0c1112;
      font-size: 16px;
    }
    .error { color: #fff; background: #9d2c38; }
    @container (max-width: 600px) {
      .viewport { min-height: 0; aspect-ratio: var(--spatial-aspect-mobile, 4 / 5); }
      .room-navigation { gap: 8px; }
      .room-rail { gap: 28px; }
      .room-rail button { min-height: 52px; padding: 2px 0 10px; font-size: 19px; }
      .entity-beacon { width: 40px; height: 40px; border-radius: 20px; translate: calc(var(--entity-x, -100px) - 20px) calc(var(--entity-y, -100px) - 20px); }
      .entity-beacon[data-side='end'] { translate: calc(var(--entity-x, -100px) - 100% + 20px) calc(var(--entity-y, -100px) - 20px); }
      .entity-icon { flex-basis: 40px; width: 40px; height: 40px; }
    }
    @media (prefers-reduced-motion: reduce) {
      button { transition: none; }
    }
  `;

  protected firstUpdated(): void {
    const canvas = this.renderRoot.querySelector('canvas');
    if (!(canvas instanceof HTMLCanvasElement)) return;
    try {
      this._prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
      this._renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        alpha: true,
        premultipliedAlpha: false,
        powerPreference: 'high-performance',
      });
      this._renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      this._renderer.setClearColor(0x000000, 0);
      this._renderer.outputColorSpace = THREE.SRGBColorSpace;
      this._renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this._renderer.toneMappingExposure = 1.04;
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

      this._composer = new EffectComposer(this._renderer);
      this._composer.addPass(new RenderPass(this._scene, this._camera));
      this._grainPass = new ShaderPass(GRAIN_SHADER);
      this._composer.addPass(this._grainPass);
      this._composer.addPass(new OutputPass());

      canvas.addEventListener('pointerdown', this._onPointerDown);
      canvas.addEventListener('pointerup', this._onPointerUp);

      RectAreaLightUniformsLib.init();
      this._sky = new THREE.HemisphereLight(0xc7d8df, 0x0b0e10, 0);
      this._scene.add(this._sky);
      this._sun = new THREE.DirectionalLight(0xffedcf, 0);
      this._sun.castShadow = true;
      const shadowSize = this.clientWidth < 600 ? 1024 : 2048;
      this._sun.shadow.mapSize.set(shadowSize, shadowSize);
      this._sun.shadow.camera.left = -8;
      this._sun.shadow.camera.right = 8;
      this._sun.shadow.camera.top = 8;
      this._sun.shadow.camera.bottom = -8;
      this._sun.shadow.bias = -0.00035;
      this._sun.shadow.normalBias = 0.018;
      this._sun.shadow.radius = 2.4;
      this._scene.add(this._sun);
      this._fill = new THREE.DirectionalLight(0x9ebac4, 0);
      this._fill.position.set(7, 6, -9);
      this._scene.add(this._fill);
      this._warmBounce = new THREE.RectAreaLight(0xffd2a0, 0, 11, 9);
      this._warmBounce.position.set(-1.5, 5.5, 1.2);
      this._warmBounce.lookAt(0, 0, 0);
      this._scene.add(this._warmBounce);
      this._updateSun();

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
    if (changed.has('site') || changed.has('latitude') || changed.has('longitude') || changed.has('weatherEntity') || changed.has('illuminanceEntity') || changed.has('spatialLightingMode')) this._updateSun();
    if (changed.has('focusedZoneId') && this._scene) {
      this._applyFocus();
      this._moveCameraTo(this.focusedZoneId);
    }
    if (changed.has('hideWalls') && this._scene) this._applyWallCutaway();
    if (changed.has('hass')) {
      this._updateEntityStateVisuals();
      this._updateSun();
    }
  }

  private _entityIsActive(entityId: string): boolean {
    const resolved = resolveSpatialEntityState(this.hass?.states ?? {}, entityId);
    return resolved.activity === 'active' || resolved.activity === 'attention';
  }

  private _entityLightColor(entityId: string): THREE.Color {
    const attributes = resolveSpatialEntityState(this.hass?.states ?? {}, entityId).state?.attributes ?? {};
    const rgb = attributes.rgb_color;
    if (Array.isArray(rgb) && rgb.length >= 3) return new THREE.Color(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255);
    const temperature = Number(attributes.color_temp_kelvin);
    if (Number.isFinite(temperature) && temperature >= 4000) return new THREE.Color(0xcfe8ff);
    return new THREE.Color(0xffd7a0);
  }

  private _entityLightIntensity(entityId: string): number {
    if (!this._entityIsActive(entityId)) return 0;
    const brightness = Number(resolveSpatialEntityState(this.hass?.states ?? {}, entityId).state?.attributes?.brightness);
    const level = Number.isFinite(brightness) ? Math.max(0.2, brightness / 255) : 0.72;
    return 18 * level;
  }

  private _isConfiguredGroupWithPlacedChildren(entityId: string): boolean {
    const state = this.hass?.states?.[entityId];
    const members = state?.attributes?.entity_id;
    if (!Array.isArray(members)) return false;
    const configured = new Set(this.entities.map((entity) => entity.entity));
    return members.some((member: string) => configured.has(member));
  }

  private _updateEntityStateVisuals(): void {
    this._model?.traverse((node) => {
      if (!node.userData.entityId) return;
      const entityId = node.userData.entityId as string;
      const resolved = resolveSpatialEntityState(this.hass?.states ?? {}, entityId);
      const active = resolved.activity === 'active' || resolved.activity === 'attention';
      const strength = spatialEntityPresentation(entityId, resolved.state).strength;
      if (node instanceof THREE.PointLight && node.userData.entityLight) {
        node.color.copy(this._entityLightColor(entityId));
        node.intensity = this._entityLightIntensity(entityId);
        return;
      }
      if (!(node instanceof THREE.Mesh)) return;
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      materials.forEach((material) => {
        if (!(material instanceof THREE.MeshStandardMaterial)) return;
        if (node.userData.entityEffect) {
          node.visible = active;
          node.userData.effectStrength = strength;
          const scale = 0.62 + strength * 0.9;
          node.scale.setScalar(scale);
          material.opacity = active ? Number(node.userData.effectOpacity ?? 0.42) * (0.38 + strength * 0.62) : 0;
          material.emissiveIntensity = active ? 0.8 + strength * 1.15 : 0;
          return;
        }
        if (node.userData.stateSurface) {
          const powered = resolved.activity !== 'off' && resolved.activity !== 'unavailable';
          material.color.setHex(powered ? 0x385b64 : 0x090c0d);
          material.emissive.setHex(powered ? 0x1d6476 : 0x000000);
          material.emissiveIntensity = powered ? 1.65 : 0;
          return;
        }
        if (node.userData.entityMarker) {
          const unavailable = resolved.activity === 'unavailable';
          material.color.setHex(unavailable ? 0x596164 : active ? 0xb8e2e8 : 0x789095);
          material.emissive.setHex(active ? 0x315f68 : 0x081113);
          material.emissiveIntensity = active ? 1.35 : 0.2;
          material.opacity = unavailable ? 0.18 : active ? 1 : 0.42;
          material.transparent = material.opacity < 1;
        }
      });
    });
    this._updateSun();
  }

  private _effectColor(kind: SpatialEffectKind): number {
    if (kind === 'light') return 0xffd69a;
    if (kind === 'media') return 0x76d7e4;
    if (kind === 'air') return 0x91c9e8;
    if (kind === 'vacuum') return 0xb8dfc1;
    if (kind === 'security') return 0xe3a29d;
    if (kind === 'presence') return 0xd9c28f;
    return 0x8db8c1;
  }

  private _createEntityVisual(entityId: string, position: THREE.Vector3, zoneId?: string, visible = true): THREE.Group {
    const resolved = resolveSpatialEntityState(this.hass?.states ?? {}, entityId);
    const color = this._effectColor(resolved.effect);
    const root = new THREE.Group();
    root.position.copy(position);
    root.userData.entityId = entityId;
    root.userData.zoneId = zoneId;
    root.visible = visible;
    this._entityVisuals.set(entityId, root);
    const marker = new THREE.Mesh(
      new THREE.CylinderGeometry(0.055, 0.07, 0.075, 20),
      new THREE.MeshStandardMaterial({ color, roughness: 0.32, emissive: color, emissiveIntensity: 0.2, transparent: true, opacity: 0.42 }),
    );
    marker.userData.entityId = entityId;
    marker.userData.entityMarker = true;
    marker.userData.zoneId = zoneId;
    marker.castShadow = true;
    root.add(marker);
    if (resolved.effect !== 'none') {
      const ringCount = resolved.effect === 'media' || resolved.effect === 'air' ? 3 : 2;
      for (let index = 0; index < ringCount; index += 1) {
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(0.11 + index * 0.055, 0.008, 8, 40, resolved.effect === 'air' ? Math.PI * 1.45 : Math.PI * 2),
          new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.4, transparent: true, opacity: 0.34, depthWrite: false }),
        );
        ring.rotation.x = Math.PI / 2;
        if (resolved.effect === 'air') ring.rotation.z = index * 0.7;
        ring.userData.entityId = entityId;
        ring.userData.entityEffect = true;
        ring.userData.effectKind = resolved.effect;
        ring.userData.effectIndex = index;
        ring.userData.effectOpacity = 0.34 - index * 0.055;
        ring.userData.zoneId = zoneId;
        root.add(ring);
        this._effectMeshes.push(ring);
      }
    }
    return root;
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
    this._composer?.dispose();
    this._renderer?.dispose();
  }

  private _disposeModel(): void {
    this._effectMeshes = [];
    this._entityVisuals.clear();
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
        ...(opening.color ? { color: opening.color } : {}),
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
        this._solidifyObject(model);
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
      color: ARCHITECTURAL_WALL,
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

    const objectBoundEntities = new Set(this.plan?.objects.flatMap((item) => item.entityId ? [item.entityId] : []) ?? []);
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
        if (item.entityId) {
          const visual = this._createEntityVisual(
            item.entityId,
            new THREE.Vector3(object.position.x, Math.max(0.12, item.position.y + 0.12), object.position.z),
            item.zoneId,
          );
          group.add(visual);
        }
        if (item.entityId?.startsWith('light.')) {
          const light = new THREE.PointLight(0xffd7a0, 0, 4.2, 1.65);
          light.position.set(object.position.x, Math.max(1.55, item.position.y + 0.48), object.position.z);
          light.userData.entityId = item.entityId;
          light.userData.entityLight = true;
          light.userData.zoneId = item.zoneId;
          group.add(light);
        }
      });
    }

    this.entities.forEach((entity) => {
      const center = this._spatialCenter();
      const position = new THREE.Vector3(
        entity.spatial ? entity.spatial.position.x - center.x : (entity.x - 50) * this.dimensions.width / 100,
        entity.spatial ? entity.spatial.position.y : 0.16,
        entity.spatial ? entity.spatial.position.z - center.y : (entity.y - 50) * this.dimensions.width / this.dimensions.aspectRatio / 100,
      );
      if (!objectBoundEntities.has(entity.entity)) {
        const visual = this._createEntityVisual(entity.entity, position, entity.zoneId, entity.spatial?.visible ?? true);
        visual.rotation.set(
          THREE.MathUtils.degToRad(entity.spatial?.rotation.x ?? 0),
          THREE.MathUtils.degToRad(entity.spatial?.rotation.y ?? 0),
          THREE.MathUtils.degToRad(entity.spatial?.rotation.z ?? 0),
        );
        group.add(visual);
      }
      if ((entity.entity.startsWith('light.') || entity.light)
        && !objectBoundEntities.has(entity.entity)
        && !this._isConfiguredGroupWithPlacedChildren(entity.entity)) {
        const light = new THREE.PointLight(0xffd7a0, 0, 4, 1.65);
        light.position.copy(position);
        light.position.y = Math.max(1.55, light.position.y);
        light.userData.zoneId = entity.zoneId;
        light.userData.entityId = entity.entity;
        light.userData.entityLight = true;
        group.add(light);
      }
    });

    group.updateMatrixWorld(true);
    const contentBounds = new THREE.Box3().setFromObject(group);
    if (!contentBounds.isEmpty()) {
      this._overviewBounds = contentBounds.clone();
      const contentSize = contentBounds.getSize(new THREE.Vector3());
      this._modelRadius = Math.max(1, Math.hypot(contentSize.x, contentSize.z) / 2);
      this._fitSunShadow(contentBounds);
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
          color: ARCHITECTURAL_WALL,
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
        const floor = new THREE.Mesh(geometry, material);
        floor.position.y = 0.008;
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
        const lintel = this._box(opening.width, lintelHeight, opening.depth, ARCHITECTURAL_WALL, top + lintelHeight / 2);
        lintel.position.x = x;
        lintel.position.z = z;
        lintel.rotation.y = -angle;
        const lintelMaterial = lintel.material as THREE.MeshStandardMaterial;
        lintelMaterial.clippingPlanes = [cutawayPlane];
        lintelMaterial.clipShadows = true;
        result.add(lintel);
      }
      if (opening.kind === 'door') {
        const panel = this._box(opening.width * 0.94, opening.height * 0.98, 0.045, new THREE.Color(opening.color ?? DEFAULT_DOOR_COLOR).getHex(), opening.height * 0.49);
        panel.position.x = x;
        panel.position.z = z;
        panel.rotation.y = -angle;
        panel.userData.wallOpening = true;
        result.add(panel);
      }
      if (opening.kind === 'window') {
        const visibleHeight = Math.max(0.2, Math.min(opening.height, 1.28 - opening.bottom));
        const glass = this._box(opening.width * 0.92, visibleHeight, 0.025, WINDOW_GLASS, opening.bottom + visibleHeight / 2);
        glass.position.x = x;
        glass.position.z = z;
        glass.rotation.y = -angle;
        const glassMaterial = glass.material as THREE.MeshStandardMaterial;
        glassMaterial.transparent = true;
        glassMaterial.opacity = 0.46;
        glassMaterial.emissive.setHex(0x24383b);
        glassMaterial.emissiveIntensity = 0.5;
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
      color: ARCHITECTURAL_WALL,
      roughness: 0.88,
    });
    const assigned = assignShellOpenings(shell);
    const segments = shellSegments(shell);
    shell.walls?.filter((wall) => wall.smooth).forEach((wall) => {
      result.add(this._createSmoothSurveyWall(
        wall,
        segments.filter((segment) => segment.wall.id === wall.id),
        assigned.filter((item) => item.segment.wall.id === wall.id),
        centerX,
        centerZ,
        sectionHeight,
      ));
    });
    segments.filter((segment) => !segment.wall.smooth).forEach((segment) => {
        const { wall, segmentIndex: index, thickness, length } = segment;
        const [startX, startZ] = segment.start;
        const [endX, endZ] = segment.end;
        const dx = endX - startX;
        const dz = endZ - startZ;
        const openings = assigned
          .filter((item) => item.segment.id === segment.id)
          .sort((left, right) => left.along - right.along);

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
                color: WINDOW_GLASS,
                emissive: 0x24383b,
                emissiveIntensity: 0.5,
                roughness: 0.18,
                metalness: 0.08,
                transparent: true,
                opacity: 0.46,
              }),
            );
            glass.position.set(openingCenter, opening.bottom + visibleHeight / 2, 0);
            glass.userData.wallOpening = true;
            segmentGroup.add(glass);
            const floorGlazing = opening.bottom <= 0.08;
            [-1, 1].forEach((side) => {
              const jamb = new THREE.Mesh(new THREE.BoxGeometry(0.035, visibleHeight, thickness * 1.04), wallMaterial());
              jamb.position.set(openingCenter + side * (to - from - 0.035) / 2, opening.bottom + visibleHeight / 2, 0);
              jamb.userData.wallOpening = true;
              segmentGroup.add(jamb);
            });
            if (floorGlazing) {
              [opening.bottom + 0.025, opening.bottom + visibleHeight - 0.025].forEach((height) => {
                const rail = new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.04, to - from), 0.05, thickness * 1.04), wallMaterial());
                rail.position.set(openingCenter, height, 0);
                rail.userData.wallOpening = true;
                segmentGroup.add(rail);
              });
            }
          } else {
            const panelHeight = Math.min(opening.height, sectionHeight - 0.01);
            const panel = new THREE.Mesh(
              new THREE.BoxGeometry(Math.max(0.04, to - from - 0.045), panelHeight, 0.045),
              new THREE.MeshStandardMaterial({ color: opening.color ?? DEFAULT_DOOR_COLOR, roughness: 0.78 }),
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
    });
    return result;
  }

  private _createSmoothSurveyWall(
    wall: SpatialShellWall,
    wallSegments: ReturnType<typeof shellSegments>,
    assigned: ReturnType<typeof assignShellOpenings>,
    centerX: number,
    centerZ: number,
    sectionHeight: number,
  ): THREE.Group {
    const result = new THREE.Group();
    const path = this._smoothWallPath(wall, wallSegments);
    if (!path.segments.length || path.totalLength <= 0.01) return result;
    const openings: SmoothWallOpening[] = assigned.map(({ opening, segment, along }) => {
      const center = THREE.MathUtils.clamp(
        (path.knots[segment.segmentIndex] ?? 0) + THREE.MathUtils.clamp(along, 0, segment.length),
        0,
        path.totalLength,
      );
      return {
        opening,
        center,
        from: Math.max(0, center - opening.width / 2),
        to: Math.min(path.totalLength, center + opening.width / 2),
      };
    }).filter(({ to, from }) => to - from > 0.02);

    const wallGeometry = this._smoothWallGeometry(path, openings, sectionHeight, centerX, centerZ);
    const fullWall = new THREE.Mesh(wallGeometry, new THREE.MeshStandardMaterial({
      color: ARCHITECTURAL_WALL,
      roughness: 0.88,
      side: THREE.DoubleSide,
    }));
    fullWall.castShadow = true;
    fullWall.receiveShadow = true;
    fullWall.userData.architecturalWall = true;
    fullWall.userData.smoothContinuous = true;
    fullWall.userData.wallId = wall.id;
    result.add(fullWall);

    openings.forEach((candidate) => {
      const { opening, from, to } = candidate;
      const bottom = Math.max(0, opening.bottom);
      const top = Math.min(sectionHeight - 0.01, opening.bottom + opening.height);
      if (top - bottom <= 0.02) return;
      const insertGeometry = this._smoothRibbonGeometry(
        path,
        from + 0.025,
        to - 0.025,
        bottom + 0.025,
        top - 0.025,
        opening.kind === 'window' ? 0.025 : 0.045,
        centerX,
        centerZ,
      );
      const insert = new THREE.Mesh(
        insertGeometry,
        opening.kind === 'window'
          ? new THREE.MeshStandardMaterial({
            color: WINDOW_GLASS,
            emissive: 0x24383b,
            emissiveIntensity: 0.5,
            roughness: 0.18,
            metalness: 0.08,
            transparent: true,
            opacity: 0.46,
            side: THREE.DoubleSide,
          })
          : new THREE.MeshStandardMaterial({ color: opening.color ?? DEFAULT_DOOR_COLOR, roughness: 0.78, side: THREE.DoubleSide }),
      );
      insert.castShadow = opening.kind === 'door';
      insert.receiveShadow = true;
      insert.userData.wallOpening = true;
      insert.userData.openingId = opening.id;
      insert.userData.openingWidth = to - from;
      insert.userData.smoothContinuous = true;
      result.add(insert);
    });

    const cutawayHeight = sectionHeight * 0.1;
    const cutawayOpenings = openings
      .filter(({ opening }) => opening.kind === 'door')
      .map((candidate) => ({
        ...candidate,
        opening: { ...candidate.opening, bottom: 0, height: cutawayHeight },
      }));
    const cutaway = new THREE.Mesh(
      this._smoothWallGeometry(path, cutawayOpenings, cutawayHeight, centerX, centerZ),
      new THREE.MeshStandardMaterial({ color: ARCHITECTURAL_WALL, roughness: 0.88, side: THREE.DoubleSide }),
    );
    cutaway.castShadow = true;
    cutaway.receiveShadow = true;
    cutaway.visible = false;
    cutaway.userData.cutawayReplacement = true;
    cutaway.userData.smoothContinuous = true;
    cutaway.userData.wallId = `${wall.id}:cutaway`;
    result.add(cutaway);

    const zoneIds = [...new Set([...(wall.zoneIds ?? []), ...(wall.segmentZoneIds ?? []).flat()])];
    const midpoint = this._smoothWallSample(path, path.totalLength / 2);
    this._setObjectZoneIds(result, zoneIds, new THREE.Vector2(midpoint.point.x - centerX, midpoint.point.y - centerZ));
    return result;
  }

  private _smoothWallPath(
    wall: SpatialShellWall,
    wallSegments: ReturnType<typeof shellSegments>,
  ): SmoothWallPath {
    let distance = 0;
    const segments = wallSegments
      .sort((left, right) => left.segmentIndex - right.segmentIndex)
      .map((segment) => {
        const start = new THREE.Vector2(segment.start[0], segment.start[1]);
        const end = new THREE.Vector2(segment.end[0], segment.end[1]);
        const tangent = end.clone().sub(start).normalize();
        const pathSegment: SmoothWallPathSegment = {
          start,
          end,
          tangent,
          length: segment.length,
          startDistance: distance,
          endDistance: distance + segment.length,
          thickness: segment.thickness,
        };
        distance += segment.length;
        return pathSegment;
      });
    return {
      wall,
      segments,
      knots: [0, ...segments.map((segment) => segment.endDistance)],
      totalLength: distance,
    };
  }

  private _smoothWallSample(path: SmoothWallPath, distance: number): SmoothWallSample {
    const clamped = THREE.MathUtils.clamp(distance, 0, path.totalLength);
    const index = Math.max(0, path.segments.findIndex((segment) => clamped <= segment.endDistance + 1e-6));
    const segment = path.segments[index] ?? path.segments[path.segments.length - 1];
    const local = segment.length > 0 ? (clamped - segment.startDistance) / segment.length : 0;
    const point = segment.start.clone().lerp(segment.end, THREE.MathUtils.clamp(local, 0, 1));
    const tangent = segment.tangent.clone();
    const atStart = Math.abs(clamped - segment.startDistance) < 1e-5;
    const atEnd = Math.abs(clamped - segment.endDistance) < 1e-5;
    if (atStart && index > 0) tangent.add(path.segments[index - 1].tangent).normalize();
    else if (atEnd && index < path.segments.length - 1) tangent.add(path.segments[index + 1].tangent).normalize();
    return {
      point,
      tangent,
      normal: new THREE.Vector2(-tangent.y, tangent.x),
      thickness: segment.thickness,
    };
  }

  private _smoothWallGeometry(
    path: SmoothWallPath,
    openings: SmoothWallOpening[],
    height: number,
    centerX: number,
    centerZ: number,
  ): THREE.BufferGeometry {
    const breakpoints = this._uniqueDistances([
      ...path.knots,
      ...openings.flatMap(({ from, to }) => [from, to]),
    ], path.totalLength);
    const rangesAt = (distance: number): [number, number][] => {
      const blocked = openings
        .filter(({ from, to }) => distance > from + 1e-6 && distance < to - 1e-6)
        .map(({ opening }) => [
          THREE.MathUtils.clamp(opening.bottom, 0, height),
          THREE.MathUtils.clamp(opening.bottom + opening.height, 0, height),
        ] as [number, number])
        .filter(([bottom, top]) => top - bottom > 0.001)
        .sort((left, right) => left[0] - right[0]);
      const merged: [number, number][] = [];
      blocked.forEach(([bottom, top]) => {
        const previous = merged[merged.length - 1];
        if (previous && bottom <= previous[1] + 1e-6) previous[1] = Math.max(previous[1], top);
        else merged.push([bottom, top]);
      });
      const solid: [number, number][] = [];
      let cursor = 0;
      merged.forEach(([bottom, top]) => {
        if (bottom - cursor > 0.001) solid.push([cursor, bottom]);
        cursor = Math.max(cursor, top);
      });
      if (height - cursor > 0.001) solid.push([cursor, height]);
      return solid;
    };
    return this._buildSmoothPathGeometry(path, breakpoints, rangesAt, centerX, centerZ);
  }

  private _smoothRibbonGeometry(
    path: SmoothWallPath,
    from: number,
    to: number,
    bottom: number,
    top: number,
    depth: number,
    centerX: number,
    centerZ: number,
  ): THREE.BufferGeometry {
    const start = Math.min(from, to);
    const end = Math.max(from, to);
    const breakpoints = this._uniqueDistances([
      start,
      ...path.knots.filter((distance) => distance > start && distance < end),
      end,
    ], path.totalLength);
    return this._buildSmoothPathGeometry(
      path,
      breakpoints,
      () => top - bottom > 0.001 ? [[bottom, top]] : [],
      centerX,
      centerZ,
      depth,
    );
  }

  private _buildSmoothPathGeometry(
    path: SmoothWallPath,
    breakpoints: number[],
    rangesAt: (distance: number) => [number, number][],
    centerX: number,
    centerZ: number,
    depthOverride?: number,
  ): THREE.BufferGeometry {
    const positions: number[] = [];
    const normals: number[] = [];
    const vertex = (sample: SmoothWallSample, y: number, side: number): THREE.Vector3 => {
      const halfDepth = (depthOverride ?? sample.thickness) / 2;
      return new THREE.Vector3(
        sample.point.x - centerX + sample.normal.x * halfDepth * side,
        y,
        sample.point.y - centerZ + sample.normal.y * halfDepth * side,
      );
    };
    const pushTriangle = (
      a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3,
      na: THREE.Vector3, nb: THREE.Vector3, nc: THREE.Vector3,
    ): void => {
      [a, b, c].forEach((point) => positions.push(point.x, point.y, point.z));
      [na, nb, nc].forEach((normal) => normals.push(normal.x, normal.y, normal.z));
    };
    const quad = (
      a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3,
      na: THREE.Vector3, nb = na, nc = na, nd = na,
    ): void => {
      pushTriangle(a, b, c, na, nb, nc);
      pushTriangle(a, c, d, na, nc, nd);
    };
    const solidAt = (ranges: [number, number][], y: number): boolean => ranges.some(([bottom, top]) => y > bottom + 1e-6 && y < top - 1e-6);
    const intervalRanges: [number, number][][] = [];
    for (let index = 0; index < breakpoints.length - 1; index += 1) {
      const from = breakpoints[index];
      const to = breakpoints[index + 1];
      const ranges = rangesAt((from + to) / 2);
      intervalRanges.push(ranges);
      const start = this._smoothWallSample(path, from);
      const end = this._smoothWallSample(path, to);
      ranges.forEach(([bottom, top]) => {
        const frontNormalStart = new THREE.Vector3(start.normal.x, 0, start.normal.y);
        const frontNormalEnd = new THREE.Vector3(end.normal.x, 0, end.normal.y);
        const backNormalStart = frontNormalStart.clone().negate();
        const backNormalEnd = frontNormalEnd.clone().negate();
        const sf0 = vertex(start, bottom, 1);
        const sf1 = vertex(start, top, 1);
        const ef0 = vertex(end, bottom, 1);
        const ef1 = vertex(end, top, 1);
        const sb0 = vertex(start, bottom, -1);
        const sb1 = vertex(start, top, -1);
        const eb0 = vertex(end, bottom, -1);
        const eb1 = vertex(end, top, -1);
        quad(sf0, ef0, ef1, sf1, frontNormalStart, frontNormalEnd, frontNormalEnd, frontNormalStart);
        quad(eb0, sb0, sb1, eb1, backNormalEnd, backNormalStart, backNormalStart, backNormalEnd);
        quad(sf1, ef1, eb1, sb1, new THREE.Vector3(0, 1, 0));
        quad(sb0, eb0, ef0, sf0, new THREE.Vector3(0, -1, 0));
      });
    }

    breakpoints.forEach((distance, index) => {
      const left = index > 0 ? intervalRanges[index - 1] : [];
      const right = index < intervalRanges.length ? intervalRanges[index] : [];
      const verticalBreaks = [...new Set([
        ...left.flat(),
        ...right.flat(),
      ])].sort((a, b) => a - b);
      const sample = this._smoothWallSample(path, distance);
      const front = (y: number) => vertex(sample, y, 1);
      const back = (y: number) => vertex(sample, y, -1);
      for (let yIndex = 0; yIndex < verticalBreaks.length - 1; yIndex += 1) {
        const bottom = verticalBreaks[yIndex];
        const top = verticalBreaks[yIndex + 1];
        if (top - bottom <= 0.001) continue;
        const mid = (bottom + top) / 2;
        const leftSolid = solidAt(left, mid);
        const rightSolid = solidAt(right, mid);
        if (leftSolid === rightSolid) continue;
        const capNormal = new THREE.Vector3(sample.tangent.x, 0, sample.tangent.y)
          .multiplyScalar(leftSolid ? 1 : -1);
        if (leftSolid) quad(front(bottom), front(top), back(top), back(bottom), capNormal);
        else quad(back(bottom), back(top), front(top), front(bottom), capNormal);
      }
    });

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return geometry;
  }

  private _uniqueDistances(values: number[], totalLength: number): number[] {
    return values
      .map((value) => THREE.MathUtils.clamp(value, 0, totalLength))
      .sort((left, right) => left - right)
      .filter((value, index, sorted) => index === 0 || value - sorted[index - 1] > 1e-5);
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
      this._solidifyObject(imported);
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

  private _solidifyObject(root: THREE.Object3D): void {
    const replacements = new Map<THREE.Material, THREE.MeshStandardMaterial>();
    const solid = (source: THREE.Material): THREE.MeshStandardMaterial => {
      const cached = replacements.get(source);
      if (cached) return cached;
      const standard = source instanceof THREE.MeshStandardMaterial ? source : undefined;
      const colored = source as THREE.Material & { color?: THREE.Color };
      const replacement = new THREE.MeshStandardMaterial({
        color: colored.color?.clone() ?? new THREE.Color(0xaeb4b3),
        emissive: standard?.emissive.clone() ?? new THREE.Color(0x000000),
        emissiveIntensity: standard?.emissiveIntensity ?? 1,
        opacity: source.opacity,
        transparent: source.transparent,
        side: source.side,
        roughness: Math.max(0.68, standard?.roughness ?? 0.82),
        metalness: Math.min(0.14, standard?.metalness ?? 0),
        depthWrite: source.depthWrite,
      });
      replacement.name = source.name;
      replacements.set(source, replacement);
      return replacement;
    };
    root.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      node.material = Array.isArray(node.material)
        ? node.material.map(solid)
        : solid(node.material);
    });
  }

  private _surveyFloorMaterial(): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({ color: 0x827568, roughness: 0.86, metalness: 0 });
  }

  private _tileFloorMaterial(color: number): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0 });
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
      display.userData.stateSurface = true;
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
          new THREE.MeshStandardMaterial({ color: opening.color ?? DEFAULT_DOOR_COLOR, roughness: 0.76 }),
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
          : new THREE.MeshStandardMaterial({ color: opening.color ?? DEFAULT_DOOR_COLOR, roughness: 0.76 }),
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
    const environment = resolveSpatialEnvironment({
      states: this.hass?.states ?? {},
      entityIds: this.entities.map((entity) => entity.entity),
      fallbackElevationRadians: solar.altitude,
      fallbackAzimuthRadians: solar.azimuth,
      weatherEntity: this.weatherEntity || undefined,
      illuminanceEntity: this.illuminanceEntity || undefined,
      mode: this.spatialLightingMode,
    });
    this._environment = environment;
    const altitude = THREE.MathUtils.degToRad(Math.max(-6, environment.elevationDegrees));
    const bearing = THREE.MathUtils.degToRad(environment.azimuthDegrees + this.site.north);
    const horizontal = Math.cos(altitude) * 13;
    this._sun.position.set(
      Math.sin(bearing) * horizontal,
      Math.max(0.7, Math.sin(altitude) * 13),
      -Math.cos(bearing) * horizontal,
    );
    this._sun.intensity = environment.sunIntensity;
    if (this._sky) this._sky.intensity = environment.skyIntensity;
    if (this._fill) this._fill.intensity = environment.fillIntensity;
    if (this._warmBounce) this._warmBounce.intensity = environment.bounceIntensity;
    if (this._renderer) this._renderer.toneMappingExposure = environment.exposure;
  }

  private _fitSunShadow(bounds: THREE.Box3): void {
    if (!this._sun) return;
    const size = bounds.getSize(new THREE.Vector3());
    const radius = Math.max(4, Math.max(size.x, size.z) * 0.62);
    this._sun.shadow.camera.left = -radius;
    this._sun.shadow.camera.right = radius;
    this._sun.shadow.camera.top = radius;
    this._sun.shadow.camera.bottom = -radius;
    this._sun.shadow.camera.near = 0.1;
    this._sun.shadow.camera.far = 36;
    this._sun.shadow.camera.updateProjectionMatrix();
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
    const poseDistance = position.distanceTo(target);
    this._controls.maxDistance = zone
      ? Math.max(this._controls.maxDistance, poseDistance * 1.04)
      : Math.max(this._controls.minDistance + 1, poseDistance * OVERVIEW_ZOOM_OUT_MARGIN);
    this._camera.far = Math.max(50, this._controls.maxDistance * 3);
    this._camera.updateProjectionMatrix();
    this._cameraTween = {
      started: performance.now(),
      duration: this._prefersReducedMotion ? 1 : 520,
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
    }, this._camera!.near * 2) * (mobile ? 1.03 : 1.08);
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

  private _focusZoneFromPointer(event: PointerEvent, zoneId: string | null): void {
    event.stopPropagation();
    this._focusZone(zoneId);
  }

  private _selectEntity(entityId: string): void {
    this.dispatchEvent(new CustomEvent('spatial-entity-selected', {
      detail: { entityId }, bubbles: true, composed: true,
    }));
  }

  private _entityObjectIsVisible(object: THREE.Object3D): boolean {
    let current: THREE.Object3D | null = object;
    while (current) {
      if (!current.visible) return false;
      if (current === this._model) break;
      current = current.parent;
    }
    return true;
  }

  private _syncEntityBeacons(): void {
    if (!this._camera || !this._renderer) return;
    const canvas = this._renderer.domElement;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height) return;
    const world = new THREE.Vector3();
    const placements: Array<{ beacon: HTMLElement; x: number; y: number; width: number; height: number; side: 'start' | 'end' }> = [];
    this.renderRoot.querySelectorAll<HTMLElement>('.entity-beacon').forEach((beacon) => {
      const object = this._entityVisuals.get(beacon.dataset.entityId ?? '');
      if (!object || !this._entityObjectIsVisible(object)) {
        beacon.style.setProperty('--entity-visible', '0');
        return;
      }
      object.getWorldPosition(world);
      world.y += 0.28;
      world.project(this._camera!);
      const visible = world.z > -1 && world.z < 1 && Math.abs(world.x) < 1.08 && Math.abs(world.y) < 1.08;
      const x = Math.min(width - 20, Math.max(20, (world.x * 0.5 + 0.5) * width));
      const y = Math.min(height - 20, Math.max(20, (-world.y * 0.5 + 0.5) * height));
      beacon.style.setProperty('--entity-visible', visible ? '1' : '0');
      if (!visible) return;
      const side = x > width * 0.55 ? 'end' : 'start';
      const expandedWidth = Number.parseFloat(beacon.style.getPropertyValue('--entity-width')) || 154;
      const markerSize = this.clientWidth <= 600 ? 40 : 36;
      placements.push({
        beacon,
        x,
        y,
        width: beacon.classList.contains('expanded') ? expandedWidth : markerSize,
        height: markerSize,
        side,
      });
    });
    const placed: Array<{ left: number; top: number; right: number; bottom: number }> = [];
    placements.sort((left, right) => left.y - right.y).forEach((placement) => {
      const halfIcon = (this.clientWidth <= 600 ? 40 : 36) / 2;
      const left = placement.side === 'end'
        ? placement.x - placement.width + halfIcon
        : placement.x - halfIcon;
      const candidates = [0, -46, 46, -92, 92];
      const selectedY = candidates
        .map((offset) => Math.min(height - placement.height / 2 - 6, Math.max(placement.height / 2 + 6, placement.y + offset)))
        .find((candidateY) => {
          const candidate = {
            left: left - 6,
            top: candidateY - placement.height / 2 - 6,
            right: left + placement.width + 6,
            bottom: candidateY + placement.height / 2 + 6,
          };
          return placed.every((item) => candidate.right <= item.left || candidate.left >= item.right || candidate.bottom <= item.top || candidate.top >= item.bottom);
        }) ?? placement.y;
      placement.beacon.style.setProperty('--entity-x', `${placement.x}px`);
      placement.beacon.style.setProperty('--entity-y', `${selectedY}px`);
      placement.beacon.dataset.side = placement.side;
      placed.push({
        left: left - 6,
        top: selectedY - placement.height / 2 - 6,
        right: left + placement.width + 6,
        bottom: selectedY + placement.height / 2 + 6,
      });
    });
  }

  private _renderEntityBeacon(entity: EntityConfig) {
    if (!(entity.spatial?.visible ?? true)) return '';
    const resolved = resolveSpatialEntityState(this.hass?.states ?? {}, entity.entity);
    const fallbackState = resolved.state ?? { entity_id: entity.entity, state: 'unavailable', attributes: {} };
    const presentation = spatialEntityPresentation(
      entity.entity,
      resolved.state,
      entity.name,
      this.hass?.formatEntityState
        ? (state) => this.hass?.formatEntityState?.(state) ?? state.state
        : undefined,
    );
    const domain = entity.entity.split('.')[0] ?? '';
    const deviceClass = String(fallbackState.attributes?.device_class ?? '');
    let icon = iconForEntity(fallbackState, entity);
    if (!entity.icon && resolved.activity === 'off') {
      if (domain === 'light') icon = 'mdi:lightbulb-outline';
      if (domain === 'fan') icon = 'mdi:fan-off';
      if (domain === 'climate') icon = 'mdi:thermostat-off';
      if (domain === 'media_player') icon = deviceClass === 'tv' ? 'mdi:television-off' : 'mdi:speaker-off';
    } else if (!entity.icon && resolved.activity === 'active') {
      if (domain === 'media_player') icon = deviceClass === 'tv' ? 'mdi:television-play' : 'mdi:speaker-play';
      if (domain === 'vacuum') icon = 'mdi:robot-vacuum-variant';
    } else if (!entity.icon && resolved.activity === 'attention' && domain === 'lock') {
      icon = 'mdi:lock-open-variant';
    }
    const expanded = resolved.activity === 'attention'
      || (resolved.activity === 'active' && ['media_player', 'fan', 'humidifier', 'climate', 'vacuum'].includes(domain))
      || (this.focusedZoneId !== null && entity.zoneId === this.focusedZoneId);
    const width = Math.min(260, Math.max(154, Math.max(presentation.name.length, presentation.status.length) * 7 + 54));
    return html`<button
      type="button"
      class="entity-beacon ${expanded ? 'expanded' : ''}"
      data-entity-id=${entity.entity}
      data-activity=${resolved.activity}
      style=${`--entity-width:${width}px`}
      aria-label=${`${presentation.name}: ${presentation.status}`}
      title=${`${presentation.name} · ${presentation.status}`}
      @click=${() => this._selectEntity(entity.entity)}
    >
      <span class="entity-icon"><ha-icon icon=${icon}></ha-icon></span>
      <span class="entity-copy"><strong>${presentation.name}</strong><span>${presentation.status}</span></span>
    </button>`;
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
    this._composer?.setSize(width, height);
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
    this._animateEntityEffects(performance.now());
    this._syncEntityBeacons();
    if (this._grainPass) this._grainPass.uniforms.time.value = performance.now() * 0.001;
    if (this._composer) this._composer.render();
    else if (this._renderer && this._scene && this._camera) this._renderer.render(this._scene, this._camera);
  };

  private _animateEntityEffects(now: number): void {
    if (!this._model || this._prefersReducedMotion) return;
    for (const node of this._effectMeshes) {
      if (!node.visible) continue;
      const index = Number(node.userData.effectIndex ?? 0);
      const phase = now * 0.0015 + index * 0.9;
      const strength = Number(node.userData.effectStrength ?? 0.5);
      const baseScale = 0.62 + strength * 0.9;
      const pulse = 1 + Math.sin(phase) * 0.045;
      node.scale.setScalar(baseScale * pulse);
      if (node.userData.effectKind === 'air') node.rotation.z += 0.0012 + strength * 0.004 + index * 0.0004;
      const material = node.material;
      if (material instanceof THREE.MeshStandardMaterial) {
        material.opacity = Number(node.userData.effectOpacity ?? 0.34)
          * (0.38 + strength * 0.62)
          * (0.86 + Math.sin(phase) * 0.14);
      }
    }
  }

  protected render() {
    return html`${this.showRoomControls && this.zones.length ? html`<nav class="room-navigation" aria-label="Rooms">
      ${this.focusedZoneId !== null ? html`<button class="room-back" aria-label="Back to apartment overview" title="Overview"
        @pointerup=${(event: PointerEvent) => this._focusZoneFromPointer(event, null)}
        @click=${() => this._focusZone(null)}><ha-icon icon="mdi:arrow-left"></ha-icon></button>` : ''}
      <div class="room-rail">
        ${this.focusedZoneId === null ? html`<button aria-pressed="true">Overview</button>` : ''}
        ${this.zones.map((zone) => html`<button aria-pressed=${this.focusedZoneId === zone.id} @pointerup=${(event: PointerEvent) => this._focusZoneFromPointer(event, zone.id ?? null)} @click=${() => this._focusZone(zone.id ?? null)}>${zone.name}</button>`)}
      </div>
    </nav>` : ''}
    <div class="viewport">
      <canvas aria-label="Generated interactive 3D apartment preview"></canvas>
      <div class="entity-layer" role="group" aria-label="Devices">
        ${this.entities.map((entity) => this._renderEntityBeacon(entity))}
      </div>
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
