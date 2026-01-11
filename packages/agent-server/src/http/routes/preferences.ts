import type { HttpRouteHandler } from '../types';
import { parsePreferences, parsePreferencesPatch } from '../../preferences/preferencesStore';

export const handlePreferencesRoutes: HttpRouteHandler = async (
  context,
  req,
  _res,
  url,
  _segments,
  helpers,
) => {
  const { sendJson, readJsonBody } = helpers;
  const { pathname } = url;

  if (pathname !== '/preferences') {
    return false;
  }

  if (req.method === 'GET') {
    const prefs = await context.preferencesStore.getPreferences();
    sendJson(200, prefs);
    return true;
  }

  if (req.method === 'PATCH') {
    const body = await readJsonBody();
    if (!body) {
      return true;
    }

    let patch;
    try {
      patch = parsePreferencesPatch(body);
    } catch (err) {
      sendJson(400, { error: (err as Error).message || 'Invalid preferences payload' });
      return true;
    }

    const updated = await context.preferencesStore.updatePreferences(patch);
    sendJson(200, updated);
    return true;
  }

  if (req.method === 'PUT') {
    const body = await readJsonBody();
    if (!body) {
      return true;
    }

    let full;
    try {
      full = parsePreferences(body);
    } catch (err) {
      sendJson(400, { error: (err as Error).message || 'Invalid preferences payload' });
      return true;
    }

    const updated = await context.preferencesStore.setPreferences(full);
    sendJson(200, updated);
    return true;
  }

  return false;
};
