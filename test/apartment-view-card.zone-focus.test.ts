// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '../src/apartment-view-card';
import type { ApartmentViewCard } from '../src/apartment-view-card';
import type { ApartmentViewConfig, ZoneConfig } from '../src/core/config';

const living: ZoneConfig = { name: 'Living', x: 40, y: 40, width: 20, height: 20 };
const kitchen: ZoneConfig = { name: 'Kitchen', x: 0, y: 0, width: 30, height: 30 };

function makeConfig(): ApartmentViewConfig {
  return {
    type: 'custom:apartment-view-card',
    images: { base: '/x.png' },
    entities: [],
    zones: [living, kitchen],
    options: {
      view: 'auto',
      lightStyle: 'lit',
      freePanZoom: true,
      zoomMax: 1.5,
      duskDawnOffsetMinutes: 60,
      labels: { source: 'none', visibility: 'auto', densityCap: 14 },
      iconSize: 44,
      iconSizeMax: 88,
      interaction: { wheel: 'modifier', doubleTapZoom: true, roomSwipe: true, inertia: true },
      idleTimeout: 0,
    },
    quickActions: [],
  };
}

function makeCard(): ApartmentViewCard {
  const el = document.createElement('apartment-view-card') as ApartmentViewCard;
  // Inject config + a deterministic viewport without a full HA mount.
  (el as any).config = makeConfig();
  (el as any)._viewport = () => ({ width: 1000, height: 800 });
  return el;
}

describe('ApartmentViewCard zone focus state machine', () => {
  let card: ApartmentViewCard;
  beforeEach(() => {
    card = makeCard();
  });

  it('starts in overview (no focused zone, identity transform)', () => {
    expect((card as any)._focusedZone).toBeNull();
  });

  it('_focusZone sets the focused zone and a zoomToZone transform', () => {
    (card as any)._focusZone(living);
    expect((card as any)._focusedZone).toBe(living);
    // 20% zone -> fit 5x, capped at zoomMax 1.5.
    expect((card as any)._transform.scale).toBeCloseTo(1.5, 6);
    // center 50%,50% => px (500,400); pan -250,-200 within clamp [-500,0]/[-400,0].
    expect((card as any)._transform.panX).toBeCloseTo(-250, 6);
    expect((card as any)._transform.panY).toBeCloseTo(-200, 6);
  });

  it('_exitFocus returns to overview with identity transform', () => {
    (card as any)._focusZone(living);
    (card as any)._exitFocus();
    expect((card as any)._focusedZone).toBeNull();
    expect((card as any)._transform).toEqual({ scale: 1, panX: 0, panY: 0 });
  });

  it('_onZoneChip routes a zone chip to focus and a back chip to exit', () => {
    (card as any)._onZoneChip({ kind: 'zone', label: 'Living', icon: '', zone: living, index: 0 });
    expect((card as any)._focusedZone).toBe(living);
    (card as any)._onZoneChip({ kind: 'back', label: '← Back to All', icon: '', zone: null, index: 0 });
    expect((card as any)._focusedZone).toBeNull();
  });

  it('Escape exits focus', () => {
    (card as any)._focusZone(living);
    (card as any)._handleKeyDown(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect((card as any)._focusedZone).toBeNull();
  });

  it('free pan/zoom is suppressed while focused', () => {
    (card as any)._focusZone(living);
    const before = { ...(card as any)._transform };
    // Wheel must not mutate transform while focused.
    (card as any)._onWheel(new WheelEvent('wheel', { deltaY: -100 }));
    expect((card as any)._transform).toEqual(before);
  });
});

describe('ApartmentViewCard room swipe while focused (P0-1)', () => {
  let card: ApartmentViewCard;
  beforeEach(() => {
    card = makeCard();
  });

  // Drive the pointer handlers directly (the card is not mounted here, so
  // window listeners are not attached — same pattern as _onWheel above).
  const down = (x: number, y: number, id = 1) =>
    (card as any)._onScenePointerDown(
      new PointerEvent('pointerdown', { pointerId: id, clientX: x, clientY: y, button: 0 }),
    );
  const move = (x: number, y: number, id = 1) =>
    (card as any)._onWindowPointerMove(
      new PointerEvent('pointermove', { pointerId: id, clientX: x, clientY: y }),
    );
  const up = (x: number, y: number, id = 1) =>
    (card as any)._onWindowPointerUp(
      new PointerEvent('pointerup', { pointerId: id, clientX: x, clientY: y }),
    );

  it('a fast horizontal swipe left advances to the next zone by center-x', () => {
    (card as any)._focusZone(kitchen); // center-x 15 → next by center-x is living (50)
    down(400, 300);
    move(300, 310); // dx -100 (>56), dy 10 → mostly horizontal
    up(300, 310);
    expect((card as any)._focusedZone).toBe(living);
  });

  it('swipe right goes to the previous zone and clamps at the ends (no wrap)', () => {
    (card as any)._focusZone(living);
    down(300, 300);
    move(400, 290);
    up(400, 290);
    expect((card as any)._focusedZone).toBe(kitchen);
    // kitchen is leftmost — a further swipe right stays put.
    down(300, 300, 2);
    move(400, 290, 2);
    up(400, 290, 2);
    expect((card as any)._focusedZone).toBe(kitchen);
  });

  it('a vertical drag while focused does not change the zone', () => {
    (card as any)._focusZone(kitchen);
    down(400, 300);
    move(395, 420); // dy 120 dominates → not a room swipe
    up(395, 420);
    expect((card as any)._focusedZone).toBe(kitchen);
  });

  it('a drag while focused never clobbers the zone transform', () => {
    (card as any)._focusZone(kitchen);
    const before = { ...(card as any)._transform };
    down(400, 300);
    move(395, 420);
    up(395, 420);
    expect((card as any)._transform).toEqual(before);
  });

  it('interaction.roomSwipe:false gates the swipe off (spec v2.5 §7)', () => {
    const cfg = makeConfig();
    cfg.options.interaction.roomSwipe = false;
    (card as any).config = cfg;
    (card as any)._focusZone(kitchen);
    down(400, 300);
    move(300, 310); // same gesture that pages to `living` when enabled
    up(300, 310);
    expect((card as any)._focusedZone).toBe(kitchen);
  });
});

// ---------------------------------------------------------------------------
// Scene taps + double-tap zoom (spec P0-5). The card is unmounted (no shadow
// root), so _zoneAtPoint runs the pure 2D math-inversion fallback — exact at
// overview and against the stubbed 1000×800 viewport. Fake timers drive the
// 250ms single-tap commit window (performance.now is faked too, so every
// down→up pair classifies as a tap).
// ---------------------------------------------------------------------------

describe('ApartmentViewCard scene taps + double-tap zoom (P0-5)', () => {
  let card: ApartmentViewCard;
  beforeEach(() => {
    vi.useFakeTimers();
    card = makeCard();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const down = (x: number, y: number, id = 1) =>
    (card as any)._onScenePointerDown(
      new PointerEvent('pointerdown', { pointerId: id, clientX: x, clientY: y, button: 0 }),
    );
  const up = (x: number, y: number, id = 1) =>
    (card as any)._onWindowPointerUp(
      new PointerEvent('pointerup', { pointerId: id, clientX: x, clientY: y }),
    );
  const move = (x: number, y: number, id = 1) =>
    (card as any)._onWindowPointerMove(
      new PointerEvent('pointermove', { pointerId: id, clientX: x, clientY: y }),
    );
  const tap = (x: number, y: number, id = 1) => {
    down(x, y, id);
    up(x, y, id);
  };

  // Viewport 1000×800 at identity: living (40..60%, 40..60%) = px 400..600 ×
  // 320..480; kitchen (0..30%, 0..30%) = px 0..300 × 0..240.

  it('a single tap inside a zone focuses it after the double-tap window', () => {
    tap(450, 350);
    // The commit window is still open — nothing focused yet.
    expect((card as any)._focusedZone).toBeNull();
    vi.advanceTimersByTime(250);
    expect((card as any)._focusedZone).toBe(living);
  });

  it('doubleTapZoom:false resolves the tap immediately (no delay)', () => {
    const cfg = makeConfig();
    cfg.options.interaction.doubleTapZoom = false;
    (card as any).config = cfg;
    tap(450, 350);
    expect((card as any)._focusedZone?.name).toBe('Living');
  });

  it('a tap outside all zones while focused exits focus', () => {
    (card as any)._focusZone(living);
    vi.advanceTimersByTime(700); // camera settled — is-animating cleared
    // (900,100) inverts through the zone camera (1.5, -250, -200) to
    // (76.7%, 25%) — outside living and kitchen.
    tap(900, 100);
    vi.advanceTimersByTime(250);
    expect((card as any)._focusedZone).toBeNull();
    expect((card as any)._transform).toEqual({ scale: 1, panX: 0, panY: 0 });
  });

  it('exit-by-tap is blocked while the camera is animating (F13)', () => {
    (card as any)._focusZone(living); // is-animating until the 640ms fallback
    tap(900, 100);
    vi.advanceTimersByTime(250); // tap resolves mid-flight → blocked
    expect((card as any)._focusedZone).toBe(living);
    vi.advanceTimersByTime(400); // camera settles
    tap(900, 100);
    vi.advanceTimersByTime(250);
    expect((card as any)._focusedZone).toBeNull();
  });

  it('while focused: tap inside the current zone is a no-op, inside another refocuses', () => {
    (card as any)._focusZone(living);
    vi.advanceTimersByTime(700);
    const before = { ...(card as any)._transform };
    // (500,400) inverts to (50%, 50%) — inside the focused living zone.
    tap(500, 400);
    vi.advanceTimersByTime(250);
    expect((card as any)._focusedZone).toBe(living);
    expect((card as any)._transform).toEqual(before);
    // (50,40) inverts to (20%, 20%) — inside kitchen.
    tap(50, 40);
    vi.advanceTimersByTime(250);
    expect((card as any)._focusedZone).toBe(kitchen);
  });

  it('double-tap toggles free zoom up, a second double-tap returns to identity', () => {
    tap(450, 350);
    tap(450, 350); // same spot, same faked instant → double-tap
    // min(zoomMax 1.5, 2) anchored at (450,350) with a zero rect:
    // pan = anchor - anchor * 1.5.
    expect((card as any)._transform.scale).toBeCloseTo(1.5, 6);
    expect((card as any)._transform.panX).toBeCloseTo(-225, 6);
    expect((card as any)._transform.panY).toBeCloseTo(-175, 6);
    // Controller stays in sync (the machine move went through pinchZoom).
    expect((card as any)._panZoom.transform.scale).toBeCloseTo(1.5, 6);
    // The first tap's pending commit was cancelled — no zone focus sneaks in.
    vi.advanceTimersByTime(300);
    expect((card as any)._focusedZone).toBeNull();

    tap(450, 350);
    tap(450, 350); // fresh pair (the consumed pair never chains a triple)
    expect((card as any)._transform).toEqual({ scale: 1, panX: 0, panY: 0 });
    expect((card as any)._panZoom.transform).toEqual({ scale: 1, panX: 0, panY: 0 });
  });

  it('a second pointerdown cancels the pending single-tap commit (F13)', () => {
    tap(450, 350); // inside living — would focus at +250ms
    down(700, 100, 2); // any new pointer cancels the pending commit
    up(700, 100, 2); // …and its own tap resolves outside all zones → no-op
    vi.advanceTimersByTime(300);
    expect((card as any)._focusedZone).toBeNull();
  });

  it('no zones configured → scene taps do nothing', () => {
    const cfg = makeConfig();
    cfg.zones = [];
    (card as any).config = cfg;
    tap(450, 350);
    vi.advanceTimersByTime(300);
    expect((card as any)._focusedZone).toBeNull();
    expect((card as any)._transform).toEqual({ scale: 1, panX: 0, panY: 0 });
  });

  it('free-zoomed taps (scale > 1.05) never focus zones — pan/double-tap territory', () => {
    (card as any)._transform = { scale: 1.3, panX: 0, panY: 0 };
    // (585,468) inverts to (45%, 45%) — inside living at overview.
    tap(585, 468);
    vi.advanceTimersByTime(300);
    expect((card as any)._focusedZone).toBeNull();
  });

  it('a drag never resolves as a scene tap', () => {
    down(450, 350);
    move(480, 350); // > 8px → drag
    up(480, 350);
    vi.advanceTimersByTime(300);
    expect((card as any)._focusedZone).toBeNull();
  });
});
