// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import '../src/editor/preview-canvas';
import type { PreviewCanvas } from '../src/editor/preview-canvas';
import type { EntityConfig } from '../src/core/config';

function makeEntity(x: number, y: number): EntityConfig {
  return { entity: 'light.a', x, y, size: 'small', tap: 'toggle', orientation: null };
}

async function mount(): Promise<PreviewCanvas> {
  const el = document.createElement('preview-canvas') as PreviewCanvas;
  el.base = 'data:image/gif;base64,R0lGODlhAQABAAAAACw='; // 1x1 transparent
  el.entities = [makeEntity(20, 30), makeEntity(70, 80)];
  el.zones = [];
  el.selectedEntity = -1;
  el.drawingZone = false;
  // Force a deterministic preview rect so geometry math is predictable.
  (el as any).style.position = 'absolute';
  (el as any).style.left = '0px';
  (el as any).style.top = '0px';
  (el as any).style.width = '400px';
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

describe('preview-canvas', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders one marker per entity', async () => {
    const el = await mount();
    const markers = el.shadowRoot!.querySelectorAll('.marker');
    expect(markers.length).toBe(2);
  });

  it('clicking a marker fires preview-entity-selected with its index', async () => {
    const el = await mount();
    const events: number[] = [];
    el.addEventListener('preview-entity-selected', (e) =>
      events.push((e as CustomEvent).detail.index)
    );
    const marker = el.shadowRoot!.querySelectorAll('.marker')[1] as HTMLElement;
    marker.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, clientX: 0, clientY: 0 })
    );
    expect(events).toEqual([1]);
  });

  it('applies .selected to the selected marker only', async () => {
    const el = await mount();
    el.selectedEntity = 0;
    await el.updateComplete;
    const markers = el.shadowRoot!.querySelectorAll('.marker');
    expect(markers[0].classList.contains('selected')).toBe(true);
    expect(markers[1].classList.contains('selected')).toBe(false);
  });

  it('dragging a marker fires preview-entity-moved with clamped %', async () => {
    const el = await mount();
    const moves: { index: number; x: number; y: number }[] = [];
    el.addEventListener('preview-entity-moved', (e) =>
      moves.push((e as CustomEvent).detail)
    );
    const surface = el.shadowRoot!.querySelector('.surface') as HTMLElement;
    // Stub getBoundingClientRect to return a known rect for geometry math
    surface.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 400, height: 200, right: 400, bottom: 200 }) as DOMRect;
    const marker = el.shadowRoot!.querySelectorAll('.marker')[0] as HTMLElement;
    marker.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        clientX: 400 * 0.2,
        clientY: 200 * 0.3,
      })
    );
    surface.dispatchEvent(
      new PointerEvent('pointermove', {
        bubbles: true,
        clientX: 400 * 0.6,
        clientY: 200 * 0.4,
      })
    );
    surface.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    expect(moves.length).toBeGreaterThan(0);
    const last = moves[moves.length - 1];
    expect(last.index).toBe(0);
    expect(last.x).toBeCloseTo(60, 0);
    expect(last.y).toBeCloseTo(40, 0);
  });

  it('drawing a zone fires preview-zone-drawn with a normalized rect', async () => {
    const el = await mount();
    el.drawingZone = true;
    await el.updateComplete;
    const drawn: any[] = [];
    el.addEventListener('preview-zone-drawn', (e) =>
      drawn.push((e as CustomEvent).detail)
    );
    const surface = el.shadowRoot!.querySelector('.surface') as HTMLElement;
    // Stub getBoundingClientRect to return a known rect for geometry math
    surface.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 400, height: 200, right: 400, bottom: 200 }) as DOMRect;
    surface.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        clientX: 400 * 0.1,
        clientY: 200 * 0.2,
      })
    );
    surface.dispatchEvent(
      new PointerEvent('pointermove', {
        bubbles: true,
        clientX: 400 * 0.5,
        clientY: 200 * 0.7,
      })
    );
    surface.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    expect(drawn.length).toBe(1);
    expect(drawn[0].x).toBeCloseTo(10, 0);
    expect(drawn[0].y).toBeCloseTo(20, 0);
    expect(drawn[0].width).toBeCloseTo(40, 0);
    expect(drawn[0].height).toBeCloseTo(50, 0);
  });

  it('shows crosshair cursor while in zone-draw mode', async () => {
    const el = await mount();
    el.drawingZone = true;
    await el.updateComplete;
    const surface = el.shadowRoot!.querySelector('.surface') as HTMLElement;
    expect(getComputedStyle(surface).cursor).toBe('crosshair');
  });

  it('an empty zone drag fires preview-zone-draw-cancelled', async () => {
    const el = await mount();
    el.drawingZone = true;
    await el.updateComplete;
    const cancelled: any[] = [];
    el.addEventListener('preview-zone-draw-cancelled', () => cancelled.push(1));
    const surface = el.shadowRoot!.querySelector('.surface') as HTMLElement;
    // Stub getBoundingClientRect to return a known rect
    surface.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 400, height: 200, right: 400, bottom: 200 }) as DOMRect;
    surface.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        clientX: 5,
        clientY: 5,
      })
    );
    surface.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    expect(cancelled.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Drawing-mode indication (rc.2 field feedback #3)
// ---------------------------------------------------------------------------

describe('preview-canvas: drawing-mode indication', () => {
  it('shows the instruction banner + disables marker hits while drawing', async () => {
    const el = await mount();
    expect(el.shadowRoot!.querySelector('.draw-banner')).toBeNull();
    el.drawingZone = true;
    await el.updateComplete;
    const banner = el.shadowRoot!.querySelector('.draw-banner')!;
    expect(banner.textContent).toContain('Draw the zone');
    expect(el.shadowRoot!.querySelector('.surface')!.classList.contains('drawing')).toBe(true);
  });

  it('Escape cancels an armed draw', async () => {
    const el = await mount();
    el.drawingZone = true;
    await el.updateComplete;
    let cancelled = false;
    el.addEventListener('preview-zone-draw-cancelled', () => (cancelled = true));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(cancelled).toBe(true);
  });
});
