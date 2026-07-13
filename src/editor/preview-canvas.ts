import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { wallIdFor, wallParts, type EntityConfig, type OpeningConfig, type WallConfig, type WallSide, type ZoneConfig } from '../core/config';
import {
  pointToPercent,
  rectFromDrag,
  type PreviewRect,
} from './preview-geometry';

type DragMode = 'none' | 'marker' | 'zone';

@customElement('preview-canvas')
export class PreviewCanvas extends LitElement {
  @property({ attribute: false }) entities: EntityConfig[] = [];
  @property({ attribute: false }) zones: ZoneConfig[] = [];
  @property({ attribute: false }) openings: OpeningConfig[] = [];
  @property({ attribute: false }) walls: WallConfig[] = [];
  @property() base = '';
  @property({ type: Number }) selectedEntity = -1;
  @property({ type: Boolean }) drawingZone = false;
  @property({ type: Boolean }) architectureMode = false;
  @property() selectedWallId = '';
  @property() selectedOpeningId = '';

  @state() private _dragMode: DragMode = 'none';
  @state() private _dragIndex = -1;
  @state() private _drawStart: { x: number; y: number } | null = null;
  @state() private _drawCurrent: { x: number; y: number } | null = null;

  static styles = css`
    :host {
      display: block;
      width: 100%;
    }
    .surface {
      position: relative;
      width: 100%;
      user-select: none;
      touch-action: none;
      overflow: hidden;
      border-radius: 8px;
    }
    .surface.drawing {
      cursor: crosshair;
    }
    /* Drawing mode must be unmissable (rc.1 field feedback: "no indication
       that I should now draw"): armed dashed outline + instruction banner,
       and markers stop intercepting the drag. */
    .surface.drawing .marker {
      pointer-events: none;
      opacity: 0.4;
    }
    .surface.drawing::after {
      content: '';
      position: absolute;
      inset: 2px;
      border: 2px dashed var(--primary-color, #03a9f4);
      border-radius: 8px;
      pointer-events: none;
      animation: draw-armed 1.6s ease-in-out infinite;
    }
    @keyframes draw-armed {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.45; }
    }
    .draw-banner {
      position: absolute;
      top: 10px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 2;
      max-width: calc(100% - 32px);
      padding: 8px 14px;
      border-radius: 18px;
      background: var(--primary-color, #03a9f4);
      color: var(--text-primary-color, #fff);
      font-size: 13px;
      font-weight: 500;
      text-align: center;
      pointer-events: none;
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
    }
    @media (prefers-reduced-motion: reduce) {
      .surface.drawing::after {
        animation: none;
      }
    }
    .base {
      display: block;
      width: 100%;
      height: auto;
      pointer-events: none;
    }
    .empty {
      padding: 32px 16px;
      text-align: center;
      color: var(--secondary-text-color);
      border: 1px dashed var(--divider-color);
      border-radius: 8px;
    }
    .marker {
      position: absolute;
      width: 22px;
      height: 22px;
      margin: -11px 0 0 -11px;
      border-radius: 50%;
      background: var(--primary-color);
      border: 2px solid var(--card-background-color);
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
      cursor: grab;
      transition: opacity 0.1s ease;
    }
    .marker.selected {
      background: var(--accent-color, var(--primary-color));
      box-shadow: 0 0 0 3px var(--primary-color);
    }
    .marker.dragging {
      cursor: grabbing;
      opacity: 0.5;
    }
    .marker:focus-visible {
      outline: 3px solid var(--primary-color);
      outline-offset: 3px;
    }
    .zone {
      position: absolute;
      border: 2px dashed var(--accent-color, var(--primary-color));
      background: color-mix(in srgb, var(--primary-color) 12%, transparent);
      pointer-events: none;
    }
    .zone.drawing {
      border-style: dashed;
    }
    .wall {
      position: absolute;
      z-index: 3;
      border: 0;
      padding: 0;
      background: color-mix(in srgb, var(--primary-text-color, #fff) 18%, transparent);
      cursor: pointer;
      opacity: 0.65;
    }
    .wall.horizontal { height: 8px; transform: translateY(-4px); }
    .wall.vertical { width: 8px; transform: translateX(-4px); }
    .wall:hover, .wall:focus-visible, .wall.selected {
      opacity: 1;
      background: var(--primary-color);
      outline: none;
      box-shadow: 0 0 0 2px color-mix(in srgb, var(--primary-color) 28%, transparent);
    }
    .opening {
      position: absolute;
      z-index: 4;
      border: 2px solid var(--card-background-color);
      padding: 0;
      cursor: pointer;
      background: var(--warning-color, #d7a44a);
      box-sizing: border-box;
    }
    .opening.window { background: #8dc4d1; }
    .opening.horizontal { height: 12px; transform: translateY(-6px); }
    .opening.vertical { width: 12px; transform: translateX(-6px); }
    .opening.selected { box-shadow: 0 0 0 3px var(--primary-color); }
    .wall-curves { position: absolute; inset: 0; z-index: 2; width: 100%; height: 100%; pointer-events: none; overflow: visible; }
    .wall-curves path { fill: none; stroke: var(--primary-color); stroke-width: 0.65; stroke-linecap: round; vector-effect: non-scaling-stroke; }
  `;

  private get _surface(): HTMLElement | null {
    return this.shadowRoot?.querySelector('.surface') ?? null;
  }

  private _rect(): PreviewRect {
    const r = this._surface!.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  }

  private _onMarkerDown(ev: PointerEvent, index: number) {
    ev.stopPropagation();
    this._emit('preview-edit-start', {});
    this._emit('preview-entity-selected', { index });
    this._dragMode = 'marker';
    this._dragIndex = index;
    (ev.currentTarget as HTMLElement).setPointerCapture?.(ev.pointerId);
  }

  private _onMarkerKeyDown(ev: KeyboardEvent, index: number) {
    const delta = ev.shiftKey ? 2 : 0.5;
    const entity = this.entities[index];
    if (!entity) return;
    let x = entity.x;
    let y = entity.y;
    if (ev.key === 'ArrowLeft') x -= delta;
    else if (ev.key === 'ArrowRight') x += delta;
    else if (ev.key === 'ArrowUp') y -= delta;
    else if (ev.key === 'ArrowDown') y += delta;
    else if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      this._emit('preview-entity-selected', { index });
      return;
    } else return;
    ev.preventDefault();
    this._emit('preview-entity-selected', { index });
    this._emit('preview-entity-moved', {
      index,
      x: Math.min(100, Math.max(0, x)),
      y: Math.min(100, Math.max(0, y)),
    });
  }

  private _onSurfaceDown(ev: PointerEvent) {
    if (!this.drawingZone) return;
    const p = pointToPercent(ev.clientX, ev.clientY, this._rect());
    this._dragMode = 'zone';
    this._drawStart = p;
    this._drawCurrent = p;
    this._surface!.setPointerCapture?.(ev.pointerId);
  }

  private _selectWall(ev: Event, zoneId: string, side: WallSide): void {
    ev.stopPropagation();
    this._emit('preview-wall-selected', { wallId: wallIdFor(zoneId, side) });
  }

  private _openingStyle(opening: OpeningConfig): { style: string; orientation: 'horizontal' | 'vertical' } | null {
    const parts = wallParts(opening.wallId);
    const zone = parts && this.zones.find((candidate) => candidate.id === parts.zoneId);
    if (!parts || !zone) return null;
    const width = Math.min(0.8, Math.max(0.08, opening.width));
    const center = Math.min(1 - width / 2, Math.max(width / 2, opening.position));
    const start = center - width / 2;
    if (parts.side === 'top' || parts.side === 'bottom') {
      const top = parts.side === 'top' ? zone.y : zone.y + zone.height;
      return {
        orientation: 'horizontal',
        style: `left:${zone.x + start * zone.width}%;top:${top}%;width:${width * zone.width}%;`,
      };
    }
    const left = parts.side === 'left' ? zone.x : zone.x + zone.width;
    return {
      orientation: 'vertical',
      style: `left:${left}%;top:${zone.y + start * zone.height}%;height:${width * zone.height}%;`,
    };
  }

  private _curvePath(wall: WallConfig): string | null {
    const parts = wallParts(wall.wallId);
    const zone = parts && this.zones.find((candidate) => candidate.id === parts.zoneId);
    if (!parts || !zone || Math.abs(wall.curve) < 0.01) return null;
    if (parts.side === 'top' || parts.side === 'bottom') {
      const y = parts.side === 'top' ? zone.y : zone.y + zone.height;
      const offset = wall.curve * Math.min(10, zone.width * 0.24);
      return `M ${zone.x} ${y} Q ${zone.x + zone.width / 2} ${y + offset} ${zone.x + zone.width} ${y}`;
    }
    const x = parts.side === 'left' ? zone.x : zone.x + zone.width;
    const offset = wall.curve * Math.min(10, zone.height * 0.24);
    return `M ${x} ${zone.y} Q ${x + offset} ${zone.y + zone.height / 2} ${x} ${zone.y + zone.height}`;
  }

  private _onMove = (ev: PointerEvent) => {
    if (this._dragMode === 'marker') {
      const p = pointToPercent(ev.clientX, ev.clientY, this._rect());
      this._emit('preview-entity-moved', {
        index: this._dragIndex,
        x: p.x,
        y: p.y,
      });
    } else if (this._dragMode === 'zone' && this._drawStart) {
      this._drawCurrent = pointToPercent(ev.clientX, ev.clientY, this._rect());
    }
  };

  private _onUp = () => {
    const wasMarkerDrag = this._dragMode === 'marker';
    if (this._dragMode === 'zone' && this._drawStart && this._drawCurrent) {
      const r = rectFromDrag(
        this._drawStart.x,
        this._drawStart.y,
        this._drawCurrent.x,
        this._drawCurrent.y
      );
      if (r.width < 2 || r.height < 2) {
        this._emit('preview-zone-draw-cancelled', {});
      } else {
        this._emit('preview-zone-drawn', r);
      }
    }
    this._dragMode = 'none';
    this._dragIndex = -1;
    this._drawStart = null;
    this._drawCurrent = null;
    if (wasMarkerDrag) this._emit('preview-edit-end', {});
  };

  private _emit(type: string, detail: unknown) {
    this.dispatchEvent(
      new CustomEvent(type, { detail, bubbles: true, composed: true })
    );
  }

  /** Escape cancels an armed/ongoing zone draw. */
  private _onKeyDown = (ev: KeyboardEvent) => {
    if (ev.key !== 'Escape' || !this.drawingZone) return;
    ev.stopPropagation();
    this._dragMode = 'none';
    this._drawStart = null;
    this._drawCurrent = null;
    this._emit('preview-zone-draw-cancelled', {});
  };

  connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener('keydown', this._onKeyDown);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener('keydown', this._onKeyDown);
  }

  protected render() {
    if (!this.base) {
      return html`<div class="empty">
        Set <code>images.base</code> to enable the live preview.
      </div>`;
    }

    const rubber =
      this._dragMode === 'zone' && this._drawStart && this._drawCurrent
        ? rectFromDrag(
            this._drawStart.x,
            this._drawStart.y,
            this._drawCurrent.x,
            this._drawCurrent.y
          )
        : null;

    return html`
      <div
        class="surface ${this.drawingZone ? 'drawing' : ''}"
        @pointerdown=${this._onSurfaceDown}
        @pointermove=${this._onMove}
        @pointerup=${this._onUp}
        @pointercancel=${this._onUp}
      >
        <img class="base" src=${this.base} alt="Apartment preview" />
        ${this.drawingZone
          ? html`<div class="draw-banner">
              ${this._dragMode === 'zone'
                ? 'Release to create the zone'
                : 'Draw the zone: click and drag a rectangle — Esc to cancel'}
            </div>`
          : nothing}
        ${this.zones.map(
          (z) => html`<div
            class="zone"
            style="left:${z.x}%;top:${z.y}%;width:${z.width}%;height:${z.height}%;"
          ></div>`
        )}
        ${this.architectureMode ? this.zones.flatMap((zone) => {
          if (!zone.id) return [];
          const walls: { side: WallSide; style: string; orientation: 'horizontal' | 'vertical' }[] = [
            { side: 'top', style: `left:${zone.x}%;top:${zone.y}%;width:${zone.width}%;`, orientation: 'horizontal' },
            { side: 'right', style: `left:${zone.x + zone.width}%;top:${zone.y}%;height:${zone.height}%;`, orientation: 'vertical' },
            { side: 'bottom', style: `left:${zone.x}%;top:${zone.y + zone.height}%;width:${zone.width}%;`, orientation: 'horizontal' },
            { side: 'left', style: `left:${zone.x}%;top:${zone.y}%;height:${zone.height}%;`, orientation: 'vertical' },
          ];
          return walls.map((wall) => {
            const id = wallIdFor(zone.id!, wall.side);
            return html`<button class="wall ${wall.orientation} ${this.selectedWallId === id ? 'selected' : ''}"
              style=${wall.style} aria-label=${`Select ${wall.side} wall of ${zone.name}`}
              @pointerdown=${(event: Event) => this._selectWall(event, zone.id!, wall.side)}></button>`;
          });
        }) : nothing}
        ${this.architectureMode && this.walls.length ? html`<svg class="wall-curves" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          ${this.walls.map((wall) => {
            const path = this._curvePath(wall);
            return path ? html`<path d=${path}></path>` : nothing;
          })}
        </svg>` : nothing}
        ${this.architectureMode ? this.openings.map((opening) => {
          const geometry = this._openingStyle(opening);
          return geometry ? html`<button class="opening ${opening.kind} ${geometry.orientation} ${this.selectedOpeningId === opening.id ? 'selected' : ''}"
            style=${geometry.style} aria-label=${`Select ${opening.kind}`}
            @pointerdown=${(event: Event) => { event.stopPropagation(); this._emit('preview-opening-selected', { id: opening.id, wallId: opening.wallId }); }}></button>` : nothing;
        }) : nothing}
        ${rubber
          ? html`<div
              class="zone drawing"
              style="left:${rubber.x}%;top:${rubber.y}%;width:${rubber.width}%;height:${rubber.height}%;"
            ></div>`
          : nothing}
        ${this.entities.map(
          (e, i) => html`<div
            role="button"
            tabindex="0"
            aria-label=${`Position ${e.name || e.entity || `device ${i + 1}`}`}
            class="marker ${i === this.selectedEntity ? 'selected' : ''} ${this
              ._dragMode === 'marker' && this._dragIndex === i
              ? 'dragging'
              : ''}"
            style="left:${e.x}%;top:${e.y}%;"
            @pointerdown=${(ev: PointerEvent) => this._onMarkerDown(ev, i)}
            @keydown=${(ev: KeyboardEvent) => this._onMarkerKeyDown(ev, i)}
          ></div>`
        )}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'preview-canvas': PreviewCanvas;
  }
}
