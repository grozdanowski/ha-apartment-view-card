import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { EntityConfig, ZoneConfig } from '../core/config';
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
  @property() base = '';
  @property({ type: Number }) selectedEntity = -1;
  @property({ type: Boolean }) drawingZone = false;

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
    .zone {
      position: absolute;
      border: 2px dashed var(--accent-color, var(--primary-color));
      background: color-mix(in srgb, var(--primary-color) 12%, transparent);
      pointer-events: none;
    }
    .zone.drawing {
      border-style: dashed;
    }
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
    this._emit('preview-entity-selected', { index });
    this._dragMode = 'marker';
    this._dragIndex = index;
    (ev.currentTarget as HTMLElement).setPointerCapture?.(ev.pointerId);
  }

  private _onSurfaceDown(ev: PointerEvent) {
    if (!this.drawingZone) return;
    const p = pointToPercent(ev.clientX, ev.clientY, this._rect());
    this._dragMode = 'zone';
    this._drawStart = p;
    this._drawCurrent = p;
    this._surface!.setPointerCapture?.(ev.pointerId);
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
  };

  private _emit(type: string, detail: unknown) {
    this.dispatchEvent(
      new CustomEvent(type, { detail, bubbles: true, composed: true })
    );
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
        ${this.zones.map(
          (z) => html`<div
            class="zone"
            style="left:${z.x}%;top:${z.y}%;width:${z.width}%;height:${z.height}%;"
          ></div>`
        )}
        ${rubber
          ? html`<div
              class="zone drawing"
              style="left:${rubber.x}%;top:${rubber.y}%;width:${rubber.width}%;height:${rubber.height}%;"
            ></div>`
          : nothing}
        ${this.entities.map(
          (e, i) => html`<div
            class="marker ${i === this.selectedEntity ? 'selected' : ''} ${this
              ._dragMode === 'marker' && this._dragIndex === i
              ? 'dragging'
              : ''}"
            style="left:${e.x}%;top:${e.y}%;"
            @pointerdown=${(ev: PointerEvent) => this._onMarkerDown(ev, i)}
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
