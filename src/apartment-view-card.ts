import { LitElement, html, css, unsafeCSS, nothing, type TemplateResult, type PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { guard } from 'lit/directives/guard.js';
import { fireEvent } from 'custom-card-helpers';
import type { HassLike } from './core/ha-types';
import { normalizeConfig, zoneForEntity, zoneForPoint, type ApartmentViewConfig, type EntityConfig, type ZoneConfig, type QuickAction, type ImagesConfig } from './core/config';
import './editor/apartment-view-card-editor';
import './editor/spatial-preview';
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
import { attentionFor } from './core/attention';
import './render/control-surface';
import { controlKind, controlTarget } from './core/entity-capabilities';
import { markerIsVisible } from './core/entity-policy';
import { rectangularSpatialPlan } from './core/spatial-plan';
import { editorPreviewElementId, ELEMENT_INSPECTOR_EVENT } from './editor/editor-preview-state';

/** Viewport width at/below which the mobile icon-size overrides apply. */
const MOBILE_BREAKPOINT_PX = 768;
/** Horizontal cushion (px, each side) between the contained mobile floorplan
 *  and the card edge, so the plan never touches the screen edges (Fix 3). */
const FRAME_CUSHION_PX = 11;
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
 * Numeric twin of --av-dur-med: the rubber-band snap-back duration (the
 * `is-animating-snap` camera variant, spec P0-4).
 */
const SNAP_MS = 320;

/**
 * Scene tap grammar (spec P0-5): a second tap within DOUBLE_TAP_MS and
 * DOUBLE_TAP_RADIUS_PX of the previous scene tap is a double-tap (toggle
 * zoom); any other tap commits after SINGLE_TAP_MS. The wait is invisible in
 * practice — zone focus rides a 560ms camera move anyway — and markers never
 * wait (their taps bypass this entirely).
 */
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_RADIUS_PX = 24;
const SINGLE_TAP_MS = 250;
/** Idle gap after the last gated wheel event before the gesture unlatches:
 * long enough to span a ~60-120Hz trackpad-pinch stream, short enough that a
 * single discrete notch unlatches invisibly (spec L7 / P0-2). */
const WHEEL_IDLE_MS = 160;

/** Camera scale for a zoneless attention marker (spec P0-6 / F16). */
const ATTENTION_ZOOM = 1.35;

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
  // navigator.platform is deprecated; userAgentData.platform is the
  // replacement where it exists (Chromium). Fall back for Safari/Firefox.
  const platform =
    (navigator as any).userAgentData?.platform ?? navigator.platform ?? '';
  const mac = /mac|iphone|ipad|ipod/i.test(platform);
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
  @state() private _editorElementPreviewId: string | null = null;
  /** True when the viewport is a mobile screen (drives the icon-size override). */
  @state() private _isMobileScreen = false;
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
   * The in-flight camera move is the rubber-band snap-back variant
   * (`is-animating-snap`: --av-dur-med + --av-ease-snap instead of the
   * --av-dur-slow camera). Only meaningful while _isAnimating.
   */
  @state() private _animSnap = false;
  /**
   * A pan/pinch movement has latched (drives `.wrapper.is-gesturing`).
   * This is reactive state, NOT a raw classList toggle: render already runs
   * per-frame during a gesture (every move writes _transform), and Lit's
   * class= binding on .wrapper would clobber a manually toggled class on
   * those renders. Latch/unlatch add at most one render each.
   */
  @state() private _isGesturing = false;
  @state() private _focusedZone: ZoneConfig | null = null;
  @state() private _spatialFocusedZoneId: string | null = null;
  /** Entities currently driven by the control surface (empty = closed). */
  @state() private _controlled: string[] = [];
  /** "Lights control" multi-select mode. */
  @state() private _selectMode = false;
  /** Transient: pulse the attention markers to help locate them. */
  @state() private _pulse = false;
  private _pulseTimer?: ReturnType<typeof setTimeout>;
  /**
   * Attention-pill cycling (spec P0-6): number of pill taps so far — the
   * index of the NEXT item to visit. Reactive because it drives the pill
   * label ("2 of 3" while cycling). Reset by exit-focus, Escape, and a
   * change in the attention count.
   */
  @state() private _attentionCycle = 0;
  /** Attention count captured at the last pill tap; a change resets the cycle. */
  private _attentionCycleCount = 0;
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
  private _mql?: MediaQueryList;
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
  /** One-shot callback fired when the in-flight camera move settles (P0-6). */
  private _onSettleCb?: () => void;
  /** Pending single-tap commit (the double-tap window, spec P0-5). */
  private _sceneTapTimer: ReturnType<typeof setTimeout> | null = null;
  /** Idle timer that unlatches the gesture after a gated-wheel stream stops
   * (trackpad pinch / kiosk plain-wheel arrive as a sustained ctrl-wheel
   * stream; the whole stream must share one latch — spec L7 / P0-2). */
  private _wheelIdleTimer: ReturnType<typeof setTimeout> | null = null;
  private _idleResetTimer: ReturnType<typeof setTimeout> | null = null;
  /** Previous scene tap (client coords + timestamp) for double-tap detection. */
  private _lastSceneTap: { x: number; y: number; t: number } | null = null;

  static styles = [
    css`
    :host {
      display: block;
      background: transparent;
      outline: none !important;
      -webkit-tap-highlight-color: transparent;
      /* Motion tokens (spec v2.5 §2) — every duration/easing in the card
         derives from these. Reduced motion zeroes the durations below
         (keyframes and the tilt transform don't read the vars, so they keep
         explicit overrides in the media block). */
      --av-dur-instant: 90ms; /* press feedback, check pops */
      --av-dur-fast: 180ms; /* exits, dismissals, hover reveals */
      --av-dur-med: 320ms; /* entrances, panel arrivals, snap-back */
      --av-dur-slow: 560ms; /* camera moves: zone focus, reset, double-tap */
      --av-ease-out: cubic-bezier(0.22, 1, 0.36, 1); /* the camera, fades, labels */
      --av-ease-spring: cubic-bezier(0.22, 1, 0.36, 1); /* crisp chips, checks, FAB; NEVER the camera */
      --av-ease-in-out: cubic-bezier(0.65, 0, 0.35, 1); /* cross-fades, exits */
      --av-ease-snap: cubic-bezier(0.22, 1, 0.36, 1); /* rubber-band return only */
    }
    :host(:focus),
    :host(:focus-visible),
    ha-card:focus,
    ha-card:focus-visible {
      outline: none !important;
    }
    /* The floorplan floats directly on the dashboard: no card chrome. */
    ha-card {
      --ha-card-background: transparent;
      --ha-card-border-color: transparent;
      --ha-card-box-shadow: none;
      background: transparent;
      border: none;
      box-shadow: none;
      overflow: visible;
    }
    .spatial-room-navigation {
      display: flex;
      align-items: stretch;
      gap: 14px;
      width: 100%;
      min-width: 0;
      margin-bottom: 4px;
    }
    .spatial-room-rail {
      display: flex;
      flex: 1 1 auto;
      min-width: 0;
      gap: 24px;
      overflow-x: auto;
      scrollbar-width: none;
      scroll-snap-type: x proximity;
    }
    .spatial-room-rail::-webkit-scrollbar { display: none; }
    .spatial-room-navigation button {
      appearance: none;
      flex: 0 0 auto;
      min-height: 48px;
      padding: 2px 0 9px;
      border: 0;
      border-bottom: 2px solid transparent;
      border-radius: 0;
      background: transparent;
      color: var(--secondary-text-color, #9aa6a8);
      font: inherit;
      font-size: 17px;
      font-weight: 470;
      line-height: 1;
      white-space: nowrap;
      cursor: pointer;
      scroll-snap-align: start;
    }
    .spatial-room-navigation button[aria-pressed='true'] {
      color: var(--primary-text-color, #f8fbfb);
      border-bottom-color: #a9d2d8;
    }
    .spatial-room-navigation button:focus-visible {
      outline: 2px solid #d8e5e7;
      outline-offset: 2px;
    }
    .spatial-room-back {
      display: grid;
      flex-basis: 48px !important;
      width: 48px;
      height: 48px;
      place-items: center;
      padding: 0 !important;
      border-bottom-color: transparent !important;
      color: var(--primary-text-color, #f8fbfb) !important;
    }
    .spatial-room-back ha-icon { --mdc-icon-size: 24px; }
    .spatial-room-divider {
      flex: 0 0 1px;
      width: 1px;
      height: 28px;
      align-self: center;
      background: color-mix(in srgb, var(--primary-text-color, #f8fbfb) 22%, transparent);
    }
    @media (max-width: 600px) {
      .spatial-room-navigation { gap: 8px; }
      .spatial-room-divider { height: 24px; }
      .spatial-room-rail { gap: 28px; }
      .spatial-room-navigation button { min-height: 52px; padding: 2px 0 10px; font-size: 19px; }
    }
    /* HUD row above the canvas (attention + lights control live here, never
       overlaying the floorplan). */
    .hud {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 0 2px 10px;
      /* Narrow phones (~375px): wrap to a second line rather than clip the
         right pill off-screen. The spacer collapses when wrapped so the
         second-line pill aligns left. */
      flex-wrap: wrap;
    }
    .hud-spacer {
      flex: 1 1 0;
      min-width: 0;
    }
    .wrapper {
      position: relative;
      width: 100%;
      /* border-box so the mobile taller-frame's horizontal cushion (applied as
         inline padding) stays INSIDE width:100% (no overflow) and the
         aspect-ratio height is taken over the full outer width. */
      box-sizing: border-box;
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
    /* Mobile taller-frame (Fix 3 / options.aspectMobile). The frame is the
       floorplan's coordinate box: the scene + marker overlay live inside it at
       inset:0, so it is the single source of truth for where the plan renders.
       By default it fills the wrapper edge-to-edge (inset:0). On a mobile
       screen with aspectMobile set, the wrapper grows TALLER than the plan's
       natural height and the .frame.framed box is CONTAINED inside it: a
       small horizontal cushion on each side (so the plan never touches the
       card edges) and vertically centered (the extra box height becomes
       top/bottom breathing room). The whole floorplan stays visible — no crop,
       no up-scale. Because _cardWidth is measured from THIS element's
       contentRect and every screen->scene mapping reads THIS element's rect,
       markers and zones inherit the cushion + centering offset for free and
       can't drift. */
    .frame {
      position: absolute;
      inset: 0;
      transform-style: preserve-3d;
    }
    .frame.framed {
      /* Contained + cushioned + vertically centered. An absolutely-positioned
         inset:0 element fills the wrapper's PADDING box (padding does NOT inset
         it), so the horizontal cushion is applied HERE as left/right insets;
         the wrapper carries a matching horizontal padding purely so its
         contentRect width (which drives _cardWidth / _viewport) equals this
         box's width. The top/bottom insets center the natural-height (contained)
         plan in the taller wrapper — extra box height becomes top/bottom
         breathing room. Contain, never crop or up-scale. */
      left: var(--av-frame-inset-x, 0px);
      right: var(--av-frame-inset-x, 0px);
      top: var(--av-frame-inset-y, 0px);
      bottom: var(--av-frame-inset-y, 0px);
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
    /* Invisible per-zone hit-rects (spec P0-5 / F4): percent-positioned inside
       the transformed scene so they ride the pan/zoom — and, while focused,
       the perspective tilt: elementsFromPoint gets the browser's own 3D
       projection instead of a math inversion. Permanently non-interactive
       (a11y guardrail §8.11 — they never intercept markers or pan); the
       wrapper's .hit-testing class flips them hittable only for the duration
       of the synchronous tap resolution. */
    .zone-hit {
      position: absolute;
      pointer-events: none;
    }
    .wrapper.hit-testing .zone-hit {
      pointer-events: auto;
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
        translate var(--av-dur-slow) var(--av-ease-out),
        transform var(--av-dur-slow) var(--av-ease-out),
        scale var(--av-dur-fast) var(--av-ease-spring),
        box-shadow 0.4s ease, opacity 0.3s ease, color 0.4s ease;
    }
    .wrapper.is-animating .marker-overlay .marker-label {
      transition:
        transform var(--av-dur-slow) var(--av-ease-out),
        opacity var(--av-dur-fast) var(--av-ease-out);
    }
    /* Rubber-band snap-back variant (spec P0-4): shorter + snappier than the
       camera — --av-dur-med with the snap ease, same one-body rule set.
       Equal specificity to the is-animating rules, declared after → wins
       while both classes are present; the pre-reveal gate below still
       trumps everything. */
    .wrapper.is-animating-snap .scene,
    .wrapper.is-animating-snap .tilt {
      transition: transform var(--av-dur-med) var(--av-ease-snap);
    }
    .wrapper.is-animating-snap .marker-overlay .marker {
      transition:
        translate var(--av-dur-med) var(--av-ease-snap),
        transform var(--av-dur-med) var(--av-ease-snap),
        scale var(--av-dur-fast) var(--av-ease-spring),
        box-shadow 0.4s ease, opacity 0.3s ease, color 0.4s ease;
    }
    .wrapper.is-animating-snap .marker-overlay .marker-label {
      transition:
        transform var(--av-dur-med) var(--av-ease-snap),
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
    /* press feedback — position lives in the individual 'translate' property
       (which composes BEFORE 'scale' per CSS property order), so this is a
       pure local shrink around the chip's center: zero displacement. */
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
    /* 34px visual height; the ::after inset extends the effective hit target
       to 44px (a11y guardrail) without changing the calm HUD look. */
    .lights-control::after {
      content: '';
      position: absolute;
      inset: -5px;
    }
    /* Compact ROUND warning-icon button (field feedback): just an alert glyph
       in a 34px circle — no text label — with the live count as a small corner
       badge. Still taps to start/advance the attention tour. Hit target reaches
       the 44px a11y floor via the ::after inset. */
    .attention-pill::after {
      content: '';
      position: absolute;
      inset: -5px;
    }
    .attention-pill {
      position: relative;
      display: inline-grid;
      place-items: center;
      width: 34px;
      height: 34px;
      padding: 0;
      border: none;
      border-radius: 50%;
      cursor: pointer;
      pointer-events: auto;
      font: inherit;
      color: var(--primary-text-color);
      background: color-mix(in srgb, var(--card-background-color, #1c1e24) 60%, transparent);
      -webkit-backdrop-filter: blur(14px) saturate(1.5);
      backdrop-filter: blur(14px) saturate(1.5);
      box-shadow: inset 0 0 0 1px var(--divider-color, rgba(255, 255, 255, 0.14)), 0 4px 14px rgba(0, 0, 0, 0.35);
      transition: scale var(--av-dur-fast) var(--av-ease-spring);
      --mdc-icon-size: 20px;
    }
    .attention-pill ha-icon { color: var(--warning-color, #ffa600); }
    .attention-pill:active { scale: 0.96; }
    /* Count badge on the circle's top-right corner; hidden when count is 1. */
    .attention-pill .attention-count {
      position: absolute;
      top: -3px;
      right: -3px;
      min-width: 16px;
      height: 16px;
      padding: 0 4px;
      box-sizing: border-box;
      display: grid;
      place-items: center;
      border-radius: 8px;
      background: var(--warning-color, #ffa600);
      color: #1c1c1e;
      font-size: 11px;
      font-weight: 700;
      line-height: 1;
      pointer-events: none;
    }
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
      position: relative;
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
    /* quick-actions: FAB + anchored labeled sheet (bottom-right, rising up).
       Replaces the old radial spray — labeled pills read cleanly on phones and
       the scrim separates them from the marker field. */
    .quick {
      position: absolute;
      inset: 0;
      z-index: 7;
      pointer-events: none;
    }
    /* Dim scrim over the whole card; taps close the menu. Opacity-only fade so
       reduced-motion (which zeroes the duration token) collapses it instantly. */
    .quick-scrim {
      position: absolute;
      inset: 0;
      border: none;
      margin: 0;
      padding: 0;
      cursor: default;
      background: rgba(0, 0, 0, 0.44);
      -webkit-backdrop-filter: blur(2px);
      backdrop-filter: blur(2px);
      opacity: 0;
      pointer-events: none;
      transition: opacity var(--av-dur-fast) var(--av-ease-out);
    }
    .quick.open .quick-scrim {
      opacity: 1;
      pointer-events: auto;
    }
    .quick-fab {
      position: absolute;
      bottom: 12px;
      right: 12px;
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
      transform: rotate(90deg);
    }
    /* Vertical column of labeled pills, right-aligned above the FAB. Anchored to
       the FAB (bottom: 72px = 48px FAB + 12px inset + 12px gap). Scrolls
       internally if the actions exceed the available height (narrow phones). */
    .quick-menu {
      position: absolute;
      right: 12px;
      bottom: 72px;
      z-index: 3;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 8px;
      max-width: calc(100% - 24px);
      max-height: calc(100% - 96px);
      overflow-y: auto;
      pointer-events: none;
      scrollbar-width: thin;
    }
    .quick.open .quick-menu {
      pointer-events: auto;
    }
    .quick-action {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      min-height: 44px;
      max-width: 100%;
      padding: 0 16px;
      border: none;
      border-radius: 22px;
      cursor: pointer;
      pointer-events: inherit;
      font: inherit;
      font-size: 14px;
      font-weight: 500;
      text-align: left;
      color: var(--primary-text-color);
      background: color-mix(in srgb, var(--card-background-color, #1c1e24) 82%, transparent);
      -webkit-backdrop-filter: blur(14px) saturate(1.5);
      backdrop-filter: blur(14px) saturate(1.5);
      box-shadow: inset 0 0 0 1px var(--divider-color, rgba(255, 255, 255, 0.16)), 0 4px 14px rgba(0, 0, 0, 0.42);
      --mdc-icon-size: 20px;
      transform: translateY(10px) scale(0.94);
      opacity: 0;
      transition: transform var(--av-dur-fast) var(--av-ease-spring),
        opacity var(--av-dur-fast) var(--av-ease-out);
      transition-delay: var(--qd, 0s);
    }
    .quick-action ha-icon {
      flex: none;
      color: var(--primary-color, #03a9f4);
    }
    .quick-action .quick-action-label {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .quick.open .quick-action {
      transform: translateY(0) scale(1);
      opacity: 1;
    }
    .quick-action:active {
      scale: 0.97;
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
    if (this.isConnected && this._isCardEditorPreview()) {
      const activeElementId = editorPreviewElementId();
      this._editorElementPreviewId = activeElementId && this.config.spatial?.plan?.elements.some((element) => element.id === activeElementId)
        ? activeElementId
        : null;
    } else if (this._editorElementPreviewId && !this.config.spatial?.plan?.elements.some((element) => element.id === this._editorElementPreviewId)) {
      this._editorElementPreviewId = null;
    }
    this._syncPanZoomFromConfig();
    this._scheduleIdleReset();
  }

  public getCardSize(): number {
    return 8;
  }

  public getGridOptions(): { rows: number; columns: number; min_rows: number; min_columns: number } {
    return { rows: 8, columns: 12, min_rows: 4, min_columns: 6 };
  }

  private _onSpatialEntitySelected(event: CustomEvent<{ entityId: string }>): void {
    event.stopPropagation();
    fireEvent(this, 'hass-more-info', { entityId: event.detail.entityId });
  }

  private _setSpatialRoomFocus = (zoneId: string | null): void => {
    if (this._spatialFocusedZoneId === zoneId) return;
    this._spatialFocusedZoneId = zoneId;
    this._scheduleIdleReset();
  };

  static getConfigElement(): HTMLElement {
    return document.createElement('apartment-view-card-editor');
  }

  // HA calls getStubConfig(hass, entities); params accepted for future seeding.
  static getStubConfig(): ApartmentViewConfig {
    return normalizeConfig({
      type: 'custom:apartment-view-card',
      entities: [],
      zones: [],
      spatial: { plan: rectangularSpatialPlan(8, 6) },
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
    window.addEventListener(ELEMENT_INSPECTOR_EVENT, this._onEditorElementPreview as EventListener);
    if (this._isCardEditorPreview()) this._editorElementPreviewId = editorPreviewElementId();
    this.addEventListener('wheel', this._onWheel, { passive: false });
    // Desktop Safari trackpad pinch fires proprietary gesture events that
    // page-zoom the dashboard; we consume its ctrl-wheel stream instead
    // (spec P0-3 / F14b). Harmless no-op everywhere else.
    this.addEventListener('gesturestart', this._onGestureStart);
    window.addEventListener('pointermove', this._onWindowPointerMove);
    window.addEventListener('pointerup', this._onWindowPointerUp);
    window.addEventListener('pointercancel', this._onWindowPointerCancel);
    window.addEventListener('keydown', this._handleKeyDown);
    // The card listens for keyboard shortcuts on `window`; making the host
    // focusable only leaves a persistent Safari tap outline around the card.
    this.removeAttribute('tabindex');
    if (typeof ResizeObserver !== 'undefined') {
      this._ro = new ResizeObserver((entries) => {
        const w = entries[0]?.contentRect?.width;
        if (w && Math.abs(w - this._cardWidth) > 0.5) {
          this._cardWidth = w;
        }
        // Backstop for the matchMedia change event (some engines don't fire it
        // on every viewport change) — a breakpoint crossing almost always
        // resizes the card too, so re-read matches here.
        if (this._mql && this._mql.matches !== this._isMobileScreen) {
          this._isMobileScreen = this._mql.matches;
        }
      });
    }
    // Mobile-screen icon sizing: track the viewport breakpoint reactively so
    // options.iconSizeMobile / iconSizeMaxMobile apply on phones (spec: sizes
    // set "separately for desktop and mobile screen sizes").
    this._mql = window.matchMedia?.(`(max-width: ${MOBILE_BREAKPOINT_PX}px)`);
    if (this._mql) {
      this._isMobileScreen = this._mql.matches;
      this._mql.addEventListener('change', this._onBreakpointChange);
    }
    // Re-arm the multi-touch guards on reconnect (the wrapper node survives
    // in the persisted renderRoot; no-op before the first render).
    this._attachWrapperTouchGuards();
    this._scheduleIdleReset();
  }

  private _onBreakpointChange = (e: MediaQueryListEvent): void => {
    this._isMobileScreen = e.matches;
  };

  /** Effective marker sizes for the current screen (mobile override → desktop). */
  private _resolveIconSizes(): { iconSize: number; iconSizeMax: number } {
    const o = this.config.options;
    const mobile = this._isMobileScreen;
    return {
      iconSize: (mobile && o.iconSizeMobile) || o.iconSize,
      iconSizeMax: (mobile && o.iconSizeMaxMobile) || o.iconSizeMax,
    };
  }

  /**
   * Mobile floorplan frame (Fix 3 / options.aspectMobile). A wide plan renders
   * as a short box at width:100%; on phones we give it a TALLER wrapper (default
   * 4/5) and then CONTAIN the whole floorplan inside it — the plan keeps its
   * natural aspect, fills the width minus a small cushion, and is centered
   * vertically so the extra box height becomes top/bottom breathing room. The
   * ENTIRE plan (every edge, every marker) stays visible: this is fit/contain,
   * never cover/fill — nothing is cropped and nothing is up-scaled.
   *
   * Zero drift by construction: the wrapper carries `insetX` as horizontal
   * PADDING, so `_cardWidth` (from its contentRect) is the cushioned box width;
   * the `.frame` is inset by the same `insetX` (left/right) + `insetY`
   * (top/bottom), and every screen->scene mapping reads the `.frame` rect
   * (`_sceneRect()`), so markers/zones sit in the exact contained-and-centered
   * box the plan renders in.
   *
   * `aspect` = the wrapper's w/h ratio (drives CSS `aspect-ratio`). `insetX` =
   * the horizontal cushion per side (px). `insetY` = the top/bottom inset that
   * centers the natural-height plan in the taller wrapper (px). Returns null
   * (no frame) on desktop, before the image aspect is known, or when the
   * requested frame isn't taller than the plan renders naturally (nothing to
   * gain — the plan already fills or exceeds the box height).
   */
  private _mobileFrame(): { aspect: number; insetX: number; insetY: number } | null {
    if (!this._isMobileScreen || this._imgAspect === null) return null;
    const aspect = this.config.options.aspectMobile; // desired wrapper w/h
    const insetX = FRAME_CUSHION_PX; // horizontal cushion per side
    // _cardWidth === the wrapper's content-box (cushioned) width. The plan
    // renders at width:100% of it, so its natural height is cardWidth*imgAspect.
    // The wrapper's box height comes from its aspect-ratio over the FULL border
    // width (cushioned width + both cushions).
    const boxWidth = this._cardWidth + 2 * insetX;
    const boxHeight = boxWidth / aspect;
    const planHeight = this._cardWidth * this._imgAspect;
    const insetY = (boxHeight - planHeight) / 2;
    if (!(insetY > 0.5)) return null; // box no taller than the plan: skip (no gain)
    return { aspect, insetX, insetY };
  }

  public disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener(ELEMENT_INSPECTOR_EVENT, this._onEditorElementPreview as EventListener);
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
    this._cancelSceneTap();
    this._cancelWheelIdle();
    this._clearIdleReset();
    // A disconnect mid-gesture must not leak pointer state into the next
    // mount (HA re-attaches cards when switching tabs): a leaked entry makes
    // the first touch after reattach read size === 2 → phantom pinch, and a
    // stuck is-gesturing keeps chips opaque with frozen labels (review F-3).
    this._activePointers.clear();
    this._pinchStartDist = 0;
    this._lastMove = null;
    this._tapHold.reset();
    this._activeMarker = null;
    this._unlatchGesture();
    this._ro?.disconnect();
    this._ro = undefined;
    this._mql?.removeEventListener('change', this._onBreakpointChange);
    this._mql = undefined;
  }

  private _isCardEditorPreview(): boolean {
    let node: Node | null = this.parentNode
      ?? ((this.getRootNode() instanceof ShadowRoot) ? (this.getRootNode() as ShadowRoot).host : null);
    const visited = new Set<Node>();
    while (node && !visited.has(node)) {
      visited.add(node);
      if (node instanceof HTMLElement && node.matches('hui-card-preview')) return true;
      const root = node.getRootNode();
      node = node.parentNode ?? (root instanceof ShadowRoot ? root.host : null);
    }
    return false;
  }

  private _onEditorElementPreview = (event: CustomEvent<{ elementId: string | null }>): void => {
    if (!this._isCardEditorPreview()) return;
    const elementId = event.detail.elementId;
    this._editorElementPreviewId = elementId && this.config?.spatial?.plan?.elements.some((element) => element.id === elementId)
      ? elementId
      : null;
  };

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
    const illuminance = this.config?.options?.illuminanceEntity;
    const configuredIds = this.config ? this._floorData.entities.map((entity) => entity.entity) : [];
    const configured = new Set(configuredIds);
    const inferredEnvironmentIds = this.config?.spatial ? Object.values(next.states)
      .filter((state) => state.entity_id.startsWith('weather.') || (
        state.entity_id.startsWith('sensor.')
        && (String(state.attributes?.device_class ?? '').toLowerCase() === 'illuminance'
          || String(state.attributes?.unit_of_measurement ?? '').toLowerCase() === 'lx')
      ))
      .map((state) => state.entity_id) : [];
    const fallbackGroupIds = Object.values(next.states)
      .filter((state) => Array.isArray(state.attributes?.entity_id)
        && state.attributes.entity_id.some((member: string) => configured.has(member)))
      .map((state) => state.entity_id);
    const ids = [
      'sun.sun',
      ...(weather ? [weather] : []),
      ...(illuminance ? [illuminance] : []),
      ...configuredIds,
      ...inferredEnvironmentIds,
      ...fallbackGroupIds,
    ];
    return ids.some((id) => prev.states?.[id] !== next.states?.[id]);
  }

  protected willUpdate(changed: PropertyValues): void {
    if (changed.has('hass')) this._detectMotion(changed.get('hass') as HassLike | undefined);
    // Attention cycling is positional: when the attention set changes size,
    // the pill restarts from "N need attention" (spec P0-6). Only checked
    // while actively cycling and only on data changes — never per-frame.
    if (
      this._attentionCycle !== 0 &&
      (changed.has('hass') || changed.has('config')) &&
      this._attentionEntities().length !== this._attentionCycleCount
    ) {
      this._attentionCycle = 0;
    }
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
    // Observe the .wrapper. When the mobile taller-frame is active the wrapper
    // carries a horizontal cushion as PADDING, so its contentRect.width (what
    // the observer reads) is already the CUSHIONED coordinate-box width — the
    // scene + overlay live at inset:0 inside that same content box, so
    // _viewport()/_cardWidth and every marker coordinate line up exactly.
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

  /**
   * The on-screen rect of the floorplan's coordinate box — the `.frame`
   * element. Every screen->scene mapping (tap, wheel, pinch, double-tap)
   * subtracts this rect's origin, so it inherits the mobile cushion + vertical
   * centering for free: the scene + marker overlay live at inset:0 inside the
   * frame, so its top-left IS the (0,0) of `_viewport()`. Falls back to the
   * wrapper, then the host, when the frame isn't mounted yet.
   */
  private _sceneRect(): DOMRect {
    const el =
      (this.renderRoot?.querySelector('.frame') as HTMLElement | null) ??
      (this.renderRoot?.querySelector('.wrapper') as HTMLElement | null);
    return el?.getBoundingClientRect() ?? this.getBoundingClientRect();
  }

  /** Apply zoomMax + freePanZoom gate whenever config changes. */
  private _syncPanZoomFromConfig(): void {
    this._panZoom = new PanZoomController({
      zoomMax: this.config.options.zoomMax,
      // Cover-bounds clamp + rubber-band (spec P0-4). _viewport() is pure
      // state (width × aspect) — no layout reads on the gesture path.
      viewport: () => this._viewport(),
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
  private _animateTransformTo(
    t: ZoomTransform,
    opts: { snap?: boolean; onSettle?: () => void } = {},
  ): void {
    this._clearAnimating(); // restart cleanly if a move is already in flight
    // Reduced motion (0ms tokens) and no-op moves produce no transition, so
    // transitionend never fires and is-animating would park on the 640ms
    // fallback — swallowing exit taps and flashing chips opaque (review F-4).
    // Settle synchronously instead; onSettle still fires after the write.
    const cur = this._transform;
    if (
      this._reducedMotion() ||
      (cur.scale === t.scale && cur.panX === t.panX && cur.panY === t.panY)
    ) {
      this._transform = t;
      const settled = opts.onSettle;
      if (settled) requestAnimationFrame(() => settled());
      return;
    }
    this._animSnap = !!opts.snap;
    this._onSettleCb = opts.onSettle;
    this._isAnimating = true;
    this._transform = t;
    const scene = this.renderRoot?.querySelector('.scene');
    if (scene) {
      const onEnd = (e: Event): void => {
        if (e.target !== scene) return; // bubbled child transition, not the camera
        this._settleAnimating();
      };
      scene.addEventListener('transitionend', onEnd);
      this._sceneEndUnsub = () => scene.removeEventListener('transitionend', onEnd);
    }
    this._animateFallback = setTimeout(
      () => this._settleAnimating(),
      (opts.snap ? SNAP_MS : CAMERA_MS) + 80,
    );
  }

  /** The camera ARRIVED (transitionend or fallback, whichever first): clear
   * the animation state, then fire the one-shot settle callback (spec P0-6).
   * A restarted or torn-down move goes through _clearAnimating directly and
   * never fires its settle. */
  private _settleAnimating(): void {
    const settled = this._onSettleCb;
    this._clearAnimating();
    settled?.();
  }

  private _clearAnimating(): void {
    clearTimeout(this._animateFallback);
    this._animateFallback = undefined;
    this._sceneEndUnsub?.();
    this._sceneEndUnsub = undefined;
    this._onSettleCb = undefined; // superseded moves never fire their settle
    this._isAnimating = false;
    this._animSnap = false;
  }

  private _focusZone(zone: ZoneConfig, opts: { onSettle?: () => void } = {}): void {
    this._focusedZone = zone;
    this._animateTransformTo(
      zoomToZone(zone, this._viewport(), this.config.options.zoomMax),
      opts,
    );
    this._panZoom.setEnabled(false);
  }

  private _exitFocus(): void {
    this._focusedZone = null;
    this._attentionCycle = 0; // leaving a room ends the attention tour (P0-6)
    this._animateTransformTo({ scale: 1, panX: 0, panY: 0 });
    // Resync (spec P0-5): the controller may still hold a stale pre-focus
    // transform; the next gesture or double-tap must continue from the
    // identity we return to, not jump back to it.
    this._panZoom.reset();
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

  /**
   * Scene tap grammar (spec P0-5). A second tap within DOUBLE_TAP_MS /
   * DOUBLE_TAP_RADIUS_PX (gated by options.interaction.doubleTapZoom) is a
   * double-tap: toggle free zoom, at overview or already free-zoomed — never
   * while focused, where taps belong to the enter/exit logic. Anything else
   * arms the single-tap commit timer (immediate when double-tap zoom is off —
   * there is nothing to wait for).
   */
  private _onSceneTap(x: number, y: number, now: number): void {
    const prev = this._lastSceneTap;
    this._lastSceneTap = { x, y, t: now };
    const doubleTap = this.config.options.interaction.doubleTapZoom;
    if (
      doubleTap &&
      this._focusedZone === null &&
      prev !== null &&
      now - prev.t < DOUBLE_TAP_MS &&
      Math.hypot(x - prev.x, y - prev.y) < DOUBLE_TAP_RADIUS_PX
    ) {
      this._cancelSceneTap();
      this._lastSceneTap = null; // consumed — a third tap starts a fresh pair
      this._toggleDoubleTapZoom(x, y);
      return;
    }
    if (!doubleTap) {
      this._resolveSceneTap(x, y);
      return;
    }
    this._cancelSceneTap();
    this._sceneTapTimer = setTimeout(() => {
      this._sceneTapTimer = null;
      this._resolveSceneTap(x, y);
    }, SINGLE_TAP_MS);
  }

  /** Cancel a pending single-tap commit — any new pointerdown, pointercancel,
   * a gated wheel zoom, a floor switch, or Escape (spec P0-5 / F13). */
  private _cancelSceneTap(): void {
    if (this._sceneTapTimer !== null) {
      clearTimeout(this._sceneTapTimer);
      this._sceneTapTimer = null;
    }
  }

  /**
   * Double-tap toggle (spec P0-5): free-zoomed (scale > 1.02) → back to the
   * overview identity; at rest → zoom to min(zoomMax, 2) anchored at the tap
   * point, THROUGH the controller so the P0-4 cover-bounds clamp applies and
   * controller + card stay in sync. Double-tap zoom is a free zoom, so
   * options.freePanZoom gates it like every other one.
   */
  private _toggleDoubleTapZoom(x: number, y: number): void {
    if (!this.config.options.freePanZoom) return;
    if (this._transform.scale > 1.02) {
      this._panZoom.reset();
      this._animateTransformTo({ scale: 1, panX: 0, panY: 0 });
      return;
    }
    const rect = this._sceneRect();
    const targetScale = Math.min(this.config.options.zoomMax, 2);
    this._animateTransformTo(
      this._panZoom.pinchZoom(
        targetScale / this._panZoom.transform.scale,
        x - rect.left,
        y - rect.top,
      ),
    );
  }

  /**
   * Single-tap resolution (spec P0-5): wayfinding. At overview a tap inside a
   * zone focuses it; free-zoomed taps are pan/double-tap territory; while
   * focused, a tap inside another zone refocuses, inside the current zone
   * does nothing, and outside all zones exits — blocked while the camera is
   * in flight (F13: the state flag, not a fixed delay).
   */
  private _resolveSceneTap(x: number, y: number): void {
    if (this._floorData.zones.length === 0) return;
    const zone = this._zoneAtPoint(x, y);
    if (this._focusedZone === null) {
      if (this._transform.scale > 1.05) return; // free-zoomed: not wayfinding
      if (zone) this._focusZone(zone);
      return;
    }
    if (zone === this._focusedZone) return;
    if (zone) {
      this._focusZone(zone);
      return;
    }
    if (!this._isAnimating) this._exitFocus();
  }

  /**
   * Zone hit-test (spec P0-5 / F4). Primary path: the browser's own
   * projection via shadowRoot.elementsFromPoint over the percent-space
   * hit-rects — exact even under the focused-state perspective tilt. The
   * rects are permanently pointer-events:none; since some engines skip such
   * elements in elementsFromPoint, the wrapper's `.hit-testing` class flips
   * them hittable strictly for this synchronous call (never spans a frame, so
   * Lit can't clobber the class and the rects can't intercept anything).
   * Fallback (no elementsFromPoint — e.g. happy-dom): invert the 2D pan/zoom
   * math. Exact at overview where the tilt is none; while focused the
   * rotateX(11deg) perspective makes the inversion slightly imprecise near
   * the viewport edges — acceptable for a test-environment fallback.
   */
  private _zoneAtPoint(x: number, y: number): ZoneConfig | null {
    const zones = this._floorData.zones;
    const root = this.shadowRoot;
    const wrapper = this.renderRoot?.querySelector('.wrapper') as HTMLElement | null;
    if (wrapper && root && typeof root.elementsFromPoint === 'function') {
      wrapper.classList.add('hit-testing');
      try {
        // Topmost-first; smaller zones render later, so the first hit is the
        // smallest containing zone — the same rule as zoneForPoint.
        for (const el of root.elementsFromPoint(x, y)) {
          const idx = (el as HTMLElement).dataset?.zoneIndex;
          if (idx !== undefined) return zones[Number(idx)] ?? null;
        }
        return null;
      } finally {
        wrapper.classList.remove('hit-testing');
      }
    }
    const rect = this._sceneRect();
    const t = this._transform;
    const vp = this._viewport();
    const xPct = ((x - rect.left - t.panX) / t.scale / vp.width) * 100;
    const yPct = ((y - rect.top - t.panY) / t.scale / vp.height) * 100;
    return zoneForPoint(xPct, yPct, zones);
  }

  /**
   * The interactive marker under a screen point, if any (spec §3: marker taps
   * outrank zone focus at every zoom level). The marker overlay sits ABOVE the
   * scene with each `.marker` button `pointer-events:auto`, so a tap on a chip
   * hits the button — but a small chip on a phone can leave the button's own
   * pointerdown un-latched (the touch centroid resolves to the overlay gap or
   * the scene), so `_activeMarker` stays null and the scene-tap path would
   * steal the tap for zone focus. Re-hit-testing here at RESOLUTION time makes
   * the marker win regardless: `elementsFromPoint` reports the topmost `.marker`
   * (or its `ha-icon`/glyph children) whenever the point is over the chip.
   * `dimmed`/`select-dim` markers are `pointer-events:none`, so they correctly
   * never appear here — the tap falls through to zone wayfinding, as intended.
   */
  private _markerViewAtPoint(x: number, y: number): MarkerView | null {
    const root = this.shadowRoot;
    if (!root || typeof root.elementsFromPoint !== 'function') return null;
    for (const el of root.elementsFromPoint(x, y)) {
      const btn = (el as HTMLElement).closest?.('.marker[data-entity]') as
        | HTMLElement
        | null;
      const id = btn?.dataset?.entity;
      if (id) {
        const view = this._lastViews.find((v) => v.entity.entity === id);
        if (view) return view;
      }
      // A zone-hit rect or the scene surfacing first means no marker is on top.
      if ((el as HTMLElement).dataset?.zoneIndex !== undefined) break;
      if ((el as HTMLElement).classList?.contains('scene')) break;
    }
    return null;
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

  /**
   * True when a Home Assistant dialog is topmost (a hold-opened more-info, or
   * any other dashboard dialog). HA renders these as `ha-dialog[open]` inside
   * the `home-assistant` element's shadow root (`ha-more-info-dialog` wraps its
   * own `ha-dialog`), so a single `ha-dialog[open]` query catches all of them.
   */
  private _hasOpenHaDialog(): boolean {
    const root = document.querySelector('home-assistant')?.shadowRoot;
    return !!root?.querySelector('ha-dialog[open]');
  }

  private _handleKeyDown = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape') return;
    // F10: Escape is a no-op when a HA dialog is topmost and the keystroke did
    // not originate inside this card. The card's hold gesture opens a native
    // more-info dialog; pressing Escape to close THAT dialog (or one from any
    // other dashboard card) must not tear down card state behind it. The
    // window listener stays (Esc must work after a click moved focus away),
    // but is scoped to the host via composedPath when a dialog is open.
    if (!e.composedPath().includes(this) && this._hasOpenHaDialog()) return;
    this._cancelSceneTap(); // Escape aborts a pending scene tap (F13)
    this._attentionCycle = 0; // …and ends the attention tour (P0-6)
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
    this._scheduleIdleReset();
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
      // Pass-through: the page is about to scroll under a possibly-armed
      // single-tap timer — its stored client coords go stale, so the 250ms-
      // late hit-test would resolve the wrong zone. Cancel it (review F-5).
      this._cancelSceneTap();
      this._maybeShowWheelHint();
      return;
    }
    e.preventDefault();
    this._cancelSceneTap(); // a gated wheel zoom cancels a pending tap (F13)
    // A wheel zoom is direct manipulation too: cancel any in-flight camera
    // move so the write isn't eased through the 560ms curve (review F-2).
    this._clearAnimating();
    // Latch the gesture engine for the whole gated-wheel stream (spec L7):
    // trackpad pinch and kiosk plain-wheel arrive as a ~60-120Hz ctrl-wheel
    // stream, so without latching, computeMarkerViews runs UN-frozen (fresh
    // Intl.NumberFormat + O(n²) label cull per event) and 20+ frosted markers
    // keep backdrop-filter blur live under a transforming scene. _latchGesture
    // is a no-op if a pointer gesture already latched (its unlatch wins). A
    // wheel-idle timeout unlatches ~160ms after the last gated wheel event; a
    // single discrete notch unlatches invisibly.
    this._armWheelIdle();
    // deltaMode 1 = lines (Firefox); normalize to px before the exp curve (F6).
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    // Anchor on the CANVAS rect, not the host (host includes the HUD row —
    // anchoring there zooms toward a point ~44px below the cursor).
    const r = this._sceneRect();
    this._transform = this._panZoom.wheelZoom(
      dy,
      e.clientX - r.left,
      e.clientY - r.top
    );
  };

  /**
   * Latch the gesture engine (frozen labels + is-gesturing) for a gated-wheel
   * stream and (re)arm the idle timeout that unlatches it. Each gated wheel
   * event refreshes the timer, so the whole ~60-120Hz ctrl-wheel stream shares
   * one latch; ~160ms after the last event it unlatches. Idempotent latch —
   * a pointer gesture already in flight owns the latch, and the idle callback
   * defers to it (never unlatches while pointers are down, so it can't
   * double-unlatch or steal the pointer path's latch).
   */
  private _armWheelIdle(): void {
    this._latchGesture();
    if (this._wheelIdleTimer !== null) clearTimeout(this._wheelIdleTimer);
    this._wheelIdleTimer = setTimeout(() => {
      this._wheelIdleTimer = null;
      // A pointer gesture may have started mid-stream; its latch/unlatch wins.
      if (this._activePointers.size === 0) this._unlatchGesture();
    }, WHEEL_IDLE_MS);
  }

  /** Cancel a pending wheel-idle unlatch (disconnect / pointer takeover). */
  private _cancelWheelIdle(): void {
    if (this._wheelIdleTimer !== null) {
      clearTimeout(this._wheelIdleTimer);
      this._wheelIdleTimer = null;
    }
  }

  private _clearIdleReset(): void {
    if (this._idleResetTimer === null) return;
    clearTimeout(this._idleResetTimer);
    this._idleResetTimer = null;
  }

  private _scheduleIdleReset(): void {
    this._clearIdleReset();
    const seconds = this.config?.options?.idleTimeout ?? 0;
    if (!this.isConnected || seconds <= 0) return;
    this._idleResetTimer = setTimeout(() => {
      this._idleResetTimer = null;
      this._quickOpen = false;
      this._controlled = [];
      this._selectMode = false;
      if (this._spatialFocusedZoneId !== null) this._spatialFocusedZoneId = null;
      if (this._focusedZone !== null) {
        this._exitFocus();
      } else if (this._transform.scale !== 1 || this._transform.panX !== 0 || this._transform.panY !== 0) {
        this._panZoom.reset();
        this._animateTransformTo({ scale: 1, panX: 0, panY: 0 });
      }
    }, seconds * 1_000);
  }

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

  /**
   * Shared pointer registration for scene AND marker pointerdowns. Returns
   * true when this pointer became the second finger of a pinch — the
   * pinch-begin branch must run regardless of which surface the second
   * finger lands on (with 20+ chips covering the plan it often lands on a
   * marker): otherwise the tap tracker is restarted for the second finger,
   * pointermove feeds interleaved two-finger deltas through the single-
   * pointer pan path (violent jitter instead of zoom), and a still
   * two-finger press can release as outcome 'tap' with _activeMarker set —
   * phantom device activation (spec §3: 2-finger anything → card owns it).
   */
  private _registerPointer(e: PointerEvent): boolean {
    this._scheduleIdleReset();
    this._cancelSceneTap(); // any new pointer cancels a pending single-tap (F13)
    this._activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this._activePointers.size === 2) {
      // begin pinch
      const [a, b] = [...this._activePointers.values()];
      this._pinchStartDist = this._panZoom.pinchDistance(a.x, a.y, b.x, b.y);
      this._pinchStartScale = this._panZoom.transform.scale;
      this._cancelHold();
      // A pinch is never a tap/hold/marker gesture: the pinch branch bypasses
      // _tapHold.move, so without a reset the first finger's release could
      // still classify 'tap' and fire a phantom scene tap / marker
      // activation (spec P0-5); _activeMarker must clear for the same reason.
      this._tapHold.reset();
      this._activeMarker = null;
      return true;
    }
    return false;
  }

  private _onScenePointerDown = (e: PointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    if (this._registerPointer(e)) return;
    // single pointer: candidate tap/hold/pan on the SCENE (not a marker)
    this._activeMarker = null;
    this._beginGesture(e);
  };

  private _onMarkerPointerDown = (e: PointerEvent, m: MarkerView) => {
    e.stopPropagation();
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    if (this._registerPointer(e)) return;
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

  /**
   * Entities needing attention, in render order — the same attentionFor
   * decision computeMarkerViews makes per marker, so the pill's cycle count
   * always equals the badge count on the glass.
   */
  private _attentionEntities(): EntityConfig[] {
    const states = this.hass?.states ?? {};
    return this._floorData.entities.filter((e) => attentionFor(states[e.entity]) !== null);
  }

  /**
   * The pill is a promise, not a decoration (spec P0-6): each tap flies the
   * camera to the next attention item — its containing zone when it has one,
   * else a 1.35× camera centered on the marker (a zero-size zone through
   * zoomToZone: same centering math, same cover-bounds clamp, F16) — and
   * fires the locate pulse as the arrival flourish once the camera settles.
   */
  /** Exit the attention tour: camera back to overview, cycle reset (rc.2). */
  private _exitAttentionTour = (): void => {
    this._exitFocus(); // resets _attentionCycle + animates to identity
  };

  private _goToAttention = (): void => {
    const items = this._attentionEntities();
    if (!items.length) return;
    if (items.length !== this._attentionCycleCount) {
      // The attention set changed since the last tap — restart the tour.
      this._attentionCycle = 0;
      this._attentionCycleCount = items.length;
    }
    const item = items[this._attentionCycle % items.length];
    const zone = zoneForEntity(item, this._floorData.zones);
    const onSettle = (): void => this._pulseAttention();
    if (zone) {
      this._focusZone(zone, { onSettle });
    } else {
      // A zoneless item is viewed from the free camera: leave any focused
      // state (NOT via _exitFocus — that would reset this very cycle and fly
      // to identity) so the target marker is never dimmed and the pan/zoom
      // gates match what is on screen.
      this._focusedZone = null;
      const camera = zoomToZone(
        { name: item.entity, x: item.x, y: item.y, width: 0, height: 0 },
        this._viewport(),
        ATTENTION_ZOOM,
      );
      this._animateTransformTo(camera, { onSettle });
      // A machine move outside the zone system: adopt it in the controller
      // so a follow-up pan/double-tap continues from here, not from a stale
      // transform (same sync rule as P0-4/P0-5).
      this._panZoom.syncTo(camera);
      this._panZoom.setEnabled(this.config.options.freePanZoom);
    }
    this._attentionCycle += 1;
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
    this._cancelSceneTap(); // the tapped zone no longer exists (F13)
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
        const match = /^([a-z0-9_]+)\.([a-z0-9_]+)$/i.exec(qa.service.trim());
        if (!match) {
          this.dispatchEvent(new CustomEvent('hass-notification', {
            detail: { message: `“${qa.name}” needs a valid domain.service action.` },
            bubbles: true,
            composed: true,
          }));
          this._quickOpen = false;
          return;
        }
        this.hass.callService(match[1], match[2], qa.data ?? {});
      } else if (qa.entity) {
        const entityId = qa.entity.trim();
        if (!/^[a-z0-9_]+\.[a-z0-9_]+$/i.test(entityId)) {
          this.dispatchEvent(new CustomEvent('hass-notification', {
            detail: { message: `“${qa.name}” needs a valid entity ID.` },
            bubbles: true,
            composed: true,
          }));
          this._quickOpen = false;
          return;
        }
        this.hass.callService('homeassistant', 'turn_on', { entity_id: entityId });
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
    // A pointer stream takes over the latch lifecycle: drop any pending
    // wheel-idle unlatch so it can't fire mid-drag or double-unlatch.
    this._cancelWheelIdle();
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
    // The finger takes the glass: cancel any in-flight machine move NOW.
    // Otherwise per-frame gesture writes are retargeted through the 560ms
    // camera curve (rubber-lag, violating doctrine L2) and the fallback
    // timer strips is-animating MID-DRAG — a visible snap under the finger.
    this._clearAnimating();
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
      // Anchor on the CANVAS rect, not the host: the host includes the HUD
      // row (and floor tabs) above the wrapper, which would shift the pinch
      // anchor down by their height (review: anchor-offset finding).
      const r = this._sceneRect();
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
    } else if (
      outcome === 'tap' &&
      this._activeMarker === null &&
      this._activePointers.size === 0
    ) {
      // Marker precedence (spec §3): a tap that landed on a marker chip must do
      // the MARKER action, never zone focus — even when the chip's own
      // pointerdown didn't latch _activeMarker (small phone hit target). Re-hit-
      // test the release point; a marker on top wins outright.
      const marker = this.hass ? this._markerViewAtPoint(e.clientX, e.clientY) : null;
      if (marker) {
        this._activateEntity(marker.entity);
      } else {
        // Scene tap (spec P0-5): wayfinding + double-tap zoom. The size guard
        // keeps the first-lifted finger of a multi-touch from reading as a tap.
        this._onSceneTap(e.clientX, e.clientY, now);
      }
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
    } else if (outcome === 'drag' && this._focusedZone === null) {
      // Free-pan settle (spec P0-4): a drag left overshot rubber-bands back
      // to the cover-bounds; a release resting below scale 1.06 returns to
      // the overview identity (controller resynced so both stay in step).
      const { target, overshot } = this._panZoom.release();
      if (overshot) {
        this._animateTransformTo(target, { snap: true });
      } else if (target.scale < 1.06 && target.scale !== 1) {
        this._panZoom.reset();
        this._animateTransformTo({ scale: 1, panX: 0, panY: 0 });
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
    this._cancelSceneTap();
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

  /**
   * Invisible per-zone hit-rects (spec P0-5 / F4), percent-positioned inside
   * the transformed scene. Larger zones render FIRST so the topmost
   * elementsFromPoint hit is the smallest containing zone — matching
   * zoneForPoint's smallest-area-wins rule. data-zone-index carries the
   * position in the UNSORTED zones array.
   */
  private _renderZoneHits(): TemplateResult | typeof nothing {
    const zones = this._floorData.zones;
    if (!zones.length) return nothing;
    const byAreaDesc = zones
      .map((z, i) => ({ z, i }))
      .sort((a, b) => b.z.width * b.z.height - a.z.width * a.z.height);
    return html`${byAreaDesc.map(
      ({ z, i }) => html`<div
        class="zone-hit"
        aria-hidden="true"
        data-zone-index=${i}
        style="left:${z.x}%;top:${z.y}%;width:${z.width}%;height:${z.height}%"
      ></div>`,
    )}`;
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  protected render(): TemplateResult {
    const spatial = this.config?.spatial;
    if (spatial?.plan || spatial?.shell) {
      const inspectingElement = this._editorElementPreviewId
        ? spatial.plan?.elements.find((element) => element.id === this._editorElementPreviewId)
        : undefined;
      return html`<ha-card>
        ${!inspectingElement && this.config.zones.length ? html`<nav class="spatial-room-navigation" aria-label="Rooms">
          ${this._spatialFocusedZoneId !== null ? html`<button type="button" class="spatial-room-back"
            aria-label="Back to apartment overview" title="Overview"
            @click=${() => this._setSpatialRoomFocus(null)}>
            <ha-icon icon="mdi:arrow-left"></ha-icon>
          </button><span class="spatial-room-divider" aria-hidden="true"></span>` : nothing}
          <div class="spatial-room-rail">
            ${this.config.zones.map((zone) => html`<button type="button"
              aria-pressed=${this._spatialFocusedZoneId === zone.id}
              @click=${() => this._setSpatialRoomFocus(zone.id ?? null)}>${zone.name}</button>`)}
          </div>
        </nav>` : nothing}
        <spatial-preview
        .zones=${this.config.zones}
        .entities=${this.config.entities}
        .openings=${spatial.openings}
        .walls=${spatial.walls}
        .site=${spatial.site}
        .dimensions=${spatial.dimensions}
        .plan=${spatial.plan}
        .shell=${spatial.shell ?? null}
        .hass=${this.hass}
        .hideWalls=${this.config.options.hideWalls}
        .overviewResetSeconds=${this.config.options.idleTimeout}
        .latitude=${spatial.site.latitude ?? this.hass?.config?.latitude ?? 0}
        .longitude=${spatial.site.longitude ?? this.hass?.config?.longitude ?? 0}
        .weatherEntity=${this.config.options.weatherEntity ?? ''}
        .illuminanceEntity=${this.config.options.illuminanceEntity ?? ''}
        .spatialLightingMode=${this.config.options.spatialLightingMode}
        .isolatedElementId=${inspectingElement?.id ?? ''}
        .focusedZoneId=${this._spatialFocusedZoneId}
        .showRoomControls=${false}
        @spatial-entity-selected=${this._onSpatialEntitySelected}
      ></spatial-preview></ha-card>`;
    }
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

    const { iconSize, iconSizeMax } = this._resolveIconSizes();
    const maxIconScale = iconSize > 0 ? iconSizeMax / iconSize : 2;
    // Mobile taller-frame (Fix 3): overrides the wrapper aspect + scales the
    // whole floorplan (via .frame) to fill it. null on desktop / no gain.
    const frame = this._mobileFrame();
    const allViews = computeMarkerViews(
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
    const roomFocused = this._focusedZone !== null;
    const views = allViews.filter((view) => markerIsVisible(
      view.entity,
      this.config.options.presentation ?? 'control-heavy',
      {
        state: view.state,
        active: view.active,
        attention: view.attention,
        roomFocused,
        selectMode: this._selectMode,
      },
    ));
    this._lastViews = views; // snapshot source for the gesture label freeze
    const attentionCount = allViews.filter((v) => v.attention).length;

    const floors = this.config.floors ?? [];

    // HUD row above the canvas: attention pill (left) + lights control (right).
    // The pill label counts the tour while cycling ("2 of 3", spec P0-6).
    const attentionLabel =
      this._attentionCycle > 0
        ? `Attention ${((this._attentionCycle - 1) % attentionCount) + 1} of ${attentionCount} — go to the next one`
        : `${attentionCount} need${attentionCount === 1 ? 's' : ''} attention — go to the next one`;
    // The corner badge counts the tour while cycling ("2"), else the total
    // count; hidden entirely when a single item needs attention (round glyph
    // alone reads clearly). No text label on the chip itself (field feedback).
    const attentionBadge =
      this._attentionCycle > 0
        ? `${((this._attentionCycle - 1) % attentionCount) + 1}`
        : attentionCount > 1
        ? `${attentionCount}`
        : null;
    const attentionPill =
      attentionCount > 0 && !this._selectMode
        ? html`<button
            class="attention-pill"
            @click=${this._goToAttention}
            aria-label=${attentionLabel}
            title="Go to the next item that needs attention"
          >
            <ha-icon icon="mdi:alert-circle"></ha-icon>
            ${attentionBadge !== null
              ? html`<span class="attention-count" aria-hidden="true">${attentionBadge}</span>`
              : nothing}
          </button>`
        : nothing;
    // While the attention tour is cycling, the right HUD slot becomes the way
    // OUT (rc.1 field feedback: the tour had no exit). Exiting zooms back to
    // the overview and resets the cycle via _exitFocus.
    const tourActive = this._attentionCycle > 0 && attentionCount > 0;
    const lightsControl = tourActive
      ? html`<button
          class="lights-control"
          @click=${this._exitAttentionTour}
          aria-label="Exit the attention tour and zoom back out"
        >
          <ha-icon icon="mdi:close"></ha-icon>
          <span>Exit</span>
        </button>`
      : this._hasLights()
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
          class="wrapper ${this._isAnimating
            ? `is-animating${this._animSnap ? ' is-animating-snap' : ''}`
            : ''} ${this._isGesturing ? 'is-gesturing' : ''}"
          style="--av-icon-size:${iconSize}px;${frame
            ? ` aspect-ratio:${frame.aspect}; padding:0 ${frame.insetX}px; --av-frame-inset-x:${frame.insetX}px; --av-frame-inset-y:${frame.insetY}px;`
            : ''} touch-action:${t.scale > 1 &&
          this._focusedZone === null
            ? 'none' /* free-zoomed: the card owns single-finger pan */
            : 'pan-y' /* overview + focused: vertical swipes scroll the dashboard */}"
        >
          <div class="frame ${frame ? 'framed' : ''}">
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
              ${guard([this._floorData.zones], () => this._renderZoneHits())}
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
    // Rows are laid out top-to-bottom but rise from the FAB, so the bottom-most
    // (last) row leads the stagger. flex-direction stays natural (source order);
    // the delay counts up from the bottom for a bottom-up ripple.
    const n = actions.length;
    return html`
      <div class="quick ${this._quickOpen ? 'open' : ''}">
        <button
          class="quick-scrim"
          aria-label="Close quick actions"
          tabindex=${this._quickOpen ? '0' : '-1'}
          @click=${() => {
            this._quickOpen = false;
          }}
        ></button>
        <div class="quick-menu" role="menu" aria-label="Quick actions">
          ${actions.map(
            (qa, i) => html`<button
              class="quick-action"
              role="menuitem"
              style="--qd:${((n - 1 - i) * 0.03).toFixed(2)}s"
              title=${qa.name}
              tabindex=${this._quickOpen ? '0' : '-1'}
              @click=${() => this._runQuickAction(qa)}
            >
              <ha-icon icon=${qa.icon ?? 'mdi:flash'}></ha-icon>
              <span class="quick-action-label">${qa.name}</span>
            </button>`,
          )}
        </div>
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
