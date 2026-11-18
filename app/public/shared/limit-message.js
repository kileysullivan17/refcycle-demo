// The one plain message shown when the demo's daily spending cap or the per-visitor limit is reached
// (PRD addendum). No answer of any kind is shown with it, and the parts that need no model call are linked.
import { h } from './dom.js';

export function limitBlock(message) {
  return h(
    'div',
    { class: 'notice stack', 'data-state': 'limit', role: 'status' },
    h('h2', { class: 'section-title' }, 'Demo limit reached'),
    h('p', {}, message),
    h(
      'ul',
      { class: 'bullets' },
      h('li', {}, h('a', { href: '/recyclopedia' }, 'Browse the Recyclopedia list')),
      h('li', {}, h('a', { href: '/guidelines' }, 'Read the Place guidelines')),
      h('li', {}, h('a', { href: '/locations' }, 'See Locations')),
      h('li', {}, h('a', { href: '/another-life' }, 'Give it another life')),
    ),
  );
}
