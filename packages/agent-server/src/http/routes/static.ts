import fs from 'node:fs/promises';
import path from 'node:path';

import type { HttpRouteHandler } from '../types';

async function serveStaticFile(
  res: import('node:http').ServerResponse,
  filePath: string,
  contentType: string,
): Promise<void> {
  try {
    const data = await fs.readFile(filePath);
    res.statusCode = 200;
    res.setHeader('Content-Type', contentType);
    res.end(data);
  } catch {
    res.statusCode = 404;
    res.end('Not found');
  }
}

function getContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.js':
      return 'text/javascript; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.json':
    case '.map':
      return 'application/json; charset=utf-8';
    case '.md':
      return 'text/markdown; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    default:
      return 'application/octet-stream';
  }
}

export const handleStaticRoutes: HttpRouteHandler = async (context, req, res, url) => {
  const { pathname } = url;

  if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
    const indexPath = path.join(context.webClientPublicDir, 'index.html');
    await serveStaticFile(res, indexPath, 'text/html; charset=utf-8');
    return true;
  }

  if (req.method === 'GET' && pathname === '/client.js') {
    const clientJsPath = path.join(context.webClientDistDir, 'client.js');
    await serveStaticFile(res, clientJsPath, 'text/javascript; charset=utf-8');
    return true;
  }

  if (req.method === 'GET' && pathname === '/styles.css') {
    const stylesPath = path.join(context.webClientPublicDir, 'styles.css');
    await serveStaticFile(res, stylesPath, 'text/css; charset=utf-8');
    return true;
  }

  if (req.method === 'GET' && pathname.startsWith('/plugins/')) {
    const relativePath = pathname.replace(/^\/+/, '');
    const parts = relativePath.split('/').filter((segment) => segment.length > 0);
    const pluginId = parts[1];
    const assetPath = parts.slice(2).join('/');

    if (pluginId && assetPath && context.pluginRegistry?.getPluginPublicDir) {
      const pluginPublicDir = context.pluginRegistry.getPluginPublicDir(pluginId);
      if (pluginPublicDir) {
        const filePath = path.resolve(pluginPublicDir, assetPath);
        const safePath = path.relative(pluginPublicDir, filePath);
        if (!safePath.startsWith('..') && !path.isAbsolute(safePath)) {
          await serveStaticFile(res, filePath, getContentType(filePath));
          return true;
        }
      }
    }

    const filePath = path.resolve(context.webClientPublicDir, relativePath);
    const safePath = path.relative(context.webClientPublicDir, filePath);
    if (safePath.startsWith('..') || path.isAbsolute(safePath)) {
      res.statusCode = 403;
      res.end('Forbidden');
      return true;
    }
    await serveStaticFile(res, filePath, getContentType(filePath));
    return true;
  }

  return false;
};
