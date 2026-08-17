'use strict';
/**
 * PIPELINE_FALLBACK parity — R-5 / 10-frontend-architecture.md.
 *
 * The React app keeps one tiny hardcoded copy of pipeline knowledge:
 * frontend/src/meta/pipeline-fallback.json, the offline board skeleton drawn
 * when /api/meta/pipeline is unreachable. A fallback that drifts from the
 * server would silently render columns that no longer exist — so parity is a
 * TEST, not a convention. Renaming a stage fails this suite until the
 * fallback is regenerated.
 *
 * The fallback is also asserted MINIMAL: it must never grow gates or enums,
 * because a gate checklist rendered from stale offline data would tell a rep
 * the wrong requirements.
 */
const fs = require('fs');
const path = require('path');
const pipeline = require('../src/config/pipeline');

const FALLBACK_PATH = path.resolve(
  __dirname, '../../frontend/src/meta/pipeline-fallback.json');

const load = () => JSON.parse(fs.readFileSync(FALLBACK_PATH, 'utf8'));

describe('the offline fallback stays in parity with serialize()', () => {
  it('exists where usePipeline.ts imports it from', () => {
    expect(fs.existsSync(FALLBACK_PATH)).toBe(true);
  });

  it('carries exactly the sales stage keys, in order', () => {
    const fallback = load();
    const server = pipeline.serialize().sales.stages;

    expect(fallback.sales.map((s) => s.key)).toEqual(server.map((s) => s.key));
    expect(fallback.sales.map((s) => s.order)).toEqual(server.map((s) => s.order));
  });

  it('labels and colours match the server', () => {
    const fallback = load();
    const byKey = Object.fromEntries(
      pipeline.serialize().sales.stages.map((s) => [s.key, s]));

    for (const s of fallback.sales) {
      expect(s.label).toBe(byKey[s.key].label);
      expect(s.color).toBe(byKey[s.key].color);
      expect(s.terminal).toBe(!!byKey[s.key].terminal);
    }
  });

  it('marks the won and lost stages the way the server does', () => {
    const fallback = load();
    expect(fallback.sales.find((s) => s.won).key).toBe(pipeline.WON_STAGE);
    expect(fallback.sales.find((s) => s.lost).key).toBe(pipeline.LOST_STAGE);
  });

  it('stays minimal — no gates, no enums, no checklists offline', () => {
    const fallback = load();
    expect(Object.keys(fallback).sort()).toEqual(['sales', 'version']);
    for (const s of fallback.sales) {
      expect(s.entryRequires).toBeUndefined();
      expect(s.checklistTemplate).toBeUndefined();
    }
  });

  it('identifies itself as the fallback, never masquerading as live data', () => {
    expect(load().version).toBe('fallback');
  });
});
