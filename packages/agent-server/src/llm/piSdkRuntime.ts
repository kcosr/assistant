import path from 'node:path';

import type {
  Api,
  AssistantMessage,
  AssistantMessageEventStream,
  Context,
  Model,
  SimpleStreamOptions,
} from '@earendil-works/pi-ai';
import type { ModelRuntime } from '@earendil-works/pi-coding-agent';

import { getPiAgentDir } from './piAgentAuth';

type PiCodingAgentModule = typeof import('@earendil-works/pi-coding-agent');
type RequestOverridesModule = typeof import('@kcosr/pi-request-overrides');
const nativeImportEsmModule = new Function('specifier', 'return import(specifier)') as (
  specifier: string,
) => Promise<unknown>;

let runtimeCache: { agentDir: string; promise: Promise<ModelRuntime> } | undefined;

let requestOverridesCache:
  | {
      agentDir: string;
      promise: Promise<ReturnType<RequestOverridesModule['createRequestOverrides']>>;
    }
  | undefined;

async function getRequestOverrides() {
  const agentDir = getPiAgentDir();
  if (!requestOverridesCache || requestOverridesCache.agentDir !== agentDir) {
    const promise = (async () => {
      const { createRequestOverrides } = process.env['VITEST']
        ? await import('@kcosr/pi-request-overrides')
        : ((await nativeImportEsmModule('@kcosr/pi-request-overrides')) as RequestOverridesModule);
      return createRequestOverrides({ configPath: path.join(agentDir, 'request-overrides.json') });
    })();
    requestOverridesCache = { agentDir, promise };
    void promise.catch(() => {
      if (requestOverridesCache?.promise === promise) requestOverridesCache = undefined;
    });
  }
  return requestOverridesCache.promise;
}

/** One canonical Pi registry owns model definitions and request authentication. */
export async function getPiSdkRuntime(): Promise<ModelRuntime> {
  const agentDir = getPiAgentDir();
  if (!runtimeCache || runtimeCache.agentDir !== agentDir) {
    const promise = (async () => {
      const { ModelRuntime } = process.env['VITEST']
        ? await import('@earendil-works/pi-coding-agent')
        : ((await nativeImportEsmModule('@earendil-works/pi-coding-agent')) as PiCodingAgentModule);
      const runtime = await ModelRuntime.create({
        authPath: path.join(agentDir, 'auth.json'),
        modelsPath: path.join(agentDir, 'models.json'),
        allowModelNetwork: false,
      });
      if (runtime.getError()) {
        throw new Error(
          `Failed to load Pi registry at ${path.join(agentDir, 'models.json')}: ${runtime.getError()}`,
        );
      }
      return runtime;
    })();
    runtimeCache = { agentDir, promise };
    void promise.catch(() => {
      if (runtimeCache?.promise === promise) runtimeCache = undefined;
    });
  }
  return runtimeCache.promise;
}

export async function getPiSdkProviders(): Promise<string[]> {
  return (await getPiSdkRuntime()).getProviders().map((provider) => provider.id);
}

export async function getPiSdkModels(providerId: string): Promise<readonly Model<Api>[]> {
  return (await getPiSdkRuntime()).getModels(providerId);
}

export async function streamPiSdkModel(
  model: Model<Api>,
  context: Context,
  options?: SimpleStreamOptions,
): Promise<AssistantMessageEventStream> {
  const [runtime, overrides] = await Promise.all([getPiSdkRuntime(), getRequestOverrides()]);
  return runtime.streamSimple(model, context, {
    ...options,
    onPayload: async (payload, requestModel) => {
      const override = await overrides.onPayload(payload, requestModel);
      const customized = override === undefined ? payload : override;
      const replacement = await options?.onPayload?.(customized, requestModel);
      return replacement === undefined ? customized : replacement;
    },
  });
}

export async function completePiSdkModel(
  model: Model<Api>,
  context: Context,
  options?: SimpleStreamOptions,
): Promise<AssistantMessage> {
  return (await streamPiSdkModel(model, context, options)).result();
}
