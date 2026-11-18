// Give it another life (PRD addendum, screen 5): outside reuse and repair links for the selected Place.
// These are links to other organizations' pages, clearly labeled as outside resources. They are not rules,
// they are not part of any answer, and RefCycle gives no upcycling ideas or instructions of its own.
import { getReuseLinks } from '../../shared/api.js';
import { clear, h, isWebUrl, outLink } from '../../shared/dom.js';
import { icon } from '../../shared/icons.js';

function linkCard(link) {
  return h(
    'li',
    { class: 'reuse-card', 'data-link': link.id },
    h('span', { class: 'reuse-tag' }, link.scope === 'everywhere' ? 'Outside resource, any Place' : 'Outside resource'),
    h('h2', { class: 'reuse-title' }, outLink(link.url, [link.title, ' ', icon('arrow-top-right-on-square')])),
    h('p', { class: 'subhead' }, link.publisher),
    h('p', {}, link.description),
    h('p', { class: 'footnote' }, `Link checked ${link.checked}. Opens in a new tab.`),
  );
}

export function mount(route, container, ctx) {
  let alive = true;
  ctx.setTitle('Give it another life');
  container.appendChild(h('div', { class: 'loading-block' }, h('div', { class: 'spinner', role: 'progressbar', 'aria-label': 'Loading' })));
  const placeName = ctx.places.find((p) => p.id === ctx.place)?.name ?? '';

  getReuseLinks(ctx.place)
    .then((data) => {
      if (!alive) return;
      const links = (data.links || []).filter((link) => isWebUrl(link.url));
      clear(container).appendChild(
        h(
          'div',
          { class: 'stack-wide' },
          h('h1', { class: 'h1' }, 'Give it another life'),
          h(
            'div',
            { class: 'notice stack' },
            h('p', {}, `Places to reuse, pass on or repair things, for ${placeName}.`),
            h('p', {}, 'These are outside resources run by other organizations. RefCycle does not run or check them, and they are not local rules. They never change an answer RefCycle shows.'),
          ),
          links.length ? h('ul', { class: 'reuse-list' }, links.map(linkCard)) : h('p', {}, 'No outside links are listed for this Place.'),
        ),
      );
    })
    .catch(() => {
      if (!alive) return;
      clear(container).appendChild(h('div', { class: 'stack' }, h('p', { class: 'h3' }, 'The links could not be loaded.'), h('button', { type: 'button', class: 'button', onclick: () => location.reload() }, 'Try again')));
    });

  return () => {
    alive = false;
  };
}
