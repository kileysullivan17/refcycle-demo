// The Recyclopedia catalog (contracts 5, G3): exactly the approved 10 categories and 50 entries.
// The expected values are read from the contract's own tables, so the file cannot drift from it.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { loadPacks } from '../../../engine/code/src/rules.ts';
import { CATALOG_JSON, REPO_DIR, RULES_DIR } from '../../src/shared/paths.ts';
import { startApp, type TestApp } from '../helpers/app.ts';

const PLACES: Record<string, string> = { SEA: 'seattle_wa', ATX: 'austin_tx', HC: 'hawaii_county_hi' };

function contractTables() {
  const contract = readFileSync(path.join(REPO_DIR, 'orchestrator', 'CONTRACTS.md'), 'utf8');
  const section = contract.split('### 5.2 Categories')[1].split('## 6.')[0];
  const rows = section
    .split('\n')
    .filter((line) => line.startsWith('|'))
    .map((line) => line.replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim()));
  const categories = rows.filter((r) => r.length === 3 && /^\d+$/.test(r[0])).map((r) => ({ id: r[1], name: r[2], order: Number(r[0]) }));
  const ids = new Set(categories.map((c) => c.id));
  const entries = rows
    .filter((r) => r.length === 5 && ids.has(r[0]))
    .map((r) => ({ id: r[1], category: r[0], name: r[2], query: r[2], rule_ids: r[3].split(',').map((s) => s.trim()), covered_in: r[4].split(',').map((s) => PLACES[s.trim()]) }));
  return { categories, entries };
}

let app: TestApp;
before(async () => {
  app = await startApp();
});
after(async () => {
  await app.close();
});

test('GET /api/catalog returns exactly the approved catalog', async () => {
  const response = await fetch(`${app.url}/api/catalog`);
  assert.equal(response.status, 200);
  const catalog = await response.json();
  const contract = contractTables();
  assert.equal(contract.categories.length, 10);
  assert.equal(contract.entries.length, 50);
  assert.deepEqual(Object.keys(catalog), ['categories', 'entries']);
  assert.deepEqual(catalog.categories, contract.categories);
  assert.deepEqual(catalog.entries, contract.entries);
});

test('the file on disk is the same list, and Textiles is not in it', () => {
  const file = JSON.parse(readFileSync(CATALOG_JSON, 'utf8'));
  assert.deepEqual(file, contractTables());
  assert.ok(!file.categories.some((c: { id: string }) => /textile/i.test(c.id)));
});

test('every entry’s query equals its name, ids are unique slugs, and categories follow the Figma order', async () => {
  const catalog = await (await fetch(`${app.url}/api/catalog`)).json();
  assert.deepEqual(
    catalog.categories.map((c: { name: string }) => c.name),
    ['Batteries', 'Biodegradable', 'Electronics', 'Glass', 'Metal', 'Paper', 'Plastic', 'Rubber', 'Wood', 'Miscellaneous'],
  );
  const ids = catalog.entries.map((e: { id: string }) => e.id);
  assert.equal(new Set(ids).size, 50);
  for (const entry of catalog.entries) {
    assert.equal(entry.query, entry.name);
    assert.match(entry.id, /^[a-z0-9]+(-[a-z0-9]+)*$/);
  }
});

test('coverage notes agree with the packs: every rule id exists, and covered_in is where its rules live', async () => {
  const packs = await loadPacks(RULES_DIR);
  const placeOf = new Map<string, string>();
  for (const [place, pack] of packs) for (const rule of pack.rules) placeOf.set(rule.id, place);
  const mapped = new Set<string>();
  for (const entry of contractTables().entries) {
    const places = new Set<string>();
    for (const id of entry.rule_ids) {
      assert.ok(placeOf.has(id), `${entry.id}: ${id} is not in any pack`);
      places.add(placeOf.get(id)!);
      mapped.add(id);
    }
    assert.deepEqual([...places].sort(), [...entry.covered_in].sort(), entry.id);
  }
  // Every pack rule maps to at least one entry except hc-system-000, which is a service (contracts 5.3).
  const unmapped = [...placeOf.keys()].filter((id) => !mapped.has(id));
  assert.deepEqual(unmapped, ['hc-system-000']);
});

test('the catalog carries no stream, verdict or answer for any entry', () => {
  const text = readFileSync(CATALOG_JSON, 'utf8');
  assert.doesNotMatch(text, /"(recycle_bin|compost_bin|garbage|drop_off_special|deposit_return)"|"stream"|"verdict"|"behavior"|"answer"/);
  for (const key of Object.keys(JSON.parse(text).entries[0])) assert.ok(['id', 'category', 'name', 'query', 'rule_ids', 'covered_in'].includes(key), key);
});

test('a broken catalog file is a 500 with no detail, not a guess', async () => {
  const broken = await startApp({ catalogJson: path.join(REPO_DIR, 'orchestrator', 'PRD.md') });
  try {
    const response = await fetch(`${broken.url}/api/catalog`);
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: 'Catalog could not be loaded' });
  } finally {
    await broken.close();
  }
});
