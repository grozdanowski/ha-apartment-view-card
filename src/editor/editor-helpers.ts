import type {
  CardOptions,
  EntityConfig,
  LightStyle,
  SizeTier,
  TapAction,
  ZoneConfig,
} from '../core/config';

/**
 * Loose structural type for a single ha-form schema row. ha-form accepts a much
 * wider shape; we only model the keys the editor sets.
 */
export interface HaFormSchema {
  name: string;
  selector?: any;
  type?: string;
  required?: boolean;
  default?: any;
}

export function defaultEntity(): EntityConfig {
  return {
    entity: '',
    x: 50,
    y: 50,
    size: 'small',
    tap: 'toggle',
    orientation: null,
  };
}

export function defaultZone(): ZoneConfig {
  return {
    name: 'New zone',
    x: 25,
    y: 25,
    width: 50,
    height: 50,
  };
}

export function isDirectional(
  orientation: number | null | undefined,
): boolean {
  return typeof orientation === 'number';
}

const LIGHT_STYLE_OPTIONS: { value: LightStyle; label: string }[] = [
  { value: 'lit', label: 'Lit (render-free)' },
  { value: 'reveal', label: 'Reveal (needs all-lights)' },
  { value: 'glow', label: 'Glow (flat color)' },
];

const VIEW_OPTIONS: { value: CardOptions['view']; label: string }[] = [
  { value: 'auto', label: 'Auto (sun-based)' },
  { value: 'day', label: 'Day' },
  { value: 'night', label: 'Night' },
  { value: 'duskDawn', label: 'Dusk / Dawn' },
];

const SIZE_OPTIONS: { value: SizeTier; label: string }[] = [
  { value: 'tiny', label: 'Tiny' },
  { value: 'small', label: 'Small' },
  { value: 'medium', label: 'Medium' },
  { value: 'large', label: 'Large' },
  { value: 'huge', label: 'Huge' },
];

const TAP_OPTIONS: { value: TapAction; label: string }[] = [
  { value: 'toggle', label: 'Toggle' },
  { value: 'more-info', label: 'More info' },
  { value: 'none', label: 'None' },
];

/** Per-entity label source. 'inherit' = no per-entity label (use the global default). */
const LABEL_SOURCE_OPTIONS = [
  { value: 'inherit', label: 'Inherit from card default' },
  { value: 'none', label: 'No label' },
  { value: 'state', label: 'State' },
  { value: 'static', label: 'Custom text…' },
  { value: 'attribute', label: 'Attribute…' },
  { value: 'climate-current', label: 'Temperature (current)' },
  { value: 'climate-target', label: 'Temperature (target)' },
  { value: 'media-title', label: 'Now playing' },
  { value: 'media-source', label: 'Media source' },
  { value: 'light-brightness', label: 'Brightness %' },
  { value: 'cover-position', label: 'Cover position %' },
  { value: 'fan-percentage', label: 'Fan speed %' },
  { value: 'battery', label: 'Battery %' },
  { value: 'sensor', label: 'Sensor value' },
  { value: 'last-changed', label: 'Last changed' },
];

/** Global label default adds 'smart' (per-domain preset) and drops 'inherit'. */
const GLOBAL_LABEL_SOURCE_OPTIONS = [
  { value: 'none', label: 'Off' },
  { value: 'smart', label: 'Smart (per device type)' },
  ...LABEL_SOURCE_OPTIONS.filter((o) => o.value !== 'inherit' && o.value !== 'none'),
];

const LABEL_VISIBILITY_OPTIONS = [
  { value: 'auto', label: 'Auto (on zoom / zone focus)' },
  { value: 'always', label: 'Always' },
  { value: 'active', label: 'When active' },
  { value: 'never', label: 'Never' },
];

/** ha-form schema for the global label defaults (card options.labels). */
export function labelsSchema(): HaFormSchema[] {
  return [
    { name: 'source', selector: { select: { mode: 'dropdown', options: GLOBAL_LABEL_SOURCE_OPTIONS } } },
    { name: 'visibility', selector: { select: { mode: 'dropdown', options: LABEL_VISIBILITY_OPTIONS } } },
  ];
}

/**
 * Image fields are rendered with <ha-picture-upload> (HA's click-to-upload /
 * "Pick media" widget) rather than a ha-form selector — HA has no `image`
 * form selector, and a plain text field can't upload. Order = render order.
 */
export type ImageFieldKey = 'base' | 'allLights' | 'night' | 'duskDawn';
export interface ImageFieldDef {
  key: ImageFieldKey;
  label: string;
  required?: boolean;
}
export const IMAGE_FIELDS: ImageFieldDef[] = [
  { key: 'base', label: 'Base render (required)', required: true },
  { key: 'allLights', label: 'All-lights render (enables "reveal")' },
  { key: 'night', label: 'Night render (optional)' },
  { key: 'duskDawn', label: 'Dusk/Dawn render (optional)' },
];

/** ha-form schema for the non-image card options only. */
export function optionsSchema(): HaFormSchema[] {
  return [
    {
      name: 'view',
      selector: { select: { mode: 'dropdown', options: VIEW_OPTIONS } },
    },
    {
      name: 'lightStyle',
      selector: { select: { mode: 'dropdown', options: LIGHT_STYLE_OPTIONS } },
    },
    { name: 'freePanZoom', selector: { boolean: {} } },
    {
      name: 'zoomMax',
      selector: { number: { min: 1, max: 5, step: 0.1, mode: 'slider' } },
    },
    {
      name: 'duskDawnOffsetMinutes',
      selector: {
        number: { min: 0, max: 180, step: 5, mode: 'slider', unit_of_measurement: 'min' },
      },
    },
    {
      name: 'iconSize',
      selector: { number: { min: 24, max: 80, step: 1, mode: 'slider', unit_of_measurement: 'px' } },
    },
    {
      name: 'iconSizeMax',
      selector: { number: { min: 30, max: 160, step: 2, mode: 'slider', unit_of_measurement: 'px' } },
    },
    {
      name: 'iconSizeMobile',
      selector: { number: { min: 24, max: 96, step: 1, mode: 'slider', unit_of_measurement: 'px' } },
    },
    {
      name: 'iconSizeMaxMobile',
      selector: { number: { min: 30, max: 200, step: 2, mode: 'slider', unit_of_measurement: 'px' } },
    },
  ];
}

/** Floorplan-tab options (the static stage): everything except the light style. */
export function stageOptionsSchema(): HaFormSchema[] {
  return optionsSchema().filter((s) => s.name !== 'lightStyle');
}
/** Lighting-tab options: just the global light style. */
export function lightingOptionsSchema(): HaFormSchema[] {
  return optionsSchema().filter((s) => s.name === 'lightStyle');
}

export function entitySchema(directional: boolean, labelSource = 'inherit'): HaFormSchema[] {
  const schema: HaFormSchema[] = [
    // Entity selector is intentionally NOT domain-limited (spec §7).
    { name: 'entity', required: true, selector: { entity: {} } },
    { name: 'name', selector: { text: {} } },
    { name: 'icon', selector: { icon: {} } },
    {
      name: 'labelSource',
      selector: { select: { mode: 'dropdown', options: LABEL_SOURCE_OPTIONS } },
    },
  ];
  if (labelSource === 'static') {
    schema.push({ name: 'labelText', selector: { text: {} } });
  } else if (labelSource === 'attribute') {
    schema.push({ name: 'labelAttribute', selector: { text: {} } });
  }
  if (labelSource !== 'inherit' && labelSource !== 'none') {
    schema.push({
      name: 'labelVisibility',
      selector: { select: { mode: 'dropdown', options: LABEL_VISIBILITY_OPTIONS } },
    });
  }
  schema.push(
    {
      name: 'size',
      selector: { select: { mode: 'dropdown', options: SIZE_OPTIONS } },
    },
    {
      name: 'tap',
      selector: { select: { mode: 'dropdown', options: TAP_OPTIONS } },
    },
    {
      name: 'lightStyle',
      selector: { select: { mode: 'dropdown', options: LIGHT_STYLE_OPTIONS } },
    },
    {
      name: 'x',
      selector: { number: { min: 0, max: 100, step: 0.5, mode: 'slider' } },
    },
    {
      name: 'y',
      selector: { number: { min: 0, max: 100, step: 0.5, mode: 'slider' } },
    },
    { name: 'directional', selector: { boolean: {} } },
  );
  if (directional) {
    schema.push({
      name: 'orientation',
      selector: {
        number: { min: 0, max: 359, step: 1, mode: 'slider', unit_of_measurement: '°' },
      },
    });
  }
  return schema;
}

/** Quick-action row (radial ⚡ menu): name + icon + target. The entity
 *  selector covers the common case (scenes/scripts/anything activatable via
 *  homeassistant.turn_on); the service text field is the advanced override. */
export function quickActionSchema(): HaFormSchema[] {
  return [
    { name: 'name', required: true, selector: { text: {} } },
    { name: 'icon', selector: { icon: {} } },
    { name: 'entity', selector: { entity: {} } },
    { name: 'service', selector: { text: {} } },
  ];
}

export function zoneSchema(): HaFormSchema[] {
  return [
    { name: 'name', required: true, selector: { text: {} } },
    { name: 'icon', selector: { icon: {} } },
    {
      name: 'x',
      selector: { number: { min: 0, max: 100, step: 0.5, mode: 'slider' } },
    },
    {
      name: 'y',
      selector: { number: { min: 0, max: 100, step: 0.5, mode: 'slider' } },
    },
    {
      name: 'width',
      selector: { number: { min: 1, max: 100, step: 0.5, mode: 'slider' } },
    },
    {
      name: 'height',
      selector: { number: { min: 1, max: 100, step: 0.5, mode: 'slider' } },
    },
  ];
}

export interface EntityFormData {
  entity: string;
  name?: string;
  icon?: string;
  size: SizeTier;
  tap: TapAction;
  lightStyle?: LightStyle;
  x: number;
  y: number;
  directional: boolean;
  orientation?: number;
  /** 'inherit' when no per-entity label is set; else the label source. */
  labelSource: string;
  labelText?: string;
  labelAttribute?: string;
  labelVisibility?: string;
}

export function entityToForm(e: EntityConfig): EntityFormData {
  const directional = isDirectional(e.orientation);
  const form: EntityFormData = {
    entity: e.entity,
    name: e.name,
    icon: e.icon,
    size: e.size,
    tap: e.tap,
    lightStyle: e.lightStyle,
    x: e.x,
    y: e.y,
    directional,
    labelSource: e.label ? e.label.source : 'inherit',
  };
  if (directional) {
    form.orientation = e.orientation as number;
  }
  if (e.label?.text) form.labelText = e.label.text;
  if (e.label?.attribute) form.labelAttribute = e.label.attribute;
  if (e.label?.visibility) form.labelVisibility = e.label.visibility;
  return form;
}

export function formToEntity(
  prev: EntityConfig,
  data: Partial<EntityFormData>,
): EntityConfig {
  // Start from prev (preserves unknown keys), overlay the form patch.
  const merged: any = { ...prev, ...data };

  // The directional toggle is authoritative over the nullable orientation.
  const directional =
    'directional' in data ? data.directional : isDirectional(prev.orientation);

  if (directional) {
    const angle =
      typeof data.orientation === 'number'
        ? data.orientation
        : typeof prev.orientation === 'number'
          ? prev.orientation
          : 0;
    merged.orientation = angle;
  } else {
    merged.orientation = null;
  }

  // Rebuild the nested label config from the flat form fields.
  const ls = merged.labelSource as string | undefined;
  if (!ls || ls === 'inherit') {
    delete merged.label;
  } else if (ls === 'none') {
    merged.label = { source: 'none' };
  } else {
    const label: any = { source: ls };
    if (ls === 'static' && merged.labelText) label.text = merged.labelText;
    if (ls === 'attribute' && merged.labelAttribute) label.attribute = merged.labelAttribute;
    if (merged.labelVisibility && merged.labelVisibility !== 'auto') label.visibility = merged.labelVisibility;
    merged.label = label;
  }

  // Transient UI-only fields; never persist them.
  delete merged.directional;
  delete merged.labelSource;
  delete merged.labelText;
  delete merged.labelAttribute;
  delete merged.labelVisibility;
  return merged as EntityConfig;
}
