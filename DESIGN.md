# Apartment View Card Design System

## Intent

An immersive architectural control surface for Home Assistant. The 3D home floats directly in the dashboard, while typography and controls remain quiet, precise, and task-focused. The visual register is Scandinavian industrial design with refined Metro-style hierarchy.

## Color

- Canvas: `#080b0d`
- Raised surface: `#101518`
- Quiet surface: `#151b1e`
- Primary text: `#f1f4f4`
- Secondary text: `#a7b0b3`
- Muted text: `#727d81`
- Hairline: `rgba(197, 214, 218, 0.16)`
- Active accent: `#9fd8df`
- Warning: `#d8b06a`
- Error: `#e18478`
- Success: `#8ec7a1`

Use the accent only for current selection, focus, and live state. Do not use decorative gradients or colored background washes. Surfaces may carry a subtle monochrome noise pass.

## Typography

Use the Home Assistant/system sans stack. The greeting is bold and editorial; all controls use compact product typography with zero letter spacing. Use fixed sizes, never viewport-scaled text.

- Greeting: 32px mobile, 38px landscape; weight 700; line-height 1.12
- Subtitle: 17px; weight 400; line-height 1.4; maximum 65 characters per line
- Section heading: 22px; weight 650; line-height 1.2
- Control title: 15px; weight 600
- Metadata: 13px; weight 450; color secondary
- Label: 12px; weight 600

## Layout

### Mobile

- The card owns one viewport: `100dvh` with safe-area handling.
- Intro flows first, followed by a borderless 3D stage and a horizontally scrollable room selector.
- Once controls scroll, the intro leaves and the 3D stage becomes sticky at approximately `25vh`; the selector remains attached.
- Content uses 16px horizontal gutters and 24-32px section spacing.
- End content padding is `calc(100px + env(safe-area-inset-bottom))` by default.

### Landscape

- Two-column viewport shell.
- Left spatial column: greeting, subtitle, 3D stage, room selector.
- Right column: independently scrollable overview or room content.
- Default split is 45/55 on tablet and 48/52 on desktop, configurable.

## Components

### Spatial Stage

No card background, outline, or decorative frame. The canvas must preserve the whole model, maintain stable camera framing, and expose only a compact Back control in room state.

### Room Selector

Text navigation in a horizontal rail. Active room uses text contrast and a 2px accent underline. In room state, Back appears on the canvas, not duplicated in the rail.

### Content Blocks

Ordered blocks may be headings, narrative actions, spatial entity controls, conditions, spacers, and native/custom Lovelace cards. First-party controls use square-to-soft geometry with a maximum 8px radius. Nested cards keep their own visual identity.

### Element List

Elements appear as compact rows with name, type, room, bound entity, state, Edit, and overflow actions. Editing opens a large dedicated modal with an isolated 3D preview; mobile uses a full-screen sheet.

## Motion

- Room focus: 850-950ms architectural camera arc into a canonical isometric view.
- Return: reverse spatial transition, slightly faster than entry.
- Idle orbit: slow 360-degree rotation in overview and room states.
- User orbit or zoom stops automation immediately and holds for 10 seconds before a smooth canonical reset.
- Layout and control transitions: 180-320ms with `cubic-bezier(0.22, 1, 0.36, 1)`.
- Reduced motion: no orbit, no decorative camera arc, direct transition under 200ms.

## Rendering

Use solid-color materials with subtle post-process noise. Prefer adaptive antialiasing and bounded device pixel ratio over brute-force quality. Mobile/WebKit must preserve a strict practical-light and shadow budget, recover from context loss, and show a local error state instead of a blank canvas.

## States

Every interactive control supports default, hover, focus-visible, active, disabled, and loading states. Content blocks support empty and local error states. Entity effects remain in the 3D scene even when their marker is hidden. Marker visibility, size, and tooltip content are independently configurable for overview and room contexts.
