import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { fireEvent, type HomeAssistant } from 'custom-card-helpers';
import { normalizeConfig, type ApartmentViewConfig } from '../core/config';
import { imagesOptionsSchema } from './editor-helpers';

@customElement('apartment-view-card-editor')
export class ApartmentViewCardEditor extends LitElement {
  @property({ attribute: false }) public hass!: HomeAssistant;
  @state() private _config!: ApartmentViewConfig;

  static styles = css`
    .section {
      margin-bottom: 24px;
    }
    .section-title {
      font-weight: 600;
      margin: 16px 0 8px;
    }
  `;

  public get config(): ApartmentViewConfig {
    return this._config;
  }

  public setConfig(config: any): void {
    // normalizeConfig fills defaults, applies breaking renames, preserves unknown keys.
    this._config = normalizeConfig(config);
  }

  /** Flatten images + options into a single ha-form data object. */
  private _imagesOptionsData(): Record<string, unknown> {
    return { ...this._config.images, ...this._config.options };
  }

  private _imagesOptionsLabel = (schema: { name: string }): string => {
    const labels: Record<string, string> = {
      base: 'Base render (required)',
      allLights: 'All-lights render (enables "reveal")',
      night: 'Night render (optional)',
      duskDawn: 'Dusk/Dawn render (optional)',
      view: 'Time-of-day view',
      lightStyle: 'Light style',
      freePanZoom: 'Free pan / zoom',
      zoomMax: 'Max zone-zoom scale',
      duskDawnOffsetMinutes: 'Dusk/Dawn offset',
    };
    return labels[schema.name] ?? schema.name;
  };

  private _onImagesOptionsChanged(ev: CustomEvent): void {
    ev.stopPropagation();
    const v = ev.detail.value as Record<string, any>;
    const images = {
      base: v.base,
      allLights: v.allLights || undefined,
      night: v.night || undefined,
      duskDawn: v.duskDawn || undefined,
    };
    const options = {
      view: v.view,
      lightStyle: v.lightStyle,
      freePanZoom: v.freePanZoom,
      zoomMax: v.zoomMax,
      duskDawnOffsetMinutes: v.duskDawnOffsetMinutes,
    };
    // Spread _config first so entities/zones/unknown keys survive.
    const config: ApartmentViewConfig = {
      ...this._config,
      images: { ...this._config.images, ...images },
      options: { ...this._config.options, ...options },
    };
    this._config = config;
    fireEvent(this, 'config-changed', { config });
  }

  protected render() {
    if (!this.hass || !this._config) {
      return html``;
    }
    return html`
      <div class="section">
        <div class="section-title">Images &amp; options</div>
        <ha-form
          class="images-options"
          .hass=${this.hass}
          .data=${this._imagesOptionsData()}
          .schema=${imagesOptionsSchema()}
          .computeLabel=${this._imagesOptionsLabel}
          @value-changed=${this._onImagesOptionsChanged}
        ></ha-form>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'apartment-view-card-editor': ApartmentViewCardEditor;
  }
}
