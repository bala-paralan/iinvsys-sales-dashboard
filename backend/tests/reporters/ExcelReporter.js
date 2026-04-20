'use strict';
/**
 * ExcelReporter.js — Custom Jest reporter
 * Writes full test results to IINVSYS_Test_Results_<timestamp>.xlsx
 */
const ExcelJS = require('exceljs');
const path    = require('path');
const fs      = require('fs');

const CATEGORY_MAP = {
  'AUTH':         'Authentication',
  'SECURITY':     'Security',
  'FUNCTIONAL':   'Functional',
  'LEADS':        'Functional',
  'AGENTS':       'Functional',
  'PRODUCTS':     'Functional',
  'EXPOS':        'Functional',
  'SETTINGS':     'Functional',
  'ANALYTICS':    'Functional',
  'REPORTS':      'Functional',
  'PERFORMANCE':  'Performance',
  'LOAD':         'Load / Stress',
  'EXCEPTION':    'Exception Handling',
  'REGRESSION':   'Regression',
  'UI':           'UI / UX',
  'RESPONSIVE':   'Screen Responsiveness',
  'CONTRACT':     'API Contract',
  'RBAC':         'Security / RBAC',
};

function deriveCategory(suiteName, testName) {
  const combined = (suiteName + ' ' + testName).toUpperCase();
  for (const [key, val] of Object.entries(CATEGORY_MAP)) {
    if (combined.includes(key)) return val;
  }
  return 'Functional';
}

function derivePriority(suiteName, testName) {
  const combined = (suiteName + ' ' + testName).toUpperCase();
  if (combined.includes('SECURITY') || combined.includes('AUTH') || combined.includes('RBAC') ||
      combined.includes('REGRESSION') || combined.includes('LOGIN') || combined.includes('TOKEN')) {
    return 'High';
  }
  if (combined.includes('PERFORMANCE') || combined.includes('EXCEPTION') || combined.includes('VALIDATION')) {
    return 'Medium';
  }
  return 'Low';
}

class ExcelReporter {
  constructor(globalConfig, options) {
    this._globalConfig = globalConfig;
    this._options      = options || {};
    this._results      = [];
    this._startTime    = Date.now();
    this._suiteStart   = {};
  }

  onTestFileStart(test) {
    this._suiteStart[test.path] = Date.now();
  }

  onTestResult(test, testResult) {
    const suitePath = test.path || '';
    const fileName  = path.basename(suitePath, '.test.js');

    testResult.testResults.forEach((t, idx) => {
      const ancestorTitles = t.ancestorTitles || [];
      const suiteName = ancestorTitles.join(' > ');
      const testName  = t.fullName || t.title;
      const status    = t.status === 'passed' ? 'PASS'
                      : t.status === 'failed' ? 'FAIL'
                      : 'SKIP';

      this._results.push({
        id:       `TC-${String(this._results.length + 1).padStart(4, '0')}`,
        file:     fileName,
        suite:    suiteName,
        name:     testName,
        category: deriveCategory(suiteName, testName),
        priority: derivePriority(suiteName, testName),
        status,
        duration: t.duration || 0,
        error:    t.failureMessages && t.failureMessages.length
                    ? t.failureMessages[0].split('\n').slice(0, 3).join(' | ')
                    : '',
      });
    });
  }

  async onRunComplete(contexts, results) {
    const ts      = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const outDir  = path.join(__dirname, '../../test-reports');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const outFile = path.join(outDir, `IINVSYS_Test_Results_${ts}.xlsx`);

    const wb = new ExcelJS.Workbook();
    wb.creator  = 'IINVSYS Test Suite';
    wb.created  = new Date();
    wb.modified = new Date();

    /* ── Sheet 1: Summary ── */
    const sumWs = wb.addWorksheet('Summary');
    this._buildSummarySheet(sumWs, results);

    /* ── Sheet 2: All Results ── */
    const allWs = wb.addWorksheet('All Test Results');
    this._buildResultsSheet(allWs, this._results);

    /* ── Sheet 3: Failures ── */
    const failWs = wb.addWorksheet('Failures');
    const failed = this._results.filter(r => r.status === 'FAIL');
    this._buildResultsSheet(failWs, failed, true);

    /* ── Sheets 4+: By Category ── */
    const categories = [...new Set(this._results.map(r => r.category))].sort();
    for (const cat of categories) {
      const ws   = wb.addWorksheet(cat.substring(0, 31));
      const rows = this._results.filter(r => r.category === cat);
      this._buildResultsSheet(ws, rows);
    }

    await wb.xlsx.writeFile(outFile);
    console.log(`\n📊  Excel report written → ${outFile}`);
  }

  _buildSummarySheet(ws, results) {
    const total   = this._results.length;
    const passed  = this._results.filter(r => r.status === 'PASS').length;
    const failed  = this._results.filter(r => r.status === 'FAIL').length;
    const skipped = this._results.filter(r => r.status === 'SKIP').length;
    const elapsed = ((Date.now() - this._startTime) / 1000).toFixed(1);

    const GOLD  = 'FFF0BE18';
    const GREEN = 'FF00C851';
    const RED   = 'FFFF4444';
    const BLUE  = 'FF1A3C5E';

    ws.columns = [
      { key: 'label', width: 30 },
      { key: 'value', width: 20 },
    ];

    const title = ws.addRow(['IINVSYS Sales Dashboard — Test Report', '']);
    title.getCell(1).font = { bold: true, size: 16, color: { argb: GOLD } };
    title.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE } };
    title.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE } };
    ws.mergeCells('A1:B1');

    ws.addRow([]);
    this._summaryRow(ws, 'Run Date',          new Date().toLocaleString('en-IN'), BLUE);
    this._summaryRow(ws, 'Total Test Cases',  total,   BLUE);
    this._summaryRow(ws, 'Passed',            passed,  GREEN);
    this._summaryRow(ws, 'Failed',            failed,  failed > 0 ? RED : GREEN);
    this._summaryRow(ws, 'Skipped',           skipped, BLUE);
    this._summaryRow(ws, 'Pass Rate',         `${total ? ((passed/total)*100).toFixed(1) : 0}%`, passed === total ? GREEN : RED);
    this._summaryRow(ws, 'Total Duration',    `${elapsed}s`, BLUE);
    this._summaryRow(ws, 'Test Suites Run',   results.numTotalTestSuites, BLUE);
    ws.addRow([]);

    // Category breakdown
    const catHeader = ws.addRow(['Category', 'Total', 'Pass', 'Fail', 'Pass %']);
    catHeader.eachCell(c => {
      c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE } };
      c.alignment = { horizontal: 'center' };
    });

    const categories = [...new Set(this._results.map(r => r.category))].sort();
    for (const cat of categories) {
      const catResults = this._results.filter(r => r.category === cat);
      const catPass    = catResults.filter(r => r.status === 'PASS').length;
      const catFail    = catResults.filter(r => r.status === 'FAIL').length;
      const catPct     = `${catResults.length ? ((catPass/catResults.length)*100).toFixed(0) : 0}%`;
      const row = ws.addRow([cat, catResults.length, catPass, catFail, catPct]);
      row.getCell(4).font = { color: { argb: catFail > 0 ? RED : GREEN } };
    }
  }

  _summaryRow(ws, label, value, argb) {
    const row = ws.addRow([label, value]);
    row.getCell(1).font = { bold: true };
    row.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb || 'FFF0F4F8' } };
    row.getCell(2).font = { color: { argb: 'FFFFFFFF' } };
    row.getCell(2).alignment = { horizontal: 'center' };
  }

  _buildResultsSheet(ws, rows, isFail) {
    ws.columns = [
      { header: 'Test ID',    key: 'id',       width: 12 },
      { header: 'File',       key: 'file',     width: 30 },
      { header: 'Suite',      key: 'suite',    width: 40 },
      { header: 'Test Case',  key: 'name',     width: 60 },
      { header: 'Category',   key: 'category', width: 22 },
      { header: 'Priority',   key: 'priority', width: 12 },
      { header: 'Status',     key: 'status',   width: 10 },
      { header: 'Duration(ms)',key:'duration', width: 14 },
      { header: 'Error',      key: 'error',    width: 70 },
    ];

    const hRow = ws.getRow(1);
    hRow.eachCell(c => {
      c.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A3C5E' } };
      c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    });
    hRow.height = 22;

    rows.forEach((r, i) => {
      const row = ws.addRow(r);
      const statusCell = row.getCell('status');
      if (r.status === 'PASS') {
        statusCell.font = { color: { argb: 'FF00C851' }, bold: true };
      } else if (r.status === 'FAIL') {
        statusCell.font = { color: { argb: 'FFFF4444' }, bold: true };
        row.eachCell(c => {
          c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF0F0' } };
        });
      } else {
        statusCell.font = { color: { argb: 'FFFF8800' }, bold: true };
      }
      if (i % 2 === 1 && r.status !== 'FAIL') {
        row.eachCell(c => {
          c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FBFF' } };
        });
      }
      row.eachCell(c => { c.alignment = { vertical: 'middle', wrapText: false }; });
      row.height = 16;
    });

    ws.autoFilter = { from: 'A1', to: 'I1' };
  }
}

module.exports = ExcelReporter;
