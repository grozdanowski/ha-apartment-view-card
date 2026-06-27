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
      background: color-mix(in srgb, var(--primary-text-color, #fff) 8%, transparent); color: var(--secondary-text-color, #b9bdc6); text-transform: capitalize;
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
  /** When >1 entity, the surface is always a light group; else the single entity's kind. */
  private get _kind(): ControlKind {
    if (this.entityIds.length > 1) return 'light';
    return this.entityIds.length === 1 ? controlKind(this.entityIds[0]) : 'light';
  }
  private _call(domain: string, service: string, data: Record<string, unknown>): void {
    this.hass?.callService(domain, service, { entity_id: this.entityIds, ...data });
  }
  private _close(): void {
    this.dispatchEvent(new CustomEvent('surface-close', { bubbles: true, composed: true }));
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
        title = `${this.entityIds.length} lights`;
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
        <button class="pwr ${anyOn ? '' : 'off'}" @click=${() => this._call('homeassistant', anyOn ? 'turn_off' : 'turn_on', {})} ?disabled=${disabled}>
          <ha-icon icon="mdi:power"></ha-icon>${multi ? (anyOn ? 'All off' : 'All on') : anyOn ? 'Off' : 'On'}
        </button>
        <button class="close" aria-label="Close" @click=${this._close}><ha-icon icon="mdi:close"></ha-icon></button>
      </div>
    `;
  }

  private _singleSub(state: HassEntity | undefined): string {
    if (!state) return '';
    const k = controlKind(state.entity_id);
    if (k === 'climate') return isActive(state) ? `${state.state} · ${this._displayTemp(state)}°` : 'Off';
    if (k === 'media') return isActive(state) ? (state.state === 'playing' ? 'Playing' : 'Paused') : 'Off';
    return isActive(state) ? `${Math.round(intensity(state) * 100)}%` : 'Off';
  }
  private _avatarIcon(id: string): string {
    const k = id ? controlKind(id) : 'light';
    return k === 'media' ? 'mdi:cast' : k === 'climate' ? 'mdi:thermostat' : 'mdi:lightbulb';
  }
  private _avatarStyle(state: HassEntity | undefined): Record<string, string> {
    const on = state ? isActive(state) : false;
    const color = state && on && controlKind(state.entity_id) === 'light' ? rgbCss(resolveLightColor(state)) : 'var(--secondary-text-color, #9aa0a8)';
    return { color };
  }

  private _renderBody(disabled: boolean): TemplateResult {
    const kind = this._kind;
    if (kind === 'media') return this._renderMedia();
    if (kind === 'climate') return this._renderClimate();
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
    return html`
      <div class="body">
        ${title
          ? html`<div class="row"><span class="nowplaying"><b>${title}</b>${a.media_artist ? ' · ' + a.media_artist : ''}</span></div>`
          : nothing}
        <div class="row transport">
          ${c.previous ? html`<button class="tbtn" aria-label="Previous" @click=${() => this._call('media_player', 'media_previous_track', {})}><ha-icon icon="mdi:skip-previous"></ha-icon></button>` : nothing}
          ${c.play || c.pause
            ? html`<button class="tbtn play" aria-label="Play or pause" @click=${() => this._call('media_player', 'media_play_pause', {})}><ha-icon icon=${playing ? 'mdi:pause' : 'mdi:play'}></ha-icon></button>`
            : nothing}
          ${c.next ? html`<button class="tbtn" aria-label="Next" @click=${() => this._call('media_player', 'media_next_track', {})}><ha-icon icon="mdi:skip-next"></ha-icon></button>` : nothing}
          ${c.volume
            ? html`<span class="ico" style="margin-left:6px"><ha-icon icon="mdi:volume-high"></ha-icon></span>
                <div class="track" role="slider" tabindex="0" aria-label="Volume" aria-valuenow=${Math.round(vol * 100)} style="height:34px"
                  @pointerdown=${this._volDown} @pointermove=${this._volMove}>
                  <div class="fill" style="width:${Math.round(vol * 100)}%;background:linear-gradient(90deg,#5b9bff,#bcd6ff)"></div>
                </div>`
            : nothing}
        </div>
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
