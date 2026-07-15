import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { fireEvent, type HomeAssistant } from 'custom-card-helpers';
import { dump as dumpYaml, load as loadYaml } from 'js-yaml';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as THREE from 'three';
import {
  normalizeConfig,
  roomIdFor,
  wallParts,
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
  type SpatialElementPrimitive,
  type SpatialElement,
  type SpatialGlbSurface,
  type SpatialConditionalValue,
  type SpatialElementType,
  type MarkerVisibility,
  type TooltipContent,
} from '../core/config';
import {
  defaultEntity,
  quickActionSchema,
  defaultZone,
} from './editor-helpers';
import { withSuggestedEntityPolicy } from '../core/entity-policy';
import {
  addSpatialElement,
  duplicateSpatialElement,
  emptySpatialPlan,
  rectangularSpatialPlan,
  removeSpatialElement,
  updateSpatialElement,
  updateSpatialWall,
  withDerivedSpatialRooms,
} from '../core/spatial-plan';
import { roomPolygon, spatialBounds, validateSpatialPlan, wallLength } from '../core/spatial-geometry';
import { assignShellOpenings, shellSegmentById } from '../core/spatial-shell';
import { resolveSpatialEntityState } from '../core/spatial-state';
import { createSpatialPrimitive, elementPrimitivesForType } from '../core/spatial-elements';
import { discoverGlbSurfaces } from '../core/spatial-glb';

type EditorMode = 'setup' | 'advanced';
type SetupStep = 'floorplan' | 'rooms' | 'architecture' | 'elements' | 'devices' | 'actions' | 'review';
type PreviewMode = 'edit' | '3d';
type GlbSurfaceScope = 'surface' | 'material' | 'color';
type HomeChange =
  | { kind: 'rename'; zoneId: string; currentName: string; areaName: string }
  | { kind: 'new-devices'; areaId: string; areaName: string; count: number }
  | { kind: 'missing-area'; zoneId: string; zoneName: string };
const SETUP_STEPS: { id: SetupStep; label: string; icon: string }[] = [
  { id: 'floorplan', label: 'Structure', icon: 'mdi:vector-polyline' },
  { id: 'rooms', label: 'Rooms', icon: 'mdi:door' },
  { id: 'architecture', label: 'Openings', icon: 'mdi:door-open' },
  { id: 'elements', label: 'Elements', icon: 'mdi:shape-outline' },
  { id: 'devices', label: 'Devices', icon: 'mdi:devices' },
  { id: 'actions', label: 'Actions', icon: 'mdi:flash-outline' },
  { id: 'review', label: 'Review', icon: 'mdi:check-circle-outline' },
];
const MAX_EMBEDDED_GLB_BYTES = 2_500_000;
import './spatial-preview';
import './spatial-plan-editor';

@customElement('apartment-view-card-editor')
export class ApartmentViewCardEditor extends LitElement {
  @property({ attribute: false }) public hass!: HomeAssistant;
  @state() private _config!: ApartmentViewConfig;
  @state() private _selectedEntity = -1;
  @state() private _mode: EditorMode = 'setup';
  @state() private _setupStep: SetupStep = 'floorplan';
  @state() private _selectedWallId = '';
  @state() private _selectedOpeningId = '';
  @state() private _selectedRoomId = '';
  @state() private _selectedElementId = '';
  @state() private _selectedPrimitiveId = '';
  @state() private _selectedGlbSurfaceId = '';
  @state() private _glbSurfaceScope: GlbSurfaceScope = 'surface';
  @state() private _glbStatus: { kind: 'loading' | 'ready' | 'error'; message: string } | null = null;
  @state() private _previewMode: PreviewMode = 'edit';
  @state() private _previewCollapsed = false;
  @state() private _undoCount = 0;
  @state() private _redoCount = 0;
  @state() private _backupStatus: { kind: 'ready' | 'error' | 'restored'; message: string } | null = null;
  @state() private _pendingRestore: ApartmentViewConfig | null = null;
  @state() private _pendingRestoreName = '';
  private _undoStack: ApartmentViewConfig[] = [];
  private _redoStack: ApartmentViewConfig[] = [];
  private _lastEmittedConfig: ApartmentViewConfig | null = null;
  private _dragStartConfig: ApartmentViewConfig | null = null;
  private _dialogStyleRestores = new Map<HTMLElement, string | null>();
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
    .section-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 10px; }
    .section-heading h3 { margin: 2px 0 0; }
    .section-heading > ha-icon { --mdc-icon-size: 22px; color: var(--secondary-text-color); }
    .section-kicker { color: var(--studio-accent); font-size: 12px; font-weight: 650; text-transform: uppercase; }
    .structure-hint { display: flex; align-items: center; gap: 10px; margin: 18px 0 0; color: var(--secondary-text-color); font-size: 14px; line-height: 1.45; }
    .structure-hint ha-icon { flex: 0 0 auto; --mdc-icon-size: 20px; color: var(--studio-accent); }
    .wall-editor-card .opening-editor { margin-top: 18px; }
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
    .element-kinds { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-top: 16px; }
    .element-kinds button,
    .element-kinds .element-upload,
    .backup-actions button {
      display: grid;
      grid-template-columns: 32px minmax(0, 1fr);
      align-items: center;
      gap: 12px;
      min-height: 82px;
      padding: 14px;
      border: 1px solid var(--studio-line);
      border-radius: 2px;
      background: color-mix(in srgb, var(--studio-accent) 5%, transparent);
      color: var(--primary-text-color);
      cursor: pointer;
      font: inherit;
      text-align: left;
    }
    .element-kinds .element-upload { box-sizing: border-box; }
    .element-kinds button:hover,
    .element-kinds .element-upload:hover,
    .backup-actions button:hover { border-color: var(--studio-accent); background: color-mix(in srgb, var(--studio-accent) 10%, transparent); }
    .element-kinds ha-icon,
    .element-kinds .element-upload ha-icon,
    .backup-actions ha-icon { --mdc-icon-size: 25px; color: var(--studio-accent); }
    .element-kinds strong,
    .element-kinds small,
    .backup-actions strong,
    .backup-actions small { display: block; line-height: 1.3; }
    .element-kinds small,
    .backup-actions small { margin-top: 3px; color: var(--secondary-text-color); font-size: 12px; }
    .element-title,
    .primitive-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
    .element-title > div > span,
    .primitive-header > div > span { color: var(--studio-accent); font-size: 11px; font-weight: 700; text-transform: uppercase; }
    .element-title h3,
    .primitive-header h3 { margin-top: 4px; }
    .element-type { padding: 4px 0; border-bottom: 2px solid var(--studio-accent); color: var(--secondary-text-color); font-size: 12px; text-transform: capitalize; }
    .primitive-add { display: flex; gap: 4px; }
    .primitive-add button,
    .conditional-heading button,
    .condition-remove {
      display: inline-flex; align-items: center; justify-content: center; gap: 5px; min-width: 42px; min-height: 42px;
      border: 1px solid var(--studio-line); border-radius: 2px; background: transparent; color: var(--primary-text-color); cursor: pointer; font: inherit;
    }
    .primitive-add ha-icon,
    .conditional-heading ha-icon,
    .condition-remove ha-icon { --mdc-icon-size: 18px; }
    .primitive-list { display: flex; gap: 16px; margin: 16px 0 0; overflow-x: auto; border-bottom: 1px solid var(--studio-line); scrollbar-width: none; }
    .primitive-list::-webkit-scrollbar { display: none; }
    .primitive-list button { display: inline-flex; align-items: center; gap: 7px; flex: 0 0 auto; min-height: 44px; padding: 0 0 7px; border: 0; border-bottom: 2px solid transparent; background: transparent; color: var(--secondary-text-color); cursor: pointer; font: inherit; }
    .primitive-list button.active { border-bottom-color: var(--studio-accent); color: var(--primary-text-color); }
    .primitive-list ha-icon { --mdc-icon-size: 17px; }
    .primitive-editor { padding-top: 18px; }
    .glb-source { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 14px; margin-top: 14px; padding: 14px 0; border-block: 1px solid var(--studio-line); }
    .glb-source strong, .glb-source span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .glb-source span { margin-top: 3px; color: var(--secondary-text-color); font-size: 12px; }
    .glb-replace { display: inline-flex; align-items: center; gap: 7px; min-height: 42px; padding: 0 11px; border: 1px solid var(--studio-line); color: var(--primary-text-color); cursor: pointer; font-size: 13px; }
    .glb-replace ha-icon { --mdc-icon-size: 18px; }
    .glb-status { display: flex; align-items: center; gap: 8px; margin-top: 12px; color: var(--secondary-text-color); font-size: 13px; line-height: 1.4; }
    .glb-status ha-icon { --mdc-icon-size: 18px; }
    .glb-status.ready { color: var(--success-color, #6fba98); }
    .glb-status.error { color: var(--error-color, #e57373); }
    .glb-note { margin-top: 10px !important; color: var(--secondary-text-color); font-size: 12px !important; }
    .surface-meta { margin-top: 10px; color: var(--secondary-text-color); font-size: 12px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    .surface-scope { margin-top: 16px; padding-block: 14px; border-block: 1px solid var(--studio-line); }
    .surface-scope-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .surface-scope-header strong { font-size: 13px; font-weight: 600; }
    .surface-scope-switch { display: flex; min-width: 0; overflow-x: auto; border-bottom: 1px solid var(--studio-line); scrollbar-width: none; }
    .surface-scope-switch::-webkit-scrollbar { display: none; }
    .surface-scope-switch button { flex: 0 0 auto; min-height: 42px; padding: 0 12px; border: 0; border-bottom: 2px solid transparent; background: transparent; color: var(--secondary-text-color); cursor: pointer; font: inherit; font-size: 12px; }
    .surface-scope-switch button[aria-pressed='true'] { border-bottom-color: var(--studio-accent); color: var(--primary-text-color); }
    .surface-scope-switch button[disabled] { opacity: 0.38; cursor: default; }
    .surface-scope-copy { margin-top: 10px; color: var(--secondary-text-color); font-size: 12px; line-height: 1.45; }
    .surface-apply { min-height: 40px; padding: 0 12px; border: 1px solid var(--studio-accent); border-radius: 2px; background: transparent; color: var(--primary-text-color); cursor: pointer; font: inherit; font-size: 12px; }
    .conditional-control { margin-top: 22px; padding-top: 18px; border-top: 1px solid var(--studio-line); }
    .conditional-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .conditional-heading button { min-height: 36px; padding: 0 9px; color: var(--secondary-text-color); font-size: 12px; }
    .base-value { display: grid; grid-template-columns: 72px minmax(0, 1fr) 48px; align-items: center; gap: 10px; margin-top: 12px; color: var(--secondary-text-color); font-size: 13px; }
    .base-value input[type='range'] { width: 100%; accent-color: var(--studio-accent); }
    .base-value input[type='color'],
    .condition-result input[type='color'] { width: 44px; height: 36px; padding: 2px; border: 1px solid var(--studio-line); border-radius: 2px; background: transparent; }
    .base-value input[type='text'] { min-height: 40px; box-sizing: border-box; padding: 8px 10px; border: 1px solid var(--studio-line); border-radius: 2px; background: var(--card-background-color); color: var(--primary-text-color); font: inherit; }
    .base-value output { text-align: right; font-variant-numeric: tabular-nums; }
    .condition-row { position: relative; display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)) 42px; gap: 8px; margin-top: 10px; padding: 12px 0; border-top: 1px solid var(--studio-line); }
    .condition-row label { display: grid; gap: 4px; min-width: 0; color: var(--secondary-text-color); font-size: 11px; }
    .condition-row input,
    .condition-row select { width: 100%; min-width: 0; min-height: 42px; box-sizing: border-box; padding: 8px; border: 1px solid var(--studio-line); border-radius: 2px; background: var(--card-background-color); color: var(--primary-text-color); font: inherit; font-size: 13px; }
    .condition-remove { align-self: end; color: var(--error-color, #e57373); }
    .advanced-workspace { max-width: 920px; }
    .backup-card { display: grid; grid-template-columns: 44px minmax(0, 1fr); column-gap: 14px; }
    .backup-icon { display: grid; place-items: center; width: 44px; height: 44px; background: color-mix(in srgb, var(--studio-accent) 16%, transparent); color: var(--studio-accent); }
    .backup-icon ha-icon { --mdc-icon-size: 22px; }
    .backup-copy { min-width: 0; }
    .backup-actions { grid-column: 2; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-top: 18px; }
    .backup-picker,
    .restore-button { grid-column: 2; display: inline-flex; align-items: center; justify-content: center; gap: 9px; min-height: 48px; margin-top: 18px; padding: 0 16px; box-sizing: border-box; border: 1px solid var(--studio-accent); border-radius: 2px; background: transparent; color: var(--primary-text-color); cursor: pointer; font: inherit; }
    .restore-button { background: var(--studio-accent); color: #091012; }
    .backup-status { grid-column: 2; display: flex; align-items: flex-start; gap: 10px; margin-top: 14px; padding: 12px; border-left: 3px solid var(--studio-accent); background: color-mix(in srgb, var(--studio-accent) 8%, transparent); color: var(--secondary-text-color); font-size: 13px; line-height: 1.45; }
    .backup-status.error { border-left-color: var(--error-color, #e57373); }
    .backup-status ha-icon { flex: 0 0 auto; --mdc-icon-size: 20px; }
    .backup-status strong { display: block; margin-bottom: 2px; color: var(--primary-text-color); }
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
    .marker-policy { margin-top: 18px; padding-top: 16px; border-top: 1px solid var(--studio-line); }
    .marker-policy h4 { margin: 0 0 5px; color: var(--primary-text-color); font-size: 14px; font-weight: 650; }
    .marker-policy p { margin: 0; color: var(--secondary-text-color); font-size: 12px; line-height: 1.45; }
    .marker-policy-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 9px; margin-top: 12px; }
    .marker-policy-grid label { display: grid; gap: 5px; color: var(--secondary-text-color); font-size: 12px; }
    .marker-policy-grid select { width: 100%; min-width: 0; min-height: 44px; box-sizing: border-box; padding: 9px 10px; border: 1px solid var(--divider-color); border-radius: 2px; background: var(--card-background-color); color: var(--primary-text-color); font: inherit; font-size: 14px; }
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
      .element-kinds { grid-template-columns: 1fr; }
      .element-kinds button, .element-kinds .element-upload { min-height: 72px; }
      .glb-source { grid-template-columns: 1fr; }
      .glb-replace { justify-content: center; }
      .surface-scope-header { align-items: stretch; flex-direction: column; }
      .surface-apply { width: 100%; }
      .transform-grid { grid-template-columns: 1fr; }
      .marker-policy-grid { grid-template-columns: 1fr; }
      .primitive-header { align-items: center; }
      .base-value { grid-template-columns: 64px minmax(0, 1fr) 44px; }
      .condition-row { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 42px; padding: 14px 0; }
      .condition-row label:nth-child(1),
      .condition-row label:nth-child(2) { grid-column: 1 / -1; }
      .condition-row label:nth-child(3) { grid-column: 1; }
      .condition-row label:nth-child(4) { grid-column: 2 / -1; }
      .condition-row label:nth-child(5) { grid-column: 1 / 3; }
      .condition-row .condition-remove { grid-column: 3; align-self: end; }
      .backup-card { display: block; }
      .backup-icon { margin-bottom: 14px; }
      .backup-actions { grid-template-columns: 1fr; }
      .backup-actions,
      .backup-picker,
      .backup-status,
      .restore-button { grid-column: auto; width: 100%; }
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

  private _downloadBackup(format: 'json' | 'yaml'): void {
    const content = format === 'json'
      ? `${JSON.stringify(this._config, null, 2)}\n`
      : dumpYaml(this._config, { noRefs: true, lineWidth: 120, sortKeys: false });
    const blob = new Blob([content], { type: format === 'json' ? 'application/json' : 'application/yaml' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `apartment-view-backup.${format === 'json' ? 'json' : 'yaml'}`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  private _validateBackup(raw: unknown): { config?: ApartmentViewConfig; errors: string[] } {
    const errors: string[] = [];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { errors: ['The backup must contain one configuration object.'] };
    const candidate = raw as Record<string, unknown>;
    if (candidate.type !== 'custom:apartment-view-card') errors.push('This is not an Apartment View Card backup.');
    if (!Array.isArray(candidate.entities)) errors.push('The entities list is missing or invalid.');
    if (!Array.isArray(candidate.zones)) errors.push('The rooms list is missing or invalid.');
    const spatial = candidate.spatial as Record<string, unknown> | undefined;
    const rawPlan = spatial?.plan as Record<string, unknown> | undefined;
    if (rawPlan && !Array.isArray(rawPlan.elements)) errors.push('The spatial plan has no valid Elements list.');
    if (errors.length) return { errors };
    const config = normalizeConfig(candidate);
    const plan = config.spatial?.plan;
    if (plan) {
      errors.push(...validateSpatialPlan(plan, config.spatial?.openings).filter((issue) => issue.severity === 'error').map((issue) => issue.message));
      plan.elements.forEach((element) => {
        if (element.type === 'custom' && !element.primitives.length) errors.push(`Element ${element.name ?? element.id} has no primitives.`);
        if (element.type === 'glb' && (!element.glb || !element.glb.surfaces.length)) errors.push(`Element ${element.name ?? element.id} has no valid GLB surfaces.`);
      });
    }
    return errors.length ? { errors } : { config, errors: [] };
  }

  private async _onBackupPicked(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (file.size > 5_000_000) {
      this._backupStatus = { kind: 'error', message: 'That backup is larger than 5 MB.' };
      return;
    }
    try {
      const text = await file.text();
      const raw = file.name.toLowerCase().endsWith('.json') ? JSON.parse(text) : loadYaml(text);
      const result = this._validateBackup(raw);
      if (!result.config) {
        this._pendingRestore = null;
        this._backupStatus = { kind: 'error', message: result.errors.join(' ') };
        return;
      }
      this._pendingRestore = result.config;
      this._pendingRestoreName = file.name;
      const plan = result.config.spatial?.plan;
      this._backupStatus = {
        kind: 'ready',
        message: `Validated ${result.config.zones.length} rooms, ${result.config.entities.length} entities, and ${plan?.elements.length ?? 0} Elements.`,
      };
    } catch (error) {
      this._pendingRestore = null;
      this._backupStatus = { kind: 'error', message: error instanceof Error ? error.message : 'The backup could not be read.' };
    }
  }

  private _restorePendingBackup(): void {
    if (!this._pendingRestore) return;
    this._applyConfig(this._pendingRestore);
    this._pendingRestore = null;
    this._backupStatus = { kind: 'restored', message: `${this._pendingRestoreName} has been restored.` };
  }

  private _rememberDialogStyle(element: HTMLElement): void {
    if (!this._dialogStyleRestores.has(element)) this._dialogStyleRestores.set(element, element.getAttribute('style'));
  }

  private _styleEditorDialog(element: HTMLElement, surface = false): void {
    this._rememberDialogStyle(element);
    const width = 'calc(100vw - 32px)';
    if (surface) {
      element.style.setProperty('width', width, 'important');
      element.style.setProperty('max-width', width, 'important');
      return;
    }
    element.style.setProperty('--mdc-dialog-min-width', width);
    element.style.setProperty('--mdc-dialog-max-width', width);
    element.style.setProperty('--md-dialog-container-min-width', width);
    element.style.setProperty('--md-dialog-container-max-width', width);
  }

  private _expandHostDialog(): void {
    if (!window.matchMedia?.('(min-width: 900px)').matches) return;
    const ancestors: HTMLElement[] = [];
    let node: Node | null = this.parentNode
      ?? ((this.getRootNode() instanceof ShadowRoot) ? (this.getRootNode() as ShadowRoot).host : null);
    const visited = new Set<Node>();
    while (node && !visited.has(node) && ancestors.length < 16) {
      visited.add(node);
      if (node instanceof HTMLElement) ancestors.push(node);
      const parent: Node | null = node.parentNode
        ?? (node instanceof ShadowRoot ? node.host : null)
        ?? ((node.getRootNode() instanceof ShadowRoot) ? (node.getRootNode() as ShadowRoot).host : null);
      node = parent;
    }
    const dialogs = new Set<HTMLElement>();
    ancestors.forEach((ancestor) => {
      if (ancestor.matches('ha-dialog, md-dialog, hui-dialog-edit-card, hui-dialog-edit-card-v2')) dialogs.add(ancestor);
      ancestor.shadowRoot?.querySelectorAll<HTMLElement>('ha-dialog, md-dialog').forEach((dialog) => dialogs.add(dialog));
    });
    dialogs.forEach((dialog) => {
      this._styleEditorDialog(dialog);
      dialog.shadowRoot?.querySelectorAll<HTMLElement>('.mdc-dialog__surface, [part="container"], .dialog-surface')
        .forEach((surface) => this._styleEditorDialog(surface, true));
    });
  }

  public disconnectedCallback(): void {
    this._dialogStyleRestores.forEach((style, element) => {
      if (style === null) element.removeAttribute('style');
      else element.setAttribute('style', style);
    });
    this._dialogStyleRestores.clear();
    super.disconnectedCallback();
  }

  protected updated(): void {
    this._expandHostDialog();
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

  private _commitEntities(entities: EntityConfig[], record = true): void {
    const config: ApartmentViewConfig = { ...this._config, entities };
    this._applyConfig(config, record);
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

  private _onSpatialShellChanged(ev: CustomEvent): void {
    ev.stopPropagation();
    const { shell, record = true } = ev.detail as { shell: SpatialConfig['shell']; record?: boolean };
    if (!shell) return;
    this._applyConfig({ ...this._config, spatial: { ...this._spatial(), shell } }, record);
  }

  private _onPreviewWallSelected(ev: CustomEvent): void {
    this._selectedWallId = (ev.detail as { wallId: string }).wallId;
    this._selectedOpeningId = '';
    if (this._mode !== 'setup' || this._setupStep !== 'floorplan') this._setupStep = 'architecture';
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

  private async _editStructure(): Promise<void> {
    this._mode = 'setup';
    this._setupStep = 'floorplan';
    this._previewMode = 'edit';
    this._previewCollapsed = false;
    await this.updateComplete;
    const editor = this.renderRoot.querySelector('spatial-plan-editor');
    await editor?.beginStructureEditing();
    const preview = this.renderRoot.querySelector<HTMLElement>('.preview-panel');
    if (typeof preview?.scrollIntoView === 'function') preview.scrollIntoView({ block: 'start', behavior: 'auto' });
  }

  private _renderNorthSetting() {
    const north = this._spatial().site.north;
    return html`<div class="setup-card">
      <h3>True north</h3>
      <p>Rotate north to match the plan. Home Assistant's location supplies the correct solar path and daylight angles.</p>
      <div class="north-setting">
        <div class="compass" aria-hidden="true"><div class="compass-arrow" style=${`transform:rotate(${north}deg)`}></div></div>
        <div>
          <div class="opening-control">
            <label for="structure-north-bearing">North</label>
            <input id="structure-north-bearing" type="range" min="0" max="359" step="1" .value=${String(Math.round(north))}
              @pointerdown=${this._onPreviewEditStart} @pointerup=${this._onPreviewEditEnd}
              @input=${(event: Event) => this._updateNorth(Number((event.target as HTMLInputElement).value), !this._dragStartConfig)} />
            <output>${Math.round(north)}°</output>
          </div>
          <div class="location-note">${this.hass.config?.latitude?.toFixed?.(3) ?? 'Home'} · ${this.hass.config?.longitude?.toFixed?.(3) ?? 'location'}</div>
        </div>
      </div>
    </div>`;
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
    const shell = this._spatial().shell;
    const shellSegment = shell ? shellSegmentById(shell, wallId) : undefined;
    if (shellSegment) return `Wall ${shellSegment.wallIndex + 1}.${shellSegment.segmentIndex + 1} · ${shellSegment.length.toFixed(2)} m`;
    const parts = wallParts(wallId);
    const zone = parts && this._config.zones.find((candidate) => candidate.id === parts.zoneId);
    return parts && zone ? `${zone.name} · ${parts.side} wall` : 'Selected wall';
  }

  private _updatePlanWall(wallId: string, patch: Parameters<typeof updateSpatialWall>[2]): void {
    const plan = this._spatial().plan;
    if (!plan) return;
    this._commitSpatial({ ...this._spatial(), plan: updateSpatialWall(plan, wallId, patch) });
  }

  private _updateShellWall(wallId: string, patch: { thickness?: number; smooth?: boolean }): void {
    const shell = this._spatial().shell;
    const segment = shell ? shellSegmentById(shell, wallId) : undefined;
    if (!shell || !segment || !shell.walls) return;
    const walls = shell.walls.map((wall, wallIndex) => {
      if (wallIndex !== segment.wallIndex) return wall;
      const next = { ...wall };
      if (patch.smooth !== undefined) next.smooth = patch.smooth;
      if (patch.thickness !== undefined) {
        const thicknesses = Array.from(
          { length: Math.max(0, wall.points.length - 1) },
          (_, index) => wall.segmentThicknesses?.[index] ?? wall.thickness ?? 0.12,
        );
        thicknesses[segment.segmentIndex] = Math.min(2, Math.max(0.03, patch.thickness));
        next.segmentThicknesses = thicknesses;
      }
      return next;
    });
    this._commitSpatial({ ...this._spatial(), shell: { ...shell, walls } });
  }

  private _elementInsertionPoint(plan: SpatialPlan): { position: { x: number; z: number }; zoneId?: string } {
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
    return { position, ...(room?.zoneId ? { zoneId: room.zoneId } : {}) };
  }

  private _addSpatialElement(type: SpatialElementType): void {
    const plan = this._spatial().plan ?? emptySpatialPlan();
    const insertion = this._elementInsertionPoint(plan);
    const next = addSpatialElement(plan, type, insertion.position, {
      ...(insertion.zoneId ? { zoneId: insertion.zoneId } : {}),
      name: type === 'ceiling-light' ? 'Ceiling light' : type === 'light-bulb' ? 'Light bulb' : 'Custom element',
      primitives: elementPrimitivesForType(type),
    });
    const added = next.elements[next.elements.length - 1];
    this._selectedElementId = added.id;
    this._selectedPrimitiveId = added.primitives[0]?.id ?? '';
    this._selectedGlbSurfaceId = '';
    this._commitSpatial({ ...this._spatial(), plan: next });
    this._previewMode = 'edit';
  }

  private _updateSpatialElement(patch: Parameters<typeof updateSpatialElement>[2]): void {
    const plan = this._spatial().plan;
    if (!plan || !this._selectedElementId) return;
    this._commitSpatial({ ...this._spatial(), plan: updateSpatialElement(plan, this._selectedElementId, patch) });
  }

  private _duplicateSpatialElement(): void {
    const plan = this._spatial().plan;
    if (!plan || !this._selectedElementId) return;
    const next = duplicateSpatialElement(plan, this._selectedElementId);
    const added = next.elements[next.elements.length - 1];
    this._selectedElementId = added.id;
    this._selectedPrimitiveId = added.primitives[0]?.id ?? '';
    this._selectedGlbSurfaceId = added.glb?.surfaces[0]?.id ?? '';
    this._commitSpatial({ ...this._spatial(), plan: next });
  }

  private _removeSpatialElement(): void {
    const plan = this._spatial().plan;
    if (!plan || !this._selectedElementId) return;
    this._commitSpatial({ ...this._spatial(), plan: removeSpatialElement(plan, this._selectedElementId) });
    this._selectedElementId = '';
    this._selectedPrimitiveId = '';
    this._selectedGlbSurfaceId = '';
  }

  private _updateElementPrimitive(patch: Partial<SpatialElementPrimitive>): void {
    const plan = this._spatial().plan;
    const element = plan?.elements.find((candidate) => candidate.id === this._selectedElementId);
    if (!plan || !element || !this._selectedPrimitiveId) return;
    this._updateSpatialElement({
      primitives: element.primitives.map((primitive) => primitive.id === this._selectedPrimitiveId ? { ...primitive, ...patch } : primitive),
    });
  }

  private _addElementPrimitive(kind: SpatialElementPrimitive['kind']): void {
    const plan = this._spatial().plan;
    const element = plan?.elements.find((candidate) => candidate.id === this._selectedElementId);
    if (!element) return;
    let index = element.primitives.length + 1;
    while (element.primitives.some((primitive) => primitive.id === `part-${index}`)) index += 1;
    const primitive = createSpatialPrimitive(`part-${index}`, kind, { name: `Part ${index}` });
    this._selectedPrimitiveId = primitive.id;
    this._updateSpatialElement({ primitives: [...element.primitives, primitive] });
  }

  private _removeElementPrimitive(): void {
    const plan = this._spatial().plan;
    const element = plan?.elements.find((candidate) => candidate.id === this._selectedElementId);
    if (!element || !this._selectedPrimitiveId) return;
    const primitives = element.primitives.filter((primitive) => primitive.id !== this._selectedPrimitiveId);
    this._selectedPrimitiveId = primitives[0]?.id ?? '';
    this._updateSpatialElement({ primitives });
  }

  private _readFileAsDataUri(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error ?? new Error('The GLB file could not be read.'));
      reader.onload = () => typeof reader.result === 'string'
        ? resolve(reader.result)
        : reject(new Error('The GLB file could not be encoded.'));
      reader.readAsDataURL(file);
    });
  }

  private async _onGlbPicked(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    const replace = input.dataset.replace === 'true';
    input.value = '';
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.glb')) {
      this._glbStatus = { kind: 'error', message: 'Choose a binary .glb file. Linked .gltf files are not portable.' };
      return;
    }
    if (file.size > MAX_EMBEDDED_GLB_BYTES) {
      this._glbStatus = { kind: 'error', message: `Keep embedded GLB files below ${(MAX_EMBEDDED_GLB_BYTES / 1_000_000).toFixed(1)} MB so Home Assistant can save and sync the dashboard.` };
      return;
    }
    this._glbStatus = { kind: 'loading', message: `Inspecting ${file.name}…` };
    try {
      const buffer = await file.arrayBuffer();
      const [gltf, uri] = await Promise.all([
        new GLTFLoader().parseAsync(buffer, ''),
        this._readFileAsDataUri(file),
      ]);
      gltf.scene.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(gltf.scene);
      if (bounds.isEmpty()) throw new Error('The GLB contains no renderable geometry.');
      const size = bounds.getSize(new THREE.Vector3());
      const surfaces = discoverGlbSurfaces(gltf.scene).map((surface) => ({
        id: surface.id,
        name: surface.name,
        nodePath: surface.nodePath,
        materialIndex: surface.materialIndex,
        sourceMaterialKey: surface.sourceMaterialKey,
        sourceColor: surface.sourceColor,
        color: surface.color,
        luminosity: surface.luminosity,
      }));
      if (!surfaces.length) throw new Error('The GLB contains no material surfaces to map.');
      const source = {
        fileName: file.name,
        uri: `data:model/gltf-binary;base64,${uri.slice(uri.indexOf(',') + 1)}`,
        byteLength: file.size,
        size: { x: Math.max(0.001, size.x), y: Math.max(0.001, size.y), z: Math.max(0.001, size.z) },
        surfaces,
      };
      const plan = this._spatial().plan ?? emptySpatialPlan();
      const selected = plan.elements.find((element) => element.id === this._selectedElementId);
      if (replace && selected?.type === 'glb') {
        this._glbSurfaceScope = 'surface';
        this._selectedGlbSurfaceId = surfaces[0].id;
        this._updateSpatialElement({ glb: source });
      } else {
        const insertion = this._elementInsertionPoint(plan);
        const name = file.name.replace(/\.glb$/i, '').replace(/[-_]+/g, ' ').trim() || 'GLB element';
        const next = addSpatialElement(plan, 'glb', insertion.position, {
          ...(insertion.zoneId ? { zoneId: insertion.zoneId } : {}),
          name,
          glb: source,
          primitives: [],
        });
        const added = next.elements[next.elements.length - 1];
        this._selectedElementId = added.id;
        this._selectedPrimitiveId = '';
        this._glbSurfaceScope = 'surface';
        this._selectedGlbSurfaceId = surfaces[0].id;
        this._commitSpatial({ ...this._spatial(), plan: next });
      }
      this._previewMode = '3d';
      this._glbStatus = { kind: 'ready', message: `${surfaces.length} ${surfaces.length === 1 ? 'surface' : 'surfaces'} ready to map.` };
    } catch (error) {
      this._glbStatus = { kind: 'error', message: error instanceof Error ? error.message : 'The GLB could not be imported.' };
    }
  }

  private _updateGlbSurface(patch: Partial<SpatialGlbSurface>): void {
    const element = this._spatial().plan?.elements.find((candidate) => candidate.id === this._selectedElementId);
    if (!element?.glb || !this._selectedGlbSurfaceId) return;
    this._updateSpatialElement({
      glb: {
        ...element.glb,
        surfaces: element.glb.surfaces.map((surface) => surface.id === this._selectedGlbSurfaceId ? { ...surface, ...patch } : surface),
      },
    });
  }

  private _glbSurfaceTargets(element: SpatialElement, selected: SpatialGlbSurface): SpatialGlbSurface[] {
    if (!element.glb || this._glbSurfaceScope === 'surface') return [selected];
    if (this._glbSurfaceScope === 'material') {
      const key = selected.sourceMaterialKey;
      return key ? element.glb.surfaces.filter((surface) => surface.sourceMaterialKey === key) : [selected];
    }
    const color = selected.sourceColor ?? String(selected.color.base).toLowerCase();
    return element.glb.surfaces.filter((surface) => (surface.sourceColor ?? String(surface.color.base).toLowerCase()) === color);
  }

  private _updateGlbSurfaceGroup(patch: Partial<SpatialGlbSurface>): void {
    const element = this._spatial().plan?.elements.find((candidate) => candidate.id === this._selectedElementId);
    const selected = element?.glb?.surfaces.find((candidate) => candidate.id === this._selectedGlbSurfaceId);
    if (!element?.glb || !selected) return;
    const targetIds = new Set(this._glbSurfaceTargets(element, selected).map((surface) => surface.id));
    this._updateSpatialElement({
      glb: {
        ...element.glb,
        surfaces: element.glb.surfaces.map((surface) => targetIds.has(surface.id) ? { ...surface, ...patch } : surface),
      },
    });
  }

  private _applySelectedGlbMappingToScope(): void {
    const element = this._spatial().plan?.elements.find((candidate) => candidate.id === this._selectedElementId);
    const selected = element?.glb?.surfaces.find((candidate) => candidate.id === this._selectedGlbSurfaceId);
    if (!selected || this._glbSurfaceScope === 'surface') return;
    this._updateGlbSurfaceGroup({
      entityId: selected.entityId,
      color: structuredClone(selected.color),
      luminosity: structuredClone(selected.luminosity),
    });
  }

  private _updateGlbSurfaceConditional<T>(key: 'color' | 'luminosity', value: SpatialConditionalValue<T>): void {
    this._updateGlbSurfaceGroup({ [key]: value } as Partial<SpatialGlbSurface>);
  }

  private _addGlbSurfaceRule(key: 'color' | 'luminosity'): void {
    const element = this._spatial().plan?.elements.find((candidate) => candidate.id === this._selectedElementId);
    const surface = element?.glb?.surfaces.find((candidate) => candidate.id === this._selectedGlbSurfaceId);
    if (!surface) return;
    const value = surface[key] as SpatialConditionalValue<string | number>;
    this._updateGlbSurfaceConditional(key, {
      ...value,
      rules: [...value.rules, { operator: 'equals', compare: 'on', value: value.base }],
    } as SpatialConditionalValue<any>);
  }

  private _updateGlbSurfaceRule(key: 'color' | 'luminosity', index: number, patch: Record<string, unknown>): void {
    const element = this._spatial().plan?.elements.find((candidate) => candidate.id === this._selectedElementId);
    const surface = element?.glb?.surfaces.find((candidate) => candidate.id === this._selectedGlbSurfaceId);
    if (!surface) return;
    const value = surface[key] as SpatialConditionalValue<string | number>;
    this._updateGlbSurfaceConditional(key, {
      ...value,
      rules: value.rules.map((rule, ruleIndex) => ruleIndex === index ? { ...rule, ...patch } : rule),
    } as SpatialConditionalValue<any>);
  }

  private _removeGlbSurfaceRule(key: 'color' | 'luminosity', index: number): void {
    const element = this._spatial().plan?.elements.find((candidate) => candidate.id === this._selectedElementId);
    const surface = element?.glb?.surfaces.find((candidate) => candidate.id === this._selectedGlbSurfaceId);
    if (!surface) return;
    this._updateGlbSurfaceConditional(key, {
      ...surface[key],
      rules: surface[key].rules.filter((_, ruleIndex) => ruleIndex !== index),
    } as SpatialConditionalValue<any>);
  }

  private _updatePrimitiveConditional<T>(key: 'color' | 'luminosity' | 'waves', value: SpatialConditionalValue<T>): void {
    this._updateElementPrimitive({ [key]: value } as Partial<SpatialElementPrimitive>);
  }

  private _addPrimitiveRule(key: 'color' | 'luminosity' | 'waves'): void {
    const element = this._spatial().plan?.elements.find((candidate) => candidate.id === this._selectedElementId);
    const primitive = element?.primitives.find((candidate) => candidate.id === this._selectedPrimitiveId);
    if (!primitive) return;
    if (key === 'color') {
      this._updatePrimitiveConditional(key, { ...primitive.color, rules: [...primitive.color.rules, { operator: 'equals', compare: 'on', value: primitive.color.base }] });
    } else {
      const value = primitive[key];
      this._updatePrimitiveConditional(key, { ...value, rules: [...value.rules, { operator: 'equals', compare: 'on', value: value.base }] });
    }
  }

  private _updatePrimitiveRule(
    key: 'color' | 'luminosity' | 'waves',
    index: number,
    patch: Record<string, unknown>,
  ): void {
    const element = this._spatial().plan?.elements.find((candidate) => candidate.id === this._selectedElementId);
    const primitive = element?.primitives.find((candidate) => candidate.id === this._selectedPrimitiveId);
    if (!primitive) return;
    const current = primitive[key] as SpatialConditionalValue<string | number>;
    this._updatePrimitiveConditional(key, {
      ...current,
      rules: current.rules.map((rule, ruleIndex) => ruleIndex === index ? { ...rule, ...patch } : rule),
    } as SpatialConditionalValue<any>);
  }

  private _removePrimitiveRule(key: 'color' | 'luminosity' | 'waves', index: number): void {
    const element = this._spatial().plan?.elements.find((candidate) => candidate.id === this._selectedElementId);
    const primitive = element?.primitives.find((candidate) => candidate.id === this._selectedPrimitiveId);
    if (!primitive) return;
    const current = primitive[key] as SpatialConditionalValue<string | number>;
    this._updatePrimitiveConditional(key, { ...current, rules: current.rules.filter((_, ruleIndex) => ruleIndex !== index) } as SpatialConditionalValue<any>);
  }

  private _onSpatialElementSelected(ev: CustomEvent): void {
    this._selectedElementId = (ev.detail as { elementId: string }).elementId;
    const element = this._spatial().plan?.elements.find((candidate) => candidate.id === this._selectedElementId);
    this._selectedPrimitiveId = element?.primitives[0]?.id ?? '';
    this._selectedGlbSurfaceId = element?.glb?.surfaces[0]?.id ?? '';
    this._setupStep = 'elements';
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

  private _updateSelectedEntity(patch: Partial<EntityConfig>): void {
    if (!this._config.entities[this._selectedEntity]) return;
    this._commitEntities(this._config.entities.map((entity, index) => index === this._selectedEntity
      ? { ...entity, ...patch }
      : entity));
  }

  private _renderMarkerVisibilitySelect(
    label: string,
    value: MarkerVisibility,
    key: 'overviewVisibility' | 'roomVisibility',
  ) {
    const options: Array<{ value: MarkerVisibility; label: string }> = [
      { value: 'auto', label: 'Automatic (recommended)' },
      { value: 'always', label: 'Always show' },
      { value: 'active', label: 'Only while active' },
      { value: 'attention', label: 'Only when attention is needed' },
      { value: 'hidden', label: 'Never show' },
    ];
    return html`<label><span>${label}</span><select .value=${value}
      @change=${(event: Event) => this._updateSelectedEntity({
        [key]: (event.target as HTMLSelectElement).value as MarkerVisibility,
      })}>
      ${options.map((option) => html`<option value=${option.value}>${option.label}</option>`)}
    </select></label>`;
  }

  private _renderTooltipContentSelect(
    label: string,
    value: TooltipContent,
    key: 'tooltipContentInOverview' | 'tooltipContentInRoom',
  ) {
    const options: Array<{ value: TooltipContent; label: string }> = [
      { value: 'none', label: 'None' },
      { value: 'state', label: 'Name and live state' },
    ];
    return html`<label><span>${label}</span><select .value=${value}
      @change=${(event: Event) => this._updateSelectedEntity({
        [key]: (event.target as HTMLSelectElement).value as TooltipContent,
      })}>
      ${options.map((option) => html`<option value=${option.value}>${option.label}</option>`)}
    </select></label>`;
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

  private _selectUnplacedEntity(entity: EntityConfig): void {
    this._selectedEntity = this._config.entities.indexOf(entity);
    this._previewMode = 'edit';
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
            @click=${() => {
              if (step.id === 'floorplan') void this._editStructure();
              else {
                this._setupStep = step.id;
                if (step.id === 'architecture' || step.id === 'elements') this._previewMode = 'edit';
              }
            }}>
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
    if (next.id === 'floorplan') {
      void this._editStructure();
      return;
    }
    this._setupStep = next.id;
    if (next.id === 'architecture' || next.id === 'elements') this._previewMode = 'edit';
  }

  private _renderSetupFloorplan() {
    const plan = this._spatial().plan;
    const shell = this._spatial().shell;
    const surveyWallCount = shell?.walls?.reduce((count, wall) => count + Math.max(0, wall.points.length - 1), 0) ?? 0;
    const wallCount = surveyWallCount || plan?.walls.length || 0;
    const roomCount = shell?.rooms?.length || plan?.rooms.length || 0;
    const elementCount = plan?.elements.length || 0;
    const selectedShellSegment = shell ? shellSegmentById(shell, this._selectedWallId) : undefined;
    const selectedPlanWall = plan?.walls.find((wall) => wall.id === this._selectedWallId);
    return html`
      <p class="studio-intro">Build the physical home in metres. Shared corners, walls, openings, Elements, light, and every device use one coherent model.</p>
      ${plan || shell ? html`
        <div class="setup-card">
          <h3>Your structure</h3>
          <p>${wallCount} wall segment${wallCount === 1 ? '' : 's'}, ${roomCount} room${roomCount === 1 ? '' : 's'}, and ${elementCount} Element${elementCount === 1 ? '' : 's'}.</p>
          <div class="setup-actions">
            <ha-button @click=${this._editStructure}>Edit structure</ha-button>
            <ha-button @click=${() => { this._previewMode = '3d'; }}>Inspect in 3D</ha-button>
            <ha-button @click=${() => { this._setupStep = 'rooms'; }}>Continue to rooms</ha-button>
          </div>
        </div>
        ${selectedShellSegment || selectedPlanWall ? html`
          <div class="setup-card wall-editor-card">
            <div class="section-heading">
              <div><span class="section-kicker">Selected wall</span><h3>${this._wallName(this._selectedWallId)}</h3></div>
              <ha-icon icon="mdi:wall"></ha-icon>
            </div>
            <p>Drag either end in the plan to reshape this wall. Connected floors, rooms, and openings move with it.</p>
            <div class="opening-editor">
              <div class="opening-control">
                <label for="structure-wall-thickness">Thickness</label>
                <input id="structure-wall-thickness" type="number" min="0.03" max="2" step="0.01"
                  .value=${String(selectedShellSegment?.thickness ?? selectedPlanWall?.thickness ?? 0.12)}
                  @change=${(event: Event) => {
                    const thickness = Number((event.target as HTMLInputElement).value);
                    if (selectedShellSegment) this._updateShellWall(selectedShellSegment.id, { thickness });
                    else if (selectedPlanWall) this._updatePlanWall(selectedPlanWall.id, { thickness });
                  }} />
                <output>m</output>
              </div>
              ${selectedShellSegment ? html`
                <div class="opening-control">
                  <label for="structure-wall-shape">Shape</label>
                  <select id="structure-wall-shape" .value=${selectedShellSegment.wall.smooth ? 'smooth' : 'straight'}
                    @change=${(event: Event) => this._updateShellWall(selectedShellSegment.id, { smooth: (event.target as HTMLSelectElement).value === 'smooth' })}>
                    <option value="straight">Straight segments</option>
                    <option value="smooth">Smooth curve</option>
                  </select>
                  <output></output>
                </div>
              ` : html`
                <div class="opening-control">
                  <label for="structure-wall-curve">Curve</label>
                  <input id="structure-wall-curve" type="range" min="-100" max="100" step="1" .value=${String(Math.round((selectedPlanWall?.curve ?? 0) * 100))}
                    @pointerdown=${this._onPreviewEditStart} @pointerup=${this._onPreviewEditEnd}
                    @input=${(event: Event) => selectedPlanWall && this._updateWallCurve(selectedPlanWall.id, Number((event.target as HTMLInputElement).value) / 100, !this._dragStartConfig)} />
                  <output>${Math.round((selectedPlanWall?.curve ?? 0) * 100)}%</output>
                </div>
              `}
            </div>
          </div>
        ` : html`<p class="structure-hint"><ha-icon icon="mdi:cursor-default-click-outline"></ha-icon><span>Select a wall to edit its thickness and shape, or drag a corner directly in the plan.</span></p>`}
        ${this._renderNorthSetting()}
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
      <p class="studio-intro">${surveyedRooms.length} room${surveyedRooms.length === 1 ? ' is' : 's are'} ready to name and connect to Home Assistant Areas.</p>
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
        <div class="setup-actions"><ha-button @click=${this._editStructure}>Edit structure</ha-button></div>
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
          <ha-button @click=${this._editStructure}>Adjust walls</ha-button>
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
    const wallOpenings = this._selectedWallId
      ? openings.filter((opening) => opening.wallId === this._selectedWallId)
      : [];
    if (this._spatial().shell && !plan?.walls.length) return html`
      <p class="studio-intro">Select a wall to add an opening, or select a door or window to edit it.</p>
      <div class="setup-card">
        <h3>Doors &amp; windows</h3>
        <p>${surveyOpenings.length} opening${surveyOpenings.length === 1 ? '' : 's'} in your structure.</p>
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
      <div class="setup-actions"><ha-button @click=${() => { this._setupStep = 'elements'; this._previewMode = 'edit'; }}>Continue to Elements</ha-button></div>
    `;
    if (!plan?.rooms.length && !this._config.zones.length) return html`
      <p class="studio-intro">Doors and windows are attached directly to room walls.</p>
      <div class="architecture-empty">Close at least one room first.<div class="setup-actions"><ha-button @click=${this._editStructure}>Edit structure</ha-button></div></div>
    `;
    return html`
      <p class="studio-intro">Select a wall to shape it, then add doors and windows.</p>
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
        <p>Scale the model in metres so rooms, Elements, walls, shadows, and camera movement share one believable physical system.</p>
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
      <div class="setup-actions"><ha-button @click=${() => { this._setupStep = 'elements'; this._previewMode = 'edit'; }}>Continue to Elements</ha-button></div>
    `;
  }

  private _renderConditionalControl(
    primitive: SpatialElementPrimitive,
    key: 'color' | 'luminosity' | 'waves',
    label: string,
  ) {
    const value = primitive[key] as SpatialConditionalValue<string | number>;
    const isColor = key === 'color';
    return html`<div class="conditional-control">
      <div class="conditional-heading"><strong>${label}</strong><button title=${`Add conditional ${label.toLowerCase()} rule`} @click=${() => this._addPrimitiveRule(key)}><ha-icon icon="mdi:plus"></ha-icon><span>Condition</span></button></div>
      <label class="base-value"><span>Default</span>${isColor ? html`
        <input type="color" .value=${String(value.base)} @input=${(event: Event) => this._updatePrimitiveConditional(key, { ...value, base: (event.target as HTMLInputElement).value } as SpatialConditionalValue<any>)} />
        <input type="text" pattern="#[0-9a-fA-F]{6}" .value=${String(value.base)} @change=${(event: Event) => this._updatePrimitiveConditional(key, { ...value, base: (event.target as HTMLInputElement).value } as SpatialConditionalValue<any>)} />
      ` : html`<input type="range" min="0" max="1" step="0.01" .value=${String(value.base)}
        @pointerdown=${this._onPreviewEditStart} @pointerup=${this._onPreviewEditEnd}
        @input=${(event: Event) => this._updatePrimitiveConditional(key, { ...value, base: Number((event.target as HTMLInputElement).value) } as SpatialConditionalValue<any>)} /><output>${Number(value.base).toFixed(2)}</output>`}</label>
      ${value.rules.map((rule, index) => html`<div class="condition-row">
        <label><span>Entity</span><input type="text" list="ha-entity-ids" .value=${rule.entityId ?? ''} placeholder="Use element entity"
          @change=${(event: Event) => this._updatePrimitiveRule(key, index, { entityId: (event.target as HTMLInputElement).value.trim() || undefined })} /></label>
        <label><span>Attribute</span><input type="text" .value=${rule.attribute ?? ''} placeholder="State"
          @change=${(event: Event) => this._updatePrimitiveRule(key, index, { attribute: (event.target as HTMLInputElement).value.trim() || undefined })} /></label>
        <label><span>Match</span><select .value=${rule.operator} @change=${(event: Event) => this._updatePrimitiveRule(key, index, { operator: (event.target as HTMLSelectElement).value })}>
          <option value="equals">Equals</option><option value="not-equals">Does not equal</option><option value="above">Above</option><option value="below">Below</option>
        </select></label>
        <label><span>Value</span><input type="text" .value=${String(rule.compare)} @change=${(event: Event) => this._updatePrimitiveRule(key, index, { compare: (event.target as HTMLInputElement).value })} /></label>
        <label class="condition-result"><span>Result</span>${isColor ? html`<input type="color" .value=${String(rule.value)} @input=${(event: Event) => this._updatePrimitiveRule(key, index, { value: (event.target as HTMLInputElement).value })} />`
          : html`<input type="number" min="0" max="1" step="0.05" .value=${String(rule.value)} @change=${(event: Event) => this._updatePrimitiveRule(key, index, { value: Number((event.target as HTMLInputElement).value) })} />`}</label>
        <button class="condition-remove" title="Remove condition" @click=${() => this._removePrimitiveRule(key, index)}><ha-icon icon="mdi:close"></ha-icon></button>
      </div>`)}
    </div>`;
  }

  private _renderGlbSurfaceConditionalControl(
    surface: SpatialGlbSurface,
    key: 'color' | 'luminosity',
    label: string,
  ) {
    const value = surface[key] as SpatialConditionalValue<string | number>;
    const isColor = key === 'color';
    return html`<div class="conditional-control">
      <div class="conditional-heading"><strong>${label}</strong><button title=${`Add conditional ${label.toLowerCase()} rule`} @click=${() => this._addGlbSurfaceRule(key)}><ha-icon icon="mdi:plus"></ha-icon><span>Condition</span></button></div>
      <label class="base-value"><span>Default</span>${isColor ? html`
        <input type="color" .value=${String(value.base)} @input=${(event: Event) => this._updateGlbSurfaceConditional(key, { ...value, base: (event.target as HTMLInputElement).value } as SpatialConditionalValue<any>)} />
        <input type="text" pattern="#[0-9a-fA-F]{6}" .value=${String(value.base)} @change=${(event: Event) => this._updateGlbSurfaceConditional(key, { ...value, base: (event.target as HTMLInputElement).value } as SpatialConditionalValue<any>)} />
      ` : html`<input type="range" min="0" max="1" step="0.01" .value=${String(value.base)}
        @pointerdown=${this._onPreviewEditStart} @pointerup=${this._onPreviewEditEnd}
        @input=${(event: Event) => this._updateGlbSurfaceConditional(key, { ...value, base: Number((event.target as HTMLInputElement).value) } as SpatialConditionalValue<any>)} /><output>${Number(value.base).toFixed(2)}</output>`}</label>
      ${value.rules.map((rule, index) => html`<div class="condition-row">
        <label><span>Entity</span><input type="text" list="ha-entity-ids" .value=${rule.entityId ?? surface.entityId ?? ''} placeholder="Use surface entity"
          @change=${(event: Event) => this._updateGlbSurfaceRule(key, index, { entityId: (event.target as HTMLInputElement).value.trim() || undefined })} /></label>
        <label><span>Attribute</span><input type="text" .value=${rule.attribute ?? ''} placeholder="State"
          @change=${(event: Event) => this._updateGlbSurfaceRule(key, index, { attribute: (event.target as HTMLInputElement).value.trim() || undefined })} /></label>
        <label><span>Match</span><select .value=${rule.operator} @change=${(event: Event) => this._updateGlbSurfaceRule(key, index, { operator: (event.target as HTMLSelectElement).value })}>
          <option value="equals">Equals</option><option value="not-equals">Does not equal</option><option value="above">Above</option><option value="below">Below</option>
        </select></label>
        <label><span>Value</span><input type="text" .value=${String(rule.compare)} @change=${(event: Event) => this._updateGlbSurfaceRule(key, index, { compare: (event.target as HTMLInputElement).value })} /></label>
        <label class="condition-result"><span>Result</span>${isColor ? html`<input type="color" .value=${String(rule.value)} @input=${(event: Event) => this._updateGlbSurfaceRule(key, index, { value: (event.target as HTMLInputElement).value })} />`
          : html`<input type="number" min="0" max="1" step="0.05" .value=${String(rule.value)} @change=${(event: Event) => this._updateGlbSurfaceRule(key, index, { value: Number((event.target as HTMLInputElement).value) })} />`}</label>
        <button class="condition-remove" title="Remove condition" @click=${() => this._removeGlbSurfaceRule(key, index)}><ha-icon icon="mdi:close"></ha-icon></button>
      </div>`)}
    </div>`;
  }

  private _renderSetupElements() {
    const plan = this._spatial().plan ?? (this._spatial().shell ? emptySpatialPlan() : null);
    if (!plan) return nothing;
    const selected = plan.elements.find((item) => item.id === this._selectedElementId);
    const primitive = selected?.primitives.find((item) => item.id === this._selectedPrimitiveId) ?? selected?.primitives[0];
    const glbSurface = selected?.glb?.surfaces.find((item) => item.id === this._selectedGlbSurfaceId) ?? selected?.glb?.surfaces[0];
    const glbMaterialCount = selected?.glb && glbSurface?.sourceMaterialKey
      ? selected.glb.surfaces.filter((surface) => surface.sourceMaterialKey === glbSurface.sourceMaterialKey).length
      : 1;
    const glbColorCount = selected?.glb && glbSurface
      ? selected.glb.surfaces.filter((surface) => (surface.sourceColor ?? String(surface.color.base).toLowerCase()) === (glbSurface.sourceColor ?? String(glbSurface.color.base).toLowerCase())).length
      : 1;
    const glbScopeCount = this._glbSurfaceScope === 'material' ? glbMaterialCount : this._glbSurfaceScope === 'color' ? glbColorCount : 1;
    const entityOptions = Object.values(this.hass.states ?? {}).slice().sort((left, right) => {
      const leftName = String(left.attributes?.friendly_name ?? left.entity_id);
      const rightName = String(right.attributes?.friendly_name ?? right.entity_id);
      return leftName.localeCompare(rightName);
    });
    return html`
      <datalist id="ha-entity-ids">${entityOptions.map((state) => html`<option value=${state.entity_id}>${state.attributes?.friendly_name ?? state.entity_id}</option>`)}</datalist>
      <p class="studio-intro">Everything in the home is an Element. It can stand alone or represent a Home Assistant entity, and custom Elements can be built from editable solid primitives.</p>
      <div class="setup-card">
        <h3>Add an Element</h3>
        <div class="element-kinds">
          <button @click=${() => this._addSpatialElement('ceiling-light')}><ha-icon icon="mdi:ceiling-light"></ha-icon><span><strong>Ceiling light</strong><small>State beacon with practical light</small></span></button>
          <button @click=${() => this._addSpatialElement('light-bulb')}><ha-icon icon="mdi:lightbulb-outline"></ha-icon><span><strong>Light bulb</strong><small>State beacon with practical light</small></span></button>
          <button @click=${() => this._addSpatialElement('custom')}><ha-icon icon="mdi:shape-plus"></ha-icon><span><strong>Custom</strong><small>Build from solid primitives</small></span></button>
          <label class="element-upload"><ha-icon icon="mdi:cube-scan"></ha-icon><span><strong>GLB sourced</strong><small>Import and map model surfaces</small></span><input type="file" accept=".glb,model/gltf-binary" hidden @change=${this._onGlbPicked} /></label>
        </div>
        <p class="glb-note">GLB files up to 2.5 MB are embedded in the dashboard, so they travel with backups and work on every device.</p>
        ${this._glbStatus ? html`<div class=${`glb-status ${this._glbStatus.kind}`}><ha-icon icon=${this._glbStatus.kind === 'loading' ? 'mdi:progress-clock' : this._glbStatus.kind === 'ready' ? 'mdi:check-circle-outline' : 'mdi:alert-circle-outline'}></ha-icon><span>${this._glbStatus.message}</span></div>` : nothing}
      </div>
      ${selected ? html`<div class="setup-card">
        <div class="element-title"><div><span>Selected Element</span><h3>${selected.name || 'Element'}</h3></div><span class="element-type">${selected.type.replace('-', ' ')}</span></div>
        <p>Position uses metres from the plan origin. Y is height above the finished floor.</p>
        <div class="asset-fields">
          <label><span>Name</span><input type="text" .value=${selected.name ?? ''} placeholder="Optional label"
            @change=${(event: Event) => this._updateSpatialElement({ name: (event.target as HTMLInputElement).value.trim() || undefined })} /></label>
          <label><span>Element type</span><select .value=${selected.type} @change=${(event: Event) => {
            const type = (event.target as HTMLSelectElement).value as SpatialElementType;
            const primitives = elementPrimitivesForType(type);
            this._selectedPrimitiveId = primitives[0]?.id ?? '';
            this._selectedGlbSurfaceId = '';
            this._updateSpatialElement({ type, primitives, glb: undefined });
          }}><option value="ceiling-light">Ceiling light</option><option value="light-bulb">Light bulb</option><option value="custom">Custom</option><option value="glb" disabled>GLB sourced</option></select></label>
          <label><span>Represents Home Assistant device</span><select .value=${selected.entityId ?? ''}
            @change=${(event: Event) => this._updateSpatialElement({ entityId: (event.target as HTMLSelectElement).value || undefined })}>
            <option value="">No device binding</option>
            ${entityOptions.map((state) => html`<option value=${state.entity_id}>${state.attributes?.friendly_name ?? state.entity_id} · ${state.entity_id}</option>`)}
          </select></label>
        </div>
        <div class="transform-grid">
          ${(['x', 'y', 'z'] as const).map((axis) => html`<label><span>${axis.toUpperCase()} position</span><input type="number" step="0.05" .value=${String(selected.position[axis])}
            @change=${(event: Event) => this._updateSpatialElement({ position: { ...selected.position, [axis]: Number((event.target as HTMLInputElement).value) } })} /></label>`)}
          <label><span>Rotation</span><input type="number" step="5" .value=${String(selected.rotation.y)}
            @change=${(event: Event) => this._updateSpatialElement({ rotation: { ...selected.rotation, y: Number((event.target as HTMLInputElement).value) } })} /></label>
          ${(['x', 'y', 'z'] as const).map((axis) => html`<label><span>${axis.toUpperCase()} scale</span><input type="number" min=${selected.type === 'glb' ? '0.001' : '0.05'} max="20" step=${selected.type === 'glb' ? '0.001' : '0.05'} .value=${String(selected.scale[axis])}
            @change=${(event: Event) => this._updateSpatialElement({ scale: { ...selected.scale, [axis]: Number((event.target as HTMLInputElement).value) } })} /></label>`)}
        </div>
        <div class="setup-actions">
          <ha-button @click=${() => { this._previewMode = '3d'; }}>Inspect in 3D</ha-button>
          <ha-button @click=${this._duplicateSpatialElement}>Duplicate Element</ha-button>
          <ha-button @click=${this._removeSpatialElement}>Remove Element</ha-button>
        </div>
      </div>
      ${selected.type === 'custom' ? html`<div class="setup-card primitive-builder">
        <div class="primitive-header"><div><span>Custom geometry</span><h3>Parts</h3></div><div class="primitive-add"><button title="Add cube" @click=${() => this._addElementPrimitive('cube')}><ha-icon icon="mdi:cube-outline"></ha-icon></button><button title="Add sphere" @click=${() => this._addElementPrimitive('sphere')}><ha-icon icon="mdi:sphere"></ha-icon></button><button title="Add cylinder" @click=${() => this._addElementPrimitive('cylinder')}><ha-icon icon="mdi:cylinder"></ha-icon></button></div></div>
        <div class="primitive-list">${selected.primitives.map((part) => html`<button class=${part.id === primitive?.id ? 'active' : ''} @click=${() => { this._selectedPrimitiveId = part.id; }}><ha-icon icon=${part.kind === 'cube' ? 'mdi:cube-outline' : part.kind === 'sphere' ? 'mdi:sphere' : 'mdi:cylinder'}></ha-icon><span>${part.name ?? part.id}</span></button>`)}</div>
        ${primitive ? html`<div class="primitive-editor">
          <div class="asset-fields">
            <label><span>Part name</span><input type="text" .value=${primitive.name ?? ''} @change=${(event: Event) => this._updateElementPrimitive({ name: (event.target as HTMLInputElement).value.trim() || undefined })} /></label>
            <label><span>Primitive</span><select .value=${primitive.kind} @change=${(event: Event) => this._updateElementPrimitive({ kind: (event.target as HTMLSelectElement).value as SpatialElementPrimitive['kind'] })}><option value="cube">Cube</option><option value="sphere">Sphere</option><option value="cylinder">Solid cylinder</option></select></label>
          </div>
          <div class="transform-grid primitive-transform">
            ${(['x', 'y', 'z'] as const).map((axis) => html`<label><span>${axis.toUpperCase()} size</span><input type="number" min="0.01" step="0.01" .value=${String(primitive.size[axis])} @change=${(event: Event) => this._updateElementPrimitive({ size: { ...primitive.size, [axis]: Number((event.target as HTMLInputElement).value) } })} /></label>`)}
            ${(['x', 'y', 'z'] as const).map((axis) => html`<label><span>${axis.toUpperCase()} offset</span><input type="number" step="0.01" .value=${String(primitive.position[axis])} @change=${(event: Event) => this._updateElementPrimitive({ position: { ...primitive.position, [axis]: Number((event.target as HTMLInputElement).value) } })} /></label>`)}
            ${(['x', 'y', 'z'] as const).map((axis) => html`<label><span>${axis.toUpperCase()} rotation</span><input type="number" step="1" .value=${String(primitive.rotation[axis])} @change=${(event: Event) => this._updateElementPrimitive({ rotation: { ...primitive.rotation, [axis]: Number((event.target as HTMLInputElement).value) } })} /></label>`)}
            <label><span>Edge softness</span><input type="number" min="0" max="2" step="0.01" .value=${String(primitive.bevel)} @change=${(event: Event) => this._updateElementPrimitive({ bevel: Number((event.target as HTMLInputElement).value) })} /></label>
          </div>
          ${this._renderConditionalControl(primitive, 'color', 'Color')}
          ${this._renderConditionalControl(primitive, 'luminosity', 'Luminosity')}
          ${this._renderConditionalControl(primitive, 'waves', 'Emit waves')}
          <div class="setup-actions"><ha-button @click=${this._removeElementPrimitive}>Remove part</ha-button></div>
        </div>` : html`<div class="architecture-empty">Add a primitive to build this Element.</div>`}
      </div>` : nothing}
      ${selected.type === 'glb' && selected.glb ? html`<div class="setup-card primitive-builder">
        <div class="primitive-header"><div><span>Imported geometry</span><h3>Surfaces</h3></div><span class="element-type">${selected.glb.surfaces.length} mapped</span></div>
        <div class="glb-source">
          <div><strong>${selected.glb.fileName}</strong><span>${(selected.glb.byteLength / 1_000_000).toFixed(2)} MB · ${selected.glb.size.x.toFixed(2)} × ${selected.glb.size.y.toFixed(2)} × ${selected.glb.size.z.toFixed(2)} m</span></div>
          <label class="glb-replace"><ha-icon icon="mdi:file-replace-outline"></ha-icon><span>Replace file</span><input type="file" accept=".glb,model/gltf-binary" data-replace="true" hidden @change=${this._onGlbPicked} /></label>
        </div>
        <div class="primitive-list">${selected.glb.surfaces.map((surface) => html`<button class=${surface.id === glbSurface?.id ? 'active' : ''} @click=${() => { this._selectedGlbSurfaceId = surface.id; this._glbSurfaceScope = 'surface'; }}><ha-icon icon="mdi:layers-triple-outline"></ha-icon><span>${surface.name}</span></button>`)}</div>
        ${glbSurface ? html`<div class="primitive-editor">
          <div class="asset-fields">
            <label><span>Surface name</span><input type="text" .value=${glbSurface.name} @change=${(event: Event) => this._updateGlbSurface({ name: (event.target as HTMLInputElement).value.trim() || glbSurface.name })} /></label>
            <label><span>Surface entity</span><select .value=${glbSurface.entityId ?? ''} @change=${(event: Event) => this._updateGlbSurfaceGroup({ entityId: (event.target as HTMLSelectElement).value || undefined })}>
              <option value="">Use Element entity</option>
              ${entityOptions.map((state) => html`<option value=${state.entity_id}>${state.attributes?.friendly_name ?? state.entity_id} · ${state.entity_id}</option>`)}
            </select></label>
          </div>
          <div class="surface-meta">mesh ${glbSurface.nodePath} · material ${glbSurface.materialIndex + 1}</div>
          <div class="surface-scope">
            <div class="surface-scope-switch" role="group" aria-label="Surfaces affected by edits">
              <button aria-pressed=${this._glbSurfaceScope === 'surface'} @click=${() => { this._glbSurfaceScope = 'surface'; }}>Selected</button>
              <button aria-pressed=${this._glbSurfaceScope === 'material'} ?disabled=${glbMaterialCount < 2}
                @click=${() => { this._glbSurfaceScope = 'material'; }}>Material · ${glbMaterialCount}</button>
              <button aria-pressed=${this._glbSurfaceScope === 'color'} ?disabled=${glbColorCount < 2}
                @click=${() => { this._glbSurfaceScope = 'color'; }}>Color · ${glbColorCount}</button>
            </div>
            <div class="surface-scope-header">
              <div class="surface-scope-copy">${this._glbSurfaceScope === 'surface'
                ? 'Changes affect only this mesh surface.'
                : `Changes affect all ${glbScopeCount} matching surfaces.`}</div>
              ${this._glbSurfaceScope !== 'surface' ? html`<button class="surface-apply" @click=${this._applySelectedGlbMappingToScope}>Apply selected mapping</button>` : nothing}
            </div>
          </div>
          ${this._renderGlbSurfaceConditionalControl(glbSurface, 'color', 'Surface color')}
          ${this._renderGlbSurfaceConditionalControl(glbSurface, 'luminosity', 'Light emission')}
        </div>` : html`<div class="architecture-empty">This model has no discovered material surfaces.</div>`}
      </div>` : nothing}
      ` : html`<div class="architecture-empty">Add an Element or select one on the plan to adjust it.</div>`}
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
      elementBound: Boolean(this._spatial().plan?.elements.some((element) => element.entityId === entity.entity)),
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
          ${wiring.map(({ entity, index, resolved, elementBound }) => {
            const fallback = resolved.usedGroupFallback;
            const unavailable = resolved.activity === 'unavailable';
            const stateLabel = fallback ? `Via ${resolved.sourceEntityId}` : unavailable ? 'Unavailable' : resolved.state?.state ?? 'Unknown';
            const icon = unavailable ? 'mdi:link-off' : fallback ? 'mdi:link-variant' : elementBound ? 'mdi:cube-scan' : 'mdi:map-marker-radius-outline';
            return html`<button class="wiring-row" @click=${() => { this._selectedEntity = index; this._previewMode = 'edit'; }}>
              <ha-icon icon=${icon}></ha-icon>
              <span class="wiring-copy"><strong>${entity.name ?? resolved.state?.attributes?.friendly_name ?? entity.entity}</strong><span>${elementBound ? 'Represented by an Element' : entity.zoneId ? `Placed in ${this._config.zones.find((zone) => zone.id === entity.zoneId)?.name ?? entity.zoneId}` : 'Needs a room'}</span></span>
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
          @change=${(event: Event) => this._updateSelectedEntitySpatial({ visible: (event.target as HTMLInputElement).checked })} /><span>Show this device as a marker</span></label>
        ${(selectedSpatial?.visible ?? true) ? html`<div class="marker-policy">
          <h4>Marker visibility</h4>
          <p>Automatic keeps the overview quiet: lights affect the model without adding icons, while active equipment and anything needing attention can surface.</p>
          <div class="marker-policy-grid">
            ${this._renderMarkerVisibilitySelect('Apartment overview', selected.overviewVisibility ?? 'auto', 'overviewVisibility')}
            ${this._renderMarkerVisibilitySelect('Inside its room', selected.roomVisibility ?? 'auto', 'roomVisibility')}
          </div>
        </div><div class="marker-policy tooltip-policy">
          <h4>Tooltip content</h4>
          <p>Keep markers icon-only, or show the entity name and live state persistently in each context. Media detail appears only while the player is active.</p>
          <div class="marker-policy-grid">
            ${this._renderTooltipContentSelect('Apartment overview', selected.tooltipContentInOverview ?? 'none', 'tooltipContentInOverview')}
            ${this._renderTooltipContentSelect('Inside its room', selected.tooltipContentInRoom ?? 'none', 'tooltipContentInRoom')}
          </div>
        </div>` : nothing}
        <div class="setup-actions"><ha-button @click=${() => { this._previewMode = '3d'; }}>Inspect in 3D</ha-button></div>
      </div>` : nothing}
      <div class="setup-actions"><ha-button @click=${() => { this._setupStep = 'actions'; }}>Continue to Actions</ha-button><ha-button @click=${() => { this._setupStep = 'review'; }}>Review setup</ha-button></div>
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
          ${plan ? html`<div class="health-item ready"><ha-icon icon="mdi:shape-outline"></ha-icon><span>${plan.elements.length} Element${plan.elements.length === 1 ? '' : 's'} placed.</span></div>` : nothing}
        </div>
        <div class="setup-actions">
          ${unplaced.length || !this._config.entities.length ? html`<ha-button @click=${() => { this._setupStep = 'devices'; }}>Place devices</ha-button>` : nothing}
          ${!this._config.zones.length || overlaps.length ? html`<ha-button @click=${() => { this._setupStep = 'rooms'; }}>Review rooms</ha-button>` : nothing}
          <ha-button @click=${() => { this._setupStep = 'elements'; }}>Review Elements</ha-button>
        </div>
      </div>
    `;
  }

  private _renderAdvanced() {
    return html`<div class="advanced-workspace">
      <p class="studio-intro">Portable backups for the complete card: architecture, rooms, Elements, entity bindings, lighting, and actions.</p>
      <div class="setup-card backup-card">
        <div class="backup-icon"><ha-icon icon="mdi:tray-arrow-down"></ha-icon></div>
        <div class="backup-copy"><h3>Download configuration</h3><p>Keep a human-readable YAML copy or an exact JSON copy. Both contain the same complete configuration.</p></div>
        <div class="backup-actions">
          <button @click=${() => this._downloadBackup('json')}><ha-icon icon="mdi:code-json"></ha-icon><span><strong>Download JSON</strong><small>Exact structured backup</small></span></button>
          <button @click=${() => this._downloadBackup('yaml')}><ha-icon icon="mdi:file-code-outline"></ha-icon><span><strong>Download YAML</strong><small>Easy to read and edit</small></span></button>
        </div>
      </div>
      <div class="setup-card backup-card">
        <div class="backup-icon"><ha-icon icon="mdi:backup-restore"></ha-icon></div>
        <div class="backup-copy"><h3>Restore a backup</h3><p>Choose a JSON or YAML file. It is parsed, normalized, and checked for broken geometry and invalid Elements before you can restore it.</p></div>
        <label class="backup-picker"><ha-icon icon="mdi:file-upload-outline"></ha-icon><span>Choose backup file</span><input type="file" accept=".json,.yaml,.yml,application/json,application/yaml,text/yaml" hidden @change=${this._onBackupPicked} /></label>
        ${this._backupStatus ? html`<div class="backup-status ${this._backupStatus.kind}"><ha-icon icon=${this._backupStatus.kind === 'error' ? 'mdi:alert-circle-outline' : this._backupStatus.kind === 'ready' ? 'mdi:check-decagram-outline' : 'mdi:check-circle-outline'}></ha-icon><span><strong>${this._backupStatus.kind === 'error' ? 'Backup rejected' : this._backupStatus.kind === 'ready' ? this._pendingRestoreName : 'Restore complete'}</strong>${this._backupStatus.message}</span></div>` : nothing}
        ${this._pendingRestore ? html`<button class="restore-button" @click=${this._restorePendingBackup}><ha-icon icon="mdi:restore"></ha-icon><span>Restore validated backup</span></button>` : nothing}
      </div>
    </div>`;
  }

  private _renderSetupStudio() {
    let content;
    switch (this._setupStep) {
      case 'rooms': content = this._renderSetupRooms(); break;
      case 'architecture': content = this._renderSetupArchitecture(); break;
      case 'elements': content = this._renderSetupElements(); break;
      case 'devices': content = this._renderSetupDevices(); break;
      case 'actions': content = html`<p class="studio-intro">Add the contextual commands that should be available from the spatial home.</p>${this._renderActions()}`; break;
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
        .selectedElementId=${this._selectedElementId}
        .selectedRoomId=${this._selectedRoomId}
        @spatial-plan-changed=${this._onSpatialPlanChanged}
        @spatial-shell-changed=${this._onSpatialShellChanged}
        @spatial-edit-start=${this._onPreviewEditStart}
        @spatial-edit-end=${this._onPreviewEditEnd}
        @spatial-wall-selected=${this._onPreviewWallSelected}
        @spatial-opening-selected=${this._onPreviewOpeningSelected}
        @spatial-element-selected=${this._onSpatialElementSelected}
        @spatial-room-selected=${this._onSpatialRoomSelected}
        @spatial-entity-selected=${this._onSpatialEntitySelected}
        @spatial-entity-moved=${this._onSpatialEntityMoved}
      ></spatial-plan-editor>` : html`<div class="spatial-empty-preview">
        <ha-icon icon="mdi:vector-square"></ha-icon><strong>Your 3D home starts here</strong><span>Choose a structure below to begin.</span>
      </div>`}
      </section>
      <section class="controls-panel" aria-label="Card settings">
      ${this._mode === 'setup' ? this._renderSetupStudio() : this._renderAdvanced()}
      </section>
      </div>
    `;
  }

}

declare global {
  interface HTMLElementTagNameMap {
    'apartment-view-card-editor': ApartmentViewCardEditor;
  }
}
