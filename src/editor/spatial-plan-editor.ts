import { LitElement, css, html, svg } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { EntityConfig, OpeningConfig, SpatialElement, SpatialPlan, SpatialShellConfig, SpatialVertex, SpatialWallSegment } from '../core/config';
import { spatialBounds, wallLength } from '../core/spatial-geometry';
import { addSpatialVertex, addSpatialWall, emptySpatialPlan, moveSpatialVertex, nearestSpatialVertex, snapSpatialPoint, updateSpatialElement } from '../core/spatial-plan';
import { assignShellOpenings, moveShellPoint, shellSegments } from '../core/spatial-shell';

type PlanEditorMode = 'select' | 'wall' | 'pan';

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
  @state() private _mode: PlanEditorMode = 'select';
  @state() private _draftStartId = '';
  @state() private _dragVertexId = '';
  @state() private _dragElementId = '';
  @state() private _dragEntityId = '';
  @state() private _zoom = MIN_ZOOM;
  @state() private _panX = 0;
  @state() private _panZ = 0;
  @state() private _isPanning = false;
  private _dragShellPoint: [number, number] | null = null;
  @state() private _dragShellPointKey = '';
  private _dragEntityPoint: { x: number; z: number } | null = null;
  @state() private _dragMoved = false;
  private _viewportPointers = new Map<number, { x: number; y: number }>();
  private _viewportGesture: ViewportGesture | null = null;
  private _pinchGesture: PinchGesture | null = null;

  static styles = css`
    :host { display: block; color: #edf2f3; }
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
    .canvas { position: relative; min-height: 420px; aspect-ratio: 16 / 10; }
    svg { display: block; width: 100%; height: 100%; touch-action: none; cursor: default; }
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
    .survey-room { fill: #657474; fill-opacity: 0.2; stroke: transparent; stroke-width: 0.06; cursor: pointer; }
    .survey-room.selected { fill: #8db8c1; fill-opacity: 0.28; stroke: #b8e1e6; }
    .survey-room.tile { fill: #6d7776; fill-opacity: 0.3; }
    .survey-wall { fill: none; stroke: #d8dfdf; stroke-linecap: square; stroke-linejoin: round; pointer-events: none; }
    .survey-wall.selected { stroke: #9dcbd2; }
    .survey-wall-hit { fill: none; stroke: transparent; cursor: pointer; pointer-events: stroke; }
    .survey-vertex-hit { fill: transparent; stroke: none; cursor: grab; pointer-events: all; }
    .survey-vertex { fill: #101617; stroke: #d8dfdf; stroke-width: 0.035; pointer-events: none; }
    .survey-vertex.selected { fill: #b9dce1; stroke: #101617; }
    .survey-opening { stroke: #0c1112; stroke-linecap: butt; pointer-events: none; }
    .survey-opening.selected { stroke: #8ed4df; }
    .survey-opening-hit { stroke: transparent; cursor: pointer; }
    .wall { fill: none; stroke: #d8dfdf; stroke-linecap: square; stroke-linejoin: round; }
    .wall.selected { stroke: #9dcbd2; }
    .wall-hit { fill: none; stroke: transparent; cursor: pointer; pointer-events: stroke; }
    .vertex { fill: #101617; stroke: #d8dfdf; stroke-width: 0.035; cursor: grab; }
    .vertex.selected, .vertex.draft { fill: #b9dce1; stroke: #101617; }
    .opening { stroke: #0c1112; stroke-width: 0.16; stroke-linecap: butt; pointer-events: none; }
    .element { cursor: grab; }
    .element-shape { fill: #879597; fill-opacity: 0.82; stroke: #c8d5d7; stroke-width: 0.025; }
    .element.selected .element-shape { fill: #a9cbd0; stroke: #edf6f7; stroke-width: 0.055; }
    .element-label { display: none; fill: #0b1011; font: 650 0.18px/1 -apple-system, BlinkMacSystemFont, sans-serif; text-anchor: middle; pointer-events: none; }
    .element.selected .element-label { display: block; }
    .entity-marker { fill: #152326; stroke: #a8d9e1; stroke-width: 0.045; cursor: grab; }
    .entity-marker.selected { fill: #b8dce2; stroke: #f2fbfc; }
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
    const bounds = spatialBounds(this.plan);
    const width = Math.max(6, bounds.width + 2);
    const depth = Math.max(5, bounds.depth + 2);
    return {
      x: this.plan.vertices.length ? bounds.minX - 1 : -width / 2,
      z: this.plan.vertices.length ? bounds.minZ - 1 : -depth / 2,
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
    if (mode !== 'wall') this._draftStartId = '';
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
    this.renderRoot.querySelector<SVGSVGElement>('svg')?.focus();
  }

  private _finishWalls(): void {
    this._draftStartId = '';
    this._mode = 'select';
  }

  private _onCanvasPointerDown(event: PointerEvent): void {
    if (this._mode === 'pan' || event.button === 1) {
      this._startViewportGesture(event);
      return;
    }
    if (this._mode !== 'wall' || event.button !== 0) return;
    const point = this._point(event);
    if (!point) return;
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
    event.stopPropagation();
    this.selectedWallId = wallId;
    this.selectedVertexId = '';
    this.selectedElementId = '';
    this.dispatchEvent(new CustomEvent('spatial-wall-selected', { detail: { wallId }, bubbles: true, composed: true }));
  }

  private _selectShellWall(event: Event, wallId: string): void {
    if (this._mode !== 'select') return;
    event.stopPropagation();
    this.selectedWallId = wallId;
    this.selectedOpeningId = '';
    this.selectedElementId = '';
    this.dispatchEvent(new CustomEvent('spatial-wall-selected', { detail: { wallId }, bubbles: true, composed: true }));
  }

  private _selectShellOpening(event: PointerEvent, openingId: string, wallId: string): void {
    if (this._mode !== 'select') return;
    event.stopPropagation();
    this.selectedOpeningId = openingId;
    this.selectedWallId = wallId;
    this.selectedElementId = '';
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

  private _selectRoom(event: PointerEvent, roomId: string): void {
    if (this._mode !== 'select') return;
    event.stopPropagation();
    this.selectedRoomId = roomId;
    this.selectedWallId = '';
    this.selectedOpeningId = '';
    this.selectedElementId = '';
    this.selectedVertexId = '';
    this.dispatchEvent(new CustomEvent('spatial-room-selected', {
      detail: { roomId }, bubbles: true, composed: true,
    }));
  }

  private _startVertexDrag(event: PointerEvent, vertexId: string): void {
    if (this._mode !== 'select' || event.button !== 0) return;
    event.stopPropagation();
    this._dragVertexId = vertexId;
    this._dragMoved = false;
    this.selectedVertexId = vertexId;
    this.selectedWallId = '';
    this.selectedElementId = '';
    (event.currentTarget as SVGCircleElement).setPointerCapture(event.pointerId);
    this.dispatchEvent(new CustomEvent('spatial-vertex-selected', { detail: { vertexId }, bubbles: true, composed: true }));
  }

  private _dragVertex(event: PointerEvent): void {
    if (!this._dragVertexId && !this._dragElementId && !this._dragEntityId && !this._dragShellPoint) return;
    const point = this._point(event);
    if (!point) return;
    this._dragMoved = true;
    if (this._dragShellPoint && this.shell) {
      const next: [number, number] = [point.x, point.z];
      this._commitShell(moveShellPoint(this.shell, this._dragShellPoint, next), false);
      this._dragShellPoint = next;
      this._dragShellPointKey = `${next[0].toFixed(3)}:${next[1].toFixed(3)}`;
    } else if (this._dragVertexId) this._commit(moveSpatialVertex(this.plan, this._dragVertexId, point), false);
    else if (this._dragElementId) {
      const element = this.plan.elements.find((item) => item.id === this._dragElementId);
      if (element) this._commit(updateSpatialElement(this.plan, element.id, { position: { ...element.position, x: point.x, z: point.z } }), false);
    } else {
      this._dragEntityPoint = point;
      this.dispatchEvent(new CustomEvent('spatial-entity-moved', {
        detail: { entityId: this._dragEntityId, point, record: false }, bubbles: true, composed: true,
      }));
    }
  }

  private _onCanvasPointerMove(event: PointerEvent): void {
    if (this._moveViewportGesture(event)) return;
    this._dragVertex(event);
  }

  private _onCanvasPointerUp(event: PointerEvent): void {
    if (this._endViewportGesture(event)) return;
    this._endVertexDrag();
  }

  private _endVertexDrag(): void {
    if (!this._dragVertexId && !this._dragElementId && !this._dragEntityId && !this._dragShellPoint) return;
    if (this._dragMoved && this._dragEntityId && this._dragEntityPoint) {
      this.dispatchEvent(new CustomEvent('spatial-entity-moved', {
        detail: { entityId: this._dragEntityId, point: this._dragEntityPoint, record: true }, bubbles: true, composed: true,
      }));
    } else if (this._dragMoved && this._dragShellPoint) {
      this.dispatchEvent(new CustomEvent('spatial-edit-end', { bubbles: true, composed: true }));
    } else if (this._dragMoved) this._commit(this.plan, true);
    this._dragVertexId = '';
    this._dragElementId = '';
    this._dragEntityId = '';
    this._dragEntityPoint = null;
    this._dragShellPoint = null;
    this._dragShellPointKey = '';
    this._dragMoved = false;
  }

  private _startShellPointDrag(event: PointerEvent, point: [number, number]): void {
    if (this._mode !== 'select' || event.button !== 0) return;
    event.stopPropagation();
    this._dragShellPoint = [point[0], point[1]];
    this._dragShellPointKey = `${point[0].toFixed(3)}:${point[1].toFixed(3)}`;
    this._dragMoved = false;
    this.selectedWallId = '';
    this.selectedOpeningId = '';
    this.dispatchEvent(new CustomEvent('spatial-edit-start', { bubbles: true, composed: true }));
    (event.currentTarget as SVGCircleElement).setPointerCapture(event.pointerId);
  }

  private _shellControlPoints(): [number, number][] {
    const points = this.shell?.walls?.flatMap((wall) => wall.points) ?? [];
    const unique = new Map<string, [number, number]>();
    points.forEach((point) => unique.set(`${point[0].toFixed(3)}:${point[1].toFixed(3)}`, point));
    return [...unique.values()];
  }

  private _startEntityDrag(event: PointerEvent, entityId: string): void {
    if (this._mode !== 'select' || event.button !== 0) return;
    event.stopPropagation();
    this._dragEntityId = entityId;
    this._dragMoved = false;
    this.selectedElementId = '';
    this.selectedWallId = '';
    this.selectedVertexId = '';
    (event.currentTarget as SVGCircleElement).setPointerCapture(event.pointerId);
    this.dispatchEvent(new CustomEvent('spatial-entity-selected', { detail: { entityId }, bubbles: true, composed: true }));
  }

  private _startElementDrag(event: PointerEvent, elementId: string): void {
    if (this._mode !== 'select' || event.button !== 0) return;
    event.stopPropagation();
    this._dragElementId = elementId;
    this._dragMoved = false;
    this.selectedElementId = elementId;
    this.selectedWallId = '';
    this.selectedVertexId = '';
    (event.currentTarget as SVGGElement).setPointerCapture(event.pointerId);
    this.dispatchEvent(new CustomEvent('spatial-element-selected', { detail: { elementId }, bubbles: true, composed: true }));
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
      else this._finishWalls();
      return;
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
    const vertices = new Map(this.plan.vertices.map((vertex) => [vertex.id, vertex]));
    const walls = new Map(this.plan.walls.map((wall) => [wall.id, wall]));
    const handleRadius = Math.max(0.09 / this._zoom, view.width / 105);
    const hitWidth = Math.max(0.06, 0.42 / this._zoom);
    return html`<div class="editor" @keydown=${this._keyDown}>
      <div class="toolbar">
        <div class="toolbar-row">
          <div class="mode-group" role="group" aria-label="Drawing mode">
            <button aria-pressed=${this._mode === 'select'} @click=${() => this._setMode('select')}>Select</button>
            ${this.shell ? '' : html`<button aria-pressed=${this._mode === 'wall'} @click=${() => this._setMode('wall')}>Draw walls</button>`}
          </div>
          ${this._mode === 'wall' && this._draftStartId ? html`<button class="finish" @click=${this._finishWalls}>Finish walls</button>` : ''}
        </div>
        <div class="hint">${this.shell
          ? 'Select a wall to edit it, or drag any corner to reshape the home.'
          : this._mode === 'wall'
          ? this._draftStartId ? 'Tap the next corner. Existing points snap automatically.' : 'Tap where the first wall begins.'
          : 'Select a wall, or drag a corner to adjust the plan.'}</div>
      </div>
      <div class="canvas">
        <svg
          class=${this._isPanning ? 'panning' : this._mode === 'wall' ? 'drawing' : this._mode === 'pan' ? 'pan' : ''}
          viewBox=${`${view.x} ${view.z} ${view.width} ${view.depth}`}
          preserveAspectRatio="xMidYMid meet"
          role="application"
          aria-label="Architectural plan editor"
          tabindex="0"
          @pointerdown=${this._onCanvasPointerDown}
          @pointermove=${this._onCanvasPointerMove}
          @pointerup=${this._onCanvasPointerUp}
          @pointercancel=${this._onCanvasPointerUp}
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
          ${this.shell?.rooms?.map((room) => svg`
            <polygon class="survey-room ${room.finish === 'tile' ? 'tile' : ''} ${this.selectedRoomId === `survey:${room.zoneId}` ? 'selected' : ''}"
              points=${room.floor.map(([x, z]) => `${x},${z}`).join(' ')} @pointerdown=${(event: PointerEvent) => this._selectRoom(event, `survey:${room.zoneId}`)} />
            ${room.floors?.map((floor) => svg`<polygon class="survey-room ${room.finish === 'tile' ? 'tile' : ''} ${this.selectedRoomId === `survey:${room.zoneId}` ? 'selected' : ''}"
              points=${floor.map(([x, z]) => `${x},${z}`).join(' ')} @pointerdown=${(event: PointerEvent) => this._selectRoom(event, `survey:${room.zoneId}`)} />`)}
          `)}
          ${this.shell ? shellSegments(this.shell).map((segment) => svg`
            <line class="survey-wall ${this.selectedWallId === segment.id ? 'selected' : ''}"
              x1=${segment.start[0]} y1=${segment.start[1]} x2=${segment.end[0]} y2=${segment.end[1]} stroke-width=${segment.thickness} />
            <line class="survey-wall-hit" x1=${segment.start[0]} y1=${segment.start[1]} x2=${segment.end[0]} y2=${segment.end[1]}
              stroke-width=${hitWidth}
              role="button" tabindex="0" aria-label=${`Edit wall ${segment.wallIndex + 1}.${segment.segmentIndex + 1}`}
              @pointerdown=${(event: PointerEvent) => this._selectShellWall(event, segment.id)}
              @click=${(event: MouseEvent) => this._selectShellWall(event, segment.id)}
              @keydown=${(event: KeyboardEvent) => this._selectWallFromKeyboard(event, segment.id, true)} />
          `) : ''}
          ${this.shell ? assignShellOpenings(this.shell).map(({ opening, segment }) => {
            const angle = opening.rotation * Math.PI / 180;
            const halfX = Math.cos(angle) * opening.width / 2;
            const halfZ = Math.sin(angle) * opening.width / 2;
            return svg`
              <line class="survey-opening ${this.selectedOpeningId === opening.id ? 'selected' : ''}"
                x1=${opening.x - halfX} y1=${opening.z - halfZ} x2=${opening.x + halfX} y2=${opening.z + halfZ} stroke-width=${Math.max(0.1, opening.depth * 1.15)} />
              <line class="survey-opening-hit" x1=${opening.x - halfX} y1=${opening.z - halfZ} x2=${opening.x + halfX} y2=${opening.z + halfZ}
                stroke-width=${hitWidth}
                @pointerdown=${(event: PointerEvent) => this._selectShellOpening(event, opening.id, segment.id)} />
            `;
          }) : ''}
          ${this.shell ? this._shellControlPoints().map((point) => {
            const key = `${point[0].toFixed(3)}:${point[1].toFixed(3)}`;
            return svg`
              <circle class="survey-vertex-hit" cx=${point[0]} cy=${point[1]} r=${handleRadius * 2.6}
                role="button" tabindex="0" aria-label="Drag wall corner"
                @pointerdown=${(event: PointerEvent) => this._startShellPointDrag(event, point)} />
              <circle class="survey-vertex ${this._dragShellPointKey === key ? 'selected' : ''}"
                cx=${point[0]} cy=${point[1]} r=${handleRadius * 0.82} aria-hidden="true" />
            `;
          }) : ''}
          ${this.plan.rooms.map((room) => {
            const points = room.boundary.flatMap((edge) => {
              const wall = walls.get(edge.wallId);
              const vertex = wall ? vertices.get(edge.reversed ? wall.end : wall.start) : undefined;
              return vertex ? [`${vertex.x},${vertex.z}`] : [];
            });
            return points.length >= 3 ? svg`<polygon class="room ${this.selectedRoomId === room.id ? 'selected' : ''}"
              points=${points.join(' ')} @pointerdown=${(event: PointerEvent) => this._selectRoom(event, room.id)} />` : '';
          })}
          ${this.plan.walls.map((wall) => {
            const path = this._wallPath(wall, vertices);
            const start = vertices.get(wall.start);
            const end = vertices.get(wall.end);
            const length = wallLength(wall, vertices);
            return svg`
              <path class="wall ${this.selectedWallId === wall.id ? 'selected' : ''}" d=${path} stroke-width=${wall.thickness} />
              <path class="wall-hit" d=${path} role="button" tabindex="0" aria-label=${`Edit wall ${this.plan.walls.indexOf(wall) + 1}`}
                stroke-width=${hitWidth}
                @pointerdown=${(event: PointerEvent) => this._selectWall(event, wall.id)}
                @click=${(event: MouseEvent) => this._selectWall(event, wall.id)}
                @keydown=${(event: KeyboardEvent) => this._selectWallFromKeyboard(event, wall.id)} />
              ${start && end && length > 0.25 ? svg`<text class="dimension" x=${(start.x + end.x) / 2} y=${(start.z + end.z) / 2 - 0.16}>${length.toFixed(2)} m</text>` : ''}
            `;
          })}
          ${this.openings.map((opening) => {
            const wall = walls.get(opening.wallId);
            const line = wall ? this._openingLine(opening, wall, vertices) : null;
            return line ? svg`<line class="opening" x1=${line.x1} y1=${line.z1} x2=${line.x2} y2=${line.z2} />` : '';
          })}
          ${this.plan.elements.map((item) => {
            const footprint = this._elementFootprint(item);
            const label = item.name ?? item.type.replace(/(^|[-_])\w/g, (match) => match.replace(/[-_]/, '').toUpperCase());
            return svg`<g
              class="element ${this.selectedElementId === item.id ? 'selected' : ''}"
              transform=${`translate(${item.position.x} ${item.position.z}) rotate(${item.rotation.y})`}
              role="button"
              aria-label=${label}
              tabindex="0"
              @pointerdown=${(event: PointerEvent) => this._startElementDrag(event, item.id)}
            >
              <rect class="element-shape" x=${-footprint.width / 2} y=${-footprint.depth / 2} width=${footprint.width} height=${footprint.depth} rx=".06" />
              <text class="element-label" y=".06">${label}</text>
            </g>`;
          })}
          ${this.entities.filter((entity) => entity.spatial?.visible).map((entity) => svg`<circle
            class="entity-marker ${this._dragEntityId === entity.entity ? 'selected' : ''}"
            cx=${entity.spatial!.position.x}
            cy=${entity.spatial!.position.z}
            r=${Math.max(0.13, view.width / 72)}
            role="button"
            aria-label=${entity.name ?? entity.entity}
            tabindex="0"
            @pointerdown=${(event: PointerEvent) => this._startEntityDrag(event, entity.entity)}
          />`)}
          ${this.plan.vertices.map((vertex) => svg`<circle
            class="vertex ${this.selectedVertexId === vertex.id ? 'selected' : ''} ${this._draftStartId === vertex.id ? 'draft' : ''}"
            cx=${vertex.x} cy=${vertex.z} r=${handleRadius}
            @pointerdown=${(event: PointerEvent) => this._startVertexDrag(event, vertex.id)}
          />`)}
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
        ${!this.plan.walls.length && !this.shell?.walls?.length ? html`<div class="empty"><strong>Draw the shape of your home</strong><span>Choose Draw walls, then tap each corner. Measurements and shared corners stay exact.</span></div>` : ''}
      </div>
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'spatial-plan-editor': SpatialPlanEditor;
  }
}
