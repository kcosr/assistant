import type { CombinedPluginManifest } from '@assistant/shared';

import type { PanelFactory, PanelRegistry } from '../controllers/panelRegistry';
import { getApiBaseUrl } from './api';

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
    const url = resolvePluginAssetUrl(bundlePath);
    if (!url || this.loadedScripts.has(url)) {
      return;
    }
    const promise = new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = url;
      script.async = true;
      script.defer = true;
      script.onload = () => resolve();
      script.onerror = () => {
        console.error(`Failed to load plugin bundle for "${pluginId}"`, url);
        reject(new Error(`Failed to load plugin bundle for "${pluginId}"`));
      };
      document.head.appendChild(script);
    });
    this.loadedScripts.set(url, promise);
    void promise.catch(() => undefined);
  }

  private loadStyles(pluginId: string, stylesPath: string): void {
    const url = resolvePluginAssetUrl(stylesPath);
    if (!url || this.loadedStyles.has(url)) {
      return;
    }
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = url;
    link.onload = () => undefined;
    link.onerror = () => {
      console.error(`Failed to load plugin styles for "${pluginId}"`, url);
    };
    document.head.appendChild(link);
    this.loadedStyles.add(url);
  }
}

const PROTOCOL_RE = /^[a-z][a-z0-9+.-]*:/i;

function resolvePluginAssetUrl(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) {
    return '';
  }
  if (PROTOCOL_RE.test(trimmed)) {
    return trimmed;
  }
  if (trimmed.startsWith('//')) {
    return `${window.location.protocol}${trimmed}`;
  }
  const base = getApiBaseUrl();
  return trimmed.startsWith('/') ? `${base}${trimmed}` : `${base}/${trimmed}`;
}
