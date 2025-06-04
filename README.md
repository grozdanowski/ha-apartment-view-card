# Apartment View Card

> ⚠️ **Work in Progress**: This card is currently under active development. Some features may not work as expected, and the configuration interface is still being improved. Please report any issues you encounter.

A Home Assistant card that shows your apartment layout with interactive lights. The card displays different images based on the time of day and allows you to control your lights by clicking on their positions in the layout.

![Desktop View](screenshots/01.png)
![Mobile View](screenshots/02.png)

## Time of Day Behavior

The card automatically switches between different views based on the time of day to create a realistic representation of your apartment:

- **Day View**: Shows your apartment in natural daylight, typically from sunrise until late afternoon
- **Dusk/Dawn View**: Displays a warm, ambient lighting during sunrise and sunset hours
- **Night View**: Shows your apartment in darkness, typically from late evening until early morning

The transitions between these views are smooth and automatic, creating a natural flow throughout the day. The card uses Home Assistant's sun position to determine the appropriate view, ensuring accurate representation of your local daylight conditions.

## Current Status

- ✅ Basic functionality works
- ✅ Day/night image switching
- ✅ Light control through clicking
- 🚧 Visual editor is under development
- 🚧 Some features may be unstable
- 🚧 Configuration requires manual YAML editing

## Installation

1. Download the `apartment-view-card.js` file
2. Copy the file to your Home Assistant's `/config/www/` directory
3. Add the card to your configuration:

Example of adding to `configuration.yaml`:

```yaml
frontend:
  themes: !include_dir_merge_named themes
  extra_module_url:
    - /hacsfiles/lovelace-card-mod/card-mod.js
    - /local/apartment-view-card.js
```

## Creating the Required Images

The easiest way to create the required images is using [Sweet Home 3D](http://www.sweethome3d.com/), a free interior design application. Here's how to create each image:

1. Download and install [Sweet Home 3D](http://www.sweethome3d.com/)
2. Create your apartment layout:
   - Draw the walls and rooms
   - Add furniture and fixtures
   - Place lights where you want them to be interactive
3. Create the required images:
   - `all-lights.png`: Set all lights to maximum brightness
   - `day.png`: Set lights to off and use daylight settings
   - `night.png`: Set lights to off and use night settings
   - `duskdawn.png`: Set lights to off and use sunset/sunrise settings
4. Export each view as a PNG image
5. Upload the images to your Home Assistant's `/config/www/` directory

Tips for creating good images:

- Use the same camera angle for all images
- Keep the resolution consistent
- Make sure the lighting is clearly visible
- Test the images in Home Assistant to ensure they work well together

## Configuration

### Required Images

You need to prepare and upload the following images to your Home Assistant's `/config/www/` directory:

- `all-lights.png` - Image showing all lights on
- `day.png` - Image showing the apartment during the day
- `night.png` - Image showing the apartment at night
- `duskdawn.png` - Image showing the apartment during sunrise/sunset

### Example Configuration

```yaml
type: custom:apartment-view-card
allLightsImage: /local/all-lights.png
dayImage: /local/day.png
nightImage: /local/night.png
duskdawnImage: /local/duskdawn.png
objects:
  - offsetX: 52
    offsetY: 72
    size: small
    customName: Bedroom ceiling
    entityName: light.bar_1
    customIcon: mdi:ceiling-light
  - offsetX: 53
    offsetY: 82
    size: small
    customName: Bedroom ceiling
    entityName: light.sank_viseca_2
    customIcon: mdi:ceiling-light
  - offsetX: 75
    offsetY: 52
    size: small
    customName: Living Room Meblo
    entityName: light.meblo_1
    customIcon: mdi:floor-lamp
  - offsetX: 80
    offsetY: 52
    size: small
    customName: Living Room Meblo
    entityName: light.meblo_2
    customIcon: mdi:floor-lamp
  - offsetX: 68
    offsetY: 85
    size: medium
    customName: Living Room aside couch
    entityName: light.wash_right
    customIcon: mdi:light-bulb
  - offsetX: 76
    offsetY: 84
    size: medium
    customName: Living Room aside couch 2
    entityName: light.hue_color_lamp_1
    customIcon: mdi:light-bulb
  - offsetX: 83
    offsetY: 82
    size: tiny
    customName: Living Room Tree
    entityName: light.bedroom_smart_plug
    customIcon: mdi:lightbulb-outline
  - offsetX: 90
    offsetY: 60
    size: medium
    customName: Living Room TV
    entityName: media_player.philips_tv
    customIcon: mdi:television
  - offsetX: 86
    offsetY: 66
    size: medium
    customName: Naim Mu-So
    entityName: media_player.naim_mu_so_2
    customIcon: mdi:speaker
  - offsetX: 34
    offsetY: 18
    size: tiny
    customName: Study room under desk
    entityName: light.home_office_floor_light
    customIcon: mdi:lightbulb-outline
  - offsetX: 47
    offsetY: 16
    size: medium
    customName: Naim Mu-So
    entityName: media_player.kef
    customIcon: mdi:speaker
  - offsetX: 54
    offsetY: 46
    size: small
    customName: Living Room A/C
    entityName: climate.living_room_a_c
    customIcon: mdi:air-conditioner
    disableService: true
view_layout:
  position: main
grid_options:
  rows: 8
  columns: 18
```

### Configuration Options

- `allLightsImage`: Path to the image showing all lights on
- `dayImage`: Path to the image showing the apartment during the day
- `nightImage`: Path to the image showing the apartment at night
- `duskdawnImage`: Path to the image showing the apartment during sunrise/sunset
- `objects`: Array of light objects with the following properties:
  - `offsetX`: X position as percentage (0-100)
  - `offsetY`: Y position as percentage (0-100)
  - `size`: Size of the light marker (tiny, small, medium, large, huge)
  - `customName`: Display name for the light
  - `entityName`: Home Assistant entity ID
  - `customIcon`: Icon to display (optional)
  - `disableService`: Disable the toggle service (optional)

## Known Issues

- The visual editor is not yet functional - please use the "Show Code Editor" option
- Some image paths may not work correctly - ensure your images are in the correct location
- Configuration changes may require a dashboard refresh to take effect

## Planned Features

- [ ] Visual editor for easy configuration
- [ ] Image upload interface
- [ ] Drag-and-drop object placement
- [ ] Preview of day/night states
- [ ] Support for more device types

## Features

- Different images for day, night, and dusk/dawn
- Interactive light controls
- Customizable light positions and sizes
- Support for different light icons
- Automatic day/night switching based on sun position

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request. For major changes, please open an issue first to discuss what you would like to change.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
