import yargs, { type CommandModule } from 'yargs';
import { hideBin } from 'yargs/helpers';

import type {
  CombinedPluginManifest,
  PluginJsonSchema,
  PluginOperation,
  PluginOperationCli,
  PluginOperationCliOption,
  PluginOperationHttp,
  PluginOperationSurfaces,
} from '@assistant/shared';

import { loadConfig, type AssistantCliConfig } from './config';
import { httpRequest } from './httpClient';

const EXIT_OK = 0;
const EXIT_USAGE = 2;
const EXIT_CONFIG = 3;
const EXIT_HTTP_ERROR = 4;
const EXIT_UNKNOWN_ERROR = 1;

const DEFAULT_HTTP_METHOD = 'POST';
const DEFAULT_HTTP_PREFIX = '/operations';
const SESSION_ID_ENV_VAR = 'ASSISTANT_SESSION_ID';

const MISSING_CONFIG_MESSAGE =
  'AI assistant configuration not found. Set ASSISTANT_URL or create assistant.config.(json|yaml|yml).';

type HttpConfig = {
  method: string;
  path: string;
  query?: string[];
  body?: boolean;
};

export async function runPluginCli(options: {
  manifest: CombinedPluginManifest;
  pluginId?: string;
  argv?: string[];
}): Promise<void> {
  const manifest = options.manifest;
  const pluginId = options.pluginId ?? manifest.id;
  const surfaces = resolveSurfaces(manifest);

  try {
    const parser = yargs(options.argv ?? hideBin(process.argv))
      .scriptName(`${pluginId}-cli`)
      .version(manifest.version ?? 'unknown')
      .usage('Usage: $0 <command> [options]')
      .option('json', {
        type: 'boolean',
        default: true,
        describe: 'Output JSON (default: true)',
      })
      .option('session-id', {
        alias: 's',
        type: 'string',
        describe: `Session id for session-scoped operations (defaults to ${SESSION_ID_ENV_VAR}).`,
      })
      .exitProcess(false)
      .fail((msg: string, err: Error | undefined) => {
        const message = err?.message ?? msg ?? 'Invalid command usage. Run with --help for usage.';
        const exitError = new Error(message) as ExitError;
        exitError.exitCode = EXIT_USAGE;
        throw exitError;
      })
      .middleware([
        (args: Record<string, unknown>) => {
          const argv = args as { config?: AssistantCliConfig; help?: boolean; h?: boolean };

          if (argv.help === true || argv.h === true) {
            return;
          }

          const config = loadConfig();
          if (!config) {
            const exitError = new Error(MISSING_CONFIG_MESSAGE) as ExitError;
            exitError.exitCode = EXIT_CONFIG;
            throw exitError;
          }

          argv.config = config;
        },
      ]);

    const operations = manifest.operations ?? [];
    for (const operation of operations) {
      if (!surfaces.cli || !surfaces.http) {
        continue;
      }
      const command = createCommand(operation, pluginId);
      parser.command(command as CommandModule);
    }

    parser.demandCommand(1, 'You must specify a command').strict().help();

    const argv = await parser.parseAsync();
    if (!argv) {
      process.exitCode = EXIT_USAGE;
    } else {
      process.exitCode = EXIT_OK;
    }
  } catch (error: unknown) {
    handleCliError(error);
  }
}

function resolveSurfaces(manifest: CombinedPluginManifest): PluginOperationSurfaces {
  const surfaces = manifest.surfaces;
  return {
    tool: surfaces?.tool !== false,
    http: surfaces?.http !== false,
    cli: surfaces?.cli !== false,
  };
}

function resolveCliConfig(operation: PluginOperation): PluginOperationCli {
  const cliConfig: PluginOperationCli | undefined = operation.cli;
  return {
    command: cliConfig?.command ?? operation.id,
    description: cliConfig?.description ?? operation.summary,
    ...(cliConfig?.aliases ? { aliases: cliConfig.aliases } : {}),
    ...(cliConfig?.options ? { options: cliConfig.options } : {}),
  };
}

function resolveHttpConfig(operation: PluginOperation): HttpConfig {
  const httpConfig: PluginOperationHttp | undefined = operation.http;
  const method = (httpConfig?.method ?? DEFAULT_HTTP_METHOD).toUpperCase();
  const path = httpConfig?.path ?? `${DEFAULT_HTTP_PREFIX}/${operation.id}`;
  return {
    method,
    path,
    ...(httpConfig?.query ? { query: httpConfig.query } : {}),
    ...(httpConfig?.body !== undefined ? { body: httpConfig.body } : {}),
  };
}

function createCommand(
  operation: PluginOperation,
  pluginId: string,
): CommandModule<unknown, Record<string, unknown>> {
  const cli = resolveCliConfig(operation);
  const schema = operation.inputSchema;
  const overrides = new Map<string, PluginOperationCliOption>(
    cli.options?.map((option) => [option.name, option]) ?? [],
  );

  return {
    command: cli.command ?? operation.id,
    describe: cli.description ?? operation.summary,
    ...(cli.aliases ? { aliases: cli.aliases } : {}),
    builder: (args) => {
      for (const [name, propertySchema] of Object.entries(schema.properties ?? {})) {
        const override = overrides.get(name);
        const optionConfig = buildOptionConfig(
          name,
          propertySchema as PluginJsonSchema,
          override,
          schema.required,
        );
        args.option(name, optionConfig);
      }
      return args;
    },
    handler: async (argv) => {
      const config = (argv as { config?: AssistantCliConfig }).config;
      if (!config) {
        throwExitError(EXIT_CONFIG, MISSING_CONFIG_MESSAGE);
      }

      const args = extractArgsFromArgv(argv, schema);
      const errors = validateArgs(schema, args);
      if (errors.length > 0) {
        throwExitError(EXIT_USAGE, errors.join('; '));
      }

      const { path, method, query, body } = buildHttpRequest(operation, args, pluginId);
      const cliSessionId =
        typeof (argv as { sessionId?: string }).sessionId === 'string'
          ? (argv as { sessionId?: string }).sessionId?.trim()
          : '';
      const envSessionId = process.env[SESSION_ID_ENV_VAR]?.trim() ?? '';
      const sessionId = cliSessionId || envSessionId;
      const headers = sessionId ? { 'x-session-id': sessionId } : undefined;
      const result = await httpRequest<unknown>(config, {
        path,
        method,
        ...(query ? { query } : {}),
        ...(body ? { body } : {}),
        ...(headers ? { headers } : {}),
      });

      const jsonOutput = (argv as { json?: boolean }).json !== false;
      printJson(result, jsonOutput);
    },
  };
}

function buildOptionConfig(
  name: string,
  schema: PluginJsonSchema,
  override: PluginOperationCliOption | undefined,
  required: string[] | undefined,
): {
  type?: 'string' | 'number' | 'boolean';
  describe?: string;
  demandOption?: boolean;
  array?: boolean;
  alias?: string | string[];
} {
  const types = getSchemaTypes(schema);
  const isArray = override?.array ?? types.includes('array');
  let optionType: 'string' | 'number' | 'boolean' | undefined;

  switch (override?.type) {
    case 'number':
      optionType = 'number';
      break;
    case 'boolean':
      optionType = 'boolean';
      break;
    case 'json':
    case 'string':
      optionType = 'string';
      break;
    default: {
      if (types.includes('boolean')) {
        optionType = 'boolean';
      } else if (types.includes('number') || types.includes('integer')) {
        optionType = 'number';
      } else {
        optionType = 'string';
      }
      break;
    }
  }

  const aliases: string[] = [];
  if (override?.flag) {
    aliases.push(override.flag);
  }
  if (override?.alias) {
    if (Array.isArray(override.alias)) {
      aliases.push(...override.alias);
    } else {
      aliases.push(override.alias);
    }
  }

  const alias = aliases.length === 0 ? undefined : aliases.length === 1 ? aliases[0] : aliases;

  return {
    type: optionType,
    ...(override?.description || schema.description
      ? { describe: override?.description ?? schema.description }
      : {}),
    ...(required?.includes(name) || override?.required ? { demandOption: true } : {}),
    ...(isArray ? { array: true } : {}),
    ...(alias ? { alias } : {}),
  };
}

function extractArgsFromArgv(
  argv: Record<string, unknown>,
  schema: PluginOperation['inputSchema'],
): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  for (const key of Object.keys(schema.properties ?? {})) {
    if (argv[key] !== undefined) {
      args[key] = argv[key];
    }
  }
  return coerceArgs(schema, args);
}

function buildHttpRequest(
  operation: PluginOperation,
  args: Record<string, unknown>,
  pluginId: string,
): {
  path: string;
  method: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown>;
} {
  const httpConfig = resolveHttpConfig(operation);
  const remaining: Record<string, unknown> = { ...args };
  const pathSegments = httpConfig.path.split('/').filter(Boolean);
  const renderedSegments = pathSegments.map((segment) => {
    if (segment.startsWith(':')) {
      const key = segment.slice(1);
      const value = remaining[key];
      if (value === undefined) {
        throwExitError(EXIT_USAGE, `Missing required path param: ${key}`);
      }
      delete remaining[key];
      return encodeURIComponent(String(value));
    }
    return segment;
  });
  const relativePath = `/${renderedSegments.join('/')}`;
  const encodedPluginId = encodeURIComponent(pluginId);
  const path = `/api/plugins/${encodedPluginId}${relativePath}`;

  let query: Record<string, string | number | boolean | undefined> | undefined;
  if (httpConfig.query && httpConfig.query.length > 0) {
    query = {};
    for (const key of httpConfig.query) {
      const value = remaining[key];
      if (value === undefined) {
        continue;
      }
      query[key] = value as string | number | boolean;
      delete remaining[key];
    }
  }

  const expectsBody =
    httpConfig.body ?? (httpConfig.method !== 'GET' && httpConfig.method !== 'DELETE');
  const body = expectsBody ? remaining : undefined;
  if (!expectsBody && !query) {
    query = remaining as Record<string, string | number | boolean | undefined>;
  }

  return {
    path,
    method: httpConfig.method,
    ...(query ? { query } : {}),
    ...(body ? { body } : {}),
  };
}

function getSchemaTypes(schema: PluginJsonSchema | undefined): string[] {
  if (!schema?.type) {
    return [];
  }
  return Array.isArray(schema.type) ? schema.type : [schema.type];
}

function coerceValue(schema: PluginJsonSchema | undefined, value: unknown): unknown {
  if (value === undefined) {
    return value;
  }

  const types = getSchemaTypes(schema);
  if (types.length === 0) {
    return value;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (types.includes('null') && trimmed.toLowerCase() === 'null') {
      return null;
    }
    if (types.includes('boolean')) {
      if (trimmed === 'true') return true;
      if (trimmed === 'false') return false;
    }
    if (types.includes('number') || types.includes('integer')) {
      const numeric = Number(trimmed);
      if (!Number.isNaN(numeric)) {
        return numeric;
      }
    }
    if (types.includes('array')) {
      if (trimmed.startsWith('[')) {
        try {
          const parsed = JSON.parse(trimmed) as unknown;
          if (Array.isArray(parsed)) {
            return parsed;
          }
        } catch {
          // ignore parse failure
        }
      }
      if (trimmed.includes(',')) {
        return trimmed
          .split(',')
          .map((entry) => entry.trim())
          .filter(Boolean);
      }
      return [trimmed];
    }
    if (types.includes('object') && (trimmed.startsWith('{') || trimmed.startsWith('['))) {
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        if (typeof parsed === 'object' && parsed !== null) {
          return parsed;
        }
      } catch {
        // ignore parse failure
      }
    }
  }

  if (Array.isArray(value) && types.includes('array') && schema?.items) {
    const itemSchema = Array.isArray(schema.items) ? schema.items[0] : schema.items;
    if (itemSchema) {
      return value.map((entry) => coerceValue(itemSchema, entry));
    }
  }

  return value;
}

function coerceArgs(
  schema: PluginOperation['inputSchema'],
  args: Record<string, unknown>,
): Record<string, unknown> {
  const output: Record<string, unknown> = { ...args };
  for (const [key, propertySchema] of Object.entries(schema.properties ?? {})) {
    if (output[key] !== undefined) {
      output[key] = coerceValue(propertySchema as PluginJsonSchema, output[key]);
    }
  }
  return output;
}

function matchesSchemaType(schema: PluginJsonSchema | undefined, value: unknown): boolean {
  if (!schema?.type) {
    return true;
  }

  const types = getSchemaTypes(schema);
  if (value === null) {
    return types.includes('null');
  }

  if (Array.isArray(value)) {
    return types.includes('array');
  }

  switch (typeof value) {
    case 'string':
      return types.includes('string');
    case 'boolean':
      return types.includes('boolean');
    case 'number':
      if (types.includes('number')) {
        return true;
      }
      if (types.includes('integer')) {
        return Number.isInteger(value);
      }
      return false;
    case 'object':
      return types.includes('object');
    default:
      return false;
  }
}

function validateArgs(
  schema: PluginOperation['inputSchema'],
  args: Record<string, unknown>,
): string[] {
  const errors: string[] = [];
  const required = schema.required ?? [];

  for (const key of required) {
    if (args[key] === undefined) {
      errors.push(`${key} is required`);
    }
  }

  for (const [key, propertySchema] of Object.entries(schema.properties ?? {})) {
    if (args[key] === undefined) {
      continue;
    }
    if (!matchesSchemaType(propertySchema as PluginJsonSchema, args[key])) {
      errors.push(`${key} has invalid type`);
    }
  }

  return errors;
}

function printJson(value: unknown, jsonOutput: boolean): void {
  if (!jsonOutput) {
    process.stdout.write(`${value}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function throwExitError(code: number, message: string): never {
  const error = new Error(message) as ExitError;
  error.exitCode = code;
  throw error;
}

function handleCliError(error: unknown): void {
  if (isExitError(error)) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = error.exitCode;
    return;
  }

  if (isHttpError(error)) {
    const bodyText = error.body !== undefined ? `\n${JSON.stringify(error.body, null, 2)}` : '';
    process.stderr.write(`Request failed: HTTP ${error.status}: ${error.message}${bodyText}\n`);
    process.exitCode = EXIT_HTTP_ERROR;
    return;
  }

  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Unexpected error: ${message}\n`);
  process.exitCode = EXIT_UNKNOWN_ERROR;
}

interface ExitError extends Error {
  exitCode: number;
}

function isExitError(error: unknown): error is ExitError {
  return (
    typeof error === 'object' && error !== null && typeof (error as ExitError).exitCode === 'number'
  );
}

interface HttpErrorShape {
  status: number;
  body?: unknown;
  message: string;
}

function isHttpError(error: unknown): error is HttpErrorShape {
  return (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as HttpErrorShape).status === 'number'
  );
}
