#!/usr/bin/env bash
# RefCycle whole-app build: scored run of the three original features, for Kiley's Mac, from his own
# Terminal (model calls must reach the provider, which a sandboxed shell cannot do).
#
#   cd ~/refcycle-builds/refcycle-whole-app
#   ./scripts/run-scored-whole-app.sh          # checks, then the scored run and the grading
#   ./scripts/run-scored-whole-app.sh check    # only the checks (no servers, no model calls, no cases)
#   ./scripts/run-scored-whole-app.sh grade <results folder> [<results folder> ...]
#                                              # grade-only: re-grade finished runs against KEYS_DIR and export
#                                              # the blind invented-rules sheet. No servers, no model calls.
#   ./scripts/run-scored-whole-app.sh fix-check <case ids, comma-separated>
#                                              # POST-RUN CHECK, NOT A SCORE: runs only the named cases against
#                                              # the live engine, into its own postrun-fix-check-<date-time>
#                                              # folder, and prints what the app did. No grading, no blind sheet.
#   ./scripts/run-scored-whole-app.sh upgrade-check [<case ids, comma-separated>]
#                                              # POST-UPGRADE CHECK, NOT A SCORE: after the zod upgrade (4.1.11
#                                              # to 4.6.6). With case ids, those cases and the readout, as a
#                                              # fix-check. With none, all the test and held_out cases, graded
#                                              # against KEYS_DIR for comparison only. Always its own new
#                                              # post-upgrade-check-<date-time> folder; never a blind sheet.
#   ./scripts/run-scored-whole-app.sh blind-report <graded blind folder>
#                                              # after the blind sheet is graded: the whole-app rows on their
#                                              # own, and baseline and team against the published grades.
#
# Grade-only mode. Each <results folder> is one build's folder from a finished run (the one holding raw/ and
# run-meta.json). It is never written to: raw/, cases.jsonl and run-meta.json are copied into a new folder
# and graded there with the harness's own grade.mjs, then blind-export.mjs writes blind-sheet.csv,
# unblind-map.csv and GRADER-INSTRUCTIONS.txt for all the folders given, shuffled together.
#   KEYS_DIR=~/refcycle-builds/refcycle-private/keys-v2-2026-11-05 \
#     ./scripts/run-scored-whole-app.sh grade <scored>/baseline <scored>/team <whole-app run>/whole-app
#   GRADE_OUT    where the re-grade goes   default: <REVIEW_DIR>/results/regrade-<keys folder name>-<date-time>
#   RULES_DIR, FACILITIES_CSV              default: the engine/rules and engine/data/facilities.csv of the
#                                          build each run names in run-meta.json, else this build's
#   BLIND_SEED   shuffle seed              default: 20261105 (the harness default)
#
# The blind sheet. Kiley's decision (2026-11-11): the sheet holds three builds, baseline, team and whole-app,
# shuffled together, and the grader instructions say three builds. The live run adds the two published
# builds by itself (BLIND_WITH); in grade-only mode, pass all three folders. Once the sheet is graded,
# blind-report lists the whole-app rows on their own and compares the new baseline and team grades with the
# published ones, as a consistency check only. Published results are read and never changed.
#   BLIND_WITH        results folders to put on the live run's sheet with the whole-app build, colon-separated
#                     default: <REVIEW_DIR>/results/scored-20261105-142835/baseline and .../team
#   PUBLISHED_BLIND   the published graded sheet   default: ~/refcycle-builds/handoff-2026-11-05/blind-grading
#
# This is the per-build part of refcycle-scored/review/run-scored.sh, pointed at this folder. The review
# harness itself (run.mjs, lib/, grade/) is used exactly as it is and is not copied or changed.
#
# Two differences from run-scored.sh, both on purpose:
#   1. It never copies a key. engine/.env and app/.env must already exist, filled in by Kiley.
#   2. It starts the app with DEMO_LIMITS=off, on 127.0.0.1 only, because the harness asks far more than
#      20 questions from one address. The setting lives in this one command and nowhere else.
#
# Settings (environment, all optional):
#   REVIEW_DIR   the review folder      default: ~/refcycle-builds/refcycle-scored/review
#   KEYS_DIR     answer keys folder     default: ~/refcycle-builds/refcycle-private/frozen-2026-11-05
#   CHROME_PATH  Chrome executable      default: Google Chrome, found by playwright-core
#   REPEATS      runs of every case     default: 1
#   RESULTS_DIR  results folder         default: <REVIEW_DIR>/results/whole-app-<date-time>
set -euo pipefail

BUILD="$(cd "$(dirname "$0")/.." && pwd)"
REVIEW="${REVIEW_DIR:-$HOME/refcycle-builds/refcycle-scored/review}"
KEYS_DIR="${KEYS_DIR:-$HOME/refcycle-builds/refcycle-private/frozen-2026-11-05}"
REPEATS="${REPEATS:-1}"
STAMP="$(date +%Y%m%d-%H%M%S)"
RESULTS_DIR="${RESULTS_DIR:-$REVIEW/results/whole-app-$STAMP}"
WHICH="${1:-run}"

ENGINE_PROVIDER="anthropic"
ENGINE_MODEL="claude-sonnet-5-5"
IMAGE_PROVIDER="anthropic"
IMAGE_MODEL="claude-sonnet-5-5"

say() { printf '\n== %s\n' "$*"; }
die() { printf '\nSTOPPED: %s\n' "$*" >&2; exit 1; }
port_busy() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
has_key() { [ -f "$1" ] && grep -Eq '^[[:space:]]*(export[[:space:]]+)?ANTHROPIC_API_KEY=.+' "$1"; }

case "$WHICH" in run|check|grade|blind-report|fix-check|upgrade-check) ;; *) echo "Usage: ./scripts/run-scored-whole-app.sh [check | fix-check <case ids> | upgrade-check [<case ids>] | grade <results folder> ... | blind-report <graded blind folder>]" >&2; exit 2 ;; esac

# A fix-check is a post-run check of a few named cases after a fix. It is not a score: it goes to its own
# folder, under its own build label, and is never graded or put on a blind sheet.
CASES=""; BUILD_LABEL="whole-app"; CHECK=""; CHECK_NOTE=""; CHECK_WHY=""
if [ "$WHICH" = "fix-check" ]; then
  CASES="${2:-}"
  [[ "$CASES" =~ ^[A-Za-z0-9_-]+(,[A-Za-z0-9_-]+)*$ ]] || die "Give the case ids, comma-separated: ./scripts/run-scored-whole-app.sh fix-check ph19,ph36,lc28-haw"
  BUILD_LABEL="whole-app-postrun-check"
  RESULTS_DIR="${FIX_CHECK_DIR:-$REVIEW/results/postrun-fix-check-$STAMP}"
  [ ! -e "$RESULTS_DIR" ] || die "$RESULTS_DIR already exists; a fix-check never writes into an existing results folder."
  CHECK="POST-RUN CHECK"; CHECK_NOTE="POST-RUN-CHECK.txt"
  CHECK_WHY="These cases were run again after a fix, to see what the app now does. Nothing here is graded,"
fi

# A post-upgrade check is run after the zod upgrade (4.1.11 to 4.6.6, engine and app), to see that the app
# behaves as it did. It is not a score either: its own new folder and build label, and never a blind sheet.
# With case ids it is those cases and the readout; with none it is every test and held_out case, graded
# against the keys for comparison only. The scored runs used zod 4.1.11 and are final.
if [ "$WHICH" = "upgrade-check" ]; then
  CASES="${2:-}"
  [ -z "$CASES" ] || [[ "$CASES" =~ ^[A-Za-z0-9_-]+(,[A-Za-z0-9_-]+)*$ ]] || die "Give the case ids, comma-separated, or none for every case: ./scripts/run-scored-whole-app.sh upgrade-check ph19,ph36,lc28-haw"
  BUILD_LABEL="whole-app-post-upgrade-check"
  RESULTS_DIR="${UPGRADE_CHECK_DIR:-$REVIEW/results/post-upgrade-check-$STAMP}"
  [ ! -e "$RESULTS_DIR" ] || die "$RESULTS_DIR already exists; a post-upgrade check never writes into an existing results folder."
  CHECK="POST-UPGRADE CHECK"; CHECK_NOTE="POST-UPGRADE-CHECK.txt"
  if [ -n "$CASES" ]; then
    CHECK_WHY="These cases were run after the zod upgrade (4.1.11 to 4.6.6, engine and app). The scored runs used 4.1.11. Nothing here is graded,"
  else
    CHECK_WHY="Every test and held_out case was run after the zod upgrade (4.1.11 to 4.6.6, engine and app). The scored runs used 4.1.11. The grading here is for comparison only,"
  fi
fi

# The rules folder of the build a results folder came from (RULES_DIR overrides; this build's is the fallback).
rules_of() {
  local d
  if [ -n "${RULES_DIR:-}" ]; then echo "$RULES_DIR"; return; fi
  d="$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).build_dir || ""' "$1/run-meta.json")"
  if [ -n "$d" ] && [ -d "$d/engine/rules" ]; then echo "$d/engine/rules"; else echo "$BUILD/engine/rules"; fi
}

# Writes the blind invented-rules sheet for one or more results folders with the harness's own exporter,
# then makes the grader instructions name the number of builds really on the sheet.
# The exporter wants at least two folders; for a single build an empty stand-in is passed, which adds no rows.
# It also takes one rules folder for all builds, so the builds' packs must print every cited rule the same.
blind_export() { # out folder, results folders...
  local out="$1"; shift
  local args=() packs=() d r stub=""
  for d in "$@"; do
    args+=(--results "$d")
    r="$(rules_of "$d")"
    case " ${packs[*]-} " in *" $r "*) ;; *) packs+=("$r") ;; esac
  done
  if [ "${#packs[@]}" -gt 1 ]; then
    node "$BUILD/scripts/blind-tools.mjs" packs-agree --harness "$REVIEW/harness" "${packs[@]}" \
      || { echo "These builds cannot share one blind sheet: their rules packs print cited rules differently."; return 1; }
  fi
  if [ "$#" -lt 2 ]; then
    stub="$(mktemp -d)"
    printf '{"build":"none"}\n' > "$stub/run-meta.json"
    args+=(--results "$stub")
  fi
  node "$REVIEW/harness/grade/blind-export.mjs" export "${args[@]}" --rules "${packs[0]}" --out "$out" --seed "${BLIND_SEED:-20261105}" || return 1
  [ -z "$stub" ] || rm -rf "$stub"
  node "$BUILD/scripts/blind-tools.mjs" instructions "$out" "$#" || return 1
  echo "  builds on the sheet: $#. Grade blind-sheet.csv, then: ./scripts/run-scored-whole-app.sh blind-report $out"
}

# ---------- blind report: files in, files out; reads the published sheet, never writes it ----------
if [ "$WHICH" = "blind-report" ]; then
  [ "$#" -eq 2 ] && [ -d "$2" ] || die "Give the graded blind folder: ./scripts/run-scored-whole-app.sh blind-report <graded blind folder>"
  command -v node >/dev/null || die "Node is not installed (Node 20 or later is needed)."
  PUBLISHED_BLIND="${PUBLISHED_BLIND:-$HOME/refcycle-builds/handoff-2026-11-05/blind-grading}"
  [ -d "$PUBLISHED_BLIND" ] || die "Published blind grading not found: $PUBLISHED_BLIND (set PUBLISHED_BLIND)."
  node "$BUILD/scripts/blind-tools.mjs" report --blind "$2" --published "$PUBLISHED_BLIND" || die "The blind report could not be written."
  echo "Written: $2/blind-report.md and blind-report.json. The published results were only read."
  exit 0
fi

# ---------- grade-only mode: files in, files out; no servers, no model calls ----------
if [ "$WHICH" = "grade" ]; then
  shift
  [ "$#" -ge 1 ] || die "Give at least one results folder: ./scripts/run-scored-whole-app.sh grade <results folder> ..."
  command -v node >/dev/null || die "Node is not installed (Node 20 or later is needed)."
  [ -f "$REVIEW/harness/grade/grade.mjs" ] || die "Review harness not found at $REVIEW (set REVIEW_DIR)."
  [ -d "$KEYS_DIR" ] || die "Keys folder not found: $KEYS_DIR (set KEYS_DIR)."
  if [ ! -d "$REVIEW/harness/node_modules/csv-parse" ] || [ ! -d "$REVIEW/harness/node_modules/yaml" ]; then
    ( cd "$REVIEW/harness" && npm ci --no-audit --no-fund >/dev/null ) || die "Harness packages could not be installed (npm ci in review/harness)."
  fi
  KEYS_DIR="$(cd "$KEYS_DIR" && pwd)"
  GRADE_OUT="${GRADE_OUT:-$REVIEW/results/regrade-$(basename "$KEYS_DIR")-$STAMP}"
  [ ! -e "$GRADE_OUT" ] || die "$GRADE_OUT already exists; choose another GRADE_OUT."
  mkdir -p "$GRADE_OUT"
  GRADE_OUT="$(cd "$GRADE_OUT" && pwd)"
  say "Grade-only: keys $KEYS_DIR; output $GRADE_OUT"
  GRADED=()
  for SRC in "$@"; do
    [ -d "$SRC/raw" ] && [ -f "$SRC/run-meta.json" ] || die "Not a finished build results folder (needs raw/ and run-meta.json): $SRC"
    SRC="$(cd "$SRC" && pwd)"
    case "$SRC/" in "$GRADE_OUT"/*) die "A results folder cannot be inside the output folder." ;; esac
    NAME="$(basename "$SRC")"
    DEST="$GRADE_OUT/$NAME"
    [ ! -e "$DEST" ] || die "Two results folders are both named $NAME; grade them in separate runs."
    BUILD_DIR="$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).build_dir || ""' "$SRC/run-meta.json")"
    RULES="${RULES_DIR:-}"; FAC="${FACILITIES_CSV:-}"
    if [ -z "$RULES" ]; then if [ -n "$BUILD_DIR" ] && [ -d "$BUILD_DIR/engine/rules" ]; then RULES="$BUILD_DIR/engine/rules"; else RULES="$BUILD/engine/rules"; fi; fi
    if [ -z "$FAC" ]; then if [ -n "$BUILD_DIR" ] && [ -f "$BUILD_DIR/engine/data/facilities.csv" ]; then FAC="$BUILD_DIR/engine/data/facilities.csv"; else FAC="$BUILD/engine/data/facilities.csv"; fi; fi
    say "$NAME: copying raw answers (the source folder is not changed)"
    mkdir -p "$DEST"
    cp -R "$SRC/raw" "$DEST/raw"
    cp "$SRC/run-meta.json" "$DEST/run-meta.json"
    [ ! -f "$SRC/cases.jsonl" ] || cp "$SRC/cases.jsonl" "$DEST/cases.jsonl"
    node "$BUILD/scripts/raw-check.mjs" "$SRC" > "$DEST/raw-check.json" \
      && echo "  raw check: every answer and explanation is present" \
      || echo "  RAW CHECK FOUND GAPS: see $DEST/raw-check.json"
    say "$NAME: grading against $(basename "$KEYS_DIR")"
    node "$REVIEW/harness/grade/grade.mjs" --results "$DEST" --keys "$KEYS_DIR" --rules "$RULES" --facilities "$FAC" > "$DEST/grading.log" 2>&1 \
      || { tail -n 20 "$DEST/grading.log"; die "Grading failed for $NAME."; }
    printf 'Re-graded %s\nsource: %s\nkeys: %s\nrules: %s\nfacilities: %s\nNo model was called: grade.mjs reads files only.\n' \
      "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$SRC" "$KEYS_DIR" "$RULES" "$FAC" > "$DEST/REGRADE.txt"
    echo "  summary: $DEST/grading/summary.md"
    GRADED+=("$DEST")
  done
  say "Blind invented-rules sheet (labels removed, rows shuffled)"
  blind_export "$GRADE_OUT/blind" "${GRADED[@]}" || die "The blind export failed."
  say "Finished. Re-grade: $GRADE_OUT"
  exit 0
fi

# ---------- checks before anything starts ----------
command -v node >/dev/null || die "Node is not installed (Node 20 or later is needed)."
[ "$(node -p 'process.versions.node.split(".")[0]')" -ge 20 ] || die "Node $(node -v) is too old; Node 20 or later is needed."
command -v npm >/dev/null || die "npm is not installed."
command -v curl >/dev/null || die "curl is not installed."
[ -f "$REVIEW/harness/run.mjs" ] || die "Review harness not found at $REVIEW (set REVIEW_DIR)."
[ -d "$KEYS_DIR" ] || die "Keys folder not found: $KEYS_DIR (set KEYS_DIR)."
[ -d "$BUILD/app" ] && [ -d "$BUILD/engine/code" ] || die "This does not look like the whole-app build folder: $BUILD"
has_key "$BUILD/engine/.env" || die "engine/.env is missing or has no ANTHROPIC_API_KEY. Create it yourself; this script never copies a key."
has_key "$BUILD/app/.env" || die "app/.env is missing or has no ANTHROPIC_API_KEY. Create it yourself; this script never copies a key."
if [ -z "${CHROME_PATH:-}" ] && [ ! -d "/Applications/Google Chrome.app" ] && [ ! -d "$HOME/Applications/Google Chrome.app" ]; then
  die "Google Chrome was not found. Install it, or set CHROME_PATH to a Chrome executable."
fi
for p in 3000 3001; do port_busy "$p" && die "Port $p is in use. Stop whatever is running there (the Prize Stats API uses 3000) and run again."; done
dirty="$(git -C "$BUILD" status --porcelain --untracked-files=no)"
[ -z "$dirty" ] || die "This build has uncommitted changes to tracked files:
$dirty"
HEAD_SHORT="$(git -C "$BUILD" rev-parse --short=7 HEAD)"
BRANCH="$(git -C "$BUILD" rev-parse --abbrev-ref HEAD)"
ZOD_APP="$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).packages["node_modules/zod"].version' "$BUILD/app/package-lock.json")"
ZOD_ENGINE="$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).packages["node_modules/zod"].version' "$BUILD/engine/code/package-lock.json")"
# The scored run was made on zod 4.1.11 and is final. After the upgrade this build is no longer the scored
# build, so a plain run is refused; upgrade-check is the way to run it.
if [ "$WHICH" = "run" ] && { [ "$ZOD_APP" != "4.1.11" ] || [ "$ZOD_ENGINE" != "4.1.11" ]; }; then
  die "The scored run was made on zod 4.1.11 and is final. This build now has zod $ZOD_ENGINE (engine) and $ZOD_APP (app). For a check after the upgrade use: ./scripts/run-scored-whole-app.sh upgrade-check"
fi

verify_keys() {
  ( cd "$REVIEW/harness" && npm ci --no-audit --no-fund >/dev/null ) || die "Harness packages could not be installed (npm ci in review/harness)."
  node --input-type=module -e "
    import { verifyKeys } from '$REVIEW/harness/lib/keys.mjs';
    const r = verifyKeys(process.argv[1]);
    for (const l of r.lines) console.log((l.ok ? 'OK   ' : 'FAIL ') + l.name);
    process.exit(r.ok ? 0 : 1);" "$KEYS_DIR" || die "Key checksums do not match SHA256SUMS.txt."
}
if [ "$WHICH" = "check" ]; then
  verify_keys
  echo "Checks passed: Node $(node -v), keys, engine/.env and app/.env, Chrome, ports 3000 and 3001 free, build clean at $BRANCH $HEAD_SHORT."
  exit 0
fi

mkdir -p "$RESULTS_DIR"
RESULTS_DIR="$(cd "$RESULTS_DIR" && pwd)"
OUT="$RESULTS_DIR/$BUILD_LABEL"
mkdir -p "$OUT/server-logs"
exec > >(tee -a "$RESULTS_DIR/run-scored.log") 2>&1
if [ -n "$CHECK" ]; then
  say "RefCycle whole-app $CHECK, NOT A SCORE, $STAMP: cases ${CASES:-all test and held_out}; $BRANCH $HEAD_SHORT; zod $ZOD_ENGINE (engine), $ZOD_APP (app); results: $RESULTS_DIR"
  printf '%s, NOT A SCORE.\nCases: %s\nBuild: %s %s\nzod: %s (engine), %s (app)\nStarted: %s\n%s\nand nothing here changes or adds to the scored run or its results.\n' \
    "$CHECK" "${CASES:-all test and held_out cases}" "$BRANCH" "$HEAD_SHORT" "$ZOD_ENGINE" "$ZOD_APP" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$CHECK_WHY" > "$RESULTS_DIR/$CHECK_NOTE"
else
  say "RefCycle whole-app scored run $STAMP: $BRANCH $HEAD_SHORT; keys: $KEYS_DIR; results: $RESULTS_DIR"
fi
command -v caffeinate >/dev/null && { caffeinate -dims -w $$ & } || true

say "Installing harness packages (npm ci) and checking the keys"
verify_keys

# ---------- servers and cleanup ----------
ENGINE_PID=""; APP_PID=""
stop_servers() {
  for pid in $APP_PID $ENGINE_PID; do kill "$pid" 2>/dev/null || true; done
  sleep 1
  # npm runs the app as a child; anything still on these two ports was started here (they were free).
  if command -v lsof >/dev/null; then
    for p in 3000 3001; do lsof -ti "tcp:$p" -sTCP:LISTEN 2>/dev/null | xargs kill 2>/dev/null || true; done
  fi
  ENGINE_PID=""; APP_PID=""
}
trap stop_servers EXIT
trap 'exit 130' INT TERM

wait_up() {
  local url="$1" name="$2" logf="$3" i
  for i in $(seq 1 120); do curl -sf "$url" >/dev/null 2>&1 && return 0; sleep 0.5; done
  echo "--- $name log ---"; tail -n 40 "$logf" || true
  die "$name did not start ($url)."
}
count_lines() { if [ -f "$1" ]; then wc -l < "$1" | tr -d ' '; else echo 0; fi; }
copy_new_lines() { if [ -f "$1" ]; then tail -n +"$(( $2 + 1 ))" "$1" > "$3"; else : > "$3"; fi; }

say "Installing engine and app packages (npm ci)"
( cd "$BUILD/engine/code" && npm ci --no-audit --no-fund )
( cd "$BUILD/app" && npm ci --no-audit --no-fund )

ELOG="$BUILD/engine/logs/requests.jsonl"; ILOG="$BUILD/app/logs/identify.jsonl"; SLOG="$BUILD/app/logs/display-swaps.jsonl"
E0="$(count_lines "$ELOG")"; I0="$(count_lines "$ILOG")"; S0="$(count_lines "$SLOG")"

say "Starting the engine ($ENGINE_PROVIDER/$ENGINE_MODEL) from engine/"
( cd "$BUILD/engine" && LLM_PROVIDER="$ENGINE_PROVIDER" LLM_MODEL="$ENGINE_MODEL" \
    exec node --import "$BUILD/engine/code/node_modules/tsx/dist/esm/index.mjs" code/src/main.ts ) > "$OUT/server-logs/engine.log" 2>&1 &
ENGINE_PID=$!
wait_up http://127.0.0.1:3000/api/jurisdictions engine "$OUT/server-logs/engine.log"
grep -q "$ENGINE_PROVIDER/$ENGINE_MODEL" "$OUT/server-logs/engine.log" || die "The engine did not report $ENGINE_PROVIDER/$ENGINE_MODEL; see $OUT/server-logs/engine.log"

say "Starting the app (image model $IMAGE_PROVIDER/$IMAGE_MODEL; demo limits off for this run, 127.0.0.1 only)"
( cd "$BUILD/app" && env -u NODE_ENV DEMO_LIMITS=off HOST=127.0.0.1 PORT=3001 ENGINE_URL=http://127.0.0.1:3000 \
    LLM_IMAGE_PROVIDER="$IMAGE_PROVIDER" LLM_IMAGE_MODEL="$IMAGE_MODEL" \
    npm run dev ) > "$OUT/server-logs/app.log" 2>&1 &
APP_PID=$!
wait_up http://127.0.0.1:3001/api/jurisdictions app "$OUT/server-logs/app.log"
grep -q "LIMITS OFF (local only)" "$OUT/server-logs/app.log" || die "The app did not start with limits off; see $OUT/server-logs/app.log"

CASE_ARGS=()
if [ -n "$CASES" ]; then
  CASE_ARGS=(--cases "$CASES")
  say "Running the harness on cases $CASES only ($CHECK, not a score)"
elif [ -n "$CHECK" ]; then
  say "Running the harness (test and held_out cases, repeats $REPEATS; $CHECK, not a score)"
else
  say "Running the harness (test and held_out cases, repeats $REPEATS)"
fi
# The harness runs test and held_out cases only with its --scored switch; the checks need it for that
# reason alone, and their folder and build label mark them as checks, not scores.
REFCYCLE_SCORED_RUN=1 node "$REVIEW/harness/run.mjs" --scored --build "$BUILD_LABEL" --build-dir "$BUILD" --build-head "$HEAD_SHORT" \
  --base-url http://127.0.0.1:3001 --keys "$KEYS_DIR" --splits test,held_out --repeats "$REPEATS" --out "$OUT" ${CASE_ARGS[@]+"${CASE_ARGS[@]}"} \
  || echo "The harness exited with an error; the cases it finished are kept."

copy_new_lines "$ELOG" "$E0" "$OUT/server-logs/engine-requests.jsonl"
copy_new_lines "$ILOG" "$I0" "$OUT/server-logs/identify.jsonl"
copy_new_lines "$SLOG" "$S0" "$OUT/server-logs/display-swaps.jsonl"
say "Stopping the servers"
stop_servers

say "Checking that every raw engine answer and explanation was saved"
node "$BUILD/scripts/raw-check.mjs" "$OUT" > "$OUT/raw-check.json" \
  && echo "  every answer and explanation is present, in raw/ and in the engine log" \
  || echo "  RAW CHECK FOUND GAPS: see $OUT/raw-check.json before grading anything else"

if [ -n "$CASES" ]; then
  say "What the app did ($CHECK, not a score; nothing is graded)"
  node "$BUILD/scripts/fix-check-readout.mjs" "$OUT" | tee "$RESULTS_DIR/fix-check-readout.txt"
  say "Finished. $CHECK, not a score: $RESULTS_DIR"
  echo "  Remember to start the Prize Stats API again."
  exit 0
fi

say "Grading"
node "$REVIEW/harness/grade/grade.mjs" --results "$OUT" --keys "$KEYS_DIR" --rules "$BUILD/engine/rules" --facilities "$BUILD/engine/data/facilities.csv" > "$OUT/grading.log" 2>&1 \
  || echo "Grading failed; see $OUT/grading.log"

if [ -n "$CHECK" ]; then
  # The full post-upgrade check stops here: graded for comparison only, and never put on a blind sheet.
  say "Finished. $CHECK, NOT A SCORE: $RESULTS_DIR"
  [ -f "$OUT/grading/summary.md" ] && echo "  summary, for comparison with the scored run only: $OUT/grading/summary.md"
  echo "  Remember to start the Prize Stats API again."
  exit 0
fi

say "Blind invented-rules sheet: baseline, team and whole-app, shuffled together"
PUBLISHED_RUN="$REVIEW/results/scored-20261105-142835"
BLIND_FOLDERS=()
IFS=':' read -r -a BLIND_EXTRA <<< "${BLIND_WITH-$PUBLISHED_RUN/baseline:$PUBLISHED_RUN/team}"
for d in "${BLIND_EXTRA[@]-}"; do
  [ -n "$d" ] || continue
  if [ -d "$d/raw" ] && [ -f "$d/run-meta.json" ]; then BLIND_FOLDERS+=("$d"); else echo "  NOT ON THE SHEET (no finished results there): $d"; fi
done
BLIND_FOLDERS+=("$OUT")
blind_export "$RESULTS_DIR/blind" "${BLIND_FOLDERS[@]}" || echo "The blind export failed; grade-only mode can make it later."

say "Finished. Results: $RESULTS_DIR"
[ -f "$OUT/grading/summary.md" ] && echo "  summary: $OUT/grading/summary.md"
echo "  Remember to start the Prize Stats API again."
