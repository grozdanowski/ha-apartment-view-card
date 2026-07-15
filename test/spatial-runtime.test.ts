// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import '../src/apartment-view-card';
import { rectangularSpatialPlan } from '../src/core/spatial-plan';
import { elementPrimitivesForType } from '../src/core/spatial-elements';

describe('3D spatial runtime', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    if (!customElements.get('ha-card')) customElements.define('ha-card', class extends HTMLElement {});
  });

  async function mount() {
    const callService = vi.fn(async () => undefined);
    const card = document.createElement('apartment-view-card') as any;
    const plan = rectangularSpatialPlan(8, 6);
    plan.rooms[0] = { ...plan.rooms[0], zoneId: 'living' };
    card.hass = {
      states: { 'light.living': { entity_id: 'light.living', state: 'on', attributes: {} } },
      callService,
    };
    card.setConfig({
      type: 'custom:apartment-view-card',
      zones: [{ id: 'living', name: 'Living Room', x: 0, y: 0, width: 100, height: 100 }],
      entities: [{
        entity: 'light.living', name: 'Living light', x: 50, y: 50, size: 'medium', tap: 'toggle', orientation: null, zoneId: 'living', overviewVisibility: 'always',
        spatial: { position: { x: 4, y: 2.4, z: 3 }, rotation: { x: 0, y: 0, z: 0 }, mount: 'ceiling', visible: true },
      }],
      spatial: { plan },
    });
    document.body.append(card);
    await card.updateComplete;
    const preview = card.shadowRoot.querySelector('spatial-preview') as any;
    await preview.updateComplete;
    return { card, preview, callService };
  }

  it('keeps room focus owned by the spatial surface across host updates', async () => {
    const { card } = await mount();
    const roomButton = [...card.shadowRoot.querySelectorAll('.spatial-room-rail button')]
      .find((button: Element) => button.textContent === 'Living Room') as HTMLButtonElement;
    roomButton.click();
    await card.updateComplete;
    card.hass = { ...card.hass };
    await card.updateComplete;
    const currentPreview = card.shadowRoot.querySelector('spatial-preview') as any;
    await currentPreview.updateComplete;
    expect(currentPreview.focusedZoneId).toBe('living');
  });

  it('opens more-info from an accessible entity shortcut without calling a service', async () => {
    const { card, preview, callService } = await mount();
    let selected = '';
    card.addEventListener('hass-more-info', (event: Event) => {
      selected = (event as CustomEvent).detail.entityId;
    });
    (preview.shadowRoot.querySelector('.entity-shortcuts button') as HTMLButtonElement).click();
    expect(selected).toBe('light.living');
    expect(callService).not.toHaveBeenCalled();
  });

  it('keeps navigation and status UI outside the Three.js viewport', async () => {
    const { card, preview } = await mount();
    const viewport = preview.shadowRoot.querySelector('.viewport') as HTMLElement;
    const rail = card.shadowRoot.querySelector('.spatial-room-rail') as HTMLElement;
    expect(viewport.querySelector('.topbar')).toBeNull();
    expect(viewport.querySelector('.room-rail')).toBeNull();
    expect(rail).toBeTruthy();
    expect(rail.compareDocumentPosition(viewport) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(viewport.textContent).not.toContain('Your apartment');
  });

  it('uses the configured overview reset delay and allows zero to disable it', () => {
    vi.useFakeTimers();
    try {
      const preview = document.createElement('spatial-preview') as any;
      preview.focusedZoneId = null;
      preview.overviewResetSeconds = 0.05;
      preview._moveCameraTo = vi.fn();
      preview._scheduleOverviewReset();
      vi.advanceTimersByTime(60);
      expect(preview._moveCameraTo).toHaveBeenCalledWith(null);
      preview._moveCameraTo.mockClear();
      preview.overviewResetSeconds = 0;
      preview._scheduleOverviewReset();
      vi.advanceTimersByTime(1000);
      expect(preview._moveCameraTo).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('focuses a room from the navigation rail', async () => {
    const { card, preview } = await mount();
    const roomButtons = [...card.shadowRoot.querySelectorAll('.spatial-room-rail button')] as HTMLButtonElement[];
    expect(roomButtons.map((button) => button.textContent)).toEqual(['Living Room']);
    expect(card.shadowRoot.querySelector('.spatial-room-back')).toBeNull();
    expect(card.shadowRoot.querySelector('.spatial-room-divider')).toBeNull();
    const roomButton = roomButtons.find((button) => button.textContent === 'Living Room');
    roomButton?.click();
    await card.updateComplete;
    await preview.updateComplete;
    expect(preview.focusedZoneId).toBe('living');
    expect(roomButton?.getAttribute('aria-pressed')).toBe('true');
    const back = card.shadowRoot.querySelector('.spatial-room-back') as HTMLButtonElement;
    expect(back).toBeTruthy();
    expect(card.shadowRoot.querySelector('.spatial-room-divider')).toBeTruthy();
    expect([...card.shadowRoot.querySelectorAll('.spatial-room-rail button')].map((button) => button.textContent)).toEqual(['Living Room']);
    back.click();
    await card.updateComplete;
    await preview.updateComplete;
    expect(preview.focusedZoneId).toBeNull();
    expect(card.shadowRoot.querySelector('.spatial-room-back')).toBeNull();
  });

  it('keeps standalone preview room controls usable in the editor', async () => {
    const { preview } = await mount();
    preview.showRoomControls = true;
    await preview.updateComplete;
    const roomButton = [...preview.shadowRoot.querySelectorAll('.room-rail button')]
      .find((button: Element) => button.textContent === 'Living Room') as HTMLButtonElement;
    expect([...preview.shadowRoot.querySelectorAll('.room-rail button')].map((button) => button.textContent)).toEqual(['Living Room']);
    expect(preview.shadowRoot.querySelector('.room-back')).toBeNull();
    expect(preview.shadowRoot.querySelector('.room-divider')).toBeNull();
    roomButton.click();
    await preview.updateComplete;
    expect(preview.focusedZoneId).toBe('living');
    expect(roomButton.getAttribute('aria-pressed')).toBe('true');
    expect(preview.shadowRoot.querySelector('.room-back')).toBeTruthy();
    expect(preview.shadowRoot.querySelector('.room-divider')).toBeTruthy();
  });

  it('uses solid floor materials without image textures', () => {
    const preview = document.createElement('spatial-preview') as any;
    const floor = preview._surveyFloorMaterial() as THREE.MeshStandardMaterial;
    expect(floor.map).toBeNull();
    expect(floor.roughness).toBeGreaterThanOrEqual(0.8);
  });

  it('blocks exterior directional light with invisible room-shaped ceilings', () => {
    const preview = document.createElement('spatial-preview') as any;
    preview.dimensions = { width: 6, aspectRatio: 1, wallHeight: 2.7 };
    const shell = preview._createCeilingShadowShell({
      outer: [[0, 0], [6, 0], [6, 4], [0, 4]],
      holes: [],
      floor: [[0, 0], [6, 0], [6, 4], [0, 4]],
      rooms: [
        { zoneId: 'living', floor: [[0, 0], [4, 0], [4, 4], [0, 4]] },
        { zoneId: 'office', floor: [[4, 0], [6, 0], [6, 4], [4, 4]] },
      ],
      openings: [],
    });
    const ceilings = shell.children as THREE.Mesh[];
    expect(ceilings).toHaveLength(2);
    expect(ceilings.map((ceiling) => ceiling.userData.zoneId)).toEqual(['living', 'office']);
    ceilings.forEach((ceiling) => {
      const material = ceiling.material as THREE.MeshBasicMaterial;
      expect(ceiling.position.y).toBe(2.7);
      expect(ceiling.castShadow).toBe(true);
      expect(ceiling.receiveShadow).toBe(false);
      expect(ceiling.userData.ceilingShadowOccluder).toBe(true);
      expect(material.colorWrite).toBe(false);
      expect(material.depthWrite).toBe(false);
      expect(material.side).toBe(THREE.DoubleSide);
    });
  });

  it('keeps the sun as the only shadow-casting exterior direction', () => {
    const preview = document.createElement('spatial-preview') as any;
    const sun = new THREE.DirectionalLight();
    const fill = new THREE.DirectionalLight();
    preview._configureExteriorShadow(sun, 2048);
    preview._configureDiffuseExteriorFill(fill);
    expect(sun.castShadow).toBe(true);
    expect(fill.castShadow).toBe(false);
    expect(fill.shadow.autoUpdate).toBe(false);
    expect(sun.shadow.mapSize.width).toBe(2048);
  });

  it('lets exterior directional light pass through architectural glazing', () => {
    const preview = document.createElement('spatial-preview') as any;
    preview.dimensions = { width: 4, aspectRatio: 1, wallHeight: 2.7 };
    const shell = preview._createSurveyShell({
      outer: [[0, 0], [4, 0], [4, 3], [0, 3]],
      holes: [],
      floor: [[0, 0], [4, 0], [4, 3], [0, 3]],
      rooms: [{ zoneId: 'living', floor: [[0, 0], [4, 0], [4, 3], [0, 3]] }],
      walls: [{ id: 'facade', points: [[0, 0], [4, 0]], thickness: 0.2, zoneIds: ['living'] }],
      openings: [{
        id: 'balcony-glass', kind: 'window', x: 2, z: 0, width: 1.8, depth: 0.2,
        rotation: 0, bottom: 0, height: 2.45,
      }],
    });
    const glazing: THREE.Mesh[] = [];
    const walls: THREE.Mesh[] = [];
    shell.traverse((node: THREE.Object3D) => {
      if (!(node instanceof THREE.Mesh)) return;
      if (node.userData.glazing) glazing.push(node);
      if (node.userData.architecturalWall) walls.push(node);
    });
    expect(glazing).toHaveLength(1);
    expect(glazing[0].castShadow).toBe(false);
    expect(glazing[0].receiveShadow).toBe(true);
    expect((glazing[0].material as THREE.MeshStandardMaterial).transparent).toBe(true);
    expect(walls.length).toBeGreaterThan(0);
    expect(walls.every((wall) => wall.castShadow)).toBe(true);
  });

  it('turns active Home Assistant lights into practical scene lighting', () => {
    const preview = document.createElement('spatial-preview') as any;
    preview.hass = {
      states: {
        'light.living': {
          entity_id: 'light.living',
          state: 'on',
          attributes: { brightness: 204, rgb_color: [255, 180, 120] },
        },
      },
    };
    const practical = new THREE.PointLight();
    practical.userData.entityId = 'light.living';
    practical.userData.entityLight = true;
    const model = new THREE.Group();
    model.add(practical);
    preview._model = model;
    preview._updateEntityStateVisuals();
    expect(practical.intensity).toBeGreaterThan(10);
    expect(practical.color.r).toBeCloseTo(1);
    expect(practical.color.g).toBeCloseTo(180 / 255);
  });

  it('represents both light Element types as beacon anchors with practical light and no solid mesh', () => {
    const preview = document.createElement('spatial-preview') as any;
    preview.hass = {
      states: {
        'light.fixture': {
          entity_id: 'light.fixture', state: 'on',
          attributes: { brightness: 128, rgb_color: [255, 120, 60] },
        },
      },
    };
    for (const type of ['ceiling-light', 'light-bulb'] as const) {
      const visual = preview._createSpatialElement({
        id: type,
        type,
        entityId: 'light.fixture',
        position: { x: 0, y: 2.4, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        primitives: elementPrimitivesForType(type),
      });
      expect(visual.children.some((node: THREE.Object3D) => node instanceof THREE.Mesh)).toBe(false);
      const practical = visual.children.find((node: THREE.Object3D) => node instanceof THREE.PointLight) as THREE.PointLight;
      expect(practical).toBeTruthy();
      expect(practical.intensity).toBeCloseTo((128 / 255) * 18);
      expect(practical.color.r).toBeCloseTo(1);
      expect(practical.color.g).toBeCloseTo(120 / 255);
      expect(practical.userData.semanticLight).toBe(true);
    }
  });

  it('loads a GLB Element once and drives each mapped material surface from Home Assistant state', async () => {
    const preview = document.createElement('spatial-preview') as any;
    const source = new THREE.Group();
    const sourceMesh = new THREE.Mesh(
      new THREE.BoxGeometry(1.4, 0.8, 0.12),
      new THREE.MeshStandardMaterial({ name: 'Screen', color: 0x111111 }),
    );
    sourceMesh.name = 'Display';
    source.add(sourceMesh);
    const element = {
      id: 'tv', type: 'glb' as const, name: 'Television', entityId: 'media_player.tv',
      position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, primitives: [],
      glb: {
        fileName: 'tv.glb', uri: 'data:model/gltf-binary;base64,AAAA', byteLength: 3,
        size: { x: 1.4, y: 0.8, z: 0.12 },
        surfaces: [{
          id: 'screen', name: 'Screen', nodePath: '0', materialIndex: 0, entityId: 'switch.screen',
          color: { base: '#111111', rules: [{ operator: 'equals' as const, compare: 'on', value: '#ff0000' }] },
          luminosity: { base: 0, rules: [{ operator: 'equals' as const, compare: 'on', value: 0.8 }] },
        }],
      },
    };
    preview.plan = { ...rectangularSpatialPlan(4, 3), elements: [element] };
    preview.hass = {
      states: {
        'switch.screen': { entity_id: 'switch.screen', state: 'on', attributes: {} },
      },
    };
    preview._elementLoadGeneration = 1;
    preview._cachedGlbElement = async () => source;
    const model = new THREE.Group();
    const visual = preview._createSpatialElement(element, 1);
    model.add(visual);
    preview._model = model;

    await new Promise((resolve) => setTimeout(resolve, 0));

    const mesh = (visual.children[0] as THREE.Group).children[0] as THREE.Mesh;
    const material = mesh.material as THREE.MeshStandardMaterial;
    expect(material.color.getHexString()).toBe('ff0000');
    expect(material.emissiveIntensity).toBeCloseTo(2.8);
    const practical = mesh.children.find((node) => node instanceof THREE.PointLight) as THREE.PointLight;
    expect(practical.intensity).toBeCloseTo(9.6);
    expect(practical.userData.elementGlbSurfaceLight).toBe('screen');
  });

  it('creates a colored floating beacon directly from a bound light Element', async () => {
    const preview = document.createElement('spatial-preview') as any;
    const plan = rectangularSpatialPlan(4, 3);
    plan.elements = [{
      id: 'pendant', type: 'ceiling-light', name: 'Dining pendant', zoneId: 'living', entityId: 'light.pendant',
      position: { x: 2, y: 2.4, z: 1.5 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 },
      primitives: elementPrimitivesForType('ceiling-light'),
    }];
    preview.plan = plan;
    preview.entities = [];
    preview.hass = {
      states: {
        'light.pendant': {
          entity_id: 'light.pendant', state: 'on',
          attributes: { friendly_name: 'Pendant', brightness: 220, rgb_color: [80, 160, 255] },
        },
      },
    };
    preview.focusedZoneId = 'living';
    document.body.append(preview);
    await preview.updateComplete;
    const beacon = preview.shadowRoot.querySelector('.entity-beacon') as HTMLElement;
    expect(beacon).toBeTruthy();
    expect(beacon.dataset.domain).toBe('light');
    expect(beacon.getAttribute('style')).toContain('--entity-accent:rgb(80 160 255)');
    expect(beacon.querySelector('ha-icon')?.getAttribute('icon')).toBe('mdi:ceiling-light');
    expect(beacon.getAttribute('aria-label')).toContain('Dining pendant');
  });

  it('represents lights as emitted color and brightness without airflow rings', () => {
    const preview = document.createElement('spatial-preview') as any;
    preview.hass = {
      states: {
        'light.mirror': {
          entity_id: 'light.mirror',
          state: 'on',
          attributes: { brightness: 64, color_temp_kelvin: 2700 },
        },
      },
    };
    const visual = preview._createEntityVisual('light.mirror', new THREE.Vector3(0, 1.7, 0), 'bathroom');
    const model = new THREE.Group();
    model.add(visual);
    preview._model = model;
    preview._updateEntityStateVisuals();

    const marker = visual.children.find((node: THREE.Object3D) => node.userData.entityMarker) as THREE.Mesh;
    const material = marker.material as THREE.MeshStandardMaterial;
    expect(visual.children.some((node: THREE.Object3D) => node.userData.entityEffect)).toBe(false);
    expect(material.emissiveIntensity).toBeCloseTo(1.2 + (64 / 255) * 3.8);
    expect(material.emissive.r).toBeGreaterThan(material.emissive.b);
  });

  it('keeps media activity rings clear of the floating marker footprint', () => {
    const preview = document.createElement('spatial-preview') as any;
    preview.hass = {
      states: {
        'media_player.naim': {
          entity_id: 'media_player.naim',
          state: 'playing',
          attributes: { media_content_type: 'music' },
        },
      },
    };
    const visual = preview._createEntityVisual('media_player.naim', new THREE.Vector3(), 'living');
    const rings = visual.children
      .filter((node: THREE.Object3D) => node.userData.entityEffect)
      .map((node: THREE.Object3D) => (node as THREE.Mesh<THREE.TorusGeometry>).geometry.parameters.radius);

    expect(rings).toHaveLength(3);
    expect(rings[0]).toBeCloseTo(0.22);
    expect(rings[1]).toBeCloseTo(0.315);
    expect(rings[2]).toBeCloseTo(0.41);
  });

  it('scales air effects from live fan percentage', () => {
    const preview = document.createElement('spatial-preview') as any;
    preview.hass = {
      states: {
        'fan.purifier': {
          entity_id: 'fan.purifier',
          state: 'on',
          attributes: { percentage: 80 },
        },
      },
    };
    const effect = new THREE.Mesh(
      new THREE.TorusGeometry(0.2, 0.01),
      new THREE.MeshStandardMaterial(),
    );
    effect.userData.entityId = 'fan.purifier';
    effect.userData.entityEffect = true;
    effect.userData.effectOpacity = 0.34;
    const model = new THREE.Group();
    model.add(effect);
    preview._model = model;
    preview._updateEntityStateVisuals();
    expect(effect.userData.effectStrength).toBeCloseTo(0.8);
    expect(effect.scale.x).toBeCloseTo(1.34);
    expect((effect.material as THREE.MeshStandardMaterial).opacity).toBeGreaterThan(0.25);
  });

  it('renders state-rich media beacons instead of anonymous dots', async () => {
    const { preview } = await mount();
    preview.entities = [{
      entity: 'media_player.naim', name: 'Naim Mu-so', x: 50, y: 50, size: 'medium', tap: 'more-info', orientation: null, zoneId: 'living',
      spatial: { position: { x: 4, y: 0.5, z: 3 }, rotation: { x: 0, y: 0, z: 0 }, mount: 'surface', visible: true },
    }];
    preview.hass = {
      states: {
        'media_player.naim': {
          entity_id: 'media_player.naim', state: 'playing',
          attributes: { device_class: 'speaker', media_title: 'All The Stars', media_artist: 'Kendrick Lamar & SZA', source: 'Spotify' },
        },
      },
    };
    await preview.updateComplete;
    let beacon = preview.shadowRoot.querySelector('.entity-beacon') as HTMLElement;
    expect(beacon.dataset.context).toBe('overview');
    expect(beacon.classList.contains('expanded')).toBe(false);
    expect(beacon.title).toBe('');
    expect(beacon.getAttribute('aria-label')).toContain('All The Stars · Kendrick Lamar & SZA · Spotify');
    expect(beacon.querySelector('ha-icon')?.getAttribute('icon')).toBe('mdi:speaker-play');

    preview.focusedZoneId = 'living';
    await preview.updateComplete;
    beacon = preview.shadowRoot.querySelector('.entity-beacon') as HTMLElement;
    expect(beacon.dataset.context).toBe('room');
    expect(beacon.classList.contains('expanded')).toBe(false);
    let selectedEntity = '';
    preview.addEventListener('spatial-entity-selected', (event: Event) => {
      selectedEntity = (event as CustomEvent).detail.entityId;
    });
    beacon.click();
    await preview.updateComplete;
    beacon = preview.shadowRoot.querySelector('.entity-beacon') as HTMLElement;
    expect(beacon.classList.contains('expanded')).toBe(true);
    expect(beacon.getAttribute('aria-expanded')).toBe('true');
    expect(selectedEntity).toBe('');
    expect(beacon.title).toBe('');
    beacon.click();
    expect(selectedEntity).toBe('media_player.naim');
  });

  it('shows configured media tooltip content only while the player is active', async () => {
    const { preview } = await mount();
    preview.entities = [{
      entity: 'media_player.kef', name: 'KEF LSX', x: 50, y: 50, size: 'medium', tap: 'more-info', orientation: null, zoneId: 'living',
      roomVisibility: 'always', tooltipContentInOverview: 'none', tooltipContentInRoom: 'state',
      spatial: { position: { x: 4, y: 0.6, z: 3 }, rotation: { x: 0, y: 0, z: 0 }, mount: 'surface', visible: true },
    }];
    preview.hass = { states: {
      'media_player.kef': {
        entity_id: 'media_player.kef', state: 'playing',
        attributes: { media_title: 'All The Stars', media_artist: 'Kendrick Lamar & SZA', source: 'Spotify' },
      },
    } };
    preview.focusedZoneId = 'living';
    await preview.updateComplete;

    let beacon = preview.shadowRoot.querySelector('.entity-beacon') as HTMLElement;
    expect(beacon.classList.contains('expanded')).toBe(true);
    expect(beacon.querySelector('.entity-copy')?.textContent).toContain('All The Stars · Kendrick Lamar & SZA · Spotify');
    let selectedEntity = '';
    preview.addEventListener('spatial-entity-selected', (event: Event) => {
      selectedEntity = (event as CustomEvent).detail.entityId;
    });
    beacon.click();
    expect(selectedEntity).toBe('media_player.kef');

    preview.hass = { states: {
      'media_player.kef': { entity_id: 'media_player.kef', state: 'paused', attributes: { media_title: 'All The Stars' } },
    } };
    await preview.updateComplete;
    beacon = preview.shadowRoot.querySelector('.entity-beacon') as HTMLElement;
    expect(beacon.classList.contains('expanded')).toBe(false);
  });

  it('keeps automatic overview markers calm while preserving explicit pins', async () => {
    const { preview } = await mount();
    preview.entities = [
      {
        entity: 'light.sofa', name: 'Sofa light', x: 50, y: 50, size: 'medium', tap: 'more-info', orientation: null, zoneId: 'living',
        spatial: { position: { x: 3, y: 1.2, z: 3 }, rotation: { x: 0, y: 0, z: 0 }, mount: 'wall', visible: true },
      },
      {
        entity: 'media_player.naim', name: 'Naim', x: 50, y: 50, size: 'medium', tap: 'more-info', orientation: null, zoneId: 'living',
        spatial: { position: { x: 4, y: 0.5, z: 3 }, rotation: { x: 0, y: 0, z: 0 }, mount: 'surface', visible: true },
      },
      {
        entity: 'light.pinned', name: 'Pinned light', x: 50, y: 50, size: 'medium', tap: 'more-info', orientation: null, zoneId: 'living', overviewVisibility: 'always',
        spatial: { position: { x: 5, y: 1.2, z: 3 }, rotation: { x: 0, y: 0, z: 0 }, mount: 'wall', visible: true },
      },
    ];
    preview.hass = { states: {
      'light.sofa': { entity_id: 'light.sofa', state: 'on', attributes: {} },
      'media_player.naim': { entity_id: 'media_player.naim', state: 'playing', attributes: {} },
      'light.pinned': { entity_id: 'light.pinned', state: 'off', attributes: {} },
    } };
    await preview.updateComplete;
    const ids = [...preview.shadowRoot.querySelectorAll('.entity-beacon')].map((node) => (node as HTMLElement).dataset.entityId);
    expect(ids).toEqual(['media_player.naim', 'light.pinned']);
  });

  it('keeps nearby markers rigidly anchored instead of collision-shifting them', async () => {
    const preview = document.createElement('spatial-preview') as any;
    preview.focusedZoneId = 'living';
    preview.entities = [
      {
        entity: 'light.bar_1', name: 'Bar Pendant 1', x: 50, y: 50, size: 'medium', tap: 'more-info', orientation: null, zoneId: 'living',
        spatial: { position: { x: 2, y: 2.5, z: 2 }, rotation: { x: 0, y: 0, z: 0 }, mount: 'ceiling', visible: true },
      },
      {
        entity: 'light.bar_2', name: 'Bar Pendant 2', x: 50, y: 50, size: 'medium', tap: 'more-info', orientation: null, zoneId: 'living',
        spatial: { position: { x: 2, y: 2.5, z: 2 }, rotation: { x: 0, y: 0, z: 0 }, mount: 'ceiling', visible: true },
      },
    ];
    preview.hass = { states: {
      'light.bar_1': { entity_id: 'light.bar_1', state: 'off', attributes: {} },
      'light.bar_2': { entity_id: 'light.bar_2', state: 'off', attributes: {} },
    } };
    document.body.append(preview);
    await preview.updateComplete;

    const canvas = preview.shadowRoot.querySelector('canvas') as HTMLCanvasElement;
    Object.defineProperties(canvas, {
      clientWidth: { value: 400 },
      clientHeight: { value: 300 },
    });
    preview._renderer = { domElement: canvas, dispose: vi.fn() };
    preview._camera = new THREE.PerspectiveCamera(50, 4 / 3, 0.1, 100);
    preview._camera.position.set(0, 0, 10);
    preview._camera.lookAt(0, 0, 0);
    preview._camera.updateMatrixWorld(true);
    const first = new THREE.Group();
    const second = new THREE.Group();
    preview._entityVisuals.set('light.bar_1', first);
    preview._entityVisuals.set('light.bar_2', second);

    preview._syncEntityBeacons();
    const beacons = [...preview.shadowRoot.querySelectorAll('.entity-beacon')] as HTMLElement[];
    expect(beacons).toHaveLength(2);
    expect(beacons[0].style.getPropertyValue('--entity-x')).toBe(beacons[1].style.getPropertyValue('--entity-x'));
    expect(beacons[0].style.getPropertyValue('--entity-y')).toBe(beacons[1].style.getPropertyValue('--entity-y'));
  });

  it('hides a beacon from overview without suppressing it in its room', async () => {
    const { preview } = await mount();
    preview.entities = [{
      entity: 'fan.purifier', name: 'Air purifier', x: 50, y: 50, size: 'medium', tap: 'more-info', orientation: null,
      zoneId: 'living', overviewVisibility: 'hidden', roomVisibility: 'always',
      spatial: { position: { x: 4, y: 0.5, z: 3 }, rotation: { x: 0, y: 0, z: 0 }, mount: 'surface', visible: true },
    }];
    preview.hass = { states: { 'fan.purifier': { entity_id: 'fan.purifier', state: 'on', attributes: { percentage: 70 } } } };
    await preview.updateComplete;
    expect(preview.shadowRoot.querySelector('.entity-beacon')).toBeNull();

    preview.focusedZoneId = 'living';
    await preview.updateComplete;
    const beacon = preview.shadowRoot.querySelector('.entity-beacon') as HTMLElement;
    expect(beacon).toBeTruthy();
    expect(beacon.dataset.context).toBe('room');
  });

  it('hides other-room 3D markers during room focus while preserving their effects', () => {
    const preview = document.createElement('spatial-preview') as any;
    const livingMarker = new THREE.Mesh(new THREE.SphereGeometry(0.05), new THREE.MeshStandardMaterial());
    livingMarker.userData.entityMarker = true;
    livingMarker.userData.zoneId = 'living';
    const officeMarker = livingMarker.clone();
    officeMarker.userData.entityMarker = true;
    officeMarker.userData.zoneId = 'office';
    const officeEffect = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.01), new THREE.MeshStandardMaterial());
    officeEffect.userData.entityEffect = true;
    officeEffect.userData.zoneId = 'office';
    preview._model = new THREE.Group();
    preview._model.add(livingMarker, officeMarker, officeEffect);

    preview.focusedZoneId = 'living';
    preview._applyFocus();
    expect(livingMarker.visible).toBe(true);
    expect(officeMarker.visible).toBe(false);
    expect(officeEffect.visible).toBe(true);

    preview.focusedZoneId = null;
    preview._applyFocus();
    expect(officeMarker.visible).toBe(true);
  });

  it('fits every apartment corner inside a narrow mobile overview', () => {
    const preview = document.createElement('spatial-preview') as any;
    Object.defineProperty(preview, 'clientWidth', { value: 390 });
    preview._camera = new THREE.PerspectiveCamera(34, 0.8, 0.1, 50);
    preview._overviewBounds = new THREE.Box3(
      new THREE.Vector3(-5.85, 0, -5.05),
      new THREE.Vector3(5.85, 2.7, 5.05),
    );
    const pose = preview._overviewPose();
    preview._camera.position.copy(pose.position);
    preview._camera.lookAt(pose.target);
    preview._camera.updateMatrixWorld(true);
    preview._camera.updateProjectionMatrix();
    for (const x of [-5.85, 5.85]) {
      for (const y of [0, 2.7]) {
        for (const z of [-5.05, 5.05]) {
          const projected = new THREE.Vector3(x, y, z).project(preview._camera);
          expect(Math.abs(projected.x)).toBeLessThanOrEqual(0.98);
          expect(Math.abs(projected.y)).toBeLessThanOrEqual(0.98);
        }
      }
    }
  });

  it('fits the complete room and ceiling markers inside the focused viewport', () => {
    const preview = document.createElement('spatial-preview') as any;
    Object.defineProperties(preview, {
      clientWidth: { value: 390 },
      clientHeight: { value: 500 },
    });
    preview.dimensions = { width: 8, aspectRatio: 4 / 3, wallHeight: 2.7 };
    preview.zones = [{ id: 'office', name: 'Office', x: 50, y: 0, width: 50, height: 50 }];
    preview._activeShell = {
      outer: [[0, 0], [8, 0], [8, 6], [0, 6]],
      holes: [], floor: [[0, 0], [8, 0], [8, 6], [0, 6]], openings: [],
      rooms: [{ zoneId: 'office', floor: [[4, 0], [8, 0], [8, 3], [4, 3]] }],
    };
    preview.entities = [
      {
        entity: 'light.office_ceiling', x: 50, y: 50, size: 'medium', tap: 'more-info', orientation: null, zoneId: 'office',
        spatial: { position: { x: 7.7, y: 2.58, z: 0.2 }, rotation: { x: 0, y: 0, z: 0 }, mount: 'ceiling', visible: true },
      },
      {
        entity: 'media_player.office', x: 50, y: 50, size: 'medium', tap: 'more-info', orientation: null, zoneId: 'office',
        spatial: { position: { x: 4.2, y: 0.45, z: 2.8 }, rotation: { x: 0, y: 0, z: 0 }, mount: 'surface', visible: true },
      },
    ];
    preview._camera = new THREE.PerspectiveCamera(34, 390 / 500, 0.1, 50);

    const zone = preview.zones[0];
    const bounds = preview._roomBounds(zone) as THREE.Box3;
    const pose = preview._roomPose(zone);
    preview._camera.position.copy(pose.position);
    preview._camera.lookAt(pose.target);
    preview._camera.updateMatrixWorld(true);
    preview._camera.updateProjectionMatrix();

    for (const x of [bounds.min.x, bounds.max.x]) {
      for (const y of [bounds.min.y, bounds.max.y]) {
        for (const z of [bounds.min.z, bounds.max.z]) {
          const projected = new THREE.Vector3(x, y, z).project(preview._camera);
          expect(Math.abs(projected.x)).toBeLessThanOrEqual(0.9);
          expect(Math.abs(projected.y)).toBeLessThanOrEqual(0.86);
        }
      }
    }
  });

  it('suppresses an automatic group marker when its placed child fixtures exist', async () => {
    const { preview } = await mount();
    preview.focusedZoneId = 'living';
    preview.entities = [
      {
        entity: 'light.office', name: 'Office Lights', x: 50, y: 50, size: 'medium', tap: 'more-info', orientation: null, zoneId: 'living',
        spatial: { position: { x: 4, y: 2.4, z: 3 }, rotation: { x: 0, y: 0, z: 0 }, mount: 'ceiling', visible: true },
      },
      {
        entity: 'light.office_ceiling', name: 'Office Ceiling Light', x: 50, y: 50, size: 'medium', tap: 'more-info', orientation: null, zoneId: 'living',
        spatial: { position: { x: 4, y: 2.4, z: 3 }, rotation: { x: 0, y: 0, z: 0 }, mount: 'ceiling', visible: true },
      },
    ];
    preview.hass = { states: {
      'light.office': { entity_id: 'light.office', state: 'off', attributes: { entity_id: ['light.office_ceiling'] } },
      'light.office_ceiling': { entity_id: 'light.office_ceiling', state: 'off', attributes: {} },
    } };
    await preview.updateComplete;

    const ids = [...preview.shadowRoot.querySelectorAll('.entity-beacon')]
      .map((node) => (node as HTMLElement).dataset.entityId);
    expect(ids).toEqual(['light.office_ceiling']);
  });

  it('restores the overview ten seconds after manual camera interaction', () => {
    vi.useFakeTimers();
    try {
      const preview = document.createElement('spatial-preview') as any;
      preview.focusedZoneId = null;
      preview._moveCameraTo = vi.fn();
      preview._scheduleOverviewReset();
      vi.advanceTimersByTime(9_999);
      expect(preview._moveCameraTo).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(preview._moveCameraTo).toHaveBeenCalledWith(null);
    } finally {
      vi.useRealTimers();
    }
  });

  it('replaces full walls with door-cut low wall segments in clipped mode', () => {
    const preview = document.createElement('spatial-preview') as any;
    preview.dimensions = { width: 6, aspectRatio: 1, wallHeight: 2.6 };
    const model = preview._createSurveyWalls({
      outer: [[0, 0], [4, 0], [4, 3], [0, 3]],
      holes: [],
      floor: [[0, 0], [4, 0], [4, 3], [0, 3]],
      walls: [{ id: 'hall-wall', points: [[0, 0], [4, 0]], thickness: 0.2, zoneIds: ['hall'] }],
      openings: [{
        id: 'hall-door', kind: 'door', x: 2, z: 0, width: 0.9, depth: 0.2,
        rotation: 0, bottom: 0, height: 2.1,
      }],
    }, 2, 1.5);
    preview._model = model;
    preview._applyFocus();

    const meshes: any[] = [];
    model.traverse((node: any) => { if (node.isMesh) meshes.push(node); });
    const normalWalls = meshes.filter((mesh) => mesh.userData.architecturalWall);
    const openings = meshes.filter((mesh) => mesh.userData.wallOpening);
    const replacements = meshes.filter((mesh) => mesh.userData.cutawayReplacement);
    expect(normalWalls.length).toBeGreaterThan(1);
    expect(openings.length).toBe(1);
    expect(replacements).toHaveLength(2);
    expect(replacements.every((mesh) => !mesh.visible)).toBe(true);

    preview.hideWalls = true;
    preview._applyWallCutaway();
    expect(normalWalls.every((mesh) => !mesh.visible)).toBe(true);
    expect(openings.every((mesh) => !mesh.visible)).toBe(true);
    expect(replacements.every((mesh) => mesh.visible)).toBe(true);
    const clippedWidth = replacements.reduce((sum, mesh) => sum + mesh.geometry.parameters.width, 0);
    expect(clippedWidth).toBeCloseTo(3.1);
    expect(replacements[0].geometry.parameters.height).toBeCloseTo(0.26);
  });

  it('keeps a curved-wall window at full width across short survey segments', () => {
    const preview = document.createElement('spatial-preview') as any;
    preview.dimensions = { width: 4, aspectRatio: 1, wallHeight: 2.6 };
    const model = preview._createSurveyWalls({
      outer: [[0, 0], [2, 0], [2, 2], [0, 2]],
      holes: [],
      floor: [[0, 0], [2, 0], [2, 2], [0, 2]],
      walls: [{
        id: 'curved-facade',
        smooth: true,
        thickness: 0.24,
        points: [[0, 0], [0.24, -0.03], [0.48, -0.1], [0.7, -0.2], [0.9, -0.34], [1.08, -0.52], [1.23, -0.73]],
      }],
      openings: [{
        id: 'wide-curve-window', kind: 'window', x: 0.69, z: -0.21, width: 0.82, depth: 0.24,
        rotation: -28, bottom: 0.9, height: 1.1,
      }],
    }, 1, 1);
    const meshes: any[] = [];
    model.traverse((node: any) => { if (node.isMesh) meshes.push(node); });
    const fullWalls = meshes.filter((mesh) => mesh.userData.architecturalWall);
    const window = meshes.find((mesh) => mesh.userData.openingId === 'wide-curve-window');

    expect(fullWalls).toHaveLength(1);
    expect(fullWalls[0].userData.smoothContinuous).toBe(true);
    expect(window).toBeTruthy();
    expect(window.userData.openingWidth).toBeCloseTo(0.82, 2);
    window.geometry.computeBoundingBox();
    const size = window.geometry.boundingBox.getSize(new THREE.Vector3());
    expect(Math.hypot(size.x, size.z)).toBeGreaterThan(0.72);
  });

  it('uses the configured solid color for a door panel', () => {
    const preview = document.createElement('spatial-preview') as any;
    preview.dimensions = { width: 4, aspectRatio: 1, wallHeight: 2.6 };
    const model = preview._createSurveyWalls({
      outer: [[0, 0], [3, 0], [3, 2], [0, 2]],
      holes: [],
      floor: [[0, 0], [3, 0], [3, 2], [0, 2]],
      walls: [{ id: 'colored-wall', points: [[0, 0], [3, 0]], thickness: 0.18 }],
      openings: [{
        id: 'colored-door', kind: 'door', x: 1.5, z: 0, width: 0.9, depth: 0.18,
        rotation: 0, bottom: 0, height: 2.1, color: '#2f5962',
      }],
    }, 1.5, 1);
    let panel: THREE.Mesh | undefined;
    model.traverse((node: THREE.Object3D) => {
      if (node instanceof THREE.Mesh && node.userData.wallOpening) panel = node;
    });
    expect(panel).toBeTruthy();
    expect((panel!.material as THREE.MeshStandardMaterial).color.getHex()).toBe(0x2f5962);
  });
});
