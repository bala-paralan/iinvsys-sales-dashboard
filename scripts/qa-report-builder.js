#!/usr/bin/env node
'use strict';
/**
 * qa-report-builder.js — turn raw test outputs into a single HTML report,
 * a CSV summary, and a JUnit XML for downstream tools.
 *
 * Usage:
 *   node scripts/qa-report-builder.js \
 *     --jest qa-output/jest.json \
 *     --playwright qa-output/playwright.json \
 *     --audit qa-output/npm-audit.json \
 *     --sanity qa-output/sanity.txt \
 *     --smoke-exit 0 \
 *     --previous ~/.iinvsys-qa-archive/<yesterday>/jest.json \
 *     --out-html qa-output/report.html \
 *     --out-csv  qa-output/qa-summary.csv \
 *     --out-junit qa-output/jest-junit.xml
 */
const fs = require('fs');
const path = require('path');

// ── arg parsing ─────────────────────────────────────────────────────────────
const args = {};
for (let i = 2; i < process.argv.length; i += 2) {
  args[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
}

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (e) { return null; }
}
function readText(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch (e) { return ''; }
}

// ── load inputs ─────────────────────────────────────────────────────────────
const jest       = readJson(args.jest)       || { numTotalTests: 0, numPassedTests: 0, numFailedTests: 0, testResults: [] };
const playwright = readJson(args.playwright) || { stats: { expected: 0, unexpected: 0, flaky: 0, skipped: 0, duration: 0 }, suites: [] };
const audit      = readJson(args.audit)      || { metadata: { vulnerabilities: {} } };
const sanity     = readText(args.sanity);
const previous   = readJson(args.previous)   || null;
const smokeExit  = Number(args['smoke-exit'] || 0);

// ── jest ────────────────────────────────────────────────────────────────────
const jestTotal   = jest.numTotalTests   || 0;
const jestPassed  = jest.numPassedTests  || 0;
const jestFailed  = jest.numFailedTests  || 0;
const jestSkipped = jest.numPendingTests || 0;
const jestDurMs   = (jest.startTime && jest.testResults?.length)
  ? jest.testResults.reduce((s, r) => s + ((r.perfStats?.runtime) || 0), 0)
  : 0;

const jestFailures = [];
const jestPerf = [];
for (const suite of jest.testResults || []) {
  for (const t of suite.testResults || []) {
    const fullName = `${path.basename(suite.testFilePath || suite.name || 'unknown')} › ${t.fullName || t.title}`;
    if (t.status === 'failed') {
      jestFailures.push({
        name: fullName,
        message: (t.failureMessages || []).join('\n').slice(0, 1500),
      });
    }
    jestPerf.push({ name: fullName, duration: t.duration || 0, status: t.status });
  }
}
jestPerf.sort((a, b) => b.duration - a.duration);

// ── new-failures diff (today vs yesterday) ──────────────────────────────────
const previousFailedSet = new Set();
const previousPassedSet = new Set();
if (previous) {
  for (const suite of previous.testResults || []) {
    for (const t of suite.testResults || []) {
      const k = `${path.basename(suite.testFilePath || suite.name || 'unknown')} › ${t.fullName || t.title}`;
      if (t.status === 'failed') previousFailedSet.add(k);
      if (t.status === 'passed') previousPassedSet.add(k);
    }
  }
}
const newFailures = jestFailures
  .filter(f => previousPassedSet.has(f.name) && !previousFailedSet.has(f.name));

// ── playwright ──────────────────────────────────────────────────────────────
const pwStats   = playwright.stats || {};
const pwExpected= pwStats.expected   || 0;
const pwFailed  = pwStats.unexpected || 0;
const pwFlaky   = pwStats.flaky      || 0;
const pwSkipped = pwStats.skipped    || 0;
const pwDurMs   = pwStats.duration   || 0;

const pwFailures = [];
const pwFlakyList = [];
function walkPwSuite(s, parentTitle = '') {
  const title = parentTitle ? `${parentTitle} › ${s.title}` : s.title;
  for (const spec of s.specs || []) {
    for (const test of spec.tests || []) {
      for (const res of test.results || []) {
        const name = `${title} › ${spec.title}`;
        if (test.status === 'unexpected' && res.status !== 'passed') {
          pwFailures.push({ name, error: (res.error?.message || '').slice(0, 1500) });
        }
        if (test.status === 'flaky') pwFlakyList.push({ name });
      }
    }
  }
  for (const child of s.suites || []) walkPwSuite(child, title);
}
for (const root of playwright.suites || []) walkPwSuite(root);

// ── audit ───────────────────────────────────────────────────────────────────
const vulns = audit.metadata?.vulnerabilities || {};
const vCrit = vulns.critical || 0;
const vHigh = vulns.high     || 0;
const vMod  = vulns.moderate || 0;

// ── overall verdict ─────────────────────────────────────────────────────────
const totalTests = jestTotal + pwExpected + pwFailed;
const totalPass  = jestPassed + pwExpected;
const totalFail  = jestFailed + pwFailed;
let verdict = 'green';
if (totalFail > 0 || vCrit > 0 || smokeExit !== 0) verdict = 'red';
else if (vHigh > 0 || pwFlaky > 0)                 verdict = 'amber';

const verdictColors = { green: '#0a8a3a', amber: '#d68800', red: '#c53030' };
const verdictBg = verdictColors[verdict];

const date = new Date().toISOString().slice(0, 10);
const totalDurSec = Math.round((jestDurMs + pwDurMs) / 1000);

// ── subject line (also written to report.subject for email step) ────────────
const prefix = smokeExit !== 0 ? '🚨 PROD DOWN — ' : '';
const subject = `${prefix}[IINVSYS QA] ${date} — ${totalPass}/${totalTests} pass · ${totalFail} fail · ${totalDurSec}s`;
fs.writeFileSync(args['out-html'].replace(/report\.html$/, 'report.subject'), subject);

// ── helpers ─────────────────────────────────────────────────────────────────
const esc = (s = '') => String(s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function row(label, pass, fail, skip, dur) {
  const status = fail > 0 ? '❌' : (pass > 0 ? '✅' : '➖');
  return `<tr>
    <td>${status} ${esc(label)}</td>
    <td style="text-align:right">${pass}</td>
    <td style="text-align:right;color:${fail>0?'#c53030':'inherit'}">${fail}</td>
    <td style="text-align:right;color:#888">${skip || 0}</td>
    <td style="text-align:right;color:#888">${dur}s</td>
  </tr>`;
}

// ── HTML report ─────────────────────────────────────────────────────────────
const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${esc(subject)}</title>
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f5f5f5;color:#222;margin:0;padding:24px;}
  .card{max-width:880px;margin:0 auto;background:#fff;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,.06);overflow:hidden;}
  .hero{background:${verdictBg};color:#fff;padding:24px 28px;}
  .hero h1{margin:0;font-size:22px;font-weight:600;}
  .hero p{margin:4px 0 0;opacity:.9;font-size:14px;}
  .section{padding:20px 28px;border-top:1px solid #eee;}
  .section h2{margin:0 0 12px;font-size:15px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:#555;}
  table{width:100%;border-collapse:collapse;font-size:14px;}
  th,td{padding:8px 10px;text-align:left;border-bottom:1px solid #f0f0f0;}
  th{font-weight:600;color:#666;font-size:12px;text-transform:uppercase;letter-spacing:.5px;background:#fafafa;}
  .fail{background:#fff5f5;}
  .fail td{color:#742a2a;}
  pre{background:#fafafa;padding:10px;border-radius:4px;font-size:12px;line-height:1.4;overflow-x:auto;margin:4px 0 12px;border:1px solid #eee;}
  .meta{color:#888;font-size:12px;}
  .pill{display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;background:#eee;color:#444;margin-right:6px;}
  .pill.red{background:#fed7d7;color:#742a2a;}
  .pill.amber{background:#feebc8;color:#7b4400;}
  .pill.green{background:#c6f6d5;color:#22543d;}
</style></head><body>
<div class="card">

  <div class="hero">
    <h1>${esc(subject)}</h1>
    <p>${verdict.toUpperCase()} · ${totalDurSec}s total · host ${esc(require('os').hostname())}</p>
  </div>

  <div class="section">
    <h2>Score by layer</h2>
    <table>
      <thead><tr><th>Layer</th><th style="text-align:right">Pass</th><th style="text-align:right">Fail</th><th style="text-align:right">Skip</th><th style="text-align:right">Time</th></tr></thead>
      <tbody>
        ${row('Jest (unit + integration)', jestPassed, jestFailed, jestSkipped, Math.round(jestDurMs / 1000))}
        ${row('Playwright (UI E2E)',       pwExpected, pwFailed,  pwSkipped, Math.round(pwDurMs / 1000))}
        ${row('Production smoke',          smokeExit === 0 ? 1 : 0, smokeExit === 0 ? 0 : 1, 0, 0)}
        ${row('npm audit (≥ high)',        (vHigh + vCrit) === 0 ? 1 : 0, (vHigh + vCrit) > 0 ? 1 : 0, vMod, 0)}
      </tbody>
    </table>
  </div>

  ${newFailures.length ? `
  <div class="section">
    <h2>🔴 New failures (passed yesterday, failed today)</h2>
    ${newFailures.slice(0, 20).map(f => `
      <div class="fail" style="padding:8px 10px;margin-bottom:6px;border-radius:4px;">
        <strong>${esc(f.name)}</strong>
        <pre>${esc(f.message)}</pre>
      </div>`).join('')}
  </div>` : ''}

  ${jestFailures.length ? `
  <div class="section">
    <h2>Jest failures (${jestFailures.length})</h2>
    ${jestFailures.slice(0, 25).map(f => `
      <div class="fail" style="padding:8px 10px;margin-bottom:6px;border-radius:4px;">
        <strong>${esc(f.name)}</strong>
        <pre>${esc(f.message)}</pre>
      </div>`).join('')}
    ${jestFailures.length > 25 ? `<p class="meta">… ${jestFailures.length - 25} more — see jest-junit.xml</p>` : ''}
  </div>` : ''}

  ${pwFailures.length ? `
  <div class="section">
    <h2>Playwright failures (${pwFailures.length})</h2>
    ${pwFailures.slice(0, 15).map(f => `
      <div class="fail" style="padding:8px 10px;margin-bottom:6px;border-radius:4px;">
        <strong>${esc(f.name)}</strong>
        <pre>${esc(f.error)}</pre>
      </div>`).join('')}
  </div>` : ''}

  ${pwFlakyList.length ? `
  <div class="section">
    <h2>Flaky tests (passed only on retry)</h2>
    <ul>${pwFlakyList.map(f => `<li>${esc(f.name)}</li>`).join('')}</ul>
  </div>` : ''}

  <div class="section">
    <h2>Slowest 10 tests</h2>
    <table>
      <thead><tr><th>Test</th><th style="text-align:right">ms</th></tr></thead>
      <tbody>
        ${jestPerf.slice(0, 10).map(t => `<tr><td>${esc(t.name)}</td><td style="text-align:right">${t.duration}</td></tr>`).join('')}
      </tbody>
    </table>
  </div>

  <div class="section">
    <h2>Dependency vulnerabilities</h2>
    <p>
      <span class="pill ${vCrit>0?'red':'green'}">${vCrit} critical</span>
      <span class="pill ${vHigh>0?'amber':'green'}">${vHigh} high</span>
      <span class="pill">${vMod} moderate</span>
    </p>
    <p class="meta">Run <code>npm audit</code> in <code>backend/</code> for full details.</p>
  </div>

  <div class="section">
    <h2>Production smoke check (${smokeExit === 0 ? '✅ all green' : '❌ failures'})</h2>
    <pre>${esc(sanity).slice(0, 3000)}</pre>
  </div>

  <div class="section meta">
    Attachments: jest-junit.xml · qa-summary.csv · sanity.txt · playwright-report.zip<br/>
    Archive: ~/.iinvsys-qa-archive/${date}/<br/>
    See <code>TESTING_STRATEGY.md</code> for the run-book.
  </div>
</div>
</body></html>`;
fs.writeFileSync(args['out-html'], html);

// ── CSV summary ─────────────────────────────────────────────────────────────
const csvRows = [['layer','test','status','duration_ms']];
for (const t of jestPerf) csvRows.push(['jest', t.name, t.status, t.duration]);
fs.writeFileSync(args['out-csv'],
  csvRows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n'));

// ── Minimal JUnit XML (Jest only — Playwright already supports JUnit reporter) ──
const xmlEsc = (s='') => String(s).replace(/[<&>"']/g, c =>
  ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]));
const suiteXml = (jest.testResults || []).map(suite => {
  const tests = suite.testResults || [];
  return `  <testsuite name="${xmlEsc(path.basename(suite.testFilePath||'unknown'))}" tests="${tests.length}" failures="${tests.filter(t=>t.status==='failed').length}">
    ${tests.map(t => {
      const tc = `<testcase classname="${xmlEsc(suite.testFilePath||'')}" name="${xmlEsc(t.fullName||t.title)}" time="${(t.duration||0)/1000}">`;
      if (t.status === 'failed') return `${tc}<failure>${xmlEsc((t.failureMessages||[]).join('\n'))}</failure></testcase>`;
      if (t.status === 'pending' || t.status === 'skipped') return `${tc}<skipped/></testcase>`;
      return `${tc}</testcase>`;
    }).join('\n    ')}
  </testsuite>`;
}).join('\n');
fs.writeFileSync(args['out-junit'],
  `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites name="iinvsys-daily-qa" tests="${jestTotal}" failures="${jestFailed}">\n${suiteXml}\n</testsuites>\n`);

console.log(JSON.stringify({
  verdict, subject,
  jest:       { passed: jestPassed, failed: jestFailed, skipped: jestSkipped },
  playwright: { passed: pwExpected, failed: pwFailed,  flaky: pwFlaky },
  vulns:      { critical: vCrit, high: vHigh, moderate: vMod },
  smokeExit, totalDurSec,
  newFailures: newFailures.length,
}, null, 2));
