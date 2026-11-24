// The app server (contracts 2 and 2.1): engine forwarding, own routes, static files and client routes.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { FEATURE_MODULES } from '../../src/server.ts';
import { appendLog, MAX_LOG_BYTES } from '../../src/shared/logs.ts';
import { APP_DIR } from '../../src/shared/paths.ts';
import { postJson, startApp, type TestApp } from '../helpers/app.ts';
import { startFakeEngine, type FakeEngine } from '../helpers/fake-engine.ts';

let engine: FakeEngine;
let app: TestApp;

before(async () => {
  engine = await startFakeEngine();
  app = await startApp({ engineUrl: engine.url });
});
after(async () => {
  await app.close();
  await engine.close();
});

describe('engine forwarding', () => {
  test('GET /api/jurisdictions returns the engine’s list unchanged', async () => {
    const direct = await (await fetch(`${engine.url}/api/jurisdictions`)).text();
    const viaApp = await fetch(`${app.url}/api/jurisdictions`);
    assert.equal(viaApp.status, 200);
    assert.equal(await viaApp.text(), direct);
    assert.deepEqual(
      JSON.parse(direct).map((p: { id: string }) => p.id),
      ['austin_tx', 'hawaii_county_hi', 'seattle_wa'],
    );
  });

  test('POST /api/ask returns the engine’s answer unchanged', async () => {
    const body = { jurisdiction: 'hawaii_county_hi', query: 'clear #1 bottle' };
    const direct = await (await postJson(`${engine.url}/api/ask`, body)).json();
    const viaApp = await postJson(`${app.url}/api/ask`, body);
    assert.equal(viaApp.status, 200);
    const answer = await viaApp.json();
    assert.deepEqual(answer, direct);
    assert.equal(answer.behavior, 'answer');
    assert.equal(answer.stream, 'drop_off_special');
    assert.deepEqual(answer.rule_ids, ['hc-plastic-011']);
  });

  test('the engine’s HTTP 400 comes back as HTTP 400 with its message', async () => {
    for (const bad of [{ jurisdiction: 'seattle_wa' }, { jurisdiction: 'seattle_wa', query: 'x', extra: 1 }, 'not json']) {
      const direct = await postJson(`${engine.url}/api/ask`, bad);
      const viaApp = await postJson(`${app.url}/api/ask`, bad);
      assert.equal(viaApp.status, 400);
      assert.deepEqual(await viaApp.json(), await direct.json());
    }
    const wrongType = await fetch(`${app.url}/api/ask`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' });
    assert.equal(wrongType.status, 400);
  });

  test('a body over the engine’s 16,384 byte limit is refused', async () => {
    const response = await postJson(`${app.url}/api/ask`, { jurisdiction: 'seattle_wa', query: 'x'.repeat(20_000) });
    assert.equal(response.status, 400);
  });

  test('when the engine cannot be reached the app says so and invents nothing', async () => {
    const lonely = await startApp({ engineUrl: 'http://127.0.0.1:9' });
    try {
      const ask = await postJson(`${lonely.url}/api/ask`, { jurisdiction: 'seattle_wa', query: 'cardboard' });
      assert.equal(ask.status, 502);
      assert.deepEqual(Object.keys(await ask.json()), ['error']);
      assert.equal((await fetch(`${lonely.url}/api/jurisdictions`)).status, 502);
    } finally {
      await lonely.close();
    }
  });
});

describe('own routes', () => {
  test('POST /api/log/display-swap appends a timestamped record', async () => {
    const record = { surface: 'item.explanation', from: 'County of Hawaiʻi', to: 'Hawaiʻi County', count: 2, place: 'hawaii_county_hi' };
    const response = await postJson(`${app.url}/api/log/display-swap`, record);
    assert.equal(response.status, 204);
    const lines = readFileSync(path.join(app.logsDir, 'display-swaps.jsonl'), 'utf8').trim().split('\n');
    const last = JSON.parse(lines[lines.length - 1]);
    assert.match(last.timestamp, /^\d{4}-\d{2}-\d{2}T/);
    assert.deepEqual({ ...last, timestamp: undefined }, { ...record, timestamp: undefined });
  });

  test('a log file stops growing at its size cap, and the request still succeeds', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'refcycle-logcap-'));
    for (let i = 0; i < 50; i++) await appendLog(dir, 'capped.jsonl', { n: i, pad: 'x'.repeat(100) }, 2000);
    const size = statSync(path.join(dir, 'capped.jsonl')).size;
    assert.ok(size > 1000 && size <= 2000, String(size));
    assert.equal(MAX_LOG_BYTES, 5 * 1024 * 1024);
  });

  test('a malformed display-swap record is refused', async () => {
    for (const bad of [{}, { surface: 's', from: 'a', to: 'b', count: 0, place: 'x' }, { surface: 's', from: 'a', to: 'b', count: 1, place: 'x', extra: true }]) {
      assert.equal((await postJson(`${app.url}/api/log/display-swap`, bad)).status, 400);
    }
  });

  test('feature modules load in the contract’s order, then the whole-app additions', () => {
    assert.deepEqual(FEATURE_MODULES, ['recyclopedia', 'camera-scan', 'locator', 'guidelines', 'reuse']);
  });

  test('every API route in the contract answers', async () => {
    assert.equal((await fetch(`${app.url}/api/catalog`)).status, 200);
    assert.equal((await fetch(`${app.url}/api/sites?place=seattle_wa`)).status, 200);
    assert.equal((await postJson(`${app.url}/api/identify`, {})).status, 400);
  });

  test('anything else is 404 with { "error": "Not found" }', async () => {
    for (const [method, route] of [
      ['GET', '/api/nope'],
      ['GET', '/nope'],
      ['POST', '/home'],
      ['GET', '/recyclopedia/a/b'],
      ['DELETE', '/api/ask'],
      ['GET', '/api/ask'],
    ]) {
      const response = await fetch(app.url + route, { method });
      assert.equal(response.status, 404, `${method} ${route}`);
      assert.deepEqual(await response.json(), { error: 'Not found' });
    }
  });
});

describe('static files and client routes', () => {
  const clientRoutes = ['/', '/place', '/home', '/guidelines', '/another-life', '/item?entry=tires', '/recyclopedia', '/recyclopedia/plastic', '/search?q=x', '/scan', '/scan/confirm', '/locations?view=map', '/locations/f-sea-01'];

  test('every client route returns the app shell', async () => {
    const shell = readFileSync(path.join(APP_DIR, 'public', 'index.html'), 'utf8');
    for (const route of clientRoutes) {
      const response = await fetch(app.url + route);
      assert.equal(response.status, 200, route);
      assert.match(response.headers.get('content-type') ?? '', /text\/html/);
      assert.equal(await response.text(), shell, route);
    }
  });

  test('static files are served with their types and security headers', async () => {
    for (const [file, type] of [
      ['/shared/tokens.css', 'text/css'],
      ['/shared/app.js', 'text/javascript'],
      ['/shared/fonts/saira-semi-condensed-latin-700-normal.woff2', 'font/woff2'],
      ['/shared/vendor/leaflet/leaflet.js', 'text/javascript'],
      ['/shared/vendor/leaflet/images/marker-icon.png', 'image/png'],
    ]) {
      const response = await fetch(app.url + file);
      assert.equal(response.status, 200, file);
      assert.ok((response.headers.get('content-type') ?? '').startsWith(type), file);
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    }
    const csp = (await fetch(`${app.url}/`)).headers.get('content-security-policy') ?? '';
    assert.match(csp, /default-src 'self'/);
    assert.match(csp, /img-src 'self' data: blob: https:\/\/tile\.openstreetmap\.org/);
    assert.match(csp, /connect-src 'self'/);
    assert.match(csp, /script-src 'self'/);
    // The only outside origin the browser may load from is the OpenStreetMap tile server (contracts 2.1).
    assert.deepEqual(csp.match(/https?:\/\/[^\s;]+/g), ['https://tile.openstreetmap.org']);
  });

  test('nothing outside app/public can be read', async () => {
    for (const route of ['/../package.json', '/%2e%2e/package.json', '/shared/../../package.json', '/..%2f..%2fengine/rules/seattle_wa.yaml', '/shared/%00', '/.env', '/shared/fonts/../../../.env']) {
      const response = await fetch(app.url + route);
      assert.equal(response.status, 404, route);
    }
  });
});
