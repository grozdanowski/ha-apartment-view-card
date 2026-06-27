import {
  createMockHass,
  setSunForTimeOfDay,
  type MockHass,
} from './mock-hass';
import { normalizeConfig, type ApartmentViewConfig } from '../src/core/config';

// Dev-only <ha-icon> stub so markers render a visible glyph in the harness
// (real HA provides ha-icon; the mock environment does not). Renders a simple
// filled glyph in currentColor sized to --mdc-icon-size.
if (!customElements.get('ha-icon')) {
  class HaIconStub extends HTMLElement {
    static get observedAttributes() {
      return ['icon'];
    }
    connectedCallback() {
      this.style.display = 'inline-grid';
      this.style.placeItems = 'center';
      const size = getComputedStyle(this).getPropertyValue('--mdc-icon-size').trim() || '24px';
      this.style.width = size;
      this.style.height = size;
      this.innerHTML =
        '<svg viewBox="0 0 24 24" width="100%" height="100%" fill="currentColor" aria-hidden="true"><path d="M12 2a7 7 0 0 0-4 12.7V17a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-2.3A7 7 0 0 0 12 2Zm-3 18a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1v-1H9Z"/></svg>';
    }
  }
  customElements.define('ha-icon', HaIconStub);
}

// Import the card entry so it self-registers.
import '../src/apartment-view-card';

// ---- Demo config (v2 schema) -------------------------------------------
const rawConfig = {
  type: 'custom:apartment-view-card',
  images: {
    base: '/day.png',
    allLights: '/all-lights.png',
    night: '/night.png',
    duskDawn: '/duskdawn.png',
  },
  entities: [
    { entity: 'light.kitchen_ceiling', x: 35, y: 16, size: 'small', tap: 'toggle' },
    { entity: 'light.living_lamp', x: 60, y: 55, size: 'medium', tap: 'toggle' },
    { entity: 'media_player.tv', x: 70, y: 40, size: 'small', tap: 'more-info', orientation: 180 },
    { entity: 'climate.bedroom_ac', x: 20, y: 70, size: 'small', tap: 'more-info' },
  ],
  zones: [
    { name: 'Kitchen', icon: 'mdi:silverware-fork-knife', x: 20, y: 5, width: 35, height: 35 },
    { name: 'Living room', icon: 'mdi:sofa', x: 50, y: 35, width: 45, height: 50 },
  ],
  options: {
    view: 'auto',
    lightStyle: 'lit',
    // demo the smart label map: climate -> temp, media -> now-playing, lights stay quiet
    labels: { source: 'smart', visibility: 'always' },
  },
};
const config: ApartmentViewConfig = normalizeConfig(rawConfig);

const hass: MockHass = createMockHass();

// ---- DOM refs ----------------------------------------------------------
const callLog = document.getElementById('calls') as HTMLPreElement;
const lightControls = document.getElementById('light-controls') as HTMLDivElement;
const card = document.getElementById('card') as any; // <apartment-view-card>

function pushHass(): void {
  // reassigning hass mimics HA pushing a state update to the card
  if (card) {
    card.hass = { ...hass, states: { ...hass.states } };
  }
}

function logCalls(): void {
  callLog.textContent = hass.serviceCalls
    .slice(-12)
    .map((c) => `${c.domain}.${c.service}(${JSON.stringify(c.data)})`)
    .join('\n');
}

// ---- Control panel: per-light toggle / dim / recolor -------------------
function buildLightControls(): void {
  lightControls.innerHTML = '';
  for (const e of config.entities) {
    if (!e.entity.startsWith('light.')) continue;
    const ent = hass.states[e.entity];
    const row = document.createElement('div');
    row.className = 'lc-row';

    const label = document.createElement('div');
    label.className = 'lc-label';
    label.textContent = ent.attributes.friendly_name ?? e.entity;

    const toggle = document.createElement('button');
    toggle.className = 'b';
    const syncToggle = () => {
      toggle.textContent = hass.states[e.entity].state === 'on' ? 'On' : 'Off';
      toggle.classList.toggle('on', hass.states[e.entity].state === 'on');
    };
    toggle.addEventListener('click', async () => {
      await hass.callService('homeassistant', 'toggle', { entity_id: e.entity });
      syncToggle();
      logCalls();
      pushHass();
    });
    syncToggle();

    const dim = document.createElement('input');
    dim.type = 'range';
    dim.min = '0';
    dim.max = '255';
    dim.value = String(ent.attributes.brightness ?? 255);
    dim.addEventListener('input', () => {
      const cur = hass.states[e.entity];
      hass.states[e.entity] = {
        ...cur,
        state: Number(dim.value) > 0 ? 'on' : 'off',
        attributes: { ...cur.attributes, brightness: Number(dim.value) },
      };
      syncToggle();
      pushHass();
    });

    const color = document.createElement('input');
    color.type = 'color';
    const c = ent.attributes.rgb_color ?? [255, 250, 230];
    color.value =
      '#' +
      [c[0], c[1], c[2]]
        .map((v: number) => v.toString(16).padStart(2, '0'))
        .join('');
    color.addEventListener('input', () => {
      const hex = color.value.slice(1);
      const rgb = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
      const cur = hass.states[e.entity];
      hass.states[e.entity] = {
        ...cur,
        attributes: { ...cur.attributes, rgb_color: rgb, color_mode: 'rgb' },
      };
      pushHass();
    });

    row.append(label, toggle, dim, color);
    lightControls.appendChild(row);
  }
}

// ---- Control panel: time-of-day ---------------------------------------
for (const btn of Array.from(
  document.querySelectorAll<HTMLButtonElement>('[data-tod]'),
)) {
  btn.addEventListener('click', () => {
    const tod = btn.dataset.tod as 'day' | 'night' | 'duskDawn';
    setSunForTimeOfDay(hass, tod);
    for (const b of document.querySelectorAll('[data-tod]'))
      b.classList.toggle('on', b === btn);
    pushHass();
  });
}

// ---- Boot --------------------------------------------------------------
if (card && typeof card.setConfig === 'function') {
  try {
    card.setConfig(rawConfig);
  } catch (err) {
    // Phase 1 placeholder card has no setConfig; ignore.
    console.warn('card.setConfig not available yet (Phase 1 placeholder):', err);
  }
}
setSunForTimeOfDay(hass, 'day');
document.querySelector('[data-tod="day"]')?.classList.add('on');
buildLightControls();
pushHass();
logCalls();
