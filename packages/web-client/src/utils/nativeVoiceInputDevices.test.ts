// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { syncNativeInputDeviceSelect } from './nativeVoiceInputDevices';

describe('syncNativeInputDeviceSelect', () => {
  it('renders system default plus available devices', () => {
    const selectEl = document.createElement('select');

    syncNativeInputDeviceSelect(selectEl, '', [
      { id: '7', label: 'USB mic [id:7]' },
      { id: '11', label: 'Bluetooth headset mic [id:11]' },
    ]);

    expect(Array.from(selectEl.options).map((option) => option.value)).toEqual(['', '7', '11']);
    expect(Array.from(selectEl.options).map((option) => option.textContent)).toEqual([
      'System default',
      'USB mic [id:7]',
      'Bluetooth headset mic [id:11]',
    ]);
  });

  it('adds an unavailable option when the selected device is missing', () => {
    const selectEl = document.createElement('select');

    syncNativeInputDeviceSelect(selectEl, '99', [{ id: '7', label: 'USB mic [id:7]' }]);

    expect(Array.from(selectEl.options).map((option) => option.value)).toEqual(['', '7', '99']);
    expect(selectEl.options[2]?.textContent).toBe('Unavailable device [id:99]');
    expect(selectEl.value).toBe('99');
  });
});
