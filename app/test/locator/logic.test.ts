// Locator screen rules (PRD 6): events, field-source notes, grouping, filter values, and what the screens
// must never show.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clientModule } from '../helpers/client.ts';
import { readPublic } from '../helpers/css.ts';

const { KIND_TAGS, localToday, eventState, fieldNote, rulesOfSite, groupByRule, materialsOf, acceptedItems, parseRuleIds, locationsHref } = await clientModule('features/locator/logic.js');
const screens = readPublic('features/locator/screens.js');

const site = (over: Record<string, unknown> = {}) => ({ facility_id: 'f-1', name: 'Site', kind: 'site', materials: [], rule_ids: ['r-1'], event_last_date: null, ...over });
const rule = (over: Record<string, unknown> = {}) => ({ rule_id: 'r-1', where: null, location_limited: false, source_kind: 'official_page', source_date: '2026-09-10', source_url: null, applies_to: ['a'], ...over });

test('a dated event is tentative through its last date, then "check the source" (LOC-17)', () => {
  const event = site({ kind: 'event', event_last_date: '2027-03-06' });
  assert.equal(eventState(event, '2026-11-11'), 'tentative');
  assert.equal(eventState(event, '2027-03-06'), 'tentative');
  assert.equal(eventState(event, '2027-03-07'), 'past');
  assert.equal(eventState(site(), '2030-01-01'), null);
  assert.equal(KIND_TAGS.event, 'Tentative');
  assert.match(screens, /Check the source for the next event\./);
});

test('today is the visitor’s local date', () => {
  assert.equal(localToday(new Date(2027, 2, 6, 23, 59)), '2027-03-06');
  assert.equal(localToday(new Date(2026, 0, 5, 0, 0)), '2026-01-05');
});

test('information resting on a field observation or report says so, with its date (LOC-7)', () => {
  assert.equal(fieldNote(rule({ source_kind: 'field_report', source_date: '2026-11-03 (phone call)' })), 'Field report dated 2026-11-03 (phone call); not a published page.');
  assert.equal(fieldNote(rule({ source_kind: 'field_observation', source_date: '2026-07' })), 'Field observation dated 2026-07; not a published page.');
  assert.equal(fieldNote(rule()), null);
  assert.equal(fieldNote(null), null);
});

test('an item’s sites are grouped by cited rule, every rule kept (G19)', () => {
  const rules = [rule({ rule_id: 'a' }), rule({ rule_id: 'b' }), rule({ rule_id: 'c' })];
  const sites = [site({ facility_id: 'f-1', rule_ids: ['a', 'b'] }), site({ facility_id: 'f-2', rule_ids: ['b'] })];
  const groups = groupByRule(rules, sites);
  assert.deepEqual(groups.map((g: any) => [g.rule.rule_id, g.sites.map((s: any) => s.facility_id)]), [['a', ['f-1']], ['b', ['f-1', 'f-2']], ['c', []]]);
  assert.deepEqual(rulesOfSite(sites[0], rules).map((r: any) => r.rule_id), ['a', 'b']);
});

test('a facility page lists only items its linked pack rules send there (LOC-9)', () => {
  const rules = [rule({ rule_id: 'a', applies_to: ['tires', 'car tires'] }), rule({ rule_id: 'b', applies_to: ['batteries', 'tires'] }), rule({ rule_id: 'z', applies_to: ['paint'] })];
  assert.deepEqual(acceptedItems(site({ rule_ids: ['a', 'b'] }), rules), ['tires', 'car tires', 'batteries']);
  assert.deepEqual(acceptedItems(site({ rule_ids: ['none'] }), rules), []);
});

test('filter values are the materials the sites name, in order (LOC-18)', () => {
  assert.deepEqual(materialsOf([site({ materials: ['tires', 'batteries'] }), site({ materials: ['batteries', 'Antifreeze'] })]), ['Antifreeze', 'batteries', 'tires']);
});

test('addresses keep the item context between list, map and detail', () => {
  assert.deepEqual(parseRuleIds('a, b,,c'), ['a', 'b', 'c']);
  assert.deepEqual(parseRuleIds(undefined), []);
  assert.equal(locationsHref({ view: 'map', item: 'car tires', ruleIds: ['a', 'b'], material: 'tires' }), '/locations?view=map&item=car+tires&rule_ids=a%2Cb&material=tires');
  assert.equal(locationsHref({}), '/locations?view=list');
  assert.equal(locationsHref({ facilityId: 'f-hc-06', item: 'bottle', ruleIds: ['hc-plastic-011'] }), '/locations/f-hc-06?item=bottle&rule_ids=hc-plastic-011');
  assert.equal(locationsHref({ facilityId: 'f-sea-01' }), '/locations/f-sea-01');
});

test('the locator uses no device location, distances, geocoder or outside directory (LOC-2, LOC-13, LOC-14)', () => {
  for (const file of ['features/locator/screens.js', 'features/locator/logic.js']) {
    const source = readPublic(file).replace(/^\s*\/\/.*$/gm, '');
    assert.doesNotMatch(source, /geolocation|getCurrentPosition|watchPosition|distance|miles|\bkm\b|geocod|nominatim|maps\.google|places api/i, file);
  }
  assert.doesNotMatch(readPublic('index.html'), /geolocation/);
});

test('ratings, hours fields and phone numbers from the Figma frames are not rendered (LOC-10)', () => {
  assert.doesNotMatch(screens, /rating|review|stars|phone|opening_hours|\.hours\b/i);
});

test('the map uses OpenStreetMap tiles with the visible attribution, and the bundled library (contracts 7.4)', () => {
  assert.ok(screens.includes("'https://tile.openstreetmap.org/{z}/{x}/{y}.png'"));
  assert.ok(screens.includes('https://www.openstreetmap.org/copyright'));
  assert.ok(screens.includes('© OpenStreetMap contributors'));
  assert.ok(screens.includes("'/shared/vendor/leaflet/leaflet.js'"));
  assert.ok(screens.includes('No mapped locations yet; see the list'));
  assert.match(screens, /sites\.filter\(\(site\) => site\.pin\)/);
});

test('the wording for the only site and for no named place is on the screens (LOC-5, LOC-11)', () => {
  assert.ok(screens.includes('This is the only place that takes this item.'));
  assert.ok(screens.includes('The rules pack does not name a place for this item.'));
  assert.match(screens, /officialSource\(data\)/);
});
