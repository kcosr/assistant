import type {
  AssistantNativeVoiceBridge,
  AssistantSpeechDiscoveryResult,
} from '../controllers/speechAudioController';
import {
  normalizeSpeechServerBaseUrl,
  SPEECH_SERVER_URL_ERROR,
  type VoiceSettings,
} from './voiceSettings';

export function speechCatalogOptions(
  catalog: AssistantSpeechDiscoveryResult['catalog'],
  synthesisModel: string,
): {
  recognitionModels: string[];
  synthesisModels: string[];
  voices: string[];
} {
  const recognitionModels: string[] = [],
    synthesisModels: string[] = [],
    voices: string[] = [];
  if (catalog?.object !== 'list' || !Array.isArray(catalog.data))
    return { recognitionModels, synthesisModels, voices };
  for (const entry of catalog.data) {
    if (!entry || typeof entry !== 'object') continue;
    const model = entry as Record<string, unknown>;
    if (typeof model['id'] !== 'string') continue;
    if (model['task'] === 'transcription') recognitionModels.push(model['id']);
    if (model['task'] !== 'speech') continue;
    synthesisModels.push(model['id']);
    if (model['id'] !== synthesisModel || !Array.isArray(model['voices'])) continue;
    for (const voice of model['voices']) {
      if (voice && typeof voice === 'object' && typeof voice.id === 'string') voices.push(voice.id);
    }
  }
  return { recognitionModels, synthesisModels, voices };
}

export function bindSpeechServerControls(options: {
  bridge: AssistantNativeVoiceBridge;
  enabled: boolean;
  getSettings: () => VoiceSettings;
  syncSettings: () => void;
}): void {
  const manage = document.getElementById('speech-manage-token-button') as HTMLButtonElement | null;
  const refresh = document.getElementById(
    'speech-refresh-models-button',
  ) as HTMLButtonElement | null;
  const status = document.getElementById('speech-credential-status');
  if (!manage || !refresh || !status) return;
  manage.disabled = refresh.disabled = !options.enabled;
  if (!options.enabled) status.textContent = 'Speech server settings are available on Android.';
  let catalog: AssistantSpeechDiscoveryResult['catalog'];
  let busy = false;
  const showCatalog = (): void => {
    const selected = (
      document.getElementById('speech-synthesis-model-input') as HTMLInputElement | null
    )?.value.trim();
    const choices = speechCatalogOptions(
      catalog,
      selected || options.getSettings().speechSynthesisModel,
    );
    for (const [suffix, values] of [
      ['recognition-model', choices.recognitionModels],
      ['synthesis-model', choices.synthesisModels],
      ['voice', choices.voices],
    ] as const) {
      const list = document.getElementById(`speech-${suffix}-options`);
      if (list)
        list.replaceChildren(
          ...values.map((value) => {
            const option = document.createElement('option');
            option.value = value;
            return option;
          }),
        );
    }
  };
  const run = async (action: 'manageSpeechCredential' | 'discoverSpeechModels'): Promise<void> => {
    if (busy || !options.enabled) return;
    const endpointInput = document.getElementById(
      'speech-server-base-url-input',
    ) as HTMLInputElement | null;
    if (
      normalizeSpeechServerBaseUrl(
        endpointInput?.value ?? options.getSettings().speechServerBaseUrl,
      ) === null
    ) {
      endpointInput?.setCustomValidity(SPEECH_SERVER_URL_ERROR);
      status.textContent = SPEECH_SERVER_URL_ERROR;
      return;
    }
    endpointInput?.setCustomValidity('');
    busy = true;
    manage.disabled = refresh.disabled = true;
    status.textContent =
      action === 'discoverSpeechModels'
        ? 'Loading speech models…'
        : 'Opening speech token settings…';
    options.syncSettings();
    const requestSettings = options.getSettings();
    try {
      if (!(await options.bridge.setVoiceSettings(requestSettings))) {
        status.textContent = 'Could not save speech server settings.';
        return;
      }
      const result = await options.bridge[action]();
      const currentEndpoint =
        (
          document.getElementById('speech-server-base-url-input') as HTMLInputElement | null
        )?.value.trim() || options.getSettings().speechServerBaseUrl;
      if (
        normalizeSpeechServerBaseUrl(currentEndpoint) !==
        normalizeSpeechServerBaseUrl(requestSettings.speechServerBaseUrl)
      )
        return;
      status.textContent =
        result.error ||
        (result.credentialConfigured ? 'Speech token configured.' : 'Speech token not configured.');
      if (action === 'discoverSpeechModels') {
        catalog = result.catalog;
        showCatalog();
      }
    } finally {
      busy = false;
      manage.disabled = refresh.disabled = false;
    }
  };
  manage.addEventListener('click', () => {
    void run('manageSpeechCredential');
  });
  refresh.addEventListener('click', () => {
    void run('discoverSpeechModels');
  });
  document.getElementById('speech-synthesis-model-input')?.addEventListener('change', showCatalog);
  document.getElementById('speech-server-base-url-input')?.addEventListener('change', () => {
    catalog = undefined;
    showCatalog();
    const input = document.getElementById('speech-server-base-url-input') as HTMLInputElement;
    const valid = normalizeSpeechServerBaseUrl(input.value) !== null;
    input.setCustomValidity(valid ? '' : SPEECH_SERVER_URL_ERROR);
    status.textContent = valid
      ? 'Refresh models to check this server and its speech token.'
      : SPEECH_SERVER_URL_ERROR;
  });
}
