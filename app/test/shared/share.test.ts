// Sharing (PRD addendum): one share button, the device's own share sheet, and a link that carries the
// Place and the item but never the answer.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clientModule } from '../helpers/client.ts';

const { buildShareUrl, shareLink } = await clientModule('shared/share.js');

test('the link carries the Place and the item, and nothing else', () => {
  const entry = new URL(buildShareUrl('https://refcycle.example', { place: 'austin_tx', entryId: 'tires' }));
  assert.equal(entry.pathname, '/item');
  assert.deepEqual([...entry.searchParams.entries()], [['entry', 'tires'], ['place', 'austin_tx']]);
  const typed = new URL(buildShareUrl('https://refcycle.example', { place: 'hawaii_county_hi', query: 'clear #1 bottle & cap' }));
  assert.deepEqual([...typed.searchParams.entries()], [['q', 'clear #1 bottle & cap'], ['place', 'hawaii_county_hi']]);
});

test('the share sheet is used when the device has one', async () => {
  const shared: unknown[] = [];
  const nav = { share: async (data: unknown) => void shared.push(data), clipboard: { writeText: async () => assert.fail('should not copy') } };
  assert.equal(await shareLink('https://x.example/item?entry=tires&place=austin_tx', 'Tires | RefCycle', nav), 'shared');
  assert.deepEqual(shared, [{ title: 'Tires | RefCycle', url: 'https://x.example/item?entry=tires&place=austin_tx' }]);
  assert.deepEqual(Object.keys(shared[0] as object).sort(), ['title', 'url'], 'no answer text is passed to the share sheet');
});

test('closing the share sheet is not an error and copies nothing', async () => {
  const nav = {
    share: async () => {
      throw Object.assign(new Error('closed'), { name: 'AbortError' });
    },
    clipboard: { writeText: async () => assert.fail('should not copy') },
  };
  assert.equal(await shareLink('https://x.example/', 't', nav), 'cancelled');
});

test('without a share sheet the link is copied; without a clipboard it is shown', async () => {
  const copied: string[] = [];
  assert.equal(await shareLink('https://x.example/a', 't', { clipboard: { writeText: async (text: string) => void copied.push(text) } }), 'copied');
  assert.deepEqual(copied, ['https://x.example/a']);
  assert.equal(await shareLink('https://x.example/a', 't', {}), 'shown');
  const failing = {
    share: async () => {
      throw new Error('not allowed');
    },
    clipboard: {
      writeText: async () => {
        throw new Error('denied');
      },
    },
  };
  assert.equal(await shareLink('https://x.example/a', 't', failing), 'shown');
});
