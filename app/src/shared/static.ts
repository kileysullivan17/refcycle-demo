// Static files from app/public. No build step, no CDN: everything the browser runs is served from here.
import { readFile, stat } from 'node:fs/promises';
import type { ServerResponse } from 'node:http';
import path from 'node:path';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.ico': 'image/x-icon',
};

// The only outside origin the browser may load from is the OpenStreetMap tile server (contracts 7.4).
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "img-src 'self' data: blob: https://tile.openstreetmap.org",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "style-src 'self'",
  "script-src 'self'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

function securityHeaders(res: ServerResponse): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', CONTENT_SECURITY_POLICY);
  res.setHeader('Permissions-Policy', 'camera=(self), geolocation=(), microphone=()');
}

/** Serves one file from the public folder. Returns false when the path is not a file inside it. */
export async function serveStatic(res: ServerResponse, publicDir: string, urlPath: string, headOnly = false): Promise<boolean> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return false;
  }
  if (decoded.includes('\0')) return false;
  const file = path.resolve(publicDir, '.' + path.posix.normalize('/' + decoded));
  if (file !== publicDir && !file.startsWith(publicDir + path.sep)) return false;
  const type = TYPES[path.extname(file).toLowerCase()];
  if (!type) return false;
  try {
    const info = await stat(file);
    if (!info.isFile()) return false;
    const content = await readFile(file);
    res.statusCode = 200;
    res.setHeader('Content-Type', type);
    res.setHeader('Cache-Control', 'no-cache');
    securityHeaders(res);
    res.end(headOnly ? undefined : content);
    return true;
  } catch {
    return false;
  }
}

export async function serveIndex(res: ServerResponse, publicDir: string, headOnly = false): Promise<void> {
  const ok = await serveStatic(res, publicDir, '/index.html', headOnly);
  if (!ok) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'App shell is missing' }));
  }
}
