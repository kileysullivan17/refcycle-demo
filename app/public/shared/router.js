// Client-side routes (contracts 10 and 2.1, plus /home, /guidelines and /another-life from the PRD addendum).
// Pure functions only, so the route table is unit-tested without a browser.

export const ROUTES = [
  { name: 'root', pattern: /^\/$/, module: '/shared/intro.js', tab: null },
  { name: 'place', pattern: /^\/place$/, module: '/shared/place.js', tab: null },
  { name: 'home', pattern: /^\/home$/, module: '/shared/home.js', tab: null },
  { name: 'item', pattern: /^\/item$/, module: '/shared/item-page.js', tab: 'recyclopedia' },
  { name: 'recyclopedia', pattern: /^\/recyclopedia$/, module: '/features/recyclopedia/screens.js', tab: 'recyclopedia' },
  { name: 'category', pattern: /^\/recyclopedia\/([^/]+)$/, params: ['categoryId'], module: '/features/recyclopedia/screens.js', tab: 'recyclopedia' },
  { name: 'search', pattern: /^\/search$/, module: '/features/recyclopedia/screens.js', tab: 'recyclopedia' },
  { name: 'scan', pattern: /^\/scan$/, module: '/features/camera-scan/screens.js', tab: 'scan' },
  { name: 'scan-confirm', pattern: /^\/scan\/confirm$/, module: '/features/camera-scan/screens.js', tab: 'scan' },
  { name: 'locations', pattern: /^\/locations$/, module: '/features/locator/screens.js', tab: 'locations' },
  { name: 'facility', pattern: /^\/locations\/([^/]+)$/, params: ['facilityId'], module: '/features/locator/screens.js', tab: 'locations' },
  { name: 'guidelines', pattern: /^\/guidelines$/, module: '/features/guidelines/screens.js', tab: null },
  { name: 'another-life', pattern: /^\/another-life$/, module: '/features/reuse/screens.js', tab: null },
];

function decode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Returns { name, module, tab, route: { path, params, query } }, or null for an unknown path. */
export function matchRoute(pathname, search = '') {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  for (const entry of ROUTES) {
    const match = entry.pattern.exec(path);
    if (!match) continue;
    const params = {};
    (entry.params || []).forEach((name, i) => {
      params[name] = decode(match[i + 1]);
    });
    const query = {};
    for (const [key, value] of new URLSearchParams(search)) {
      if (!(key in query)) query[key] = value;
    }
    return { name: entry.name, module: entry.module, tab: entry.tab, route: { path, params, query } };
  }
  return null;
}

/** Removes one query parameter from a path-and-search string. */
export function withoutParam(pathname, search, name) {
  const params = new URLSearchParams(search);
  params.delete(name);
  const rest = params.toString();
  return rest ? `${pathname}?${rest}` : pathname;
}
