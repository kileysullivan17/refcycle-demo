// A stand-in engine for tests: the pinned engine's own server and answer assembly over the real public
// packs, with a fixture in place of the remote model. No provider is called and no key is needed.
// The fixture only picks rule ids by keyword; every stream, quote and "where" still comes from the packs.
import { mkdtempSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { loadPacks } from '../../../engine/code/src/rules.ts';
import { createApp } from '../../../engine/code/src/server.ts';
import { RULES_DIR } from '../../src/shared/paths.ts';

type Selection = {
  behavior: 'answer' | 'abstain' | 'clarify' | 'conditional';
  item_interpreted: string | null;
  selections: { rule_id: string; condition_index: number | null }[];
  clarifying_question: string | null;
};

const answer = (item: string, rule_id: string, condition_index: number | null = null): Selection => ({
  behavior: 'answer',
  item_interpreted: item,
  selections: [{ rule_id, condition_index }],
  clarifying_question: null,
});
const ABSTAIN: Selection = { behavior: 'abstain', item_interpreted: null, selections: [], clarifying_question: null };

/** Which rules the fixture "model" selects. Test queries are made up here; they are not from any answer key. */
export function selectionFor(place: string, query: string): Selection | 'INVALID' {
  const q = query.toLowerCase();
  const by = (sea: string, atx: string, hc: string) => (place === 'seattle_wa' ? sea : place === 'austin_tx' ? atx : hc);
  if (q.includes('invalid model output')) return 'INVALID';
  if (q.includes('unicorn')) return ABSTAIN;
  if (q.includes('tire')) return answer('tires', by('sea-special-024', 'atx-special-023', 'hc-tires-019'));
  if (q.includes('cardboard')) return answer('corrugated cardboard', by('sea-paper-002', 'atx-paper-003', 'hc-paper-001'));
  if (place === 'hawaii_county_hi') {
    if (q.includes('pizza')) return answer('pizza box', 'hc-paper-002');
    if (q.includes('soda can')) return answer('HI-5 soda can', 'hc-deposit-005');
    if (q.includes('clear #1 bottle')) return answer('clear #1 plastic bottle', 'hc-plastic-011');
    if (q.includes('cooking oil') && q.includes('large')) return answer('used cooking oil', 'hc-oil-015', 1);
    if (q.includes('cooking oil')) return { behavior: 'conditional', item_interpreted: 'used cooking oil', selections: [{ rule_id: 'hc-oil-015', condition_index: null }], clarifying_question: null };
    if (q.includes('plastic')) return { behavior: 'conditional', item_interpreted: 'plastic item', selections: [{ rule_id: 'hc-plastic-006', condition_index: null }], clarifying_question: null };
    if (q.includes('curbside')) return { behavior: 'clarify', item_interpreted: null, selections: [], clarifying_question: 'What item do you need to dispose of?' };
    if (q.includes('yard')) return answer('yard trimmings', 'hc-green-008');
  }
  if (q.includes('bottle') && !q.includes('glass')) return { behavior: 'clarify', item_interpreted: 'bottle', selections: [], clarifying_question: 'Is the bottle glass or plastic?' };
  return ABSTAIN;
}

export type FakeEngine = { url: string; calls: { place: string; query: string }[]; close(): Promise<void> };

export async function startFakeEngine(options: { delayMs?: number } = {}): Promise<FakeEngine> {
  const packs = await loadPacks(RULES_DIR);
  const calls: FakeEngine['calls'] = [];
  const provider = {
    model: 'fake/fixture',
    async select(pack: { jurisdiction: { id: string } }, query: string) {
      calls.push({ place: pack.jurisdiction.id, query });
      if (options.delayMs) await new Promise((r) => setTimeout(r, options.delayMs));
      const value = selectionFor(pack.jurisdiction.id, query);
      return { value: value === 'INVALID' ? { not: 'a selection' } : value, model: 'fake/fixture' };
    },
  };
  const logDir = mkdtempSync(path.join(os.tmpdir(), 'refcycle-fake-engine-'));
  const server: Server = createApp(packs, provider, path.join(logDir, 'requests.jsonl'));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    calls,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}
