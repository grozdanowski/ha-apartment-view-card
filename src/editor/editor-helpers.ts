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

export function imagesOptionsSchema(): HaFormSchema[] {
  return [
    { name: 'base', required: true, selector: { text: {} } },
    { name: 'allLights', selector: { text: {} } },
    { name: 'night', selector: { text: {} } },
    { name: 'duskDawn', selector: { text: {} } },
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
  ];
}

export function entitySchema(directional: boolean): HaFormSchema[] {
  const schema: HaFormSchema[] = [
    // Entity selector is intentionally NOT domain-limited (spec §7).
    { name: 'entity', required: true, selector: { entity: {} } },
    { name: 'name', selector: { text: {} } },
    { name: 'icon', selector: { icon: {} } },
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
  ];
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
  };
  if (directional) {
    form.orientation = e.orientation as number;
  }
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

  // 'directional' is a transient UI-only field; never persist it.
  delete merged.directional;
  return merged as EntityConfig;
}
