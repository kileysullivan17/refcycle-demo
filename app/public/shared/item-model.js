// Pure rules for the item page (contracts 8; X-4, X-6, X-10, X-11). No DOM here, so it is unit-tested.
// The state is decided only by the engine's behavior and stream. Nothing here knows about any material.

export const STREAM_LABELS = {
  recycle_bin: 'Recycling',
  compost_bin: 'Compost',
  garbage: 'Garbage',
  drop_off_special: 'Special drop-off',
  deposit_return: 'Deposit return',
};

const BEHAVIORS = ['answer', 'abstain', 'clarify', 'conditional'];
const isStrings = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string');

/** True when a response has the shape the pinned engine promises (contracts 3). Anything else is an error. */
export function isAnswer(a) {
  if (!a || typeof a !== 'object' || !BEHAVIORS.includes(a.behavior)) return false;
  if (typeof a.explanation !== 'string' || !isStrings(a.prep) || !isStrings(a.rule_ids) || !isStrings(a.source_urls)) return false;
  if (a.item_interpreted !== null && typeof a.item_interpreted !== 'string') return false;
  if (a.behavior === 'answer') return typeof a.stream === 'string' && a.stream in STREAM_LABELS;
  if (a.stream !== null) return false;
  if (a.behavior === 'clarify') return typeof a.clarifying_question === 'string' && a.clarifying_question.length > 0;
  if (a.behavior === 'conditional') {
    return (
      Array.isArray(a.conditions) &&
      a.conditions.length > 0 &&
      a.conditions.every((c) => c && typeof c.if === 'string' && typeof c.stream === 'string' && c.stream in STREAM_LABELS)
    );
  }
  return true;
}

/** The one display state for a response (contracts 8). */
export function itemState(answer) {
  if (answer.behavior === 'answer') {
    if (answer.stream === 'garbage') return 'card-yellow';
    if (answer.stream === 'drop_off_special') return 'card-red';
    return 'card-blue';
  }
  if (answer.behavior === 'clarify') return 'referee-check-clarify';
  if (answer.behavior === 'conditional') return 'referee-check-conditional';
  return 'referee-check-abstain';
}

/** Dispose shows when the answer sends the item outside the regular streams (CON-2, G19). */
export function showDispose(answer) {
  const outside = (s) => s === 'drop_off_special' || s === 'deposit_return';
  if (answer.behavior === 'answer') return outside(answer.stream);
  if (answer.behavior === 'conditional') return (answer.conditions || []).some((c) => outside(c.stream));
  return false;
}

/** The title is the engine's item_interpreted; when that is null, the query as sent (X-11, G14). */
export function itemTitle(answer, query) {
  return typeof answer.item_interpreted === 'string' && answer.item_interpreted.trim() ? answer.item_interpreted : query;
}

export function disposeHref(query, ruleIds) {
  return `/locations?item=${encodeURIComponent(query)}&rule_ids=${encodeURIComponent(ruleIds.join(','))}`;
}

/** The engine keeps no conversation state: a reply is sent as the original query, a space, and the reply (G20). */
export function clarifyQuery(original, reply) {
  return `${original} ${reply.trim()}`.slice(0, 2000);
}
