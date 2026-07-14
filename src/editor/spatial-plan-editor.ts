import { LitElement, css, html, svg } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { EntityConfig, OpeningConfig, SpatialObject, SpatialPlan, SpatialShellConfig, SpatialVertex, SpatialWallSegment } from '../core/config';
import { spatialBounds, wallLength } from '../core/spatial-geometry';
import { addSpatialVertex, addSpatialWall, emptySpatialPlan, moveSpatialVertex, nearestSpatialVertex, snapSpatialPoint, updateSpatialObject } from '../core/spatial-plan';
import { spatialAsset } from '../core/spatial-assets';
import { assignShellOpenings, shellSegments } from '../core/spatial-shell';

type PlanEditorMode = 'select' | 'wall';

@customElement('spatial-plan-editor')
export class SpatialPlanEditor extends LitElement {
  @property({ attribute: false }) plan: SpatialPlan = emptySpatialPlan();
  @property({ attribute: false }) openings: OpeningConfig[] = [];
  @property({ attribute: false }) entities: EntityConfig[] = [];
  @property({ attribute: false }) shell: SpatialShellConfig | null = null;
  @property() selectedWallId = '';
  @property() selectedVertexId = '';
  @property() selectedObjectId = '';
  @property() selectedOpeningId = '';
  @property() selectedRoomId = '';
  @state() private _mode: PlanEditorMode = 'select';
  @state() private _draftStartId = '';
  @state() private _dragVertexId = '';
  @state() private _dragObjectId = '';
  @state() private _dragEntityId = '';
  private _dragEntityPoint: { x: number; z: number } | null = null;
  @state() private _dragMoved = false;

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
    .room { fill: #5f6d6d; fill-opacity: 0.18; stroke: transparent; stroke-width: 0.06; cursor: pointer; }
    .room.selected { fill: #8db8c1; fill-opacity: 0.28; stroke: #b8e1e6; }
    .survey-room { fill: #657474; fill-opacity: 0.2; stroke: transparent; stroke-width: 0.06; cursor: pointer; }
    .survey-room.selected { fill: #8db8c1; fill-opacity: 0.28; stroke: #b8e1e6; }
    .survey-room.tile { fill: #6d7776; fill-opacity: 0.3; }
    .survey-wall { fill: none; stroke: #d8dfdf; stroke-linecap: square; stroke-linejoin: round; pointer-events: none; }
    .survey-wall.selected { stroke: #9dcbd2; }
    .survey-wall-hit { fill: none; stroke: transparent; stroke-width: 0.42; cursor: pointer; }
    .survey-opening { stroke: #0c1112; stroke-linecap: butt; pointer-events: none; }
    .survey-opening.selected { stroke: #8ed4df; }
    .survey-opening-hit { stroke: transparent; stroke-width: 0.42; cursor: pointer; }
    .wall { fill: none; stroke: #d8dfdf; stroke-linecap: square; stroke-linejoin: round; }
    .wall.selected { stroke: #9dcbd2; }
    .wall-hit { fill: none; stroke: transparent; stroke-width: 0.42; cursor: pointer; }
    .vertex { fill: #101617; stroke: #d8dfdf; stroke-width: 0.035; cursor: grab; }
    .vertex.selected, .vertex.draft { fill: #b9dce1; stroke: #101617; }
    .opening { stroke: #0c1112; stroke-width: 0.16; stroke-linecap: butt; pointer-events: none; }
    .object { cursor: grab; }
    .object-shape { fill: #879597; fill-opacity: 0.82; stroke: #c8d5d7; stroke-width: 0.025; }
    .object.selected .object-shape { fill: #a9cbd0; stroke: #edf6f7; stroke-width: 0.055; }
    .object-label { display: none; fill: #0b1011; font: 650 0.18px/1 -apple-system, BlinkMacSystemFont, sans-serif; text-anchor: middle; pointer-events: none; }
    .object.selected .object-label { display: block; }
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
    }
    @media (prefers-reduced-motion: reduce) { * { scroll-behavior: auto !important; } }
  `;

  private _viewBox(): { x: number; z: number; width: number; depth: number } {
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

  private _point(event: PointerEvent): { x: number; z: number } | null {
    const svgElement = this.renderRoot.querySelector('svg');
    if (!(svgElement instanceof SVGSVGElement)) return null;
    const matrix = svgElement.getScreenCTM();
    if (!matrix) return null;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    return snapSpatialPoint({ x: point.x, z: point.y }, 0.1);
  }

  private _commit(plan: SpatialPlan, record = true): void {
    this.plan = plan;
    this.dispatchEvent(new CustomEvent('spatial-plan-changed', {
      detail: { plan, record }, bubbles: true, composed: true,
    }));
  }

  private _setMode(mode: PlanEditorMode): void {
    this._mode = mode;
    if (mode !== 'wall') this._draftStartId = '';
  }

  private _finishWalls(): void {
    this._draftStartId = '';
    this._mode = 'select';
  }

  private _onCanvasPointerDown(event: PointerEvent): void {
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

  private _selectWall(event: PointerEvent, wallId: string): void {
    if (this._mode !== 'select') return;
    event.stopPropagation();
    this.selectedWallId = wallId;
    this.selectedVertexId = '';
    this.selectedObjectId = '';
    this.dispatchEvent(new CustomEvent('spatial-wall-selected', { detail: { wallId }, bubbles: true, composed: true }));
  }

  private _selectShellWall(event: PointerEvent, wallId: string): void {
    if (this._mode !== 'select') return;
    event.stopPropagation();
    this.selectedWallId = wallId;
    this.selectedOpeningId = '';
    this.selectedObjectId = '';
    this.dispatchEvent(new CustomEvent('spatial-wall-selected', { detail: { wallId }, bubbles: true, composed: true }));
  }

  private _selectShellOpening(event: PointerEvent, openingId: string, wallId: string): void {
    if (this._mode !== 'select') return;
    event.stopPropagation();
    this.selectedOpeningId = openingId;
    this.selectedWallId = wallId;
    this.selectedObjectId = '';
    this.dispatchEvent(new CustomEvent('spatial-opening-selected', {
      detail: { id: openingId, wallId }, bubbles: true, composed: true,
    }));
  }

  private _selectRoom(event: PointerEvent, roomId: string): void {
    if (this._mode !== 'select') return;
    event.stopPropagation();
    this.selectedRoomId = roomId;
    this.selectedWallId = '';
    this.selectedOpeningId = '';
    this.selectedObjectId = '';
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
    this.selectedObjectId = '';
    (event.currentTarget as SVGCircleElement).setPointerCapture(event.pointerId);
    this.dispatchEvent(new CustomEvent('spatial-vertex-selected', { detail: { vertexId }, bubbles: true, composed: true }));
  }

  private _dragVertex(event: PointerEvent): void {
    if (!this._dragVertexId && !this._dragObjectId && !this._dragEntityId) return;
    const point = this._point(event);
    if (!point) return;
    this._dragMoved = true;
    if (this._dragVertexId) this._commit(moveSpatialVertex(this.plan, this._dragVertexId, point), false);
    else if (this._dragObjectId) {
      const object = this.plan.objects.find((item) => item.id === this._dragObjectId);
      if (object) this._commit(updateSpatialObject(this.plan, object.id, { position: { ...object.position, x: point.x, z: point.z } }), false);
    } else {
      this._dragEntityPoint = point;
      this.dispatchEvent(new CustomEvent('spatial-entity-moved', {
        detail: { entityId: this._dragEntityId, point, record: false }, bubbles: true, composed: true,
      }));
    }
  }

  private _endVertexDrag(): void {
    if (!this._dragVertexId && !this._dragObjectId && !this._dragEntityId) return;
    if (this._dragMoved && this._dragEntityId && this._dragEntityPoint) {
      this.dispatchEvent(new CustomEvent('spatial-entity-moved', {
        detail: { entityId: this._dragEntityId, point: this._dragEntityPoint, record: true }, bubbles: true, composed: true,
      }));
    } else if (this._dragMoved) this._commit(this.plan, true);
    this._dragVertexId = '';
    this._dragObjectId = '';
    this._dragEntityId = '';
    this._dragEntityPoint = null;
    this._dragMoved = false;
  }

  private _startEntityDrag(event: PointerEvent, entityId: string): void {
    if (this._mode !== 'select' || event.button !== 0) return;
    event.stopPropagation();
    this._dragEntityId = entityId;
    this._dragMoved = false;
    this.selectedObjectId = '';
    this.selectedWallId = '';
    this.selectedVertexId = '';
    (event.currentTarget as SVGCircleElement).setPointerCapture(event.pointerId);
    this.dispatchEvent(new CustomEvent('spatial-entity-selected', { detail: { entityId }, bubbles: true, composed: true }));
  }

  private _startObjectDrag(event: PointerEvent, objectId: string): void {
    if (this._mode !== 'select' || event.button !== 0) return;
    event.stopPropagation();
    this._dragObjectId = objectId;
    this._dragMoved = false;
    this.selectedObjectId = objectId;
    this.selectedWallId = '';
    this.selectedVertexId = '';
    (event.currentTarget as SVGGElement).setPointerCapture(event.pointerId);
    this.dispatchEvent(new CustomEvent('spatial-object-selected', { detail: { objectId }, bubbles: true, composed: true }));
  }

  private _objectFootprint(item: SpatialObject): { width: number; depth: number } {
    const asset = spatialAsset(item.assetId);
    const sizes: Record<string, [number, number]> = {
      sofa: [2.2, 0.95], armchair: [0.9, 0.9], bed: [1.8, 2], table: [1.6, 0.9], chair: [0.48, 0.52],
      tv: [1.4, 0.22], console: [1.5, 0.42], cabinet: [1.2, 0.5], vanity: [1.1, 0.52], bathtub: [1.7, 0.75],
      island: [1.8, 0.9], rug: [2.2, 1.6], plant: [0.55, 0.55],
    };
    const [width, depth] = asset?.dimensions ?? sizes[item.kind] ?? [0.9, 0.6];
    return { width: width * item.scale.x, depth: depth * item.scale.z };
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
    if (event.key === 'Escape') this._finishWalls();
  }

  protected render() {
    const view = this._viewBox();
    const vertices = new Map(this.plan.vertices.map((vertex) => [vertex.id, vertex]));
    const walls = new Map(this.plan.walls.map((wall) => [wall.id, wall]));
    const handleRadius = Math.max(0.09, view.width / 105);
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
          ? 'Select a wall to add an opening, or select any door or window to adjust it.'
          : this._mode === 'wall'
          ? this._draftStartId ? 'Tap the next corner. Existing points snap automatically.' : 'Tap where the first wall begins.'
          : 'Select a wall, or drag a corner to adjust the plan.'}</div>
      </div>
      <div class="canvas">
        <svg
          class=${this._mode === 'wall' ? 'drawing' : ''}
          viewBox=${`${view.x} ${view.z} ${view.width} ${view.depth}`}
          preserveAspectRatio="xMidYMid meet"
          role="application"
          aria-label="Architectural plan editor"
          tabindex="0"
          @pointerdown=${this._onCanvasPointerDown}
          @pointermove=${this._dragVertex}
          @pointerup=${this._endVertexDrag}
          @pointercancel=${this._endVertexDrag}
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
              @pointerdown=${(event: PointerEvent) => this._selectShellWall(event, segment.id)} />
          `) : ''}
          ${this.shell ? assignShellOpenings(this.shell).map(({ opening, segment }) => {
            const angle = opening.rotation * Math.PI / 180;
            const halfX = Math.cos(angle) * opening.width / 2;
            const halfZ = Math.sin(angle) * opening.width / 2;
            return svg`
              <line class="survey-opening ${this.selectedOpeningId === opening.id ? 'selected' : ''}"
                x1=${opening.x - halfX} y1=${opening.z - halfZ} x2=${opening.x + halfX} y2=${opening.z + halfZ} stroke-width=${Math.max(0.1, opening.depth * 1.15)} />
              <line class="survey-opening-hit" x1=${opening.x - halfX} y1=${opening.z - halfZ} x2=${opening.x + halfX} y2=${opening.z + halfZ}
                @pointerdown=${(event: PointerEvent) => this._selectShellOpening(event, opening.id, segment.id)} />
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
              <path class="wall-hit" d=${path} @pointerdown=${(event: PointerEvent) => this._selectWall(event, wall.id)} />
              ${start && end && length > 0.25 ? svg`<text class="dimension" x=${(start.x + end.x) / 2} y=${(start.z + end.z) / 2 - 0.16}>${length.toFixed(2)} m</text>` : ''}
            `;
          })}
          ${this.openings.map((opening) => {
            const wall = walls.get(opening.wallId);
            const line = wall ? this._openingLine(opening, wall, vertices) : null;
            return line ? svg`<line class="opening" x1=${line.x1} y1=${line.z1} x2=${line.x2} y2=${line.z2} />` : '';
          })}
          ${this.plan.objects.map((item) => {
            const footprint = this._objectFootprint(item);
            const label = item.name ?? item.kind.replace(/(^|[-_])\w/g, (match) => match.replace(/[-_]/, '').toUpperCase());
            return svg`<g
              class="object ${this.selectedObjectId === item.id ? 'selected' : ''}"
              transform=${`translate(${item.position.x} ${item.position.z}) rotate(${item.rotation.y})`}
              role="button"
              aria-label=${label}
              tabindex="0"
              @pointerdown=${(event: PointerEvent) => this._startObjectDrag(event, item.id)}
            >
              <rect class="object-shape" x=${-footprint.width / 2} y=${-footprint.depth / 2} width=${footprint.width} height=${footprint.depth} rx=".06" />
              <text class="object-label" y=".06">${label}</text>
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
