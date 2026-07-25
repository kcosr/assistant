import type {
  Api,
  AssistantMessage,
  AssistantMessageEventStream,
  Context,
  Model,
  MutableModels,
  ProviderStreams,
  SimpleStreamOptions,
} from '@earendil-works/pi-ai';

type PiAiModule = typeof import('@earendil-works/pi-ai');
type PiProvidersModule = typeof import('@earendil-works/pi-ai/providers/all');
type PiApiModule =
  | typeof import('@earendil-works/pi-ai/api/anthropic-messages.lazy')
  | typeof import('@earendil-works/pi-ai/api/azure-openai-responses.lazy')
  | typeof import('@earendil-works/pi-ai/api/bedrock-converse-stream.lazy')
  | typeof import('@earendil-works/pi-ai/api/google-generative-ai.lazy')
  | typeof import('@earendil-works/pi-ai/api/google-vertex.lazy')
  | typeof import('@earendil-works/pi-ai/api/mistral-conversations.lazy')
  | typeof import('@earendil-works/pi-ai/api/openai-codex-responses.lazy')
  | typeof import('@earendil-works/pi-ai/api/openai-completions.lazy')
  | typeof import('@earendil-works/pi-ai/api/openai-responses.lazy');

const nativeImportEsmModule = new Function('specifier', 'return import(specifier)') as (
  specifier: string,
) => Promise<unknown>;

function importEsmModule(specifier: string): Promise<unknown> {
  return process.env['VITEST'] ? import(specifier) : nativeImportEsmModule(specifier);
}

let modelsPromise: Promise<MutableModels> | undefined;

function loadModels(): Promise<MutableModels> {
  modelsPromise ??= importEsmModule('@earendil-works/pi-ai/providers/all').then((module) =>
    (module as PiProvidersModule).builtinModels(),
  );
  return modelsPromise;
}

export async function getPiSdkProviders(): Promise<string[]> {
  const models = await loadModels();
  return models.getProviders().map((provider) => provider.id);
}

export async function getPiSdkModels(providerId: string): Promise<readonly Model<Api>[]> {
  return (await loadModels()).getModels(providerId);
}

async function loadApiStreams(api: string): Promise<ProviderStreams> {
  const loaders: Readonly<Record<string, [string, string]>> = {
    'anthropic-messages': [
      '@earendil-works/pi-ai/api/anthropic-messages.lazy',
      'anthropicMessagesApi',
    ],
    'azure-openai-responses': [
      '@earendil-works/pi-ai/api/azure-openai-responses.lazy',
      'azureOpenAIResponsesApi',
    ],
    'bedrock-converse-stream': [
      '@earendil-works/pi-ai/api/bedrock-converse-stream.lazy',
      'bedrockConverseStreamApi',
    ],
    'google-generative-ai': [
      '@earendil-works/pi-ai/api/google-generative-ai.lazy',
      'googleGenerativeAIApi',
    ],
    'google-vertex': ['@earendil-works/pi-ai/api/google-vertex.lazy', 'googleVertexApi'],
    'mistral-conversations': [
      '@earendil-works/pi-ai/api/mistral-conversations.lazy',
      'mistralConversationsApi',
    ],
    'openai-codex-responses': [
      '@earendil-works/pi-ai/api/openai-codex-responses.lazy',
      'openAICodexResponsesApi',
    ],
    'openai-completions': [
      '@earendil-works/pi-ai/api/openai-completions.lazy',
      'openAICompletionsApi',
    ],
    'openai-responses': ['@earendil-works/pi-ai/api/openai-responses.lazy', 'openAIResponsesApi'],
  };
  const loader = loaders[api];
  if (!loader) {
    throw new Error(`Pi API implementation "${api}" is not available`);
  }
  const [specifier, exportName] = loader;
  const module = (await importEsmModule(specifier)) as PiApiModule;
  const createStreams = (module as unknown as Record<string, unknown>)[exportName] as
    | (() => ProviderStreams)
    | undefined;
  if (!createStreams) {
    throw new Error(`Pi API implementation "${api}" did not export ${String(exportName)}`);
  }
  return createStreams();
}

async function resolveModelProvider(model: Model<Api>) {
  const models = await loadModels();
  const builtinProvider = models.getProvider(model.provider);
  if (builtinProvider) {
    return builtinProvider;
  }

  const [{ createProvider, envApiKeyAuth }, streams] = await Promise.all([
    importEsmModule('@earendil-works/pi-ai') as Promise<PiAiModule>,
    loadApiStreams(model.api),
  ]);
  return createProvider({
    id: model.provider,
    auth: {
      apiKey: envApiKeyAuth(model.provider, []),
    },
    models: [model],
    api: streams,
  });
}

export async function streamPiSdkModel(
  model: Model<Api>,
  context: Context,
  options?: SimpleStreamOptions,
): Promise<AssistantMessageEventStream> {
  return (await resolveModelProvider(model)).streamSimple(model, context, options);
}

export async function completePiSdkModel(
  model: Model<Api>,
  context: Context,
  options?: SimpleStreamOptions,
): Promise<AssistantMessage> {
  return (await streamPiSdkModel(model, context, options)).result();
}
