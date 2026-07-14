import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { discoverGlbSurfaces, objectAtGlbNodePath } from '../src/core/spatial-glb';

describe('GLB surface discovery', () => {
  it('assigns stable paths and one mapping per material slot', () => {
    const root = new THREE.Group();
    const wrapper = new THREE.Group();
    wrapper.name = 'Cabinet';
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      [
        new THREE.MeshStandardMaterial({ name: 'Body', color: 0x224466 }),
        new THREE.MeshStandardMaterial({ name: 'Display', color: 0x112233, emissive: 0x336699, emissiveIntensity: 2 }),
      ],
    );
    mesh.name = 'Front';
    wrapper.add(mesh);
    root.add(wrapper);

    const surfaces = discoverGlbSurfaces(root);

    expect(surfaces).toHaveLength(2);
    expect(surfaces[0]).toMatchObject({ name: 'Front · Body', nodePath: '0/0', materialIndex: 0, color: { base: '#224466' } });
    expect(surfaces[1]).toMatchObject({ name: 'Front · Display', nodePath: '0/0', materialIndex: 1, color: { base: '#112233' } });
    expect(surfaces[1].luminosity.base).toBeGreaterThan(0);
    expect(objectAtGlbNodePath(root, '0/0')).toBe(mesh);
  });

  it('retains shared-material and original-color groups for bulk editing', () => {
    const root = new THREE.Group();
    const shared = new THREE.MeshStandardMaterial({ name: 'Oak', color: 0x9a714f });
    const sameColor = new THREE.MeshStandardMaterial({ name: 'Oak trim', color: 0x9a714f });
    root.add(
      new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), shared),
      new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), shared),
      new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), sameColor),
    );

    const surfaces = discoverGlbSurfaces(root);
    expect(surfaces[0].sourceMaterialKey).toBe(surfaces[1].sourceMaterialKey);
    expect(surfaces[2].sourceMaterialKey).not.toBe(surfaces[0].sourceMaterialKey);
    expect(surfaces.map((surface) => surface.sourceColor)).toEqual(['#9a714f', '#9a714f', '#9a714f']);
  });
});
