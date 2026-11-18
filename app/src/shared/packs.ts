// Read-only access to the public rules packs through the pinned engine's own loader (contracts 2 and 6).
// The app never writes, edits or infers a rule; it only reads what the packs state.
import { loadPacks, type Pack, type Rule } from '../../../engine/code/src/rules.ts';

export type { Pack, Rule };
export type PackSource = Pack['sources'][number];

const loaded = new Map<string, Promise<Map<string, Pack>>>();

/** Loads the packs once per rules folder. A failed load is not cached, so a later request can try again. */
export function getPacks(rulesDir: string): Promise<Map<string, Pack>> {
  let promise = loaded.get(rulesDir);
  if (!promise) {
    promise = loadPacks(rulesDir);
    loaded.set(rulesDir, promise);
    promise.catch(() => loaded.delete(rulesDir));
  }
  return promise;
}

export function sourceOf(pack: Pack, id: string | undefined): PackSource | undefined {
  return id ? pack.sources.find((s) => s.id === id) : undefined;
}

/** The date a source rests on: when it was observed, else the page's own date, else when it was read. */
export function sourceDate(source: PackSource | undefined): string | null {
  if (!source) return null;
  return source.observed ?? source.page_date ?? source.retrieved ?? null;
}

export function isFieldSource(source: PackSource | undefined): boolean {
  return !!source && (source.kind === 'field_observation' || source.kind === 'field_report');
}
