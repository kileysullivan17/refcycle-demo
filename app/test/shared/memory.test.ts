// Remembered on the device (PRD addendum): the Place and recent items, in the browser only, with a clear
// way to forget them. A recent item never holds an answer.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clientModule, fakeStorage } from '../helpers/client.ts';

const { createMemory, recentHref, PLACE_KEY, RECENT_KEY, MAX_RECENT } = await clientModule('shared/memory.js');

test('the Place is kept under the contract key, as a plain id', () => {
  const storage = fakeStorage();
  const memory = createMemory(storage);
  assert.equal(PLACE_KEY, 'refcycle.place');
  assert.equal(memory.getPlace(), null);
  memory.setPlace('austin_tx');
  assert.equal(storage.map.get('refcycle.place'), 'austin_tx');
  assert.equal(memory.getPlace(), 'austin_tx');
});

test('recent items hold the Place, the entry or the words asked, and a label; nothing else', () => {
  const storage = fakeStorage();
  const memory = createMemory(storage);
  memory.addRecent({ place: 'austin_tx', entry: 'tires', label: 'Tires', answer: 'Special drop-off', stream: 'drop_off_special', explanation: 'text' });
  memory.addRecent({ place: 'austin_tx', q: 'bread bag clips', label: 'bread bag clips', behavior: 'abstain' });
  const stored = JSON.parse(storage.map.get(RECENT_KEY)!);
  assert.deepEqual(stored, [
    { place: 'austin_tx', q: 'bread bag clips', label: 'bread bag clips' },
    { place: 'austin_tx', entry: 'tires', label: 'Tires' },
  ]);
  assert.doesNotMatch(storage.map.get(RECENT_KEY)!, /Special drop-off|drop_off_special|abstain|explanation/);
});

test('newest first, no duplicates, at most eight, and listed per Place', () => {
  const memory = createMemory(fakeStorage());
  for (let i = 0; i < 12; i++) memory.addRecent({ place: 'seattle_wa', q: `item ${i}`, label: `item ${i}` });
  memory.addRecent({ place: 'seattle_wa', q: 'ITEM 11 ', label: 'ITEM 11' });
  const all = memory.getRecent();
  assert.equal(all.length, MAX_RECENT);
  assert.equal(all[0].label, 'ITEM 11');
  assert.equal(all.filter((i: { q: string }) => i.q.trim().toLowerCase() === 'item 11').length, 1);
  memory.addRecent({ place: 'austin_tx', entry: 'tires', label: 'Tires' });
  assert.deepEqual(memory.getRecent('austin_tx'), [{ place: 'austin_tx', entry: 'tires', label: 'Tires' }]);
  assert.equal(memory.getRecent('hawaii_county_hi').length, 0);
});

test('reopening a recent item asks again: the link carries the item only', () => {
  assert.equal(recentHref({ place: 'austin_tx', entry: 'tires', label: 'Tires' }), '/item?entry=tires');
  assert.equal(recentHref({ place: 'austin_tx', q: 'bread bag clips', label: 'x' }), '/item?q=bread%20bag%20clips&origin=search');
});

test('forget removes the Place, the recent items and any other app key, and leaves other sites’ keys alone', () => {
  const storage = fakeStorage({ 'other.app': 'keep', 'refcycle.future': 'x' });
  const memory = createMemory(storage);
  memory.setPlace('seattle_wa');
  memory.addRecent({ place: 'seattle_wa', entry: 'tires', label: 'Tires' });
  assert.equal(memory.forget(), true);
  assert.equal(memory.getPlace(), null);
  assert.deepEqual(memory.getRecent(), []);
  assert.deepEqual([...storage.map.keys()], ['other.app']);
});

test('damaged or hostile stored values are ignored', () => {
  for (const bad of ['not json', '{"a":1}', '[1,2,3]', JSON.stringify([{ place: 'x' }, { place: 'x', label: 'l', entry: 'e', q: 'both' }, { place: 'x', label: 5, q: 'q' }])]) {
    assert.deepEqual(createMemory(fakeStorage({ [RECENT_KEY]: bad })).getRecent(), [], bad);
  }
  assert.equal(createMemory(fakeStorage({ [PLACE_KEY]: 'x'.repeat(500) })).getPlace(), null);
});

test('a browser that refuses storage does not break the app', () => {
  const blocked = {
    getItem() {
      throw new Error('blocked');
    },
    setItem() {
      throw new Error('blocked');
    },
    removeItem() {
      throw new Error('blocked');
    },
    key() {
      throw new Error('blocked');
    },
    get length(): number {
      throw new Error('blocked');
    },
  };
  const memory = createMemory(blocked);
  assert.equal(memory.getPlace(), null);
  assert.equal(memory.setPlace('seattle_wa'), false);
  assert.deepEqual(memory.getRecent(), []);
  assert.equal(memory.addRecent({ place: 'seattle_wa', entry: 'tires', label: 'Tires' }), false);
  assert.equal(memory.forget(), false);
});
