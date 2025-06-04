import { LitElement, html, css } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { HomeAssistant } from "custom-card-helpers";
import type { HassEntity } from "home-assistant-js-websocket";
import { ApartmentViewCardEditor } from "./ApartmentViewCardEditor";
import {
  mdiLightbulb,
  mdiCeilingLight,
  mdiFloorLamp,
  mdiWallSconce,
  mdiPowerSocket,
  mdiTelevision,
  mdiSpeaker,
  mdiChandelier,
  mdiDeskLamp,
  mdiAirConditioner,
} from "@mdi/js";

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
  columns?: number;
  rows?: number;
}

@customElement("apartment-view-card")
export class ApartmentViewCard extends LitElement {
  @property({ attribute: false }) public hass!: HomeAssistant;
  @property({ type: Object }) public config!: ApartmentViewConfig;
  @state() private _windowWidth: number = 0;
  @state() private _scale: number = 1;
  @state() private _position: { x: number; y: number } = { x: 0, y: 0 };
  @state() private _isDragging: boolean = false;
  @state() private _lastPosition: { x: number; y: number } = { x: 0, y: 0 };

  static styles = css`
    :host {
      display: block;
    }
    .wrapper {
      width: 100%;
      height: 100%;
      overflow: hidden;
      touch-action: none;
    }
    .apartment-view {
      width: 100%;
      height: 100%;
      position: relative;
    }
    .images-container {
      position: relative;
      width: 100%;
      height: 100%;
      transform-origin: 0 0;
      will-change: transform;
    }
    .base-image {
      width: 100%;
      height: 100%;
      object-fit: contain;
    }
    .light-object-container {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
    }
    .light-object-overlay-container {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
    }
    .light-object-image {
      width: 100%;
      height: 100%;
      object-fit: contain;
    }
    .color-overlay {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      mix-blend-mode: multiply;
    }
    .light-object-button-container {
      position: absolute;
      width: 0;
      height: 0;
      transform-origin: center;
    }
    ha-icon-button {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      --mdc-icon-button-size: 40px;
      --mdc-icon-size: 24px;
      color: var(--primary-text-color);
      background-color: var(--card-background-color);
      border-radius: 50%;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
      transition: all 0.3s ease;
    }
    ha-icon-button[active] {
      color: var(--text-primary-color);
      background-color: var(--primary-color);
    }
    ha-icon-button:not([disabled]):hover {
      background-color: var(--primary-color);
      color: var(--text-primary-color);
    }
    ha-icon-button[disabled] {
      color: var(--disabled-text-color);
      background-color: var(--disabled-background-color);
    }
  `;

  static getConfigElement() {
    return document.createElement("apartment-view-card-editor");
  }

  static getStubConfig() {
    return {
      type: "apartment-view-card",
      objects: [],
      allLightsImage: "/local/apartment/all-lights.png",
      dayImage: "/local/apartment/day.png",
      nightImage: "/local/apartment/night.png",
      duskdawnImage: "/local/apartment/duskdawn.png",
      columns: 2,
      rows: 2,
    };
  }

  connectedCallback() {
    super.connectedCallback();
    this._windowWidth = window.innerWidth;
    window.addEventListener("resize", this._handleResize);
    this.addEventListener("wheel", this._handleWheel);
    this.addEventListener("pointerdown", this._handlePointerDown);
    this.addEventListener("pointermove", this._handlePointerMove);
    this.addEventListener("pointerup", this._handlePointerUp);
    this.addEventListener("pointercancel", this._handlePointerUp);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("resize", this._handleResize);
    this.removeEventListener("wheel", this._handleWheel);
    this.removeEventListener("pointerdown", this._handlePointerDown);
    this.removeEventListener("pointermove", this._handlePointerMove);
    this.removeEventListener("pointerup", this._handlePointerUp);
    this.removeEventListener("pointercancel", this._handlePointerUp);
  }

  private _handleResize = () => {
    this._windowWidth = window.innerWidth;
  };

  private _handleWheel = (e: WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY;
    const scaleChange = delta > 0 ? 0.9 : 1.1;
    const newScale = Math.min(Math.max(this._scale * scaleChange, 0.5), 3);

    // Calculate the mouse position relative to the container
    const rect = this.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Calculate the new position to zoom towards the mouse
    const newX = x - (x - this._position.x) * (newScale / this._scale);
    const newY = y - (y - this._position.y) * (newScale / this._scale);

    this._scale = newScale;
    this._position = { x: newX, y: newY };
    this.requestUpdate();
  };

  private _handlePointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return; // Only handle left mouse button
    this._isDragging = true;
    this._lastPosition = { x: e.clientX, y: e.clientY };
    this.style.cursor = "grabbing";
  };

  private _handlePointerMove = (e: PointerEvent) => {
    if (!this._isDragging) return;

    const deltaX = e.clientX - this._lastPosition.x;
    const deltaY = e.clientY - this._lastPosition.y;

    this._position = {
      x: this._position.x + deltaX,
      y: this._position.y + deltaY,
    };

    this._lastPosition = { x: e.clientX, y: e.clientY };
    this.requestUpdate();
  };

  private _handlePointerUp = () => {
    this._isDragging = false;
    this.style.cursor = "grab";
  };

  private _getEntityState(entityId: string) {
    return this.hass.states[entityId];
  }

  private _calculateIntensity(entityState: any) {
    if (entityState?.attributes?.color_mode === "onoff") {
      return entityState.state === "on" ? 1 : 0;
    }

    if (!entityState?.attributes?.brightness) return 0;
    return entityState.attributes.brightness / 255;
  }

  private _calculateColor(entityState: any) {
    if (!entityState?.attributes?.rgb_color) return null;
    if (!Array.isArray(entityState.attributes.rgb_color)) return "#fffae6";

    const [red, green, blue] = entityState.attributes.rgb_color;
    if (red === undefined || green === undefined || blue === undefined)
      return "#fffae6";

    return `rgb(${red}, ${green}, ${blue})`;
  }

  private _getDayState() {
    const sun = this._getEntityState("sun.sun");
    if (!sun) return this.config.dayImage || "";

    const now = new Date();
    const sunrise = new Date(sun.attributes.next_rising);
    const sunset = new Date(sun.attributes.next_setting);
    const duskdawnOffset = 60;

    const sunriseToday = new Date(sunrise.setDate(now.getDate()));
    const sunsetToday = new Date(sunset.setDate(now.getDate()));

    if (
      new Date(sunriseToday.getTime() - duskdawnOffset * 60000) < now &&
      now < new Date(sunriseToday.getTime() + duskdawnOffset * 60000)
    ) {
      return this.config.duskdawnImage || this.config.dayImage || "";
    }

    if (
      new Date(sunsetToday.getTime() - duskdawnOffset * 60000) < now &&
      now < new Date(sunsetToday.getTime() + duskdawnOffset * 60000)
    ) {
      return this.config.duskdawnImage || this.config.dayImage || "";
    }

    if (now < sunriseToday || now > sunsetToday) {
      return this.config.nightImage || this.config.dayImage || "";
    }

    return this.config.dayImage || "";
  }

  private _getSizeInPixels(size: string) {
    const containerWidth = this.getBoundingClientRect().width;
    switch (size) {
      case "tiny":
        return containerWidth * 0.1;
      case "small":
        return containerWidth * 0.14;
      case "large":
        return containerWidth * 0.2;
      case "huge":
        return containerWidth * 0.25;
      default:
        return containerWidth * 0.2;
    }
  }

  private _getScale() {
    const containerWidth = this.getBoundingClientRect().width;
    if (containerWidth > 600) return 1;
    if (containerWidth > 420) return 0.8;
    return 0.5;
  }

  private _handleEntityClick(object: ApartmentObject) {
    if (object.disableService) return;

    this.hass.callService("homeassistant", "toggle", {
      entity_id: object.entityName,
    });
  }

  setConfig(config: ApartmentViewConfig) {
    if (!config.objects || !Array.isArray(config.objects)) {
      throw new Error("Please define objects array");
    }
    this.config = {
      type: "apartment-view-card",
      objects: config.objects.map((obj) => ({
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
  }

  render() {
    if (!this.config.allLightsImage) {
      return html`
        <ha-card>
          <div class="card-content">
            <div class="warning">
              Please configure the card by adding required images.
            </div>
          </div>
        </ha-card>
      `;
    }

    return html`
      <div class="wrapper">
        <div class="apartment-view">
          <div
            class="images-container"
            style="transform: translate(${this._position.x}px, ${this._position
              .y}px) scale(${this._scale})"
          >
            <img
              class="base-image"
              src="${this._getDayState()}"
              alt="Apartment view"
            />
            ${this.config.objects.map(
              (object) => html`
                <div
                  class="light-object-container"
                  style="mask-image: radial-gradient(circle ${this._getSizeInPixels(
                    object.size
                  )}px at ${object.offsetX}% ${object.offsetY}%, black 0%, transparent 100%);"
                >
                  <img
                    class="light-object-image"
                    src="${this.config.allLightsImage}"
                    alt="${object.customName}"
                    style="opacity: ${this._calculateIntensity(
                      this._getEntityState(object.entityName)
                    )}"
                  />
                  <div
                    class="color-overlay"
                    style="background-color: ${this._calculateColor(
                      this._getEntityState(object.entityName)
                    )}"
                  ></div>
                </div>
              `
            )}
            ${this.config.objects.map(
              (object) => html`
                <div
                  class="light-object-button-container"
                  style="left: ${object.offsetX}%; top: ${object.offsetY}%; transform: scale(${this._getScale()})"
                >
                  <ha-icon-button
                    .path="${this._getIconPath(object.customIcon)}"
                    @click="${() => this._handleEntityClick(object)}"
                    .disabled="${object.disableService}"
                    .title="${object.customName}"
                    ?active="${this._isEntityActive(object.entityName)}"
                  ></ha-icon-button>
                </div>
              `
            )}
          </div>
        </div>
      </div>
    `;
  }

  private _getIconPath(iconName?: string): string {
    if (!iconName) return mdiLightbulb;

    switch (iconName) {
      case "mdi:ceiling-light":
        return mdiCeilingLight;
      case "mdi:floor-lamp":
        return mdiFloorLamp;
      case "mdi:wall-sconce":
        return mdiWallSconce;
      case "mdi:power-socket":
        return mdiPowerSocket;
      case "mdi:television":
        return mdiTelevision;
      case "mdi:speaker":
        return mdiSpeaker;
      case "mdi:chandelier":
        return mdiChandelier;
      case "mdi:desk-lamp":
        return mdiDeskLamp;
      case "mdi:air-conditioner":
        return mdiAirConditioner;
      default:
        return mdiLightbulb;
    }
  }

  private _isEntityActive(entityName: string): boolean {
    const state = this._getEntityState(entityName);
    if (!state) return false;

    const domain = entityName.split(".")[0];

    if (domain === "light") {
      return state.state === "on";
    }
    if (domain === "media_player") {
      return state.state !== "off" && state.state !== "idle";
    }
    if (domain === "climate") {
      // Climate is active when it's not 'off' and not in 'idle' mode
      return state.state !== "off" && state.state !== "idle";
    }

    return false;
  }
}

// Register the card with Home Assistant
if (!customElements.get("apartment-view-card")) {
  customElements.define("apartment-view-card", ApartmentViewCard);
}

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

// Register the editor
if (!customElements.get("apartment-view-card-editor")) {
  customElements.define("apartment-view-card-editor", ApartmentViewCardEditor);
}
