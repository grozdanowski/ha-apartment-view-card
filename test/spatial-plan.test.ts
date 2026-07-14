import { describe, expect, it } from 'vitest';
import {
  addSpatialVertex,
  addSpatialWall,
  addSpatialElement,
  deriveSpatialRooms,
  duplicateSpatialElement,
  emptySpatialPlan,
  moveSpatialVertex,
  nearestSpatialVertex,
  rectangularSpatialPlan,
  removeSpatialElement,
  removeSpatialWall,
  snapSpatialPoint,
  updateSpatialWall,
  updateSpatialElement,
} from '../src/core/spatial-plan';
import { createSpatialPrimitive } from '../src/core/spatial-elements';

describe('spatial plan mutations', () => {
  it('creates a closed rectangular starter home', () => {
    const plan = rectangularSpatialPlan(7.5, 5.2);
    expect(plan.vertices).toHaveLength(4);
    expect(plan.walls).toHaveLength(4);
    expect(plan.rooms[0].boundary).toHaveLength(4);
    expect(plan.vertices[2]).toMatchObject({ x: 7.5, z: 5.2 });
  });

  it('snaps, finds, adds, and moves shared vertices', () => {
    let plan = emptySpatialPlan();
    const first = addSpatialVertex(plan, snapSpatialPoint({ x: 1.04, z: 2.07 }));
    plan = first.plan;
    expect(first.vertex).toMatchObject({ x: 1, z: 2.1 });
    expect(nearestSpatialVertex(plan, { x: 1.1, z: 2.1 }, 0.15)?.id).toBe(first.vertex.id);
    plan = moveSpatialVertex(plan, first.vertex.id, { x: 1.5, z: 2.5 });
    expect(plan.vertices[0]).toMatchObject({ x: 1.5, z: 2.5 });
  });

  it('adds each physical wall once and edits its geometry', () => {
    let plan = emptySpatialPlan();
    const a = addSpatialVertex(plan, { x: 0, z: 0 }); plan = a.plan;
    const b = addSpatialVertex(plan, { x: 4, z: 0 }); plan = b.plan;
    plan = addSpatialWall(plan, a.vertex.id, b.vertex.id);
    plan = addSpatialWall(plan, b.vertex.id, a.vertex.id);
    expect(plan.walls).toHaveLength(1);
    plan = updateSpatialWall(plan, plan.walls[0].id, { thickness: 0.2, curve: -0.3, height: 2.8 });
    expect(plan.walls[0]).toMatchObject({ thickness: 0.2, curve: -0.3, height: 2.8 });
  });

  it('removes invalidated room boundaries with a deleted wall', () => {
    const plan = rectangularSpatialPlan();
    const next = removeSpatialWall(plan, 'wall-1');
    expect(next.walls).toHaveLength(3);
    expect(next.rooms).toEqual([]);
  });

  it('derives two enclosed rooms around a shared divider', () => {
    let plan = rectangularSpatialPlan(8, 6);
    const top = addSpatialVertex(plan, { x: 4, z: 0 });
    plan = top.plan;
    const bottom = addSpatialVertex(plan, { x: 4, z: 6 });
    plan = bottom.plan;
    plan = {
      ...plan,
      walls: [
        { id: 'north-west', start: 'vertex-1', end: top.vertex.id, thickness: 0.18, curve: 0 },
        { id: 'north-east', start: top.vertex.id, end: 'vertex-2', thickness: 0.18, curve: 0 },
        plan.walls[1],
        { id: 'south-east', start: 'vertex-3', end: bottom.vertex.id, thickness: 0.18, curve: 0 },
        { id: 'south-west', start: bottom.vertex.id, end: 'vertex-4', thickness: 0.18, curve: 0 },
        plan.walls[3],
        { id: 'divider', start: top.vertex.id, end: bottom.vertex.id, thickness: 0.12, curve: 0 },
      ],
      rooms: [],
    };

    const rooms = deriveSpatialRooms(plan);
    expect(rooms).toHaveLength(2);
    expect(rooms.every((room) => room.boundary.some((edge) => edge.wallId === 'divider'))).toBe(true);
  });

  it('preserves room metadata when its wall boundary survives', () => {
    const plan = rectangularSpatialPlan(8, 6);
    plan.rooms[0] = {
      ...plan.rooms[0],
      id: 'living-room-face',
      zoneId: 'living-room',
      floorFinish: 'stone',
      floorColor: '#222222',
    };
    expect(deriveSpatialRooms(plan)).toEqual([expect.objectContaining({
      id: 'living-room-face',
      zoneId: 'living-room',
      floorFinish: 'stone',
      floorColor: '#222222',
    })]);
  });

  it('does not create a room from an open wall chain', () => {
    const plan = rectangularSpatialPlan(8, 6);
    expect(deriveSpatialRooms({ ...plan, walls: plan.walls.slice(0, 3), rooms: [] })).toEqual([]);
  });

  it('adds, transforms, duplicates, and removes an Element', () => {
    let plan = addSpatialElement(rectangularSpatialPlan(), 'custom', { x: 2, z: 3 }, {
      name: 'Sofa',
      primitives: [createSpatialPrimitive('seat', 'cube', {
        color: { base: '#445566', rules: [{ operator: 'equals', compare: 'on', value: '#ffffff' }] },
      })],
    });
    expect(plan.elements[0]).toMatchObject({ id: 'custom-1', type: 'custom', position: { x: 2, y: 0, z: 3 } });
    plan = updateSpatialElement(plan, 'custom-1', { rotation: { x: 0, y: 90, z: 0 }, scale: { x: 1.2, y: 1, z: 1 } });
    expect(plan.elements[0]).toMatchObject({ rotation: { y: 90 }, scale: { x: 1.2 } });

    plan = duplicateSpatialElement(plan, 'custom-1');
    expect(plan.elements[1]).toMatchObject({ id: 'custom-2', name: 'Sofa copy', position: { x: 2.25, z: 3.25 } });
    expect(plan.elements[1].primitives[0]).not.toBe(plan.elements[0].primitives[0]);
    expect(plan.elements[1].primitives[0].color.rules[0]).not.toBe(plan.elements[0].primitives[0].color.rules[0]);

    expect(removeSpatialElement(plan, 'custom-1').elements.map((element) => element.id)).toEqual(['custom-2']);
  });

  it('duplicates GLB surface rules without sharing mutable configuration', () => {
    let plan = addSpatialElement(rectangularSpatialPlan(), 'glb', { x: 2, z: 2 }, {
      name: 'Television',
      glb: {
        fileName: 'tv.glb', uri: 'data:model/gltf-binary;base64,AAAA', byteLength: 3,
        size: { x: 1.4, y: 0.8, z: 0.12 },
        surfaces: [{
          id: 'screen', name: 'Screen', nodePath: '0', materialIndex: 0,
          color: { base: '#111111', rules: [{ operator: 'equals', compare: 'on', value: '#ffffff' }] },
          luminosity: { base: 0, rules: [{ operator: 'equals', compare: 'on', value: 0.8 }] },
        }],
      },
    });

    plan = duplicateSpatialElement(plan, 'glb-1');
    expect(plan.elements[1].glb).not.toBe(plan.elements[0].glb);
    expect(plan.elements[1].glb?.surfaces[0]).not.toBe(plan.elements[0].glb?.surfaces[0]);
    expect(plan.elements[1].glb?.surfaces[0].luminosity.rules[0]).not.toBe(plan.elements[0].glb?.surfaces[0].luminosity.rules[0]);
  });
});
