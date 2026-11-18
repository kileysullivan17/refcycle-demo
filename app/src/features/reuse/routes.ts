// Give it another life (PRD addendum): outside reuse and repair links for a Place.
// GET /api/reuse?place=<id>. These links are outside resources, never rules. They take no part in any
// answer: the engine is not called here, and nothing here is read by the item page's answer.
import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { contextOf } from '../../shared/feature.ts';
import { sendJson } from '../../shared/http.ts';
import { getPacks } from '../../shared/packs.ts';

const ReuseLink = z
  .object({
    id: z.string().min(1),
    place: z.string().min(1).nullable(), // null: useful in every Place
    title: z.string().min(1),
    url: z.string().url().startsWith('https://'),
    publisher: z.string().min(1),
    description: z.string().min(1),
    checked: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .strict();
export const ReuseLinks = z.object({ links: z.array(ReuseLink) }).strict();
export type ReuseLinkRecord = z.infer<typeof ReuseLink>;

const loaded = new Map<string, Promise<ReuseLinkRecord[]>>();

export function getReuseLinks(file: string): Promise<ReuseLinkRecord[]> {
  let promise = loaded.get(file);
  if (!promise) {
    promise = readFile(file, 'utf8').then((text) => ReuseLinks.parse(JSON.parse(text)).links);
    loaded.set(file, promise);
    promise.catch(() => loaded.delete(file));
  }
  return promise;
}

export async function handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  if (url.pathname !== '/api/reuse' || req.method !== 'GET') return false;
  const context = contextOf(req);
  const place = (url.searchParams.get('place') ?? '').trim();
  try {
    const packs = await getPacks(context.rulesDir);
    if (!packs.has(place)) {
      sendJson(res, 400, { error: 'Unknown place id' });
      return true;
    }
    const links = await getReuseLinks(context.reuseLinksJson);
    sendJson(res, 200, {
      place,
      links: links.filter((l) => l.place === place || l.place === null).map((l) => ({ ...l, scope: l.place === null ? 'everywhere' : 'place' })),
    });
  } catch {
    console.error('Reuse links could not be loaded');
    sendJson(res, 500, { error: 'Reuse links could not be loaded' });
  }
  return true;
}
