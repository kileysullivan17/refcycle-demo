// POST /api/identify (contracts 4; CS-2, CS-4 to CS-10). The provider is replaced by a test double on
// globalThis.fetch, the same seam the review harness uses, so no model is called and no key is needed.
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { cleanName, IDENTIFY_INSTRUCTION, parseImage, readImageConfig, sanitizeReply } from '../../src/features/camera-scan/identify.ts';
import { LIMIT_MESSAGE } from '../../src/shared/limits.ts';
import { APP_DIR } from '../../src/shared/paths.ts';
import { postJson, startApp, type TestApp } from '../helpers/app.ts';
import { JPEG_DATA_URL, jpegOfSize, PNG_BASE64, PNG_DATA_URL, WEBP_DATA_URL } from '../helpers/images.ts';

type ProviderCall = { url: string; headers: Record<string, string>; body: any };
const realFetch = globalThis.fetch;
let calls: ProviderCall[] = [];
let reply: (call: ProviderCall) => Response = () => anthropicReply({ status: 'identified', label: 'plastic milk jug', candidates: [] });

function anthropicReply(value: unknown, extra: Record<string, unknown> = {}): Response {
  return Response.json({ id: 'msg_test', type: 'message', model: 'claude-sonnet-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }], usage: { input_tokens: 1500, output_tokens: 40 }, ...extra });
}

let app: TestApp;
beforeEach(async () => {
  calls = [];
  reply = () => anthropicReply({ status: 'identified', label: 'plastic milk jug', candidates: [] });
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith('https://api.anthropic.com/') && !url.startsWith('https://api.openai.com/')) return realFetch(input, init);
    const call = { url, headers: init.headers as Record<string, string>, body: JSON.parse(init.body) };
    calls.push(call);
    return reply(call);
  }) as typeof fetch;
  app = await startApp();
});
afterEach(async () => {
  globalThis.fetch = realFetch;
  await app.close();
});

const identify = (image: unknown = PNG_DATA_URL, target = app) => postJson(`${target.url}/api/identify`, { image });

describe('request checks', () => {
  test('JPEG, PNG and WebP data URLs are accepted', async () => {
    for (const image of [PNG_DATA_URL, JPEG_DATA_URL, WEBP_DATA_URL]) assert.equal((await identify(image)).status, 200);
  });

  test('anything else is HTTP 400 and never reaches the provider', async () => {
    const bad: unknown[] = [
      null,
      42,
      '',
      'https://example.org/photo.jpg',
      'data:image/gif;base64,R0lGODlhAQABAAAAACw=',
      'data:image/svg+xml;base64,PHN2Zy8+',
      'data:text/html;base64,PGI+',
      `data:image/jpeg;base64,${PNG_BASE64}`, // the bytes are not a JPEG
      'data:image/png;base64,', // empty
      'data:image/png;base64,not base64!!',
      `data:image/png,${PNG_BASE64}`,
    ];
    for (const image of bad) {
      const response = await identify(image);
      assert.equal(response.status, 400, String(image).slice(0, 40));
      assert.deepEqual(Object.keys(await response.json()), ['error']);
    }
    assert.equal((await postJson(`${app.url}/api/identify`, { image: PNG_DATA_URL, stream: 'recycle_bin' })).status, 400, 'extra keys');
    assert.equal((await postJson(`${app.url}/api/identify`, 'not json')).status, 400);
    assert.equal((await fetch(`${app.url}/api/identify`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ image: PNG_DATA_URL }) })).status, 400);
    assert.equal(calls.length, 0);
  });

  test('a decoded image over 5 MB is HTTP 400; one just under is accepted', async () => {
    assert.equal((await identify(jpegOfSize(5 * 1024 * 1024 + 1))).status, 400);
    assert.equal((await identify(jpegOfSize(5 * 1024 * 1024))).status, 200);
    assert.equal(calls.length, 1);
    assert.throws(() => parseImage(jpegOfSize(5 * 1024 * 1024 + 1)), /larger than 5 MB/);
  });
});

describe('what goes to the provider', () => {
  test('the image, a question about what the item is, the configured model, temperature 0, and the key in a header', async () => {
    await identify();
    assert.equal(calls.length, 1);
    const call = calls[0];
    assert.equal(call.url, 'https://api.anthropic.com/v1/messages');
    assert.equal(call.headers['x-api-key'], 'test-key-not-real');
    assert.equal(call.body.model, 'claude-sonnet-5-5');
    assert.equal(call.body.temperature, 0);
    assert.equal(call.body.system, IDENTIFY_INSTRUCTION);
    assert.deepEqual(call.body.messages[0].content[0], { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG_BASE64 } });
    assert.deepEqual(call.body.messages[0].content[1], { type: 'text', text: 'What is this item?' });
  });

  test('the instruction asks only what the item is: no stream, verdict or disposal answer, no brands', () => {
    assert.match(IDENTIFY_INSTRUCTION, /Say only what the item is/);
    assert.match(IDENTIFY_INSTRUCTION, /Never say whether or how it can be recycled/);
    assert.match(IDENTIFY_INSTRUCTION, /Never give a brand, product line or model name/);
    assert.match(IDENTIFY_INSTRUCTION, /Do not guess/);
    assert.doesNotMatch(IDENTIFY_INSTRUCTION, /recycle_bin|compost_bin|drop_off_special|deposit_return|seattle|austin|hawai/i);
  });

  test('the place is never sent: identification does not depend on it', async () => {
    await identify();
    assert.doesNotMatch(JSON.stringify(calls[0].body).replace(PNG_BASE64, ''), /seattle|austin|hawai|jurisdiction/i);
  });

  test('temperature is dropped for a model that rejects it, and remembered', async () => {
    const custom = await startApp({ env: { LLM_IMAGE_PROVIDER: 'anthropic', LLM_IMAGE_MODEL: 'no-temperature-model', ANTHROPIC_API_KEY: 'k' } });
    try {
      reply = (call) => ('temperature' in call.body ? Response.json({ type: 'error', error: { type: 'invalid_request_error', message: 'temperature is not supported for this model' } }, { status: 400 }) : anthropicReply({ status: 'unclear', label: null, candidates: [] }));
      assert.equal((await identify(PNG_DATA_URL, custom)).status, 200);
      assert.equal(calls.length, 2);
      assert.equal((await identify(PNG_DATA_URL, custom)).status, 200);
      assert.equal(calls.length, 3, 'the second scan skips temperature straight away');
      assert.ok(!('temperature' in calls[2].body));
    } finally {
      await custom.close();
    }
  });

  test('the OpenAI adapter is used when LLM_IMAGE_PROVIDER is openai', async () => {
    const openai = await startApp({ env: { LLM_IMAGE_PROVIDER: 'openai', LLM_IMAGE_MODEL: 'gpt-test', OPENAI_API_KEY: 'open-key' } });
    try {
      reply = () => Response.json({ model: 'gpt-test-2026', choices: [{ message: { role: 'assistant', content: JSON.stringify({ status: 'identified', label: 'glass jar', candidates: [] }) } }], usage: { prompt_tokens: 900, completion_tokens: 20 } });
      const response = await identify(PNG_DATA_URL, openai);
      assert.deepEqual(await response.json(), { status: 'identified', label: 'glass jar', candidates: [], model: 'openai/gpt-test-2026' });
      assert.equal(calls[0].url, 'https://api.openai.com/v1/chat/completions');
      assert.equal(calls[0].headers.Authorization, 'Bearer open-key');
      assert.equal(calls[0].body.messages[1].content[0].image_url.url, PNG_DATA_URL);
    } finally {
      await openai.close();
    }
  });

  test('settings default to anthropic and claude-sonnet-5-5; no key means no identification', async () => {
    assert.deepEqual(readImageConfig({ ANTHROPIC_API_KEY: 'k' }), { provider: 'anthropic', model: 'claude-sonnet-5-5', apiKey: 'k' });
    assert.equal(readImageConfig({}), null);
    assert.equal(readImageConfig({ LLM_IMAGE_PROVIDER: 'other', ANTHROPIC_API_KEY: 'k' }), null);
    const keyless = await startApp({ env: {} });
    try {
      const response = await identify(PNG_DATA_URL, keyless);
      assert.equal(response.status, 502);
      assert.equal(calls.length, 0);
    } finally {
      await keyless.close();
    }
  });
});

// Post-run fix (DECISIONS.md 53): cases ph19 and ph36 of the scored run of 2026-11-16. The image model, not
// the app, decides between "identified" and "multiple"; the app sets the instruction and passes the reply
// on. These tests use fake model answers, so they show what the app does with each kind of reply. Whether
// the real model follows the instruction is checked by the live fix-check run, not here.
describe('how many items the photo shows', () => {
  test('the instruction: several of one kind are one item, the surface is not an item, two kinds are "multiple"', () => {
    assert.match(IDENTIFY_INSTRUCTION, /Several of the same kind of item are one item/);
    assert.match(IDENTIFY_INSTRUCTION, /A difference in color, pattern or size alone does not make a different kind of item/);
    assert.match(IDENTIFY_INSTRUCTION, /Whatever the item rests on or in \(a table, counter, tray, dish, bag or hand\) is not an item/);
    assert.match(IDENTIFY_INSTRUCTION, /multiple: two or more different kinds of item are the subject of the photo/);
    assert.match(IDENTIFY_INSTRUCTION, /answer "multiple"\. Never choose one of them yourself/);
    assert.doesNotMatch(IDENTIFY_INSTRUCTION, /the photo shows more than one distinct item/, 'the wording that split ph19 and ph36 is gone');
  });

  test('several of one item: one plural label to confirm, and no list to choose from', async () => {
    for (const label of ['AA batteries', 'plastic drinking straws']) {
      reply = () => anthropicReply({ status: 'identified', label, candidates: [] });
      assert.deepEqual(await (await identify()).json(), { status: 'identified', label, candidates: [], model: 'anthropic/claude-sonnet-5-5' });
    }
  });

  test('two different items: "multiple" with both names; the app never picks one', async () => {
    for (const candidates of [['banana peel', 'apple core'], ['aluminum drink can', 'clear plastic water bottle']]) {
      reply = () => anthropicReply({ status: 'multiple', label: candidates[0], candidates });
      assert.deepEqual(await (await identify()).json(), { status: 'multiple', label: null, candidates, model: 'anthropic/claude-sonnet-5-5' });
    }
  });

  test('a "multiple" reply is passed on as it is: the app does not merge names that look alike', async () => {
    const candidates = ['red-striped plastic bendy straw', 'yellow-striped plastic straw', 'blue-striped plastic straw'];
    reply = () => anthropicReply({ status: 'multiple', label: null, candidates });
    const body = await (await identify()).json();
    assert.deepEqual([body.status, body.label, body.candidates], ['multiple', null, candidates]);
  });

  test('one item: "identified" with its label and no candidates, even if the model sends some', async () => {
    reply = () => anthropicReply({ status: 'identified', label: 'clear plastic water bottle', candidates: ['bottle cap', 'label'] });
    assert.deepEqual(await (await identify()).json(), { status: 'identified', label: 'clear plastic water bottle', candidates: [], model: 'anthropic/claude-sonnet-5-5' });
  });
});

describe('the response', () => {
  test('identified: status, a generic label, no candidates, and the exact model used', async () => {
    const response = await identify();
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'identified', label: 'plastic milk jug', candidates: [], model: 'anthropic/claude-sonnet-5-5' });
  });

  test('multiple: up to 4 candidate names and no label (CS-7)', async () => {
    reply = () => anthropicReply({ status: 'multiple', label: 'a pile', candidates: ['glass jar', 'steel can', 'glass jar', 'paper bag', 'plastic tub', 'cork'] });
    assert.deepEqual(await (await identify()).json(), { status: 'multiple', label: null, candidates: ['glass jar', 'steel can', 'paper bag', 'plastic tub'], model: 'anthropic/claude-sonnet-5-5' });
  });

  test('unclear: no label and no candidates (CS-5)', async () => {
    reply = () => anthropicReply({ status: 'unclear', label: 'maybe a box', candidates: ['box'] });
    assert.deepEqual(await (await identify()).json(), { status: 'unclear', label: null, candidates: [], model: 'anthropic/claude-sonnet-5-5' });
  });

  test('any stream, verdict or advice the model adds is dropped (CS-4)', async () => {
    reply = () => anthropicReply({ status: 'identified', label: 'pizza box', candidates: [], stream: 'compost_bin', verdict: 'Compost', recyclable: false, advice: 'Put it in the green cart', prep: ['remove food'] });
    const body = await (await identify()).json();
    assert.deepEqual(Object.keys(body).sort(), ['candidates', 'label', 'model', 'status']);
    assert.equal(body.label, 'pizza box');
    assert.doesNotMatch(JSON.stringify(body), /compost|green cart|recyclable|remove food/i);
  });

  test('a label that carries a verdict or an instruction is not used; the photo counts as unclear', () => {
    for (const label of ['recyclable plastic bottle', 'pizza box (goes in the compost)', 'battery: take to a drop-off site', 'not accepted foam cup', 'paint can, hazardous waste', 'bottle that should be rinsed']) {
      assert.equal(cleanName(label), null, label);
      assert.deepEqual(sanitizeReply(JSON.stringify({ status: 'identified', label, candidates: [] })), { status: 'unclear', label: null, candidates: [] });
    }
    for (const label of ['recycling bin', 'compost bag', 'garbage can', 'glass jar', 'cardboard box']) assert.equal(cleanName(label), label);
  });

  test('the label is trimmed, unquoted and at most 120 characters', () => {
    assert.equal(cleanName('  "plastic   milk\njug."  '), 'plastic milk jug');
    assert.equal(cleanName('x'.repeat(300))!.length, 120);
    assert.equal(cleanName(''), null);
    assert.equal(cleanName(null), null);
  });

  test('a reply that is not the expected JSON is unclear, never a guess', () => {
    for (const text of ['I think this is a bottle.', '{"status":"sure"}', '[]', '', null, '{"status":"identified","label":null}', '{"status":"identified"']) {
      assert.deepEqual(sanitizeReply(text), { status: 'unclear', label: null, candidates: [] }, String(text));
    }
    assert.equal(sanitizeReply('```json\n{"status":"identified","label":"steel can","candidates":[]}\n```').label, 'steel can');
    assert.equal(sanitizeReply('Here it is: {"status":"identified","label":"steel can","candidates":[]} Thanks').label, 'steel can');
  });

  test('a refusal from the model is unclear', async () => {
    reply = () => anthropicReply('', { stop_reason: 'refusal', content: [] });
    assert.equal((await (await identify()).json()).status, 'unclear');
  });

  test('a provider error or an unreachable provider is HTTP 502 with an error only', async () => {
    reply = () => Response.json({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }, { status: 529 });
    const overloaded = await identify();
    assert.equal(overloaded.status, 502);
    assert.deepEqual(Object.keys(await overloaded.json()), ['error']);
    reply = () => {
      throw new TypeError('fetch failed');
    };
    assert.equal((await identify()).status, 502);
  });
});

describe('photos are not stored (CS-10)', () => {
  test('the log holds time, status, label, model, duration and token counts, and nothing of the photo', async () => {
    await identify();
    reply = () => Response.json({}, { status: 500 });
    await identify();
    const lines = readFileSync(path.join(app.logsDir, 'identify.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(lines.length, 2);
    for (const line of lines) assert.deepEqual(Object.keys(line).sort(), ['duration_ms', 'input_tokens', 'label', 'model', 'output_tokens', 'status', 'timestamp']);
    assert.deepEqual([lines[0].status, lines[0].label, lines[0].model], ['identified', 'plastic milk jug', 'anthropic/claude-sonnet-5-5']);
    assert.deepEqual([lines[0].input_tokens, lines[0].output_tokens], [1500, 40], 'the counts the provider reported');
    assert.deepEqual([lines[1].input_tokens, lines[1].output_tokens], [null, null], 'no counts when the call failed');
    assert.equal(lines[1].status, 'error');
  });

  test('nothing the server writes contains the photo', async () => {
    await identify();
    const files = readdirSync(app.logsDir);
    assert.ok(files.includes('identify.jsonl'));
    for (const file of files) {
      const content = readFileSync(path.join(app.logsDir, file), 'utf8');
      assert.ok(!content.includes(PNG_BASE64.slice(0, 40)), file);
      assert.doesNotMatch(content, /data:image/);
    }
    assert.ok(!existsSync(path.join(app.logsDir, 'uploads')));
  });

  test('the photo goes to the provider and nowhere else', async () => {
    await identify();
    assert.deepEqual(calls.map((c) => new URL(c.url).host), ['api.anthropic.com']);
  });
});

describe('limits apply to scans too', () => {
  test('a scan counts against the visitor; at the limit the plain message comes back and the provider is not called', async () => {
    const limited = await startApp({ limitsConfig: { enabled: true, visitorDailyLimit: 2 } });
    try {
      assert.equal((await identify(PNG_DATA_URL, limited)).status, 200);
      assert.equal((await identify(PNG_DATA_URL, limited)).status, 200);
      const refused = await identify(PNG_DATA_URL, limited);
      assert.equal(refused.status, 429);
      assert.deepEqual(await refused.json(), { error: 'limit_reached', message: LIMIT_MESSAGE });
      assert.equal(calls.length, 2);
    } finally {
      await limited.close();
    }
  });

  test('at the limit a scan is refused before the upload is read, even a malformed one', async () => {
    const limited = await startApp({ limitsConfig: { enabled: true, visitorDailyLimit: 1 } });
    try {
      assert.equal((await identify(PNG_DATA_URL, limited)).status, 200);
      assert.equal((await identify(jpegOfSize(5 * 1024 * 1024), limited)).status, 429);
      assert.equal((await postJson(`${limited.url}/api/identify`, 'not json')).status, 429);
      assert.equal(calls.length, 1);
    } finally {
      await limited.close();
    }
  });

  test('a scan is charged at the provider’s reported usage', async () => {
    const limited = await startApp({ limitsConfig: { enabled: true } });
    try {
      await identify(PNG_DATA_URL, limited);
      // 1500 input tokens at 2 dollars and 40 output tokens at 10 dollars per million.
      assert.equal(limited.context.limits.status().spentUsd.toFixed(6), ((1500 * 2 + 40 * 10) / 1_000_000).toFixed(6));
    } finally {
      await limited.close();
    }
  });

  test('an invalid photo is refused before it can count against the visitor', async () => {
    const limited = await startApp({ limitsConfig: { enabled: true, visitorDailyLimit: 1 } });
    try {
      for (let i = 0; i < 3; i++) assert.equal((await identify('data:image/gif;base64,AAAA', limited)).status, 400);
      assert.equal((await identify(PNG_DATA_URL, limited)).status, 200);
    } finally {
      await limited.close();
    }
  });
});

test('the scan feature never asks the engine itself', () => {
  // Camera scan hands a confirmed or typed label to the item page; only the item page calls /api/ask.
  for (const file of ['src/features/camera-scan/identify.ts', 'src/features/camera-scan/routes.ts', 'public/features/camera-scan/screens.js', 'public/features/camera-scan/capture.js']) {
    const source = readFileSync(path.join(APP_DIR, file), 'utf8').replace(/^\s*\/\/.*$/gm, '');
    assert.doesNotMatch(source, /\/api\/ask|\bask\(|import \{[^}]*\bask\b/, file);
  }
});
