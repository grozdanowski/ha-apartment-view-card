// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HomeAssistant, LovelaceCard } from 'custom-card-helpers';
import {
  LOVELACE_CARD_HOST_TAG,
  type LovelaceCardHost,
} from '../src/runtime/lovelace-card-host';

class TestCard extends HTMLElement {
  public hass?: HomeAssistant;
  public getCardSize(): number {
    return 3;
  }
  public setConfig(): void {}
}

if (!customElements.get('test-lovelace-card')) {
  customElements.define('test-lovelace-card', TestCard);
}

const testCard = (): LovelaceCard =>
  document.createElement('test-lovelace-card') as LovelaceCard;

function hostWith(config: {
  type: string;
  [key: string]: unknown;
}): LovelaceCardHost {
  const host = document.createElement(
    LOVELACE_CARD_HOST_TAG,
  ) as LovelaceCardHost;
  host.config = config;
  document.body.append(host);
  return host;
}

beforeEach(() => {
  document.body.replaceChildren();
  delete window.loadCardHelpers;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('LovelaceCardHost', () => {
  it('creates a nested card with Home Assistant helpers and assigns hass', async () => {
    const card = testCard();
    const createCardElement = vi.fn(() => card);
    window.loadCardHelpers = vi.fn().mockResolvedValue({ createCardElement });
    const hass = { states: {} } as HomeAssistant;
    const config = { type: 'entities', entities: ['light.kitchen'] };

    const host = document.createElement(
      LOVELACE_CARD_HOST_TAG,
    ) as LovelaceCardHost;
    host.config = config;
    host.hass = hass;
    document.body.append(host);

    await vi.waitFor(() => expect(host.cardElement).toBe(card));
    expect(window.loadCardHelpers).toHaveBeenCalledTimes(1);
    expect(createCardElement).toHaveBeenCalledWith(config);
    expect(card.hass).toBe(hass);
    expect(host.shadowRoot?.querySelector('.mount')?.firstChild).toBe(card);
    expect(host.getCardSize()).toBe(3);
  });

  it('applies a semantic presentation tone without changing the native card config', async () => {
    const card = testCard();
    const createCardElement = vi.fn(() => card);
    window.loadCardHelpers = vi.fn().mockResolvedValue({ createCardElement });
    const host = hostWith({ type: 'tile', entity: 'media_player.naim' });

    await vi.waitFor(() => expect(host.cardElement).toBe(card));
    expect(host.dataset.cardType).toBe('tile');
    expect(host.dataset.tone).toBe('media');
    expect(createCardElement).toHaveBeenCalledWith({ type: 'tile', entity: 'media_player.naim' });
  });

  it('reuses cards for equivalent configs and propagates later hass updates', async () => {
    const cards: LovelaceCard[] = [];
    const createCardElement = vi.fn(() => {
      const card = testCard();
      cards.push(card);
      return card;
    });
    window.loadCardHelpers = vi.fn().mockResolvedValue({ createCardElement });
    const host = hostWith({ type: 'markdown', content: 'Status' });

    await vi.waitFor(() => expect(host.cardElement).toBe(cards[0]));
    host.config = { content: 'Status', type: 'markdown' };
    await vi.waitFor(() => expect(host.cardElement).toBe(cards[0]));
    expect(createCardElement).toHaveBeenCalledTimes(1);

    const hass = { states: { 'sensor.test': {} } } as unknown as HomeAssistant;
    host.hass = hass;
    expect(cards[0].hass).toBe(hass);

    host.config = { type: 'markdown', content: 'Different' };
    await vi.waitFor(() => expect(host.cardElement).toBe(cards[1]));
    expect(createCardElement).toHaveBeenCalledTimes(2);

    host.config = { type: 'markdown', content: 'Status' };
    await vi.waitFor(() => expect(host.cardElement).toBe(cards[0]));
    expect(createCardElement).toHaveBeenCalledTimes(2);
    expect(cards[0].hass).toBe(hass);
  });

  it('contains helper failures in a local alert and reports an error event', async () => {
    const failure = new Error('custom card failed');
    window.loadCardHelpers = vi.fn().mockRejectedValue(failure);
    const host = document.createElement(
      LOVELACE_CARD_HOST_TAG,
    ) as LovelaceCardHost;
    const errors: Error[] = [];
    host.addEventListener('lovelace-card-error', (event) => {
      errors.push((event as CustomEvent<{ error: Error }>).detail.error);
    });
    host.config = { type: 'custom:broken-card' };
    document.body.append(host);

    await vi.waitFor(() => {
      expect(
        host.shadowRoot?.querySelector('[role="alert"]')?.textContent,
      ).toContain('custom card failed');
    });
    expect(host.cardElement).toBeUndefined();
    expect(errors).toEqual([failure]);
  });

  it('makes preview cards inert and suppresses nested actions', async () => {
    const card = testCard();
    window.loadCardHelpers = vi.fn().mockResolvedValue({
      createCardElement: () => card,
    });
    const callService = vi.fn();
    const host = hostWith({ type: 'button', entity: 'light.kitchen' });
    host.hass = { states: {}, callService } as unknown as HomeAssistant;
    await vi.waitFor(() => expect(host.cardElement).toBe(card));
    const received = vi.fn();
    document.body.addEventListener('action', received);

    host.preview = true;
    const blocked = card.dispatchEvent(
      new CustomEvent('action', {
        bubbles: true,
        composed: true,
        cancelable: true,
      }),
    );
    expect(blocked).toBe(false);
    expect(received).not.toHaveBeenCalled();
    expect(host.inert).toBe(true);
    expect(host.getAttribute('aria-disabled')).toBe('');
    await (card.hass as HomeAssistant).callService('light', 'turn_on', { entity_id: 'light.kitchen' });
    expect(callService).not.toHaveBeenCalled();

    host.preview = false;
    card.dispatchEvent(
      new CustomEvent('action', { bubbles: true, composed: true }),
    );
    expect(received).toHaveBeenCalledTimes(1);
    expect(host.inert).toBe(false);
    expect(host.hasAttribute('aria-disabled')).toBe(false);
  });
});
