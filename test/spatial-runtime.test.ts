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

  it('keeps room focus controlled by the card runtime', async () => {
    const { card, preview } = await mount();
    preview.dispatchEvent(new CustomEvent('spatial-room-selected', {
      detail: { zoneId: 'living' }, bubbles: true, composed: true,
    }));
    await card.updateComplete;
    await preview.updateComplete;
    expect(card._spatialFocusedZone).toBe('living');
    expect(preview.focusedZoneId).toBe('living');
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
    const { preview } = await mount();
    const viewport = preview.shadowRoot.querySelector('.viewport') as HTMLElement;
    const rail = preview.shadowRoot.querySelector('.room-rail') as HTMLElement;
    expect(viewport.querySelector('.topbar')).toBeNull();
    expect(viewport.querySelector('.room-rail')).toBeNull();
    expect(rail).toBeTruthy();
    expect(rail.compareDocumentPosition(viewport) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(viewport.textContent).not.toContain('Your apartment');
  });

  it('focuses a room from the navigation rail', async () => {
    const { card, preview } = await mount();
    const roomButtons = [...preview.shadowRoot.querySelectorAll('.room-rail button')] as HTMLButtonElement[];
    const roomButton = roomButtons.find((button) => button.textContent === 'Living Room');
    roomButton?.click();
    await card.updateComplete;
    await preview.updateComplete;
    expect(card._spatialFocusedZone).toBe('living');
    expect(roomButton?.getAttribute('aria-pressed')).toBe('true');
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
          expect(Math.abs(projected.x)).toBeLessThanOrEqual(0.9);
          expect(Math.abs(projected.y)).toBeLessThanOrEqual(0.9);
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
});
