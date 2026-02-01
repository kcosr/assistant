import type { HttpRouteHandler } from '../types';
import {
  PanelInventoryWindowError,
  getSelectedPanels,
  listPanels,
} from '../../panels/panelInventoryStore';

function parseBooleanParam(value: string | null): boolean | undefined {
  if (value === null) {
    return undefined;
  }
  const trimmed = value.trim().toLowerCase();
  if (trimmed === 'true' || trimmed === '1') {
    return true;
  }
  if (trimmed === 'false' || trimmed === '0') {
    return false;
  }
  return undefined;
}

export const handlePanelRoutes: HttpRouteHandler = async (
  _context,
  req,
  _res,
  url,
  segments,
  helpers,
) => {
  const { sendJson } = helpers;

  if (segments.length < 2 || segments[0] !== 'api' || segments[1] !== 'panels') {
    return false;
  }

  const includeChat = parseBooleanParam(url.searchParams.get('includeChat'));
  const includeContext = parseBooleanParam(url.searchParams.get('includeContext'));
  const windowId = url.searchParams.get('windowId');

  if (url.searchParams.has('includeChat') && includeChat === undefined) {
    sendJson(400, { error: 'includeChat must be a boolean' });
    return true;
  }

  if (url.searchParams.has('includeContext') && includeContext === undefined) {
    sendJson(400, { error: 'includeContext must be a boolean' });
    return true;
  }

  const options = {
    ...(includeChat !== undefined ? { includeChat } : {}),
    ...(includeContext !== undefined ? { includeContext } : {}),
    ...(windowId ? { windowId } : {}),
  };

  if (req.method === 'GET' && segments.length === 2) {
    try {
      const result = listPanels(options);
      sendJson(200, result);
    } catch (err) {
      if (err instanceof PanelInventoryWindowError) {
        sendJson(400, {
          error: err.message,
          code: err.code,
          windows: err.windows,
        });
      } else {
        sendJson(500, { error: 'Failed to load panels' });
      }
    }
    return true;
  }

  if (req.method === 'GET' && segments.length === 3 && segments[2] === 'selected') {
    try {
      const result = getSelectedPanels(options);
      sendJson(200, result);
    } catch (err) {
      if (err instanceof PanelInventoryWindowError) {
        sendJson(400, {
          error: err.message,
          code: err.code,
          windows: err.windows,
        });
      } else {
        sendJson(500, { error: 'Failed to load panels' });
      }
    }
    return true;
  }

  sendJson(404, { error: 'Not found' });
  return true;
};
