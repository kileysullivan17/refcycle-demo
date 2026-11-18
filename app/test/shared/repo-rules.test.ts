// Standing rules for everything written in this build:
//   no em dashes anywhere (code, comments, docs, UI text);
//   private businesses by public description, never by name;
//   the provider key stays server-side and no .env is ever committed;
//   the browser loads nothing from outside the app except OpenStreetMap tiles.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { APP_DIR, REPO_DIR } from '../../src/shared/paths.ts';
import { publicFiles, readPublic } from '../helpers/css.ts';

const TEXT = /\.(ts|mts|js|mjs|json|css|html|md|txt|yaml|yml|csv|sh|example|gitignore)$/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git' || name === 'logs') continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

// Written in this build: the app, and the repo's top-level docs. The engine, the packs, the PRD and
// contracts, the specs, and third-party files (fonts' licenses, Leaflet, the lockfile) are not ours to edit.
function authoredFiles(): string[] {
  const app = walk(APP_DIR).filter((f) => {
    const rel = path.relative(APP_DIR, f).split(path.sep).join('/');
    return !rel.startsWith('public/shared/vendor/') && !rel.startsWith('public/shared/fonts/') && rel !== 'package-lock.json';
  });
  const top = readdirSync(REPO_DIR)
    .map((name) => path.join(REPO_DIR, name))
    .filter((f) => statSync(f).isFile());
  const scripts = existsSync(path.join(REPO_DIR, 'scripts')) ? walk(path.join(REPO_DIR, 'scripts')) : [];
  return [...app, ...top, ...scripts].filter((f) => TEXT.test(f) || path.basename(f).startsWith('.'));
}

test('no em dashes in anything written for this build', () => {
  const files = authoredFiles();
  assert.ok(files.length > 60, `only ${files.length} files scanned`);
  const emDash = String.fromCharCode(0x2014);
  const offenders = files.filter((f) => readFileSync(f, 'utf8').includes(emDash)).map((f) => path.relative(REPO_DIR, f));
  assert.deepEqual(offenders, []);
});

test('the withheld business name appears only where the contract’s swap needs it', () => {
  const name = ['Big', 'Island', 'Biodiesel'].join(' ');
  const allowed = new Set(['app/public/shared/display-text.js', 'app/test/shared/display-text.test.ts', 'app/test/e2e/browser.test.ts']);
  const offenders = authoredFiles()
    .filter((f) => readFileSync(f, 'utf8').includes(name))
    .map((f) => path.relative(REPO_DIR, f).split(path.sep).join('/'))
    .filter((f) => !allowed.has(f));
  assert.deepEqual(offenders, []);
});

test('the reuse links and the facility list name no operator business', () => {
  // The County's reuse page names a contact business; this app describes the centers and never names it.
  const reuse = readFileSync(path.join(APP_DIR, 'data', 'reuse-links.json'), 'utf8');
  assert.doesNotMatch(reuse, /\bLLC\b|\bInc\b|Thrift Store/i);
});

test('no .env file is tracked, and the example holds no key', () => {
  let tracked: string[] = [];
  try {
    tracked = execFileSync('git', ['ls-files'], { cwd: REPO_DIR, encoding: 'utf8' }).split('\n').filter(Boolean);
  } catch {
    return; // not a git checkout (for example an exported copy): nothing to check
  }
  const envFiles = tracked.filter((f) => /(^|\/)\.env(\.|$)/.test(f) && !f.endsWith('.env.example'));
  assert.deepEqual(envFiles, []);
  const example = readFileSync(path.join(APP_DIR, '.env.example'), 'utf8');
  for (const line of example.split('\n')) {
    const match = /^\s*(ANTHROPIC_API_KEY|OPENAI_API_KEY)\s*=\s*(.*)$/.exec(line);
    if (match) assert.equal(match[2].trim(), '', `${match[1]} must be empty in .env.example`);
  }
  assert.doesNotMatch(example, /sk-[A-Za-z0-9_-]{10,}/);
  assert.ok(existsSync(path.join(REPO_DIR, '.gitignore')));
  assert.match(readFileSync(path.join(REPO_DIR, '.gitignore'), 'utf8'), /^\.env$/m);
});

test('no key or key variable reaches the browser', () => {
  for (const file of publicFiles().filter((f) => !f.startsWith('shared/vendor/') && /\.(js|html|css)$/.test(f))) {
    assert.doesNotMatch(readPublic(file), /API_KEY|x-api-key|api\.anthropic\.com|api\.openai\.com|Authorization/i, file);
  }
});

test('the browser loads nothing from outside the app except OpenStreetMap tiles', () => {
  const allowed = new Set([
    'https://tile.openstreetmap.org/{z}/{x}/{y}.png', // map tiles (contracts 7.4)
    'https://www.openstreetmap.org/copyright', // the attribution link, opened by the visitor
    'http://www.w3.org/2000/svg', // an XML namespace, not a request
    'http://app.invalid',
  ]);
  for (const file of publicFiles().filter((f) => !f.startsWith('shared/vendor/') && !f.startsWith('shared/fonts/') && /\.(js|html|css)$/.test(f))) {
    for (const url of readPublic(file).match(/https?:\/\/[^\s'"`)<>]+/g) ?? []) {
      assert.ok(allowed.has(url), `${file} references ${url}`);
    }
    assert.doesNotMatch(readPublic(file), /@import|<script[^>]+src="https?:|<link[^>]+href="https?:/i, file);
  }
});

test('the app server calls only the engine and the image-model provider', () => {
  const urls = new Set<string>();
  for (const file of walk(path.join(APP_DIR, 'src'))) {
    for (const url of readFileSync(file, 'utf8').match(/https?:\/\/[^\s'"`)<>]+/g) ?? []) {
      if (!url.includes('${')) urls.add(url); // the start-up line prints the app's own address
    }
  }
  assert.deepEqual([...urls].sort(), [
    'http://127.0.0.1:3000',
    'http://app.invalid',
    'https://api.anthropic.com/v1/messages',
    'https://api.openai.com/v1/chat/completions',
    'https://tile.openstreetmap.org', // named in the Content-Security-Policy header only
  ]);
});

test('the app imports from the engine only what the contract allows', () => {
  const imports = new Set<string>();
  for (const file of walk(path.join(APP_DIR, 'src'))) {
    for (const match of readFileSync(file, 'utf8').matchAll(/from '([^']*engine\/code[^']*)'/g)) imports.add(match[1].replace(/^(\.\.\/)+/, ''));
  }
  assert.deepEqual([...imports].sort(), ['engine/code/src/config.ts', 'engine/code/src/rules.ts']);
  const rulesImport = readFileSync(path.join(APP_DIR, 'src', 'shared', 'packs.ts'), 'utf8');
  assert.match(rulesImport, /import \{ loadPacks, type Pack, type Rule \} from/);
  assert.match(readFileSync(path.join(APP_DIR, 'src', 'server.ts'), 'utf8'), /import \{ loadEnv \} from/);
});

test('zod is at 4.6.6, the first release that fixes the published advisory, in the app and the engine', () => {
  // Upgraded on Kiley's word on 2026-11-17 (DECISIONS 58). The scored runs used 4.1.11.
  const pkg = JSON.parse(readFileSync(path.join(APP_DIR, 'package.json'), 'utf8'));
  assert.equal(pkg.dependencies.zod, '4.6.6');
  const lock = JSON.parse(readFileSync(path.join(APP_DIR, 'package-lock.json'), 'utf8'));
  assert.equal(lock.packages['node_modules/zod'].version, '4.6.6');
  const engineDir = path.join(REPO_DIR, 'engine', 'code');
  const enginePkg = JSON.parse(readFileSync(path.join(engineDir, 'package.json'), 'utf8'));
  assert.equal(enginePkg.dependencies.zod, 'https://registry.npmjs.org/zod/-/zod-4.6.6.tgz');
  const engineLock = JSON.parse(readFileSync(path.join(engineDir, 'package-lock.json'), 'utf8'));
  assert.equal(engineLock.packages['node_modules/zod'].version, '4.6.6');
});

test('the deploy files hold no key, keep every .env out of the image and never turn the limits off', () => {
  const read = (name: string) => readFileSync(path.join(REPO_DIR, name), 'utf8');
  const ignore = read('.dockerignore').split('\n');
  for (const line of ['**/.env', '**/.env.*', '**/node_modules', '**/logs', '.git']) assert.ok(ignore.includes(line), `.dockerignore lists ${line}`);
  const files = ['Dockerfile', 'fly.toml', path.join('scripts', 'start-host.sh')].map(read);
  for (const text of files) {
    assert.doesNotMatch(text, /sk-ant-|DEMO_LIMITS\s*=|ANTHROPIC_API_KEY\s*=\s*["']?[A-Za-z0-9]/, 'no key and no limits switch');
    assert.doesNotMatch(text, /COPY\s+\.\s|\.env(?!\.example)\b(?! file)/, 'no .env is copied or read');
  }
  const [docker, fly, start] = files;
  assert.match(docker, /NODE_ENV=production/);
  assert.match(fly, /NODE_ENV = "production"/);
  assert.match(fly, /TRUST_FLY_CLIENT_IP = "1"/);
  assert.match(fly, /destination = "\/srv\/refcycle\/app\/logs"/);
  assert.match(fly, /auto_stop_machines = "off"/);
  assert.match(start, /export NODE_ENV=production/);
  assert.match(start, /HOST=0\.0\.0\.0/);
  // The engine is started as it is, from its own folder, and nothing but the app listens beyond the container.
  assert.match(start, /code\/src\/main\.ts/);
  assert.doesNotMatch(docker, /EXPOSE\s+3000/);
  assert.doesNotMatch(fly, /3000/);
});
