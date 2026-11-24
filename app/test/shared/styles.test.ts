// Design tokens (names from contracts 11, values from decision 18): exact names and values, defined once in tokens.css, and used by
// every screen (new ones included) only through the custom properties.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { PUBLIC_DIR } from '../../src/shared/paths.ts';
import { allOwnRules, ownStylesheets, parseCss, publicFiles, readPublic, tokens } from '../helpers/css.ts';

const EXPECTED: Record<string, string> = {
  '--color-blue': '#1D5C96',
  '--color-ink': '#1B2733',
  '--color-gold': '#D5DADF',
  '--color-red': '#F28C28',
  '--color-sand': '#E6EFF6',
  '--color-white': '#FFFFFF',
  '--radius-control': '8px',
  '--space-unit': '8px',
  '--icon-max': '20px',
  '--type-h1-size': '30px',
  '--type-h1-weight': '600',
  '--type-h2-size': '23px',
  '--type-h2-weight': '600',
  '--type-h3-size': '20px',
  '--type-h3-weight': '600',
  '--type-headline-size': '17px',
  '--type-headline-weight': '600',
  '--type-body-size': '17px',
  '--type-body-weight': '400',
  '--type-callout-size': '16px',
  '--type-callout-weight': '400',
  '--type-subhead-size': '15px',
  '--type-subhead-weight': '400',
  '--type-footnote-size': '13px',
  '--type-footnote-weight': '400',
  '--type-caption-size': '12px',
  '--type-caption-weight': '400',
  '--type-card-red-size': '24px',
  '--type-card-red-weight': '700',
};

test('tokens.css defines exactly the contract’s tokens with the decision 18 values', () => {
  const defined = tokens();
  for (const [name, value] of Object.entries(EXPECTED)) assert.equal(defined.get(name), value, name);
  assert.match(defined.get('--font-text') ?? '', /^'Atkinson Hyperlegible Next'/);
  assert.match(defined.get('--font-display') ?? '', /^'Saira Semi Condensed'/);
  assert.deepEqual([...defined.keys()].sort(), [...Object.keys(EXPECTED), '--font-text', '--font-display'].sort(), 'no extra tokens');
});

test('tokens are defined once, in tokens.css only', () => {
  for (const file of ownStylesheets().filter((f) => f !== 'shared/tokens.css')) {
    for (const rule of parseCss(file)) {
      for (const d of rule.declarations) assert.ok(!d.property.startsWith('--'), `${file} defines ${d.property}`);
    }
  }
});

test('every screen has a stylesheet and the shell loads them all', () => {
  const sheets = ownStylesheets();
  for (const expected of ['shared/tokens.css', 'shared/app.css', 'features/recyclopedia/recyclopedia.css', 'features/camera-scan/camera-scan.css', 'features/locator/locator.css', 'features/guidelines/guidelines.css', 'features/reuse/reuse.css']) {
    assert.ok(sheets.includes(expected), expected);
    assert.ok(readPublic('index.html').includes(`href="/${expected}"`), `index.html loads ${expected}`);
  }
});

const rules = allOwnRules().filter((r) => r.file !== 'shared/tokens.css');
const each = (check: (property: string, value: string, where: string) => void) => {
  for (const rule of rules) for (const d of rule.declarations) check(d.property, d.value, `${rule.file} ${rule.selector} { ${d.property}: ${d.value} }`);
};

test('no stylesheet hardcodes a color', () => {
  each((property, value, where) => {
    assert.doesNotMatch(value, /#[0-9a-fA-F]{3,8}\b/, where);
    assert.doesNotMatch(value, /\b(rgb|rgba|hsl|hsla|oklch|lab|color)\(/i, where);
    if (['color', 'background', 'background-color', 'border-color', 'border-top-color', 'outline-color', 'fill', 'stroke'].includes(property)) {
      assert.match(value, /^(var\(--color-[a-z]+\)|transparent|currentColor|inherit)$/, where);
    }
    if (/^(border|border-(top|right|bottom|left)|outline)$/.test(property) && value !== '0' && value !== 'none') {
      assert.match(value, /var\(--color-[a-z]+\)|transparent|currentColor/, where);
    }
  });
});

test('every font size is a type token; fonts are the two bundled families', () => {
  each((property, value, where) => {
    if (property === 'font-size') assert.match(value, /^var\(--type-[a-z0-9-]+-size\)$/, where);
    if (property === 'font-family') assert.match(value, /^(var\(--font-(text|display)\)|inherit)$/, where);
    if (property === 'font') assert.fail(`font shorthand hides a size: ${where}`);
    if (property === 'font-weight') assert.match(value, /^(var\(--type-[a-z0-9-]+-weight\)|[1-9]00)$/, where);
  });
});

test('every corner radius is the control radius (or a circle)', () => {
  each((property, value, where) => {
    if (property.includes('radius')) assert.match(value, /^(var\(--radius-control\)|50%|0)$/, where);
  });
});

// Spacing: paddings, margins, gaps and insets in multiples of 4px, always written through --space-unit (K4).
const SPACING = /^(padding|margin|gap|row-gap|column-gap|inset|top|right|bottom|left)(-(top|right|bottom|left|inline|block|inline-start|inline-end|block-start|block-end))?$/;
const UNIT = /^var\(--space-unit\)$/;
const TIMES = /^calc\(var\(--space-unit\) \* (-?\d+(?:\.\d+)?)\)$/;
const HALF = /^calc\(var\(--space-unit\) \/ 2\)$/;

function spacingParts(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of value) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ' ' && depth === 0) {
      if (current) parts.push(current);
      current = '';
    } else current += ch;
  }
  if (current) parts.push(current);
  return parts;
}

test('spacing is written through --space-unit in multiples of 4px', () => {
  let checked = 0;
  each((property, value, where) => {
    if (!SPACING.test(property)) return;
    for (const part of spacingParts(value)) {
      checked++;
      if (part === '0' || part === 'auto') continue;
      if (UNIT.test(part) || HALF.test(part)) continue;
      const times = TIMES.exec(part);
      assert.ok(times, where);
      assert.equal((Number(times![1]) * 8) % 4, 0, `not a multiple of 4px: ${where}`);
    }
  });
  assert.ok(checked > 60, `only ${checked} spacing values checked`);
});

test('icons are capped at the icon token', () => {
  const icon = rules.find((r) => r.selector === '.icon');
  assert.ok(icon);
  assert.equal(icon!.declarations.find((d) => d.property === 'height')?.value, 'var(--icon-max)');
});

test('no inline styles: screens style through the stylesheets only', () => {
  for (const file of publicFiles().filter((f) => (f.endsWith('.js') || f.endsWith('.html')) && !f.startsWith('shared/vendor/'))) {
    const source = readPublic(file);
    assert.doesNotMatch(source, /\bstyle\s*=|\.style\.|setAttribute\(\s*['"]style|cssText/, file);
    assert.doesNotMatch(source, /#[0-9a-fA-F]{6}\b/, `${file} holds a color value`);
  }
});

test('fonts are bundled: Atkinson Hyperlegible Next 400, 600 and Saira Semi Condensed 400, 600 and a real 700', () => {
  const css = readPublic('shared/fonts.css');
  for (const file of [
    ...['400', '600'].flatMap((w) => [`atkinson-hyperlegible-next-latin-${w}-normal`, `atkinson-hyperlegible-next-latin-ext-${w}-normal`]),
    ...['400', '600', '700'].flatMap((w) => [`saira-semi-condensed-latin-${w}-normal`, `saira-semi-condensed-latin-ext-${w}-normal`]),
  ]) {
    assert.ok(css.includes(`./fonts/${file}.woff2`), file);
    assert.ok(existsSync(path.join(PUBLIC_DIR, 'shared', 'fonts', `${file}.woff2`)), file);
  }
  assert.doesNotMatch(css, /https?:\/\//, 'fonts are served by the app, not a font service');
  for (const license of ['OFL-AtkinsonHyperlegibleNext.txt', 'OFL-SairaSemiCondensed.txt']) assert.ok(existsSync(path.join(PUBLIC_DIR, 'shared', 'fonts', license)));
});

test('the phone-width layout: 430px maximum, usable from 320px', () => {
  const app = rules.find((r) => r.file === 'shared/app.css' && r.selector === '.app');
  assert.equal(app?.declarations.find((d) => d.property === 'max-width')?.value, '430px');
  assert.equal(app?.declarations.find((d) => d.property === 'min-width')?.value, '320px');
});
