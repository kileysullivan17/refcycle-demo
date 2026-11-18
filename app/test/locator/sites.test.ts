// Locator data (contracts 6 and 7; LOC-2 to LOC-18), against the real facility list and public packs.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { loadPacks } from '../../../engine/code/src/rules.ts';
import { findSites, parseFacilities, ruleWhere, UnknownPlace } from '../../src/features/locator/sites.ts';
import { FACILITIES_CSV, RULES_DIR } from '../../src/shared/paths.ts';

const csv = readFileSync(FACILITIES_CSV, 'utf8');
const all = parseFacilities(csv);
const find = (place: string, ruleIds?: string[] | null, material?: string) => findSites(RULES_DIR, FACILITIES_CSV, { place, ruleIds, material });
const ids = (r: { sites: { facility_id: string }[] }) => r.sites.map((s) => s.facility_id);
const HEADER = 'facility_id,place,name,type,materials,address,lat,lng,source_url,source_label,date_checked,rule_ids,notes,internal_notes';

test('every record in the facility list parses, and its type maps to a kind', () => {
  assert.equal(all.length, 28);
  const kinds: Record<string, string> = Object.fromEntries(all.map((f) => [f.facility_id, f.kind]));
  assert.equal(kinds['f-sea-01'], 'site');
  assert.equal(kinds['f-atx-01'], 'site');
  assert.equal(kinds['f-hc-05'], 'site'); // reuse_center
  assert.equal(kinds['f-hc-06'], 'site'); // private_recycler
  assert.equal(kinds['p-hc-04'], 'site');
  assert.equal(kinds['f-hc-01'], 'event');
  assert.equal(kinds['f-atx-02'], 'category'); // retail_dropoff_unnamed
  assert.equal(kinds['f-atx-03'], 'category'); // library_unnamed
  assert.equal(kinds['f-hc-08'], 'category'); // redemption_center
  assert.equal(kinds['f-hc-09'], 'category'); // tire_company
  assert.equal(kinds['p-sea-01'], 'how_to');
});

test('an unknown type is a contract break, not a silent default', () => {
  assert.throws(() => parseFacilities(`${HEADER}\nx-1,seattle_wa,Mystery,spaceport,,,,,,,,sea-special-017,,`), /Unknown facility type "spaceport"/);
});

test('internal_notes never leaves the server', async () => {
  for (const facility of all) assert.ok(!('internal_notes' in facility));
  const response = JSON.stringify(await find('seattle_wa'));
  assert.doesNotMatch(response, /internal_notes|verified by KS|Coordinates entered|KS to spot-check|Decided 2026/);
});

test('address rule: empty, "withheld..." and "not listed..." become null; anything else is shown as written', () => {
  const by = Object.fromEntries(all.map((f) => [f.facility_id, f]));
  assert.equal(by['f-sea-01'].address, '1350 N 34th St, Seattle, WA 98103');
  assert.equal(by['f-hc-01'].address, 'location to be announced');
  assert.equal(by['f-hc-06'].address, null); // withheld (private pack)
  assert.equal(by['f-hc-09'].address, null); // withheld (pack lists four, names withheld)
  assert.equal(by['f-atx-02'].address, null); // not listed by the city
  assert.equal(by['f-hc-08'].address, null); // not listed in the pack
  assert.equal(by['p-sea-01'].address, null);
});

test('pins come only from the hand-entered coordinates; category and how-to records never get one', () => {
  const pinned = all.filter((f) => f.pin).map((f) => f.facility_id);
  assert.deepEqual(pinned, ['f-sea-01', 'f-sea-02', 'f-sea-03', 'f-sea-04', 'f-atx-01', 'f-hc-03', 'f-hc-04']);
  assert.deepEqual(all.find((f) => f.facility_id === 'f-sea-01')!.pin, { lat: 47.6488529, lng: -122.3409766 });
  const forced = parseFacilities(`${HEADER}\nc-1,seattle_wa,A group,category,,,47.6,-122.3,,,,sea-special-017,,\nh-1,seattle_wa,A how to,how_to,,,47.6,-122.3,,,,sea-special-017,,\ns-1,seattle_wa,Half,site,,,47.6,,,,,sea-special-017,,`);
  assert.deepEqual(forced.map((f) => f.pin), [null, null, null]);
});

test('coordinates sit in the right part of the world for each place (no geocoder, so a slip would show here)', () => {
  const boxes: Record<string, [number, number, number, number]> = {
    seattle_wa: [47.4, 47.8, -122.5, -122.2],
    austin_tx: [30.0, 30.6, -98.0, -97.5],
    hawaii_county_hi: [18.8, 20.4, -156.2, -154.7],
  };
  for (const f of all.filter((x) => x.pin)) {
    const [latMin, latMax, lngMin, lngMax] = boxes[f.place];
    assert.ok(f.pin!.lat >= latMin && f.pin!.lat <= latMax && f.pin!.lng >= lngMin && f.pin!.lng <= lngMax, f.facility_id);
  }
});

test('materials split on semicolons; empty source values become null', () => {
  const by = Object.fromEntries(all.map((f) => [f.facility_id, f]));
  assert.deepEqual(by['f-sea-01'].materials, ['tires', 'batteries']);
  assert.equal(by['f-hc-06'].source_url, null);
  assert.equal(by['f-hc-06'].source_label, 'phone report, 2026-11-03');
  assert.equal(by['f-sea-01'].source_label, null);
  assert.equal(by['f-sea-01'].date_checked, '2026-11-05');
});

test('event last dates are the contract’s (Q18, G11); other records have none', () => {
  const by = Object.fromEntries(all.map((f) => [f.facility_id, f.event_last_date]));
  assert.deepEqual([by['f-hc-01'], by['f-hc-02'], by['f-hc-03'], by['f-hc-04']], ['2027-02-28', '2027-02-28', '2027-03-06', '2027-03-07']);
  assert.equal(by['f-sea-01'], null);
});

test('with no item, every linked record for the place, sorted by name (LOC-12, LOC-14)', async () => {
  const sea = await find('seattle_wa');
  assert.deepEqual(ids(sea), ['p-sea-01', 'f-sea-03', 'f-sea-01', 'p-sea-02', 'f-sea-04', 'f-sea-02']);
  const names = sea.sites.map((s) => s.name);
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' })));
  for (const site of sea.sites) assert.equal(site.place, 'seattle_wa');
  assert.equal((await find('hawaii_county_hi')).sites.length, 14);
});

test('records with no rule link are never returned (G8)', async () => {
  assert.ok(!ids(await find('seattle_wa')).includes('p-sea-03'));
  assert.ok(!ids(await find('austin_tx')).includes('p-atx-04'));
});

test('data fix S1: the curbside service rule links to no facility', async () => {
  const result = await find('hawaii_county_hi', ['hc-system-000']);
  assert.deepEqual(ids(result), []);
  assert.equal(result.rules[0].where, 'County Recycling and Transfer Stations');
});

test('for an item, only the sites linked to the cited rules (LOC-4)', async () => {
  assert.deepEqual(ids(await find('seattle_wa', ['sea-special-024'])), ['f-sea-01', 'f-sea-02']);
  assert.deepEqual(ids(await find('austin_tx', ['atx-special-023'])), ['f-atx-01']);
  assert.deepEqual(ids(await find('hawaii_county_hi', ['hc-tires-019'])), ['f-hc-09']);
  assert.deepEqual(ids(await find('hawaii_county_hi', ['hc-deposit-005'])), ['f-hc-08']);
});

test('a location-limited rule returns its one site marked as the only site (LOC-5)', async () => {
  const result = await find('hawaii_county_hi', ['hc-plastic-011']);
  assert.deepEqual(ids(result), ['f-hc-06']);
  assert.equal(result.sites[0].only_site, true);
  assert.equal(result.rules[0].location_limited, true);
  const tires = await find('hawaii_county_hi', ['hc-tires-019']);
  assert.equal(tires.sites[0].only_site, false);
  // Listed without an item, the same site is not flagged.
  assert.equal((await find('hawaii_county_hi')).sites.find((s) => s.facility_id === 'f-hc-06')!.only_site, false);
});

test('a conditional answer’s rules return the sites of every cited rule (G19)', async () => {
  const result = await find('hawaii_county_hi', ['hc-plastic-006', 'hc-plastic-011', 'hc-plastic-012']);
  assert.deepEqual(ids(result).sort(), ['f-hc-06', 'f-hc-07']);
  assert.deepEqual(result.rules.map((r) => r.rule_id), ['hc-plastic-006', 'hc-plastic-011', 'hc-plastic-012']);
  assert.equal(result.rules[0].where, null);
});

test('each rule comes back with where, location_limited, source kind, date and url, and applies_to as written (K5)', async () => {
  const result = await find('hawaii_county_hi', ['hc-plastic-011', 'hc-hhw-010']);
  const [field, official] = result.rules;
  assert.deepEqual(Object.keys(field), ['rule_id', 'where', 'location_limited', 'source_kind', 'source_date', 'source_url', 'applies_to']);
  assert.equal(field.source_kind, 'field_report');
  assert.equal(field.source_date, '2026-11-03 (phone call)'); // the observed value (LOC-7)
  assert.equal(field.source_url, null);
  assert.deepEqual(field.applies_to, ['clear #1 PET plastic bottles that are not HI-5 containers']);
  assert.equal(official.source_kind, 'official_page');
  assert.equal(official.source_date, '2026-09-10'); // no page date, so the date it was retrieved
  assert.equal(official.source_url, 'https://www.hawaiizerowaste.org/recycle/household-hazardous-waste/');
  const dated = (await find('hawaii_county_hi', ['hc-paper-001'])).rules[0];
  assert.equal(dated.source_date, '2026-08-08'); // the page's own date
});

test('rules are read from the selected place’s pack only', async () => {
  const wrongPlace = await find('seattle_wa', ['hc-plastic-011', 'atx-special-023']);
  assert.deepEqual(wrongPlace.rules, []);
  assert.deepEqual(wrongPlace.sites, []);
  const unknown = await find('seattle_wa', ['sea-nothing-999']);
  assert.deepEqual([unknown.rules, unknown.sites], [[], []]);
});

test('a rule with no where and no linked record returns nothing to show (LOC-11)', async () => {
  const result = await find('hawaii_county_hi', ['hc-paper-002']);
  assert.equal(result.rules[0].where, null);
  assert.deepEqual(result.sites, []);
  assert.deepEqual(result.official_source, { title: 'Official recycling information', url: 'https://www.hawaiizerowaste.org/recycle/drop-off/' });
});

test('an abstention (no rule ids) names no site', async () => {
  const result = await find('austin_tx', []);
  assert.deepEqual([result.rules, result.sites], [[], []]);
  assert.equal(result.official_source.url, 'https://www.austintexas.gov/recycling');
});

test('the material filter keeps only records whose materials list has that value (LOC-18)', async () => {
  assert.deepEqual(ids(await find('seattle_wa', null, 'tires')), ['f-sea-01', 'f-sea-02']);
  assert.deepEqual(ids(await find('seattle_wa', null, 'tire')), []);
  assert.deepEqual(ids(await find('seattle_wa', ['sea-special-017'], 'oil-based paint')), ['f-sea-03', 'f-sea-04']);
});

test('no rule resting on a superseded source is ever read (LOC-8)', async () => {
  const packs = await loadPacks(RULES_DIR);
  for (const pack of packs.values()) {
    const superseded = new Set(pack.sources.filter((s) => s.kind === 'superseded').map((s) => s.id));
    for (const rule of pack.rules) {
      const view = ruleWhere(pack, rule.id);
      assert.ok(view, rule.id);
      assert.ok(!superseded.has(rule.source));
      assert.notEqual(view!.source_kind, 'superseded');
    }
  }
  const hc = packs.get('hawaii_county_hi')!;
  const tampered = { ...hc, rules: [{ ...hc.rules[1], source: 'src-06' }] };
  assert.equal(ruleWhere(tampered, hc.rules[1].id), null);
});

test('private businesses appear by public description only (LOC-3, X-8)', async () => {
  const hc = await find('hawaii_county_hi');
  const names = hc.sites.map((s) => s.name);
  assert.ok(names.includes('A private recycler in Hilo (#1 clear bottles)'));
  assert.ok(names.includes('A private recycler in the Shipman Industrial Park (#2 bottles and jugs)'));
  assert.ok(names.includes('A local biodiesel company (call first)'));
  assert.ok(names.includes('County-listed tire companies (4) or the tire retailer'));
  for (const site of hc.sites.filter((s) => /private recycler|biodiesel|tire companies|scrap metal company/i.test(s.name))) {
    assert.equal(site.address, null, site.facility_id);
    assert.equal(site.pin, null, site.facility_id);
  }
});

test('every site shown has a source: a link or a label (the "facilities shown with no source" measure)', async () => {
  for (const place of ['seattle_wa', 'austin_tx', 'hawaii_county_hi']) {
    for (const site of (await find(place)).sites) assert.ok(site.source_url || site.source_label, site.facility_id);
  }
});

test('an unknown place is an error, not an empty list', async () => {
  await assert.rejects(find('portland_or'), UnknownPlace);
});
