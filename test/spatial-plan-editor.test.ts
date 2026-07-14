// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '../src/editor/spatial-plan-editor';
import { rectangularSpatialPlan } from '../src/core/spatial-plan';

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
});
