// Recyclopedia screens (PRD 4; contracts 5 and 10): the landing with category cards, a material page per
// category, and search. Every entry opens the shared item page, which shows the engine's answer for the
// selected Place. Nothing here states a rule, a stream or a verdict for any entry (RC-5, RC-6).
import { getCatalog } from '../../shared/api.js';
import { clear, h } from '../../shared/dom.js';
import { icon } from '../../shared/icons.js';
import { askHref, entryHref, matchEntries, normalize, searchHref } from './search.js';

function entryList(entries) {
  return h(
    'ul',
    { class: 'link-list' },
    entries.map((entry) => h('li', {}, h('a', { class: 'list-item', href: entryHref(entry) }, entry.name))),
  );
}

function results(catalog, typed) {
  const text = normalize(typed);
  const matches = matchEntries(catalog.entries, text);
  return h(
    'section',
    { class: 'stack', 'aria-label': 'Search results', 'aria-live': 'polite' },
    matches.length ? entryList(matches) : h('p', {}, 'No Recyclopedia entry matches that. You can ask about it as typed.'),
    h('a', { class: 'button button-secondary button-block', href: askHref(text) }, icon('magnifying-glass'), `Ask about “${text}” as typed`),
  );
}

export function mount(route, container, ctx) {
  let alive = true;
  const isSearch = route.path === '/search';
  const categoryId = route.params.categoryId || null;
  ctx.setTitle('Recyclopedia');

  const input = h('input', {
    class: 'field',
    type: 'search',
    name: 'q',
    placeholder: 'Search',
    'aria-label': 'Search the Recyclopedia',
    autocomplete: 'off',
    maxlength: 200,
    value: isSearch ? route.query.q || '' : '',
  });
  const body = h('div', { class: 'stack-wide' });
  let catalog = null;
  let browse = () => h('div', {});

  const refresh = () => {
    if (!catalog) return;
    clear(body).appendChild(normalize(input.value) ? results(catalog, input.value) : browse());
  };

  const form = h(
    'form',
    {
      class: 'search-form',
      role: 'search',
      onsubmit: (event) => {
        event.preventDefault();
        const text = normalize(input.value);
        if (!text || !catalog) return;
        // Text that matches no entry goes straight to the engine as typed (RC-9).
        if (!matchEntries(catalog.entries, text).length) ctx.navigate(askHref(text));
        else if (!isSearch || normalize(route.query.q) !== text) ctx.navigate(searchHref(text));
      },
    },
    input,
    h('button', { type: 'submit', class: 'button search-button', 'aria-label': 'Search' }, icon('magnifying-glass')),
  );
  input.addEventListener('input', refresh);

  container.appendChild(h('div', { class: 'stack-wide' }, form, body));
  body.appendChild(h('div', { class: 'loading-block' }, h('div', { class: 'spinner', role: 'progressbar', 'aria-label': 'Loading' })));

  getCatalog()
    .then((data) => {
      if (!alive) return;
      catalog = data;
      const categories = [...data.categories].sort((a, b) => a.order - b.order);
      if (categoryId) {
        const category = categories.find((c) => c.id === categoryId);
        if (!category) {
          browse = () => h('div', { class: 'stack' }, h('p', { class: 'h3' }, 'That category is not in the Recyclopedia.'), h('a', { class: 'button', href: '/recyclopedia' }, 'All categories'));
        } else {
          ctx.setTitle(category.name);
          const entries = data.entries.filter((e) => e.category === category.id);
          browse = () => h('div', { class: 'stack' }, h('h1', { class: 'h1' }, category.name), entryList(entries));
        }
      } else if (isSearch) {
        browse = () => h('p', {}, 'Type a material or an item.');
      } else {
        browse = () =>
          h(
            'div',
            { class: 'stack' },
            h('h1', { class: 'h1' }, 'Recyclopedia'),
            h(
              'ul',
              { class: 'category-grid' },
              categories.map((c) => h('li', {}, h('a', { class: 'category-card', href: `/recyclopedia/${encodeURIComponent(c.id)}` }, c.name))),
            ),
          );
      }
      refresh();
    })
    .catch(() => {
      if (!alive) return;
      clear(body).appendChild(
        h('div', { class: 'stack' }, h('p', { class: 'h3' }, 'The Recyclopedia list could not be loaded.'), h('button', { type: 'button', class: 'button', onclick: () => location.reload() }, 'Try again')),
      );
    });

  return () => {
    alive = false;
  };
}
