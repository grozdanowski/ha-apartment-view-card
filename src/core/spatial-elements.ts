import type { HassEntity } from './ha-types';
import type {
  SpatialConditionalValue,
  SpatialElementPrimitive,
  SpatialElementType,
  SpatialPrimitiveKind,
  SpatialRotation,
  SpatialVector3,
} from './config';

const ZERO: SpatialVector3 = { x: 0, y: 0, z: 0 };
const ROTATION: SpatialRotation = { x: 0, y: 0, z: 0 };

export function staticSpatialValue<T>(base: T): SpatialConditionalValue<T> {
  return { base, rules: [] };
}

export function createSpatialPrimitive(
  id: string,
  kind: SpatialPrimitiveKind = 'cube',
  patch: Partial<SpatialElementPrimitive> = {},
): SpatialElementPrimitive {
  return {
    id,
    kind,
    position: { ...ZERO },
    rotation: { ...ROTATION },
    size: { x: 0.5, y: 0.5, z: 0.5 },
    bevel: kind === 'cube' ? 0.04 : kind === 'cylinder' ? 0.025 : 0,
    color: staticSpatialValue('#d6dcda'),
    luminosity: staticSpatialValue(0),
    waves: staticSpatialValue(0),
    ...patch,
  };
}

export function elementPrimitivesForType(type: SpatialElementType): SpatialElementPrimitive[] {
  if (type === 'glb') return [];
  if (type === 'ceiling-light' || type === 'light-bulb') {
    return [createSpatialPrimitive('emission', 'sphere', {
      name: 'Light emission',
      size: { x: 0.1, y: 0.1, z: 0.1 },
      color: staticSpatialValue('#fff4d8'),
      luminosity: {
        base: 0,
        rules: [{ operator: 'equals', compare: 'on', value: 1 }],
      },
    })];
  }
  return [createSpatialPrimitive('part-1', 'cube', { name: 'Part 1' })];
}

function matches(actual: unknown, operator: string, expected: unknown): boolean {
  if (operator === 'not-equals') return String(actual) !== String(expected);
  if (operator === 'above') return Number.isFinite(Number(actual)) && Number(actual) > Number(expected);
  if (operator === 'below') return Number.isFinite(Number(actual)) && Number(actual) < Number(expected);
  return String(actual) === String(expected);
}

export function resolveSpatialValue<T>(
  value: SpatialConditionalValue<T>,
  states: Record<string, HassEntity>,
  elementEntityId?: string,
): T {
  let resolved = value.base;
  value.rules.forEach((rule) => {
    const state = states[rule.entityId ?? elementEntityId ?? ''];
    if (!state) return;
    const actual = rule.attribute ? state.attributes?.[rule.attribute] : state.state;
    if (matches(actual, rule.operator, rule.compare)) resolved = rule.value;
  });
  return resolved;
}
