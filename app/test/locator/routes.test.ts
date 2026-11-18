// GET /api/sites over HTTP (contracts 6).
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { startApp, type TestApp } from '../helpers/app.ts';

let app: TestApp;
before(async () => {
  app = await startApp();
});
after(async () => {
  await app.close();
});
const get = async (query: string) => {
  const response = await fetch(`${app.url}/api/sites${query}`);
  return { status: response.status, body: await response.json() };
};

test('the response has rules, sites and the official source', async () => {
  const { status, body } = await get('?place=austin_tx');
  assert.equal(status, 200);
  assert.deepEqual(Object.keys(body), ['rules', 'sites', 'official_source']);
  assert.deepEqual(body.official_source, { title: 'Official recycling information', url: 'https://www.austintexas.gov/recycling' });
  assert.deepEqual(Object.keys(body.sites[0]), ['facility_id', 'place', 'name', 'kind', 'type', 'materials', 'address', 'pin', 'source_url', 'source_label', 'date_checked', 'rule_ids', 'notes', 'only_site', 'event_last_date']);
});

test('rule_ids is a comma-separated list; material filters', async () => {
  const item = await get('?place=hawaii_county_hi&rule_ids=hc-plastic-011,%20hc-plastic-012');
  assert.deepEqual(item.body.sites.map((s: { facility_id: string }) => s.facility_id).sort(), ['f-hc-06', 'f-hc-07']);
  assert.ok(item.body.sites.every((s: { only_site: boolean }) => s.only_site));
  const filtered = await get('?place=seattle_wa&material=tires');
  assert.deepEqual(filtered.body.sites.map((s: { facility_id: string }) => s.facility_id), ['f-sea-01', 'f-sea-02']);
});

test('an empty rule_ids parameter means an item with no cited rules, not "everything"', async () => {
  const { body } = await get('?place=seattle_wa&rule_ids=');
  assert.deepEqual([body.rules, body.sites], [[], []]);
});

test('the conditions the pack states are served as written (LOC-6)', async () => {
  const sea = (await get('?place=seattle_wa&rule_ids=sea-special-024')).body;
  assert.equal(sea.sites[0].notes, '$16 per load, 4 tires max. 8 am to 5:30 pm daily; opens at 10 am on the first Wednesday of the month.');
  const atx = (await get('?place=austin_tx&rule_ids=atx-foam-009')).body;
  assert.match(atx.sites[0].notes, /^By appointment\./);
  const hc = (await get('?place=hawaii_county_hi&rule_ids=hc-plastic-012')).body;
  assert.match(hc.rules[0].where, /Bottles and jugs only: no caps or tubs/);
});

test('a missing or unknown place is HTTP 400', async () => {
  assert.equal((await get('')).status, 400);
  assert.equal((await get('?place=')).status, 400);
  assert.equal((await get('?place=portland_or')).status, 400);
});

test('if the data cannot be loaded: HTTP 500 with a fixed message and no detail (K1)', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'refcycle-bad-csv-'));
  const file = path.join(dir, 'facilities.csv');
  writeFileSync(file, 'facility_id,place,name,type,materials,address,lat,lng,source_url,source_label,date_checked,rule_ids,notes,internal_notes\nx,seattle_wa,Secret,moonbase,,,,,,,,sea-special-017,,private detail');
  const broken = await startApp({ facilitiesCsv: file });
  try {
    const response = await fetch(`${broken.url}/api/sites?place=seattle_wa`);
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: 'Site data could not be loaded' });
  } finally {
    await broken.close();
  }
  const noPacks = await startApp({ rulesDir: dir });
  try {
    const response = await fetch(`${noPacks.url}/api/sites?place=seattle_wa`);
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: 'Site data could not be loaded' });
  } finally {
    await noPacks.close();
  }
});

test('the locator makes no model call and is never limited', async () => {
  const limited = await startApp({ limitsConfig: { enabled: true, visitorDailyLimit: 1, dailyCapUsd: 0.000001 } });
  try {
    for (let i = 0; i < 5; i++) assert.equal((await fetch(`${limited.url}/api/sites?place=seattle_wa`)).status, 200);
    assert.equal(limited.context.limits.status().spentUsd, 0);
  } finally {
    await limited.close();
  }
});
