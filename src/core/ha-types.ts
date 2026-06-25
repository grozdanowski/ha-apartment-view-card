// Minimal local HA entity shape — avoids coupling to custom-card-helpers internals.
export interface HassEntity {
  entity_id: string;
  state: string;
  attributes: Record<string, any>;
  last_changed?: string;
  last_updated?: string;
}
