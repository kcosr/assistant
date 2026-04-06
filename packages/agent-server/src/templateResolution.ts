/**
 * Template resolution for agent configuration.
 *
 * Operates on raw JSON objects (before Zod validation) so that:
 * - `null` values are preserved for clearing inherited fields
 * - `extends` references are resolved and stripped
 * - The `templates` section is consumed and removed
 *
 * After resolution, each agent is a flat JSON object ready for Zod validation.
 */

type RawObject = Record<string, unknown>;

/**
 * Normalize `extends` to a string array. Accepts string, string[], or undefined.
 */
function normalizeExtends(value: unknown): string[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      throw new Error('extends must be a non-empty string when provided');
    }
    return [trimmed];
  }
  if (Array.isArray(value)) {
    const result: string[] = [];
    for (const item of value) {
      if (typeof item !== 'string' || item.trim().length === 0) {
        throw new Error(`extends entries must be non-empty strings, got: ${JSON.stringify(item)}`);
      }
      result.push(item.trim());
    }
    return result;
  }
  throw new Error(`extends must be a string, array of strings, or omitted, got: ${typeof value}`);
}

function isPlainObject(value: unknown): value is RawObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Deep merge two raw JSON objects.
 *
 * Rules:
 * - `extends` key is always skipped (meta-field)
 * - Explicit `null` clears the inherited field (deletes from result)
 * - `undefined` means "not specified" — does not override
 * - Plain objects: recurse (deep merge)
 * - Arrays: replace entirely (last writer wins)
 * - Scalars: replace (last writer wins)
 */
export function deepMergeFragments(base: RawObject, override: RawObject): RawObject {
  const result = { ...base };

  for (const [key, value] of Object.entries(override)) {
    if (key === 'extends') {
      continue;
    }

    if (value === null) {
      delete result[key];
      continue;
    }

    if (value === undefined) {
      continue;
    }

    const baseValue = result[key];

    if (isPlainObject(value) && isPlainObject(baseValue)) {
      result[key] = deepMergeFragments(baseValue, value);
    } else {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Resolve a single template's full inheritance chain via depth-first traversal.
 * Returns the fully merged template fragment (without `extends`).
 */
function resolveTemplate(
  name: string,
  templates: Record<string, unknown>,
  resolveCache: Map<string, RawObject>,
  visiting: Set<string>,
): RawObject {
  const cached = resolveCache.get(name);
  if (cached) {
    return cached;
  }

  if (visiting.has(name)) {
    const chain = [...visiting, name].join(' → ');
    throw new Error(`Circular template reference: ${chain}`);
  }

  const template = templates[name];
  if (!isPlainObject(template)) {
    throw new Error(`Template "${name}" not found`);
  }

  visiting.add(name);

  const parentNames = normalizeExtends(template['extends']);

  let resolved: RawObject = {};
  for (const parentName of parentNames) {
    const parent = resolveTemplate(parentName, templates, resolveCache, new Set(visiting));
    resolved = deepMergeFragments(resolved, parent);
  }

  // Merge this template's own fields on top
  resolved = deepMergeFragments(resolved, template);

  visiting.delete(name);
  resolveCache.set(name, resolved);

  return resolved;
}

const IDENTITY_FIELDS = new Set(['agentId', 'displayName', 'description']);

/**
 * Validate the templates section:
 * - All extends references exist
 * - No circular references
 * - Templates do not contain identity fields
 */
function validateTemplates(templates: Record<string, unknown>): void {
  const resolveCache = new Map<string, RawObject>();

  for (const [name, template] of Object.entries(templates)) {
    if (!isPlainObject(template)) {
      throw new Error(`Template "${name}" must be an object`);
    }

    for (const field of IDENTITY_FIELDS) {
      if (field in template) {
        throw new Error(`Template "${name}" must not contain "${field}" (identity fields belong on agents)`);
      }
    }

    // Resolve to detect cycles and missing references
    resolveTemplate(name, templates, resolveCache, new Set());
  }
}

/**
 * Resolve all agent template references in the raw config.
 *
 * Consumes the `templates` section and resolves `extends` on each agent,
 * producing flat agent objects ready for Zod validation.
 *
 * Also normalizes skills roots relative to configDir (matching contextFiles behavior).
 */
export function resolveAgentTemplates(rawConfig: RawObject): RawObject {
  const rawTemplates = rawConfig['templates'];
  const agents = rawConfig['agents'];

  // Validate templates section shape
  let templates: Record<string, unknown> = {};
  if (rawTemplates !== undefined && rawTemplates !== null) {
    if (!isPlainObject(rawTemplates)) {
      throw new Error('templates must be an object when provided');
    }
    templates = rawTemplates;
    if (Object.keys(templates).length > 0) {
      validateTemplates(templates);
    }
  }

  if (!Array.isArray(agents)) {
    const result = { ...rawConfig };
    delete result['templates'];
    return result;
  }

  const resolveCache = new Map<string, RawObject>();

  const resolvedAgents = agents.map((agent: unknown, index: number) => {
    if (!isPlainObject(agent)) {
      return agent; // Let Zod handle the error
    }

    const extendsValue = agent['extends'];
    if (extendsValue === undefined || extendsValue === null) {
      // No extends — return as-is (minus the extends key)
      const copy = { ...agent };
      delete copy['extends'];
      return copy;
    }

    const parentNames = normalizeExtends(extendsValue);

    let base: RawObject = {};
    for (const parentName of parentNames) {
      if (!isPlainObject(templates) || !(parentName in templates)) {
        const agentId = typeof agent['agentId'] === 'string' ? agent['agentId'] : `index ${index}`;
        throw new Error(`Agent "${agentId}" extends template "${parentName}" which does not exist`);
      }
      const resolved = resolveTemplate(parentName, templates, resolveCache, new Set());
      base = deepMergeFragments(base, resolved);
    }

    // Merge agent's own fields on top (highest priority)
    return deepMergeFragments(base, agent);
  });

  const result = { ...rawConfig };
  delete result['templates'];
  result['agents'] = resolvedAgents;
  return result;
}
