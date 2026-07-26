import os from 'node:os';
import path from 'node:path';

type PiCodingAgentModule = typeof import('@earendil-works/pi-coding-agent');

const nativeImportEsmModule = new Function('specifier', 'return import(specifier)') as (
  specifier: string,
) => Promise<PiCodingAgentModule>;

function importEsmModule(specifier: string): Promise<PiCodingAgentModule> {
  return process.env['VITEST'] ? import(specifier) : nativeImportEsmModule(specifier);
}

function expandHomeDir(input: string): string {
  if (input === '~') {
    return os.homedir();
  }
  if (input.startsWith('~/')) {
    return path.join(os.homedir(), input.slice(2));
  }
  return input;
}

function getPiAgentDir(): string {
  const envDir = process.env['PI_CODING_AGENT_DIR'];
  if (envDir) {
    return expandHomeDir(envDir);
  }
  return path.join(os.homedir(), '.pi', 'agent');
}

/**
 * Resolve the configured Pi credential for a provider using Pi's canonical
 * model/auth runtime. OAuth refreshes are persisted to auth.json by Pi.
 */
export async function resolvePiAgentAuthApiKey(options: {
  providerId: string;
  log?: (...args: unknown[]) => void;
}): Promise<string | undefined> {
  const { providerId, log } = options;
  const trimmedProviderId = providerId.trim();
  if (!trimmedProviderId) {
    return undefined;
  }

  try {
    const { ModelRuntime } = await importEsmModule('@earendil-works/pi-coding-agent');
    const runtime = await ModelRuntime.create({
      authPath: path.join(getPiAgentDir(), 'auth.json'),
      modelsPath: null,
      allowModelNetwork: false,
    });
    const resolved = await runtime.getAuth(trimmedProviderId);
    return resolved?.auth.apiKey;
  } catch (error) {
    log?.('[pi-auth] Failed to resolve provider auth', {
      providerId: trimmedProviderId,
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}
