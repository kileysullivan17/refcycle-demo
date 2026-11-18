// Contrast rule (contracts 11, approved 2026-11-05).
//   1. Text on the red card is ink, bold (700) and at least 19px, through --type-card-red-size and
//      --type-card-red-weight; no rule inside the card overrides its size, weight or color.
//   2. No San Marino text on Wheatfield: any box with a --color-sand background sets its text and its
//      links in ink.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { allOwnRules, tokens, type CssRule } from '../helpers/css.ts';

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const t = tokens();
const color = (name: string) => t.get(`--color-${name}`)!;
const rules = allOwnRules().filter((r) => r.file !== 'shared/tokens.css');
const value = (rule: CssRule | undefined, property: string) => rule?.declarations.find((d) => d.property === property)?.value;
const selectors = (rule: CssRule) => rule.selector.split(',').map((s) => s.trim());

test('the measured ratios behind the rule', () => {
  assert.equal(contrast(color('ink'), color('red')).toFixed(2), '4.40');
  assert.equal(contrast(color('white'), color('red')).toFixed(2), '3.70');
  assert.equal(contrast(color('blue'), color('sand')).toFixed(2), '4.38');
});

test('every text and background pair the app uses meets 4.5:1 (3:1 for the large bold red card label)', () => {
  const pairs: [string, string, number][] = [
    ['ink', 'white', 4.5],
    ['blue', 'white', 4.5], // links and quiet buttons on white
    ['white', 'blue', 4.5], // primary buttons, the blue card, the camera tab
    ['ink', 'gold', 4.5], // the yellow card
    ['ink', 'sand', 4.5], // notices, tiles, tags, category cards
    ['ink', 'red', 3], // the red card label: large text
  ];
  for (const [text, background, minimum] of pairs) {
    const ratio = contrast(color(text), color(background));
    assert.ok(ratio >= minimum, `${text} on ${background}: ${ratio.toFixed(2)}`);
  }
});

test('the red card label is ink, bold and at least 19px, through its own tokens', () => {
  const card = rules.find((r) => selectors(r).includes('.card-red'));
  assert.ok(card, '.card-red rule');
  assert.equal(value(card, 'background'), 'var(--color-red)');
  assert.equal(value(card, 'color'), 'var(--color-ink)');
  assert.equal(value(card, 'font-size'), 'var(--type-card-red-size)');
  assert.equal(value(card, 'font-weight'), 'var(--type-card-red-weight)');
  assert.equal(t.get('--type-card-red-size'), 'var(--type-h2-size)');
  assert.ok(parseInt(t.get('--type-h2-size')!, 10) >= 19);
  assert.ok(Number(t.get('--type-card-red-weight')) >= 700);
});

test('nothing inside the red card overrides its size, weight or color', () => {
  for (const rule of rules) {
    for (const selector of selectors(rule)) {
      if (!selector.includes('.card-red') || selector === '.card-red') continue;
      for (const property of ['color', 'font-size', 'font-weight']) assert.equal(value(rule, property), undefined, `${rule.file} ${selector} sets ${property}`);
    }
  }
  // The card is declared after the shared verdict rule, so the card's own size and weight win.
  const verdictIndex = rules.findIndex((r) => selectors(r).includes('.verdict'));
  const cardIndex = rules.findIndex((r) => selectors(r).includes('.card-red'));
  assert.ok(verdictIndex >= 0 && cardIndex > verdictIndex);
  // No other rule uses the red background.
  for (const rule of rules) {
    if (/var\(--color-red\)/.test(value(rule, 'background') ?? '') || /var\(--color-red\)/.test(value(rule, 'background-color') ?? '')) {
      assert.deepEqual(selectors(rule), ['.card-red'], `${rule.file} ${rule.selector}`);
    }
  }
});

test('every sand box sets its text in ink, and its links in ink', () => {
  const sand = rules.filter((r) => /var\(--color-sand\)/.test(value(r, 'background') ?? value(r, 'background-color') ?? ''));
  assert.ok(sand.length >= 4, 'sand boxes found');
  for (const rule of sand) {
    if (selectors(rule).includes('body')) continue; // the page backdrop behind the app column holds no text
    assert.equal(value(rule, 'color'), 'var(--color-ink)', `${rule.file} ${rule.selector}`);
  }
  // Boxes that can hold links: the link color is ink there too.
  const noticeLinks = rules.find((r) => selectors(r).includes('.notice a'));
  assert.equal(value(noticeLinks, 'color'), 'var(--color-ink)');
});

test('no rule puts San Marino text on a sand background', () => {
  for (const rule of rules) {
    const background = value(rule, 'background') ?? value(rule, 'background-color') ?? '';
    if (/var\(--color-sand\)/.test(background)) assert.notEqual(value(rule, 'color'), 'var(--color-blue)', `${rule.file} ${rule.selector}`);
  }
});
