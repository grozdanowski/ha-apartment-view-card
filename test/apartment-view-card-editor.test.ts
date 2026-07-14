// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import '../src/editor/apartment-view-card-editor';
import type { ApartmentViewConfig } from '../src/core/config';
import { rectangularSpatialPlan } from '../src/core/spatial-plan';

function baseConfig(): ApartmentViewConfig {
  return {
    type: 'custom:apartment-view-card',
    images: { base: '/local/day.png' },
    entities: [],
    zones: [],
    options: {
      view: 'auto',
      lightStyle: 'lit',
      hideWalls: false,
      freePanZoom: true,
      zoomMax: 1.5,
      duskDawnOffsetMinutes: 60,
      labels: { source: 'none', visibility: 'auto', densityCap: 14 },
      iconSize: 44,
      iconSizeMax: 88,
      aspectMobile: 1,
      interaction: { wheel: 'modifier', doubleTapZoom: true, roomSwipe: true, inertia: true },
      idleTimeout: 0,
      spatialLightingMode: 'realistic',
    },
    quickActions: [],
  };
}

async function mount() {
  const el = document.createElement('apartment-view-card-editor') as any;
  el.hass = { states: {}, localize: (k: string) => k };
  el.setConfig(baseConfig());
  el._mode = 'advanced';
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

describe('apartment-view-card-editor: images + options', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('setConfig preserves unknown keys', async () => {
    const el = document.createElement('apartment-view-card-editor') as any;
    el.hass = { states: {} };
    el.setConfig({ ...baseConfig(), _legacy: 'keep' });
    el._mode = 'advanced';
    expect(el.config._legacy).toBe('keep');
  });

  it('renders a text input + file upload per image field, and a separate options form', async () => {
    const el = await mount();
    // image fields use plain inputs (always render), not a lazy HA component
    expect(el.shadowRoot.querySelectorAll('.image-url').length).toBe(4);
    expect(el.shadowRoot.querySelectorAll('.image-upload-btn').length).toBe(4);
    expect(el.shadowRoot.querySelectorAll('input[type="file"]').length).toBe(4);
    const base = el.shadowRoot.querySelector('.image-base') as HTMLInputElement;
    expect(base.value).toBe('/local/day.png');
    // options live in their own ha-form (no image fields)
    const form = el.shadowRoot.querySelector('ha-form.options') as any;
    expect(form).toBeTruthy();
    expect(form.data.view).toBe('auto');
    expect(form.data.zoomMax).toBe(1.5);
    expect('base' in form.data).toBe(false);
  });

  it('typing/pasting a URL in an image field updates that image and fires config-changed', async () => {
    const el = await mount();
    let fired: ApartmentViewConfig | null = null;
    el.addEventListener('config-changed', (e: CustomEvent) => {
      fired = e.detail.config;
    });
    const base = el.shadowRoot.querySelector('.image-base') as HTMLInputElement;
    base.value = '/local/new.png';
    base.dispatchEvent(new Event('change', { bubbles: true }));
    expect(fired).not.toBeNull();
    expect(fired!.images.base).toBe('/local/new.png');
  });

  it('uploading a file POSTs to the image API and stores the serve URL', async () => {
    const el = document.createElement('apartment-view-card-editor') as any;
    let uploadedTo: string | null = null;
    el.hass = {
      states: {},
      localize: (k: string) => k,
      fetchWithAuth: async (path: string) => {
        uploadedTo = path;
        return { ok: true, status: 200, json: async () => ({ id: 'abc123' }) };
      },
    };
    el.setConfig(baseConfig());
    el._mode = 'advanced';
    document.body.appendChild(el);
    await el.updateComplete;
    let fired: any = null;
    el.addEventListener('config-changed', (e: CustomEvent) => (fired = e.detail.config));

    const row = (el.shadowRoot.querySelector('.image-base') as HTMLElement).closest('.image-row')!;
    const fileInput = row.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File([new Uint8Array([1, 2, 3])], 'floorplan.png', { type: 'image/png' });
    Object.defineProperty(fileInput, 'files', { value: [file], configurable: true });
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 20)); // let the async upload resolve

    expect(uploadedTo).toBe('/api/image/upload');
    expect(fired.images.base).toBe('/api/image/serve/abc123/original');
  });

  it('clearing an optional image removes that key', async () => {
    const el = document.createElement('apartment-view-card-editor') as any;
    el.hass = { states: {}, localize: (k: string) => k };
    el.setConfig({
      ...baseConfig(),
      images: { base: '/local/day.png', allLights: '/local/all.png' },
    });
    el._mode = 'advanced';
    document.body.appendChild(el);
    await el.updateComplete;
    let fired: any = null;
    el.addEventListener('config-changed', (e: CustomEvent) => (fired = e.detail.config));
    const row = (el.shadowRoot.querySelector('.image-allLights') as HTMLElement).closest('.image-row')!;
    (row.querySelector('.image-clear') as HTMLElement).click();
    expect('allLights' in fired.images).toBe(false);
    expect(fired.images.base).toBe('/local/day.png');
  });

  it('an options form value-changed re-nests into options and fires config-changed', async () => {
    const el = await mount();
    let fired: ApartmentViewConfig | null = null;
    el.addEventListener('config-changed', (e: CustomEvent) => {
      fired = e.detail.config;
    });
    const form = el.shadowRoot.querySelector('ha-form.options') as any;
    form.dispatchEvent(
      new CustomEvent('value-changed', {
        detail: {
          value: {
            view: 'night',
            lightStyle: 'glow',
            freePanZoom: false,
            zoomMax: 2,
            duskDawnOffsetMinutes: 45,
          },
        },
        bubbles: true,
        composed: true,
      })
    );
    expect(fired).not.toBeNull();
    expect(fired!.options.view).toBe('night');
    expect(fired!.options.freePanZoom).toBe(false);
    expect(fired!.options.zoomMax).toBe(2);
  });

  it('config-changed preserves entities, zones, images, and unknown keys', async () => {
    const el = document.createElement('apartment-view-card-editor') as any;
    el.hass = { states: {} };
    el.setConfig({
      ...baseConfig(),
      entities: [
        { entity: 'light.a', x: 1, y: 2, size: 'small', tap: 'toggle', orientation: null },
      ],
      _legacy: 'keep',
    });
    el._mode = 'advanced';
    document.body.appendChild(el);
    await el.updateComplete;
    let fired: any = null;
    el.addEventListener('config-changed', (e: CustomEvent) => (fired = e.detail.config));
    const form = el.shadowRoot.querySelector('ha-form.options') as any;
    form.dispatchEvent(
      new CustomEvent('value-changed', {
        detail: { value: { ...form.data, view: 'day' } },
        bubbles: true,
        composed: true,
      })
    );
    expect(fired.entities.length).toBe(1);
    expect(fired.images.base).toBe('/local/day.png');
    expect(fired._legacy).toBe('keep');
  });
});

describe('apartment-view-card-editor: entities', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  async function mountWithEntities() {
    const el = document.createElement('apartment-view-card-editor') as any;
    el.hass = { states: {}, localize: (k: string) => k };
    el.setConfig({
      type: 'custom:apartment-view-card',
      images: { base: '/local/day.png' },
      entities: [
        { entity: 'light.a', x: 10, y: 20, size: 'small', tap: 'toggle', orientation: null },
        { entity: 'light.b', x: 30, y: 40, size: 'small', tap: 'toggle', orientation: 90 },
      ],
      zones: [],
      options: {
        view: 'auto',
        lightStyle: 'lit',
        freePanZoom: true,
        zoomMax: 1.5,
        duskDawnOffsetMinutes: 60,
      },
    });
    el._mode = 'advanced';
    document.body.appendChild(el);
    await el.updateComplete;
    return el;
  }

  it('renders one entity row per configured entity', async () => {
    const el = await mountWithEntities();
    expect(el.shadowRoot.querySelectorAll('.entity-row').length).toBe(2);
  });

  it('Add entity appends a default entity and fires config-changed', async () => {
    const el = await mountWithEntities();
    let fired: any = null;
    el.addEventListener('config-changed', (e: CustomEvent) => (fired = e.detail.config));
    (el.shadowRoot.querySelector('.add-entity') as HTMLElement).click();
    expect(fired.entities.length).toBe(3);
    expect(fired.entities[2]).toMatchObject({
      entity: '',
      x: 50,
      y: 50,
      size: 'small',
      tap: 'toggle',
      orientation: null,
    });
  });

  it('Remove entity drops that index and fires config-changed', async () => {
    const el = await mountWithEntities();
    let fired: any = null;
    el.addEventListener('config-changed', (e: CustomEvent) => (fired = e.detail.config));
    const remove = el.shadowRoot.querySelectorAll('.remove-entity')[0] as HTMLElement;
    remove.click();
    expect(fired.entities.length).toBe(1);
    expect(fired.entities[0].entity).toBe('light.b');
  });

  /** Accordion: a row's ha-form renders only while expanded. Expand index i. */
  async function expand(el: any, i: number) {
    el._selectedEntity = i;
    await el.updateComplete;
    return el.shadowRoot.querySelector('ha-form.entity-form') as any;
  }

  it('entity forms collapse by default and expand one at a time (accordion)', async () => {
    const el = await mountWithEntities();
    // collapsed: rows present, no forms
    expect(el.shadowRoot.querySelectorAll('.entity-row').length).toBe(2);
    expect(el.shadowRoot.querySelectorAll('ha-form.entity-form').length).toBe(0);

    const headers = el.shadowRoot.querySelectorAll('.row-header');
    (headers[0] as HTMLElement).click();
    await el.updateComplete;
    expect(el.shadowRoot.querySelectorAll('ha-form.entity-form').length).toBe(1);
    expect((el.shadowRoot.querySelectorAll('.row-header')[0] as HTMLElement).getAttribute('aria-expanded')).toBe('true');

    // expanding another collapses the first (single _selectedEntity)
    (el.shadowRoot.querySelectorAll('.row-header')[1] as HTMLElement).click();
    await el.updateComplete;
    const forms = el.shadowRoot.querySelectorAll('ha-form.entity-form');
    expect(forms.length).toBe(1);
    expect((forms[0] as any).data.entity).toBe('light.b');

    // clicking the open header again collapses it
    (el.shadowRoot.querySelectorAll('.row-header')[1] as HTMLElement).click();
    await el.updateComplete;
    expect(el.shadowRoot.querySelectorAll('ha-form.entity-form').length).toBe(0);
  });

  it('the per-entity form schema includes orientation only when directional', async () => {
    const el = await mountWithEntities();
    const formA = await expand(el, 0);
    const namesA = formA.schema.map((s: any) => s.name);
    expect(namesA.includes('orientation')).toBe(false); // light.a orientation null
    // entity selector NOT domain-limited
    expect(formA.schema.find((s: any) => s.name === 'entity').selector.entity).toEqual({});

    const formB = await expand(el, 1);
    const namesB = formB.schema.map((s: any) => s.name);
    expect(namesB.includes('orientation')).toBe(true); // light.b orientation 90
  });

  it('turning the directional toggle on writes orientation 0 (nullable->0)', async () => {
    const el = await mountWithEntities();
    let fired: any = null;
    el.addEventListener('config-changed', (e: CustomEvent) => (fired = e.detail.config));
    const form = await expand(el, 0);
    form.dispatchEvent(
      new CustomEvent('value-changed', {
        detail: { value: { ...form.data, directional: true } },
        bubbles: true,
        composed: true,
      })
    );
    expect(fired.entities[0].orientation).toBe(0);
  });

  it('turning the directional toggle off restores orientation null', async () => {
    const el = await mountWithEntities();
    let fired: any = null;
    el.addEventListener('config-changed', (e: CustomEvent) => (fired = e.detail.config));
    const form = await expand(el, 1);
    form.dispatchEvent(
      new CustomEvent('value-changed', {
        detail: { value: { ...form.data, directional: false } },
        bubbles: true,
        composed: true,
      })
    );
    expect(fired.entities[1].orientation).toBeNull();
  });

  it('preview-entity-moved updates the moved entity x/y and fires config-changed', async () => {
    const el = await mountWithEntities();
    let fired: any = null;
    el.addEventListener('config-changed', (e: CustomEvent) => (fired = e.detail.config));
    const preview = el.shadowRoot.querySelector('preview-canvas') as HTMLElement;
    preview.dispatchEvent(
      new CustomEvent('preview-entity-moved', {
        detail: { index: 0, x: 66, y: 77 },
        bubbles: true,
        composed: true,
      })
    );
    expect(fired.entities[0].x).toBe(66);
    expect(fired.entities[0].y).toBe(77);
  });

  it('preview-entity-selected sets the selected index on the preview', async () => {
    const el = await mountWithEntities();
    const preview = el.shadowRoot.querySelector('preview-canvas') as any;
    preview.dispatchEvent(
      new CustomEvent('preview-entity-selected', {
        detail: { index: 1 },
        bubbles: true,
        composed: true,
      })
    );
    await el.updateComplete;
    expect((el.shadowRoot.querySelector('preview-canvas') as any).selectedEntity).toBe(1);
  });
});

describe('apartment-view-card-editor: zones', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  async function mountWithZones() {
    const el = document.createElement('apartment-view-card-editor') as any;
    el.hass = { states: {}, localize: (k: string) => k };
    el.setConfig({
      type: 'custom:apartment-view-card',
      images: { base: '/local/day.png' },
      entities: [],
      zones: [
        { name: 'Living', x: 5, y: 5, width: 40, height: 40 },
        { name: 'Kitchen', x: 50, y: 5, width: 30, height: 30 },
      ],
      options: {
        view: 'auto',
        lightStyle: 'lit',
        freePanZoom: true,
        zoomMax: 1.5,
        duskDawnOffsetMinutes: 60,
      },
    });
    el._mode = 'advanced';
    document.body.appendChild(el);
    await el.updateComplete;
    return el;
  }

  it('renders one zone row per configured zone with a zone-form each', async () => {
    const el = await mountWithZones();
    expect(el.shadowRoot.querySelectorAll('.zone-row').length).toBe(2);
    expect(el.shadowRoot.querySelectorAll('ha-form.zone-form').length).toBe(2);
  });

  it('Add zone puts the preview into crosshair draw mode', async () => {
    const el = await mountWithZones();
    (el.shadowRoot.querySelector('.add-zone') as HTMLElement).click();
    await el.updateComplete;
    expect((el.shadowRoot.querySelector('preview-canvas') as any).drawingZone).toBe(true);
  });

  it('preview-zone-drawn appends a zone, exits draw mode, fires config-changed', async () => {
    const el = await mountWithZones();
    (el.shadowRoot.querySelector('.add-zone') as HTMLElement).click();
    await el.updateComplete;
    let fired: any = null;
    el.addEventListener('config-changed', (e: CustomEvent) => (fired = e.detail.config));
    const preview = el.shadowRoot.querySelector('preview-canvas') as HTMLElement;
    preview.dispatchEvent(
      new CustomEvent('preview-zone-drawn', {
        detail: { x: 12, y: 15, width: 22, height: 18 },
        bubbles: true,
        composed: true,
      })
    );
    await el.updateComplete;
    expect(fired.zones.length).toBe(3);
    expect(fired.zones[2]).toMatchObject({ x: 12, y: 15, width: 22, height: 18 });
    expect((el.shadowRoot.querySelector('preview-canvas') as any).drawingZone).toBe(false);
  });

  it('preview-zone-draw-cancelled just exits draw mode (no new zone)', async () => {
    const el = await mountWithZones();
    (el.shadowRoot.querySelector('.add-zone') as HTMLElement).click();
    await el.updateComplete;
    let fired: any = null;
    el.addEventListener('config-changed', (e: CustomEvent) => (fired = e.detail.config));
    const preview = el.shadowRoot.querySelector('preview-canvas') as HTMLElement;
    preview.dispatchEvent(
      new CustomEvent('preview-zone-draw-cancelled', {
        detail: {},
        bubbles: true,
        composed: true,
      })
    );
    await el.updateComplete;
    expect(fired).toBeNull();
    expect((el.shadowRoot.querySelector('preview-canvas') as any).drawingZone).toBe(false);
  });

  it('Remove zone drops that index and fires config-changed', async () => {
    const el = await mountWithZones();
    let fired: any = null;
    el.addEventListener('config-changed', (e: CustomEvent) => (fired = e.detail.config));
    (el.shadowRoot.querySelectorAll('.remove-zone')[0] as HTMLElement).click();
    expect(fired.zones.length).toBe(1);
    expect(fired.zones[0].name).toBe('Kitchen');
  });

  it('editing a zone form re-nests x/y/w/h and fires config-changed', async () => {
    const el = await mountWithZones();
    let fired: any = null;
    el.addEventListener('config-changed', (e: CustomEvent) => (fired = e.detail.config));
    const form = el.shadowRoot.querySelectorAll('ha-form.zone-form')[0] as any;
    form.dispatchEvent(
      new CustomEvent('value-changed', {
        detail: { value: { ...form.data, name: 'Lounge', width: 55 } },
        bubbles: true,
        composed: true,
      })
    );
    expect(fired.zones[0].name).toBe('Lounge');
    expect(fired.zones[0].width).toBe(55);
  });

  it('move-down reorders zones', async () => {
    const el = await mountWithZones();
    let fired: any = null;
    el.addEventListener('config-changed', (e: CustomEvent) => (fired = e.detail.config));
    (el.shadowRoot.querySelectorAll('.zone-down')[0] as HTMLElement).click();
    expect(fired.zones.map((z: any) => z.name)).toEqual(['Kitchen', 'Living']);
  });

  it('links a room to an Area independently of its display name', async () => {
    const el = await mountWithZones();
    el.hass = {
      states: {},
      localize: (k: string) => k,
      areas: { living_room: { area_id: 'living_room', name: 'Living Area' } },
    };
    await el.updateComplete;
    const select = el.shadowRoot.querySelector('.zone-area-link') as HTMLSelectElement;
    select.value = 'living_room';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(el.config.zones[0].areaId).toBe('living_room');
    expect(el.config.zones[0].name).toBe('Living Area');
  });
});

describe('apartment-view-card-editor: tabs + import + search', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  async function mountEd(entities: any[] = []) {
    const el = document.createElement('apartment-view-card-editor') as any;
    el.hass = { states: {}, localize: (k: string) => k };
    el.setConfig({ ...baseConfig(), entities });
    el._mode = 'advanced';
    document.body.appendChild(el);
    await el.updateComplete;
    return el;
  }

  it('renders 5 tabs; switching changes the active pane', async () => {
    const el = await mountEd();
    const tabs = Array.from(el.shadowRoot.querySelectorAll('.tab')) as HTMLElement[];
    expect(tabs.length).toBe(5); // + Quick actions (rc.2)
    expect(el.shadowRoot.querySelector('.tab-devices.active')).toBeTruthy();
    (tabs.find((t) => /zones/i.test(t.textContent || '')) as HTMLElement).click();
    await el.updateComplete;
    expect(el.shadowRoot.querySelector('.tab-zones.active')).toBeTruthy();
    expect(el.shadowRoot.querySelector('.tab-devices.active')).toBeNull();
  });

  it("Import-from-Area appends the area's sensible, unplaced entities", async () => {
    const el = await mountEd([{ entity: 'light.placed', x: 1, y: 2, size: 'small', tap: 'toggle', orientation: null }]);
    el.hass = {
      states: {}, localize: (k: string) => k,
      areas: { kitchen: { area_id: 'kitchen', name: 'Kitchen' } },
      devices: { dev1: { area_id: 'kitchen' } },
      entities: {
        'light.ceiling': { entity_id: 'light.ceiling', area_id: 'kitchen' },
        'switch.kettle': { entity_id: 'switch.kettle', device_id: 'dev1' },
        'light.placed': { entity_id: 'light.placed', area_id: 'kitchen' },
        'automation.x': { entity_id: 'automation.x', area_id: 'kitchen' },
        'light.other': { entity_id: 'light.other', area_id: 'bedroom' },
        'light.hidden': { entity_id: 'light.hidden', area_id: 'kitchen', hidden: true },
      },
    };
    await el.updateComplete;
    let fired: any = null;
    el.addEventListener('config-changed', (e: CustomEvent) => (fired = e.detail.config));
    el._addEntitiesFromArea('kitchen');
    const added = fired.entities.map((e: any) => e.entity);
    expect(added).toContain('light.ceiling');
    expect(added).toContain('switch.kettle'); // area via its device
    expect(added).not.toContain('automation.x'); // not a sensible domain
    expect(added).not.toContain('light.other'); // different area
    expect(added).not.toContain('light.hidden'); // hidden
    expect(added.filter((id: string) => id === 'light.placed').length).toBe(1); // not re-added
  });

  it('search box (shown at >5 entities) filters rows by id/name', async () => {
    const ents = Array.from({ length: 7 }, (_, i) => ({ entity: `light.lamp_${i}`, x: 1, y: 1, size: 'small', tap: 'toggle', orientation: null }));
    ents[0].entity = 'light.kitchen_special';
    const el = await mountEd(ents);
    expect(el.shadowRoot.querySelector('.entity-search')).toBeTruthy();
    el._entitySearch = 'special';
    await el.updateComplete;
    expect(el.shadowRoot.querySelectorAll('.entity-row').length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Quick actions tab (rc.2 field feedback #4)
// ---------------------------------------------------------------------------

describe('apartment-view-card-editor: quick actions', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  async function mountActions(quickActions: any[] = []) {
    const el = document.createElement('apartment-view-card-editor') as any;
    el.hass = { states: {}, localize: (k: string) => k };
    el.setConfig({ ...baseConfig(), quickActions });
    el._mode = 'advanced';
    document.body.appendChild(el);
    await el.updateComplete;
    (Array.from(el.shadowRoot.querySelectorAll('.tab')) as HTMLElement[])
      .find((t) => /quick actions/i.test(t.textContent || ''))!.click();
    await el.updateComplete;
    return el;
  }

  it('renders existing quick actions as editable rows', async () => {
    const el = await mountActions([{ name: 'Movie', icon: 'mdi:movie', entity: 'scene.movie' }]);
    const rows = el.shadowRoot.querySelectorAll('.action-row');
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain('Movie');
  });

  it('Add quick action creates a DRAFT row that survives normalize round-trips', async () => {
    const el = await mountActions();
    let fired: any = null;
    el.addEventListener('config-changed', (e: CustomEvent) => (fired = e.detail.config));
    (el.shadowRoot.querySelector('.add-action') as HTMLElement).click();
    await el.updateComplete;
    // The half-filled row renders (draft)…
    expect(el.shadowRoot.querySelectorAll('.action-row').length).toBe(1);
    // …but is NOT committed to the card config (no target yet).
    expect(fired.quickActions).toEqual([]);
  });

  it('filling in an entity commits the action to the config', async () => {
    const el = await mountActions();
    (el.shadowRoot.querySelector('.add-action') as HTMLElement).click();
    await el.updateComplete;
    let fired: any = null;
    el.addEventListener('config-changed', (e: CustomEvent) => (fired = e.detail.config));
    const form = el.shadowRoot.querySelector('.action-form') as any;
    form.dispatchEvent(new CustomEvent('value-changed', {
      detail: { value: { name: 'Dobro jutro', icon: 'mdi:weather-sunset-up', entity: 'scene.home_morning' } },
      bubbles: true, composed: true,
    }));
    await el.updateComplete;
    expect(fired.quickActions).toEqual([
      { name: 'Dobro jutro', icon: 'mdi:weather-sunset-up', entity: 'scene.home_morning' },
    ]);
  });

  it('remove + reorder work on the draft list', async () => {
    const el = await mountActions([
      { name: 'A', entity: 'scene.a' },
      { name: 'B', entity: 'scene.b' },
    ]);
    let fired: any = null;
    el.addEventListener('config-changed', (e: CustomEvent) => (fired = e.detail.config));
    (el.shadowRoot.querySelectorAll('.action-down')[0] as HTMLElement).click();
    expect(fired.quickActions.map((a: any) => a.name)).toEqual(['B', 'A']);
    (el.shadowRoot.querySelectorAll('.remove-action')[0] as HTMLElement).click();
    await el.updateComplete;
    expect(fired.quickActions.map((a: any) => a.name)).toEqual(['A']);
  });
});

describe('apartment-view-card-editor: setup studio', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  async function mountStudio(config = baseConfig()) {
    const el = document.createElement('apartment-view-card-editor') as any;
    el.hass = { states: {}, localize: (k: string) => k };
    el.setConfig(config);
    document.body.appendChild(el);
    await el.updateComplete;
    return el;
  }

  it('opens in the room-first setup studio and keeps advanced controls one tap away', async () => {
    const el = await mountStudio();
    expect(el.shadowRoot.querySelector('.setup-steps')).toBeTruthy();
    expect(el.shadowRoot.querySelector('.tab-devices')).toBeNull();
    const advanced = Array.from(el.shadowRoot.querySelectorAll('.mode-switch button'))
      .find((button: any) => button.textContent?.includes('Advanced')) as HTMLElement;
    advanced.click();
    await el.updateComplete;
    expect(el.shadowRoot.querySelector('.tab-devices')).toBeTruthy();
  });

  it('offers plan authoring and a generated 3D home preview', async () => {
    const el = await mountStudio();
    const labels = Array.from(el.shadowRoot.querySelectorAll('.preview-switch button'))
      .map((button: any) => button.textContent?.trim());
    expect(labels).toEqual(['Plan', '3D home']);
    (el.shadowRoot.querySelectorAll('.preview-switch button')[1] as HTMLElement).click();
    await el.updateComplete;
    expect(el.shadowRoot.querySelector('spatial-preview')).toBeTruthy();
  });

  it('keeps room selection state inside the setup 3D preview', async () => {
    const el = await mountStudio();
    (el.shadowRoot.querySelectorAll('.preview-switch button')[1] as HTMLElement).click();
    await el.updateComplete;
    const preview = el.shadowRoot.querySelector('spatial-preview') as any;
    preview._focusZone('living');
    await el.updateComplete;
    await preview.updateComplete;
    expect(preview.focusedZoneId).toBe('living');
  });

  it('presents imported geometry as editable architecture', async () => {
    const el = await mountStudio({
      ...baseConfig(),
      type: 'custom:apartment-view-card',
      zones: [{ id: 'living', name: 'Living Room', x: 0, y: 0, width: 100, height: 100 }],
      spatial: {
        openings: [], walls: [], site: { north: 0 }, dimensions: { width: 6, aspectRatio: 1.5, wallHeight: 2.6 },
        plan: { version: 1, vertices: [], walls: [], rooms: [], objects: [] },
        shell: {
          outer: [[0, 0], [6, 0], [6, 4], [0, 4]], holes: [], floor: [[0, 0], [6, 0], [6, 4], [0, 4]],
          rooms: [{ zoneId: 'living', floor: [[0, 0], [6, 0], [6, 4], [0, 4]] }],
          walls: [{ id: 'wall', points: [[0, 0], [6, 0], [6, 4]], thickness: 0.18 }],
          openings: [{ id: 'door', kind: 'door', x: 3, z: 0, width: 0.9, depth: 0.18, rotation: 0, bottom: 0, height: 2.1 }],
        },
      },
    });
    expect(el.shadowRoot.textContent).toContain('2 wall segments, 1 room, and 0 placed objects');
    const planEditor = el.shadowRoot.querySelector('spatial-plan-editor') as any;
    await planEditor.updateComplete;
    expect(planEditor.shadowRoot.querySelectorAll('.survey-wall')).toHaveLength(2);
    expect(planEditor.shadowRoot.textContent).toContain('Select a wall to add an opening');
    el._setupStep = 'architecture';
    await el.updateComplete;
    expect(el.shadowRoot.textContent).toContain('1 opening in the imported plan');
    expect(el.shadowRoot.textContent).toContain('0.90 × 2.10 m');
    const opening = el.shadowRoot.querySelector('.opening-row') as HTMLButtonElement;
    opening.click();
    await el.updateComplete;
    expect(el.shadowRoot.querySelector('#shell-opening-position')).toBeTruthy();
    expect(el.shadowRoot.querySelector('#shell-opening-width')).toBeTruthy();
  });

  it('edits and selects imported rooms instead of rendering them read-only', async () => {
    const el = await mountStudio({
      ...baseConfig(),
      zones: [{ id: 'living', name: 'Living Room', x: 0, y: 0, width: 100, height: 100 }],
      spatial: {
        openings: [], walls: [], site: { north: 0 }, dimensions: { width: 6, aspectRatio: 1.5, wallHeight: 2.6 },
        shell: {
          outer: [[0, 0], [6, 0], [6, 4], [0, 4]], holes: [], floor: [[0, 0], [6, 0], [6, 4], [0, 4]],
          rooms: [{ zoneId: 'living', floor: [[0, 0], [6, 0], [6, 4], [0, 4]] }],
          openings: [],
        },
      },
    });
    el.hass = {
      states: {}, localize: (key: string) => key,
      areas: { lounge: { area_id: 'lounge', name: 'Lounge Area' } }, entities: {}, devices: {},
    };
    el._setupStep = 'rooms';
    await el.updateComplete;
    expect(el._selectedRoomId).toBe('survey:living');
    expect(el.shadowRoot.querySelector('.room-mapping.selected')).toBeTruthy();
    const name = el.shadowRoot.querySelector('.room-fields input') as HTMLInputElement;
    name.value = 'Lounge';
    name.dispatchEvent(new Event('change', { bubbles: true }));
    expect(el.config.zones[0].name).toBe('Lounge');
    const area = el.shadowRoot.querySelector('.room-fields select') as HTMLSelectElement;
    area.value = 'lounge';
    area.dispatchEvent(new Event('change', { bubbles: true }));
    expect(el.config.zones[0].areaId).toBe('lounge');

    el._setupStep = 'floorplan';
    await el.updateComplete;
    const planEditor = el.shadowRoot.querySelector('spatial-plan-editor') as HTMLElement;
    planEditor.dispatchEvent(new CustomEvent('spatial-room-selected', {
      detail: { roomId: 'survey:living' }, bubbles: true, composed: true,
    }));
    await el.updateComplete;
    expect(el._setupStep).toBe('rooms');
    expect(el._selectedRoomId).toBe('survey:living');
  });

  it('undoes and redoes editor changes', async () => {
    const el = await mountStudio();
    el._onImageChanged('base', '/local/changed.png');
    await el.updateComplete;
    expect(el.config.images.base).toBe('/local/changed.png');
    (el.shadowRoot.querySelector('.undo') as HTMLElement).click();
    await el.updateComplete;
    expect(el.config.images.base).toBe('/local/day.png');
    (el.shadowRoot.querySelector('.redo') as HTMLElement).click();
    expect(el.config.images.base).toBe('/local/changed.png');
  });

  it('adds and adjusts an opening after selecting a wall', async () => {
    const el = await mountStudio({
      ...baseConfig(),
      zones: [{ id: 'living', name: 'Living Room', x: 10, y: 10, width: 70, height: 60 }],
      spatial: {
        plan: rectangularSpatialPlan(8, 6),
        openings: [], walls: [], site: { north: 0 }, dimensions: { width: 8, aspectRatio: 4 / 3, wallHeight: 2.6 },
      },
    });
    el._setupStep = 'architecture';
    await el.updateComplete;
    const preview = el.shadowRoot.querySelector('spatial-plan-editor') as HTMLElement;
    preview.dispatchEvent(new CustomEvent('spatial-wall-selected', {
      detail: { wallId: 'wall-1' }, bubbles: true, composed: true,
    }));
    await el.updateComplete;
    const addDoor = Array.from(el.shadowRoot.querySelectorAll('.setup-card ha-button'))
      .find((button: any) => button.textContent?.includes('Add door')) as HTMLElement;
    addDoor.click();
    await el.updateComplete;
    expect(el.config.spatial.openings[0]).toMatchObject({ kind: 'door', wallId: 'wall-1', position: 0.5, widthMeters: 0.9, height: 2.1 });
    const size = el.shadowRoot.querySelector('#opening-size') as HTMLInputElement;
    size.value = '1.15';
    size.dispatchEvent(new Event('change', { bubbles: true }));
    expect(el.config.spatial.openings[0].widthMeters).toBe(1.15);
    const curve = el.shadowRoot.querySelector('#wall-curve') as HTMLInputElement;
    curve.value = '-42';
    curve.dispatchEvent(new Event('input', { bubbles: true }));
    expect(el.config.spatial.plan.walls[0].curve).toBe(-0.42);
    const north = el.shadowRoot.querySelector('#north-bearing') as HTMLInputElement;
    north.value = '32';
    north.dispatchEvent(new Event('input', { bubbles: true }));
    expect(el.config.spatial.site.north).toBe(32);
  });

  it('maps an enclosed spatial room to a Home Assistant Area', async () => {
    const el = await mountStudio();
    el.hass = {
      states: {}, localize: (k: string) => k,
      areas: { living: { area_id: 'living', name: 'Living Room' } },
      entities: {}, devices: {},
    };
    el._commitSpatial({ ...el._spatial(), plan: rectangularSpatialPlan(8, 6) });
    el._setupStep = 'rooms';
    await el.updateComplete;
    expect(el.shadowRoot.textContent).toContain('1 enclosed space was found');
    const select = el.shadowRoot.querySelector('.room-fields select') as HTMLSelectElement;
    select.value = 'living';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(el.config.zones[0].name).toBe('Living Room');
    expect(el.config.zones[0].areaId).toBe('living');
    expect(el.config.spatial.plan.rooms[0].zoneId).toBe(el.config.zones[0].id);
  });

  it('imports an area into its matching room rather than a generic grid', async () => {
    const config = {
      ...baseConfig(),
      zones: [{ name: 'Kitchen', x: 20, y: 30, width: 40, height: 20 }],
    };
    const el = await mountStudio(config);
    el.hass = {
      states: {}, localize: (k: string) => k,
      areas: { kitchen: { area_id: 'kitchen', name: 'Kitchen' } },
      entities: {
        'light.kitchen_one': { entity_id: 'light.kitchen_one', area_id: 'kitchen' },
        'light.kitchen_two': { entity_id: 'light.kitchen_two', area_id: 'kitchen' },
      },
      devices: {},
    };
    el._addEntitiesFromArea('kitchen');
    expect(el.config.entities).toHaveLength(2);
    for (const entity of el.config.entities) {
      expect(entity.x).toBeGreaterThan(20);
      expect(entity.x).toBeLessThan(60);
      expect(entity.y).toBeGreaterThan(30);
      expect(entity.y).toBeLessThan(50);
    }
  });

  it('flags unplaced devices and overlapping rooms in the setup review', async () => {
    const el = await mountStudio({
      ...baseConfig(),
      entities: [{ entity: 'light.unplaced', x: 90, y: 90, size: 'small', tap: 'toggle', orientation: null }],
      zones: [
        { name: 'Living Room', x: 0, y: 0, width: 50, height: 50 },
        { name: 'Kitchen', x: 40, y: 40, width: 40, height: 40 },
      ],
    });
    el._setupStep = 'review';
    await el.updateComplete;
    expect(el.shadowRoot.textContent).toContain('1 device needs a room');
    expect(el.shadowRoot.textContent).toContain('1 overlapping room boundary found');
  });
});
