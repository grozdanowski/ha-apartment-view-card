import { LitElement, html, css, unsafeCSS, nothing, type TemplateResult, type PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { fireEvent } from 'custom-card-helpers';
import type { HassLike } from './core/ha-types';
import { normalizeConfig, type ApartmentViewConfig, type EntityConfig, type ZoneConfig, type QuickAction, type ImagesConfig } from './core/config';
import './editor/apartment-view-card-editor';
import { renderBaseLayer, weatherTint } from './render/base-layer';
import { renderLightLayer } from './render/light-layer';
import { renderEffect, EFFECT_STYLES } from './render/effect-layer';
import { PanZoomController } from './core/pan-zoom';
import { TapHoldTracker, HOLD_MS, MOVE_THRESHOLD_PX } from './core/tap-hold';
import {
  computeMarkerViews,
  renderMarkerOverlay,
  type MarkerView,
} from './render/marker-overlay';
import { zoomToZone, markerScreenPos, type Viewport, type ZoomTransform } from './core/geometry';
import { buildZoneChips, type ZoneChip } from './render/zone-controls';
import { entityInFocusedZone } from './render/zone-focus';
import './render/control-surface';
import { controlKind, controlTarget } from './core/entity-capabilities';

@customElement('apartment-view-card')
export class ApartmentViewCard extends LitElement {
  // MIGRATION (v1 -> v2): v1 used ad-hoc `_scale` (clamped 0.5..3) + `_position`
  // with mouse-anchored wheel zoom and no zone awareness (old src/ApartmentViewCard.ts).
  // v2 unifies this into a single `_transform: ZoomTransform`. Free pan/zoom (Phase 3)
  // drives `_transform` directly; zone focus (Phase 5) drives it via geometry.zoomToZone.
  @property({ attribute: false }) public hass?: HassLike;
  @property({ attribute: false }) public config!: ApartmentViewConfig;
  @state() private _cardWidth = 600;
  @state() private _transform: ZoomTransform = { scale: 1, panX: 0, panY: 0 };
  @state() private _focusedZone: ZoneConfig | null = null;
  /** Entities currently driven by the control surface (empty = closed). */
  @state() private _controlled: string[] = [];
  /** "Lights control" multi-select mode. */
  @state() private _selectMode = false;
  /** Transient: pulse the attention markers to help locate them. */
  @state() private _pulse = false;
  private _pulseTimer?: ReturnType<typeof setTimeout>;
  /** Radial quick-actions menu open state. */
  @state() private _quickOpen = false;
  /** Active floor index (multi-floor) + a transient cross-fade flag. */
  @state() private _floor = 0;
  @state() private _floorFading = false;
  private _floorFadeTimer?: ReturnType<typeof setTimeout>;
  /** Transient motion ripples (presence sensors firing), capped + auto-decaying. */
  @state() private _ripples: Array<{ key: number; left: number; top: number }> = [];
  private _rippleSeq = 0;

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
  private _aspectListenerSrc?: string;

  static styles = [
    css`
    :host {
      display: block;
    }
    .wrapper {
      position: relative;
      width: 100%;
      /* Self-size from the base image's aspect ratio (set by _syncAspect on load)
         so the card has real height in masonry / vertical-stack / panel / the
         card-picker preview — not only HA's sections/grid layout. */
      aspect-ratio: var(--av-aspect, 16 / 9);
      min-height: 120px;
      overflow: hidden;
      touch-action: none; /* let us own pinch/pan */
      /* 3D context for the zone-focus perspective tilt. */
      perspective: 1300px;
      perspective-origin: 50% 44%;
    }
    /* Tilts the scene + marker overlay together on zone focus (they stay aligned;
       markers remain crisp). The Lights-control button sits outside, staying flat. */
    .tilt {
      position: absolute;
      inset: 0;
      transform-origin: 50% 50%;
      transform-style: preserve-3d;
      transition: transform 0.6s cubic-bezier(0.4, 0, 0.2, 1);
    }
    .scene {
      position: absolute;
      inset: 0;
      transform-origin: 0 0;
      will-change: transform;
      /* Transition lives here (not inline) so prefers-reduced-motion can cancel it. */
      transition: transform 0.6s cubic-bezier(0.4, 0, 0.2, 1);
    }
    .base-image {
      display: block;
      width: 100%;
      height: auto;
    }
    /* ambient weather tint over the floorplan (soft-light) */
    .weather-tint {
      position: absolute;
      inset: 0;
      pointer-events: none;
      mix-blend-mode: soft-light;
      transition: background 1.2s ease;
    }
    /* multi-floor switcher + cross-fade */
    .floors {
      display: flex;
      gap: 4px;
      padding: 8px 8px 0;
      flex-wrap: wrap;
    }
    .floor-tab {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 7px 14px;
      border: none;
      border-radius: 16px;
      cursor: pointer;
      font: inherit;
      font-size: 13px;
      font-weight: 500;
      color: var(--secondary-text-color);
      background: color-mix(in srgb, var(--primary-text-color, #fff) 6%, transparent);
      --mdc-icon-size: 16px;
      transition: background-color 0.2s ease, color 0.2s ease;
    }
    .floor-tab.active {
      background: var(--primary-color, #03a9f4);
      color: var(--text-primary-color, #fff);
    }
    .scene.floor-fade {
      animation: av-floor-fade 0.42s ease;
    }
    @keyframes av-floor-fade {
      from { opacity: 0.25; }
      to { opacity: 1; }
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
      /* >=44px hit area for touch (icon stays ~22px, centered). */
      min-width: 44px;
      min-height: 44px;
      transform: translate(-50%, -50%);
      display: grid;
      place-items: center;
      border: none;
      border-radius: 50%;
      padding: 0;
      cursor: pointer;
      pointer-events: auto;
      color: var(--primary-text-color);
      --mdc-icon-size: 22px;
      /* Frosted, dimensional chip that floats above the floorplan. The
         translucent fill + backdrop blur read on any image; the inset hairline
         gives a crisp edge on light and dark themes alike. */
      background: color-mix(in srgb, var(--card-background-color, #1c1c1e) 68%, transparent);
      -webkit-backdrop-filter: blur(8px) saturate(1.4);
      backdrop-filter: blur(8px) saturate(1.4);
      box-shadow:
        0 4px 14px rgba(0, 0, 0, 0.42),
        inset 0 0 0 1px rgba(255, 255, 255, 0.14);
      transition: left 0.6s cubic-bezier(.4,0,.2,1), top 0.6s cubic-bezier(.4,0,.2,1),
        transform 0.6s cubic-bezier(.4,0,.2,1),
        scale 0.26s cubic-bezier(.34,1.56,.64,1),
        box-shadow 0.4s ease, opacity 0.3s ease, color 0.4s ease;
    }
    /* press feedback — the individual 'scale' property composes with the
       positioning transform (translate + icon scale) without clobbering it. */
    .marker-overlay .marker:active {
      scale: 0.86;
    }
    .marker-overlay .marker:focus-visible,
    .zone-chip:focus-visible {
      outline: 2px solid var(--primary-color);
      outline-offset: 2px;
    }
    .marker-overlay .marker.active {
      /* bloom in the light's actual colour (--marker-glow set inline); the icon
         picks up the colour too so the chip feels lit from within. The concrete
         #03a9f4 fallback (HA's default primary) is required — an undefined
         --primary-color would invalidate the whole box-shadow (-> none). */
      --av-accent: var(--marker-glow, var(--primary-color, #03a9f4));
      color: var(--av-accent);
      box-shadow:
        0 4px 14px rgba(0, 0, 0, 0.42),
        inset 0 0 0 1px color-mix(in srgb, var(--av-accent) 55%, rgba(255, 255, 255, 0.14)),
        0 0 18px 1px color-mix(in srgb, var(--av-accent) 72%, transparent),
        0 0 5px 0 var(--av-accent);
    }
    .marker-overlay .marker.dimmed {
      opacity: 0.25;
      pointer-events: none;
    }
    .marker-overlay .marker[disabled] {
      cursor: default;
      color: var(--disabled-text-color);
    }
    /* "Lights control" multi-select mode */
    .marker-overlay .marker.select-dim {
      opacity: 0.28;
      pointer-events: none;
      filter: grayscale(0.5);
    }
    .marker-overlay .marker.selectable {
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.35), inset 0 0 0 1.5px rgba(255, 255, 255, 0.42);
    }
    .marker-overlay .marker.selected {
      scale: 1.05;
    }
    .marker-overlay .marker-check {
      position: absolute;
      right: -4px;
      top: -4px;
      width: 18px;
      height: 18px;
      border-radius: 50%;
      display: grid;
      place-items: center;
      --mdc-icon-size: 12px;
      background: var(--card-background-color, #15171c);
      color: transparent;
      box-shadow: 0 0 0 2px var(--card-background-color, #15171c), inset 0 0 0 1.5px rgba(255, 255, 255, 0.55);
    }
    .marker-overlay .marker.selected .marker-check {
      background: var(--primary-color, #03a9f4);
      color: var(--text-primary-color, #fff);
      box-shadow: 0 0 0 2px var(--card-background-color, #15171c), inset 0 0 0 1.5px var(--primary-color, #03a9f4);
    }
    /* Offline (unavailable/unknown): desaturated chip + dashed ring, no glow. */
    .marker-overlay .marker.offline {
      filter: grayscale(0.85);
      opacity: 0.55;
    }
    .marker-overlay .marker.offline::after {
      content: '';
      position: absolute;
      inset: -2px;
      border-radius: 50%;
      border: 1.5px dashed var(--secondary-text-color, #8a8f98);
    }
    /* Dynamic value label — frosted plate guarantees contrast on any floorplan. */
    .marker-overlay .marker-label {
      position: absolute;
      transform: translate(-50%, var(--label-dy, 26px));
      max-inline-size: var(--av-label-max-width, 8em);
      padding: 2px 7px;
      border-radius: 7px;
      font-size: 11px;
      line-height: 1.4;
      font-weight: 500;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      pointer-events: none;
      z-index: 1;
      color: var(--primary-text-color, #f5f5f7);
      background: color-mix(in srgb, var(--card-background-color, #1c1c1e) 72%, transparent);
      -webkit-backdrop-filter: blur(6px) saturate(1.3);
      backdrop-filter: blur(6px) saturate(1.3);
      box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.12), 0 2px 8px rgba(0, 0, 0, 0.35);
      transition: opacity 0.25s ease;
    }
    .marker-overlay .marker-label.anchor-start {
      transform: translate(-12px, var(--label-dy, 26px));
    }
    .marker-overlay .marker-label.anchor-end {
      transform: translate(calc(-100% + 12px), var(--label-dy, 26px));
    }
    /* attention badge on the marker corner (auto-derived: open/leak/unlocked/battery/offline) */
    .marker-overlay .marker-badge {
      position: absolute;
      right: -3px;
      top: -3px;
      width: 17px;
      height: 17px;
      border-radius: 50%;
      display: grid;
      place-items: center;
      --mdc-icon-size: 11px;
      color: #fff;
      box-shadow: 0 0 0 2px var(--card-background-color, #15171c);
    }
    .marker-overlay .marker-badge.sev-critical { background: var(--error-color, #db4437); }
    .marker-overlay .marker-badge.sev-warning { background: var(--warning-color, #ffa600); color: #1c1c1e; }
    .marker-overlay .marker-badge.sev-info { background: var(--secondary-text-color, #8a8f98); }
    /* pulse-to-locate when the "N need attention" pill is tapped */
    .marker-overlay.pulse .marker.has-attention {
      animation: av-attention 0.55s ease 0s 3;
    }
    @keyframes av-attention {
      0%, 100% { box-shadow: 0 4px 14px rgba(0, 0, 0, 0.42), inset 0 0 0 1px rgba(255, 255, 255, 0.14); }
      50% { box-shadow: 0 0 0 7px color-mix(in srgb, var(--warning-color, #ffa600) 55%, transparent), 0 4px 14px rgba(0, 0, 0, 0.42); }
    }
    .attention-pill {
      position: absolute;
      top: 10px;
      left: 10px;
      z-index: 6;
      display: inline-flex;
      align-items: center;
      gap: 7px;
      height: 34px;
      padding: 0 14px;
      border: none;
      border-radius: 17px;
      cursor: pointer;
      pointer-events: auto;
      font: inherit;
      font-size: 13px;
      font-weight: 500;
      color: var(--primary-text-color);
      background: color-mix(in srgb, var(--card-background-color, #1c1e24) 60%, transparent);
      -webkit-backdrop-filter: blur(14px) saturate(1.5);
      backdrop-filter: blur(14px) saturate(1.5);
      box-shadow: inset 0 0 0 1px var(--divider-color, rgba(255, 255, 255, 0.14)), 0 4px 14px rgba(0, 0, 0, 0.35);
      transition: scale 0.18s cubic-bezier(.34, 1.56, .64, 1);
      --mdc-icon-size: 16px;
    }
    .attention-pill ha-icon { color: var(--warning-color, #ffa600); }
    .attention-pill:active { scale: 0.96; }
    /* presence/motion ripple — a one-shot expanding pulse where motion fires */
    .ripple-layer {
      position: absolute;
      inset: 0;
      pointer-events: none;
      z-index: 0;
    }
    .motion-ripple {
      position: absolute;
      width: 16px;
      height: 16px;
      border-radius: 50%;
      transform: translate(-50%, -50%);
      background: radial-gradient(circle, color-mix(in srgb, var(--primary-color, #03a9f4) 55%, transparent), transparent 70%);
      animation: av-ripple 1.4s cubic-bezier(0.22, 1, 0.36, 1) forwards;
    }
    @keyframes av-ripple {
      from { opacity: 0.7; scale: 0.3; }
      to { opacity: 0; scale: 4.5; }
    }
    .lights-control {
      position: absolute;
      top: 10px;
      right: 10px;
      z-index: 6;
      display: inline-flex;
      align-items: center;
      gap: 7px;
      height: 34px;
      padding: 0 14px;
      border: none;
      border-radius: 17px;
      cursor: pointer;
      pointer-events: auto;
      font: inherit;
      font-size: 13px;
      font-weight: 500;
      color: var(--primary-text-color);
      background: color-mix(in srgb, var(--card-background-color, #1c1e24) 60%, transparent);
      -webkit-backdrop-filter: blur(14px) saturate(1.5);
      backdrop-filter: blur(14px) saturate(1.5);
      box-shadow: inset 0 0 0 1px var(--divider-color, rgba(255, 255, 255, 0.14)), 0 4px 14px rgba(0, 0, 0, 0.35);
      transition: scale 0.18s cubic-bezier(.34, 1.56, .64, 1), background-color 0.2s ease;
      --mdc-icon-size: 16px;
    }
    .lights-control.active {
      background: var(--primary-color, #03a9f4);
      color: var(--text-primary-color, #fff);
    }
    .lights-control:active {
      scale: 0.96;
    }
    /* radial quick-actions menu */
    .quick {
      position: absolute;
      bottom: 12px;
      right: 12px;
      z-index: 7;
      pointer-events: none;
    }
    .quick-fab {
      position: relative;
      z-index: 2;
      width: 48px;
      height: 48px;
      border-radius: 50%;
      border: none;
      cursor: pointer;
      pointer-events: auto;
      display: grid;
      place-items: center;
      color: var(--text-primary-color, #fff);
      background: var(--primary-color, #03a9f4);
      box-shadow: 0 6px 18px rgba(0, 0, 0, 0.42);
      --mdc-icon-size: 24px;
      transition: transform 0.25s cubic-bezier(.34, 1.56, .64, 1);
    }
    .quick.open .quick-fab {
      transform: rotate(135deg);
    }
    .quick-action {
      position: absolute;
      right: 4px;
      bottom: 4px;
      width: 40px;
      height: 40px;
      border-radius: 50%;
      border: none;
      cursor: pointer;
      pointer-events: auto;
      display: grid;
      place-items: center;
      color: var(--primary-text-color);
      background: color-mix(in srgb, var(--card-background-color, #1c1e24) 78%, transparent);
      -webkit-backdrop-filter: blur(12px) saturate(1.4);
      backdrop-filter: blur(12px) saturate(1.4);
      box-shadow: inset 0 0 0 1px var(--divider-color, rgba(255, 255, 255, 0.16)), 0 4px 12px rgba(0, 0, 0, 0.4);
      --mdc-icon-size: 20px;
      transform: translate(0, 0) scale(0.3);
      opacity: 0;
      transition: transform 0.3s cubic-bezier(.34, 1.56, .64, 1), opacity 0.2s ease;
      transition-delay: var(--qd, 0s);
    }
    .quick.open .quick-action {
      transform: translate(var(--qx, 0), var(--qy, 0)) scale(1);
      opacity: 1;
    }
    .zone-controls {
      display: flex;
      flex-direction: row;
      gap: 8px;
      overflow-x: auto;
      padding: 8px;
      scrollbar-width: thin;
    }
    .control-surface {
      display: block;
      padding: 0 8px 8px;
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
    /* hover-only so a tap on a touch device doesn't leave the chip stuck
       in the highlight state (which is identical to the --back state). */
    @media (hover: hover) {
      .zone-chip:hover {
        background: var(--primary-color);
        color: var(--text-primary-color);
      }
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
    @media (prefers-reduced-motion: reduce) {
      .scene {
        transition: none;
      }
      .marker-overlay .marker-label {
        transition: none;
      }
      .marker-overlay.pulse .marker.has-attention {
        animation: none;
      }
      .quick-action,
      .quick-fab {
        transition: none;
      }
      .scene.floor-fade {
        animation: none;
      }
      .tilt {
        transition: none;
        transform: none !important;
      }
      .marker-overlay .marker {
        transition: opacity 0.3s ease, background-color 0.3s ease, color 0.3s ease;
      }
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

  // Self-contained placeholder so the card-picker preview shows a clean
  // "configure me" panel instead of a 404 to a path that does not exist yet.
  static readonly STUB_BASE_IMAGE =
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='320' height='200'%3E%3Crect width='320' height='200' fill='%23263238'/%3E%3Crect x='24' y='24' width='272' height='152' rx='8' fill='none' stroke='%2390a4ae' stroke-width='2' stroke-dasharray='8 6'/%3E%3Ctext x='160' y='106' fill='%2390a4ae' font-family='sans-serif' font-size='14' text-anchor='middle'%3ESet images.base to your floorplan%3C/text%3E%3C/svg%3E";

  // HA calls getStubConfig(hass, entities); params accepted for future seeding.
  static getStubConfig(): ApartmentViewConfig {
    return normalizeConfig({
      type: 'custom:apartment-view-card',
      images: { base: ApartmentViewCard.STUB_BASE_IMAGE },
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
    clearTimeout(this._pulseTimer);
    clearTimeout(this._floorFadeTimer);
    this._cancelHold();
    this._ro?.disconnect();
    this._ro = undefined;
  }

  /**
   * Perf gate: HA replaces the whole `hass` object on every state change across
   * the entire dashboard. Without this, the card would rebuild all light/effect
   * layers on every unrelated tick. Re-render only when an entity we draw (or
   * sun.sun, for time-of-day) actually changed — or when any other reactive
   * property (config, transform, focus, width) changed.
   */
  protected shouldUpdate(changed: PropertyValues): boolean {
    if (changed.size > 1 || !changed.has('hass')) return true;
    const prev = changed.get('hass') as HassLike | undefined;
    return this._relevantStateChanged(prev, this.hass);
  }

  private _relevantStateChanged(prev?: HassLike, next?: HassLike): boolean {
    if (!prev || !next) return true;
    const weather = this.config?.options?.weatherEntity;
    const ids = [
      'sun.sun',
      ...(weather ? [weather] : []),
      ...(this.config ? this._floorData.entities.map((e) => e.entity) : []),
    ];
    return ids.some((id) => prev.states?.[id] !== next.states?.[id]);
  }

  protected willUpdate(changed: PropertyValues): void {
    if (changed.has('hass')) this._detectMotion(changed.get('hass') as HassLike | undefined);
  }

  private _reducedMotion(): boolean {
    return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  }

  private _isMotion(entity: EntityConfig): boolean {
    if (!entity.entity.startsWith('binary_sensor.')) return false;
    const dc = this.hass?.states?.[entity.entity]?.attributes?.device_class;
    return dc === 'motion' || dc === 'occupancy' || dc === 'presence' || dc === 'moving';
  }

  /** Emit a ripple where a presence sensor just transitioned off->on. */
  private _detectMotion(prev?: HassLike): void {
    if (!prev || !this.hass || this._reducedMotion()) return; // no ripple on first paint
    for (const e of this.config ? this._floorData.entities : []) {
      if (!this._isMotion(e)) continue;
      const now = this.hass.states[e.entity];
      if (!now || now.state !== 'on') continue;
      if (prev.states?.[e.entity]?.state === 'on') continue; // already on -> not a new trigger
      this._fireRipple(e);
    }
  }

  private _fireRipple(entity: EntityConfig): void {
    const { left, top } = markerScreenPos(entity.x, entity.y, this._transform, this._viewport());
    const key = ++this._rippleSeq;
    let ripples = [...this._ripples, { key, left, top }];
    if (ripples.length > 3) ripples = ripples.slice(ripples.length - 3); // cap concurrent
    this._ripples = ripples;
    setTimeout(() => {
      this._ripples = this._ripples.filter((r) => r.key !== key);
    }, 1400);
  }

  protected firstUpdated(): void {
    const wrapper = this.renderRoot.querySelector('.wrapper');
    // Let the ResizeObserver deliver the first width asynchronously. Setting the
    // reactive _cardWidth synchronously here would schedule a second update inside
    // the just-finished one (Lit "scheduled an update after an update completed").
    if (wrapper) this._ro?.observe(wrapper);
    this._syncAspect();
  }

  protected updated(): void {
    // Sync focus class on host so `:host(.is-focused)` CSS selector works.
    this.classList.toggle('is-focused', this._focusedZone !== null);
    this._syncAspect();
  }

  /**
   * Drive `--av-aspect` from the base image's natural dimensions so the card
   * self-sizes (see `.wrapper { aspect-ratio }`). Falls back to 16/9 until the
   * image loads. Uses a direct style mutation (not reactive state) so it never
   * re-enters the update cycle.
   */
  private _syncAspect = (): void => {
    const img = this.renderRoot?.querySelector('.base-image') as HTMLImageElement | null;
    if (!img) return;
    const apply = (): void => {
      if (img.naturalWidth > 0 && img.naturalHeight > 0) {
        this.style.setProperty('--av-aspect', `${img.naturalWidth} / ${img.naturalHeight}`);
      }
    };
    if (img.complete && img.naturalWidth > 0) {
      apply();
    } else if (img.src !== this._aspectListenerSrc) {
      this._aspectListenerSrc = img.src;
      img.addEventListener('load', apply, { once: true });
    }
  };

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
    if (e.key !== 'Escape') return;
    if (this._quickOpen) {
      e.preventDefault();
      this._quickOpen = false;
      return;
    }
    if (this._controlled.length || this._selectMode) {
      e.preventDefault();
      this._closeControl();
    } else if (this._focusedZone !== null) {
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

  /**
   * Keyboard activation (Enter/Space) on a focused marker. Pointer taps run
   * through the gesture machinery above; the marker template guards this on
   * `detail === 0` so it fires for keyboard only (no double-action on click).
   */
  private _onMarkerActivate = (m: MarkerView): void => {
    this._activateEntity(m.entity);
  };

  /**
   * A tap on a marker. Controllable entities (light/media_player/climate) open
   * the on-floorplan control surface; everything else keeps its configured tap
   * action (toggle / more-info / none).
   */
  private _activateEntity(entity: EntityConfig): void {
    if (!this.hass) return;
    if (this._selectMode) {
      // Only lights are selectable, scoped to the focused zone if any.
      if (controlKind(entity.entity) !== 'light') return;
      if (this._focusedZone && !entityInFocusedZone(entity, this._focusedZone, this._floorData.zones)) return;
      this._controlled = this._controlled.includes(entity.entity)
        ? this._controlled.filter((id) => id !== entity.entity)
        : [...this._controlled, entity.entity];
      return;
    }
    // Explicit tap overrides win on controllable entities (e.g. a light that
    // should open more-info instead of the control surface).
    if (entity.tap === 'more-info') {
      dispatchTapAction({ hass: this.hass }, entity, this);
      return;
    }
    if (entity.tap === 'none') return;
    const { kind, ids } = controlTarget(entity.entity, this.hass.states);
    if (kind !== 'none') {
      this._controlled = ids;
    } else {
      dispatchTapAction({ hass: this.hass }, entity, this);
    }
  }

  private _closeControl = (): void => {
    this._controlled = [];
    this._selectMode = false;
  };

  /** Briefly pulse the attention markers so the eye can find them. */
  private _pulseAttention = (): void => {
    clearTimeout(this._pulseTimer);
    this._pulse = true;
    this._pulseTimer = setTimeout(() => {
      this._pulse = false;
    }, 1400);
  };

  /** Configured quick actions, plus a contextual "turn off this room" while a zone is focused. */
  private _quickActionList(): QuickAction[] {
    const list = [...(this.config.quickActions ?? [])];
    if (this._focusedZone) {
      const lights = this._lightsInZone(this._focusedZone);
      if (lights.length) {
        list.unshift({
          name: `Turn off ${this._focusedZone.name}`,
          icon: 'mdi:lightbulb-off',
          service: 'light.turn_off',
          data: { entity_id: lights },
        });
      }
    }
    return list;
  }

  /** The active floor's images/entities/zones (or the top-level config when single-floor). */
  private get _floorData(): { images: ImagesConfig; entities: EntityConfig[]; zones: ZoneConfig[] } {
    const f = this.config.floors;
    if (f && f.length) return f[Math.min(this._floor, f.length - 1)];
    return this.config;
  }

  private _switchFloor(i: number): void {
    if (i === this._floor) return;
    this._exitFocus();
    this._controlled = [];
    this._selectMode = false;
    this._floor = i;
    this._floorFading = true;
    clearTimeout(this._floorFadeTimer);
    this._floorFadeTimer = setTimeout(() => {
      this._floorFading = false;
    }, 420);
  }

  private _runQuickAction(qa: QuickAction): void {
    if (this.hass) {
      if (qa.service) {
        const dot = qa.service.indexOf('.');
        this.hass.callService(qa.service.slice(0, dot), qa.service.slice(dot + 1), qa.data ?? {});
      } else if (qa.entity) {
        this.hass.callService('homeassistant', 'turn_on', { entity_id: qa.entity });
      }
    }
    this._quickOpen = false;
  }

  /** "Lights control" toggle: enter multi-select (pre-checking the focused zone's lights) or exit. */
  private _toggleSelectMode = (): void => {
    if (this._selectMode) {
      this._selectMode = false;
      this._controlled = [];
      return;
    }
    this._selectMode = true;
    this._controlled = this._focusedZone ? this._lightsInZone(this._focusedZone) : [];
  };

  private _lightsInZone(zone: ZoneConfig): string[] {
    return this._floorData.entities
      .filter((e) => controlKind(e.entity) === 'light' && entityInFocusedZone(e, zone, this._floorData.zones))
      .map((e) => e.entity);
  }

  private _hasLights(): boolean {
    return this._floorData.entities.some((e) => controlKind(e.entity) === 'light');
  }

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
      this._activateEntity(this._activeMarker.entity);
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
    const { options } = this.config;
    const { images, entities } = this._floorData;
    const sun = this.hass?.states?.['sun.sun'];
    const tint = options.weatherEntity
      ? weatherTint(this.hass?.states?.[options.weatherEntity])
      : null;
    return html`${renderBaseLayer(images, options, sun)}
      ${renderLightLayer(this.hass, entities, options, images, this._cardWidth)}
      ${entities.map((e) =>
        renderEffect(this.hass?.states?.[e.entity], e, this._cardWidth),
      )}
      ${tint ? html`<div class="weather-tint" style="background:${tint}"></div>` : nothing}`;
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
            this._floorData.entities
              .filter((e) =>
                entityInFocusedZone(e, this._focusedZone, this._floorData.zones),
              )
              .map((e) => e.entity),
          );

    const views = computeMarkerViews(
      this._floorData.entities,
      this.hass?.states ?? {},
      t,
      vp,
      focusedZoneEntityIds,
      this._selectMode,
      new Set(this._controlled),
      this.config.options.labels,
      this.hass,
    );
    const attentionCount = views.filter((v) => v.attention).length;

    const floors = this.config.floors ?? [];

    return html`
      <ha-card>
        ${floors.length > 1
          ? html`<div class="floors" role="tablist" aria-label="Floors">
              ${floors.map(
                (fl, i) => html`<button
                  role="tab"
                  class="floor-tab ${i === this._floor ? 'active' : ''}"
                  aria-selected=${i === this._floor ? 'true' : 'false'}
                  @click=${() => this._switchFloor(i)}
                >
                  ${fl.icon ? html`<ha-icon icon=${fl.icon}></ha-icon>` : nothing}<span>${fl.name}</span>
                </button>`,
              )}
            </div>`
          : nothing}
        <div class="wrapper">
          <div
            class="tilt"
            style="transform: ${this._focusedZone ? 'rotateX(11deg)' : 'none'};"
          >
            <div
              class="scene ${this._floorFading ? 'floor-fade' : ''}"
              style="transform: translate(${t.panX}px, ${t.panY}px) scale(${t.scale});"
              @pointerdown=${this._onScenePointerDown}
            >
              <!-- base-layer + light-layer come from Phase 2 render functions -->
              ${this._renderScene()}
            </div>
            ${renderMarkerOverlay(views, this._onMarkerPointerDown, this._onMarkerActivate, this._pulse)}
            ${this._ripples.length
              ? html`<div class="ripple-layer">
                  ${repeat(
                    this._ripples,
                    (r) => r.key,
                    (r) => html`<span class="motion-ripple" style="left:${r.left}px;top:${r.top}px"></span>`,
                  )}
                </div>`
              : nothing}
          </div>
          ${attentionCount > 0 && !this._selectMode
            ? html`<button
                class="attention-pill"
                @click=${this._pulseAttention}
                title="Locate items that need attention"
              >
                <ha-icon icon="mdi:alert-circle"></ha-icon>
                <span>${attentionCount} need${attentionCount === 1 ? 's' : ''} attention</span>
              </button>`
            : nothing}
          ${this._hasLights()
            ? html`<button
                class="lights-control ${this._selectMode ? 'active' : ''}"
                @click=${this._toggleSelectMode}
                aria-pressed=${this._selectMode}
              >
                <ha-icon icon="mdi:tune-variant"></ha-icon>
                <span>${this._selectMode ? 'Done' : 'Lights control'}</span>
              </button>`
            : nothing}
          ${this._renderQuickActions()}
        </div>
        <div class="zone-controls" role="toolbar" aria-label="Zones">
          ${buildZoneChips(this._floorData.zones, this._focusedZone).map(
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
        ${this._renderControlSurface()}
      </ha-card>
    `;
  }

  private _renderQuickActions(): TemplateResult | typeof nothing {
    const actions = this._quickActionList();
    if (!actions.length || this._selectMode) return nothing;
    const R = 80;
    return html`
      <div class="quick ${this._quickOpen ? 'open' : ''}">
        ${actions.map((qa, i) => {
          const t = actions.length === 1 ? 0.5 : i / (actions.length - 1);
          const ang = Math.PI + t * (Math.PI / 2); // 180° (left) -> 270° (up)
          const dx = Math.cos(ang) * R;
          const dy = Math.sin(ang) * R;
          return html`<button
            class="quick-action"
            style="--qx:${dx.toFixed(1)}px;--qy:${dy.toFixed(1)}px;--qd:${(i * 0.03).toFixed(2)}s"
            title=${qa.name}
            aria-label=${qa.name}
            tabindex=${this._quickOpen ? '0' : '-1'}
            @click=${() => this._runQuickAction(qa)}
          ><ha-icon icon=${qa.icon ?? 'mdi:flash'}></ha-icon></button>`;
        })}
        <button
          class="quick-fab"
          aria-label="Quick actions"
          aria-expanded=${this._quickOpen}
          @click=${() => {
            this._quickOpen = !this._quickOpen;
          }}
        >
          <ha-icon icon=${this._quickOpen ? 'mdi:close' : 'mdi:flash'}></ha-icon>
        </button>
      </div>
    `;
  }

  private _renderControlSurface(): TemplateResult | typeof nothing {
    if (!this._controlled.length && !this._selectMode) return nothing;
    return html`<av-control-surface
      class="control-surface"
      .hass=${this.hass}
      .entityIds=${this._controlled}
      .selectMode=${this._selectMode}
      @surface-close=${this._closeControl}
    ></av-control-surface>`;
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
  card: { hass: HassLike },
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
interface CustomCardEntry {
  type: string;
  name: string;
  description?: string;
  preview?: boolean;
  documentationURL?: string;
}
declare global {
  interface Window {
    customCards?: CustomCardEntry[];
  }
}

window.customCards = window.customCards ?? [];
if (!window.customCards.find((c) => c.type === 'apartment-view-card')) {
  window.customCards.push({
    type: 'apartment-view-card',
    name: 'Apartment View Card',
    description:
      'Interactive, state-aware device markers and lighting over a floorplan render.',
    preview: true,
    documentationURL: 'https://github.com/grozdanowski/ha-apartment-view-card',
  });
}
