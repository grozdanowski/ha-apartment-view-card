import { LitElement } from "lit";
import { HomeAssistant } from "custom-card-helpers";
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
export declare class ApartmentViewCard extends LitElement {
    hass: HomeAssistant;
    config: ApartmentViewConfig;
    private _windowWidth;
    private _scale;
    private _position;
    private _isDragging;
    private _lastPosition;
    static styles: import("lit").CSSResult;
    static getConfigElement(): HTMLElement;
    static getStubConfig(): {
        type: string;
        objects: never[];
        allLightsImage: string;
        dayImage: string;
        nightImage: string;
        duskdawnImage: string;
        columns: number;
        rows: number;
    };
    connectedCallback(): void;
    disconnectedCallback(): void;
    private _handleResize;
    private _handleWheel;
    private _handlePointerDown;
    private _handlePointerMove;
    private _handlePointerUp;
    private _getEntityState;
    private _calculateIntensity;
    private _calculateColor;
    private _getDayState;
    private _getSizeInPixels;
    private _getScale;
    private _handleEntityClick;
    setConfig(config: ApartmentViewConfig): void;
    render(): import("lit").TemplateResult<1>;
    private _getIconPath;
    private _isEntityActive;
}
export {};
