// /place: the Place picker on its own, and the control that forgets what this browser remembers.
import { h } from './dom.js';
import { placeButtons } from './intro.js';
import { memory } from './memory.js';

/** The forget control, shared with Home. Clears the Place and the recent items, then returns to the start. */
export function forgetControl(ctx) {
  return h(
    'div',
    { class: 'notice stack' },
    h('h2', { class: 'section-title' }, 'Remembered on this device'),
    h('p', { class: 'subhead' }, 'This browser remembers your Place and your recent items. Nothing is stored on a server, and there are no accounts.'),
    h(
      'button',
      {
        type: 'button',
        class: 'button button-secondary',
        onclick: () => {
          memory().forget();
          ctx.navigate('/', { replace: true });
        },
      },
      'Forget my Place and recent items',
    ),
  );
}

export function mount(route, container, ctx) {
  ctx.setTitle('Place');
  container.appendChild(
    h(
      'div',
      { class: 'stack-wide' },
      h('h1', { class: 'h1' }, 'Choose a Place'),
      h('p', { class: 'subhead' }, 'RefCycle does not use your location.'),
      placeButtons(
        ctx,
        (id) => {
          ctx.choosePlace(id);
          ctx.navigate('/home');
        },
        ctx.place,
      ),
      ctx.place ? forgetControl(ctx) : null,
    ),
  );
}
