# RefCycle whole app

> RefCycle began as a student concept by a five-person team in the Berkeley UX/UI Boot Camp, UC Berkeley Extension, January 2024. This rebuild and evaluation are solo work.

The whole RefCycle app, built by one Claude Fable 5.2 agent in Claude Code from the approved PRD, contracts v1.3 and a PRD addendum, then scored as the third build in the RefCycle evals. It runs as a public portfolio demo at [refcycle.kileysullivan.com](https://refcycle.kileysullivan.com), with a daily spending cap and a per-visitor limit, and with no promise that its recycling rules stay current.

Earlier evals: [kileysullivan17/refcycle-eval](https://github.com/kileysullivan17/refcycle-eval) built and scored the guidance engine; [kileysullivan17/refcycle-team-eval](https://github.com/kileysullivan17/refcycle-team-eval) built three features twice, by a solo agent and an agent team.

## Read first

[writeup/RESULTS-WHOLE-APP.md](writeup/RESULTS-WHOLE-APP.md) has the scored results, every miss and where it came from, the blind invented-rules grading, the fixes made after the run, and the cost.

## Folders

| Folder | What it holds |
|---|---|
| `app/` | The app: server, screens, tests, and `.env.example` |
| `engine/` | The guidance engine from the first eval, pinned (see `engine/code/PINNED.md`), with the public rules packs and the facility list |
| `planning/` | The whole-app scope decisions: the approved PRD addendum, the decision log, the glossary and two decision records |
| `orchestrator/` | The approved PRD, contracts v1.3 and the gate decisions shared with the earlier builds |
| `specs/` | The list of 2024 Figma frames. The 2024 team's deck and Figma file are theirs and are not published here |
| `scripts/` | The scored-run script (check, run, grade-only, blind export, fix-check and upgrade-check) and the host start script |
| `results/` | The scored run's grading, the v2 regrade, the blind grading of all three builds, and two post-run checks that are not scores |
| `writeup/` | The approved results write-up |

`DECISIONS.md` records every choice the specs left open. `Dockerfile` and `fly.toml` are how the demo is hosted.

## Three things to know

- The answer keys were drafted by Claude from the rules packs. Kiley Sullivan decided every row marked CHECK and every naming rule; he did not review each of the 116 rows himself. The keys and photos are published in refcycle-team-eval.
- The 36 photos were generated in Higgsfield. Scan scores describe those photos, not real phone photos.
- Three Hawaiʻi County HI-5 cases are scored as misses under the frozen key. The write-up explains why and gives the practical reading beside the headline.

## Not here

Private business names never appear: private sites are described publicly. Raw model answers, server logs, screenshots, any `.env` file and any provider key are not published.
