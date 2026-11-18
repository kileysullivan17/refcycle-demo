#!/usr/bin/env node
// Prints what the app did for each case of a post-run fix-check, from the harness's raw records.
// A post-run check is not a score: this reads no answer key and grades nothing.
//
//   node scripts/fix-check-readout.mjs <results folder of the check (the one holding raw/)>
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const dir = process.argv[2];
if (!dir || !existsSync(path.join(dir, 'raw'))) {
  console.error('Usage: fix-check-readout.mjs <results folder of the check (the one holding raw/)>');
  process.exit(2);
}
const lines = ['POST-RUN CHECK, NOT A SCORE. What the app did, case by case:', ''];
for (const feature of ['scan', 'locator', 'recyclopedia']) {
  const fdir = path.join(dir, 'raw', feature);
  if (!existsSync(fdir)) continue;
  for (const file of readdirSync(fdir).filter((f) => f.endsWith('.json')).sort()) {
    const rec = JSON.parse(readFileSync(path.join(fdir, file), 'utf8'));
    const net = rec.network || [];
    lines.push(`${feature} ${rec.case_id} (${rec.jurisdiction})${rec.error ? `: THE HARNESS STOPPED AT ${rec.error.step}` : ''}`);
    for (const n of net.filter((x) => x.path === '/api/identify')) {
      const r = n.response || {};
      lines.push(`  image model said: ${r.status ?? `HTTP ${n.status}`}${r.label ? `, label "${r.label}"` : ''}${r.candidates?.length ? `, candidates ${r.candidates.map((c) => `"${c}"`).join(', ')}` : ''}`);
    }
    const heading = rec.scan?.confirm_screen?.headings?.[0];
    if (heading) lines.push(`  the screen asked: ${heading}`);
    const asks = net.filter((x) => x.path === '/api/ask');
    if (!asks.length) lines.push('  no question was sent to the engine');
    for (const n of asks) {
      const r = n.response || {};
      lines.push(`  engine was asked "${n.request?.query ?? ''}": ${r.behavior ?? `HTTP ${n.status}`}${r.stream ? `, ${r.stream}` : ''}; rules cited: ${(r.rule_ids || []).join(', ') || 'none'}`);
    }
    const sites = net.filter((x) => x.path === '/api/sites').pop();
    if (sites?.response?.sites) lines.push(`  sites listed: ${sites.response.sites.map((s) => `${s.facility_id} (for ${s.rule_ids.join(', ')})`).join('; ') || 'none'}`);
    lines.push('');
  }
}
console.log(lines.join('\n'));
