import {
  createMockHass,
  setSunForTimeOfDay,
  type MockHass,
} from './mock-hass';
import { normalizeConfig, type ApartmentViewConfig } from '../src/core/config';
// Import the card entry so it self-registers (Phase 1: placeholder module).
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
  options: { view: 'auto', lightStyle: 'lit' },
};
const config: ApartmentViewConfig = normalizeConfig(rawConfig);

const hass: MockHass = createMockHass();
const SIZE_FRACTION: Record<string, number> = {
  tiny: 0.09, small: 0.13, medium: 0.17, large: 0.22, huge: 0.28,
};

// ---- DOM refs ----------------------------------------------------------
const stage = document.getElementById('scene') as HTMLDivElement;
const baseImg = document.getElementById('base') as HTMLImageElement;
const lightLayer = document.getElementById('lights') as HTMLDivElement;
const callLog = document.getElementById('calls') as HTMLPreElement;
const lightControls = document.getElementById('light-controls') as HTMLDivElement;
const card = document.getElementById('card') as any; // <apartment-view-card>

// ---- Helpers -----------------------------------------------------------
function brightness01(id: string): number {
  const ent = hass.states[id];
  if (!ent || ent.state !== 'on') return 0;
  const b = ent.attributes.brightness;
  return typeof b === 'number' ? Math.max(0, Math.min(1, b / 255)) : 1;
}
function rgbCss(id: string): string {
  const c = hass.states[id]?.attributes?.rgb_color;
  return Array.isArray(c) ? `rgb(${c[0]}, ${c[1]}, ${c[2]})` : 'rgb(255,250,230)';
}

function renderScenePreview(): void {
  // base time-of-day filter (derived) — mirrors spec defaults
  const sun = hass.states['sun.sun'];
  const setting = new Date(sun.attributes.next_setting).getTime();
  const rising = new Date(sun.attributes.next_rising).getTime();
  const now = Date.now();
  const win = config.options.duskDawnOffsetMinutes * 60_000;
  let filter = 'none';
  if (sun.state === 'below_horizon') filter = 'brightness(0.4) saturate(0.9)';
  else if (Math.abs(rising - now) <= win || Math.abs(setting - now) <= win)
    filter = 'brightness(0.75) saturate(1.1) hue-rotate(20deg) sepia(0.15)';
  baseImg.style.filter = filter;

  // per-light radial-masked tint (a Phase-1 stand-in for light-layer.ts)
  lightLayer.innerHTML = '';
  const w = stage.clientWidth || 600;
  for (const e of config.entities) {
    if (!e.entity.startsWith('light.')) continue;
    const b = brightness01(e.entity);
    const r = SIZE_FRACTION[e.size] * w * (0.45 + 0.55 * b);
    const div = document.createElement('div');
    div.style.cssText = [
      'position:absolute', 'inset:0', 'pointer-events:none',
      `background:${rgbCss(e.entity)}`,
      'mix-blend-mode:soft-light',
      `opacity:${(0.55 + 0.3 * b) * (b > 0 ? 1 : 0)}`,
      'transition:opacity .3s ease, background .3s ease',
      `mask-image:radial-gradient(circle ${r}px at ${e.x}% ${e.y}%, black 0%, rgba(0,0,0,0.55) 40%, transparent 100%)`,
      `-webkit-mask-image:radial-gradient(circle ${r}px at ${e.x}% ${e.y}%, black 0%, rgba(0,0,0,0.55) 40%, transparent 100%)`,
    ].join(';');
    lightLayer.appendChild(div);
  }
}

function pushHass(): void {
  // re-trigger the (placeholder) card; reassigning hass mimics HA updates
  if (card) {
    card.hass = { ...hass, states: { ...hass.states } };
  }
  renderScenePreview();
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
