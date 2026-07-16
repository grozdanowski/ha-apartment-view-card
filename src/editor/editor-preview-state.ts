export const ELEMENT_INSPECTOR_EVENT = 'apartment-view-card-element-inspector';

let selectedElementId: string | null = null;

export function editorPreviewElementId(): string | null {
  return selectedElementId;
}

export function publishEditorPreviewElement(elementId: string | null): void {
  selectedElementId = elementId || null;
  window.dispatchEvent(new CustomEvent(ELEMENT_INSPECTOR_EVENT, {
    detail: { elementId: selectedElementId },
  }));
}
