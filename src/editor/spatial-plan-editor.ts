import { LitElement, css, html, svg, type PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { EntityConfig, OpeningConfig, SpatialElement, SpatialPlan, SpatialShellConfig, SpatialShellOpening, SpatialVertex, SpatialWallSegment } from '../core/config';
import { spatialBounds, wallLength } from '../core/spatial-geometry';
import { addSpatialVertex, addSpatialWall, emptySpatialPlan, moveSpatialVertex, nearestSpatialVertex, snapSpatialPoint, updateSpatialElement } from '../core/spatial-plan';
import { addShellWall, assignShellOpenings, moveShellPoint, reconcileShellWallZones, shellSegments } from '../core/spatial-shell';
import { isValidSimplePolygon } from '../core/polygon';

type PlanEditorMode = 'select' | 'wall' | 'room' | 'pan';

interface ViewportGesture {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startPanX: number;
  startPanZ: number;
  scaleX: number;
  scaleY: number;
}

interface PinchGesture {
  startZoom: number;
  startDistance: number;
  startMidX: number;
  startMidY: number;
  startView: { x: number; z: number; width: number; depth: number };
  anchor: { x: number; z: number };
  scaleX: number;
  scaleY: number;
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 10;
const NUDGE_STEP_METERS = 0.01;
const NUDGE_FINE_STEP_METERS = 0.001;
const NUDGE_COARSE_STEP_METERS = 0.1;

type PlanMovement = [number, number];
type PlanEditScope = 'structure' | 'rooms' | 'openings' | 'elements' | 'devices' | 'none';

const ARROW_MOVEMENT: Readonly<Record<string, PlanMovement>> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

@customElement('spatial-plan-editor')
export class SpatialPlanEditor extends LitElement {
  @property({ attribute: false }) plan: SpatialPlan = emptySpatialPlan();
  @property({ attribute: false }) openings: OpeningConfig[] = [];
  @property({ attribute: false }) entities: EntityConfig[] = [];
  @property({ attribute: false }) shell: SpatialShellConfig | null = null;
  @property() selectedWallId = '';
  @property() selectedVertexId = '';
  @property() selectedElementId = '';
  @property() selectedOpeningId = '';
  @property() selectedRoomId = '';
  @property() selectedEntityId = '';
  @property({ attribute: 'edit-scope' }) editScope: PlanEditScope = 'structure';
  @state() private _mode: PlanEditorMode = 'select';
  @state() private _draftStartId = '';
  @state() private _draftShellStart: [number, number] | null = null;
  @state() private _draftRoomPoints: [number, number][] = [];
  @state() private _roomDraftError = '';
  @state() private _deleteArmed = false;
  @state() private _dragVertexId = '';
  @state() private _dragElementId = '';
  @state() private _dragEntityId = '';
  @state() private _dragOpeningId = '';
  @state() private _zoom = MIN_ZOOM;
  @state() private _panX = 0;
  @state() private _panZ = 0;
  @state() private _isPanning = false;
  private _dragShellPoint: [number, number] | null = null;
  private _selectedShellPoint: [number, number] | null = null;
  private _dragRoomPoint: { roomId: string; index: number } | null = null;
  private _selectedRoomPoint: { roomId: string; index: number } | null = null;
  private _dragShellRoomPoint: { zoneId: string; floorIndex: number; pointIndex: number } | null = null;
  private _selectedShellRoomPoint: { zoneId: string; floorIndex: number; pointIndex: number } | null = null;
  @state() private _dragShellPointKey = '';
  private _dragEntityPoint: { x: number; z: number } | null = null;
  private _dragOpeningKind: 'plan' | 'shell' | '' = '';
  private _selectedOpeningKind: 'plan' | 'shell' | '' = '';
  private _pendingDragPoint: { x: number; z: number } | null = null;
  private _dragFrame = 0;
  private _dragPlan: SpatialPlan | null = null;
  private _dragShell: SpatialShellConfig | null = null;
  private _dragOpenings: OpeningConfig[] | null = null;
  @state() private _dragMoved = false;
  private _viewportPointers = new Map<number, { x: number; y: number }>();
  private _viewportGesture: ViewportGesture | null = null;
  private _pinchGesture: PinchGesture | null = null;

  disconnectedCallback(): void {
    if (this._dragFrame) cancelAnimationFrame(this._dragFrame);
    this._dragFrame = 0;
    this._dragPlan = null;
    this._dragShell = null;
    this._dragOpenings = null;
    super.disconnectedCallback();
  }

  protected willUpdate(changed: PropertyValues<this>): void {
    if (changed.has('selectedOpeningId')) {
      this._selectedOpeningKind = this._openingKindForId(this.selectedOpeningId);
    }
    if (changed.has('editScope')) {
      if (this.editScope !== 'structure' && this._mode === 'wall') this._setMode('select');
      if (this.editScope !== 'rooms' && this._mode === 'room') this._setMode('select');
      if (this.editScope !== 'structure') this.selectedWallId = '';
      if (this.editScope !== 'openings') {
        this.selectedOpeningId = '';
        this._selectedOpeningKind = '';
      }
      if (this.editScope !== 'elements') this.selectedElementId = '';
      if (this.editScope !== 'devices') this.selectedEntityId = '';
      if (this.editScope === 'rooms') {
        if (this.selectedVertexId && !this._roomVertexIds().has(this.selectedVertexId)) this.selectedVertexId = '';
        this._selectedShellPoint = null;
      } else if (this.editScope !== 'structure') {
        this.selectedVertexId = '';
        this._selectedShellPoint = null;
      }
      if (this.editScope !== 'rooms') {
        this._selectedRoomPoint = null;
        this._selectedShellRoomPoint = null;
      }
    }
    if (changed.has('selectedRoomId')) {
      const shellZoneId = this.selectedRoomId.startsWith('survey:') ? this.selectedRoomId.slice(7) : '';
      if (this._selectedRoomPoint?.roomId !== this.selectedRoomId) this._selectedRoomPoint = null;
      if (this._selectedShellRoomPoint?.zoneId !== shellZoneId) this._selectedShellRoomPoint = null;
    }
  }

  static styles = css`
    :host {
      display: block;
      color: #edf2f3;
      outline: none;
      -webkit-tap-highlight-color: transparent;
    }
    :host(:focus),
    :host(:focus-visible),
    .editor:focus,
    .canvas:focus,
    svg:focus,
    svg:focus-visible {
      outline: none !important;
    }
    .editor {
      overflow: hidden;
      border: 1px solid rgba(229, 239, 241, 0.12);
      border-radius: 8px;
      background: #0c1112;
    }
    .toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      min-height: 54px;
      padding: 7px 9px 7px 12px;
      border-bottom: 1px solid rgba(229, 239, 241, 0.1);
      background: #111718;
    }
    .mode-group { display: flex; gap: 3px; padding: 3px; border-radius: 7px; background: #090d0e; }
    button {
      min-height: 38px;
      padding: 0 13px;
      border: 0;
      border-radius: 5px;
      color: #aebabc;
      background: transparent;
      font: 600 13px/1 inherit;
      cursor: pointer;
    }
    button:hover { color: #edf2f3; background: rgba(255, 255, 255, 0.06); }
    button[aria-pressed='true'] { color: #101617; background: #c8d5d7; }
    button:focus-visible { outline: 2px solid #d9e5e7; outline-offset: 2px; }
    .hint { min-width: 0; color: #829093; font-size: 12px; line-height: 1.4; }
    .finish { flex: 0 0 auto; color: #dbe6e7; background: #273234; }
    .delete-wall { flex: 0 0 auto; color: #efb3ad; background: rgba(150, 53, 45, 0.14); }
    .delete-wall:hover { color: #ffe8e5; background: rgba(183, 67, 57, 0.24); }
    .delete-wall.confirm { color: #fff; background: #a73f36; }
    .canvas { position: relative; min-height: 420px; aspect-ratio: 16 / 10; }
    svg {
      display: block;
      width: 100%;
      height: 100%;
      outline: none;
      touch-action: none;
      cursor: default;
      -webkit-tap-highlight-color: transparent;
    }
    svg [role='button'] {
      outline: none;
      -webkit-tap-highlight-color: transparent;
    }
    svg.drawing { cursor: crosshair; }
    svg.pan { cursor: grab; }
    svg.panning { cursor: grabbing; }
    .viewport-controls {
      position: absolute;
      z-index: 2;
      right: 10px;
      bottom: 10px;
      display: flex;
      gap: 2px;
      padding: 3px;
      border: 1px solid rgba(229, 239, 241, 0.14);
      border-radius: 7px;
      background: rgba(10, 14, 15, 0.9);
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.22);
      backdrop-filter: blur(12px);
    }
    .viewport-controls button {
      display: grid;
      place-items: center;
      width: 40px;
      min-width: 40px;
      height: 40px;
      min-height: 40px;
      padding: 0;
      border-radius: 5px;
    }
    .viewport-controls ha-icon { --mdc-icon-size: 20px; }
    .viewport-controls button:disabled { color: #596466; cursor: default; background: transparent; }
    .viewport-controls .pan-control[aria-pressed='true'] { color: #101617; background: #c8d5d7; }
    .room { fill: #5f6d6d; fill-opacity: 0.18; stroke: transparent; stroke-width: 0.06; cursor: pointer; }
    .room.selected { fill: #8db8c1; fill-opacity: 0.28; stroke: #b8e1e6; }
    .room.draft { fill: #8db8c1; fill-opacity: 0.2; stroke: none; pointer-events: none; }
    .room-draft-line { fill: none; stroke: #b8e1e6; stroke-width: 0.055; stroke-dasharray: 0.16 0.1; pointer-events: none; }
    .room:focus-visible { stroke: #d9e5e7; }
    .survey-room { fill: #657474; fill-opacity: 0.2; stroke: transparent; stroke-width: 0.06; cursor: pointer; }
    .survey-room.selected { fill: #8db8c1; fill-opacity: 0.28; stroke: #b8e1e6; }
    .survey-room:focus-visible { stroke: #d9e5e7; }
    .survey-room.tile { fill: #6d7776; fill-opacity: 0.3; }
    .survey-wall { fill: none; stroke: #d8dfdf; stroke-linecap: square; stroke-linejoin: round; pointer-events: none; }
    .survey-wall.selected { stroke: #9dcbd2; }
    .survey-wall-hit {
      fill: none;
      stroke: transparent;
      outline: none;
      cursor: pointer;
      pointer-events: stroke;
      -webkit-tap-highlight-color: transparent;
    }
    .survey-wall:has(+ .survey-wall-hit:focus-visible) { stroke: #d9e5e7; }
    .survey-vertex-hit { fill: transparent; stroke: none; outline: none; cursor: grab; pointer-events: all; -webkit-tap-highlight-color: transparent; }
    .survey-vertex { fill: #101617; stroke: #d8dfdf; stroke-width: 0.035; pointer-events: none; }
    .survey-vertex.selected { fill: #b9dce1; stroke: #101617; }
    .survey-vertex-hit:focus-visible + .survey-vertex { stroke: #edf6f7; stroke-width: 0.065; }
    .survey-opening { stroke: #0c1112; stroke-linecap: butt; pointer-events: none; }
    .survey-opening.selected { stroke: #8ed4df; }
    .survey-opening-hit { stroke: transparent; outline: none; cursor: grab; -webkit-tap-highlight-color: transparent; }
    .wall { fill: none; stroke: #d8dfdf; stroke-linecap: square; stroke-linejoin: round; }
    .wall.selected { stroke: #9dcbd2; }
    .wall-hit {
      fill: none;
      stroke: transparent;
      outline: none;
      cursor: pointer;
      pointer-events: stroke;
      -webkit-tap-highlight-color: transparent;
    }
    .wall:has(+ .wall-hit:focus-visible) { stroke: #d9e5e7; }
    .vertex { fill: #101617; stroke: #d8dfdf; stroke-width: 0.035; outline: none; cursor: grab; -webkit-tap-highlight-color: transparent; }
    .vertex.selected, .vertex.draft { fill: #b9dce1; stroke: #101617; }
    .vertex:focus-visible { stroke: #edf6f7; stroke-width: 0.065; }
    .opening { stroke: #0c1112; stroke-width: 0.16; stroke-linecap: butt; pointer-events: none; }
    .opening.selected { stroke: #8ed4df; }
    .opening-hit { stroke: transparent; outline: none; cursor: grab; -webkit-tap-highlight-color: transparent; }
    .element { outline: none; cursor: grab; -webkit-tap-highlight-color: transparent; }
    .element-shape { fill: #879597; fill-opacity: 0.82; stroke: #c8d5d7; stroke-width: 0.025; }
    .element.selected .element-shape { fill: #a9cbd0; stroke: #edf6f7; stroke-width: 0.055; }
    .element:focus-visible .element-shape { stroke: #edf6f7; stroke-width: 0.055; }
    .element-label { display: none; fill: #0b1011; font: 650 0.18px/1 -apple-system, BlinkMacSystemFont, sans-serif; text-anchor: middle; pointer-events: none; }
    .element.selected .element-label { display: block; }
    .entity-marker { fill: #152326; stroke: #a8d9e1; stroke-width: 0.045; outline: none; cursor: grab; -webkit-tap-highlight-color: transparent; }
    .entity-marker.selected { fill: #b8dce2; stroke: #f2fbfc; }
    .entity-marker:focus-visible { stroke: #edf6f7; stroke-width: 0.065; }
    .dimension {
      fill: #aab6b8;
      font: 600 0.2px/1 -apple-system, BlinkMacSystemFont, sans-serif;
      paint-order: stroke;
      stroke: #0c1112;
      stroke-width: 0.055;
      stroke-linejoin: round;
      text-anchor: middle;
      pointer-events: none;
    }
    .empty {
      position: absolute;
      inset: 0;
      display: grid;
      place-content: center;
      gap: 8px;
      padding: 32px;
      color: #aab6b8;
      text-align: center;
      pointer-events: none;
    }
    .empty strong { color: #edf2f3; font-size: 18px; font-weight: 560; }
    .empty span { max-width: 38ch; font-size: 13px; line-height: 1.45; }
    @media (max-width: 600px) {
      .toolbar { align-items: stretch; flex-direction: column; gap: 7px; padding: 8px; }
      .toolbar-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
      button { min-height: 44px; }
      .hint { padding: 0 4px 2px; }
      .canvas { min-height: 340px; aspect-ratio: 1 / 1; }
      .viewport-controls { right: 8px; bottom: 8px; }
      .viewport-controls button { width: 44px; min-width: 44px; height: 44px; min-height: 44px; }
      :host([compact]) .toolbar { min-height: 48px; }
      :host([compact]) .hint { display: none; }
      :host([compact]) .canvas { min-height: 230px; aspect-ratio: 16 / 9; }
    }
    @media (prefers-reduced-motion: reduce) { * { scroll-behavior: auto !important; } }
  `;

  private _fitViewBox(): { x: number; z: number; width: number; depth: number } {
    if (this.shell) {
      const points = [...this.shell.outer, ...this.shell.floor, ...(this.shell.floors ?? []).flat()];
      if (points.length) {
        const minX = Math.min(...points.map(([x]) => x));
        const maxX = Math.max(...points.map(([x]) => x));
        const minZ = Math.min(...points.map(([, z]) => z));
        const maxZ = Math.max(...points.map(([, z]) => z));
        return { x: minX - 0.8, z: minZ - 0.8, width: Math.max(6, maxX - minX + 1.6), depth: Math.max(5, maxZ - minZ + 1.6) };
      }
    }
    const roomPoints = this.plan.rooms.flatMap((room) => room.floor ?? []);
    const allPoints = [
      ...this.plan.vertices.map((vertex) => [vertex.x, vertex.z] as [number, number]),
      ...roomPoints,
    ];
    const bounds = allPoints.length ? {
      minX: Math.min(...allPoints.map(([x]) => x)),
      maxX: Math.max(...allPoints.map(([x]) => x)),
      minZ: Math.min(...allPoints.map(([, z]) => z)),
      maxZ: Math.max(...allPoints.map(([, z]) => z)),
    } : spatialBounds(this.plan);
    const width = Math.max(6, bounds.maxX - bounds.minX + 2);
    const depth = Math.max(5, bounds.maxZ - bounds.minZ + 2);
    return {
      x: allPoints.length ? bounds.minX - 1 : -width / 2,
      z: allPoints.length ? bounds.minZ - 1 : -depth / 2,
      width,
      depth,
    } as { x: number; z: number; width: number; depth: number };
  }

  private _viewBox(): { x: number; z: number; width: number; depth: number } {
    const fit = this._fitViewBox();
    const width = fit.width / this._zoom;
    const depth = fit.depth / this._zoom;
    return {
      x: fit.x + (fit.width - width) / 2 + this._panX,
      z: fit.z + (fit.depth - depth) / 2 + this._panZ,
      width,
      depth,
    };
  }

  private _svg(): SVGSVGElement | null {
    const element = this.renderRoot.querySelector('svg');
    return element instanceof SVGSVGElement ? element : null;
  }

  private _worldPoint(clientX: number, clientY: number): { x: number; z: number } | null {
    const matrix = this._svg()?.getScreenCTM();
    if (!matrix) return null;
    const point = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse());
    return { x: point.x, z: point.y };
  }

  private _point(event: PointerEvent): { x: number; z: number } | null {
    const point = this._worldPoint(event.clientX, event.clientY);
    return point ? snapSpatialPoint(point, 0.1) : null;
  }

  private _clampZoom(value: number): number {
    return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
  }

  private _setZoomAt(value: number, clientX?: number, clientY?: number): void {
    const nextZoom = this._clampZoom(value);
    if (Math.abs(nextZoom - this._zoom) < 0.001) return;
    const current = this._viewBox();
    const fit = this._fitViewBox();
    const anchor = clientX == null || clientY == null ? null : this._worldPoint(clientX, clientY);
    const ratioX = anchor ? (anchor.x - current.x) / current.width : 0.5;
    const ratioZ = anchor ? (anchor.z - current.z) / current.depth : 0.5;
    const width = fit.width / nextZoom;
    const depth = fit.depth / nextZoom;
    const nextX = anchor ? anchor.x - ratioX * width : fit.x + (fit.width - width) / 2 + this._panX;
    const nextZ = anchor ? anchor.z - ratioZ * depth : fit.z + (fit.depth - depth) / 2 + this._panZ;
    this._zoom = nextZoom;
    this._panX = nextX - fit.x - (fit.width - width) / 2;
    this._panZ = nextZ - fit.z - (fit.depth - depth) / 2;
  }

  private _zoomIn(): void {
    this._setZoomAt(this._zoom * 1.5);
  }

  private _zoomOut(): void {
    this._setZoomAt(this._zoom / 1.5);
  }

  private _fitView(): void {
    this._zoom = MIN_ZOOM;
    this._panX = 0;
    this._panZ = 0;
  }

  private _onWheel(event: WheelEvent): void {
    const factor = Math.exp(-event.deltaY * 0.0015);
    const nextZoom = this._clampZoom(this._zoom * factor);
    if (Math.abs(nextZoom - this._zoom) < 0.001) return;
    event.preventDefault();
    this._setZoomAt(nextZoom, event.clientX, event.clientY);
  }

  private _viewportScale(): { x: number; y: number } {
    const matrix = this._svg()?.getScreenCTM();
    if (matrix) return { x: Math.max(0.001, Math.hypot(matrix.a, matrix.b)), y: Math.max(0.001, Math.hypot(matrix.c, matrix.d)) };
    const bounds = this._svg()?.getBoundingClientRect();
    const view = this._viewBox();
    return {
      x: Math.max(0.001, (bounds?.width ?? 1) / view.width),
      y: Math.max(0.001, (bounds?.height ?? 1) / view.depth),
    };
  }

  private _beginPinchGesture(): void {
    const points = [...this._viewportPointers.values()];
    if (points.length < 2) return;
    const [first, second] = points;
    const startMidX = (first.x + second.x) / 2;
    const startMidY = (first.y + second.y) / 2;
    const anchor = this._worldPoint(startMidX, startMidY);
    if (!anchor) return;
    const scale = this._viewportScale();
    this._pinchGesture = {
      startZoom: this._zoom,
      startDistance: Math.max(1, Math.hypot(second.x - first.x, second.y - first.y)),
      startMidX,
      startMidY,
      startView: this._viewBox(),
      anchor,
      scaleX: scale.x,
      scaleY: scale.y,
    };
  }

  private _startViewportGesture(event: PointerEvent): void {
    event.preventDefault();
    event.stopPropagation();
    const svgElement = this._svg();
    svgElement?.setPointerCapture?.(event.pointerId);
    this._viewportPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    this._isPanning = true;
    if (this._viewportPointers.size > 1) {
      this._beginPinchGesture();
      this._viewportGesture = null;
      return;
    }
    const scale = this._viewportScale();
    this._viewportGesture = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startPanX: this._panX,
      startPanZ: this._panZ,
      scaleX: scale.x,
      scaleY: scale.y,
    };
  }

  private _moveViewportGesture(event: PointerEvent): boolean {
    if (!this._viewportPointers.has(event.pointerId)) return false;
    event.preventDefault();
    this._viewportPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this._viewportPointers.size > 1 && this._pinchGesture) {
      const points = [...this._viewportPointers.values()];
      const [first, second] = points;
      const midpointX = (first.x + second.x) / 2;
      const midpointY = (first.y + second.y) / 2;
      const distance = Math.max(1, Math.hypot(second.x - first.x, second.y - first.y));
      const gesture = this._pinchGesture;
      const nextZoom = this._clampZoom(gesture.startZoom * distance / gesture.startDistance);
      const fit = this._fitViewBox();
      const width = fit.width / nextZoom;
      const depth = fit.depth / nextZoom;
      const ratioX = (gesture.anchor.x - gesture.startView.x) / gesture.startView.width;
      const ratioZ = (gesture.anchor.z - gesture.startView.z) / gesture.startView.depth;
      const zoomScale = nextZoom / gesture.startZoom;
      const nextX = gesture.anchor.x - ratioX * width - (midpointX - gesture.startMidX) / (gesture.scaleX * zoomScale);
      const nextZ = gesture.anchor.z - ratioZ * depth - (midpointY - gesture.startMidY) / (gesture.scaleY * zoomScale);
      this._zoom = nextZoom;
      this._panX = nextX - fit.x - (fit.width - width) / 2;
      this._panZ = nextZ - fit.z - (fit.depth - depth) / 2;
      return true;
    }
    const gesture = this._viewportGesture;
    if (!gesture || gesture.pointerId !== event.pointerId) return true;
    this._panX = gesture.startPanX - (event.clientX - gesture.startClientX) / gesture.scaleX;
    this._panZ = gesture.startPanZ - (event.clientY - gesture.startClientY) / gesture.scaleY;
    return true;
  }

  private _endViewportGesture(event: PointerEvent): boolean {
    if (!this._viewportPointers.has(event.pointerId)) return false;
    this._viewportPointers.delete(event.pointerId);
    if (this._viewportPointers.size === 1) {
      const [pointerId, point] = [...this._viewportPointers.entries()][0];
      const scale = this._viewportScale();
      this._viewportGesture = {
        pointerId,
        startClientX: point.x,
        startClientY: point.y,
        startPanX: this._panX,
        startPanZ: this._panZ,
        scaleX: scale.x,
        scaleY: scale.y,
      };
      this._pinchGesture = null;
    } else if (!this._viewportPointers.size) {
      this._viewportGesture = null;
      this._pinchGesture = null;
      this._isPanning = false;
    }
    return true;
  }

  private _commit(plan: SpatialPlan, record = true): void {
    this.plan = plan;
    this.dispatchEvent(new CustomEvent('spatial-plan-changed', {
      detail: { plan, record }, bubbles: true, composed: true,
    }));
  }

  private _commitShell(shell: SpatialShellConfig, record = true): void {
    this.shell = shell;
    this.dispatchEvent(new CustomEvent('spatial-shell-changed', {
      detail: { shell, record }, bubbles: true, composed: true,
    }));
  }

  private _setMode(mode: PlanEditorMode): void {
    this._mode = mode;
    this._deleteArmed = false;
    if (mode !== 'wall') {
      this._draftStartId = '';
      this._draftShellStart = null;
    }
    if (mode !== 'room') this._draftRoomPoints = [];
    if (mode !== 'pan') {
      this._viewportPointers.clear();
      this._viewportGesture = null;
      this._pinchGesture = null;
      this._isPanning = false;
    }
  }

  public async beginStructureEditing(): Promise<void> {
    this._setMode('select');
    await this.updateComplete;
  }

  public async beginRoomDrawing(): Promise<void> {
    this._setMode('room');
    await this.updateComplete;
  }

  private _finishWalls(): void {
    this._draftStartId = '';
    this._draftShellStart = null;
    this._deleteArmed = false;
    this._mode = 'select';
  }

  private _finishRoom(): void {
    if (!isValidSimplePolygon(this._draftRoomPoints)) {
      this._roomDraftError = 'Room corners must form one simple, non-crossing floor shape.';
      return;
    }
    const floor = this._draftRoomPoints.map((point): [number, number] => [point[0], point[1]]);
    this._draftRoomPoints = [];
    this._roomDraftError = '';
    this._mode = 'select';
    this.dispatchEvent(new CustomEvent('spatial-room-created', {
      detail: { floor }, bubbles: true, composed: true,
    }));
  }

  private _cancelRoom(): void {
    this._draftRoomPoints = [];
    this._roomDraftError = '';
    this._mode = 'select';
  }

  private _requestDeleteWall(): void {
    if (!this.selectedWallId) return;
    if (!this._deleteArmed) {
      this._deleteArmed = true;
      return;
    }
    const wallId = this.selectedWallId;
    this._deleteArmed = false;
    this.selectedWallId = '';
    this.selectedOpeningId = '';
    this.dispatchEvent(new CustomEvent('spatial-wall-delete-requested', {
      detail: { wallId }, bubbles: true, composed: true,
    }));
  }

  private _snapShellPoint(point: { x: number; z: number }): [number, number] {
    const tolerance = Math.max(0.12, 0.24 / this._zoom);
    const nearest = this._shellControlPoints().reduce<{ point: [number, number]; distance: number } | null>((best, candidate) => {
      const distance = Math.hypot(point.x - candidate[0], point.z - candidate[1]);
      return !best || distance < best.distance ? { point: candidate, distance } : best;
    }, null);
    return nearest && nearest.distance <= tolerance
      ? [nearest.point[0], nearest.point[1]]
      : [point.x, point.z];
  }

  private _onCanvasPointerDown(event: PointerEvent): void {
    event.preventDefault();
    if (this._mode === 'pan' || event.button === 1) {
      this._startViewportGesture(event);
      return;
    }
    if (this.editScope === 'rooms' && this._mode === 'room' && event.button === 0) {
      const point = this._point(event);
      if (!point) return;
      const snapped = snapSpatialPoint(point, 0.01);
      this._draftRoomPoints = [...this._draftRoomPoints, [snapped.x, snapped.z]];
      this._roomDraftError = '';
      return;
    }
    if (this.editScope !== 'structure' || this._mode !== 'wall' || event.button !== 0) return;
    const point = this._point(event);
    if (!point) return;
    this._deleteArmed = false;
    if (this.shell) {
      const shellPoint = this._snapShellPoint(point);
      if (!this._draftShellStart) {
        this._draftShellStart = shellPoint;
        return;
      }
      const before = this.shell.walls?.length ?? 0;
      const nextShell = addShellWall(this.shell, this._draftShellStart, shellPoint);
      this._draftShellStart = shellPoint;
      if ((nextShell.walls?.length ?? 0) > before) {
        const wall = nextShell.walls!.at(-1)!;
        this.selectedWallId = `shell:${wall.id}:0`;
      }
      this._commitShell(nextShell);
      return;
    }
    let nextPlan = this.plan;
    let vertex = nearestSpatialVertex(nextPlan, point, 0.22);
    if (!vertex) {
      const added = addSpatialVertex(nextPlan, point);
      nextPlan = added.plan;
      vertex = added.vertex;
    }
    if (!this._draftStartId) {
      this._draftStartId = vertex.id;
      this.selectedVertexId = vertex.id;
      this._commit(nextPlan);
      return;
    }
    const before = nextPlan.walls.length;
    nextPlan = addSpatialWall(nextPlan, this._draftStartId, vertex.id);
    this._draftStartId = vertex.id;
    this.selectedVertexId = vertex.id;
    if (nextPlan.walls.length > before) this.selectedWallId = nextPlan.walls[nextPlan.walls.length - 1].id;
    this._commit(nextPlan);
  }

  private _selectWall(event: Event, wallId: string): void {
    if (this._mode !== 'select') return;
    event.preventDefault();
    event.stopPropagation();
    this._deleteArmed = false;
    this.selectedWallId = wallId;
    this.selectedRoomId = '';
    this.selectedOpeningId = '';
    this.selectedVertexId = '';
    this.selectedElementId = '';
    this.selectedEntityId = '';
    this._selectedShellPoint = null;
    this.dispatchEvent(new CustomEvent('spatial-wall-selected', { detail: { wallId }, bubbles: true, composed: true }));
  }

  private _selectShellWall(event: Event, wallId: string): void {
    if (this._mode !== 'select') return;
    event.preventDefault();
    event.stopPropagation();
    this._deleteArmed = false;
    this.selectedWallId = wallId;
    this.selectedRoomId = '';
    this.selectedOpeningId = '';
    this.selectedElementId = '';
    this.selectedVertexId = '';
    this.selectedEntityId = '';
    this._selectedShellPoint = null;
    this.dispatchEvent(new CustomEvent('spatial-wall-selected', { detail: { wallId }, bubbles: true, composed: true }));
  }

  private _selectShellOpening(event: Event, openingId: string, wallId: string): void {
    if (this._mode !== 'select') return;
    event.preventDefault();
    event.stopPropagation();
    this.selectedOpeningId = openingId;
    this._selectedOpeningKind = 'shell';
    this.selectedWallId = wallId;
    this.selectedRoomId = '';
    this.selectedElementId = '';
    this.selectedVertexId = '';
    this.selectedEntityId = '';
    this._selectedShellPoint = null;
    this.dispatchEvent(new CustomEvent('spatial-opening-selected', {
      detail: { id: openingId, wallId }, bubbles: true, composed: true,
    }));
  }

  private _selectPlanOpening(event: Event, openingId: string, wallId: string): void {
    if (this._mode !== 'select') return;
    event.preventDefault();
    event.stopPropagation();
    this.selectedOpeningId = openingId;
    this._selectedOpeningKind = 'plan';
    this.selectedWallId = wallId;
    this.selectedRoomId = '';
    this.selectedElementId = '';
    this.selectedVertexId = '';
    this.selectedEntityId = '';
    this._selectedShellPoint = null;
    this.dispatchEvent(new CustomEvent('spatial-opening-selected', {
      detail: { id: openingId, wallId }, bubbles: true, composed: true,
    }));
  }

  private _selectWallFromKeyboard(event: KeyboardEvent, wallId: string, shell = false): void {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    if (shell) this._selectShellWall(event, wallId);
    else this._selectWall(event, wallId);
  }

  private _openingKeyDown(event: KeyboardEvent, openingId: string, wallId: string, shell: boolean): void {
    if (ARROW_MOVEMENT[event.key]) {
      if (this.selectedOpeningId !== openingId) {
        this.selectedOpeningId = openingId;
        this._selectedOpeningKind = shell ? 'shell' : 'plan';
        this.selectedWallId = wallId;
        this.selectedRoomId = '';
        this.selectedElementId = '';
        this.selectedVertexId = '';
        this.selectedEntityId = '';
        this._selectedShellPoint = null;
        this.dispatchEvent(new CustomEvent('spatial-opening-selected', {
          detail: { id: openingId, wallId }, bubbles: true, composed: true,
        }));
      }
      this._nudgeOpening(event, openingId, shell ? 'shell' : 'plan');
      return;
    }
    this._activateFromKeyboard(event, () => {
      if (shell) this._selectShellOpening(event, openingId, wallId);
      else this._selectPlanOpening(event, openingId, wallId);
    });
  }

  private _selectRoom(event: Event, roomId: string): void {
    if (this._mode !== 'select') return;
    event.preventDefault();
    event.stopPropagation();
    this.selectedRoomId = roomId;
    this.selectedWallId = '';
    this.selectedOpeningId = '';
    this.selectedElementId = '';
    this.selectedVertexId = '';
    this.selectedEntityId = '';
    this._selectedShellPoint = null;
    this._selectedRoomPoint = null;
    this._selectedShellRoomPoint = null;
    this.dispatchEvent(new CustomEvent('spatial-room-selected', {
      detail: { roomId }, bubbles: true, composed: true,
    }));
  }

  private _activateFromKeyboard(event: KeyboardEvent, action: () => void): void {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    event.stopPropagation();
    action();
  }

  private _selectElementFromKeyboard(event: KeyboardEvent, elementId: string): void {
    if (ARROW_MOVEMENT[event.key]) {
      if (this.selectedElementId !== elementId) {
        this.selectedElementId = elementId;
        this.selectedRoomId = '';
        this.selectedOpeningId = '';
        this.selectedWallId = '';
        this.selectedVertexId = '';
        this.selectedEntityId = '';
        this._selectedShellPoint = null;
        this.dispatchEvent(new CustomEvent('spatial-element-selected', { detail: { elementId }, bubbles: true, composed: true }));
      }
      this._nudgeElement(event, elementId);
      return;
    }
    this._activateFromKeyboard(event, () => {
      this.selectedElementId = elementId;
      this.selectedRoomId = '';
      this.selectedOpeningId = '';
      this.selectedWallId = '';
      this.selectedVertexId = '';
      this.selectedEntityId = '';
      this._selectedShellPoint = null;
      this.dispatchEvent(new CustomEvent('spatial-element-selected', { detail: { elementId }, bubbles: true, composed: true }));
    });
  }

  private _selectEntityFromKeyboard(event: KeyboardEvent, entityId: string): void {
    if (ARROW_MOVEMENT[event.key]) {
      if (this.selectedEntityId !== entityId) {
        this.selectedElementId = '';
        this.selectedRoomId = '';
        this.selectedOpeningId = '';
        this.selectedWallId = '';
        this.selectedVertexId = '';
        this.selectedEntityId = entityId;
        this._selectedShellPoint = null;
        this.dispatchEvent(new CustomEvent('spatial-entity-selected', { detail: { entityId }, bubbles: true, composed: true }));
      }
      this._nudgeEntity(event, entityId);
      return;
    }
    this._activateFromKeyboard(event, () => {
      this.selectedElementId = '';
      this.selectedRoomId = '';
      this.selectedOpeningId = '';
      this.selectedWallId = '';
      this.selectedVertexId = '';
      this.selectedEntityId = entityId;
      this._selectedShellPoint = null;
      this.dispatchEvent(new CustomEvent('spatial-entity-selected', { detail: { entityId }, bubbles: true, composed: true }));
    });
  }

  private _nudgeStep(event: KeyboardEvent): number {
    if (event.altKey) return NUDGE_FINE_STEP_METERS;
    if (event.shiftKey) return NUDGE_COARSE_STEP_METERS;
    return NUDGE_STEP_METERS;
  }

  private _addMeters(value: number, delta: number): number {
    return Number((value + delta).toFixed(9));
  }

  private _preciseMeter(value: number): number {
    return Number(value.toFixed(9));
  }

  private _consumeArrow(event: KeyboardEvent): PlanMovement | null {
    const direction = ARROW_MOVEMENT[event.key];
    if (!direction) return null;
    event.preventDefault();
    event.stopPropagation();
    return direction;
  }

  private _nudgeVertex(event: KeyboardEvent, vertexId: string): void {
    const direction = this._consumeArrow(event);
    if (!direction) return;
    const vertex = this.plan.vertices.find((candidate) => candidate.id === vertexId);
    if (!vertex) return;
    const step = this._nudgeStep(event);
    this._commit(moveSpatialVertex(this.plan, vertexId, {
      x: this._addMeters(vertex.x, direction[0] * step),
      z: this._addMeters(vertex.z, direction[1] * step),
    }));
  }

  private _nudgeShellPoint(event: KeyboardEvent, point: [number, number]): void {
    const direction = this._consumeArrow(event);
    if (!direction || !this.shell) return;
    const step = this._nudgeStep(event);
    const next: [number, number] = [
      this._addMeters(point[0], direction[0] * step),
      this._addMeters(point[1], direction[1] * step),
    ];
    this._selectedShellPoint = next;
    this._commitShell(moveShellPoint(this.shell, point, next));
  }

  private _moveRoomPoint(plan: SpatialPlan, selection: { roomId: string; index: number }, point: { x: number; z: number }): SpatialPlan {
    const next = {
      ...plan,
      rooms: plan.rooms.map((room) => room.id === selection.roomId && room.floor
        ? { ...room, floor: room.floor.map((candidate, index): [number, number] => index === selection.index ? [point.x, point.z] : candidate) }
        : room),
    };
    const floor = next.rooms.find((room) => room.id === selection.roomId)?.floor;
    return floor && isValidSimplePolygon(floor) ? next : plan;
  }

  private _nudgeRoomPoint(event: KeyboardEvent, selection: { roomId: string; index: number }): void {
    const direction = this._consumeArrow(event);
    if (!direction) return;
    const point = this.plan.rooms.find((room) => room.id === selection.roomId)?.floor?.[selection.index];
    if (!point) return;
    const step = this._nudgeStep(event);
    const next = {
      x: this._addMeters(point[0], direction[0] * step),
      z: this._addMeters(point[1], direction[1] * step),
    };
    this._selectedRoomPoint = selection;
    this._commit(this._moveRoomPoint(this.plan, selection, next));
  }

  private _moveShellRoomPoint(
    shell: SpatialShellConfig,
    selection: { zoneId: string; floorIndex: number; pointIndex: number },
    point: { x: number; z: number },
  ): SpatialShellConfig {
    const next: SpatialShellConfig = {
      ...shell,
      rooms: shell.rooms?.map((room) => {
        if (room.zoneId !== selection.zoneId) return room;
        const floors = [room.floor, ...(room.floors ?? [])].map((floor, floorIndex) => floor.map((candidate, pointIndex): [number, number] =>
          floorIndex === selection.floorIndex && pointIndex === selection.pointIndex ? [point.x, point.z] : candidate));
        return { ...room, floor: floors[0], ...(floors.length > 1 ? { floors: floors.slice(1) } : { floors: undefined }) };
      }),
    };
    const room = next.rooms?.find((candidate) => candidate.zoneId === selection.zoneId);
    const floor = room ? [room.floor, ...(room.floors ?? [])][selection.floorIndex] : undefined;
    return floor && isValidSimplePolygon(floor) ? reconcileShellWallZones(next) : shell;
  }

  private _nudgeShellRoomPoint(
    event: KeyboardEvent,
    selection: { zoneId: string; floorIndex: number; pointIndex: number },
  ): void {
    const direction = this._consumeArrow(event);
    if (!direction || !this.shell) return;
    const room = this.shell.rooms?.find((candidate) => candidate.zoneId === selection.zoneId);
    const point = [room?.floor, ...(room?.floors ?? [])][selection.floorIndex]?.[selection.pointIndex];
    if (!point) return;
    const step = this._nudgeStep(event);
    const next = {
      x: this._addMeters(point[0], direction[0] * step),
      z: this._addMeters(point[1], direction[1] * step),
    };
    this._selectedShellRoomPoint = selection;
    this._commitShell(this._moveShellRoomPoint(this.shell, selection, next));
  }

  private _nudgeElement(event: KeyboardEvent, elementId: string): void {
    const direction = this._consumeArrow(event);
    if (!direction) return;
    const element = this.plan.elements.find((candidate) => candidate.id === elementId);
    if (!element) return;
    const step = this._nudgeStep(event);
    this._commit(updateSpatialElement(this.plan, elementId, { position: {
      ...element.position,
      x: this._addMeters(element.position.x, direction[0] * step),
      z: this._addMeters(element.position.z, direction[1] * step),
    } }));
  }

  private _nudgeEntity(event: KeyboardEvent, entityId: string): void {
    const direction = this._consumeArrow(event);
    if (!direction) return;
    const entity = this.entities.find((candidate) => candidate.entity === entityId);
    if (!entity?.spatial) return;
    const step = this._nudgeStep(event);
    const point = {
      x: this._addMeters(entity.spatial.position.x, direction[0] * step),
      z: this._addMeters(entity.spatial.position.z, direction[1] * step),
    };
    this.dispatchEvent(new CustomEvent('spatial-entity-moved', {
      detail: { entityId, point, record: true }, bubbles: true, composed: true,
    }));
  }

  private _nudgeOpening(event: KeyboardEvent, openingId: string, kind: 'plan' | 'shell' | '' = ''): void {
    if (!ARROW_MOVEMENT[event.key]) return;
    event.preventDefault();
    event.stopPropagation();
    const direction = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
    const step = this._nudgeStep(event) * direction;
    const openingKind = kind || this._openingKindForId(openingId);
    if (openingKind === 'shell' && this.shell) {
      const assignment = assignShellOpenings(this.shell).find((candidate) => candidate.opening.id === openingId);
      if (!assignment) return;
      const halfWidth = Math.min(assignment.opening.width, assignment.segment.length) / 2;
      const along = Math.min(assignment.segment.length - halfWidth, Math.max(halfWidth, assignment.along + step));
      const ratio = assignment.segment.length > 0 ? along / assignment.segment.length : 0.5;
      const opening: SpatialShellOpening = {
        ...assignment.opening,
        x: this._preciseMeter(assignment.segment.start[0] + (assignment.segment.end[0] - assignment.segment.start[0]) * ratio),
        z: this._preciseMeter(assignment.segment.start[1] + (assignment.segment.end[1] - assignment.segment.start[1]) * ratio),
        rotation: assignment.segment.rotation,
        depth: assignment.segment.thickness,
      };
      this._commitShell({ ...this.shell, openings: this.shell.openings.map((candidate) => candidate.id === openingId ? opening : candidate) });
      return;
    }
    const opening = this.openings.find((candidate) => candidate.id === openingId);
    const wall = this.plan.walls.find((candidate) => candidate.id === opening?.wallId);
    const vertices = new Map(this.plan.vertices.map((vertex) => [vertex.id, vertex]));
    const length = wall ? wallLength(wall, vertices) : 0;
    if (!opening || length <= 0) return;
    const width = Math.min(0.98, Math.max(0.01, opening.widthMeters ? opening.widthMeters / length : opening.width));
    const position = Math.min(1 - width / 2, Math.max(width / 2, opening.position + step / length));
    this.openings = this.openings.map((candidate) => candidate.id === openingId ? { ...candidate, position } : candidate);
    this.dispatchEvent(new CustomEvent('spatial-opening-moved', {
      detail: { openingId, position, record: true }, bubbles: true, composed: true,
    }));
  }

  private _startVertexDrag(event: PointerEvent, vertexId: string): void {
    if (this._mode !== 'select' || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    this._dragVertexId = vertexId;
    this._dragMoved = false;
    this.selectedVertexId = vertexId;
    this.selectedWallId = '';
    this.selectedElementId = '';
    this.selectedOpeningId = '';
    this.selectedEntityId = '';
    this._selectedShellPoint = null;
    (event.currentTarget as SVGCircleElement).setPointerCapture(event.pointerId);
    this._focusCanvas(event);
    this.dispatchEvent(new CustomEvent('spatial-vertex-selected', { detail: { vertexId }, bubbles: true, composed: true }));
  }

  private _focusCanvas(event: Event): void {
    const target = event.currentTarget as SVGElement | null;
    const canvas = target?.ownerSVGElement ?? (target?.localName === 'svg' ? target as SVGSVGElement : null);
    canvas?.focus({ preventScroll: true });
  }

  private _hasObjectDrag(): boolean {
    return Boolean(this._dragVertexId || this._dragElementId || this._dragEntityId || this._dragOpeningId || this._dragShellPoint || this._dragRoomPoint || this._dragShellRoomPoint);
  }

  private _projectPlanOpening(openingId: string, point: { x: number; z: number }): void {
    const openings = this._dragOpenings ?? this.openings;
    const opening = openings.find((candidate) => candidate.id === openingId);
    const wall = this.plan.walls.find((candidate) => candidate.id === opening?.wallId);
    const start = wall ? this.plan.vertices.find((candidate) => candidate.id === wall.start) : undefined;
    const end = wall ? this.plan.vertices.find((candidate) => candidate.id === wall.end) : undefined;
    if (!opening || !start || !end) return;
    const dx = end.x - start.x;
    const dz = end.z - start.z;
    const length = Math.hypot(dx, dz);
    if (length <= 0) return;
    const along = ((point.x - start.x) * dx + (point.z - start.z) * dz) / (length * length);
    const width = Math.min(0.98, Math.max(0.01, opening.widthMeters ? opening.widthMeters / length : opening.width));
    const position = Math.min(1 - width / 2, Math.max(width / 2, along));
    this._dragOpenings = openings.map((candidate) => candidate.id === openingId ? { ...candidate, position } : candidate);
  }

  private _projectShellOpening(openingId: string, point: { x: number; z: number }): void {
    const shell = this._dragShell ?? this.shell;
    if (!shell) return;
    const assignment = assignShellOpenings(shell).find((candidate) => candidate.opening.id === openingId);
    if (!assignment) return;
    const dx = assignment.segment.end[0] - assignment.segment.start[0];
    const dz = assignment.segment.end[1] - assignment.segment.start[1];
    const length = assignment.segment.length;
    const projected = ((point.x - assignment.segment.start[0]) * dx + (point.z - assignment.segment.start[1]) * dz) / length;
    const halfWidth = Math.min(assignment.opening.width, length) / 2;
    const along = Math.min(length - halfWidth, Math.max(halfWidth, projected));
    const ratio = length > 0 ? along / length : 0.5;
    const opening: SpatialShellOpening = {
      ...assignment.opening,
      x: assignment.segment.start[0] + dx * ratio,
      z: assignment.segment.start[1] + dz * ratio,
      rotation: assignment.segment.rotation,
      depth: assignment.segment.thickness,
    };
    this._dragShell = { ...shell, openings: shell.openings.map((candidate) => candidate.id === openingId ? opening : candidate) };
  }

  private _applyPendingDrag(): void {
    this._dragFrame = 0;
    const point = this._pendingDragPoint;
    this._pendingDragPoint = null;
    if (!point || !this._hasObjectDrag()) return;
    this._dragMoved = true;
    const shell = this._dragShell ?? this.shell;
    const plan = this._dragPlan ?? this.plan;
    if (this._dragShellRoomPoint && shell) {
      this._dragShell = this._moveShellRoomPoint(shell, this._dragShellRoomPoint, point);
    } else if (this._dragShellPoint && shell) {
      const next: [number, number] = [point.x, point.z];
      this._dragShell = moveShellPoint(shell, this._dragShellPoint, next);
      this._dragShellPoint = next;
      this._selectedShellPoint = next;
      this._dragShellPointKey = `${next[0].toFixed(3)}:${next[1].toFixed(3)}`;
    } else if (this._dragRoomPoint) {
      this._dragPlan = this._moveRoomPoint(plan, this._dragRoomPoint, point);
    } else if (this._dragVertexId) {
      this._dragPlan = moveSpatialVertex(plan, this._dragVertexId, point);
    } else if (this._dragElementId) {
      const element = plan.elements.find((item) => item.id === this._dragElementId);
      if (element) this._dragPlan = updateSpatialElement(plan, element.id, { position: { ...element.position, x: point.x, z: point.z } });
    } else if (this._dragOpeningId && this._dragOpeningKind === 'shell') {
      this._projectShellOpening(this._dragOpeningId, point);
    } else if (this._dragOpeningId) {
      this._projectPlanOpening(this._dragOpeningId, point);
    } else if (this._dragEntityId) {
      this._dragEntityPoint = point;
    }
    this.requestUpdate();
  }

  private _dragVertex(event: PointerEvent): void {
    if (!this._hasObjectDrag()) return;
    const point = this._point(event);
    if (!point) return;
    this._pendingDragPoint = point;
    if (!this._dragFrame) this._dragFrame = requestAnimationFrame(() => this._applyPendingDrag());
  }

  private _onCanvasPointerMove(event: PointerEvent): void {
    if (this._moveViewportGesture(event)) return;
    this._dragVertex(event);
  }

  private _onCanvasPointerUp(event: PointerEvent): void {
    if (this._endViewportGesture(event)) return;
    this._endVertexDrag();
  }

  private _onCanvasPointerCancel(event: PointerEvent): void {
    if (this._endViewportGesture(event)) return;
    this._cancelObjectDrag();
  }

  private _clearObjectDrag(): void {
    this._dragVertexId = '';
    this._dragElementId = '';
    this._dragEntityId = '';
    this._dragOpeningId = '';
    this._dragOpeningKind = '';
    this._dragEntityPoint = null;
    this._pendingDragPoint = null;
    this._dragPlan = null;
    this._dragShell = null;
    this._dragOpenings = null;
    this._dragShellPoint = null;
    this._dragRoomPoint = null;
    this._dragShellRoomPoint = null;
    this._dragShellPointKey = '';
    this._dragMoved = false;
  }

  private _cancelObjectDrag(): void {
    if (this._dragFrame) cancelAnimationFrame(this._dragFrame);
    this._dragFrame = 0;
    if (this._dragShellPoint) this._selectedShellPoint = null;
    this._clearObjectDrag();
    this.requestUpdate();
  }

  private _endVertexDrag(): void {
    if (!this._hasObjectDrag()) return;
    if (this._dragFrame) cancelAnimationFrame(this._dragFrame);
    this._dragFrame = 0;
    this._applyPendingDrag();
    if (this._dragMoved && this._dragEntityId && this._dragEntityPoint) {
      this.dispatchEvent(new CustomEvent('spatial-entity-moved', {
        detail: { entityId: this._dragEntityId, point: this._dragEntityPoint, record: true }, bubbles: true, composed: true,
      }));
    } else if (this._dragMoved && this._dragOpeningId && this._dragOpeningKind === 'plan') {
      const opening = this._dragOpenings?.find((candidate) => candidate.id === this._dragOpeningId);
      if (opening) this.dispatchEvent(new CustomEvent('spatial-opening-moved', {
        detail: { openingId: opening.id, position: opening.position, record: true }, bubbles: true, composed: true,
      }));
    } else if (this._dragMoved && (this._dragShellPoint || this._dragShellRoomPoint || this._dragOpeningKind === 'shell') && this._dragShell) {
      this._commitShell(this._dragShell, true);
    } else if (this._dragMoved && this._dragPlan) this._commit(this._dragPlan, true);
    this._clearObjectDrag();
  }

  private _startShellPointDrag(event: PointerEvent, point: [number, number]): void {
    if (this._mode !== 'select' || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    this._dragShellPoint = [point[0], point[1]];
    this._selectedShellPoint = [point[0], point[1]];
    this._dragShellPointKey = `${point[0].toFixed(3)}:${point[1].toFixed(3)}`;
    this._dragMoved = false;
    this.selectedWallId = '';
    this.selectedOpeningId = '';
    this.selectedVertexId = '';
    this.selectedElementId = '';
    this.selectedEntityId = '';
    (event.currentTarget as SVGCircleElement).setPointerCapture(event.pointerId);
    this._focusCanvas(event);
  }

  private _startRoomPointDrag(event: PointerEvent, roomId: string, index: number): void {
    if (this._mode !== 'select' || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    this._dragRoomPoint = { roomId, index };
    this._selectedRoomPoint = { roomId, index };
    this._dragMoved = false;
    this.selectedRoomId = roomId;
    this.selectedWallId = '';
    this.selectedOpeningId = '';
    this.selectedVertexId = '';
    this.selectedElementId = '';
    this.selectedEntityId = '';
    this._selectedShellPoint = null;
    (event.currentTarget as SVGCircleElement).setPointerCapture(event.pointerId);
    this._focusCanvas(event);
    this.dispatchEvent(new CustomEvent('spatial-room-selected', {
      detail: { roomId }, bubbles: true, composed: true,
    }));
  }

  private _startShellRoomPointDrag(
    event: PointerEvent,
    zoneId: string,
    floorIndex: number,
    pointIndex: number,
  ): void {
    if (this._mode !== 'select' || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    this._dragShellRoomPoint = { zoneId, floorIndex, pointIndex };
    this._selectedShellRoomPoint = { zoneId, floorIndex, pointIndex };
    this._dragMoved = false;
    this.selectedRoomId = `survey:${zoneId}`;
    this.selectedWallId = '';
    this.selectedOpeningId = '';
    this.selectedVertexId = '';
    this.selectedElementId = '';
    this.selectedEntityId = '';
    this._selectedShellPoint = null;
    this._selectedRoomPoint = null;
    (event.currentTarget as SVGCircleElement).setPointerCapture(event.pointerId);
    this._focusCanvas(event);
    this.dispatchEvent(new CustomEvent('spatial-room-selected', {
      detail: { roomId: `survey:${zoneId}` }, bubbles: true, composed: true,
    }));
  }

  private _shellControlPoints(shell = this._dragShell ?? this.shell): [number, number][] {
    const points = shell ? [
      ...(shell.walls?.flatMap((wall) => wall.points) ?? []),
      ...shell.outer,
      ...shell.floor,
      ...(shell.floors?.flat() ?? []),
      ...shell.holes.flat(),
    ] : [];
    const unique = new Map<string, [number, number]>();
    points.forEach((point) => unique.set(`${point[0].toFixed(3)}:${point[1].toFixed(3)}`, point));
    return [...unique.values()];
  }

  private _roomVertexIds(): Set<string> {
    const walls = new Map(this.plan.walls.map((wall) => [wall.id, wall]));
    return new Set(this.plan.rooms.flatMap((room) => room.boundary.flatMap((edge) => {
      const wall = walls.get(edge.wallId);
      return wall ? [wall.start, wall.end] : [];
    })));
  }

  private _openingKindForId(openingId: string): 'plan' | 'shell' | '' {
    if (!openingId) return '';
    const planMatch = this.openings.some((opening) => opening.id === openingId);
    const shellMatch = Boolean(this.shell && assignShellOpenings(this.shell).some(({ opening }) => opening.id === openingId));
    if (planMatch && !shellMatch) return 'plan';
    if (shellMatch && !planMatch) return 'shell';
    return this._selectedOpeningKind;
  }

  private _startEntityDrag(event: PointerEvent, entityId: string): void {
    if (this._mode !== 'select' || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    this._dragEntityId = entityId;
    this._dragMoved = false;
    this.selectedElementId = '';
    this.selectedWallId = '';
    this.selectedOpeningId = '';
    this.selectedRoomId = '';
    this.selectedVertexId = '';
    this.selectedEntityId = entityId;
    this._selectedShellPoint = null;
    (event.currentTarget as SVGCircleElement).setPointerCapture(event.pointerId);
    this._focusCanvas(event);
    this.dispatchEvent(new CustomEvent('spatial-entity-selected', { detail: { entityId }, bubbles: true, composed: true }));
  }

  private _startElementDrag(event: PointerEvent, elementId: string): void {
    if (this._mode !== 'select' || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    this._dragElementId = elementId;
    this._dragMoved = false;
    this.selectedElementId = elementId;
    this.selectedWallId = '';
    this.selectedOpeningId = '';
    this.selectedRoomId = '';
    this.selectedVertexId = '';
    this.selectedEntityId = '';
    this._selectedShellPoint = null;
    (event.currentTarget as SVGGElement).setPointerCapture(event.pointerId);
    this._focusCanvas(event);
    this.dispatchEvent(new CustomEvent('spatial-element-selected', { detail: { elementId }, bubbles: true, composed: true }));
  }

  private _startPlanOpeningDrag(event: PointerEvent, openingId: string, wallId: string): void {
    if (this._mode !== 'select' || event.button !== 0) return;
    this._selectPlanOpening(event, openingId, wallId);
    this._dragOpeningId = openingId;
    this._dragOpeningKind = 'plan';
    this._dragMoved = false;
    (event.currentTarget as SVGLineElement).setPointerCapture(event.pointerId);
    this._focusCanvas(event);
  }

  private _startShellOpeningDrag(event: PointerEvent, openingId: string, wallId: string): void {
    if (this._mode !== 'select' || event.button !== 0) return;
    this._selectShellOpening(event, openingId, wallId);
    this._dragOpeningId = openingId;
    this._dragOpeningKind = 'shell';
    this._dragMoved = false;
    (event.currentTarget as SVGLineElement).setPointerCapture(event.pointerId);
    this._focusCanvas(event);
  }

  private _elementFootprint(item: SpatialElement): { width: number; depth: number } {
    if (item.type === 'glb' && item.glb) {
      return {
        width: Math.max(0.08, item.glb.size.x * item.scale.x),
        depth: Math.max(0.08, item.glb.size.z * item.scale.z),
      };
    }
    const bounds = item.primitives.reduce((result, primitive) => ({
      minX: Math.min(result.minX, primitive.position.x - primitive.size.x / 2),
      maxX: Math.max(result.maxX, primitive.position.x + primitive.size.x / 2),
      minZ: Math.min(result.minZ, primitive.position.z - primitive.size.z / 2),
      maxZ: Math.max(result.maxZ, primitive.position.z + primitive.size.z / 2),
    }), { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity });
    const width = Number.isFinite(bounds.maxX - bounds.minX) ? bounds.maxX - bounds.minX : 0.5;
    const depth = Number.isFinite(bounds.maxZ - bounds.minZ) ? bounds.maxZ - bounds.minZ : 0.5;
    return { width: Math.max(0.08, width * item.scale.x), depth: Math.max(0.08, depth * item.scale.z) };
  }

  private _wallPath(wall: SpatialWallSegment, vertices: Map<string, SpatialVertex>): string {
    const start = vertices.get(wall.start);
    const end = vertices.get(wall.end);
    if (!start || !end) return '';
    if (Math.abs(wall.curve) < 0.01) return `M ${start.x} ${start.z} L ${end.x} ${end.z}`;
    const dx = end.x - start.x;
    const dz = end.z - start.z;
    const length = Math.hypot(dx, dz) || 1;
    const bend = wall.curve * length * 0.76;
    const controlX = (start.x + end.x) / 2 - dz / length * bend;
    const controlZ = (start.z + end.z) / 2 + dx / length * bend;
    return `M ${start.x} ${start.z} Q ${controlX} ${controlZ} ${end.x} ${end.z}`;
  }

  private _openingLine(opening: OpeningConfig, wall: SpatialWallSegment, vertices: Map<string, SpatialVertex>) {
    const start = vertices.get(wall.start);
    const end = vertices.get(wall.end);
    if (!start || !end) return null;
    const dx = end.x - start.x;
    const dz = end.z - start.z;
    const length = Math.hypot(dx, dz) || 1;
    const centerX = start.x + dx * opening.position;
    const centerZ = start.z + dz * opening.position;
    const width = Math.min(length, opening.widthMeters ?? opening.width * length);
    const ux = dx / length;
    const uz = dz / length;
    return {
      x1: centerX - ux * width / 2,
      z1: centerZ - uz * width / 2,
      x2: centerX + ux * width / 2,
      z2: centerZ + uz * width / 2,
    };
  }

  private _keyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      if (this._mode === 'pan') this._setMode('select');
      else if (this._mode === 'room') this._cancelRoom();
      else this._finishWalls();
      return;
    }
    const target = event.composedPath()[0] as Element | undefined;
    const insidePlan = Boolean(target?.closest?.('svg'));
    if (insidePlan && ARROW_MOVEMENT[event.key]) {
      if (this.editScope === 'structure' && this.selectedVertexId) {
        this._nudgeVertex(event, this.selectedVertexId);
      } else if (this.editScope === 'rooms' && this._selectedRoomPoint) {
        this._nudgeRoomPoint(event, this._selectedRoomPoint);
      } else if (this.editScope === 'rooms' && this._selectedShellRoomPoint) {
        this._nudgeShellRoomPoint(event, this._selectedShellRoomPoint);
      } else if (this.editScope === 'rooms' && this.selectedVertexId && this._roomVertexIds().has(this.selectedVertexId)) {
        this._nudgeVertex(event, this.selectedVertexId);
      } else if (this.editScope === 'structure' && this._selectedShellPoint) {
        this._nudgeShellPoint(event, this._selectedShellPoint);
      } else if (this.editScope === 'openings' && this.selectedOpeningId) {
        this._nudgeOpening(event, this.selectedOpeningId);
      } else if (this.editScope === 'elements' && this.selectedElementId) {
        this._nudgeElement(event, this.selectedElementId);
      } else if (this.editScope === 'devices' && this.selectedEntityId) {
        this._nudgeEntity(event, this.selectedEntityId);
      }
      if (event.defaultPrevented) return;
    }
    if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      this._zoomIn();
    } else if (event.key === '-') {
      event.preventDefault();
      this._zoomOut();
    } else if (event.key === '0') {
      event.preventDefault();
      this._fitView();
    }
  }

  protected render() {
    const view = this._viewBox();
    const plan = this._dragPlan ?? this.plan;
    const shell = this._dragShell ?? this.shell;
    const openings = this._dragOpenings ?? this.openings;
    const vertices = new Map(plan.vertices.map((vertex) => [vertex.id, vertex]));
    const walls = new Map(plan.walls.map((wall) => [wall.id, wall]));
    const structureScope = this.editScope === 'structure';
    const roomScope = this.editScope === 'rooms';
    const openingScope = this.editScope === 'openings';
    const elementScope = this.editScope === 'elements';
    const deviceScope = this.editScope === 'devices';
    const roomVertexIds = new Set(plan.rooms.flatMap((room) => room.boundary.flatMap((edge) => {
      const wall = walls.get(edge.wallId);
      return wall ? [wall.start, wall.end] : [];
    })));
    const handleRadius = Math.max(0.09 / this._zoom, view.width / 105);
    const hitWidth = Math.max(0.06, 0.42 / this._zoom);
    const hasDraftWall = structureScope && Boolean(this._draftStartId || this._draftShellStart);
    const hasDraftRoom = roomScope && this._draftRoomPoints.length > 0;
    const hasMovableSelection = Boolean(
      this.selectedVertexId || this._selectedShellPoint || this._selectedRoomPoint || this._selectedShellRoomPoint || this.selectedOpeningId || this.selectedElementId || this.selectedEntityId,
    );
    const scopeHint = structureScope
      ? shell
        ? 'Select a wall to edit it, or drag any corner to reshape the home.'
        : 'Select a wall, or drag a corner to adjust the plan.'
      : roomScope
      ? 'Select a room, or drag a floor corner to refine its boundary.'
      : openingScope
      ? 'Select a door or window, then drag it along its wall.'
      : elementScope
      ? 'Select an Element to edit it, or drag it into position.'
      : deviceScope
      ? 'Select a device marker, or drag it into position.'
      : 'Walls remain visible as architectural context.';
    return html`<div class="editor" @keydown=${this._keyDown}>
      <div class="toolbar">
        <div class="toolbar-row">
          ${structureScope ? html`<div class="mode-group" role="group" aria-label="Drawing mode">
            <button aria-pressed=${this._mode === 'select'} @click=${() => this._setMode('select')}>Select</button>
            <button aria-pressed=${this._mode === 'wall'} @click=${() => this._setMode('wall')}>Draw walls</button>
          </div>` : ''}
          ${roomScope ? html`<div class="mode-group" role="group" aria-label="Room mode">
            <button aria-pressed=${this._mode === 'select'} @click=${() => this._setMode('select')}>Select</button>
            <button aria-pressed=${this._mode === 'room'} @click=${() => this._setMode('room')}>Draw room zone</button>
          </div>` : ''}
          ${this._mode === 'wall' && hasDraftWall ? html`<button class="finish" @click=${this._finishWalls}>Finish walls</button>` : ''}
          ${this._mode === 'room' && hasDraftRoom ? html`
            <button class="finish" ?disabled=${this._draftRoomPoints.length < 3} @click=${this._finishRoom}>Finish room</button>
            <button @click=${this._cancelRoom}>Cancel</button>
          ` : ''}
          ${structureScope && this._mode === 'select' && this.selectedWallId && !this.selectedOpeningId ? html`<button class="delete-wall ${this._deleteArmed ? 'confirm' : ''}"
            @click=${this._requestDeleteWall}>${this._deleteArmed ? 'Confirm delete' : 'Delete wall'}</button>` : ''}
        </div>
        <div class="hint">${roomScope && this._mode === 'room'
          ? this._roomDraftError || (this._draftRoomPoints.length >= 3
            ? 'Tap more corners, or finish the room. No walls are required.'
            : 'Tap at least three corners to draw the room floor.')
          : structureScope && this._mode === 'wall'
          ? hasDraftWall ? 'Tap the next corner. Existing points snap automatically.' : 'Tap where the first wall begins.'
          : hasMovableSelection
          ? 'Drag to place · Arrow keys 1 cm · Shift 10 cm · Option 1 mm'
          : scopeHint}</div>
      </div>
      <div class="canvas">
        <svg
          class=${this._isPanning ? 'panning' : this._mode === 'wall' || this._mode === 'room' ? 'drawing' : this._mode === 'pan' ? 'pan' : ''}
          viewBox=${`${view.x} ${view.z} ${view.width} ${view.depth}`}
          preserveAspectRatio="xMidYMid meet"
          role="application"
          aria-label="Architectural plan editor"
          tabindex="0"
          @pointerdown=${this._onCanvasPointerDown}
          @pointermove=${this._onCanvasPointerMove}
          @pointerup=${this._onCanvasPointerUp}
          @pointercancel=${this._onCanvasPointerCancel}
          @wheel=${this._onWheel}
        >
          <defs>
            <pattern id="minor-grid" width="0.5" height="0.5" patternUnits="userSpaceOnUse">
              <path d="M .5 0 L 0 0 0 .5" fill="none" stroke="rgba(213,229,232,.08)" stroke-width=".012" />
            </pattern>
            <pattern id="major-grid" width="1" height="1" patternUnits="userSpaceOnUse">
              <rect width="1" height="1" fill="url(#minor-grid)" />
              <path d="M 1 0 L 0 0 0 1" fill="none" stroke="rgba(213,229,232,.13)" stroke-width=".016" />
            </pattern>
          </defs>
          <rect x=${view.x} y=${view.z} width=${view.width} height=${view.depth} fill="url(#major-grid)" />
          ${this._draftRoomPoints.length ? svg`
            <polygon class="room draft" points=${this._draftRoomPoints.map(([x, z]) => `${x},${z}`).join(' ')} />
            <polyline class="room-draft-line" points=${this._draftRoomPoints.map(([x, z]) => `${x},${z}`).join(' ')} />
            ${this._draftRoomPoints.map(([x, z]) => svg`<circle class="vertex draft" cx=${x} cy=${z} r=${handleRadius} />`)}
          ` : ''}
          ${roomScope ? shell?.rooms?.map((room) => svg`
            <polygon class="survey-room ${room.finish === 'tile' ? 'tile' : ''} ${this.selectedRoomId === `survey:${room.zoneId}` ? 'selected' : ''}"
              points=${room.floor.map(([x, z]) => `${x},${z}`).join(' ')} role="button" tabindex="0" aria-label=${`Edit room ${room.zoneId}`}
              @pointerdown=${(event: PointerEvent) => this._selectRoom(event, `survey:${room.zoneId}`)}
              @keydown=${(event: KeyboardEvent) => this._activateFromKeyboard(event, () => this._selectRoom(event, `survey:${room.zoneId}`))} />
            ${room.floors?.map((floor) => svg`<polygon class="survey-room ${room.finish === 'tile' ? 'tile' : ''} ${this.selectedRoomId === `survey:${room.zoneId}` ? 'selected' : ''}"
              points=${floor.map(([x, z]) => `${x},${z}`).join(' ')} role="button" tabindex="0" aria-label=${`Edit room ${room.zoneId}`}
              @pointerdown=${(event: PointerEvent) => this._selectRoom(event, `survey:${room.zoneId}`)}
              @keydown=${(event: KeyboardEvent) => this._activateFromKeyboard(event, () => this._selectRoom(event, `survey:${room.zoneId}`))} />`)}
          `) : ''}
          ${shell ? shellSegments(shell).map((segment) => svg`
            <line class="survey-wall ${this.selectedWallId === segment.id ? 'selected' : ''}"
              x1=${segment.start[0]} y1=${segment.start[1]} x2=${segment.end[0]} y2=${segment.end[1]} stroke-width=${segment.thickness} />
            ${structureScope ? svg`<line class="survey-wall-hit" x1=${segment.start[0]} y1=${segment.start[1]} x2=${segment.end[0]} y2=${segment.end[1]}
              stroke-width=${hitWidth}
              role="button" tabindex="0" aria-label=${`Edit wall ${segment.wallIndex + 1}.${segment.segmentIndex + 1}`}
              @pointerdown=${(event: PointerEvent) => this._selectShellWall(event, segment.id)}
              @click=${(event: MouseEvent) => this._selectShellWall(event, segment.id)}
              @keydown=${(event: KeyboardEvent) => this._selectWallFromKeyboard(event, segment.id, true)} />` : ''}
          `) : ''}
          ${shell && openingScope ? assignShellOpenings(shell).map(({ opening, segment }) => {
            const angle = opening.rotation * Math.PI / 180;
            const halfX = Math.cos(angle) * opening.width / 2;
            const halfZ = Math.sin(angle) * opening.width / 2;
            return svg`
              <line class="survey-opening ${this.selectedOpeningId === opening.id ? 'selected' : ''}"
                x1=${opening.x - halfX} y1=${opening.z - halfZ} x2=${opening.x + halfX} y2=${opening.z + halfZ} stroke-width=${Math.max(0.1, opening.depth * 1.15)} />
              <line class="survey-opening-hit" x1=${opening.x - halfX} y1=${opening.z - halfZ} x2=${opening.x + halfX} y2=${opening.z + halfZ}
                stroke-width=${hitWidth} role="button" tabindex="0" aria-label=${`Move ${opening.name ?? `${opening.kind} ${opening.id}`}. Use arrow keys for precise adjustment.`}
                @pointerdown=${(event: PointerEvent) => this._startShellOpeningDrag(event, opening.id, segment.id)}
                @keydown=${(event: KeyboardEvent) => this._openingKeyDown(event, opening.id, segment.id, true)} />
            `;
          }) : ''}
          ${shell && structureScope ? this._shellControlPoints(shell).map((point) => {
            const key = `${point[0].toFixed(3)}:${point[1].toFixed(3)}`;
            return svg`
              <circle class="survey-vertex-hit" cx=${point[0]} cy=${point[1]} r=${handleRadius * 2.6}
                role="button" tabindex="0" aria-label="Move wall corner. Use arrow keys for precise adjustment."
                @pointerdown=${(event: PointerEvent) => this._startShellPointDrag(event, point)}
                @keydown=${(event: KeyboardEvent) => this._nudgeShellPoint(event, point)} />
              <circle class="survey-vertex ${this._dragShellPointKey === key || (this._selectedShellPoint && `${this._selectedShellPoint[0].toFixed(3)}:${this._selectedShellPoint[1].toFixed(3)}` === key) ? 'selected' : ''}"
                cx=${point[0]} cy=${point[1]} r=${handleRadius * 0.82} aria-hidden="true" />
            `;
          }) : ''}
          ${shell && roomScope ? (shell.rooms ?? []).flatMap((room) => [room.floor, ...(room.floors ?? [])].flatMap((floor, floorIndex) =>
            floor.map(([x, z], pointIndex) => svg`
              <circle class="survey-vertex-hit" cx=${x} cy=${z} r=${handleRadius * 2.6}
                role="button" tabindex="0" aria-label="Move room corner. Use arrow keys for precise adjustment."
                @pointerdown=${(event: PointerEvent) => this._startShellRoomPointDrag(event, room.zoneId, floorIndex, pointIndex)}
                @keydown=${(event: KeyboardEvent) => this._nudgeShellRoomPoint(event, { zoneId: room.zoneId, floorIndex, pointIndex })} />
              <circle class="survey-vertex ${this._selectedShellRoomPoint?.zoneId === room.zoneId
                && this._selectedShellRoomPoint.floorIndex === floorIndex
                && this._selectedShellRoomPoint.pointIndex === pointIndex ? 'selected' : ''}"
                cx=${x} cy=${z} r=${handleRadius * 0.82} aria-hidden="true" />
            `))) : ''}
          ${roomScope ? plan.rooms.map((room) => {
            const points = room.floor?.length ? room.floor.map(([x, z]) => `${x},${z}`) : room.boundary.flatMap((edge) => {
              const wall = walls.get(edge.wallId);
              const vertex = wall ? vertices.get(edge.reversed ? wall.end : wall.start) : undefined;
              return vertex ? [`${vertex.x},${vertex.z}`] : [];
            });
            return points.length >= 3 ? svg`<polygon class="room ${this.selectedRoomId === room.id ? 'selected' : ''}"
              points=${points.join(' ')} role="button" tabindex="0" aria-label=${`Edit room ${room.id}`}
              @pointerdown=${(event: PointerEvent) => this._selectRoom(event, room.id)}
              @keydown=${(event: KeyboardEvent) => this._activateFromKeyboard(event, () => this._selectRoom(event, room.id))} />` : '';
          }) : ''}
          ${roomScope ? plan.rooms.flatMap((room) => room.floor?.map(([x, z], index) => svg`
            <circle class="survey-vertex-hit" cx=${x} cy=${z} r=${handleRadius * 2.6}
              role="button" tabindex="0" aria-label="Move room corner. Use arrow keys for precise adjustment."
              @pointerdown=${(event: PointerEvent) => this._startRoomPointDrag(event, room.id, index)}
              @keydown=${(event: KeyboardEvent) => this._nudgeRoomPoint(event, { roomId: room.id, index })} />
            <circle class="survey-vertex ${this._selectedRoomPoint?.roomId === room.id && this._selectedRoomPoint.index === index ? 'selected' : ''}"
              cx=${x} cy=${z} r=${handleRadius * 0.82} aria-hidden="true" />
          `) ?? []) : ''}
          ${plan.walls.map((wall) => {
            const path = this._wallPath(wall, vertices);
            const start = vertices.get(wall.start);
            const end = vertices.get(wall.end);
            const length = wallLength(wall, vertices);
            return svg`
              <path class="wall ${this.selectedWallId === wall.id ? 'selected' : ''}" d=${path} stroke-width=${wall.thickness} />
              ${structureScope ? svg`<path class="wall-hit" d=${path} role="button" tabindex="0" aria-label=${`Edit wall ${plan.walls.indexOf(wall) + 1}`}
                stroke-width=${hitWidth}
                @pointerdown=${(event: PointerEvent) => this._selectWall(event, wall.id)}
                @click=${(event: MouseEvent) => this._selectWall(event, wall.id)}
                @keydown=${(event: KeyboardEvent) => this._selectWallFromKeyboard(event, wall.id)} />` : ''}
              ${structureScope && start && end && length > 0.25 ? svg`<text class="dimension" x=${(start.x + end.x) / 2} y=${(start.z + end.z) / 2 - 0.16}>${length.toFixed(2)} m</text>` : ''}
            `;
          })}
          ${openingScope ? openings.map((opening) => {
            const wall = walls.get(opening.wallId);
            const line = wall ? this._openingLine(opening, wall, vertices) : null;
            return line ? svg`<g><line class="opening ${this.selectedOpeningId === opening.id ? 'selected' : ''}" x1=${line.x1} y1=${line.z1} x2=${line.x2} y2=${line.z2} />
              <line class="opening-hit" x1=${line.x1} y1=${line.z1} x2=${line.x2} y2=${line.z2} stroke-width=${hitWidth}
                role="button" tabindex="0" aria-label=${`Move ${opening.name ?? `${opening.kind} ${opening.id}`}. Use arrow keys for precise adjustment.`}
                @pointerdown=${(event: PointerEvent) => this._startPlanOpeningDrag(event, opening.id, opening.wallId)}
                @keydown=${(event: KeyboardEvent) => this._openingKeyDown(event, opening.id, opening.wallId, false)} /></g>` : '';
          }) : ''}
          ${elementScope ? plan.elements.map((item) => {
            const footprint = this._elementFootprint(item);
            const label = item.name ?? item.type.replace(/(^|[-_])\w/g, (match) => match.replace(/[-_]/, '').toUpperCase());
            return svg`<g
              class="element ${this.selectedElementId === item.id ? 'selected' : ''}"
              transform=${`translate(${item.position.x} ${item.position.z}) rotate(${item.rotation.y})`}
              role="button"
              aria-label=${label}
              tabindex="0"
              @pointerdown=${(event: PointerEvent) => this._startElementDrag(event, item.id)}
              @keydown=${(event: KeyboardEvent) => this._selectElementFromKeyboard(event, item.id)}
            >
              <rect class="element-shape" x=${-footprint.width / 2} y=${-footprint.depth / 2} width=${footprint.width} height=${footprint.depth} rx=".06" />
              <text class="element-label" y=".06">${label}</text>
            </g>`;
          }) : ''}
          ${deviceScope ? this.entities.filter((entity) => entity.spatial?.visible).map((entity) => {
            const dragPoint = this._dragEntityId === entity.entity ? this._dragEntityPoint : null;
            return svg`<circle
            class="entity-marker ${this.selectedEntityId === entity.entity ? 'selected' : ''}"
            cx=${dragPoint?.x ?? entity.spatial!.position.x}
            cy=${dragPoint?.z ?? entity.spatial!.position.z}
            r=${Math.max(0.13, view.width / 72)}
            role="button"
            aria-label=${entity.name ?? entity.entity}
            tabindex="0"
            @pointerdown=${(event: PointerEvent) => this._startEntityDrag(event, entity.entity)}
            @keydown=${(event: KeyboardEvent) => this._selectEntityFromKeyboard(event, entity.entity)}
          />`;
          }) : ''}
          ${(structureScope || roomScope) ? plan.vertices.filter((vertex) => structureScope || roomVertexIds.has(vertex.id)).map((vertex) => svg`<circle
            class="vertex ${this.selectedVertexId === vertex.id ? 'selected' : ''} ${this._draftStartId === vertex.id ? 'draft' : ''}"
            cx=${vertex.x} cy=${vertex.z} r=${handleRadius} role="button" tabindex="0"
            aria-label="Move wall corner. Use arrow keys for precise adjustment."
            @pointerdown=${(event: PointerEvent) => this._startVertexDrag(event, vertex.id)}
            @keydown=${(event: KeyboardEvent) => this._nudgeVertex(event, vertex.id)}
          />`) : ''}
          ${this._draftShellStart ? svg`<circle class="survey-vertex selected"
            cx=${this._draftShellStart[0]} cy=${this._draftShellStart[1]} r=${handleRadius * 0.92} aria-hidden="true" />` : ''}
        </svg>
        <div class="viewport-controls" role="toolbar" aria-label="Plan view controls">
          <button
            class="pan-control"
            aria-label="Pan plan"
            title="Pan plan"
            aria-pressed=${this._mode === 'pan'}
            @click=${() => this._setMode(this._mode === 'pan' ? 'select' : 'pan')}
          ><ha-icon icon="mdi:hand-back-right-outline"></ha-icon></button>
          <button aria-label="Zoom out" title="Zoom out" ?disabled=${this._zoom <= MIN_ZOOM} @click=${this._zoomOut}>
            <ha-icon icon="mdi:magnify-minus-outline"></ha-icon>
          </button>
          <button aria-label="Fit home in view" title="Fit home in view" @click=${this._fitView}>
            <ha-icon icon="mdi:fit-to-screen-outline"></ha-icon>
          </button>
          <button aria-label="Zoom in" title="Zoom in" ?disabled=${this._zoom >= MAX_ZOOM} @click=${this._zoomIn}>
            <ha-icon icon="mdi:magnify-plus-outline"></ha-icon>
          </button>
        </div>
        ${!plan.walls.length && !shell?.walls?.length ? html`<div class="empty"><strong>Draw the shape of your home</strong><span>Choose Draw walls, then tap each corner. Measurements and shared corners stay exact.</span></div>` : ''}
      </div>
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'spatial-plan-editor': SpatialPlanEditor;
  }
}
