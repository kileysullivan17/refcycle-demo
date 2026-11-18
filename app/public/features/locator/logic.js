// Locator rules with no DOM (PRD 6; contracts 6 and 7), so they are unit-tested.
// Everything shown comes from /api/sites: the facility list and the selected Place's pack. Nothing is added.

export const KIND_TAGS = { site: null, event: 'Tentative', category: 'Several sites', how_to: 'How to' };

/** Today's date in the visitor's own time zone, as YYYY-MM-DD. */
export function localToday(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** A dated event is "tentative" until its last date has passed, then "past" (Q18, LOC-17). */
export function eventState(site, today) {
  if (site.kind !== 'event') return null;
  return site.event_last_date && today > site.event_last_date ? 'past' : 'tentative';
}

/** Site information resting on a field observation or field report says so, with its date (LOC-7). */
export function fieldNote(rule) {
  if (!rule || (rule.source_kind !== 'field_observation' && rule.source_kind !== 'field_report')) return null;
  const kind = rule.source_kind === 'field_report' ? 'Field report' : 'Field observation';
  return `${kind} dated ${rule.source_date ?? 'date not recorded'}; not a published page.`;
}

export function rulesOfSite(site, rules) {
  return rules.filter((rule) => site.rule_ids.includes(rule.rule_id));
}

/** For an item: one group per cited rule, each with the sites that rule links to (G19). */
export function groupByRule(rules, sites) {
  return rules.map((rule) => ({ rule, sites: sites.filter((site) => site.rule_ids.includes(rule.rule_id)) }));
}

/** The filter values: every material named by the sites, in name order (LOC-18). */
export function materialsOf(sites) {
  return [...new Set(sites.flatMap((site) => site.materials))].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
}

/** What every accepted-items list on a facility page is built from: the linked rules' applies_to (LOC-9). */
export function acceptedItems(site, rules) {
  return [...new Set(rulesOfSite(site, rules).flatMap((rule) => rule.applies_to))];
}

export function parseRuleIds(value) {
  return typeof value === 'string'
    ? value
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean)
    : [];
}

/** Builds a /locations address, keeping the item context. */
export function locationsHref({ view, item, ruleIds, material, facilityId } = {}) {
  const params = new URLSearchParams();
  if (!facilityId) params.set('view', view === 'map' ? 'map' : 'list');
  if (item) params.set('item', item);
  if (ruleIds && ruleIds.length) params.set('rule_ids', ruleIds.join(','));
  if (material && !facilityId) params.set('material', material);
  const query = params.toString();
  const path = facilityId ? `/locations/${encodeURIComponent(facilityId)}` : '/locations';
  return query ? `${path}?${query}` : path;
}
