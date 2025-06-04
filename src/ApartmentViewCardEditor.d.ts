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
}
export declare class ApartmentViewCardEditor extends LitElement {
    hass: HomeAssistant;
    config: ApartmentViewConfig;
    private _selectedObject?;
    private _previewImage?;
    private _expandedObjects;
    static styles: import("lit").CSSResult;
    setConfig(config: ApartmentViewConfig): void;
    protected render(): import("lit").TemplateResult<1>;
    private _showCodeEditor;
    private _handleConfigChanged;
    private _handleObjectConfigChanged;
    private _handleImageClick;
    private _handleObjectClick;
    private _selectObject;
    private _toggleObject;
    private _deleteObject;
    private _addObject;
}
export {};
