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

// ---------------------------------------------------------------------------
// Mobile taller-frame (Fix 3 / options.aspectMobile). A wide floorplan renders
// short at width:100%; on phones a TALLER wrapper + a CONTAINED floorplan gives
// it real vertical space WITHOUT cropping: the plan keeps its natural aspect,
// fills the width minus a small cushion, and is centered vertically (extra
// height = breathing room). The `.frame` is the coordinate box — scene +
// overlay live inside it — and _cardWidth/_viewport() are derived from it, so
// markers inherit the cushion + centering and can never drift.
//
// Geometry for imgAspect 0.5 (natural 2:1 plan), _cardWidth 375, cushion 11px:
//   boxWidth  = 375 + 2*11 = 397
//   planHeight (contained) = 375 * 0.5 = 187.5
//   aspect 1   -> boxHeight 397    -> insetY = (397    - 187.5)/2 = 104.75
//   aspect 0.8 -> boxHeight 496.25 -> insetY = (496.25 - 187.5)/2 = 154.375
// ---------------------------------------------------------------------------

const CUSHION = 11; // FRAME_CUSHION_PX

const frameEl = (card: Card): HTMLElement | null =>
  card.shadowRoot!.querySelector('.frame') as HTMLElement | null;
const wrapperEl = (card: Card): HTMLElement =>
  card.shadowRoot!.querySelector('.wrapper') as HTMLElement;
const cssVar = (el: HTMLElement, name: string): number | null => {
  const m = new RegExp(`${name}:\\s*(-?[\\d.]+)px`).exec(el.getAttribute('style') ?? '');
  return m ? parseFloat(m[1]) : null;
};

describe('mobile taller-frame (Fix 3 / aspectMobile — CONTAIN)', () => {
  it('contains the plan in a taller box with a horizontal cushion + vertical centering (default 4/5)', async () => {
    // Wide floorplan (imgAspect 0.5 => natural box is 2:1, very short).
    const card = await mountCard();
    (card as any)._cardWidth = 375;
    (card as any)._imgAspect = 0.5;
    (card as any)._isMobileScreen = true;
    await (card as any).updateComplete;

    const wrapper = wrapperEl(card);
    // Wrapper aspect overridden to the 4/5 default (0.8) — a TALLER box.
    expect(wrapper.getAttribute('style')).toContain('aspect-ratio:0.8');

    // Frame is active and CONTAINED (no fill scale — the transform is gone).
    const frame = frameEl(card)!;
    expect(frame.classList.contains('framed')).toBe(true);
    expect(frame.getAttribute('style') ?? '').not.toContain('scale(');

    // Horizontal cushion each side: wrapper padding (drives _cardWidth) +
    // matching frame inset (positions the contained plan off the card edges).
    expect(wrapper.getAttribute('style')).toContain(`padding:0 ${CUSHION}px`);
    expect(cssVar(wrapper, '--av-frame-inset-x')).toBeCloseTo(CUSHION, 4);

    // Vertical centering: (boxHeight - planHeight)/2, boxHeight = (375+22)/0.8.
    const boxWidth = 375 + 2 * CUSHION;
    const boxHeight = boxWidth / 0.8;
    const planHeight = 375 * 0.5;
    const insetY = (boxHeight - planHeight) / 2;
    expect(cssVar(wrapper, '--av-frame-inset-y')).toBeCloseTo(insetY, 3);
    // Positive insetY => the whole plan fits with room to spare (contain, not crop).
    expect(insetY).toBeGreaterThan(0);
    // And the contained plan width (cushioned) never exceeds the box width.
    expect(375).toBeLessThan(boxWidth);
  });

  it('honours a custom aspectMobile (1/1) with matching contain insets', async () => {
    const card = await mountCard({
      ...BASE_CONFIG,
      options: { aspectMobile: '1/1' },
    } as any);
    (card as any)._cardWidth = 375;
    (card as any)._imgAspect = 0.5; // natural 2:1
    (card as any)._isMobileScreen = true;
    await (card as any).updateComplete;

    const wrapper = wrapperEl(card);
    expect(wrapper.getAttribute('style')).toContain('aspect-ratio:1');
    expect(frameEl(card)!.getAttribute('style') ?? '').not.toContain('scale(');
    expect(wrapper.getAttribute('style')).toContain(`padding:0 ${CUSHION}px`);
    expect(cssVar(wrapper, '--av-frame-inset-x')).toBeCloseTo(CUSHION, 4);
    // boxHeight = (375+22)/1 = 397; planHeight 187.5; insetY = 104.75.
    expect(cssVar(wrapper, '--av-frame-inset-y')).toBeCloseTo(104.75, 3);
  });

  it('markers do NOT drift: positions are identical framed vs unframed', async () => {
    const card = await mountCard();
    (card as any)._cardWidth = 375;
    (card as any)._imgAspect = 0.5;

    // Desktop (no frame): capture the marker position.
    (card as any)._isMobileScreen = false;
    await (card as any).updateComplete;
    expect(frameEl(card)!.classList.contains('framed')).toBe(false);
    const topUnframed = markerTop(firstMarker(card));

    // Mobile (framed): the marker sits at the SAME viewport coordinate. The
    // frame is the coordinate box for BOTH scene and overlay, and _viewport()
    // (width x imgAspect) is unchanged — so the inline translate is identical.
    (card as any)._isMobileScreen = true;
    await (card as any).updateComplete;
    expect(frameEl(card)!.classList.contains('framed')).toBe(true);
    const topFramed = markerTop(firstMarker(card));

    expect(topFramed).toBeCloseTo(topUnframed, 6);
    // And it matches the pure viewport projection (width x imgAspect), unchanged.
    const expected = markerScreenPos(30, 40, { scale: 1, panX: 0, panY: 0 }, {
      width: 375,
      height: 375 * 0.5,
    });
    expect(topFramed).toBeCloseTo(expected.top, 1);
  });

  it('no frame on desktop, or when the box is not taller than the plan', async () => {
    // Desktop: never framed regardless of aspectMobile.
    const card = await mountCard({ ...BASE_CONFIG, options: { aspectMobile: '1/1' } } as any);
    (card as any)._cardWidth = 375;
    (card as any)._imgAspect = 0.5;
    (card as any)._isMobileScreen = false;
    await (card as any).updateComplete;
    expect(frameEl(card)!.classList.contains('framed')).toBe(false);

    // Mobile but the plan is already TALLER than the requested box
    // (imgAspect 1.4 => planHeight 525 > boxHeight 397): insetY <= 0, skip.
    (card as any)._imgAspect = 1.4;
    (card as any)._isMobileScreen = true;
    await (card as any).updateComplete;
    expect(frameEl(card)!.classList.contains('framed')).toBe(false);
    expect(wrapperEl(card).getAttribute('style')).not.toContain('aspect-ratio');
    expect(wrapperEl(card).getAttribute('style')).not.toContain('--av-frame-inset');
  });
});
