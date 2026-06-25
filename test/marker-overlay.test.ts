// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { render } from 'lit';
import { computeMarkerViews, renderMarkerOverlay } from '../src/render/marker-overlay';
import type { MarkerView } from '../src/render/marker-overlay';
import type { EntityConfig } from '../src/core/config';
import type { Viewport, ZoomTransform } from '../src/core/geometry';
import type { HassEntity } from '../src/core/ha-types';

function ent(partial: Partial<EntityConfig>): EntityConfig {
  return {
    entity: 'light.x',
    x: 50,
    y: 50,
    size: 'small',
    tap: 'toggle',
    orientation: null,
    ...partial,
  };
}

function lightState(on: boolean): HassEntity {
  return {
    entity_id: 'light.x',
    state: on ? 'on' : 'off',
    attributes: {},
  };
}

const vp: Viewport = { width: 1000, height: 800 };
const t: ZoomTransform = { scale: 1, panX: 0, panY: 0 };

describe('computeMarkerViews', () => {
  it('places markers at screen px and clamps icon scale', () => {
    const big: ZoomTransform = { scale: 3, panX: 0, panY: 0 };
    const views = computeMarkerViews(
      [ent({ entity: 'light.x', x: 50, y: 50 })],
      { 'light.x': lightState(true) },
      big,
      vp,
      null
    );
    expect(views).toHaveLength(1);
    // 50/100*1000*3 = 1500 ; 50/100*800*3 = 1200
    expect(views[0].left).toBe(1500);
    expect(views[0].top).toBe(1200);
    // scale 3 -> clamped to 2.0
    expect(views[0].iconScale).toBe(2.0);
  });

  it('marks active state from isActive', () => {
    const views = computeMarkerViews(
      [ent({ entity: 'light.x' })],
      { 'light.x': lightState(true) },
      t,
      vp,
      null
    );
    expect(views[0].active).toBe(true);

    const off = computeMarkerViews(
      [ent({ entity: 'light.x' })],
      { 'light.x': lightState(false) },
      t,
      vp,
      null
    );
    expect(off[0].active).toBe(false);
  });

  it('all markers focused when not in zone focus (null set)', () => {
    const views = computeMarkerViews(
      [ent({ entity: 'light.a', x: 10 }), ent({ entity: 'light.b', x: 90 })],
      { 'light.a': lightState(true), 'light.b': lightState(false) },
      t,
      vp,
      null
    );
    expect(views.every((v) => v.focused)).toBe(true);
  });

  it('dims markers outside the focused zone set', () => {
    const focus = new Set(['light.a']);
    const views = computeMarkerViews(
      [ent({ entity: 'light.a', x: 10 }), ent({ entity: 'light.b', x: 90 })],
      { 'light.a': lightState(true), 'light.b': lightState(true) },
      t,
      vp,
      focus
    );
    const a = views.find((v) => v.entity.entity === 'light.a')!;
    const b = views.find((v) => v.entity.entity === 'light.b')!;
    expect(a.focused).toBe(true);
    expect(b.focused).toBe(false);
  });

  it('tolerates a missing entity state (state undefined, not active)', () => {
    const views = computeMarkerViews(
      [ent({ entity: 'light.ghost' })],
      {},
      t,
      vp,
      null
    );
    expect(views[0].state).toBeUndefined();
    expect(views[0].active).toBe(false);
  });
});

function makeView(over: Partial<MarkerView> = {}): MarkerView {
  return {
    entity: ent({ entity: 'light.x' }),
    state: lightState(true),
    left: 200,
    top: 150,
    iconScale: 1.5,
    icon: 'mdi:lightbulb',
    active: true,
    focused: true,
    ...over,
  };
}

describe('renderMarkerOverlay', () => {
  it('positions each marker with left/top and transform scale', () => {
    const host = document.createElement('div');
    const view = makeView({ left: 300, top: 250, iconScale: 1.2 });
    render(renderMarkerOverlay([view], () => {}), host);

    const marker = host.querySelector('.marker') as HTMLElement;
    expect(marker).toBeTruthy();
    expect(marker.style.left).toBe('300px');
    expect(marker.style.top).toBe('250px');
    expect(marker.style.transform).toContain('translate(-50%,-50%)');
    expect(marker.style.transform).toContain('scale(1.2)');
  });

  it('passes icon attribute to ha-icon', () => {
    const host = document.createElement('div');
    const view = makeView({ icon: 'mdi:fan' });
    render(renderMarkerOverlay([view], () => {}), host);

    const haIcon = host.querySelector('ha-icon');
    expect(haIcon).toBeTruthy();
    expect(haIcon!.getAttribute('icon')).toBe('mdi:fan');
  });

  it('active markers get active class', () => {
    const host = document.createElement('div');
    render(renderMarkerOverlay([makeView({ active: true })], () => {}), host);
    const marker = host.querySelector('.marker') as HTMLElement;
    expect(marker.classList.contains('active')).toBe(true);
  });

  it('unfocused markers render at opacity 0.25 and are non-interactive', () => {
    const host = document.createElement('div');
    render(renderMarkerOverlay([makeView({ focused: false })], () => {}), host);
    const marker = host.querySelector('.marker') as HTMLElement;
    expect(marker.style.opacity).toBe('0.25');
    expect(marker.style.pointerEvents).toBe('none');
  });

  it('focused markers do not dim', () => {
    const host = document.createElement('div');
    render(renderMarkerOverlay([makeView({ focused: true })], () => {}), host);
    const marker = host.querySelector('.marker') as HTMLElement;
    expect(marker.style.opacity).not.toBe('0.25');
  });

  it('fires onPointerDown with the event and view', () => {
    const host = document.createElement('div');
    const calls: Array<[PointerEvent, MarkerView]> = [];
    const view = makeView();
    render(renderMarkerOverlay([view], (e, m) => calls.push([e, m])), host);

    const marker = host.querySelector('.marker') as HTMLElement;
    const evt = new PointerEvent('pointerdown');
    marker.dispatchEvent(evt);
    expect(calls).toHaveLength(1);
    expect(calls[0][1]).toBe(view);
  });
});
