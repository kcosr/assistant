import type { AssistantNativeVoiceInputDevice } from '../controllers/speechAudioController';

export const syncNativeInputDeviceSelect = (
  selectEl: HTMLSelectElement,
  selectedMicDeviceId: string,
  devices: readonly AssistantNativeVoiceInputDevice[],
): void => {
  const existingValues = new Set<string>();
  selectEl.replaceChildren();

  const systemDefaultOption = document.createElement('option');
  systemDefaultOption.value = '';
  systemDefaultOption.textContent = 'System default';
  selectEl.appendChild(systemDefaultOption);
  existingValues.add('');

  for (const device of devices) {
    if (existingValues.has(device.id)) {
      continue;
    }
    const option = document.createElement('option');
    option.value = device.id;
    option.textContent = device.label;
    selectEl.appendChild(option);
    existingValues.add(device.id);
  }

  if (selectedMicDeviceId && !existingValues.has(selectedMicDeviceId)) {
    const unavailableOption = document.createElement('option');
    unavailableOption.value = selectedMicDeviceId;
    unavailableOption.textContent = `Unavailable device [id:${selectedMicDeviceId}]`;
    selectEl.appendChild(unavailableOption);
  }

  selectEl.value = selectedMicDeviceId;
  if (selectEl.value !== selectedMicDeviceId) {
    selectEl.value = '';
  }
};
