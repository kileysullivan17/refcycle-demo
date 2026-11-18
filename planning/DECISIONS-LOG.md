# Scope grill decisions, 2026-11-11

Feeds the PRD addendum. Decided by Kiley Sullivan.

1. Purpose: public portfolio demo, no promise of upkeep (ADR 0001).
2. Home: a simple home screen that only routes to the three features. No Handbook, news or tip of the day.
3. Place guidelines: a per-Place guidelines screen built only from the rules pack, read-only: the pack's system summary, its rules grouped by stream with each rule's quote and source, and a link to the official contact page. Checked 2026-11-11: the packs carry almost no collection-day schedules, so the screen shows no collection days unless the pack states them.
4. Upcycling: craft ideas and instructions stay out; the Upcycle button stays hidden. Replaced (revisited 2026-11-11) by a per-Place "Give it another life" screen of outside reuse and repair links only, clearly labeled as outside resources, plus a small link to it below the engine's answer on each item page. The link never changes the answer. Candidate links found 2026-11-11, to verify before the build: Austin Reuse Directory (Austin EcoNetwork, supported by Austin Resource Recovery); Seattle Public Utilities' donate, share, resell and buy used page; Hawaiʻi County's reuse centers at County recycling and transfer stations (named by public description, no operator business name); iFixit and U.S. PIRG's Community Repair Hub for repair events everywhere.
5. Onboarding and location: one short intro screen (says the demo covers three Places only and is not kept up to date), then a Place picker. No splash sequence, no device location, no location permission prompt.
6. Accounts: none. The browser remembers the chosen Place and recent items on the person's own device only; nothing is sent to a server for this. A clear way to forget them is included.
7. Sharing: one share button using the device's own share sheet, sending a link to an item's answer. The link carries the Place and item, not the answer text, so whoever opens it gets the engine's current answer.
8. Hosting and cost: live hosted demo with a hard daily spending cap and a per-visitor limit; provider key server-side only (ADR 0002).
9. At the cap: a plain message that the demo has reached today's limit, while everything that needs no model keeps working (catalog browsing, Place guidelines, reuse links, the locator's sourced lists where they need no model call). Never a guessed or cached answer in place of the engine's.
10. Daily spending cap: 5 US dollars, raised only if real visitors keep hitting it.
11. Per-visitor limit: 20 questions or scans per visitor per day, then the same limit message as the daily cap.
12. Look: keep the 2024 design tokens fixed in contracts v1.3 (section 11) across the whole app; no new design system. New screens use the same tokens. (Kiley first chose a fresh system, then kept the contract once the conflict with the settled contracts was raised.)
13. Address: a subdomain, refcycle.kileysullivan.com (or similar), on a host that runs server code so the provider key stays server-side. DNS is at Squarespace Domains.

14. Scoring: the three original features (Recyclopedia, Camera scan, locator) run through the same harness against the frozen and v2 keys, as a third scored build. New screens are checked against this addendum, not scored.
15. Order: score the three original features on the pinned engine first (zod 4.1.11, as in the first two builds), then upgrade zod past the advisory, re-run the engine's own tests, and only then deploy.
16. Build structure: one Fable 5.2 agent builds the whole app in Claude Code, from the approved PRD, contracts v1.3 and this addendum. No orchestrator or builder team (the team eval found at least 2.4 times the build tokens for the same scores).
17. Hazardous waste: a section inside Place guidelines, built from the pack's special drop-off rules with their quotes and sources. No separate screen.
