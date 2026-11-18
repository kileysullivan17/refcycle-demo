// scripts/raw-check.mjs: the scored run's own check that every raw engine answer and explanation was
// saved, in the harness's raw records and in the engine's request log. Uses made-up records only.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { REPO_DIR } from '../../src/shared/paths.ts';

const SCRIPT = path.join(REPO_DIR, 'scripts', 'raw-check.mjs');
const answer = (explanation: string) => ({
  jurisdiction: 'seattle_wa',
  item_interpreted: 'thing',
  behavior: 'answer',
  stream: 'garbage',
  conditions: null,
  clarifying_question: null,
  prep: [],
  explanation,
  rule_ids: ['sea-garbage-015'],
  source_urls: ['https://example.org/'],
  model: 'fake/fixture',
});

function results(options: { cut?: boolean; dropFromLog?: boolean; withLog?: boolean } = {}): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'refcycle-raw-check-'));
  const cases = [
    { feature: 'recyclopedia', case_id: 'made-up-1', query: 'first thing', explanation: 'sea-garbage-015: “one”' },
    { feature: 'locator', case_id: 'made-up-2', query: 'second thing', explanation: 'sea-garbage-015: “two”' },
  ];
  const log: string[] = [];
  for (const [i, c] of cases.entries()) {
    mkdirSync(path.join(dir, 'raw', c.feature), { recursive: true });
    const request = { jurisdiction: 'seattle_wa', query: c.query };
    const response = options.cut && i === 1 ? undefined : answer(c.explanation);
    const ask = { t_ms: 10, method: 'POST', path: '/api/ask', search: '', status: 200, request, ...(response ? { response } : { response_error: 'body not read' }) };
    writeFileSync(path.join(dir, 'raw', c.feature, `${c.case_id}.r1.json`), JSON.stringify({ case_id: c.case_id, feature: c.feature, repeat: 1, network: [ask], item: { screen: { text: 'shown' } } }));
    if (!(options.dropFromLog && i === 1)) log.push(JSON.stringify({ id: String(i), status: 200, request, response: answer(c.explanation), diagnostics: [{ attempt: 0 }], model: 'fake/fixture' }));
  }
  mkdirSync(path.join(dir, 'raw', 'scan'), { recursive: true });
  writeFileSync(path.join(dir, 'raw', 'scan', 'made-up-3.r1.json'), JSON.stringify({ case_id: 'made-up-3', feature: 'scan', repeat: 1, network: [], scan: { identify_status: 'unclear' } }));
  if (options.withLog !== false) {
    mkdirSync(path.join(dir, 'server-logs'), { recursive: true });
    writeFileSync(path.join(dir, 'server-logs', 'engine-requests.jsonl'), log.join('\n') + '\n');
  }
  return dir;
}

const run = (dir: string) => {
  const out = spawnSync(process.execPath, [SCRIPT, dir], { encoding: 'utf8' });
  return { code: out.status, report: out.stdout ? JSON.parse(out.stdout) : null, stderr: out.stderr };
};

test('a complete run passes: every answer is in raw/ and, word for word, in the engine log', () => {
  const { code, report } = run(results());
  assert.equal(code, 0);
  assert.equal(report.ok, true);
  assert.deepEqual([report.cases, report.questions_asked, report.answers_saved_in_full], [3, 2, 2]);
  assert.deepEqual(report.cases_with_no_question, ['scan/made-up-3.r1 (scan: unclear)']);
  assert.deepEqual(report.engine_log, { file: 'server-logs/engine-requests.jsonl', lines: 2, answers_with_explanation: 2, with_model_diagnostics: 2, raw_answers_found_word_for_word_in_engine_log: 2 });
});

test('an answer whose body was not saved fails the check and is named', () => {
  const { code, report } = run(results({ cut: true }));
  assert.equal(code, 1);
  assert.equal(report.ok, false);
  assert.deepEqual(report.answers_missing_or_cut, ['locator/made-up-2.r1: HTTP 200, body not read']);
});

test('an engine log that is short of an answer fails the check', () => {
  const { code, report } = run(results({ dropFromLog: true }));
  assert.equal(code, 1);
  assert.match(report.problems.join('; '), /engine log holds fewer answers/);
});

test('a re-grade copy with no engine log is checked on raw/ alone', () => {
  const { code, report } = run(results({ withLog: false }));
  assert.equal(code, 0);
  assert.equal(report.engine_log.file, null);
});

test('a folder that is not a results folder is a usage error', () => {
  assert.equal(run(os.tmpdir()).code, 2);
});

test('the checker and the run script read no answer key and call nothing', () => {
  const checker = readFileSync(SCRIPT, 'utf8');
  assert.doesNotMatch(checker, /fetch\(|node:http|node:https|node:net|\.key\.csv|refcycle-private/);
  const script = readFileSync(path.join(REPO_DIR, 'scripts', 'run-scored-whole-app.sh'), 'utf8');
  const gradeOnly = script.slice(script.indexOf('# ---------- grade-only mode'), script.indexOf('# ---------- checks before anything starts'));
  assert.ok(gradeOnly.length > 500);
  assert.doesNotMatch(gradeOnly, /curl|run\.mjs|npm run dev|main\.ts|ANTHROPIC|\.env|REFCYCLE_SCORED_RUN/, 'grade-only starts no server and needs no key');
  assert.match(gradeOnly, /grade\/grade\.mjs/);
  assert.doesNotMatch(script, /cp [^\n]*\.env|refcycle-b\/|ENV_SOURCE/, 'the script never copies a key file');
});

test('a fix-check is a post-run check, not a score: its own folder and label, no grading, no blind sheet', () => {
  const script = readFileSync(path.join(REPO_DIR, 'scripts', 'run-scored-whole-app.sh'), 'utf8');
  assert.match(script, /RESULTS_DIR="\$\{FIX_CHECK_DIR:-\$REVIEW\/results\/postrun-fix-check-\$STAMP\}"/);
  assert.match(script, /BUILD_LABEL="whole-app-postrun-check"/);
  assert.match(script, /a fix-check never writes into an existing results folder/);
  assert.match(script, /POST-RUN CHECK, NOT A SCORE/);
  const afterHarness = script.slice(script.indexOf('if [ -n "$CASES" ]; then\n  say "What the app did'));
  const fixCheckEnd = afterHarness.slice(0, afterHarness.indexOf('say "Grading"'));
  assert.match(fixCheckEnd, /fix-check-readout\.mjs/);
  assert.match(fixCheckEnd, /exit 0/, 'the fix-check stops before grading and the blind export');
  assert.doesNotMatch(fixCheckEnd, /grade\.mjs|blind_export/);
  const readout = readFileSync(path.join(REPO_DIR, 'scripts', 'fix-check-readout.mjs'), 'utf8');
  assert.doesNotMatch(readout, /fetch\(|node:http|node:https|node:net|\.key\.csv|refcycle-private|writeFileSync/);
});

test('a post-upgrade check is not a score: its own new folder and label, no blind sheet, and a plain run is refused', () => {
  const script = readFileSync(path.join(REPO_DIR, 'scripts', 'run-scored-whole-app.sh'), 'utf8');
  assert.match(script, /RESULTS_DIR="\$\{UPGRADE_CHECK_DIR:-\$REVIEW\/results\/post-upgrade-check-\$STAMP\}"/);
  assert.match(script, /BUILD_LABEL="whole-app-post-upgrade-check"/);
  assert.match(script, /a post-upgrade check never writes into an existing results folder/);
  assert.match(script, /CHECK="POST-UPGRADE CHECK"; CHECK_NOTE="POST-UPGRADE-CHECK\.txt"/);
  assert.match(script, /The scored run was made on zod 4\.1\.11 and is final\./);
  const afterGrading = script.slice(script.indexOf('say "Grading"'));
  const stop = afterGrading.indexOf('if [ -n "$CHECK" ]; then');
  const blind = afterGrading.indexOf('blind_export "$RESULTS_DIR/blind"');
  assert.ok(stop > 0 && stop < blind, 'the full check stops before the blind export');
  assert.match(afterGrading.slice(stop, blind), /exit 0/);
});
