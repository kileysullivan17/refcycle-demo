// Demo limits (PRD addendum, ADR 0002): a hard daily spending cap and a per-visitor daily limit on questions
// and scans. When either is reached the app answers 429 with one plain message and never substitutes a
// guessed or cached answer; everything that needs no model call keeps working.
//
// The on/off switch is read from the server's environment only (DEMO_LIMITS). Nothing in a request, header,
// query string, cookie or browser storage is ever consulted for it. The default is on. A production start
// refuses to run with limits off (assertStartAllowed).
import { createHash, randomBytes } from 'node:crypto';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import type { IncomingMessage } from 'node:http';
import { BlockList, isIP } from 'node:net';
import path from 'node:path';

export const LIMIT_MESSAGE =
  'This demo has reached its limit for today. Questions and photo scans are paused until tomorrow. ' +
  'You can still browse the Recyclopedia list, Place guidelines, Locations and the reuse links.';

export type LimitsConfig = {
  enabled: boolean;
  dailyCapUsd: number;
  visitorDailyLimit: number;
  inputUsdPerMTok: number;
  outputUsdPerMTok: number;
  askCostUsd: number;
  scanCostUsd: number;
  trustProxy: boolean;
  trustFlyClientIp: boolean;
};

export class LimitsConfigError extends Error {}

function numberSetting(env: NodeJS.ProcessEnv, name: string, fallback: number, { integer = false } = {}): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0 || (integer && !Number.isInteger(value))) {
    throw new LimitsConfigError(`${name} must be a positive ${integer ? 'whole number' : 'number'}; got "${raw}".`);
  }
  return value;
}

/** Reads the limits from the server environment. Unset means on. Anything but "on" or "off" stops the start. */
export function readLimitsConfig(env: NodeJS.ProcessEnv = process.env): LimitsConfig {
  const raw = (env.DEMO_LIMITS ?? '').trim().toLowerCase();
  if (raw !== '' && raw !== 'on' && raw !== 'off') {
    throw new LimitsConfigError(`DEMO_LIMITS must be "on" or "off"; got "${env.DEMO_LIMITS}". Leave it unset for on.`);
  }
  const proxy = (env.TRUST_PROXY ?? '').trim();
  if (proxy !== '' && proxy !== '0' && proxy !== '1') throw new LimitsConfigError('TRUST_PROXY must be 0 or 1.');
  const fly = (env.TRUST_FLY_CLIENT_IP ?? '').trim();
  if (fly !== '' && fly !== '0' && fly !== '1') throw new LimitsConfigError('TRUST_FLY_CLIENT_IP must be 0 or 1.');
  if (fly === '1' && proxy === '1') {
    throw new LimitsConfigError('Set TRUST_FLY_CLIENT_IP or TRUST_PROXY, not both: each names a different place to read the visitor address from.');
  }
  return {
    enabled: raw !== 'off',
    dailyCapUsd: numberSetting(env, 'DAILY_SPEND_CAP_USD', 5),
    visitorDailyLimit: numberSetting(env, 'VISITOR_DAILY_LIMIT', 20, { integer: true }),
    inputUsdPerMTok: numberSetting(env, 'PRICE_INPUT_USD_PER_MTOK', 2),
    outputUsdPerMTok: numberSetting(env, 'PRICE_OUTPUT_USD_PER_MTOK', 10),
    askCostUsd: numberSetting(env, 'ASK_COST_USD', 0.03),
    scanCostUsd: numberSetting(env, 'SCAN_COST_USD', 0.02),
    trustProxy: proxy === '1',
    trustFlyClientIp: fly === '1',
  };
}

export function isLoopbackHost(host: string): boolean {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1';
}

/**
 * A production start, or any start that listens beyond this machine, must have the limits on.
 * Throws with the reason; the caller prints it and exits.
 */
export function assertStartAllowed(config: LimitsConfig, env: NodeJS.ProcessEnv, host: string): void {
  if (config.enabled) return;
  const production = (env.NODE_ENV ?? '').trim().toLowerCase() === 'production';
  if (production) {
    throw new LimitsConfigError(
      'Refusing to start: NODE_ENV is production and DEMO_LIMITS is off. The public demo calls a paid model on ' +
        "Kiley's key, so the daily spending cap and the per-visitor limit must be on. Remove DEMO_LIMITS=off (on is the default).",
    );
  }
  if (!isLoopbackHost(host)) {
    throw new LimitsConfigError(
      `Refusing to start: HOST is ${host} (reachable from other machines) and DEMO_LIMITS is off. ` +
        'Limits may be off only on 127.0.0.1, for the scored run and local tests. Remove DEMO_LIMITS=off or set HOST=127.0.0.1.',
    );
  }
}

// ---------- cost settings ----------

// The pinned engine reports no token usage, so each question is counted at a flat amount, ASK_COST_USD.
// The default, 0.03 US dollars, is about one and a half times the average measured on the scored run of
// 2026-11-16 (1.75 dollars for 90 questions and 30 scans; see DECISIONS.md 55). It is an average, not a
// ceiling: one question with a retry and a long answer can cost more than it is counted at.
//
// A scan is counted at the usage the provider reports. SCAN_COST_USD is the amount held against the cap
// while the call runs, and the amount counted if the provider reports no usage.
export const IDENTIFY_MAX_OUTPUT_TOKENS = 2048;

export function usd(config: LimitsConfig, inputTokens: number, outputTokens: number): number {
  return (inputTokens * config.inputUsdPerMTok + outputTokens * config.outputUsdPerMTok) / 1_000_000;
}

// ---------- the counters ----------

export type Refusal = { ok: false; reason: 'daily_cap' | 'visitor' };
export type Ticket = { ok: true; settle(actualUsd?: number): void; cancel(): void };

type LimitsOptions = { ledgerPath?: string | null; now?: () => Date };

export class Limits {
  readonly config: LimitsConfig;
  private readonly ledgerPath: string | null;
  private readonly now: () => Date;
  private readonly salt = randomBytes(16);
  private day = '';
  private spentUsd = 0;
  private reservedUsd = 0;
  private visitors = new Map<string, number>();

  constructor(config: LimitsConfig, options: LimitsOptions = {}) {
    this.config = config;
    this.ledgerPath = options.ledgerPath ?? null;
    this.now = options.now ?? (() => new Date());
  }

  private today(): string {
    return this.now().toISOString().slice(0, 10); // UTC day
  }

  private roll(): void {
    const today = this.today();
    if (today !== this.day) {
      this.day = today;
      this.spentUsd = 0;
      this.visitors = new Map();
    }
  }

  /** Reads today's spending back from the ledger so a restart does not reset the daily cap. */
  async load(): Promise<void> {
    this.roll();
    if (!this.ledgerPath || !this.config.enabled) return;
    let text: string;
    try {
      text = await readFile(this.ledgerPath, 'utf8');
    } catch {
      return;
    }
    let total = 0;
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        const row = JSON.parse(line) as { day?: string; usd?: number };
        if (row.day === this.day && typeof row.usd === 'number' && row.usd > 0) total += row.usd;
      } catch {
        /* a damaged line is skipped */
      }
    }
    this.spentUsd = total;
  }

  /**
   * A stable key for one visitor for the life of this process: a salted hash of the network address.
   * The address itself is never stored or logged, and no cookie is set.
   */
  visitorKey(req: IncomingMessage): string {
    return createHash('sha256').update(this.salt).update(this.visitorAddress(req).address).digest('hex');
  }

  /**
   * One line for the server log about where a counted request's visitor address came from, so the host
   * setting can be checked on the live site. It names the source and whether the address is a public one.
   * It never holds the address, any part of it, or the visitor key.
   */
  visitorSourceLine(req: IncomingMessage, kind: 'ask' | 'identify'): string {
    const { address, source } = this.visitorAddress(req);
    const from = source === 'fly-client-ip' ? 'the Fly-Client-IP header' : source === 'x-forwarded-for' ? 'the X-Forwarded-For header' : 'the connection';
    return `Counted ${kind}: visitor address from ${from}; ${addressKind(address)}`;
  }

  private visitorAddress(req: IncomingMessage): { address: string; source: 'fly-client-ip' | 'x-forwarded-for' | 'connection' } {
    const connection = req.socket.remoteAddress ?? 'unknown';
    if (this.config.trustFlyClientIp) {
      // On Fly.io the last X-Forwarded-For entry is the app's own address, the same for every visitor. Fly's
      // proxy writes the visitor's address in Fly-Client-IP. The header is read only when the host setting
      // is on; anywhere else a visitor could send it and pose as someone new. With no header (a request that
      // did not come through Fly's proxy) the connection's own address is used.
      const header = req.headers['fly-client-ip'];
      const client = (Array.isArray(header) ? header[0] : header)?.trim();
      if (client) return { address: client, source: 'fly-client-ip' };
    } else if (this.config.trustProxy) {
      // Behind the host's own proxy, the last X-Forwarded-For entry is the one that proxy wrote.
      const forwarded = String(req.headers['x-forwarded-for'] ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (forwarded.length) return { address: forwarded[forwarded.length - 1], source: 'x-forwarded-for' };
    }
    return { address: connection, source: 'connection' };
  }

  /** Whether a request would be refused right now, without counting anything. Lets a route say no before reading a large upload. */
  wouldRefuse(visitorKey: string, estimateUsd: number): Refusal | null {
    if (!this.config.enabled) return null;
    this.roll();
    if (this.spentUsd + this.reservedUsd + estimateUsd > this.config.dailyCapUsd) return { ok: false, reason: 'daily_cap' };
    if ((this.visitors.get(visitorKey) ?? 0) >= this.config.visitorDailyLimit) return { ok: false, reason: 'visitor' };
    return null;
  }

  /** Asks to make one model-backed request. Counts it against the visitor and reserves its estimated cost. */
  admit(visitorKey: string, estimateUsd: number, kind: 'ask' | 'identify'): Ticket | Refusal {
    if (!this.config.enabled) return { ok: true, settle() {}, cancel() {} };
    this.roll();
    if (this.spentUsd + this.reservedUsd + estimateUsd > this.config.dailyCapUsd) return { ok: false, reason: 'daily_cap' };
    const used = this.visitors.get(visitorKey) ?? 0;
    if (used >= this.config.visitorDailyLimit) return { ok: false, reason: 'visitor' };
    this.visitors.set(visitorKey, used + 1);
    this.reservedUsd += estimateUsd;
    const day = this.day;
    let open = true;
    return {
      ok: true,
      settle: (actualUsd?: number) => {
        if (!open) return;
        open = false;
        this.reservedUsd = Math.max(0, this.reservedUsd - estimateUsd);
        const cost = actualUsd !== undefined && Number.isFinite(actualUsd) && actualUsd >= 0 ? actualUsd : estimateUsd;
        if (day === this.today()) {
          this.roll();
          this.spentUsd += cost;
        }
        void this.record(day, kind, cost);
      },
      cancel: () => {
        // No model call was made (for example the engine rejected the request), so nothing is counted.
        if (!open) return;
        open = false;
        this.reservedUsd = Math.max(0, this.reservedUsd - estimateUsd);
        if (day === this.day) {
          const now = this.visitors.get(visitorKey) ?? 0;
          if (now > 0) this.visitors.set(visitorKey, now - 1);
        }
      },
    };
  }

  private async record(day: string, kind: string, usdSpent: number): Promise<void> {
    if (!this.ledgerPath) return;
    try {
      await mkdir(path.dirname(this.ledgerPath), { recursive: true });
      await appendFile(this.ledgerPath, JSON.stringify({ timestamp: this.now().toISOString(), day, kind, usd: Number(usdSpent.toFixed(6)) }) + '\n', 'utf8');
    } catch {
      console.error('Spend ledger write failed');
    }
  }

  /** For the start-up line and tests. Never sent to the browser. */
  status(): { enabled: boolean; day: string; spentUsd: number; reservedUsd: number; visitors: number } {
    this.roll();
    return { enabled: this.config.enabled, day: this.day, spentUsd: this.spentUsd, reservedUsd: this.reservedUsd, visitors: this.visitors.size };
  }
}

export function limitBody(): { error: string; message: string } {
  return { error: 'limit_reached', message: LIMIT_MESSAGE };
}

// Addresses that are not a visitor's own on the public internet: this machine, private networks, link-local,
// carrier-grade NAT, and the IPv6 local ranges (Fly's private network is in fc00::/7).
const NOT_PUBLIC = new BlockList();
for (const [net, bits] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.168.0.0', 16]] as const) NOT_PUBLIC.addSubnet(net, bits, 'ipv4');
for (const [net, bits] of [['::', 127], ['fc00::', 7], ['fe80::', 10]] as const) NOT_PUBLIC.addSubnet(net, bits, 'ipv6');

/** "public address", "not a public address" or "not an address". Says nothing else about the address. */
export function addressKind(address: string): 'public address' | 'not a public address' | 'not an address' {
  const plain = address.toLowerCase().startsWith('::ffff:') && isIP(address.slice(7)) === 4 ? address.slice(7) : address;
  const family = isIP(plain);
  if (family === 0) return 'not an address';
  return NOT_PUBLIC.check(plain, family === 4 ? 'ipv4' : 'ipv6') ? 'not a public address' : 'public address';
}
