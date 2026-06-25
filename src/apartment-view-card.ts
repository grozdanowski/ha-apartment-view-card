import { LitElement, html, css, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { HassEntity } from './core/ha-types';
import { normalizeConfig, type ApartmentViewConfig } from './core/config';
import { renderBaseLayer } from './render/base-layer';
import { renderLightLayer } from './render/light-layer';

interface MinimalHass {
  states: Record<string, HassEntity>;
  // Needed by Phase 3 dispatchTapAction (tap:toggle -> homeassistant.toggle).
  callService(domain: string, service: string, data?: any): Promise<void>;
}

@customElement('apartment-view-card')
export class ApartmentViewCard extends LitElement {
  @property({ attribute: false }) public hass?: MinimalHass;
  @property({ attribute: false }) public config!: ApartmentViewConfig;
  @state() private _cardWidth = 600;

  private _ro?: ResizeObserver;

  static styles = css`
    :host {
      display: block;
    }
    .wrapper {
      position: relative;
      width: 100%;
      overflow: hidden;
      touch-action: none;
    }
    .scene {
      position: relative;
      width: 100%;
      transform-origin: 0 0;
      will-change: transform;
    }
    .base-image {
      display: block;
      width: 100%;
      height: auto;
    }
    .warning {
      padding: 16px;
      color: var(--error-color, #db4437);
      text-align: center;
    }
  `;

  public setConfig(raw: any): void {
    this.config = normalizeConfig(raw);
  }

  public getCardSize(): number {
    return 8;
  }

  public getGridOptions(): { rows: number; columns: number; min_rows: number; min_columns: number } {
    return { rows: 8, columns: 12, min_rows: 4, min_columns: 6 };
  }

  static getConfigElement(): HTMLElement {
    return document.createElement('apartment-view-card-editor');
  }

  static getStubConfig(): Record<string, unknown> {
    return {
      type: 'custom:apartment-view-card',
      images: { base: '/local/floorplan.png' },
      entities: [],
    };
  }

  public connectedCallback(): void {
    super.connectedCallback();
    if (typeof ResizeObserver !== 'undefined') {
      this._ro = new ResizeObserver((entries) => {
        const w = entries[0]?.contentRect?.width;
        if (w && Math.abs(w - this._cardWidth) > 0.5) {
          this._cardWidth = w;
        }
      });
    }
  }

  public disconnectedCallback(): void {
    super.disconnectedCallback();
    this._ro?.disconnect();
    this._ro = undefined;
  }

  protected firstUpdated(): void {
    const wrapper = this.renderRoot.querySelector('.wrapper');
    if (wrapper) {
      const w = wrapper.getBoundingClientRect().width;
      if (w) this._cardWidth = w;
      this._ro?.observe(wrapper);
    }
  }

  /**
   * Base + light fragment, extracted so Phase 3 (gestures) and Phase 4
   * (effect layer) can call it inside the transformed scene. `cardWidth`
   * passed to renderLightLayer is always `this._cardWidth` (the scene
   * image-box width threaded everywhere — see Phase 5 `_viewport()`).
   */
  private _renderScene(): TemplateResult {
    const { images, options, entities } = this.config;
    const sun = this.hass?.states?.['sun.sun'];
    return html`${renderBaseLayer(images, options, sun)}
      ${renderLightLayer(this.hass, entities, options, images, this._cardWidth)}`;
  }

  protected render(): TemplateResult {
    if (!this.config) {
      return html`<ha-card
        ><div class="warning">Please configure the card.</div></ha-card
      >`;
    }
    return html`
      <ha-card>
        <div class="wrapper">
          <div class="scene">${this._renderScene()}</div>
        </div>
      </ha-card>
    `;
  }
}

// --- Registration ---------------------------------------------------------
if (!(window as any).customCards) {
  (window as any).customCards = [];
}
if (
  !(window as any).customCards.find(
    (c: any) => c.type === 'apartment-view-card',
  )
) {
  (window as any).customCards.push({
    type: 'apartment-view-card',
    name: 'Apartment View Card',
    description:
      'Interactive, state-aware device markers and lighting over a floorplan render.',
    preview: true,
    documentationURL:
      'https://github.com/grozdanowski/ha-apartment-view-card',
  });
}
