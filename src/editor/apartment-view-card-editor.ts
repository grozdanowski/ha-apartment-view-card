import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { fireEvent, type HomeAssistant } from 'custom-card-helpers';
import {
  normalizeConfig,
  type ApartmentViewConfig,
  type EntityConfig,
  type ZoneConfig,
} from '../core/config';
import {
  IMAGE_FIELDS,
  type ImageFieldKey,
  entitySchema,
  entityToForm,
  formToEntity,
  defaultEntity,
  isDirectional,
  zoneSchema,
  defaultZone,
  labelsSchema,
  stageOptionsSchema,
  lightingOptionsSchema,
} from './editor-helpers';

type EditorTab = 'floorplan' | 'devices' | 'lighting' | 'zones';
const TABS: { id: EditorTab; label: string; icon: string }[] = [
  { id: 'floorplan', label: 'Floorplan', icon: 'mdi:floor-plan' },
  { id: 'devices', label: 'Devices', icon: 'mdi:devices' },
  { id: 'lighting', label: 'Lighting', icon: 'mdi:lightbulb-group' },
  { id: 'zones', label: 'Zones', icon: 'mdi:select-group' },
];
import './preview-canvas';

@customElement('apartment-view-card-editor')
export class ApartmentViewCardEditor extends LitElement {
  @property({ attribute: false }) public hass!: HomeAssistant;
  @state() private _config!: ApartmentViewConfig;
  @state() private _selectedEntity = -1;
  @state() private _drawingZone = false;
  @state() private _uploadingKey: ImageFieldKey | null = null;
  @state() private _tab: EditorTab = 'devices';
  @state() private _entitySearch = '';

  static styles = css`
    .tabs {
      display: flex;
      gap: 2px;
      border-bottom: 1px solid var(--divider-color);
      margin: 8px 0 16px;
      overflow-x: auto;
      scrollbar-width: thin;
    }
    .tab {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 10px 14px;
      border: none;
      background: none;
      cursor: pointer;
      font: inherit;
      font-size: 0.95em;
      color: var(--secondary-text-color);
      border-bottom: 2px solid transparent;
      white-space: nowrap;
      --mdc-icon-size: 18px;
    }
    .tab.active {
      color: var(--primary-color);
      border-bottom-color: var(--primary-color);
    }
    .tab-pane {
      display: none;
    }
    .tab-pane.active {
      display: block;
    }
    .import-row {
      margin-bottom: 10px;
    }
    .area-import,
    .entity-search {
      width: 100%;
      box-sizing: border-box;
      padding: 9px 10px;
      border-radius: 6px;
      border: 1px solid var(--divider-color);
      background: var(--card-background-color);
      color: var(--primary-text-color);
      font: inherit;
    }
    .entity-search {
      margin-bottom: 10px;
    }
    .section {
      margin-bottom: 24px;
    }
    .section-title {
      font-weight: 600;
      margin: 16px 0 8px;
    }
    .section-hint {
      font-size: 0.85em;
      color: var(--secondary-text-color);
      margin: 0 0 10px;
      line-height: 1.4;
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
    .row-header:focus-visible {
      outline: 2px solid var(--primary-color);
      outline-offset: 2px;
      border-radius: 4px;
    }
    .chevron {
      flex: 0 0 auto;
      --mdc-icon-size: 18px;
      color: var(--secondary-text-color);
      transition: transform 0.15s ease;
    }
    .chevron.open {
      transform: rotate(90deg);
    }
    .entity-form {
      display: block;
      margin-top: 10px;
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
      iconSize: 'Marker size (zoomed out)',
      iconSizeMax: 'Max marker size (zoomed in)',
    };
    return labels[schema.name] ?? schema.name;
  };

  private _onOptionsChanged(ev: CustomEvent): void {
    ev.stopPropagation();
    // ha-form sends the full options object; merge it so every field (incl.
    // iconSize/iconSizeMax and any future option) is picked up. Spread _config
    // first so images/entities/zones/unknown keys survive.
    const v = ev.detail.value as Record<string, any>;
    const config: ApartmentViewConfig = {
      ...this._config,
      options: { ...this._config.options, ...v },
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

  private _matchesSearch(e: EntityConfig): boolean {
    const q = this._entitySearch.trim().toLowerCase();
    if (!q) return true;
    return (e.name ?? '').toLowerCase().includes(q) || e.entity.toLowerCase().includes(q);
  }

  private _sensibleDomains = new Set([
    'light', 'switch', 'input_boolean', 'media_player', 'climate', 'cover',
    'fan', 'lock', 'sensor', 'binary_sensor', 'vacuum', 'humidifier',
  ]);

  /** Entity ids in an HA area (via the entity's own area, else its device's), not yet placed. */
  private _entitiesInArea(areaId: string): string[] {
    const reg = (this.hass as any).entities ?? {};
    const dev = (this.hass as any).devices ?? {};
    const placed = new Set(this._config.entities.map((e) => e.entity));
    return Object.values(reg)
      .filter((e: any) => {
        if (e.hidden || e.disabled_by) return false;
        const aid = e.area_id ?? dev[e.device_id]?.area_id;
        return (
          aid === areaId &&
          !placed.has(e.entity_id) &&
          this._sensibleDomains.has((e.entity_id.split('.')[0] || '').toLowerCase())
        );
      })
      .map((e: any) => e.entity_id);
  }

  /** Append an area's devices as markers in a loose grid; the user drags them into place. */
  private _addEntitiesFromArea(areaId: string): void {
    const ids = this._entitiesInArea(areaId);
    if (!ids.length) return;
    const start = this._config.entities.length;
    const added: EntityConfig[] = ids.map((id, i) => {
      const n = start + i;
      return { ...defaultEntity(), entity: id, x: 14 + (n % 5) * 17, y: 14 + (Math.floor(n / 5) % 5) * 17 };
    });
    this._commitEntities([...this._config.entities, ...added]);
    this._tab = 'devices';
  }

  private _removeEntity(index: number): void {
    const entities = this._config.entities.filter((_, i) => i !== index);
    if (this._selectedEntity === index) this._selectedEntity = -1;
    this._commitEntities(entities);
  }

  private _selectEntity(index: number): void {
    this._selectedEntity = this._selectedEntity === index ? -1 : index;
  }

  /** Keyboard support for the collapsible entity header (Enter/Space toggles). */
  private _onRowKey(ev: KeyboardEvent, index: number): void {
    if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      this._selectEntity(index);
    }
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
      labelSource: 'Label',
      labelText: 'Label text',
      labelAttribute: 'Attribute name',
      labelVisibility: 'Label visibility',
    };
    return labels[schema.name] ?? schema.name;
  };

  private _labelsLabel = (schema: { name: string }): string => {
    const labels: Record<string, string> = {
      source: 'Default label',
      visibility: 'When to show labels',
    };
    return labels[schema.name] ?? schema.name;
  };

  private _onLabelsChanged(ev: CustomEvent): void {
    ev.stopPropagation();
    const v = ev.detail.value as { source?: string; visibility?: string };
    const config: ApartmentViewConfig = {
      ...this._config,
      options: {
        ...this._config.options,
        labels: {
          ...this._config.options.labels,
          source: (v.source ?? this._config.options.labels.source) as any,
          visibility: (v.visibility ?? this._config.options.labels.visibility) as any,
        },
      },
    };
    this._config = config;
    fireEvent(this, 'config-changed', { config });
  }

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

  private _renderImportFromArea() {
    const areas = (this.hass as unknown as { areas?: Record<string, { area_id: string; name: string }> }).areas ?? {};
    const list = Object.values(areas);
    if (!list.length) return nothing;
    return html`<div class="import-row">
      <select
        class="area-import"
        aria-label="Import devices from a room"
        @change=${(ev: Event) => {
          const sel = ev.target as HTMLSelectElement;
          if (sel.value) this._addEntitiesFromArea(sel.value);
          sel.value = '';
        }}
      >
        <option value="">+ Import devices from a room…</option>
        ${list
          .slice()
          .sort((a, b) => String(a.name).localeCompare(String(b.name)))
          .map((a) => html`<option value=${a.area_id}>${a.name}</option>`)}
      </select>
    </div>`;
  }

  private _renderEntities() {
    return html`
      <div class="section">
        <div class="section-title">Entities</div>
        ${this._renderImportFromArea()}
        ${this._config.entities.length > 5
          ? html`<input
              class="entity-search"
              type="search"
              placeholder="Search devices…"
              .value=${this._entitySearch}
              @input=${(ev: Event) => {
                this._entitySearch = (ev.target as HTMLInputElement).value;
              }}
            />`
          : nothing}
        ${this._config.entities
          .map((e, i) => ({ e, i }))
          .filter(({ e }) => this._matchesSearch(e))
          .map(({ e, i }) => {
          const directional = isDirectional(e.orientation);
          const expanded = i === this._selectedEntity;
          return html`
            <div class="entity-row ${expanded ? 'selected' : ''}">
              <div
                class="row-header"
                role="button"
                tabindex="0"
                aria-expanded=${expanded ? 'true' : 'false'}
                @click=${() => this._selectEntity(i)}
                @keydown=${(ev: KeyboardEvent) => this._onRowKey(ev, i)}
              >
                <ha-icon
                  class="chevron ${expanded ? 'open' : ''}"
                  icon="mdi:chevron-right"
                ></ha-icon>
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
              ${expanded
                ? html`<ha-form
                    class="entity-form"
                    .hass=${this.hass}
                    .data=${entityToForm(e)}
                    .schema=${entitySchema(directional, e.label?.source ?? 'inherit')}
                    .computeLabel=${this._entityLabel}
                    @value-changed=${(ev: CustomEvent) =>
                      this._onEntityChanged(ev, i)}
                  ></ha-form>`
                : nothing}
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
      <div class="tabs" role="tablist">
        ${TABS.map(
          (t) => html`<button
            role="tab"
            class="tab ${this._tab === t.id ? 'active' : ''}"
            aria-selected=${this._tab === t.id ? 'true' : 'false'}
            @click=${() => {
              this._tab = t.id;
            }}
          >
            <ha-icon icon=${t.icon}></ha-icon><span>${t.label}</span>
          </button>`,
        )}
      </div>
      <div class="tab-pane tab-floorplan ${this._tab === 'floorplan' ? 'active' : ''}">
        ${this._renderFloorplanTab()}
      </div>
      <div class="tab-pane tab-devices ${this._tab === 'devices' ? 'active' : ''}">
        ${this._renderEntities()}
      </div>
      <div class="tab-pane tab-lighting ${this._tab === 'lighting' ? 'active' : ''}">
        ${this._renderLightingTab()}
      </div>
      <div class="tab-pane tab-zones ${this._tab === 'zones' ? 'active' : ''}">
        ${this._renderZones()}
      </div>
    `;
  }

  private _renderFloorplanTab() {
    return html`
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
        <div class="section-title">View &amp; motion</div>
        <ha-form
          class="options"
          .hass=${this.hass}
          .data=${this._config.options}
          .schema=${stageOptionsSchema()}
          .computeLabel=${this._optionsLabel}
          @value-changed=${this._onOptionsChanged}
        ></ha-form>
      </div>
    `;
  }

  private _renderLightingTab() {
    return html`
      <div class="section">
        <div class="section-title">Light style</div>
        <ha-form
          class="lighting-options"
          .hass=${this.hass}
          .data=${this._config.options}
          .schema=${lightingOptionsSchema()}
          .computeLabel=${this._optionsLabel}
          @value-changed=${this._onOptionsChanged}
        ></ha-form>
      </div>
      <div class="section">
        <div class="section-title">Labels</div>
        <div class="section-hint">
          A glanceable value beside each marker. "Smart" picks a sensible value per device
          (temperature, now-playing…) and leaves lights quiet. Override per entity below.
        </div>
        <ha-form
          class="labels"
          .hass=${this.hass}
          .data=${this._config.options.labels}
          .schema=${labelsSchema()}
          .computeLabel=${this._labelsLabel}
          @value-changed=${this._onLabelsChanged}
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
