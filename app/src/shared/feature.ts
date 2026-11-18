// What every server feature module shares. Each module exports
//   handle(req, res, url): Promise<boolean>
// (contracts 2.1) and finds its settings through contextOf(req), so several app servers can run in one
// process (the tests do this) without sharing state.
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Limits } from './limits.ts';

export type AppContext = {
  engineUrl: string;
  publicDir: string;
  logsDir: string;
  rulesDir: string;
  facilitiesCsv: string;
  catalogJson: string;
  reuseLinksJson: string;
  limits: Limits;
  env: NodeJS.ProcessEnv;
  /** Today's date as YYYY-MM-DD, for tests that need a fixed day. */
  today: () => string;
};

export type FeatureHandler = (req: IncomingMessage, res: ServerResponse, url: URL) => Promise<boolean>;

const contexts = new WeakMap<IncomingMessage, AppContext>();

export function bindContext(req: IncomingMessage, context: AppContext): void {
  contexts.set(req, context);
}

export function contextOf(req: IncomingMessage): AppContext {
  const context = contexts.get(req);
  if (!context) throw new Error('Request has no app context');
  return context;
}
