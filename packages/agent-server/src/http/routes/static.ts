import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import type { HttpRouteHandler } from '../types';

type StaticFileOptions = {
  revalidate?: boolean;
  ifNoneMatch?: string;
};

async function serveStaticFile(
  res: import('node:http').ServerResponse,
  filePath: string,
  contentType: string,
  options: StaticFileOptions = {},
): Promise<void> {
  try {
    const data = await fs.readFile(filePath);
    res.setHeader('Content-Type', contentType);
    if (options.revalidate) {
      const etag = `"${createHash('sha256').update(data).digest('base64url')}"`;
      res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
      res.setHeader('ETag', etag);
      const requestedEtags = options.ifNoneMatch?.split(',').map((value) => value.trim()) ?? [];
      if (requestedEtags.includes(etag) || requestedEtags.includes('*')) {
        res.statusCode = 304;
        res.end();
        return;
      }
    }
    res.statusCode = 200;
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
    case '.woff2':
      return 'font/woff2';
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

  if (req.method === 'GET' && pathname.startsWith('/fonts/')) {
    const fontsDir = path.join(context.webClientPublicDir, 'fonts');
    const assetPath = pathname.slice('/fonts/'.length);
    const filePath = path.resolve(fontsDir, assetPath);
    const safePath = path.relative(fontsDir, filePath);
    if (!assetPath || safePath.startsWith('..') || path.isAbsolute(safePath)) {
      res.statusCode = 403;
      res.end('Forbidden');
      return true;
    }
    await serveStaticFile(res, filePath, getContentType(filePath), {
      revalidate: true,
      ifNoneMatch: req.headers['if-none-match'],
    });
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
