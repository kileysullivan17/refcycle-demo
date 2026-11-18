// Headless Chrome for the browser tests, through playwright-core. If Chrome is not installed the browser
// tests are skipped with a clear reason rather than failing.
import { existsSync } from 'node:fs';
import { chromium, type Browser } from 'playwright-core';

const CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  `${process.env.HOME}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`,
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter((p): p is string => !!p);

export function chromePath(): string | null {
  return CANDIDATES.find((p) => existsSync(p)) ?? null;
}

export async function launchChrome(): Promise<Browser | null> {
  const executablePath = chromePath();
  if (!executablePath) return null;
  try {
    return await chromium.launch({ executablePath, headless: true });
  } catch (error) {
    console.error('Chrome could not be started for the browser tests:', error instanceof Error ? error.message.split('\n')[0] : error);
    return null;
  }
}
