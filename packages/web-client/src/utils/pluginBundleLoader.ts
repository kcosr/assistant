import type { CombinedPluginManifest } from '@assistant/shared';

import type { PanelFactory, PanelRegistry } from '../controllers/panelRegistry';
import { getApiBaseUrl } from './api';
import { isTauri } from './tauri';

export interface PluginPanelRegistryApi {
  registerPanel: (panelType: string, factory: PanelFactory) => void;
}

declare global {
  interface Window {
    ASSISTANT_PANEL_REGISTRY?: PluginPanelRegistryApi;
  }
}

export interface PluginBundleLoaderOptions {
  panelRegistry: PanelRegistry;
  onPanelRegistered?: (panelType: string) => void;
}

export class PluginBundleLoader {
  private readonly loadedScripts = new Map<string, Promise<void>>();
  private readonly loadedStyles = new Set<string>();

  constructor(private readonly options: PluginBundleLoaderOptions) {}

  installGlobalRegistry(): void {
    window.ASSISTANT_PANEL_REGISTRY = {
      registerPanel: (panelType, factory) => {
        this.registerPanel(panelType, factory);
      },
    };
  }

  loadFromManifests(manifests: CombinedPluginManifest[]): void {
    for (const manifest of manifests) {
      const web = manifest.web;
      if (!web) {
        continue;
      }
      if (web.stylesPath) {
        this.loadStyles(manifest.id, web.stylesPath);
      }
      if (web.bundlePath) {
        this.loadBundle(manifest.id, web.bundlePath);
      }
    }
  }

  private registerPanel(panelType: string, factory: PanelFactory): void {
    const manifest = this.options.panelRegistry.getManifest(panelType);
    if (!manifest) {
      console.warn(`Ignoring panel registration for unknown type "${panelType}".`);
      return;
    }
    this.options.panelRegistry.registerOrReplace(manifest, factory);
    this.options.onPanelRegistered?.(panelType);
  }

  private loadBundle(pluginId: string, bundlePath: string): void {
    const urls = resolvePluginAssetUrls(bundlePath);
    if (urls.length === 0) {
      return;
    }
    this.loadScriptWithFallback(pluginId, urls, 0);
  }

  private loadStyles(pluginId: string, stylesPath: string): void {
    const urls = resolvePluginAssetUrls(stylesPath);
    if (urls.length === 0) {
      return;
    }
    this.loadStylesWithFallback(pluginId, urls, 0);
  }

  private loadScriptWithFallback(pluginId: string, urls: string[], index: number): void {
    if (index >= urls.length) {
      console.error(`Failed to load plugin bundle for "${pluginId}"`, urls);
      return;
    }
    const url = urls[index];
    if (!url) {
      this.loadScriptWithFallback(pluginId, urls, index + 1);
      return;
    }
    const existing = this.loadedScripts.get(url);
    if (existing) {
      void existing.catch(() => {
        this.loadScriptWithFallback(pluginId, urls, index + 1);
      });
      return;
    }

    const promise = new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = url;
      script.async = true;
      script.defer = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(`Failed to load plugin bundle for "${pluginId}"`));
      document.head.appendChild(script);
    });
    this.loadedScripts.set(url, promise);
    void promise.catch(() => {
      this.loadScriptWithFallback(pluginId, urls, index + 1);
    });
  }

  private loadStylesWithFallback(pluginId: string, urls: string[], index: number): void {
    if (index >= urls.length) {
      console.error(`Failed to load plugin styles for "${pluginId}"`, urls);
      return;
    }
    const url = urls[index];
    if (!url) {
      this.loadStylesWithFallback(pluginId, urls, index + 1);
      return;
    }
    if (this.loadedStyles.has(url)) {
      return;
    }
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = url;
    link.onload = () => undefined;
    link.onerror = () => {
      this.loadStylesWithFallback(pluginId, urls, index + 1);
    };
    document.head.appendChild(link);
    this.loadedStyles.add(url);
  }
}

const PROTOCOL_RE = /^[a-z][a-z0-9+.-]*:/i;

function getPluginAssetBaseUrls(): string[] {
  const bases: string[] = [];
  if (isTauri()) {
    const origin = window.location.origin;
    if (origin && origin !== 'null') {
      bases.push(origin);
    } else if (window.location.protocol && window.location.host) {
      bases.push(`${window.location.protocol}//${window.location.host}`);
    }
  }
  bases.push(getApiBaseUrl());
  return Array.from(new Set(bases.filter(Boolean)));
}

function resolvePluginAssetUrls(path: string): string[] {
  const trimmed = path.trim();
  if (!trimmed) {
    return [];
  }
  if (PROTOCOL_RE.test(trimmed)) {
    return [trimmed];
  }
  if (trimmed.startsWith('//')) {
    return [`${window.location.protocol}${trimmed}`];
  }
  const bases = getPluginAssetBaseUrls();
  const urls = bases.map((base) =>
    trimmed.startsWith('/') ? `${base}${trimmed}` : `${base}/${trimmed}`,
  );
  return Array.from(new Set(urls.filter(Boolean)));
}
