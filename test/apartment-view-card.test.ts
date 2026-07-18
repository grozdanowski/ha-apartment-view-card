// @vitest-environment happy-dom
import { describe, it, expect, beforeAll } from 'vitest';
import type { HassEntity } from '../src/core/ha-types';
import '../src/apartment-view-card';

type Card = HTMLElement & {
  hass: any;
  config: any;
  setConfig: (raw: any) => void;
};

function mkHass(states: Record<string, HassEntity>) {
  return { states };
}

async function mount(raw: any, hass: any): Promise<Card> {
  const el = document.createElement('apartment-view-card') as Card;
  el.setConfig(raw);
  el.hass = hass;
  document.body.appendChild(el);
  await (el as any).updateComplete;
  return el;
}

beforeAll(() => {
  // jsdom/browser: ensure custom element defined
  expect(customElements.get('apartment-view-card')).toBeTruthy();
});

describe('setConfig', () => {
  it('throws when images.base is missing', () => {
    const el = document.createElement('apartment-view-card') as Card;
    expect(() => el.setConfig({ type: 'custom:apartment-view-card', images: {} })).toThrow();
  });
});

describe('render', () => {
  it('renders the base image inside .scene', async () => {
    const el = await mount(
      { type: 'custom:apartment-view-card', images: { base: '/b.png' }, entities: [] },
      mkHass({}),
    );
    const scene = el.shadowRoot!.querySelector('.scene');
    expect(scene).toBeTruthy();
    const base = el.shadowRoot!.querySelector('img.base-image') as HTMLImageElement;
    expect(base.getAttribute('src')).toBe('/b.png');
  });

  it('renders one light overlay per entity', async () => {
    const el = await mount(
      {
        type: 'custom:apartment-view-card',
        images: { base: '/b.png' },
        entities: [
          { entity: 'light.a', x: 10, y: 10, size: 'small' },
          { entity: 'light.b', x: 20, y: 20, size: 'small' },
        ],
      },
      mkHass({
        'light.a': { entity_id: 'light.a', state: 'on', attributes: { brightness: 255 } },
        'light.b': { entity_id: 'light.b', state: 'off', attributes: {} },
      }),
    );
    const overlays = el.shadowRoot!.querySelectorAll('.light-overlay');
    expect(overlays.length).toBe(2);
  });

  it('on light overlay opaque, off light overlay faded', async () => {
    const el = await mount(
      {
        type: 'custom:apartment-view-card',
        images: { base: '/b.png' },
        entities: [
          { entity: 'light.a', x: 10, y: 10, size: 'small' },
          { entity: 'light.b', x: 20, y: 20, size: 'small' },
        ],
      },
      mkHass({
        'light.a': { entity_id: 'light.a', state: 'on', attributes: { brightness: 255 } },
        'light.b': { entity_id: 'light.b', state: 'off', attributes: {} },
      }),
    );
    const overlays = Array.from(
      el.shadowRoot!.querySelectorAll('.light-overlay'),
    ) as HTMLElement[];
    expect(parseFloat(overlays[0].style.opacity)).toBe(1);
    expect(parseFloat(overlays[1].style.opacity)).toBe(0);
  });

  it('shows a warning card when config absent', async () => {
    const el = document.createElement('apartment-view-card') as Card;
    document.body.appendChild(el);
    await (el as any).updateComplete;
    expect(el.shadowRoot!.textContent).toContain('configure');
  });
});

describe('getGridOptions', () => {
  it('returns an object with numeric rows and columns', () => {
    const el = document.createElement('apartment-view-card') as Card & { getGridOptions(): any };
    const opts = (el as any).getGridOptions();
    expect(typeof opts.rows).toBe('number');
    expect(typeof opts.columns).toBe('number');
  });
});

describe('dashboard edit affordance', () => {
  it('enters dashboard edit mode when the card is nested in HA shadow roots', async () => {
    const panel = document.createElement('ha-panel-lovelace') as HTMLElement & {
      editMode?: boolean;
      requestUpdate?: () => void;
      lovelace?: { editMode?: boolean; setEditMode?: (editing: boolean) => void };
    };
    const panelShadow = panel.attachShadow({ mode: 'open' });
    const view = document.createElement('hui-view');
    const viewShadow = view.attachShadow({ mode: 'open' });
    const card = document.createElement('apartment-view-card') as Card & { _requestDashboardEdit: () => void };
    card.setConfig({ type: 'custom:apartment-view-card', images: { base: '/b.png' }, entities: [] });
    panelShadow.append(view);
    viewShadow.append(card);
    document.body.append(panel);
    await (card as any).updateComplete;

    let requested = false;
    panel.lovelace = { setEditMode: (editing) => { requested = editing; } };
    card._requestDashboardEdit();

    expect(requested).toBe(true);
  });
});
