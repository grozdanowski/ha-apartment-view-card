# Apartment View Card

A spatial, state-aware 3D home for Home Assistant. Draw the apartment once in metres, place rooms, openings, Elements, and entities in the same model, then navigate the real home instead of a grid of cards.

## What It Does

- Builds architecture from shared vertices and physical walls.
- Detects enclosed rooms automatically, including rooms divided by a shared wall.
- Adds doors and windows directly to a wall with real width, height, sill, hinge, and swing data.
- Supports straight and curved walls, per-wall thickness, and full-height walls.
- Builds reusable Elements from solid primitives or imported GLB geometry in three-dimensional space.
- Places Home Assistant entities on floors, walls, ceilings, surfaces, or freely in space.
- Uses Home Assistant Areas to suggest and organize devices.
- Renders live entity state, contextual room summaries, sunlight direction, and room camera transitions.
- Opens Home Assistant's native details dialog when an entity is selected. It does not execute a service from a model tap.
- Supports a card setting to lower overview walls. Room focus automatically lowers walls to 10% and hides doors and windows.
- Keeps the previous image renderer available only for legacy configuration migration.

## Installation

### HACS

1. In HACS, open **Custom repositories**.
2. Add `https://github.com/grozdanowski/ha-apartment-view-card` as a **Dashboard** repository.
3. Install **Apartment View Card**.
4. Refresh the browser after HACS registers the resource.

Minimum Home Assistant: **2024.3.0**.

### Manual

1. Copy `dist/apartment-view-card.js` to `/config/www/apartment-view-card.js`.
2. Add `/local/apartment-view-card.js` as a JavaScript module under **Settings > Dashboards > Resources**.
3. Add `custom:apartment-view-card` to a dashboard.

## Setup

The visual editor is the recommended configuration surface. Version 4 adds dedicated **Experience** and **Content** workspaces alongside the architectural setup.

1. **Structure**: start with a dimensioned rectangle or draw walls from scratch. Drag shared corners to adjust the plan.
2. **Rooms**: every enclosed wall face becomes a room. Give it a name or connect it to a Home Assistant Area.
3. **Openings**: select a wall, then add and size doors or windows. Set the apartment's north direction.
4. **Elements**: build objects from primitives or GLB geometry, drag them into place, then adjust X/Y/Z, rotation, scale, materials, luminosity, and state effects.
5. **Devices**: import entities from linked Areas. The editor suggests an appropriate floor, wall, ceiling, surface, or free mount.
6. **Review**: validate architecture, room links, object placement, and entity placement before daily use.

Plan view stays focused on the active setup step: walls are always visible, while Structure shows wall points, Rooms shows floor points, Openings shows doors and windows, Elements shows Elements, and Devices shows entity markers. Rooms can be derived from enclosed walls or drawn as independent floor zones with **Draw room zone**; no walls are required. Dragging updates the Plan locally and commits once on release, so the 3D preview and Lovelace config do not rebuild during every pointer movement. With a selected point, opening, Element, or device, arrow keys move it by **1 cm**; hold **Shift** for 10 cm or **Option/Alt** for 1 mm.

Elements are shown as a compact inventory. **Edit** opens a large transactional workspace with an isolated 3D preview; **Apply** commits the draft and **Cancel** restores the saved Element. On phones this workspace becomes full-screen.

## Immersive Experience

The spatial card can fill its dashboard surface without escaping normal dashboard flow.

- On phones, the configurable greeting and supporting paragraphs lead into the 3D home. The card remains an ordinary scrollable dashboard surface, including in dashboard edit mode.
- In landscape, the greeting, 3D home, and room navigation stay in the left column while contextual controls scroll independently on the right.
- Selecting a room animates to a canonical architectural view. A single **Back** control appears inside the canvas, and the room's content replaces the overview content.
- Camera motion pauses immediately when the user orbits or zooms, then returns to the canonical pose and slow orbit after the configured idle period.
- The final content inset is configurable and defaults to 100 px so floating dashboard navigation never covers the last control.

Greeting templates support `{{ user.name }}`, `{{ timeOfDay }}`, `{{ room }}`, and `{{ states('sensor.example') }}`. Wrap short informational fragments in `**double asterisks**` for emphasis and separate paragraphs with a blank line.

```yaml
experience:
  intro:
    title: "**Good evening, {{ user.name }}.**"
    subtitle: |-
      The apartment is settled. **Two lights are on.**

      No rain is expected tonight.
  mobile:
    expandedHeight: 480
    bottomInset: 100
  landscape:
    spatialRatio: 0.46
  motion:
    resetSeconds: 10
    transitionMs: 900
    orbitSeconds: 90
  quality: auto
```

## Contextual Content

Overview and room content are ordered independently in the **Content** workspace. A sequence can contain headings, state-aware spatial controls, explicit Home Assistant actions, conditions, spacers, and complete nested Lovelace cards.

```yaml
content:
  overview:
    - type: heading
      title: At a glance
      subtitle: The controls you use most, kept close.
    - type: spatial-controls
      entities:
        - light.living_room
        - media_player.naim
    - type: lovelace-card
      card:
        type: weather-forecast
        entity: weather.home
  rooms:
    living-room:
      - type: heading
        title: Living Room
      - type: lovelace-card
        card:
          type: media-control
          entity: media_player.naim
```

Nested cards are created with Home Assistant's own card helpers and receive live `hass` updates. In the visual editor, choose a card type through the searchable card picker, fill in the common fields, and open **Advanced card configuration** only when that card needs specialist options. In every editor preview they are inert and receive a service-blocking Home Assistant facade, so editing cannot activate a device.

The editor is preview-only. It does not call Home Assistant services.

## Spatial Model

The generated YAML is intentionally explicit and portable:

```yaml
type: custom:apartment-view-card
modelVersion: 6
zones:
  - id: living-room
    name: Living Room
    areaId: living_room
    x: 0
    y: 0
    width: 68
    height: 100
entities:
  - entity: light.living_room
    name: Living room light
    zoneId: living-room
    x: 34
    y: 50
    size: medium
    tap: more-info
    orientation: null
    spatial:
      mount: ceiling
      parentId: room-1
      visible: true
      position: { x: 2.7, y: 2.48, z: 2.5 }
      rotation: { x: 0, y: 0, z: 0 }
spatial:
  dimensions:
    width: 8
    aspectRatio: 1.6
    wallHeight: 2.7
  site:
    north: 18
  openings:
    - id: window-1
      kind: window
      wallId: wall-1
      position: 0.5
      width: 0.3
      widthMeters: 1.8
      height: 1.2
      bottom: 0.9
  walls: []
  plan:
    version: 1
    vertices:
      - { id: vertex-1, x: 0, z: 0 }
      - { id: vertex-2, x: 8, z: 0 }
      - { id: vertex-3, x: 8, z: 5 }
      - { id: vertex-4, x: 0, z: 5 }
    walls:
      - { id: wall-1, start: vertex-1, end: vertex-2, thickness: 0.18, curve: 0 }
      - { id: wall-2, start: vertex-2, end: vertex-3, thickness: 0.18, curve: 0 }
      - { id: wall-3, start: vertex-3, end: vertex-4, thickness: 0.18, curve: 0 }
      - { id: wall-4, start: vertex-4, end: vertex-1, thickness: 0.18, curve: 0 }
    rooms:
      - id: room-1
        zoneId: living-room
        floorFinish: wood
        boundary:
          - { wallId: wall-1, reversed: false }
          - { wallId: wall-2, reversed: false }
          - { wallId: wall-3, reversed: false }
          - { wallId: wall-4, reversed: false }
    elements:
      - id: pendant
        type: ceiling-light
        zoneId: living-room
        entityId: light.living_room_pendant
        position: { x: 3, y: 2.5, z: 3.5 }
        rotation: { x: 0, y: 0, z: 0 }
        scale: { x: 1, y: 1, z: 1 }
        primitives: []
```

### Coordinates

- X and Z are horizontal metres in plan space.
- Y is height above finished floor level in metres.
- Rotations are degrees.
- Wall `curve` is signed from `-1` to `1`; `0` is straight.
- Opening `position` is the normalized centre point along its parent wall.
- Element scale is applied to its complete compound geometry.

### Elements

Everything placed in the 3D home is an Element. Ceiling lights and light bulbs use the same floating state beacon while casting their live Home Assistant brightness and color into the model. Custom Elements are assembled from editable cubes, spheres, and solid cylinders.

Each primitive has independent position, rotation, size, color, edge softness, luminosity, and waves. Color, luminosity, and waves can react to a bound Home Assistant entity or explicit entity-state rules:

```yaml
- id: media-console
  type: custom
  name: Media console
  zoneId: living-room
  position: { x: 3, y: 0, z: 3.5 }
  rotation: { x: 0, y: 180, z: 0 }
  scale: { x: 1, y: 1, z: 1 }
  primitives:
    - id: body
      kind: cube
      position: { x: 0, y: 0.25, z: 0 }
      rotation: { x: 0, y: 0, z: 0 }
      size: { x: 1.8, y: 0.5, z: 0.45 }
      bevel: 0.04
      color: { base: "#59605f", rules: [] }
      luminosity: { base: 0, rules: [] }
      waves: { base: 0, rules: [] }
```

### Imported Architecture

For surveyed or professionally dimensioned homes, `spatial.shell` stores finished floor polygons, centerline wall runs, wall thickness, room polygons, doors, and windows directly. The runtime and editor use this exact shell instead of trying to infer architecture from rendered mesh faces. Walls, doors, and windows remain editable while the floor and room geometry stays coherent.

The shell is portable and contains no dependency on the original SketchUp or GLB file.

## Runtime Interaction

- Tap a room name or its floor to move the camera into that room.
- Room focus keeps the full apartment present while lowering every wall to 10% height and hiding all openings.
- Tap **Overview** or the circular back control to return.
- Enable **Lower walls in apartment overview** in the card settings to keep the global overview cutaway active.
- Orbit and zoom the scene directly. Reduced-motion preferences shorten camera transitions.
- Tap an entity marker or a bound object to open Home Assistant's native details dialog.

Entity taps in the 3D runtime are intentionally detail-first. Automations and service calls remain explicit Home Assistant actions rather than accidental model gestures.

## Live State

The model reads entity state from Home Assistant:

- active devices receive stronger visual emphasis;
- active lights and playing media appear in the apartment or room summary;
- unavailable entities are called out in the summary;
- media titles are used when the player exposes `media_title`;
- sun position uses Home Assistant's configured location unless the spatial site overrides latitude or longitude.

## Legacy Migration

Version 4 keeps parsing the previous `images`, percentage `zones`, and percentage entity positions so existing dashboards do not fail during migration. Those fields are not required once `spatial.plan` or `spatial.shell` exists.

- New cards start with a generated 3D shell and require no image.
- A config without `spatial.plan` or `spatial.shell` remains a legacy image config and still requires `images.base`.
- Legacy image controls are available in **Advanced** while migrating.
- Unknown top-level keys and existing entity behavior are preserved by normalization.

Keep a backup of the old card YAML before replacing the dashboard resource.

## Development

```bash
npm install
npm run dev
npm run typecheck
npm run lint
npm test
npm run build
```

Useful local QA pages:

- `/3d-editor.html` - full visual setup flow
- `/spatial-plan-editor.html` - architectural wall editor
- `/spatial-plan.html` - saved-plan renderer
- `/3d-runtime.html` - production card with mock Home Assistant state

The production bundle is written to `dist/apartment-view-card.js`.

## License

MIT
