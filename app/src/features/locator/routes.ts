// Locator server route: GET /api/sites?place=<id>[&rule_ids=a,b][&material=<value>] (contracts 6).
import type { IncomingMessage, ServerResponse } from 'node:http';
import { contextOf } from '../../shared/feature.ts';
import { sendJson } from '../../shared/http.ts';
import { findSites, UnknownPlace } from './sites.ts';

export async function handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  if (url.pathname !== '/api/sites' || req.method !== 'GET') return false;
  const context = contextOf(req);
  const place = (url.searchParams.get('place') ?? '').trim();
  if (!place) {
    sendJson(res, 400, { error: 'Provide a place id' });
    return true;
  }
  const ruleIds = url.searchParams.has('rule_ids')
    ? (url.searchParams.get('rule_ids') ?? '')
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean)
        .slice(0, 50)
    : null;
  try {
    sendJson(res, 200, await findSites(context.rulesDir, context.facilitiesCsv, { place, ruleIds, material: url.searchParams.get('material') }));
  } catch (error) {
    if (error instanceof UnknownPlace) {
      sendJson(res, 400, { error: 'Unknown place id' });
    } else {
      // The detail goes only to the server log (K1).
      console.error('Site data could not be loaded:', error instanceof Error ? error.message : 'unknown error');
      sendJson(res, 500, { error: 'Site data could not be loaded' });
    }
  }
  return true;
}
