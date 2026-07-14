import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { fireEvent, type HomeAssistant } from 'custom-card-helpers';
import {
  normalizeConfig,
  roomIdFor,
  wallParts,
  zoneForPoint,
  zoneForEntity,
  type ApartmentViewConfig,
  type EntityConfig,
  type ZoneConfig,
  type QuickAction,
  type OpeningConfig,
  type OpeningKind,
  type SpatialConfig,
  type SpatialDimensions,
  type WallConfig,
  type SpatialPlan,
  type SpatialRoom,
  type SpatialShellOpening,
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
  quickActionSchema,
  defaultZone,
  labelsSchema,
  stageOptionsSchema,
  lightingOptionsSchema,
} from './editor-helpers';
import { withSuggestedEntityPolicy } from '../core/entity-policy';
import {
  addSpatialObject,
  emptySpatialPlan,
  rectangularSpatialPlan,
  removeSpatialObject,
  updateSpatialObject,
  updateSpatialWall,
  withDerivedSpatialRooms,
} from '../core/spatial-plan';
import { roomPolygon, spatialBounds, validateSpatialPlan, wallLength } from '../core/spatial-geometry';
import { SPATIAL_ASSETS, SPATIAL_ASSET_CATEGORIES, spatialAsset, type SpatialAssetDefinition, type SpatialAssetCategory } from '../core/spatial-assets';
import { assignShellOpenings, shellSegmentById } from '../core/spatial-shell';
import { resolveSpatialEntityState } from '../core/spatial-state';

type EditorTab = 'floorplan' | 'devices' | 'lighting' | 'zones' | 'actions';
type EditorMode = 'setup' | 'advanced';
type SetupStep = 'floorplan' | 'rooms' | 'architecture' | 'furniture' | 'devices' | 'review';
type PreviewMode = 'edit' | '3d';
type HomeChange =
  | { kind: 'rename'; zoneId: string; currentName: string; areaName: string }
  | { kind: 'new-devices'; areaId: string; areaName: string; count: number }
  | { kind: 'missing-area'; zoneId: string; zoneName: string };
const TABS: { id: EditorTab; label: string; icon: string }[] = [
  { id: 'floorplan', label: 'Floorplan', icon: 'mdi:floor-plan' },
  { id: 'devices', label: 'Devices', icon: 'mdi:devices' },
  { id: 'lighting', label: 'Lighting', icon: 'mdi:lightbulb-group' },
  { id: 'zones', label: 'Zones', icon: 'mdi:select-group' },
  { id: 'actions', label: 'Quick actions', icon: 'mdi:flash' },
];
const SETUP_STEPS: { id: SetupStep; label: string; icon: string }[] = [
  { id: 'floorplan', label: 'Structure', icon: 'mdi:vector-polyline' },
  { id: 'rooms', label: 'Rooms', icon: 'mdi:door' },
  { id: 'architecture', label: 'Openings', icon: 'mdi:door-open' },
  { id: 'furniture', label: 'Furniture', icon: 'mdi:sofa-outline' },
  { id: 'devices', label: 'Devices', icon: 'mdi:devices' },
  { id: 'review', label: 'Review', icon: 'mdi:check-circle-outline' },
];
import './preview-canvas';
import './spatial-preview';
import './spatial-plan-editor';

@customElement('apartment-view-card-editor')
export class ApartmentViewCardEditor extends LitElement {
  @property({ attribute: false }) public hass!: HomeAssistant;
  @state() private _config!: ApartmentViewConfig;
  @state() private _selectedEntity = -1;
  @state() private _drawingZone = false;
  @state() private _uploadingKey: ImageFieldKey | null = null;
  @state() private _tab: EditorTab = 'devices';
  @state() private _mode: EditorMode = 'setup';
  @state() private _setupStep: SetupStep = 'floorplan';
  @state() private _entitySearch = '';
  @state() private _pendingZoneName = '';
  @state() private _pendingAreaId = '';
  @state() private _selectedWallId = '';
  @state() private _selectedOpeningId = '';
  @state() private _selectedRoomId = '';
  @state() private _selectedObjectId = '';
  @state() private _previewMode: PreviewMode = 'edit';
  @state() private _previewCollapsed = false;
  @state() private _assetSearch = '';
  @state() private _assetCategory: SpatialAssetCategory | 'All' = 'All';
  @state() private _undoCount = 0;
  @state() private _redoCount = 0;
  private _undoStack: ApartmentViewConfig[] = [];
  private _redoStack: ApartmentViewConfig[] = [];
  private _lastEmittedConfig: ApartmentViewConfig | null = null;
  private _dragStartConfig: ApartmentViewConfig | null = null;
  /** Local quick-actions draft; normalize would drop half-filled rows. */
  @state() private _actionsDraft: QuickAction[] | null = null;

  static styles = css`
    :host {
      display: block;
      width: 100%;
      min-width: 0;
      box-sizing: border-box;
      --studio-accent: #a9d2d8;
      --studio-line: color-mix(in srgb, var(--primary-text-color) 14%, transparent);
      container-type: inline-size;
    }
    .editor-workspace { display: grid; min-width: 0; gap: 28px; }
    .preview-panel, .controls-panel { min-width: 0; }
    .preview-panel { align-self: start; }
    .preview-collapse { display: none; }
    .setup-progress { display: none; }
    .tabs {
      display: flex;
      gap: 24px;
      border-bottom: 1px solid var(--studio-line);
      margin: 12px 0 24px;
      overflow-x: auto;
      scrollbar-width: none;
    }
    .tabs::-webkit-scrollbar { display: none; }
    .editor-mode {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin: 4px 0 18px;
    }
    .editor-title {
      font-size: 24px;
      font-weight: 520;
      letter-spacing: 0;
    }
    .editor-heading { display: flex; align-items: center; gap: 4px; min-width: 0; }
    .history-button[disabled] { opacity: 0.35; pointer-events: none; }
    .preview-toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 10px;
      margin: 0 0 10px;
    }
    .preview-switch { display: inline-flex; gap: 20px; max-width: 100%; overflow-x: auto; border: 0; }
    .preview-switch button { min-height: 44px; padding: 0 0 7px; border: 0; border-bottom: 2px solid transparent; border-radius: 0; background: transparent; color: var(--secondary-text-color); font: inherit; font-size: 16px; cursor: pointer; }
    .preview-switch button.active { border-bottom-color: var(--studio-accent); color: var(--primary-text-color); }
    .preview-note { color: var(--secondary-text-color); font-size: 12px; line-height: 1.35; text-align: right; margin-left: auto; }
    .device-preview-shell { margin: 0 auto; max-width: 100%; }
    .device-preview-shell.phone { width: 390px; }
    .device-preview-shell.tablet { width: 768px; }
    .device-preview-shell.desktop { width: 100%; }
    .device-preview-frame { overflow: hidden; border: 1px solid var(--divider-color); border-radius: 8px; background: var(--primary-background-color); }
    .spatial-empty-preview {
      display: grid;
      place-content: center;
      min-height: 300px;
      padding: 32px;
      border: 1px solid var(--studio-line);
      border-radius: 2px;
      background: transparent;
      color: var(--secondary-text-color);
      text-align: center;
    }
    .spatial-empty-preview ha-icon { margin: 0 auto 10px; color: var(--primary-color); --mdc-icon-size: 28px; }
    .spatial-empty-preview strong { color: var(--primary-text-color); font-size: 1.05em; font-weight: 620; }
    .spatial-empty-preview span { margin-top: 5px; font-size: 0.84em; }
    .mode-switch {
      display: inline-flex;
      align-items: center;
      gap: 22px;
      border: 0;
      background: transparent;
    }
    .mode-switch button {
      min-height: 44px;
      border: 0;
      border-bottom: 2px solid transparent;
      border-radius: 0;
      background: transparent;
      color: var(--secondary-text-color);
      cursor: pointer;
      font: inherit;
      font-size: 15px;
      padding: 0 0 7px;
    }
    .mode-switch button.active {
      color: var(--primary-text-color);
      border-bottom-color: var(--studio-accent);
    }
    .studio-intro {
      max-width: 720px;
      margin: 0 0 24px;
      color: var(--secondary-text-color);
      font-size: 16px;
      line-height: 1.5;
    }
    .setup-steps {
      display: flex;
      gap: 28px;
      margin: 12px 0 26px;
      overflow-x: auto;
      border-bottom: 1px solid var(--studio-line);
      scrollbar-width: none;
    }
    .setup-steps::-webkit-scrollbar { display: none; }
    .setup-step {
      flex: 0 0 auto;
      min-width: 88px;
      min-height: 54px;
      border: 0;
      border-bottom: 3px solid transparent;
      background: transparent;
      color: var(--secondary-text-color);
      cursor: pointer;
      font: inherit;
      font-size: 15px;
      padding: 4px 0 10px;
      text-align: left;
    }
    .setup-step ha-icon { --mdc-icon-size: 18px; display: inline-block; margin: 0 7px 0 0; vertical-align: -4px; }
    .setup-step span { white-space: nowrap; }
    .setup-step.active { color: var(--primary-text-color); border-bottom-color: var(--studio-accent); }
    .setup-card {
      border: 0;
      border-top: 1px solid var(--studio-line);
      border-radius: 0;
      padding: 24px 0;
      margin: 0;
      background: transparent;
    }
    .setup-card h3 { margin: 0 0 8px; font-size: 22px; font-weight: 520; }
    .setup-card p { max-width: 720px; margin: 0; color: var(--secondary-text-color); font-size: 15px; line-height: 1.5; }
    .setup-actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 18px; }
    .suggestion-list { display: grid; gap: 8px; margin-top: 12px; }
    .suggestion {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 10px 0;
      border-top: 1px solid var(--divider-color);
    }
    .suggestion:first-child { border-top: 0; padding-top: 0; }
    .suggestion-copy { min-width: 0; }
    .suggestion-name { font-weight: 600; }
    .suggestion-meta { color: var(--secondary-text-color); font-size: 0.84em; margin-top: 2px; }
    .health-list { display: grid; gap: 8px; margin-top: 10px; }
    .health-item { display: flex; align-items: flex-start; gap: 8px; font-size: 0.9em; line-height: 1.35; }
    .health-item ha-icon { flex: 0 0 auto; --mdc-icon-size: 18px; color: var(--secondary-text-color); }
    .health-item.warning ha-icon { color: var(--warning-color, #c98b2c); }
    .health-item.ready ha-icon { color: var(--success-color, #3a9b72); }
    .wiring-summary { display: flex; flex-wrap: wrap; gap: 18px; margin-top: 14px; color: var(--secondary-text-color); font-size: 13px; }
    .wiring-summary strong { color: var(--primary-text-color); font-size: 18px; font-variant-numeric: tabular-nums; }
    .wiring-list { display: grid; margin-top: 12px; }
    .wiring-row {
      display: grid;
      grid-template-columns: 24px minmax(0, 1fr) auto;
      align-items: center;
      gap: 10px;
      width: 100%;
      min-height: 54px;
      box-sizing: border-box;
      padding: 8px 0;
      border: 0;
      border-bottom: 1px solid var(--studio-line);
      border-radius: 0;
      background: transparent;
      color: var(--primary-text-color);
      font: inherit;
      text-align: left;
      cursor: pointer;
    }
    .wiring-row ha-icon { --mdc-icon-size: 20px; color: var(--secondary-text-color); }
    .wiring-copy { min-width: 0; }
    .wiring-copy strong, .wiring-copy span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .wiring-copy span { margin-top: 2px; color: var(--secondary-text-color); font-size: 12px; }
    .wiring-state { color: var(--secondary-text-color); font-size: 12px; text-align: right; }
    .wiring-state.live { color: var(--success-color, #6fba98); }
    .wiring-state.fallback { color: var(--warning-color, #d7a255); }
    .change-list { display: grid; gap: 0; margin-top: 10px; }
    .change-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 0; border-top: 1px solid var(--divider-color); }
    .change-row:first-child { border-top: 0; }
    .change-copy { min-width: 0; font-size: 0.9em; line-height: 1.4; }
    .change-copy strong { display: block; }
    .architecture-empty {
      padding: 18px;
      border: 1px dashed var(--divider-color);
      border-radius: 8px;
      color: var(--secondary-text-color);
      text-align: center;
      line-height: 1.45;
    }
    .opening-editor { display: grid; gap: 16px; margin-top: 14px; }
    .opening-control { display: grid; grid-template-columns: 86px minmax(0, 1fr) 48px; align-items: center; gap: 10px; }
    .opening-control label { color: var(--secondary-text-color); font-size: 0.88em; }
    .opening-control output { text-align: right; font-variant-numeric: tabular-nums; font-size: 0.88em; }
    .opening-control input[type='range'] { width: 100%; accent-color: var(--primary-color); }
    .opening-control input[type='color'] {
      width: 52px;
      height: 34px;
      padding: 3px;
      border: 1px solid var(--divider-color);
      border-radius: 5px;
      background: transparent;
      cursor: pointer;
    }
    .north-setting { display: grid; grid-template-columns: 72px minmax(0, 1fr); gap: 16px; align-items: center; margin-top: 12px; }
    .compass {
      position: relative;
      width: 72px;
      height: 72px;
      border: 1px solid var(--divider-color);
      border-radius: 50%;
      background: var(--secondary-background-color);
    }
    .compass::before { content: 'N'; position: absolute; top: 6px; left: 50%; transform: translateX(-50%); color: var(--primary-color); font-size: 12px; font-weight: 700; }
    .compass-arrow { position: absolute; inset: 18px 33px; background: linear-gradient(to bottom, var(--primary-color) 0 50%, var(--secondary-text-color) 50%); transform-origin: 50% 50%; }
    .location-note { margin-top: 8px; color: var(--secondary-text-color); font-size: 0.8em; }
    .opening-list { display: grid; gap: 6px; margin-top: 12px; }
    .opening-row { display: flex; align-items: center; gap: 10px; width: 100%; box-sizing: border-box; padding: 9px 10px; border: 1px solid var(--divider-color); border-radius: 6px; background: transparent; color: var(--primary-text-color); font: inherit; text-align: left; cursor: pointer; }
    .opening-row { min-height: 52px; padding: 10px 4px; border-width: 0 0 1px; border-radius: 0; }
    .opening-row.selected { border-bottom-color: var(--studio-accent); background: color-mix(in srgb, var(--studio-accent) 8%, transparent); }
    .opening-row ha-icon { --mdc-icon-size: 18px; }
    .opening-row span { flex: 1; }
    .zone-name-form { display: flex; gap: 8px; margin-top: 12px; }
    .zone-name-form input { min-width: 0; flex: 1; }
    .room-mapping-list { display: grid; gap: 8px; margin-top: 12px; }
    .room-mapping {
      display: grid;
      grid-template-columns: 38px minmax(0, 1fr) auto;
      gap: 12px;
      align-items: start;
      padding: 16px 12px;
      border: 0;
      border-bottom: 1px solid var(--studio-line);
      border-radius: 0;
      background: transparent;
      transition: border-color 140ms ease, background 140ms ease;
    }
    .room-mapping.selected { border-bottom-color: var(--studio-accent); background: color-mix(in srgb, var(--studio-accent) 6%, transparent); }
    .room-number {
      display: grid;
      place-items: center;
      width: 38px;
      height: 38px;
      border-radius: 1px;
      background: color-mix(in srgb, var(--studio-accent) 18%, transparent);
      color: var(--primary-text-color);
      font-size: 0.78em;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
    }
    .room-fields { display: grid; gap: 9px; min-width: 0; }
    .room-summary-name {
      display: none;
      grid-template-columns: minmax(0, 1fr) 24px;
      align-items: center;
      gap: 8px;
      min-width: 0;
      padding: 0;
      overflow: hidden;
      border: 0;
      background: transparent;
      color: var(--primary-text-color);
      font: inherit;
      font-weight: 600;
      text-align: left;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .room-summary-name ha-icon { --mdc-icon-size: 18px; color: var(--secondary-text-color); }
    .room-fields label { display: grid; gap: 4px; color: var(--secondary-text-color); font-size: 0.75em; }
    .room-fields input,
    .room-fields select {
      width: 100%;
      min-width: 0;
      box-sizing: border-box;
      border: 1px solid var(--divider-color);
      min-height: 44px;
      border-radius: 2px;
      padding: 9px 10px;
      background: var(--card-background-color);
      color: var(--primary-text-color);
      font: inherit;
      font-size: 1.12em;
    }
    .room-fields input:disabled { opacity: 0.6; }
    .room-status { padding-top: 3px; color: var(--secondary-text-color); font-size: 0.72em; white-space: nowrap; }
    .room-status.linked { color: var(--success-color, #6fba98); }
    .furniture-library {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 7px;
      margin-top: 12px;
    }
    .furniture-library button {
      display: grid;
      place-items: center;
      gap: 7px;
      min-height: 94px;
      min-width: 0;
      padding: 9px 6px;
      border: 1px solid var(--divider-color);
      border-radius: 2px;
      background: color-mix(in srgb, var(--studio-accent) 8%, var(--secondary-background-color));
      color: var(--primary-text-color);
      font: inherit;
      font-size: 0.76em;
      cursor: pointer;
      text-align: left;
    }
    .furniture-library button:hover { border-color: color-mix(in srgb, var(--primary-color) 55%, var(--divider-color)); }
    .furniture-library ha-icon { --mdc-icon-size: 22px; color: var(--primary-color); }
    .furniture-library span { max-width: 100%; overflow-wrap: anywhere; }
    .asset-browser-tools { display: grid; gap: 8px; margin-top: 12px; }
    .asset-search {
      width: 100%; min-width: 0; min-height: 46px; box-sizing: border-box; padding: 10px 11px;
      border: 1px solid var(--divider-color); border-radius: 2px;
      background: var(--card-background-color); color: var(--primary-text-color); font: inherit;
    }
    .asset-categories { display: flex; gap: 5px; overflow-x: auto; scrollbar-width: none; }
    .asset-categories::-webkit-scrollbar { display: none; }
    .asset-categories button {
      flex: 0 0 auto; min-height: 40px; padding: 0 0 5px; border: 0; border-bottom: 2px solid transparent;
      border-radius: 0; background: transparent; color: var(--secondary-text-color); font: inherit; font-size: 13px; cursor: pointer;
    }
    .asset-categories { gap: 20px; }
    .asset-categories button.active { border-bottom-color: var(--studio-accent); background: transparent; color: var(--primary-text-color); }
    .asset-name { display: block; font-weight: 650; line-height: 1.25; }
    .asset-size { display: block; margin-top: 3px; color: var(--secondary-text-color); font-size: 0.88em; font-variant-numeric: tabular-nums; }
    .finish-picker { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
    .finish-picker button { display: flex; align-items: center; gap: 7px; min-height: 36px; padding: 0 10px; border: 1px solid var(--divider-color); border-radius: 6px; background: var(--card-background-color); color: var(--primary-text-color); font: inherit; font-size: 0.78em; cursor: pointer; }
    .finish-picker button.active { border-color: var(--primary-color); }
    .finish-swatch { width: 16px; height: 16px; border: 1px solid color-mix(in srgb, currentColor 22%, transparent); border-radius: 50%; }
    .transform-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 9px; margin-top: 14px; }
    .asset-fields { display: grid; gap: 9px; margin-top: 14px; }
    .asset-fields label { display: grid; gap: 4px; color: var(--secondary-text-color); font-size: 0.75em; }
    .transform-grid label { display: grid; gap: 4px; color: var(--secondary-text-color); font-size: 0.75em; }
    .asset-fields input,
    .asset-fields select,
    .transform-grid input,
    .transform-grid select {
      width: 100%; min-width: 0; min-height: 44px; box-sizing: border-box; padding: 9px 10px;
      border: 1px solid var(--divider-color); border-radius: 2px;
      background: var(--card-background-color); color: var(--primary-text-color); font: inherit; font-size: 1.08em;
    }
    .visibility-toggle { display: flex; align-items: center; gap: 9px; margin-top: 14px; color: var(--secondary-text-color); font-size: 0.86em; }
    .visibility-toggle input { width: 18px; height: 18px; accent-color: var(--primary-color); }
    .unplaced-list { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
    .unplaced-device {
      border: 1px solid var(--divider-color);
      border-radius: 2px;
      background: var(--card-background-color);
      color: var(--primary-text-color);
      cursor: pointer;
      font: inherit;
      font-size: 0.82em;
      padding: 6px 9px;
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    @media (max-width: 420px) {
      .editor-mode { align-items: flex-start; flex-direction: column; }
      .mode-switch { width: 100%; }
      .mode-switch button { flex: 1; }
      .room-mapping { grid-template-columns: 34px minmax(0, 1fr); }
      .room-number { width: 34px; height: 34px; }
      .room-status { grid-column: 2; padding-top: 0; }
      .furniture-library { grid-template-columns: repeat(3, minmax(0, 1fr)); }
      .setup-steps { gap: 24px; margin-bottom: 22px; }
      .setup-step { min-width: auto; font-size: 16px; padding-inline: 0; }
      .setup-step ha-icon { display: none; }
      .preview-note { max-width: 160px; }
      .setup-actions { display: grid; grid-template-columns: 1fr; }
      .setup-actions ha-button { width: 100%; }
      .opening-row { min-height: 44px; }
    }
    .tab {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-height: 48px;
      padding: 8px 0;
      border: none;
      background: none;
      cursor: pointer;
      font: inherit;
      font-size: 16px;
      color: var(--secondary-text-color);
      border-bottom: 2px solid transparent;
      white-space: nowrap;
      --mdc-icon-size: 18px;
    }
    .tab.active {
      color: var(--primary-text-color);
      border-bottom-color: var(--studio-accent);
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
      min-height: 44px;
      box-sizing: border-box;
      padding: 9px 10px;
      border-radius: 2px;
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
      border: 0;
      border-top: 1px solid var(--studio-line);
      border-radius: 0;
      padding: 14px 0;
      margin: 0;
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
      border: 0;
      border-top: 1px solid var(--studio-line);
      border-radius: 0;
      padding: 14px 0;
      margin: 0;
    }
    .zone-area-link {
      width: 100%;
      box-sizing: border-box;
      margin: 10px 0 4px;
      padding: 9px 10px;
      border: 1px solid var(--divider-color);
      min-height: 44px;
      border-radius: 2px;
      color: var(--primary-text-color);
      background: var(--card-background-color);
      font: inherit;
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
    @container (min-width: 920px) {
      .editor-workspace { grid-template-columns: minmax(0, 1.08fr) minmax(360px, 0.92fr); align-items: start; }
      .preview-panel { position: sticky; top: 8px; }
      .setup-steps { gap: 20px; }
      .setup-step { min-width: auto; }
      .studio-intro { margin-top: 0; }
    }
    @container (max-width: 620px) {
      .editor-title { font-size: 20px; }
      .editor-mode { align-items: flex-start; flex-direction: column; }
      .mode-switch { width: 100%; }
      .mode-switch button { flex: 1; }
      .preview-toolbar { flex-wrap: nowrap; min-height: 48px; }
      .preview-note { display: none; }
      .preview-collapse {
        display: inline-grid;
        appearance: none;
        flex: 0 0 auto;
        width: auto;
        min-width: 64px;
        height: 48px;
        place-items: center;
        grid-auto-flow: column;
        gap: 4px;
        margin-left: auto;
        padding: 0;
        border: 0;
        background: transparent;
        color: var(--primary-text-color);
      }
      .preview-panel.collapsed > :not(.preview-toolbar) { display: none; }
      .preview-panel spatial-preview { --spatial-aspect-mobile: 1 / 1; }
      .setup-steps { display: none; }
      .setup-progress {
        display: grid;
        grid-template-columns: 48px minmax(0, 1fr) 48px;
        align-items: center;
        gap: 8px;
        min-height: 58px;
        margin: 4px 0 16px;
        border-bottom: 1px solid var(--studio-line);
      }
      .setup-progress button { display: grid; width: 48px; height: 48px; place-items: center; border: 0; background: transparent; color: var(--primary-text-color); }
      .setup-progress button[disabled] { opacity: 0.3; }
      .setup-progress-copy { min-width: 0; text-align: center; }
      .setup-progress-copy span { display: block; color: var(--secondary-text-color); font-size: 12px; }
      .setup-progress-copy strong { display: block; overflow: hidden; font-size: 16px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
      .setup-card { padding: 20px 0; }
      .setup-card h3 { font-size: 20px; }
      .room-mapping { grid-template-columns: 34px minmax(0, 1fr); padding-inline: 0; }
      .room-number { width: 34px; height: 34px; }
      .room-summary-name { display: grid; align-self: center; font-size: 15px; }
      .room-mapping:not(.selected) .room-fields { display: none; }
      .room-mapping.selected .room-summary-name { display: none; }
      .room-mapping.selected .room-fields { grid-column: 2; }
      .room-status { grid-column: 2; padding-top: 0; }
      .furniture-library { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .transform-grid { grid-template-columns: 1fr; }
      .opening-control { grid-template-columns: 78px minmax(0, 1fr) 42px; }
      .north-setting { grid-template-columns: 56px minmax(0, 1fr); gap: 10px; }
      .compass { width: 56px; height: 56px; }
      .compass-arrow { inset: 13px 25px; }
      .setup-actions { display: grid; grid-template-columns: 1fr; }
      .setup-actions ha-button { width: 100%; min-height: 48px; }
      .image-row { flex-wrap: wrap; }
      .image-url { flex-basis: calc(100% - 58px); }
    }
  `;

  public get config(): ApartmentViewConfig {
    return this._config;
  }

  public setConfig(config: any): void {
    // normalizeConfig fills defaults, applies breaking renames, preserves unknown keys.
    const normalized = normalizeConfig(config);
    const echoed = this._lastEmittedConfig && JSON.stringify(normalized) === JSON.stringify(this._lastEmittedConfig);
    this._config = normalized;
    if (!this._selectedRoomId) {
      const surveyedRoom = normalized.spatial?.shell?.rooms?.[0];
      const plannedRoom = normalized.spatial?.plan?.rooms?.[0];
      this._selectedRoomId = surveyedRoom
        ? `survey:${surveyedRoom.zoneId}`
        : plannedRoom?.id ?? '';
    }
    if (!echoed) {
      this._undoStack = [];
      this._redoStack = [];
      this._syncHistoryState();
    }
  }

  private _syncHistoryState(): void {
    this._undoCount = this._undoStack.length;
    this._redoCount = this._redoStack.length;
  }

  private _applyConfig(config: ApartmentViewConfig, record = true): void {
    if (record && this._config && JSON.stringify(config) !== JSON.stringify(this._config)) {
      this._undoStack.push(this._config);
      if (this._undoStack.length > 50) this._undoStack.shift();
      this._redoStack = [];
    }
    this._config = config;
    this._lastEmittedConfig = config;
    this._syncHistoryState();
    fireEvent(this, 'config-changed', { config });
  }

  private _undo(): void {
    const previous = this._undoStack.pop();
    if (!previous) return;
    this._redoStack.push(this._config);
    this._applyConfig(previous, false);
  }

  private _redo(): void {
    const next = this._redoStack.pop();
    if (!next) return;
    this._undoStack.push(this._config);
    this._applyConfig(next, false);
  }

  private _setMode(mode: EditorMode): void {
    this._mode = mode;
  }

  protected updated(): void {
    if (!['phone', 'tablet', 'desktop'].includes(this._previewMode)) return;
    const card = this.renderRoot.querySelector('.device-preview-card') as unknown as {
      hass?: HomeAssistant;
      setConfig?: (config: ApartmentViewConfig) => void;
    } | null;
    if (!card) return;
    card.hass = {
      ...this.hass,
      callService: async () => undefined,
    } as HomeAssistant;
    card.setConfig?.(this._config);
  }

  private _areaList(): { area_id: string; name: string }[] {
    const areas = (this.hass as unknown as { areas?: Record<string, { area_id: string; name: string }> }).areas ?? {};
    return Object.values(areas).slice().sort((a, b) => a.name.localeCompare(b.name));
  }

  private _zoneForArea(areaId: string): ZoneConfig | undefined {
    const linked = this._config.zones.find((zone) => zone.areaId === areaId);
    if (linked) return linked;
    const area = this._areaList().find((candidate) => candidate.area_id === areaId);
    if (!area) return undefined;
    return this._config.zones.find((zone) => zone.name.trim().toLowerCase() === area.name.trim().toLowerCase());
  }

  private _zoneForEntity(entity: EntityConfig): ZoneConfig | undefined {
    return zoneForEntity(entity, this._config.zones) ?? undefined;
  }

  private _unplacedEntities(): EntityConfig[] {
    if (this._spatial().plan) return this._config.entities.filter((entity) => !entity.entity || !entity.spatial);
    return this._config.entities.filter((entity) => !entity.entity || !this._zoneForEntity(entity));
  }

  private _overlappingZones(): [ZoneConfig, ZoneConfig][] {
    const overlaps: [ZoneConfig, ZoneConfig][] = [];
    for (let i = 0; i < this._config.zones.length; i += 1) {
      const a = this._config.zones[i];
      for (let j = i + 1; j < this._config.zones.length; j += 1) {
        const b = this._config.zones[j];
        if (a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y) {
          overlaps.push([a, b]);
        }
      }
    }
    return overlaps;
  }

  private _homeChanges(): HomeChange[] {
    const areas = new Map(this._areaList().map((area) => [area.area_id, area]));
    const changes: HomeChange[] = [];
    for (const zone of this._config.zones) {
      if (!zone.areaId || !zone.id) continue;
      const area = areas.get(zone.areaId);
      if (!area) {
        changes.push({ kind: 'missing-area', zoneId: zone.id, zoneName: zone.name });
        continue;
      }
      if (area.name.trim() !== zone.name.trim()) {
        changes.push({ kind: 'rename', zoneId: zone.id, currentName: zone.name, areaName: area.name });
      }
      const count = this._entitiesInArea(zone.areaId).length;
      if (count) changes.push({ kind: 'new-devices', areaId: zone.areaId, areaName: area.name, count });
    }
    return changes;
  }

  private _renameLinkedZone(zoneId: string, name: string): void {
    this._commitZones(this._config.zones.map((zone) => zone.id === zoneId ? { ...zone, name } : zone));
  }

  private _unlinkMissingArea(zoneId: string): void {
    this._commitZones(this._config.zones.map((zone) => {
      if (zone.id !== zoneId) return zone;
      const { areaId: _areaId, ...unlinked } = zone;
      return unlinked;
    }));
  }

  private _optionsLabel = (schema: { name: string }): string => {
    const labels: Record<string, string> = {
      view: 'Time-of-day view',
      lightStyle: 'Light style',
      hideWalls: 'Lower walls in apartment overview',
      freePanZoom: 'Free pan / zoom',
      zoomMax: 'Max zone-zoom scale',
      duskDawnOffsetMinutes: 'Dusk/Dawn offset',
      iconSize: 'Marker size — desktop (zoomed out)',
      iconSizeMax: 'Max marker size — desktop (zoomed in)',
      iconSizeMobile: 'Marker size — mobile (zoomed out)',
      iconSizeMaxMobile: 'Max marker size — mobile (zoomed in)',
      presentation: 'Information density',
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
    this._applyConfig(config);
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
    this._applyConfig(config);
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

  private _commitEntities(entities: EntityConfig[], record = true): void {
    const config: ApartmentViewConfig = { ...this._config, entities };
    this._applyConfig(config, record);
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
    const zone = this._zoneForArea(areaId);
    const plan = this._spatial().plan;
    const room = plan?.rooms.find((candidate) => candidate.zoneId === zone?.id);
    const polygon = plan && room ? roomPolygon(plan, room) : null;
    const minX = polygon?.length ? Math.min(...polygon.map((point) => point.x)) : 0;
    const maxX = polygon?.length ? Math.max(...polygon.map((point) => point.x)) : 0;
    const minZ = polygon?.length ? Math.min(...polygon.map((point) => point.z)) : 0;
    const maxZ = polygon?.length ? Math.max(...polygon.map((point) => point.z)) : 0;
    const start = this._config.entities.length;
    const added: EntityConfig[] = ids.map((id, i) => {
      const columns = Math.max(1, Math.ceil(Math.sqrt(ids.length)));
      const row = Math.floor(i / columns);
      const column = i % columns;
      const rows = Math.ceil(ids.length / columns);
      const x = zone ? zone.x + ((column + 1) / (columns + 1)) * zone.width : 14 + ((start + i) % 5) * 17;
      const y = zone ? zone.y + ((row + 1) / (rows + 1)) * zone.height : 14 + (Math.floor((start + i) / 5) % 5) * 17;
      const spatialX = polygon?.length ? minX + ((column + 1) / (columns + 1)) * (maxX - minX) : 0;
      const spatialZ = polygon?.length ? minZ + ((row + 1) / (rows + 1)) * (maxZ - minZ) : 0;
      const domain = id.split('.')[0];
      const mount = domain === 'light' ? 'ceiling'
        : ['climate', 'media_player', 'cover', 'lock', 'binary_sensor'].includes(domain) ? 'wall'
          : domain === 'vacuum' ? 'floor' : 'free';
      const spatialY = mount === 'ceiling' ? Math.max(0.1, this._spatial().dimensions.wallHeight - 0.12)
        : mount === 'wall' ? 1.35 : mount === 'floor' ? 0.08 : 0.18;
      return withSuggestedEntityPolicy({
        ...defaultEntity(),
        entity: id,
        x,
        y,
        ...(zone?.id ? { zoneId: zone.id } : {}),
        ...(plan ? { spatial: {
          position: { x: spatialX, y: spatialY, z: spatialZ },
          rotation: { x: 0, y: 0, z: 0 },
          mount,
          ...(room ? { parentId: room.id } : {}),
          visible: true,
        } } : {}),
      });
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
      overviewVisibility: 'Show on apartment overview',
      roomVisibility: 'Show inside room',
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
    this._applyConfig(config);
  }

  private _onEntityChanged(ev: CustomEvent, index: number): void {
    ev.stopPropagation();
    const prev = this._config.entities[index];
    const changed = formToEntity(prev, ev.detail.value);
    const next = !prev.entity && changed.entity ? withSuggestedEntityPolicy(changed) : changed;
    const entities = this._config.entities.map((e, i) =>
      i === index ? next : e
    );
    this._commitEntities(entities);
  }

  private _onPreviewEditStart(): void {
    this._dragStartConfig = this._config;
  }

  private _onPreviewEditEnd(): void {
    const start = this._dragStartConfig;
    this._dragStartConfig = null;
    if (!start || JSON.stringify(start) === JSON.stringify(this._config)) return;
    this._undoStack.push(start);
    if (this._undoStack.length > 50) this._undoStack.shift();
    this._redoStack = [];
    this._syncHistoryState();
  }

  private _onPreviewEntityMoved(ev: CustomEvent): void {
    const { index, x, y } = ev.detail as {
      index: number;
      x: number;
      y: number;
    };
    const zone = zoneForPoint(x, y, this._config.zones);
    const entities = this._config.entities.map((e, i) => {
      if (i !== index) return e;
      const moved = { ...e, x, y };
      if (zone?.id) return { ...moved, zoneId: zone.id };
      const { zoneId: _zoneId, ...unplaced } = moved;
      return unplaced;
    });
    this._commitEntities(entities, !this._dragStartConfig);
  }

  private _onPreviewEntitySelected(ev: CustomEvent): void {
    this._selectedEntity = (ev.detail as { index: number }).index;
  }

  private _spatial(): SpatialConfig {
    return this._config.spatial ?? {
      openings: [],
      walls: [],
      site: { north: 0 },
      dimensions: { width: 10, aspectRatio: 1, wallHeight: 2.6 },
    };
  }

  private _commitSpatial(spatial: SpatialConfig): void {
    this._applyConfig({ ...this._config, spatial });
  }

  private _onSpatialPlanChanged(ev: CustomEvent): void {
    ev.stopPropagation();
    const { plan, record = true } = ev.detail as { plan: SpatialConfig['plan']; record?: boolean };
    if (!plan) return;
    this._applyConfig({ ...this._config, spatial: { ...this._spatial(), plan: withDerivedSpatialRooms(plan) } }, record);
  }

  private _onPreviewWallSelected(ev: CustomEvent): void {
    this._selectedWallId = (ev.detail as { wallId: string }).wallId;
    this._selectedOpeningId = '';
    this._setupStep = 'architecture';
    this._previewMode = 'edit';
  }

  private _onPreviewOpeningSelected(ev: CustomEvent): void {
    const { id, wallId } = ev.detail as { id: string; wallId: string };
    this._selectedOpeningId = id;
    this._selectedWallId = wallId;
    this._setupStep = 'architecture';
    this._previewMode = 'edit';
  }

  private _onSpatialRoomSelected(ev: CustomEvent): void {
    this._selectedRoomId = (ev.detail as { roomId: string }).roomId;
    this._setupStep = 'rooms';
    this._previewMode = 'edit';
  }

  private _openingId(kind: OpeningKind): string {
    const ids = new Set([
      ...this._spatial().openings.map((opening) => opening.id),
      ...(this._spatial().shell?.openings.map((opening) => opening.id) ?? []),
    ]);
    let index = 1;
    while (ids.has(`${kind}-${index}`)) index += 1;
    return `${kind}-${index}`;
  }

  private _addOpening(kind: OpeningKind): void {
    if (!this._selectedWallId) return;
    const shell = this._spatial().shell;
    const shellSegment = shell ? shellSegmentById(shell, this._selectedWallId) : undefined;
    if (shell && shellSegment) {
      const opening: SpatialShellOpening = {
        id: this._openingId(kind),
        kind,
        x: (shellSegment.start[0] + shellSegment.end[0]) / 2,
        z: (shellSegment.start[1] + shellSegment.end[1]) / 2,
        width: Math.min(kind === 'door' ? 0.9 : 1.2, Math.max(0.4, shellSegment.length - 0.2)),
        depth: shellSegment.thickness,
        rotation: shellSegment.rotation,
        bottom: kind === 'door' ? 0 : 0.9,
        height: kind === 'door' ? 2.1 : 1.2,
        ...(kind === 'door' ? { color: '#8f887d' } : {}),
      };
      this._selectedOpeningId = opening.id;
      this._commitSpatial({ ...this._spatial(), shell: { ...shell, openings: [...shell.openings, opening] } });
      return;
    }
    const plan = this._spatial().plan;
    const planWall = plan?.walls.find((wall) => wall.id === this._selectedWallId);
    const vertices = plan ? new Map(plan.vertices.map((vertex) => [vertex.id, vertex])) : new Map();
    const length = planWall ? wallLength(planWall, vertices) : 0;
    const widthMeters = kind === 'door' ? 0.9 : 1.2;
    const width = length > 0 ? Math.min(0.8, widthMeters / length) : kind === 'door' ? 0.22 : 0.3;
    const existing = this._spatial().openings.filter((opening) => opening.wallId === this._selectedWallId);
    const candidates = [0.5, 0.25, 0.75, 0.38, 0.62];
    const position = candidates.find((candidate) => existing.every((opening) =>
      Math.abs(opening.position - candidate) > (opening.width + width) / 2 + 0.03,
    )) ?? 0.5;
    const opening: OpeningConfig = {
      id: this._openingId(kind),
      kind,
      wallId: this._selectedWallId,
      position,
      width,
      ...(planWall ? {
        widthMeters: Math.min(widthMeters, Math.max(0.4, length - 0.2)),
        height: kind === 'door' ? 2.1 : 1.2,
        bottom: kind === 'door' ? 0 : 0.9,
        hinge: 'left' as const,
        swing: 'in' as const,
      } : {}),
      ...(kind === 'door' ? { color: '#8f887d' } : {}),
    };
    this._selectedOpeningId = opening.id;
    this._commitSpatial({ ...this._spatial(), openings: [...this._spatial().openings, opening] });
  }

  private _updateShellOpening(id: string, patch: Partial<SpatialShellOpening>, record = true): void {
    const shell = this._spatial().shell;
    if (!shell) return;
    this._applyConfig({
      ...this._config,
      spatial: {
        ...this._spatial(),
        shell: {
          ...shell,
          openings: shell.openings.map((opening) => opening.id === id ? { ...opening, ...patch } : opening),
        },
      },
    }, record);
  }

  private _moveShellOpening(id: string, wallId: string, position: number, record = true): void {
    const shell = this._spatial().shell;
    const segment = shell ? shellSegmentById(shell, wallId) : undefined;
    if (!shell || !segment) return;
    const clamped = Math.min(0.96, Math.max(0.04, position));
    this._updateShellOpening(id, {
      x: segment.start[0] + (segment.end[0] - segment.start[0]) * clamped,
      z: segment.start[1] + (segment.end[1] - segment.start[1]) * clamped,
      rotation: segment.rotation,
      depth: segment.thickness,
    }, record);
  }

  private _removeShellOpening(id: string): void {
    const shell = this._spatial().shell;
    if (!shell) return;
    this._commitSpatial({ ...this._spatial(), shell: { ...shell, openings: shell.openings.filter((opening) => opening.id !== id) } });
    this._selectedOpeningId = '';
  }

  private _updateOpening(id: string, patch: Partial<OpeningConfig>, record = true): void {
    const spatial: SpatialConfig = {
      ...this._spatial(),
      openings: this._spatial().openings.map((opening) => {
        if (opening.id !== id) return opening;
        const next = { ...opening, ...patch };
        const width = Math.min(0.8, Math.max(0.08, next.width));
        return {
          ...next,
          width,
          position: Math.min(1 - width / 2, Math.max(width / 2, next.position)),
        };
      }),
    };
    this._applyConfig({ ...this._config, spatial }, record);
  }

  private _removeOpening(id: string): void {
    this._commitSpatial({ ...this._spatial(), openings: this._spatial().openings.filter((opening) => opening.id !== id) });
    this._selectedOpeningId = '';
  }

  private _wallCurve(wallId: string): number {
    const planWall = this._spatial().plan?.walls.find((wall) => wall.id === wallId);
    if (planWall) return planWall.curve;
    return this._spatial().walls.find((wall) => wall.wallId === wallId)?.curve ?? 0;
  }

  private _updateWallCurve(wallId: string, curve: number, record = true): void {
    const clamped = Math.min(1, Math.max(-1, curve));
    const plan = this._spatial().plan;
    if (plan?.walls.some((wall) => wall.id === wallId)) {
      this._applyConfig({
        ...this._config,
        spatial: { ...this._spatial(), plan: updateSpatialWall(plan, wallId, { curve: Math.abs(clamped) < 0.01 ? 0 : clamped }) },
      }, record);
      return;
    }
    const walls: WallConfig[] = this._spatial().walls.filter((wall) => wall.wallId !== wallId);
    if (Math.abs(clamped) >= 0.01) walls.push({ wallId, curve: clamped });
    this._applyConfig({ ...this._config, spatial: { ...this._spatial(), walls } }, record);
  }

  private _updateNorth(north: number, record = true): void {
    const normalized = ((north % 360) + 360) % 360;
    this._applyConfig({
      ...this._config,
      spatial: { ...this._spatial(), site: { ...this._spatial().site, north: normalized } },
    }, record);
  }

  private _updateDimensions(patch: Partial<SpatialDimensions>): void {
    this._commitSpatial({
      ...this._spatial(),
      dimensions: { ...this._spatial().dimensions, ...patch },
    });
  }

  private _useImageAspect(): void {
    const image = new Image();
    image.onload = () => {
      if (image.naturalWidth > 0 && image.naturalHeight > 0) {
        this._updateDimensions({ aspectRatio: image.naturalWidth / image.naturalHeight });
      }
    };
    image.src = this._config.images.base;
  }

  private _wallName(wallId: string): string {
    const plan = this._spatial().plan;
    const planWall = plan?.walls.find((wall) => wall.id === wallId);
    if (plan && planWall) {
      const index = plan.walls.indexOf(planWall) + 1;
      const length = wallLength(planWall, new Map(plan.vertices.map((vertex) => [vertex.id, vertex])));
      return `Wall ${index} · ${length.toFixed(2)} m`;
    }
    const parts = wallParts(wallId);
    const zone = parts && this._config.zones.find((candidate) => candidate.id === parts.zoneId);
    return parts && zone ? `${zone.name} · ${parts.side} wall` : 'Selected wall';
  }

  private _updatePlanWall(wallId: string, patch: Parameters<typeof updateSpatialWall>[2]): void {
    const plan = this._spatial().plan;
    if (!plan) return;
    this._commitSpatial({ ...this._spatial(), plan: updateSpatialWall(plan, wallId, patch) });
  }

  private _addSpatialFurniture(asset: SpatialAssetDefinition | null): void {
    const plan = this._spatial().plan ?? emptySpatialPlan();
    const room = plan.rooms.find((candidate) => candidate.id === this._selectedRoomId) ?? plan.rooms[0];
    const polygon = room ? roomPolygon(plan, room) : null;
    const bounds = spatialBounds(plan);
    const shellPoints = this._spatial().shell ? [
      ...this._spatial().shell!.outer,
      ...this._spatial().shell!.floor,
      ...(this._spatial().shell!.floors ?? []).flat(),
    ] : [];
    const shellCenter = shellPoints.length ? {
      x: (Math.min(...shellPoints.map(([x]) => x)) + Math.max(...shellPoints.map(([x]) => x))) / 2,
      z: (Math.min(...shellPoints.map(([, z]) => z)) + Math.max(...shellPoints.map(([, z]) => z))) / 2,
    } : null;
    const position = polygon?.length ? {
      x: polygon.reduce((sum, point) => sum + point.x, 0) / polygon.length,
      z: polygon.reduce((sum, point) => sum + point.z, 0) / polygon.length,
    } : shellCenter ?? { x: bounds.centerX, z: bounds.centerZ };
    const next = addSpatialObject(plan, asset?.kind ?? 'custom', position, {
      ...(room?.zoneId ? { zoneId: room.zoneId } : {}),
      ...(asset ? { name: asset.label, assetId: asset.id, finishId: asset.defaultFinish } : { name: 'Custom model' }),
    });
    this._selectedObjectId = next.objects[next.objects.length - 1].id;
    this._commitSpatial({ ...this._spatial(), plan: next });
    this._previewMode = 'edit';
  }

  private _updateSpatialFurniture(patch: Parameters<typeof updateSpatialObject>[2]): void {
    const plan = this._spatial().plan;
    if (!plan || !this._selectedObjectId) return;
    this._commitSpatial({ ...this._spatial(), plan: updateSpatialObject(plan, this._selectedObjectId, patch) });
  }

  private _removeSpatialFurniture(): void {
    const plan = this._spatial().plan;
    if (!plan || !this._selectedObjectId) return;
    this._commitSpatial({ ...this._spatial(), plan: removeSpatialObject(plan, this._selectedObjectId) });
    this._selectedObjectId = '';
  }

  private _onSpatialObjectSelected(ev: CustomEvent): void {
    this._selectedObjectId = (ev.detail as { objectId: string }).objectId;
    this._setupStep = 'furniture';
  }

  private _onSpatialEntitySelected(ev: CustomEvent): void {
    const entityId = (ev.detail as { entityId: string }).entityId;
    this._selectedEntity = this._config.entities.findIndex((entity) => entity.entity === entityId);
    this._setupStep = 'devices';
  }

  private _onSpatialEntityMoved(ev: CustomEvent): void {
    ev.stopPropagation();
    const { entityId, point, record = true } = ev.detail as { entityId: string; point: { x: number; z: number }; record?: boolean };
    this._commitEntities(this._config.entities.map((entity) => entity.entity === entityId && entity.spatial ? {
      ...entity,
      spatial: { ...entity.spatial, position: { ...entity.spatial.position, x: point.x, z: point.z } },
    } : entity), record);
  }

  private _updateSelectedEntitySpatial(patch: Partial<NonNullable<EntityConfig['spatial']>>): void {
    const selected = this._config.entities[this._selectedEntity];
    if (!selected) return;
    const bounds = spatialBounds(this._spatial().plan ?? emptySpatialPlan());
    const spatial = selected.spatial ?? {
      position: { x: bounds.centerX, y: 0.18, z: bounds.centerZ },
      rotation: { x: 0, y: 0, z: 0 },
      mount: 'free' as const,
      visible: true,
    };
    this._commitEntities(this._config.entities.map((entity, index) => index === this._selectedEntity ? {
      ...entity,
      spatial: { ...spatial, ...patch },
    } : entity));
  }

  private _commitZones(zones: ZoneConfig[]): void {
    if (this._spatial().plan) {
      this._applyConfig({ ...this._config, zones });
      return;
    }
    const validZoneIds = new Set(zones.map((zone) => zone.id).filter((id): id is string => Boolean(id)));
    const openings = this._spatial().openings.filter((opening) => {
      const parts = wallParts(opening.wallId);
      return parts && validZoneIds.has(parts.zoneId);
    });
    const walls = this._spatial().walls.filter((wall) => {
      const parts = wallParts(wall.wallId);
      return parts && validZoneIds.has(parts.zoneId);
    });
    const config: ApartmentViewConfig = {
      ...this._config,
      zones,
      spatial: { ...this._spatial(), openings, walls },
    };
    this._applyConfig(config);
  }

  private _zoneBoundsForRoom(plan: SpatialPlan, room: SpatialRoom): Pick<ZoneConfig, 'x' | 'y' | 'width' | 'height'> {
    const polygon = roomPolygon(plan, room) ?? [];
    const bounds = spatialBounds(plan);
    if (!polygon.length || bounds.width <= 0 || bounds.depth <= 0) return { x: 0, y: 0, width: 100, height: 100 };
    const minX = Math.min(...polygon.map((point) => point.x));
    const maxX = Math.max(...polygon.map((point) => point.x));
    const minZ = Math.min(...polygon.map((point) => point.z));
    const maxZ = Math.max(...polygon.map((point) => point.z));
    return {
      x: (minX - bounds.minX) / bounds.width * 100,
      y: (minZ - bounds.minZ) / bounds.depth * 100,
      width: (maxX - minX) / bounds.width * 100,
      height: (maxZ - minZ) / bounds.depth * 100,
    };
  }

  private _linkSpatialRoom(roomId: string, areaId: string, customName?: string): void {
    const plan = this._spatial().plan;
    const room = plan?.rooms.find((candidate) => candidate.id === roomId);
    if (!plan || !room) return;
    const area = this._areaList().find((candidate) => candidate.area_id === areaId);
    const current = room.zoneId ? this._config.zones.find((zone) => zone.id === room.zoneId) : undefined;
    const name = customName?.trim() || area?.name || current?.name || `Room ${plan.rooms.indexOf(room) + 1}`;
    const zoneId = current?.id ?? roomIdFor(name, this._config.zones);
    const nextZone: ZoneConfig = {
      ...(current ?? defaultZone()),
      id: zoneId,
      name,
      areaId: areaId || undefined,
      ...this._zoneBoundsForRoom(plan, room),
    };
    const zones = current
      ? this._config.zones.map((zone) => zone.id === current.id ? nextZone : zone)
      : [...this._config.zones, nextZone];
    const nextPlan: SpatialPlan = {
      ...plan,
      rooms: plan.rooms.map((candidate) => candidate.id === roomId ? { ...candidate, zoneId } : candidate),
    };
    this._selectedRoomId = roomId;
    this._applyConfig({ ...this._config, zones, spatial: { ...this._spatial(), plan: nextPlan } });
  }

  private _renameSpatialRoom(roomId: string, name: string): void {
    const plan = this._spatial().plan;
    const room = plan?.rooms.find((candidate) => candidate.id === roomId);
    const trimmed = name.trim();
    if (!plan || !room || !trimmed) return;
    if (!room.zoneId) {
      this._linkSpatialRoom(roomId, '', trimmed);
      return;
    }
    this._applyConfig({
      ...this._config,
      zones: this._config.zones.map((zone) => zone.id === room.zoneId ? { ...zone, name: trimmed } : zone),
    });
  }

  private _renameSurveyRoom(zoneId: string, name: string): void {
    const trimmed = name.trim();
    if (!trimmed) return;
    this._commitZones(this._config.zones.map((zone) => zone.id === zoneId ? { ...zone, name: trimmed } : zone));
  }

  private _linkSurveyRoom(zoneId: string, areaId: string): void {
    const area = this._areaList().find((candidate) => candidate.area_id === areaId);
    this._commitZones(this._config.zones.map((zone) => zone.id === zoneId ? {
      ...zone,
      areaId: areaId || undefined,
      ...(!zone.name.trim() && area ? { name: area.name } : {}),
    } : zone));
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
      id: roomIdFor(this._pendingZoneName.trim() || base.name, this._config.zones),
      ...(this._pendingAreaId ? { areaId: this._pendingAreaId } : {}),
      name: this._pendingZoneName.trim() || base.name,
      ...(base.icon !== undefined ? { icon: base.icon } : {}),
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    };
    this._drawingZone = false;
    const zones = [...this._config.zones, zone];
    this._commitZones(zones);
    this._pendingZoneName = zone.name === base.name ? '' : zone.name;
    this._pendingAreaId = '';
    this._setupStep = 'rooms';
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

  private _onZoneAreaChanged(index: number, areaId: string): void {
    const area = this._areaList().find((candidate) => candidate.area_id === areaId);
    const zones = this._config.zones.map((zone, i) => {
      if (i !== index) return zone;
      if (!areaId) {
        const { areaId: _areaId, ...unlinked } = zone;
        return unlinked;
      }
      return { ...zone, areaId, ...(area ? { name: area.name } : {}) };
    });
    this._commitZones(zones);
  }

  private _selectUnplacedEntity(entity: EntityConfig): void {
    this._selectedEntity = this._config.entities.indexOf(entity);
    this._previewMode = 'edit';
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
              <select class="zone-area-link" aria-label="Linked Home Assistant Area"
                .value=${z.areaId ?? ''}
                @change=${(event: Event) => this._onZoneAreaChanged(i, (event.target as HTMLSelectElement).value)}>
                <option value="">No linked Home Assistant Area</option>
                ${this._areaList().map((area) => html`<option value=${area.area_id}>${area.name}</option>`)}
              </select>
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
        <ha-button
          class="add-zone"
          @click=${this._drawingZone ? this._onZoneDrawCancelled : this._startDrawZone}
        >${this._drawingZone ? 'Cancel drawing' : 'Add zone'}</ha-button>
        <p class="section-hint">
          ${this._drawingZone
            ? html`<b>Drawing mode is ON</b> — drag a rectangle on the floorplan
                preview to place the zone (Esc cancels).`
            : 'Add zone arms drawing mode: you then drag the zone rectangle directly on the preview.'}
        </p>
      </div>
    `;
  }

  // ---------------------------------------------------------------------------
  // Quick actions (radial ⚡ menu) editing
  // ---------------------------------------------------------------------------

  /**
   * Draft kept locally: normalizeConfig DROPS actions without a name +
   * entity/service, so a freshly-added row would vanish from the round-tripped
   * config before the user finishes filling it in. Rows render from the draft;
   * only valid rows are committed to the card config.
   */
  private _actions(): QuickAction[] {
    return this._actionsDraft ?? this._config.quickActions ?? [];
  }

  private _commitActions(list: QuickAction[]): void {
    this._actionsDraft = list;
    const valid = list.filter((a) => a.name && (a.entity || a.service));
    const config: ApartmentViewConfig = { ...this._config, quickActions: valid };
    this._applyConfig(config);
  }

  private _addAction(): void {
    this._commitActions([...this._actions(), { name: 'New action', icon: 'mdi:flash' }]);
  }

  private _removeAction(index: number): void {
    this._commitActions(this._actions().filter((_, i) => i !== index));
  }

  private _moveAction(index: number, delta: number): void {
    const list = [...this._actions()];
    const target = index + delta;
    if (target < 0 || target >= list.length) return;
    const [a] = list.splice(index, 1);
    list.splice(target, 0, a);
    this._commitActions(list);
  }

  private _onActionChanged(ev: CustomEvent, index: number): void {
    ev.stopPropagation();
    const v = ev.detail.value as Partial<QuickAction>;
    const list = this._actions().map((a, i) => {
      if (i !== index) return a;
      const merged = { ...a, ...v } as QuickAction;
      // ha-form leaves cleared fields as '' — strip them so normalize treats
      // the action consistently (entity OR service, not empty husks).
      (['icon', 'entity', 'service'] as const).forEach((k) => {
        if (!merged[k]) delete merged[k];
      });
      return merged;
    });
    this._commitActions(list);
  }

  private _actionLabel = (schema: { name: string }): string => {
    const labels: Record<string, string> = {
      name: 'Name',
      icon: 'Icon',
      entity: 'Entity to activate (scene, script, light…)',
      service: 'Service (advanced — overrides entity, e.g. light.turn_off)',
    };
    return labels[schema.name] ?? schema.name;
  };

  private _renderActions() {
    const list = this._actions();
    return html`
      <div class="section">
        <div class="section-title">Quick actions</div>
        <p class="section-hint">
          These live in the radial ⚡ button on the floorplan. Point each one at
          a scene, script, or any entity to activate — or use an advanced
          service call. An action appears once it has a name and a target.
        </p>
        ${list.map(
          (a, i) => html`
            <div class="zone-row action-row">
              <div class="row-header">
                <span class="row-title">${a.name || 'Unnamed action'}</span>
                <div class="zone-actions">
                  <ha-icon-button
                    class="action-up"
                    .label=${'Move action up'}
                    .path=${'M7,15L12,10L17,15H7Z'}
                    @click=${() => this._moveAction(i, -1)}
                  ></ha-icon-button>
                  <ha-icon-button
                    class="action-down"
                    .label=${'Move action down'}
                    .path=${'M7,10L12,15L17,10H7Z'}
                    @click=${() => this._moveAction(i, 1)}
                  ></ha-icon-button>
                  <ha-icon-button
                    class="remove-action"
                    .label=${'Delete action'}
                    .path=${'M19,4H15.5L14.5,3H9.5L8.5,4H5V6H19M6,19A2,2 0 0,0 8,21H16A2,2 0 0,0 18,19V7H6V19Z'}
                    @click=${() => this._removeAction(i)}
                  ></ha-icon-button>
                </div>
              </div>
              <ha-form
                class="action-form"
                .hass=${this.hass}
                .data=${a}
                .schema=${quickActionSchema()}
                .computeLabel=${this._actionLabel}
                @value-changed=${(ev: CustomEvent) => this._onActionChanged(ev, i)}
              ></ha-form>
            </div>
          `
        )}
        <ha-button class="add-action" @click=${this._addAction}>Add quick action</ha-button>
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

  private _renderStudioHeader() {
    return html`
      <div class="editor-mode">
        <div class="editor-heading">
          <div class="editor-title">Apartment View Card</div>
          <ha-icon-button class="history-button undo" .label=${'Undo'} icon="mdi:undo"
            ?disabled=${!this._undoCount} @click=${this._undo}></ha-icon-button>
          <ha-icon-button class="history-button redo" .label=${'Redo'} icon="mdi:redo"
            ?disabled=${!this._redoCount} @click=${this._redo}></ha-icon-button>
        </div>
        <div class="mode-switch" role="tablist" aria-label="Editor mode">
          <button class=${this._mode === 'setup' ? 'active' : ''} role="tab"
            aria-selected=${this._mode === 'setup'} @click=${() => this._setMode('setup')}>Setup</button>
          <button class=${this._mode === 'advanced' ? 'active' : ''} role="tab"
            aria-selected=${this._mode === 'advanced'} @click=${() => this._setMode('advanced')}>Advanced</button>
        </div>
      </div>
    `;
  }

  private _renderSetupSteps() {
    const index = SETUP_STEPS.findIndex((step) => step.id === this._setupStep);
    const active = SETUP_STEPS[index] ?? SETUP_STEPS[0];
    return html`
      <div class="setup-progress" aria-label="Setup progress">
        <button aria-label="Previous setup step" ?disabled=${index <= 0} @click=${() => this._moveSetupStep(-1)}><ha-icon icon="mdi:chevron-left"></ha-icon></button>
        <div class="setup-progress-copy"><span>Step ${index + 1} of ${SETUP_STEPS.length}</span><strong>${active.label}</strong></div>
        <button aria-label="Next setup step" ?disabled=${index >= SETUP_STEPS.length - 1} @click=${() => this._moveSetupStep(1)}><ha-icon icon="mdi:chevron-right"></ha-icon></button>
      </div>
      <div class="setup-steps" role="tablist" aria-label="Setup steps">
        ${SETUP_STEPS.map((step) => html`
          <button class="setup-step ${this._setupStep === step.id ? 'active' : ''}" role="tab"
            aria-selected=${this._setupStep === step.id}
            @click=${() => { this._setupStep = step.id; if (step.id === 'architecture' || step.id === 'furniture') this._previewMode = 'edit'; }}>
            <ha-icon icon=${step.icon}></ha-icon><span>${step.label}</span>
          </button>
        `)}
      </div>
    `;
  }

  private _moveSetupStep(delta: number): void {
    const index = SETUP_STEPS.findIndex((step) => step.id === this._setupStep);
    const next = SETUP_STEPS[Math.min(SETUP_STEPS.length - 1, Math.max(0, index + delta))];
    if (!next) return;
    this._setupStep = next.id;
    if (next.id === 'architecture' || next.id === 'furniture') this._previewMode = 'edit';
  }

  private _renderSetupFloorplan() {
    const plan = this._spatial().plan;
    const shell = this._spatial().shell;
    const surveyWallCount = shell?.walls?.reduce((count, wall) => count + Math.max(0, wall.points.length - 1), 0) ?? 0;
    const wallCount = surveyWallCount || plan?.walls.length || 0;
    const roomCount = shell?.rooms?.length || plan?.rooms.length || 0;
    const objectCount = plan?.objects.length || 0;
    return html`
      <p class="studio-intro">Build the physical home in metres. Shared corners, walls, openings, furniture, light, and every device will use this one model.</p>
      ${plan || shell ? html`
        <div class="setup-card">
          <h3>Your structure</h3>
          <p>${wallCount} wall segment${wallCount === 1 ? '' : 's'}, ${roomCount} room${roomCount === 1 ? '' : 's'}, and ${objectCount} placed object${objectCount === 1 ? '' : 's'}.</p>
          <div class="setup-actions">
            <ha-button @click=${() => { this._previewMode = 'edit'; }}>${shell ? 'Edit imported plan' : 'Edit structure'}</ha-button>
            <ha-button @click=${() => { this._previewMode = '3d'; }}>Inspect in 3D</ha-button>
            <ha-button @click=${() => { this._setupStep = 'rooms'; }}>Continue to rooms</ha-button>
          </div>
        </div>
      ` : html`
        <div class="setup-card">
          <h3>How would you like to begin?</h3>
          <p>A dimensioned rectangle is fastest for most homes. A blank plan gives you complete control from the first wall.</p>
          <div class="setup-actions">
            <ha-button @click=${() => {
              this._commitSpatial({ ...this._spatial(), plan: rectangularSpatialPlan(8, 6) });
              this._previewMode = 'edit';
            }}>Start with an 8 × 6 m shell</ha-button>
            <ha-button @click=${() => {
              this._commitSpatial({ ...this._spatial(), plan: emptySpatialPlan() });
              this._previewMode = 'edit';
            }}>Draw from scratch</ha-button>
          </div>
        </div>
      `}
    `;
  }

  private _renderSetupRooms() {
    const plan = this._spatial().plan;
    const surveyedRooms = this._spatial().shell?.rooms ?? [];
    const areas = this._areaList();
    if ((!plan || !plan.rooms.length) && surveyedRooms.length) return html`
      <p class="studio-intro">${surveyedRooms.length} imported room${surveyedRooms.length === 1 ? ' is' : 's are'} ready to name and connect to Home Assistant Areas.</p>
      <div class="setup-card">
        <h3>Your rooms</h3>
        <div class="room-mapping-list">
          ${surveyedRooms.map((room, index) => {
            const zone = this._config.zones.find((candidate) => candidate.id === room.zoneId);
            const selectedId = `survey:${room.zoneId}`;
            return html`<div class="room-mapping ${this._selectedRoomId === selectedId ? 'selected' : ''}"
              @click=${() => { this._selectedRoomId = selectedId; }}>
              <div class="room-number">${String(index + 1).padStart(2, '0')}</div>
              <button type="button" class="room-summary-name" aria-label=${`Edit ${zone?.name ?? room.zoneId}`}>
                <span>${zone?.name ?? room.zoneId}</span><ha-icon icon="mdi:pencil-outline"></ha-icon>
              </button>
              <div class="room-fields">
                <label>
                  <span>Room name</span>
                  <input aria-label=${`Name for room ${index + 1}`} .value=${zone?.name ?? room.zoneId}
                    @change=${(event: Event) => this._renameSurveyRoom(room.zoneId, (event.target as HTMLInputElement).value)}
                    @blur=${(event: Event) => this._renameSurveyRoom(room.zoneId, (event.target as HTMLInputElement).value)}
                    @keydown=${(event: KeyboardEvent) => {
                      if (event.key !== 'Enter') return;
                      this._renameSurveyRoom(room.zoneId, (event.target as HTMLInputElement).value);
                      (event.target as HTMLInputElement).blur();
                    }} />
                </label>
                <label>
                  <span>Home Assistant Area</span>
                  <select aria-label=${`Area for room ${index + 1}`} .value=${zone?.areaId ?? ''}
                    @change=${(event: Event) => this._linkSurveyRoom(room.zoneId, (event.target as HTMLSelectElement).value)}>
                    <option value="" ?selected=${!zone?.areaId}>Not linked</option>
                    ${areas.map((area) => html`<option value=${area.area_id} ?selected=${zone?.areaId === area.area_id}>${area.name}</option>`)}
                  </select>
                </label>
              </div>
              <div class="room-status ${zone?.areaId ? 'linked' : ''}">${zone?.areaId ? 'Linked' : 'Local room'}</div>
            </div>`;
          })}
        </div>
        <div class="setup-actions"><ha-button @click=${() => { this._setupStep = 'architecture'; }}>Continue to openings</ha-button></div>
      </div>
    `;
    if (!plan || !plan.rooms.length) return html`
      <p class="studio-intro">Rooms appear automatically whenever walls form an enclosed space.</p>
      <div class="setup-card">
        <h3>No enclosed rooms yet</h3>
        <p>Close the wall outline in Plan view. Shared walls can divide a larger outline into multiple rooms.</p>
        <div class="setup-actions"><ha-button @click=${() => { this._setupStep = 'floorplan'; this._previewMode = 'edit'; }}>Edit structure</ha-button></div>
      </div>
    `;
    return html`
      <p class="studio-intro">${plan.rooms.length} enclosed ${plan.rooms.length === 1 ? 'space was' : 'spaces were'} found from the wall graph. Name each one or connect it to a Home Assistant Area.</p>
      <div class="setup-card">
        <h3>Your rooms</h3>
        <div class="room-mapping-list">
          ${plan.rooms.map((room, index) => {
            const zone = room.zoneId ? this._config.zones.find((candidate) => candidate.id === room.zoneId) : undefined;
            return html`<div class="room-mapping ${this._selectedRoomId === room.id ? 'selected' : ''}" @click=${() => { this._selectedRoomId = room.id; }}>
              <div class="room-number">${String(index + 1).padStart(2, '0')}</div>
              <button type="button" class="room-summary-name" aria-label=${`Edit ${zone?.name ?? `Room ${index + 1}`}`}>
                <span>${zone?.name ?? `Room ${index + 1}`}</span><ha-icon icon="mdi:pencil-outline"></ha-icon>
              </button>
              <div class="room-fields">
                <label>
                  <span>Room name</span>
                  <input aria-label=${`Name for room ${index + 1}`} .value=${zone?.name ?? `Room ${index + 1}`}
                    @change=${(event: Event) => this._renameSpatialRoom(room.id, (event.target as HTMLInputElement).value)}
                    @blur=${(event: Event) => this._renameSpatialRoom(room.id, (event.target as HTMLInputElement).value)}
                    @keydown=${(event: KeyboardEvent) => {
                      if (event.key !== 'Enter') return;
                      this._renameSpatialRoom(room.id, (event.target as HTMLInputElement).value);
                      (event.target as HTMLInputElement).blur();
                    }} />
                </label>
                <label>
                  <span>Home Assistant Area</span>
                  <select aria-label=${`Area for room ${index + 1}`} .value=${zone?.areaId ?? ''}
                    @change=${(event: Event) => this._linkSpatialRoom(room.id, (event.target as HTMLSelectElement).value)}>
                    <option value="" ?selected=${!zone?.areaId}>Choose an area</option>
                    ${areas.map((area) => html`<option value=${area.area_id} ?selected=${zone?.areaId === area.area_id}>${area.name}</option>`)}
                  </select>
                </label>
              </div>
              <div class="room-status ${zone ? 'linked' : ''}">${zone ? 'Linked' : 'Needs a name'}</div>
            </div>`;
          })}
        </div>
        <div class="setup-actions">
          <ha-button @click=${() => { this._setupStep = 'floorplan'; this._previewMode = 'edit'; }}>Adjust walls</ha-button>
          <ha-button @click=${() => { this._setupStep = 'architecture'; this._previewMode = 'edit'; }}>Add doors &amp; windows</ha-button>
        </div>
      </div>
    `;
  }

  private _renderSetupArchitecture() {
    const openings = this._spatial().openings;
    const plan = this._spatial().plan;
    const surveyOpenings = this._spatial().shell?.openings ?? [];
    const shellAssignments = this._spatial().shell ? assignShellOpenings(this._spatial().shell!) : [];
    const surveySelected = surveyOpenings.find((opening) => opening.id === this._selectedOpeningId);
    const surveyAssignment = shellAssignments.find(({ opening }) => opening.id === surveySelected?.id);
    const selectedShellSegment = this._spatial().shell ? shellSegmentById(this._spatial().shell!, this._selectedWallId) : undefined;
    const surveyPosition = surveyAssignment ? Math.min(1, Math.max(0, surveyAssignment.along / surveyAssignment.segment.length)) : 0.5;
    const planWall = plan?.walls.find((wall) => wall.id === this._selectedWallId);
    const selected = openings.find((opening) => opening.id === this._selectedOpeningId);
    const curve = this._selectedWallId ? this._wallCurve(this._selectedWallId) : 0;
    const north = this._spatial().site.north;
    const wallOpenings = this._selectedWallId
      ? openings.filter((opening) => opening.wallId === this._selectedWallId)
      : [];
    if (this._spatial().shell && !plan?.walls.length) return html`
      <p class="studio-intro">This imported floor plan stays dimensionally exact. Select a wall to add an opening, or select a door or window to edit it.</p>
      <div class="setup-card">
        <h3>Doors &amp; windows</h3>
        <p>${surveyOpenings.length} opening${surveyOpenings.length === 1 ? '' : 's'} in the imported plan.</p>
        <div class="opening-list">
          ${shellAssignments.map(({ opening, segment }) => html`<button class="opening-row ${opening.id === this._selectedOpeningId ? 'selected' : ''}"
            @click=${() => { this._selectedOpeningId = opening.id; this._selectedWallId = segment.id; }}>
            <ha-icon icon=${opening.kind === 'door' ? 'mdi:door-open' : 'mdi:window-closed-variant'}></ha-icon>
            <span>${opening.id.split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ')}</span>
            <small>${opening.width.toFixed(2)} × ${opening.height.toFixed(2)} m</small>
          </button>`)}
        </div>
        ${selectedShellSegment ? html`<div class="setup-actions">
          <ha-button @click=${() => this._addOpening('door')}><ha-icon icon="mdi:door-open"></ha-icon>&nbsp; Add door</ha-button>
          <ha-button @click=${() => this._addOpening('window')}><ha-icon icon="mdi:window-closed-variant"></ha-icon>&nbsp; Add window</ha-button>
          <ha-button @click=${() => { this._previewMode = '3d'; }}>View in 3D</ha-button>
        </div>` : html`<p>Select a wall in the plan to add a new opening.</p>`}
      </div>
      ${surveySelected && surveyAssignment ? html`<div class="setup-card">
        <h3>Edit ${surveySelected.kind}</h3>
        <div class="opening-editor">
          <div class="opening-control">
            <label for="shell-opening-kind">Type</label>
            <select id="shell-opening-kind" .value=${surveySelected.kind}
              @change=${(event: Event) => {
                const kind = (event.target as HTMLSelectElement).value as OpeningKind;
                this._updateShellOpening(surveySelected.id, kind === 'door'
                  ? { kind, bottom: 0, color: surveySelected.color ?? '#8f887d' }
                  : { kind, bottom: Math.max(0.9, surveySelected.bottom) });
              }}>
              <option value="window">Window</option><option value="door">Door</option>
            </select>
          </div>
          <div class="opening-control">
            <label for="shell-opening-position">Position</label>
            <input id="shell-opening-position" type="range" min="4" max="96" step="1" .value=${String(Math.round(surveyPosition * 100))}
              @pointerdown=${this._onPreviewEditStart} @pointerup=${this._onPreviewEditEnd}
              @input=${(event: Event) => this._moveShellOpening(surveySelected.id, surveyAssignment.segment.id, Number((event.target as HTMLInputElement).value) / 100, !this._dragStartConfig)} />
            <output>${Math.round(surveyPosition * 100)}%</output>
          </div>
          <div class="opening-control">
            <label for="shell-opening-width">Width</label>
            <input id="shell-opening-width" type="number" min="0.2" max="8" step="0.01" .value=${String(surveySelected.width)}
              @change=${(event: Event) => this._updateShellOpening(surveySelected.id, { width: Number((event.target as HTMLInputElement).value) })} />
            <output>m</output>
          </div>
          <div class="opening-control">
            <label for="shell-opening-height">Height</label>
            <input id="shell-opening-height" type="number" min="0.2" max="5" step="0.01" .value=${String(surveySelected.height)}
              @change=${(event: Event) => this._updateShellOpening(surveySelected.id, { height: Number((event.target as HTMLInputElement).value) })} />
            <output>m</output>
          </div>
          ${surveySelected.kind === 'window' ? html`<div class="opening-control">
            <label for="shell-opening-bottom">Sill</label>
            <input id="shell-opening-bottom" type="number" min="0" max="4" step="0.01" .value=${String(surveySelected.bottom)}
              @change=${(event: Event) => this._updateShellOpening(surveySelected.id, { bottom: Number((event.target as HTMLInputElement).value) })} />
            <output>m</output>
          </div>` : html`<div class="opening-control">
            <label for="shell-opening-color">Color</label>
            <input id="shell-opening-color" type="color" .value=${surveySelected.color ?? '#8f887d'}
              @change=${(event: Event) => this._updateShellOpening(surveySelected.id, { color: (event.target as HTMLInputElement).value })} />
            <output>${surveySelected.color ?? '#8f887d'}</output>
          </div>`}
        </div>
        <div class="setup-actions"><ha-button @click=${() => this._removeShellOpening(surveySelected.id)}>Remove ${surveySelected.kind}</ha-button></div>
      </div>` : nothing}
      <div class="setup-card">
        <h3>Daylight orientation</h3>
        <p>Set true north so the 3D home casts sunlight from the correct direction.</p>
        <div class="opening-control">
          <label for="north-bearing">North</label>
          <input id="north-bearing" type="range" min="0" max="359" step="1" .value=${String(Math.round(north))}
            @pointerdown=${this._onPreviewEditStart} @pointerup=${this._onPreviewEditEnd}
            @input=${(event: Event) => this._updateNorth(Number((event.target as HTMLInputElement).value), !this._dragStartConfig)} />
          <output>${Math.round(north)}°</output>
        </div>
      </div>
      <div class="setup-actions"><ha-button @click=${() => { this._setupStep = 'furniture'; this._previewMode = 'edit'; }}>Continue to furniture</ha-button></div>
    `;
    if (!plan?.rooms.length && !this._config.zones.length) return html`
      <p class="studio-intro">Doors and windows are attached directly to room walls.</p>
      <div class="architecture-empty">Close at least one room first.<div class="setup-actions"><ha-button @click=${() => { this._setupStep = 'floorplan'; this._previewMode = 'edit'; }}>Edit structure</ha-button></div></div>
    `;
    return html`
      <p class="studio-intro">Select a wall to shape it, then add doors and windows. Set north once and the 3D model can cast sunlight from the real direction.</p>
      ${!this._selectedWallId ? html`
        <div class="architecture-empty">Select any highlighted wall in the 2D plan above.</div>
      ` : html`
        <div class="setup-card">
          <h3>${this._wallName(this._selectedWallId)}</h3>
          <p>Add an opening or select an existing one to adjust it.</p>
          <div class="opening-editor">
            ${planWall ? html`
              <div class="opening-control">
                <label for="wall-thickness">Thickness</label>
                <input id="wall-thickness" type="number" min="0.05" max="1" step="0.01" .value=${String(planWall.thickness)}
                  @change=${(event: Event) => this._updatePlanWall(planWall.id, { thickness: Number((event.target as HTMLInputElement).value) })} />
                <output>m</output>
              </div>
              <div class="opening-control">
                <label for="selected-wall-height">Height</label>
                <input id="selected-wall-height" type="number" min="0.3" max="6" step="0.05" .value=${String(planWall.height ?? this._spatial().dimensions.wallHeight)}
                  @change=${(event: Event) => this._updatePlanWall(planWall.id, { height: Number((event.target as HTMLInputElement).value) })} />
                <output>m</output>
              </div>
            ` : nothing}
            <div class="opening-control">
              <label for="wall-curve">Wall arch</label>
              <input id="wall-curve" type="range" min="-100" max="100" step="1" .value=${String(Math.round(curve * 100))}
                @pointerdown=${this._onPreviewEditStart} @pointerup=${this._onPreviewEditEnd}
                @input=${(event: Event) => this._updateWallCurve(this._selectedWallId, Number((event.target as HTMLInputElement).value) / 100, !this._dragStartConfig)} />
              <output>${curve === 0 ? 'Straight' : `${curve > 0 ? '+' : ''}${Math.round(curve * 100)}%`}</output>
            </div>
          </div>
          <div class="setup-actions">
            <ha-button @click=${() => this._addOpening('door')}><ha-icon icon="mdi:door-open"></ha-icon>&nbsp; Add door</ha-button>
            <ha-button @click=${() => this._addOpening('window')}><ha-icon icon="mdi:window-closed-variant"></ha-icon>&nbsp; Add window</ha-button>
            <ha-button @click=${() => { this._previewMode = '3d'; }}>View in 3D</ha-button>
          </div>
          ${wallOpenings.length ? html`<div class="opening-list">${wallOpenings.map((opening, index) => html`
            <button class="opening-row ${opening.id === this._selectedOpeningId ? 'selected' : ''}"
              @click=${() => { this._selectedOpeningId = opening.id; }}>
              <ha-icon icon=${opening.kind === 'door' ? 'mdi:door-open' : 'mdi:window-closed-variant'}></ha-icon>
              <span>${opening.kind === 'door' ? 'Door' : 'Window'} ${index + 1}</span>
              <small>${Math.round(opening.position * 100)}% · ${opening.widthMeters?.toFixed(2) ?? `${Math.round(opening.width * 100)}%`} ${opening.widthMeters ? 'm' : ''}</small>
            </button>
          `)}</div>` : nothing}
        </div>
      `}
      ${selected ? html`
        <div class="setup-card">
          <h3>Adjust ${selected.kind}</h3>
          <p>Position runs along the wall. Width, height, and sill are real dimensions in metres.</p>
          <div class="opening-editor">
            <div class="opening-control">
              <label for="opening-position">Position</label>
              <input id="opening-position" type="range" min="8" max="92" step="1" .value=${String(Math.round(selected.position * 100))}
                @pointerdown=${this._onPreviewEditStart} @pointerup=${this._onPreviewEditEnd}
                @input=${(event: Event) => this._updateOpening(selected.id, { position: Number((event.target as HTMLInputElement).value) / 100 }, !this._dragStartConfig)} />
              <output>${Math.round(selected.position * 100)}%</output>
            </div>
            ${plan ? html`<div class="opening-control">
              <label for="opening-size">Width</label>
              <input id="opening-size" type="number" min="0.3" max="8" step="0.05" .value=${String(selected.widthMeters ?? 1)}
                @change=${(event: Event) => this._updateOpening(selected.id, { widthMeters: Number((event.target as HTMLInputElement).value) })} />
              <output>m</output>
            </div>
            <div class="opening-control">
              <label for="opening-height">Height</label>
              <input id="opening-height" type="number" min="0.3" max="4" step="0.05" .value=${String(selected.height ?? (selected.kind === 'door' ? 2.1 : 1.2))}
                @change=${(event: Event) => this._updateOpening(selected.id, { height: Number((event.target as HTMLInputElement).value) })} />
              <output>m</output>
            </div>
            ${selected.kind === 'window' ? html`<div class="opening-control">
              <label for="opening-bottom">Sill</label>
              <input id="opening-bottom" type="number" min="0" max="3" step="0.05" .value=${String(selected.bottom ?? 0.9)}
                @change=${(event: Event) => this._updateOpening(selected.id, { bottom: Number((event.target as HTMLInputElement).value) })} />
              <output>m</output>
            </div>` : html`<div class="opening-control">
              <label for="opening-color">Color</label>
              <input id="opening-color" type="color" .value=${selected.color ?? '#8f887d'}
                @change=${(event: Event) => this._updateOpening(selected.id, { color: (event.target as HTMLInputElement).value })} />
              <output>${selected.color ?? '#8f887d'}</output>
            </div>`}` : html`<div class="opening-control">
              <label for="opening-size">Size</label>
              <input id="opening-size" type="range" min="8" max="70" step="1" .value=${String(Math.round(selected.width * 100))}
                @pointerdown=${this._onPreviewEditStart} @pointerup=${this._onPreviewEditEnd}
                @input=${(event: Event) => this._updateOpening(selected.id, { width: Number((event.target as HTMLInputElement).value) / 100 }, !this._dragStartConfig)} />
              <output>${Math.round(selected.width * 100)}%</output>
            </div>`}
          </div>
          <div class="setup-actions"><ha-button @click=${() => this._removeOpening(selected.id)}>Remove ${selected.kind}</ha-button></div>
        </div>
      ` : nothing}
      <div class="setup-card">
        <h3>Real dimensions</h3>
        <p>Scale the model in metres so rooms, furniture, walls, shadows, and camera movement share one believable physical system.</p>
        <div class="opening-editor">
          <div class="opening-control">
            <label for="apartment-width">Plan width</label>
            <input id="apartment-width" type="number" min="2" max="100" step="0.1" .value=${String(this._spatial().dimensions.width)}
              @change=${(event: Event) => this._updateDimensions({ width: Number((event.target as HTMLInputElement).value) })} />
            <output>m</output>
          </div>
          <div class="opening-control">
            <label for="wall-height">Wall height</label>
            <input id="wall-height" type="number" min="1.8" max="5" step="0.05" .value=${String(this._spatial().dimensions.wallHeight)}
              @change=${(event: Event) => this._updateDimensions({ wallHeight: Number((event.target as HTMLInputElement).value) })} />
            <output>m</output>
          </div>
          ${!plan ? html`<div class="opening-control">
            <label for="plan-aspect">Image ratio</label>
            <input id="plan-aspect" type="number" min="0.25" max="4" step="0.001" .value=${String(this._spatial().dimensions.aspectRatio)}
              @change=${(event: Event) => this._updateDimensions({ aspectRatio: Number((event.target as HTMLInputElement).value) })} />
            <output>${this._spatial().dimensions.aspectRatio.toFixed(3)}</output>
          </div>` : nothing}
        </div>
        ${!plan ? html`<div class="setup-actions"><ha-button @click=${this._useImageAspect}>Read ratio from floorplan</ha-button></div>` : nothing}
      </div>
      <div class="setup-card">
        <h3>Sun orientation</h3>
        <p>Point north to match the floorplan. Home Assistant's home location supplies latitude and longitude automatically.</p>
        <div class="north-setting">
          <div class="compass" aria-hidden="true"><div class="compass-arrow" style=${`transform:rotate(${north}deg)`}></div></div>
          <div>
            <div class="opening-control">
              <label for="north-bearing">North</label>
              <input id="north-bearing" type="range" min="0" max="359" step="1" .value=${String(Math.round(north))}
                @pointerdown=${this._onPreviewEditStart} @pointerup=${this._onPreviewEditEnd}
                @input=${(event: Event) => this._updateNorth(Number((event.target as HTMLInputElement).value), !this._dragStartConfig)} />
              <output>${Math.round(north)}°</output>
            </div>
            <div class="location-note">${this.hass.config?.latitude?.toFixed?.(3) ?? 'Home'} · ${this.hass.config?.longitude?.toFixed?.(3) ?? 'location'}</div>
          </div>
        </div>
      </div>
      <div class="setup-actions"><ha-button @click=${() => { this._setupStep = 'furniture'; this._previewMode = 'edit'; }}>Continue to furniture</ha-button></div>
    `;
  }

  private _renderSetupFurniture() {
    const plan = this._spatial().plan ?? (this._spatial().shell ? emptySpatialPlan() : null);
    if (!plan) return nothing;
    const selected = plan.objects.find((item) => item.id === this._selectedObjectId);
    const selectedAsset = spatialAsset(selected?.assetId);
    const query = this._assetSearch.trim().toLocaleLowerCase();
    const assets = SPATIAL_ASSETS.filter((asset) => (
      (this._assetCategory === 'All' || asset.category === this._assetCategory)
      && (!query || `${asset.label} ${asset.category}`.toLocaleLowerCase().includes(query))
    ));
    return html`
      <p class="studio-intro">Place the objects that make rooms recognizable. Drag them in Plan view, then use precise three-dimensional controls when needed.</p>
      <div class="setup-card">
        <h3>Add furniture</h3>
        <div class="asset-browser-tools">
          <input class="asset-search" type="search" placeholder="Search the collection" aria-label="Search furniture collection" .value=${this._assetSearch}
            @input=${(event: Event) => { this._assetSearch = (event.target as HTMLInputElement).value; }} />
          <div class="asset-categories" aria-label="Furniture categories">
            ${(['All', ...SPATIAL_ASSET_CATEGORIES] as const).map((category) => html`<button class=${this._assetCategory === category ? 'active' : ''}
              @click=${() => { this._assetCategory = category; }}>${category}</button>`)}
          </div>
        </div>
        <div class="furniture-library">
          ${assets.map((asset) => html`<button title=${`Add ${asset.label}`} @click=${() => this._addSpatialFurniture(asset)}>
            <ha-icon icon=${asset.icon}></ha-icon><span><span class="asset-name">${asset.label}</span><span class="asset-size">${asset.dimensions[0]} × ${asset.dimensions[1]} m</span></span>
          </button>`)}
        </div>
        ${assets.length ? nothing : html`<div class="architecture-empty">No objects match that search.</div>`}
        <div class="setup-actions"><ha-button @click=${() => this._addSpatialFurniture(null)}>Add custom 3D model</ha-button></div>
      </div>
      ${selected ? html`<div class="setup-card">
        <h3>${selected.name || selectedAsset?.label || 'Object'}</h3>
        <p>Position uses metres from the plan origin. Y is height above the finished floor.</p>
        ${selectedAsset ? html`<div class="finish-picker" aria-label="Material finish">
          ${selectedAsset.finishes.map((finish) => html`<button class=${selected.finishId === finish.id ? 'active' : ''}
            @click=${() => this._updateSpatialFurniture({ finishId: finish.id })}>
            <span class="finish-swatch" style=${`background:#${finish.color.toString(16).padStart(6, '0')}`}></span>${finish.label}
          </button>`)}
        </div>` : nothing}
        <div class="asset-fields">
          <label><span>Name</span><input type="text" .value=${selected.name ?? ''} placeholder="Optional label"
            @change=${(event: Event) => this._updateSpatialFurniture({ name: (event.target as HTMLInputElement).value.trim() || undefined })} /></label>
          <label><span>GLB / GLTF model URL</span><input type="url" .value=${selected.modelUrl ?? ''} placeholder="/local/models/chair.glb"
            @change=${(event: Event) => this._updateSpatialFurniture({ modelUrl: (event.target as HTMLInputElement).value.trim() || undefined })} /></label>
          <label><span>Represents Home Assistant device</span><select .value=${selected.entityId ?? ''}
            @change=${(event: Event) => this._updateSpatialFurniture({ entityId: (event.target as HTMLSelectElement).value || undefined })}>
            <option value="">No device binding</option>
            ${this._config.entities.map((entity) => html`<option value=${entity.entity}>${entity.name ?? this.hass.states[entity.entity]?.attributes?.friendly_name ?? entity.entity}</option>`)}
          </select></label>
        </div>
        <div class="transform-grid">
          ${(['x', 'y', 'z'] as const).map((axis) => html`<label><span>${axis.toUpperCase()} position</span><input type="number" step="0.05" .value=${String(selected.position[axis])}
            @change=${(event: Event) => this._updateSpatialFurniture({ position: { ...selected.position, [axis]: Number((event.target as HTMLInputElement).value) } })} /></label>`)}
          <label><span>Rotation</span><input type="number" step="5" .value=${String(selected.rotation.y)}
            @change=${(event: Event) => this._updateSpatialFurniture({ rotation: { ...selected.rotation, y: Number((event.target as HTMLInputElement).value) } })} /></label>
          ${(['x', 'y', 'z'] as const).map((axis) => html`<label><span>${axis.toUpperCase()} scale</span><input type="number" min="0.1" max="20" step="0.05" .value=${String(selected.scale[axis])}
            @change=${(event: Event) => this._updateSpatialFurniture({ scale: { ...selected.scale, [axis]: Number((event.target as HTMLInputElement).value) } })} /></label>`)}
        </div>
        <div class="setup-actions">
          <ha-button @click=${() => { this._previewMode = '3d'; }}>Inspect in 3D</ha-button>
          <ha-button @click=${this._removeSpatialFurniture}>Remove object</ha-button>
        </div>
      </div>` : html`<div class="architecture-empty">Add an object or select one on the plan to adjust it.</div>`}
      <div class="setup-actions"><ha-button @click=${() => { this._setupStep = 'devices'; }}>Continue to devices</ha-button></div>
    `;
  }

  private _renderSetupDevices() {
    const areas = this._areaList().filter((area) => this._zoneForArea(area.area_id));
    const unplaced = this._unplacedEntities();
    const selected = this._config.entities[this._selectedEntity];
    const selectedSpatial = selected?.spatial;
    const wiring = this._config.entities.map((entity, index) => ({
      entity,
      index,
      resolved: resolveSpatialEntityState(this.hass.states ?? {}, entity.entity),
      objectBound: Boolean(this._spatial().plan?.objects.some((object) => object.entityId === entity.entity)),
    }));
    const liveCount = wiring.filter(({ resolved }) => resolved.activity !== 'unavailable' && !resolved.usedGroupFallback).length;
    const fallbackCount = wiring.filter(({ resolved }) => resolved.usedGroupFallback).length;
    const missingCount = wiring.filter(({ resolved }) => resolved.activity === 'unavailable').length;
    return html`
      <p class="studio-intro">Bring in the things you use every day. Devices are suggested from Home Assistant Areas and land inside their matching room.</p>
      ${wiring.length ? html`<div class="setup-card">
        <h3>Live device wiring</h3>
        <p>Every row is checked against the current Home Assistant state. Select one to adjust its physical position.</p>
        <div class="wiring-summary">
          <span><strong>${liveCount}</strong><br />live</span>
          <span><strong>${fallbackCount}</strong><br />using group state</span>
          <span><strong>${missingCount}</strong><br />unavailable</span>
        </div>
        <div class="wiring-list">
          ${wiring.map(({ entity, index, resolved, objectBound }) => {
            const fallback = resolved.usedGroupFallback;
            const unavailable = resolved.activity === 'unavailable';
            const stateLabel = fallback ? `Via ${resolved.sourceEntityId}` : unavailable ? 'Unavailable' : resolved.state?.state ?? 'Unknown';
            const icon = unavailable ? 'mdi:link-off' : fallback ? 'mdi:link-variant' : objectBound ? 'mdi:cube-scan' : 'mdi:map-marker-radius-outline';
            return html`<button class="wiring-row" @click=${() => { this._selectedEntity = index; this._previewMode = 'edit'; }}>
              <ha-icon icon=${icon}></ha-icon>
              <span class="wiring-copy"><strong>${entity.name ?? resolved.state?.attributes?.friendly_name ?? entity.entity}</strong><span>${objectBound ? 'Bound to a 3D object' : entity.zoneId ? `Placed in ${this._config.zones.find((zone) => zone.id === entity.zoneId)?.name ?? entity.zoneId}` : 'Needs a room'}</span></span>
              <span class="wiring-state ${fallback ? 'fallback' : unavailable ? '' : 'live'}">${stateLabel}</span>
            </button>`;
          })}
        </div>
      </div>` : nothing}
      ${areas.length ? html`
        <div class="setup-card">
          <h3>Suggested devices by room</h3>
          <p>Add a room at a time, then drag any marker to its real-world position on the preview.</p>
          <div class="suggestion-list">
            ${areas.map((area) => {
              const count = this._entitiesInArea(area.area_id).length;
              return html`<div class="suggestion">
                <div class="suggestion-copy"><div class="suggestion-name">${area.name}</div><div class="suggestion-meta">${count ? `${count} device${count === 1 ? '' : 's'} ready to add` : 'Everything available is already on the plan'}</div></div>
                ${count ? html`<ha-button @click=${() => this._addEntitiesFromArea(area.area_id)}>Add ${count}</ha-button>` : nothing}
              </div>`;
            })}
          </div>
        </div>
      ` : html`
        <div class="setup-card"><h3>Map a room first</h3><p>Once a drawn room matches a Home Assistant Area, we can suggest its devices and place them inside it.</p><div class="setup-actions"><ha-button @click=${() => { this._setupStep = 'rooms'; }}>Map rooms</ha-button></div></div>
      `}
      ${unplaced.length ? html`
        <div class="setup-card">
          <h3>Needs a room</h3>
          <p>Select a device, then drag its marker into a room. This keeps the overview calm and room summaries accurate.</p>
          <div class="unplaced-list">
            ${unplaced.map((entity) => html`<button class="unplaced-device" @click=${() => this._selectUnplacedEntity(entity)}>${entity.name || entity.entity || 'Unnamed device'}</button>`)}
          </div>
        </div>
      ` : nothing}
      ${selected ? html`<div class="setup-card">
        <h3>${selected.name || selected.entity || 'Device position'}</h3>
        <p>Drag the marker in Plan view. Use Y and mount type to place it correctly in three-dimensional space.</p>
        <div class="transform-grid">
          ${(['x', 'y', 'z'] as const).map((axis) => html`<label><span>${axis.toUpperCase()} position</span><input type="number" step="0.05" .value=${String(selectedSpatial?.position[axis] ?? 0)}
            @change=${(event: Event) => this._updateSelectedEntitySpatial({ position: { ...(selectedSpatial?.position ?? { x: 0, y: 0.18, z: 0 }), [axis]: Number((event.target as HTMLInputElement).value) } })} /></label>`)}
          <label><span>Mount</span><select .value=${selectedSpatial?.mount ?? 'free'}
            @change=${(event: Event) => this._updateSelectedEntitySpatial({ mount: (event.target as HTMLSelectElement).value as NonNullable<EntityConfig['spatial']>['mount'] })}>
            ${(['floor', 'wall', 'ceiling', 'surface', 'free'] as const).map((mount) => html`<option value=${mount}>${mount[0].toUpperCase()}${mount.slice(1)}</option>`)}
          </select></label>
          <label><span>Rotation</span><input type="number" step="5" .value=${String(selectedSpatial?.rotation.y ?? 0)}
            @change=${(event: Event) => this._updateSelectedEntitySpatial({ rotation: { ...(selectedSpatial?.rotation ?? { x: 0, y: 0, z: 0 }), y: Number((event.target as HTMLInputElement).value) } })} /></label>
        </div>
        <label class="visibility-toggle"><input type="checkbox" .checked=${selectedSpatial?.visible ?? true}
          @change=${(event: Event) => this._updateSelectedEntitySpatial({ visible: (event.target as HTMLInputElement).checked })} /><span>Show a marker in the 3D home</span></label>
        <div class="setup-actions"><ha-button @click=${() => { this._previewMode = '3d'; }}>Inspect in 3D</ha-button></div>
      </div>` : nothing}
      <div class="setup-card"><h3>Need something specific?</h3><p>The advanced editor supports every Home Assistant entity, custom labels, directional effects, device behavior, and service-powered actions.</p><div class="setup-actions"><ha-button @click=${() => { this._mode = 'advanced'; this._tab = 'devices'; }}>Add a specific device</ha-button><ha-button @click=${() => { this._setupStep = 'review'; }}>Review setup</ha-button></div></div>
    `;
  }

  private _renderSetupReview() {
    const plan = this._spatial().plan;
    const unplaced = this._unplacedEntities();
    const overlaps = plan ? [] : this._overlappingZones();
    const needsRevealImage = !plan && this._config.options.lightStyle === 'reveal' && !this._config.images.allLights;
    const spatialIssues = plan ? validateSpatialPlan(plan, this._spatial().openings) : [];
    const ready = Boolean(plan?.rooms.length || this._config.zones.length) && this._config.zones.length > 0 && this._config.entities.length > 0 && !unplaced.length && !overlaps.length && !needsRevealImage && !spatialIssues.some((issue) => issue.severity === 'error');
    const changes = this._homeChanges();
    return html`
      <p class="studio-intro">A final spatial check before the card goes into daily use. Nothing here can trigger a device.</p>
      ${changes.length ? html`<div class="setup-card">
        <h3>Your home changed</h3>
        <p>Review updates from the Home Assistant registry. Nothing is changed automatically.</p>
        <div class="change-list">${changes.map((change) => {
          if (change.kind === 'rename') return html`<div class="change-row"><div class="change-copy"><strong>${change.currentName} was renamed</strong>Use ${change.areaName} to stay aligned with its Area.</div><ha-button @click=${() => this._renameLinkedZone(change.zoneId, change.areaName)}>Update</ha-button></div>`;
          if (change.kind === 'new-devices') return html`<div class="change-row"><div class="change-copy"><strong>${change.count} new device${change.count === 1 ? '' : 's'} in ${change.areaName}</strong>Add with safe interaction and visibility defaults.</div><ha-button @click=${() => this._addEntitiesFromArea(change.areaId)}>Review & add</ha-button></div>`;
          return html`<div class="change-row"><div class="change-copy"><strong>${change.zoneName} lost its Area link</strong>The room remains intact; reconnect it or keep it independent.</div><ha-button @click=${() => this._unlinkMissingArea(change.zoneId)}>Keep room</ha-button></div>`;
        })}</div>
      </div>` : nothing}
      <div class="setup-card">
        <h3>${ready ? 'Your apartment is ready' : 'A few details to finish'}</h3>
        <div class="health-list">
          ${plan ? html`<div class="health-item ${spatialIssues.length ? 'warning' : 'ready'}"><ha-icon icon=${spatialIssues.length ? 'mdi:alert-circle-outline' : 'mdi:check-circle-outline'}></ha-icon><span>${spatialIssues.length ? `${spatialIssues.length} architecture issue${spatialIssues.length === 1 ? '' : 's'} to review.` : `${plan.walls.length} walls form ${plan.rooms.length} valid enclosed room${plan.rooms.length === 1 ? '' : 's'}.`}</span></div>` : nothing}
          <div class="health-item ${this._config.zones.length ? 'ready' : 'warning'}"><ha-icon icon=${this._config.zones.length ? 'mdi:check-circle-outline' : 'mdi:alert-circle-outline'}></ha-icon><span>${this._config.zones.length ? `${this._config.zones.length} room${this._config.zones.length === 1 ? '' : 's'} mapped.` : 'No rooms mapped yet.'}</span></div>
          <div class="health-item ${this._config.entities.length ? 'ready' : 'warning'}"><ha-icon icon=${this._config.entities.length ? 'mdi:check-circle-outline' : 'mdi:alert-circle-outline'}></ha-icon><span>${this._config.entities.length ? `${this._config.entities.length} device${this._config.entities.length === 1 ? '' : 's'} on the plan.` : 'No devices placed yet.'}</span></div>
          <div class="health-item ${unplaced.length ? 'warning' : 'ready'}"><ha-icon icon=${unplaced.length ? 'mdi:map-marker-alert-outline' : 'mdi:check-circle-outline'}></ha-icon><span>${unplaced.length ? `${unplaced.length} device${unplaced.length === 1 ? ' needs' : 's need'} a room.` : 'Every device belongs to a room.'}</span></div>
          <div class="health-item ${overlaps.length ? 'warning' : 'ready'}"><ha-icon icon=${overlaps.length ? 'mdi:vector-intersection' : 'mdi:check-circle-outline'}></ha-icon><span>${overlaps.length ? `${overlaps.length} overlapping room ${overlaps.length === 1 ? 'boundary' : 'boundaries'} found.` : 'Room boundaries are clean.'}</span></div>
          ${needsRevealImage ? html`<div class="health-item warning"><ha-icon icon="mdi:image-alert-outline"></ha-icon><span>Reveal lighting needs an all-lights render, or switch back to render-free lighting.</span></div>` : nothing}
          ${plan ? html`<div class="health-item ready"><ha-icon icon="mdi:sofa-outline"></ha-icon><span>${plan.objects.length} spatial object${plan.objects.length === 1 ? '' : 's'} placed.</span></div>` : nothing}
        </div>
        <div class="setup-actions">
          ${unplaced.length || !this._config.entities.length ? html`<ha-button @click=${() => { this._setupStep = 'devices'; }}>Place devices</ha-button>` : nothing}
          ${!this._config.zones.length || overlaps.length ? html`<ha-button @click=${() => { this._setupStep = 'rooms'; }}>Review rooms</ha-button>` : nothing}
          <ha-button @click=${() => { this._mode = 'advanced'; this._tab = 'lighting'; }}>Fine tune appearance</ha-button>
        </div>
      </div>
    `;
  }

  private _renderSetupStudio() {
    let content;
    switch (this._setupStep) {
      case 'rooms': content = this._renderSetupRooms(); break;
      case 'architecture': content = this._renderSetupArchitecture(); break;
      case 'furniture': content = this._renderSetupFurniture(); break;
      case 'devices': content = this._renderSetupDevices(); break;
      case 'review': content = this._renderSetupReview(); break;
      default: content = this._renderSetupFloorplan();
    }
    return html`${this._renderSetupSteps()}${content}`;
  }

  protected render() {
    if (!this.hass || !this._config) {
      return html``;
    }
    return html`
      ${this._renderStudioHeader()}
      <div class="editor-workspace">
      <section class="preview-panel ${this._previewCollapsed ? 'collapsed' : ''}" aria-label="Live preview">
      <div class="preview-toolbar">
        <div class="preview-switch" role="tablist" aria-label="Spatial preview">
          <button class=${this._previewMode === 'edit' ? 'active' : ''} @click=${() => { this._previewMode = 'edit'; }}>Plan</button>
          <button class=${this._previewMode === '3d' ? 'active' : ''} @click=${() => { this._previewMode = '3d'; }}>3D home</button>
        </div>
        <span class="preview-note">Preview only · device actions disabled</span>
        <button class="preview-collapse" aria-label=${this._previewCollapsed ? 'Show preview' : 'Hide preview'}
          title=${this._previewCollapsed ? 'Show preview' : 'Hide preview'} @click=${() => { this._previewCollapsed = !this._previewCollapsed; }}>
          <ha-icon icon=${this._previewCollapsed ? 'mdi:chevron-down' : 'mdi:chevron-up'}></ha-icon><span>${this._previewCollapsed ? 'Show' : 'Hide'}</span>
        </button>
      </div>
      ${this._previewMode === '3d' ? html`<spatial-preview
        .zones=${this._config.zones}
        .entities=${this._config.entities}
        .openings=${this._spatial().openings}
        .walls=${this._spatial().walls}
        .site=${this._spatial().site}
        .dimensions=${this._spatial().dimensions}
        .plan=${this._spatial().plan ?? null}
        .shell=${this._spatial().shell ?? null}
        .hass=${this.hass}
        .hideWalls=${this._config.options.hideWalls}
        .latitude=${this.hass.config?.latitude}
        .longitude=${this.hass.config?.longitude}
        .weatherEntity=${this._config.options.weatherEntity ?? ''}
        .illuminanceEntity=${this._config.options.illuminanceEntity ?? ''}
        .spatialLightingMode=${this._config.options.spatialLightingMode}
        @spatial-entity-selected=${this._onSpatialEntitySelected}
      ></spatial-preview>` : (this._spatial().plan || this._spatial().shell) ? html`<spatial-plan-editor
        .plan=${this._spatial().plan ?? emptySpatialPlan()}
        .shell=${this._spatial().shell ?? null}
        .openings=${this._spatial().openings}
        .entities=${this._config.entities}
        .selectedWallId=${this._selectedWallId}
        .selectedOpeningId=${this._selectedOpeningId}
        .selectedObjectId=${this._selectedObjectId}
        .selectedRoomId=${this._selectedRoomId}
        @spatial-plan-changed=${this._onSpatialPlanChanged}
        @spatial-wall-selected=${this._onPreviewWallSelected}
        @spatial-opening-selected=${this._onPreviewOpeningSelected}
        @spatial-object-selected=${this._onSpatialObjectSelected}
        @spatial-room-selected=${this._onSpatialRoomSelected}
        @spatial-entity-selected=${this._onSpatialEntitySelected}
        @spatial-entity-moved=${this._onSpatialEntityMoved}
      ></spatial-plan-editor>` : this._mode === 'setup' ? html`<div class="spatial-empty-preview">
        <ha-icon icon="mdi:vector-square"></ha-icon><strong>Your 3D home starts here</strong><span>Choose a structure below to begin.</span>
      </div>` : html`<preview-canvas
        .base=${this._config.images.base}
        .entities=${this._config.entities}
        .zones=${this._config.zones}
        .openings=${this._spatial().openings}
        .walls=${this._spatial().walls}
        .selectedEntity=${this._selectedEntity}
        .architectureMode=${false}
        .selectedWallId=${this._selectedWallId}
        .selectedOpeningId=${this._selectedOpeningId}
        .drawingZone=${this._drawingZone}
        @preview-entity-moved=${this._onPreviewEntityMoved}
        @preview-entity-selected=${this._onPreviewEntitySelected}
        @preview-wall-selected=${this._onPreviewWallSelected}
        @preview-opening-selected=${this._onPreviewOpeningSelected}
        @preview-edit-start=${this._onPreviewEditStart}
        @preview-edit-end=${this._onPreviewEditEnd}
        @preview-zone-drawn=${this._onZoneDrawn}
        @preview-zone-draw-cancelled=${this._onZoneDrawCancelled}
      ></preview-canvas>`}
      </section>
      <section class="controls-panel" aria-label="Card settings">
      ${this._mode === 'setup' ? this._renderSetupStudio() : html`
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
      <div class="tab-pane tab-actions ${this._tab === 'actions' ? 'active' : ''}">
        ${this._renderActions()}
      </div>`}
      </section>
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
