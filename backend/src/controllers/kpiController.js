'use strict';
/**
 * kpiController.js — GET /api/kpis/{sales|delivery|installation} and /summary.
 *
 * Thin by design: the controller resolves the window and hands off. Every
 * formula lives in kpiService, every target in pipeline.KPI_TARGETS. If a
 * number appears in this file, something has gone wrong.
 */

const kpis = require('../services/kpiService');
const pipeline = require('../config/pipeline');
const { ok, badRequest } = require('../utils/response');

/** Resolve the window, converting a bad query string into a 400 not a 500. */
function windowOr400(req, res) {
  try {
    return kpis.resolveWindow(req.query);
  } catch (err) {
    if (err instanceof RangeError) { badRequest(res, err.message); return null; }
    throw err;
  }
}

function handlerFor(process, compute, extra) {
  return async function handler(req, res, next) {
    try {
      const window = windowOr400(req, res);
      if (!window) return undefined;

      /* Which numbers, not just which window. See kpiService.scopeBases(). */
      const metrics = await compute(window, req.scope);
      return ok(res, {
        process,
        window: { from: window.from, to: window.to, label: window.label },
        metrics,
        ...(extra ? await extra(req) : {}),
      });
    } catch (err) { return next(err); }
  };
}

const salesKpis = handlerFor('sales', (w, scope) => kpis.salesKpis(w, scope),
  (req) => kpis.salesHygieneCounters(new Date(), req.scope).then((counters) => ({ counters })));
const deliveryKpis = handlerFor('delivery', (w, scope) => kpis.deliveryKpis(w, scope));
const installationKpis = handlerFor('installation', (w, scope) => kpis.installationKpis(w, scope));

/**
 * All three processes in one call, for the manager dashboard.
 *
 * Sequential, not Promise.all: the three run the same aggregations against the
 * same three collections, and firing them together tripled the peak connection
 * demand for a page nobody loads in a tight loop.
 */
async function summary(req, res, next) {
  try {
    const window = windowOr400(req, res);
    if (!window) return undefined;

    const sales = await kpis.salesKpis(window, req.scope);
    const delivery = await kpis.deliveryKpis(window, req.scope);
    const installation = await kpis.installationKpis(window, req.scope);
    const counters = await kpis.salesHygieneCounters(new Date(), req.scope);

    const all = [...sales, ...delivery, ...installation];
    return ok(res, {
      window: { from: window.from, to: window.to, label: window.label },
      pipelineVersion: pipeline.pipelineVersion(),
      sales,
      delivery,
      installation,
      counters,
      /* A one-line health read for the dashboard header. Metrics with no
         target contribute to neither count — they cannot pass or fail. */
      health: {
        ok: all.filter((m) => m.status === 'ok').length,
        warn: all.filter((m) => m.status === 'warn').length,
        breach: all.filter((m) => m.status === 'breach').length,
        unmeasured: all.filter((m) => m.status === null).length,
      },
    });
  } catch (err) { return next(err); }
}

module.exports = { salesKpis, deliveryKpis, installationKpis, summary };
