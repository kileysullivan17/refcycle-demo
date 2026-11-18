// Loads a browser module (plain JavaScript under app/public) into a Node test. Only modules with no DOM
// at import time are loaded this way: the pure logic the screens are built on.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { PUBLIC_DIR } from '../../src/shared/paths.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function clientModule(relative: string): Promise<any> {
  return import(pathToFileURL(path.join(PUBLIC_DIR, relative)).href);
}

/** A minimal localStorage stand-in. */
export function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  };
}
