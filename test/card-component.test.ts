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
import { describe, it, expect, afterEach } from 'vitest';
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
  it('marker left/top matches markerScreenPos for a known viewport', async () => {
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

    // The marker is positioned as left:${left}px, top:${top}px in the style attribute.
    const actualLeft = parseFloat(firstMarker.style.left);
    const actualTop = parseFloat(firstMarker.style.top);

    expect(actualLeft).toBeCloseTo(expected.left, 1);
    expect(actualTop).toBeCloseTo(expected.top, 1);
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
