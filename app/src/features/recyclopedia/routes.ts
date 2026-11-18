// Recyclopedia server routes: GET /api/catalog (contracts 5.1).
import type { IncomingMessage, ServerResponse } from 'node:http';
import { contextOf } from '../../shared/feature.ts';
import { sendJson } from '../../shared/http.ts';
import { getCatalog } from './catalog.ts';

export async function handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  if (url.pathname !== '/api/catalog' || req.method !== 'GET') return false;
  try {
    const catalog = await getCatalog(contextOf(req).catalogJson);
    sendJson(res, 200, { categories: catalog.categories, entries: catalog.entries });
  } catch {
    console.error('Catalog could not be loaded');
    sendJson(res, 500, { error: 'Catalog could not be loaded' });
  }
  return true;
}
