// Entry module. The full orchestrator LitElement is implemented in Phase 2.
// Phase 1 only needs a valid build input and the global custom-cards registration.
export const CARD_TYPE = 'apartment-view-card';

if (!(window as any).customCards) {
  (window as any).customCards = [];
}
if (
  !(window as any).customCards.find(
    (card: any) => card.type === CARD_TYPE,
  )
) {
  (window as any).customCards.push({
    type: CARD_TYPE,
    name: 'Apartment View Card',
    description:
      'Interactive, state-aware device markers and procedural lighting on a floorplan render.',
    preview: true,
    documentationURL:
      'https://github.com/grozdanowski/ha-apartment-view-card',
  });
}
