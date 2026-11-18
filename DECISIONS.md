# RefCycle whole app: decisions

RefCycle began as a student concept by a five-person team in the Berkeley UX/UI Boot Camp, UC Berkeley Extension, January 2024. This rebuild and evaluation are solo work.

Every choice the PRD, contracts v1.3 and the PRD addendum left open, as built by one Fable 5.2 agent on 2026-11-11. Decisions 1 to 6 were put to Kiley in the plan and approved by him the same day. The rest were made during the build and are his to overturn.

Nothing here changes the PRD, the contracts, a rules pack, the facility list or the engine. Those files are byte-for-byte what the scored base holds.

## Approved by Kiley, 2026-11-11

1. **Starting point.** A new repo seeded from the scored-run base (commit 6920487 of the scored-baseline repo) plus the two later data fixes: S1 (hc-system-000 unlinked from p-hc-01) and the Hawaiʻi County pack wording fix. All three original features were built fresh from the PRD and contracts. The solo baseline's and the team's app code were not opened.

2. **Intro and Place picker are one first-use screen.** The review harness opens `/` in a new browser and expects a Place control on that screen, and contracts 10 puts the picker at `/` when no Place is stored. So the first screen is the short intro with the three Place buttons under it. `/place` is the picker on its own. Any route shows this screen until a Place is chosen, then carries on to where the visitor was going.

3. **Home is at `/home`, and `/` goes there once a Place is stored.** Contracts 10 says `/` redirects to `/recyclopedia`; the addendum makes Home the first screen after choosing a Place. Kiley approved changing that one row for this build. `orchestrator/CONTRACTS.md` itself is not edited.

4. **Limits.** See "Demo limits" below. Kiley's additions: the switch is read only from the server environment, the default is on, a production start refuses to run with limits off and says why, and each has a test.

5. **Hazardous waste heading.** The section is headed "Hazardous waste and special drop-off" and lists every rule whose stream, or one of whose cases, is special drop-off, as written. The app does not decide which of them are hazardous; the screen says the pack does not mark that.

6. **Austin link.** `https://austinreusedirectory.com/`, the address the City of Austin's Austin Resource Recovery blog linked on 2025-08-04, in place of the older Austin EcoNetwork page.

## Reuse links, final list (verified 2026-11-11)

| Place | Title shown | URL | What was checked |
|---|---|---|---|
| Seattle | Donate, Share, Resell, & Buy Used | `https://www.seattle.gov/utilities/protecting-our-environment/sustainability-tips/waste-prevention/at-home/donate-share-resell-and-buy-used` | Live. Seattle Public Utilities. Covers donating, sharing, swapping, buying second-hand and repair. The shorter address in the planning notes redirects here. |
| Austin | Austin Reuse Directory | `https://austinreusedirectory.com/` | Live. The page carries the City of Austin site header. The City's blog post of 2025-08-04 links it. The page needs JavaScript, so its body was not read; who runs it day to day is not stated there, and the app says only that the City's pages link to it. |
| Hawaiʻi County | Reuse Centers at County Recycling and Transfer Stations | `https://www.hawaiizerowaste.org/reuse-2/` | Live. County Department of Environmental Management. Has a section on County reuse centers at recycling and transfer stations. The page names a contact business; the app does not, and describes the centers publicly. |
| All Places | Community Repair Hub | `https://www.ifixit.com/Community/Events` | Live. iFixit's launch post of 2026-06-16 links this address as the Hub and says it was launched with U.S. PIRG. U.S. PIRG's own page returned HTTP 403 to an automated read, so that page was not read directly. |

The links live in `app/data/reuse-links.json`. The app server never fetches them. They are not kept up to date after the build (ADR 0001); each card shows the date it was checked.

## Demo limits

7. **Switch.** `DEMO_LIMITS` in the server environment (or `app/.env`): unset or `on` means on; only the exact value `off` turns limits off; any other value stops the start. No request, header, query string, cookie, body field or browser storage is consulted. `app/src/shared/limits.ts` is the only file that reads it.

8. **When limits may be off.** Only when `NODE_ENV` is not `production` and the app listens on this machine only (`127.0.0.1`, `localhost` or `::1`). `npm start` sets `NODE_ENV=production`. The second condition, refusing limits off on any address other machines can reach, goes one step past what Kiley asked and can be removed if he prefers.

9. **What counts.** One question (`POST /api/ask`) or one scan (`POST /api/identify`) is one use against the visitor's 20 a day. A clarify reply is a new question. Requests that never reach a model are not counted: an engine HTTP 400, an unsupported place, a photo the app rejects, an engine that refuses the connection.

10. **Spending is counted at the worst case for questions.** (Replaced on 2026-11-17 by decision 55; kept as the record of what the scored run was built with.) The pinned engine reports no token usage, so each question is counted as two provider attempts, each with the full instruction text and pack as input (at 2.5 characters per token, deliberately low) and the engine's 4,096-token output ceiling. At Claude Sonnet 5.5 list prices (2 US dollars per million input tokens, 10 per million output, read on 2026-11-11) that is about 0.11 US dollars a question for Seattle and Austin and 0.13 for Hawaiʻi County. **So the 5 dollar cap stops the demo after roughly 39 to 44 questions a day in total**, which two visitors at 20 each can use up. Real spending per question should be several times lower. If the cap proves too tight, raise `DAILY_SPEND_CAP_USD`; the counting method is in `askWorstCaseUsd`. A spending limit set in the provider's console is still the real backstop.

11. **Scans are counted at the provider's reported usage**, with a worst-case amount reserved while the call is in flight. In-flight requests are reserved against the cap so a burst cannot overshoot it.

12. **The day is the UTC day.** Spending is appended to `app/logs/spend.jsonl` (ignored by git) and read back at start, so a restart does not reset the cap. Per-visitor counts live in memory and reset on restart.

13. **Who a visitor is.** A salted SHA-256 of the network address, with a new salt each time the server starts. The address is never stored or logged and no cookie is set. `TRUST_PROXY=1` makes the app use the last `X-Forwarded-For` entry, for a host that puts its own proxy in front; without it the header is ignored. This will need setting correctly for whichever host is chosen.

14. **At a limit.** `/api/ask` and `/api/identify` answer HTTP 429 with `{ "error": "limit_reached", "message": ... }`. The page shows that one message for both limits, no card and no answer, with links to the Recyclopedia list, Place guidelines, Locations and the reuse links. Below the limit `/api/ask` is forwarded unchanged, as contracts 2.1 requires.

## Where the addendum meets the PRD

15. **Addendum over PRD non-goals.** The PRD lists sharing, onboarding, Home, Place-wide guidelines and recent items as non-goals (Q20, Q23). The addendum adds a narrow form of each. The addendum is treated as Kiley's approval for exactly those forms and nothing wider: no splash sequence, no accounts, no full sharing screens, no upcycling ideas, no Handbook, news or tips.

16. **Item page additions.** Below the engine's answer the item page has one Share button and one small link, "Give it another life: outside reuse and repair links". Their wording avoids the five stream labels, "Dispose", "we don't know" and "it depends", because the review harness reads the page text for those. A test holds this.

## Recyclopedia

17. **Search.** Typing filters entries by name on the landing, material and search screens. Enter on text that matches no entry opens the item page with the text as typed (RC-9). Enter on text that matches entries lists them at `/search?q=`. The list always ends with "Ask about “<text>” as typed", so a visitor's own words can reach the engine even when they happen to match an entry name. The contracts require this only when nothing matches; offering it always is a choice.

18. **No coverage marks.** Every entry is listed in every Place. `covered_in` and `rule_ids` are not shown and drive nothing (G4).

## Item page

19. **Wording the app adds.** Section headings ("How to prepare it", "What the local rules say", "Where the rules point", "Sources"), the neutral-state headings ("One question first", "It depends", "We don't know") and one abstain line: "RefCycle has no verified answer for this item in this Place. Check the official source." None of it states a rule.

20. **A clarify reply becomes part of the address.** The reply opens `/item?q=<original> <reply>`, so Back works and a shared link reproduces the same question.

21. **A response that is not shaped like the engine's is the error state**, not a best effort.

## Camera scan

22. **Provider call.** Plain HTTP to the provider, the same way the pinned engine does it, with no SDK added. Temperature 0 is sent and dropped for a model that rejects it. `max_tokens` is 2,048. A refusal from the model is treated as `unclear`; no fallback model is used, because the contract pins the model and logs it.

23. **Label filter.** Besides dropping every field but status, label and candidates, a label that itself carries a verdict or an instruction ("recyclable ...", "goes in ...") is not used and the photo counts as unclear.

24. **Photos are sent as they are** when they are JPEG, PNG or WebP of at most 5 MB. A photo is re-encoded (JPEG, longest side 2,000 px) only when it would otherwise be refused.

25. **The camera is requested when the scan screen opens.** That is the only permission prompt in the app. If it is denied or missing, the screen offers photo upload.

`identify.jsonl` carries token counts (`input_tokens`, `output_tokens`) for cost measurement; see decision 56.

## Locator

26. **Default view is the list**, since the list shows every site and the map only pinned ones.

27. **"Grouped by case" is grouped by cited rule.** The locator receives rule ids, not cases, so an item's sites are shown under each cited rule, with the rule's id, its `applies_to` and its `where` text. A site linked to two cited rules appears under both.

28. **A cited rule with `where` text but no facility record** shows the `where` text. "The rules pack does not name a place for this item" shows only when no cited rule has a site or `where` text.

29. **Past events** show "Check the source for the next event" and the source link, without the old tentative date.

30. **A facility page opened from an item keeps the item's context**, so "the only place that takes this item" is still shown there.

31. **`/api/sites` without `rule_ids`** also returns the pack details of every rule the listed sites link to, so a facility page can list accepted items (LOC-9).

## Place guidelines

32. **Shown per rule:** `applies_to`, stream label or cases, prep, `where`, the location-limited note, the quote, the source (kind, title, link, publisher, date), and the destination quote and source where the pack has them.

33. **Left out:** `also_acceptable` routes (not shown anywhere in this build, G8), `business_page` and `superseded` sources, source notes and observer fields, and `verified_by_ks` (X-13).

34. **Inferred destinations.** A rule with `destination_inferred` shows the engine's own sentence about it, word for word, so the screen says no more and no less than an answer would.

35. **Groups.** Recycling, Compost, Garbage, Deposit return, "Depends on the item" (rules whose cases decide the stream) and "About the local service" (the one rule with no stream and no cases). A rule with a special drop-off case appears under "Depends on the item" and again in the special drop-off section.

36. **Quotes are never text-swapped**; other pack text goes through `displayText` (contracts 9).

37. **No collection days.** The packs carry no schedule fields, so none are shown. Dates that appear inside a rule's own `where` text are shown as written.

## Remembered on the device, and sharing

38. **Keys.** `refcycle.place` (contracts 1) and `refcycle.recent`. Forget removes every key that starts with `refcycle.`.

39. **Recent items.** Up to 8, newest first, shown on Home for the current Place. Each holds the Place, the entry id or the words asked, and a label. Never an answer: reopening one asks the engine again.

40. **Share link.** `/item?entry=<id>&place=<id>` or `/item?q=<text>&place=<id>`. Opening it stores that Place (replacing a different stored Place), removes `place` from the address, and asks the engine. A Place the engine does not list is ignored.

41. **Where there is no share sheet** the link is copied, and where that is not allowed it is shown to copy.

## Shell and look

42. **The header's Place picker is a select**, so the Place can be changed on any screen, and changing it re-renders the screen with the new Place (X-9).

43. **Back stays inside the app.** With no in-app history it goes to Home.

44. **Tokens.** `tokens.css` holds exactly the contract's tokens and no others. Colors mixed from tokens, shadows and extra alias tokens are not used. Tests check every color, font size, radius and spacing value in the app's stylesheets.

45. **Fonts and icons.** Outfit 300, 400, 600 and MuseoModerno 400, 700 from `@fontsource` 5.3.0 (SIL Open Font License, bundled). Heroicons 2.2.0 outline paths (MIT), inlined.

## Server

46. **New routes.** `GET /api/guidelines?place=` and `GET /api/reuse?place=`, loaded after the three contract modules.

47. **Security headers.** A Content-Security-Policy that allows the app's own files and OpenStreetMap tiles only, no inline script or style.

48. **`HOST` setting**, default `127.0.0.1`, for the host that will run the demo.

48a. **Two guards for a public address.** The display-swap log stops growing at 5 MB (logging never blocks display, contracts 9). At a limit, a scan is refused before its upload is read.

## Dependencies and files outside `app/src` and `app/public`

49. **`app/package.json`.** Added `playwright-core` 1.64.1 as a dev dependency (the version the engine already uses) for the browser tests, and a `start` script for production. zod stays at 4.1.11.

50. **`app/.env.example`** gained the limits settings.

51. **`scripts/run-scored-whole-app.sh`** runs the unchanged review harness against this folder. Unlike `run-scored.sh` it never copies a key: `engine/.env` and `app/.env` must already exist.

51a. **Raw answers and grade-only mode (added 2026-11-11 at Kiley's request).** After a run the script runs `scripts/raw-check.mjs`, which confirms every `/api/ask` answer and explanation is saved in `raw/` and, word for word, in the engine's request log, and writes `raw-check.json`. `./scripts/run-scored-whole-app.sh grade <results folder> ...` re-grades finished runs against any `KEYS_DIR` with the harness's own `grade.mjs` and writes the blind invented-rules sheet with the harness's own `blind-export.mjs`. It copies `raw/` into a new folder and never writes to the source. Run on the published `scored-20261105-142835` baseline and team folders with the v2 keys, it reproduced `baseline-keys-v2/grading`, `team-keys-v2/grading` and `blind/` byte for byte. For a single build the exporter is given an empty stand-in second folder, which adds no rows; the instructions line is then rewritten to say the sheet holds one build (see 51b).

51b. **Blind sheet of three builds (Kiley's decision, 2026-11-11).** The blind invented-rules sheet holds baseline, team and whole-app, shuffled together by the harness's own exporter. The live run adds the published `scored-20261105-142835` baseline and team folders by itself (`BLIND_WITH` changes that); grade-only mode takes the three folders as arguments. The harness is not changed: after the export, `scripts/blind-tools.mjs` rewrites the one instructions line that names the number of builds, so it says three (two keeps the harness wording byte for byte). The exporter takes one rules folder for all builds, so the script first checks that the builds' packs print every cited rule the same and refuses a shared sheet if they do not; the whole-app pack differs from the scored packs only in notes and comments, which the sheet does not print. After grading, `./scripts/run-scored-whole-app.sh blind-report <graded blind folder>` reports the whole-app rows on their own and compares the new baseline and team grades with the published graded sheet in `handoff-2026-11-05/blind-grading`, row by row, as a consistency check only. It writes into the new folder, refuses to write into the published one, and the published grades stand whatever the check shows. The 184 published row numbers do not carry over to the new sheet; rows are matched by build, feature and case.

52. **Tests reach further into the engine than the app does.** The app imports only `loadPacks`, the `Pack` and `Rule` types and `loadEnv`, as contracts 2 allows. The tests also start the engine's own server with a fixture in place of the model, the way the review harness's fake engine does.

## After the scored run (2026-11-17)

The scored run of 2026-11-16 (`results/whole-app-20261116-205922`, and the v2 re-grade beside it) is final. Nothing below changes it, its results folders, the engine, the rules packs, the facility list, the keys or the photos. Each item was diagnosed first and changed only on Kiley's go.

53. **Scan: several of one item were read as several items (cases ph19, ph36).** Cause: the app never decides "multiple"; the image model does, from the instruction the app sends. The instruction said multiple means "the photo shows more than one distinct item". That wording counted anything visible, where the baseline and team instructions spoke of the subject of the photo, and it never said that several of one kind are one item. In the run, ph36 (a few straws) came back as three candidates that differed only by color, and ph19 (loose AA batteries) as "old yellow and silver batteries" and "shallow metal dish or jar lid". The same photos were "identified" in the baseline and team runs. Fix, on Kiley's go: the instruction now says multiple means two or more different kinds of item are the subject of the photo; several of the same kind are one item, named in the plural; a difference in color, pattern or size alone does not make a different item; whatever the item rests on or in is not an item; and for two different kinds the model must answer "multiple" and never choose. The app code that handles the reply is unchanged: it does not merge candidates that look alike, because that would be the app picking an item, and an "identified" label still goes to the "Is that right?" screen before the engine is asked. Tests use fake model answers for several of one item, two different items and one item. They show what the app does with each reply; only a live check shows that the model follows the instruction. This is a choice the contract leaves open (contracts 4 says only "more than one item").

54. **Locator lc28: no change. The engine cited the rule.** For "clear water bottle with no HI-5 label" in Hawaiʻi County the engine's own answer cited `hc-plastic-006`, `hc-plastic-011` and `hc-plastic-012` (the same in the harness's raw record and in the engine's request log), as an "it depends" answer with a branch for "#2 plastic bottle or jug (see hc-plastic-012)". The app listed f-hc-07 because that site's rule is `hc-plastic-012`: by contract, a site is listed when a rule the engine's answer cited points to it, and the app matches on cited rule ids only, never on materials or categories. So this is engine behavior and not the app's to fix. In the baseline and team runs the engine cited only `hc-plastic-011` for the same case. One run cannot separate run-to-run variation from the Hawaiʻi County pack wording fix in this build's base, which changed the "observed" date text the engine prints for these two field reports.

55. **Price settings for the spending cap (replaces decision 10).** Measured on the scored run: 1.75 US dollars in total; 90 engine questions, which took 102 model attempts (12 retries); 30 identification calls (26 identified, 4 multiple), counted from `server-logs/identify.jsonl`. Neither log held token counts and the spending ledger is not written with limits off, so the split between questions and scans is an estimate: a scan at about 0.004 to 0.011 dollars (one image of about 1,600 to 4,800 tokens, a 350-token instruction, about 50 tokens out, at 2 dollars in and 10 out per million), so 0.13 to 0.32 for 30 scans, leaving 0.016 to 0.018 a question; with scans counted as free, 1.75 / 90 = 0.0194. One and a half times that is 0.029. Settings, on Kiley's go: `ASK_COST_USD=0.03`, a flat amount per question; `SCAN_COST_USD=0.02`, held against the cap while a scan runs, with the scan then counted at the usage the provider reports (0.02 is counted only if it reports none). With the 5 dollar cap that is 166 questions a day, or 100 scans each followed by its question; the 20 a day per visitor still applies. The worst-case counting it replaces allowed about 39 to 44. The flat amount is an average and not a ceiling: one question with a retry and the longest answer can cost about 0.13, so real spending can pass 5 dollars on a day the counter reads 5. A spending limit in the provider's console remains the real backstop.

56. **`identify.jsonl` now records token counts.** Each line gains `input_tokens` and `output_tokens`, as the provider reported them, or null when it reported none or the call failed, so the next run measures scan cost. Asked for by Kiley on 2026-11-17. Contracts 4 lists the log as "time, status, label, model and duration only"; the contract text was not edited and still reads that way. The photo is still never logged.

57. **Post-run fix-check.** `./scripts/run-scored-whole-app.sh fix-check <case ids>` runs only the named cases against the live engine, to see what the app does after a fix. It is not a score: it writes to its own `postrun-fix-check-<date-time>` folder under the build label `whole-app-postrun-check`, refuses an existing folder, writes `POST-RUN-CHECK.txt`, and runs no grading and no blind export. It passes the harness's `--scored` switch only because the harness will not run test and held_out cases without it.

## Deploy prep (2026-11-17)

58. **zod 4.1.11 to 4.6.6.** Approved in the PRD addendum (decision 15) and asked for by Kiley on 2026-11-17. The published advisory is GHSA-mrhx-c7xc-m3w5 (zod can exhaust memory while validating oversized constrained collections; high; every version before 4.6.6). 4.6.6 is the first release that fixes it; the current release is 4.6.7. Before: 4.1.11 in `engine/code` and in `app`. After: 4.6.6 in both, each in `package.json` and `package-lock.json`, and nothing else in the engine changed. Every scored run, the v2 regrade and the fix-check of 2026-11-17 used 4.1.11. The engine's own tests read 25 of 26 before and after; the one failure (R12 and R13 in `test/behavior.test.ts`) expects the words "Field observation" for hc-plastic-011 and hc-plastic-012, whose source in the packs is a field report (a phone call), printed as "Field report"; it fails the same way on both versions. `engine/code/PINNED.md` records this.

59. **The app's zod was upgraded with the engine's.** Kiley's instruction named `engine/code`. The app is the process that faces the internet and checks every request body with zod, so leaving it on 4.1.11 would have left the advisory open on the public side. It is its own commit, so it can be undone alone.

60. **Post-upgrade check mode.** `./scripts/run-scored-whole-app.sh upgrade-check [<case ids>]` is a check after the upgrade, not a score. With case ids it runs those cases and prints the readout, as the fix-check does. With none it runs all 94 test and held_out cases and grades them against the frozen keys for comparison only. Either way it writes to a new `post-upgrade-check-<date-time>` folder under the build label `whole-app-post-upgrade-check`, with a `POST-UPGRADE-CHECK.txt` that says what it is; it refuses an existing folder and never makes a blind sheet. A plain scored run is now refused, because this build is no longer on zod 4.1.11 and the scored run is final.

61. **Host: Fly.io, one container for both processes.** Chosen by Kiley on 2026-11-17 (Render was the alternative). The engine listens on 127.0.0.1:3000, fixed in its code, so it cannot be a service of its own without changing it. `scripts/start-host.sh` starts the engine, waits for it, then starts the app on `PORT` with `HOST=0.0.0.0`; if either process stops, both stop and the host restarts the container. Only the app is reachable from outside. Fly deploys from the local folder, so no GitHub repo is needed.

62. **Visitor address on Fly (adds to decision 13).** On Fly the last `X-Forwarded-For` entry is the app's own address, so `TRUST_PROXY=1` would count every visitor as one and the whole demo would stop after 20 questions a day. New server setting `TRUST_FLY_CLIENT_IP=1`: the app then reads the address Fly's proxy writes in `Fly-Client-IP`. With the setting off the header is ignored, so nobody can send it to pose as a new visitor; a test checks that. With it on and no header, the connection's own address is used. The two settings cannot both be on. The address is still hashed with a per-process salt and never stored or logged.

63. **What the host is given.** `NODE_ENV=production`, `PORT=8080` and `TRUST_FLY_CLIENT_IP=1` in `fly.toml`; `ANTHROPIC_API_KEY` only as a Fly secret, set by Kiley. No `.env` is in the image (`.dockerignore`) and the start script reads none. `DEMO_LIMITS` is set nowhere, so limits are on, and the app still refuses a production start with them off. A 1 GB volume at `app/logs` holds the spending ledger, so a restart or deploy does not reset the daily cap. One machine, always on (512 MB), because the per-visitor counts live in memory. The image runs Node 26, the version the tests ran on.

64. **`fly.toml` was written with the three files Kiley listed.** He asked for the Dockerfile, the start script and `.dockerignore`. `fly.toml` holds the volume, the always-on setting and the address setting, which have no other home; it creates nothing on Fly by existing. App name `refcycle-demo` and region `ewr` are proposals and are his to change. The image could not be built here (no Docker on this Mac), so the first build is the first `fly deploy`.

## First Fly deploy (2026-11-18)

65. **Region `sjc`.** Kiley's choice on 2026-11-18, replacing the proposed `ewr` (San Jose is on Fly's region list; `sea` was the fallback). The volume and the one machine are both in `sjc`.

66. **App and volume created on Fly, nothing deployed yet.** On Kiley's go of 2026-11-18: app `refcycle-demo` in his personal organization (the name was free; an app with no machine costs nothing) and one encrypted 1 GB volume `refcycle_logs` in `sjc` (0.15 dollars a month; its daily snapshots, kept 5 days, fall inside Fly's free snapshot allowance). The `.fly.dev` address only: no DNS record, no certificate, no custom domain, no dedicated IPv4. Kiley sets `ANTHROPIC_API_KEY` as a Fly secret from his own Terminal; this session never sees it.

67. **First deploy, to `refcycle-demo.fly.dev` only.** `fly deploy --remote-only --ha=false` on 2026-11-18: built on Fly's remote builder (113 MB image) and started one machine in `sjc` with the volume attached. The first attempt built but the push to Fly's registry was refused (403); the same command run again went through, with no change to any file. Fly assigned a shared IPv4 and an IPv6 address, both free; no dedicated IPv4. Checked with curl: the page and its files load over HTTPS and plain HTTP redirects to HTTPS; the machine's settings show `NODE_ENV=production` and the start line reads "limits on: 5 US dollars a day, 20 questions or scans per visitor a day"; one question ("glass jar", Seattle) came back from the engine citing `sea-glass-014` and was written to the spending ledger on the volume (0.03); port 3000 refuses connections from outside. Not checked: that the app counts the visitor's own address. By decision 62 the app never logs an address, so its logs cannot show one; this is open and is Kiley's call.

68. **A log line for where the visitor address came from (adds to decision 62).** Asked for by Kiley on 2026-11-18, to check the address setting on the live site. For each counted question or scan, with limits on, the app prints one line such as "Counted ask: visitor address from the Fly-Client-IP header; public address". It names the source (the Fly-Client-IP header, the X-Forwarded-For header, or the connection) and one of "public address", "not a public address" or "not an address". It never holds the address, any part of it, or the visitor key; a test checks that no digit appears in the line. The address is still never stored or logged.

69. **Address check on the live site, and the custom domain.** After the redeploy of 2026-11-18, one question sent from Kiley's network produced the line "Counted ask: visitor address from the Fly-Client-IP header; public address", so the app counts the visitor's own address and not Fly's proxy. Kiley added a CNAME at Squarespace Domains (`refcycle` to `refcycle-demo.fly.dev`, TTL 1 hour) and asked for the certificate: `fly certs add refcycle.kileysullivan.com -a refcycle-demo` (Let's Encrypt, issued within a minute; Fly charges nothing for it). The site answers at `https://refcycle.kileysullivan.com` and at `https://refcycle-demo.fly.dev`.

## Not done, on purpose

- No push to any git remote.
- No model call was made during the build or the post-run fixes. Kiley runs every live run.
- `orchestrator/CONTRACTS.md` still says `/` redirects to `/recyclopedia` (decision 3).
