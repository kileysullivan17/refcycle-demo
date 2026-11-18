// RefCycle app server (contracts 2 and 2.1). Serves the phone-width web UI and the app's own API, and
// forwards GET /api/jurisdictions and POST /api/ask unchanged to the pinned engine. Every recycling answer
// comes from the engine; nothing here writes, edits or infers a rule.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { z } from 'zod';
import { loadEnv } from '../../engine/code/src/config.ts';
import { bindContext, type AppContext, type FeatureHandler } from './shared/feature.ts';
import { BodyTooLarge, isJsonRequest, readBody, sendJson } from './shared/http.ts';
import { assertStartAllowed, limitBody, Limits, LimitsConfigError, readLimitsConfig } from './shared/limits.ts';
import { appendLog, MAX_LOG_BYTES } from './shared/logs.ts';
import { getPacks } from './shared/packs.ts';
import { APP_DIR, CATALOG_JSON, FACILITIES_CSV, LOGS_DIR, PUBLIC_DIR, REUSE_LINKS_JSON, RULES_DIR } from './shared/paths.ts';
import { serveIndex, serveStatic } from './shared/static.ts';

// Loaded in this order at startup; a missing module is skipped (contracts 2.1). The last two are the
// whole-app additions (PRD addendum).
export const FEATURE_MODULES = ['recyclopedia', 'camera-scan', 'locator', 'guidelines', 'reuse'];

// Client-side routes (contracts 10, plus /home, /guidelines and /another-life from the addendum).
const CLIENT_ROUTES = [
  /^\/$/,
  /^\/place$/,
  /^\/home$/,
  /^\/guidelines$/,
  /^\/another-life$/,
  /^\/item$/,
  /^\/recyclopedia$/,
  /^\/recyclopedia\/[^/]+$/,
  /^\/search$/,
  /^\/scan$/,
  /^\/scan\/confirm$/,
  /^\/locations$/,
  /^\/locations\/[^/]+$/,
];

const ASK_BODY_LIMIT = 16_384; // the engine's own limit
const ENGINE_TIMEOUT_MS = 140_000; // two provider attempts of up to 60 s each, plus slack

const SwapLog = z
  .object({
    surface: z.string().min(1).max(200),
    from: z.string().min(1).max(200),
    to: z.string().min(1).max(200),
    count: z.number().int().min(1).max(10_000),
    place: z.string().max(100).nullable().optional(),
  })
  .strict();

export type AppOptions = Partial<Omit<AppContext, 'limits'>> & { limits?: Limits; features?: FeatureHandler[] };

async function loadFeatures(): Promise<FeatureHandler[]> {
  const handlers: FeatureHandler[] = [];
  for (const name of FEATURE_MODULES) {
    const file = path.join(APP_DIR, 'src', 'features', name, 'routes.ts');
    try {
      const mod = (await import(pathToFileURL(file).href)) as { handle?: FeatureHandler };
      if (typeof mod.handle === 'function') handlers.push(mod.handle);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ERR_MODULE_NOT_FOUND' || code === 'ENOENT') continue;
      throw error;
    }
  }
  return handlers;
}

async function forwardJurisdictions(context: AppContext, res: ServerResponse): Promise<void> {
  try {
    const upstream = await fetch(new URL('/api/jurisdictions', context.engineUrl), { signal: AbortSignal.timeout(10_000) });
    const text = await upstream.text();
    res.statusCode = upstream.status;
    res.setHeader('Content-Type', upstream.headers.get('content-type') ?? 'application/json; charset=utf-8');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    res.end(text);
  } catch {
    sendJson(res, 502, { error: 'The engine could not be reached' });
  }
}

/** POST /api/ask: the body goes to the engine as received and the engine's reply comes back as sent. */
async function forwardAsk(context: AppContext, req: IncomingMessage, res: ServerResponse): Promise<void> {
  let body: Buffer;
  try {
    body = await readBody(req, ASK_BODY_LIMIT);
  } catch (error) {
    sendJson(res, 400, { error: error instanceof BodyTooLarge ? 'Request body too large' : 'Invalid input' });
    return;
  }

  // The body is read only to see whether the question will reach a model; it is never changed.
  let jurisdiction: string | null = null;
  try {
    const parsed = JSON.parse(body.toString('utf8')) as { jurisdiction?: unknown };
    if (typeof parsed.jurisdiction === 'string') jurisdiction = parsed.jurisdiction.trim();
  } catch {
    /* the engine answers invalid JSON with HTTP 400 and no model call */
  }

  let ticket: ReturnType<Limits['admit']> | null = null;
  if (jurisdiction !== null) {
    let counted = true;
    try {
      // An unsupported place gets the engine's own abstention without a model call, so it is not counted.
      counted = (await getPacks(context.rulesDir)).has(jurisdiction);
    } catch {
      /* packs unreadable here: count the question */
    }
    if (counted) {
      ticket = context.limits.admit(context.limits.visitorKey(req), context.limits.config.askCostUsd, 'ask');
      if (!ticket.ok) {
        sendJson(res, 429, limitBody());
        return;
      }
      if (context.limits.config.enabled) console.log(context.limits.visitorSourceLine(req, 'ask'));
    }
  }

  let upstream: Response;
  let text: string;
  try {
    upstream = await fetch(new URL('/api/ask', context.engineUrl), {
      method: 'POST',
      headers: { 'Content-Type': String(req.headers['content-type'] ?? '') },
      body: new Uint8Array(body),
      signal: AbortSignal.timeout(ENGINE_TIMEOUT_MS),
    });
    text = await upstream.text();
  } catch (error) {
    const refused = ((error as { cause?: { code?: string } }).cause?.code ?? '') === 'ECONNREFUSED';
    if (ticket?.ok) refused ? ticket.cancel() : ticket.settle();
    sendJson(res, 502, { error: 'The engine could not be reached' });
    return;
  }
  // HTTP 400 means the engine rejected the request before any model call.
  if (ticket?.ok) upstream.status === 400 ? ticket.cancel() : ticket.settle();
  res.statusCode = upstream.status;
  res.setHeader('Content-Type', upstream.headers.get('content-type') ?? 'application/json; charset=utf-8');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');
  res.end(text);
}

async function logDisplaySwap(context: AppContext, req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    if (!isJsonRequest(req)) throw new Error('Content-Type must be application/json');
    const parsed = SwapLog.safeParse(JSON.parse((await readBody(req, 4096)).toString('utf8')));
    if (!parsed.success) throw new Error('Invalid display-swap record');
    await appendLog(context.logsDir, 'display-swaps.jsonl', parsed.data, MAX_LOG_BYTES);
    res.statusCode = 204;
    res.end();
  } catch (error) {
    sendJson(res, 400, { error: error instanceof Error ? error.message : 'Invalid input' });
  }
}

export async function createAppServer(options: AppOptions = {}): Promise<{ server: Server; context: AppContext }> {
  const env = options.env ?? process.env;
  const logsDir = options.logsDir ?? LOGS_DIR;
  const limits = options.limits ?? new Limits(readLimitsConfig(env), { ledgerPath: path.join(logsDir, 'spend.jsonl') });
  await limits.load();
  const context: AppContext = {
    engineUrl: options.engineUrl ?? env.ENGINE_URL ?? 'http://127.0.0.1:3000',
    publicDir: options.publicDir ?? PUBLIC_DIR,
    logsDir,
    rulesDir: options.rulesDir ?? RULES_DIR,
    facilitiesCsv: options.facilitiesCsv ?? FACILITIES_CSV,
    catalogJson: options.catalogJson ?? CATALOG_JSON,
    reuseLinksJson: options.reuseLinksJson ?? REUSE_LINKS_JSON,
    limits,
    env,
    today: options.today ?? (() => new Date().toISOString().slice(0, 10)),
  };
  const features = options.features ?? (await loadFeatures());

  const server = createServer((req, res) => {
    void (async () => {
      bindContext(req, context);
      const url = new URL(req.url ?? '/', 'http://app.invalid');
      const method = req.method ?? 'GET';
      try {
        if (url.pathname === '/api/jurisdictions' && method === 'GET') return await forwardJurisdictions(context, res);
        if (url.pathname === '/api/ask' && method === 'POST') return await forwardAsk(context, req, res);
        if (url.pathname === '/api/log/display-swap' && method === 'POST') return await logDisplaySwap(context, req, res);
        const reading = method === 'GET' || method === 'HEAD';
        if (reading && !url.pathname.startsWith('/api/') && (await serveStatic(res, context.publicDir, url.pathname, method === 'HEAD'))) return;
        for (const handle of features) {
          if (await handle(req, res, url)) return;
        }
        if (reading && CLIENT_ROUTES.some((route) => route.test(url.pathname))) return await serveIndex(res, context.publicDir, method === 'HEAD');
        sendJson(res, 404, { error: 'Not found' });
      } catch (error) {
        console.error('Request failed:', error instanceof Error ? error.message : 'unknown error');
        sendJson(res, 500, { error: 'Something went wrong' });
      }
    })();
  });
  return { server, context };
}

async function main(): Promise<void> {
  // The app reads its own .env (app/.env). Values already in the environment win.
  await loadEnv(path.join(APP_DIR, '.env'));
  const host = process.env.HOST?.trim() || '127.0.0.1';
  const port = Number(process.env.PORT ?? 3001);
  let config;
  try {
    config = readLimitsConfig(process.env);
    assertStartAllowed(config, process.env, host);
  } catch (error) {
    if (error instanceof LimitsConfigError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }
  const { server, context } = await createAppServer();
  server.on('error', (error) => {
    console.error(`The app could not start on ${host}:${port}: ${error.message}`);
    process.exit(1);
  });
  server.listen(port, host, () => {
    const limits = config.enabled
      ? `limits on: ${config.dailyCapUsd} US dollars a day, ${config.visitorDailyLimit} questions or scans per visitor a day`
      : 'LIMITS OFF (local only)';
    const image = `${process.env.LLM_IMAGE_PROVIDER ?? 'anthropic'}/${process.env.LLM_IMAGE_MODEL ?? 'claude-sonnet-5-5'}`;
    console.log(`RefCycle app: http://${host}:${port} (engine ${context.engineUrl}; image model ${image}; ${limits})`);
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Startup failed');
    process.exit(1);
  });
}
