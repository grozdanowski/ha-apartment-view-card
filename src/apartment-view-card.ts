import { LitElement, html, css, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { fireEvent } from 'custom-card-helpers';
import type { HomeAssistant } from 'custom-card-helpers';
import type { HassEntity } from './core/ha-types';
import { normalizeConfig, type ApartmentViewConfig, type EntityConfig } from './core/config';
import { renderBaseLayer } from './render/base-layer';
import { renderLightLayer } from './render/light-layer';
import { PanZoomController } from './core/pan-zoom';
import { TapHoldTracker, HOLD_MS, MOVE_THRESHOLD_PX } from './core/tap-hold';
import {
  computeMarkerViews,
  renderMarkerOverlay,
  type MarkerView,
} from './render/marker-overlay';
import type { Viewport, ZoomTransform } from './core/geometry';

interface MinimalHass {
  states: Record<string, HassEntity>;
  // Needed by Phase 3 dispatchTapAction (tap:toggle -> homeassistant.toggle).
  callService(domain: string, service: string, data?: any): Promise<void>;
}

@customElement('apartment-view-card')
export class ApartmentViewCard extends LitElement {
  @property({ attribute: false }) public hass?: MinimalHass;
  @property({ attribute: false }) public config!: ApartmentViewConfig;
  @state() private _cardWidth = 600;
  @state() private _transform: ZoomTransform = { scale: 1, panX: 0, panY: 0 };
  @state() private _animating = false;

  private _ro?: ResizeObserver;
  private _panZoom = new PanZoomController({ zoomMax: 1.5 });
  private _tapHold = new TapHoldTracker();
  private _activeMarker: MarkerView | null = null;
  private _holdTimer: number | null = null;
  private _holdFired = false;
  private _activePointers = new Map<number, { x: number; y: number }>();
  private _pinchStartDist = 0;
  private _pinchStartScale = 1;
  private _lastMove: { x: number; y: number } | null = null;

  /** Inline string so Phase 5 can reference ApartmentViewCard.ZOOM_TRANSITION. */
  static readonly ZOOM_TRANSITION = 'transform 0.6s cubic-bezier(0.4, 0, 0.2, 1)';

  static styles = css`
    :host {
      display: block;
    }
    .wrapper {
      position: relative;
      width: 100%;
      height: 100%;
      overflow: hidden;
      touch-action: none; /* let us own pinch/pan */
    }
    .scene {
      position: absolute;
      inset: 0;
      transform-origin: 0 0;
      will-change: transform;
    }
    .base-image {
      display: block;
      width: 100%;
      height: auto;
    }
    .warning {
      padding: 16px;
      color: var(--error-color, #db4437);
      text-align: center;
    }
    .marker-overlay {
      position: absolute;
      inset: 0;
      pointer-events: none; /* container transparent; buttons re-enable */
    }
    .marker-overlay .marker {
      position: absolute;
      transform: translate(-50%, -50%);
      display: grid;
      place-items: center;
      border: none;
      border-radius: 50%;
      padding: 0;
      cursor: pointer;
      pointer-events: auto;
      background: var(--card-background-color);
      color: var(--primary-text-color);
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
      transition: opacity 0.3s ease, transform 0.6s cubic-bezier(0.4, 0, 0.2, 1),
        background-color 0.3s ease, color 0.3s ease;
    }
    .marker-overlay .marker.active {
      background: var(--primary-color);
      color: var(--text-primary-color);
    }
    .marker-overlay .marker.dimmed {
      opacity: 0.25;
    }
    .marker-overlay .marker[disabled] {
      cursor: default;
      color: var(--disabled-text-color);
    }
  `;

  public setConfig(raw: any): void {
    this.config = normalizeConfig(raw);
    this._syncPanZoomFromConfig();
  }

  public getCardSize(): number {
    return 8;
  }

  public getGridOptions(): { rows: number; columns: number; min_rows: number; min_columns: number } {
    return { rows: 8, columns: 12, min_rows: 4, min_columns: 6 };
  }

  static getConfigElement(): HTMLElement {
    return document.createElement('apartment-view-card-editor');
  }

  static getStubConfig(): Record<string, unknown> {
    return {
      type: 'custom:apartment-view-card',
      images: { base: '/local/floorplan.png' },
      entities: [],
    };
  }

  public connectedCallback(): void {
    super.connectedCallback();
    this.addEventListener('wheel', this._onWheel, { passive: false });
    window.addEventListener('pointermove', this._onWindowPointerMove);
    window.addEventListener('pointerup', this._onWindowPointerUp);
    window.addEventListener('pointercancel', this._onWindowPointerUp);
    if (typeof ResizeObserver !== 'undefined') {
      this._ro = new ResizeObserver((entries) => {
        const w = entries[0]?.contentRect?.width;
        if (w && Math.abs(w - this._cardWidth) > 0.5) {
          this._cardWidth = w;
        }
      });
    }
  }

  public disconnectedCallback(): void {
    super.disconnectedCallback();
    this.removeEventListener('wheel', this._onWheel);
    window.removeEventListener('pointermove', this._onWindowPointerMove);
    window.removeEventListener('pointerup', this._onWindowPointerUp);
    window.removeEventListener('pointercancel', this._onWindowPointerUp);
    this._cancelHold();
    this._ro?.disconnect();
    this._ro = undefined;
  }

  protected firstUpdated(): void {
    const wrapper = this.renderRoot.querySelector('.wrapper');
    if (wrapper) {
      const w = wrapper.getBoundingClientRect().width;
      if (w) this._cardWidth = w;
      this._ro?.observe(wrapper);
    }
  }

  // ---------------------------------------------------------------------------
  // Viewport + PanZoom configuration
  // ---------------------------------------------------------------------------

  /**
   * Returns the .wrapper / scene image-box size.
   * vp.width === this._cardWidth (same width passed to renderLightLayer).
   */
  private _viewport(): Viewport {
    const r = this.getBoundingClientRect();
    return { width: r.width, height: r.height };
  }

  /** Apply zoomMax + freePanZoom gate whenever config changes. */
  private _syncPanZoomFromConfig(): void {
    this._panZoom = new PanZoomController({
      zoomMax: this.config.options.zoomMax,
    });
    // Overview: free pan/zoom only when enabled in options (focus state in Phase 5).
    this._panZoom.setEnabled(this.config.options.freePanZoom);
    this._transform = this._panZoom.transform;
  }

  // ---------------------------------------------------------------------------
  // Pointer / wheel handlers (named exactly per spec for Phase 5 compatibility)
  // ---------------------------------------------------------------------------

  private _onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this._animating = false;
    const r = this.getBoundingClientRect();
    this._transform = this._panZoom.wheelZoom(
      e.deltaY,
      e.clientX - r.left,
      e.clientY - r.top
    );
  };

  private _onScenePointerDown = (e: PointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    this._activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this._animating = false;
    if (this._activePointers.size === 2) {
      // begin pinch
      const [a, b] = [...this._activePointers.values()];
      this._pinchStartDist = this._panZoom.pinchDistance(a.x, a.y, b.x, b.y);
      this._pinchStartScale = this._panZoom.transform.scale;
      this._cancelHold();
      return;
    }
    // single pointer: candidate tap/hold/pan on the SCENE (not a marker)
    this._activeMarker = null;
    this._beginGesture(e);
  };

  private _onMarkerPointerDown = (e: PointerEvent, m: MarkerView) => {
    e.stopPropagation();
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    this._activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this._animating = false;
    this._activeMarker = m;
    this._beginGesture(e);
  };

  private _beginGesture(e: PointerEvent) {
    this._tapHold.start(e.clientX, e.clientY, performance.now());
    this._holdFired = false;
    this._cancelHold();
    this._holdTimer = window.setTimeout(() => {
      // fire only if still pressed and not moved past threshold
      if (this._tapHold.holdElapsed(performance.now())) {
        this._holdFired = true;
        if (this._activeMarker) {
          dispatchHoldAction(this._activeMarker.entity, this);
        }
      }
    }, HOLD_MS);
  }

  private _onWindowPointerMove = (e: PointerEvent) => {
    if (!this._activePointers.has(e.pointerId)) return;
    this._activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (this._activePointers.size >= 2 && this._pinchStartDist > 0) {
      const [a, b] = [...this._activePointers.values()];
      const dist = this._panZoom.pinchDistance(a.x, a.y, b.x, b.y);
      if (Math.abs(dist - this._pinchStartDist) <= MOVE_THRESHOLD_PX) return; // below per-gesture threshold
      const factor = dist / this._pinchStartDist;
      const r = this.getBoundingClientRect();
      const cx = (a.x + b.x) / 2 - r.left;
      const cy = (a.y + b.y) / 2 - r.top;
      // apply relative to the pinch-start scale
      const target = this._pinchStartScale * factor;
      this._transform = this._panZoom.pinchZoom(
        target / this._panZoom.transform.scale,
        cx,
        cy
      );
      return;
    }

    const moved = this._tapHold.move(e.clientX, e.clientY);
    if (moved.exceededThreshold) {
      this._cancelHold();
      // pan: translate by the per-event delta
      const prev = this._lastMove ?? { x: e.clientX, y: e.clientY };
      this._transform = this._panZoom.panBy(e.clientX - prev.x, e.clientY - prev.y);
    }
    this._lastMove = { x: e.clientX, y: e.clientY };
  };

  private _onWindowPointerUp = (e: PointerEvent) => {
    if (!this._activePointers.has(e.pointerId)) return;
    this._activePointers.delete(e.pointerId);
    this._lastMove = null;
    if (this._activePointers.size < 2) this._pinchStartDist = 0;

    const outcome = this._tapHold.end(performance.now());
    this._cancelHold();
    if (outcome === 'tap' && this._activeMarker && this.hass) {
      dispatchTapAction(this as unknown as { hass: HomeAssistant }, this._activeMarker.entity, this);
    } else if (outcome === 'hold' && this._activeMarker && !this._holdFired) {
      // hold timer didn't fire (e.g. test/no-timer path) but release is late
      dispatchHoldAction(this._activeMarker.entity, this);
    }
    this._activeMarker = null;
  };

  private _cancelHold() {
    if (this._holdTimer !== null) {
      window.clearTimeout(this._holdTimer);
      this._holdTimer = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Scene render (base + light), extracted for Phase 3/4 composition
  // ---------------------------------------------------------------------------

  /**
   * Base + light fragment, extracted so Phase 3 (gestures) and Phase 4
   * (effect layer) can call it inside the transformed scene. `cardWidth`
   * passed to renderLightLayer is always `this._cardWidth` (the scene
   * image-box width threaded everywhere — see Phase 5 `_viewport()`).
   */
  private _renderScene(): TemplateResult {
    const { images, options, entities } = this.config;
    const sun = this.hass?.states?.['sun.sun'];
    return html`${renderBaseLayer(images, options, sun)}
      ${renderLightLayer(this.hass, entities, options, images, this._cardWidth)}`;
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  protected render(): TemplateResult {
    if (!this.config?.images?.base) {
      return html`<ha-card><div class="warning">Please configure images.base.</div></ha-card>`;
    }
    const vp = this._viewport();
    const t = this._transform;
    const views = computeMarkerViews(
      this.config.entities,
      this.hass?.states ?? {},
      t,
      vp,
      null // overview: no zone focus until Phase 5
    );
    const sceneTransition = this._animating ? ApartmentViewCard.ZOOM_TRANSITION : 'none';
    return html`
      <ha-card>
        <div class="wrapper">
          <div
            class="scene"
            style="transform: translate(${t.panX}px, ${t.panY}px) scale(${t.scale}); transition: ${sceneTransition};"
            @pointerdown=${this._onScenePointerDown}
          >
            <!-- base-layer + light-layer come from Phase 2 render functions -->
            ${this._renderScene()}
          </div>
          ${renderMarkerOverlay(views, this._onMarkerPointerDown)}
        </div>
      </ha-card>
    `;
  }
}

// ---------------------------------------------------------------------------
// Exported action dispatchers (spec §5, tested in card-tap-action.test.ts)
// ---------------------------------------------------------------------------

/**
 * Spec §5 tap dispatch. toggle -> homeassistant.toggle; more-info -> native
 * dialog via fireEvent(el,'hass-more-info'); none -> no-op.
 */
export function dispatchTapAction(
  card: { hass: HomeAssistant },
  entity: EntityConfig,
  el: HTMLElement
): void {
  switch (entity.tap) {
    case 'toggle':
      card.hass.callService('homeassistant', 'toggle', {
        entity_id: entity.entity,
      });
      return;
    case 'more-info':
      fireEvent(el, 'hass-more-info', { entityId: entity.entity });
      return;
    case 'none':
    default:
      return;
  }
}

/** Press-and-hold (>=450ms) always opens the native more-info dialog. */
export function dispatchHoldAction(entity: EntityConfig, el: HTMLElement): void {
  fireEvent(el, 'hass-more-info', { entityId: entity.entity });
}

// --- Registration ---------------------------------------------------------
if (!(window as any).customCards) {
  (window as any).customCards = [];
}
if (
  !(window as any).customCards.find(
    (c: any) => c.type === 'apartment-view-card',
  )
) {
  (window as any).customCards.push({
    type: 'apartment-view-card',
    name: 'Apartment View Card',
    description:
      'Interactive, state-aware device markers and lighting over a floorplan render.',
    preview: true,
    documentationURL:
      'https://github.com/grozdanowski/ha-apartment-view-card',
  });
}
