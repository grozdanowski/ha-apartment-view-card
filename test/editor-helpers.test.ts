import { describe, it, expect } from 'vitest';
import {
  defaultEntity,
  defaultZone,
  imagesOptionsSchema,
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

describe('imagesOptionsSchema', () => {
  const schema = imagesOptionsSchema();
  const names = schema.map((s) => s.name);

  it('includes all image keys and all options keys', () => {
    expect(names).toEqual(
      expect.arrayContaining([
        'base',
        'allLights',
        'night',
        'duskDawn',
        'view',
        'lightStyle',
        'freePanZoom',
        'zoomMax',
        'duskDawnOffsetMinutes',
      ])
    );
  });

  it('marks only images.base as required', () => {
    expect(schema.find((s) => s.name === 'base')!.required).toBe(true);
    expect(schema.find((s) => s.name === 'allLights')!.required).toBeFalsy();
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
