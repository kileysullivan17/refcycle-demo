#!/usr/bin/env node
// Checks that a scored run's results folder holds every raw engine answer and explanation.
//
//   node scripts/raw-check.mjs <results folder of one build>
//
// A run saves each answer twice:
//   1. raw/<feature>/<case>.r<n>.json: the harness records every /api/ask call the page made, with the
//      request and the engine's full response as the browser received it;
//   2. server-logs/engine-requests.jsonl: the engine's own request log for the run, with the request, the
//      full response and the model's diagnostics.
// This script counts both, matches them one to one, and exits 1 if any answer is missing or cut short.
// It reads files only. It never reads an answer key and calls nothing.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const dir = process.argv[2];
if (!dir || !existsSync(path.join(dir, 'raw'))) {
  console.error('Usage: raw-check.mjs <results folder of one build> (the folder that holds raw/)');
  process.exit(2);
}

const FIELDS = ['jurisdiction', 'item_interpreted', 'behavior', 'stream', 'conditions', 'clarifying_question', 'prep', 'explanation', 'rule_ids', 'source_urls', 'model'];
const complete = (a) => a && typeof a === 'object' && FIELDS.every((f) => f in a) && typeof a.explanation === 'string' && a.explanation.length > 0;
const keyOf = (request, response) => JSON.stringify([request?.jurisdiction ?? null, request?.query ?? null, response?.behavior ?? null, response?.explanation ?? null]);

const report = {
  results: path.resolve(dir),
  cases: 0,
  drive_failures: [],
  cases_with_no_question: [],
  questions_asked: 0,
  answers_saved_in_full: 0,
  answers_missing_or_cut: [],
  screens_saved: 0,
  screenshots_saved: 0,
  engine_log: null,
};
const rawAnswers = new Map();

for (const feature of ['recyclopedia', 'locator', 'scan']) {
  const fdir = path.join(dir, 'raw', feature);
  if (!existsSync(fdir)) continue;
  for (const file of readdirSync(fdir).filter((f) => f.endsWith('.json')).sort()) {
    const rec = JSON.parse(readFileSync(path.join(fdir, file), 'utf8'));
    const id = `${feature}/${rec.case_id}.r${rec.repeat}`;
    report.cases++;
    if (rec.error) report.drive_failures.push(`${id}: ${rec.error.step}`);
    if (rec.item?.screen?.text) report.screens_saved++;
    if (rec.screenshot && existsSync(path.join(dir, rec.screenshot))) report.screenshots_saved++;
    const asks = (rec.network || []).filter((n) => n.path === '/api/ask');
    if (!asks.length) report.cases_with_no_question.push(`${id}${rec.scan ? ` (scan: ${rec.scan.identify_status})` : ''}`);
    for (const ask of asks) {
      report.questions_asked++;
      if (ask.status === 200 && complete(ask.response)) {
        report.answers_saved_in_full++;
        const key = keyOf(ask.request, ask.response);
        rawAnswers.set(key, (rawAnswers.get(key) ?? 0) + 1);
      } else {
        report.answers_missing_or_cut.push(`${id}: HTTP ${ask.status ?? 'none'}${ask.failed ? `, ${ask.failed}` : ''}${ask.response_error ? `, ${ask.response_error}` : ''}`);
      }
    }
  }
}

const logFile = path.join(dir, 'server-logs', 'engine-requests.jsonl');
if (existsSync(logFile)) {
  const lines = readFileSync(logFile, 'utf8').split('\n').filter((l) => l.trim());
  const entries = lines.map((l) => {
    try {
      return JSON.parse(l);
    } catch {
      return null;
    }
  });
  const answered = entries.filter((e) => e && e.status === 200 && complete(e.response));
  const logged = new Map();
  for (const e of answered) {
    const key = keyOf(e.request, e.response);
    logged.set(key, (logged.get(key) ?? 0) + 1);
  }
  let matched = 0;
  for (const [key, count] of rawAnswers) matched += Math.min(count, logged.get(key) ?? 0);
  report.engine_log = {
    file: path.relative(dir, logFile),
    lines: lines.length,
    answers_with_explanation: answered.length,
    with_model_diagnostics: answered.filter((e) => Array.isArray(e.diagnostics)).length,
    raw_answers_found_word_for_word_in_engine_log: matched,
  };
} else {
  report.engine_log = { file: null, note: 'no server-logs/engine-requests.jsonl in this folder (a re-grade copy keeps only raw/)' };
}

const problems = [];
if (report.cases === 0) problems.push('no raw case files');
if (report.answers_missing_or_cut.length) problems.push(`${report.answers_missing_or_cut.length} answers missing or cut short in raw/`);
if (report.engine_log.file) {
  if (report.engine_log.answers_with_explanation < report.answers_saved_in_full) problems.push('the engine log holds fewer answers than raw/');
  if (report.engine_log.raw_answers_found_word_for_word_in_engine_log < report.answers_saved_in_full) problems.push('some raw answers do not match the engine log word for word');
}
report.ok = problems.length === 0;
report.problems = problems;
console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
