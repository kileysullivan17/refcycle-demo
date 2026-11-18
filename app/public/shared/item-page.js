// The one item page, shared by Recyclopedia and Camera scan (contracts 8; CON-1).
// It asks the engine and shows exactly what the engine returned: the state, title, prep, explanation,
// the cited rules' "where" text and the source links. It adds no recycling guidance of its own, keeps no
// answer, and never turns an abstention or a question into a verdict (X-3 to X-7).
import { ask, getCatalog, getSites } from './api.js';
import { clear, h, isWebUrl, outLink } from './dom.js';
import { icon } from './icons.js';
import { clarifyQuery, disposeHref, isAnswer, itemState, itemTitle, showDispose, STREAM_LABELS } from './item-model.js';
import { limitBlock } from './limit-message.js';
import { memory } from './memory.js';
import { buildShareUrl, shareLink } from './share.js';

const CARD_ICONS = { 'card-blue': 'flag', 'card-yellow': 'trash', 'card-red': 'exclamation-triangle' };

function refereeCheck(...children) {
  return h('div', { class: 'referee-check' }, h('div', { class: 'referee-check-tag' }, icon('question-mark-circle'), 'Referee check'), children);
}

/** Share and the reuse link sit below the engine's answer and never change it. */
function extras(ctx, shareTarget, title) {
  const status = h('p', { class: 'status-line', role: 'status' });
  const shown = h('div', {});
  const url = buildShareUrl(location.origin, { place: ctx.place, ...shareTarget });
  const button = h(
    'button',
    {
      type: 'button',
      class: 'button button-secondary',
      onclick: async () => {
        const outcome = await shareLink(url, `${title} | RefCycle`);
        if (outcome === 'copied') status.textContent = 'Link copied.';
        else if (outcome === 'shown') {
          status.textContent = 'Copy this link:';
          clear(shown).appendChild(h('input', { class: 'share-url', type: 'text', readonly: true, value: url, 'aria-label': 'Link to this item' }));
        } else status.textContent = '';
      },
    },
    icon('share'),
    'Share',
  );
  return h(
    'div',
    { class: 'item-extras' },
    h('div', { class: 'row' }, button),
    status,
    shown,
    h('a', { class: 'small-link', href: '/another-life' }, 'Give it another life: outside reuse and repair links'),
  );
}

export function mount(route, container, ctx) {
  let alive = true;
  run(route, container, ctx, () => alive);
  return () => {
    alive = false;
  };
}

async function run(route, container, ctx, isAlive) {
  const origin = route.query.origin === 'scan' ? 'scan' : route.query.entry ? 'catalog' : 'search';
  const entryId = typeof route.query.entry === 'string' && route.query.entry ? route.query.entry : null;
  let query = typeof route.query.q === 'string' ? route.query.q.trim().slice(0, 2000) : '';
  let entryName = null;

  const fail = (text) => {
    clear(container).appendChild(
      h('div', { class: 'stack-wide', 'data-state': 'error' }, h('h1', { class: 'h2' }, text), h('a', { class: 'button', href: '/recyclopedia' }, 'Open the Recyclopedia')),
    );
  };

  if (entryId) {
    try {
      const catalog = await getCatalog();
      if (!isAlive()) return;
      const entry = (catalog.entries || []).find((e) => e.id === entryId);
      if (!entry) return fail('That entry is not in the Recyclopedia.');
      query = entry.query;
      entryName = entry.name;
    } catch {
      if (!isAlive()) return;
      return fail('The Recyclopedia list could not be loaded.');
    }
  }
  if (!isAlive()) return;
  if (!query) return fail('There is no item to look up.');

  const shareTarget = entryId ? { entryId } : { query };

  async function load() {
    ctx.setTitle(entryName || query);
    clear(container).appendChild(
      h(
        'div',
        { class: 'loading-block', 'data-state': 'loading', 'aria-busy': 'true' },
        h('p', { class: 'h3' }, query),
        h('div', { class: 'spinner', role: 'progressbar', 'aria-label': 'Asking the rules engine' }),
        h('p', { class: 'subhead' }, 'Checking the local rules. This can take a minute.'),
      ),
    );
    const result = await ask(ctx.place, query);
    if (!isAlive()) return;
    if (result.kind === 'limit') {
      clear(container).appendChild(h('div', { class: 'stack-wide' }, h('h1', { class: 'h2' }, entryName || query), limitBlock(result.message)));
      return;
    }
    if (result.kind !== 'answer' || !isAnswer(result.answer)) {
      clear(container).appendChild(
        h(
          'div',
          { class: 'stack-wide', 'data-state': 'error' },
          h('h1', { class: 'h2' }, 'No answer available right now'),
          h('p', {}, 'RefCycle could not get an answer for this item, so it is not showing one.'),
          h('button', { type: 'button', class: 'button', onclick: load }, icon('arrow-path'), 'Retry'),
        ),
      );
      return;
    }
    show(result.answer);
  }

  function show(answer) {
    const text = (value, field) => ctx.displayText(value, `item.${field}`);
    const state = itemState(answer);
    const title = text(itemTitle(answer, query), 'title');
    ctx.setTitle(title);
    memory().addRecent(entryId ? { place: ctx.place, entry: entryId, label: entryName } : { place: ctx.place, q: query, label: query });

    let verdict;
    if (state.startsWith('card-')) {
      verdict = h('div', { class: `verdict ${state}`, 'data-state': state }, icon(CARD_ICONS[state]), h('span', {}, STREAM_LABELS[answer.stream]));
    } else if (state === 'referee-check-clarify') {
      const input = h('input', { class: 'field', id: 'clarify-reply', type: 'text', maxlength: 500, autocomplete: 'off', required: true });
      verdict = refereeCheck(
        h('h2', { class: 'h3' }, 'One question first'),
        h('p', {}, text(answer.clarifying_question, 'clarifying_question')),
        h(
          'form',
          {
            class: 'stack',
            onsubmit: (event) => {
              event.preventDefault();
              const reply = input.value.trim();
              if (!reply) return;
              ctx.navigate(`/item?q=${encodeURIComponent(clarifyQuery(query, reply))}&origin=${origin === 'scan' ? 'scan' : 'search'}`);
            },
          },
          h('label', { class: 'field-label', for: 'clarify-reply' }, 'Your reply'),
          input,
          h('button', { type: 'submit', class: 'button' }, 'Send'),
        ),
      );
      verdict.setAttribute('data-state', state);
    } else if (state === 'referee-check-conditional') {
      verdict = refereeCheck(
        h('h2', { class: 'h3' }, 'It depends'),
        h(
          'ul',
          { class: 'case-list' },
          answer.conditions.map((c) =>
            h('li', { class: 'case' }, h('div', {}, text(c.if, 'conditions.if')), h('div', { class: 'case-stream' }, STREAM_LABELS[c.stream])),
          ),
        ),
      );
      verdict.setAttribute('data-state', state);
    } else {
      verdict = refereeCheck(h('h2', { class: 'h3' }, 'We don’t know'), h('p', {}, 'RefCycle has no verified answer for this item in this Place. Check the official source.'));
      verdict.setAttribute('data-state', state);
    }

    const whereBox = h('section', { class: 'stack', hidden: true });
    const links = answer.source_urls.filter(isWebUrl);
    const page = h(
      'article',
      { class: 'stack-wide' },
      h('h1', { class: 'h1' }, title),
      verdict,
      showDispose(answer) ? h('a', { class: 'button button-block', href: disposeHref(query, answer.rule_ids) }, icon('map-pin'), 'Dispose') : null,
      answer.prep.length
        ? h('section', { class: 'stack' }, h('h2', { class: 'section-title' }, 'How to prepare it'), h('ul', { class: 'bullets' }, answer.prep.map((p) => h('li', {}, text(p, 'prep')))))
        : null,
      h('section', { class: 'stack' }, h('h2', { class: 'section-title' }, 'What the local rules say'), h('p', { class: 'pre-line callout' }, text(answer.explanation, 'explanation'))),
      whereBox,
      links.length
        ? h(
            'section',
            { class: 'stack' },
            h('h2', { class: 'section-title' }, state === 'referee-check-abstain' ? 'Official source' : 'Sources'),
            h('ul', { class: 'stack' }, links.map((url) => h('li', {}, outLink(url, url)))),
          )
        : null,
      extras(ctx, shareTarget, title),
    );
    clear(container).appendChild(page);

    // The "where" text of the cited rules, read from the pack by the locator's route (G5). Hidden if that
    // route is missing or fails.
    if (answer.rule_ids.length) {
      getSites(ctx.place, { ruleIds: answer.rule_ids })
        .then((data) => {
          if (!isAlive()) return;
          const wheres = (data.rules || []).filter((r) => typeof r.where === 'string' && r.where.trim());
          if (!wheres.length) return;
          whereBox.appendChild(h('h2', { class: 'section-title' }, 'Where the rules point'));
          whereBox.appendChild(h('ul', { class: 'bullets' }, wheres.map((r) => h('li', {}, text(r.where, 'where')))));
          whereBox.hidden = false;
        })
        .catch(() => {});
    }
  }

  await load();
}
