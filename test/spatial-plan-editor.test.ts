// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '../src/editor/spatial-plan-editor';
import { rectangularSpatialPlan } from '../src/core/spatial-plan';
import type { SpatialShellConfig } from '../src/core/config';

async function mount() {
  const editor = document.createElement('spatial-plan-editor') as any;
  editor.plan = rectangularSpatialPlan(12, 8);
  document.body.append(editor);
  await editor.updateComplete;
  return editor;
}

function viewBox(editor: any): number[] {
  return (editor.shadowRoot.querySelector('svg') as SVGSVGElement)
    .getAttribute('viewBox')!
    .split(' ')
    .map(Number);
}

describe('spatial-plan-editor precision viewport', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('offers accessible pan, zoom, and fit controls in every plan editor', async () => {
    const editor = await mount();
    const controls = editor.shadowRoot.querySelector('.viewport-controls');
    expect(controls?.getAttribute('role')).toBe('toolbar');
    expect([...controls.querySelectorAll('button')].map((button: Element) => button.getAttribute('aria-label'))).toEqual([
      'Pan plan',
      'Zoom out',
      'Fit home in view',
      'Zoom in',
    ]);
  });

  it('zooms without changing plan geometry and keeps editing handles a stable screen size', async () => {
    const editor = await mount();
    const changed = vi.fn();
    editor.addEventListener('spatial-plan-changed', changed);
    const initialView = viewBox(editor);
    const initialRadius = Number(editor.shadowRoot.querySelector('.vertex')?.getAttribute('r'));

    (editor.shadowRoot.querySelector('[aria-label="Zoom in"]') as HTMLButtonElement).click();
    await editor.updateComplete;

    const zoomedView = viewBox(editor);
    const zoomedRadius = Number(editor.shadowRoot.querySelector('.vertex')?.getAttribute('r'));
    expect(zoomedView[2]).toBeLessThan(initialView[2]);
    expect(zoomedView[3]).toBeLessThan(initialView[3]);
    expect(zoomedRadius / zoomedView[2]).toBeCloseTo(initialRadius / initialView[2], 4);
    expect(changed).not.toHaveBeenCalled();
  });

  it('fits the complete home after zooming or panning', async () => {
    const editor = await mount();
    const initial = viewBox(editor);
    editor._zoomIn();
    editor._panX = 2;
    editor._panZ = -1;
    await editor.updateComplete;
    expect(viewBox(editor)).not.toEqual(initial);

    (editor.shadowRoot.querySelector('[aria-label="Fit home in view"]') as HTMLButtonElement).click();
    await editor.updateComplete;
    expect(viewBox(editor)).toEqual(initial);
    expect(editor._zoom).toBe(1);
  });

  it('uses an explicit touch pan mode and returns to Select with Escape', async () => {
    const editor = await mount();
    const pan = editor.shadowRoot.querySelector('[aria-label="Pan plan"]') as HTMLButtonElement;
    pan.click();
    await editor.updateComplete;
    expect(pan.getAttribute('aria-pressed')).toBe('true');
    expect(editor.shadowRoot.querySelector('svg')?.classList.contains('pan')).toBe(true);

    editor.shadowRoot.querySelector('svg')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await editor.updateComplete;
    expect(editor._mode).toBe('select');
  });

  it('keeps the large wall hit target visually transparent when focused', async () => {
    const editor = await mount();
    const hit = editor.shadowRoot.querySelector('.wall-hit') as SVGPathElement;
    hit.focus();

    const style = getComputedStyle(hit);
    expect(editor.shadowRoot.activeElement).toBe(hit);
    expect(style.stroke).toMatch(/transparent|rgba\(0, 0, 0, 0\)/);
    expect(style.outlineStyle).toBe('none');
  });

  it('does not move focus into the plan when structure editing starts', async () => {
    const editor = await mount();
    const outside = document.createElement('button');
    document.body.prepend(outside);
    outside.focus();

    await editor.beginStructureEditing();

    expect(document.activeElement).toBe(outside);
    expect(editor.shadowRoot.activeElement).toBeNull();
  });

  it('prevents pointer taps from applying native SVG focus paint', async () => {
    const editor = await mount();
    const room = editor.shadowRoot.querySelector('.room') as SVGPolygonElement;
    const pointer = new PointerEvent('pointerdown', {
      button: 0,
      bubbles: true,
      cancelable: true,
    });

    expect(room.dispatchEvent(pointer)).toBe(false);
    expect(pointer.defaultPrevented).toBe(true);
    expect(editor.shadowRoot.activeElement).toBeNull();
  });

  it('offers wall drawing for surveyed homes too', async () => {
    const editor = await mount();
    const shell: SpatialShellConfig = {
      outer: [[0, 0], [4, 0], [4, 3], [0, 3]], holes: [], floor: [[0, 0], [4, 0], [4, 3], [0, 3]],
      walls: [{ id: 'north', points: [[0, 0], [4, 0]], thickness: 0.2 }], openings: [],
    };
    editor.shell = shell;
    await editor.updateComplete;
    const draw = [...editor.shadowRoot.querySelectorAll('.mode-group button')]
      .find((button: Element) => button.textContent?.trim() === 'Draw walls') as HTMLButtonElement;
    expect(draw).toBeTruthy();
    draw.click();
    await editor.updateComplete;
    expect(editor._mode).toBe('wall');
    expect(editor.shadowRoot.querySelector('.hint')?.textContent).toContain('first wall begins');
  });

  it('draws a snapped wall into the surveyed shell', async () => {
    const editor = await mount();
    editor.shell = {
      outer: [[0, 0], [4, 0], [4, 3], [0, 3]], holes: [], floor: [[0, 0], [4, 0], [4, 3], [0, 3]],
      walls: [{ id: 'north', points: [[0, 0], [4, 0]], thickness: 0.2 }], openings: [],
    } satisfies SpatialShellConfig;
    editor._mode = 'wall';
    editor._point = vi.fn()
      .mockReturnValueOnce({ x: 0.04, z: 0.03 })
      .mockReturnValueOnce({ x: 2, z: 2 });
    const changed = vi.fn();
    editor.addEventListener('spatial-shell-changed', changed);

    const pointer = { button: 0, preventDefault: vi.fn() } as unknown as PointerEvent;
    editor._onCanvasPointerDown(pointer);
    editor._onCanvasPointerDown(pointer);

    expect(editor.shell.walls).toHaveLength(2);
    expect(editor.shell.walls.at(-1).points).toEqual([[0, 0], [2, 2]]);
    expect(editor.selectedWallId).toBe('shell:wall-1:0');
    expect(changed).toHaveBeenCalledOnce();
    expect(pointer.preventDefault).toHaveBeenCalledTimes(2);
  });

  it('requires confirmation before requesting deletion of a selected wall', async () => {
    const editor = await mount();
    const requested = vi.fn();
    editor.addEventListener('spatial-wall-delete-requested', requested);
    editor.selectedWallId = editor.plan.walls[0].id;
    await editor.updateComplete;

    let button = editor.shadowRoot.querySelector('.delete-wall') as HTMLButtonElement;
    expect(button.textContent?.trim()).toBe('Delete wall');
    button.click();
    await editor.updateComplete;
    expect(requested).not.toHaveBeenCalled();
    button = editor.shadowRoot.querySelector('.delete-wall') as HTMLButtonElement;
    expect(button.textContent?.trim()).toBe('Confirm delete');
    button.click();
    expect(requested).toHaveBeenCalledOnce();
    expect(requested.mock.calls[0][0].detail.wallId).toBe('wall-1');
  });

  it('clears a stale room highlight when a wall is selected', async () => {
    const editor = await mount();
    editor.selectedRoomId = editor.plan.rooms[0].id;
    await editor.updateComplete;
    const wall = editor.shadowRoot.querySelector('.wall-hit') as SVGPathElement;
    wall.dispatchEvent(new PointerEvent('pointerdown', { button: 0, bubbles: true }));
    await editor.updateComplete;
    expect(editor.selectedRoomId).toBe('');
    expect(editor.selectedWallId).toBe(editor.plan.walls[0].id);
    expect(editor.shadowRoot.querySelector('.room.selected')).toBeNull();
  });

  it('exposes room-only floor corners for direct boundary editing', async () => {
    const editor = await mount();
    editor.shell = {
      outer: [[0, 0], [4, 0], [4, 3], [0, 3]], holes: [], floor: [[0, 0], [4, 0], [4, 3], [0, 3]],
      walls: [{ id: 'north', points: [[0, 0], [4, 0]], thickness: 0.2 }], openings: [],
      rooms: [{ zoneId: 'living', floor: [[0, 0], [4, 0], [3.25, 2.25], [0, 3]] }],
    } satisfies SpatialShellConfig;
    await editor.updateComplete;
    expect(editor._shellControlPoints()).toContainEqual([3.25, 2.25]);
  });
});
