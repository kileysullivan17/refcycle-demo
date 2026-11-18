// Display-time text swap (contracts 9; Q24, X-2, G12, G13).
// One shared function for every string that comes from the engine, a pack or the facility list.
// Only two things ever change, and only in what is shown, never in the data:
//   1. every spelling of the county name becomes "Hawaiʻi County";
//   2. the one business name the public pack still carries becomes its public description.
// Quoted source lines (text between the curly quotes “ and ”) are left exactly as written.

const COUNTY = /County of Hawai(?:[ʻ‘’'`])?i/g;
const COUNTY_TO = 'Hawaiʻi County';
const BUSINESS = /Big Island Biodiesel/g;
const BUSINESS_TO = 'a local biodiesel company';
const QUOTED = /“[^”]*”/g;

function swapOutsideQuotes(text, pattern, to, swaps) {
  const replaceIn = (part) =>
    part.replace(pattern, (match) => {
      const found = swaps.find((s) => s.from === match && s.to === to);
      if (found) found.count += 1;
      else swaps.push({ from: match, to, count: 1 });
      return to;
    });
  let out = '';
  let last = 0;
  for (const quoted of text.matchAll(QUOTED)) {
    out += replaceIn(text.slice(last, quoted.index)) + quoted[0];
    last = quoted.index + quoted[0].length;
  }
  return out + replaceIn(text.slice(last));
}

/** Pure: returns the text to show and what was replaced. */
export function swapText(text) {
  const swaps = [];
  if (typeof text !== 'string' || text === '') return { text: typeof text === 'string' ? text : '', swaps };
  let out = swapOutsideQuotes(text, COUNTY, COUNTY_TO, swaps);
  out = swapOutsideQuotes(out, BUSINESS, BUSINESS_TO, swaps);
  return { text: out, swaps };
}

let report = null;

/** The shell supplies how a swap is reported: POST /api/log/display-swap with the current place. */
export function setSwapReporter(fn) {
  report = fn;
}

/** displayText(text, surface): the text to show. Each call that replaced something is logged. */
export function displayText(text, surface) {
  const result = swapText(text);
  if (result.swaps.length && report) {
    for (const swap of result.swaps) {
      try {
        report({ surface: String(surface || 'unknown').slice(0, 200), from: swap.from, to: swap.to, count: swap.count });
      } catch {
        /* logging never blocks display */
      }
    }
  }
  return result.text;
}
