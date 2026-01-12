// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';

import type { PanelRegistry } from '../controllers/panelRegistry';
import type { CombinedPluginManifest } from '@assistant/shared';
import { PluginBundleLoader } from './pluginBundleLoader';

const panelRegistryStub = {
  getManifest: () => null,
  registerOrReplace: () => undefined,
  listManifests: () => [],
} as unknown as PanelRegistry;

function clearHead(): void {
  document.head.innerHTML = '';
}

describe('PluginBundleLoader asset base', () => {
  beforeEach(() => {
    clearHead();
    delete (window as { ASSISTANT_API_HOST?: string }).ASSISTANT_API_HOST;
    delete (window as { ASSISTANT_INSECURE?: boolean }).ASSISTANT_INSECURE;
    delete (window as { __TAURI__?: unknown }).__TAURI__;
  });

  it('uses the local origin in Tauri mode', () => {
    (window as { __TAURI__?: unknown }).__TAURI__ = {};
    (window as { ASSISTANT_API_HOST?: string }).ASSISTANT_API_HOST = 'localhost:59071';
    (window as { ASSISTANT_INSECURE?: boolean }).ASSISTANT_INSECURE = true;
    const loader = new PluginBundleLoader({ panelRegistry: panelRegistryStub });
    loader.loadFromManifests([
      {
        id: 'lists',
        web: { bundlePath: '/plugins/lists/bundle.js' },
      } as CombinedPluginManifest,
    ]);

    const script = document.head.querySelector('script') as HTMLScriptElement | null;
    expect(script?.src).toBe(`${window.location.origin}/plugins/lists/bundle.js`);
  });

  it('falls back to the API base when local bundle fails in Tauri', async () => {
    (window as { __TAURI__?: unknown }).__TAURI__ = {};
    (window as { ASSISTANT_API_HOST?: string }).ASSISTANT_API_HOST = 'localhost:59071';
    (window as { ASSISTANT_INSECURE?: boolean }).ASSISTANT_INSECURE = true;
    const loader = new PluginBundleLoader({ panelRegistry: panelRegistryStub });
    loader.loadFromManifests([
      {
        id: 'lists',
        web: { bundlePath: '/plugins/lists/bundle.js' },
      } as CombinedPluginManifest,
    ]);

    const firstScript = document.head.querySelector('script') as HTMLScriptElement | null;
    expect(firstScript?.src).toBe(`${window.location.origin}/plugins/lists/bundle.js`);
    firstScript?.onerror?.(new Event('error'));
    await Promise.resolve();

    const scripts = Array.from(document.head.querySelectorAll('script'));
    expect(scripts).toHaveLength(2);
    expect(scripts[1]?.src).toBe('http://localhost:59071/plugins/lists/bundle.js');
  });

  it('uses the API base outside Tauri', () => {
    (window as { ASSISTANT_API_HOST?: string }).ASSISTANT_API_HOST = 'localhost:59071';
    (window as { ASSISTANT_INSECURE?: boolean }).ASSISTANT_INSECURE = true;
    const loader = new PluginBundleLoader({ panelRegistry: panelRegistryStub });
    loader.loadFromManifests([
      {
        id: 'lists',
        web: { bundlePath: '/plugins/lists/bundle.js' },
      } as CombinedPluginManifest,
    ]);

    const script = document.head.querySelector('script') as HTMLScriptElement | null;
    expect(script?.src).toBe('http://localhost:59071/plugins/lists/bundle.js');
  });
});
