import type { HassEntity, HassLike } from './ha-types';
import { isActive } from './entity-state';

/**
 * Marker label system. A marker may carry an optional text label that reads a
 * live value — a static string, the entity state, a named attribute, or a
 * self-describing dynamic preset. Resolution is pure + capability-honest:
 * a preset returns `null` (render nothing) when its datum is absent, rather
 * than leaking `undefined`/`unknown` onto the floorplan. Numbers format through
 * the HA locale; the `state` source degrades gracefully on older cores.
 */

export type LabelSource =
  | 'none'
  | 'static'
  | 'state'
  | 'attribute'
  | 'climate-current'
  | 'climate-target'
  | 'media-title'
  | 'media-source'
  | 'light-brightness'
  | 'cover-position'
  | 'fan-percentage'
  | 'battery'
  | 'sensor'
  | 'last-changed';

export type LabelVisibility = 'auto' | 'always' | 'active' | 'never';

export interface LabelConfig {
  source: LabelSource;
  /** Required when source === 'static'. */
  text?: string;
  /** Required when source === 'attribute'. */
  attribute?: string;
  /** Per-entity override; inherits the global default when omitted. */
  visibility?: LabelVisibility;
}

export interface LabelDefaults {
  /** 'smart' expands to a per-domain preset (see {@link smartSource}). */
  source: LabelSource | 'smart';
  visibility: LabelVisibility;
  /** Final safety ceiling on simultaneously-shown auto labels (collision cull runs first). */
  densityCap: number;
}

export const DEFAULT_LABELS: LabelDefaults = {
  source: 'none',
  visibility: 'auto',
  densityCap: 14,
};

export const VALID_LABEL_SOURCES: readonly LabelSource[] = [
  'none', 'static', 'state', 'attribute', 'climate-current', 'climate-target',
  'media-title', 'media-source', 'light-brightness', 'cover-position',
  'fan-percentage', 'battery', 'sensor', 'last-changed',
];
export const VALID_LABEL_VISIBILITIES: readonly LabelVisibility[] = [
  'auto', 'always', 'active', 'never',
];

/**
 * Per-domain preset chosen by `source: smart`. Only domains whose key datum the
 * ambient layer does NOT already encode get a preset — lights stay silent
 * because the brightness ring already says it.
 */
const SMART: Record<string, LabelSource> = {
  climate: 'climate-current',
  media_player: 'media-title',
  cover: 'cover-position',
  sensor: 'sensor',
};

export function smartSource(domain: string): LabelSource {
  return SMART[domain] ?? 'none';
}

function domainOf(entityId: string): string {
  return (entityId.split('.')[0] || '').toLowerCase();
}

/**
 * Effective label config for an entity: a per-entity `label` FULLY replaces the
 * global default (matching how `lightStyle` overrides work); otherwise the
 * global default applies, expanding `smart` to the domain preset. Returns null
 * when the effective source is 'none'.
 */
export function effectiveLabel(
  entityLabel: LabelConfig | undefined,
  defaults: LabelDefaults,
  entityId: string,
): LabelConfig | null {
  if (entityLabel) {
    return entityLabel.source === 'none' ? null : entityLabel;
  }
  const source =
    defaults.source === 'smart' ? smartSource(domainOf(entityId)) : defaults.source;
  if (source === 'none') return null;
  return { source, visibility: defaults.visibility };
}

function fmtNum(hass: HassLike | undefined, value: number, maxFrac = 0): string {
  const lang = hass?.locale?.language;
  try {
    return new Intl.NumberFormat(lang || undefined, { maximumFractionDigits: maxFrac }).format(value);
  } catch {
    return String(maxFrac ? value : Math.round(value));
  }
}

function tempUnit(hass: HassLike | undefined): string {
  const u = hass?.config?.unit_system?.temperature;
  return typeof u === 'string' && u.length ? u : '°';
}

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** Coarse relative time ("just now", "3 min ago", "2 hr ago", "5 days ago"). */
export function relativeTime(iso: string | undefined, nowMs: number): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const sec = Math.max(0, Math.round((nowMs - t) / 1000));
  if (sec < 45) return 'just now';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const day = Math.round(hr / 24);
  return `${day} day${day === 1 ? '' : 's'} ago`;
}

/**
 * Resolve a label config to its display text, or null to render nothing.
 * Offline/unavailable suppression is a SEPARATE concern handled at render
 * (the marker offline treatment hides labels regardless of source).
 */
export function formatLabel(
  cfg: LabelConfig,
  state: HassEntity | undefined,
  hass?: HassLike,
  nowMs: number = Date.now(),
): string | null {
  if (cfg.source === 'static') {
    return cfg.text && cfg.text.length ? cfg.text : null;
  }
  if (!state) return null;
  const a = state.attributes ?? {};

  switch (cfg.source) {
    case 'state': {
      const f = hass?.formatEntityState;
      return (f ? f(state) : null) ?? capitalize(state.state);
    }
    case 'attribute': {
      const key = cfg.attribute;
      if (!key) return null;
      const v = a[key];
      if (v == null || v === '') return null;
      if (typeof v === 'number') {
        const unit = typeof a.unit_of_measurement === 'string' ? ` ${a.unit_of_measurement}` : '';
        return `${fmtNum(hass, v, 1)}${unit}`;
      }
      return String(v);
    }
    case 'climate-current':
      return typeof a.current_temperature === 'number'
        ? `${fmtNum(hass, a.current_temperature, 1)}${tempUnit(hass)}`
        : null;
    case 'climate-target':
      if (typeof a.temperature === 'number') {
        return `${fmtNum(hass, a.temperature, 1)}${tempUnit(hass)}`;
      }
      if (typeof a.target_temp_low === 'number' && typeof a.target_temp_high === 'number') {
        return `${fmtNum(hass, a.target_temp_low, 1)}–${fmtNum(hass, a.target_temp_high, 1)}${tempUnit(hass)}`;
      }
      return null;
    case 'media-title': {
      const title = a.media_title;
      if (typeof title !== 'string' || !title.length) return null;
      return typeof a.media_artist === 'string' && a.media_artist.length
        ? `${title} — ${a.media_artist}`
        : title;
    }
    case 'media-source': {
      const s = a.source ?? a.app_name;
      return typeof s === 'string' && s.length ? s : null;
    }
    case 'light-brightness':
      if (!isActive(state)) return null;
      return typeof a.brightness === 'number'
        ? `${Math.round((a.brightness / 255) * 100)}%`
        : null;
    case 'cover-position':
      return typeof a.current_position === 'number' ? `${Math.round(a.current_position)}%` : null;
    case 'fan-percentage':
      return typeof a.percentage === 'number' ? `${Math.round(a.percentage)}%` : null;
    case 'battery': {
      if (typeof a.battery_level === 'number') return `${Math.round(a.battery_level)}%`;
      if (a.device_class === 'battery' && Number.isFinite(Number(state.state))) {
        return `${Math.round(Number(state.state))}%`;
      }
      return null;
    }
    case 'sensor': {
      const n = Number(state.state);
      if (!Number.isFinite(n)) return null;
      const unit = typeof a.unit_of_measurement === 'string' ? ` ${a.unit_of_measurement}` : '';
      return `${fmtNum(hass, n, 1)}${unit}`;
    }
    case 'last-changed':
      return relativeTime(state.last_changed, nowMs);
    default:
      return null;
  }
}
