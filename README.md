# Apartment View Card

> ⚠️ **Work in Progress**: This card is currently under active development. Some features may not work as expected, and the configuration interface is still being improved. Please report any issues you encounter.

A Home Assistant card that shows your apartment layout with interactive lights. The card displays different images based on the time of day and allows you to control your lights by clicking on their positions in the layout.

## Current Status

- ✅ Basic functionality works
- ✅ Day/night image switching
- ✅ Light control through clicking
- 🚧 Visual editor is under development
- 🚧 Some features may be unstable
- 🚧 Configuration requires manual YAML editing

## Installation

1. Download the `apartment-view-card.js` file from the [latest release](https://github.com/grozdanowski/ha-apartment-view-card/releases/latest)
2. Copy the file to your Home Assistant's `/config/www/` directory
3. Add the card to your dashboard using the "Show Code Editor" option (the visual editor is currently under development)

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
type: apartment-view-card
allLightsImage: /local/all-lights.png
dayImage: /local/day.png
nightImage: /local/night.png
duskdawnImage: /local/duskdawn.png
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
    customIcon: mdi:wall-sconce
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
