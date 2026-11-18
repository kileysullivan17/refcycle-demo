// The app shell: header (back, title, Place picker), tab bar, and the router that loads each screen module.
// Screens get a ctx object (contracts 2.1) and render into <main>.
import { getJurisdictions, logDisplaySwap } from './api.js';
import { displayText, setSwapReporter } from './display-text.js';
import { clear, h } from './dom.js';
import { icon } from './icons.js';
import { memory } from './memory.js';
import { matchRoute, withoutParam } from './router.js';

const screen = document.getElementById('screen');
const titleEl = document.getElementById('app-title');
const placeSelect = document.getElementById('place-select');
const backButton = document.getElementById('back-button');
const tabBar = document.getElementById('tab-bar');
const store = memory();

let places = [];
let cleanup = null;
let placeListeners = new Set();
let renderToken = 0;

const currentPlace = () => {
  const id = store.getPlace();
  return id && places.some((p) => p.id === id) ? id : null;
};

setSwapReporter((swap) => logDisplaySwap({ ...swap, place: currentPlace() }));

function setTitle(text) {
  const shown = text && String(text).trim() ? String(text) : 'RefCycle';
  titleEl.textContent = shown;
  document.title = shown === 'RefCycle' ? 'RefCycle' : `${shown} | RefCycle`;
}

function navigate(path, { replace = false } = {}) {
  // depth counts the in-app steps behind this one, so Back never leaves the app by surprise.
  const depth = (history.state && history.state.depth) || 0;
  if (replace) history.replaceState({ depth }, '', path);
  else history.pushState({ depth: depth + 1 }, '', path);
  render();
}

function fillPlaceSelect() {
  clear(placeSelect);
  const chosen = currentPlace();
  if (!chosen) placeSelect.appendChild(h('option', { value: '', selected: true, disabled: true }, 'Choose a Place'));
  for (const place of places) placeSelect.appendChild(h('option', { value: place.id, selected: place.id === chosen }, place.name));
  placeSelect.value = chosen || '';
}

function choosePlace(id) {
  if (!places.some((p) => p.id === id)) return;
  store.setPlace(id);
  fillPlaceSelect();
  for (const listener of [...placeListeners]) {
    try {
      listener(id);
    } catch {
      /* one screen's listener never blocks the change */
    }
  }
}

function stopScreen() {
  if (typeof cleanup === 'function') {
    try {
      cleanup();
    } catch {
      /* ignore */
    }
  }
  cleanup = null;
  placeListeners = new Set();
}

function message(text, extra) {
  clear(screen).appendChild(h('div', { class: 'stack-wide' }, h('p', { class: 'h3' }, text), extra));
}

async function render() {
  const token = ++renderToken;
  stopScreen();

  // A shared link carries the Place as ?place=<id>. It becomes the stored Place, then leaves the address bar.
  const linked = new URLSearchParams(location.search).get('place');
  if (linked !== null) {
    if (places.some((p) => p.id === linked)) store.setPlace(linked);
    history.replaceState(history.state, '', withoutParam(location.pathname, location.search, 'place') + location.hash);
  }

  const match = matchRoute(location.pathname, location.search);
  const place = currentPlace();
  fillPlaceSelect();
  setTitle('RefCycle');
  tabBar.hidden = !place;
  for (const tab of tabBar.querySelectorAll('[data-tab]')) {
    if (match && match.tab === tab.dataset.tab) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  }
  backButton.classList.toggle('is-off', !place || !match || match.name === 'home' || match.name === 'root');

  if (!match) {
    message('This page does not exist.', h('a', { class: 'button', href: '/' }, 'Go to the start'));
    return;
  }
  if (place && match.name === 'root') {
    navigate('/home', { replace: true });
    return;
  }

  const ctx = {
    place,
    places,
    displayText,
    navigate,
    setTitle,
    onPlaceChange(callback) {
      placeListeners.add(callback);
      return () => placeListeners.delete(callback);
    },
  };

  // No Place yet: every route shows the first-use screen (intro and Place picker). After the choice the
  // visitor carries on to where they were going; from "/" that is Home.
  const firstUse = !place && match.name !== 'place';
  const modulePath = firstUse ? '/shared/intro.js' : match.module;
  clear(screen);
  screen.setAttribute('aria-busy', 'true');
  try {
    const mod = await import(modulePath);
    if (token !== renderToken) return;
    const result = await mod.mount(match.route, screen, { ...ctx, choosePlace, firstUse });
    if (token !== renderToken) {
      if (typeof result === 'function') result();
      return;
    }
    cleanup = typeof result === 'function' ? result : null;
  } catch (error) {
    if (token !== renderToken) return;
    console.error(error);
    message('This part of RefCycle is not available yet');
  } finally {
    if (token === renderToken) screen.removeAttribute('aria-busy');
  }
  if (token === renderToken) {
    window.scrollTo(0, 0);
    screen.focus({ preventScroll: true });
  }
}

// Same-origin links navigate inside the app; outside links and new-tab links are left to the browser.
document.addEventListener('click', (event) => {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
  if (!link || link.target === '_blank' || link.hasAttribute('download')) return;
  const url = new URL(link.href, location.href);
  if (url.origin !== location.origin) return;
  event.preventDefault();
  navigate(url.pathname + url.search);
});

window.addEventListener('popstate', () => render());

placeSelect.addEventListener('change', () => {
  const id = placeSelect.value;
  if (!id) return;
  const firstChoice = !currentPlace();
  choosePlace(id);
  // Changing the Place asks again for whatever is on screen (X-9).
  if (firstChoice && location.pathname === '/') navigate('/home', { replace: true });
  else render();
});

backButton.appendChild(icon('arrow-long-left'));
backButton.addEventListener('click', () => {
  if (history.state && history.state.depth > 0) history.back();
  else navigate('/home', { replace: true });
});

async function start() {
  screen.appendChild(h('div', { class: 'loading-block' }, h('div', { class: 'spinner', role: 'progressbar', 'aria-label': 'Loading' })));
  try {
    const list = await getJurisdictions();
    if (!Array.isArray(list) || !list.length) throw new Error('No places');
    // The Place list comes from the engine, never from a hardcoded list (contracts 1). Names go through displayText.
    places = list
      .filter((p) => p && typeof p.id === 'string' && typeof p.name === 'string')
      .map((p) => ({ id: p.id, name: displayText(p.name, 'shell.place-name') }));
  } catch {
    message('RefCycle cannot reach its rules engine right now.', h('button', { type: 'button', class: 'button', onclick: () => location.reload() }, 'Try again'));
    return;
  }
  render();
}

start();
