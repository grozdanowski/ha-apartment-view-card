import { LitElement, html, css } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { HomeAssistant, fireEvent } from "custom-card-helpers";
import type { HassEntity } from "home-assistant-js-websocket";

interface ApartmentObject {
  offsetX: number;
  offsetY: number;
  size: "tiny" | "small" | "medium" | "large" | "huge";
  customName: string;
  entityName: string;
  disableService?: boolean;
  customIcon?: string;
}

interface ApartmentViewConfig {
  type: string;
  objects: ApartmentObject[];
  allLightsImage: string;
  dayImage: string;
  nightImage: string;
  duskdawnImage: string;
}

@customElement("apartment-view-card-editor")
export class ApartmentViewCardEditor extends LitElement {
  @property({ attribute: false }) public hass!: HomeAssistant;
  @property({ type: Object }) public config!: ApartmentViewConfig;
  @state() private _selectedObject?: ApartmentObject;
  @state() private _previewImage?: string;
  @state() private _expandedObjects: Set<number> = new Set();

  static styles = css`
    ha-form {
      width: 100%;
    }
    .preview {
      width: 100%;
      max-width: 500px;
      margin: 16px auto;
      position: relative;
    }
    .preview img {
      width: 100%;
      height: auto;
    }
    .object-marker {
      position: absolute;
      width: 20px;
      height: 20px;
      background: var(--primary-color);
      border-radius: 50%;
      transform: translate(-50%, -50%);
      cursor: pointer;
    }
    .object-marker.selected {
      background: var(--accent-color);
      box-shadow: 0 0 0 2px var(--primary-color);
    }
    .object-list {
      margin-top: 16px;
    }
    .object-item {
      display: flex;
      flex-direction: column;
      padding: 8px;
      border-bottom: 1px solid var(--divider-color);
    }
    .object-header {
      display: flex;
      align-items: center;
      cursor: pointer;
    }
    .object-header:hover {
      background: var(--divider-color);
    }
    .object-header.selected {
      background: var(--primary-color);
      color: var(--text-primary-color);
    }
    .object-content {
      padding: 8px;
      display: none;
    }
    .object-content.expanded {
      display: block;
    }
    .object-actions {
      margin-left: auto;
      display: flex;
      gap: 8px;
    }
    ha-icon-button {
      color: var(--primary-text-color);
    }
    .object-header.selected ha-icon-button {
      color: var(--text-primary-color);
    }
    .warning {
      color: var(--error-color);
      padding: 8px;
      text-align: center;
    }
  `;

  setConfig(config: ApartmentViewConfig) {
    if (!config) {
      throw new Error("Invalid configuration");
    }

    this.config = {
      type: "apartment-view-card",
      objects: (config.objects || []).map((obj) => ({
        offsetX: obj.offsetX || 50,
        offsetY: obj.offsetY || 50,
        size: obj.size || "medium",
        customName: obj.customName || "New Object",
        entityName: obj.entityName || "",
        disableService: obj.disableService || false,
        customIcon: obj.customIcon || "",
      })),
      allLightsImage: config.allLightsImage || "",
      dayImage: config.dayImage || "",
      nightImage: config.nightImage || "",
      duskdawnImage: config.duskdawnImage || "",
    };

    this.requestUpdate();
  }

  protected render() {
    if (!this.hass) {
      return html``;
    }

    return html`
      <div class="card-config">
        <div class="warning" style="text-align: center; padding: 16px;">
          The visual editor is currently under development. Please use the "Show
          Code Editor" option to configure the card.
          <br /><br />
          <ha-button @click=${() => this._showCodeEditor()}
            >Show Code Editor</ha-button
          >
        </div>
      </div>
    `;
  }

  private _showCodeEditor() {
    const event = new CustomEvent("show-code-editor");
    this.dispatchEvent(event);
  }

  private _handleConfigChanged(ev: CustomEvent) {
    const config = { ...this.config, ...ev.detail.value };
    fireEvent(this, "config-changed", { config });
  }

  private _handleObjectConfigChanged(ev: CustomEvent, obj: ApartmentObject) {
    const newObj = { ...obj, ...ev.detail.value };
    const objects = this.config.objects.map((o) => (o === obj ? newObj : o));
    const config = { ...this.config, objects };
    fireEvent(this, "config-changed", { config });
  }

  private _handleImageClick(ev: MouseEvent) {
    if (!this._selectedObject) return;

    const rect = (ev.target as HTMLElement).getBoundingClientRect();
    const x = ((ev.clientX - rect.left) / rect.width) * 100;
    const y = ((ev.clientY - rect.top) / rect.height) * 100;

    const objects = this.config.objects.map((obj) =>
      obj === this._selectedObject ? { ...obj, offsetX: x, offsetY: y } : obj
    );

    const config = { ...this.config, objects };
    fireEvent(this, "config-changed", { config });
  }

  private _handleObjectClick(ev: MouseEvent, obj: ApartmentObject) {
    ev.stopPropagation();
    this._selectObject(obj);
  }

  private _selectObject(obj: ApartmentObject) {
    this._selectedObject = obj;
  }

  private _toggleObject(index: number) {
    if (this._expandedObjects.has(index)) {
      this._expandedObjects.delete(index);
    } else {
      this._expandedObjects.add(index);
    }
    this.requestUpdate();
  }

  private _deleteObject(ev: MouseEvent, obj: ApartmentObject) {
    ev.stopPropagation();
    const objects = this.config.objects.filter((o) => o !== obj);
    const config = { ...this.config, objects };
    fireEvent(this, "config-changed", { config });
  }

  private _addObject() {
    const newObject: ApartmentObject = {
      offsetX: 50,
      offsetY: 50,
      size: "medium",
      customName: "New Object",
      entityName: "",
      disableService: false,
      customIcon: "",
    };

    const objects = [...(this.config.objects || []), newObject];
    const config = { ...this.config, objects };
    fireEvent(this, "config-changed", { config });
    this._selectedObject = newObject;
    this._expandedObjects.add(objects.length - 1);
  }
}

// Register the editor with Home Assistant
if (!customElements.get("apartment-view-card-editor")) {
  customElements.define("apartment-view-card-editor", ApartmentViewCardEditor);
}

// Add the editor to the customCards array
if (!(window as any).customCards) {
  (window as any).customCards = [];
}

// Check if the card is already registered
const existingCard = (window as any).customCards.find(
  (card: any) => card.type === "apartment-view-card"
);

if (!existingCard) {
  (window as any).customCards.push({
    type: "apartment-view-card",
    name: "Apartment View Card",
    description:
      "A card that shows your apartment layout with interactive lights",
    preview: true,
    documentationURL: "https://github.com/grozdanowski/ha-apartment-view-card",
  });
}
