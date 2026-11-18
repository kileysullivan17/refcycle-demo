// A small CSS reader for the style tests: enough to walk the app's own stylesheets rule by rule.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { PUBLIC_DIR } from '../../src/shared/paths.ts';

export type Declaration = { property: string; value: string };
export type CssRule = { file: string; selector: string; declarations: Declaration[] };

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/** Every file under app/public, as paths relative to it. */
export function publicFiles(): string[] {
  return walk(PUBLIC_DIR).map((f) => path.relative(PUBLIC_DIR, f).split(path.sep).join('/'));
}

/** The app's own stylesheets: everything except third-party vendor code and the generated font faces. */
export function ownStylesheets(): string[] {
  return publicFiles().filter((f) => f.endsWith('.css') && !f.startsWith('shared/vendor/') && f !== 'shared/fonts.css');
}

export function readPublic(relative: string): string {
  return readFileSync(path.join(PUBLIC_DIR, relative), 'utf8');
}

/** Flattens a stylesheet into rules. At-rule wrappers (@media) are entered; @keyframes steps are kept too. */
export function parseCss(file: string, source = readPublic(file)): CssRule[] {
  const text = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: CssRule[] = [];
  const walkBlock = (block: string) => {
    let i = 0;
    while (i < block.length) {
      const open = block.indexOf('{', i);
      if (open < 0) break;
      let depth = 1;
      let j = open + 1;
      while (j < block.length && depth > 0) {
        if (block[j] === '{') depth++;
        else if (block[j] === '}') depth--;
        j++;
      }
      const selector = block.slice(i, open).trim();
      const body = block.slice(open + 1, j - 1);
      if (selector.startsWith('@')) walkBlock(body);
      else {
        const declarations = body
          .split(';')
          .map((d) => d.trim())
          .filter(Boolean)
          .map((d) => {
            const colon = d.indexOf(':');
            return { property: d.slice(0, colon).trim().toLowerCase(), value: d.slice(colon + 1).trim() };
          });
        rules.push({ file, selector, declarations });
      }
      i = j;
    }
  };
  walkBlock(text);
  return rules;
}

export function allOwnRules(): CssRule[] {
  return ownStylesheets().flatMap((file) => parseCss(file));
}

/** The custom properties defined in tokens.css. */
export function tokens(): Map<string, string> {
  const map = new Map<string, string>();
  for (const rule of parseCss('shared/tokens.css')) {
    for (const d of rule.declarations) if (d.property.startsWith('--')) map.set(d.property, d.value);
  }
  return map;
}
