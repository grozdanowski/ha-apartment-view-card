import { LitElement, css, html, nothing, type PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { HomeAssistant } from 'custom-card-helpers';
import type { NestedLovelaceCardConfig } from '../core/config';

interface CardHelpers {
  createCardElement(config: NestedLovelaceCardConfig): HTMLElement & {
    getConfigElement?: () => HTMLElement | Promise<HTMLElement | null> | null;
  };
}

declare global {
  interface Window {
    loadCardHelpers?: () => Promise<CardHelpers>;
  }
}

@customElement('studio-nested-card-editor')
export class StudioNestedCardEditor extends LitElement {
  @property({ attribute: false }) public hass!: HomeAssistant;
  @property({ attribute: false }) public config!: NestedLovelaceCardConfig;
  @state() private _status: 'loading' | 'ready' | 'fallback' = 'loading';
  private _loadToken = 0;

  static styles = css`
    :host { display: block; }
    .native-editor { min-height: 8px; }
    .status { color: var(--secondary-text-color); font-size: 12px; line-height: 1.45; }
    .status strong { color: var(--primary-text-color); font-weight: 620; }
  `;

  protected updated(changed: PropertyValues<this>): void {
    if (changed.has('config') || changed.has('hass')) void this._loadNativeEditor();
  }

  private async _loadNativeEditor(): Promise<void> {
    const token = ++this._loadToken;
    this._status = 'loading';
    await this.updateComplete;
    const mount = this.renderRoot.querySelector('.native-editor');
    if (!mount || !this.config || !window.loadCardHelpers) {
      this._status = 'fallback';
      return;
    }
    try {
      const helpers = await window.loadCardHelpers();
      const card = helpers.createCardElement(this.config);
      const editor = await card.getConfigElement?.();
      if (token !== this._loadToken || !editor) {
        this._status = 'fallback';
        return;
      }
      (editor as HTMLElement & { hass?: HomeAssistant }).hass = this.hass;
      const setConfig = (editor as HTMLElement & { setConfig?: (config: NestedLovelaceCardConfig) => void }).setConfig;
      setConfig?.(this.config);
      editor.addEventListener('config-changed', (event: Event) => {
        const detail = (event as CustomEvent<{ config?: NestedLovelaceCardConfig }>).detail;
        if (!detail?.config) return;
        this.dispatchEvent(new CustomEvent('config-changed', {
          detail: { config: detail.config },
          bubbles: true,
          composed: true,
        }));
      });
      mount.replaceChildren(editor);
      this._status = 'ready';
    } catch {
      this._status = 'fallback';
    }
  }

  protected render() {
    return html`
      ${this._status === 'loading' ? html`<p class="status">Opening Home Assistant’s native card editor…</p>` : nothing}
      ${this._status === 'fallback' ? html`<p class="status"><strong>This card has no visual editor.</strong> Use Advanced card configuration below for its complete options.</p>` : nothing}
      <div class="native-editor" aria-live="polite"></div>
    `;
  }
}
