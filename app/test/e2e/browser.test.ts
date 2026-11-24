// The whole app in headless Chrome at phone width, against the pinned engine's own answer assembly with a
// fixture in place of the model, and a test double in place of the image provider. No provider is called.
// New screens are checked against the PRD addendum; the three original features against PRD and contracts.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, before, describe, test } from 'node:test';
import type { Browser, BrowserContext, Page } from 'playwright-core';
import { LIMIT_MESSAGE } from '../../src/shared/limits.ts';
import { REPO_DIR } from '../../src/shared/paths.ts';
import { startApp, type TestApp } from '../helpers/app.ts';
import { chromePath, launchChrome } from '../helpers/browser.ts';
import { startFakeEngine, type FakeEngine } from '../helpers/fake-engine.ts';
import { PNG_BYTES } from '../helpers/images.ts';

const BUSINESS = ['Big', 'Island', 'Biodiesel'].join(' ');
const STREAMS = ['Recycling', 'Compost', 'Garbage', 'Special drop-off', 'Deposit return'];

let browser: Browser | null = null;
let engine: FakeEngine;
let app: TestApp;
let imageReply: unknown = { status: 'identified', label: 'plastic milk jug', candidates: [] };
let providerCalls = 0;
const realFetch = globalThis.fetch;
const outside = new Set<string>();

before(async () => {
  browser = await launchChrome();
  if (chromePath()) assert.ok(browser, 'Chrome was found but could not be started');
  engine = await startFakeEngine();
  app = await startApp({ engineUrl: engine.url });
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith('https://api.anthropic.com/')) return realFetch(input, init);
    providerCalls++;
    return Response.json({ model: 'claude-sonnet-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(imageReply) }], usage: { input_tokens: 1200, output_tokens: 30 } });
  }) as typeof fetch;
});
after(async () => {
  globalThis.fetch = realFetch;
  await browser?.close();
  await app?.close();
  await engine?.close();
});

type Session = { context: BrowserContext; page: Page; errors: string[]; shared: () => Promise<any[]>; geo: () => Promise<number> };

async function open(target: TestApp = app, options: { width?: number; place?: string; share?: boolean } = {}): Promise<Session> {
  const context = await browser!.newContext({ viewport: { width: options.width ?? 430, height: 932 }, locale: 'en-US' });
  await context.addInitScript(
    ({ place, share }) => {
      (window as any).__geo = 0;
      const geo = navigator.geolocation;
      if (geo) {
        for (const name of ['getCurrentPosition', 'watchPosition'] as const) {
          (geo as any)[name] = () => {
            (window as any).__geo++;
          };
        }
      }
      (window as any).__shared = [];
      if (share) (navigator as any).share = async (data: unknown) => void (window as any).__shared.push(data);
      if (place && !sessionStorage.getItem('seeded')) {
        localStorage.setItem('refcycle.place', place);
        sessionStorage.setItem('seeded', '1');
      }
    },
    { place: options.place ?? null, share: options.share ?? false },
  );
  // Map tiles are answered locally so the tests need no network; every other outside request is recorded and refused.
  await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => {
    const url = route.request().url();
    if (url.startsWith('https://tile.openstreetmap.org/')) return route.fulfill({ status: 200, contentType: 'image/png', body: PNG_BYTES });
    outside.add(url);
    return route.abort();
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && !/Failed to load resource/.test(message.text())) errors.push(message.text());
  });
  return { context, page, errors, shared: () => page.evaluate(() => (window as any).__shared), geo: () => page.evaluate(() => (window as any).__geo) };
}

const main = (page: Page) => page.locator('main');
const mainText = async (page: Page) => (await main(page).innerText()).replace(/\s+/g, ' ').trim();
const state = (page: Page, name: string) => page.locator(`main [data-state="${name}"]`);
async function item(page: Page, target: TestApp, query: string, expected: string) {
  await page.goto(`${target.url}/item?q=${encodeURIComponent(query)}&origin=search`);
  await state(page, expected).waitFor({ timeout: 15_000 });
}
// Decided when the file loads, because node:test reads `skip` before the `before` hook has run.
const skip = () => (chromePath() ? false : 'Google Chrome was not found; set CHROME_PATH to run the browser tests');

describe('first use: intro and Place picker', () => {
  test('the first screen says the demo covers three Places only and is not kept up to date, with the picker under it', { skip: skip() }, async () => {
    const s = await open();
    await s.page.goto(app.url + '/');
    await s.page.getByRole('heading', { name: 'Welcome to RefCycle' }).waitFor();
    const text = await mainText(s.page);
    assert.match(text, /portfolio demo/);
    assert.match(text, /covers three Places only: Austin, TX; Hawaiʻi County, HI; Seattle, WA\./);
    assert.match(text, /not kept up to date/);
    assert.match(text, /does not use your location/);
    assert.match(text, /RefCycle began as a student concept by a five-person team in the Berkeley UX\/UI Boot Camp, UC Berkeley Extension, January 2024\. This rebuild and evaluation are solo work\./);
    for (const name of ['Austin, TX', 'Hawaiʻi County, HI', 'Seattle, WA']) assert.equal(await main(s.page).getByRole('button', { name, exact: true }).count(), 1, name);
    assert.equal(await s.page.locator('nav').isVisible(), false, 'no tab bar before a Place is chosen');
    assert.equal(await s.page.evaluate(() => localStorage.getItem('refcycle.place')), null, 'no default Place');
    assert.equal(await s.geo(), 0, 'no device location');
    assert.deepEqual(s.errors, []);
    await s.context.close();
  });

  test('choosing a Place stores it on the device and opens Home; "/" then goes to Home', { skip: skip() }, async () => {
    const s = await open();
    await s.page.goto(app.url + '/');
    await main(s.page).getByRole('button', { name: /hawai/i }).click();
    await s.page.waitForURL('**/home');
    assert.equal(await s.page.evaluate(() => localStorage.getItem('refcycle.place')), 'hawaii_county_hi');
    assert.equal(await s.page.locator('#place-select').inputValue(), 'hawaii_county_hi');
    assert.equal(await s.page.locator('nav').isVisible(), true);
    await s.page.goto(app.url + '/');
    await s.page.waitForURL('**/home');
    await s.context.close();
  });

  test('every route shows the first-use screen until a Place is chosen, then carries on to where the visitor was going', { skip: skip() }, async () => {
    const s = await open();
    await s.page.goto(app.url + '/recyclopedia/plastic');
    await s.page.getByRole('heading', { name: 'Welcome to RefCycle' }).waitFor();
    await main(s.page).getByRole('button', { name: /seattle/i }).click();
    await s.page.getByRole('heading', { name: 'Plastic', exact: true }).waitFor();
    assert.equal(new URL(s.page.url()).pathname, '/recyclopedia/plastic');
    await s.context.close();
  });

  test('a stored Place that the engine does not list brings the picker back', { skip: skip() }, async () => {
    const s = await open(app, { place: 'portland_or' });
    await s.page.goto(app.url + '/home');
    await s.page.getByRole('heading', { name: 'Choose your Place' }).waitFor();
    await s.context.close();
  });
});

describe('Home', () => {
  test('Home routes to the five parts of the app and holds no content of its own', { skip: skip() }, async () => {
    const s = await open(app, { place: 'austin_tx' });
    await s.page.goto(app.url + '/home');
    await s.page.locator('.home-tile').first().waitFor();
    const tiles = await main(s.page).locator('a.home-tile').evaluateAll((links) => links.map((a) => [a.textContent, a.getAttribute('href')]));
    assert.deepEqual(tiles, [
      ['Recyclopedia', '/recyclopedia'],
      ['Camera scan', '/scan'],
      ['Locations', '/locations'],
      ['Place guidelines', '/guidelines'],
      ['Give it another life', '/another-life'],
    ]);
    const text = await mainText(s.page);
    assert.doesNotMatch(text, /Handbook|News|Tip of the day/i);
    for (const label of STREAMS) assert.ok(!text.includes(label), label);
    const tabs = await s.page.locator('nav a').evaluateAll((links) => links.map((a) => a.textContent));
    assert.deepEqual(tabs, ['Recyclopedia', 'Camera', 'Locations']);
    await s.context.close();
  });
});

describe('Recyclopedia and the item page', () => {
  test('landing shows the ten category cards; a category lists its entries; an entry asks the engine by its name', { skip: skip() }, async () => {
    const s = await open(app, { place: 'seattle_wa' });
    await s.page.goto(app.url + '/recyclopedia');
    await s.page.locator('.category-card').first().waitFor();
    assert.deepEqual(await s.page.locator('.category-card').allInnerTexts(), ['Batteries', 'Biodegradable', 'Electronics', 'Glass', 'Metal', 'Paper', 'Plastic', 'Rubber', 'Wood', 'Miscellaneous']);
    await s.page.getByRole('link', { name: 'Rubber', exact: true }).click();
    await s.page.getByRole('link', { name: 'Tires', exact: true }).click();
    await state(s.page, 'card-red').waitFor();
    assert.deepEqual(engine.calls.at(-1), { place: 'seattle_wa', query: 'Tires' });
    assert.equal(new URL(s.page.url()).search, '?entry=tires');
    await s.context.close();
  });

  test('typing filters entries; Enter on text that matches nothing asks the engine as typed', { skip: skip() }, async () => {
    const s = await open(app, { place: 'seattle_wa' });
    await s.page.goto(app.url + '/recyclopedia');
    const box = s.page.getByRole('searchbox');
    await box.fill('pizza');
    await main(s.page).getByRole('link', { name: 'Pizza boxes', exact: true }).waitFor();
    assert.equal(await s.page.locator('.category-card').count(), 0);
    await box.fill('unicorn horn');
    await box.press('Enter');
    await state(s.page, 'referee-check-abstain').waitFor();
    assert.deepEqual(engine.calls.at(-1), { place: 'seattle_wa', query: 'unicorn horn' });
    await s.context.close();
  });

  test('Enter on text that matches entries lists them, with a way to ask about the text as typed', { skip: skip() }, async () => {
    const s = await open(app, { place: 'seattle_wa' });
    await s.page.goto(app.url + '/recyclopedia');
    const before = engine.calls.length;
    await s.page.getByRole('searchbox').fill('cardboard');
    await s.page.getByRole('searchbox').press('Enter');
    await s.page.waitForURL('**/search?q=cardboard');
    await main(s.page).getByRole('link', { name: 'Cardboard', exact: true }).waitFor();
    assert.equal(engine.calls.length, before, 'listing entries asks the engine nothing');
    await main(s.page).getByRole('link', { name: /^Ask about “cardboard” as typed$/ }).click();
    await state(s.page, 'card-blue').waitFor();
    assert.deepEqual(engine.calls.at(-1), { place: 'seattle_wa', query: 'cardboard' });
    await s.context.close();
  });

  test('answer states: a blue, yellow or red card with the stream label, driven by the engine only', { skip: skip() }, async () => {
    const s = await open(app, { place: 'hawaii_county_hi' });
    for (const [query, card, label] of [
      ['cardboard', 'card-blue', 'Recycling'],
      ['yard waste', 'card-blue', 'Compost'],
      ['soda can', 'card-blue', 'Deposit return'],
      ['pizza box', 'card-yellow', 'Garbage'],
      ['clear #1 bottle', 'card-red', 'Special drop-off'],
    ]) {
      await item(s.page, app, query, card);
      assert.equal(await state(s.page, card).innerText(), label, query);
      assert.equal(await s.page.locator('main .verdict').count(), 1);
      assert.doesNotMatch(await mainText(s.page), /Score!|Hazardous/);
    }
    assert.deepEqual(s.errors, []);
    await s.context.close();
  });

  test('the red card label is ink, bold and at least 19px in the real Saira Semi Condensed 700 face', { skip: skip() }, async () => {
    const s = await open(app, { place: 'hawaii_county_hi' });
    await item(s.page, app, 'clear #1 bottle', 'card-red');
    const style = await state(s.page, 'card-red').locator('span').evaluate((el) => {
      const cs = getComputedStyle(el);
      return { color: cs.color, weight: cs.fontWeight, size: parseFloat(cs.fontSize), family: cs.fontFamily, background: getComputedStyle(el.parentElement!).backgroundColor };
    });
    assert.deepEqual([style.color, style.weight, style.background], ['rgb(27, 39, 51)', '700', 'rgb(242, 140, 40)']);
    assert.ok(style.size >= 19);
    assert.match(style.family, /Saira Semi Condensed/);
    assert.equal(await s.page.evaluate(() => document.fonts.check('700 24px "Saira Semi Condensed"')), true);
    await s.context.close();
  });

  test('the item page shows the title, prep, the explanation unedited, the where text and the source links', { skip: skip() }, async () => {
    const s = await open(app, { place: 'seattle_wa' });
    await item(s.page, app, 'tires', 'card-red');
    const answer = await (await realFetch(`${app.url}/api/ask`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jurisdiction: 'seattle_wa', query: 'tires' }) })).json();
    assert.equal(await s.page.locator('main h1').innerText(), answer.item_interpreted);
    assert.equal(await s.page.locator('main p.pre-line').evaluate((el) => el.textContent), answer.explanation);
    const text = await mainText(s.page);
    for (const step of answer.prep) assert.ok(text.includes(step), step);
    assert.match(text, /sea-special-024/);
    await s.page.getByRole('heading', { name: 'Where the rules point' }).waitFor();
    const hrefs = await s.page.locator('main a[target="_blank"]').evaluateAll((links) => links.map((a) => (a as HTMLAnchorElement).href));
    for (const url of answer.source_urls) assert.ok(hrefs.includes(url), url);
    assert.doesNotMatch(text, /decompose|recycled annually|specialized facilities/i);
    assert.equal(await s.page.getByRole('button', { name: /upcycle/i }).count(), 0);
    await s.context.close();
  });

  test('clarify: the engine’s question, a reply box and Send; the reply is sent as the query plus the reply; no card', { skip: skip() }, async () => {
    const s = await open(app, { place: 'seattle_wa' });
    await item(s.page, app, 'bottle', 'referee-check-clarify');
    assert.match(await mainText(s.page), /Is the bottle glass or plastic\?/);
    assert.equal(await s.page.locator('main .verdict, main [class*="card-"]').count(), 0);
    assert.equal(await main(s.page).getByRole('link', { name: 'Dispose' }).count(), 0);
    for (const label of STREAMS) assert.ok(!(await mainText(s.page)).includes(label), label);
    await s.page.getByLabel('Your reply').fill('glass');
    await s.page.getByRole('button', { name: 'Send' }).click();
    await state(s.page, 'referee-check-abstain').waitFor();
    assert.deepEqual(engine.calls.at(-1), { place: 'seattle_wa', query: 'bottle glass' });
    await s.context.close();
  });

  test('conditional: every case with its stream as text, none picked, no card color (RC-7)', { skip: skip() }, async () => {
    const s = await open(app, { place: 'hawaii_county_hi' });
    await item(s.page, app, 'plastic', 'referee-check-conditional');
    const cases = await s.page.locator('main .case').allInnerTexts();
    assert.equal(cases.length, 4);
    assert.match(cases[0], /HI-5 deposit beverage container\s+Deposit return/);
    assert.match(cases[3], /any other plastic[\s\S]*Garbage/);
    assert.match(await mainText(s.page), /It depends/);
    assert.equal(await s.page.locator('main .verdict, main [class*="card-"]').count(), 0);
    const backgrounds = await s.page.locator('main .case').evaluateAll((els) => els.map((el) => getComputedStyle(el).backgroundColor));
    assert.ok(backgrounds.every((b) => b === 'rgba(0, 0, 0, 0)'), 'cases carry no card color');
    assert.equal(await main(s.page).getByRole('link', { name: 'Dispose' }).count(), 1, 'a case is special drop-off or deposit return');
    await s.context.close();
  });

  test('abstain: "We don’t know" with the official source link, and no verdict, card or stream', { skip: skip() }, async () => {
    const s = await open(app, { place: 'austin_tx' });
    await item(s.page, app, 'unicorn', 'referee-check-abstain');
    const text = await mainText(s.page);
    assert.match(text, /We don’t know/);
    assert.equal(await s.page.locator('main h1').innerText(), 'unicorn', 'the title is the query as sent when item_interpreted is null');
    assert.equal(await s.page.locator('main .verdict, main [class*="card-"]').count(), 0);
    for (const label of STREAMS) assert.ok(!text.includes(label), label);
    assert.equal(await main(s.page).getByRole('link', { name: 'https://www.austintexas.gov/recycling' }).count(), 1);
    assert.equal(await main(s.page).getByRole('link', { name: 'Dispose' }).count(), 0);
    await s.context.close();
  });

  test('a provider failure inside the engine is shown like any abstention', { skip: skip() }, async () => {
    const s = await open(app, { place: 'austin_tx' });
    await item(s.page, app, 'invalid model output please', 'referee-check-abstain');
    assert.match(await mainText(s.page), /We could not produce a verified answer from the local rules\./);
    await s.context.close();
  });

  test('error: when the engine rejects or cannot be reached, "No answer available right now" and Retry; nothing else', { skip: skip() }, async () => {
    const s = await open(app, { place: 'austin_tx' });
    await s.page.route('**/api/ask', (route) => route.fulfill({ status: 400, contentType: 'application/json', body: '{"error":"Invalid input"}' }));
    await item(s.page, app, 'tires', 'error');
    let text = await mainText(s.page);
    assert.match(text, /No answer available right now/);
    for (const label of STREAMS) assert.ok(!text.includes(label), label);
    assert.equal(await s.page.locator('main .verdict, main .referee-check').count(), 0);
    await s.page.unroute('**/api/ask');
    await s.page.route('**/api/ask', (route) => route.abort());
    await s.page.getByRole('button', { name: 'Retry' }).click();
    await s.page.waitForTimeout(300);
    assert.match(await mainText(s.page), /No answer available right now/);
    await s.page.unroute('**/api/ask');
    await s.page.getByRole('button', { name: 'Retry' }).click();
    await state(s.page, 'card-red').waitFor();
    text = await mainText(s.page);
    assert.match(text, /Special drop-off/);
    await s.context.close();
  });

  test('loading shows the query and a spinner, and no card', { skip: skip() }, async () => {
    const slowEngine = await startFakeEngine({ delayMs: 1500 });
    const slowApp = await startApp({ engineUrl: slowEngine.url });
    const s = await open(slowApp, { place: 'seattle_wa' });
    try {
      await s.page.goto(`${slowApp.url}/item?q=cardboard&origin=search`);
      await state(s.page, 'loading').waitFor();
      assert.match(await mainText(s.page), /^cardboard/);
      assert.equal(await s.page.locator('main .spinner').count(), 1);
      assert.equal(await s.page.locator('main .verdict').count(), 0);
      await state(s.page, 'card-blue').waitFor();
    } finally {
      await s.context.close();
      await slowApp.close();
      await slowEngine.close();
    }
  });

  test('changing the Place asks again for what is on screen (X-9)', { skip: skip() }, async () => {
    const s = await open(app, { place: 'seattle_wa' });
    await item(s.page, app, 'tires', 'card-red');
    assert.match(await mainText(s.page), /sea-special-024/);
    await s.page.locator('#place-select').selectOption('austin_tx');
    await s.page.getByText('atx-special-023').first().waitFor();
    assert.deepEqual(engine.calls.at(-1), { place: 'austin_tx', query: 'tires' });
    assert.doesNotMatch(await mainText(s.page), /sea-special-024/);
    assert.equal(await s.page.evaluate(() => localStorage.getItem('refcycle.place')), 'austin_tx');
    await s.context.close();
  });

  test('leaving an item page while the engine is thinking never paints its answer on the next screen', { skip: skip() }, async () => {
    const slowEngine = await startFakeEngine({ delayMs: 1200 });
    const slowApp = await startApp({ engineUrl: slowEngine.url });
    const s = await open(slowApp, { place: 'seattle_wa' });
    try {
      await s.page.goto(`${slowApp.url}/item?q=tires&origin=search`);
      await state(s.page, 'loading').waitFor();
      await s.page.locator('nav a', { hasText: 'Locations' }).click();
      await s.page.getByRole('heading', { name: 'Locations' }).waitFor();
      await s.page.waitForTimeout(1800);
      assert.equal(await s.page.locator('main .verdict').count(), 0);
      assert.equal(new URL(s.page.url()).pathname, '/locations');
    } finally {
      await s.context.close();
      await slowApp.close();
      await slowEngine.close();
    }
  });
});

describe('display-time text swap in the browser', () => {
  test('the Place name reads "Hawaiʻi County" everywhere the app writes it', { skip: skip() }, async () => {
    const s = await open(app, { place: 'hawaii_county_hi' });
    await s.page.goto(app.url + '/home');
    await s.page.locator('.home-tile').first().waitFor();
    assert.match(await mainText(s.page), /Your Place: Hawaiʻi County, HI/);
    assert.deepEqual(await s.page.locator('#place-select option').allInnerTexts(), ['Austin, TX', 'Hawaiʻi County, HI', 'Seattle, WA']);
    await s.context.close();
  });

  test('the withheld business is shown by description on the item page, the locator and the guidelines; the swap is logged', { skip: skip() }, async () => {
    const s = await open(app, { place: 'hawaii_county_hi' });
    await item(s.page, app, 'cooking oil large', 'card-red');
    await s.page.getByRole('heading', { name: 'Where the rules point' }).waitFor();
    let text = await mainText(s.page);
    assert.match(text, /a local biodiesel company accepts limited quantities \(call first\)/);
    assert.ok(!text.includes(BUSINESS));
    await main(s.page).getByRole('link', { name: 'Dispose' }).click();
    await s.page.locator('.site-card').first().waitFor();
    text = await mainText(s.page);
    assert.match(text, /A local biodiesel company \(call first\)/);
    assert.ok(!text.includes(BUSINESS));
    await s.page.goto(app.url + '/guidelines');
    await s.page.locator('[data-rule="hc-oil-015"]').first().waitFor();
    assert.ok(!(await s.page.locator('body').innerText()).includes(BUSINESS));
    await s.page.waitForTimeout(300);
    const log = readFileSync(path.join(app.logsDir, 'display-swaps.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    assert.ok(log.some((r) => r.from === BUSINESS && r.to === 'a local biodiesel company' && r.place === 'hawaii_county_hi' && /where/.test(r.surface)));
    assert.ok(log.some((r) => r.from === 'County of Hawaiʻi' && r.to === 'Hawaiʻi County'));
    await s.context.close();
  });

  test('quoted source lines keep the county’s own spelling', { skip: skip() }, async () => {
    const s = await open(app, { place: 'hawaii_county_hi' });
    await item(s.page, app, 'curbside', 'referee-check-clarify');
    await s.page.goto(app.url + '/guidelines');
    const quote = await s.page.locator('[data-rule="hc-system-000"] blockquote').first().innerText();
    assert.equal(quote, '“The County of Hawai`i currently does not have curbside rubbish or recycling pick-up services.”');
    await s.context.close();
  });
});

describe('Locator', () => {
  test('Dispose opens the locator for the item with only the cited rules’ sites, each with its source', { skip: skip() }, async () => {
    const s = await open(app, { place: 'seattle_wa' });
    await item(s.page, app, 'tires', 'card-red');
    await main(s.page).getByRole('link', { name: 'Dispose' }).click();
    await s.page.locator('.site-card').first().waitFor();
    const url = new URL(s.page.url());
    assert.equal(url.pathname, '/locations');
    assert.equal(url.searchParams.get('item'), 'tires');
    assert.equal(url.searchParams.get('rule_ids'), 'sea-special-024');
    assert.deepEqual(await s.page.locator('.site-card').evaluateAll((cards) => cards.map((c) => c.getAttribute('data-facility'))), ['f-sea-01', 'f-sea-02']);
    const text = await mainText(s.page);
    assert.match(text, /Where to take: tires/);
    assert.match(text, /North Transfer Station[\s\S]*1350 N 34th St, Seattle, WA 98103[\s\S]*\$16 per load, 4 tires max\.[\s\S]*checked 2026-11-05/);
    assert.doesNotMatch(text, /Household Hazardous Waste Facility|miles|km away|★|reviews/);
    const sources = await s.page.locator('.site-card a[target="_blank"]').evaluateAll((links) => links.map((a) => (a as HTMLAnchorElement).href));
    assert.deepEqual(sources, ['https://www.seattle.gov/utilities/your-services/collection-and-disposal/transfer-stations/north-station', 'https://www.seattle.gov/utilities/your-services/collection-and-disposal/transfer-stations/south-station']);
    assert.equal(await main(s.page).getByRole('button', { name: 'List' }).getAttribute('aria-pressed'), 'true');
    assert.equal(await s.geo(), 0);
    await s.context.close();
  });

  test('a location-limited rule shows its single site and says it is the only place; field reports say so with the date', { skip: skip() }, async () => {
    const s = await open(app, { place: 'hawaii_county_hi' });
    await item(s.page, app, 'clear #1 bottle', 'card-red');
    await main(s.page).getByRole('link', { name: 'Dispose' }).click();
    await s.page.locator('.site-card').first().waitFor();
    assert.equal(await s.page.locator('.site-card').count(), 1);
    const text = await mainText(s.page);
    assert.match(text, /A private recycler in Hilo \(#1 clear bottles\)/);
    assert.match(text, /This is the only place that takes this item\./);
    assert.match(text, /Field report dated 2026-11-03 \(phone call\); not a published page\./);
    assert.match(text, /Source: phone report, 2026-11-03/);
    await s.context.close();
  });

  test('a conditional answer lists the sites for every cited rule, grouped by rule (G19)', { skip: skip() }, async () => {
    const s = await open(app, { place: 'hawaii_county_hi' });
    await item(s.page, app, 'plastic', 'referee-check-conditional');
    await main(s.page).getByRole('link', { name: 'Dispose' }).click();
    await s.page.locator('.rule-group').first().waitFor();
    const groups = await s.page.locator('.rule-group').evaluateAll((sections) => sections.map((sec) => [sec.getAttribute('data-rule'), [...sec.querySelectorAll('.site-card')].map((c) => c.getAttribute('data-facility'))]));
    assert.deepEqual(groups, [
      ['hc-plastic-006', []],
      ['hc-plastic-011', ['f-hc-06']],
      ['hc-plastic-012', ['f-hc-07']],
    ]);
    await s.context.close();
  });

  test('when the pack names no place, the locator says so and links the official source (LOC-11)', { skip: skip() }, async () => {
    const s = await open(app, { place: 'hawaii_county_hi' });
    await s.page.goto(`${app.url}/locations?view=list&item=pizza%20box&rule_ids=hc-paper-002`);
    await s.page.getByText('The rules pack does not name a place for this item.').waitFor();
    assert.equal(await s.page.locator('.site-card').count(), 0);
    assert.equal(await main(s.page).getByRole('link', { name: 'Official recycling information' }).getAttribute('href'), 'https://www.hawaiizerowaste.org/recycle/drop-off/');
    await s.page.goto(`${app.url}/locations?view=list&item=unicorn&rule_ids=`);
    await s.page.getByText('The rules pack does not name a place for this item.').waitFor();
    await s.context.close();
  });

  test('with no item, every site for the Place by name; the filter narrows by material; no distances', { skip: skip() }, async () => {
    const s = await open(app, { place: 'seattle_wa' });
    await s.page.locator('body').waitFor();
    await s.page.goto(app.url + '/locations');
    await s.page.locator('.site-card').first().waitFor();
    assert.deepEqual(await s.page.locator('.site-card .site-name').allInnerTexts(), [
      'Curbside battery pickup (fee)',
      'North Household Hazardous Waste Facility',
      'North Transfer Station',
      'Set out used motor and cooking oil next to the recycle cart on collection day',
      'South Household Hazardous Waste Facility',
      'South Transfer Station',
    ]);
    assert.match(await s.page.locator('[data-facility="p-sea-01"]').innerText(), /How to/);
    await s.page.getByLabel('Filter by material accepted').selectOption('tires');
    await s.page.waitForURL('**material=tires**');
    await s.page.locator('.site-card').first().waitFor();
    assert.deepEqual(await s.page.locator('.site-card').evaluateAll((cards) => cards.map((c) => c.getAttribute('data-facility'))), ['f-sea-01', 'f-sea-02']);
    await s.context.close();
  });

  test('tentative events are labeled, with the date checked and the source; categories show as one entry', { skip: skip() }, async () => {
    const s = await open(app, { place: 'hawaii_county_hi' });
    await s.page.goto(app.url + '/locations');
    await s.page.locator('.site-card').first().waitFor();
    const event = await s.page.locator('[data-facility="f-hc-03"]').innerText();
    assert.match(event, /Tentative/);
    assert.match(event, /Tentative 2027-03-06\./);
    assert.match(event, /checked 2026-09-10/);
    assert.equal(await s.page.locator('[data-facility="f-hc-03"] a[target="_blank"]').getAttribute('href'), 'https://www.hawaiizerowaste.org/recycle/household-hazardous-waste/');
    assert.match(await s.page.locator('[data-facility="f-hc-08"]').innerText(), /HI-5 redemption centers \(14 on the island\)[\s\S]*Several sites/);
    assert.match(await s.page.locator('[data-facility="f-hc-01"]').innerText(), /location to be announced/);
    await s.context.close();
  });

  test('after an event’s last date it reads "Check the source for the next event"', { skip: skip() }, async () => {
    const s = await open(app, { place: 'hawaii_county_hi' });
    await s.page.clock.install({ time: new Date('2027-03-07T12:00:00') });
    await s.page.goto(app.url + '/locations');
    await s.page.locator('.site-card').first().waitFor();
    const waimea = await s.page.locator('[data-facility="f-hc-03"]').innerText();
    assert.match(waimea, /Check the source for the next event\./);
    assert.doesNotMatch(waimea, /Tentative/);
    assert.equal(await s.page.locator('[data-facility="f-hc-03"] a[target="_blank"]').count(), 1);
    assert.match(await s.page.locator('[data-facility="f-hc-04"]').innerText(), /Tentative 2027-03-07\./, 'the event on its last date is still tentative');
    await s.context.close();
  });

  test('the map shows only pinned sites, with the OpenStreetMap attribution; no pins means the list message', { skip: skip() }, async () => {
    const s = await open(app, { place: 'seattle_wa' });
    await s.page.goto(app.url + '/locations?view=map');
    await s.page.locator('.leaflet-marker-icon').first().waitFor();
    assert.equal(await s.page.locator('.leaflet-marker-icon').count(), 4);
    const attribution = s.page.locator('.leaflet-control-attribution a');
    assert.equal(await attribution.innerText(), '© OpenStreetMap contributors');
    assert.equal(await attribution.getAttribute('href'), 'https://www.openstreetmap.org/copyright');
    assert.equal(await main(s.page).getByRole('button', { name: 'Map' }).getAttribute('aria-pressed'), 'true');
    await s.page.goto(`${app.url}/locations?view=map&item=batteries&rule_ids=atx-special-017`);
    await s.page.locator('#place-select').selectOption('austin_tx');
    await s.page.goto(`${app.url}/locations?view=map&material=electronics`);
    await s.page.getByText('No mapped locations yet; see the list').waitFor();
    await main(s.page).getByRole('link', { name: 'List' }).last().click();
    await s.page.waitForURL('**view=list**');
    assert.deepEqual(s.errors, []);
    await s.context.close();
  });

  test('a facility page lists only the items its linked rules send there (LOC-9)', { skip: skip() }, async () => {
    const s = await open(app, { place: 'austin_tx' });
    await s.page.goto(app.url + '/locations');
    await s.page.getByRole('link', { name: 'Recycle and Reuse Drop-off Center' }).click();
    await s.page.getByRole('heading', { name: 'Accepts the following' }).waitFor();
    const text = await mainText(s.page);
    assert.match(text, /2514 Business Center Dr, Austin, TX 78744/);
    assert.match(text, /By appointment\. \$6 per tire\./);
    const response = await (await realFetch(`${app.url}/api/sites?place=austin_tx`)).json();
    const site = response.sites.find((x: any) => x.facility_id === 'f-atx-01');
    const expected = [...new Set(response.rules.filter((r: any) => site.rule_ids.includes(r.rule_id)).flatMap((r: any) => r.applies_to))];
    const listed = await s.page.locator('main section:has(h2:text("Accepts the following")) li').allInnerTexts();
    assert.deepEqual(listed, expected);
    await s.page.goto(app.url + '/locations/f-sea-01');
    await s.page.getByText('This location is not listed for this Place.').waitFor();
    await s.context.close();
  });
});

describe('Camera scan', () => {
  const photo = { name: 'photo.png', mimeType: 'image/png', buffer: PNG_BYTES };

  test('without a camera the screen offers photo upload; the controls the PRD lists are present', { skip: skip() }, async () => {
    const s = await open(app, { place: 'seattle_wa' });
    await s.page.goto(app.url + '/scan');
    await s.page.getByText('The camera is not available here. Choose a photo instead.').waitFor();
    assert.equal(await s.page.locator('input[type=file]').getAttribute('accept'), 'image/jpeg,image/png,image/webp');
    await main(s.page).getByText('Photos', { exact: true }).waitFor();
    await s.page.getByRole('button', { name: 'Snap Tips' }).click();
    await s.page.getByRole('heading', { name: 'Snap Tips' }).waitFor();
    assert.equal(await s.geo(), 0);
    await s.context.close();
  });

  test('with a camera: viewfinder, Identify, Photos, Snap Tips, close, flash and flip (CS-1)', { skip: skip() }, async () => {
    const context = await browser!.newContext({ viewport: { width: 430, height: 932 }, permissions: ['camera'] });
    await context.addInitScript(() => {
      localStorage.setItem('refcycle.place', 'seattle_wa');
      const canvas = document.createElement('canvas');
      canvas.width = 64;
      canvas.height = 48;
      const pen = canvas.getContext('2d')!;
      let tick = 0;
      setInterval(() => pen.fillRect(0, 0, 1 + (tick++ % 60), 48), 100); // a canvas stream only sends a frame when it changes
      (navigator.mediaDevices as any).getUserMedia = async () => (canvas as any).captureStream(5);
    });
    const page = await context.newPage();
    await page.goto(app.url + '/scan');
    await page.getByRole('button', { name: 'Identify' }).waitFor();
    await page.waitForFunction(() => !(document.querySelector('.scan-identify') as HTMLButtonElement).disabled);
    assert.equal(await page.locator('video.scan-video').isVisible(), true);
    for (const name of ['Flash', 'Flip camera']) assert.equal(await page.getByRole('button', { name }).count(), 1, name);
    assert.equal(await page.getByRole('link', { name: 'Close' }).count(), 1);
    assert.equal(await page.getByText('Photos', { exact: true }).count(), 1);
    assert.equal(await page.getByRole('button', { name: 'Snap Tips' }).count(), 1);
    imageReply = { status: 'identified', label: 'steel can', candidates: [] };
    await page.waitForFunction(() => (document.querySelector('video') as HTMLVideoElement).videoWidth > 0);
    await page.getByRole('button', { name: 'Identify' }).click();
    await page.getByRole('heading', { name: 'We think this is: steel can. Is that right?' }).waitFor();
    await context.close();
  });

  test('identified: "We think this is: ___. Is that right?"; the engine is asked only after Yes, with the label', { skip: skip() }, async () => {
    imageReply = { status: 'identified', label: 'cardboard box', candidates: [], stream: 'recycle_bin', advice: 'recycle it' };
    const s = await open(app, { place: 'seattle_wa' });
    await s.page.goto(app.url + '/scan');
    const asked = engine.calls.length;
    await s.page.locator('input[type=file]').setInputFiles(photo);
    await s.page.getByRole('heading', { name: 'We think this is: cardboard box. Is that right?' }).waitFor();
    assert.equal(new URL(s.page.url()).pathname, '/scan/confirm');
    assert.equal(engine.calls.length, asked, 'no engine call before the label is confirmed');
    const text = await mainText(s.page);
    for (const label of STREAMS) assert.ok(!text.includes(label), 'identification shows no verdict');
    assert.doesNotMatch(text, /recycle it/);
    await s.page.getByRole('button', { name: 'Yes', exact: true }).click();
    await state(s.page, 'card-blue').waitFor();
    assert.deepEqual(engine.calls.at(-1), { place: 'seattle_wa', query: 'cardboard box' });
    assert.equal(new URL(s.page.url()).searchParams.get('origin'), 'scan');
    await s.context.close();
  });

  test('Edit lets the resident correct the label before the engine is asked (CS-8)', { skip: skip() }, async () => {
    imageReply = { status: 'identified', label: 'rubber ring', candidates: [] };
    const s = await open(app, { place: 'austin_tx' });
    await s.page.goto(app.url + '/scan');
    await s.page.locator('input[type=file]').setInputFiles(photo);
    await s.page.getByRole('button', { name: 'Edit' }).click();
    const field = s.page.getByLabel('Correct the item');
    assert.equal(await field.inputValue(), 'rubber ring');
    await field.fill('car tires');
    await s.page.getByRole('button', { name: 'Use this' }).click();
    await state(s.page, 'card-red').waitFor();
    assert.deepEqual(engine.calls.at(-1), { place: 'austin_tx', query: 'car tires' });
    await s.context.close();
  });

  test('several of one item: one plural label to confirm, no "which one" list, and nothing asked before Yes', { skip: skip() }, async () => {
    imageReply = { status: 'identified', label: 'plastic drinking straws', candidates: [] };
    const s = await open(app, { place: 'austin_tx' });
    await s.page.goto(app.url + '/scan');
    const asked = engine.calls.length;
    await s.page.locator('input[type=file]').setInputFiles(photo);
    await s.page.getByRole('heading', { name: 'We think this is: plastic drinking straws. Is that right?' }).waitFor();
    assert.equal(await s.page.getByRole('heading', { name: /more than one item/ }).count(), 0);
    assert.equal(engine.calls.length, asked, 'the label is never used before the resident confirms it');
    await s.page.getByRole('button', { name: 'Yes', exact: true }).click();
    await s.page.waitForURL(/\/item\?/);
    for (let i = 0; i < 50 && engine.calls.length === asked; i++) await s.page.waitForTimeout(100);
    assert.deepEqual(engine.calls.at(-1), { place: 'austin_tx', query: 'plastic drinking straws' });
    await s.context.close();
  });

  test('more than one item: the app asks which one and does not merge them (CS-7)', { skip: skip() }, async () => {
    imageReply = { status: 'multiple', label: null, candidates: ['cardboard box', 'car tires'] };
    const s = await open(app, { place: 'austin_tx' });
    await s.page.goto(app.url + '/scan');
    const asked = engine.calls.length;
    await s.page.locator('input[type=file]').setInputFiles(photo);
    await s.page.getByRole('heading', { name: 'This photo shows more than one item. Which one do you mean?' }).waitFor();
    assert.equal(engine.calls.length, asked);
    assert.equal(await s.page.getByRole('button', { name: /^yes/i }).count(), 0);
    await s.page.getByRole('button', { name: 'car tires' }).click();
    await state(s.page, 'card-red').waitFor();
    assert.deepEqual(engine.calls.at(-1), { place: 'austin_tx', query: 'car tires' });
    await s.context.close();
  });

  test('unclear: retake or type the item; the engine is never asked with a guess (CS-5)', { skip: skip() }, async () => {
    imageReply = { status: 'unclear', label: 'maybe a can', candidates: [] };
    const s = await open(app, { place: 'austin_tx' });
    await s.page.goto(app.url + '/scan');
    const asked = engine.calls.length;
    await s.page.locator('input[type=file]').setInputFiles(photo);
    await s.page.getByRole('heading', { name: 'We could not tell what this is.' }).waitFor();
    assert.doesNotMatch(await mainText(s.page), /maybe a can/);
    assert.equal(await s.page.getByRole('link', { name: 'Retake photo' }).getAttribute('href'), '/scan');
    assert.equal(engine.calls.length, asked);
    await s.page.getByLabel('Type the item').fill('cardboard');
    await s.page.getByRole('button', { name: 'Look it up' }).click();
    await state(s.page, 'card-blue').waitFor();
    assert.deepEqual(engine.calls.at(-1), { place: 'austin_tx', query: 'cardboard' });
    await s.context.close();
  });

  test('a provider failure offers retake or typing, and /scan/confirm with nothing pending returns to the scan screen', { skip: skip() }, async () => {
    const s = await open(app, { place: 'austin_tx' });
    await s.page.route('**/api/identify', (route) => route.fulfill({ status: 502, contentType: 'application/json', body: '{"error":"The image model could not be reached"}' }));
    await s.page.goto(app.url + '/scan');
    await s.page.locator('input[type=file]').setInputFiles(photo);
    await s.page.getByText('The photo could not be identified. Retake it, choose another photo, or type the item.').waitFor();
    assert.equal(await s.page.getByLabel('Type the item').count(), 1);
    await s.page.goto(app.url + '/scan/confirm');
    await s.page.waitForURL('**/scan');
    await s.context.close();
  });

  test('the photo is sent to /api/identify only and is not kept in the browser', { skip: skip() }, async () => {
    imageReply = { status: 'identified', label: 'glass jar', candidates: [] };
    const s = await open(app, { place: 'seattle_wa' });
    const bodies: { url: string; size: number }[] = [];
    s.page.on('request', (request) => {
      const data = request.postData();
      if (data && data.includes('data:image/')) bodies.push({ url: new URL(request.url()).pathname, size: data.length });
    });
    await s.page.goto(app.url + '/scan');
    await s.page.locator('input[type=file]').setInputFiles(photo);
    await s.page.getByRole('button', { name: 'Yes', exact: true }).click();
    await state(s.page, 'referee-check-abstain').waitFor();
    assert.deepEqual(bodies.map((b) => b.url), ['/api/identify']);
    const stored = await s.page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
    assert.doesNotMatch(stored, /data:image|iVBOR/);
    await s.context.close();
  });
});

describe('Place guidelines', () => {
  test('summary, rules by stream with quote and source, the hazardous waste section, and the official link', { skip: skip() }, async () => {
    const s = await open(app, { place: 'hawaii_county_hi' });
    await s.page.goto(app.url + '/guidelines');
    await s.page.getByRole('heading', { name: 'Guidelines for Hawaiʻi County, HI' }).waitFor();
    const headings = await s.page.locator('main h2').allInnerTexts();
    assert.deepEqual(headings, ['How the local system works', 'Recycling', 'Compost', 'Garbage', 'Deposit return', 'Depends on the item', 'About the local service', 'Hazardous waste and special drop-off']);
    const text = await mainText(s.page);
    assert.match(text, /No curbside rubbish or recycling pickup\. Residents take materials to County Recycling and Transfer Stations\./);
    assert.match(text, /shown as written/);
    assert.match(text, /not kept up to date/);
    const hazard = s.page.locator('#hazardous-waste');
    assert.deepEqual(await hazard.locator('.rule-card').evaluateAll((cards) => cards.map((c) => c.getAttribute('data-rule'))), ['hc-plastic-006', 'hc-plastic-011', 'hc-plastic-012', 'hc-metal-007', 'hc-oil-015', 'hc-hhw-010', 'hc-hhw-017', 'hc-hhw-018', 'hc-tires-019']);
    const hhw = await hazard.locator('[data-rule="hc-hhw-010"]').innerText();
    assert.match(hhw, /Special drop-off/);
    assert.match(hhw, /“Automotive fluids \(including antifreeze\/engine coolant/);
    assert.match(hhw, /County Household Hazardous Waste Collection Events, residential households only\./);
    assert.equal(await hazard.locator('[data-rule="hc-hhw-010"] a[target="_blank"]').getAttribute('href'), 'https://www.hawaiizerowaste.org/recycle/household-hazardous-waste/');
    const field = await hazard.locator('[data-rule="hc-plastic-011"]').innerText();
    assert.match(field, /Only one place takes this\./);
    assert.match(field, /Field report, Pack author, dated 2026-11-03 \(phone call\); not a published page/);
    const inferred = await s.page.locator('[data-rule="hc-green-009"]').innerText();
    assert.match(inferred, /The destination is the pack author’s inference, not an explicit disposal instruction in the source\./);
    assert.equal(await main(s.page).getByRole('link', { name: 'Official contact page' }).first().getAttribute('href'), 'https://www.hawaiizerowaste.org/recycle/drop-off/');
    assert.doesNotMatch(text, /superseded|verified_by_ks|Starting December 1, 2018/);
    assert.equal(await s.page.locator('main input, main textarea, main form').count(), 0, 'read-only');
    assert.deepEqual(s.errors, []);
    await s.context.close();
  });

  test('the guidelines follow the selected Place and ask the engine nothing', { skip: skip() }, async () => {
    const s = await open(app, { place: 'austin_tx' });
    const asked = engine.calls.length;
    await s.page.goto(app.url + '/guidelines');
    await s.page.getByRole('heading', { name: 'Guidelines for Austin, TX' }).waitFor();
    assert.ok((await s.page.locator('.rule-card').count()) >= 24);
    assert.equal(await s.page.locator('[data-rule^="sea-"], [data-rule^="hc-"]').count(), 0);
    await s.page.locator('#place-select').selectOption('seattle_wa');
    await s.page.getByRole('heading', { name: 'Guidelines for Seattle, WA' }).waitFor();
    assert.equal(await s.page.locator('[data-rule^="atx-"]').count(), 0);
    assert.equal(engine.calls.length, asked);
    await s.context.close();
  });
});

describe('Give it another life', () => {
  test('the Place’s outside links, each labeled as an outside resource and opening in a new tab', { skip: skip() }, async () => {
    const s = await open(app, { place: 'austin_tx' });
    await s.page.goto(app.url + '/another-life');
    await s.page.locator('.reuse-card').first().waitFor();
    const cards = await s.page.locator('.reuse-card').evaluateAll((items) =>
      items.map((card) => {
        const link = card.querySelector('a')!;
        return [card.querySelector('.reuse-tag')!.textContent, link.textContent!.trim(), link.href, link.target, link.rel];
      }),
    );
    assert.deepEqual(cards, [
      ['Outside resource', 'Austin Reuse Directory', 'https://austinreusedirectory.com/', '_blank', 'noopener noreferrer'],
      ['Outside resource, any Place', 'Community Repair Hub', 'https://www.ifixit.com/Community/Events', '_blank', 'noopener noreferrer'],
    ]);
    const text = await mainText(s.page);
    assert.match(text, /These are outside resources run by other organizations\./);
    assert.match(text, /They never change an answer RefCycle shows\./);
    for (const label of STREAMS) assert.ok(!text.includes(label), label);
    await s.context.close();
  });

  test('each item page shows a small link to it below the engine’s answer, and the answer is the same with or without it', { skip: skip() }, async () => {
    const s = await open(app, { place: 'hawaii_county_hi' });
    await item(s.page, app, 'soda can', 'card-blue');
    const link = main(s.page).getByRole('link', { name: 'Give it another life: outside reuse and repair links' });
    assert.equal(await link.getAttribute('href'), '/another-life');
    const order = await s.page.evaluate(() => {
      const verdict = document.querySelector('main .verdict')!;
      const explanation = document.querySelector('main p.pre-line')!;
      const reuse = document.querySelector('main a[href="/another-life"]')!;
      return [verdict.compareDocumentPosition(reuse) & Node.DOCUMENT_POSITION_FOLLOWING, explanation.compareDocumentPosition(reuse) & Node.DOCUMENT_POSITION_FOLLOWING];
    });
    assert.deepEqual(order, [4, 4], 'the link sits after the verdict and the explanation');
    const withLink = await s.page.locator('main article').evaluate((el) => [el.querySelector('.verdict')!.textContent, el.querySelector('p.pre-line')!.textContent]);
    await link.click();
    await s.page.locator('.reuse-card').first().waitFor();
    await s.page.goBack();
    await state(s.page, 'card-blue').waitFor();
    const again = await s.page.locator('main article').evaluate((el) => [el.querySelector('.verdict')!.textContent, el.querySelector('p.pre-line')!.textContent]);
    assert.deepEqual(again, withLink);
    for (const neutral of [['unicorn', 'referee-check-abstain'], ['plastic', 'referee-check-conditional'], ['curbside', 'referee-check-clarify']]) {
      await item(s.page, app, neutral[0], neutral[1]);
      assert.equal(await main(s.page).getByRole('link', { name: /^Give it another life/ }).count(), 1, neutral[1]);
    }
    await s.context.close();
  });
});

describe('remembered on the device, and forgetting', () => {
  test('recent items appear on Home, hold no answer, and reopening one asks the engine again', { skip: skip() }, async () => {
    const s = await open(app, { place: 'seattle_wa' });
    await item(s.page, app, 'unicorn', 'referee-check-abstain');
    await s.page.goto(app.url + '/item?entry=tires');
    await state(s.page, 'card-red').waitFor();
    await s.page.goto(app.url + '/home');
    await s.page.locator('.home-tile').first().waitFor();
    assert.deepEqual(await s.page.locator('main section[aria-label="Recent items"] a').evaluateAll((links) => links.map((a) => [a.textContent, a.getAttribute('href')])), [
      ['Tires', '/item?entry=tires'],
      ['unicorn', '/item?q=unicorn&origin=search'],
    ]);
    const stored = await s.page.evaluate(() => localStorage.getItem('refcycle.recent'));
    assert.deepEqual(JSON.parse(stored!), [
      { place: 'seattle_wa', entry: 'tires', label: 'Tires' },
      { place: 'seattle_wa', q: 'unicorn', label: 'unicorn' },
    ]);
    assert.doesNotMatch(stored!, /Special drop-off|drop_off_special|abstain|sea-special|explanation/);
    assert.deepEqual(await s.page.evaluate(() => Object.keys(localStorage).sort()), ['refcycle.place', 'refcycle.recent']);
    const asked = engine.calls.length;
    await s.page.getByRole('link', { name: 'Tires' }).click();
    await state(s.page, 'card-red').waitFor();
    assert.equal(engine.calls.length, asked + 1, 'no cached answer: the engine is asked again');
    assert.equal(await s.page.evaluate(() => document.cookie), '', 'no cookies');
    await s.context.close();
  });

  test('recent items are listed per Place, and nothing about them is sent to the server', { skip: skip() }, async () => {
    const s = await open(app, { place: 'seattle_wa' });
    const posts: string[] = [];
    const sent: string[] = [];
    s.page.on('request', (request) => {
      if (request.method() !== 'POST') return;
      posts.push(new URL(request.url()).pathname);
      if (!request.url().endsWith('/api/ask')) sent.push(request.postData() ?? '');
    });
    await item(s.page, app, 'cardboard', 'card-blue');
    await s.page.goto(app.url + '/home');
    await s.page.locator('main section[aria-label="Recent items"]').waitFor();
    await s.page.locator('#place-select').selectOption('austin_tx');
    await s.page.locator('.home-tile').first().waitFor();
    assert.equal(await s.page.locator('main section[aria-label="Recent items"]').count(), 0);
    // The only posts are the question itself and the display-swap log (place names), which names no item.
    assert.deepEqual([...new Set(posts)].sort(), ['/api/ask', '/api/log/display-swap']);
    assert.doesNotMatch(sent.join('\n'), /cardboard|recent|refcycle\.recent/);
    await s.context.close();
  });

  test('Forget clears the Place and the recent items and returns to the first screen', { skip: skip() }, async () => {
    const s = await open(app, { place: 'seattle_wa' });
    await item(s.page, app, 'cardboard', 'card-blue');
    await s.page.goto(app.url + '/home');
    await s.page.getByRole('button', { name: 'Forget my Place and recent items' }).click();
    await s.page.getByRole('heading', { name: 'Welcome to RefCycle' }).waitFor();
    assert.deepEqual(await s.page.evaluate(() => Object.keys(localStorage)), []);
    assert.equal(await s.page.locator('#place-select').inputValue(), '');
    await s.page.reload();
    await s.page.getByRole('heading', { name: 'Welcome to RefCycle' }).waitFor();
    await s.page.goto(app.url + '/place');
    await s.page.getByRole('heading', { name: 'Choose a Place' }).waitFor();
    assert.equal(await s.page.getByRole('button', { name: 'Forget my Place and recent items' }).count(), 0, 'nothing to forget');
    await s.context.close();
  });

  test('the Place picker screen also carries the forget control', { skip: skip() }, async () => {
    const s = await open(app, { place: 'austin_tx' });
    await s.page.goto(app.url + '/place');
    assert.equal(await main(s.page).getByRole('button', { name: 'Austin, TX' }).getAttribute('aria-pressed'), 'true');
    await s.page.getByRole('button', { name: 'Forget my Place and recent items' }).click();
    await s.page.getByRole('heading', { name: 'Welcome to RefCycle' }).waitFor();
    await s.context.close();
  });
});

describe('sharing', () => {
  test('one Share button opens the device share sheet with a link that carries the Place and the item, not the answer', { skip: skip() }, async () => {
    const s = await open(app, { place: 'austin_tx', share: true });
    await s.page.goto(app.url + '/item?entry=tires');
    await state(s.page, 'card-red').waitFor();
    assert.equal(await main(s.page).getByRole('button', { name: 'Share' }).count(), 1);
    await main(s.page).getByRole('button', { name: 'Share' }).click();
    const shared = await s.shared();
    assert.equal(shared.length, 1);
    assert.deepEqual(Object.keys(shared[0]).sort(), ['title', 'url']);
    assert.equal(shared[0].url, `${app.url}/item?entry=tires&place=austin_tx`);
    assert.doesNotMatch(JSON.stringify(shared[0]), /Special drop-off|drop_off|atx-special|By appointment/);
    await item(s.page, app, 'old car tires', 'card-red');
    await main(s.page).getByRole('button', { name: 'Share' }).click();
    assert.equal((await s.shared())[0].url, `${app.url}/item?q=old+car+tires&place=austin_tx`);
    await s.context.close();
  });

  test('without a share sheet the link is copied or shown', { skip: skip() }, async () => {
    const s = await open(app, { place: 'austin_tx' });
    await s.context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await s.page.addInitScript(() => {
      delete (Navigator.prototype as any).share;
    });
    await s.page.goto(app.url + '/item?entry=tires');
    await state(s.page, 'card-red').waitFor();
    await main(s.page).getByRole('button', { name: 'Share' }).click();
    await s.page.getByText(/Link copied\.|Copy this link:/).waitFor();
    const status = await s.page.locator('main .status-line').innerText();
    if (status === 'Link copied.') assert.equal(await s.page.evaluate(() => navigator.clipboard.readText()), `${app.url}/item?entry=tires&place=austin_tx`);
    else assert.equal(await s.page.getByLabel('Link to this item').inputValue(), `${app.url}/item?entry=tires&place=austin_tx`);
    await s.context.close();
  });

  test('opening a shared link on a new device sets the Place, skips the intro and gets the engine’s current answer', { skip: skip() }, async () => {
    const s = await open();
    const asked = engine.calls.length;
    await s.page.goto(`${app.url}/item?entry=tires&place=hawaii_county_hi`);
    await state(s.page, 'card-red').waitFor();
    assert.equal(engine.calls.length, asked + 1);
    assert.deepEqual(engine.calls.at(-1), { place: 'hawaii_county_hi', query: 'Tires' });
    assert.equal(await s.page.evaluate(() => localStorage.getItem('refcycle.place')), 'hawaii_county_hi');
    assert.equal(new URL(s.page.url()).search, '?entry=tires', 'the place leaves the address bar');
    assert.match(await mainText(s.page), /hc-tires-019/);
    await s.context.close();
  });

  test('a shared link with a Place this demo does not cover falls back to the first-use screen', { skip: skip() }, async () => {
    const s = await open();
    await s.page.goto(`${app.url}/item?entry=tires&place=portland_or`);
    await s.page.getByRole('heading', { name: 'Welcome to RefCycle' }).waitFor();
    assert.equal(await s.page.evaluate(() => localStorage.getItem('refcycle.place')), null);
    await s.context.close();
  });
});

describe('the limit message', () => {
  test('at the limit: the plain message, no answer of any kind, and everything without a model call still works', { skip: skip() }, async () => {
    const limited = await startApp({ engineUrl: engine.url, limitsConfig: { enabled: true, visitorDailyLimit: 1 } });
    const s = await open(limited, { place: 'seattle_wa' });
    try {
      await item(s.page, limited, 'tires', 'card-red');
      const asked = engine.calls.length;
      await item(s.page, limited, 'tires', 'limit');
      const text = await mainText(s.page);
      assert.ok(text.includes(LIMIT_MESSAGE));
      assert.match(text, /Demo limit reached/);
      for (const label of STREAMS) assert.ok(!text.includes(label), `no ${label} at the limit`);
      assert.equal(await s.page.locator('main .verdict, main .referee-check, main p.pre-line').count(), 0, 'no cached or guessed answer');
      assert.doesNotMatch(text, /sea-special-024/);
      assert.equal(engine.calls.length, asked);

      imageReply = { status: 'identified', label: 'glass jar', candidates: [] };
      const provider = providerCalls;
      await s.page.goto(limited.url + '/scan');
      await s.page.locator('input[type=file]').setInputFiles({ name: 'p.png', mimeType: 'image/png', buffer: PNG_BYTES });
      await s.page.locator('main [data-state="limit"]').waitFor();
      assert.equal(providerCalls, provider, 'the image model is not called at the limit');

      await s.page.goto(limited.url + '/recyclopedia/rubber');
      await s.page.getByRole('link', { name: 'Tires', exact: true }).waitFor();
      await s.page.goto(limited.url + '/guidelines');
      await s.page.locator('.rule-card').first().waitFor();
      await s.page.goto(limited.url + '/locations');
      await s.page.locator('.site-card').first().waitFor();
      await s.page.goto(limited.url + '/another-life');
      await s.page.locator('.reuse-card').first().waitFor();
    } finally {
      await s.context.close();
      await limited.close();
    }
  });
});

describe('look and layout', () => {
  const screens = ['/', '/home', '/recyclopedia', '/recyclopedia/paper', '/search?q=plastic', '/item?q=plastic&origin=search', '/item?q=clear%20%231%20bottle&origin=search', '/scan', '/locations', '/locations/f-hc-03', '/guidelines', '/another-life', '/place'];

  test('usable from 320px: no screen scrolls sideways', { skip: skip() }, async () => {
    const s = await open(app, { place: 'hawaii_county_hi', width: 320 });
    for (const route of screens.slice(1)) {
      await s.page.goto(app.url + route);
      await s.page.waitForFunction(() => !document.querySelector('main .spinner') && !document.querySelector('main[aria-busy]'));
      const overflow = await s.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(overflow <= 0, `${route} overflows by ${overflow}px`);
    }
    await s.context.close();
  });

  test('centered with a 430px maximum on a wide screen', { skip: skip() }, async () => {
    const s = await open(app, { place: 'seattle_wa', width: 1200 });
    await s.page.goto(app.url + '/home');
    const box = await s.page.locator('#app').boundingBox();
    assert.equal(box!.width, 430);
    assert.equal(Math.round(box!.x), 385);
    await s.context.close();
  });

  test('every screen, new ones included, renders in the decision 18 tokens', { skip: skip() }, async () => {
    const s = await open(app, { place: 'hawaii_county_hi' });
    const allowed = new Set(['rgb(29, 92, 150)', 'rgb(27, 39, 51)', 'rgb(213, 218, 223)', 'rgb(242, 140, 40)', 'rgb(230, 239, 246)', 'rgb(255, 255, 255)', 'rgba(0, 0, 0, 0)']);
    for (const route of screens.slice(1)) {
      await s.page.goto(app.url + route);
      await s.page.waitForFunction(() => !document.querySelector('main .spinner') && !document.querySelector('main[aria-busy]'));
      const report = await s.page.evaluate(() => {
        const colors = new Set<string>();
        const fonts = new Set<string>();
        const sizes = new Set<string>();
        for (const el of document.querySelectorAll('#app, #app *:not(option)')) {
          if (el.closest('svg') || el.closest('.leaflet-container')) continue;
          const cs = getComputedStyle(el);
          colors.add(cs.color);
          colors.add(cs.backgroundColor);
          fonts.add(cs.fontFamily.split(',')[0].replace(/["']/g, '').trim());
          sizes.add(cs.fontSize);
        }
        return { colors: [...colors], fonts: [...fonts], sizes: [...sizes] };
      });
      for (const color of report.colors) assert.ok(allowed.has(color), `${route}: ${color}`);
      for (const font of report.fonts) assert.ok(['Atkinson Hyperlegible Next', 'Saira Semi Condensed'].includes(font), `${route}: ${font}`);
      for (const size of report.sizes) assert.ok(['30px', '24px', '23px', '20px', '17px', '16px', '15px', '13px', '12px'].includes(size), `${route}: ${size}`);
    }
    assert.equal(await s.page.evaluate(() => document.fonts.check('400 17px "Atkinson Hyperlegible Next"') && document.fonts.check('600 23px "Saira Semi Condensed"')), true);
    await s.context.close();
  });

  test('the header has back, title and the Place picker on every screen; the tab bar has the three tabs', { skip: skip() }, async () => {
    const s = await open(app, { place: 'seattle_wa' });
    for (const route of ['/recyclopedia', '/scan', '/locations', '/guidelines', '/another-life', '/item?q=unicorn&origin=search']) {
      await s.page.goto(app.url + route);
      await s.page.waitForFunction(() => !document.querySelector('main[aria-busy]'));
      assert.equal(await s.page.getByRole('button', { name: 'Back' }).isVisible(), true, route);
      assert.equal(await s.page.locator('#place-select').isVisible(), true, route);
      assert.ok((await s.page.locator('#app-title').innerText()).length > 0, route);
      assert.equal(await s.page.locator('nav a').count(), 3, route);
    }
    await s.page.goto(app.url + '/recyclopedia');
    await s.page.locator('.category-card').first().waitFor();
    await s.page.getByRole('link', { name: 'Glass', exact: true }).click();
    await s.page.getByRole('heading', { name: 'Glass', exact: true }).waitFor();
    await s.page.getByRole('button', { name: 'Back' }).click();
    await s.page.locator('.category-card').first().waitFor();
    assert.equal(new URL(s.page.url()).pathname, '/recyclopedia');
    await s.page.goto(app.url + '/guidelines');
    await s.page.getByRole('button', { name: 'Back' }).click();
    await s.page.waitForURL('**/home');
    await s.context.close();
  });
});

describe('what the browser talks to', () => {
  test('across every test above, the browser asked nothing outside the app except map tiles, and never the device location', { skip: skip() }, async () => {
    assert.deepEqual([...outside], []);
  });
});

describe('review harness compatibility (practice-free: made-up queries, the harness’s own driver)', () => {
  const driver = path.join(REPO_DIR, '..', 'refcycle-scored', 'review', 'harness', 'lib', 'drive.mjs');
  const available = () => (skip() ? skip() : existsSync(driver) ? false : 'the review harness is not on this machine');

  test('the harness’s own steps drive this build: pick a Place, search to an item, read it, follow Dispose, scan a photo', { skip: available() }, async () => {
    const drive = await import(pathToFileURL(driver).href);
    const run = async (place: string, fn: (page: Page, net: any, steps: any[]) => Promise<void>) => {
      const context = await browser!.newContext({ viewport: { width: 430, height: 932 }, locale: 'en-US' });
      await context.route('https://tile.openstreetmap.org/**', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PNG_BYTES }));
      const page = await context.newPage();
      const steps: any[] = [];
      const net = drive.attachNetwork(page, Date.now());
      try {
        await drive.pickPlace(page, app.url, place, steps);
        assert.deepEqual(steps.at(-1), { step: 'place_stored', value: place });
        await fn(page, net, steps);
      } finally {
        await context.close();
      }
    };

    // Text that matches no entry: Enter opens the item page directly.
    await run('hawaii_county_hi', async (page, net, steps) => {
      assert.equal(await drive.searchToItem(page, app.url, 'clear #1 bottle', steps), 'enter_opened_item');
      const read = await drive.readItemPage(page, net, steps);
      assert.deepEqual(read.summary.visible_stream_labels, ['drop_off_special']);
      assert.deepEqual(read.summary.visible_rule_ids, ['hc-plastic-011']);
      assert.deepEqual([read.summary.shows_dont_know, read.summary.shows_it_depends, read.summary.shows_no_answer], [false, false, false]);
      const locator = await drive.openLocatorFromItem(page, net, steps);
      assert.ok(locator, 'Dispose found');
      assert.match(locator.screen.text, /A private recycler in Hilo \(#1 clear bottles\)/);
      const sites = net.records.filter((r: any) => r.path === '/api/sites' && r.search.includes('rule_ids')).at(-1);
      assert.deepEqual(sites.response.sites.map((x: any) => x.facility_id), ['f-hc-06']);
      assert.match(locator.screen.text, /phone report, 2026-11-03/, 'the site’s source label is on the page');
    });

    // Text equal to an entry name: the exact entry is offered and followed.
    await run('seattle_wa', async (page, net, steps) => {
      assert.equal(await drive.searchToItem(page, app.url, 'tires', steps), 'exact_entry');
      const read = await drive.readItemPage(page, net, steps);
      assert.deepEqual(read.summary.visible_stream_labels, ['drop_off_special']);
      const locator = await drive.openLocatorFromItem(page, net, steps);
      const hrefs = new Set(locator.screen.anchors.map((a: any) => a.href));
      const sites = net.records.filter((r: any) => r.path === '/api/sites' && r.search.includes('rule_ids')).at(-1).response.sites;
      assert.equal(sites.length, 2);
      for (const site of sites) {
        assert.ok(locator.screen.text.includes(site.name), site.name);
        assert.ok(hrefs.has(site.source_url), `source link for ${site.facility_id}`);
      }
    });

    // Text that is part of several entry names: the typed text can still be asked as written.
    await run('hawaii_county_hi', async (page, net, steps) => {
      assert.equal(await drive.searchToItem(page, app.url, 'plastic', steps), 'ask_typed_text');
      const read = await drive.readItemPage(page, net, steps);
      assert.equal(read.summary.shows_it_depends, true);
      assert.deepEqual(read.summary.visible_stream_labels.sort(), ['deposit_return', 'drop_off_special', 'garbage']);
      assert.equal(net.records.filter((r: any) => r.path === '/api/ask').at(-1).request.query, 'plastic');
    });

    // Abstain and clarify read as such, with no stream label on the page.
    await run('austin_tx', async (page, net, steps) => {
      await drive.searchToItem(page, app.url, 'unicorn horn', steps);
      const read = await drive.readItemPage(page, net, steps);
      assert.equal(read.summary.shows_dont_know, true);
      assert.deepEqual(read.summary.visible_stream_labels, []);
      assert.equal(await drive.openLocatorFromItem(page, net, steps), null, 'no Dispose on an abstention');
    });
    await run('austin_tx', async (page, net, steps) => {
      await drive.searchToItem(page, app.url, 'a bottle of some kind', steps);
      const read = await drive.readItemPage(page, net, steps);
      assert.deepEqual(read.summary.visible_stream_labels, []);
      assert.match(read.screen.text, /Is the bottle glass or plastic\?/);
    });

    // Camera scan through the file input, then the confirm control.
    const photoFile = path.join(app.logsDir, 'harness-photo.png');
    (await import('node:fs')).writeFileSync(photoFile, PNG_BYTES);
    await run('seattle_wa', async (page, net, steps) => {
      imageReply = { status: 'identified', label: 'cardboard box', candidates: [] };
      const scan = await drive.scanPhoto(page, app.url, net, photoFile, steps, {});
      assert.deepEqual([scan.identify_status, scan.identify_label, scan.confirmed], ['identified', 'cardboard box', true]);
      const read = await drive.readItemPage(page, net, steps, { since: scan.ask_since });
      assert.deepEqual(read.summary.visible_stream_labels, ['recycle_bin']);
    });
    await run('seattle_wa', async (page, net, steps) => {
      imageReply = { status: 'unclear', label: null, candidates: [] };
      const scan = await drive.scanPhoto(page, app.url, net, photoFile, steps, {});
      assert.deepEqual([scan.identify_status, scan.confirmed], ['unclear', false]);
      assert.equal(net.records.filter((r: any) => r.path === '/api/ask').length, 0);
    });
  });
});
