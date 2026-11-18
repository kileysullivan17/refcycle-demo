// Place guidelines (PRD addendum, screen 4): a read-only view of the selected Place's rules pack.
// It shows the pack's system summary, its rules grouped by stream with each rule's quote and source, a
// hazardous waste and special drop-off section, and a link to the official contact page. Every word of a
// rule comes from the pack. No collection days are shown, because the packs state none as schedules.
// This screen does not answer questions about an item; the item page and the engine do that.
import { getGuidelines } from '../../shared/api.js';
import { clear, h, isWebUrl, outLink } from '../../shared/dom.js';
import { STREAM_LABELS } from '../../shared/item-model.js';

const GROUP_TITLES = {
  recycle_bin: STREAM_LABELS.recycle_bin,
  compost_bin: STREAM_LABELS.compost_bin,
  garbage: STREAM_LABELS.garbage,
  deposit_return: STREAM_LABELS.deposit_return,
  depends: 'Depends on the item',
  no_stream: 'About the local service',
};

const SOURCE_KINDS = { official_page: 'Official page', field_observation: 'Field observation', field_report: 'Field report' };

function sourceBlock(source, ctx, label) {
  const text = (value) => ctx.displayText(value, 'guidelines.source');
  const title = text(source.title);
  const parts = [SOURCE_KINDS[source.kind] || 'Source', text(source.publisher), source.date ? `dated ${source.date}` : null].filter(Boolean).join(', ');
  return h(
    'p',
    { class: 'footnote' },
    `${label}: `,
    source.url && isWebUrl(source.url) ? outLink(source.url, title) : title,
    ` (${parts}${source.field ? '; not a published page' : ''})`,
  );
}

function ruleCard(rule, ctx) {
  const text = (value, field) => ctx.displayText(value, `guidelines.${field}`);
  return h(
    'li',
    { class: 'rule-card', 'data-rule': rule.rule_id },
    h('h3', { class: 'rule-title' }, text(rule.applies_to.join('; '), 'applies_to')),
    h('p', { class: 'caption' }, rule.rule_id),
    rule.stream ? h('p', { class: 'rule-stream' }, STREAM_LABELS[rule.stream]) : null,
    rule.conditions
      ? h(
          'ul',
          { class: 'case-list' },
          rule.conditions.map((c) => h('li', { class: 'case' }, h('div', {}, text(c.if, 'conditions.if')), h('div', { class: 'case-stream' }, STREAM_LABELS[c.stream] ?? c.stream))),
        )
      : null,
    rule.prep.length ? h('div', { class: 'stack' }, h('p', { class: 'rule-label' }, 'Prep'), h('ul', { class: 'bullets' }, rule.prep.map((p) => h('li', {}, text(p, 'prep'))))) : null,
    rule.where ? h('p', {}, h('span', { class: 'rule-label' }, 'Where: '), text(rule.where, 'where')) : null,
    rule.location_limited ? h('p', { class: 'rule-label' }, 'Only one place takes this.') : null,
    // The engine's own wording for an inferred destination, so this screen says no more than an answer would.
    rule.destination_inferred ? h('p', { class: 'footnote' }, 'The destination is the pack author’s inference, not an explicit disposal instruction in the source.') : null,
    // Quotes are shown exactly as the pack holds them, with no text swap (contracts 9).
    h('blockquote', { class: 'rule-quote' }, `“${rule.quote}”`),
    sourceBlock(rule.source, ctx, 'Source'),
    rule.destination_quote ? h('blockquote', { class: 'rule-quote' }, `“${rule.destination_quote}”`) : null,
    rule.destination_source ? sourceBlock(rule.destination_source, ctx, 'Destination source') : null,
  );
}

function ruleSection(id, title, rules, ctx, note) {
  return h(
    'section',
    { class: 'stack', id, 'data-group': id },
    h('h2', { class: 'h2' }, title),
    note ? h('p', { class: 'subhead' }, note) : null,
    h('ul', { class: 'rule-list' }, rules.map((rule) => ruleCard(rule, ctx))),
  );
}

export function mount(route, container, ctx) {
  let alive = true;
  ctx.setTitle('Place guidelines');
  container.appendChild(h('div', { class: 'loading-block' }, h('div', { class: 'spinner', role: 'progressbar', 'aria-label': 'Loading' })));

  getGuidelines(ctx.place)
    .then((data) => {
      if (!alive) return;
      const placeName = ctx.displayText(data.place.name, 'guidelines.place');
      const official = isWebUrl(data.official_source.url) ? outLink(data.official_source.url, 'Official contact page') : null;
      const sections = [];
      for (const group of data.groups) sections.push(ruleSection(`group-${group.key}`, GROUP_TITLES[group.key] ?? group.key, group.rules, ctx));
      if (data.special_drop_off.length) {
        sections.push(
          ruleSection(
            'hazardous-waste',
            'Hazardous waste and special drop-off',
            data.special_drop_off,
            ctx,
            'Every rule in this Place’s pack that sends something to a special drop-off, as written. The pack does not mark which of these are hazardous.',
          ),
        );
      }
      clear(container).appendChild(
        h(
          'article',
          { class: 'stack-wide' },
          h('h1', { class: 'h1' }, `Guidelines for ${placeName}`),
          h(
            'div',
            { class: 'notice stack' },
            h('p', {}, 'This is the rules pack RefCycle reads for this Place, shown as written. It is a demo and is not kept up to date.'),
            official,
          ),
          h('section', { class: 'stack' }, h('h2', { class: 'h2' }, 'How the local system works'), h('p', { class: 'pre-line' }, ctx.displayText(data.system_summary, 'guidelines.system_summary'))),
          h(
            'div',
            { class: 'stack', role: 'group', 'aria-label': 'Sections' },
            h(
              'ul',
              { class: 'link-list' },
              sections.map((section) => h('li', {}, h('a', { class: 'list-item', href: `#${section.id}`, onclick: (event) => jump(event, section) }, section.querySelector('h2').textContent))),
            ),
          ),
          sections,
          official ? h('p', {}, outLink(data.official_source.url, 'Official contact page')) : null,
        ),
      );
    })
    .catch(() => {
      if (!alive) return;
      clear(container).appendChild(h('div', { class: 'stack' }, h('p', { class: 'h3' }, 'The guidelines could not be loaded.'), h('button', { type: 'button', class: 'button', onclick: () => location.reload() }, 'Try again')));
    });

  function jump(event, section) {
    // In-page jump, handled here so the app's router does not treat it as a new screen.
    event.preventDefault();
    section.scrollIntoView({ block: 'start' });
    section.querySelector('h2').setAttribute('tabindex', '-1');
    section.querySelector('h2').focus({ preventScroll: true });
  }

  return () => {
    alive = false;
  };
}
