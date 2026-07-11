// @vitest-environment happy-dom
/**
 * Full-mount component/integration test for <apartment-view-card>.
 *
 * Exercises the end-to-end path that unit tests don't cover:
 *   - Mounting the real custom element with a mock hass
 *   - Confirming markers render
 *   - Tapping a marker fires homeassistant.toggle
 *   - Light-overlay opacity matches the glow formula
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import '../src/apartment-view-card';
import { createMockHass } from '../dev/mock-hass';
import { markerScreenPos } from '../src/core/geometry';
import type { ApartmentViewCard } from '../src/apartment-view-card';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Card = ApartmentViewCard & HTMLElement;

const BASE_CONFIG = {
  type: 'custom:apartment-view-card',
  images: { base: '/local/day.png' },
  entities: [
    { entity: 'light.kitchen_ceiling', x: 30, y: 40, size: 'small', tap: 'toggle' },
    { entity: 'light.living_lamp', x: 70, y: 60, size: 'medium', tap: 'toggle' },
  ],
};

async function mountCard(rawConfig = BASE_CONFIG, hass = createMockHass()): Promise<Card> {
  const el = document.createElement('apartment-view-card') as Card;
  el.setConfig(rawConfig);
  el.hass = hass as any;
  document.body.appendChild(el);
  await (el as any).updateComplete;
  return el;
}

afterEach(() => {
  // Remove all mounted cards between tests to avoid cross-test pollution.
  document.body.querySelectorAll('apartment-view-card').forEach((el) => el.remove());
});

/** Markers are compositor-positioned (spec P0-2): read left/top back out of
 * the inline `translate3d(Xpx, Ypx, 0)` transform. */
function markerPos(el: HTMLElement): { left: number; top: number } {
  const m = /translate3d\((-?[\d.]+)px, (-?[\d.]+)px/.exec(el.style.transform);
  expect(m).toBeTruthy();
  return { left: parseFloat(m![1]), top: parseFloat(m![2]) };
}

// ---------------------------------------------------------------------------
// shouldUpdate perf gate: don't rebuild layers on unrelated dashboard ticks
// ---------------------------------------------------------------------------

describe('card-component: shouldUpdate perf gate', () => {
  const lightOn = () => ({ entity_id: 'light.kitchen_ceiling', state: 'on', attributes: {} });
  const hassWith = (kitchen: unknown, extra: Record<string, unknown> = {}) =>
    ({ states: { 'light.kitchen_ceiling': kitchen, ...extra }, callService: () => Promise.resolve() });

  it('skips re-render when only an unrelated entity changed', async () => {
    const card = await mountCard();
    const sharedKitchen = lightOn(); // SAME object reference in prev + next
    const prev = hassWith(sharedKitchen, { 'sensor.x': { entity_id: 'sensor.x', state: '1', attributes: {} } });
    const next = hassWith(sharedKitchen, { 'sensor.x': { entity_id: 'sensor.x', state: '2', attributes: {} } });
    card.hass = next as any;
    expect((card as any).shouldUpdate(new Map<PropertyKey, unknown>([['hass', prev]]))).toBe(false);
  });

  it('re-renders when a drawn entity state object changed', async () => {
    const card = await mountCard();
    const prev = hassWith(lightOn());
    const next = hassWith({ entity_id: 'light.kitchen_ceiling', state: 'off', attributes: {} });
    card.hass = next as any;
    expect((card as any).shouldUpdate(new Map<PropertyKey, unknown>([['hass', prev]]))).toBe(true);
  });

  it('re-renders when sun.sun changed (time-of-day)', async () => {
    const card = await mountCard();
    const k = lightOn();
    const prev = hassWith(k, { 'sun.sun': { entity_id: 'sun.sun', state: 'above_horizon', attributes: {} } });
    const next = hassWith(k, { 'sun.sun': { entity_id: 'sun.sun', state: 'below_horizon', attributes: {} } });
    card.hass = next as any;
    expect((card as any).shouldUpdate(new Map<PropertyKey, unknown>([['hass', prev]]))).toBe(true);
  });

  it('always re-renders when a non-hass reactive property changed', async () => {
    const card = await mountCard();
    expect((card as any).shouldUpdate(new Map<PropertyKey, unknown>([['_transform', {}]]))).toBe(true);
    expect((card as any).shouldUpdate(new Map<PropertyKey, unknown>([['config', {}], ['hass', card.hass]]))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Test 1: Markers render – one per entity
// ---------------------------------------------------------------------------

describe('card-component: marker rendering', () => {
  it('registers the apartment-view-card custom element', () => {
    expect(customElements.get('apartment-view-card')).toBeTruthy();
  });

  it('renders exactly one .marker button per configured entity', async () => {
    const card = await mountCard();
    const shadow = card.shadowRoot!;
    const overlay = shadow.querySelector('.marker-overlay');
    expect(overlay).toBeTruthy();

    const markers = shadow.querySelectorAll('.marker-overlay .marker');
    expect(markers.length).toBe(BASE_CONFIG.entities.length); // 2 entities → 2 markers
  });

  it('renders no markers when entities array is empty', async () => {
    const cfg = { ...BASE_CONFIG, entities: [] };
    const card = await mountCard(cfg);
    const markers = card.shadowRoot!.querySelectorAll('.marker-overlay .marker');
    expect(markers.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Test 2: Marker position tracks markerScreenPos formula
// ---------------------------------------------------------------------------

describe('card-component: marker screen position', () => {
  it('marker translate3d position matches markerScreenPos for a known viewport', async () => {
    const card = await mountCard();

    // Force a deterministic card width so markerScreenPos gives real numbers.
    // In happy-dom there is no layout; _cardWidth defaults to 600 but
    // we override to a known value so the math is predictable.
    const WIDTH = 400;
    const HEIGHT = 200;
    (card as any)._cardWidth = WIDTH;

    // Also stub the private _viewport() so the height leg is deterministic.
    (card as any)._viewport = () => ({ width: WIDTH, height: HEIGHT });

    // Trigger re-render after stubbing.
    await (card as any).updateComplete;

    // The first entity: x=30, y=40; default transform scale=1, pan=0,0
    const entity = BASE_CONFIG.entities[0];
    const t = { scale: 1, panX: 0, panY: 0 };
    const vp = { width: WIDTH, height: HEIGHT };
    const expected = markerScreenPos(entity.x, entity.y, t, vp);

    const markers = Array.from(
      card.shadowRoot!.querySelectorAll('.marker-overlay .marker'),
    ) as HTMLElement[];

    const firstMarker = markers[0];
    expect(firstMarker).toBeTruthy();

    // The marker is positioned via transform:translate3d(${left}px, ${top}px, 0).
    const actual = markerPos(firstMarker);
    expect(actual.left).toBeCloseTo(expected.left, 1);
    expect(actual.top).toBeCloseTo(expected.top, 1);
  });
});

// ---------------------------------------------------------------------------
// Test 3: Tapping a marker fires homeassistant.toggle
// ---------------------------------------------------------------------------

describe('card-component: tap → opens control surface', () => {
  async function tapMarker(card: Card, index: number, coords: { clientX: number; clientY: number; pointerId: number }) {
    const markers = Array.from(card.shadowRoot!.querySelectorAll('.marker-overlay .marker')) as HTMLElement[];
    const marker = markers[index];
    const c = { ...coords, button: 0, pointerType: 'mouse' };
    marker.dispatchEvent(new PointerEvent('pointerdown', { ...c, bubbles: true }));
    window.dispatchEvent(new PointerEvent('pointerup', { ...c, bubbles: true }));
    await (card as any).updateComplete;
  }

  it('opens the control surface for the tapped light (not a direct toggle)', async () => {
    const hass = createMockHass();
    const card = await mountCard(BASE_CONFIG, hass);
    await tapMarker(card, 0, { clientX: 50, clientY: 50, pointerId: 1 });

    const surface = card.shadowRoot!.querySelector('av-control-surface') as any;
    expect(surface).toBeTruthy();
    expect(surface.entityIds).toEqual(['light.kitchen_ceiling']);
    // tap no longer fires a direct toggle — control happens inside the surface
    expect(hass.serviceCalls.length).toBe(0);
  });

  it('opens the surface for the SECOND marker when that is tapped', async () => {
    const hass = createMockHass();
    const card = await mountCard(BASE_CONFIG, hass);
    await tapMarker(card, 1, { clientX: 80, clientY: 80, pointerId: 2 });

    const surface = card.shadowRoot!.querySelector('av-control-surface') as any;
    expect(surface.entityIds).toEqual(['light.living_lamp']);
  });

  it('does NOT call service when pointer is dragged before release (>8px move)', async () => {
    const hass = createMockHass();
    const card = await mountCard(BASE_CONFIG, hass);

    const markers = Array.from(
      card.shadowRoot!.querySelectorAll('.marker-overlay .marker'),
    ) as HTMLElement[];

    const marker = markers[0];
    const downCoords = { clientX: 50, clientY: 50, pointerId: 3, button: 0, pointerType: 'mouse' };
    marker.dispatchEvent(new PointerEvent('pointerdown', { ...downCoords, bubbles: true }));

    // Move > 8px on window — this is how the card detects drags.
    window.dispatchEvent(
      new PointerEvent('pointermove', {
        clientX: 70, // 20px move → exceeds MOVE_THRESHOLD_PX (8)
        clientY: 50,
        pointerId: 3,
        bubbles: true,
      }),
    );

    window.dispatchEvent(
      new PointerEvent('pointerup', {
        clientX: 70,
        clientY: 50,
        pointerId: 3,
        bubbles: true,
      }),
    );
    await Promise.resolve();

    // Drag → no toggle fired
    expect(hass.serviceCalls.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// pointercancel is an abort, never a tap (spec P0-0)
// ---------------------------------------------------------------------------

describe('card-component: pointercancel aborts the gesture (P0-0)', () => {
  it('marker pointerdown → pointercancel fires no service and opens no surface', async () => {
    const hass = createMockHass();
    const card = await mountCard(BASE_CONFIG, hass);
    const marker = card.shadowRoot!.querySelector('.marker-overlay .marker') as HTMLElement;
    const c = { clientX: 50, clientY: 50, pointerId: 11, button: 0, pointerType: 'touch' };
    marker.dispatchEvent(new PointerEvent('pointerdown', { ...c, bubbles: true }));
    window.dispatchEvent(new PointerEvent('pointercancel', { ...c, bubbles: true }));
    await (card as any).updateComplete;

    // A browser-claimed scroll must terminate with NO outcome.
    expect(hass.serviceCalls.length).toBe(0);
    expect(card.shadowRoot!.querySelector('av-control-surface')).toBeNull();
  });

  it('scene pointerdown → pointercancel changes no focus and leaves no state', async () => {
    const card = await mountCard();
    const scene = card.shadowRoot!.querySelector('.scene') as HTMLElement;
    const c = { clientX: 120, clientY: 90, pointerId: 12, button: 0, pointerType: 'touch' };
    scene.dispatchEvent(new PointerEvent('pointerdown', { ...c, bubbles: true }));
    window.dispatchEvent(new PointerEvent('pointercancel', { ...c, bubbles: true }));
    await (card as any).updateComplete;

    expect((card as any)._focusedZone).toBeNull();
    expect((card as any)._activePointers.size).toBe(0);
    expect((card as any)._activeMarker).toBeNull();
  });

  it('a single pointerdown after a pointercancel is not treated as a pinch', async () => {
    const card = await mountCard();
    const marker = card.shadowRoot!.querySelector('.marker-overlay .marker') as HTMLElement;
    const first = { clientX: 50, clientY: 50, pointerId: 21, button: 0, pointerType: 'touch' };
    marker.dispatchEvent(new PointerEvent('pointerdown', { ...first, bubbles: true }));
    window.dispatchEvent(new PointerEvent('pointercancel', { ...first, bubbles: true }));

    // The cancelled pointer must not linger and turn the next touch into a pinch.
    const second = { clientX: 80, clientY: 80, pointerId: 22, button: 0, pointerType: 'touch' };
    marker.dispatchEvent(new PointerEvent('pointerdown', { ...second, bubbles: true }));
    expect((card as any)._activePointers.size).toBe(1);
    expect((card as any)._pinchStartDist).toBe(0);
    window.dispatchEvent(new PointerEvent('pointerup', { ...second, bubbles: true }));
  });
});

// ---------------------------------------------------------------------------
// Focused-zone interactions (spec P0-1): markers stay live, pointers don't leak
// ---------------------------------------------------------------------------

describe('card-component: focused zone interactions (P0-1)', () => {
  const ZONED_CONFIG = {
    ...BASE_CONFIG,
    zones: [
      { name: 'Kitchen', x: 10, y: 20, width: 40, height: 40 },
      { name: 'Living', x: 55, y: 40, width: 40, height: 40 },
    ],
  };

  it('tapping a marker while a zone is focused opens the control surface', async () => {
    const hass = createMockHass();
    const card = await mountCard(ZONED_CONFIG as any, hass);
    (card as any)._focusZone((card as any)._floorData.zones[0]);
    await (card as any).updateComplete;

    const marker = card.shadowRoot!.querySelector('.marker-overlay .marker') as HTMLElement;
    const c = { clientX: 50, clientY: 50, pointerId: 31, button: 0, pointerType: 'touch' };
    marker.dispatchEvent(new PointerEvent('pointerdown', { ...c, bubbles: true }));
    window.dispatchEvent(new PointerEvent('pointerup', { ...c, bubbles: true }));
    await (card as any).updateComplete;

    const surface = card.shadowRoot!.querySelector('av-control-surface') as any;
    expect(surface).toBeTruthy();
    expect(surface.entityIds).toEqual(['light.kitchen_ceiling']);
    expect(hass.serviceCalls.length).toBe(0);
  });

  it('does not leak _activePointers across focus transitions (no phantom pinch)', async () => {
    const card = await mountCard(ZONED_CONFIG as any);
    (card as any)._focusZone((card as any)._floorData.zones[0]);
    await (card as any).updateComplete;

    // A pointer released while focused must be unregistered (the old blanket
    // guard swallowed this pointerup and leaked the entry).
    const marker = card.shadowRoot!.querySelector('.marker-overlay .marker') as HTMLElement;
    const c = { clientX: 50, clientY: 50, pointerId: 41, button: 0, pointerType: 'touch' };
    marker.dispatchEvent(new PointerEvent('pointerdown', { ...c, bubbles: true }));
    window.dispatchEvent(new PointerEvent('pointerup', { ...c, bubbles: true }));
    expect((card as any)._activePointers.size).toBe(0);

    (card as any)._exitFocus();
    await (card as any).updateComplete;

    // The next single touch is one pointer — not the second leg of a pinch.
    const scene = card.shadowRoot!.querySelector('.scene') as HTMLElement;
    const d = { clientX: 60, clientY: 60, pointerId: 42, button: 0, pointerType: 'touch' };
    scene.dispatchEvent(new PointerEvent('pointerdown', { ...d, bubbles: true }));
    expect((card as any)._activePointers.size).toBe(1);
    expect((card as any)._pinchStartDist).toBe(0);
    window.dispatchEvent(new PointerEvent('pointerup', { ...d, bubbles: true }));
  });
});

// ---------------------------------------------------------------------------
// Camera engine (spec P0-2): gated transitions + frozen labels
// ---------------------------------------------------------------------------

describe('card-component: camera engine (P0-2)', () => {
  const ZONED = {
    ...BASE_CONFIG,
    zones: [{ name: 'Kitchen', x: 10, y: 20, width: 40, height: 40 }],
  };
  const wrapper = (card: Card) => card.shadowRoot!.querySelector('.wrapper')!;

  it('a machine camera move raises is-animating; the fallback timeout clears it', async () => {
    vi.useFakeTimers();
    try {
      const card = await mountCard(ZONED as any);
      (card as any)._focusZone((card as any)._floorData.zones[0]);
      await (card as any).updateComplete;
      expect(wrapper(card).classList.contains('is-animating')).toBe(true);

      // happy-dom fires no transitionend — the CAMERA_MS + 80 fallback clears.
      vi.advanceTimersByTime(700);
      await (card as any).updateComplete;
      expect(wrapper(card).classList.contains('is-animating')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('exit focus also runs through the animated camera', async () => {
    vi.useFakeTimers();
    try {
      const card = await mountCard(ZONED as any);
      (card as any)._focusZone((card as any)._floorData.zones[0]);
      vi.advanceTimersByTime(700);
      await (card as any).updateComplete;

      (card as any)._exitFocus();
      // The target transform is written synchronously (doctrine L2 machine move).
      expect((card as any)._transform).toEqual({ scale: 1, panX: 0, panY: 0 });
      await (card as any).updateComplete;
      expect(wrapper(card).classList.contains('is-animating')).toBe(true);
      vi.advanceTimersByTime(700);
      await (card as any).updateComplete;
      expect(wrapper(card).classList.contains('is-animating')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a pan latch raises is-gesturing + freezes labels; pointerup clears both', async () => {
    const card = await mountCard(ZONED as any);
    const scene = card.shadowRoot!.querySelector('.scene') as HTMLElement;
    const c = { pointerId: 51, button: 0, pointerType: 'touch' };
    scene.dispatchEvent(new PointerEvent('pointerdown', { ...c, clientX: 100, clientY: 100, bubbles: true }));
    // No latch on the bare press…
    expect((card as any)._isGesturing).toBe(false);
    // …only once movement exceeds the threshold.
    window.dispatchEvent(new PointerEvent('pointermove', { ...c, clientX: 130, clientY: 100, bubbles: true }));
    await (card as any).updateComplete;
    expect(wrapper(card).classList.contains('is-gesturing')).toBe(true);
    expect((card as any)._frozenLabels).not.toBeNull();

    window.dispatchEvent(new PointerEvent('pointerup', { ...c, clientX: 130, clientY: 100, bubbles: true }));
    await (card as any).updateComplete;
    expect(wrapper(card).classList.contains('is-gesturing')).toBe(false);
    expect((card as any)._frozenLabels).toBeNull();
  });

  it('a marker tap (no movement) never latches is-gesturing', async () => {
    const card = await mountCard(ZONED as any);
    const marker = card.shadowRoot!.querySelector('.marker-overlay .marker') as HTMLElement;
    const c = { pointerId: 52, clientX: 50, clientY: 50, button: 0, pointerType: 'touch' };
    marker.dispatchEvent(new PointerEvent('pointerdown', { ...c, bubbles: true }));
    expect((card as any)._isGesturing).toBe(false);
    window.dispatchEvent(new PointerEvent('pointerup', { ...c, bubbles: true }));
    await (card as any).updateComplete;
    expect((card as any)._isGesturing).toBe(false);
    expect(wrapper(card).classList.contains('is-gesturing')).toBe(false);
  });

  it('direct gesture writes (wheel zoom) never raise is-animating (finger is 1:1)', async () => {
    const card = await mountCard(ZONED as any);
    (card as any)._onWheel(new WheelEvent('wheel', { deltaY: -100 }));
    await (card as any).updateComplete;
    expect((card as any)._transform.scale).toBeGreaterThan(1); // it did zoom
    expect(wrapper(card).classList.contains('is-animating')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Test 4: Light-overlay opacity matches the glow formula
// ---------------------------------------------------------------------------

describe('card-component: glow-style light overlay opacity', () => {
  /**
   * glow formula from renderLight:
   *   ON  → tintOpacity = clamp01(0.4 + 0.55 * b)   where b = brightness/255
   *   OFF → outer .light-overlay opacity = 0  (the container fades to 0)
   */

  it('glow ON at brightness ~0.8 → tint opacity ≈ 0.4 + 0.55*0.8 = 0.84', async () => {
    const glowConfig = {
      ...BASE_CONFIG,
      options: { lightStyle: 'glow' },
      entities: [
        // brightness 204 ≈ 0.8 normalized
        { entity: 'light.kitchen_ceiling', x: 30, y: 40, size: 'small', tap: 'toggle', lightStyle: 'glow' },
      ],
    };
    const hass = createMockHass(); // light.kitchen_ceiling is 'on' with brightness 204
    const card = await mountCard(glowConfig as any, hass);

    const overlay = card.shadowRoot!.querySelector('.light-overlay') as HTMLElement | null;
    expect(overlay).toBeTruthy();

    // The outer .light-overlay container is visible when ON (opacity:1).
    expect(parseFloat(overlay!.style.opacity)).toBe(1);

    // The inner .tint should carry glow opacity = 0.4 + 0.55 * (204/255).
    const tint = overlay!.querySelector('.tint') as HTMLElement | null;
    expect(tint).toBeTruthy();
    const b = 204 / 255; // ~0.8
    const expectedTintOpacity = 0.4 + 0.55 * b;
    expect(parseFloat(tint!.style.opacity)).toBeCloseTo(expectedTintOpacity, 2);
  });

  it('glow OFF → outer .light-overlay opacity = 0', async () => {
    const glowConfig = {
      ...BASE_CONFIG,
      options: { lightStyle: 'glow' },
      entities: [
        { entity: 'light.kitchen_ceiling', x: 30, y: 40, size: 'small', tap: 'toggle', lightStyle: 'glow' },
      ],
    };
    // Override kitchen_ceiling to 'off'
    const hass = createMockHass({
      'light.kitchen_ceiling': { state: 'off', attributes: {} },
    });
    const card = await mountCard(glowConfig as any, hass);

    const overlay = card.shadowRoot!.querySelector('.light-overlay') as HTMLElement | null;
    expect(overlay).toBeTruthy();
    expect(parseFloat(overlay!.style.opacity)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// "Lights control" multi-select mode
// ---------------------------------------------------------------------------

describe('card-component: Lights control (multi-select)', () => {
  const click = (el: Element) => el.dispatchEvent(new MouseEvent('click', { detail: 0, bubbles: true }));

  it('shows the Lights control button when there are lights', async () => {
    const card = await mountCard();
    expect(card.shadowRoot!.querySelector('.lights-control')).toBeTruthy();
  });

  it('entering select mode opens a disabled surface and marks light markers selectable', async () => {
    const card = await mountCard();
    click(card.shadowRoot!.querySelector('.lights-control')!);
    await (card as any).updateComplete;
    const surface = card.shadowRoot!.querySelector('av-control-surface') as any;
    expect(surface.selectMode).toBe(true);
    expect(surface.entityIds).toEqual([]);
    // both demo entities are lights -> selectable, with a checkbox
    expect(card.shadowRoot!.querySelectorAll('.marker.selectable').length).toBe(2);
    expect(card.shadowRoot!.querySelector('.marker-check')).toBeTruthy();
  });

  it('checking lights builds the group; checking again removes; Done exits', async () => {
    const card = await mountCard();
    click(card.shadowRoot!.querySelector('.lights-control')!);
    await (card as any).updateComplete;
    const markers = () => Array.from(card.shadowRoot!.querySelectorAll('.marker-overlay .marker')) as HTMLElement[];

    click(markers()[0]); // check kitchen
    await (card as any).updateComplete;
    let surface = card.shadowRoot!.querySelector('av-control-surface') as any;
    expect(surface.entityIds).toEqual(['light.kitchen_ceiling']);

    click(markers()[1]); // check living
    await (card as any).updateComplete;
    surface = card.shadowRoot!.querySelector('av-control-surface') as any;
    expect(surface.entityIds).toEqual(['light.kitchen_ceiling', 'light.living_lamp']);
    expect(card.shadowRoot!.querySelectorAll('.marker.selected').length).toBe(2);

    click(markers()[0]); // uncheck kitchen
    await (card as any).updateComplete;
    surface = card.shadowRoot!.querySelector('av-control-surface') as any;
    expect(surface.entityIds).toEqual(['light.living_lamp']);

    click(card.shadowRoot!.querySelector('.lights-control')!); // Done
    await (card as any).updateComplete;
    expect(card.shadowRoot!.querySelector('av-control-surface')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Tap disambiguation + group resolution
// ---------------------------------------------------------------------------

describe('card-component: tap disambiguation + groups', () => {
  const click = (el: Element) => el.dispatchEvent(new MouseEvent('click', { detail: 0, bubbles: true }));

  it('tap: more-info on a controllable entity opens more-info, NOT the surface', async () => {
    const cfg = { ...BASE_CONFIG, entities: [{ entity: 'light.kitchen_ceiling', x: 30, y: 40, size: 'small', tap: 'more-info' }] };
    const card = await mountCard(cfg);
    let moreInfo = false;
    card.addEventListener('hass-more-info', () => (moreInfo = true));
    click(card.shadowRoot!.querySelector('.marker')!);
    await (card as any).updateComplete;
    expect(card.shadowRoot!.querySelector('av-control-surface')).toBeNull();
    expect(moreInfo).toBe(true);
  });

  it('a group marker opens a surface that drives its members', async () => {
    const cfg = { ...BASE_CONFIG, entities: [{ entity: 'group.lights', x: 50, y: 50, size: 'small', tap: 'toggle' }] };
    const hass = createMockHass();
    (hass.states as any)['group.lights'] = { entity_id: 'group.lights', state: 'on', attributes: { entity_id: ['light.kitchen_ceiling', 'light.living_lamp'] } };
    const card = await mountCard(cfg, hass);
    click(card.shadowRoot!.querySelector('.marker')!);
    await (card as any).updateComplete;
    const surf = card.shadowRoot!.querySelector('av-control-surface') as any;
    expect(surf.entityIds).toEqual(['light.kitchen_ceiling', 'light.living_lamp']);
  });
});

describe('card-component: attention pill', () => {
  it('shows "N need attention" + a marker badge when an entity needs attention', async () => {
    const cfg = { ...BASE_CONFIG, entities: [{ entity: 'binary_sensor.front_door', x: 30, y: 40, size: 'small', tap: 'more-info' }] };
    const hass = createMockHass();
    (hass.states as any)['binary_sensor.front_door'] = { entity_id: 'binary_sensor.front_door', state: 'on', attributes: { device_class: 'door' } };
    const card = await mountCard(cfg, hass);
    const pill = card.shadowRoot!.querySelector('.attention-pill') as HTMLElement;
    expect(pill).toBeTruthy();
    expect(pill.textContent).toContain('1 need');
    expect(card.shadowRoot!.querySelector('.marker-badge')).toBeTruthy();
  });

  it('no pill when nothing needs attention', async () => {
    const card = await mountCard();
    expect(card.shadowRoot!.querySelector('.attention-pill')).toBeNull();
  });
});

describe('card-component: motion ripple', () => {
  it('a presence sensor turning off->on emits a ripple; none on first paint', async () => {
    const cfg = { ...BASE_CONFIG, entities: [{ entity: 'binary_sensor.hall_motion', x: 50, y: 50, size: 'small', tap: 'more-info' }] };
    const hass = createMockHass();
    const off = { entity_id: 'binary_sensor.hall_motion', state: 'off', attributes: { device_class: 'motion' } };
    (hass.states as any)['binary_sensor.hall_motion'] = off;
    const card = await mountCard(cfg, hass);
    expect(card.shadowRoot!.querySelectorAll('.motion-ripple').length).toBe(0); // no ripple on mount

    card.hass = { ...(hass as any), states: { ...hass.states, 'binary_sensor.hall_motion': { entity_id: 'binary_sensor.hall_motion', state: 'on', attributes: { device_class: 'motion' } } } } as any;
    await (card as any).updateComplete;
    expect(card.shadowRoot!.querySelectorAll('.motion-ripple').length).toBeGreaterThan(0);
  });
});

describe('card-component: quick actions', () => {
  it('a FAB opens the radial menu and an action runs its service, then closes', async () => {
    const cfg = { ...BASE_CONFIG, quickActions: [{ name: 'Movie', service: 'scene.turn_on', data: { entity_id: 'scene.movie' } }] };
    const card = await mountCard(cfg);
    const fab = card.shadowRoot!.querySelector('.quick-fab') as HTMLElement;
    expect(fab).toBeTruthy();
    expect(card.shadowRoot!.querySelector('.quick.open')).toBeNull();
    fab.click();
    await (card as any).updateComplete;
    expect(card.shadowRoot!.querySelector('.quick.open')).toBeTruthy();
    (card.shadowRoot!.querySelector('.quick-action') as HTMLElement).click();
    await (card as any).updateComplete;
    const calls = (card.hass as any).serviceCalls ?? [];
    expect(calls.at(-1)).toMatchObject({ domain: 'scene', service: 'turn_on' });
    expect(calls.at(-1).data).toMatchObject({ entity_id: 'scene.movie' });
    expect(card.shadowRoot!.querySelector('.quick.open')).toBeNull();
  });
  it('no FAB when no quick actions are configured', async () => {
    const card = await mountCard();
    expect(card.shadowRoot!.querySelector('.quick-fab')).toBeNull();
  });
});

describe('card-component: multi-floor', () => {
  it('renders floor tabs and switching changes the markers', async () => {
    const cfg = {
      type: 'custom:apartment-view-card', images: { base: '/g.png' }, entities: [],
      floors: [
        { name: 'Ground', images: { base: '/g.png' }, entities: [{ entity: 'light.kitchen_ceiling', x: 30, y: 40, size: 'small', tap: 'toggle' }] },
        { name: 'Upstairs', images: { base: '/u.png' }, entities: [
          { entity: 'light.living_lamp', x: 50, y: 50, size: 'small', tap: 'toggle' },
          { entity: 'light.living_lamp2', x: 60, y: 60, size: 'small', tap: 'toggle' },
        ] },
      ],
    };
    const card = await mountCard(cfg);
    const tabs = card.shadowRoot!.querySelectorAll('.floor-tab');
    expect(tabs.length).toBe(2);
    expect(card.shadowRoot!.querySelectorAll('.marker-overlay .marker').length).toBe(1); // Ground
    (tabs[1] as HTMLElement).click();
    await (card as any).updateComplete;
    expect(card.shadowRoot!.querySelectorAll('.marker-overlay .marker').length).toBe(2); // Upstairs
    expect(card.shadowRoot!.querySelector('.floor-tab.active span')!.textContent).toBe('Upstairs');
  });
  it('no floor tabs for a single-floor config', async () => {
    const card = await mountCard();
    expect(card.shadowRoot!.querySelector('.floors')).toBeNull();
  });
});
