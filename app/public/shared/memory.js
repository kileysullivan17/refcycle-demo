// What the browser remembers on this device (PRD addendum, "Remembered on the device"):
// the chosen Place and recent items. Nothing else, and none of it is ever sent to a server for this.
// A recent item holds the Place, the entry id or the words asked, and a label. It never holds an answer:
// opening one asks the engine again.

export const PLACE_KEY = 'refcycle.place'; // contracts 1
export const RECENT_KEY = 'refcycle.recent';
export const MAX_RECENT = 8;
const PREFIX = 'refcycle.';

const short = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max;

function validRecent(item) {
  if (!item || typeof item !== 'object') return false;
  if (!short(item.place, 100) || !short(item.label, 2000)) return false;
  const hasEntry = short(item.entry, 100);
  const hasQuery = short(item.q, 2000);
  return hasEntry !== hasQuery;
}

/** storage is window.localStorage in the app and a stand-in in tests. Every call survives a blocked store. */
export function createMemory(storage) {
  const read = (key) => {
    try {
      return storage.getItem(key);
    } catch {
      return null;
    }
  };
  const write = (key, value) => {
    try {
      storage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  };

  function getPlace() {
    const value = read(PLACE_KEY);
    return short(value, 100) ? value : null;
  }

  function setPlace(id) {
    return short(id, 100) ? write(PLACE_KEY, id) : false;
  }

  function getRecent(place) {
    let list;
    try {
      list = JSON.parse(read(RECENT_KEY) || '[]');
    } catch {
      list = [];
    }
    if (!Array.isArray(list)) return [];
    const clean = list
      .filter(validRecent)
      .map((i) => (i.entry ? { place: i.place, entry: i.entry, label: i.label } : { place: i.place, q: i.q, label: i.label }))
      .slice(0, MAX_RECENT);
    return place ? clean.filter((i) => i.place === place) : clean;
  }

  function addRecent(item) {
    if (!validRecent(item)) return false;
    const key = (i) => `${i.place}|${i.entry ? 'e:' + i.entry : 'q:' + i.q.trim().toLowerCase()}`;
    const entry = item.entry ? { place: item.place, entry: item.entry, label: item.label } : { place: item.place, q: item.q, label: item.label };
    const rest = getRecent().filter((i) => key(i) !== key(entry));
    return write(RECENT_KEY, JSON.stringify([entry, ...rest].slice(0, MAX_RECENT)));
  }

  /** Forgets everything this app keeps on the device: the Place, the recent items and any other app key. */
  function forget() {
    try {
      const keys = [];
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (typeof key === 'string' && key.startsWith(PREFIX)) keys.push(key);
      }
      for (const key of keys) storage.removeItem(key);
      return true;
    } catch {
      return false;
    }
  }

  return { getPlace, setPlace, getRecent, addRecent, forget };
}

/** The link that reopens a recent item. It carries the Place and the item only. */
export function recentHref(item) {
  return item.entry ? `/item?entry=${encodeURIComponent(item.entry)}` : `/item?q=${encodeURIComponent(item.q)}&origin=search`;
}

let shared = null;

export function memory() {
  if (!shared) {
    let store;
    try {
      store = window.localStorage;
    } catch {
      store = null;
    }
    // Private modes can refuse storage; the app then simply remembers nothing between visits.
    const fallback = new Map();
    shared = createMemory(
      store || {
        getItem: (k) => (fallback.has(k) ? fallback.get(k) : null),
        setItem: (k, v) => void fallback.set(k, String(v)),
        removeItem: (k) => void fallback.delete(k),
        key: (i) => [...fallback.keys()][i] ?? null,
        get length() {
          return fallback.size;
        },
      },
    );
  }
  return shared;
}
