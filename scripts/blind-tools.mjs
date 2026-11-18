#!/usr/bin/env node
// Helpers around the review harness's blind invented-rules sheet. The harness exporter itself is used
// unchanged; these run on its output. Files in, files out: no servers, no model, no answer keys.
//
//   node scripts/blind-tools.mjs instructions <blind folder> <number of builds>
//       Rewrites the one line of GRADER-INSTRUCTIONS.txt that names how many builds are on the sheet.
//       Two builds is the harness's own wording and is left exactly as it is.
//
//   node scripts/blind-tools.mjs packs-agree --harness <review/harness> <rules folder> <rules folder> ...
//       Exits 1 if the rules folders differ in anything the sheet prints for a cited rule (streams,
//       applies_to, quotes, where, prep). The exporter takes one rules folder for every build, so builds
//       may share a sheet only when this passes.
//
//   node scripts/blind-tools.mjs report --blind <graded blind folder> [--published <published blind folder>]
//       After the grader has filled in the grade column. Builds that the published sheet does not hold
//       (the whole-app build) are reported on their own. Builds it does hold (baseline, team) are compared
//       row by row with the published grades, as a consistency check only. Writes blind-report.md and
//       blind-report.json into the graded folder. The published folder is only read, never written.
import { existsSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const [mode, ...rest] = process.argv.slice(2);
const opt = { _: [] };
for (let i = 0; i < rest.length; i++) {
  if (rest[i].startsWith('--')) opt[rest[i].slice(2)] = rest[++i];
  else opt._.push(rest[i]);
}
const usage = () => {
  console.error('Usage: blind-tools.mjs instructions <blind folder> <builds> | packs-agree --harness <dir> <rules>... | report --blind <dir> [--published <dir>]');
  process.exit(2);
};

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      rows.push(row);
      row = [];
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const [head, ...body] = rows.filter((r) => r.length > 1 || r[0] !== '');
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h.replace(/^﻿/, ''), r[i] ?? ''])));
}

if (mode === 'instructions') {
  const [dir, countText] = opt._;
  const count = Number(countText);
  const file = dir && path.join(dir, 'GRADER-INSTRUCTIONS.txt');
  if (!file || !existsSync(file) || !Number.isInteger(count) || count < 1) usage();
  if (count === 2) process.exit(0);
  const words = ['', 'one', 'two', 'three', 'four', 'five', 'six'];
  const harnessLine = /^Blinding is partial: the two builds lay out their screens differently, so the screen text can hint at the build\.$/m;
  const text = readFileSync(file, 'utf8');
  if (!harnessLine.test(text)) {
    console.error('GRADER-INSTRUCTIONS.txt does not hold the line about the two builds; it was left as it is.');
    process.exit(1);
  }
  const line =
    count === 1
      ? 'This sheet holds one build only.'
      : `Blinding is partial: the ${words[count] ?? count} builds lay out their screens differently, so the screen text can hint at the build.`;
  writeFileSync(file, text.replace(harnessLine, line));
  process.exit(0);
}

if (mode === 'packs-agree') {
  if (!opt.harness || opt._.length < 2) usage();
  const YAML = createRequire(path.join(path.resolve(opt.harness), 'package.json'))('yaml');
  const printed = (dir) => {
    const out = {};
    for (const f of readdirSync(dir).filter((f) => f.endsWith('.yaml')).sort()) {
      const pack = YAML.parse(readFileSync(path.join(dir, f), 'utf8'));
      out[pack.jurisdiction.id] = pack.rules.map((r) => [r.id, r.stream ?? null, (r.conditions || []).map((c) => [c.if, c.stream]), r.also_acceptable ?? null, r.applies_to, r.quote, r.destination_quote ?? null, r.where ?? null, r.prep ?? null]);
    }
    return out;
  };
  const first = printed(opt._[0]);
  const differing = [];
  for (const dir of opt._.slice(1)) {
    const other = printed(dir);
    for (const place of new Set([...Object.keys(first), ...Object.keys(other)])) {
      const a = new Map((first[place] || []).map((r) => [r[0], JSON.stringify(r)]));
      const b = new Map((other[place] || []).map((r) => [r[0], JSON.stringify(r)]));
      for (const id of new Set([...a.keys(), ...b.keys()])) if (a.get(id) !== b.get(id)) differing.push(`${place} ${id} (${opt._[0]} and ${dir})`);
    }
  }
  if (differing.length) {
    console.error(`The rules folders print ${differing.length} cited rules differently:\n  ${differing.slice(0, 20).join('\n  ')}`);
    process.exit(1);
  }
  process.exit(0);
}

if (mode !== 'report' || !opt.blind) usage();

const COMPARED_TEXT = ['place', 'question', 'behavior', 'verdict', 'prep', 'explanation', 'screen_text', 'cited_rules'];
const NAMES = { 2: 'faithful', 1: 'loose', 0: 'invented' };
const load = (dir) => {
  const graded = path.join(dir, 'blind-sheet-graded.csv');
  const sheetFile = existsSync(graded) ? graded : path.join(dir, 'blind-sheet.csv');
  const mapFile = path.join(dir, 'unblind-map.csv');
  if (!existsSync(sheetFile) || !existsSync(mapFile)) return null;
  const map = new Map(parseCsv(readFileSync(mapFile, 'utf8')).map((r) => [r.row_id, r]));
  const rows = parseCsv(readFileSync(sheetFile, 'utf8')).map((r) => {
    const m = map.get(r.row_id);
    if (!m) throw new Error(`${sheetFile}: row ${r.row_id} is not in unblind-map.csv`);
    return { ...r, grade: String(r.grade ?? '').trim(), build: m.build, feature: m.feature, case_id: m.case_id, key: `${m.build}|${m.feature}|${m.case_id}` };
  });
  return { sheetFile, rows };
};

const blindDir = path.resolve(opt.blind);
const now = load(blindDir);
if (!now) {
  console.error(`No blind-sheet.csv (or blind-sheet-graded.csv) and unblind-map.csv in ${blindDir}`);
  process.exit(2);
}
let published = null;
if (opt.published) {
  const publishedDir = path.resolve(opt.published);
  if (existsSync(publishedDir) && realpathSync(publishedDir) === realpathSync(blindDir)) {
    console.error('The graded folder and the published folder are the same folder. The report is never written into published results.');
    process.exit(2);
  }
  published = load(publishedDir);
  if (!published) {
    console.error(`No graded sheet and unblind-map.csv in the published folder ${publishedDir}`);
    process.exit(2);
  }
}

const tally = (rows) => {
  const t = { rows: rows.length, graded: 0, faithful: 0, loose: 0, invented: 0, not_graded: 0, unreadable_grade: 0 };
  for (const r of rows) {
    if (r.grade === '') t.not_graded++;
    else if (NAMES[r.grade]) {
      t.graded++;
      t[NAMES[r.grade]]++;
    } else t.unreadable_grade++;
  }
  return t;
};
const flagged = (rows) => rows.filter((r) => r.grade === '0' || r.grade === '1').map((r) => ({ row_id: r.row_id, feature: r.feature, case_id: r.case_id, grade: NAMES[r.grade], grader_note: r.grader_note || '' }));

const builds = [...new Set(now.rows.map((r) => r.build))];
const publishedBuilds = new Set(published ? published.rows.map((r) => r.build) : []);
const report = {
  graded_sheet: now.sheetFile,
  published_sheet: published ? published.sheetFile : null,
  published_results_changed: false,
  all_rows_graded: now.rows.every((r) => NAMES[r.grade]),
  totals: tally(now.rows),
  new_builds: {},
  consistency_check: {},
};

for (const build of builds) {
  const rows = now.rows.filter((r) => r.build === build);
  if (!publishedBuilds.has(build)) {
    report.new_builds[build] = { ...tally(rows), loose_and_invented_rows: flagged(rows) };
    continue;
  }
  const before = new Map(published.rows.filter((r) => r.build === build).map((r) => [r.key, r]));
  const check = { ...tally(rows), published: tally([...before.values()]), compared: 0, same_grade: 0, different_grade: 0, not_graded_now: 0, text_identical_to_published: 0, not_in_published_sheet: [], not_in_this_sheet: [], differences: [] };
  for (const r of rows) {
    const p = before.get(r.key);
    if (!p) {
      check.not_in_published_sheet.push(`${r.feature} ${r.case_id}`);
      continue;
    }
    before.delete(r.key);
    if (COMPARED_TEXT.every((c) => (r[c] ?? '') === (p[c] ?? ''))) check.text_identical_to_published++;
    if (r.grade === '') {
      check.not_graded_now++;
      continue;
    }
    check.compared++;
    if (r.grade === p.grade) check.same_grade++;
    else {
      check.different_grade++;
      check.differences.push({ row_id: r.row_id, published_row_id: p.row_id, feature: r.feature, case_id: r.case_id, published_grade: NAMES[p.grade] ?? p.grade, grade_now: NAMES[r.grade] ?? r.grade, published_note: p.grader_note || '', note_now: r.grader_note || '' });
    }
  }
  check.not_in_this_sheet = [...before.values()].map((p) => `${p.feature} ${p.case_id}`);
  report.consistency_check[build] = check;
}

const cell = (s) => String(s).replace(/\|/g, '/').replace(/\s*\n\s*/g, ' ');
let md = '# Blind invented-rules grading: report\n\n';
md += `Graded sheet: ${now.sheetFile}\n\n`;
md += `Rows: ${report.totals.rows}. Graded: ${report.totals.graded}. Not graded: ${report.totals.not_graded}.${report.totals.unreadable_grade ? ` Grades that are not 0, 1 or 2: ${report.totals.unreadable_grade}.` : ''}\n\n`;
if (!report.all_rows_graded) md += 'NOT FINISHED: some rows have no grade yet. The numbers below cover the graded rows only.\n\n';
md += '## New rows, reported on their own\n\n';
if (!Object.keys(report.new_builds).length) md += 'None: every build on this sheet is also on the published sheet.\n';
else {
  md += '| Build | Rows | Graded | Faithful | Loose | Invented |\n|---|---|---|---|---|---|\n';
  for (const [b, t] of Object.entries(report.new_builds)) md += `| ${b} | ${t.rows} | ${t.graded} | ${t.faithful} | ${t.loose} | ${t.invented} |\n`;
  for (const [b, t] of Object.entries(report.new_builds)) {
    if (!t.loose_and_invented_rows.length) continue;
    md += `\n${b}, rows graded loose or invented:\n`;
    for (const r of t.loose_and_invented_rows) md += `- ${r.row_id} ${r.feature} ${r.case_id}: ${r.grade}. ${cell(r.grader_note)}\n`;
  }
}
md += '\n## Consistency check against the published grades\n\n';
if (!published) md += 'Not run: no published folder was given.\n';
else if (!Object.keys(report.consistency_check).length) md += 'Nothing to compare: no build on this sheet is on the published sheet.\n';
else {
  md += `Published sheet (read only, not changed): ${published.sheetFile}\n\n`;
  md += 'This compares the new grades of the rows that were graded before with their published grades. It is a check on the grader only. The published grades stand whatever it shows.\n\n';
  md += '| Build | Rows | Compared | Same grade | Different grade | Not graded now | Text identical to published |\n|---|---|---|---|---|---|---|\n';
  for (const [b, c] of Object.entries(report.consistency_check)) md += `| ${b} | ${c.rows} | ${c.compared} | ${c.same_grade} | ${c.different_grade} | ${c.not_graded_now} | ${c.text_identical_to_published} |\n`;
  md += '\n| Build | Published: faithful / loose / invented | Now: faithful / loose / invented |\n|---|---|---|\n';
  for (const [b, c] of Object.entries(report.consistency_check)) md += `| ${b} | ${c.published.faithful} / ${c.published.loose} / ${c.published.invented} | ${c.faithful} / ${c.loose} / ${c.invented} |\n`;
  for (const [b, c] of Object.entries(report.consistency_check)) {
    if (c.differences.length) {
      md += `\n${b}, rows graded differently this time:\n`;
      for (const d of c.differences) md += `- ${d.row_id} (published ${d.published_row_id}) ${d.feature} ${d.case_id}: published ${d.published_grade}, now ${d.grade_now}. ${cell(d.note_now)}\n`;
    }
    if (c.not_in_published_sheet.length) md += `\n${b}, rows not on the published sheet: ${c.not_in_published_sheet.join(', ')}\n`;
    if (c.not_in_this_sheet.length) md += `\n${b}, published rows not on this sheet: ${c.not_in_this_sheet.join(', ')}\n`;
  }
}
writeFileSync(path.join(blindDir, 'blind-report.json'), JSON.stringify(report, null, 2) + '\n');
writeFileSync(path.join(blindDir, 'blind-report.md'), md);
console.log(md);
