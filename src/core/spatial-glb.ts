import * as THREE from 'three';
import type { SpatialGlbSurface } from './config';
import { staticSpatialValue } from './spatial-elements';

export interface SpatialGlbSurfaceCandidate extends SpatialGlbSurface {
  meshName: string;
  materialName: string;
}

function materialColor(material: THREE.Material): string {
  const color = (material as THREE.Material & { color?: THREE.Color }).color;
  return `#${(color ?? new THREE.Color(0xd6dcda)).getHexString()}`;
}

function materialLuminosity(material: THREE.Material): number {
  if (!(material instanceof THREE.MeshStandardMaterial)) return 0;
  const strength = Math.max(material.emissive.r, material.emissive.g, material.emissive.b) * material.emissiveIntensity;
  return THREE.MathUtils.clamp(strength / 3.5, 0, 1);
}

/** Discover each independently addressable material slot using stable child-index paths. */
export function discoverGlbSurfaces(root: THREE.Object3D): SpatialGlbSurfaceCandidate[] {
  const surfaces: SpatialGlbSurfaceCandidate[] = [];
  const usedIds = new Set<string>();
  const unnamedMaterials = new WeakMap<THREE.Material, string>();
  let unnamedMaterialCount = 0;
  const walk = (node: THREE.Object3D, path: string): void => {
    if (node instanceof THREE.Mesh) {
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      materials.forEach((material, materialIndex) => {
        const meshName = node.name.trim() || `Mesh ${path}`;
        const materialName = material.name.trim() || (materials.length > 1 ? `Material ${materialIndex + 1}` : 'Surface');
        const normalizedMaterialName = material.name.trim().toLowerCase().replace(/\s+/g, '-');
        let sourceMaterialKey = normalizedMaterialName ? `name:${normalizedMaterialName}` : unnamedMaterials.get(material);
        if (!sourceMaterialKey) {
          sourceMaterialKey = `material:${++unnamedMaterialCount}`;
          unnamedMaterials.set(material, sourceMaterialKey);
        }
        const sourceColor = materialColor(material);
        const base = `${meshName}-${materialName}`
          .normalize('NFKD')
          .replace(/[\u0300-\u036f]/g, '')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '') || `surface-${surfaces.length + 1}`;
        let id = base;
        let suffix = 2;
        while (usedIds.has(id)) id = `${base}-${suffix++}`;
        usedIds.add(id);
        surfaces.push({
          id,
          name: materialName === 'Surface' ? meshName : `${meshName} · ${materialName}`,
          meshName,
          materialName,
          nodePath: path,
          materialIndex,
          sourceMaterialKey,
          sourceColor,
          color: staticSpatialValue(sourceColor),
          luminosity: staticSpatialValue(materialLuminosity(material)),
        });
      });
    }
    node.children.forEach((child, index) => walk(child, path ? `${path}/${index}` : String(index)));
  };
  root.children.forEach((child, index) => walk(child, String(index)));
  return surfaces;
}

export function objectAtGlbNodePath(root: THREE.Object3D, path: string): THREE.Object3D | undefined {
  let node: THREE.Object3D | undefined = root;
  for (const part of path.split('/')) {
    const index = Number(part);
    if (!node || !Number.isInteger(index)) return undefined;
    node = node.children[index];
  }
  return node;
}
