// Recycling center locator screens (PRD 6; contracts 6, 7 and 10).
//   /locations?view=list|map[&item=][&rule_ids=][&material=]   list and map of the same sites
//   /locations/:facilityId                                       one site's detail
// Opened for an item, it shows only the sites linked to the rules the engine cited (LOC-4). It uses no
// device location, no distances and no geocoder, and shows only fields the facility list and pack provide.
import { getSites } from '../../shared/api.js';
import { clear, h, isWebUrl, outLink } from '../../shared/dom.js';
import { icon } from '../../shared/icons.js';
import { acceptedItems, eventState, fieldNote, groupByRule, KIND_TAGS, localToday, locationsHref, materialsOf, parseRuleIds, rulesOfSite } from './logic.js';

const OSM_TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const OSM_COPYRIGHT = 'https://www.openstreetmap.org/copyright';
const LEAFLET_SRC = '/shared/vendor/leaflet/leaflet.js';

let leafletPromise = null;

/** The bundled map library, loaded only when a map is opened. */
function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (!leafletPromise) {
    leafletPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = LEAFLET_SRC;
      script.onload = () => {
        window.L.Icon.Default.imagePath = '/shared/vendor/leaflet/images/';
        resolve(window.L);
      };
      script.onerror = () => {
        leafletPromise = null;
        reject(new Error('Map library failed to load'));
      };
      document.head.appendChild(script);
    });
  }
  return leafletPromise;
}

function sourceLine(site) {
  if (site.source_url && isWebUrl(site.source_url)) return outLink(site.source_url, 'Source');
  if (site.source_label) return h('span', {}, `Source: ${site.source_label}`);
  return null;
}

function officialSource(data) {
  return data.official_source && isWebUrl(data.official_source.url) ? outLink(data.official_source.url, data.official_source.title) : null;
}

/** The facts shown for one site, on a card and on the detail page. Only what the data provides (LOC-10). */
function siteFacts(site, rules, ctx, today) {
  const text = (value, field) => ctx.displayText(value, `locator.${field}`);
  const state = eventState(site, today);
  const notes = [...new Set(rulesOfSite(site, rules).map(fieldNote).filter(Boolean))];
  const facts = [];
  if (site.only_site) facts.push(h('p', { class: 'site-only' }, 'This is the only place that takes this item.'));
  if (state === 'past') {
    facts.push(h('p', {}, 'Check the source for the next event.'));
  } else {
    if (site.address) facts.push(h('p', {}, text(site.address, 'address')));
    if (site.notes) facts.push(h('p', {}, text(site.notes, 'notes')));
  }
  for (const note of notes) facts.push(h('p', { class: 'footnote' }, note));
  const meta = [];
  if (state !== 'past' && site.date_checked) meta.push(h('span', {}, `checked ${site.date_checked}`));
  const source = sourceLine(site);
  if (source) meta.push(source);
  if (meta.length) facts.push(h('p', { class: 'row footnote' }, meta));
  return facts;
}

function siteCard(site, rules, ctx, today, context) {
  const state = eventState(site, today);
  const tag = site.kind === 'event' ? (state === 'past' ? null : 'Tentative') : KIND_TAGS[site.kind];
  return h(
    'li',
    { class: 'site-card', 'data-facility': site.facility_id },
    h(
      'div',
      { class: 'site-head' },
      h('a', { class: 'site-name', href: locationsHref({ facilityId: site.facility_id, item: context.item, ruleIds: context.ruleIds }) }, ctx.displayText(site.name, 'locator.name')),
      tag ? h('span', { class: 'site-tag' }, tag) : null,
    ),
    siteFacts(site, rules, ctx, today),
  );
}

function mountLocations(route, container, ctx) {
  let alive = true;
  let map = null;
  ctx.setTitle('Locations');
  const view = route.query.view === 'map' ? 'map' : 'list';
  const item = typeof route.query.item === 'string' ? route.query.item.trim() : '';
  const ruleIds = parseRuleIds(route.query.rule_ids);
  const forItem = 'rule_ids' in route.query;
  const material = typeof route.query.material === 'string' ? route.query.material : '';
  const context = { item, ruleIds: forItem ? ruleIds : null };
  const href = (changes) => locationsHref({ view, item, ruleIds: context.ruleIds, material, ...changes });
  const today = localToday();

  const filter = h('select', { class: 'field', id: 'material-filter' }, h('option', { value: '' }, 'All materials'));
  filter.addEventListener('change', () => ctx.navigate(href({ material: filter.value })));
  const body = h('div', { class: 'stack-wide' });

  container.appendChild(
    h(
      'div',
      { class: 'stack-wide' },
      h('h1', { class: 'h1' }, forItem && item ? `Where to take: ${item}` : 'Locations'),
      h(
        'div',
        { class: 'view-switch', role: 'group', 'aria-label': 'View' },
        h('a', { class: view === 'list' ? 'button' : 'button button-secondary', href: href({ view: 'list' }), role: 'button', 'aria-pressed': String(view === 'list') }, icon('list-bullet'), 'List'),
        h('a', { class: view === 'map' ? 'button' : 'button button-secondary', href: href({ view: 'map' }), role: 'button', 'aria-pressed': String(view === 'map') }, icon('map'), 'Map'),
      ),
      h('div', { class: 'stack' }, h('label', { class: 'field-label', for: 'material-filter' }, 'Filter by material accepted'), filter),
      body,
    ),
  );
  body.appendChild(h('div', { class: 'loading-block' }, h('div', { class: 'spinner', role: 'progressbar', 'aria-label': 'Loading' })));

  const wanted = { ruleIds: forItem ? ruleIds : undefined };
  // The unfiltered call supplies the filter values; the filtered one is what is shown.
  const all = material ? getSites(ctx.place, wanted) : null;
  const shown = getSites(ctx.place, { ...wanted, material: material || undefined });

  Promise.all([shown, all ?? shown])
    .then(([data, unfiltered]) => {
      if (!alive) return;
      for (const value of materialsOf(unfiltered.sites || [])) filter.appendChild(h('option', { value, selected: value === material }, ctx.displayText(value, 'locator.material')));
      filter.value = material;
      clear(body);
      const sites = data.sites || [];
      const rules = data.rules || [];
      if (view === 'map') showMap(sites, rules);
      else showList(data, sites, rules);
    })
    .catch(() => {
      if (!alive) return;
      clear(body).appendChild(h('div', { class: 'stack' }, h('p', { class: 'h3' }, 'Locations could not be loaded.'), h('button', { type: 'button', class: 'button', onclick: () => location.reload() }, 'Try again')));
    });

  function nonePlaced(data) {
    // The pack names no place for this item: say so and link the official source (LOC-11).
    return h('div', { class: 'notice stack' }, h('p', {}, 'The rules pack does not name a place for this item.'), officialSource(data));
  }

  function showList(data, sites, rules) {
    if (!forItem) {
      if (!sites.length) {
        body.appendChild(h('p', {}, material ? 'No listed location accepts that material.' : 'No locations are listed for this Place.'));
        return;
      }
      body.appendChild(h('ul', { class: 'site-list' }, sites.map((site) => siteCard(site, rules, ctx, today, context))));
      return;
    }
    const groups = groupByRule(rules, sites);
    const anything = groups.some((g) => g.sites.length || (g.rule.where && g.rule.where.trim()));
    if (!anything) {
      body.appendChild(material && rules.length ? h('p', {}, 'No listed location for this item accepts that material.') : nonePlaced(data));
      return;
    }
    for (const group of groups) {
      const rule = group.rule;
      body.appendChild(
        h(
          'section',
          { class: 'rule-group stack', 'data-rule': rule.rule_id },
          h('h2', { class: 'section-title' }, `${rule.rule_id}: ${ctx.displayText(rule.applies_to.join('; '), 'locator.applies_to')}`),
          rule.where ? h('p', {}, ctx.displayText(rule.where, 'locator.where')) : null,
          rule.location_limited ? h('p', { class: 'site-only' }, 'Only one place takes this item.') : null,
          group.sites.length
            ? h('ul', { class: 'site-list' }, group.sites.map((site) => siteCard(site, rules, ctx, today, context)))
            : rule.where
              ? null
              : h('p', { class: 'subhead' }, 'The rules pack does not name a place for this case.'),
        ),
      );
    }
    const official = officialSource(data);
    if (official) body.appendChild(h('p', { class: 'footnote' }, official));
  }

  function showMap(sites, rules) {
    const pinned = sites.filter((site) => site.pin);
    if (!pinned.length) {
      // Contracts 7.4.
      body.appendChild(h('div', { class: 'notice stack' }, h('p', {}, 'No mapped locations yet; see the list'), h('a', { class: 'button', href: href({ view: 'list' }) }, 'List')));
      return;
    }
    const mapEl = h('div', { class: 'map', role: 'region', 'aria-label': 'Map of locations' });
    body.appendChild(mapEl);
    if (pinned.length < sites.length) body.appendChild(h('p', { class: 'footnote' }, 'Some locations have no map pin. The list shows every location.'));
    loadLeaflet()
      .then((L) => {
        if (!alive) return;
        map = L.map(mapEl, { attributionControl: false, scrollWheelZoom: false });
        L.control.attribution({ prefix: false }).addAttribution(`<a href="${OSM_COPYRIGHT}" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors</a>`).addTo(map);
        L.tileLayer(OSM_TILES, { maxZoom: 19 }).addTo(map);
        const points = [];
        for (const site of pinned) {
          const point = [site.pin.lat, site.pin.lng];
          points.push(point);
          const popup = h(
            'div',
            { class: 'stack' },
            h('a', { href: locationsHref({ facilityId: site.facility_id, item: context.item, ruleIds: context.ruleIds }) }, ctx.displayText(site.name, 'locator.name')),
            site.address ? h('span', {}, ctx.displayText(site.address, 'locator.address')) : null,
          );
          L.marker(point, { title: ctx.displayText(site.name, 'locator.name'), alt: ctx.displayText(site.name, 'locator.name') }).addTo(map).bindPopup(popup);
        }
        if (points.length === 1) map.setView(points[0], 13);
        else map.fitBounds(points, { padding: [24, 24] });
      })
      .catch(() => {
        if (!alive) return;
        clear(body).appendChild(h('div', { class: 'notice stack' }, h('p', {}, 'The map could not be loaded; see the list'), h('a', { class: 'button', href: href({ view: 'list' }) }, 'List')));
      });
  }

  return () => {
    alive = false;
    if (map) map.remove();
  };
}

function mountFacility(route, container, ctx) {
  let alive = true;
  ctx.setTitle('Location');
  const id = route.params.facilityId;
  const item = typeof route.query.item === 'string' ? route.query.item.trim() : '';
  const forItem = 'rule_ids' in route.query;
  const ruleIds = parseRuleIds(route.query.rule_ids);
  const backHref = locationsHref({ view: 'list', item, ruleIds: forItem ? ruleIds : null });
  const today = localToday();
  container.appendChild(h('div', { class: 'loading-block' }, h('div', { class: 'spinner', role: 'progressbar', 'aria-label': 'Loading' })));

  const notListed = () =>
    clear(container).appendChild(h('div', { class: 'stack-wide' }, h('h1', { class: 'h2' }, 'This location is not listed for this Place.'), h('a', { class: 'button', href: '/locations' }, 'All locations')));

  (async () => {
    // Within an item's context first, so "the only place" is kept; then among every site for the Place.
    let data = forItem ? await getSites(ctx.place, { ruleIds }) : await getSites(ctx.place);
    let site = (data.sites || []).find((s) => s.facility_id === id);
    if (!site && forItem) {
      data = await getSites(ctx.place);
      site = (data.sites || []).find((s) => s.facility_id === id);
    }
    if (!alive) return;
    if (!site) return notListed();
    const rules = data.rules || [];
    const name = ctx.displayText(site.name, 'facility.name');
    ctx.setTitle(name);
    const state = eventState(site, today);
    const tag = site.kind === 'event' ? (state === 'past' ? null : 'Tentative') : KIND_TAGS[site.kind];
    const accepted = acceptedItems(site, rules);
    const wheres = rulesOfSite(site, rules).filter((r) => r.where && r.where.trim());
    clear(container).appendChild(
      h(
        'article',
        { class: 'stack-wide', 'data-facility': site.facility_id },
        h('h1', { class: 'h1' }, name),
        tag ? h('p', {}, h('span', { class: 'site-tag' }, tag)) : null,
        h('div', { class: 'stack' }, siteFacts(site, rules, ctx, today)),
        accepted.length
          ? h(
              'section',
              { class: 'stack' },
              h('h2', { class: 'section-title' }, 'Accepts the following'),
              h('ul', { class: 'bullets' }, accepted.map((entry) => h('li', {}, ctx.displayText(entry, 'facility.applies_to')))),
            )
          : null,
        wheres.length
          ? h(
              'section',
              { class: 'stack' },
              h('h2', { class: 'section-title' }, 'As the local rules put it'),
              h('ul', { class: 'bullets' }, wheres.map((r) => h('li', {}, `${r.rule_id}: ${ctx.displayText(r.where, 'facility.where')}`))),
            )
          : null,
        h('a', { class: 'button button-secondary', href: backHref }, icon('list-bullet'), 'Back to the list'),
      ),
    );
  })().catch(() => {
    if (!alive) return;
    clear(container).appendChild(h('div', { class: 'stack' }, h('p', { class: 'h3' }, 'This location could not be loaded.'), h('a', { class: 'button', href: '/locations' }, 'All locations')));
  });

  return () => {
    alive = false;
  };
}

export function mount(route, container, ctx) {
  return route.params.facilityId ? mountFacility(route, container, ctx) : mountLocations(route, container, ctx);
}
