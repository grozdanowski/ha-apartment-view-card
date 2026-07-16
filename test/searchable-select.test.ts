// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '../src/editor/searchable-select';

async function mount() {
  const element = document.createElement('studio-searchable-select') as any;
  element.label = 'Device to edit';
  element.value = 'light.pendant';
  element.options = [
    {
      value: 'light.pendant',
      label: 'Pendant',
      description: 'Living Room · off',
      icon: 'mdi:lightbulb-outline',
    },
    {
      value: 'media_player.naim',
      label: 'Naim Mu-so',
      description: 'Living Room · playing',
      icon: 'mdi:speaker',
    },
    {
      value: 'fan.pablo',
      label: 'Pablo',
      description: 'Hallway · docked',
      icon: 'mdi:robot-vacuum',
    },
  ];
  document.body.append(element);
  await element.updateComplete;
  return element;
}

describe('studio-searchable-select', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('filters by label, description, and entity id', async () => {
    const element = await mount();
    const input = element.shadowRoot.querySelector('input') as HTMLInputElement;
    input.focus();
    input.value = 'playing';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await element.updateComplete;

    const options = element.shadowRoot.querySelectorAll('[role="option"]');
    expect(options).toHaveLength(1);
    expect(options[0].textContent).toContain('Naim Mu-so');
  });

  it('supports keyboard selection and emits one controlled value change', async () => {
    const element = await mount();
    const onChange = vi.fn();
    element.addEventListener('value-changed', onChange);
    const input = element.shadowRoot.querySelector('input') as HTMLInputElement;
    input.focus();
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
    );
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    );
    await element.updateComplete;

    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange.mock.calls[0][0].detail.value).toBe('media_player.naim');
  });
});
