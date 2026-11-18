// Starts the real app server for a test, on a free port, with its logs in a temporary folder.
import { mkdtempSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createAppServer, type AppOptions } from '../../src/server.ts';
import type { AppContext } from '../../src/shared/feature.ts';
import { Limits, readLimitsConfig, type LimitsConfig } from '../../src/shared/limits.ts';

export type TestApp = { url: string; logsDir: string; context: AppContext; close(): Promise<void> };

/** Limits are off in most tests; pass `limits` to exercise them. Keys are fake unless a test sets them. */
export async function startApp(options: AppOptions & { limitsConfig?: Partial<LimitsConfig>; now?: () => Date } = {}): Promise<TestApp> {
  const logsDir = options.logsDir ?? mkdtempSync(path.join(os.tmpdir(), 'refcycle-app-test-'));
  const env = options.env ?? { LLM_IMAGE_PROVIDER: 'anthropic', LLM_IMAGE_MODEL: 'claude-sonnet-5-5', ANTHROPIC_API_KEY: 'test-key-not-real' };
  const config: LimitsConfig = { ...readLimitsConfig({ DEMO_LIMITS: 'off' }), ...(options.limitsConfig ?? {}) };
  const limits = options.limits ?? new Limits(config, { ledgerPath: path.join(logsDir, 'spend.jsonl'), now: options.now });
  const { limitsConfig: _c, now: _n, ...rest } = options;
  const { server, context } = await createAppServer({ ...rest, logsDir, env, limits });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    logsDir,
    context,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}

export async function postJson(url: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
}
