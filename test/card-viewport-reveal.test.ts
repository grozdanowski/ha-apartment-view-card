// @vitest-environment happy-dom
/**
 * Regression tests for the v2.4.x marker-drift bug + the v2.5 reveal/HUD UX.
 *
 * THE BUG: `_viewport()` read the wrapper's live rect height at render time,
 * but re-renders were only triggered by ResizeObserver WIDTH changes — so when
 * the floorplan image finished loading and changed the wrapper's aspect-ratio
 * (height), marker positions were never recomputed and drifted off their
 * rooms until an unrelated state change forced a re-render.
 *
 * THE FIX: viewport height is DERIVED from the base image's natural aspect
 * (`_imgAspect`, reactive state set on image load) — the image box is always
 * `width / naturalAspect` because it renders at `width:100%; height:auto`.
 */
import { describe, it, expect, afterEach } from 'vitest';
import '../src/apartment-view-card';
import { createMockHass } from '../dev/mock-hass';
import { markerScreenPos } from '../src/core/geometry';
import type { ApartmentViewCard } from '../src/apartment-view-card';

type Card = ApartmentViewCard & HTMLElement;

const BASE_CONFIG = {
  type: 'custom:apartment-view-card',
  images: { base: '/local/day.png' },
  entities: [{ entity: 'light.kitchen_ceiling', x: 30, y: 40, size: 'small', tap: 'toggle' }],
};

async function mountCard(rawConfig = BASE_CONFIG, hass = createMockHass()): Promise<Card> {
  const el = document.createElement('apartment-view-card') as Card;
  el.setConfig(rawConfig);
  el.hass = hass as any;
  document.body.appendChild(el);
  await (el as any).updateComplete;
  return el;
}

const firstMarker = (card: Card): HTMLElement =>
  card.shadowRoot!.querySelector('.marker-overlay .marker') as HTMLElement;

/** Markers are compositor-positioned (spec P0-2, rc.2): the screen position
 * lives in the inline `translate: calc(Xpx - 50%) calc(Ypx - 50%)` property. */
const markerTop = (el: HTMLElement): number => {
  const m = /calc\((-?[\d.]+)px - 50%\) calc\((-?[\d.]+)px - 50%\)/.exec(
    el.getAttribute('style') ?? '',
  );
  expect(m).toBeTruthy();
  return parseFloat(m![2]);
};

afterEach(() => {
  document.body.querySelectorAll('apartment-view-card').forEach((el) => el.remove());
});

describe('viewport height derives from the image aspect (drift regression)', () => {
  it('uses the 16:9 fallback height before the image loads', async () => {
    const card = await mountCard();
    (card as any)._cardWidth = 400;
    await (card as any).updateComplete;

    const expected = markerScreenPos(30, 40, { scale: 1, panX: 0, panY: 0 }, {
      width: 400,
      height: 400 * (9 / 16),
    });
    expect(markerTop(firstMarker(card))).toBeCloseTo(expected.top, 1);
  });

  it('RECOMPUTES marker positions when the image aspect becomes known', async () => {
    const card = await mountCard();
    (card as any)._cardWidth = 400;
    await (card as any).updateComplete;
    const topBefore = markerTop(firstMarker(card));

    // Simulate the base image load completing with a 4:3 floorplan.
    (card as any)._imgAspect = 3 / 4;
    await (card as any).updateComplete;

    const expected = markerScreenPos(30, 40, { scale: 1, panX: 0, panY: 0 }, {
      width: 400,
      height: 400 * (3 / 4),
    });
    const topAfter = markerTop(firstMarker(card));
    expect(topAfter).toBeCloseTo(expected.top, 1);
    expect(topAfter).not.toBeCloseTo(topBefore, 1); // it actually moved
  });

  it('_viewport() never touches the DOM (pure function of reactive state)', async () => {
    const card = await mountCard();
    (card as any)._cardWidth = 500;
    (card as any)._imgAspect = 0.8;
    // No wrapper rect involved: result is exact regardless of layout timing.
    expect((card as any)._viewport()).toEqual({ width: 500, height: 400 });
  });
});

describe('marker overlay reveal choreography', () => {
  it('overlay is NOT .ready before the image aspect is known', async () => {
    const card = await mountCard();
    const overlay = card.shadowRoot!.querySelector('.marker-overlay')!;
    expect(overlay.classList.contains('ready')).toBe(false);
  });

  it('overlay becomes .ready one frame after the aspect arrives', async () => {
    const card = await mountCard();
    (card as any)._imgAspect = 0.75;
    await (card as any).updateComplete; // commit correct positions (hidden)
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    await (card as any).updateComplete; // reveal frame
    const overlay = card.shadowRoot!.querySelector('.marker-overlay')!;
    expect(overlay.classList.contains('ready')).toBe(true);
  });
});

describe('HUD row above the canvas', () => {
  it('lights control renders inside .hud, not inside .wrapper', async () => {
    const card = await mountCard();
    const shadow = card.shadowRoot!;
    expect(shadow.querySelector('.hud .lights-control')).toBeTruthy();
    expect(shadow.querySelector('.wrapper .lights-control')).toBeNull();
  });

  it('renders no .hud at all when there is nothing to show', async () => {
    const card = await mountCard({ ...BASE_CONFIG, entities: [] });
    expect(card.shadowRoot!.querySelector('.hud')).toBeNull();
  });

  it('card chrome is removed (ha-card carries no background/border/shadow)', async () => {
    const card = await mountCard();
    // The style rule lives in static styles; assert it targets ha-card.
    const cssText = (card.constructor as typeof ApartmentViewCard).styles
      .map((s: any) => s.cssText ?? '')
      .join('\n');
    expect(cssText).toMatch(/ha-card\s*\{[^}]*background:\s*none/);
    expect(cssText).toMatch(/ha-card\s*\{[^}]*border:\s*none/);
    expect(cssText).toMatch(/ha-card\s*\{[^}]*box-shadow:\s*none/);
  });
});
