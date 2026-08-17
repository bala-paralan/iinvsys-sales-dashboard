/**
 * One KPI tile.
 *
 * Every value shown here — label, target, unit, status band — comes from the
 * API envelope, which reads them from `pipeline.KPI_TARGETS`. Nothing about a
 * KPI is decided in this file, so tuning a target in Settings changes the
 * dashboard without a deploy.
 */
import type { Kpi } from '../features/kpis/types';

const STATUS: Record<string, { color: string; word: string }> = {
  ok: { color: 'var(--emerald)', word: 'on target' },
  warn: { color: 'var(--amber)', word: 'near target' },
  breach: { color: 'var(--coral)', word: 'off target' },
};

/** Format by unit — a currency KPI and a percentage KPI are not the same shape. */
export function formatKpi(m: Kpi): string {
  if (m.actual === null) return '—';
  switch (m.unit) {
    case 'percent':
      return `${m.actual}%`;
    case 'currency':
      return `₹${m.actual.toLocaleString('en-IN')}`;
    case 'days':
    case 'business days':
      return `${m.actual}d`;
    case 'hours':
      return `${m.actual}h`;
    default:
      return String(m.actual);
  }
}

export function KpiCard({ metric }: { metric: Kpi }) {
  const band = metric.status ? STATUS[metric.status] : null;

  return (
    <div
      className="card"
      style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 6, minHeight: 132 }}
    >
      <div className="form-label" style={{ margin: 0, fontSize: 11 }}>{metric.label}</div>

      <div
        style={{
          fontFamily: 'var(--font-display)', fontSize: 30, lineHeight: 1.1,
          color: band ? band.color : 'var(--text-2)',
        }}
      >
        {formatKpi(metric)}
      </div>

      <div style={{ fontSize: 12, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>
        {metric.target === null
          /* No target in the source document — a number to watch, not a bar to
             clear. Saying "on target" here would invent a pass. */
          ? 'no target — informational'
          : `${metric.direction === 'max' ? '≤' : '≥'} ${metric.target}${metric.unit === 'percent' ? '%' : ''}`}
      </div>

      <div style={{ marginTop: 'auto', fontSize: 11, color: 'var(--text-4)', fontFamily: 'var(--font-mono)' }}>
        {metric.actual === null
          /* "No data" and "zero" are different facts and only one is a problem. */
          ? 'no data in this window'
          : band
            ? `${band.word}${metric.denominator !== null ? ` · ${metric.numerator ?? '—'} / ${metric.denominator}` : ''}`
            : metric.denominator !== null ? `over ${metric.denominator} record(s)` : ''}
      </div>
    </div>
  );
}
