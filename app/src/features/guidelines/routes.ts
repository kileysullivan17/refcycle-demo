// Place guidelines server route: GET /api/guidelines?place=<id>. Read-only; no model call.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { contextOf } from '../../shared/feature.ts';
import { sendJson } from '../../shared/http.ts';
import { getGuidelines, UnknownPlace } from './guidelines.ts';

export async function handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  if (url.pathname !== '/api/guidelines' || req.method !== 'GET') return false;
  const place = (url.searchParams.get('place') ?? '').trim();
  if (!place) {
    sendJson(res, 400, { error: 'Provide a place id' });
    return true;
  }
  try {
    sendJson(res, 200, await getGuidelines(contextOf(req).rulesDir, place));
  } catch (error) {
    if (error instanceof UnknownPlace) {
      sendJson(res, 400, { error: 'Unknown place id' });
    } else {
      console.error('Guidelines could not be loaded:', error instanceof Error ? error.message : 'unknown error');
      sendJson(res, 500, { error: 'Guidelines could not be loaded' });
    }
  }
  return true;
}
