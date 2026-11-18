// Demo limits (PRD addendum; ADR 0002): the daily spending cap, the per-visitor limit, the limit message,
// and the three rules Kiley set for the on/off switch:
//   1. it is read only from the server environment, never from a request, header, query or browser storage;
//   2. the default is on;
//   3. a production start refuses to run with limits off, and says why.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { createAppServer } from '../../src/server.ts';
import {
  assertStartAllowed,
  LIMIT_MESSAGE,
  Limits,
  LimitsConfigError,
  readLimitsConfig,
  usd,
  type LimitsConfig,
} from '../../src/shared/limits.ts';
import { APP_DIR } from '../../src/shared/paths.ts';
import { postJson, startApp, type TestApp } from '../helpers/app.ts';
import { publicFiles, readPublic } from '../helpers/css.ts';
import { startFakeEngine, type FakeEngine } from '../helpers/fake-engine.ts';

const ON: LimitsConfig = readLimitsConfig({});
const ask = (app: TestApp, query = 'cardboard', extra: { headers?: Record<string, string>; search?: string } = {}) =>
  postJson(`${app.url}/api/ask${extra.search ?? ''}`, { jurisdiction: 'seattle_wa', query }, extra.headers);

describe('limits settings', () => {
  test('the default is on, with a 5 dollar daily cap and 20 per visitor', () => {
    for (const env of [{}, { DEMO_LIMITS: '' }, { DEMO_LIMITS: 'on' }, { DEMO_LIMITS: ' ON ' }]) {
      const config = readLimitsConfig(env);
      assert.equal(config.enabled, true);
      assert.equal(config.dailyCapUsd, 5);
      assert.equal(config.visitorDailyLimit, 20);
    }
  });

  test('only the exact value "off" turns limits off; anything else stops the start', () => {
    assert.equal(readLimitsConfig({ DEMO_LIMITS: 'off' }).enabled, false);
    for (const value of ['0', 'false', 'no', 'disabled', 'offf']) {
      assert.throws(() => readLimitsConfig({ DEMO_LIMITS: value }), LimitsConfigError);
    }
  });

  test('a bad number stops the start instead of silently lifting a limit', () => {
    for (const env of [{ DAILY_SPEND_CAP_USD: 'lots' }, { DAILY_SPEND_CAP_USD: '0' }, { DAILY_SPEND_CAP_USD: '-1' }, { VISITOR_DAILY_LIMIT: '2.5' }, { VISITOR_DAILY_LIMIT: 'Infinity' }]) {
      assert.throws(() => readLimitsConfig(env), LimitsConfigError);
    }
  });

  test('a server started with no limits setting has limits on', async () => {
    const logsDir = mkdtempSync(path.join(os.tmpdir(), 'refcycle-limits-default-'));
    const { context } = await createAppServer({ env: {}, logsDir, features: [] });
    assert.equal(context.limits.config.enabled, true);
    assert.equal(context.limits.status().enabled, true);
  });
});

describe('production start', () => {
  test('refuses limits off in production, and says why', () => {
    const off = readLimitsConfig({ DEMO_LIMITS: 'off' });
    assert.throws(
      () => assertStartAllowed(off, { NODE_ENV: 'production' }, '127.0.0.1'),
      (error: Error) => error instanceof LimitsConfigError && /Refusing to start/.test(error.message) && /production/.test(error.message) && /DEMO_LIMITS is off/.test(error.message) && /spending cap/.test(error.message),
    );
  });

  test('refuses limits off on any address other machines can reach', () => {
    const off = readLimitsConfig({ DEMO_LIMITS: 'off' });
    assert.throws(() => assertStartAllowed(off, {}, '0.0.0.0'), /Refusing to start: HOST is 0\.0\.0\.0/);
    assert.throws(() => assertStartAllowed(off, { NODE_ENV: 'development' }, '192.168.1.20'), LimitsConfigError);
  });

  test('allows limits off only on this machine outside production, and always allows limits on', () => {
    const off = readLimitsConfig({ DEMO_LIMITS: 'off' });
    assert.doesNotThrow(() => assertStartAllowed(off, {}, '127.0.0.1'));
    assert.doesNotThrow(() => assertStartAllowed(ON, { NODE_ENV: 'production' }, '0.0.0.0'));
  });

  async function freePort(): Promise<number> {
    const probe = createServer();
    await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
    const { port } = probe.address() as AddressInfo;
    await new Promise<void>((resolve) => probe.close(() => resolve()));
    return port;
  }

  function runServer(extraEnv: Record<string, string>, port: number): Promise<{ code: number | null; output: string; started: boolean }> {
    return new Promise((resolve) => {
      const env: NodeJS.ProcessEnv = { ...process.env, PORT: String(port), ENGINE_URL: 'http://127.0.0.1:9', ...extraEnv };
      const child = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], { cwd: APP_DIR, env });
      let output = '';
      let started = false;
      const finish = (code: number | null) => resolve({ code, output, started });
      const timer = setTimeout(() => child.kill(), 20_000);
      const onData = (chunk: Buffer) => {
        output += chunk.toString();
        if (/RefCycle app: http/.test(output)) {
          started = true;
          child.kill();
        }
      };
      child.stdout.on('data', onData);
      child.stderr.on('data', onData);
      child.on('exit', (code) => {
        clearTimeout(timer);
        finish(code);
      });
    });
  }

  test('the real start command exits with the reason when production has limits off', async () => {
    const result = await runServer({ NODE_ENV: 'production', DEMO_LIMITS: 'off', HOST: '127.0.0.1' }, await freePort());
    assert.equal(result.started, false, result.output);
    assert.equal(result.code, 1, result.output);
    assert.match(result.output, /Refusing to start: NODE_ENV is production and DEMO_LIMITS is off/);
  });

  test('the real start command runs in production with limits on', async () => {
    const result = await runServer({ NODE_ENV: 'production', DEMO_LIMITS: 'on', HOST: '127.0.0.1' }, await freePort());
    assert.equal(result.started, true, result.output);
    assert.match(result.output, /limits on: 5 US dollars a day, 20 questions or scans per visitor a day/);
  });

  test('npm start is the production start', () => {
    const pkg = JSON.parse(readFileSync(path.join(APP_DIR, 'package.json'), 'utf8'));
    assert.match(pkg.scripts.start, /NODE_ENV=production/);
    assert.match(pkg.scripts.start, /src\/server\.ts/);
  });
});

describe('the switch is read only from the server environment', () => {
  let engine: FakeEngine;
  let app: TestApp;
  before(async () => {
    engine = await startFakeEngine();
    app = await startApp({ engineUrl: engine.url, limitsConfig: { enabled: true, visitorDailyLimit: 1 } });
  });
  after(async () => {
    await app.close();
    await engine.close();
  });

  test('no header, query, cookie or body field can turn limits off', async () => {
    assert.equal((await ask(app)).status, 200);
    const attempts: { headers?: Record<string, string>; search?: string }[] = [
      { headers: { 'DEMO_LIMITS': 'off' } },
      { headers: { 'X-Demo-Limits': 'off', 'X-Limits': 'off', 'X-Forwarded-For': '203.0.113.9' } },
      { headers: { Cookie: 'DEMO_LIMITS=off; limits=off; refcycle.limits=off' } },
      { headers: { Authorization: 'Bearer limits-off' } },
      { search: '?DEMO_LIMITS=off&limits=off&demo_limits=off' },
    ];
    for (const attempt of attempts) {
      const response = await ask(app, 'cardboard', attempt);
      assert.equal(response.status, 429, JSON.stringify(attempt));
      assert.deepEqual(await response.json(), { error: 'limit_reached', message: LIMIT_MESSAGE });
    }
    // A body field is not accepted either: the limit applies before the engine would reject the extra key.
    const body = await postJson(`${app.url}/api/ask`, { jurisdiction: 'seattle_wa', query: 'cardboard', DEMO_LIMITS: 'off' });
    assert.equal(body.status, 429);
    assert.equal(engine.calls.length, 1, 'only the first question reached the engine');
  });

  test('the browser code never reads or sends a limits switch', () => {
    const scripts = publicFiles().filter((f) => (f.endsWith('.js') || f.endsWith('.html')) && !f.startsWith('shared/vendor/'));
    assert.ok(scripts.length > 10);
    for (const file of scripts) {
      const source = readPublic(file);
      assert.doesNotMatch(source, /DEMO_LIMITS|demo_limits|demoLimits|limitsOff|limits=off/i, file);
    }
    // The only storage keys the app uses are the Place and the recent items.
    const keys = scripts.flatMap((f) => [...readPublic(f).matchAll(/['"`](refcycle\.[a-z.-]*)['"`]/g)].map((m) => m[1]));
    assert.deepEqual([...new Set(keys)].sort(), ['refcycle.', 'refcycle.place', 'refcycle.recent']);
  });

  test('the server source reads the switch from the environment object only', () => {
    const source = readFileSync(path.join(APP_DIR, 'src', 'shared', 'limits.ts'), 'utf8');
    const reads = [...source.matchAll(/DEMO_LIMITS/g)].length;
    assert.ok(reads > 0);
    assert.match(source, /env\.DEMO_LIMITS/);
    for (const file of ['src/server.ts', 'src/features/camera-scan/routes.ts']) {
      assert.doesNotMatch(readFileSync(path.join(APP_DIR, file), 'utf8'), /DEMO_LIMITS/, `${file} must not read the switch itself`);
    }
  });
});

describe('per-visitor limit and daily cap', () => {
  test('the 21st question from one visitor gets the limit message; the engine is not asked', async () => {
    const engine = await startFakeEngine();
    const app = await startApp({ engineUrl: engine.url, limitsConfig: { enabled: true, dailyCapUsd: 1000 } });
    try {
      for (let i = 0; i < 20; i++) assert.equal((await ask(app)).status, 200, `question ${i + 1}`);
      const refused = await ask(app);
      assert.equal(refused.status, 429);
      assert.equal((await refused.json()).message, LIMIT_MESSAGE);
      assert.equal(engine.calls.length, 20);
      // Everything that needs no model call keeps working.
      for (const route of ['/api/jurisdictions', '/api/catalog', '/api/sites?place=seattle_wa', '/api/guidelines?place=seattle_wa', '/api/reuse?place=seattle_wa', '/home']) {
        assert.equal((await fetch(app.url + route)).status, 200, route);
      }
    } finally {
      await app.close();
      await engine.close();
    }
  });

  test('a question the engine rejects (HTTP 400) is not counted', async () => {
    const engine = await startFakeEngine();
    const app = await startApp({ engineUrl: engine.url, limitsConfig: { enabled: true, visitorDailyLimit: 1 } });
    try {
      for (let i = 0; i < 3; i++) assert.equal((await postJson(`${app.url}/api/ask`, { jurisdiction: 'seattle_wa', query: '' })).status, 400);
      assert.equal(app.context.limits.status().spentUsd, 0);
      assert.equal((await ask(app)).status, 200);
      assert.equal((await ask(app)).status, 429);
    } finally {
      await app.close();
      await engine.close();
    }
  });

  test('an unsupported place is answered by the engine without a model call and is not counted', async () => {
    const engine = await startFakeEngine();
    const app = await startApp({ engineUrl: engine.url, limitsConfig: { enabled: true, visitorDailyLimit: 1 } });
    try {
      for (let i = 0; i < 2; i++) {
        const response = await postJson(`${app.url}/api/ask`, { jurisdiction: 'portland_or', query: 'cardboard' });
        assert.equal(response.status, 200);
        assert.equal((await response.json()).behavior, 'abstain');
      }
      assert.equal(app.context.limits.status().spentUsd, 0);
    } finally {
      await app.close();
      await engine.close();
    }
  });

  test('the daily cap stops questions before the total can pass 5 dollars', async () => {
    const engine = await startFakeEngine();
    const app = await startApp({ engineUrl: engine.url, limitsConfig: { enabled: true, visitorDailyLimit: 100_000 } });
    try {
      let answered = 0;
      for (let i = 0; i < 400; i++) {
        const response = await ask(app);
        if (response.status === 429) break;
        assert.equal(response.status, 200);
        answered++;
      }
      const status = app.context.limits.status();
      assert.ok(answered > 10 && answered < 400, `answered ${answered}`);
      assert.ok(status.spentUsd <= 5, `counted ${status.spentUsd}`);
      assert.ok(status.spentUsd > 4, `counted ${status.spentUsd}`);
      assert.equal(engine.calls.length, answered);
      assert.equal((await ask(app)).status, 429);
    } finally {
      await app.close();
      await engine.close();
    }
  });

  test('today’s spending survives a restart; a new day starts from zero', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'refcycle-ledger-'));
    const ledgerPath = path.join(dir, 'spend.jsonl');
    let now = new Date('2026-11-11T10:00:00Z');
    const first = new Limits({ ...ON, dailyCapUsd: 1 }, { ledgerPath, now: () => now });
    await first.load();
    const ticket = first.admit('a', 0.6, 'ask');
    assert.ok(ticket.ok);
    ticket.settle();
    await new Promise((r) => setTimeout(r, 50));

    const second = new Limits({ ...ON, dailyCapUsd: 1 }, { ledgerPath, now: () => now });
    await second.load();
    assert.equal(second.status().spentUsd, 0.6);
    assert.deepEqual(second.admit('b', 0.6, 'ask'), { ok: false, reason: 'daily_cap' });

    now = new Date('2026-11-12T00:00:01Z');
    assert.equal(second.status().spentUsd, 0);
    assert.equal(second.admit('b', 0.6, 'ask').ok, true);
  });

  test('requests in flight are reserved, so a burst cannot overshoot the cap', () => {
    const limits = new Limits({ ...ON, dailyCapUsd: 1, visitorDailyLimit: 100 });
    const a = limits.admit('v', 0.4, 'ask');
    const b = limits.admit('v', 0.4, 'ask');
    assert.ok(a.ok && b.ok);
    assert.deepEqual(limits.admit('v', 0.4, 'ask'), { ok: false, reason: 'daily_cap' });
    if (a.ok) a.cancel();
    assert.equal(limits.admit('v', 0.4, 'ask').ok, true);
  });

  test('visitors are counted apart, by a salted hash and never by the address itself', async () => {
    const limits = new Limits({ ...ON, visitorDailyLimit: 1 });
    assert.equal(limits.admit('one', 0.01, 'ask').ok, true);
    assert.deepEqual(limits.admit('one', 0.01, 'ask'), { ok: false, reason: 'visitor' });
    assert.equal(limits.admit('two', 0.01, 'ask').ok, true);
    const req = { socket: { remoteAddress: '198.51.100.7' }, headers: { 'x-forwarded-for': '203.0.113.1' } } as never;
    const key = limits.visitorKey(req);
    assert.match(key, /^[0-9a-f]{64}$/);
    assert.ok(!key.includes('198.51.100.7'));
    assert.equal(key, limits.visitorKey(req), 'stable within one process');
    assert.notEqual(key, new Limits(ON).visitorKey(req), 'a different salt in each process');
    // Without TRUST_PROXY the forwarded header is ignored, so a visitor cannot pose as someone new.
    const spoofed = { socket: { remoteAddress: '198.51.100.7' }, headers: { 'x-forwarded-for': '10.9.8.7' } } as never;
    assert.equal(limits.visitorKey(spoofed), key);
  });

  test('behind the host proxy (TRUST_PROXY=1) the last forwarded address identifies the visitor', () => {
    const limits = new Limits(readLimitsConfig({ TRUST_PROXY: '1' }));
    const from = (xff: string) => limits.visitorKey({ socket: { remoteAddress: '10.0.0.1' }, headers: { 'x-forwarded-for': xff } } as never);
    assert.equal(from('1.1.1.1, 203.0.113.5'), from('9.9.9.9, 203.0.113.5'), 'a forged first entry changes nothing');
    assert.notEqual(from('203.0.113.5'), from('203.0.113.6'));
  });

  test('Fly-Client-IP is ignored when the host setting is off, so a visitor cannot pose as someone new', () => {
    for (const env of [{}, { TRUST_FLY_CLIENT_IP: '0' }, { TRUST_PROXY: '1' }]) {
      const limits = new Limits(readLimitsConfig(env));
      const from = (client?: string) =>
        limits.visitorKey({ socket: { remoteAddress: '198.51.100.7' }, headers: { 'x-forwarded-for': '203.0.113.5', ...(client ? { 'fly-client-ip': client } : {}) } } as never);
      assert.equal(from('10.9.8.7'), from(), JSON.stringify(env));
      assert.equal(from('10.9.8.7'), from('10.1.2.3'), JSON.stringify(env));
    }
  });

  test('on Fly (TRUST_FLY_CLIENT_IP=1) the address Fly reports identifies the visitor, not the forwarded list', () => {
    const limits = new Limits(readLimitsConfig({ TRUST_FLY_CLIENT_IP: '1' }));
    const from = (client: string | undefined, xff = '1.1.1.1, 66.241.124.1', socket = '172.19.0.1') =>
      limits.visitorKey({ socket: { remoteAddress: socket }, headers: { 'x-forwarded-for': xff, ...(client === undefined ? {} : { 'fly-client-ip': client }) } } as never);
    assert.notEqual(from('203.0.113.5'), from('203.0.113.6'), 'two visitors behind the same proxy are told apart');
    assert.equal(from('203.0.113.5', '9.9.9.9, 66.241.124.1'), from('203.0.113.5', '8.8.8.8'), 'the forwarded list changes nothing');
    assert.equal(from(' 203.0.113.5 '), from('203.0.113.5'));
    // A request that did not come through Fly's proxy carries no such header: the connection's address is used.
    assert.equal(from(undefined), from(''));
    assert.notEqual(from(undefined), from(undefined, '', '172.19.0.2'));
  });

  test('the two address settings cannot both be on, and each takes only 0 or 1', () => {
    assert.throws(() => readLimitsConfig({ TRUST_FLY_CLIENT_IP: '1', TRUST_PROXY: '1' }), /not both/);
    assert.throws(() => readLimitsConfig({ TRUST_FLY_CLIENT_IP: 'yes' }), /TRUST_FLY_CLIENT_IP must be 0 or 1/);
    assert.equal(readLimitsConfig({}).trustFlyClientIp, false);
    assert.equal(readLimitsConfig({ TRUST_FLY_CLIENT_IP: '1' }).trustFlyClientIp, true);
  });

  test('the log line names where the visitor address came from and whether it is public, never the address', () => {
    const line = (env: Record<string, string>, socket: string, headers: Record<string, string>) =>
      new Limits(readLimitsConfig(env)).visitorSourceLine({ socket: { remoteAddress: socket }, headers } as never, 'ask');
    const fly = { TRUST_FLY_CLIENT_IP: '1' };
    assert.equal(line(fly, '172.19.0.1', { 'fly-client-ip': '203.0.113.5' }), 'Counted ask: visitor address from the Fly-Client-IP header; public address');
    assert.equal(line(fly, '172.19.0.1', { 'fly-client-ip': '2001:db8::1234' }), 'Counted ask: visitor address from the Fly-Client-IP header; public address');
    assert.equal(line(fly, '172.19.0.1', { 'fly-client-ip': '10.1.2.3' }), 'Counted ask: visitor address from the Fly-Client-IP header; not a public address');
    assert.equal(line(fly, '172.19.0.1', { 'fly-client-ip': 'nonsense' }), 'Counted ask: visitor address from the Fly-Client-IP header; not an address');
    assert.equal(line(fly, 'fdaa:0:1::2', {}), 'Counted ask: visitor address from the connection; not a public address');
    // With the host setting off the header is not the source, whatever a visitor sends.
    assert.equal(line({}, '198.51.100.7', { 'fly-client-ip': '203.0.113.5' }), 'Counted ask: visitor address from the connection; public address');
    assert.equal(line({}, '::ffff:127.0.0.1', {}), 'Counted ask: visitor address from the connection; not a public address');
    assert.equal(line({ TRUST_PROXY: '1' }, '10.0.0.1', { 'x-forwarded-for': '1.1.1.1, 203.0.113.5' }), 'Counted ask: visitor address from the X-Forwarded-For header; public address');
    // No digit of any address, and no visitor key, appears in any line.
    const limits = new Limits(readLimitsConfig(fly));
    const req = { socket: { remoteAddress: '172.19.0.1' }, headers: { 'fly-client-ip': '203.0.113.5', 'x-forwarded-for': '203.0.113.5, 66.241.124.1' } } as never;
    const text = limits.visitorSourceLine(req, 'identify');
    assert.doesNotMatch(text, /\d/);
    assert.ok(!text.includes(limits.visitorKey(req)));
    assert.match(text, /^Counted identify: /);
  });

  test('wouldRefuse answers without counting anything', () => {
    const limits = new Limits({ ...ON, visitorDailyLimit: 1, dailyCapUsd: 1 });
    for (let i = 0; i < 5; i++) assert.equal(limits.wouldRefuse('v', 0.5), null);
    assert.deepEqual(limits.wouldRefuse('v', 1.5), { ok: false, reason: 'daily_cap' });
    const ticket = limits.admit('v', 0.5, 'identify');
    assert.ok(ticket.ok);
    assert.deepEqual(limits.wouldRefuse('v', 0.1), { ok: false, reason: 'visitor' });
    assert.equal(limits.wouldRefuse('other', 0.1), null);
    assert.equal(new Limits(readLimitsConfig({ DEMO_LIMITS: 'off' })).wouldRefuse('v', 1000), null);
  });

  test('with limits off nothing is refused and nothing is written', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'refcycle-ledger-off-'));
    const limits = new Limits(readLimitsConfig({ DEMO_LIMITS: 'off' }), { ledgerPath: path.join(dir, 'spend.jsonl') });
    for (let i = 0; i < 100; i++) {
      const ticket = limits.admit('v', 1, 'ask');
      assert.ok(ticket.ok);
      ticket.settle();
    }
    assert.equal(limits.status().spentUsd, 0);
  });
});

describe('cost settings', () => {
  test('defaults: 3 cents a question and a 2 cent hold for a scan, so 5 dollars is 166 questions a day', () => {
    assert.equal(usd(ON, 1_000_000, 0), 2);
    assert.equal(usd(ON, 0, 1_000_000), 10);
    assert.equal(ON.askCostUsd, 0.03);
    assert.equal(ON.scanCostUsd, 0.02);
    const limits = new Limits({ ...ON, visitorDailyLimit: 1000 });
    let admitted = 0;
    for (;;) {
      const ticket = limits.admit('v', ON.askCostUsd, 'ask');
      if (!ticket.ok) break;
      ticket.settle();
      admitted++;
    }
    assert.equal(admitted, 166);
  });

  test('ASK_COST_USD and SCAN_COST_USD are read from the server environment and must be positive numbers', () => {
    const config = readLimitsConfig({ ASK_COST_USD: '0.05', SCAN_COST_USD: '0.01' });
    assert.deepEqual([config.askCostUsd, config.scanCostUsd], [0.05, 0.01]);
    for (const env of [{ ASK_COST_USD: '0' }, { ASK_COST_USD: 'cheap' }, { SCAN_COST_USD: '-0.02' }]) assert.throws(() => readLimitsConfig(env), LimitsConfigError);
  });

  test('a question is counted at ASK_COST_USD, whatever the place or the length of the question', async () => {
    const engine = await startFakeEngine();
    const app = await startApp({ engineUrl: engine.url, limitsConfig: { enabled: true } });
    try {
      assert.equal((await ask(app, 'cardboard')).status, 200);
      assert.equal((await postJson(`${app.url}/api/ask`, { jurisdiction: 'hawaii_county_hi', query: 'cardboard '.repeat(100) })).status, 200);
      assert.ok(Math.abs(app.context.limits.status().spentUsd - 0.06) < 1e-9, String(app.context.limits.status().spentUsd));
    } finally {
      await app.close();
      await engine.close();
    }
  });
});
