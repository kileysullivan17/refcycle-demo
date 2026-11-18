// Recyclopedia search (contracts 5.1; RC-3, RC-9).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { CATALOG_JSON } from '../../src/shared/paths.ts';
import { clientModule } from '../helpers/client.ts';

const { matchEntries, entryHref, askHref, searchHref, normalize } = await clientModule('features/recyclopedia/search.js');
const { entries } = JSON.parse(readFileSync(CATALOG_JSON, 'utf8'));
const names = (typed: string) => matchEntries(entries, typed).map((e: { name: string }) => e.name);

test('typing "Plastic" lists the plastic entries (RC-3)', () => {
  const found = matchEntries(entries, 'Plastic');
  assert.ok(found.length >= 12);
  for (const entry of entries.filter((e: { category: string; name: string }) => e.category === 'plastic' && /plastic/i.test(e.name))) assert.ok(found.includes(entry), entry.name);
});

test('matching is a case-insensitive substring of the entry name', () => {
  assert.deepEqual(names('TIRES'), ['Tires']);
  assert.deepEqual(names('  pizza  '), ['Pizza boxes']);
  assert.deepEqual(names('#2'), ['Plastic #2 HDPE']);
  assert.deepEqual(names('hi-5'), ['HI-5 deposit beverage containers']);
  assert.ok(names('paper').includes('Shredded paper'));
});

test('text that matches no entry matches nothing, and is sent to the engine as typed (RC-9)', () => {
  assert.deepEqual(names('bread bag clips'), []);
  assert.equal(askHref('  bread   bag clips '), '/item?q=bread%20bag%20clips&origin=search');
});

test('empty text matches nothing', () => {
  assert.deepEqual(names(''), []);
  assert.deepEqual(names('   '), []);
});

test('an entry opens the item page by its id', () => {
  assert.equal(entryHref({ id: 'plastic-2' }), '/item?entry=plastic-2');
  assert.equal(searchHref(' glass  jars '), '/search?q=glass%20jars');
  assert.equal(normalize(' a \n b '), 'a b');
});

test('search never looks at rule ids, coverage or anything but the name', () => {
  assert.deepEqual(names('sea-plastic-009'), []);
  assert.deepEqual(names('seattle_wa'), []);
});
