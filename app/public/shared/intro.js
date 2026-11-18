// First use: one short intro with the Place picker under it (PRD addendum, screens 1 and 2).
// No splash sequence, no device location, no permission prompt. Shown on any route until a Place is chosen.
import { h } from './dom.js';

export const ORIGIN_LINE =
  'RefCycle began as a student concept by a five-person team in the Berkeley UX/UI Boot Camp, UC Berkeley Extension, January 2024. This rebuild and evaluation are solo work.';

export function placeButtons(ctx, onChosen, current) {
  return h(
    'div',
    { class: 'place-buttons' },
    ctx.places.map((place) =>
      h(
        'button',
        {
          type: 'button',
          class: place.id === current ? 'button button-block' : 'button button-secondary button-block',
          'aria-pressed': current ? String(place.id === current) : null,
          onclick: () => onChosen(place.id),
        },
        place.name,
      ),
    ),
  );
}

export function mount(route, container, ctx) {
  ctx.setTitle('RefCycle');
  const names = ctx.places.map((p) => p.name).join('; ');
  const count = ctx.places.length === 3 ? 'three' : String(ctx.places.length);
  container.appendChild(
    h(
      'div',
      { class: 'stack-wide' },
      h('h1', { class: 'h1' }, 'Welcome to RefCycle'),
      h(
        'div',
        { class: 'notice stack' },
        h('p', {}, `This is a portfolio demo. It covers ${count} Places only: ${names}.`),
        h('p', {}, 'Its rules are not kept up to date. Check the official source before you act on an answer.'),
      ),
      h('h2', { class: 'h2' }, 'Choose your Place'),
      h('p', { class: 'subhead' }, 'RefCycle does not use your location. Your choice is remembered in this browser only.'),
      placeButtons(ctx, (id) => {
        ctx.choosePlace(id);
        const here = location.pathname + location.search;
        ctx.navigate(route.path === '/' ? '/home' : here, { replace: true });
      }),
      h('p', { class: 'footnote' }, ORIGIN_LINE),
    ),
  );
}
