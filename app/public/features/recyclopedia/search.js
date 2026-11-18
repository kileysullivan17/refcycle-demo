// Recyclopedia search (contracts 5.1; RC-3, RC-9): typed text is matched against entry names,
// case-insensitive substring. Pure, so it is unit-tested.

export function normalize(text) {
  return String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Entries whose name contains the typed text. Empty text matches nothing. Catalog order is kept. */
export function matchEntries(entries, typed) {
  const needle = normalize(typed).toLowerCase();
  if (!needle) return [];
  return entries.filter((entry) => entry.name.toLowerCase().includes(needle));
}

export function entryHref(entry) {
  return `/item?entry=${encodeURIComponent(entry.id)}`;
}

/** Text that matches no entry goes to the engine as typed (RC-9, Q5). */
export function askHref(typed) {
  return `/item?q=${encodeURIComponent(normalize(typed).slice(0, 2000))}&origin=search`;
}

export function searchHref(typed) {
  return `/search?q=${encodeURIComponent(normalize(typed))}`;
}
