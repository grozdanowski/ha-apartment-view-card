import { describe, it, expect } from 'vitest';
import {
  defaultEntity,
  defaultZone,
  optionsSchema,
  IMAGE_FIELDS,
  entitySchema,
  zoneSchema,
  isDirectional,
  entityToForm,
  formToEntity,
} from '../src/editor/editor-helpers';
import type { EntityConfig } from '../src/core/config';

describe('defaultEntity', () => {
  it('matches the EntityConfig contract defaults', () => {
    expect(defaultEntity()).toEqual({
      entity: '',
      x: 50,
      y: 50,
      size: 'small',
      tap: 'toggle',
      orientation: null,
    });
  });
  it('returns a fresh object each call (no shared reference)', () => {
    expect(defaultEntity()).not.toBe(defaultEntity());
  });
});

describe('defaultZone', () => {
  it('matches the ZoneConfig contract defaults', () => {
    expect(defaultZone()).toEqual({
      name: 'New zone',
      x: 25,
      y: 25,
      width: 50,
      height: 50,
    });
  });
});

describe('isDirectional', () => {
  it('is true only for a numeric orientation', () => {
    expect(isDirectional(0)).toBe(true);
    expect(isDirectional(180)).toBe(true);
    expect(isDirectional(null)).toBe(false);
    expect(isDirectional(undefined)).toBe(false);
  });
});

describe('IMAGE_FIELDS', () => {
  it('lists base (required) + the three optional renders, in render order', () => {
    expect(IMAGE_FIELDS.map((f) => f.key)).toEqual([
      'base',
      'allLights',
      'night',
      'duskDawn',
    ]);
    expect(IMAGE_FIELDS.find((f) => f.key === 'base')!.required).toBe(true);
    expect(IMAGE_FIELDS.find((f) => f.key === 'allLights')!.required).toBeFalsy();
  });
});

describe('optionsSchema', () => {
  const schema = optionsSchema();
  const names = schema.map((s) => s.name);

  it('includes the option keys and NOT the image fields (those use ha-picture-upload)', () => {
    expect(names).toEqual(
      expect.arrayContaining([
        'view',
        'lightStyle',
        'freePanZoom',
        'zoomMax',
        'duskDawnOffsetMinutes',
      ])
    );
    expect(names).not.toContain('base');
    expect(names).not.toContain('allLights');
  });

  it('uses a select selector for view with the four TOD modes', () => {
    const view = schema.find((s) => s.name === 'view')!;
    const opts = view.selector.select.options.map((o: any) => o.value ?? o);
    expect(opts).toEqual(['auto', 'day', 'night', 'duskDawn']);
  });

  it('uses a slider number selector for zoomMax', () => {
    const zoomMax = schema.find((s) => s.name === 'zoomMax')!;
    expect(zoomMax.selector.number.mode).toBe('slider');
    expect(zoomMax.selector.number.min).toBe(1);
  });

  it('uses a boolean selector for freePanZoom', () => {
    const fpz = schema.find((s) => s.name === 'freePanZoom')!;
    expect(fpz.selector.boolean).toBeDefined();
  });
});

describe('entitySchema', () => {
  it('uses a non-domain-limited entity selector', () => {
    const entity = entitySchema(false).find((s) => s.name === 'entity')!;
    // selector.entity must be an empty object — NO domain key
    expect(entity.selector.entity).toEqual({});
  });

  it('uses an icon selector for icon', () => {
    const icon = entitySchema(false).find((s) => s.name === 'icon')!;
    expect(icon.selector.icon).toBeDefined();
  });

  it('uses slider number selectors clamped 0-100 for x and y', () => {
    const x = entitySchema(false).find((s) => s.name === 'x')!;
    expect(x.selector.number.mode).toBe('slider');
    expect(x.selector.number.min).toBe(0);
    expect(x.selector.number.max).toBe(100);
  });

  it('select selectors for size and tap carry the contract values', () => {
    const schema = entitySchema(false);
    const size = schema.find((s) => s.name === 'size')!;
    expect(size.selector.select.options.map((o: any) => o.value)).toEqual([
      'tiny',
      'small',
      'medium',
      'large',
      'huge',
    ]);
    const tap = schema.find((s) => s.name === 'tap')!;
    expect(tap.selector.select.options.map((o: any) => o.value)).toEqual([
      'toggle',
      'more-info',
      'none',
    ]);
  });

  it('always includes the directional boolean toggle', () => {
    expect(entitySchema(false).some((s) => s.name === 'directional')).toBe(true);
    expect(entitySchema(true).some((s) => s.name === 'directional')).toBe(true);
  });

  it('omits the orientation slider when not directional', () => {
    expect(entitySchema(false).some((s) => s.name === 'orientation')).toBe(false);
  });

  it('includes an orientation slider 0-359 when directional', () => {
    const orientation = entitySchema(true).find((s) => s.name === 'orientation')!;
    expect(orientation.selector.number.mode).toBe('slider');
    expect(orientation.selector.number.min).toBe(0);
    expect(orientation.selector.number.max).toBe(359);
  });
});

describe('zoneSchema', () => {
  it('has name (text), icon (icon selector), and slider x/y/width/height', () => {
    const schema = zoneSchema();
    const names = schema.map((s) => s.name);
    expect(names).toEqual(
      expect.arrayContaining(['name', 'icon', 'x', 'y', 'width', 'height'])
    );
    expect(schema.find((s) => s.name === 'icon')!.selector.icon).toBeDefined();
    expect(schema.find((s) => s.name === 'width')!.selector.number.mode).toBe(
      'slider'
    );
  });
});

describe('entityToForm', () => {
  it('null orientation -> directional false, no orientation key', () => {
    const e: EntityConfig = {
      entity: 'light.a',
      x: 10,
      y: 20,
      size: 'small',
      tap: 'toggle',
      orientation: null,
    };
    const form = entityToForm(e);
    expect(form.directional).toBe(false);
    expect('orientation' in form).toBe(false);
    expect(form).toMatchObject({ entity: 'light.a', x: 10, y: 20 });
  });

  it('numeric orientation -> directional true + orientation', () => {
    const e: EntityConfig = {
      entity: 'light.a',
      x: 0,
      y: 0,
      size: 'small',
      tap: 'toggle',
      orientation: 90,
    };
    const form = entityToForm(e);
    expect(form.directional).toBe(true);
    expect(form.orientation).toBe(90);
  });
});

describe('formToEntity', () => {
  const base: EntityConfig = {
    entity: 'light.a',
    x: 10,
    y: 20,
    size: 'small',
    tap: 'toggle',
    orientation: null,
  };

  it('turning directional on with no angle defaults orientation to 0', () => {
    const out = formToEntity(base, { directional: true });
    expect(out.orientation).toBe(0);
  });

  it('directional on + slider value sets that orientation', () => {
    const out = formToEntity(base, { directional: true, orientation: 145 });
    expect(out.orientation).toBe(145);
  });

  it('turning directional off forces orientation back to null', () => {
    const lit: EntityConfig = { ...base, orientation: 200 };
    const out = formToEntity(lit, { directional: false, orientation: 200 });
    expect(out.orientation).toBeNull();
  });

  it('merges scalar fields and drops the transient directional key', () => {
    const out = formToEntity(base, { x: 33, name: 'Lamp' });
    expect(out.x).toBe(33);
    expect(out.name).toBe('Lamp');
    expect('directional' in out).toBe(false);
  });

  it('preserves unknown keys already on the entity', () => {
    const withExtra = { ...base, _legacy: 'keep' } as unknown as EntityConfig;
    const out = formToEntity(withExtra, { x: 5 });
    expect((out as any)._legacy).toBe('keep');
  });
});

import { labelsSchema } from '../src/editor/editor-helpers';

describe('editor label config round-trip', () => {
  const base = (over: Partial<EntityConfig> = {}): EntityConfig => ({ entity: 'light.x', x: 1, y: 2, size: 'small', tap: 'toggle', orientation: null, ...over });

  it('entityToForm: no label -> labelSource "inherit"', () => {
    expect(entityToForm(base()).labelSource).toBe('inherit');
  });
  it('entityToForm: maps a per-entity label to flat fields', () => {
    const f = entityToForm(base({ label: { source: 'static', text: 'Hi', visibility: 'always' } }));
    expect(f).toMatchObject({ labelSource: 'static', labelText: 'Hi', labelVisibility: 'always' });
  });
  it('formToEntity: inherit clears the label', () => {
    const e = formToEntity(base({ label: { source: 'state' } }), { labelSource: 'inherit' } as any);
    expect(e.label).toBeUndefined();
  });
  it('formToEntity: none -> {source:none}', () => {
    expect(formToEntity(base(), { labelSource: 'none' } as any).label).toEqual({ source: 'none' });
  });
  it('formToEntity: static keeps text; preset keeps non-auto visibility; transient fields stripped', () => {
    const e1 = formToEntity(base(), { labelSource: 'static', labelText: 'Movie', labelVisibility: 'auto' } as any);
    expect(e1.label).toEqual({ source: 'static', text: 'Movie' }); // auto visibility omitted
    const e2 = formToEntity(base(), { labelSource: 'climate-current', labelVisibility: 'always' } as any);
    expect(e2.label).toEqual({ source: 'climate-current', visibility: 'always' });
    expect('labelSource' in (e2 as any)).toBe(false);
    expect('labelText' in (e2 as any)).toBe(false);
  });
  it('entitySchema reveals labelText only for static, labelAttribute only for attribute', () => {
    const names = (src: string) => entitySchema(false, src).map((s) => s.name);
    expect(names('static')).toContain('labelText');
    expect(names('static')).not.toContain('labelAttribute');
    expect(names('attribute')).toContain('labelAttribute');
    expect(names('inherit')).not.toContain('labelVisibility');
    expect(names('climate-current')).toContain('labelVisibility');
  });
  it('labelsSchema exposes source + visibility (incl. smart)', () => {
    const s = labelsSchema();
    expect(s.map((r) => r.name)).toEqual(['source', 'visibility']);
    const sources = s[0].selector.select.options.map((o: any) => o.value);
    expect(sources).toContain('smart');
    expect(sources).toContain('none');
  });
});
