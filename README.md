# Apartment View Card

A spatial, state-aware 3D home for Home Assistant. Draw the apartment once in metres, place rooms, openings, furniture, and entities in the same model, then navigate the real home instead of a grid of cards.

## What It Does

- Builds architecture from shared vertices and physical walls.
- Detects enclosed rooms automatically, including rooms divided by a shared wall.
- Adds doors and windows directly to a wall with real width, height, sill, hinge, and swing data.
- Supports straight and curved walls, per-wall thickness, and full-height walls.
- Places built-in furniture or custom GLB/GLTF models in three-dimensional space.
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

The visual editor is the recommended configuration surface.

1. **Structure**: start with a measured rectangle or draw walls from scratch. Drag shared corners to adjust the plan.
2. **Rooms**: every enclosed wall face becomes a room. Give it a name or connect it to a Home Assistant Area.
3. **Openings**: select a wall, then add and size doors or windows. Set the apartment's north direction.
4. **Furniture**: add built-in objects, drag them into place, then adjust X/Y/Z, rotation, and scale.
5. **Devices**: import entities from linked Areas. The editor suggests an appropriate floor, wall, ceiling, surface, or free mount.
6. **Review**: validate architecture, room links, object placement, and entity placement before daily use.

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
    objects:
      - id: sofa-1
        kind: sofa
        zoneId: living-room
        position: { x: 3, y: 0, z: 3.5 }
        rotation: { x: 0, y: 180, z: 0 }
        scale: { x: 1, y: 1, z: 1 }
```

### Coordinates

- X and Z are horizontal metres in plan space.
- Y is height above finished floor level in metres.
- Rotations are degrees.
- Wall `curve` is signed from `-1` to `1`; `0` is straight.
- Opening `position` is the normalized centre point along its parent wall.
- Object scale is relative to the built-in object or normalized custom model.

### Furniture And Models

The editor ships with an original Scandinavian catalog sized in real metres. It includes Fjord sofas, the Holm lounge chair, Aska tables and benches, Linea dining chairs, Sund beds, Natt bedside tables, low media storage, Form and Havn cabinets, the Arc floor lamp, a Studio TV, the Holme kitchen island, a Fjord bath, the Sten vanity, Ull rugs, and greenery. Each design offers a restrained set of material finishes.

Saved objects keep a stable `assetId` and `finishId`, so a home looks the same after editing, exporting, and importing:

```yaml
- id: sofa-1
  kind: sofa
  assetId: fjord-sofa-3
  finishId: mist
  zoneId: living-room
  position: { x: 3, y: 0, z: 3.5 }
  rotation: { x: 0, y: 180, z: 0 }
  scale: { x: 1, y: 1, z: 1 }
```

Set `modelUrl` on a spatial object to use a custom `.glb` or `.gltf` asset:

```yaml
- id: lounge-chair
  kind: custom
  name: Lounge chair
  modelUrl: /local/models/lounge-chair.glb
  position: { x: 4.2, y: 0, z: 3.1 }
  rotation: { x: 0, y: 35, z: 0 }
  scale: { x: 0.9, y: 0.9, z: 0.9 }
```

The loader normalizes the model's longest axis to one metre before applying object scale. Use models you are licensed to redistribute and host them locally when possible.

### Surveyed Architecture

For imported or professionally measured homes, `spatial.shell` stores the finished floor polygons, centerline wall runs, wall thickness, room polygons, and measured doors and windows directly. The runtime and editor use this exact shell instead of trying to infer architecture from rendered mesh faces. Surveyed walls are intentionally locked in the visual editor; furniture and devices remain fully editable.

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

Version 3 keeps parsing the previous `images`, percentage `zones`, and percentage entity positions so existing dashboards do not fail during migration. Those fields are not required once `spatial.plan` or `spatial.shell` exists.

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
