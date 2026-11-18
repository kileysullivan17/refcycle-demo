// Tiny DOM helper. Text always goes in as text nodes, never as markup, so nothing from the engine, a pack,
// the facility list or a visitor can inject HTML.

/**
 * h('a', { class: 'button', href: '/home', onclick: fn }, 'Home')
 * Attribute values of false, null or undefined are skipped; true sets an empty attribute.
 */
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === false || value === null || value === undefined) continue;
    if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
    else if (key === 'class') el.className = value;
    else if (key === 'value') el.value = value;
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child === false || child === null || child === undefined) continue;
    el.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

/** An outside link: opens in a new tab and passes nothing back to the page it leaves. */
export function outLink(url, text, attrs = {}) {
  return h('a', { href: url, target: '_blank', rel: 'noopener noreferrer', class: 'link-out', ...attrs }, text);
}

/** Only http and https links are ever rendered as links. */
export function isWebUrl(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}
