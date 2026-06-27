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
    expect(views[0].glowColor).toBeUndefined();
    expect(views[0].brightness).toBe(0);
  });

  it('sets glowColor (resolved light colour) + brightness for an active light', () => {
    const colored: HassEntity = { entity_id: 'light.x', state: 'on', attributes: { rgb_color: [255, 100, 50], brightness: 128 } };
    const views = computeMarkerViews([ent({ entity: 'light.x' })], { 'light.x': colored }, t, vp, null);
    expect(views[0].glowColor).toMatch(/^rgb\(\s*255\s*,\s*100\s*,\s*50\s*\)$/);
    expect(views[0].brightness).toBeCloseTo(128 / 255, 2);
  });

  it('clears glowColor when the light is off and never sets it for non-lights', () => {
    const off = computeMarkerViews([ent({ entity: 'light.x' })], { 'light.x': lightState(false) }, t, vp, null);
    expect(off[0].glowColor).toBeUndefined();
    const tv: HassEntity = { entity_id: 'media_player.tv', state: 'playing', attributes: {} };
    const views = computeMarkerViews([ent({ entity: 'media_player.tv', tap: 'more-info' })], { 'media_player.tv': tv }, t, vp, null);
    expect(views[0].glowColor).toBeUndefined();
    expect(views[0].brightness).toBe(0);
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
    label: 'Lamp',
    active: true,
    focused: true,
    brightness: 1,
    selectMode: false,
    selectable: false,
    selected: false,
    ...over,
  };
}

const noop = (): void => {};

describe('renderMarkerOverlay', () => {
  it('positions each marker with left/top and transform scale', () => {
    const host = document.createElement('div');
    const view = makeView({ left: 300, top: 250, iconScale: 1.2 });
    render(renderMarkerOverlay([view], noop, noop), host);

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
    render(renderMarkerOverlay([view], noop, noop), host);

    const haIcon = host.querySelector('ha-icon');
    expect(haIcon).toBeTruthy();
    expect(haIcon!.getAttribute('icon')).toBe('mdi:fan');
  });

  it('active markers get active class', () => {
    const host = document.createElement('div');
    render(renderMarkerOverlay([makeView({ active: true })], noop, noop), host);
    const marker = host.querySelector('.marker') as HTMLElement;
    expect(marker.classList.contains('active')).toBe(true);
  });

  it('unfocused markers have the dimmed class', () => {
    const host = document.createElement('div');
    render(renderMarkerOverlay([makeView({ focused: false })], noop, noop), host);
    const marker = host.querySelector('.marker') as HTMLElement;
    expect(marker.classList.contains('dimmed')).toBe(true);
  });

  it('focused markers do not have the dimmed class', () => {
    const host = document.createElement('div');
    render(renderMarkerOverlay([makeView({ focused: true })], noop, noop), host);
    const marker = host.querySelector('.marker') as HTMLElement;
    expect(marker.classList.contains('dimmed')).toBe(false);
  });

  it('fires onPointerDown with the event and view', () => {
    const host = document.createElement('div');
    const calls: Array<[PointerEvent, MarkerView]> = [];
    const view = makeView();
    render(renderMarkerOverlay([view], (e, m) => calls.push([e, m]), noop), host);

    const marker = host.querySelector('.marker') as HTMLElement;
    const evt = new PointerEvent('pointerdown');
    marker.dispatchEvent(evt);
    expect(calls).toHaveLength(1);
    expect(calls[0][1]).toBe(view);
  });
});

describe('renderMarkerOverlay accessibility', () => {
  it('labels the button with the human label (not the raw entity id) for title and aria-label', () => {
    const host = document.createElement('div');
    const view = makeView({ label: 'Kitchen ceiling', state: lightState(true) });
    render(renderMarkerOverlay([view], noop, noop), host);
    const marker = host.querySelector('.marker') as HTMLElement;
    expect(marker.getAttribute('title')).toBe('Kitchen ceiling');
    // aria-label includes the state for screen readers.
    expect(marker.getAttribute('aria-label')).toBe('Kitchen ceiling, on');
  });

  it('sets aria-pressed on toggle markers and omits it on non-toggle markers', () => {
    const host = document.createElement('div');
    render(
      renderMarkerOverlay(
        [
          makeView({ entity: ent({ entity: 'a', tap: 'toggle' }), active: true }),
          makeView({ entity: ent({ entity: 'b', tap: 'more-info' }), active: true }),
        ],
        noop,
        noop,
      ),
      host,
    );
    const markers = host.querySelectorAll('.marker');
    expect(markers[0].getAttribute('aria-pressed')).toBe('true');
    expect(markers[1].hasAttribute('aria-pressed')).toBe(false);
  });

  it('removes dimmed markers from the tab order and hides them from the a11y tree', () => {
    const host = document.createElement('div');
    render(
      renderMarkerOverlay(
        [makeView({ focused: true }), makeView({ focused: false })],
        noop,
        noop,
      ),
      host,
    );
    const markers = host.querySelectorAll('.marker');
    expect(markers[0].getAttribute('tabindex')).toBe('0');
    expect(markers[0].hasAttribute('aria-hidden')).toBe(false);
    expect(markers[1].getAttribute('tabindex')).toBe('-1');
    expect(markers[1].getAttribute('aria-hidden')).toBe('true');
  });

  it('keyboard activation (click with detail 0) calls onActivate; a pointer click (detail>0) does not', () => {
    const host = document.createElement('div');
    const activated: MarkerView[] = [];
    const view = makeView();
    render(renderMarkerOverlay([view], noop, (m) => activated.push(m)), host);
    const marker = host.querySelector('.marker') as HTMLElement;

    marker.dispatchEvent(new MouseEvent('click', { detail: 0 }));
    expect(activated).toHaveLength(1);
    expect(activated[0]).toBe(view);

    marker.dispatchEvent(new MouseEvent('click', { detail: 1 }));
    expect(activated).toHaveLength(1); // pointer click ignored here (gesture machinery owns it)
  });
});

describe('computeMarkerViews label', () => {
  it('prefers config name, then friendly_name, then the raw entity id', () => {
    const named = computeMarkerViews([ent({ entity: 'light.x', name: 'My Lamp' })], { 'light.x': lightState(true) }, t, vp, null);
    expect(named[0].label).toBe('My Lamp');

    const friendly: HassEntity = { entity_id: 'light.x', state: 'on', attributes: { friendly_name: 'Hallway' } };
    const fromFriendly = computeMarkerViews([ent({ entity: 'light.x' })], { 'light.x': friendly }, t, vp, null);
    expect(fromFriendly[0].label).toBe('Hallway'); // friendly_name wins over the raw id

    const fallback = computeMarkerViews([ent({ entity: 'light.raw' })], {}, t, vp, null);
    expect(fallback[0].label).toBe('light.raw');
  });
});
