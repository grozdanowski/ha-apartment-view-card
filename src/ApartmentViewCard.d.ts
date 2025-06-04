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
    objects: ApartmentObject[];
    baseImage: string;
    dayImage: string;
    nightImage: string;
    duskdawnImage: string;
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
    render(): import("lit").TemplateResult<1>;
}
export {};
