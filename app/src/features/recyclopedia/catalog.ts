// The approved Recyclopedia catalog (contracts 5, G3): 10 categories and 50 entries, held in
// app/data/catalog.json exactly as the contract lists them. An entry's rule_ids and covered_in document
// coverage only; they never drive an answer (G4). The engine's answer is always what the item page shows.
import { readFile } from 'node:fs/promises';
import { z } from 'zod';

const Category = z.object({ id: z.string().min(1), name: z.string().min(1), order: z.number().int().positive() }).strict();
const Entry = z
  .object({
    id: z.string().min(1),
    category: z.string().min(1),
    name: z.string().min(1),
    query: z.string().min(1).max(2000),
    rule_ids: z.array(z.string().min(1)).min(1),
    covered_in: z.array(z.string().min(1)).min(1),
  })
  .strict();
const CatalogSchema = z
  .object({ categories: z.array(Category).min(1), entries: z.array(Entry).min(1) })
  .strict()
  .superRefine((catalog, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
    const categoryIds = new Set(catalog.categories.map((c) => c.id));
    if (categoryIds.size !== catalog.categories.length) fail('Duplicate category id');
    if (new Set(catalog.entries.map((e) => e.id)).size !== catalog.entries.length) fail('Duplicate entry id');
    for (const entry of catalog.entries) {
      if (!categoryIds.has(entry.category)) fail(`Entry ${entry.id} names an unknown category`);
      if (entry.query !== entry.name) fail(`Entry ${entry.id}: query must equal name (Q6)`);
    }
  });

export type Catalog = z.infer<typeof CatalogSchema>;

const loaded = new Map<string, Promise<Catalog>>();

export function getCatalog(file: string): Promise<Catalog> {
  let promise = loaded.get(file);
  if (!promise) {
    promise = readFile(file, 'utf8').then((text) => {
      const catalog = CatalogSchema.parse(JSON.parse(text));
      catalog.categories.sort((a, b) => a.order - b.order);
      return catalog;
    });
    loaded.set(file, promise);
    promise.catch(() => loaded.delete(file));
  }
  return promise;
}
