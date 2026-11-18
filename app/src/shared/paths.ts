// Fixed locations inside the repo, resolved from this file so the app works from any working directory.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const APP_DIR = path.resolve(here, '..', '..');
export const REPO_DIR = path.resolve(APP_DIR, '..');
export const PUBLIC_DIR = path.join(APP_DIR, 'public');
export const DATA_DIR = path.join(APP_DIR, 'data');
export const LOGS_DIR = path.join(APP_DIR, 'logs');
export const RULES_DIR = path.join(REPO_DIR, 'engine', 'rules');
export const FACILITIES_CSV = path.join(REPO_DIR, 'engine', 'data', 'facilities.csv');
export const CATALOG_JSON = path.join(DATA_DIR, 'catalog.json');
export const REUSE_LINKS_JSON = path.join(DATA_DIR, 'reuse-links.json');
