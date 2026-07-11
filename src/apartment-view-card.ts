import { LitElement, html, css, unsafeCSS, nothing, type TemplateResult, type PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { guard } from 'lit/directives/guard.js';
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
  type FrozenLabel,
  type MarkerView,
} from './render/marker-overlay';
import { zoomToZone, markerScreenPos, type Viewport, type ZoomTransform } from './core/geometry';
import { buildZoneChips, type ZoneChip } from './render/zone-controls';
import { entityInFocusedZone } from './render/zone-focus';
import './render/control-surface';
import { controlKind, controlTarget } from './core/entity-capabilities';

/** Room-swipe recognition while focused (spec P0-1): min horizontal travel + max duration. */
const SWIPE_MIN_PX = 56;
const SWIPE_MAX_MS = 350;

/**
 * Numeric twin of the --av-dur-slow motion token (camera moves). The
 * is-animating fallback timer fires at CAMERA_MS + 80 for environments
 * without transition events (tests, reduced motion, hidden tabs).
 */
const CAMERA_MS = 560;

/**
 * One-shot "modifier + scroll to zoom" hint (spec P0-3): module-level flag =
 * once per session, across every card instance on the dashboard.
 */
let wheelHintShown = false;
/** Hint visible-hold before the fade-out starts (opacity only). */
const WHEEL_HINT_HOLD_MS = 1600;
/** Covers the --av-dur-fast fade-out before the pill unrenders. */
const WHEEL_HINT_FADE_MS = 260;

function wheelHintText(): string {
  const mac = /mac|iphone|ipad|ipod/i.test(navigator.platform ?? '');
  return `${mac ? '⌘' : 'Ctrl'} + scroll to zoom`;
}

@customElement('apartment-view-card')
export class ApartmentViewCard extends LitElement {
  // MIGRATION (v1 -> v2): v1 used ad-hoc `_scale` (clamped 0.5..3) + `_position`
  // with mouse-anchored wheel zoom and no zone awareness (old src/ApartmentViewCard.ts).
  // v2 unifies this into a single `_transform: ZoomTransform`. Free pan/zoom (Phase 3)
  // drives `_transform` directly; zone focus (Phase 5) drives it via geometry.zoomToZone.
  @property({ attribute: false }) public hass?: HassLike;
  @property({ attribute: false }) public config!: ApartmentViewConfig;
  @state() private _cardWidth = 600;
  /**
   * Base image aspect (naturalHeight / naturalWidth); null until the image
   * loads. The overlay viewport height is DERIVED from this (width × aspect)
   * because the image renders at `width:100%; height:auto` — marker math must
   * never depend on wrapper-rect timing (the root cause of the marker drift
   * on initial render / resize: the rect height was read once at render time
   * and nothing re-rendered when the loaded image changed the wrapper height).
   */
  @state() private _imgAspect: number | null = null;
  /** Markers stay hidden until image + geometry are ready, then fade in place. */
  @state() private _revealed = false;
  @state() private _transform: ZoomTransform = { scale: 1, panX: 0, panY: 0 };
  /**
   * A machine camera move is in flight (drives `.wrapper.is-animating`,
   * which enables the scene/tilt/marker transform transitions). Set by
   * _animateTransformTo only — direct gesture writes stay 1:1 (doctrine L2).
   */
  @state() private _isAnimating = false;
  /**
   * A pan/pinch movement has latched (drives `.wrapper.is-gesturing`).
   * This is reactive state, NOT a raw classList toggle: render already runs
   * per-frame during a gesture (every move writes _transform), and Lit's
   * class= binding on .wrapper would clobber a manually toggled class on
   * those renders. Latch/unlatch add at most one render each.
   */
  @state() private _isGesturing = false;
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
  /** One-shot wheel hint lifecycle: fade in ('show') → hold → 'fade' → gone. */
  @state() private _wheelHintPhase: 'off' | 'show' | 'fade' = 'off';
  private _wheelHintTimers: Array<ReturnType<typeof setTimeout>> = [];
  /** Cached `closest('hui-card-preview')` check (spec F16) — computed once. */
  private _inPreview: boolean | null = null;

  private _ro?: ResizeObserver;
  /** The .wrapper currently carrying the non-passive multi-touch guards. */
  private _wrapperTouchTarget: HTMLElement | null = null;
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
  /** Label decisions snapshotted at gesture latch; frozen while gesturing so
   * the O(n²) collision cull never runs per pointermove (spec P0-2 / L7). */
  private _frozenLabels: Map<string, FrozenLabel> | null = null;
  /** Marker views as last rendered — the snapshot source for _frozenLabels. */
  private _lastViews: MarkerView[] = [];
  private _animateFallback?: ReturnType<typeof setTimeout>;
  private _sceneEndUnsub?: () => void;

  static styles = [
    css`
    :host {
      display: block;
      /* Motion tokens (spec v2.5 §2) — every duration/easing in the card
         derives from these. Reduced motion zeroes the durations below
         (keyframes and the tilt transform don't read the vars, so they keep
         explicit overrides in the media block). */
      --av-dur-instant: 90ms; /* press feedback, check pops */
      --av-dur-fast: 180ms; /* exits, dismissals, hover reveals */
      --av-dur-med: 320ms; /* entrances, panel arrivals, snap-back */
      --av-dur-slow: 560ms; /* camera moves: zone focus, reset, double-tap */
      --av-ease-out: cubic-bezier(0.22, 1, 0.36, 1); /* the camera, fades, labels */
      --av-ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1); /* chips, checks, FAB; NEVER the camera */
      --av-ease-in-out: cubic-bezier(0.65, 0, 0.35, 1); /* cross-fades, exits */
      --av-ease-snap: cubic-bezier(0.175, 0.885, 0.32, 1.12); /* rubber-band return only */
    }
    /* The floorplan floats directly on the dashboard: no card chrome. */
    ha-card {
      background: none;
      border: none;
      box-shadow: none;
    }
    /* HUD row above the canvas (attention + lights control live here, never
       overlaying the floorplan). */
    .hud {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 0 2px 10px;
    }
    .hud-spacer {
      flex: 1;
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
      /* touch-action is three-state and render-bound inline (spec P0-3 / C4):
         'pan-y' at overview and while focused (dashboard scrolls), 'none'
         only when free-zoomed. Never a static 'none' — that was the trap. */
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
      /* Gated (spec P0-2): no easing while the finger owns the glass; machine
         camera moves enable it via .wrapper.is-animating below. */
      transition: none;
    }
    .scene {
      position: absolute;
      inset: 0;
      transform-origin: 0 0;
      will-change: transform;
      /* Gated: 1:1 with the pointer by default (doctrine L2). */
      transition: none;
    }
    /* Machine camera move (spec P0-2): scene, tilt, markers and labels fly as
       ONE body — same token, same curve, enabled by a single class. */
    .wrapper.is-animating .scene,
    .wrapper.is-animating .tilt {
      transition: transform var(--av-dur-slow) var(--av-ease-out);
    }
    .base-image {
      display: block;
      width: 100%;
      height: auto;
      /* No native image-drag ghosts on mouse pans, no long-press text/image
         selection on iOS (spec P0-3 / F14c; pairs with draggable="false"). */
      -webkit-user-drag: none;
      user-select: none;
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
      animation: av-floor-fade var(--av-dur-med) var(--av-ease-out);
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
      /* Hidden until image + geometry are ready, then fades in already in
         place (positions are committed one frame before .ready flips). */
      opacity: 0;
      transition: opacity var(--av-dur-med) var(--av-ease-out);
    }
    .marker-overlay.ready {
      opacity: 1;
    }
    .marker-overlay .marker {
      position: absolute;
      /* Base marker size at overview, configurable via options.iconSize
         (default 44px; the icon glyph is half the chip). Position lives in
         the inline translate3d transform (compositor path, spec P0-2). */
      left: 0;
      top: 0;
      min-width: var(--av-icon-size, 44px);
      min-height: var(--av-icon-size, 44px);
      display: grid;
      place-items: center;
      border: none;
      border-radius: 50%;
      padding: 0;
      cursor: pointer;
      pointer-events: auto;
      color: var(--primary-text-color);
      --mdc-icon-size: calc(var(--av-icon-size, 44px) * 0.5);
      /* Frosted, dimensional chip that floats above the floorplan. The
         translucent fill + backdrop blur read on any image; the inset hairline
         gives a crisp edge on light and dark themes alike. */
      background: color-mix(in srgb, var(--card-background-color, #1c1c1e) 68%, transparent);
      -webkit-backdrop-filter: blur(8px) saturate(1.4);
      backdrop-filter: blur(8px) saturate(1.4);
      box-shadow:
        0 4px 14px rgba(0, 0, 0, 0.42),
        inset 0 0 0 1px rgba(255, 255, 255, 0.14);
      /* Position (transform) is NOT transitioned by default — gestures are
         1:1. Press feedback + state fades stay unconditional. */
      transition:
        scale var(--av-dur-fast) var(--av-ease-spring),
        box-shadow 0.4s ease, opacity 0.3s ease, color 0.4s ease;
    }
    /* During the machine camera move, marker/label transforms ride the same
       token + curve as the scene so they never detach from their rooms. */
    .wrapper.is-animating .marker-overlay .marker {
      transition:
        transform var(--av-dur-slow) var(--av-ease-out),
        scale var(--av-dur-fast) var(--av-ease-spring),
        box-shadow 0.4s ease, opacity 0.3s ease, color 0.4s ease;
    }
    .wrapper.is-animating .marker-overlay .marker-label {
      transition:
        transform var(--av-dur-slow) var(--av-ease-out),
        opacity var(--av-dur-fast) var(--av-ease-out);
    }
    /* Reveal gate composes with the animation gate: pre-reveal, nothing may
       transition (equal specificity to the is-animating rules; declared later
       so order wins). */
    .wrapper .marker-overlay:not(.ready) .marker {
      transition: none;
      pointer-events: none;
    }
    /* While the camera flies or a finger drags, blurred chips must not
       re-sample the backdrop per frame (~30 elements, doctrine L7). The
       opaque fill is invisible in motion and keeps contrast. */
    .wrapper.is-animating .marker-overlay .marker,
    .wrapper.is-gesturing .marker-overlay .marker,
    .wrapper.is-animating .marker-overlay .marker-label,
    .wrapper.is-gesturing .marker-overlay .marker-label {
      -webkit-backdrop-filter: none;
      backdrop-filter: none;
      background: var(--card-background-color, #1c1c1e);
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
    /* Dynamic value label — frosted plate guarantees contrast on any floorplan.
       Position + anchor offset live in the inline translate3d transform
       (see renderMarkerOverlay); --label-dy feeds into it. */
    .marker-overlay .marker-label {
      position: absolute;
      left: 0;
      top: 0;
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
      transition: opacity var(--av-dur-fast) var(--av-ease-out);
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
      transition: scale var(--av-dur-fast) var(--av-ease-spring);
      --mdc-icon-size: 16px;
    }
    .attention-pill ha-icon { color: var(--warning-color, #ffa600); }
    .attention-pill:active { scale: 0.96; }
    /* One-shot "modifier + scroll to zoom" hint (spec P0-3): same frosted
       recipe as .attention-pill, non-interactive, opacity-only in/out. */
    .wheel-hint {
      position: absolute;
      top: 12px;
      left: 50%;
      translate: -50% 0;
      z-index: 8;
      pointer-events: none;
      display: inline-flex;
      align-items: center;
      height: 34px;
      padding: 0 14px;
      border-radius: 17px;
      font-size: 13px;
      font-weight: 500;
      white-space: nowrap;
      color: var(--primary-text-color);
      background: color-mix(in srgb, var(--card-background-color, #1c1e24) 60%, transparent);
      -webkit-backdrop-filter: blur(14px) saturate(1.5);
      backdrop-filter: blur(14px) saturate(1.5);
      box-shadow: inset 0 0 0 1px var(--divider-color, rgba(255, 255, 255, 0.14)), 0 4px 14px rgba(0, 0, 0, 0.35);
      opacity: 1;
      transition: opacity var(--av-dur-fast) var(--av-ease-out);
      animation: av-hint-in var(--av-dur-fast) var(--av-ease-out);
    }
    .wheel-hint.fade {
      opacity: 0;
    }
    @keyframes av-hint-in {
      from { opacity: 0; }
    }
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
      transition: scale var(--av-dur-fast) var(--av-ease-spring), background-color 0.2s ease;
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
      transition: transform var(--av-dur-fast) var(--av-ease-spring);
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
      transition: transform var(--av-dur-fast) var(--av-ease-spring), opacity var(--av-dur-fast) var(--av-ease-out);
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
      /* Zeroing the tokens collapses every transition to instant. Keyframe
         animations and the tilt transform don't read the duration vars, so
         they keep explicit overrides. */
      :host {
        --av-dur-instant: 0ms;
        --av-dur-fast: 0ms;
        --av-dur-med: 0ms;
        --av-dur-slow: 0ms;
      }
      .marker-overlay.pulse .marker.has-attention {
        animation: none;
      }
      .scene.floor-fade {
        animation: none;
      }
      .tilt {
        transform: none !important;
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
    // Desktop Safari trackpad pinch fires proprietary gesture events that
    // page-zoom the dashboard; we consume its ctrl-wheel stream instead
    // (spec P0-3 / F14b). Harmless no-op everywhere else.
    this.addEventListener('gesturestart', this._onGestureStart);
    window.addEventListener('pointermove', this._onWindowPointerMove);
    window.addEventListener('pointerup', this._onWindowPointerUp);
    window.addEventListener('pointercancel', this._onWindowPointerCancel);
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
    // Re-arm the multi-touch guards on reconnect (the wrapper node survives
    // in the persisted renderRoot; no-op before the first render).
    this._attachWrapperTouchGuards();
  }

  public disconnectedCallback(): void {
    super.disconnectedCallback();
    this.removeEventListener('wheel', this._onWheel);
    this.removeEventListener('gesturestart', this._onGestureStart);
    this._detachWrapperTouchGuards();
    window.removeEventListener('pointermove', this._onWindowPointerMove);
    window.removeEventListener('pointerup', this._onWindowPointerUp);
    window.removeEventListener('pointercancel', this._onWindowPointerCancel);
    window.removeEventListener('keydown', this._handleKeyDown);
    clearTimeout(this._pulseTimer);
    clearTimeout(this._floorFadeTimer);
    this._wheelHintTimers.forEach(clearTimeout);
    this._wheelHintTimers = [];
    this._clearAnimating();
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
    // Cheap no-op once attached (reference-checked); covers the first render
    // and the warning-template → wrapper-template swap.
    this._attachWrapperTouchGuards();
    // Reveal choreography: this frame committed correct positions while the
    // overlay is still hidden (and transition-suppressed); flip `ready` on the
    // NEXT frame so markers fade in already in place instead of sliding from
    // stale coordinates.
    if (!this._revealed && this._imgAspect !== null) {
      requestAnimationFrame(() => {
        this._revealed = true;
      });
    }
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
        // Reactive: marker positions derive their viewport height from this,
        // so the load must trigger a re-render (Lit dedups unchanged values).
        this._imgAspect = img.naturalHeight / img.naturalWidth;
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
   * Returns the scene image-box size. width === this._cardWidth (the same
   * width passed to renderLightLayer and markerScreenPos so zoomToZone's
   * clamp and marker mapping agree). Height is DERIVED (width × aspect):
   * the image box is always `width / naturalAspect` because it renders at
   * `width:100%; height:auto`, so this is exact regardless of when the
   * wrapper's own rect settles — no live DOM reads, fully reactive.
   */
  private _viewport(): Viewport {
    return {
      width: this._cardWidth,
      height: this._cardWidth * (this._imgAspect ?? 9 / 16),
    };
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

  /**
   * Machine camera move (spec P0-2, doctrine L2): writes the target transform
   * SYNCHRONOUSLY (the state machine and its tests read it immediately) and
   * raises `is-animating` for the transition's lifetime — cleared on the
   * scene's own transitionend, with a timeout fallback for environments
   * without transition events (tests, reduced motion). Direct gesture writes
   * (pan/pinch/wheel) never come through here — the finger is 1:1.
   */
  private _animateTransformTo(t: ZoomTransform): void {
    this._clearAnimating(); // restart cleanly if a move is already in flight
    this._isAnimating = true;
    this._transform = t;
    const scene = this.renderRoot?.querySelector('.scene');
    if (scene) {
      const onEnd = (e: Event): void => {
        if (e.target !== scene) return; // bubbled child transition, not the camera
        this._clearAnimating();
      };
      scene.addEventListener('transitionend', onEnd);
      this._sceneEndUnsub = () => scene.removeEventListener('transitionend', onEnd);
    }
    this._animateFallback = setTimeout(() => this._clearAnimating(), CAMERA_MS + 80);
  }

  private _clearAnimating(): void {
    clearTimeout(this._animateFallback);
    this._animateFallback = undefined;
    this._sceneEndUnsub?.();
    this._sceneEndUnsub = undefined;
    this._isAnimating = false;
  }

  private _focusZone(zone: ZoneConfig): void {
    this._focusedZone = zone;
    this._animateTransformTo(zoomToZone(zone, this._viewport(), this.config.options.zoomMax));
    this._panZoom.setEnabled(false);
  }

  private _exitFocus(): void {
    this._focusedZone = null;
    this._animateTransformTo({ scale: 1, panX: 0, panY: 0 });
    this._panZoom.setEnabled(this.config.options.freePanZoom);
  }

  /** Zones ordered left-to-right (center-x, ties by center-y) for room swipe. */
  private _zonesByCenterX(): ZoneConfig[] {
    return [...this._floorData.zones].sort(
      (a, b) =>
        a.x + a.width / 2 - (b.x + b.width / 2) ||
        a.y + a.height / 2 - (b.y + b.height / 2),
    );
  }

  /**
   * Room swipe (spec P0-1): swipe left pages to the next zone by center-x,
   * swipe right to the previous. Clamped at the ends — no wrap.
   */
  private _swipeToNeighborZone(dx: number): void {
    if (this._focusedZone === null) return;
    const ordered = this._zonesByCenterX();
    const i = ordered.indexOf(this._focusedZone);
    if (i < 0) return;
    const j = Math.min(ordered.length - 1, Math.max(0, i + (dx < 0 ? 1 : -1)));
    if (j !== i) this._focusZone(ordered[j]);
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

  /** Safari's proprietary trackpad-pinch events must never page-zoom (F14b). */
  private _onGestureStart = (e: Event): void => {
    e.preventDefault();
  };

  /**
   * Multi-touch escape hatch (spec P0-3 / F5): with `pan-y`, Android Chrome
   * would claim two near-vertical fingers as a scroll and pointercancel the
   * pinch. Multi-touch always belongs to the card; single-finger stays native.
   */
  private _onWrapperTouch = (e: TouchEvent): void => {
    if (e.touches.length >= 2) e.preventDefault();
  };

  private _attachWrapperTouchGuards(): void {
    const wrapper = this.renderRoot?.querySelector('.wrapper') as HTMLElement | null;
    if (!wrapper || wrapper === this._wrapperTouchTarget) return;
    this._detachWrapperTouchGuards();
    wrapper.addEventListener('touchstart', this._onWrapperTouch, { passive: false });
    wrapper.addEventListener('touchmove', this._onWrapperTouch, { passive: false });
    this._wrapperTouchTarget = wrapper;
  }

  private _detachWrapperTouchGuards(): void {
    const w = this._wrapperTouchTarget;
    if (!w) return;
    w.removeEventListener('touchstart', this._onWrapperTouch);
    w.removeEventListener('touchmove', this._onWrapperTouch);
    this._wrapperTouchTarget = null;
  }

  private _onWheel = (e: WheelEvent) => {
    if (this._focusedZone !== null) return;
    // Wheel gate (spec P0-3 / F7b): under the default 'modifier' mode a plain
    // wheel belongs to the dashboard — pass it through UNTOUCHED (no
    // preventDefault) unless a modifier is held, a trackpad pinch arrives
    // (ctrl-wheel), or the user is already free-zoomed. 'plain' keeps the
    // v2.4 wheel-always-zooms behavior for kiosks/wall tablets.
    if (
      this.config.options.interaction.wheel === 'modifier' &&
      !(
        e.ctrlKey ||
        e.metaKey ||
        (this._transform.scale > 1 && this._focusedZone === null)
      )
    ) {
      this._maybeShowWheelHint();
      return;
    }
    e.preventDefault();
    // deltaMode 1 = lines (Firefox); normalize to px before the exp curve (F6).
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    const r = this.getBoundingClientRect();
    this._transform = this._panZoom.wheelZoom(
      dy,
      e.clientX - r.left,
      e.clientY - r.top
    );
  };

  /**
   * One-shot hint when a plain wheel passes through at overview (modifier
   * mode): frosted mini-pill, fades in fast, auto-fades out after 1.6s.
   * Once per session (module flag); suppressed in the card-picker preview.
   */
  private _maybeShowWheelHint(): void {
    if (wheelHintShown) return;
    if (this._inPreview === null) {
      this._inPreview = this.closest('hui-card-preview') !== null;
    }
    if (this._inPreview) return;
    wheelHintShown = true;
    this._wheelHintPhase = 'show';
    this._wheelHintTimers.push(
      setTimeout(() => {
        this._wheelHintPhase = 'fade';
        this._wheelHintTimers.push(
          setTimeout(() => {
            this._wheelHintPhase = 'off';
          }, WHEEL_HINT_FADE_MS),
        );
      }, WHEEL_HINT_HOLD_MS),
    );
  }

  private _onScenePointerDown = (e: PointerEvent) => {
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
    // New floor image: hide markers until its aspect is known, then re-reveal.
    this._revealed = false;
    this._imgAspect = null;
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

  /**
   * A pan/pinch movement latched (spec P0-2): freeze the current label
   * decisions (the O(n²) collision cull must not run per pointermove) and
   * raise `is-gesturing` (suppresses backdrop-filter on the chips). Marker
   * taps never latch — only actual movement past the threshold lands here.
   */
  private _latchGesture(): void {
    if (this._isGesturing) return;
    this._frozenLabels = new Map(
      this._lastViews.map((v) => [v.entity.entity, { text: v.labelText, anchor: v.labelAnchor }]),
    );
    this._isGesturing = true;
  }

  /** Gesture over (up/cancel): labels re-resolve, backdrop blur returns. */
  private _unlatchGesture(): void {
    if (!this._isGesturing) return;
    this._frozenLabels = null;
    this._isGesturing = false;
  }

  private _onWindowPointerMove = (e: PointerEvent) => {
    if (!this._activePointers.has(e.pointerId)) return;
    this._activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (this._activePointers.size >= 2 && this._pinchStartDist > 0) {
      // Focused: the controller is disabled AND its internal transform is not
      // the zone camera — writing its return value back would clobber the
      // focused view, so skip the pinch math entirely (spec P0-1).
      if (this._focusedZone !== null) return;
      const [a, b] = [...this._activePointers.values()];
      const dist = this._panZoom.pinchDistance(a.x, a.y, b.x, b.y);
      if (Math.abs(dist - this._pinchStartDist) <= MOVE_THRESHOLD_PX) return; // below per-gesture threshold
      this._latchGesture();
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
      this._latchGesture();
      // pan: translate by the per-event delta. While focused the movement only
      // feeds swipe classification — never the (disabled) pan controller.
      if (this._focusedZone === null) {
        const prev = this._lastMove ?? { x: e.clientX, y: e.clientY };
        this._transform = this._panZoom.panBy(e.clientX - prev.x, e.clientY - prev.y);
      }
    }
    this._lastMove = { x: e.clientX, y: e.clientY };
  };

  private _onWindowPointerUp = (e: PointerEvent) => {
    if (!this._activePointers.has(e.pointerId)) return;
    this._activePointers.delete(e.pointerId);
    this._lastMove = null;
    if (this._activePointers.size < 2) this._pinchStartDist = 0;
    if (this._activePointers.size === 0) this._unlatchGesture();

    const start = this._tapHold.startPoint;
    const now = performance.now();
    const outcome = this._tapHold.end(now);
    this._cancelHold();
    if (outcome === 'tap' && this._activeMarker && this.hass) {
      this._activateEntity(this._activeMarker.entity);
    } else if (outcome === 'hold' && this._activeMarker && !this._holdFired) {
      // hold timer didn't fire (e.g. test/no-timer path) but release is late
      dispatchHoldAction(this._activeMarker.entity, this);
    } else if (
      outcome === 'drag' &&
      this._focusedZone !== null &&
      this._activeMarker === null &&
      this.config.options.interaction.roomSwipe // config gate (spec §7)
    ) {
      // Room swipe (spec P0-1): a fast, mostly-horizontal scene drag while
      // focused pages to the neighbouring zone; vertical drags do nothing.
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (
        Math.abs(dx) > SWIPE_MIN_PX &&
        Math.abs(dx) > 2 * Math.abs(dy) &&
        now - start.t < SWIPE_MAX_MS
      ) {
        this._swipeToNeighborZone(dx);
      }
    }
    this._activeMarker = null;
  };

  /**
   * pointercancel is an abort, never a tap (spec P0-0): when the browser
   * claims the pointer stream (scroll takeover, palm rejection, system
   * gesture), terminate the gesture with NO outcome — routing this through
   * _onWindowPointerUp would let TapHoldTracker classify the short, still
   * press as a tap and toggle a device.
   */
  private _onWindowPointerCancel = (e: PointerEvent) => {
    if (!this._activePointers.has(e.pointerId)) return;
    this._activePointers.delete(e.pointerId);
    this._lastMove = null;
    this._pinchStartDist = 0;
    if (this._activePointers.size === 0) this._unlatchGesture();
    this._cancelHold();
    this._tapHold.reset();
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

  /**
   * guard() dependencies for the scene subtree (spec P0-2 / L7): per-frame
   * `_transform` renders must NOT re-evaluate base/light/effect layers —
   * `_renderScene` provably reads none of the transform state. Same id list
   * as `_relevantStateChanged` (sun + weather + floor entities), but keyed on
   * the state OBJECTS, not a joined `.state` string: HA replaces the object
   * on every update including attribute-only changes (brightness, rgb_color)
   * that a state-string composite would miss. `config` covers options/images
   * (editor live-preview), `_imgAspect`/`_cardWidth` cover geometry.
   */
  private _sceneDeps(): unknown[] {
    const states = this.hass?.states ?? {};
    const weather = this.config.options.weatherEntity;
    return [
      this.config,
      this._floor,
      this._cardWidth,
      this._imgAspect,
      states['sun.sun'],
      weather ? states[weather] : undefined,
      ...this._floorData.entities.map((e) => states[e.entity]),
    ];
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

    const iconSize = this.config.options.iconSize;
    const maxIconScale = iconSize > 0 ? this.config.options.iconSizeMax / iconSize : 2;
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
      maxIconScale,
      this._frozenLabels ?? undefined,
    );
    this._lastViews = views; // snapshot source for the gesture label freeze
    const attentionCount = views.filter((v) => v.attention).length;

    const floors = this.config.floors ?? [];

    // HUD row above the canvas: attention pill (left) + lights control (right).
    const attentionPill =
      attentionCount > 0 && !this._selectMode
        ? html`<button
            class="attention-pill"
            @click=${this._pulseAttention}
            title="Locate items that need attention"
          >
            <ha-icon icon="mdi:alert-circle"></ha-icon>
            <span>${attentionCount} need${attentionCount === 1 ? 's' : ''} attention</span>
          </button>`
        : nothing;
    const lightsControl = this._hasLights()
      ? html`<button
          class="lights-control ${this._selectMode ? 'active' : ''}"
          @click=${this._toggleSelectMode}
          aria-pressed=${this._selectMode}
        >
          <ha-icon icon="mdi:tune-variant"></ha-icon>
          <span>${this._selectMode ? 'Done' : 'Lights control'}</span>
        </button>`
      : nothing;

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
        ${attentionPill !== nothing || lightsControl !== nothing
          ? html`<div class="hud">
              ${attentionPill}
              <span class="hud-spacer"></span>
              ${lightsControl}
            </div>`
          : nothing}
        <div
          class="wrapper ${this._isAnimating ? 'is-animating' : ''} ${this._isGesturing ? 'is-gesturing' : ''}"
          style="--av-icon-size:${iconSize}px; touch-action:${t.scale > 1 &&
          this._focusedZone === null
            ? 'none' /* free-zoomed: the card owns single-finger pan */
            : 'pan-y' /* overview + focused: vertical swipes scroll the dashboard */}"
        >
          <div
            class="tilt"
            style="transform: ${this._focusedZone ? 'rotateX(11deg)' : 'none'};"
          >
            <div
              class="scene ${this._floorFading ? 'floor-fade' : ''}"
              style="transform: translate(${t.panX}px, ${t.panY}px) scale(${t.scale});"
              @pointerdown=${this._onScenePointerDown}
            >
              <!-- base-layer + light-layer come from Phase 2 render functions;
                   guard()ed so per-frame transform renders skip re-evaluating
                   the whole subtree (spec P0-2 / L7). -->
              ${guard(this._sceneDeps(), () => this._renderScene())}
            </div>
            ${renderMarkerOverlay(views, this._onMarkerPointerDown, this._onMarkerActivate, this._pulse, this._revealed)}
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
          ${this._renderQuickActions()}
          ${this._wheelHintPhase !== 'off'
            ? html`<div
                class="wheel-hint ${this._wheelHintPhase === 'fade' ? 'fade' : ''}"
                role="status"
              >
                ${wheelHintText()}
              </div>`
            : nothing}
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
