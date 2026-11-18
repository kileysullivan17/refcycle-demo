# RefCycle whole app: results of the third scored build

> RefCycle began as a student concept by a five-person team in the Berkeley UX/UI Boot Camp, UC Berkeley Extension, January 2024. This rebuild and evaluation are solo work.

Approved by Kiley Sullivan, 2026-11-17.

## What was tested

One Claude Fable 5.2 agent built the whole RefCycle app in Claude Code on 2026-11-11, working alone, from the approved PRD, contracts v1.3 and the PRD addendum approved the same day. The whole app adds an intro and Place picker, a Home screen, Place guidelines, a "Give it another life" screen of outside reuse links, device-only memory of the Place and recent items, a share link, and a spending cap with a per-visitor limit.

The scored run covers only the three features the first two builds also built: Recyclopedia, Camera scan and the Recycling center locator. It used the same harness, the same pinned engine on Claude Sonnet 5.5, the same answer keys and the same 36 generated photos as the 2026-11-05 runs. It ran once, on Kiley's Mac, from 20:59 to 21:16 HST on 2026-11-16. Every percentage below carries its count, and a gap of one or two cases between builds is not a finding.

The keys were drafted by Claude from the rules packs; Kiley decided every CHECK row and every naming rule, and did not review all 116 rows. The photos were generated in Higgsfield. Scan scores describe those photos, not real phone photos.

The new screens are not scored. They were checked against the addendum.

## Test split, v2 keys

The v2 keys are the keys the earlier write-up uses (the frozen keys plus the ph22 change). The solo baseline and agent team figures are the published ones.

| Measure | Target | Solo baseline | Agent team | Whole app |
|---|---|---|---|---|
| Confident-wrong, Recyclopedia and Scan | 2% or less | 5.6% (3 of 54) | 5.6% (3 of 54) | 5.6% (3 of 54) |
| Recyclopedia accuracy, answerable | 90% or more | 100% (26 of 26) | 100% (26 of 26) | 100% (26 of 26) |
| Recyclopedia abstention recall | 80% or more | 100% (2 of 2) | 100% (2 of 2) | 100% (2 of 2) |
| Recyclopedia citation validity | 95% or more | 100% (27 of 27) | 100% (28 of 28) | 100% (28 of 28) |
| Locator accuracy | none set | 100% (18 of 18) | 100% (18 of 18) | 100% (18 of 18) |
| Locator facilities shown with no source | 0 | 0 of 32 | 0 of 32 | 0 of 32 |
| Scan: wrong item, no follow-up | 2% or less | 0% (0 of 24) | 0% (0 of 24) | 0% (0 of 24) |
| Scan identification correct | none set | 100% (24 of 24) | 100% (24 of 24) | 95.8% (23 of 24) |
| Scan routed accuracy, answerable | 90% or more | 95.2% (20 of 21) | 95.2% (20 of 21) | 90.5% (19 of 21) |
| Scan over-abstention | 10% or less | 4.5% (1 of 22) | 0% (0 of 22) | 0% (0 of 22) |
| Scan: item and answer both right | none set | 91.7% (22 of 24) | 91.7% (22 of 24) | 87.5% (21 of 24) |
| Page did not show the engine's verdict | none set | 0 of 30 | 0 of 30 | 0 of 30 |

Under the frozen keys, the whole app's scan routed accuracy was 85.7% (18 of 21) and item-and-answer 83.3% (20 of 24); the ph22 change moves one case. All three builds miss the confident-wrong target with the same three Hawaiʻi County HI-5 cases. Counted the practical way described in the earlier RESULTS.md, a reading decided after results, that figure falls to 0 of 54 for this build too. The headline does not use that reading.

## Held-out final, v2 keys

| Measure | Solo baseline | Agent team | Whole app |
|---|---|---|---|
| Confident-wrong, Recyclopedia and Scan | 0% (0 of 16) | 0% (0 of 16) | 0% (0 of 16) |
| Recyclopedia accuracy | 80% (8 of 10) | 90% (9 of 10) | 80% (8 of 10) |
| Locator accuracy | 100% (6 of 6) | 100% (6 of 6) | 83.3% (5 of 6) |
| Scan: item and answer both right | 100% (6 of 6) | 100% (6 of 6) | 83.3% (5 of 6) |

## Every case the whole app got wrong

| Case | Place | Item | Expected | Whole app | Where it came from |
|---|---|---|---|---|---|
| rp13 (test) | Hawaiʻi County | clear plastic water bottle, searched | follow-up (HI-5 or not) | deposit return | Shared engine, same as both earlier builds |
| rp25 (test) | Hawaiʻi County | soda can, searched | follow-up (HI-5 or not) | deposit return | Shared engine, same as both earlier builds |
| ph10 (test) | Hawaiʻi County | soda can photo, no marking | follow-up (HI-5 or not) | deposit return | Shared engine, same as both earlier builds |
| ph19 (test) | Hawaiʻi County | loose AA batteries photo | Special drop-off | asked which item | This build's photo instruction |
| ph21 (test) | Seattle | oil-based paint can photo | Special drop-off | follow-up question | Same as the agent team build |
| rp41 (held-out) | Austin | seltzer bottle | Recycling | conditional (both cases Recycling) | Same as the baseline |
| rp46 (held-out) | Austin | salsa jar | Recycling | conditional (both cases Recycling) | Same as both earlier builds |
| lc28 (held-out) | Hawaiʻi County | clear water bottle, no HI-5 label | the #1 recycler only | also listed the #2-only recycler | Engine answer cited the #2 rule |
| ph36 (held-out) | Austin | a few plastic straws photo | Garbage | asked which item | This build's photo instruction |

Two misses come from code this build wrote. Its instruction to the image model said "multiple" meant more than one distinct thing in the photo, without saying that several of one kind are one item or limiting it to the subject. The model split the straws by color, and counted the batteries' dish as a second item. In both cases the app asked a follow-up question, so neither is a confident wrong answer.

The lc28 miss is the engine's. Its answer was "it depends", and one branch cited hc-plastic-012, the rule for #2 bottles and jugs, so the locator listed that rule's site as the contracts require. In the earlier builds' runs the engine cited only hc-plastic-011 for the same question. This build's runs used the Hawaiʻi County pack after its "before the final run" wording was removed. One run cannot separate run-to-run variation from that change.

## Invented rules, graded blind

The whole app's 90 explanations were shuffled together with the 184 already graded from the two earlier builds and graded by a separate agent that saw only that sheet.

| Grade | Solo baseline | Agent team | Whole app |
|---|---|---|---|
| 2, faithful | 80 | 80 | 79 |
| 1, loose | 12 | 12 | 11 |
| 0, invented | 0 | 0 | 0 |

All three builds were graded in this one pass, so the three columns compare directly. The published grades for the earlier builds (87, 5, 0 and 86, 6, 0) stand unchanged and come from a different grader. The two passes differed on 23 of the 184 earlier rows. Nearly all differences were judgments about whether an item fits a rule's wording, such as a microwave under "electronics" or a juice jug under "bottles and milk jugs". No row moved to or from "invented" in either pass. The loose answers come in the same families in all three builds, which points at the shared engine.

## After the scored run

These changes came after the scored run and do not change its numbers.

- The photo instruction now says that "multiple" means two or more different kinds of item as the subject, that several of one kind are one item, and that what an item rests on is not an item. A five-case check against the live engine on 2026-11-17 identified the batteries and the straws as single items and still asked which item for the two photos that show two different items (ph22, ph24). That check is not a score.
- The same check had the engine cite the #2 rule again for lc28. Nothing in the app was changed for it.
- The scan log now records token counts for cost measurement.

## Cost

The scored run cost 1.75 US dollars in model usage for 94 cases: 90 engine questions and 30 photo identifications. That is about 2 cents a question with scans included. The first measured scans used about 1,900 input tokens and 30 to 40 output tokens each. The demo's cost settings now count 3 cents a question and hold 2 cents per scan, counted at reported usage, which lets the 5 dollar daily cap cover about 166 questions.

## Limits

- One pass per case on a model that is not deterministic.
- The whole app was built by a different model (Fable 5.2) from the earlier builds (Sonnet 5.5), from the same approved PRD and contracts plus the addendum. Model and scope both changed, so this run cannot say which caused a difference.
- The engine and the image model at runtime were the same Sonnet 5.5 for all three builds.
- Keys drafted by Claude from the packs, with Kiley's decisions on every CHECK row.
- Generated photos, uploaded rather than taken with a camera.
- The Hawaiʻi County pack wording changed between the earlier runs and this one.
- The engine's dependency zod 4.1.11 carries a published high-severity advisory; it was left pinned so the engine matches the earlier runs, and must be upgraded before any public deploy.
