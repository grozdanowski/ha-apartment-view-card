import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { fireEvent, type HomeAssistant } from 'custom-card-helpers';
import {
  normalizeConfig,
  type ApartmentViewConfig,
  type EntityConfig,
  type ZoneConfig,
} from '../core/config';
import {
  optionsSchema,
  IMAGE_FIELDS,
  type ImageFieldKey,
  entitySchema,
  entityToForm,
  formToEntity,
  defaultEntity,
  isDirectional,
  zoneSchema,
  defaultZone,
} from './editor-helpers';
import './preview-canvas';

@customElement('apartment-view-card-editor')
export class ApartmentViewCardEditor extends LitElement {
  @property({ attribute: false }) public hass!: HomeAssistant;
  @state() private _config!: ApartmentViewConfig;
  @state() private _selectedEntity = -1;
  @state() private _drawingZone = false;
  @state() private _uploadingKey: ImageFieldKey | null = null;

  static styles = css`
    .section {
      margin-bottom: 24px;
    }
    .section-title {
      font-weight: 600;
      margin: 16px 0 8px;
    }
    .entity-row {
      border: 1px solid var(--divider-color);
      border-radius: 8px;
      padding: 8px;
      margin-bottom: 8px;
    }
    .entity-row.selected {
      border-color: var(--primary-color);
    }
    .row-header {
      display: flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
    }
    .row-title {
      flex: 1;
      font-weight: 500;
    }
    .add-entity,
    .add-zone {
      margin-top: 8px;
    }
    .zone-row {
      border: 1px solid var(--divider-color);
      border-radius: 8px;
      padding: 8px;
      margin-bottom: 8px;
    }
    .zone-actions {
      display: flex;
      gap: 4px;
      margin-left: auto;
    }
    .image-field {
      margin-bottom: 12px;
    }
    .image-label {
      display: block;
      font-size: 0.9em;
      color: var(--secondary-text-color);
      margin-bottom: 4px;
    }
    .image-row {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .image-thumb {
      width: 48px;
      height: 36px;
      object-fit: cover;
      border-radius: 4px;
      border: 1px solid var(--divider-color);
      flex: 0 0 auto;
      background: var(--secondary-background-color);
    }
    .image-thumb--empty {
      display: grid;
      place-items: center;
      font-size: 0.65em;
      color: var(--disabled-text-color);
    }
    .image-url {
      flex: 1 1 auto;
      min-width: 0;
      padding: 8px;
      border: 1px solid var(--divider-color);
      border-radius: 4px;
      background: var(--card-background-color);
      color: var(--primary-text-color);
      font: inherit;
    }
    .image-upload-btn {
      flex: 0 0 auto;
      padding: 8px 12px;
      border-radius: 4px;
      background: var(--primary-color);
      color: var(--text-primary-color);
      cursor: pointer;
      white-space: nowrap;
      font-size: 0.9em;
    }
    .image-clear {
      flex: 0 0 auto;
      border: none;
      background: transparent;
      color: var(--secondary-text-color);
      cursor: pointer;
      font-size: 1em;
      padding: 4px 6px;
    }
  `;

  public get config(): ApartmentViewConfig {
    return this._config;
  }

  public setConfig(config: any): void {
    // normalizeConfig fills defaults, applies breaking renames, preserves unknown keys.
    this._config = normalizeConfig(config);
  }

  private _optionsLabel = (schema: { name: string }): string => {
    const labels: Record<string, string> = {
      view: 'Time-of-day view',
      lightStyle: 'Light style',
      freePanZoom: 'Free pan / zoom',
      zoomMax: 'Max zone-zoom scale',
      duskDawnOffsetMinutes: 'Dusk/Dawn offset',
    };
    return labels[schema.name] ?? schema.name;
  };

  private _onOptionsChanged(ev: CustomEvent): void {
    ev.stopPropagation();
    const v = ev.detail.value as Record<string, any>;
    // Spread _config first so images/entities/zones/unknown keys survive.
    const config: ApartmentViewConfig = {
      ...this._config,
      options: {
        ...this._config.options,
        view: v.view,
        lightStyle: v.lightStyle,
        freePanZoom: v.freePanZoom,
        zoomMax: v.zoomMax,
        duskDawnOffsetMinutes: v.duskDawnOffsetMinutes,
      },
    };
    this._config = config;
    fireEvent(this, 'config-changed', { config });
  }

  /** <ha-picture-upload> emits a `change` event; its `.value` is the new URL (or null when cleared). */
  private _onImageChanged(key: ImageFieldKey, value: string | null): void {
    const images = { ...this._config.images };
    if (value) {
      images[key] = value;
    } else if (key === 'base') {
      images.base = ''; // required: cleared -> empty so the preview shows the "configure" warning
    } else {
      delete (images as Record<string, unknown>)[key];
    }
    const config: ApartmentViewConfig = { ...this._config, images };
    this._config = config;
    fireEvent(this, 'config-changed', { config });
  }

  /**
   * Upload a picked file to HA's image store and use its serve URL. Uses only
   * always-available primitives (file input + hass.fetchWithAuth + the image
   * integration from default_config) — NOT a lazy HA component that may be
   * unregistered in a custom-card editor context.
   */
  private async _onImageFilePicked(key: ImageFieldKey, ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const file = input.files && input.files[0];
    if (!file) return;
    this._uploadingKey = key;
    try {
      const body = new FormData();
      body.append('file', file);
      const resp = await (
        this.hass as unknown as {
          fetchWithAuth: (path: string, init: RequestInit) => Promise<Response>;
        }
      ).fetchWithAuth('/api/image/upload', { method: 'POST', body });
      if (!resp.ok) throw new Error(`upload failed (${resp.status})`);
      const data = (await resp.json()) as { id: string };
      this._onImageChanged(key, `/api/image/serve/${data.id}/original`);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('apartment-view-card: image upload failed', err);
    } finally {
      this._uploadingKey = null;
      input.value = '';
    }
  }

  private _commitEntities(entities: EntityConfig[]): void {
    const config: ApartmentViewConfig = { ...this._config, entities };
    this._config = config;
    fireEvent(this, 'config-changed', { config });
  }

  private _addEntity(): void {
    this._commitEntities([...this._config.entities, defaultEntity()]);
    this._selectedEntity = this._config.entities.length - 1;
  }

  private _removeEntity(index: number): void {
    const entities = this._config.entities.filter((_, i) => i !== index);
    if (this._selectedEntity === index) this._selectedEntity = -1;
    this._commitEntities(entities);
  }

  private _selectEntity(index: number): void {
    this._selectedEntity = this._selectedEntity === index ? -1 : index;
  }

  private _entityLabel = (schema: { name: string }): string => {
    const labels: Record<string, string> = {
      entity: 'Entity',
      name: 'Name (optional)',
      icon: 'Icon (optional)',
      size: 'Size',
      tap: 'Tap action',
      lightStyle: 'Light style override',
      x: 'X position',
      y: 'Y position',
      directional: 'Directional (cone)',
      orientation: 'Orientation',
    };
    return labels[schema.name] ?? schema.name;
  };

  private _onEntityChanged(ev: CustomEvent, index: number): void {
    ev.stopPropagation();
    const prev = this._config.entities[index];
    const next = formToEntity(prev, ev.detail.value);
    const entities = this._config.entities.map((e, i) =>
      i === index ? next : e
    );
    this._commitEntities(entities);
  }

  private _onPreviewEntityMoved(ev: CustomEvent): void {
    const { index, x, y } = ev.detail as {
      index: number;
      x: number;
      y: number;
    };
    const entities = this._config.entities.map((e, i) =>
      i === index ? { ...e, x, y } : e
    );
    this._commitEntities(entities);
  }

  private _onPreviewEntitySelected(ev: CustomEvent): void {
    this._selectedEntity = (ev.detail as { index: number }).index;
  }

  private _commitZones(zones: ZoneConfig[]): void {
    const config: ApartmentViewConfig = { ...this._config, zones };
    this._config = config;
    fireEvent(this, 'config-changed', { config });
  }

  private _startDrawZone(): void {
    this._drawingZone = true;
  }

  private _onZoneDrawn(ev: CustomEvent): void {
    const rect = ev.detail as {
      x: number;
      y: number;
      width: number;
      height: number;
    };
    const base = defaultZone();
    const zone: ZoneConfig = {
      name: base.name,
      ...(base.icon !== undefined ? { icon: base.icon } : {}),
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    };
    this._drawingZone = false;
    this._commitZones([...this._config.zones, zone]);
  }

  private _onZoneDrawCancelled(): void {
    this._drawingZone = false;
  }

  private _removeZone(index: number): void {
    this._commitZones(this._config.zones.filter((_, i) => i !== index));
  }

  private _moveZone(index: number, delta: number): void {
    const target = index + delta;
    if (target < 0 || target >= this._config.zones.length) return;
    const zones = [...this._config.zones];
    const [z] = zones.splice(index, 1);
    zones.splice(target, 0, z);
    this._commitZones(zones);
  }

  private _zoneLabel = (schema: { name: string }): string => {
    const labels: Record<string, string> = {
      name: 'Name',
      icon: 'Icon (optional)',
      x: 'X',
      y: 'Y',
      width: 'Width',
      height: 'Height',
    };
    return labels[schema.name] ?? schema.name;
  };

  private _onZoneChanged(ev: CustomEvent, index: number): void {
    ev.stopPropagation();
    const v = ev.detail.value as Partial<ZoneConfig>;
    const zones = this._config.zones.map((z, i) =>
      i === index ? { ...z, ...v } : z
    );
    this._commitZones(zones);
  }

  private _renderZones() {
    return html`
      <div class="section">
        <div class="section-title">Zones</div>
        ${this._config.zones.map(
          (z, i) => html`
            <div class="zone-row">
              <div class="row-header">
                <span class="row-title">${z.name}</span>
                <div class="zone-actions">
                  <ha-icon-button
                    class="zone-up"
                    .label=${'Move zone up'}
                    .path=${'M7,15L12,10L17,15H7Z'}
                    @click=${() => this._moveZone(i, -1)}
                  ></ha-icon-button>
                  <ha-icon-button
                    class="zone-down"
                    .label=${'Move zone down'}
                    .path=${'M7,10L12,15L17,10H7Z'}
                    @click=${() => this._moveZone(i, 1)}
                  ></ha-icon-button>
                  <ha-icon-button
                    class="remove-zone"
                    .label=${'Delete zone'}
                    .path=${'M19,4H15.5L14.5,3H9.5L8.5,4H5V6H19M6,19A2,2 0 0,0 8,21H16A2,2 0 0,0 18,19V7H6V19Z'}
                    @click=${() => this._removeZone(i)}
                  ></ha-icon-button>
                </div>
              </div>
              <ha-form
                class="zone-form"
                .hass=${this.hass}
                .data=${z}
                .schema=${zoneSchema()}
                .computeLabel=${this._zoneLabel}
                @value-changed=${(ev: CustomEvent) => this._onZoneChanged(ev, i)}
              ></ha-form>
            </div>
          `
        )}
        <ha-button class="add-zone" @click=${this._startDrawZone}>Add zone</ha-button>
      </div>
    `;
  }

  private _renderEntities() {
    return html`
      <div class="section">
        <div class="section-title">Entities</div>
        ${this._config.entities.map((e, i) => {
          const directional = isDirectional(e.orientation);
          return html`
            <div class="entity-row ${i === this._selectedEntity ? 'selected' : ''}">
              <div class="row-header" @click=${() => this._selectEntity(i)}>
                <span class="row-title">${e.name || e.entity || 'New entity'}</span>
                <ha-icon-button
                  class="remove-entity"
                  .label=${'Remove entity'}
                  .path=${'M19,4H15.5L14.5,3H9.5L8.5,4H5V6H19M6,19A2,2 0 0,0 8,21H16A2,2 0 0,0 18,19V7H6V19Z'}
                  @click=${(ev: Event) => {
                    ev.stopPropagation();
                    this._removeEntity(i);
                  }}
                ></ha-icon-button>
              </div>
              <ha-form
                class="entity-form"
                .hass=${this.hass}
                .data=${entityToForm(e)}
                .schema=${entitySchema(directional)}
                .computeLabel=${this._entityLabel}
                @value-changed=${(ev: CustomEvent) =>
                  this._onEntityChanged(ev, i)}
              ></ha-form>
            </div>
          `;
        })}
        <ha-button class="add-entity" @click=${this._addEntity}>Add entity</ha-button>
      </div>
    `;
  }

  protected render() {
    if (!this.hass || !this._config) {
      return html``;
    }
    return html`
      <preview-canvas
        .base=${this._config.images.base}
        .entities=${this._config.entities}
        .zones=${this._config.zones}
        .selectedEntity=${this._selectedEntity}
        .drawingZone=${this._drawingZone}
        @preview-entity-moved=${this._onPreviewEntityMoved}
        @preview-entity-selected=${this._onPreviewEntitySelected}
        @preview-zone-drawn=${this._onZoneDrawn}
        @preview-zone-draw-cancelled=${this._onZoneDrawCancelled}
      ></preview-canvas>
      <div class="section">
        <div class="section-title">Images</div>
        ${IMAGE_FIELDS.map((f) => {
          const value = this._config.images[f.key];
          return html`
            <div class="image-field">
              <label class="image-label">${f.label}</label>
              <div class="image-row">
                ${value
                  ? html`<img class="image-thumb" src=${value} alt="" />`
                  : html`<div class="image-thumb image-thumb--empty">no image</div>`}
                <input
                  class="image-url image-${f.key}"
                  type="text"
                  .value=${value ?? ''}
                  placeholder="Upload, or paste /local/floorplan.png or a URL"
                  @change=${(ev: Event) =>
                    this._onImageChanged(
                      f.key,
                      (ev.target as HTMLInputElement).value.trim() || null,
                    )}
                />
                <label class="image-upload-btn">
                  ${this._uploadingKey === f.key ? 'Uploading…' : 'Upload'}
                  <input
                    type="file"
                    accept="image/*"
                    hidden
                    @change=${(ev: Event) => this._onImageFilePicked(f.key, ev)}
                  />
                </label>
                ${value && f.key !== 'base'
                  ? html`<button
                      class="image-clear"
                      title="Remove"
                      @click=${() => this._onImageChanged(f.key, null)}
                    >
                      ✕
                    </button>`
                  : ''}
              </div>
            </div>
          `;
        })}
      </div>
      <div class="section">
        <div class="section-title">Options</div>
        <ha-form
          class="options"
          .hass=${this.hass}
          .data=${this._config.options}
          .schema=${optionsSchema()}
          .computeLabel=${this._optionsLabel}
          @value-changed=${this._onOptionsChanged}
        ></ha-form>
      </div>
      ${this._renderEntities()}
      ${this._renderZones()}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'apartment-view-card-editor': ApartmentViewCardEditor;
  }
}
