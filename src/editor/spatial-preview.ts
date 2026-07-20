import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneObject } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';
import * as SunCalc from 'suncalc';
import { wallIdFor, wallParts, type EntityConfig, type OpeningConfig, type SiteConfig, type SpatialDimensions, type SpatialElement, type SpatialElementPrimitive, type SpatialFloorFinish, type SpatialGlbSurface, type SpatialPlan, type SpatialShellConfig, type SpatialShellOpening, type SpatialShellWall, type WallConfig, type ZoneConfig } from '../core/config';
import type { HassLike } from '../core/ha-types';
import { iconForEntity } from '../core/entity-state';
import { resolveLightColor } from '../core/light-color';
import { suggestedOverviewVisibility, suggestedRoomVisibility } from '../core/entity-policy';
import { elementPrimitivesForType, resolveSpatialValue } from '../core/spatial-elements';
import { objectAtGlbNodePath } from '../core/spatial-glb';
import { assignShellOpenings, reconcileShellWallZones, shellSegments } from '../core/spatial-shell';
import { resolveDirectSpatialEntityState, resolveSpatialEnvironment, spatialEntityPresentation, type SpatialEffectKind, type SpatialEnvironment, type SpatialLightingMode } from '../core/spatial-state';

export interface SpatialPoint {
  x: number;
  y: number;
}

export interface SpatialZoneConfig extends ZoneConfig {
  /** Optional room outline in floorplan coordinates. Rectangles remain the editor default. */
  footprint?: SpatialPoint[];
  floorColor?: number;
}

interface CameraTween {
  started: number;
  duration: number;
  fromPosition: THREE.Vector3;
  toPosition: THREE.Vector3;
  fromTarget: THREE.Vector3;
  toTarget: THREE.Vector3;
  controlPosition?: THREE.Vector3;
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
const ARCHITECTURAL_CAMERA_FOV = 26;
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
  @property({ attribute: false }) shell: SpatialShellConfig | null = null;
  @property() modelUrl = '';
  @property({ attribute: false }) focusedZoneId: string | null = null;
  @property({ type: Boolean }) showRoomControls = true;
  @property({ type: Boolean }) hideWalls = false;
  @property({ type: Number }) overviewResetSeconds = 10;
  @property({ type: Boolean }) autoOrbit = true;
  @property({ type: Number }) orbitSeconds = 90;
  @property({ type: Number }) cameraTransitionMs = 900;
  @property() quality: 'auto' | 'mobile' | 'balanced' | 'high' = 'auto';
  @property({ type: Boolean, reflect: true }) fill = false;
  @property({ type: Number }) latitude = 0;
  @property({ type: Number }) longitude = 0;
  @property() weatherEntity = '';
  @property() illuminanceEntity = '';
  @property() spatialLightingMode: SpatialLightingMode = 'realistic';
  @property({ attribute: 'isolated-element-id', reflect: true }) isolatedElementId = '';
  @state() private _error = '';
  @state() private _loadingModel = false;
  private _expandedEntityId: string | null = null;

  private _renderer?: THREE.WebGLRenderer;
  private _composer?: EffectComposer;
  private _grainPass?: ShaderPass;
  private _scene?: THREE.Scene;
  private _camera?: THREE.PerspectiveCamera;
  private _controls?: OrbitControls;
  private _model?: THREE.Group;
  private _observer?: ResizeObserver;
  private _intersectionObserver?: IntersectionObserver;
  private _isVisible = true;
  private _frame = 0;
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
  private readonly _zoneLightLayers = new Map<string, number>();
  private readonly _glbElementCache = new Map<string, Promise<THREE.Object3D>>();
  private _elementLoadGeneration = 0;
  private _prefersReducedMotion = false;
  private _contextLost = false;
  private _beaconsDirty = true;
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
      outline: none;
      -webkit-tap-highlight-color: transparent;
      --spatial-accent: #a9d2d8;
      --spatial-muted: rgba(241, 244, 244, 0.55);
    }
    :host(:focus),
    :host(:focus-visible),
    .viewport:focus,
    canvas:focus,
    canvas:focus-visible {
      outline: none !important;
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
    :host([fill]) .viewport { height: 100%; min-height: 0; aspect-ratio: auto; }
    :host([isolated-element-id]:not([isolated-element-id=''])) .viewport { min-height: 420px; aspect-ratio: 1 / 1; }
    .isolated-light-beacon {
      position: absolute;
      top: 50%;
      left: 50%;
      display: grid;
      width: 64px;
      height: 64px;
      place-items: center;
      border: 1px solid color-mix(in srgb, var(--isolated-accent, #a9d2d8) 55%, transparent);
      border-radius: 50%;
      background: color-mix(in srgb, var(--isolated-accent, #a9d2d8) 18%, rgba(10, 15, 16, 0.88));
      color: var(--isolated-accent, #a9d2d8);
      box-shadow: 0 0 36px color-mix(in srgb, var(--isolated-accent, #a9d2d8) 32%, transparent);
      transform: translate(-50%, -50%);
      pointer-events: none;
    }
    .isolated-light-beacon ha-icon { --mdc-icon-size: 27px; }
    canvas { display: block; width: 100%; height: 100%; outline: none; touch-action: pan-y; -webkit-tap-highlight-color: transparent; }
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
    .room-divider {
      flex: 0 0 1px;
      width: 1px;
      height: 28px;
      align-self: center;
      background: color-mix(in srgb, #f1f4f4 22%, transparent);
    }
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
      --entity-marker-size: calc(36px * var(--entity-user-scale, 1));
      --entity-marker-half: calc(18px * var(--entity-user-scale, 1));
      --entity-icon-size: calc(19px * var(--entity-user-scale, 1));
      position: absolute;
      top: 0;
      left: 0;
      display: flex;
      align-items: center;
      width: var(--entity-marker-size);
      max-width: min(204px, calc(100% - 20px));
      height: var(--entity-marker-size);
      padding: 0;
      overflow: hidden;
      border-radius: var(--entity-marker-half);
      color: #e9eeee;
      background: rgba(10, 15, 16, 0.9);
      box-shadow: 0 3px 8px rgba(0, 0, 0, 0.28);
      pointer-events: auto;
      translate: calc(var(--entity-x, -100px) - var(--entity-marker-half)) calc(var(--entity-y, -100px) - var(--entity-marker-half));
      opacity: var(--entity-visible, 0);
      transition: width 200ms cubic-bezier(0.22, 1, 0.36, 1), opacity 160ms ease-out, color 160ms ease-out;
      will-change: translate;
    }
    .entity-beacon[data-activity='active'] { color: #bce7ec; }
    .entity-beacon[data-activity='attention'] { color: #ffc8bf; }
    .entity-beacon[data-activity='unavailable'] { color: #8a9496; opacity: calc(var(--entity-visible, 0) * 0.68); }
    .entity-beacon[data-context='overview'] {
      --entity-marker-size: calc(28.8px * var(--entity-user-scale, 1));
      --entity-marker-half: calc(14.4px * var(--entity-user-scale, 1));
      --entity-icon-size: calc(15px * var(--entity-user-scale, 1));
    }
    .entity-beacon[data-domain='light'] {
      color: var(--entity-accent, #aebabc);
      box-shadow: 0 0 0 1px color-mix(in srgb, var(--entity-accent, #aebabc) 34%, transparent), 0 3px 8px rgba(0, 0, 0, 0.28);
    }
    .entity-beacon[data-domain='light'][data-activity='active'] {
      color: var(--entity-accent, #fff4d8);
      box-shadow: 0 0 0 1px color-mix(in srgb, var(--entity-accent, #fff4d8) 58%, transparent), 0 0 16px color-mix(in srgb, var(--entity-accent, #fff4d8) 22%, transparent), 0 3px 8px rgba(0, 0, 0, 0.28);
    }
    .entity-beacon[data-domain='light'] .entity-icon {
      border-radius: 50%;
      background: color-mix(in srgb, var(--entity-accent, #aebabc) 12%, transparent);
    }
    .entity-beacon[data-side='end'] {
      flex-direction: row-reverse;
      translate: calc(var(--entity-x, -100px) - 100% + var(--entity-marker-half)) calc(var(--entity-y, -100px) - var(--entity-marker-half));
    }
    .entity-beacon[data-context='room']:hover,
    .entity-beacon[data-context='room']:focus-visible,
    .entity-beacon.expanded {
      width: min(var(--entity-width, 188px), calc(100% - 20px));
      z-index: 2;
    }
    .entity-icon {
      display: grid;
      flex: 0 0 var(--entity-marker-size);
      width: var(--entity-marker-size);
      height: var(--entity-marker-size);
      place-items: center;
    }
    .entity-icon ha-icon { --mdc-icon-size: var(--entity-icon-size); }
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
    .entity-beacon[data-context='room']:hover .entity-copy,
    .entity-beacon[data-context='room']:focus-visible .entity-copy,
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
      .room-divider { height: 24px; }
      .room-rail { gap: 28px; }
      .room-rail button { min-height: 52px; padding: 2px 0 10px; font-size: 19px; }
      .entity-beacon { --entity-marker-size: calc(40px * var(--entity-user-scale, 1)); --entity-marker-half: calc(20px * var(--entity-user-scale, 1)); --entity-icon-size: calc(20px * var(--entity-user-scale, 1)); }
      .entity-beacon[data-context='overview'] { --entity-marker-size: calc(32px * var(--entity-user-scale, 1)); --entity-marker-half: calc(16px * var(--entity-user-scale, 1)); --entity-icon-size: calc(16px * var(--entity-user-scale, 1)); }
    }
    @media (prefers-reduced-motion: reduce) {
      button { transition: none; }
    }
  `;

  protected firstUpdated(): void {
    this._initializeRenderer();
  }

  connectedCallback(): void {
    super.connectedCallback();
    if (this.hasUpdated && !this._renderer) queueMicrotask(() => this._initializeRenderer());
  }

  private _initializeRenderer(): void {
    if (this._renderer || !this.isConnected) return;
    const canvas = this.renderRoot.querySelector('canvas');
    if (!(canvas instanceof HTMLCanvasElement)) return;
    try {
      this._contextLost = false;
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
      this._renderer.shadowMap.type = THREE.PCFSoftShadowMap;

      this._scene = new THREE.Scene();
      this._scene.background = null;
      this._camera = new THREE.PerspectiveCamera(ARCHITECTURAL_CAMERA_FOV, 1, 0.1, 50);
      this._camera.position.set(8.8, 10.5, 11.5);

      this._controls = new OrbitControls(this._camera, canvas);
      this._controls.enableDamping = true;
      this._controls.dampingFactor = 0.06;
      this._controls.minDistance = 4;
      this._controls.maxDistance = 24;
      this._controls.maxPolarAngle = Math.PI * 0.47;
      this._controls.target.set(0, 0, 0);
      this._controls.autoRotate = false;
      this._controls.autoRotateSpeed = this.orbitSeconds > 0 ? 60 / this.orbitSeconds : 0;
      this._controls.addEventListener('start', () => {
        this._cameraTween = undefined;
        this._clearOverviewReset();
        if (this._controls) this._controls.autoRotate = false;
      });
      this._controls.addEventListener('end', this._scheduleOverviewReset);

      this._configureComposer();

      canvas.addEventListener('pointerdown', this._onPointerDown);
      canvas.addEventListener('pointerup', this._onPointerUp);
      canvas.addEventListener('webglcontextlost', this._onContextLost);
      canvas.addEventListener('webglcontextrestored', this._onContextRestored);

      RectAreaLightUniformsLib.init();
      this._sky = new THREE.HemisphereLight(0xc7d8df, 0x0b0e10, 0);
      this._scene.add(this._sky);
      this._sun = new THREE.DirectionalLight(0xffedcf, 0);
      const shadowSize = this.clientWidth < 600 ? 1024 : 2048;
      this._configureExteriorShadow(this._sun, shadowSize);
      this._scene.add(this._sun);
      this._fill = new THREE.DirectionalLight(0x9ebac4, 0);
      this._fill.position.set(7, 6, -9);
      this._configureDiffuseExteriorFill(this._fill);
      this._scene.add(this._fill);
      this._warmBounce = new THREE.RectAreaLight(0xffd2a0, 0, 11, 9);
      this._warmBounce.position.set(-1.5, 5.5, 1.2);
      this._warmBounce.lookAt(0, 0, 0);
      this._scene.add(this._warmBounce);
      this._updateSun();

      this._observer = new ResizeObserver(() => this._resize());
      this._observer.observe(this);
      if (typeof IntersectionObserver !== 'undefined') {
        this._intersectionObserver = new IntersectionObserver((entries) => {
          this._isVisible = entries.some((entry) => entry.isIntersecting);
          if (this._isVisible) this._beaconsDirty = true;
        }, { rootMargin: '160px' });
        this._intersectionObserver.observe(this);
      }
      this._buildModel();
      this._resize();
      this._moveCameraTo(null);
      if (this.modelUrl) void this._loadModel();
      this._error = '';
      this._animate();
    } catch (error) {
      canvas.removeEventListener('pointerdown', this._onPointerDown);
      canvas.removeEventListener('pointerup', this._onPointerUp);
      canvas.removeEventListener('webglcontextlost', this._onContextLost);
      canvas.removeEventListener('webglcontextrestored', this._onContextRestored);
      cancelAnimationFrame(this._frame);
      this._observer?.disconnect();
      this._intersectionObserver?.disconnect();
      this._controls?.dispose();
      this._composer?.dispose();
      this._renderer?.dispose();
      this._renderer = undefined;
      this._composer = undefined;
      this._grainPass = undefined;
      this._controls = undefined;
      this._scene = undefined;
      this._camera = undefined;
      this._observer = undefined;
      this._intersectionObserver = undefined;
      this._contextLost = false;
      const message = error instanceof Error ? error.message : '3D preview is unavailable.';
      queueMicrotask(() => {
        if (this.isConnected) this._error = message;
      });
    }
  }

  private _configureComposer(): void {
    this._composer?.dispose();
    this._composer = undefined;
    this._grainPass = undefined;
    this._grainPass = undefined;
    if (!this._renderer || !this._scene || !this._camera) return;
    const mobile = this.clientWidth < 700 || /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    const requestedSamples = this.quality === 'mobile' ? 2
      : this.quality === 'high' ? 4
        : this.quality === 'balanced' ? 2
          : mobile ? 2 : 4;
    const gl = this._renderer.getContext();
    const maxSamples = this._renderer.capabilities.isWebGL2
      ? Number((gl as WebGL2RenderingContext).getParameter((gl as WebGL2RenderingContext).MAX_SAMPLES) ?? 0)
      : 0;
    const samples = Math.max(0, Math.min(requestedSamples, maxSamples));
    // WebGL1 cannot multisample offscreen targets. Render directly instead so
    // the renderer's native antialiasing remains active.
    if (samples === 0) return;
    const renderTarget = new THREE.WebGLRenderTarget(1, 1, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      // Half-float multisampled targets can yield a transparent frame on
      // mobile WebKit even though context creation succeeds.
      type: THREE.UnsignedByteType,
    });
    renderTarget.samples = samples;
    this._composer = new EffectComposer(this._renderer, renderTarget);
    this._composer.addPass(new RenderPass(this._scene, this._camera));
    this._grainPass = new ShaderPass(GRAIN_SHADER);
    this._composer.addPass(this._grainPass);
    this._composer.addPass(new OutputPass());
  }

  protected willUpdate(changed: Map<PropertyKey, unknown>): void {
    if (changed.has('focusedZoneId')) this._expandedEntityId = null;
  }

  private _setExpandedEntityId(entityId: string | null): void {
    if (this._expandedEntityId === entityId) return;
    this._expandedEntityId = entityId;
    this.requestUpdate();
  }

  protected updated(changed: Map<PropertyKey, unknown>): void {
    this._beaconsDirty = true;
    const isolatedElementChanged = changed.has('isolatedElementId');
    if (this._scene && (changed.has('zones') || changed.has('entities') || changed.has('openings') || changed.has('walls') || changed.has('dimensions') || changed.has('shell') || changed.has('plan') || isolatedElementChanged)) {
      this._buildModel();
    }
    if (changed.has('modelUrl') && this._scene) void this._loadModel();
    if (changed.has('site') || changed.has('latitude') || changed.has('longitude') || changed.has('weatherEntity') || changed.has('illuminanceEntity') || changed.has('spatialLightingMode')) this._updateSun();
    if (changed.has('focusedZoneId')) {
      if (this._scene) {
        this._applyFocus();
        this._moveCameraTo(this.focusedZoneId);
      }
    }
    if (changed.has('orbitSeconds') && this._controls) {
      this._controls.autoRotateSpeed = this.orbitSeconds > 0 ? 60 / this.orbitSeconds : 0;
      if (this.orbitSeconds <= 0) this._controls.autoRotate = false;
    }
    if (changed.has('quality') && this._renderer) {
      this._configureComposer();
      this._resize();
    }
    if (isolatedElementChanged && this._scene) this._moveCameraTo(null);
    if (changed.has('hideWalls') && this._scene) this._applyWallCutaway();
    if (changed.has('hass')) {
      this._updateEntityStateVisuals();
      this._updateSun();
    }
  }

  private _entityIsActive(entityId: string): boolean {
    const resolved = resolveDirectSpatialEntityState(this.hass?.states ?? {}, entityId);
    return resolved.activity === 'active' || resolved.activity === 'attention';
  }

  private _entityLightColor(entityId: string): THREE.Color {
    const state = resolveDirectSpatialEntityState(this.hass?.states ?? {}, entityId).state;
    if (!state) return new THREE.Color(0xfffae6);
    const rgb = resolveLightColor(state);
    return new THREE.Color(rgb.r / 255, rgb.g / 255, rgb.b / 255);
  }

  private _entityLightIntensity(entityId: string): number {
    if (!this._entityIsActive(entityId)) return 0;
    const brightness = Number(resolveDirectSpatialEntityState(this.hass?.states ?? {}, entityId).state?.attributes?.brightness);
    const level = Number.isFinite(brightness) ? Math.max(0.02, brightness / 255) : 1;
    // Keep HA brightness as the live control, but leave headroom for the
    // scene's ambient/daylight contribution so practical lights do not wash
    // out nearby rooms.
    return 14.4 * level;
  }

  private _configureZoneLightLayers(): void {
    this._zoneLightLayers.clear();
    const zoneIds = new Set<string>();
    this.zones.forEach((zone) => {
      if (zone.id) zoneIds.add(zone.id);
    });
    this.entities.forEach((entity) => {
      if (entity.zoneId) zoneIds.add(entity.zoneId);
    });
    this.plan?.rooms.forEach((room) => {
      if (room.zoneId) zoneIds.add(room.zoneId);
    });
    this.plan?.elements.forEach((element) => {
      if (element.zoneId) zoneIds.add(element.zoneId);
    });
    this.shell?.rooms?.forEach((room) => zoneIds.add(room.zoneId));
    this._camera?.layers.set(0);
    [...zoneIds].slice(0, 31).forEach((zoneId, index) => {
      const layer = index + 1;
      this._zoneLightLayers.set(zoneId, layer);
    });
  }

  private _applyZoneLightLayers(object: THREE.Object3D, zoneIds: Array<string | undefined>): void {
    const layers = [...new Set(zoneIds
      .map((zoneId) => zoneId ? this._zoneLightLayers.get(zoneId) : undefined)
      .filter((layer): layer is number => layer !== undefined))];
    if (!layers.length) return;
    object.traverse((node) => layers.forEach((layer) => node.layers.enable(layer)));
  }

  private _configurePracticalLight(light: THREE.PointLight, zoneId?: string): void {
    light.castShadow = true;
    const mapSize = this.clientWidth < 600 ? 256 : 512;
    light.shadow.mapSize.set(mapSize, mapSize);
    light.shadow.bias = -0.0005;
    light.shadow.normalBias = 0.035;
    light.shadow.radius = 2.4;
    light.shadow.camera.near = 0.08;
    light.shadow.camera.far = Math.max(4.5, light.distance || 4.5);
    const roomLayer = zoneId ? this._zoneLightLayers.get(zoneId) : undefined;
    light.layers.set(0);
    light.shadow.camera.layers.set(roomLayer ?? 0);
    light.userData.spatialShadowLayer = roomLayer ?? 0;
  }

  private _rebalancePracticalLightShadows(): void {
    const practicalLights: THREE.PointLight[] = [];
    this._model?.traverse((node) => {
      if (node instanceof THREE.PointLight && node.userData.spatialShadowLayer !== undefined) {
        practicalLights.push(node);
      }
    });
    const maxTextureUnits = this._renderer?.capabilities.maxTextures ?? 16;
    const viewportBudget = this.clientWidth < 600 ? 6 : 10;
    const shadowBudget = Math.max(1, Math.min(viewportBudget, maxTextureUnits - 6));
    const activeLights = practicalLights
      .filter((light) => light.visible && light.intensity > 0)
      .sort((left, right) => right.intensity - left.intensity);
    const shadowLights = new Set(activeLights.slice(0, shadowBudget));
    practicalLights.forEach((light) => {
      light.castShadow = shadowLights.has(light);
    });
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
      const element = node.userData.spatialElementId
        ? this.plan?.elements.find((candidate) => candidate.id === node.userData.spatialElementId)
        : undefined;
      const primitive = node.userData.elementPrimitive
        ?? node.userData.elementPrimitiveLight
        ?? node.userData.elementPrimitiveWave;
      const elementAppearance = element && primitive
        ? this._elementPrimitiveAppearance(element, primitive as SpatialElementPrimitive)
        : undefined;
      const glbSurfaceId = node.userData.elementGlbSurfaceLight as string | undefined;
      if (element && glbSurfaceId && node instanceof THREE.PointLight) {
        const surface = element.glb?.surfaces.find((candidate) => candidate.id === glbSurfaceId);
        if (!surface) return;
        const appearance = this._elementGlbSurfaceAppearance(element, surface);
        node.color.copy(appearance.color);
        node.intensity = appearance.luminosity * 12;
        node.visible = appearance.luminosity > 0;
        return;
      }
      const glbSurfaceIds = node.userData.elementGlbSurfaceIds as string[] | undefined;
      if (element && glbSurfaceIds && node instanceof THREE.Mesh) {
        const materials = Array.isArray(node.material) ? node.material : [node.material];
        materials.forEach((material, materialIndex) => {
          if (!(material instanceof THREE.MeshStandardMaterial)) return;
          const surface = element.glb?.surfaces.find((candidate) => candidate.id === glbSurfaceIds[materialIndex]);
          if (!surface) return;
          const appearance = this._elementGlbSurfaceAppearance(element, surface);
          material.color.copy(appearance.color);
          material.emissive.copy(appearance.color);
          material.emissiveIntensity = appearance.luminosity * 3.5;
          material.needsUpdate = true;
        });
        return;
      }
      if (node instanceof THREE.PointLight && node.userData.elementPrimitiveLight && elementAppearance) {
        node.color.copy(elementAppearance.color);
        node.intensity = elementAppearance.luminosity * (node.userData.semanticLight ? 18 : 12);
        node.visible = elementAppearance.luminosity > 0;
        return;
      }
      if (node instanceof THREE.Mesh && node.userData.elementPrimitive && elementAppearance) {
        const materials = Array.isArray(node.material) ? node.material : [node.material];
        materials.forEach((material) => {
          if (!(material instanceof THREE.MeshStandardMaterial)) return;
          material.color.copy(elementAppearance.color);
          material.emissive.copy(elementAppearance.color);
          material.emissiveIntensity = elementAppearance.luminosity * 3.5;
        });
        return;
      }
      if (node instanceof THREE.Mesh && node.userData.elementPrimitiveWave && elementAppearance) {
        node.visible = elementAppearance.waves > 0;
        node.userData.effectStrength = elementAppearance.waves;
        const materials = Array.isArray(node.material) ? node.material : [node.material];
        materials.forEach((material) => {
          if (!(material instanceof THREE.MeshStandardMaterial)) return;
          material.color.copy(elementAppearance.color);
          material.emissive.copy(elementAppearance.color);
          material.opacity = Number(node.userData.effectOpacity ?? 0.28) * elementAppearance.waves;
        });
        return;
      }

      const entityId = node.userData.entityId as string | undefined;
      if (!entityId) return;
      const resolved = resolveDirectSpatialEntityState(this.hass?.states ?? {}, entityId);
      const active = resolved.activity === 'active' || resolved.activity === 'attention';
      const strength = spatialEntityPresentation(entityId, resolved.state).strength;
      if (node instanceof THREE.PointLight && node.userData.entityLight) {
        node.color.copy(this._entityLightColor(entityId));
        node.intensity = this._entityLightIntensity(entityId);
        // Invisible lights are omitted from Three.js' light and shadow shader
        // budgets. This is essential on mobile WebKit, which otherwise counts
        // every configured (but off) point-light shadow sampler and rejects the
        // complete material program once it exceeds the GPU texture-unit limit.
        node.visible = node.intensity > 0;
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
          if (resolved.effect === 'light') {
            const lightColor = this._entityLightColor(entityId);
            material.color.copy(unavailable ? new THREE.Color(0x596164) : lightColor);
            material.emissive.copy(active ? lightColor : new THREE.Color(0x080a0a));
            material.emissiveIntensity = active ? 1.2 + strength * 3.8 : 0.08;
            material.opacity = unavailable ? 0.18 : active ? 0.82 + strength * 0.18 : 0.3;
          } else {
            material.color.setHex(unavailable ? 0x596164 : active ? 0xb8e2e8 : 0x789095);
            material.emissive.setHex(active ? 0x315f68 : 0x081113);
            material.emissiveIntensity = active ? 1.35 : 0.2;
            material.opacity = unavailable ? 0.18 : active ? 1 : 0.42;
          }
          material.transparent = material.opacity < 1;
        }
      });
    });
    this._rebalancePracticalLightShadows();
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
    const resolved = resolveDirectSpatialEntityState(this.hass?.states ?? {}, entityId);
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
    // Lights illuminate the model through practical scene lights. Atmospheric
    // rings are reserved for devices whose state is expressed as motion/flow.
    if (resolved.effect !== 'none' && resolved.effect !== 'light') {
      const ringCount = resolved.effect === 'media' || resolved.effect === 'air' ? 3 : 2;
      const ringRadius = resolved.effect === 'media' ? 0.22 : 0.11;
      const ringSpacing = resolved.effect === 'media' ? 0.095 : 0.055;
      const ringThickness = resolved.effect === 'media' ? 0.01 : 0.008;
      for (let index = 0; index < ringCount; index += 1) {
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(
            ringRadius + index * ringSpacing,
            ringThickness,
            8,
            40,
            resolved.effect === 'air' ? Math.PI * 1.45 : Math.PI * 2,
          ),
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
    canvas?.removeEventListener('webglcontextlost', this._onContextLost);
    canvas?.removeEventListener('webglcontextrestored', this._onContextRestored);
    super.disconnectedCallback();
    cancelAnimationFrame(this._frame);
    this._observer?.disconnect();
    this._intersectionObserver?.disconnect();
    this._clearOverviewReset();
    this._controls?.dispose();
    this._disposeModel();
    this._composer?.dispose();
    this._renderer?.dispose();
    this._controls = undefined;
    this._composer = undefined;
    this._renderer = undefined;
    this._scene = undefined;
    this._camera = undefined;
    this._observer = undefined;
    this._intersectionObserver = undefined;
    this._isVisible = true;
    this._contextLost = false;
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
        ...(opening.name ? { name: opening.name } : {}),
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
      const floor = room.floor?.length ? room.floor : room.boundary.flatMap(({ wallId, reversed }) => {
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
    const all = [
      ...plan.vertices.map((vertex) => ({ x: vertex.x, z: vertex.z })),
      ...plan.rooms.flatMap((room) => room.floor?.map(([x, z]) => ({ x, z })) ?? []),
    ];
    if (!all.length) all.push({ x: 0, z: 0 });
    const minX = Math.min(...all.map((point) => point.x));
    const maxX = Math.max(...all.map((point) => point.x));
    const minZ = Math.min(...all.map((point) => point.z));
    const maxZ = Math.max(...all.map((point) => point.z));
    return reconcileShellWallZones({
      outer: [[minX, minZ], [maxX, minZ], [maxX, maxZ], [minX, maxZ]],
      holes: [],
      floor: [],
      rooms,
      walls,
      openings,
    });
  }

  private _planCenter(plan: SpatialPlan): THREE.Vector2 {
    const points = [
      ...plan.vertices.map((vertex) => [vertex.x, vertex.z] as [number, number]),
      ...plan.rooms.flatMap((room) => room.floor ?? []),
    ];
    if (!points.length) return new THREE.Vector2();
    const minX = Math.min(...points.map(([x]) => x));
    const maxX = Math.max(...points.map(([x]) => x));
    const minZ = Math.min(...points.map(([, z]) => z));
    const maxZ = Math.max(...points.map(([, z]) => z));
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

  private _primitiveGeometry(primitive: SpatialElementPrimitive): THREE.BufferGeometry {
    const { x, y, z } = primitive.size;
    if (primitive.kind === 'sphere') {
      const geometry = new THREE.SphereGeometry(0.5, 32, 20);
      geometry.scale(x, y, z);
      return geometry;
    }
    if (primitive.kind === 'cylinder') {
      const normalizedBevel = Math.min(0.45, Math.max(0, primitive.bevel / Math.max(0.001, Math.min(x, y, z))));
      if (normalizedBevel <= 0.001) {
        const geometry = new THREE.CylinderGeometry(0.5, 0.5, 1, 32, 3, false);
        geometry.scale(x, y, z);
        return geometry;
      }
      const points: THREE.Vector2[] = [new THREE.Vector2(0, -0.5)];
      const cornerRadius = normalizedBevel;
      const radialCenter = 0.5 - cornerRadius;
      const bottomCenter = -0.5 + cornerRadius;
      const topCenter = 0.5 - cornerRadius;
      for (let index = 0; index <= 5; index += 1) {
        const angle = -Math.PI / 2 + (index / 5) * Math.PI / 2;
        points.push(new THREE.Vector2(
          radialCenter + Math.cos(angle) * cornerRadius,
          bottomCenter + Math.sin(angle) * cornerRadius,
        ));
      }
      for (let index = 0; index <= 5; index += 1) {
        const angle = (index / 5) * Math.PI / 2;
        points.push(new THREE.Vector2(
          radialCenter + Math.cos(angle) * cornerRadius,
          topCenter + Math.sin(angle) * cornerRadius,
        ));
      }
      points.push(new THREE.Vector2(0, 0.5));
      const geometry = new THREE.LatheGeometry(points, 40);
      geometry.scale(x, y, z);
      return geometry;
    }
    const radius = Math.min(primitive.bevel, Math.min(x, y, z) * 0.49);
    return new RoundedBoxGeometry(x, y, z, radius > 0 ? 4 : 1, Math.max(0.0001, radius));
  }

  private _elementPrimitiveAppearance(element: SpatialElement, primitive: SpatialElementPrimitive): { color: THREE.Color; luminosity: number; waves: number } {
    const states = this.hass?.states ?? {};
    const color = new THREE.Color(resolveSpatialValue(primitive.color, states, element.entityId));
    let luminosity = resolveSpatialValue(primitive.luminosity, states, element.entityId);
    const boundState = element.entityId ? states[element.entityId] : undefined;
    if ((element.type === 'ceiling-light' || element.type === 'light-bulb') && boundState) {
      const active = boundState.state === 'on';
      const brightness = Number(boundState.attributes?.brightness);
      luminosity = active ? (Number.isFinite(brightness) ? Math.max(0.02, brightness / 255) : 1) : 0;
      const rgb = resolveLightColor(boundState);
      color.setRGB(rgb.r / 255, rgb.g / 255, rgb.b / 255);
    }
    return {
      color,
      luminosity: Math.min(1, Math.max(0, luminosity)),
      waves: Math.min(1, Math.max(0, resolveSpatialValue(primitive.waves, states, element.entityId))),
    };
  }

  private _elementGlbSurfaceAppearance(element: SpatialElement, surface: SpatialGlbSurface): { color: THREE.Color; luminosity: number } {
    const states = this.hass?.states ?? {};
    const entityId = surface.entityId ?? element.entityId;
    return {
      color: new THREE.Color(resolveSpatialValue(surface.color, states, entityId)),
      luminosity: THREE.MathUtils.clamp(resolveSpatialValue(surface.luminosity, states, entityId), 0, 1),
    };
  }

  private _cachedGlbElement(uri: string): Promise<THREE.Object3D> {
    const cached = this._glbElementCache.get(uri);
    if (cached) return cached;
    const loading = new GLTFLoader().loadAsync(uri).then((gltf) => gltf.scene);
    this._glbElementCache.set(uri, loading);
    loading.catch(() => this._glbElementCache.delete(uri));
    return loading;
  }

  private async _loadGlbElement(element: SpatialElement, group: THREE.Group, generation: number): Promise<void> {
    if (!element.glb) return;
    try {
      const source = await this._cachedGlbElement(element.glb.uri);
      if (generation !== this._elementLoadGeneration || !group.parent) return;
      const imported = cloneObject(source);
      imported.traverse((node) => {
        if (!(node instanceof THREE.Mesh)) return;
        node.geometry = node.geometry.clone();
      });
      this._solidifyObject(imported);
      imported.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(imported);
      const center = bounds.getCenter(new THREE.Vector3());
      imported.position.set(-center.x, -bounds.min.y, -center.z);
      element.glb.surfaces.forEach((surface) => {
        const node = objectAtGlbNodePath(imported, surface.nodePath);
        if (!(node instanceof THREE.Mesh)) return;
        const materials = Array.isArray(node.material) ? [...node.material] : [node.material];
        materials[surface.materialIndex] = materials[surface.materialIndex]?.clone();
        node.material = Array.isArray(node.material) ? materials : materials[0];
        const ids = Array.isArray(node.userData.elementGlbSurfaceIds)
          ? [...node.userData.elementGlbSurfaceIds]
          : new Array(materials.length).fill('');
        ids[surface.materialIndex] = surface.id;
        node.userData.elementGlbSurfaceIds = ids;
        const canEmit = surface.luminosity.base > 0 || surface.luminosity.rules.some((rule) => Number(rule.value) > 0);
        if (canEmit) {
          node.geometry.computeBoundingSphere();
          const light = new THREE.PointLight(0xffffff, 0, 3.8, 1.8);
          this._configurePracticalLight(light, element.zoneId);
          light.position.copy(node.geometry.boundingSphere?.center ?? new THREE.Vector3());
          light.userData.elementGlbSurfaceLight = surface.id;
          light.userData.spatialElementId = element.id;
          light.userData.entityId = surface.entityId ?? element.entityId;
          node.add(light);
        }
      });
      imported.traverse((node) => {
        node.userData.zoneId = element.zoneId;
        node.userData.spatialElementId = element.id;
        node.userData.entityId ??= element.entityId;
        if (node instanceof THREE.Mesh) {
          node.castShadow = true;
          node.receiveShadow = true;
        }
      });
      this._applyZoneLightLayers(imported, [element.zoneId]);
      group.add(imported);
      this._updateEntityStateVisuals();
      this._refreshModelBounds();
      if (this.isolatedElementId === element.id) this._moveCameraTo(null);
    } catch (error) {
      this.dispatchEvent(new CustomEvent('spatial-element-load-error', {
        detail: { elementId: element.id, message: error instanceof Error ? error.message : 'The GLB Element could not be loaded.' },
        bubbles: true,
        composed: true,
      }));
    }
  }

  private _createSpatialElement(element: SpatialElement, generation = this._elementLoadGeneration): THREE.Group {
    const group = new THREE.Group();
    group.userData.spatialElementId = element.id;
    group.userData.entityId = element.entityId;
    if (element.type === 'glb') {
      void this._loadGlbElement(element, group, generation);
      return group;
    }
    const semanticLight = element.type === 'ceiling-light' || element.type === 'light-bulb';
    if (semanticLight) {
      const primitive = element.primitives[0] ?? elementPrimitivesForType(element.type)[0];
      if (!primitive) return group;
      const appearance = this._elementPrimitiveAppearance(element, primitive);
      const practical = new THREE.PointLight(appearance.color, appearance.luminosity * 18, 4.2, 1.65);
      this._configurePracticalLight(practical, element.zoneId);
      practical.userData.entityId = element.entityId;
      practical.userData.spatialElementId = element.id;
      practical.userData.elementPrimitiveLight = primitive;
      practical.userData.elementType = element.type;
      practical.userData.semanticLight = true;
      group.add(practical);
      return group;
    }
    element.primitives.forEach((primitive) => {
      const appearance = this._elementPrimitiveAppearance(element, primitive);
      const material = new THREE.MeshStandardMaterial({
        color: appearance.color,
        emissive: appearance.color,
        emissiveIntensity: appearance.luminosity * 3.5,
        roughness: 0.82,
        metalness: 0.02,
      });
      const mesh = new THREE.Mesh(this._primitiveGeometry(primitive), material);
      mesh.position.set(primitive.position.x, primitive.position.y, primitive.position.z);
      mesh.rotation.set(
        THREE.MathUtils.degToRad(primitive.rotation.x),
        THREE.MathUtils.degToRad(primitive.rotation.y),
        THREE.MathUtils.degToRad(primitive.rotation.z),
      );
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.entityId = element.entityId;
      mesh.userData.spatialElementId = element.id;
      mesh.userData.elementPrimitive = primitive;
      mesh.userData.elementType = element.type;
      group.add(mesh);

      const practical = new THREE.PointLight(appearance.color, appearance.luminosity * 12, 3.8, 1.8);
      this._configurePracticalLight(practical, element.zoneId);
      practical.position.copy(mesh.position);
      practical.userData.entityId = element.entityId;
      practical.userData.spatialElementId = element.id;
      practical.userData.elementPrimitiveLight = primitive;
      practical.userData.elementType = element.type;
      group.add(practical);

      for (let index = 0; index < 3; index += 1) {
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(0.16 + index * 0.075, 0.007, 8, 42, Math.PI * 1.52),
          new THREE.MeshStandardMaterial({ color: appearance.color, emissive: appearance.color, emissiveIntensity: 1.2, transparent: true, opacity: appearance.waves * (0.28 - index * 0.05), depthWrite: false }),
        );
        ring.position.copy(mesh.position);
        ring.rotation.x = Math.PI / 2;
        ring.rotation.z = index * 0.72;
        ring.visible = appearance.waves > 0;
        ring.userData.entityId = element.entityId;
        ring.userData.spatialElementId = element.id;
        ring.userData.elementPrimitiveWave = primitive;
        ring.userData.effectKind = 'air';
        ring.userData.effectIndex = index;
        ring.userData.effectStrength = appearance.waves;
        ring.userData.effectOpacity = 0.28 - index * 0.05;
        group.add(ring);
        this._effectMeshes.push(ring);
      }
    });
    return group;
  }

  private _buildModel(): void {
    if (!this._scene) return;
    const generation = ++this._elementLoadGeneration;
    this._disposeModel();
    this._configureZoneLightLayers();
    const group = new THREE.Group();
    const isolatedElement = this.isolatedElementId
      ? this.plan?.elements.find((element) => element.id === this.isolatedElementId)
      : undefined;
    if (isolatedElement) {
      this._activeShell = null;
      const element = this._createSpatialElement(isolatedElement, generation);
      element.rotation.set(
        THREE.MathUtils.degToRad(isolatedElement.rotation.x),
        THREE.MathUtils.degToRad(isolatedElement.rotation.y),
        THREE.MathUtils.degToRad(isolatedElement.rotation.z),
      );
      element.scale.set(isolatedElement.scale.x, isolatedElement.scale.y, isolatedElement.scale.z);
      element.traverse((node) => {
        node.userData.spatialElementId = isolatedElement.id;
        node.userData.entityId ??= isolatedElement.entityId;
      });
      this._applyZoneLightLayers(element, [isolatedElement.zoneId]);
      group.add(element);
      this._model = group;
      this._scene.add(group);
      group.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(group);
      if (bounds.isEmpty()) bounds.set(new THREE.Vector3(-0.35, -0.35, -0.35), new THREE.Vector3(0.35, 0.35, 0.35));
      this._overviewBounds = bounds;
      const size = bounds.getSize(new THREE.Vector3());
      this._modelRadius = Math.max(0.5, size.length() / 2);
      this._updateEntityStateVisuals();
      this._updateSun();
      return;
    }
    const usesImportedModel = Boolean(this._importedModel);
    const activeShell = this.shell ?? (this.plan ? this._shellFromPlan(this.plan) : null);
    this._activeShell = activeShell;
    if (this._importedModel) group.add(this._importedModel);
    if (activeShell && !usesImportedModel) group.add(this._createSurveyShell(activeShell));
    if (activeShell) group.add(this._createCeilingShadowShell(activeShell));
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
      const shellRoom = activeShell?.rooms?.find((candidate) => candidate.zoneId === zone.id);
      const shellRegions = shellRoom
        ? [shellRoom.floor, ...(shellRoom.floors ?? [])].filter((floorPoints) => floorPoints.length >= 3)
        : [];
      const center = shellRegions.length ? this._spatialCenter() : undefined;
      const interactionRegions = shellRegions.length
        ? shellRegions.map((floorPoints) => floorPoints.map(([x, z]) => new THREE.Vector2(x - center!.x, z - center!.y)))
        : [points];
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
        if (!activeShell) room.add(this._createCeilingShadowOccluder(points, zone.id));
      }

      // Imported shells provide the visible floor, but imported meshes are not
      // guaranteed to contain a raycastable floor surface. Keep semantic room
      // hit targets separate from the render geometry so every room remains
      // tappable without changing the visual output.
      if (zone.id) interactionRegions.forEach((region) => room.add(this._createRoomInteractionFloor(region, zone.id)));

      if (usesImportedModel || activeShell) {
        // The semantic interaction floors above cover imported/survey geometry.
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
      this._applyZoneLightLayers(room, [zone.id]);
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
      this._setObjectZoneIds(
        wallGroup,
        [...new Set(record.ids.map((wallId) => wallParts(wallId)?.zoneId).filter((zoneId): zoneId is string => Boolean(zoneId)))],
      );
      group.add(wallGroup);
    });

    const elementBoundEntities = new Set(this.plan?.elements.flatMap((item) => [
      ...(item.entityId ? [item.entityId] : []),
      ...(item.glb?.surfaces.flatMap((surface) => surface.entityId ? [surface.entityId] : []) ?? []),
    ]) ?? []);
    if (this.plan) {
      const center = this._spatialCenter();
      this.plan.elements.forEach((item) => {
        const element = this._createSpatialElement(item, generation);
        element.position.set(item.position.x - center.x, item.position.y, item.position.z - center.y);
        element.rotation.set(
          THREE.MathUtils.degToRad(item.rotation.x),
          THREE.MathUtils.degToRad(item.rotation.y),
          THREE.MathUtils.degToRad(item.rotation.z),
        );
        element.scale.set(item.scale.x, item.scale.y, item.scale.z);
        element.userData.spatialElementId = item.id;
        element.userData.spatialElementRoot = true;
        element.userData.entityId = item.entityId;
        element.traverse((node) => {
          node.userData.zoneId = item.zoneId;
          node.userData.spatialElementId = item.id;
          node.userData.entityId = item.entityId;
        });
        this._applyZoneLightLayers(element, [item.zoneId]);
        group.add(element);
        if (item.entityId) {
          this._entityVisuals.set(item.entityId, element);
        }
        item.glb?.surfaces.forEach((surface) => {
          if (surface.entityId) this._entityVisuals.set(surface.entityId, element);
        });
      });
    }

    this.entities.forEach((entity) => {
      const center = this._spatialCenter();
      const position = new THREE.Vector3(
        entity.spatial ? entity.spatial.position.x - center.x : (entity.x - 50) * this.dimensions.width / 100,
        entity.spatial ? entity.spatial.position.y : 0.16,
        entity.spatial ? entity.spatial.position.z - center.y : (entity.y - 50) * this.dimensions.width / this.dimensions.aspectRatio / 100,
      );
      if (!elementBoundEntities.has(entity.entity)) {
        const visual = this._createEntityVisual(entity.entity, position, entity.zoneId, entity.spatial?.visible ?? true);
        visual.rotation.set(
          THREE.MathUtils.degToRad(entity.spatial?.rotation.x ?? 0),
          THREE.MathUtils.degToRad(entity.spatial?.rotation.y ?? 0),
          THREE.MathUtils.degToRad(entity.spatial?.rotation.z ?? 0),
        );
        this._applyZoneLightLayers(visual, [entity.zoneId]);
        group.add(visual);
      }
      if ((entity.entity.startsWith('light.') || entity.light)
        && !elementBoundEntities.has(entity.entity)
        && !this._isConfiguredGroupWithPlacedChildren(entity.entity)) {
        const light = new THREE.PointLight(0xffd7a0, 0, 4, 1.65);
        this._configurePracticalLight(light, entity.zoneId);
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
    this._updateSun();
    this._applyFocus();
  }

  private _refreshModelBounds(): void {
    if (!this._model) return;
    this._model.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(this._model);
    if (bounds.isEmpty()) return;
    this._overviewBounds = bounds.clone();
    const size = bounds.getSize(new THREE.Vector3());
    this._modelRadius = Math.max(1, Math.hypot(size.x, size.z) / 2);
    this._fitSunShadow(bounds);
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
    if (shell.walls) {
      if (shell.walls.length) result.add(this._createSurveyWalls(shell, centerX, centerZ));
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
        this._applyZoneLightLayers(floor, [room.zoneId]);
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
        this._configureGlazing(glass);
        result.add(glass);
      }
    });
    result.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        node.castShadow = !node.userData.glazing;
        node.receiveShadow = true;
      }
    });
    return result;
  }

  private _createCeilingShadowShell(shell: SpatialShellConfig): THREE.Group {
    const result = new THREE.Group();
    result.userData.ceilingShadowShell = true;
    const minX = Math.min(...shell.outer.map(([x]) => x));
    const maxX = Math.max(...shell.outer.map(([x]) => x));
    const minZ = Math.min(...shell.outer.map(([, z]) => z));
    const maxZ = Math.max(...shell.outer.map(([, z]) => z));
    const centerX = (minX + maxX) / 2;
    const centerZ = (minZ + maxZ) / 2;
    const roomRegions = (shell.rooms ?? []).flatMap((room) => [room.floor, ...(room.floors ?? [])]
      .map((points) => ({ points, zoneId: room.zoneId })));
    const regions = roomRegions.length
      ? roomRegions
      : [shell.floor, ...(shell.floors ?? [])].map((points) => ({ points, zoneId: undefined }));

    regions.filter(({ points }) => points.length >= 3).forEach(({ points, zoneId }) => {
      const projected = points.map(([x, z]) => new THREE.Vector2(x - centerX, z - centerZ));
      result.add(this._createCeilingShadowOccluder(projected, zoneId));
    });
    return result;
  }

  private _createCeilingShadowOccluder(points: THREE.Vector2[], zoneId?: string): THREE.Mesh {
    const centroid = points.reduce((sum, point) => sum.add(point), new THREE.Vector2()).divideScalar(points.length);
    const expanded = points.map((point) => {
      const direction = point.clone().sub(centroid);
      return direction.lengthSq() > 0 ? point.clone().add(direction.normalize().multiplyScalar(0.04)) : point.clone();
    });
    const shape = new THREE.Shape();
    shape.moveTo(expanded[0].x, expanded[0].y);
    expanded.slice(1).forEach((point) => shape.lineTo(point.x, point.y));
    shape.closePath();
    const material = new THREE.MeshBasicMaterial({
      color: 0x000000,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    material.colorWrite = false;
    const ceiling = new THREE.Mesh(new THREE.ShapeGeometry(shape), material);
    ceiling.geometry.rotateX(Math.PI / 2);
    ceiling.position.y = this.dimensions.wallHeight;
    ceiling.castShadow = true;
    ceiling.receiveShadow = false;
    ceiling.userData.ceilingShadowOccluder = true;
    ceiling.userData.zoneId = zoneId;
    this._applyZoneLightLayers(ceiling, [zoneId]);
    ceiling.raycast = () => {};
    return ceiling;
  }

  private _createRoomInteractionFloor(points: THREE.Vector2[], zoneId?: string): THREE.Mesh {
    const shape = new THREE.Shape();
    shape.moveTo(points[0].x, points[0].y);
    points.slice(1).forEach((point) => shape.lineTo(point.x, point.y));
    shape.closePath();
    const material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    // Keep this mesh fully invisible while retaining a normal Three.js
    // raycast target for room selection over imported GLB geometry.
    material.colorWrite = false;
    const floor = new THREE.Mesh(new THREE.ShapeGeometry(shape), material);
    floor.geometry.rotateX(Math.PI / 2);
    floor.position.y = 0.012;
    floor.userData.zoneId = zoneId;
    floor.userData.roomFloor = true;
    floor.userData.roomInteractionFloor = true;
    floor.raycast = THREE.Mesh.prototype.raycast;
    return floor;
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
            glass.userData.openingId = opening.id;
            glass.userData.openingWidth = to - from;
            this._configureGlazing(glass);
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
            panel.userData.openingId = opening.id;
            panel.userData.openingWidth = to - from;
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
      if (opening.kind === 'window') this._configureGlazing(insert);
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

  private _configureGlazing(mesh: THREE.Mesh): void {
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.userData.glazing = true;
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
        this._configureGlazing(glass);
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
      if (opening.kind === 'window') this._configureGlazing(insert);
      result.add(insert);
    });
    return result;
  }

  private _updateSun(): void {
    if (!this._sun) return;
    if (this.isolatedElementId) {
      this._sun.position.set(5, 7, 6);
      this._sun.intensity = 2.4;
      if (this._sky) this._sky.intensity = 1.05;
      if (this._fill) this._fill.intensity = 0.72;
      if (this._warmBounce) this._warmBounce.intensity = 0.42;
      if (this._renderer) this._renderer.toneMappingExposure = 1.12;
      return;
    }
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

  private _configureDiffuseExteriorFill(light: THREE.DirectionalLight): void {
    light.castShadow = false;
    light.shadow.autoUpdate = false;
  }

  private _configureExteriorShadow(light: THREE.DirectionalLight, mapSize: number): void {
    light.castShadow = true;
    light.shadow.mapSize.set(mapSize, mapSize);
    light.shadow.camera.left = -8;
    light.shadow.camera.right = 8;
    light.shadow.camera.top = 8;
    light.shadow.camera.bottom = -8;
    light.shadow.bias = -0.00035;
    light.shadow.normalBias = 0.018;
    light.shadow.radius = 3.2;
  }

  private _fitSunShadow(bounds: THREE.Box3): void {
    const size = bounds.getSize(new THREE.Vector3());
    const radius = Math.max(4, Math.max(size.x, size.z) * 0.62);
    [this._sun, this._fill].forEach((light) => {
      if (!light) return;
      light.shadow.camera.left = -radius;
      light.shadow.camera.right = radius;
      light.shadow.camera.top = radius;
      light.shadow.camera.bottom = -radius;
      light.shadow.camera.near = 0.1;
      light.shadow.camera.far = 36;
      light.shadow.camera.updateProjectionMatrix();
    });
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

  private _roomBounds(zone: SpatialZoneConfig): THREE.Box3 | undefined {
    const bounds = new THREE.Box3();
    const shellRoom = zone.id
      ? this._activeShell?.rooms?.find((candidate) => candidate.zoneId === zone.id)
      : undefined;
    const center = this._spatialCenter();
    if (shellRoom) {
      [shellRoom.floor, ...(shellRoom.floors ?? [])].flat().forEach(([x, z]) => {
        bounds.expandByPoint(new THREE.Vector3(x - center.x, 0, z - center.y));
      });
    } else {
      this._zonePoints(zone).map((point) => this._worldPoint(point)).forEach((point) => {
        bounds.expandByPoint(new THREE.Vector3(point.x, 0, point.y));
      });
    }
    if (bounds.isEmpty()) return undefined;

    const floorMin = bounds.min.clone();
    const floorMax = bounds.max.clone();
    bounds.expandByPoint(new THREE.Vector3(floorMin.x, Math.max(FLOOR_HEIGHT, this.dimensions.wallHeight * 0.1), floorMin.z));
    bounds.expandByPoint(new THREE.Vector3(floorMax.x, Math.max(FLOOR_HEIGHT, this.dimensions.wallHeight * 0.1), floorMax.z));

    this.entities.filter((entity) => entity.zoneId === zone.id).forEach((entity) => {
      const visual = this._entityVisuals.get(entity.entity);
      const position = new THREE.Vector3();
      if (visual) visual.getWorldPosition(position);
      else if (entity.spatial) position.set(
        entity.spatial.position.x - center.x,
        entity.spatial.position.y,
        entity.spatial.position.z - center.y,
      );
      else position.set(
        (entity.x - 50) * this.dimensions.width / 100,
        0.16,
        (entity.y - 50) * this.dimensions.width / this.dimensions.aspectRatio / 100,
      );
      bounds.expandByPoint(position);
      bounds.expandByPoint(position.clone().add(new THREE.Vector3(0, 0.28, 0)));
    });

    this.plan?.elements.filter((element) => element.zoneId === zone.id).forEach((element) => {
      const object = this._model?.children.find((child) => child.userData.spatialElementId === element.id);
      if (object) bounds.expandByObject(object);
      else bounds.expandByPoint(new THREE.Vector3(
        element.position.x - center.x,
        element.position.y,
        element.position.z - center.y,
      ));
    });

    const size = bounds.getSize(new THREE.Vector3());
    bounds.expandByVector(new THREE.Vector3(
      Math.max(0.12, size.x * 0.035),
      0.06,
      Math.max(0.12, size.z * 0.035),
    ));
    return bounds;
  }

  private _roomPose(zone: SpatialZoneConfig): { target: THREE.Vector3; position: THREE.Vector3 } | undefined {
    if (!this._camera) return undefined;
    const bounds = this._roomBounds(zone);
    if (!bounds || bounds.isEmpty()) return undefined;
    const target = bounds.getCenter(new THREE.Vector3());
    const direction = new THREE.Vector3(0.55, 0.9, 0.82).normalize();
    const forward = direction.clone().negate();
    const right = new THREE.Vector3().crossVectors(forward, this._camera.up).normalize();
    const up = new THREE.Vector3().crossVectors(right, forward).normalize();
    const verticalTangent = Math.tan(THREE.MathUtils.degToRad(this._camera.fov) / 2);
    const horizontalTangent = verticalTangent * Math.max(this._camera.aspect, 0.2);
    const width = Math.max(1, this.clientWidth);
    const height = Math.max(1, this.clientHeight);
    const safeX = THREE.MathUtils.clamp(1 - 72 / width, 0.68, 0.9);
    const safeY = THREE.MathUtils.clamp(1 - 80 / height, 0.66, 0.86);
    const corners = [bounds.min.x, bounds.max.x].flatMap((x) =>
      [bounds.min.y, bounds.max.y].flatMap((y) =>
        [bounds.min.z, bounds.max.z].map((z) => new THREE.Vector3(x, y, z))));
    const distance = corners.reduce((fit, corner) => {
      const relative = corner.clone().sub(target);
      return Math.max(
        fit,
        relative.dot(direction) + Math.abs(relative.dot(right)) / (horizontalTangent * safeX),
        relative.dot(direction) + Math.abs(relative.dot(up)) / (verticalTangent * safeY),
      );
    }, this._camera.near * 2) * 1.03;
    return { target, position: target.clone().addScaledVector(direction, distance) };
  }

  private _moveCameraTo(zoneId: string | null): void {
    if (!this._camera || !this._controls) return;
    this._clearOverviewReset();
    const zone = this.zones.find((candidate) => candidate.id === zoneId);
    const roomPose = zone ? this._roomPose(zone) : undefined;
    const overviewPose = zone ? undefined : this.isolatedElementId ? this._isolatedElementPose() : this._overviewPose();
    const target = roomPose?.target ?? (zone ? this._zoneCenter(zone) : overviewPose?.target ?? new THREE.Vector3(0, 0, 0));
    const mobile = this.clientWidth < 600;
    const focusDistance = zone ? this._zoneRadius(zone) * (mobile ? 3.15 : 2.35) : 0;
    const position = zone
      ? roomPose?.position ?? target.clone().add(new THREE.Vector3(focusDistance * 0.55, focusDistance * 0.9, focusDistance * 0.82))
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
    const fromPosition = this._camera.position.clone();
    const midpoint = fromPosition.clone().lerp(position, 0.5);
    const travel = Math.max(0.1, fromPosition.distanceTo(position));
    const tangent = new THREE.Vector3().crossVectors(
      position.clone().sub(fromPosition).normalize(),
      this._camera.up,
    ).normalize();
    const controlPosition = midpoint
      .addScaledVector(tangent, travel * (zone ? 0.34 : -0.24))
      .addScaledVector(this._camera.up, travel * 0.12);
    if (this.cameraTransitionMs <= 0 || this._prefersReducedMotion) {
      this._camera.position.copy(position);
      this._controls.target.copy(target);
      this._controls.update();
      this._cameraTween = undefined;
      this._controls.autoRotate = this.autoOrbit && !this._prefersReducedMotion && !this.isolatedElementId;
      this._beaconsDirty = true;
      return;
    }
    this._cameraTween = {
      started: performance.now(),
      duration: THREE.MathUtils.clamp(this.cameraTransitionMs, 160, 1_400),
      fromPosition,
      toPosition: position,
      fromTarget: this._controls.target.clone(),
      toTarget: target,
      controlPosition,
    };
    this._controls.autoRotate = false;
  }

  private _isolatedElementPose(): { target: THREE.Vector3; position: THREE.Vector3 } | undefined {
    if (!this._camera || !this._overviewBounds || this._overviewBounds.isEmpty()) return undefined;
    const bounds = this._overviewBounds;
    const target = bounds.getCenter(new THREE.Vector3());
    const direction = new THREE.Vector3(1.05, 0.72, 1.2).normalize();
    const forward = direction.clone().negate();
    const right = new THREE.Vector3().crossVectors(forward, this._camera.up).normalize();
    const up = new THREE.Vector3().crossVectors(right, forward).normalize();
    const verticalTangent = Math.tan(THREE.MathUtils.degToRad(this._camera.fov) / 2);
    const horizontalTangent = verticalTangent * Math.max(this._camera.aspect, 0.2);
    const corners = [bounds.min.x, bounds.max.x].flatMap((x) =>
      [bounds.min.y, bounds.max.y].flatMap((y) =>
        [bounds.min.z, bounds.max.z].map((z) => new THREE.Vector3(x, y, z))));
    const distance = corners.reduce((fit, corner) => {
      const relative = corner.clone().sub(target);
      return Math.max(
        fit,
        relative.dot(direction) + Math.abs(relative.dot(right)) / (horizontalTangent * 0.8),
        relative.dot(direction) + Math.abs(relative.dot(up)) / (verticalTangent * 0.8),
      );
    }, this._camera.near * 2) * 1.05;
    return { target, position: target.clone().addScaledVector(direction, distance) };
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
    if (this.overviewResetSeconds <= 0) return;
    this._overviewResetTimer = window.setTimeout(() => {
      this._overviewResetTimer = undefined;
      this._moveCameraTo(this.focusedZoneId);
    }, this.overviewResetSeconds * 1_000);
  };

  private _onContextLost = (event: Event): void => {
    event.preventDefault();
    this._contextLost = true;
    this._error = 'The 3D view paused to recover graphics memory.';
    cancelAnimationFrame(this._frame);
  };

  private _onContextRestored = (): void => {
    this._contextLost = false;
    this._error = '';
    this._buildModel();
    this._resize();
    this._moveCameraTo(this.focusedZoneId);
    this._animate();
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
    this._applyElementFocus();
    this._applyEntityMarkerFocus();
  }

  private _applyElementFocus(): void {
    if (!this._model) return;
    this._model.traverse((node) => {
      if (!node.userData.spatialElementRoot) return;
      const zoneId = node.userData.zoneId as string | undefined;
      node.visible = this.focusedZoneId === null || zoneId === this.focusedZoneId;
    });
  }

  private _applyEntityMarkerFocus(): void {
    if (!this._model) return;
    this._model.traverse((node) => {
      if (!(node instanceof THREE.Mesh) || !node.userData.entityMarker) return;
      const zoneId = node.userData.zoneId as string | undefined;
      node.visible = this.focusedZoneId === null || zoneId === this.focusedZoneId;
    });
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
    this._applyZoneLightLayers(object, zoneIds);
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

  private _activateEntityBeacon(event: Event, entityId: string, roomFocused: boolean, contentVisible: boolean): void {
    event.stopPropagation();
    if (roomFocused && !contentVisible && this._expandedEntityId !== entityId) {
      this._setExpandedEntityId(entityId);
      return;
    }
    this._selectEntity(entityId);
  }

  private _collapseEntityBeacon(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || this._expandedEntityId === null) return;
    event.preventDefault();
    event.stopPropagation();
    this._setExpandedEntityId(null);
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
      const expandedWidth = Number.parseFloat(beacon.style.getPropertyValue('--entity-width')) || 154;
      const side = x + expandedWidth > width - 10 ? 'end' : 'start';
      beacon.style.setProperty('--entity-x', `${x}px`);
      beacon.style.setProperty('--entity-y', `${y}px`);
      beacon.dataset.side = side;
    });
  }

  private _entityMarkerIsVisible(entity: EntityConfig): boolean {
    if (!(entity.spatial?.visible ?? true)) return false;
    const roomFocused = this.focusedZoneId !== null;
    if (roomFocused && entity.zoneId !== this.focusedZoneId) return false;
    const resolved = resolveDirectSpatialEntityState(this.hass?.states ?? {}, entity.entity);
    const configured = roomFocused ? entity.roomVisibility : entity.overviewVisibility;
    if (this._isConfiguredGroupWithPlacedChildren(entity.entity) && (!configured || configured === 'auto')) return false;
    const visibility = !configured || configured === 'auto'
      ? roomFocused ? suggestedRoomVisibility(entity.entity) : suggestedOverviewVisibility(entity.entity)
      : configured;
    if (visibility === 'hidden') return false;
    if (visibility === 'always') return true;
    if (visibility === 'attention') return resolved.activity === 'attention';
    return ['active', 'attention'].includes(resolved.activity);
  }

  private _renderEntityBeacon(entity: EntityConfig) {
    const element = this.plan?.elements.find((candidate) => candidate.entityId === entity.entity);
    if (!this._entityMarkerIsVisible(entity)) return '';
    const resolved = resolveDirectSpatialEntityState(this.hass?.states ?? {}, entity.entity);
    const roomFocused = this.focusedZoneId !== null;
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
    if (!entity.icon && element?.type === 'ceiling-light') icon = 'mdi:ceiling-light';
    if (!entity.icon && element?.type === 'light-bulb') icon = resolved.activity === 'active' ? 'mdi:lightbulb-on' : 'mdi:lightbulb-outline';
    if (!entity.icon && !element && resolved.activity === 'off') {
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
    const tooltipContent = roomFocused
      ? entity.tooltipContentInRoom ?? 'none'
      : entity.tooltipContentInOverview ?? 'none';
    const persistentContent = tooltipContent === 'state'
      && (domain !== 'media_player' || resolved.activity === 'active');
    const expanded = persistentContent || (roomFocused && this._expandedEntityId === entity.entity);
    const width = Math.min(188, Math.max(118, Math.max(presentation.name.length, presentation.status.length) * 5.4 + 42));
    const lightColor = domain === 'light' && resolved.activity === 'active' ? resolveLightColor(fallbackState) : null;
    const accent = lightColor ? `rgb(${lightColor.r} ${lightColor.g} ${lightColor.b})` : '#91a0a3';
    const size = roomFocused ? entity.roomSize ?? entity.size : entity.overviewSize ?? entity.size;
    const sizeScale = size === 'tiny' ? 0.72 : size === 'small' ? 0.86 : size === 'large' ? 1.18 : size === 'huge' ? 1.36 : 1;
    return html`<button
      type="button"
      class="entity-beacon ${expanded ? 'expanded' : ''}"
      data-entity-id=${entity.entity}
      data-activity=${resolved.activity}
      data-domain=${domain}
      data-context=${roomFocused ? 'room' : 'overview'}
      style=${`--entity-width:${width}px;--entity-accent:${accent};--entity-user-scale:${sizeScale}`}
      aria-label=${`${presentation.name}: ${presentation.status}`}
      aria-expanded=${roomFocused ? String(expanded) : nothing}
      @click=${(event: Event) => this._activateEntityBeacon(event, entity.entity, roomFocused, expanded)}
      @keydown=${this._collapseEntityBeacon}
    >
      <span class="entity-icon"><ha-icon icon=${icon}></ha-icon></span>
      <span class="entity-copy"><strong>${presentation.name}</strong><span>${presentation.status}</span></span>
    </button>`;
  }

  private _beaconEntities(): EntityConfig[] {
    const entities = new Map(this.entities.map((entity) => [entity.entity, entity]));
    this.plan?.elements.forEach((element) => {
      if (element.entityId) {
        const existing = entities.get(element.entityId);
        entities.set(element.entityId, existing ? {
          ...existing,
          zoneId: element.zoneId ?? existing.zoneId,
        } : {
          entity: element.entityId,
          name: element.name,
          icon: element.type === 'ceiling-light' ? 'mdi:ceiling-light' : element.type === 'light-bulb' ? 'mdi:lightbulb-outline' : undefined,
          x: 50,
          y: 50,
          size: 'medium',
          tap: 'more-info',
          orientation: null,
          zoneId: element.zoneId,
        });
      }
      element.glb?.surfaces.forEach((surface) => {
        if (!surface.entityId) return;
        const existing = entities.get(surface.entityId);
        entities.set(surface.entityId, existing ? {
          ...existing,
          zoneId: element.zoneId ?? existing.zoneId,
        } : {
          entity: surface.entityId,
          name: surface.name,
          x: 50,
          y: 50,
          size: 'medium',
          tap: 'more-info',
          orientation: null,
          zoneId: element.zoneId,
        });
      });
    });
    return [...entities.values()];
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
    const surfaceHit = hits.find((hit) => Array.isArray(hit.object.userData.elementGlbSurfaceIds));
    if (surfaceHit) {
      const ids = surfaceHit.object.userData.elementGlbSurfaceIds as string[];
      const surfaceId = ids[surfaceHit.face?.materialIndex ?? 0];
      const elementId = surfaceHit.object.userData.spatialElementId as string | undefined;
      const surface = this.plan?.elements.find((candidate) => candidate.id === elementId)?.glb?.surfaces.find((candidate) => candidate.id === surfaceId);
      if (surface?.entityId) {
        this._selectEntity(surface.entityId);
        return;
      }
    }
    const entity = hits.find((hit) => hit.object.userData.entityId);
    if (entity) {
      this._selectEntity(entity.object.userData.entityId as string);
      return;
    }
    this._setExpandedEntityId(null);
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
    this._beaconsDirty = true;
    if (this._overviewBounds && Math.abs(previousAspect - this._camera.aspect) > 0.01) {
      this._moveCameraTo(this.focusedZoneId);
    }
  }

  private _animate = () => {
    if (this._contextLost) return;
    this._frame = requestAnimationFrame(this._animate);
    if (!this._isVisible || document.visibilityState === 'hidden') return;
    const tweening = Boolean(this._cameraTween);
    if (this._cameraTween && this._camera && this._controls) {
      const elapsed = (performance.now() - this._cameraTween.started) / this._cameraTween.duration;
      const progress = Math.min(1, elapsed);
      const eased = 1 - Math.pow(1 - progress, 3);
      if (this._cameraTween.controlPosition) {
        const inverse = 1 - eased;
        this._camera.position
          .copy(this._cameraTween.fromPosition).multiplyScalar(inverse * inverse)
          .addScaledVector(this._cameraTween.controlPosition, 2 * inverse * eased)
          .addScaledVector(this._cameraTween.toPosition, eased * eased);
      } else {
        this._camera.position.lerpVectors(this._cameraTween.fromPosition, this._cameraTween.toPosition, eased);
      }
      this._controls.target.lerpVectors(this._cameraTween.fromTarget, this._cameraTween.toTarget, eased);
      if (progress >= 1) {
        this._cameraTween = undefined;
        this._controls.autoRotate = this.autoOrbit && !this._prefersReducedMotion && !this.isolatedElementId;
      }
    }
    const cameraChanged = this._controls?.update() ?? false;
    this._animateEntityEffects(performance.now());
    if (this._beaconsDirty || tweening || cameraChanged) {
      this._syncEntityBeacons();
      this._beaconsDirty = false;
    }
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
    const isolatedElement = this.isolatedElementId
      ? this.plan?.elements.find((element) => element.id === this.isolatedElementId)
      : undefined;
    const isolatedLight = isolatedElement && (isolatedElement.type === 'ceiling-light' || isolatedElement.type === 'light-bulb')
      ? isolatedElement
      : undefined;
    const isolatedLightState = isolatedLight?.entityId ? this.hass?.states?.[isolatedLight.entityId] : undefined;
    const isolatedLightColor = isolatedLightState ? resolveLightColor(isolatedLightState) : null;
    const isolatedAccent = isolatedLightColor ? `rgb(${isolatedLightColor.r} ${isolatedLightColor.g} ${isolatedLightColor.b})` : '#a9d2d8';
    return html`${!this.isolatedElementId && this.showRoomControls && this.zones.length ? html`<nav class="room-navigation" aria-label="Rooms">
      ${this.focusedZoneId !== null ? html`<button class="room-back" aria-label="Back to apartment overview" title="Overview"
        @pointerup=${(event: PointerEvent) => this._focusZoneFromPointer(event, null)}
        @click=${() => this._focusZone(null)}><ha-icon icon="mdi:arrow-left"></ha-icon></button><span class="room-divider" aria-hidden="true"></span>` : ''}
      <div class="room-rail">
        ${this.zones.map((zone) => html`<button aria-pressed=${this.focusedZoneId === zone.id} @pointerup=${(event: PointerEvent) => this._focusZoneFromPointer(event, zone.id ?? null)} @click=${() => this._focusZone(zone.id ?? null)}>${zone.name}</button>`)}
      </div>
    </nav>` : ''}
    <div class="viewport">
      <canvas aria-label="Generated interactive 3D apartment preview"></canvas>
      ${isolatedLight ? html`<div class="isolated-light-beacon" style=${`--isolated-accent:${isolatedAccent}`} aria-label=${isolatedLight.name ?? 'Light Element'}>
        <ha-icon icon=${isolatedLight.type === 'ceiling-light' ? 'mdi:ceiling-light' : 'mdi:lightbulb-outline'}></ha-icon>
      </div>` : nothing}
      ${!this.isolatedElementId ? html`<div class="entity-layer" role="group" aria-label="Devices">
        ${this._beaconEntities().map((entity) => this._renderEntityBeacon(entity))}
      </div>` : nothing}
      ${!this.isolatedElementId && !this.zones.length ? html`<div class="empty">Name the enclosed rooms to unlock room navigation and Home Assistant devices.</div>` : ''}
      ${this._loadingModel ? html`<div class="empty">Loading spatial model…</div>` : ''}
      ${this._error ? html`<div class="error">${this._error}</div>` : ''}
    </div>
    ${!this.isolatedElementId ? html`<div class="entity-shortcuts" role="group" aria-label="Devices">
      ${this._beaconEntities().filter((entity) => this._entityMarkerIsVisible(entity)).map((entity) => html`<button @click=${() => this._selectEntity(entity.entity)}>${entity.name ?? entity.entity}</button>`)}
    </div>` : nothing}`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'spatial-preview': SpatialPreview;
  }
}
