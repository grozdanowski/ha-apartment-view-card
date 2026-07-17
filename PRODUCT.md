# Product

## Register

product

## Platform

web

## Users

Apartment View Card serves Home Assistant households who want a spatial, state-aware control surface rather than a grid of disconnected cards. The primary user is operating a real home from a phone, often one-handed and in motion. Tablet and desktop users need the same model to become a calm, information-rich command surface without losing spatial context.

## Product Purpose

Turn a Home Assistant dashboard into an immersive, trustworthy model of the home. The card should make room state legible at a glance, make controls easy to reach without accidental device actions, and let advanced users build the underlying architecture, elements, content, and responsive experience without editing brittle YAML.

Success means the card can be the sole card in a full-screen Home Assistant panel, feels excellent on mobile first, adapts naturally to landscape screens, preserves native Lovelace capability, and remains reliable on constrained mobile WebGL implementations.

## Positioning

The spatial Home Assistant surface that combines a live 3D home, contextual room controls, and a complete visual editor in one portable card.

## Brand Personality

Calm, precise, and quietly premium. The experience takes cues from Scandinavian industrial design, Volvo and Polestar interfaces, and the clarity of Metro typography without copying their visual chrome. It should feel architectural and considered, not theatrical.

## Anti-references

Avoid generic card grids, glossy smart-home skeuomorphism, decorative gradients, glass panels, oversized rounded pills, saturated purple or blue themes, texture-heavy 3D materials, dense marker clutter, and editor flows that push selected settings far below the object being edited. Never trade clarity for novelty.

## Design Principles

1. **The home is the navigation.** Rooms, devices, state, and controls share one spatial model.
2. **Context before control.** Show what matters for the current overview or room, then expose explicit actions with no accidental service calls.
3. **Mobile is the primary surface.** Every hierarchy, gesture, transition, and editor flow must work comfortably on a phone before scaling outward.
4. **Native capability, coherent presentation.** Nested Lovelace cards remain real Home Assistant cards while spatial controls provide a consistent first-party vocabulary.
5. **Motion explains space.** Camera movement communicates overview, room focus, and return; it yields immediately to the user and respects reduced-motion preferences.

## Accessibility & Inclusion

Keyboard navigation, semantic controls, readable contrast, touch targets of at least 44 pixels, and visible focus for keyboard users are required. Reduced-motion users receive short direct camera transitions with no idle orbit. State must never depend on color alone, and dynamic or unavailable content must be announced and fail locally rather than blanking the card.
