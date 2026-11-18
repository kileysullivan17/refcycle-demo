Pinned from Build B (Codex), local repo refcycle-b at commit 486bf17 (M5), copied 2026-11-05.
Excluded: .env, node_modules, logs, artifacts, and its rules packs (which name private businesses).
rules/ points at engine/rules, the public packs from kileysullivan17/refcycle-eval.

One change since the pin, 2026-11-17, on Kiley's word (PRD addendum, decision 15; whole-app DECISIONS.md 58):
zod 4.1.11 to 4.6.6 in package.json and package-lock.json, for advisory GHSA-mrhx-c7xc-m3w5 (fixed in 4.6.6).
Nothing else in the engine changed. Every scored run and the fix-check of 2026-11-17 used zod 4.1.11.
The engine's own tests read 25 of 26 passing before and after the upgrade. The one failing test, "R12 and
R13: field observations include date and exact site; superseded sources never cited" in test/behavior.test.ts,
expects the words "Field observation" in the explanations of hc-plastic-011 and hc-plastic-012. In the
packs those two rules cite a source of kind field_report (a phone call), which the engine prints as "Field
report", so the test fails. It fails the same way on 4.1.11 and on 4.6.6; zod has no part in it.

## Changes in the published copy (kileysullivan17/refcycle-demo, 2026-11-18)

The same edits as in kileysullivan17/refcycle-team-eval. None touch rules, prompts or runtime logic.

- test/behavior.test.ts (R12 and R13 test) and src/behavior-eval.ts (field-pet and field-hdpe cases): private business names and a street name replaced with the public descriptions the public packs use ("A private recycler in Hilo", "A private recycler in the Shipman Industrial Park").
- eval/dev.csv: one row's field observation note, the same replacement.
- DECISIONS.md headings and the page title in public/index.html: em dashes replaced with colons. README.md: a numeric range written with "to".
