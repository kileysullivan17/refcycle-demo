# RefCycle whole app

RefCycle began as a student concept by a five-person team in the Berkeley UX/UI Boot Camp, UC Berkeley Extension, January 2024. This rebuild and evaluation are solo work.

A phone-width web app in front of the pinned Build B engine. It is a public portfolio demo with no promise of upkeep: it covers three Places only (Seattle, Austin, Hawaiʻi County) and its rules are not kept up to date.

Built to `orchestrator/PRD.md`, `orchestrator/CONTRACTS.md` v1.3 and the PRD addendum of 2026-11-11. Choices those leave open are in `../DECISIONS.md`.

## What is in it

| Screen | Route | Source |
|---|---|---|
| Intro with Place picker (first use) | `/` | addendum |
| Place picker, forget control | `/place` | addendum |
| Home | `/home` | addendum |
| Recyclopedia, material page, search | `/recyclopedia`, `/recyclopedia/:categoryId`, `/search` | PRD 4 |
| Item page (shared) | `/item` | contracts 8 |
| Camera scan, confirm | `/scan`, `/scan/confirm` | PRD 5 |
| Locator list and map, facility page | `/locations`, `/locations/:facilityId` | PRD 6 |
| Place guidelines, with hazardous waste | `/guidelines` | addendum |
| Give it another life | `/another-life` | addendum |

Three rules hold everywhere:

- No feature writes, edits or infers a recycling rule. Every answer comes from `POST /api/ask` on the pinned engine. Reuse links never change an answer.
- Public rules packs only. Private businesses appear by public description, never by name.
- The provider key stays on the server. The browser loads nothing from outside the app except OpenStreetMap tiles.

## Run it locally

Needs Node 20 or later.

```
cd engine/code && npm ci
cd ../../app && npm ci
```

Create `engine/.env` and `app/.env` yourself from the two `.env.example` files and put the provider key in each. No script here copies a key.

Start the engine from `engine/` (it listens on 127.0.0.1:3000), then the app:

```
cd engine && LLM_PROVIDER=anthropic LLM_MODEL=claude-sonnet-5-5 node --import ./code/node_modules/tsx/dist/esm/index.mjs code/src/main.ts
cd app && npm run dev
```

The app is at http://127.0.0.1:3001. `PORT`, `HOST` and `ENGINE_URL` change where it listens and where it finds the engine.

## Demo limits

| Setting | Default | Meaning |
|---|---|---|
| `DEMO_LIMITS` | on | `off` only on 127.0.0.1 outside production |
| `DAILY_SPEND_CAP_USD` | 5 | hard daily spending cap |
| `VISITOR_DAILY_LIMIT` | 20 | questions or scans per visitor per day |
| `ASK_COST_USD` | 0.03 | what one question is counted at |
| `SCAN_COST_USD` | 0.02 | held while a scan runs; counted only if the provider reports no usage |
| `PRICE_INPUT_USD_PER_MTOK`, `PRICE_OUTPUT_USD_PER_MTOK` | 2, 10 | prices used to turn a scan's reported usage into dollars |
| `TRUST_FLY_CLIENT_IP` | unset | `1` on Fly.io: visitors are told apart by `Fly-Client-IP`, which is ignored otherwise |
| `TRUST_PROXY` | unset | `1` behind a proxy that appends the visitor's address last in `X-Forwarded-For` (not Fly.io) |

The switch is read from the server environment only. `npm start` is the production start (`NODE_ENV=production`) and refuses to run with limits off. At either limit the app shows one plain message and no answer; the Recyclopedia list, Place guidelines, Locations and reuse links keep working.

Each question is counted at a flat 3 cents, because the engine reports no token usage; scans are counted at the usage the provider reports. With the defaults the cap allows 166 questions a day, or 100 scans each followed by its question. The 3 cents is an average measured on the scored run, not a ceiling. See `../DECISIONS.md`, decision 55.

## Tests

```
npm run check   # TypeScript
npm test        # unit, API and browser tests
```

No test calls a model or needs a key. The engine is the pinned engine's own code with a fixture in place of the model; the image provider is a test double. The browser tests need Google Chrome (or `CHROME_PATH`) and are skipped without it. One browser test drives the app with the review harness's own driver when `~/refcycle-builds/refcycle-scored/review` is present, using made-up queries and no answer key.

## Scored run

`../scripts/run-scored-whole-app.sh` runs the unchanged review harness against this folder, on ports 3000 and 3001, with limits off for that run only. It is for Kiley's own Terminal. Steps are in the hand-over note for this build.

After the run it checks that every raw engine answer and explanation was saved (`raw-check.json`), grades, and writes the blind invented-rules sheet. To re-grade a finished run against other keys without calling the model:

```
KEYS_DIR=~/refcycle-builds/refcycle-private/keys-v2-2026-11-05 \
  ./scripts/run-scored-whole-app.sh grade <results folder of one build> [more folders]
```

The source folder is never changed; the re-grade goes to a new `regrade-<keys>-<date-time>` folder.

The blind sheet holds three builds, shuffled together: baseline, team and whole-app. The live run adds the two published builds by itself; in grade-only mode, pass all three folders. When the sheet is graded:

```
./scripts/run-scored-whole-app.sh blind-report <graded blind folder>
```

This writes `blind-report.md` into that folder: the whole-app rows on their own, and the new baseline and team grades next to the published ones as a consistency check. Published results are read and never changed.

To run a few named cases again after a fix, as a post-run check that is not a score (its own folder, no grading):

```
./scripts/run-scored-whole-app.sh fix-check ph19,ph36,ph22,ph24,lc28-haw
```

After the zod upgrade, as post-upgrade checks that are not scores (each its own new folder, never a blind sheet): the same five cases, or all 94 cases graded against the frozen keys for comparison only (about 1.75 dollars of model calls). A plain scored run is now refused, since the scored run is final and was made on zod 4.1.11.

```
./scripts/run-scored-whole-app.sh upgrade-check ph19,ph36,ph22,ph24,lc28-haw
./scripts/run-scored-whole-app.sh upgrade-check
```

## Hosting (prepared, not deployed)

One container runs both processes: `scripts/start-host.sh` starts the pinned engine on 127.0.0.1:3000 inside the container, then the app on `PORT`. Only the app is reachable from outside. `Dockerfile`, `.dockerignore` and `fly.toml` are for Fly.io. The provider key is set only as a host secret (`ANTHROPIC_API_KEY`); no `.env` goes into the image. Limits stay on, and a volume at `app/logs` keeps the daily spending count across restarts. See DECISIONS 61 to 64.

## Layout

```
app/src/server.ts                 server, engine forwarding, static files
app/src/shared/limits.ts          spending cap and per-visitor limit
app/src/features/<feature>/       recyclopedia, camera-scan, locator, guidelines, reuse
app/data/catalog.json             the approved 50 entries (contracts 5.3)
app/data/reuse-links.json         the four outside links, verified 2026-11-11
app/public/shared/                shell, tokens, item page, memory, share
app/public/features/<feature>/    screens for each feature
app/test/                         tests, by feature, plus e2e/
```

## Not done

zod was upgraded from 4.1.11 to 4.6.6 on 2026-11-17 (DECISIONS 58 to 60); the scored runs used 4.1.11. No deploy, no push. Those wait for Kiley.
