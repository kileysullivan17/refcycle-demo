// Small HTTP helpers shared by the app server and the feature modules.
import type { IncomingMessage, ServerResponse } from 'node:http';

export class BodyTooLarge extends Error {
  constructor() {
    super('Request body too large');
  }
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  if (res.headersSent) return;
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

/** Reads the whole request body, refusing anything over the byte limit. Nothing is written to disk. */
export async function readBody(req: IncomingMessage, limitBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buf.length;
    if (bytes > limitBytes) {
      req.resume();
      throw new BodyTooLarge();
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

export function isJsonRequest(req: IncomingMessage): boolean {
  return String(req.headers['content-type'] ?? '')
    .toLowerCase()
    .startsWith('application/json');
}
