// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '../src/apartment-view-card';
import { rectangularSpatialPlan } from '../src/core/spatial-plan';

function config() {
  const plan = rectangularSpatialPlan(8, 6);
  plan.rooms[0] = { ...plan.rooms[0], zoneId: 'living' };
  return {
    type: 'custom:apartment-view-card',
    zones: [{ id: 'living', name: 'Living Room', x: 0, y: 0, width: 100, height: 100 }],
    entities: [{
      entity: 'light.living', name: 'Living light', x: 50, y: 50, size: 'medium', tap: 'more-info', orientation: null, zoneId: 'living',
      spatial: { position: { x: 4, y: 2.4, z: 3 }, rotation: { x: 0, y: 0, z: 0 }, mount: 'ceiling', visible: true },
    }],
    spatial: { plan },
    experience: {
      intro: { title: 'Hello, {{ user }}.', subtitle: '**Everything is calm.**\n\nChoose a room.' },
      mobile: { expandedHeight: 510, compactHeight: 220, bottomInset: 112 },
      fixedPosition: { mobile: true, desktop: true },
      landscape: { spatialRatio: 0.48 },
      motion: { resetSeconds: 10, transitionMs: 880, orbitSeconds: 120 },
      quality: 'balanced',
    },
    content: {
      overview: [
        { type: 'heading', title: 'Home' },
        { type: 'lovelace-card', card: { type: 'markdown', content: 'Ready' } },
      ],
      rooms: { living: [{ type: 'spatial-controls', entities: ['light.living'] }] },
    },
  };
}

describe('immersive spatial shell', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    if (!customElements.get('ha-card')) customElements.define('ha-card', class extends HTMLElement {});
  });

  async function mount() {
    const card = document.createElement('apartment-view-card') as any;
    card.hass = {
      user: { id: 'matej', name: 'Matej' },
      states: { 'light.living': { entity_id: 'light.living', state: 'off', attributes: {} } },
      callService: vi.fn(async () => undefined),
    };
    card.setConfig(config());
    document.body.append(card);
    await card.updateComplete;
    return card;
  }

  it('renders the templated intro, viewport shell, and configured content', async () => {
    const card = await mount();
    expect(card.shadowRoot.querySelector('.immersive-card')).toBeTruthy();
    expect(card.shadowRoot.querySelector('h1')?.textContent).toBe('Hello, Matej.');
    expect(card.shadowRoot.querySelector('.immersive-intro-copy')?.textContent).toContain('Everything is calm.');
    const content = card.shadowRoot.querySelector('av-immersive-content') as HTMLElement;
    expect(content.shadowRoot?.querySelector('av-lovelace-card-host')).toBeTruthy();
    expect((card.shadowRoot.querySelector('spatial-preview') as any).fill).toBe(true);
    expect((card.shadowRoot.querySelector('spatial-preview') as any).cameraTransitionMs).toBe(880);
  });

  it('moves into a room and exposes one canvas-level Back control', async () => {
    const card = await mount();
    (card.shadowRoot.querySelector('.immersive-room-nav button') as HTMLButtonElement).click();
    await card.updateComplete;
    expect((card.shadowRoot.querySelector('spatial-preview') as any).focusedZoneId).toBe('living');
    expect(card.shadowRoot.querySelectorAll('.immersive-back')).toHaveLength(1);
    expect(card.shadowRoot.querySelector('av-immersive-content')?.blocks[0].type).toBe('spatial-controls');
    (card.shadowRoot.querySelector('.immersive-back') as HTMLButtonElement).click();
    await card.updateComplete;
    expect((card.shadowRoot.querySelector('spatial-preview') as any).focusedZoneId).toBeNull();
  });

  it('compacts the mobile spatial stage after the intro scrolls away', async () => {
    const card = await mount();
    const shell = card.shadowRoot.querySelector('.immersive-shell') as HTMLElement;
    const intro = card.shadowRoot.querySelector('.immersive-intro') as HTMLElement;
    Object.defineProperty(intro, 'offsetHeight', { configurable: true, value: 180 });
    shell.scrollTop = 200;
    shell.dispatchEvent(new Event('scroll'));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await card.updateComplete;
    expect(card.shadowRoot.querySelector('.immersive-spatial-cluster')?.classList.contains('compact')).toBe(true);
  });

  it('keeps the compact spatial stage when changing rooms after scrolling', async () => {
    const card = await mount();
    const shell = card.shadowRoot.querySelector('.immersive-shell') as HTMLElement;
    const intro = card.shadowRoot.querySelector('.immersive-intro') as HTMLElement;
    Object.defineProperty(intro, 'offsetHeight', { configurable: true, value: 180 });
    shell.scrollTop = 200;
    shell.dispatchEvent(new Event('scroll'));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await card.updateComplete;
    expect(card._immersiveCompact).toBe(true);

    (card.shadowRoot.querySelector('.immersive-room-nav button') as HTMLButtonElement).click();
    await card.updateComplete;
    expect(card._immersiveCompact).toBe(true);
  });

  it('falls back into dashboard flow while Lovelace edit mode is active', async () => {
    const card = await mount();
    document.body.classList.add('edit-mode');
    (card as any)._syncDashboardEditing();
    await card.updateComplete;
    expect((card as any)._dashboardEditing).toBe(true);
    expect(card.shadowRoot.querySelector('.immersive-card')?.classList.contains('in-flow')).toBe(true);
    document.body.classList.remove('edit-mode');
    (card as any)._syncDashboardEditing();
  });

  it('forwards unrelated HA state ticks to immersive children without rebuilding the host', async () => {
    const card = await mount();
    const content = card.shadowRoot.querySelector('av-immersive-content') as any;
    const nextHass = {
      ...card.hass,
      states: { ...card.hass.states, 'sensor.unlisted': { entity_id: 'sensor.unlisted', state: 'new', attributes: {} } },
    };
    card.hass = nextHass;
    expect(content.hass).toBe(nextHass);
    expect((card.shadowRoot.querySelector('spatial-preview') as any).hass).toBe(nextHass);
  });

  it('keeps room selection while camera and legacy idle resets run, and exits it with Escape', async () => {
    vi.useFakeTimers();
    const card = await mount();
    card.config.options.idleTimeout = 0.01;
    (card.shadowRoot.querySelector('.immersive-room-nav button') as HTMLButtonElement).click();
    await card.updateComplete;
    card._scheduleIdleReset();
    vi.advanceTimersByTime(20);
    expect(card._spatialFocusedZoneId).toBe('living');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await card.updateComplete;
    expect(card._spatialFocusedZoneId).toBeNull();
    vi.useRealTimers();
  });

  it('evaluates composed and user Lovelace conditions', async () => {
    const content = document.createElement('av-immersive-content') as any;
    content.hass = {
      user: { id: 'matej', name: 'Matej' },
      states: { 'light.living': { entity_id: 'light.living', state: 'on', attributes: {} } },
    };
    content.blocks = [{
      type: 'condition',
      conditions: [{
        condition: 'and',
        conditions: [
          { condition: 'state', entity: 'light.living', state: 'on' },
          { condition: 'user', users: ['matej'] },
        ],
      }],
      blocks: [{ type: 'heading', title: 'Visible context' }],
    }];
    document.body.append(content);
    await content.updateComplete;
    expect(content.shadowRoot.querySelector('h2')?.textContent).toBe('Visible context');
  });

  it('keeps spatial floor navigation reachable and clears room focus when switching', async () => {
    const card = document.createElement('apartment-view-card') as any;
    card.hass = { states: {}, callService: vi.fn(async () => undefined) };
    const first = config();
    const secondPlan = rectangularSpatialPlan(6, 4);
    secondPlan.rooms[0] = { ...secondPlan.rooms[0], zoneId: 'upper' };
    card.setConfig({
      ...first,
      floors: [
        { name: 'Lower', zones: first.zones, entities: first.entities, spatial: first.spatial },
        { name: 'Upper', zones: [{ id: 'upper', name: 'Upper Room', x: 0, y: 0, width: 100, height: 100 }], entities: [], spatial: { plan: secondPlan } },
      ],
    });
    document.body.append(card);
    await card.updateComplete;
    (card.shadowRoot.querySelector('.immersive-room-nav button') as HTMLButtonElement).click();
    await card.updateComplete;
    const select = card.shadowRoot.querySelector('.immersive-floor-select select') as HTMLSelectElement;
    select.value = '1';
    select.dispatchEvent(new Event('change'));
    await card.updateComplete;
    expect(card._floor).toBe(1);
    expect(card._spatialFocusedZoneId).toBeNull();
    expect(card.shadowRoot.querySelector('.immersive-room-nav')?.textContent).toContain('Upper Room');
  });
});
