import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { handleActionConfig, type ActionConfig, type HomeAssistant } from 'custom-card-helpers';
import type { ActionContentBlock, ConditionContentBlock, ContentBlock, EntityConfig, SpatialControlsContentBlock } from '../core/config';
import type { HassLike } from '../core/ha-types';
import { iconForEntity } from '../core/entity-state';
import { spatialEntityPresentation } from '../core/spatial-state';
import './lovelace-card-host';

@customElement('av-immersive-content')
export class ImmersiveContent extends LitElement {
  @property({ attribute: false }) public hass?: HassLike;
  @property({ attribute: false }) public blocks: ContentBlock[] = [];
  @property({ attribute: false }) public entities: EntityConfig[] = [];
  @property({ type: Boolean }) public preview = false;

  static styles = css`
    :host {
      display: block;
      min-width: 0;
      color: var(--primary-text-color, #f1f4f4);
    }
    .stack { display: grid; gap: 24px; min-width: 0; }
    .heading { display: grid; gap: 6px; }
    .heading h2 {
      margin: 0;
      font-size: 22px;
      font-weight: 650;
      line-height: 1.2;
      letter-spacing: 0;
    }
    .heading p,
    .empty,
    .unknown {
      margin: 0;
      color: var(--secondary-text-color, #a7b0b3);
      font-size: 14px;
      line-height: 1.45;
    }
    .controls { display: grid; gap: 8px; }
    .entity,
    .action {
      box-sizing: border-box;
      display: grid;
      grid-template-columns: 40px minmax(0, 1fr) auto;
      align-items: center;
      width: 100%;
      min-height: 64px;
      gap: 12px;
      padding: 10px 12px;
      border: 1px solid color-mix(in srgb, var(--primary-text-color, #f1f4f4) 14%, transparent);
      border-radius: 6px;
      color: inherit;
      background: color-mix(in srgb, var(--primary-text-color, #f1f4f4) 4%, transparent);
      font: inherit;
      text-align: left;
      cursor: pointer;
      transition: border-color 180ms cubic-bezier(0.22, 1, 0.36, 1), background 180ms cubic-bezier(0.22, 1, 0.36, 1), transform 100ms ease-out;
    }
    .entity:hover,
    .action:hover { border-color: color-mix(in srgb, var(--primary-text-color, #f1f4f4) 28%, transparent); }
    .entity:active,
    .action:active { transform: scale(0.99); }
    .entity:focus-visible,
    .action:focus-visible { outline: 2px solid var(--spatial-accent, #9fd8df); outline-offset: 2px; }
    .entity[disabled],
    .action[disabled] { cursor: default; opacity: 0.58; }
    .icon {
      display: grid;
      width: 40px;
      height: 40px;
      place-items: center;
      border-radius: 50%;
      color: var(--spatial-accent, #9fd8df);
      background: color-mix(in srgb, var(--spatial-accent, #9fd8df) 11%, transparent);
    }
    .icon ha-icon { --mdc-icon-size: 20px; }
    .copy { display: grid; min-width: 0; gap: 3px; }
    .copy strong { overflow: hidden; font-size: 15px; font-weight: 620; text-overflow: ellipsis; white-space: nowrap; }
    .copy span { overflow: hidden; color: var(--secondary-text-color, #a7b0b3); font-size: 13px; line-height: 1.3; text-overflow: ellipsis; white-space: nowrap; }
    .chevron { color: var(--secondary-text-color, #727d81); --mdc-icon-size: 18px; }
    .empty,
    .unknown { padding: 14px 0; }
    @media (prefers-reduced-motion: reduce) {
      .entity,
      .action { transition: none; }
    }
  `;

  private _conditionMet(condition: Record<string, unknown>): boolean {
    if (!this.hass) return false;
    const kind = typeof condition.condition === 'string' ? condition.condition : '';
    if (kind === 'and' || kind === 'or') {
      const children = Array.isArray(condition.conditions)
        ? condition.conditions.filter((child): child is Record<string, unknown> => Boolean(child && typeof child === 'object' && !Array.isArray(child)))
        : [];
      return kind === 'and'
        ? children.every((child) => this._conditionMet(child))
        : children.some((child) => this._conditionMet(child));
    }
    if (kind === 'user') {
      const users = Array.isArray(condition.users) ? condition.users.filter((user): user is string => typeof user === 'string') : [];
      return Boolean(this.hass.user?.id && users.includes(this.hass.user.id));
    }
    if (kind === 'screen') {
      const query = typeof condition.media_query === 'string' ? condition.media_query : '';
      return Boolean(query && typeof window.matchMedia === 'function' && window.matchMedia(query).matches);
    }
    const entityId = typeof condition.entity === 'string' ? condition.entity : '';
    if (!entityId) return false;
    const state = this.hass.states[entityId];
    if (!state) return false;
    const expected = Array.isArray(condition.state) ? condition.state : [condition.state];
    const rejected = Array.isArray(condition.state_not) ? condition.state_not : [condition.state_not];
    if (expected.some((value) => typeof value === 'string') && !expected.includes(state.state)) return false;
    if (rejected.includes(state.state)) return false;
    const numeric = Number(state.state);
    if (condition.above !== undefined && !(numeric > Number(condition.above))) return false;
    if (condition.below !== undefined && !(numeric < Number(condition.below))) return false;
    return true;
  }

  private _showEntity(entityId: string): void {
    if (this.preview) return;
    this.dispatchEvent(new CustomEvent('hass-more-info', {
      detail: { entityId },
      bubbles: true,
      composed: true,
    }));
  }

  private _runAction(event: Event, block: Extract<ContentBlock, { type: 'action' }>): void {
    if (this.preview || !this.hass) return;
    const action = block.action as unknown as ActionConfig & { entity?: string };
    handleActionConfig(
      event.currentTarget as HTMLElement,
      this.hass as HomeAssistant,
      { entity: typeof action.entity === 'string' ? action.entity : undefined },
      action,
    );
  }

  private _renderEntity(entityId: string): TemplateResult {
    const config = this.entities.find((entity) => entity.entity === entityId);
    const state = this.hass?.states[entityId];
    const presentation = spatialEntityPresentation(
      entityId,
      state,
      config?.name,
      this.hass?.formatEntityState,
    );
    const fallback = state ?? { entity_id: entityId, state: 'unavailable', attributes: {} };
    const iconConfig = config ?? {
      entity: entityId,
      x: 50,
      y: 50,
      size: 'medium' as const,
      tap: 'more-info' as const,
      orientation: null,
    };
    return html`<button class="entity" type="button" ?disabled=${this.preview}
      aria-label=${`${presentation.name}: ${presentation.status}`}
      @click=${() => this._showEntity(entityId)}>
      <span class="icon"><ha-icon icon=${iconForEntity(fallback, iconConfig)}></ha-icon></span>
      <span class="copy"><strong>${presentation.name}</strong><span>${presentation.status}</span></span>
      <ha-icon class="chevron" icon="mdi:chevron-right"></ha-icon>
    </button>`;
  }

  private _renderBlock(block: ContentBlock): TemplateResult | typeof nothing {
    switch (block.type) {
      case 'heading':
        return html`<header class="heading"><h2>${block.title}</h2>${block.subtitle ? html`<p>${block.subtitle}</p>` : nothing}</header>`;
      case 'spatial-controls':
        return (block as SpatialControlsContentBlock).entities.length
          ? html`<div class="controls">${(block as SpatialControlsContentBlock).entities.map((entity: string) => this._renderEntity(entity))}</div>`
          : html`<p class="empty">No controls are configured for this view.</p>`;
      case 'action':
        return html`<button class="action" type="button" ?disabled=${this.preview}
          @click=${(event: Event) => this._runAction(event, block as ActionContentBlock)}>
          <span class="icon"><ha-icon icon=${block.icon ?? 'mdi:arrow-right'}></ha-icon></span>
          <span class="copy"><strong>${block.title}</strong>${block.subtitle ? html`<span>${block.subtitle}</span>` : nothing}</span>
          <ha-icon class="chevron" icon="mdi:chevron-right"></ha-icon>
        </button>`;
      case 'lovelace-card':
        return html`<av-lovelace-card-host .config=${block.card} .hass=${this.hass as HomeAssistant | undefined} .preview=${this.preview}></av-lovelace-card-host>`;
      case 'condition':
        return (block as ConditionContentBlock).conditions.every((condition: Record<string, unknown>) => this._conditionMet(condition))
          ? html`${(block as ConditionContentBlock).blocks.map((child: ContentBlock) => this._renderBlock(child))}`
          : nothing;
      case 'spacer':
        return html`<div aria-hidden="true" style=${`height:${block.size}px`}></div>`;
      default:
        return html`<p class="unknown">This content block is not supported by the installed card version.</p>`;
    }
  }

  protected render(): TemplateResult {
    return html`<div class="stack">${this.blocks.map((block) => this._renderBlock(block))}</div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'av-immersive-content': ImmersiveContent;
  }
}
