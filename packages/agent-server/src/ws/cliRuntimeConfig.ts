import type { CliWrapperConfig } from '../agents';

export interface CliRuntimeMacroContext {
  sessionId: string;
  workingDir?: string;
}

export interface CliRuntimeConfig {
  workdir?: string;
  extraArgs?: string[];
  wrapper?: CliWrapperConfig;
}

const SESSION_WORKING_DIR_MACRO = '${session.workingDir}';

function resolveStringMacro(value: string, context: CliRuntimeMacroContext): string {
  return value.replaceAll(SESSION_WORKING_DIR_MACRO, context.workingDir ?? '');
}

export function resolveCliRuntimeConfig<T extends CliRuntimeConfig>(
  config: T | undefined,
  context: CliRuntimeMacroContext,
): T | undefined {
  if (!config) {
    return undefined;
  }

  const resolved: T = { ...config };

  if (typeof config.workdir === 'string') {
    const workdir = resolveStringMacro(config.workdir, context).trim();
    if (workdir.length > 0) {
      resolved.workdir = workdir;
    } else {
      delete resolved.workdir;
    }
  }

  if (config.wrapper) {
    const wrapper: CliWrapperConfig = { ...config.wrapper };
    if (config.wrapper.env) {
      const env: Record<string, string> = {};
      for (const [key, value] of Object.entries(config.wrapper.env)) {
        env[key] = resolveStringMacro(value, context);
      }
      wrapper.env = env;
    }
    resolved.wrapper = wrapper;
  }

  return resolved;
}
