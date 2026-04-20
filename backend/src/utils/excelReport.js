'use strict';
const ExcelJS = require('exceljs');
const mongoose = require('mongoose');

/* ── helpers ── */
const currency = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;
const pct = (n) => `${Number(n || 0).toFixed(1)}%`;

const HEADER_FILL = {
  type: 'pattern', pattern: 'solid',
  fgColor: { argb: 'FF1A3C5E' },
};
const HEADER_FONT = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
const ALT_FILL = {
  type: 'pattern', pattern: 'solid',
  fgColor: { argb: 'FFF0F4F8' },
};

function styleHeader(row) {
  row.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.border = {
      bottom: { style: 'thin', color: { argb: 'FF2980b9' } },
    };
  });
  row.height = 22;
}

function styleDataRow(row, idx) {
  if (idx % 2 === 0) {
    row.eachCell((cell) => { cell.fill = ALT_FILL; });
  }
  row.eachCell((cell) => {
    cell.alignment = { vertical: 'middle' };
  });
  row.height = 18;
}

/* ─── Sheet 1: Agent Performance ──────────────────────────────── */
async function buildAgentSheet(ws, Agent, Lead) {
  ws.columns = [
    { header: 'Agent',            key: 'agent',    width: 22 },
    { header: 'Territory',        key: 'territory', width: 18 },
    { header: 'Total Leads',      key: 'total',    width: 14 },
    { header: 'Won',              key: 'won',      width: 10 },
    { header: 'Lost',             key: 'lost',     width: 10 },
    { header: 'Conversion %',     key: 'conv',     width: 16 },
    { header: 'Pipeline Value',   key: 'pipeline', width: 18 },
    { header: 'Won Value',        key: 'wonVal',   width: 18 },
    { header: 'Target',           key: 'target',   width: 18 },
    { header: 'Target Achieved %',key: 'tgtPct',   width: 18 },
  ];

  styleHeader(ws.getRow(1));

  const agents = await Agent.find({}).lean();

  for (let i = 0; i < agents.length; i++) {
    const a = agents[i];
    const leads = await Lead.find({ assignedAgent: a._id }).lean();
    const won  = leads.filter(l => l.stage === 'won');
    const lost = leads.filter(l => l.stage === 'lost');
    const wonValue = won.reduce((s, l) => s + (l.value || 0), 0);
    const pipelineValue = leads
      .filter(l => !['won','lost'].includes(l.stage))
      .reduce((s, l) => s + (l.value || 0), 0);
    const convRate = leads.length ? (won.length / leads.length) * 100 : 0;
    const tgtPct = a.target ? (wonValue / a.target) * 100 : 0;

    const row = ws.addRow({
      agent: a.name,
      territory: a.territory || '—',
      total: leads.length,
      won: won.length,
      lost: lost.length,
      conv: pct(convRate),
      pipeline: currency(pipelineValue),
      wonVal: currency(wonValue),
      target: currency(a.target),
      tgtPct: pct(tgtPct),
    });
    styleDataRow(row, i);
  }

  ws.autoFilter = { from: 'A1', to: 'J1' };
}

/* ─── Sheet 2: Leads Pipeline ─────────────────────────────────── */
async function buildLeadsSheet(ws, Lead) {
  ws.columns = [
    { header: 'Name',         key: 'name',    width: 22 },
    { header: 'Phone',        key: 'phone',   width: 16 },
    { header: 'Email',        key: 'email',   width: 26 },
    { header: 'Stage',        key: 'stage',   width: 14 },
    { header: 'Source',       key: 'source',  width: 14 },
    { header: 'Value (₹)',    key: 'value',   width: 16 },
    { header: 'Score',        key: 'score',   width: 10 },
    { header: 'Agent',        key: 'agent',   width: 20 },
    { header: 'Last Contact', key: 'contact', width: 18 },
  ];

  styleHeader(ws.getRow(1));

  const leads = await Lead.find({})
    .populate('assignedAgent', 'name')
    .sort({ createdAt: -1 })
    .lean();

  leads.forEach((l, i) => {
    const row = ws.addRow({
      name:    l.name,
      phone:   l.phone || '—',
      email:   l.email || '—',
      stage:   l.stage,
      source:  l.source,
      value:   l.value || 0,
      score:   l.score || 0,
      agent:   l.assignedAgent?.name || '—',
      contact: l.lastContact ? new Date(l.lastContact).toLocaleDateString('en-IN') : '—',
    });
    styleDataRow(row, i);
  });

  ws.autoFilter = { from: 'A1', to: 'I1' };
}

/* ─── Sheet 3: Conversion Funnel ──────────────────────────────── */
async function buildConversionSheet(ws, Lead) {
  ws.columns = [
    { header: 'Stage',          key: 'stage',   width: 18 },
    { header: 'Count',          key: 'count',   width: 12 },
    { header: 'Total Value (₹)',key: 'value',   width: 20 },
    { header: '% of All Leads', key: 'pctAll',  width: 18 },
  ];

  styleHeader(ws.getRow(1));

  const stages = ['new','contacted','interested','proposal','negotiation','won','lost'];
  const total  = await Lead.countDocuments();

  for (let i = 0; i < stages.length; i++) {
    const s = stages[i];
    const count = await Lead.countDocuments({ stage: s });
    const agg   = await Lead.aggregate([
      { $match: { stage: s } },
      { $group: { _id: null, total: { $sum: '$value' } } },
    ]);
    const value  = agg[0]?.total || 0;
    const pctAll = total ? (count / total) * 100 : 0;

    const row = ws.addRow({
      stage: s.charAt(0).toUpperCase() + s.slice(1),
      count,
      value,
      pctAll: pct(pctAll),
    });
    styleDataRow(row, i);
  }

  ws.autoFilter = { from: 'A1', to: 'D1' };
}

/* ─── Public: generate workbook buffer ────────────────────────── */
async function generateReportBuffer() {
  const Agent = require('../models/Agent');
  const Lead  = require('../models/Lead');

  const wb = new ExcelJS.Workbook();
  wb.creator  = 'IINVSYS';
  wb.created  = new Date();
  wb.modified = new Date();

  await buildAgentSheet(wb.addWorksheet('Agent Performance'), Agent, Lead);
  await buildLeadsSheet(wb.addWorksheet('Leads Pipeline'), Lead);
  await buildConversionSheet(wb.addWorksheet('Conversion Funnel'), Lead);

  return wb.xlsx.writeBuffer();
}

module.exports = { generateReportBuffer };
