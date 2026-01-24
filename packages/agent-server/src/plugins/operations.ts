import { randomUUID } from 'node:crypto';

import type {
  CombinedPluginManifest,
  PluginJsonSchema,
  PluginOperation,
  PluginOperationHttp,
  PluginOperationSurfaces,
} from '@assistant/shared';

import type { HttpRouteHandler } from '../http/types';
import type { ToolContext } from '../tools';
import { ToolError } from '../tools';
import { executeInteraction, interactionUnavailableError } from '../ws/toolCallHandling';

import type { PluginToolDefinition } from './types';

export type OperationHandler = (
  args: Record<string, unknown>,
  ctx: ToolContext,
) => Promise<unknown>;

export type OperationHandlers = Record<string, OperationHandler>;

type OperationHttpConfig = {
  method: string;
  path: string;
  query?: string[];
  body?: boolean;
  successStatus?: number;
};

const DEFAULT_HTTP_METHOD = 'POST';
const DEFAULT_HTTP_PREFIX = '/operations';
const SESSION_ID_HEADER = 'x-session-id';
const SESSION_ID_QUERY_PARAM = 'sessionId';

type ResolvedSurfaces = {
  tool: boolean;
  http: boolean;
  cli: boolean;
};

function resolveSurfaces(manifest: CombinedPluginManifest): ResolvedSurfaces {
  const surfaces: PluginOperationSurfaces | undefined = manifest.surfaces;
  return {
    tool: surfaces?.tool !== false,
    http: surfaces?.http !== false,
    cli: surfaces?.cli !== false,
  };
}

function normalizeToolSegment(value: string): string {
  return value.replace(/-/g, '_');
}

function readHeaderValue(
  req: { headers?: Record<string, string | string[] | undefined> },
  name: string,
): string | null {
  const headers = req.headers ?? {};
  const value = headers[name];
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return typeof value === 'string' ? value : null;
}

function resolveSessionId(
  req: { headers?: Record<string, string | string[] | undefined> },
  url: URL,
): string | null {
  const header = readHeaderValue(req, SESSION_ID_HEADER);
  const query = url.searchParams.get(SESSION_ID_QUERY_PARAM);
  const raw = header ?? query ?? '';
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizeToolPrefix(pluginId: string): string {
  return normalizeToolSegment(pluginId);
}

function resolveToolConfig(
  pluginId: string,
  operation: PluginOperation,
): { name: string; description: string } {
  const name = `${normalizeToolSegment(pluginId)}_${normalizeToolSegment(operation.id)}`;
  const description = operation.tool?.description ?? operation.summary;
  return { name, description };
}

function resolveHttpConfig(operation: PluginOperation): OperationHttpConfig {
  const httpConfig: PluginOperationHttp | undefined = operation.http;
  const method = (httpConfig?.method ?? DEFAULT_HTTP_METHOD).toUpperCase();
  const path = httpConfig?.path ?? `${DEFAULT_HTTP_PREFIX}/${operation.id}`;
  return {
    method,
    path,
    ...(httpConfig?.query ? { query: httpConfig.query } : {}),
    ...(httpConfig?.body !== undefined ? { body: httpConfig.body } : {}),
    ...(httpConfig?.successStatus ? { successStatus: httpConfig.successStatus } : {}),
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
          // fall through to best-effort parsing
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
    case 'number': {
      if (types.includes('number')) {
        return true;
      }
      if (types.includes('integer')) {
        return Number.isInteger(value);
      }
      return false;
    }
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

function normalizeInputSchema(
  schema: PluginOperation['inputSchema'],
): PluginToolDefinition['inputSchema'] {
  const base: PluginToolDefinition['inputSchema'] = {
    type: 'object',
    properties: schema.properties ?? {},
  };
  if (Array.isArray(schema.required) && schema.required.length > 0) {
    return { ...base, required: schema.required };
  }
  return base;
}

export function createPluginOperationTools(options: {
  manifest: CombinedPluginManifest;
  handlers: OperationHandlers;
}): PluginToolDefinition[] {
  const { manifest, handlers } = options;
  const surfaces = resolveSurfaces(manifest);
  if (!surfaces.tool) {
    return [];
  }
  const operations = manifest.operations ?? [];
  const tools: PluginToolDefinition[] = [];

  for (const operation of operations) {
    const { name, description } = resolveToolConfig(manifest.id, operation);
    const handler = handlers[operation.id];

    const wrappedHandler: PluginToolDefinition['handler'] = async (args, ctx) => {
      const normalizedArgs = coerceArgs(operation.inputSchema, args);
      const errors = validateArgs(operation.inputSchema, normalizedArgs);
      if (errors.length > 0) {
        throw new ToolError('invalid_arguments', errors.join('; '));
      }
      if (!handler) {
        throw new ToolError('tool_not_found', `Operation handler not found: ${operation.id}`);
      }
      return handler(normalizedArgs, ctx);
    };

    tools.push({
      name,
      description,
      inputSchema: normalizeInputSchema(operation.inputSchema),
      ...(operation.capabilities ? { capabilities: operation.capabilities } : {}),
      handler: wrappedHandler,
    });
  }

  return tools;
}

export function createPluginOperationRoutes(options: {
  manifest: CombinedPluginManifest;
  handlers: OperationHandlers;
}): HttpRouteHandler[] {
  const { manifest, handlers } = options;
  const surfaces = resolveSurfaces(manifest);
  if (!surfaces.http) {
    return [];
  }
  const operations = manifest.operations ?? [];
  const routes = operations.map((operation) => {
    const httpConfig = resolveHttpConfig(operation);
    const pathSegments = httpConfig.path.split('/').filter(Boolean);
    const toolName = resolveToolConfig(manifest.id, operation).name;
    return {
      operation,
      httpConfig,
      pathSegments,
      toolName,
    };
  });

  if (routes.length === 0) {
    return [];
  }

  const handler: HttpRouteHandler = async (context, req, _res, url, segments, helpers) => {
    if (!req.method) {
      return false;
    }

    const sessionId = resolveSessionId(
      req as { headers: Record<string, string | string[] | undefined> },
      url,
    );

    if (
      segments.length < 3 ||
      segments[0] !== 'api' ||
      segments[1] !== 'plugins' ||
      segments[2] !== manifest.id
    ) {
      return false;
    }

    const remaining = segments.slice(3);

    for (const route of routes) {
      if (route.httpConfig.method !== req.method.toUpperCase()) {
        continue;
      }

      if (remaining.length !== route.pathSegments.length) {
        continue;
      }

      const params: Record<string, string> = {};
      let matched = true;
      for (let index = 0; index < route.pathSegments.length; index += 1) {
        const pattern = route.pathSegments[index] ?? '';
        const segment = remaining[index] ?? '';
        if (pattern.startsWith(':')) {
          const name = pattern.slice(1);
          if (!name) {
            matched = false;
            break;
          }
          params[name] = decodeURIComponent(segment);
        } else if (pattern !== segment) {
          matched = false;
          break;
        }
      }

      if (!matched) {
        continue;
      }

      const queryParams: Record<string, unknown> = {};
      if (route.httpConfig.query && route.httpConfig.query.length > 0) {
        for (const key of route.httpConfig.query) {
          if (key === SESSION_ID_QUERY_PARAM) {
            continue;
          }
          const values = url.searchParams.getAll(key);
          if (values.length === 0) {
            continue;
          }
          queryParams[key] = values.length === 1 ? values[0] : values;
        }
      }

      const expectsBody =
        route.httpConfig.body ??
        (route.httpConfig.method !== 'GET' && route.httpConfig.method !== 'DELETE');
      let body: Record<string, unknown> | undefined;
      if (expectsBody) {
        const payload = await helpers.readJsonBody();
        if (!payload) {
          return true;
        }
        body = payload;
      }

      const rawArgs = {
        ...(body ?? {}),
        ...queryParams,
        ...params,
      };
      const args = coerceArgs(route.operation.inputSchema, rawArgs);
      const errors = validateArgs(route.operation.inputSchema, args);
      if (errors.length > 0) {
        helpers.sendJson(400, { error: errors.join('; ') });
        return true;
      }

      const operationHandler = handlers[route.operation.id];
      if (!operationHandler) {
        helpers.sendJson(500, { error: `Operation handler not found: ${route.operation.id}` });
        return true;
      }

      try {
        let toolContext = sessionId
          ? { ...context.httpToolContext, sessionId }
          : context.httpToolContext;
        if (sessionId && toolContext.sessionHub) {
          const toolCallId = randomUUID();
          const sessionHub = toolContext.sessionHub;
          toolContext = {
            ...toolContext,
            requestInteraction: async (request) => {
              const availability = sessionHub.getInteractionAvailability(sessionId);
              if (!availability.available) {
                throw interactionUnavailableError(request);
              }
              return executeInteraction({
                request,
                context: {
                  sessionId,
                  callId: toolCallId,
                  toolName: route.toolName,
                  sessionHub,
                  ...(toolContext.eventStore ? { eventStore: toolContext.eventStore } : {}),
                  ...(toolContext.signal ? { signal: toolContext.signal } : {}),
                },
              });
            },
          };
        } else if (sessionId) {
          toolContext = {
            ...toolContext,
            requestInteraction: async (request) => {
              throw interactionUnavailableError(request);
            },
          };
        }
        const result = await operationHandler(args, toolContext);
        const status = route.httpConfig.successStatus ?? 200;
        helpers.sendJson(status, { ok: true, result });
        return true;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const code =
          err instanceof ToolError
            ? err.code
            : typeof (err as { code?: unknown })?.code === 'string'
              ? String((err as { code?: unknown }).code)
              : undefined;
        const status = resolveOperationErrorStatus(code);
        helpers.sendJson(status, {
          error: message || 'Operation failed',
          ...(code ? { code } : {}),
        });
        return true;
      }
    }

    return false;
  };

  return [handler];
}

function resolveOperationErrorStatus(code: string | undefined): number {
  if (!code) {
    return 500;
  }
  if (code === 'invalid_arguments') {
    return 400;
  }
  if (code === 'session_busy') {
    return 409;
  }
  if (code === 'tool_not_found') {
    return 404;
  }
  if (code === 'not_found' || code.endsWith('_not_found')) {
    return 404;
  }
  return 500;
}

export function createPluginOperationSurface(options: {
  manifest: CombinedPluginManifest;
  handlers: OperationHandlers;
}): { tools: PluginToolDefinition[]; httpRoutes: HttpRouteHandler[] } {
  return {
    tools: createPluginOperationTools(options),
    httpRoutes: createPluginOperationRoutes(options),
  };
}
