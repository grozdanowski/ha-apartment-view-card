import type { HassEntity } from './ha-types';

/**
 * Auto-derived "needs attention" detection for markers. Turns the floorplan
 * from a pretty display into a daily-check tool: a door left open, a leak, an
 * unlocked door, a low battery, or an offline device surface a corner badge and
 * feed the card-level "N need attention" count. Only genuinely-abnormal states
 * badge — a closed door or a locked door is silent — so it stays calm.
 */

export type AttentionKind =
  | 'offline'
  | 'open'
  | 'unlocked'
  | 'leak'
  | 'smoke'
  | 'battery'
  | 'problem';

export type AttentionSeverity = 'critical' | 'warning' | 'info';

export interface Attention {
  kind: AttentionKind;
  label: string;
  severity: AttentionSeverity;
}

const OPEN_CLASSES = new Set(['door', 'window', 'garage_door', 'opening']);
const SMOKE_CLASSES = new Set(['smoke', 'gas', 'carbon_monoxide']);
const LOW_BATTERY = 20;

export const ATTENTION_ICON: Record<AttentionKind, string> = {
  offline: 'mdi:wifi-off',
  open: 'mdi:door-open',
  unlocked: 'mdi:lock-open-variant',
  leak: 'mdi:water-alert',
  smoke: 'mdi:smoke-detector-variant-alert',
  battery: 'mdi:battery-alert',
  problem: 'mdi:alert-circle',
};

/** Returns the attention state for an entity, or null when nothing is wrong. */
export function attentionFor(state: HassEntity | undefined): Attention | null {
  if (!state) return { kind: 'offline', label: 'Unavailable', severity: 'info' };
  const s = state.state;
  if (s === 'unavailable' || s === 'unknown') {
    return { kind: 'offline', label: 'Unavailable', severity: 'info' };
  }
  const domain = state.entity_id.split('.')[0];
  const dc = state.attributes?.device_class;

  // Low battery applies across domains (a phone, a sensor, a binary low-battery flag).
  const level =
    typeof state.attributes?.battery_level === 'number'
      ? state.attributes.battery_level
      : domain === 'sensor' && dc === 'battery' && Number.isFinite(Number(s))
        ? Number(s)
        : null;
  if (level !== null && level <= LOW_BATTERY) {
    return { kind: 'battery', label: `Battery ${Math.round(level)}%`, severity: 'warning' };
  }

  if (domain === 'lock' && s === 'unlocked') {
    return { kind: 'unlocked', label: 'Unlocked', severity: 'warning' };
  }

  if (domain === 'binary_sensor' && s === 'on') {
    if (dc === 'moisture') return { kind: 'leak', label: 'Leak detected', severity: 'critical' };
    if (typeof dc === 'string' && SMOKE_CLASSES.has(dc)) {
      return { kind: 'smoke', label: 'Smoke / gas', severity: 'critical' };
    }
    if (typeof dc === 'string' && OPEN_CLASSES.has(dc)) {
      return { kind: 'open', label: 'Open', severity: 'warning' };
    }
    if (dc === 'battery') return { kind: 'battery', label: 'Battery low', severity: 'warning' };
    if (dc === 'problem') return { kind: 'problem', label: 'Problem', severity: 'warning' };
  }

  return null;
}
