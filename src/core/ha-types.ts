// Minimal local HA entity shape — avoids coupling to custom-card-helpers internals.
export interface HassEntity {
  entity_id: string;
  state: string;
  attributes: Record<string, any>;
  last_changed?: string;
  last_updated?: string;
}

/**
 * The slice of Home Assistant's `hass` object this card actually consumes.
 * A real HA `HomeAssistant` is structurally assignable to this, so the card
 * accepts the live object directly — no cast needed. Modules that only read
 * states accept `Pick<HassLike, 'states'>`.
 */
export interface HassLike {
  states: Record<string, HassEntity>;
  callService(
    domain: string,
    service: string,
    data?: Record<string, unknown>,
  ): Promise<void>;
}
