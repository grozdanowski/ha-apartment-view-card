import { describe, it, expect } from 'vitest';
import { showZoneBoxes } from '../src/render/zone-controls';

describe('showZoneBoxes', () => {
  it('hides zone boxes in the live card (not edit mode)', () => {
    expect(showZoneBoxes(false)).toBe(false);
  });
  it('shows zone boxes only in editor edit mode', () => {
    expect(showZoneBoxes(true)).toBe(true);
  });
});
