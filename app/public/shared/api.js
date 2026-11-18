// The browser's calls to the app server. Nothing outside the app is ever fetched from here.
// No answer is cached: every item view asks the engine again.

export const ASK_TIMEOUT_MS = 150_000; // contracts 3
const IDENTIFY_TIMEOUT_MS = 90_000;
const READ_TIMEOUT_MS = 30_000;

async function getJson(path, timeoutMs = READ_TIMEOUT_MS) {
  const response = await fetch(path, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

async function postJson(path, body, timeoutMs) {
  return fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
}

async function limitMessage(response) {
  try {
    const body = await response.json();
    if (body && typeof body.message === 'string') return body.message;
  } catch {
    /* use the fallback */
  }
  return 'This demo has reached its limit for today.';
}

export function getJurisdictions() {
  return getJson('/api/jurisdictions');
}

/**
 * POST /api/ask. Resolves to one of:
 *   { kind: 'answer', answer }   HTTP 200 from the engine
 *   { kind: 'limit', message }   the demo's daily limit was reached; no answer of any kind is shown
 *   { kind: 'error' }            HTTP 400, any other failure, or the 150 second timeout (X-7)
 */
export async function ask(jurisdiction, query) {
  try {
    const response = await postJson('/api/ask', { jurisdiction, query }, ASK_TIMEOUT_MS);
    if (response.status === 429) return { kind: 'limit', message: await limitMessage(response) };
    if (response.status !== 200) return { kind: 'error' };
    return { kind: 'answer', answer: await response.json() };
  } catch {
    return { kind: 'error' };
  }
}

/** POST /api/identify. Resolves to { kind: 'result', result } | { kind: 'limit', message } | { kind: 'error' }. */
export async function identify(imageDataUrl) {
  try {
    const response = await postJson('/api/identify', { image: imageDataUrl }, IDENTIFY_TIMEOUT_MS);
    if (response.status === 429) return { kind: 'limit', message: await limitMessage(response) };
    if (response.status !== 200) return { kind: 'error', status: response.status };
    return { kind: 'result', result: await response.json() };
  } catch {
    return { kind: 'error', status: 0 };
  }
}

let catalogPromise = null;

/** The catalog is a static list, so one fetch per page load is enough. */
export function getCatalog() {
  if (!catalogPromise) {
    catalogPromise = getJson('/api/catalog');
    catalogPromise.catch(() => {
      catalogPromise = null;
    });
  }
  return catalogPromise;
}

export function getSites(place, { ruleIds, material } = {}) {
  const params = new URLSearchParams({ place });
  if (ruleIds) params.set('rule_ids', ruleIds.join(','));
  if (material) params.set('material', material);
  return getJson(`/api/sites?${params}`);
}

export function getGuidelines(place) {
  return getJson(`/api/guidelines?${new URLSearchParams({ place })}`);
}

export function getReuseLinks(place) {
  return getJson(`/api/reuse?${new URLSearchParams({ place })}`);
}

/** Fire and forget; a failed log never blocks display (contracts 9). */
export function logDisplaySwap(record) {
  try {
    fetch('/api/log/display-swap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(record),
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* ignore */
  }
}
