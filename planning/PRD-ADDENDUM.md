# RefCycle whole app: PRD addendum

> RefCycle began as a student concept by a five-person team in the Berkeley UX/UI Boot Camp, UC Berkeley Extension, January 2024. This rebuild and evaluation are solo work.

Approved by Kiley Sullivan, 2026-11-11, from the scope grill. Adds to the approved PRD and contracts v1.3; changes neither. Where this addendum and the PRD or contracts disagree, the PRD and contracts win and the conflict comes back to Kiley.

## Unchanged

- No feature writes, edits or infers recycling rules. Every answer comes from the pinned Build B engine.
- Public rules packs only; private businesses are shown by public description, never by name.
- Places: Seattle, Austin, Hawaiʻi County.
- Recyclopedia, Camera scan and the Recycling center locator exactly as specified in the PRD and contracts v1.3.
- Design tokens: contracts v1.3, section 11, for every screen, new ones included.

## Purpose

A public portfolio demo with no promise of upkeep (ADR 0001).

## New screens

1. **Intro**: one short screen saying the demo covers three Places only and is not kept up to date. No splash sequence.
2. **Place picker**: choose Seattle, Austin or Hawaiʻi County. No device location and no location permission prompt.
3. **Home**: routes to Recyclopedia, Camera scan, the locator, Place guidelines and Give it another life. No content of its own; no Handbook, news or tip of the day.
4. **Place guidelines**: a read-only view of the Place's rules pack: its system summary, rules grouped by stream with each rule's quote and source, a hazardous waste section built from the special drop-off rules, and a link to the official contact page. No collection-day schedules unless the pack states them.
5. **Give it another life**: outside reuse and repair links for the Place, clearly labeled as outside resources. Candidates to verify before the build: the Austin Reuse Directory; Seattle Public Utilities' donate, share, resell and buy used page; Hawaiʻi County's reuse centers at County recycling and transfer stations (public description only); the Community Repair Hub from iFixit and U.S. PIRG. Each item page shows a small link to this screen below the engine's answer; the link never changes the answer.

## Cross-cutting

- **Remembered on the device**: the chosen Place and recent items, in the browser only, with a clear way to forget them. No accounts, no sign-in.
- **Sharing**: one share button using the device's own share sheet. The link carries the Place and item, never the answer text.
- **Out**: upcycling ideas and instructions, the full sharing screens, accounts.

## Hosting and cost (ADR 0002)

- Live at a subdomain such as refcycle.kileysullivan.com, on a host that runs server code. The provider key stays server-side.
- Hard daily spending cap: 5 US dollars. Per-visitor limit: 20 questions or scans per day.
- At either limit: a plain message saying the demo has reached its limit, while everything that needs no model call keeps working. Never a guessed or cached answer in place of the engine's.

## Build and scoring

- One Fable 5.2 agent builds the whole app in Claude Code on Kiley's Mac.
- The three original features run through the same harness against the frozen and v2 keys as a third scored build, on the pinned engine. New screens are checked against this addendum, not scored.
- Then zod is upgraded past 4.1.11, the engine's own tests are re-run, and only then does anything deploy.
