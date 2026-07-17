// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '../src/editor/spatial-plan-editor';
import { rectangularSpatialPlan } from '../src/core/spatial-plan';
import type { EntityConfig, OpeningConfig, SpatialElement, SpatialShellConfig } from '../src/core/config';

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
    editor.editScope = 'rooms';
    await editor.updateComplete;
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

  it('shows only the editing handles that belong to the active setup tab', async () => {
    const editor = await mount();
    const wall = editor.plan.walls[0];
    editor.openings = [{
      id: 'window-1', name: 'Window', kind: 'window', wallId: wall.id,
      position: 0.5, width: 0.1, widthMeters: 1.2, height: 1.2, bottom: 0.9,
    } satisfies OpeningConfig];
    editor.plan = {
      ...editor.plan,
      elements: [{
        id: 'sofa', type: 'custom', name: 'Sofa', zoneId: 'living',
        position: { x: 2, y: 0.4, z: 3 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, primitives: [],
      } satisfies SpatialElement],
    };
    editor.entities = [{
      entity: 'light.living', name: 'Living light', x: 50, y: 50, size: 'medium', tap: 'more-info', orientation: null,
      spatial: { position: { x: 4, y: 2.4, z: 5 }, rotation: { x: 0, y: 0, z: 0 }, mount: 'ceiling', visible: true },
    } satisfies EntityConfig];

    const expectations = [
      ['structure', '.vertex', '.wall-hit'],
      ['rooms', '.room', '.vertex'],
      ['openings', '.opening-hit', '.opening'],
      ['elements', '.element', '.element-shape'],
      ['devices', '.entity-marker', '.entity-marker'],
    ] as const;
    for (const [scope, primary, secondary] of expectations) {
      editor.editScope = scope;
      await editor.updateComplete;
      expect(editor.shadowRoot.querySelector(primary), `${scope} primary layer`).toBeTruthy();
      expect(editor.shadowRoot.querySelector(secondary), `${scope} secondary layer`).toBeTruthy();
      expect(editor.shadowRoot.querySelectorAll('.wall')).not.toHaveLength(0);
      expect(Boolean(editor.shadowRoot.querySelector('.opening-hit'))).toBe(scope === 'openings');
      expect(Boolean(editor.shadowRoot.querySelector('.element'))).toBe(scope === 'elements');
      expect(Boolean(editor.shadowRoot.querySelector('.entity-marker'))).toBe(scope === 'devices');
    }
  });

  it('keeps walls as quiet context when a setup tab has no plan handles', async () => {
    const editor = await mount();
    editor.editScope = 'none';
    await editor.updateComplete;

    expect(editor.shadowRoot.querySelectorAll('.wall')).not.toHaveLength(0);
    expect(editor.shadowRoot.querySelector('.wall-hit')).toBeNull();
    expect(editor.shadowRoot.querySelector('.vertex')).toBeNull();
    expect(editor.shadowRoot.querySelector('.room')).toBeNull();
    expect(editor.shadowRoot.querySelector('.mode-group')).toBeNull();
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

  it('exposes room-only floor corners only in Rooms, never as Structure points', async () => {
    const editor = await mount();
    editor.shell = {
      outer: [[0, 0], [4, 0], [4, 3], [0, 3]], holes: [], floor: [[0, 0], [4, 0], [4, 3], [0, 3]],
      walls: [{ id: 'north', points: [[0, 0], [4, 0]], thickness: 0.2 }], openings: [],
      rooms: [{ zoneId: 'living', floor: [[0, 0], [4, 0], [3.25, 2.25], [0, 3]] }],
    } satisfies SpatialShellConfig;
    editor.editScope = 'rooms';
    await editor.updateComplete;
    expect(editor._shellControlPoints()).not.toContainEqual([3.25, 2.25]);
    expect([...editor.shadowRoot.querySelectorAll('.survey-vertex-hit')].some((handle: Element) => (
      Number(handle.getAttribute('cx')) === 3.25 && Number(handle.getAttribute('cy')) === 2.25
    ))).toBe(true);
  });

  it('draws an independent room zone without requiring walls', async () => {
    const editor = await mount();
    editor.editScope = 'rooms';
    await editor.updateComplete;
    const created = vi.fn();
    editor.addEventListener('spatial-room-created', created);
    editor._setMode('room');
    editor._draftRoomPoints = [[1, 1], [4, 1], [4, 3], [1, 3]];

    editor._finishRoom();

    expect(created).toHaveBeenCalledOnce();
    expect(created.mock.calls[0][0].detail.floor).toEqual([[1, 1], [4, 1], [4, 3], [1, 3]]);
    expect(editor._mode).toBe('select');
  });

  it('keeps an invalid room draft editable instead of creating broken geometry', async () => {
    const editor = await mount();
    editor.editScope = 'rooms';
    const created = vi.fn();
    editor.addEventListener('spatial-room-created', created);
    editor._setMode('room');
    editor._draftRoomPoints = [[1, 1], [4, 4], [1, 4], [4, 1]];

    editor._finishRoom();
    await editor.updateComplete;

    expect(created).not.toHaveBeenCalled();
    expect(editor._mode).toBe('room');
    expect(editor._draftRoomPoints).toHaveLength(4);
    expect(editor.shadowRoot.querySelector('.hint')?.textContent).toContain('non-crossing');
  });

  it('nudges an independent room corner by exactly one centimetre', async () => {
    const editor = await mount();
    editor.plan = {
      ...editor.plan,
      rooms: [{
        id: 'reading', boundary: [], floor: [[1, 1], [3, 1], [3, 2], [1, 2]], floorFinish: 'wood',
      }],
    };
    editor.editScope = 'rooms';
    editor._selectedRoomPoint = { roomId: 'reading', index: 0 };
    await editor.updateComplete;

    (editor.shadowRoot.querySelector('svg') as SVGSVGElement).dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }),
    );

    expect(editor.plan.rooms[0].floor[0]).toEqual([1.01, 1]);
  });

  it('clears the previous room corner before selecting another room', async () => {
    const editor = await mount();
    editor.plan = {
      ...editor.plan,
      rooms: [
        { id: 'one', boundary: [], floor: [[0, 0], [2, 0], [2, 2], [0, 2]], floorFinish: 'wood' },
        { id: 'two', boundary: [], floor: [[3, 0], [5, 0], [5, 2], [3, 2]], floorFinish: 'wood' },
      ],
    };
    editor.editScope = 'rooms';
    editor._selectedRoomPoint = { roomId: 'one', index: 0 };
    editor._selectRoom(new PointerEvent('pointerdown', { button: 0 }), 'two');

    expect(editor._selectedRoomPoint).toBeNull();
    expect(editor._selectedShellRoomPoint).toBeNull();
  });

  it('moves a surveyed room corner without moving coincident architecture', async () => {
    const editor = await mount();
    editor.shell = {
      outer: [[0, 0], [4, 0], [4, 3], [0, 3]], holes: [], floor: [[0, 0], [4, 0], [4, 3], [0, 3]],
      walls: [{ id: 'north', points: [[0, 0], [4, 0]], thickness: 0.2 }], openings: [],
      rooms: [{ zoneId: 'living', floor: [[0, 0], [4, 0], [4, 3], [0, 3]] }],
    } satisfies SpatialShellConfig;
    const next = editor._moveShellRoomPoint(editor.shell, { zoneId: 'living', floorIndex: 0, pointIndex: 0 }, { x: 0.25, z: 0.2 });

    expect(next.rooms[0].floor[0]).toEqual([0.25, 0.2]);
    expect(next.outer[0]).toEqual([0, 0]);
    expect(next.floor[0]).toEqual([0, 0]);
    expect(next.walls[0].points[0]).toEqual([0, 0]);
  });

  it('rejects room-corner movement that would cross the floor polygon', async () => {
    const editor = await mount();
    editor.plan = {
      ...editor.plan,
      rooms: [{ id: 'room', boundary: [], floor: [[0, 0], [4, 0], [4, 3], [0, 3]], floorFinish: 'wood' }],
    };
    const next = editor._moveRoomPoint(editor.plan, { roomId: 'room', index: 1 }, { x: 2, z: 4 });
    expect(next).toBe(editor.plan);
  });

  it('clears a selected floor corner when the parent chooses another room', async () => {
    const editor = await mount();
    editor.editScope = 'rooms';
    editor._selectedRoomPoint = { roomId: editor.plan.rooms[0].id, index: 0 };
    editor.selectedRoomId = 'different-room';
    await editor.updateComplete;
    expect(editor._selectedRoomPoint).toBeNull();
  });

  it('keeps the newly selected corner active when pointer selection changes rooms', async () => {
    const editor = await mount();
    editor.plan = {
      ...editor.plan,
      rooms: [{ id: 'room-two', boundary: [], floor: [[1, 1], [3, 1], [3, 2], [1, 2]], floorFinish: 'wood' }],
    };
    editor.editScope = 'rooms';
    editor._selectedRoomPoint = { roomId: 'room-two', index: 0 };
    editor.selectedRoomId = 'room-two';
    await editor.updateComplete;
    expect(editor._selectedRoomPoint).toEqual({ roomId: 'room-two', index: 0 });
  });

  it('keeps pointer movement local and emits one authoritative plan change on release', async () => {
    const editor = await mount();
    const changed = vi.fn();
    editor.addEventListener('spatial-plan-changed', changed);
    const vertex = editor.plan.vertices[0];
    editor._dragVertexId = vertex.id;
    editor._pendingDragPoint = { x: vertex.x + 0.37, z: vertex.z + 0.21 };

    editor._applyPendingDrag();
    await editor.updateComplete;

    expect(changed).not.toHaveBeenCalled();
    expect(editor.plan.vertices[0]).toMatchObject(vertex);
    expect(editor._dragPlan.vertices[0]).toMatchObject({ x: vertex.x + 0.37, z: vertex.z + 0.21 });

    editor._endVertexDrag();
    expect(changed).toHaveBeenCalledOnce();
    expect(changed.mock.calls[0][0].detail.record).toBe(true);
  });

  it('keeps an in-progress draft stable across parent property updates', async () => {
    const editor = await mount();
    const original = editor.plan;
    const vertex = original.vertices[0];
    editor._dragVertexId = vertex.id;
    editor._pendingDragPoint = { x: vertex.x + 0.42, z: vertex.z + 0.18 };
    editor._applyPendingDrag();
    await editor.updateComplete;

    editor.plan = { ...original };
    await editor.updateComplete;

    const rendered = [...editor.shadowRoot.querySelectorAll('.vertex')]
      .find((candidate: Element) => Number(candidate.getAttribute('cx')) === vertex.x + 0.42) as SVGCircleElement;
    expect(editor._dragPlan.vertices[0]).toMatchObject({ x: vertex.x + 0.42, z: vertex.z + 0.18 });
    expect(rendered).toBeTruthy();
  });

  it('discards a transient edit when the pointer gesture is cancelled', async () => {
    const editor = await mount();
    const original = editor.plan;
    const vertex = original.vertices[0];
    const changed = vi.fn();
    editor.addEventListener('spatial-plan-changed', changed);
    editor._dragVertexId = vertex.id;
    editor._pendingDragPoint = { x: vertex.x + 0.42, z: vertex.z + 0.18 };
    editor._applyPendingDrag();

    editor._onCanvasPointerCancel(new PointerEvent('pointercancel'));
    await editor.updateComplete;

    expect(changed).not.toHaveBeenCalled();
    expect(editor.plan).toBe(original);
    expect(editor._dragPlan).toBeNull();
  });

  it('clears a transient shell-point selection when its gesture is cancelled', async () => {
    const editor = await mount();
    editor.shell = {
      outer: [[0, 0], [4, 0], [4, 3], [0, 3]], holes: [], floor: [[0, 0], [4, 0], [4, 3], [0, 3]],
      walls: [{ id: 'north', points: [[0, 0], [4, 0]], thickness: 0.2 }], rooms: [], openings: [],
    } satisfies SpatialShellConfig;
    editor._dragShellPoint = [0, 0];
    editor._selectedShellPoint = [0.25, 0.25];
    editor._dragShell = { ...editor.shell, outer: [[0.25, 0.25], [4, 0], [4, 3], [0, 3]] };

    editor._onCanvasPointerCancel(new PointerEvent('pointercancel'));

    expect(editor._selectedShellPoint).toBeNull();
    expect(editor._dragShell).toBeNull();
  });

  it('nudges a selected wall or floor point by exactly one centimetre', async () => {
    const editor = await mount();
    const vertex = editor.plan.vertices[0];
    editor.selectedVertexId = vertex.id;
    await editor.updateComplete;
    const canvas = editor.shadowRoot.querySelector('svg') as SVGSVGElement;

    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));

    expect(editor.plan.vertices[0].x).toBeCloseTo(vertex.x + 0.01, 6);
    expect(editor.shadowRoot.querySelector('.hint')?.textContent).toContain('Arrow keys 1 cm');
  });

  it('preserves a true one centimetre delta for non-grid-aligned coordinates', async () => {
    const editor = await mount();
    const vertex = editor.plan.vertices[0];
    editor.plan = {
      ...editor.plan,
      vertices: editor.plan.vertices.map((candidate: any) => candidate.id === vertex.id
        ? { ...candidate, x: 1.2344, z: 2.87654 }
        : candidate),
    };
    editor.selectedVertexId = vertex.id;
    await editor.updateComplete;
    const canvas = editor.shadowRoot.querySelector('svg') as SVGSVGElement;

    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));

    expect(editor.plan.vertices.find((candidate: any) => candidate.id === vertex.id)?.x).toBe(1.2444);
  });

  it('supports one millimetre and ten centimetre precision modifiers', async () => {
    const editor = await mount();
    const vertex = editor.plan.vertices[0];
    editor.selectedVertexId = vertex.id;
    await editor.updateComplete;
    const canvas = editor.shadowRoot.querySelector('svg') as SVGSVGElement;

    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', altKey: true, bubbles: true, cancelable: true }));
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: true, bubbles: true, cancelable: true }));

    expect(editor.plan.vertices[0].x).toBeCloseTo(vertex.x + 0.001, 6);
    expect(editor.plan.vertices[0].z).toBeCloseTo(vertex.z + 0.1, 6);
  });

  it('nudges Elements and device markers by one centimetre', async () => {
    const editor = await mount();
    const element: SpatialElement = {
      id: 'sofa', type: 'custom', name: 'Sofa', zoneId: 'living',
      position: { x: 2, y: 0.4, z: 3 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, primitives: [],
    };
    const entity: EntityConfig = {
      entity: 'light.living', name: 'Living light', x: 50, y: 50, size: 'medium', tap: 'more-info', orientation: null,
      spatial: { position: { x: 4, y: 2.4, z: 5 }, rotation: { x: 0, y: 0, z: 0 }, mount: 'ceiling', visible: true },
    };
    editor.plan = { ...editor.plan, elements: [element] };
    editor.entities = [entity];
    editor.selectedElementId = element.id;
    editor.editScope = 'elements';
    await editor.updateComplete;
    const canvas = editor.shadowRoot.querySelector('svg') as SVGSVGElement;

    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
    expect(editor.plan.elements[0].position.x).toBeCloseTo(1.99, 6);

    const moved = vi.fn();
    editor.addEventListener('spatial-entity-moved', moved);
    editor.selectedElementId = '';
    editor.selectedEntityId = entity.entity;
    editor.editScope = 'devices';
    await editor.updateComplete;
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));

    expect(moved).toHaveBeenCalledOnce();
    expect(moved.mock.calls[0][0].detail).toMatchObject({
      entityId: entity.entity,
      point: { x: 4, z: 4.99 },
      record: true,
    });
  });

  it('nudges an opening one centimetre along its wall', async () => {
    const editor = await mount();
    const wall = editor.plan.walls[0];
    const opening: OpeningConfig = {
      id: 'window-1', name: 'Window', kind: 'window', wallId: wall.id,
      position: 0.5, width: 0.1, widthMeters: 1.2, height: 1.2, bottom: 0.9,
    };
    editor.openings = [opening];
    editor.selectedOpeningId = opening.id;
    editor.editScope = 'openings';
    await editor.updateComplete;
    const moved = vi.fn();
    editor.addEventListener('spatial-opening-moved', moved);
    const canvas = editor.shadowRoot.querySelector('svg') as SVGSVGElement;

    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));

    expect(moved).toHaveBeenCalledOnce();
    const start = editor.plan.vertices.find((candidate: any) => candidate.id === wall.start)!;
    const end = editor.plan.vertices.find((candidate: any) => candidate.id === wall.end)!;
    const length = Math.hypot(
      end.x - start.x,
      end.z - start.z,
    );
    expect((moved.mock.calls[0][0].detail.position - opening.position) * length).toBeCloseTo(0.01, 6);
  });

  it('nudges a plan opening correctly when an imported shell also exists', async () => {
    const editor = await mount();
    const wall = editor.plan.walls[0];
    const opening: OpeningConfig = {
      id: 'native-window', name: 'Native window', kind: 'window', wallId: wall.id,
      position: 0.5, width: 0.1, widthMeters: 1, height: 1.2, bottom: 0.9,
    };
    editor.openings = [opening];
    editor.shell = {
      outer: [[0, 0], [4, 0], [4, 3], [0, 3]], holes: [], floor: [[0, 0], [4, 0], [4, 3], [0, 3]],
      walls: [{ id: 'north', points: [[0, 0], [4, 0]], thickness: 0.2 }], rooms: [],
      openings: [{
        id: 'shell-window', name: 'Shell window', kind: 'window', x: 2, z: 0, width: 1,
        depth: 0.2, rotation: 0, bottom: 0.8, height: 1.2,
      }],
    } satisfies SpatialShellConfig;
    editor.selectedOpeningId = 'shell-window';
    await editor.updateComplete;
    editor.selectedOpeningId = opening.id;
    editor.editScope = 'openings';
    await editor.updateComplete;
    const moved = vi.fn();
    editor.addEventListener('spatial-opening-moved', moved);

    (editor.shadowRoot.querySelector('svg') as SVGSVGElement).dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }),
    );

    expect(moved).toHaveBeenCalledOnce();
    expect(editor._selectedOpeningKind).toBe('plan');
  });

  it('nudges surveyed floor points and wall openings by one centimetre', async () => {
    const editor = await mount();
    editor.shell = {
      outer: [[0, 0], [4, 0], [4, 3], [0, 3]], holes: [], floor: [[0, 0], [4, 0], [4, 3], [0, 3]],
      walls: [{ id: 'north', points: [[0, 0], [4, 0]], thickness: 0.2 }],
      rooms: [{ zoneId: 'living', floor: [[0, 0], [4, 0], [4, 3], [0, 3]] }],
      openings: [{
        id: 'window-1', name: 'Window', kind: 'window', x: 2, z: 0, width: 1,
        depth: 0.2, rotation: 0, bottom: 0.8, height: 1.2,
      }],
    } satisfies SpatialShellConfig;

    editor._nudgeShellPoint(new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true }), [0, 0]);
    expect(editor.shell.floor[0]).toEqual([0, 0.01]);
    expect(editor.shell.rooms[0].floor[0]).toEqual([0, 0.01]);

    editor.selectedOpeningId = 'window-1';
    editor.editScope = 'openings';
    await editor.updateComplete;
    const openingBefore = { x: editor.shell.openings[0].x, z: editor.shell.openings[0].z };
    const changed = vi.fn();
    editor.addEventListener('spatial-shell-changed', changed);
    const canvas = editor.shadowRoot.querySelector('svg') as SVGSVGElement;
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));

    expect(Math.hypot(
      editor.shell.openings[0].x - openingBefore.x,
      editor.shell.openings[0].z - openingBefore.z,
    )).toBeCloseTo(0.01, 6);
    expect(changed).toHaveBeenCalledOnce();
  });

  it('moves an opening exactly one centimetre along a diagonal surveyed wall', async () => {
    const editor = await mount();
    editor.shell = {
      outer: [[0, 0], [4, 4], [4, 6], [0, 2]], holes: [], floor: [[0, 0], [4, 4], [4, 6], [0, 2]],
      walls: [{ id: 'diagonal', points: [[0, 0], [4, 4]], thickness: 0.2 }], rooms: [],
      openings: [{
        id: 'diagonal-window', name: 'Diagonal window', kind: 'window', x: 2, z: 2, width: 1,
        depth: 0.2, rotation: 45, bottom: 0.8, height: 1.2,
      }],
    } satisfies SpatialShellConfig;
    editor.selectedOpeningId = 'diagonal-window';
    editor.editScope = 'openings';
    await editor.updateComplete;
    const before = editor.shell.openings[0];

    (editor.shadowRoot.querySelector('svg') as SVGSVGElement).dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }),
    );

    const after = editor.shell.openings[0];
    expect(Math.hypot(after.x - before.x, after.z - before.z)).toBeCloseTo(0.01, 7);
  });

  it('clears hidden structure selections when switching to room editing', async () => {
    const editor = await mount();
    const orphan = { id: 'orphan', x: 20, z: 20 };
    editor.plan = { ...editor.plan, vertices: [...editor.plan.vertices, orphan] };
    editor.shell = {
      outer: [[0, 0], [4, 0], [4, 3], [0, 3]], holes: [], floor: [[0, 0], [4, 0], [4, 3], [0, 3]],
      walls: [{ id: 'remote', points: [[9, 9], [10, 9]], thickness: 0.2 }],
      rooms: [{ zoneId: 'living', floor: [[0, 0], [4, 0], [4, 3], [0, 3]] }], openings: [],
    } satisfies SpatialShellConfig;
    editor.selectedVertexId = orphan.id;
    editor._selectedShellPoint = [9, 9];
    editor.editScope = 'rooms';
    await editor.updateComplete;

    expect(editor.selectedVertexId).toBe('');
    expect(editor._selectedShellPoint).toBeNull();
  });
});
