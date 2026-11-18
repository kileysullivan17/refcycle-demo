// Locator data (contracts 6 and 7). Sites come only from engine/data/facilities.csv, and the "where" text,
// location_limited flag and source details only from the selected place's rules pack. Both are read-only.
// No other directory, search provider, geocoder or mock data is used (LOC-2, LOC-13).
import { readFile } from 'node:fs/promises';
import { parse } from 'csv-parse/sync';
import { getPacks, isFieldSource, sourceDate, sourceOf, type Pack } from '../../shared/packs.ts';

export type RuleWhere = {
  rule_id: string;
  where: string | null;
  location_limited: boolean;
  source_kind: string;
  source_date: string | null;
  source_url: string | null;
  applies_to: string[];
};

export type Facility = {
  facility_id: string;
  place: string;
  name: string;
  kind: 'site' | 'event' | 'category' | 'how_to';
  type: string;
  materials: string[];
  address: string | null;
  pin: { lat: number; lng: number } | null;
  source_url: string | null;
  source_label: string | null;
  date_checked: string | null;
  rule_ids: string[];
  notes: string;
  only_site: boolean;
  event_last_date: string | null;
};

export type SitesResponse = {
  rules: RuleWhere[];
  sites: Facility[];
  official_source: { title: string; url: string };
};

export class UnknownPlace extends Error {}

const KINDS: Record<string, Facility['kind']> = {
  transfer_station: 'site',
  hhw_facility: 'site',
  city_dropoff: 'site',
  reuse_center: 'site',
  private_recycler: 'site',
  site: 'site',
  hhw_event: 'event',
  retail_dropoff_unnamed: 'category',
  library_unnamed: 'category',
  redemption_center: 'category',
  tire_company: 'category',
  category: 'category',
  how_to: 'how_to',
};

// Contracts 7.3 (Q18, G11): the last date of each tentative event.
const EVENT_LAST_DATES: Record<string, string> = {
  'f-hc-01': '2027-02-28',
  'f-hc-02': '2027-02-28',
  'f-hc-03': '2027-03-06',
  'f-hc-04': '2027-03-07',
};

const COLUMNS = ['facility_id', 'place', 'name', 'type', 'materials', 'address', 'lat', 'lng', 'source_url', 'source_label', 'date_checked', 'rule_ids', 'notes', 'internal_notes'];

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const orNull = (value: unknown): string | null => text(value) || null;

/** Parses the facility list. internal_notes is read past and never kept (G0). */
export function parseFacilities(csv: string): Facility[] {
  const rows = parse(csv, { columns: true, skip_empty_lines: true, bom: true }) as Record<string, string>[];
  if (rows.length && COLUMNS.some((c) => !(c in rows[0]))) throw new Error('Facility list has unexpected columns');
  return rows.map((row) => {
    const type = text(row.type);
    const kind = KINDS[type];
    if (!kind) throw new Error(`Unknown facility type "${type}" on ${text(row.facility_id)}`); // a contract break (7.2)
    const rawAddress = text(row.address);
    const address = !rawAddress || /^(withheld|not listed)/i.test(rawAddress) ? null : rawAddress;
    const lat = text(row.lat) === '' ? NaN : Number(row.lat);
    const lng = text(row.lng) === '' ? NaN : Number(row.lng);
    const pinned = (kind === 'site' || kind === 'event') && Number.isFinite(lat) && Number.isFinite(lng);
    const id = text(row.facility_id);
    return {
      facility_id: id,
      place: text(row.place),
      name: text(row.name),
      kind,
      type,
      materials: text(row.materials) ? text(row.materials).split(';').map((m) => m.trim()).filter(Boolean) : [],
      address,
      pin: pinned ? { lat, lng } : null,
      source_url: orNull(row.source_url),
      source_label: orNull(row.source_label),
      date_checked: orNull(row.date_checked),
      rule_ids: text(row.rule_ids) ? text(row.rule_ids).split(';').map((r) => r.trim()).filter(Boolean) : [],
      notes: text(row.notes),
      only_site: false,
      event_last_date: kind === 'event' ? (EVENT_LAST_DATES[id] ?? null) : null,
    };
  });
}

const facilityFiles = new Map<string, Promise<Facility[]>>();

function getFacilities(file: string): Promise<Facility[]> {
  let promise = facilityFiles.get(file);
  if (!promise) {
    promise = readFile(file, 'utf8').then(parseFacilities);
    facilityFiles.set(file, promise);
    promise.catch(() => facilityFiles.delete(file));
  }
  return promise;
}

/** One rule's site details, read from the pack as written. A rule on a superseded source is never read (LOC-8). */
export function ruleWhere(pack: Pack, ruleId: string): RuleWhere | null {
  const rule = pack.rules.find((r) => r.id === ruleId);
  if (!rule) return null;
  const source = sourceOf(pack, rule.source);
  if (!source || source.kind === 'superseded') return null;
  return {
    rule_id: rule.id,
    where: rule.where ?? null,
    location_limited: rule.location_limited === true,
    source_kind: source.kind,
    source_date: sourceDate(source),
    source_url: source.url ?? null,
    applies_to: [...rule.applies_to],
  };
}

export { isFieldSource };

export type SitesQuery = { place: string; ruleIds?: string[] | null; material?: string | null };

/**
 * GET /api/sites. With rule ids: the pack details of those rules and the facility records linked to any of
 * them (LOC-4). Without: every linked record for the place (LOC-12). Records with no rule link are never
 * returned (G8). Only the selected place's pack and records are read.
 */
export async function findSites(rulesDir: string, facilitiesCsv: string, query: SitesQuery): Promise<SitesResponse> {
  const [packs, facilities] = await Promise.all([getPacks(rulesDir), getFacilities(facilitiesCsv)]);
  const pack = packs.get(query.place);
  if (!pack) throw new UnknownPlace(query.place);

  const linked = facilities.filter((f) => f.place === query.place && f.rule_ids.length > 0);
  const asked = query.ruleIds ? [...new Set(query.ruleIds)] : null;
  const readable = (id: string): RuleWhere | null => ruleWhere(pack, id);

  let rules: RuleWhere[];
  let sites: Facility[];
  if (asked) {
    rules = asked.map(readable).filter((r): r is RuleWhere => r !== null);
    const ids = new Set(rules.map((r) => r.rule_id));
    const limited = new Set(rules.filter((r) => r.location_limited).map((r) => r.rule_id));
    sites = linked
      .filter((f) => f.rule_ids.some((id) => ids.has(id)))
      .map((f) => ({ ...f, only_site: f.rule_ids.some((id) => limited.has(id)) }));
  } else {
    sites = linked.map((f) => ({ ...f }));
    const ids = [...new Set(sites.flatMap((f) => f.rule_ids))];
    rules = ids.map(readable).filter((r): r is RuleWhere => r !== null);
  }
  // A record whose every linked rule is unreadable (unknown or superseded) carries no usable source.
  const known = new Set(rules.map((r) => r.rule_id));
  sites = sites.filter((f) => f.rule_ids.some((id) => known.has(id)));

  const material = query.material?.trim();
  if (material) sites = sites.filter((f) => f.materials.includes(material));
  sites.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) || a.facility_id.localeCompare(b.facility_id));

  return {
    rules,
    sites,
    official_source: { title: 'Official recycling information', url: pack.jurisdiction.official_contact_url },
  };
}
