// scripts/blind-tools.mjs: the grader instructions for a sheet of one, two or three builds, and the report
// after blind grading (whole-app rows on their own; baseline and team against the published grades, as a
// consistency check that never writes to the published folder). Uses made-up rows only.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { REPO_DIR } from '../../src/shared/paths.ts';

const SCRIPT = path.join(REPO_DIR, 'scripts', 'blind-tools.mjs');
const run = (...args: string[]) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
const HARNESS_LINE = 'Blinding is partial: the two builds lay out their screens differently, so the screen text can hint at the build.';
const csv = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

type Row = { build: string; feature: string; case_id: string; grade: string; note?: string; explanation?: string };
function blindFolder(rows: Row[], sheetName = 'blind-sheet.csv'): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'refcycle-blind-'));
  const cols = ['row_id', 'place', 'question', 'behavior', 'verdict', 'prep', 'explanation', 'screen_text', 'cited_rules', 'grade', 'grader_note'];
  const sheet = rows.map((r, i) => [`E${String(i + 1).padStart(3, '0')}`, 'seattle_wa', `thing ${r.case_id}`, 'answer', 'garbage', '', r.explanation ?? `made-up-1: “a quote, with a comma”\nsecond line for ${r.case_id}`, 'Garbage\n\nshown', 'made-up-1 [garbage]', r.grade, r.note ?? '']);
  writeFileSync(path.join(dir, sheetName), [cols.join(','), ...sheet.map((r) => r.map(csv).join(','))].join('\n') + '\n');
  writeFileSync(path.join(dir, 'unblind-map.csv'), ['row_id,build,feature,case_id', ...rows.map((r, i) => `E${String(i + 1).padStart(3, '0')},${r.build},${r.feature},${r.case_id}`)].join('\n') + '\n');
  return dir;
}
const instructions = (dir: string) => {
  writeFileSync(path.join(dir, 'GRADER-INSTRUCTIONS.txt'), `First line.\n${HARNESS_LINE}\nRows: 3.\n`);
  return path.join(dir, 'GRADER-INSTRUCTIONS.txt');
};

test('the grader instructions say three builds for a three-build sheet and change nothing else', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'refcycle-blind-'));
  const file = instructions(dir);
  assert.equal(run('instructions', dir, '3').status, 0);
  assert.equal(readFileSync(file, 'utf8'), `First line.\n${HARNESS_LINE.replace('the two builds', 'the three builds')}\nRows: 3.\n`);
});

test('a two-build sheet keeps the harness wording byte for byte; a one-build sheet says so', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'refcycle-blind-'));
  const file = instructions(dir);
  assert.equal(run('instructions', dir, '2').status, 0);
  assert.equal(readFileSync(file, 'utf8'), `First line.\n${HARNESS_LINE}\nRows: 3.\n`);
  assert.equal(run('instructions', dir, '1').status, 0);
  assert.equal(readFileSync(file, 'utf8'), 'First line.\nThis sheet holds one build only.\nRows: 3.\n');
});

test('the report lists whole-app rows on their own and checks baseline and team against the published grades', () => {
  const published = blindFolder(
    [
      { build: 'team', feature: 'locator', case_id: 'm1', grade: '2' },
      { build: 'baseline', feature: 'locator', case_id: 'm1', grade: '1', note: 'published note' },
      { build: 'team', feature: 'scan', case_id: 'm2', grade: '2' },
    ],
    'blind-sheet-graded.csv',
  );
  const graded = blindFolder([
    { build: 'whole-app', feature: 'locator', case_id: 'm1', grade: '0', note: 'states a place the pack lacks' },
    { build: 'baseline', feature: 'locator', case_id: 'm1', grade: '1' },
    { build: 'team', feature: 'scan', case_id: 'm2', grade: '1', note: 'stricter this time' },
    { build: 'whole-app', feature: 'scan', case_id: 'm2', grade: '2' },
    { build: 'team', feature: 'locator', case_id: 'm1', grade: '2' },
  ]);
  const before = readdirSync(published).map((f) => [f, readFileSync(path.join(published, f), 'utf8')]);
  const out = run('report', '--blind', graded, '--published', published);
  assert.equal(out.status, 0, out.stderr);
  const report = JSON.parse(readFileSync(path.join(graded, 'blind-report.json'), 'utf8'));
  assert.equal(report.all_rows_graded, true);
  assert.deepEqual(Object.keys(report.new_builds), ['whole-app']);
  const wa = report.new_builds['whole-app'];
  assert.deepEqual([wa.rows, wa.faithful, wa.loose, wa.invented], [2, 1, 0, 1]);
  assert.deepEqual(wa.loose_and_invented_rows, [{ row_id: 'E001', feature: 'locator', case_id: 'm1', grade: 'invented', grader_note: 'states a place the pack lacks' }]);
  const { team, baseline } = report.consistency_check;
  assert.deepEqual([team.compared, team.same_grade, team.different_grade, team.text_identical_to_published], [2, 1, 1, 2]);
  assert.deepEqual([baseline.compared, baseline.same_grade, baseline.different_grade], [1, 1, 0]);
  assert.deepEqual(team.differences.map((d: { case_id: string; published_grade: string; grade_now: string }) => [d.case_id, d.published_grade, d.grade_now]), [['m2', 'faithful', 'loose']]);
  const md = readFileSync(path.join(graded, 'blind-report.md'), 'utf8');
  assert.match(md, /\| whole-app \| 2 \| 2 \| 1 \| 0 \| 1 \|/);
  assert.match(md, /The published grades stand whatever it shows\./);
  assert.equal(md.includes(String.fromCharCode(0x2014)), false);
  assert.deepEqual(readdirSync(published).map((f) => [f, readFileSync(path.join(published, f), 'utf8')]), before, 'the published folder is only read');
});

test('an unfinished sheet is reported as not finished, and ungraded rows are not compared', () => {
  const published = blindFolder([{ build: 'team', feature: 'scan', case_id: 'm2', grade: '2' }], 'blind-sheet-graded.csv');
  const graded = blindFolder([
    { build: 'team', feature: 'scan', case_id: 'm2', grade: '' },
    { build: 'whole-app', feature: 'scan', case_id: 'm2', grade: '2' },
  ]);
  const out = run('report', '--blind', graded, '--published', published);
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /NOT FINISHED/);
  const report = JSON.parse(readFileSync(path.join(graded, 'blind-report.json'), 'utf8'));
  assert.deepEqual([report.consistency_check.team.compared, report.consistency_check.team.not_graded_now], [0, 1]);
});

test('the report refuses to write into the published folder', () => {
  const published = blindFolder([{ build: 'team', feature: 'scan', case_id: 'm2', grade: '2' }], 'blind-sheet-graded.csv');
  const out = run('report', '--blind', published, '--published', published);
  assert.equal(out.status, 2);
  assert.equal(existsSync(path.join(published, 'blind-report.md')), false);
});

test('blind-tools calls nothing and reads no answer key; the run script puts three builds on the sheet', () => {
  const tools = readFileSync(SCRIPT, 'utf8');
  assert.doesNotMatch(tools, /fetch\(|node:http|node:https|node:net|\.key\.csv|refcycle-private/);
  const script = readFileSync(path.join(REPO_DIR, 'scripts', 'run-scored-whole-app.sh'), 'utf8');
  assert.match(script, /BLIND_WITH-\$PUBLISHED_RUN\/baseline:\$PUBLISHED_RUN\/team/);
  assert.match(script, /blind-tools\.mjs" instructions "\$out" "\$#"/);
  assert.match(script, /blind-tools\.mjs" packs-agree/);
  const reportMode = script.slice(script.indexOf('# ---------- blind report'), script.indexOf('# ---------- grade-only mode'));
  assert.ok(reportMode.length > 300);
  assert.doesNotMatch(reportMode, /curl|run\.mjs|grade\.mjs|npm run dev|ANTHROPIC|\.env|KEYS_DIR|\bcp\b|\bmv\b|\brm\b/, 'the report starts nothing, needs no key and moves no file');
});
