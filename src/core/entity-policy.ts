import type { HassEntity } from './ha-types';
import type {
  EntityConfig,
  MarkerVisibility,
  PresentationPreset,
  TapAction,
} from './config';
import type { Attention } from './attention';

function domain(entityId: string): string {
  return entityId.split('.')[0] ?? '';
}

/** Conservative interaction default for newly added entities. */
export function suggestedTapAction(entityId: string): TapAction {
  switch (domain(entityId)) {
    case 'sensor':
    case 'binary_sensor':
    case 'person':
    case 'device_tracker':
    case 'weather':
      return 'more-info';
    case 'lock':
    case 'alarm_control_panel':
      return 'more-info';
    default:
      return 'toggle';
  }
}

export function suggestedOverviewVisibility(entityId: string): MarkerVisibility {
  switch (domain(entityId)) {
    case 'sensor':
    case 'binary_sensor':
    case 'device_tracker':
    case 'update':
      return 'attention';
    case 'media_player':
    case 'climate':
    case 'fan':
    case 'vacuum':
      return 'active';
    case 'light':
      return 'hidden';
    default:
      return 'auto';
  }
}

export function suggestedRoomVisibility(entityId: string): MarkerVisibility {
  switch (domain(entityId)) {
    case 'sensor':
    case 'binary_sensor':
    case 'device_tracker':
    case 'update':
      return 'attention';
    default:
      return 'always';
  }
}

export function withSuggestedEntityPolicy(entity: EntityConfig): EntityConfig {
  return {
    ...entity,
    tap: suggestedTapAction(entity.entity),
    overviewVisibility: suggestedOverviewVisibility(entity.entity),
    roomVisibility: suggestedRoomVisibility(entity.entity),
  };
}

function policyFor(
  entity: EntityConfig,
  preset: PresentationPreset,
  roomFocused: boolean,
): MarkerVisibility {
  const explicit = roomFocused ? entity.roomVisibility : entity.overviewVisibility;
  if (explicit) return explicit;
  if (preset === 'control-heavy') return 'always';
  if (preset === 'informative') {
    return roomFocused ? 'always' : 'auto';
  }
  return roomFocused
    ? suggestedRoomVisibility(entity.entity)
    : suggestedOverviewVisibility(entity.entity);
}

export interface MarkerPolicyContext {
  state: HassEntity | undefined;
  active: boolean;
  attention: Attention | null;
  roomFocused: boolean;
  selectMode: boolean;
}

/** Decide whether a marker earns visual space in the current context. */
export function markerIsVisible(
  entity: EntityConfig,
  preset: PresentationPreset,
  context: MarkerPolicyContext,
): boolean {
  if (context.selectMode) return true;
  if (context.attention) return true;
  const policy = policyFor(entity, preset, context.roomFocused);
  if (policy === 'always') return true;
  if (policy === 'hidden' || policy === 'attention') return false;
  if (policy === 'active') return context.active;

  if (preset === 'informative') {
    if (context.roomFocused) return true;
    const d = domain(entity.entity);
    return context.active || d === 'lock' || d === 'alarm_control_panel';
  }
  return context.active;
}
