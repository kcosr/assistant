import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { CombinedPluginManifestSchema, type CombinedPluginManifest } from '@assistant/shared';

import type { AppConfig, PluginsConfig } from '../config';
import type { Tool, ToolContext, ToolHost } from '../tools';
import { ToolError } from '../tools';
import type { PanelEventHandler, PluginModule, PluginToolDefinition, ToolPlugin } from './types';
import type { HttpRouteHandler } from '../http/types';
import { createPluginOperationSurface, normalizeToolPrefix } from './operations';
import { createCodingPlugin } from './coding';

const CORE_PANEL_TYPES = new Set(['sessions']);

export interface PluginRegistry {
  initialize(config: AppConfig, dataDir: string, options?: { configDir?: string }): Promise<void>;
  getTools(): PluginToolDefinition[];
  getHttpRoutes?(): HttpRouteHandler[];
  getManifests?(): CombinedPluginManifest[];
  getRegisteredPlugins?(): RegisteredPluginInfo[];
  getPluginPublicDir?(pluginId: string): string | null;
  getPanelEventHandler?(panelType: string): PanelEventHandler | undefined;
  handleSessionDeleted?(sessionId: string): Promise<void>;
  shutdown(): Promise<void>;
}

export interface RegisteredPluginInfo {
  pluginId: string;
  dataDir: string;
  pluginConfig: PluginsConfig[string];
  plugin: ToolPlugin;
  manifest?: CombinedPluginManifest;
}

interface RegisteredPlugin {
  pluginId: string;
  dataDir: string;
  pluginConfig: PluginsConfig[string];
  plugin: ToolPlugin;
  manifest?: CombinedPluginManifest;
  publicDir?: string;
}

interface PendingPlugin {
  name: string;
  plugin: ToolPlugin;
  pluginConfig: PluginsConfig[string];
  ids: string[];
  dependsOn: string[];
  manifest?: CombinedPluginManifest;
  publicDir?: string;
}

export class DefaultPluginRegistry implements PluginRegistry {
  private readonly factories: Map<string, () => ToolPlugin>;
  private plugins: RegisteredPlugin[] = [];
  private readonly panelEventHandlers = new Map<string, PanelEventHandler>();
  private readonly sessionDeletedHandlers = new Set<(sessionId: string) => Promise<void> | void>();
  private initialised = false;

  constructor() {
    this.factories = new Map<string, () => ToolPlugin>([['coding', createCodingPlugin]]);
  }

  private resolvePluginRoots(): string[] {
    const repoDistRoot = path.resolve(
      __dirname,
      '..',
      '..',
      '..',
      '..',
      '..',
      '..',
      'dist',
      'plugins',
    );
    const packageDistRoot = path.resolve(__dirname, '..', '..', '..', '..', 'dist', 'plugins');
    const cwdDistRoot = path.resolve(process.cwd(), 'dist', 'plugins');

    const roots: string[] = [];
    const addIfExists = (root: string) => {
      if (roots.includes(root)) {
        return;
      }
      if (existsSync(root)) {
        roots.push(root);
      }
    };

    if (existsSync(repoDistRoot)) {
      addIfExists(repoDistRoot);
      addIfExists(cwdDistRoot);
      return roots;
    }

    addIfExists(cwdDistRoot);
    addIfExists(packageDistRoot);

    if (roots.length > 0) {
      return roots;
    }

    return [repoDistRoot, cwdDistRoot, packageDistRoot];
  }

  private async pathExists(targetPath: string): Promise<boolean> {
    try {
      await fs.access(targetPath);
      return true;
    } catch {
      return false;
    }
  }

  private async findPluginPackage(
    pluginId: string,
    pluginConfig: PluginsConfig[string],
    configDir: string,
    roots: string[],
  ): Promise<{ rootDir: string; manifestPath: string } | null> {
    const sourcePath = pluginConfig?.source?.path;
    if (typeof sourcePath === 'string' && sourcePath.trim().length > 0) {
      const resolvedRoot = path.isAbsolute(sourcePath)
        ? sourcePath
        : path.resolve(configDir, sourcePath);
      const manifestPath = path.join(resolvedRoot, 'manifest.json');
      if (await this.pathExists(manifestPath)) {
        return { rootDir: resolvedRoot, manifestPath };
      }
      console.warn(
        `[plugins] Plugin "${pluginId}" source.path="${sourcePath}" did not include manifest.json`,
      );
      return null;
    }

    for (const root of roots) {
      const rootDir = path.join(root, pluginId);
      const manifestPath = path.join(rootDir, 'manifest.json');
      if (await this.pathExists(manifestPath)) {
        return { rootDir, manifestPath };
      }
    }

    return null;
  }

  private async readManifest(
    manifestPath: string,
  ): Promise<{ manifest?: CombinedPluginManifest; errors?: string[] }> {
    let raw: string;
    try {
      raw = await fs.readFile(manifestPath, 'utf8');
    } catch (err) {
      return { errors: [`Failed to read manifest: ${(err as Error).message}`] };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch (err) {
      return { errors: [`Manifest is not valid JSON: ${(err as Error).message}`] };
    }

    const result = CombinedPluginManifestSchema.safeParse(parsed);
    if (!result.success) {
      const errors = result.error.errors.map((issue) => {
        const pathLabel = issue.path.length > 0 ? issue.path.join('.') : 'manifest';
        return `${pathLabel}: ${issue.message}`;
      });
      return { errors };
    }

    return { manifest: result.data };
  }

  private async loadPluginModule(
    serverEntry: string,
    manifest: CombinedPluginManifest,
  ): Promise<PluginModule | null> {
    if (!(await this.pathExists(serverEntry))) {
      return null;
    }

    const moduleUrl = pathToFileURL(serverEntry).href;
    const imported = (await import(moduleUrl)) as Record<string, unknown>;
    const candidate = imported['createPlugin'] ?? imported['default'] ?? imported['plugin'] ?? null;

    if (!candidate) {
      return null;
    }

    const loaded =
      typeof candidate === 'function'
        ? await (candidate as (options: { manifest: CombinedPluginManifest }) => unknown)({
            manifest,
          })
        : candidate;

    if (!loaded || typeof loaded !== 'object') {
      throw new Error(`Invalid plugin module export at ${serverEntry}`);
    }

    return loaded as PluginModule;
  }

  private createToolPluginFromModule(
    manifest: CombinedPluginManifest,
    module: PluginModule | null,
  ): ToolPlugin {
    const operations = createPluginOperationSurface({
      manifest,
      handlers: module?.operations ?? {},
    });
    const hasOperations = Array.isArray(manifest.operations) && manifest.operations.length > 0;
    const tools = hasOperations
      ? operations.tools
      : Array.isArray(module?.tools)
        ? module?.tools
        : [];
    // Collect HTTP routes: operations routes + extra routes (for binary endpoints)
    const operationRoutes = hasOperations ? operations.httpRoutes : [];
    const extraRoutes = Array.isArray(module?.extraHttpRoutes) ? module.extraHttpRoutes : [];
    const legacyRoutes =
      !hasOperations && Array.isArray(module?.httpRoutes) ? module.httpRoutes : [];
    const httpRoutes = [...operationRoutes, ...extraRoutes, ...legacyRoutes];
    if (hasOperations) {
      if (module?.tools && module.tools.length > 0) {
        console.warn(
          `[plugins] Plugin "${manifest.id}" provided legacy tools; operations are used instead.`,
        );
      }
      if (module?.httpRoutes && module.httpRoutes.length > 0) {
        console.warn(
          `[plugins] Plugin "${manifest.id}" provided legacy HTTP routes; use extraHttpRoutes for additional endpoints.`,
        );
      }
    }
    return {
      name: manifest.id,
      manifest,
      tools,
      ...(module?.searchProvider ? { searchProvider: module.searchProvider } : {}),
      ...(module?.panelEventHandlers ? { panelEventHandlers: module.panelEventHandlers } : {}),
      ...(httpRoutes.length > 0 ? { httpRoutes } : {}),
      initialize: module?.initialize ?? (async () => {}),
      ...(module?.shutdown ? { shutdown: module.shutdown } : {}),
      ...(module?.prepareGitSnapshot ? { prepareGitSnapshot: module.prepareGitSnapshot } : {}),
      ...(module?.onSessionDeleted ? { onSessionDeleted: module.onSessionDeleted } : {}),
    };
  }

  private resolvePluginDataDir(baseDir: string, plugin: ToolPlugin): string {
    const manifestDir = plugin.manifest?.server?.dataDir;
    if (manifestDir && manifestDir.trim().length > 0) {
      return path.isAbsolute(manifestDir) ? manifestDir : path.join(baseDir, manifestDir);
    }

    const pluginId = plugin.manifest?.id ?? plugin.name;
    return path.join(baseDir, 'plugins', pluginId);
  }

  async initialize(
    config: AppConfig,
    dataDir: string,
    options?: { configDir?: string },
  ): Promise<void> {
    if (this.initialised) {
      return;
    }
    this.initialised = true;

    const pluginsConfig: PluginsConfig = config.plugins;
    const configDir = options?.configDir ?? process.cwd();
    const pluginRoots = this.resolvePluginRoots();

    const pending: PendingPlugin[] = [];
    const availableIds = new Set<string>();
    const unknownPlugins: string[] = [];
    const dependencyIssues: Array<{
      plugin: string;
      missing: string[];
      reason: 'not_enabled' | 'unresolved';
    }> = [];
    const manifestIssues: Array<{ plugin: string; errors: string[] }> = [];
    const toolPrefixOwners = new Map<string, string>();

    const registerToolPrefix = (manifest: CombinedPluginManifest, pluginLabel: string): boolean => {
      const hasOperations = Array.isArray(manifest.operations) && manifest.operations.length > 0;
      if (!hasOperations || manifest.surfaces?.tool === false) {
        return true;
      }
      const normalized = normalizeToolPrefix(manifest.id);
      const existing = toolPrefixOwners.get(normalized);
      if (existing && existing !== manifest.id) {
        manifestIssues.push({
          plugin: pluginLabel,
          errors: [
            `tool prefix "${normalized}" collides with plugin "${existing}" (normalize plugin ids or rename)`,
          ],
        });
        return false;
      }
      toolPrefixOwners.set(normalized, manifest.id);
      return true;
    };

    for (const [name, pluginConfig] of Object.entries(pluginsConfig)) {
      if (!pluginConfig?.enabled) {
        continue;
      }

      let plugin: ToolPlugin | null = null;
      let manifest: CombinedPluginManifest | undefined;
      let publicDir: string | undefined;

      const packageInfo = await this.findPluginPackage(name, pluginConfig, configDir, pluginRoots);
      if (packageInfo) {
        const manifestResult = await this.readManifest(packageInfo.manifestPath);
        if (!manifestResult.manifest) {
          manifestIssues.push({
            plugin: name,
            errors: manifestResult.errors ?? ['Manifest is invalid'],
          });
          continue;
        }

        if (manifestResult.manifest.id !== name) {
          manifestIssues.push({
            plugin: name,
            errors: [
              `manifest.id "${manifestResult.manifest.id}" does not match plugin key "${name}"`,
            ],
          });
          continue;
        }

        manifest = manifestResult.manifest;
        if (!registerToolPrefix(manifest, name)) {
          continue;
        }
        const serverEntry = path.join(packageInfo.rootDir, 'server.js');

        try {
          const module = await this.loadPluginModule(serverEntry, manifest);
          plugin = this.createToolPluginFromModule(manifest, module);
          publicDir = path.join(packageInfo.rootDir, 'public');
        } catch (err) {
          console.error(`Failed to load plugin "${name}" from ${packageInfo.rootDir}:`, err);
          continue;
        }
      } else {
        const factory = this.factories.get(name);
        if (!factory) {
          unknownPlugins.push(name);
          continue;
        }

        try {
          plugin = factory();
          manifest = plugin.manifest;
          if (manifest && !registerToolPrefix(manifest, name)) {
            continue;
          }
        } catch (err) {
          console.error(`Failed to instantiate plugin "${name}":`, err);
          continue;
        }
      }

      if (!plugin) {
        continue;
      }

      const ids = new Set<string>([plugin.name, manifest?.id].filter(Boolean) as string[]);
      const dependsOn = manifest?.server?.dependsOn ?? [];
      if (plugin.onSessionDeleted) {
        this.sessionDeletedHandlers.add(plugin.onSessionDeleted);
      }

      for (const id of ids) {
        availableIds.add(id);
      }

      const pendingEntry: PendingPlugin = {
        name,
        plugin,
        pluginConfig,
        ids: Array.from(ids),
        dependsOn,
      };
      if (manifest) {
        pendingEntry.manifest = manifest;
      }
      if (publicDir) {
        pendingEntry.publicDir = publicDir;
      }
      pending.push(pendingEntry);
    }

    const registrations: RegisteredPlugin[] = [];
    const activeIds = new Set<string>();
    let remaining = pending;
    let madeProgress = true;

    while (remaining.length > 0 && madeProgress) {
      madeProgress = false;
      const nextRemaining: PendingPlugin[] = [];

      for (const entry of remaining) {
        const missing = entry.dependsOn.filter((dep) => !activeIds.has(dep));
        const unknown = missing.filter((dep) => !availableIds.has(dep));

        if (unknown.length > 0) {
          dependencyIssues.push({ plugin: entry.name, missing: unknown, reason: 'not_enabled' });
          continue;
        }

        if (missing.length > 0) {
          nextRemaining.push(entry);
          continue;
        }

        try {
          const pluginDataDir = this.resolvePluginDataDir(dataDir, entry.plugin);
          await entry.plugin.initialize(pluginDataDir, entry.pluginConfig);
          const registration: RegisteredPlugin = {
            pluginId: entry.name,
            dataDir: pluginDataDir,
            pluginConfig: entry.pluginConfig,
            plugin: entry.plugin,
          };
          if (entry.publicDir) {
            registration.publicDir = entry.publicDir;
          }
          registrations.push(registration);
          this.registerPanelEventHandlers(entry.plugin);
          for (const id of entry.ids) {
            activeIds.add(id);
          }
          madeProgress = true;
        } catch (err) {
          console.error(`Failed to initialise plugin "${entry.name}":`, err);
        }
      }

      remaining = nextRemaining;
    }

    if (remaining.length > 0) {
      for (const entry of remaining) {
        const unresolved = entry.dependsOn.filter((dep) => !activeIds.has(dep));
        if (unresolved.length > 0) {
          dependencyIssues.push({
            plugin: entry.name,
            missing: unresolved,
            reason: 'unresolved',
          });
        }
      }
    }

    this.plugins = registrations;

    for (const registration of registrations) {
      const manifest = registration.plugin.manifest;
      if (!manifest) {
        continue;
      }
      const result = CombinedPluginManifestSchema.safeParse(manifest);
      if (!result.success) {
        const pluginLabel =
          typeof manifest.id === 'string' && manifest.id.trim().length > 0
            ? manifest.id
            : registration.plugin.name;
        const errors = result.error.errors.map((issue) => {
          const path = issue.path.length > 0 ? issue.path.join('.') : 'manifest';
          return `${path}: ${issue.message}`;
        });
        manifestIssues.push({ plugin: pluginLabel, errors });
        continue;
      }
      registration.manifest = result.data;
    }

    const assetIssues: Array<{ plugin: string; panels: string[] }> = [];
    for (const registration of registrations) {
      const manifest = registration.manifest;
      if (!manifest?.panels || manifest.panels.length === 0) {
        continue;
      }
      const panelTypes = manifest.panels
        .map((panel) => panel.type)
        .filter((type) => !CORE_PANEL_TYPES.has(type));
      if (panelTypes.length === 0) {
        continue;
      }
      const bundlePath = manifest.web?.bundlePath?.trim() ?? '';
      if (!bundlePath) {
        assetIssues.push({ plugin: manifest.id ?? registration.plugin.name, panels: panelTypes });
      }
    }

    const issueLines: string[] = [];
    if (unknownPlugins.length > 0) {
      issueLines.push(`Unknown plugins in config: ${unknownPlugins.join(', ')}`);
    }
    for (const issue of dependencyIssues) {
      if (issue.reason === 'not_enabled') {
        issueLines.push(
          `Plugin "${issue.plugin}" requires ${issue.missing.join(', ')} but they are not enabled.`,
        );
      } else {
        issueLines.push(
          `Plugin "${issue.plugin}" dependencies could not be resolved: ${issue.missing.join(', ')}.`,
        );
      }
    }
    for (const issue of assetIssues) {
      issueLines.push(
        `Plugin "${issue.plugin}" defines panels (${issue.panels.join(
          ', ',
        )}) but does not declare web.bundlePath.`,
      );
    }
    for (const issue of manifestIssues) {
      issueLines.push(`Plugin "${issue.plugin}" manifest is invalid: ${issue.errors.join('; ')}`);
    }
    if (issueLines.length > 0) {
      console.warn(`[plugins] Configuration issues detected:\n- ${issueLines.join('\n- ')}`);
    }
  }

  getPanelEventHandler(panelType: string): PanelEventHandler | undefined {
    return this.panelEventHandlers.get(panelType);
  }

  async handleSessionDeleted(sessionId: string): Promise<void> {
    const handlers = Array.from(this.sessionDeletedHandlers);
    for (const handler of handlers) {
      try {
        await handler(sessionId);
      } catch (err) {
        console.error('[plugins] Failed to handle session deletion', err);
      }
    }
  }

  getTools(): PluginToolDefinition[] {
    const tools: PluginToolDefinition[] = [];
    for (const registration of this.plugins) {
      tools.push(...registration.plugin.tools);
    }
    return tools;
  }

  getHttpRoutes(): HttpRouteHandler[] {
    const routes: HttpRouteHandler[] = [];
    for (const registration of this.plugins) {
      const pluginRoutes = registration.plugin.httpRoutes;
      if (pluginRoutes && pluginRoutes.length > 0) {
        routes.push(...pluginRoutes);
      }
    }
    return routes;
  }

  getRegisteredPlugins(): RegisteredPluginInfo[] {
    return this.plugins.map((registration) => ({
      pluginId: registration.pluginId,
      dataDir: registration.dataDir,
      pluginConfig: registration.pluginConfig,
      plugin: registration.plugin,
      ...(registration.manifest ? { manifest: registration.manifest } : {}),
    }));
  }

  getManifests(): CombinedPluginManifest[] {
    const manifests: CombinedPluginManifest[] = [];
    for (const registration of this.plugins) {
      const manifest = registration.manifest;
      if (manifest) {
        manifests.push(manifest);
      }
    }
    return manifests;
  }

  getPluginPublicDir(pluginId: string): string | null {
    const entry = this.plugins.find((registration) => {
      const manifestId = registration.manifest?.id ?? registration.plugin.manifest?.id;
      return manifestId === pluginId || registration.plugin.name === pluginId;
    });
    if (!entry?.publicDir) {
      return null;
    }
    return entry.publicDir;
  }

  private registerPanelEventHandlers(plugin: ToolPlugin): void {
    const handlers = plugin.panelEventHandlers;
    if (!handlers) {
      return;
    }
    for (const [panelType, handler] of Object.entries(handlers)) {
      if (typeof panelType !== 'string' || panelType.trim().length === 0) {
        continue;
      }
      if (this.panelEventHandlers.has(panelType)) {
        console.warn(`Panel event handler already registered for type "${panelType}"`);
        continue;
      }
      this.panelEventHandlers.set(panelType, handler);
    }
  }

  async shutdown(): Promise<void> {
    for (const registration of this.plugins) {
      const plugin = registration.plugin;
      if (!plugin.shutdown) {
        continue;
      }
      try {
        await plugin.shutdown();
      } catch (err) {
        console.error(`Error while shutting down plugin "${plugin.name}":`, err);
      }
    }
    this.plugins = [];
    this.initialised = false;
  }
}

export class PluginToolHost implements ToolHost {
  private readonly registry: PluginRegistry;

  constructor(registry: PluginRegistry) {
    this.registry = registry;
  }

  private inferCapabilities(tool: PluginToolDefinition): string[] | undefined {
    if (tool.capabilities && tool.capabilities.length > 0) {
      return tool.capabilities;
    }
    return undefined;
  }

  async listTools(): Promise<Tool[]> {
    const pluginTools = this.registry.getTools();
    const tools: Tool[] = [];

    for (const tool of pluginTools) {
      const capabilities = this.inferCapabilities(tool);
      tools.push({
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
        ...(capabilities ? { capabilities } : {}),
      });
    }

    return tools;
  }

  async callTool(name: string, argsJson: string, ctx: ToolContext): Promise<unknown> {
    const tools = this.registry.getTools();
    const tool = tools.find((t) => t.name === name);
    if (!tool) {
      throw new ToolError('tool_not_found', `Tool not found in plugin registry: ${name}`);
    }

    let args: unknown;
    try {
      const trimmed = argsJson.trim();
      args = trimmed ? JSON.parse(trimmed) : {};
    } catch {
      throw new ToolError('invalid_arguments', 'Tool arguments were not valid JSON');
    }

    return tool.handler(args as Record<string, unknown>, ctx);
  }
}
