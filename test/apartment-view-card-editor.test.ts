// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import '../src/editor/apartment-view-card-editor';
import type { ApartmentViewConfig } from '../src/core/config';

function baseConfig(): ApartmentViewConfig {
  return {
    type: 'custom:apartment-view-card',
    images: { base: '/local/day.png' },
    entities: [],
    zones: [],
    options: {
      view: 'auto',
      lightStyle: 'lit',
      freePanZoom: true,
      zoomMax: 1.5,
      duskDawnOffsetMinutes: 60,
    },
  };
}

async function mount() {
  const el = document.createElement('apartment-view-card-editor') as any;
  el.hass = { states: {}, localize: (k: string) => k };
  el.setConfig(baseConfig());
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

describe('apartment-view-card-editor: images + options', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('setConfig preserves unknown keys', async () => {
    const el = document.createElement('apartment-view-card-editor') as any;
    el.hass = { states: {} };
    el.setConfig({ ...baseConfig(), _legacy: 'keep' });
    expect(el.config._legacy).toBe('keep');
  });

  it('renders an ha-form whose data is the flattened images+options', async () => {
    const el = await mount();
    const form = el.shadowRoot.querySelector('ha-form.images-options') as any;
    expect(form).toBeTruthy();
    expect(form.data.base).toBe('/local/day.png');
    expect(form.data.view).toBe('auto');
    expect(form.data.zoomMax).toBe(1.5);
  });

  it('a form value-changed re-nests into images/options and fires config-changed', async () => {
    const el = await mount();
    let fired: ApartmentViewConfig | null = null;
    el.addEventListener('config-changed', (e: CustomEvent) => {
      fired = e.detail.config;
    });
    const form = el.shadowRoot.querySelector('ha-form.images-options') as any;
    form.dispatchEvent(
      new CustomEvent('value-changed', {
        detail: {
          value: {
            base: '/local/new.png',
            allLights: '/local/all.png',
            night: undefined,
            duskDawn: undefined,
            view: 'night',
            lightStyle: 'glow',
            freePanZoom: false,
            zoomMax: 2,
            duskDawnOffsetMinutes: 45,
          },
        },
        bubbles: true,
        composed: true,
      })
    );
    expect(fired).not.toBeNull();
    expect(fired!.images.base).toBe('/local/new.png');
    expect(fired!.images.allLights).toBe('/local/all.png');
    expect(fired!.options.view).toBe('night');
    expect(fired!.options.freePanZoom).toBe(false);
    expect(fired!.options.zoomMax).toBe(2);
  });

  it('config-changed preserves entities, zones, and unknown keys', async () => {
    const el = document.createElement('apartment-view-card-editor') as any;
    el.hass = { states: {} };
    el.setConfig({
      ...baseConfig(),
      entities: [
        { entity: 'light.a', x: 1, y: 2, size: 'small', tap: 'toggle', orientation: null },
      ],
      _legacy: 'keep',
    });
    document.body.appendChild(el);
    await el.updateComplete;
    let fired: any = null;
    el.addEventListener('config-changed', (e: CustomEvent) => (fired = e.detail.config));
    const form = el.shadowRoot.querySelector('ha-form.images-options') as any;
    form.dispatchEvent(
      new CustomEvent('value-changed', {
        detail: { value: { ...form.data, view: 'day' } },
        bubbles: true,
        composed: true,
      })
    );
    expect(fired.entities.length).toBe(1);
    expect(fired._legacy).toBe('keep');
  });
});
