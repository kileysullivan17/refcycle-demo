// Place guidelines (PRD addendum, screen 4): a read-only view of the Place's rules pack. Checked against
// the addendum: system summary, rules grouped by stream with each rule's quote and source, a hazardous
// waste section built from the special drop-off rules, the official contact link, and nothing invented.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { loadPacks, type Pack } from '../../../engine/code/src/rules.ts';
import { buildGuidelines, type RuleView } from '../../src/features/guidelines/guidelines.ts';
import { APP_DIR, RULES_DIR } from '../../src/shared/paths.ts';
import { startApp, type TestApp } from '../helpers/app.ts';
import { readPublic } from '../helpers/css.ts';

let app: TestApp;
let packs: Map<string, Pack>;
before(async () => {
  app = await startApp();
  packs = await loadPacks(RULES_DIR);
});
after(async () => {
  await app.close();
});
const get = async (place: string) => (await fetch(`${app.url}/api/guidelines?place=${place}`)).json();
const PLACES = ['seattle_wa', 'austin_tx', 'hawaii_county_hi'];
const everyView = (g: { groups: { rules: RuleView[] }[]; special_drop_off: RuleView[] }) => [...g.groups.flatMap((x) => x.rules), ...g.special_drop_off];

test('the summary and official contact link are the pack’s own', async () => {
  for (const place of PLACES) {
    const pack = packs.get(place)!;
    const g = await get(place);
    assert.equal(g.system_summary, pack.jurisdiction.system_summary);
    assert.deepEqual(g.official_source, { title: 'Official recycling information', url: pack.jurisdiction.official_contact_url });
    assert.deepEqual(g.place, { id: place, name: pack.jurisdiction.name });
  }
});

test('every rule in the pack is shown, each exactly once outside the special drop-off section', async () => {
  for (const place of PLACES) {
    const pack = packs.get(place)!;
    const g = await get(place);
    const grouped = g.groups.flatMap((x: { rules: RuleView[] }) => x.rules.map((r) => r.rule_id));
    const plainSpecial = g.special_drop_off.filter((r: RuleView) => r.stream === 'drop_off_special').map((r: RuleView) => r.rule_id);
    assert.equal(new Set(grouped).size, grouped.length);
    assert.deepEqual([...grouped, ...plainSpecial].sort(), pack.rules.map((r) => r.id).sort(), place);
  }
});

test('rules are grouped by the stream the pack gives them; nothing is reclassified', async () => {
  for (const place of PLACES) {
    const pack = packs.get(place)!;
    const g = await get(place);
    for (const group of g.groups) {
      for (const view of group.rules as RuleView[]) {
        const rule = pack.rules.find((r) => r.id === view.rule_id)!;
        if (['recycle_bin', 'compost_bin', 'garbage', 'deposit_return'].includes(group.key)) assert.equal(rule.stream, group.key, view.rule_id);
        if (group.key === 'depends') assert.ok(rule.stream === null && rule.conditions, view.rule_id);
        if (group.key === 'no_stream') assert.ok(rule.stream === null && !rule.conditions, view.rule_id);
      }
    }
    assert.ok(!g.groups.some((x: { key: string }) => x.key === 'drop_off_special'));
  }
  const hc = await get('hawaii_county_hi');
  assert.deepEqual(hc.groups.map((x: { key: string }) => x.key), ['recycle_bin', 'compost_bin', 'garbage', 'deposit_return', 'depends', 'no_stream']);
  assert.deepEqual(hc.groups.find((x: { key: string }) => x.key === 'no_stream').rules.map((r: RuleView) => r.rule_id), ['hc-system-000']);
});

test('the hazardous waste section is built from the special drop-off rules, and only from them', async () => {
  for (const place of PLACES) {
    const pack = packs.get(place)!;
    const expected = pack.rules.filter((r) => r.stream === 'drop_off_special' || (r.conditions ?? []).some((c) => c.stream === 'drop_off_special')).map((r) => r.id);
    const g = await get(place);
    assert.deepEqual(g.special_drop_off.map((r: RuleView) => r.rule_id), expected, place);
    assert.ok(expected.length >= 5, place);
  }
  const hc = (await get('hawaii_county_hi')).special_drop_off.map((r: RuleView) => r.rule_id);
  assert.deepEqual(hc, ['hc-plastic-006', 'hc-plastic-011', 'hc-plastic-012', 'hc-metal-007', 'hc-oil-015', 'hc-hhw-010', 'hc-hhw-017', 'hc-hhw-018', 'hc-tires-019']);
});

test('every field of every rule is copied from the pack as written', async () => {
  for (const place of PLACES) {
    const pack = packs.get(place)!;
    for (const view of everyView(await get(place))) {
      const rule = pack.rules.find((r) => r.id === view.rule_id)!;
      const source = pack.sources.find((s) => s.id === rule.source)!;
      assert.deepEqual(view.applies_to, rule.applies_to);
      assert.equal(view.stream, rule.stream);
      assert.deepEqual(view.conditions, rule.conditions ?? null);
      assert.deepEqual(view.prep, rule.prep);
      assert.equal(view.where, rule.where);
      assert.equal(view.quote, rule.quote);
      assert.equal(view.destination_quote, rule.destination_quote ?? null);
      assert.equal(view.location_limited, rule.location_limited === true);
      assert.equal(view.destination_inferred, rule.destination_inferred === true);
      assert.equal(view.source.title, source.title);
      assert.equal(view.source.url, source.url);
      assert.equal(view.source.publisher, source.publisher);
      assert.equal(view.source.date, source.observed ?? source.page_date ?? source.retrieved);
    }
  }
});

test('every rule carries its quote and its source; field sources are marked with their date', async () => {
  for (const place of PLACES) {
    for (const view of everyView(await get(place))) {
      assert.ok(view.quote.length > 0, view.rule_id);
      assert.ok(view.source.title.length > 0 && view.source.date, view.rule_id);
      assert.equal(view.source.field, ['field_observation', 'field_report'].includes(view.source.kind));
    }
  }
  const hc = everyView(await get('hawaii_county_hi'));
  const field = hc.find((r) => r.rule_id === 'hc-plastic-011')!;
  assert.deepEqual([field.source.kind, field.source.field, field.source.date, field.source.url], ['field_report', true, '2026-11-03 (phone call)', null]);
});

test('superseded and business-page sources, also-acceptable routes, the verified flag and pack notes are never served', async () => {
  for (const place of PLACES) {
    const text = JSON.stringify(await get(place));
    assert.doesNotMatch(text, /superseded|business_page|also_acceptable|verified_by_ks|"notes"|"observer"|"retrieved"/, place);
    const pack = packs.get(place)!;
    for (const source of pack.sources.filter((s) => s.kind === 'superseded' || s.kind === 'business_page')) {
      assert.ok(!text.includes(JSON.stringify(source.title).slice(1, -1)), `${place} ${source.id}`);
    }
  }
});

test('a rule on a superseded or business source would be left out, not shown', () => {
  const hc = packs.get('hawaii_county_hi')!;
  const tampered: Pack = { ...hc, rules: [{ ...hc.rules[1], id: 'x-1', source: 'src-06' }, hc.rules[2]] };
  assert.deepEqual(everyView(buildGuidelines(tampered)).map((r) => r.rule_id), [hc.rules[2].id]);
});

test('no collection-day schedule is added: the response has no schedule or day field', async () => {
  for (const place of PLACES) assert.doesNotMatch(JSON.stringify(Object.keys((await get(place)))), /schedule|collection|days/i);
  const screen = readPublic('features/guidelines/screens.js').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(screen, /Monday|Tuesday|Wednesday|Thursday|Friday|pickup day|collection day/i);
});

test('the screen is read-only and asks the engine nothing', () => {
  for (const file of ['src/features/guidelines/guidelines.ts', 'src/features/guidelines/routes.ts']) {
    const source = readFileSync(path.join(APP_DIR, file), 'utf8');
    assert.doesNotMatch(source, /writeFile|appendFile|\/api\/ask|fetch\(|identify/, file);
  }
  const screen = readPublic('features/guidelines/screens.js');
  assert.doesNotMatch(screen, /\bask\(|\/api\/ask|<form|type: 'submit'|contenteditable/);
  assert.match(screen, /'Hazardous waste and special drop-off'/);
  assert.match(screen, /Official contact page/);
});

test('quotes are shown as the pack holds them, with no text swap; other pack text goes through displayText', () => {
  const screen = readPublic('features/guidelines/screens.js');
  assert.match(screen, /`“\$\{rule\.quote\}”`/);
  assert.doesNotMatch(screen, /text\(rule\.quote|displayText\(rule\.quote/);
  assert.match(screen, /text\(rule\.where, 'where'\)/);
  assert.match(screen, /ctx\.displayText\(data\.system_summary/);
});

test('a missing or unknown place is HTTP 400; guidelines are never limited', async () => {
  assert.equal((await fetch(`${app.url}/api/guidelines`)).status, 400);
  assert.equal((await fetch(`${app.url}/api/guidelines?place=portland_or`)).status, 400);
  const limited = await startApp({ limitsConfig: { enabled: true, visitorDailyLimit: 1, dailyCapUsd: 0.000001 } });
  try {
    for (let i = 0; i < 3; i++) assert.equal((await fetch(`${limited.url}/api/guidelines?place=austin_tx`)).status, 200);
  } finally {
    await limited.close();
  }
});
