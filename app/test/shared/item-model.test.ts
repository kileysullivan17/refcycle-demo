// Item page rules (contracts 8; X-4, X-6, X-10, X-11, G14, G19, G20).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clientModule } from '../helpers/client.ts';

const { STREAM_LABELS, isAnswer, itemState, showDispose, itemTitle, disposeHref, clarifyQuery } = await clientModule('shared/item-model.js');

const base = {
  jurisdiction: 'seattle_wa',
  item_interpreted: 'milk jug',
  behavior: 'answer',
  stream: 'recycle_bin',
  conditions: null,
  clarifying_question: null,
  prep: ['rinse'],
  explanation: 'sea-plastic-009: “quote”',
  rule_ids: ['sea-plastic-009'],
  source_urls: ['https://example.org/a'],
  model: 'fake/fixture',
};
const answer = (stream: string) => ({ ...base, stream });
const conditional = (...streams: string[]) => ({ ...base, behavior: 'conditional', stream: null, conditions: streams.map((s, i) => ({ if: `case ${i}`, stream: s })) });
const clarify = { ...base, behavior: 'clarify', stream: null, clarifying_question: 'Which one?', prep: [], rule_ids: [] };
const abstain = { ...base, behavior: 'abstain', stream: null, item_interpreted: null, prep: [], rule_ids: [] };

test('stream labels are the contract’s five, and never "Score!" or "Hazardous"', () => {
  assert.deepEqual(STREAM_LABELS, {
    recycle_bin: 'Recycling',
    compost_bin: 'Compost',
    garbage: 'Garbage',
    drop_off_special: 'Special drop-off',
    deposit_return: 'Deposit return',
  });
});

test('one state per response, decided by behavior and stream only', () => {
  assert.equal(itemState(answer('recycle_bin')), 'card-blue');
  assert.equal(itemState(answer('compost_bin')), 'card-blue');
  assert.equal(itemState(answer('deposit_return')), 'card-blue');
  assert.equal(itemState(answer('garbage')), 'card-yellow');
  assert.equal(itemState(answer('drop_off_special')), 'card-red');
  assert.equal(itemState(clarify), 'referee-check-clarify');
  assert.equal(itemState(conditional('garbage', 'recycle_bin')), 'referee-check-conditional');
  assert.equal(itemState(abstain), 'referee-check-abstain');
});

test('clarify, conditional and abstain never produce a card state', () => {
  for (const response of [clarify, abstain, conditional('garbage', 'drop_off_special')]) assert.ok(!itemState(response).startsWith('card-'));
});

test('Dispose shows only when the answer sends the item outside the regular streams', () => {
  assert.equal(showDispose(answer('drop_off_special')), true);
  assert.equal(showDispose(answer('deposit_return')), true);
  for (const stream of ['recycle_bin', 'compost_bin', 'garbage']) assert.equal(showDispose(answer(stream)), false);
  assert.equal(showDispose(conditional('garbage', 'drop_off_special')), true);
  assert.equal(showDispose(conditional('recycle_bin', 'deposit_return')), true);
  assert.equal(showDispose(conditional('garbage', 'recycle_bin')), false);
  assert.equal(showDispose(clarify), false);
  assert.equal(showDispose(abstain), false);
});

test('the title is item_interpreted, or the query as sent when that is null', () => {
  assert.equal(itemTitle(base, 'plastic milk jug'), 'milk jug');
  assert.equal(itemTitle(abstain, 'bread bag clips'), 'bread bag clips');
  assert.equal(itemTitle({ ...base, item_interpreted: '  ' }, 'typed'), 'typed');
});

test('Dispose opens the locator with the query and the cited rule ids', () => {
  assert.equal(disposeHref('car tires & tubes', ['hc-tires-019', 'hc-hhw-010']), '/locations?item=car%20tires%20%26%20tubes&rule_ids=hc-tires-019%2Chc-hhw-010');
});

test('a clarify reply is the original query, a space, and the reply', () => {
  assert.equal(clarifyQuery('bottle', ' glass '), 'bottle glass');
  assert.equal(clarifyQuery('x'.repeat(1999), 'reply').length, 2000);
});

test('only a response with the engine’s shape is shown; anything else is the error state', () => {
  for (const good of [base, clarify, abstain, conditional('garbage', 'recycle_bin')]) assert.equal(isAnswer(good), true);
  for (const bad of [
    null,
    {},
    { error: 'Invalid input' },
    { ...base, behavior: 'guess' },
    { ...base, stream: 'landfill' },
    { ...base, stream: null },
    { ...abstain, stream: 'garbage' },
    { ...clarify, clarifying_question: null },
    { ...conditional('garbage'), conditions: null },
    { ...conditional('garbage', 'mystery') },
    { ...base, explanation: 5 },
    { ...base, prep: 'rinse' },
    { ...base, rule_ids: [1] },
  ]) {
    assert.equal(isAnswer(bad), false, JSON.stringify(bad));
  }
});
