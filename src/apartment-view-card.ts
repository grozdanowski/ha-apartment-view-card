import { LitElement, html, css, unsafeCSS, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { fireEvent } from 'custom-card-helpers';
import type { HomeAssistant } from 'custom-card-helpers';
import type { HassEntity } from './core/ha-types';
import { normalizeConfig, type ApartmentViewConfig, type EntityConfig, type ZoneConfig } from './core/config';
import './editor/apartment-view-card-editor';
import { renderBaseLayer } from './render/base-layer';
import { renderLightLayer } from './render/light-layer';
import { renderEffect, EFFECT_STYLES } from './render/effect-layer';
import { PanZoomController } from './core/pan-zoom';
import { TapHoldTracker, HOLD_MS, MOVE_THRESHOLD_PX } from './core/tap-hold';
import {
  computeMarkerViews,
  renderMarkerOverlay,
  type MarkerView,
} from './render/marker-overlay';
import { zoomToZone, type Viewport, type ZoomTransform } from './core/geometry';
import { buildZoneChips, type ZoneChip } from './render/zone-controls';
import { entityInFocusedZone } from './render/zone-focus';

interface MinimalHass {
  states: Record<string, HassEntity>;
  // Needed by Phase 3 dispatchTapAction (tap:toggle -> homeassistant.toggle).
  callService(domain: string, service: string, data?: any): Promise<void>;
}

@customElement('apartment-view-card')
export class ApartmentViewCard extends LitElement {
  // MIGRATION (v1 -> v2): v1 used ad-hoc `_scale` (clamped 0.5..3) + `_position`
  // with mouse-anchored wheel zoom and no zone awareness (old src/ApartmentViewCard.ts).
  // v2 unifies this into a single `_transform: ZoomTransform`. Free pan/zoom (Phase 3)
  // drives `_transform` directly; zone focus (Phase 5) drives it via geometry.zoomToZone.
  @property({ attribute: false }) public hass?: MinimalHass;
  @property({ attribute: false }) public config!: ApartmentViewConfig;
  @state() private _cardWidth = 600;
  @state() private _transform: ZoomTransform = { scale: 1, panX: 0, panY: 0 };
  @state() private _focusedZone: ZoneConfig | null = null;

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

  /** Locked transition string for scene layer and marker left/top/transform. */
  static readonly ZOOM_TRANSITION = 'transform 0.6s cubic-bezier(.4,0,.2,1)';

  static styles = [
    css`
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
      transition: left 0.6s cubic-bezier(.4,0,.2,1), top 0.6s cubic-bezier(.4,0,.2,1),
        transform 0.6s cubic-bezier(.4,0,.2,1),
        opacity 0.3s ease, background-color 0.3s ease, color 0.3s ease;
    }
    .marker-overlay .marker.active {
      background: var(--primary-color);
      color: var(--text-primary-color);
    }
    .marker-overlay .marker.dimmed {
      opacity: 0.25;
      pointer-events: none;
    }
    .marker-overlay .marker[disabled] {
      cursor: default;
      color: var(--disabled-text-color);
    }
    .zone-controls {
      display: flex;
      flex-direction: row;
      gap: 8px;
      overflow-x: auto;
      padding: 8px;
      scrollbar-width: thin;
    }
    .zone-chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      flex: 0 0 auto;
      padding: 6px 12px;
      border: none;
      border-radius: 16px;
      background: var(--secondary-background-color);
      color: var(--primary-text-color);
      cursor: pointer;
      white-space: nowrap;
      font: inherit;
    }
    .zone-chip:hover {
      background: var(--primary-color);
      color: var(--text-primary-color);
    }
    .zone-chip--back {
      background: var(--primary-color);
      color: var(--text-primary-color);
    }
    .zone-chip ha-icon {
      --mdc-icon-size: 18px;
    }
    :host(.is-focused) .wrapper {
      /* free pan/zoom is suppressed in JS; this is a styling hook only */
    }
  `,
    unsafeCSS(EFFECT_STYLES),
  ];

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

  static getStubConfig(): ApartmentViewConfig {
    return normalizeConfig({
      type: 'custom:apartment-view-card',
      images: { base: '/local/apartment/day.png' },
      entities: [],
      zones: [],
      options: {
        view: 'auto',
        lightStyle: 'lit',
        freePanZoom: true,
        zoomMax: 1.5,
        duskDawnOffsetMinutes: 60,
      },
    });
  }

  public connectedCallback(): void {
    super.connectedCallback();
    this.addEventListener('wheel', this._onWheel, { passive: false });
    window.addEventListener('pointermove', this._onWindowPointerMove);
    window.addEventListener('pointerup', this._onWindowPointerUp);
    window.addEventListener('pointercancel', this._onWindowPointerUp);
    window.addEventListener('keydown', this._handleKeyDown);
    if (!this.hasAttribute('tabindex')) this.setAttribute('tabindex', '0');
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
    window.removeEventListener('keydown', this._handleKeyDown);
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

  protected updated(): void {
    // Sync focus class on host so `:host(.is-focused)` CSS selector works.
    this.classList.toggle('is-focused', this._focusedZone !== null);
  }

  // ---------------------------------------------------------------------------
  // Viewport + PanZoom configuration
  // ---------------------------------------------------------------------------

  /**
   * Returns the .wrapper / scene image-box size.
   * width === this._cardWidth (same width passed to renderLightLayer and
   * markerScreenPos so zoomToZone's clamp and marker mapping agree).
   */
  private _viewport(): Viewport {
    const wrapper = this.renderRoot?.querySelector('.wrapper') as HTMLElement | null;
    const r = wrapper?.getBoundingClientRect();
    return { width: this._cardWidth, height: r?.height ?? 0 };
  }

  /** Apply zoomMax + freePanZoom gate whenever config changes. */
  private _syncPanZoomFromConfig(): void {
    this._panZoom = new PanZoomController({
      zoomMax: this.config.options.zoomMax,
    });
    // Overview: free pan/zoom only when enabled in options.
    this._panZoom.setEnabled(this.config.options.freePanZoom);
    this._transform = this._panZoom.transform;
  }

  // ---------------------------------------------------------------------------
  // Zone focus state machine (Phase 5)
  // ---------------------------------------------------------------------------

  private _focusZone(zone: ZoneConfig): void {
    this._focusedZone = zone;
    this._transform = zoomToZone(zone, this._viewport(), this.config.options.zoomMax);
    this._panZoom.setEnabled(false);
  }

  private _exitFocus(): void {
    this._focusedZone = null;
    this._transform = { scale: 1, panX: 0, panY: 0 };
    this._panZoom.setEnabled(this.config.options.freePanZoom);
  }

  private _onZoneChip(chip: ZoneChip): void {
    if (chip.kind === 'back') {
      this._exitFocus();
      return;
    }
    if (chip.zone) {
      this._focusZone(chip.zone);
    }
  }

  private _handleKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && this._focusedZone !== null) {
      e.preventDefault();
      this._exitFocus();
    }
  };

  // ---------------------------------------------------------------------------
  // Pointer / wheel handlers (named exactly per spec for Phase 5 compatibility)
  // ---------------------------------------------------------------------------

  private _onWheel = (e: WheelEvent) => {
    if (this._focusedZone !== null) return;
    e.preventDefault();
    const r = this.getBoundingClientRect();
    this._transform = this._panZoom.wheelZoom(
      e.deltaY,
      e.clientX - r.left,
      e.clientY - r.top
    );
  };

  private _onScenePointerDown = (e: PointerEvent) => {
    if (this._focusedZone !== null) return;
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    this._activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
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
    if (this._focusedZone !== null) return;
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
    if (this._focusedZone !== null) return;
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
      ${renderLightLayer(this.hass, entities, options, images, this._cardWidth)}
      ${entities.map((e) =>
        renderEffect(this.hass?.states?.[e.entity], e, this._cardWidth),
      )}`;
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

    // Build focused entity id set for marker dimming.
    const focusedZoneEntityIds =
      this._focusedZone === null
        ? null
        : new Set(
            this.config.entities
              .filter((e) =>
                entityInFocusedZone(e, this._focusedZone, this.config.zones),
              )
              .map((e) => e.entity),
          );

    const views = computeMarkerViews(
      this.config.entities,
      this.hass?.states ?? {},
      t,
      vp,
      focusedZoneEntityIds,
    );

    return html`
      <ha-card>
        <div class="wrapper">
          <div
            class="scene"
            style="transform: translate(${t.panX}px, ${t.panY}px) scale(${t.scale}); transition: ${ApartmentViewCard.ZOOM_TRANSITION};"
            @pointerdown=${this._onScenePointerDown}
          >
            <!-- base-layer + light-layer come from Phase 2 render functions -->
            ${this._renderScene()}
          </div>
          ${renderMarkerOverlay(views, this._onMarkerPointerDown)}
        </div>
        <div class="zone-controls" role="toolbar" aria-label="Zones">
          ${buildZoneChips(this.config.zones, this._focusedZone).map(
            (chip) => html`
              <button
                class="zone-chip ${chip.kind === 'back' ? 'zone-chip--back' : ''}"
                @click=${() => this._onZoneChip(chip)}
              >
                <ha-icon .icon=${chip.icon}></ha-icon>
                <span>${chip.label}</span>
              </button>
            `,
          )}
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
