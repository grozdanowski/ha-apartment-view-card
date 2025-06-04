# Apartment View Card

> ⚠️ **Work in Progress**: This card is currently under development and does not work with HACS yet. For now, please use the manual installation method described below.

A custom Lovelace card for Home Assistant that provides an interactive apartment visualization. Control lights, media players, and climate devices directly from a visual map of your home.

## Features

- Interactive apartment layout with clickable objects
- Supports lights, media players, and climate devices
- Day, night, and dusk/dawn background images
- Pan and zoom functionality
- Responsive design

## Installation

### HACS (Recommended)

1. Go to HACS > Frontend > Custom repositories.
2. Add this repository: `https://github.com/grozdanowski/ha-apartment-view-card`
3. Install the card from HACS.
4. Refresh your browser.

### Manual

1. Download `apartment-view-card.js` from the latest release.
2. Place it in your Home Assistant `config/www/` directory.
3. Add the following to your Lovelace resources:
   ```yaml
   - url: /local/apartment-view-card.js
     type: module
   ```
4. Refresh your browser.

## Configuration

Add the card to your dashboard and use YAML mode. Example:

```yaml
type: custom:apartment-view-card
baseImage: /local/apartment/base.png
dayImage: /local/apartment/day.png
nightImage: /local/apartment/night.png
duskdawnImage: /local/apartment/duskdawn.png
objects:
  - offsetX: 25
    offsetY: 30
    size: medium
    customName: Living Room Light
    entityName: light.living_room
    customIcon: mdi:ceiling-light
  - offsetX: 75
    offsetY: 40
    size: small
    customName: Kitchen Light
    entityName: light.kitchen
    disableService: false
```

- Upload your images to `/config/www/apartment/` and reference them as `/local/apartment/...`
- Supported object sizes: `tiny`, `small`, `medium`, `large`, `huge`
- Supported domains: `light`, `media_player`, `climate`

## License

MIT
