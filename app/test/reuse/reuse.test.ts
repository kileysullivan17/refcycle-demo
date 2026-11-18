// Give it another life (PRD addendum, screen 5): outside reuse and repair links, clearly labeled as
// outside resources. They are never rules and never change an answer.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { ReuseLinks } from '../../src/features/reuse/routes.ts';
import { APP_DIR, REUSE_LINKS_JSON } from '../../src/shared/paths.ts';
import { postJson, startApp, type TestApp } from '../helpers/app.ts';
import { readPublic } from '../helpers/css.ts';
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
const get = async (place: string) => (await fetch(`${app.url}/api/reuse?place=${place}`)).json();

test('the link list is the four verified on 2026-11-11', () => {
  const { links } = ReuseLinks.parse(JSON.parse(readFileSync(REUSE_LINKS_JSON, 'utf8')));
  assert.deepEqual(
    links.map((l) => [l.place, l.url]),
    [
      ['seattle_wa', 'https://www.seattle.gov/utilities/protecting-our-environment/sustainability-tips/waste-prevention/at-home/donate-share-resell-and-buy-used'],
      ['austin_tx', 'https://austinreusedirectory.com/'],
      ['hawaii_county_hi', 'https://www.hawaiizerowaste.org/reuse-2/'],
      [null, 'https://www.ifixit.com/Community/Events'],
    ],
  );
  for (const link of links) assert.equal(link.checked, '2026-11-11');
});

test('each Place gets its own link and the one that works everywhere', async () => {
  for (const [place, id] of [['seattle_wa', 'sea-donate-share-resell'], ['austin_tx', 'atx-reuse-directory'], ['hawaii_county_hi', 'hc-reuse-centers']]) {
    const body = await get(place);
    assert.equal(body.place, place);
    assert.deepEqual(body.links.map((l: { id: string; scope: string }) => [l.id, l.scope]), [[id, 'place'], ['community-repair-hub', 'everywhere']]);
    for (const link of body.links) assert.match(link.url, /^https:\/\//);
  }
});

test('the Hawaiʻi County reuse centers are described publicly and no operator business is named', async () => {
  const link = (await get('hawaii_county_hi')).links[0];
  assert.equal(link.title, 'Reuse Centers at County Recycling and Transfer Stations');
  assert.equal(link.publisher, 'Hawaiʻi County Department of Environmental Management');
  assert.doesNotMatch(JSON.stringify(link), /LLC|Inc\b|Thrift/i);
});

test('an unknown place is HTTP 400', async () => {
  assert.equal((await fetch(`${app.url}/api/reuse?place=portland_or`)).status, 400);
  assert.equal((await fetch(`${app.url}/api/reuse`)).status, 400);
});

test('the screen labels every link as an outside resource and opens it in a new tab', () => {
  const screen = readPublic('features/reuse/screens.js');
  assert.match(screen, /'Outside resource'/);
  assert.match(screen, /These are outside resources run by other organizations\./);
  assert.match(screen, /they are not local rules/);
  assert.match(screen, /They never change an answer RefCycle shows\./);
  assert.match(screen, /outLink\(link\.url/);
  assert.match(readPublic('shared/dom.js'), /target: '_blank', rel: 'noopener noreferrer'/);
});

test('no upcycling ideas or instructions, and no rules, on the reuse screen', () => {
  const screen = readPublic('features/reuse/screens.js').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(screen, /craft|step 1|instructions|how to make|STREAM_LABELS|Recycling|Compost|Garbage|drop-off|rule_id|\/api\/ask|\bask\(/i);
  const data = readFileSync(REUSE_LINKS_JSON, 'utf8');
  assert.doesNotMatch(data, /recycle_bin|compost_bin|garbage|drop_off_special|deposit_return|rule_ids?|"stream"/);
});

test('reuse links never change an answer: the engine gets the same request and the app returns the same answer', async () => {
  const body = { jurisdiction: 'austin_tx', query: 'tires' };
  const before = await (await postJson(`${app.url}/api/ask`, body)).json();
  for (const place of ['austin_tx', 'seattle_wa', 'hawaii_county_hi']) await get(place);
  const afterwards = await (await postJson(`${app.url}/api/ask`, body)).json();
  assert.deepEqual(afterwards, before);
  assert.deepEqual(engine.calls, [{ place: 'austin_tx', query: 'tires' }, { place: 'austin_tx', query: 'tires' }]);
});

test('the reuse feature shares no code path with answers', () => {
  const server = readFileSync(path.join(APP_DIR, 'src', 'features', 'reuse', 'routes.ts'), 'utf8');
  assert.doesNotMatch(server, /\/api\/ask|engineUrl|limits|identify|fetch\(/);
  // The item page links to the reuse screen; it does not load reuse data into the answer.
  const item = readPublic('shared/item-page.js');
  assert.doesNotMatch(item, /getReuseLinks|\/api\/reuse/);
  assert.match(item, /href: '\/another-life' \}, 'Give it another life: outside reuse and repair links'/);
});

test('the item page’s share and reuse controls cannot be mistaken for part of the answer by the review harness', () => {
  // The harness reads the item page's visible text for stream labels and for the Dispose control.
  const chrome = ['Share', 'Give it another life: outside reuse and repair links', 'Link copied.', 'Copy this link:', 'Referee check', 'One question first', 'Your reply', 'Send', 'How to prepare it', 'What the local rules say', 'Where the rules point', 'Sources', 'Official source'];
  const item = readPublic('shared/item-page.js');
  for (const text of chrome) {
    assert.ok(item.includes(text), text);
    assert.doesNotMatch(text, /(^|[^A-Za-z])(Recycling|Compost|Garbage|Special drop-off|Deposit return)([^A-Za-z]|$)/, text);
    assert.doesNotMatch(text, /dispose|where to take|find (a )?(place|location|drop.?off)|show (places|locations|sites)|see (places|locations)|locations for/i, text);
    assert.doesNotMatch(text, /don[’']?t know|do not know|it depends|depends on|no answer available/i, text);
  }
});
