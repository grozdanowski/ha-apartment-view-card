// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import '../src/apartment-view-card';
import { rectangularSpatialPlan } from '../src/core/spatial-plan';

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
        entity: 'light.living', name: 'Living light', x: 50, y: 50, size: 'medium', tap: 'toggle', orientation: null, zoneId: 'living',
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

  it('focuses a room from the navigation rail', async () => {
    const { card, preview } = await mount();
    const roomButtons = [...card.shadowRoot.querySelectorAll('.spatial-room-rail button')] as HTMLButtonElement[];
    const roomButton = roomButtons.find((button) => button.textContent === 'Living Room');
    roomButton?.click();
    await card.updateComplete;
    await preview.updateComplete;
    expect(preview.focusedZoneId).toBe('living');
    expect(roomButton?.getAttribute('aria-pressed')).toBe('true');
    const back = card.shadowRoot.querySelector('.spatial-room-back') as HTMLButtonElement;
    expect(back).toBeTruthy();
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
    roomButton.click();
    await preview.updateComplete;
    expect(preview.focusedZoneId).toBe('living');
    expect(roomButton.getAttribute('aria-pressed')).toBe('true');
  });

  it('uses solid floor materials without image textures', () => {
    const preview = document.createElement('spatial-preview') as any;
    const floor = preview._surveyFloorMaterial() as THREE.MeshStandardMaterial;
    expect(floor.map).toBeNull();
    expect(floor.roughness).toBeGreaterThanOrEqual(0.8);
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
    const beacon = preview.shadowRoot.querySelector('.entity-beacon') as HTMLElement;
    expect(beacon.classList.contains('expanded')).toBe(true);
    expect(beacon.getAttribute('aria-label')).toContain('All The Stars · Kendrick Lamar & SZA · Spotify');
    expect(beacon.querySelector('ha-icon')?.getAttribute('icon')).toBe('mdi:speaker-play');
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
