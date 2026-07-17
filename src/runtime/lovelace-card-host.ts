import type {
  HomeAssistant,
  LovelaceCard,
  LovelaceCardConfig,
} from 'custom-card-helpers';
import type { NestedLovelaceCardConfig } from '../core/config';

export const LOVELACE_CARD_HOST_TAG = 'av-lovelace-card-host';

interface LovelaceCardHelpers {
  createCardElement(config: LovelaceCardConfig): LovelaceCard;
}

declare global {
  interface Window {
    loadCardHelpers?: () => Promise<LovelaceCardHelpers>;
  }

  interface HTMLElementTagNameMap {
    'av-lovelace-card-host': LovelaceCardHost;
  }
}

function serializableConfig(
  value: unknown,
  seen = new WeakSet<object>(),
): unknown {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (Array.isArray(value))
    return value.map((item) => serializableConfig(item, seen));
  if (typeof value !== 'object') {
    throw new Error(
      'Nested card config must contain only serializable values.',
    );
  }
  if (seen.has(value))
    throw new Error('Nested card config cannot be circular.');

  seen.add(value);
  const normalized = Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, serializableConfig(item, seen)]),
  );
  seen.delete(value);
  return normalized;
}

/**
 * Error-bounded Home Assistant card factory. Each host caches card instances by
 * structural config so ordinary `hass` updates never rebuild nested cards.
 */
export class LovelaceCardHost extends HTMLElement {
  private static readonly MAX_CACHED_CARDS = 4;
  private readonly _mount: HTMLDivElement;
  private readonly _cardCache = new Map<string, Promise<LovelaceCard>>();
  private _cardConfig?: NestedLovelaceCardConfig;
  private _hass?: HomeAssistant;
  private _preview = false;
  private _activeCard?: LovelaceCard;
  private _renderRevision = 0;

  public constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = `
      :host { display: block; min-width: 0; }
      .mount { min-width: 0; }
      :host([data-preview]) .mount { pointer-events: none; user-select: none; }
      .error {
        box-sizing: border-box;
        padding: 12px;
        border: 1px solid var(--error-color, #db4437);
        border-radius: 6px;
        color: var(--error-color, #db4437);
        background: var(--card-background-color, transparent);
        font: 500 13px/1.4 var(--paper-font-body1_-_font-family, sans-serif);
      }
    `;
    this._mount = document.createElement('div');
    this._mount.className = 'mount';
    root.append(style, this._mount);

    for (const eventName of [
      'click',
      'dblclick',
      'contextmenu',
      'pointerdown',
      'pointerup',
      'touchstart',
      'touchend',
      'keydown',
      'keyup',
      'action',
      'hass-more-info',
      'll-custom',
    ]) {
      this.addEventListener(eventName, this._blockPreviewAction, true);
    }
  }

  public connectedCallback(): void {
    void this._renderCard();
  }

  public disconnectedCallback(): void {
    this._renderRevision += 1;
  }

  public get config(): NestedLovelaceCardConfig | undefined {
    return this._cardConfig;
  }

  public set config(value: NestedLovelaceCardConfig | undefined) {
    this._cardConfig = value;
    if (this.isConnected) void this._renderCard();
  }

  /** Lovelace-style setter for callers that do not bind element properties. */
  public setConfig(config: NestedLovelaceCardConfig): void {
    this.config = config;
  }

  public get hass(): HomeAssistant | undefined {
    return this._hass;
  }

  public set hass(value: HomeAssistant | undefined) {
    this._hass = value;
    if (this._activeCard) this._activeCard.hass = this._hassForCard();
  }

  public get preview(): boolean {
    return this._preview;
  }

  public set preview(value: boolean) {
    this._preview = Boolean(value);
    this.toggleAttribute('data-preview', this._preview);
    this.toggleAttribute('aria-disabled', this._preview);
    this.inert = this._preview;
    this._mount.inert = this._preview;
    if (this._activeCard) this._activeCard.hass = this._hassForCard();
  }

  /** The live nested card, exposed for sizing and runtime coordination. */
  public get cardElement(): LovelaceCard | undefined {
    return this._activeCard;
  }

  public getCardSize(): number | Promise<number> {
    return this._activeCard?.getCardSize?.() ?? 1;
  }

  private readonly _blockPreviewAction = (event: Event): void => {
    if (!this._preview) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  private _hassForCard(): HomeAssistant | undefined {
    if (!this._hass || !this._preview) return this._hass;
    const blocked = () => Promise.resolve(undefined);
    return new Proxy(this._hass, {
      get(target, property, receiver) {
        if (property === 'callService' || property === 'callWS' || property === 'sendWS') return blocked;
        return Reflect.get(target, property, receiver);
      },
    });
  }

  private _rememberCard(key: string, card: Promise<LovelaceCard>): void {
    this._cardCache.delete(key);
    this._cardCache.set(key, card);
    while (this._cardCache.size > LovelaceCardHost.MAX_CACHED_CARDS) {
      const oldest = this._cardCache.keys().next().value as string | undefined;
      if (!oldest) break;
      const evicted = this._cardCache.get(oldest);
      this._cardCache.delete(oldest);
      void evicted?.then((staleCard) => { staleCard.hass = undefined; }).catch(() => undefined);
    }
  }

  private async _createCard(
    config: NestedLovelaceCardConfig,
  ): Promise<LovelaceCard> {
    if (typeof window.loadCardHelpers !== 'function') {
      throw new Error('Home Assistant card helpers are unavailable.');
    }
    const helpers = await window.loadCardHelpers();
    if (!helpers || typeof helpers.createCardElement !== 'function') {
      throw new Error('Home Assistant card factory is unavailable.');
    }
    const card = helpers.createCardElement(config as LovelaceCardConfig);
    if (!(card instanceof HTMLElement)) {
      throw new Error('Home Assistant did not create a valid card element.');
    }
    return card;
  }

  private async _renderCard(): Promise<void> {
    const revision = ++this._renderRevision;
    const config = this._cardConfig;
    if (!config) {
      this._activeCard = undefined;
      this._mount.replaceChildren();
      return;
    }

    try {
      const key = JSON.stringify(serializableConfig(config));
      let pendingCard = this._cardCache.get(key);
      if (!pendingCard) {
        pendingCard = this._createCard(config);
        this._rememberCard(key, pendingCard);
        void pendingCard.catch(() => {
          if (this._cardCache.get(key) === pendingCard) {
            this._cardCache.delete(key);
          }
        });
      } else this._rememberCard(key, pendingCard);

      const card = await pendingCard;
      if (revision !== this._renderRevision || !this.isConnected) return;
      card.hass = this._hassForCard();
      this._activeCard = card;
      if (this._mount.firstChild !== card) this._mount.replaceChildren(card);
    } catch (cause) {
      if (revision !== this._renderRevision || !this.isConnected) return;
      this._activeCard = undefined;
      const error = cause instanceof Error ? cause : new Error(String(cause));
      const message = document.createElement('div');
      message.className = 'error';
      message.setAttribute('role', 'alert');
      message.textContent = `Nested card unavailable: ${error.message}`;
      this._mount.replaceChildren(message);
      this.dispatchEvent(
        new CustomEvent('lovelace-card-error', {
          bubbles: true,
          composed: true,
          detail: { error, config },
        }),
      );
    }
  }
}

if (
  typeof customElements !== 'undefined' &&
  !customElements.get(LOVELACE_CARD_HOST_TAG)
) {
  customElements.define(LOVELACE_CARD_HOST_TAG, LovelaceCardHost);
}
