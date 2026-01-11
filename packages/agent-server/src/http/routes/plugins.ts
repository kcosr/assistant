import type { CombinedPluginManifest } from '@assistant/shared';

import type { HttpRouteHandler } from '../types';
import { parsePluginSettings, parsePluginSettingsPatch } from '../../plugins/pluginSettingsStore';

export const handlePluginRoutes: HttpRouteHandler = async (
  context,
  req,
  _res,
  _url,
  segments,
  helpers,
) => {
  if (segments.length < 2 || segments[0] !== 'api' || segments[1] !== 'plugins') {
    return false;
  }

  if (segments.length === 2 && req.method === 'GET') {
    const manifests = context.pluginRegistry?.getManifests?.() ?? ([] as CombinedPluginManifest[]);

    helpers.sendJson(200, { plugins: manifests });
    return true;
  }

  if (segments.length === 4 && segments[3] === 'settings') {
    const pluginId = decodeURIComponent(segments[2] ?? '');
    if (!pluginId) {
      helpers.sendJson(400, { error: 'Plugin id is required' });
      return true;
    }

    if (req.method === 'GET') {
      const settings = await context.pluginSettingsStore.getSettings(pluginId);
      helpers.sendJson(200, settings);
      return true;
    }

    if (req.method === 'PATCH') {
      const body = await helpers.readJsonBody();
      if (!body) {
        return true;
      }

      let patch;
      try {
        patch = parsePluginSettingsPatch(body);
      } catch (err) {
        helpers.sendJson(400, {
          error: (err as Error).message || 'Invalid plugin settings patch',
        });
        return true;
      }

      const updated = await context.pluginSettingsStore.updateSettings(pluginId, patch);
      helpers.sendJson(200, updated);
      return true;
    }

    if (req.method === 'PUT') {
      const body = await helpers.readJsonBody();
      if (!body) {
        return true;
      }

      let full;
      try {
        full = parsePluginSettings(body);
      } catch (err) {
        helpers.sendJson(400, {
          error: (err as Error).message || 'Invalid plugin settings payload',
        });
        return true;
      }

      if (!full.settings) {
        helpers.sendJson(400, { error: 'Plugin settings must include a settings object' });
        return true;
      }

      const updated = await context.pluginSettingsStore.setSettings(pluginId, full);
      helpers.sendJson(200, updated);
      return true;
    }
  }

  return false;
};
