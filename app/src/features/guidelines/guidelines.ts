// Place guidelines (PRD addendum): a read-only view of one Place's rules pack. Every field is copied from
// the pack as written. Nothing is added, summarized, reworded or inferred, and the engine's answers are not
// involved: this screen shows the pack, it does not answer questions about an item.
//
// Left out on purpose: also_acceptable routes (not shown anywhere in this build, G8), business_page and
// superseded sources (never a rule's source), internal comments, and the verified_by_ks flag (X-13).
import { getPacks, isFieldSource, sourceDate, sourceOf, type Pack, type PackSource, type Rule } from '../../shared/packs.ts';

export type SourceView = {
  kind: string;
  title: string;
  url: string | null;
  publisher: string;
  date: string | null;
  field: boolean;
};

export type RuleView = {
  rule_id: string;
  applies_to: string[];
  stream: string | null;
  conditions: { if: string; stream: string }[] | null;
  prep: string[];
  where: string | null;
  quote: string;
  destination_quote: string | null;
  destination_inferred: boolean;
  location_limited: boolean;
  source: SourceView;
  destination_source: SourceView | null;
};

export type GroupKey = 'recycle_bin' | 'compost_bin' | 'garbage' | 'deposit_return' | 'depends' | 'no_stream';

export type Guidelines = {
  place: { id: string; name: string };
  system_summary: string;
  official_source: { title: string; url: string };
  groups: { key: GroupKey; rules: RuleView[] }[];
  /** Every rule whose stream, or one of whose cases, is special drop-off. Hazardous waste lives here. */
  special_drop_off: RuleView[];
};

export class UnknownPlace extends Error {}

const GROUP_ORDER: GroupKey[] = ['recycle_bin', 'compost_bin', 'garbage', 'deposit_return', 'depends', 'no_stream'];

function sourceView(source: PackSource): SourceView {
  return {
    kind: source.kind,
    title: source.title,
    url: source.url ?? null,
    publisher: source.publisher,
    date: sourceDate(source),
    field: isFieldSource(source),
  };
}

function ruleView(pack: Pack, rule: Rule): RuleView | null {
  const source = sourceOf(pack, rule.source);
  if (!source || source.kind === 'superseded' || source.kind === 'business_page') return null;
  const destination = sourceOf(pack, rule.destination_source);
  const destinationOk = destination && destination.kind !== 'superseded' && destination.kind !== 'business_page';
  return {
    rule_id: rule.id,
    applies_to: [...rule.applies_to],
    stream: rule.stream,
    conditions: rule.conditions ? rule.conditions.map((c) => ({ if: c.if, stream: c.stream })) : null,
    prep: [...rule.prep],
    where: rule.where ?? null,
    quote: rule.quote,
    destination_quote: destinationOk ? (rule.destination_quote ?? null) : null,
    destination_inferred: rule.destination_inferred === true,
    location_limited: rule.location_limited === true,
    source: sourceView(source),
    destination_source: destinationOk ? sourceView(destination) : null,
  };
}

export function buildGuidelines(pack: Pack): Guidelines {
  const views = pack.rules.map((rule) => ruleView(pack, rule)).filter((v): v is RuleView => v !== null);
  const groups = new Map<GroupKey, RuleView[]>();
  const special: RuleView[] = [];
  for (const view of views) {
    const hasSpecialCase = (view.conditions ?? []).some((c) => c.stream === 'drop_off_special');
    if (view.stream === 'drop_off_special') {
      special.push(view);
      continue;
    }
    if (hasSpecialCase) special.push(view);
    const key: GroupKey = view.stream ? (view.stream as GroupKey) : view.conditions ? 'depends' : 'no_stream';
    groups.set(key, [...(groups.get(key) ?? []), view]);
  }
  return {
    place: { id: pack.jurisdiction.id, name: pack.jurisdiction.name },
    system_summary: pack.jurisdiction.system_summary,
    official_source: { title: 'Official recycling information', url: pack.jurisdiction.official_contact_url },
    groups: GROUP_ORDER.filter((key) => groups.has(key)).map((key) => ({ key, rules: groups.get(key)! })),
    special_drop_off: special,
  };
}

export async function getGuidelines(rulesDir: string, place: string): Promise<Guidelines> {
  const pack = (await getPacks(rulesDir)).get(place);
  if (!pack) throw new UnknownPlace(place);
  return buildGuidelines(pack);
}
