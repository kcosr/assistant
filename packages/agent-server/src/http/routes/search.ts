import type { HttpRouteHandler } from '../types';

export const handleSearchRoutes: HttpRouteHandler = async (
  context,
  req,
  _res,
  url,
  segments,
  helpers,
) => {
  if (segments.length < 2 || segments[0] !== 'api' || segments[1] !== 'search') {
    return false;
  }

  const { sendJson } = helpers;
  const searchService = context.searchService;
  if (!searchService) {
    sendJson(503, { error: 'Search service unavailable' });
    return true;
  }

  if (req.method !== 'GET') {
    sendJson(405, { error: 'Method not allowed' });
    return true;
  }

  if (segments.length === 3 && segments[2] === 'scopes') {
    sendJson(200, { scopes: searchService.getSearchableScopes() });
    return true;
  }

  if (segments.length === 2) {
    const rawQuery = url.searchParams.get('q');
    const query = rawQuery?.trim() ?? '';
    const scope = url.searchParams.get('scope')?.trim() ?? '';
    const instance = url.searchParams.get('instance')?.trim() ?? '';
    if (!query && !scope) {
      sendJson(400, { error: 'q is required' });
      return true;
    }
    const limitParam = url.searchParams.get('limit');
    let limit: number | undefined;
    if (limitParam !== null) {
      const parsed = Number(limitParam);
      if (!Number.isFinite(parsed) || parsed < 0) {
        sendJson(400, { error: 'limit must be a non-negative number' });
        return true;
      }
      limit = parsed;
    }

    const response = await searchService.search({
      query,
      ...(scope ? { scope } : {}),
      ...(instance ? { instance } : {}),
      ...(limit !== undefined ? { limit } : {}),
    });
    sendJson(200, response);
    return true;
  }

  sendJson(404, { error: 'Not found' });
  return true;
};
