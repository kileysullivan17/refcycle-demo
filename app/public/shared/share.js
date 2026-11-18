// Sharing (PRD addendum): one share button that uses the device's own share sheet.
// The link carries the Place and the item, never the answer text, so whoever opens it gets the engine's
// current answer for that Place.

/** Builds the link for an item. Exactly one of entryId or query is used. */
export function buildShareUrl(origin, { place, entryId, query }) {
  const url = new URL('/item', origin);
  if (entryId) url.searchParams.set('entry', entryId);
  else url.searchParams.set('q', query);
  url.searchParams.set('place', place);
  return url.href;
}

/**
 * Opens the share sheet where the device has one; otherwise copies the link; otherwise reports 'shown' so
 * the caller can put the link on screen. Returns 'shared', 'cancelled', 'copied' or 'shown'.
 */
export async function shareLink(url, title, nav = globalThis.navigator) {
  if (nav && typeof nav.share === 'function') {
    try {
      await nav.share({ title, url });
      return 'shared';
    } catch (error) {
      if (error && error.name === 'AbortError') return 'cancelled';
      /* fall through to copying */
    }
  }
  if (nav && nav.clipboard && typeof nav.clipboard.writeText === 'function') {
    try {
      await nav.clipboard.writeText(url);
      return 'copied';
    } catch {
      /* fall through to showing the link */
    }
  }
  return 'shown';
}
