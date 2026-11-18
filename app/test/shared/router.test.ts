// Client routes (contracts 10 and 2.1, plus the PRD addendum's screens).
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { PUBLIC_DIR } from '../../src/shared/paths.ts';
import { clientModule } from '../helpers/client.ts';

const { ROUTES, matchRoute, withoutParam } = await clientModule('shared/router.js');

test('every contract route maps to its owner module', () => {
  const expected: [string, string][] = [
    ['/', '/shared/intro.js'],
    ['/place', '/shared/place.js'],
    ['/item', '/shared/item-page.js'],
    ['/recyclopedia', '/features/recyclopedia/screens.js'],
    ['/recyclopedia/plastic', '/features/recyclopedia/screens.js'],
    ['/search', '/features/recyclopedia/screens.js'],
    ['/scan', '/features/camera-scan/screens.js'],
    ['/scan/confirm', '/features/camera-scan/screens.js'],
    ['/locations', '/features/locator/screens.js'],
    ['/locations/f-sea-01', '/features/locator/screens.js'],
  ];
  for (const [route, module] of expected) assert.equal(matchRoute(route)?.module, module, route);
});

test('the addendum screens have routes', () => {
  assert.equal(matchRoute('/home')?.module, '/shared/home.js');
  assert.equal(matchRoute('/guidelines')?.module, '/features/guidelines/screens.js');
  assert.equal(matchRoute('/another-life')?.module, '/features/reuse/screens.js');
});

test('every routed module exists', () => {
  for (const route of ROUTES) assert.ok(existsSync(path.join(PUBLIC_DIR, route.module)), route.module);
});

test('route is { path, params, query } with decoded string values', () => {
  assert.deepEqual(matchRoute('/recyclopedia/plastic').route, { path: '/recyclopedia/plastic', params: { categoryId: 'plastic' }, query: {} });
  assert.deepEqual(matchRoute('/locations/f-hc-01', '?item=a%20b&rule_ids=x,y').route, {
    path: '/locations/f-hc-01',
    params: { facilityId: 'f-hc-01' },
    query: { item: 'a b', rule_ids: 'x,y' },
  });
  assert.deepEqual(matchRoute('/item', '?q=caf%C3%A9+cup&origin=scan').route.query, { q: 'café cup', origin: 'scan' });
  assert.equal(matchRoute('/item', '?q=first&q=second').route.query.q, 'first');
  assert.equal(matchRoute('/recyclopedia/').route.path, '/recyclopedia');
});

test('unknown paths match nothing', () => {
  for (const route of ['/nope', '/recyclopedia/a/b', '/scan/other', '/locations/a/b', '/Home']) assert.equal(matchRoute(route), null, route);
});

test('the tab bar highlights the right tab', () => {
  assert.equal(matchRoute('/item').tab, 'recyclopedia');
  assert.equal(matchRoute('/search').tab, 'recyclopedia');
  assert.equal(matchRoute('/scan/confirm').tab, 'scan');
  assert.equal(matchRoute('/locations/x').tab, 'locations');
  assert.equal(matchRoute('/home').tab, null);
});

test('a shared link’s place parameter is removed from the address', () => {
  assert.equal(withoutParam('/item', '?entry=tires&place=austin_tx', 'place'), '/item?entry=tires');
  assert.equal(withoutParam('/home', '?place=austin_tx', 'place'), '/home');
});
