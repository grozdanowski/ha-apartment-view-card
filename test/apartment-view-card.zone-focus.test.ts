// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
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
    },
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
