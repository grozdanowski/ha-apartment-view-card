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
  imagesOptionsSchema,
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
                    .path=${'M7,15L12,10L17,15H7Z'}
                    @click=${() => this._moveZone(i, -1)}
                  ></ha-icon-button>
                  <ha-icon-button
                    class="zone-down"
                    .path=${'M7,10L12,15L17,10H7Z'}
                    @click=${() => this._moveZone(i, 1)}
                  ></ha-icon-button>
                  <ha-icon-button
                    class="remove-zone"
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
