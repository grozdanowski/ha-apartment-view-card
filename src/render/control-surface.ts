import { LitElement, html, css, nothing, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';
import type { HassEntity, HassLike } from '../core/ha-types';
import { resolveLightColor, rgbCss } from '../core/light-color';
import { isActive, intensity } from '../core/entity-state';
import {
  lightCaps,
  mediaCaps,
  climateCaps,
  coverCaps,
  fanCaps,
  lockCaps,
  vacuumCaps,
  alarmCaps,
  controlKind,
  type ControlKind,
} from '../core/entity-capabilities';

const SWATCHES: { name: string; rgb: [number, number, number] }[] = [
  { name: 'Warm', rgb: [255, 178, 89] },
  { name: 'Soft', rgb: [255, 231, 194] },
  { name: 'White', rgb: [253, 253, 255] },
  { name: 'Cool', rgb: [170, 204, 255] },
  { name: 'Blue', rgb: [91, 155, 255] },
  { name: 'Teal', rgb: [70, 224, 192] },
  { name: 'Pink', rgb: [255, 122, 184] },
  { name: 'Red', rgb: [255, 90, 90] },
];

/**
 * On-floorplan control surface for one or more entities. Renders ONLY the
 * controls each entity actually supports (see entity-capabilities). For a set
 * of lights it acts as a group control. Emits a `surface-close` event; all
 * device changes go through hass.callService.
 *
 * The host (card) owns selection; this element is presentational + service
 * dispatch. `entityIds` empty + `selectMode` true => disabled "select a light"
 * prompt; empty + not select => renders nothing.
 */
@customElement('av-control-surface')
export class AvControlSurface extends LitElement {
  @property({ attribute: false }) public hass?: HassLike;
  @property({ attribute: false }) public entityIds: string[] = [];
  @property({ type: Boolean }) public selectMode = false;

  /** Local brightness during a drag (0..1) so the slider tracks the finger before the state round-trips. */
  private _dragBri: number | null = null;
  private _lastCall = 0;

  static styles = css`
    :host { display: block; }
    .panel {
      border-radius: 14px;
      background: var(--card-background-color, #14161c);
      box-shadow: inset 0 0 0 1px var(--divider-color, rgba(255, 255, 255, 0.08));
      padding: 14px 18px 18px;
      color: var(--primary-text-color, #f5f5f7);
    }
    .panel.disabled .body { opacity: 0.36; pointer-events: none; filter: saturate(0.4); }
    .head { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; }
    .avatars { display: flex; }
    .av {
      width: 30px; height: 30px; border-radius: 50%; display: grid; place-items: center; margin-left: -8px;
      background: var(--secondary-background-color, #2a2d34); box-shadow: 0 0 0 2px var(--card-background-color, #14161c);
      --mdc-icon-size: 16px;
    }
    .av:first-child { margin-left: 0; }
    .h-title { font-size: 16px; font-weight: 500; }
    .h-sub { font-size: 12px; color: var(--secondary-text-color, #8a8f98); }
    .pwr {
      margin-left: auto; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; border: none;
      padding: 6px 12px; border-radius: 13px; font: inherit; font-size: 12px; font-weight: 500;
      background: color-mix(in srgb, var(--primary-text-color, #fff) 12%, transparent); color: inherit;
    }
    .pwr.off { color: var(--secondary-text-color, #8a8f98); }
    .pwr ha-icon { --mdc-icon-size: 16px; }
    .close {
      cursor: pointer; width: 30px; height: 30px; border-radius: 50%; display: grid; place-items: center; border: none;
      background: color-mix(in srgb, var(--primary-text-color, #fff) 10%, transparent); color: inherit; --mdc-icon-size: 18px;
    }
    .row { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; }
    .row:last-child { margin-bottom: 0; }
    .ico { display: grid; place-items: center; color: var(--secondary-text-color, #c7cad1); --mdc-icon-size: 20px; }
    .track {
      position: relative; flex: 1; height: 40px; border-radius: 12px; overflow: hidden; cursor: pointer; touch-action: none;
      background: color-mix(in srgb, var(--primary-text-color, #fff) 10%, transparent);
    }
    .fill { position: absolute; left: 0; top: 0; bottom: 0; transition: width 0.08s linear; }
    .pct { position: absolute; right: 12px; top: 50%; transform: translateY(-50%); font-size: 13px; font-weight: 500; color: #111; mix-blend-mode: overlay; }
    .swatches { display: flex; gap: 10px; align-items: center; }
    .lbl { font-size: 12px; color: var(--secondary-text-color, #8a8f98); }
    .sw {
      width: 30px; height: 30px; border-radius: 50%; cursor: pointer; border: none; padding: 0;
      box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.18);
    }
    .sw.sel { box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.18), 0 0 0 2px #fff, 0 0 0 4px rgba(0, 0, 0, 0.4); }
    .transport { display: flex; align-items: center; gap: 14px; }
    .tbtn {
      cursor: pointer; border: none; width: 40px; height: 40px; border-radius: 50%; display: grid; place-items: center; color: inherit;
      background: color-mix(in srgb, var(--primary-text-color, #fff) 8%, transparent); --mdc-icon-size: 22px;
    }
    .tbtn.play { width: 48px; height: 48px; background: color-mix(in srgb, var(--primary-text-color, #fff) 16%, transparent); --mdc-icon-size: 26px; }
    .nowplaying { flex: 1; font-size: 13px; color: var(--secondary-text-color, #c7cad1); }
    .nowplaying b { color: var(--primary-text-color, #f5f5f7); font-weight: 500; }
    .src {
      flex: 1; height: 40px; font: inherit; font-size: 14px; cursor: pointer;
      color: var(--primary-text-color, #f5f5f7);
      background: var(--secondary-background-color, #2a2d34);
      border: none; border-radius: 12px; padding: 0 12px;
    }
    .temp { display: flex; align-items: center; gap: 14px; margin-bottom: 14px; }
    .tval { font-size: 32px; font-weight: 500; }
    .tval small { font-size: 14px; color: var(--secondary-text-color, #8a8f98); }
    .stepper { display: flex; flex-direction: column; gap: 6px; margin-left: auto; }
    .step {
      cursor: pointer; border: none; width: 40px; height: 30px; border-radius: 9px; display: grid; place-items: center; color: inherit;
      background: color-mix(in srgb, var(--primary-text-color, #fff) 10%, transparent); --mdc-icon-size: 18px;
    }
    .modes { display: flex; gap: 8px; flex-wrap: wrap; }
    .mode {
      cursor: pointer; border: none; padding: 9px 14px; border-radius: 11px; font: inherit; font-size: 13px; font-weight: 500;
      display: inline-flex; align-items: center; gap: 6px;
      background: color-mix(in srgb, var(--primary-text-color, #fff) 8%, transparent); color: var(--secondary-text-color, #b9bdc6); text-transform: capitalize;
      --mdc-icon-size: 16px;
    }
    .mode.sel { background: var(--primary-color, #03a9f4); color: var(--text-primary-color, #fff); }
    button { font: inherit; }
    button:focus-visible, .track:focus-visible { outline: 2px solid var(--primary-color, #03a9f4); outline-offset: 2px; }
  `;

  private _state(id: string): HassEntity | undefined {
    return this.hass?.states?.[id];
  }
  private get _entities(): { id: string; state: HassEntity | undefined }[] {
    return this.entityIds.map((id) => ({ id, state: this._state(id) }));
  }
  /** A homogeneous group takes its members' kind; a mixed selection is a light group. */
  private get _kind(): ControlKind {
    if (this.entityIds.length === 0) return 'light';
    const kinds = new Set(this.entityIds.map((id) => controlKind(id)));
    return kinds.size === 1 ? [...kinds][0] : 'light';
  }
  private get _kindNoun(): string {
    return ({ light: 'lights', cover: 'covers', fan: 'fans', lock: 'locks', media: 'media players', climate: 'thermostats' } as Record<ControlKind, string>)[this._kind] ?? 'devices';
  }
  private _call(domain: string, service: string, data: Record<string, unknown>): void {
    this.hass?.callService(domain, service, { entity_id: this.entityIds, ...data });
  }
  private _close(): void {
    this.dispatchEvent(new CustomEvent('surface-close', { bubbles: true, composed: true }));
  }

  protected updated(): void {
    // A <select>'s value can't be set declaratively before its <option>s exist,
    // so reflect the current value onto the picker after each render. Media uses
    // attributes.source; a select/input_select uses the entity state.
    const sel = this.renderRoot.querySelector('select.src') as HTMLSelectElement | null;
    if (!sel) return;
    const st = this._state(this.entityIds[0]);
    const want = this._kind === 'select' ? st?.state : st?.attributes?.source;
    if (typeof want === 'string' && sel.value !== want) sel.value = want;
  }

  protected render(): TemplateResult | typeof nothing {
    const empty = this.entityIds.length === 0;
    if (empty && !this.selectMode) return nothing;
    const disabled = empty && this.selectMode;
    return html`
      <div class="panel ${disabled ? 'disabled' : ''}">
        ${this._renderHead(disabled)}
        ${this._renderBody(disabled)}
      </div>
    `;
  }

  private _renderHead(disabled: boolean): TemplateResult {
    const ents = this._entities;
    const anyOn = ents.some((e) => e.state && isActive(e.state));
    const multi = this.entityIds.length > 1;
    let title = 'Light control';
    let sub = 'Select lights to control';
    if (!disabled) {
      if (multi) {
        title = `${this.entityIds.length} ${this._kindNoun}`;
        sub = `${ents.filter((e) => e.state && isActive(e.state)).length} on`;
      } else {
        const e = ents[0];
        title = e.state?.attributes?.friendly_name ?? this.entityIds[0] ?? 'Control';
        sub = this._singleSub(e.state);
      }
    }
    const avatars = (disabled ? [{ id: '', state: undefined }] : ents).slice(0, 4);
    return html`
      <div class="head">
        <div class="avatars">
          ${avatars.map((e) => html`<div class="av" style=${styleMap(this._avatarStyle(e.state))}><ha-icon icon=${this._avatarIcon(e.id)}></ha-icon></div>`)}
        </div>
        <div>
          <div class="h-title">${title}</div>
          <div class="h-sub">${sub}</div>
        </div>
        ${['light', 'media', 'climate', 'fan'].includes(this._kind)
          ? html`<button class="pwr ${anyOn ? '' : 'off'}" @click=${() => this._call('homeassistant', anyOn ? 'turn_off' : 'turn_on', {})} ?disabled=${disabled}>
              <ha-icon icon="mdi:power"></ha-icon>${multi ? (anyOn ? 'All off' : 'All on') : anyOn ? 'Off' : 'On'}
            </button>`
          : nothing}
        <button class="close" aria-label="Close" @click=${this._close}><ha-icon icon="mdi:close"></ha-icon></button>
      </div>
    `;
  }

  private _singleSub(state: HassEntity | undefined): string {
    if (!state) return '';
    const k = controlKind(state.entity_id);
    if (k === 'climate') return isActive(state) ? `${state.state} · ${this._displayTemp(state)}°` : 'Off';
    if (k === 'media') return isActive(state) ? (state.state === 'playing' ? 'Playing' : 'Paused') : 'Off';
    if (k === 'cover') {
      const p = state.attributes?.current_position;
      if (typeof p === 'number') return p <= 0 ? 'Closed' : p >= 100 ? 'Open' : `${Math.round(p)}% open`;
      return state.state === 'open' ? 'Open' : state.state === 'closed' ? 'Closed' : state.state;
    }
    if (k === 'fan') {
      const p = state.attributes?.percentage;
      return isActive(state) ? (typeof p === 'number' ? `${Math.round(p)}%` : 'On') : 'Off';
    }
    if (k === 'lock') return this._humanize(state.state);
    if (k === 'vacuum') {
      const bat = state.attributes?.battery_level;
      return `${this._humanize(state.state)}${typeof bat === 'number' ? ` · ${Math.round(bat)}%` : ''}`;
    }
    if (k === 'number') return `${state.state}${typeof state.attributes?.unit_of_measurement === 'string' ? ' ' + state.attributes.unit_of_measurement : ''}`;
    if (k === 'select') return this._humanize(state.state);
    if (k === 'alarm') return this._humanize(state.state);
    return isActive(state) ? `${Math.round(intensity(state) * 100)}%` : 'Off';
  }
  private _humanize(s: string): string {
    return s ? s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ') : s;
  }
  private _avatarIcon(id: string): string {
    const k = id ? controlKind(id) : 'light';
    const icons: Record<ControlKind, string> = {
      media: 'mdi:cast', climate: 'mdi:thermostat', cover: 'mdi:window-shutter',
      fan: 'mdi:fan', lock: 'mdi:lock', light: 'mdi:lightbulb', none: 'mdi:lightbulb',
      vacuum: 'mdi:robot-vacuum', number: 'mdi:tune-vertical', select: 'mdi:format-list-bulleted',
      alarm: 'mdi:shield-home',
    };
    return icons[k];
  }
  private _avatarStyle(state: HassEntity | undefined): Record<string, string> {
    const on = state ? isActive(state) : false;
    const color = state && on && controlKind(state.entity_id) === 'light' ? rgbCss(resolveLightColor(state)) : 'var(--secondary-text-color, #9aa0a8)';
    return { color };
  }

  /** Domain of the first controlled entity (for number/select/input_* service routing). */
  private get _domain(): string {
    return (this.entityIds[0] || '').split('.')[0];
  }

  private _renderBody(disabled: boolean): TemplateResult {
    const kind = this._kind;
    if (kind === 'media') return this._renderMedia();
    if (kind === 'climate') return this._renderClimate();
    if (kind === 'cover') return this._renderCover();
    if (kind === 'fan') return this._renderFan();
    if (kind === 'lock') return this._renderLock();
    if (kind === 'vacuum') return this._renderVacuum();
    if (kind === 'number') return this._renderNumber();
    if (kind === 'select') return this._renderSelect();
    if (kind === 'alarm') return this._renderAlarm();
    return this._renderLight(disabled);
  }

  // ---- Light (single or group) ------------------------------------------
  private _renderLight(disabled: boolean): TemplateResult {
    const ents = this._entities;
    const caps = ents.map((e) => lightCaps(e.state));
    const showBrightness = disabled || caps.some((c) => c.brightness);
    const showColor = !disabled && caps.some((c) => c.color);
    const onEnts = ents.filter((e) => e.state && isActive(e.state));
    const avg = disabled
      ? 0
      : onEnts.length
        ? onEnts.reduce((s, e) => s + intensity(e.state as HassEntity), 0) / onEnts.length
        : 0;
    const bri = this._dragBri ?? avg;
    const firstColor = ents[0]?.state && isActive(ents[0].state) ? rgbCss(resolveLightColor(ents[0].state as HassEntity)) : 'rgb(255,200,140)';
    const selRgb = ents.length === 1 ? (ents[0].state?.attributes?.rgb_color as number[] | undefined) : undefined;
    return html`
      <div class="body">
        ${showBrightness
          ? html`<div class="row">
              <span class="ico"><ha-icon icon="mdi:brightness-6"></ha-icon></span>
              <div class="track" role="slider" tabindex="0" aria-label="Brightness" aria-valuenow=${Math.round(bri * 100)}
                @pointerdown=${this._briDown} @pointermove=${this._briMove} @pointerup=${this._briUp} @keydown=${this._briKey}>
                <div class="fill" style="width:${Math.round(bri * 100)}%;background:linear-gradient(90deg, ${firstColor}, #fff0d8)"></div>
                <span class="pct">${disabled ? '' : Math.round(bri * 100) + '%'}</span>
              </div>
            </div>`
          : nothing}
        ${showColor
          ? html`<div class="row swatches">
              <span class="lbl">Color</span>
              ${SWATCHES.map(
                (s) => html`<button class="sw ${selRgb && selRgb[0] === s.rgb[0] && selRgb[1] === s.rgb[1] && selRgb[2] === s.rgb[2] ? 'sel' : ''}"
                  style="background:rgb(${s.rgb[0]},${s.rgb[1]},${s.rgb[2]})" aria-label=${s.name}
                  @click=${() => this._call('light', 'turn_on', { rgb_color: s.rgb })}></button>`,
              )}
            </div>`
          : nothing}
      </div>
    `;
  }

  private _briFromEvent(e: PointerEvent): number {
    const track = e.currentTarget as HTMLElement;
    const r = track.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
  }
  private _briDown = (e: PointerEvent): void => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    this._dragBri = this._briFromEvent(e);
    this._pushBrightness(this._dragBri, false);
    this.requestUpdate();
  };
  private _briMove = (e: PointerEvent): void => {
    if (this._dragBri === null) return;
    this._dragBri = this._briFromEvent(e);
    this._pushBrightness(this._dragBri, true);
    this.requestUpdate();
  };
  private _briUp = (e: PointerEvent): void => {
    if (this._dragBri === null) return;
    this._pushBrightness(this._briFromEvent(e), false);
    this._dragBri = null;
  };
  private _briKey = (e: KeyboardEvent): void => {
    const cur = this._dragBri ?? this._currentAvg();
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') this._pushBrightness(Math.min(1, cur + 0.05), false);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') this._pushBrightness(Math.max(0, cur - 0.05), false);
  };
  private _currentAvg(): number {
    const on = this._entities.filter((e) => e.state && isActive(e.state));
    return on.length ? on.reduce((s, e) => s + intensity(e.state as HassEntity), 0) / on.length : 0;
  }
  private _pushBrightness(b: number, throttled: boolean): void {
    const now = Date.now();
    if (throttled && now - this._lastCall < 120) return;
    this._lastCall = now;
    if (b <= 0.01) this._call('light', 'turn_off', {});
    else this._call('light', 'turn_on', { brightness_pct: Math.round(b * 100) });
  }

  // ---- Media ------------------------------------------------------------
  private _renderMedia(): TemplateResult {
    const state = this._state(this.entityIds[0]);
    const c = mediaCaps(state);
    const a = state?.attributes ?? {};
    const playing = state?.state === 'playing';
    const vol = typeof a.volume_level === 'number' ? a.volume_level : 0;
    const title = a.media_title;
    const sources: string[] = Array.isArray(a.source_list) ? (a.source_list as string[]) : [];
    const hasTransport = c.previous || c.play || c.pause || c.next;
    return html`
      <div class="body">
        ${title
          ? html`<div class="row"><span class="nowplaying"><b>${title}</b>${a.media_artist ? ' · ' + a.media_artist : ''}</span></div>`
          : nothing}
        ${hasTransport
          ? html`<div class="row transport">
              ${c.previous ? html`<button class="tbtn" aria-label="Previous" @click=${() => this._call('media_player', 'media_previous_track', {})}><ha-icon icon="mdi:skip-previous"></ha-icon></button>` : nothing}
              ${c.play || c.pause
                ? html`<button class="tbtn play" aria-label="Play or pause" @click=${() => this._call('media_player', 'media_play_pause', {})}><ha-icon icon=${playing ? 'mdi:pause' : 'mdi:play'}></ha-icon></button>`
                : nothing}
              ${c.next ? html`<button class="tbtn" aria-label="Next" @click=${() => this._call('media_player', 'media_next_track', {})}><ha-icon icon="mdi:skip-next"></ha-icon></button>` : nothing}
            </div>`
          : nothing}
        ${c.volume
          ? html`<div class="row">
              <span class="ico"><ha-icon icon="mdi:volume-high"></ha-icon></span>
              <div class="track" role="slider" tabindex="0" aria-label="Volume" aria-valuenow=${Math.round(vol * 100)}
                @pointerdown=${this._volDown} @pointermove=${this._volMove} @pointerup=${this._volUp} @keydown=${this._volKey}>
                <div class="fill" style="width:${Math.round(vol * 100)}%;background:linear-gradient(90deg,#5b9bff,#bcd6ff)"></div>
              </div>
            </div>`
          : nothing}
        ${c.source && sources.length
          ? html`<div class="row">
              <span class="ico"><ha-icon icon="mdi:import"></ha-icon></span>
              <select class="src" aria-label="Source"
                @change=${(e: Event) => this._call('media_player', 'select_source', { source: (e.target as HTMLSelectElement).value })}>
                ${sources.map((s) => html`<option value=${s}>${s}</option>`)}
              </select>
            </div>`
          : nothing}
      </div>
    `;
  }
  private _vol = false;
  private _volFromEvent(e: PointerEvent): number {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
  }
  private _volDown = (e: PointerEvent): void => { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); this._vol = true; this._call('media_player', 'volume_set', { volume_level: this._volFromEvent(e) }); };
  private _volMove = (e: PointerEvent): void => { if (!this._vol) return; const now = Date.now(); if (now - this._lastCall < 120) return; this._lastCall = now; this._call('media_player', 'volume_set', { volume_level: this._volFromEvent(e) }); };
  private _volUp = (e: PointerEvent): void => { if (!this._vol) return; this._vol = false; this._call('media_player', 'volume_set', { volume_level: this._volFromEvent(e) }); };
  private _volKey = (e: KeyboardEvent): void => {
    const cur = typeof this._state(this.entityIds[0])?.attributes?.volume_level === 'number'
      ? (this._state(this.entityIds[0]) as HassEntity).attributes.volume_level as number
      : 0;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') this._call('media_player', 'volume_set', { volume_level: Math.min(1, cur + 0.05) });
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') this._call('media_player', 'volume_set', { volume_level: Math.max(0, cur - 0.05) });
  };

  // ---- Cover ------------------------------------------------------------
  private _renderCover(): TemplateResult {
    const state = this._state(this.entityIds[0]);
    const c = coverCaps(state);
    const pos = typeof state?.attributes?.current_position === 'number' ? state.attributes.current_position : null;
    return html`
      <div class="body">
        <div class="row transport" style="justify-content:center">
          ${c.open ? html`<button class="tbtn" aria-label="Open" @click=${() => this._call('cover', 'open_cover', {})}><ha-icon icon="mdi:arrow-up"></ha-icon></button>` : nothing}
          ${c.stop ? html`<button class="tbtn" aria-label="Stop" @click=${() => this._call('cover', 'stop_cover', {})}><ha-icon icon="mdi:stop"></ha-icon></button>` : nothing}
          ${c.close ? html`<button class="tbtn" aria-label="Close" @click=${() => this._call('cover', 'close_cover', {})}><ha-icon icon="mdi:arrow-down"></ha-icon></button>` : nothing}
        </div>
        ${c.position && pos !== null
          ? html`<div class="row">
              <span class="ico"><ha-icon icon="mdi:arrow-up-down"></ha-icon></span>
              <div class="track" role="slider" tabindex="0" aria-label="Position" aria-valuenow=${Math.round(pos)}
                @pointerdown=${this._coverDown} @pointermove=${this._coverMove} @pointerup=${this._coverUp} @keydown=${this._coverKey}>
                <div class="fill" style="width:${Math.round(pos)}%;background:linear-gradient(90deg,#8a8f98,#d8dbe0)"></div>
              </div>
            </div>`
          : nothing}
      </div>
    `;
  }
  private _coverDrag = false;
  private _pctFromEvent(e: PointerEvent): number {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return Math.max(0, Math.min(100, Math.round(((e.clientX - r.left) / r.width) * 100)));
  }
  private _coverDown = (e: PointerEvent): void => { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); this._coverDrag = true; this._call('cover', 'set_cover_position', { position: this._pctFromEvent(e) }); };
  private _coverMove = (e: PointerEvent): void => { if (!this._coverDrag) return; const now = Date.now(); if (now - this._lastCall < 120) return; this._lastCall = now; this._call('cover', 'set_cover_position', { position: this._pctFromEvent(e) }); };
  private _coverUp = (e: PointerEvent): void => { if (!this._coverDrag) return; this._coverDrag = false; this._call('cover', 'set_cover_position', { position: this._pctFromEvent(e) }); };
  private _coverKey = (e: KeyboardEvent): void => {
    const cur = Number(this._state(this.entityIds[0])?.attributes?.current_position) || 0;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') this._call('cover', 'set_cover_position', { position: Math.min(100, cur + 5) });
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') this._call('cover', 'set_cover_position', { position: Math.max(0, cur - 5) });
  };

  // ---- Fan --------------------------------------------------------------
  private _renderFan(): TemplateResult {
    const state = this._state(this.entityIds[0]);
    const c = fanCaps(state);
    const pct = typeof state?.attributes?.percentage === 'number' ? state.attributes.percentage : 0;
    const preset = state?.attributes?.preset_mode;
    const osc = state?.attributes?.oscillating === true;
    return html`
      <div class="body">
        ${c.speed
          ? html`<div class="row">
              <span class="ico"><ha-icon icon="mdi:fan"></ha-icon></span>
              <div class="track" role="slider" tabindex="0" aria-label="Speed" aria-valuenow=${Math.round(pct)}
                @pointerdown=${this._fanDown} @pointermove=${this._fanMove} @pointerup=${this._fanUp} @keydown=${this._fanKey}>
                <div class="fill" style="width:${Math.round(pct)}%;background:linear-gradient(90deg,#5b9bff,#bcd6ff)"></div>
              </div>
            </div>`
          : nothing}
        ${c.preset && c.presetModes.length
          ? html`<div class="row modes">
              ${c.presetModes.map((m) => html`<button class="mode ${preset === m ? 'sel' : ''}" @click=${() => this._call('fan', 'set_preset_mode', { preset_mode: m })}>${m}</button>`)}
            </div>`
          : nothing}
        ${c.oscillate
          ? html`<div class="row">
              <button class="mode ${osc ? 'sel' : ''}" @click=${() => this._call('fan', 'oscillate', { oscillating: !osc })}><ha-icon icon="mdi:arrow-left-right"></ha-icon> Oscillate</button>
            </div>`
          : nothing}
      </div>
    `;
  }
  private _fanDrag = false;
  private _fanDown = (e: PointerEvent): void => { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); this._fanDrag = true; this._call('fan', 'set_percentage', { percentage: this._pctFromEvent(e) }); };
  private _fanMove = (e: PointerEvent): void => { if (!this._fanDrag) return; const now = Date.now(); if (now - this._lastCall < 120) return; this._lastCall = now; this._call('fan', 'set_percentage', { percentage: this._pctFromEvent(e) }); };
  private _fanUp = (e: PointerEvent): void => { if (!this._fanDrag) return; this._fanDrag = false; this._call('fan', 'set_percentage', { percentage: this._pctFromEvent(e) }); };
  private _fanKey = (e: KeyboardEvent): void => {
    const cur = Number(this._state(this.entityIds[0])?.attributes?.percentage) || 0;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') this._call('fan', 'set_percentage', { percentage: Math.min(100, cur + 10) });
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') this._call('fan', 'set_percentage', { percentage: Math.max(0, cur - 10) });
  };

  // ---- Lock -------------------------------------------------------------
  private _renderLock(): TemplateResult {
    const state = this._state(this.entityIds[0]);
    const c = lockCaps(state);
    const s = state?.state ?? 'unknown';
    return html`
      <div class="body">
        <div class="row modes">
          <button class="mode ${s === 'locked' ? 'sel' : ''}" @click=${() => this._call('lock', 'lock', {})}><ha-icon icon="mdi:lock"></ha-icon> Lock</button>
          <button class="mode ${s === 'unlocked' ? 'sel' : ''}" @click=${() => this._call('lock', 'unlock', {})}><ha-icon icon="mdi:lock-open-variant"></ha-icon> Unlock</button>
        </div>
        ${s === 'jammed' ? html`<div class="row"><span class="h-sub" style="color:var(--error-color,#db4437)">⚠ Jammed</span></div>` : nothing}
        ${c.openLatch ? html`<div class="row"><button class="mode" @click=${this._confirmOpenLatch}><ha-icon icon="mdi:door-open"></ha-icon> Open latch</button></div>` : nothing}
      </div>
    `;
  }
  private _confirmOpenLatch = (): void => {
    // Confirm guard on the irreversible latch release.
    if (typeof window !== 'undefined' && typeof window.confirm === 'function' && !window.confirm('Open the lock latch?')) return;
    this._call('lock', 'open', {});
  };

  // ---- Vacuum -----------------------------------------------------------
  private _renderVacuum(): TemplateResult {
    const state = this._state(this.entityIds[0]);
    const c = vacuumCaps(state);
    const a = state?.attributes ?? {};
    const cleaning = state?.state === 'cleaning';
    const fan = a.fan_speed;
    return html`
      <div class="body">
        <div class="row transport" style="justify-content:center">
          ${c.start
            ? html`<button class="tbtn play" aria-label=${cleaning ? 'Pause' : 'Start'} @click=${() => this._call('vacuum', cleaning && c.pause ? 'pause' : 'start', {})}><ha-icon icon=${cleaning ? 'mdi:pause' : 'mdi:play'}></ha-icon></button>`
            : nothing}
          ${c.stop ? html`<button class="tbtn" aria-label="Stop" @click=${() => this._call('vacuum', 'stop', {})}><ha-icon icon="mdi:stop"></ha-icon></button>` : nothing}
          ${c.returnHome ? html`<button class="tbtn" aria-label="Return to dock" @click=${() => this._call('vacuum', 'return_to_base', {})}><ha-icon icon="mdi:home-import-outline"></ha-icon></button>` : nothing}
          ${c.locate ? html`<button class="tbtn" aria-label="Locate" @click=${() => this._call('vacuum', 'locate', {})}><ha-icon icon="mdi:map-marker"></ha-icon></button>` : nothing}
        </div>
        ${c.fanSpeed && c.fanSpeeds.length
          ? html`<div class="row modes">
              ${c.fanSpeeds.map((fs) => html`<button class="mode ${fan === fs ? 'sel' : ''}" @click=${() => this._call('vacuum', 'set_fan_speed', { fan_speed: fs })}>${fs}</button>`)}
            </div>`
          : nothing}
      </div>
    `;
  }

  // ---- Number (number / input_number) -----------------------------------
  private _numBounds(): { min: number; max: number; step: number } {
    const a = this._state(this.entityIds[0])?.attributes ?? {};
    return {
      min: typeof a.min === 'number' ? a.min : 0,
      max: typeof a.max === 'number' ? a.max : 100,
      step: typeof a.step === 'number' && a.step > 0 ? a.step : 1,
    };
  }
  private _renderNumber(): TemplateResult {
    const state = this._state(this.entityIds[0]);
    const { min, max } = this._numBounds();
    const v = Number(state?.state);
    const cur = Number.isFinite(v) ? v : min;
    const pct = max > min ? ((cur - min) / (max - min)) * 100 : 0;
    return html`
      <div class="body">
        <div class="row">
          <span class="ico"><ha-icon icon="mdi:tune-vertical"></ha-icon></span>
          <div class="track" role="slider" tabindex="0" aria-label="Value" aria-valuenow=${cur}
            @pointerdown=${this._numDown} @pointermove=${this._numMove} @pointerup=${this._numUp} @keydown=${this._numKey}>
            <div class="fill" style="width:${Math.max(0, Math.min(100, pct))}%;background:linear-gradient(90deg,#7c9cff,#bcd6ff)"></div>
            <span class="pct">${cur}</span>
          </div>
        </div>
      </div>
    `;
  }
  private _numDrag = false;
  private _numFromEvent(e: PointerEvent): number {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const { min, max, step } = this._numBounds();
    const frac = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    return Math.round((min + frac * (max - min)) / step) * step;
  }
  private _numDown = (e: PointerEvent): void => { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); this._numDrag = true; this._setNumber(this._numFromEvent(e)); };
  private _numMove = (e: PointerEvent): void => { if (!this._numDrag) return; const now = Date.now(); if (now - this._lastCall < 120) return; this._lastCall = now; this._setNumber(this._numFromEvent(e)); };
  private _numUp = (e: PointerEvent): void => { if (!this._numDrag) return; this._numDrag = false; this._setNumber(this._numFromEvent(e)); };
  private _numKey = (e: KeyboardEvent): void => {
    const { min, max, step } = this._numBounds();
    const cur = Number(this._state(this.entityIds[0])?.state) || min;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') this._setNumber(Math.min(max, cur + step));
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') this._setNumber(Math.max(min, cur - step));
  };
  private _setNumber(v: number): void {
    this._call(this._domain, 'set_value', { value: v });
  }

  // ---- Select (select / input_select) -----------------------------------
  private _renderSelect(): TemplateResult {
    const state = this._state(this.entityIds[0]);
    const options: string[] = Array.isArray(state?.attributes?.options) ? state!.attributes.options : [];
    const cur = state?.state;
    if (!options.length) return html`<div class="body"></div>`;
    if (options.length <= 4) {
      return html`<div class="body">
        <div class="row modes">
          ${options.map((o) => html`<button class="mode ${cur === o ? 'sel' : ''}" @click=${() => this._call(this._domain, 'select_option', { option: o })}>${o}</button>`)}
        </div>
      </div>`;
    }
    return html`<div class="body">
      <div class="row">
        <select class="src" aria-label="Option" @change=${(e: Event) => this._call(this._domain, 'select_option', { option: (e.target as HTMLSelectElement).value })}>
          ${options.map((o) => html`<option value=${o}>${o}</option>`)}
        </select>
      </div>
    </div>`;
  }

  // ---- Alarm ------------------------------------------------------------
  private _renderAlarm(): TemplateResult {
    const state = this._state(this.entityIds[0]);
    const c = alarmCaps(state);
    const s = state?.state ?? 'unknown';
    const arm = (svc: string) => () => {
      const data: Record<string, unknown> = {};
      if (c.codeFormat && typeof window !== 'undefined' && typeof window.prompt === 'function') {
        const v = window.prompt('Enter alarm code');
        if (v == null) return;
        data.code = v;
      }
      this._call('alarm_control_panel', svc, data);
    };
    return html`
      <div class="body">
        <div class="row modes">
          ${c.armHome ? html`<button class="mode ${s === 'armed_home' ? 'sel' : ''}" @click=${arm('alarm_arm_home')}><ha-icon icon="mdi:home"></ha-icon> Home</button>` : nothing}
          ${c.armAway ? html`<button class="mode ${s === 'armed_away' ? 'sel' : ''}" @click=${arm('alarm_arm_away')}><ha-icon icon="mdi:shield-lock"></ha-icon> Away</button>` : nothing}
          ${c.armNight ? html`<button class="mode ${s === 'armed_night' ? 'sel' : ''}" @click=${arm('alarm_arm_night')}><ha-icon icon="mdi:weather-night"></ha-icon> Night</button>` : nothing}
          ${c.armVacation ? html`<button class="mode ${s === 'armed_vacation' ? 'sel' : ''}" @click=${arm('alarm_arm_vacation')}><ha-icon icon="mdi:airplane"></ha-icon> Vacation</button>` : nothing}
        </div>
        <div class="row">
          <button class="mode ${s === 'disarmed' ? 'sel' : ''}" @click=${arm('alarm_disarm')}><ha-icon icon="mdi:shield-off"></ha-icon> Disarm</button>
        </div>
      </div>
    `;
  }

  // ---- Climate ----------------------------------------------------------
  private _displayTemp(state: HassEntity): number | string {
    const a = state.attributes;
    if (typeof a.temperature === 'number') return a.temperature;
    if (typeof a.target_temp_high === 'number' && typeof a.target_temp_low === 'number') return `${a.target_temp_low}–${a.target_temp_high}`;
    return '—';
  }
  private _renderClimate(): TemplateResult {
    const state = this._state(this.entityIds[0]);
    const c = climateCaps(state);
    const a = state?.attributes ?? {};
    const cur = a.current_temperature;
    const target = a.temperature;
    const range = c.targetRange && typeof a.target_temp_low === 'number';
    return html`
      <div class="body">
        <div class="temp">
          ${typeof cur === 'number' ? html`<span class="h-sub">now ${cur}°</span>` : nothing}
          <span class="tval">${range ? `${a.target_temp_low}–${a.target_temp_high}` : typeof target === 'number' ? target : '—'}<small>°</small></span>
          ${!range && typeof target === 'number'
            ? html`<span class="stepper">
                <button class="step" aria-label="Warmer" @click=${() => this._setTemp(target + c.step, c)}><ha-icon icon="mdi:chevron-up"></ha-icon></button>
                <button class="step" aria-label="Cooler" @click=${() => this._setTemp(target - c.step, c)}><ha-icon icon="mdi:chevron-down"></ha-icon></button>
              </span>`
            : nothing}
        </div>
        ${c.modes.length
          ? html`<div class="row modes">
              ${c.modes.map((m) => html`<button class="mode ${state?.state === m ? 'sel' : ''}" @click=${() => this._call('climate', 'set_hvac_mode', { hvac_mode: m })}>${m.replace('_', ' ')}</button>`)}
            </div>`
          : nothing}
      </div>
    `;
  }
  private _setTemp(t: number, c: { min: number; max: number }): void {
    this._call('climate', 'set_temperature', { temperature: Math.max(c.min, Math.min(c.max, t)) });
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'av-control-surface': AvControlSurface;
  }
}
