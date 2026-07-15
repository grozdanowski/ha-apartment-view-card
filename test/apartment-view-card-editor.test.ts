// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import '../src/editor/apartment-view-card-editor';
import type { ApartmentViewConfig } from '../src/core/config';
import { addSpatialElement, rectangularSpatialPlan } from '../src/core/spatial-plan';

function config(): ApartmentViewConfig {
  const plan = rectangularSpatialPlan(8, 6);
  plan.rooms[0] = { ...plan.rooms[0], zoneId: 'living' };
  return {
    modelVersion: 7,
    type: 'custom:apartment-view-card',
    images: { base: '' },
    zones: [{ id: 'living', name: 'Living Room', areaId: 'living_room', x: 0, y: 0, width: 100, height: 100 }],
    entities: [{
      entity: 'light.pendant', name: 'Pendant', zoneId: 'living', x: 50, y: 50, size: 'medium', tap: 'toggle', orientation: null,
      spatial: { position: { x: 4, y: 2.4, z: 3 }, rotation: { x: 0, y: 0, z: 0 }, mount: 'ceiling', parentId: 'living', visible: true },
    }],
    options: {
      view: 'auto', lightStyle: 'lit', hideWalls: false, freePanZoom: true, zoomMax: 1.5,
      duskDawnOffsetMinutes: 60, labels: { source: 'none', visibility: 'auto', densityCap: 14 },
      iconSize: 44, iconSizeMax: 88, aspectMobile: 0.8,
      interaction: { wheel: 'modifier', doubleTapZoom: true, roomSwipe: true, inertia: true },
      idleTimeout: 0, spatialLightingMode: 'realistic',
    },
    quickActions: [],
    spatial: {
      plan, openings: [], walls: [], site: { north: 0 }, dimensions: { width: 8, aspectRatio: 4 / 3, wallHeight: 2.6 },
    },
  };
}

async function mount(patch: Partial<ApartmentViewConfig> = {}) {
  const element = document.createElement('apartment-view-card-editor') as any;
  element.hass = {
    states: {
      'light.pendant': { entity_id: 'light.pendant', state: 'off', attributes: { friendly_name: 'Pendant' } },
      'fan.purifier': { entity_id: 'fan.purifier', state: 'on', attributes: { friendly_name: 'Air purifier', percentage: 60 } },
    },
    areas: { living_room: { area_id: 'living_room', name: 'Living Room' } },
    config: { latitude: 45.81, longitude: 15.98 },
    localize: (key: string) => key,
  };
  element.setConfig({ ...config(), ...patch });
  document.body.append(element);
  await element.updateComplete;
  return element;
}

describe('apartment-view-card-editor', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('preserves unknown configuration keys', async () => {
    const element = await mount({ _future: { keep: true } } as any);
    expect(element.config._future).toEqual({ keep: true });
  });

  it('uses the complete 3D setup flow without legacy imported-plan or furniture language', async () => {
    const element = await mount();
    const labels = Array.from(element.shadowRoot.querySelectorAll('.setup-step span')).map((node: any) => node.textContent?.trim());
    expect(labels).toEqual(['Structure', 'Rooms', 'Openings', 'Elements', 'Devices', 'Actions', 'Review']);
    expect(element.shadowRoot.textContent).not.toMatch(/imported plan|scandinavian|furniture library/i);
    expect(element.shadowRoot.querySelector('spatial-plan-editor')).toBeTruthy();
  });

  it('opens the plan editor in structure-selection mode and exposes true north under Structure', async () => {
    const element = await mount();
    element._previewMode = '3d';
    element._previewCollapsed = true;
    element._setupStep = 'rooms';
    await element.updateComplete;

    await element._editStructure();
    const editor = element.shadowRoot.querySelector('spatial-plan-editor') as any;
    expect(element._setupStep).toBe('floorplan');
    expect(element._previewMode).toBe('edit');
    expect(element._previewCollapsed).toBe(false);
    expect(editor._mode).toBe('select');
    expect(element.shadowRoot.textContent).toContain('True north');

    const north = element.shadowRoot.querySelector('#structure-north-bearing') as HTMLInputElement;
    north.value = '137';
    north.dispatchEvent(new Event('input', { bubbles: true }));
    expect(element.config.spatial.site.north).toBe(137);

    element._setupStep = 'architecture';
    await element.updateComplete;
    expect(element.shadowRoot.querySelector('#structure-north-bearing')).toBeNull();
  });

  it('expands only its Home Assistant card dialog on desktop and restores it on close', async () => {
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = (() => ({ matches: true })) as unknown as typeof window.matchMedia;
    try {
      const wrapper = document.createElement('hui-dialog-edit-card');
      const wrapperRoot = wrapper.attachShadow({ mode: 'open' });
      const dialog = document.createElement('ha-dialog');
      const dialogRoot = dialog.attachShadow({ mode: 'open' });
      const surface = document.createElement('div');
      surface.className = 'mdc-dialog__surface';
      dialogRoot.append(surface);
      wrapperRoot.append(dialog);
      document.body.append(wrapper);
      const element = await mount();
      wrapper.append(element);
      await element.updateComplete;
      element._expandHostDialog();
      expect(dialog.style.getPropertyValue('--mdc-dialog-max-width')).toBe('calc(100vw - 32px)');
      expect(surface.style.getPropertyValue('max-width')).toBe('calc(100vw - 32px)');
      wrapper.remove();
      expect(dialog.hasAttribute('style')).toBe(false);
      expect(surface.hasAttribute('style')).toBe(false);
    } finally {
      window.matchMedia = originalMatchMedia;
    }
  });

  it('offers three generated Element types and a dedicated GLB import path', async () => {
    const element = await mount();
    element._setupStep = 'elements';
    await element.updateComplete;
    const addButtons = Array.from(element.shadowRoot.querySelectorAll('.element-kinds button')) as HTMLElement[];
    expect(addButtons.map((button) => button.textContent?.trim().replace(/\s+/g, ' '))).toEqual([
      'Ceiling lightState beacon with practical light',
      'Light bulbState beacon with practical light',
      'CustomBuild from solid primitives',
    ]);
    expect(element.shadowRoot.querySelector('.element-upload')?.textContent?.trim().replace(/\s+/g, ' ')).toBe('GLB sourcedImport and map model surfaces');
    addButtons[2].click();
    await element.updateComplete;
    expect(element.config.spatial.plan.elements).toHaveLength(1);
    expect(element.config.spatial.plan.elements[0]).toMatchObject({ type: 'custom', name: 'Custom element' });
    expect(element.config.spatial.plan.elements[0].primitives).toEqual([expect.objectContaining({ kind: 'cube' })]);
  });

  it('maps GLB surfaces to entities and conditional appearance', async () => {
    const element = await mount();
    const plan = addSpatialElement(element.config.spatial.plan, 'glb', { x: 4, z: 3 }, {
      name: 'Television',
      glb: {
        fileName: 'tv.glb', uri: 'data:model/gltf-binary;base64,AAAA', byteLength: 3,
        size: { x: 1.4, y: 0.8, z: 0.12 },
        surfaces: [{
          id: 'screen', name: 'Screen', nodePath: '0', materialIndex: 0,
          color: { base: '#111111', rules: [] }, luminosity: { base: 0, rules: [] },
        }],
      },
    });
    element._commitSpatial({ ...element.config.spatial, plan });
    element._selectedElementId = 'glb-1';
    element._selectedGlbSurfaceId = 'screen';
    element._setupStep = 'elements';
    element._updateGlbSurface({ entityId: 'fan.purifier' });
    element._addGlbSurfaceRule('luminosity');
    element._updateGlbSurfaceRule('luminosity', 0, { attribute: 'percentage', operator: 'above', compare: 50, value: 0.8 });
    await element.updateComplete;

    const surface = element.config.spatial.plan.elements[0].glb.surfaces[0];
    expect(surface).toMatchObject({ entityId: 'fan.purifier', luminosity: { rules: [{ attribute: 'percentage', value: 0.8 }] } });
    expect(element.shadowRoot.textContent).toContain('Surface color');
    expect(element.shadowRoot.textContent).toContain('Light emission');
  });

  it('applies GLB mappings to matching material instances or original colors', async () => {
    const element = await mount();
    const surface = (id: string, material: string, color: string) => ({
      id, name: id, nodePath: String(Number(id.slice(1)) - 1), materialIndex: 0,
      sourceMaterialKey: material, sourceColor: color,
      color: { base: color, rules: [] }, luminosity: { base: 0, rules: [] },
    });
    const plan = addSpatialElement(element.config.spatial.plan, 'glb', { x: 4, z: 3 }, {
      name: 'Cabinet', primitives: [],
      glb: {
        fileName: 'cabinet.glb', uri: 'data:model/gltf-binary;base64,AAAA', byteLength: 3,
        size: { x: 2, y: 1, z: 0.5 },
        surfaces: [
          surface('s1', 'name:oak', '#9a714f'),
          surface('s2', 'name:oak', '#9a714f'),
          surface('s3', 'name:trim', '#9a714f'),
          surface('s4', 'name:metal', '#222222'),
        ],
      },
    });
    element._commitSpatial({ ...element.config.spatial, plan });
    element._selectedElementId = 'glb-1';
    element._selectedGlbSurfaceId = 's1';
    element._setupStep = 'elements';

    element._glbSurfaceScope = 'material';
    element._updateGlbSurfaceConditional('color', { base: '#ffffff', rules: [] });
    let surfaces = element.config.spatial.plan.elements[0].glb.surfaces;
    expect(surfaces.map((item: any) => item.color.base)).toEqual(['#ffffff', '#ffffff', '#9a714f', '#222222']);

    element._glbSurfaceScope = 'surface';
    element._updateGlbSurface({ luminosity: { base: 0.75, rules: [] } });
    element._glbSurfaceScope = 'material';
    element._applySelectedGlbMappingToScope();
    surfaces = element.config.spatial.plan.elements[0].glb.surfaces;
    expect(surfaces[1].luminosity.base).toBe(0.75);

    element._glbSurfaceScope = 'color';
    element._updateGlbSurfaceGroup({ entityId: 'fan.purifier' });
    surfaces = element.config.spatial.plan.elements[0].glb.surfaces;
    expect(surfaces.map((item: any) => item.entityId)).toEqual(['fan.purifier', 'fan.purifier', 'fan.purifier', undefined]);
    await element.updateComplete;
    expect(element.shadowRoot.textContent).toContain('Color · 3');
    expect(element.shadowRoot.textContent).toContain('Changes affect all 3 matching surfaces.');
  });

  it('builds, binds, conditions, and duplicates a custom Element without shared references', async () => {
    const element = await mount();
    element._addSpatialElement('custom');
    element._updateSpatialElement({ entityId: 'fan.purifier', name: 'Purifier table' });
    element._addElementPrimitive('cylinder');
    element._addPrimitiveRule('waves');
    element._updatePrimitiveRule('waves', 0, { attribute: 'percentage', operator: 'above', compare: 50, value: 0.8 });
    element._duplicateSpatialElement();

    const [source, copy] = element.config.spatial.plan.elements;
    expect(source).toMatchObject({ name: 'Purifier table', entityId: 'fan.purifier' });
    expect(source.primitives[1]).toMatchObject({ kind: 'cylinder', waves: { rules: [{ attribute: 'percentage', value: 0.8 }] } });
    expect(copy.name).toBe('Purifier table copy');
    expect(copy.primitives[1]).not.toBe(source.primitives[1]);
    expect(copy.primitives[1].waves.rules[0]).not.toBe(source.primitives[1].waves.rules[0]);
  });

  it('exposes editable room names and Area links', async () => {
    const element = await mount();
    element._setupStep = 'rooms';
    element._selectedRoomId = element.config.spatial.plan.rooms[0].id;
    await element.updateComplete;
    const fields = element.shadowRoot.querySelector('.room-fields') as HTMLElement;
    const name = fields.querySelector('input') as HTMLInputElement;
    name.value = 'Lounge';
    name.dispatchEvent(new Event('change', { bubbles: true }));
    expect(element.config.zones[0].name).toBe('Lounge');
    expect(fields.querySelector('select')).toBeTruthy();
  });

  it('shows structured condition controls instead of raw YAML fields', async () => {
    const element = await mount();
    element._addSpatialElement('custom');
    element._setupStep = 'elements';
    element._addPrimitiveRule('color');
    await element.updateComplete;
    expect(element.shadowRoot.querySelectorAll('.conditional-control')).toHaveLength(3);
    expect(element.shadowRoot.querySelector('.condition-row')).toBeTruthy();
    expect((element.shadowRoot.querySelector('.condition-row input') as HTMLInputElement).placeholder).toBe('Use element entity');
  });

  it('lets each device set independent overview and room marker visibility', async () => {
    const element = await mount();
    element._setupStep = 'devices';
    element._selectedEntity = 0;
    await element.updateComplete;
    const selects = Array.from(element.shadowRoot.querySelectorAll('.marker-policy-grid select')) as HTMLSelectElement[];
    expect(selects).toHaveLength(2);
    expect(selects[0].value).toBe('auto');
    expect(selects[1].value).toBe('auto');

    selects[0].value = 'hidden';
    selects[0].dispatchEvent(new Event('change', { bubbles: true }));
    expect(element.config.entities[0].overviewVisibility).toBe('hidden');

    selects[1].value = 'active';
    selects[1].dispatchEvent(new Event('change', { bubbles: true }));
    expect(element.config.entities[0].roomVisibility).toBe('active');
  });

  it('replaces old Advanced controls with JSON/YAML backup and restore', async () => {
    const element = await mount();
    element._mode = 'advanced';
    await element.updateComplete;
    expect(element.shadowRoot.textContent).toContain('Download JSON');
    expect(element.shadowRoot.textContent).toContain('Download YAML');
    expect(element.shadowRoot.textContent).toContain('Restore a backup');
    expect(element.shadowRoot.querySelector('input[type="file"]')).toBeTruthy();
    expect(element.shadowRoot.querySelector('ha-form.options')).toBeNull();
    expect(element.shadowRoot.querySelector('.image-url')).toBeNull();
  });

  it('validates complete backups and rejects legacy object plans or empty custom Elements', async () => {
    const element = await mount();
    expect(element._validateBackup(element.config).errors).toEqual([]);

    const legacy = structuredClone(element.config) as any;
    legacy.spatial.plan.objects = [];
    delete legacy.spatial.plan.elements;
    expect(element._validateBackup(legacy).errors).toContain('The spatial plan has no valid Elements list.');

    const broken = structuredClone(element.config) as any;
    broken.spatial.plan.elements = [{
      id: 'empty', type: 'custom', position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, primitives: [],
    }];
    expect(element._validateBackup(broken).errors).toContain('Element empty has no primitives.');
  });

  it('never wires a callable Home Assistant service into either editor preview', async () => {
    const element = await mount();
    element._previewMode = '3d';
    await element.updateComplete;
    const preview = element.shadowRoot.querySelector('spatial-preview') as any;
    expect(preview).toBeTruthy();
    expect(element.shadowRoot.textContent).toContain('device actions disabled');
  });
});
