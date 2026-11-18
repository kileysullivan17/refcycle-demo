// Home (PRD addendum): the first screen after choosing a Place. It routes to the five parts of the app and
// lists this device's recent items. It holds no content of its own: no Handbook, news or tip of the day.
import { h } from './dom.js';
import { icon } from './icons.js';
import { memory, recentHref } from './memory.js';
import { forgetControl } from './place.js';

const TILES = [
  { href: '/recyclopedia', label: 'Recyclopedia', icon: 'book-open' },
  { href: '/scan', label: 'Camera scan', icon: 'camera' },
  { href: '/locations', label: 'Locations', icon: 'map-pin' },
  { href: '/guidelines', label: 'Place guidelines', icon: 'information-circle' },
  { href: '/another-life', label: 'Give it another life', icon: 'heart', wide: true },
];

export function mount(route, container, ctx) {
  ctx.setTitle('Home');
  const placeName = ctx.places.find((p) => p.id === ctx.place)?.name ?? '';
  const recent = memory().getRecent(ctx.place);
  container.appendChild(
    h(
      'div',
      { class: 'stack-wide' },
      h('h1', { class: 'h1' }, 'RefCycle'),
      h('p', { class: 'subhead' }, `Your Place: ${placeName}`),
      h(
        'div',
        { class: 'home-grid' },
        TILES.map((tile) => h('a', { class: tile.wide ? 'home-tile home-tile-wide' : 'home-tile', href: tile.href }, icon(tile.icon), h('span', {}, tile.label))),
      ),
      recent.length
        ? h(
            'section',
            { class: 'stack', 'aria-label': 'Recent items' },
            h('h2', { class: 'section-title' }, 'Recent items'),
            h(
              'ul',
              { class: 'link-list' },
              recent.map((item) => h('li', {}, h('a', { class: 'list-item', href: recentHref(item) }, h('span', {}, item.label), icon('chevron-right')))),
            ),
          )
        : null,
      forgetControl(ctx),
    ),
  );
}
