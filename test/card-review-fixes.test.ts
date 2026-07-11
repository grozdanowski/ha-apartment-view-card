// @vitest-environment happy-dom
/**
 * Regression tests for the v2.5 adversarial-review findings (F-1..F-5).
 * Each describe pins one confirmed defect so it can never return.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import '../src/apartment-view-card';
import { createMockHass } from '../dev/mock-hass';
import type { ApartmentViewCard } from '../src/apartment-view-card';

type Card = ApartmentViewCard & HTMLElement;

const BASE_CONFIG = {
  type: 'custom:apartment-view-card',
  images: { base: '/local/day.png' },
  entities: [
    { entity: 'light.kitchen_ceiling', x: 30, y: 40, size: 'small', tap: 'toggle' },
    { entity: 'light.living_lamp', x: 70, y: 60, size: 'medium', tap: 'toggle' },
  ],
  zones: [{ name: 'Kitchen', x: 0, y: 0, width: 40, height: 40 }],
};

async function mountCard(rawConfig: any = BASE_CONFIG, hass = createMockHass()): Promise<Card> {
  const el = document.createElement('apartment-view-card') as Card;
  el.setConfig(rawConfig);
  el.hass = hass as any;
  document.body.appendChild(el);
  await (el as any).updateComplete;
  return el;
}

const marker = (card: Card, i = 0): HTMLElement =>
  card.shadowRoot!.querySelectorAll('.marker-overlay .marker')[i] as HTMLElement;
const scene = (card: Card): HTMLElement =>
  card.shadowRoot!.querySelector('.scene') as HTMLElement;

const pd = (target: EventTarget, id: number, x: number, y: number) =>
  target.dispatchEvent(
    new PointerEvent('pointerdown', { pointerId: id, clientX: x, clientY: y, button: 0, bubbles: true }),
  );
const pu = (id: number, x: number, y: number) =>
  window.dispatchEvent(
    new PointerEvent('pointerup', { pointerId: id, clientX: x, clientY: y, bubbles: true }),
  );

afterEach(() => {
  document.body.querySelectorAll('apartment-view-card').forEach((el) => el.remove());
  vi.useRealTimers();
});

describe('F-1: second pinch finger on a marker begins a pinch, never a marker gesture', () => {
  it('scene-down + marker-down + quick lift → no activation, pinch armed', async () => {
    const hass = createMockHass();
    const card = await mountCard(BASE_CONFIG, hass);
    pd(scene(card), 1, 100, 100); // first finger on the scene
    pd(marker(card), 2, 140, 100); // second finger lands on a marker chip
    expect((card as any)._pinchStartDist).toBeGreaterThan(0); // pinch armed
    expect((card as any)._activeMarker).toBeNull(); // never a marker gesture
    pu(1, 100, 100); // first finger lifts quickly, still
    pu(2, 140, 100);
    await (card as any).updateComplete;
    expect(hass.serviceCalls.length).toBe(0);
    expect(card.shadowRoot!.querySelector('av-control-surface')).toBeNull();
  });

  it('marker-down + marker-down (both fingers on chips) likewise aborts', async () => {
    const hass = createMockHass();
    const card = await mountCard(BASE_CONFIG, hass);
    pd(marker(card, 0), 1, 100, 100);
    pd(marker(card, 1), 2, 150, 110);
    expect((card as any)._pinchStartDist).toBeGreaterThan(0);
    expect((card as any)._activeMarker).toBeNull();
    pu(1, 100, 100);
    pu(2, 150, 110);
    await (card as any).updateComplete;
    expect(hass.serviceCalls.length).toBe(0);
    expect(card.shadowRoot!.querySelector('av-control-surface')).toBeNull();
  });
});

describe('F-2: the finger cancels an in-flight camera move', () => {
  it('latching a drag mid-camera clears is-animating immediately', async () => {
    const card = await mountCard();
    (card as any)._animateTransformTo({ scale: 1.4, panX: -50, panY: -30 });
    await (card as any).updateComplete;
    expect((card as any)._isAnimating).toBe(true);
    (card as any)._latchGesture();
    expect((card as any)._isAnimating).toBe(false);
  });

  it('a gated wheel zoom mid-camera clears is-animating', async () => {
    const card = await mountCard();
    (card as any)._animateTransformTo({ scale: 1.4, panX: -50, panY: -30 });
    expect((card as any)._isAnimating).toBe(true);
    const ev = new WheelEvent('wheel', { deltaY: -100, cancelable: true });
    Object.defineProperty(ev, 'ctrlKey', { value: true }); // happy-dom drops it
    (card as any)._onWheel(ev);
    expect((card as any)._isAnimating).toBe(false);
  });
});

describe('F-3: disconnect mid-gesture leaks no pointer state', () => {
  it('reattach after disconnect-mid-gesture: next touch is a single pointer', async () => {
    const card = await mountCard();
    pd(scene(card), 7, 100, 100); // gesture in flight
    (card as any)._latchGesture();
    card.remove(); // disconnect mid-gesture
    document.body.appendChild(card); // HA re-attaches the card
    await (card as any).updateComplete;
    expect((card as any)._activePointers.size).toBe(0);
    expect((card as any)._isGesturing).toBe(false);
    pd(scene(card), 8, 120, 120); // first touch after reattach
    expect((card as any)._activePointers.size).toBe(1); // NOT a phantom pinch
    expect((card as any)._pinchStartDist).toBe(0);
    pu(8, 120, 120);
  });
});

describe('F-4: reduced-motion / no-op camera moves settle synchronously', () => {
  it('no-op move (same transform) never raises is-animating, still settles', async () => {
    const card = await mountCard();
    const settled = vi.fn();
    (card as any)._animateTransformTo(
      { scale: 1, panX: 0, panY: 0 }, // equals the current transform
      { onSettle: settled },
    );
    expect((card as any)._isAnimating).toBe(false);
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    expect(settled).toHaveBeenCalledTimes(1);
  });

  it('reduced motion never raises is-animating', async () => {
    const card = await mountCard();
    (card as any)._reducedMotion = () => true;
    (card as any)._animateTransformTo({ scale: 1.4, panX: -50, panY: -30 });
    expect((card as any)._isAnimating).toBe(false);
    expect((card as any)._transform.scale).toBeCloseTo(1.4, 6); // write still lands
  });
});

describe('rc.2: the attention tour has an exit', () => {
  const ATT_CONFIG = {
    ...BASE_CONFIG,
    entities: [
      { entity: 'light.kitchen_ceiling', x: 10, y: 10, size: 'small', tap: 'toggle' },
      { entity: 'binary_sensor.front_door', x: 20, y: 20, size: 'small', tap: 'more-info' },
    ],
  };
  const attHass = () => {
    const hass = createMockHass();
    (hass.states as any)['binary_sensor.front_door'] = {
      entity_id: 'binary_sensor.front_door',
      state: 'on',
      attributes: { device_class: 'door' },
    };
    return hass;
  };
  const hudRight = (card: Card) =>
    card.shadowRoot!.querySelector('.lights-control') as HTMLElement;

  it('while touring, the right HUD button becomes Exit; tapping it zooms out + resets', async () => {
    const card = await mountCard(ATT_CONFIG as any, attHass());
    expect(hudRight(card).textContent).toContain('Lights control');
    (card.shadowRoot!.querySelector('.attention-pill') as HTMLElement).click();
    await (card as any).updateComplete;
    expect((card as any)._attentionCycle).toBeGreaterThan(0); // tour running
    expect(hudRight(card).textContent).toContain('Exit');
    hudRight(card).click();
    await (card as any).updateComplete;
    expect((card as any)._attentionCycle).toBe(0);
    expect((card as any)._focusedZone).toBeNull();
    expect((card as any)._transform).toEqual({ scale: 1, panX: 0, panY: 0 });
    expect(hudRight(card).textContent).toContain('Lights control'); // slot restored
  });
});

describe('rc.2: press scale can never displace a marker', () => {
  it('marker position lives in `translate`, transform carries ONLY the icon scale', async () => {
    const card = await mountCard();
    const m = marker(card);
    // If position ever moves back into `transform`, the :active `scale`
    // property would pre-multiply it and the chip lunges toward the origin.
    expect(m.style.transform).toMatch(/^scale\([\d.]+\)$/);
    expect(m.getAttribute('style')).toMatch(/translate:calc\([\d.-]+px - 50%\)/);
  });
});

describe('F-5: a pass-through wheel cancels the armed single-tap timer', () => {
  it('scene tap armed, then plain wheel passes through → no stale zone focus', async () => {
    vi.useFakeTimers();
    const card = await mountCard();
    // Arm a single tap on the scene (inside the Kitchen zone at overview).
    pd(scene(card), 3, 10, 10);
    pu(3, 10, 10);
    // Plain wheel at scale 1 in modifier mode: passes through to the page…
    (card as any)._onWheel(new WheelEvent('wheel', { deltaY: 120, cancelable: true }));
    // …and must cancel the pending tap: advancing time focuses nothing.
    vi.advanceTimersByTime(400);
    await (card as any).updateComplete;
    expect((card as any)._focusedZone).toBeNull();
  });
});
