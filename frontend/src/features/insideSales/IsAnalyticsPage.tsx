import { useQuery } from '@tanstack/react-query';
import { isApi } from './api';
import { usePipeline } from '../../meta/usePipeline';

/**
 * IS-DIR-05 / IS-HD-05 — where leads come from, and what happens to them.
 *
 * Computed from the scoped lead list rather than a bespoke endpoint: the numbers a
 * Director sees and the numbers an IS Head sees then differ because the SERVER scoped
 * the rows, and there is no second definition of "qualification rate" to drift.
 */
export function IsAnalyticsPage() {
  const { data: meta } = usePipeline();
  const { data: leads = [], isLoading } = useQuery({
    queryKey: ['is', 'leads', 'analytics'],
    queryFn: () => isApi.leads('?limit=500'),
  });

  const sourceLabel = new Map(
    (meta?.enums.leadSources ?? []).map((s) => [s.key, s.label]),
  );

  const bySource = new Map<string, { total: number; qualified: number; lost: number }>();
  for (const l of leads as Array<Record<string, any>>) {
    const key = l.source ?? 'unknown';
    const row = bySource.get(key) ?? { total: 0, qualified: 0, lost: 0 };
    row.total += 1;
    if (['is_qualified', 'is_handoff_requested', 'is_converted'].includes(l.isStage)) row.qualified += 1;
    if (l.isStage === 'is_lost') row.lost += 1;
    bySource.set(key, row);
  }

  const rows = [...bySource.entries()].sort((a, b) => b[1].total - a[1].total);
  const total = leads.length;
  const qualified = rows.reduce((s, [, r]) => s + r.qualified, 0);

  return (
    <div>
      <h1 className="page-title">Inside Sales <em>analytics</em></h1>
      <div className="page-sub">// SOURCE PERFORMANCE — SCOPED TO WHAT YOU MAY SEE</div>

      {isLoading && <div className="page-sub">// LOADING</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12, margin: '16px 0' }}>
        <Tile label="Leads" value={String(total)} />
        <Tile label="Qualified" value={String(qualified)} />
        <Tile label="Qualification rate"
          value={total ? `${Math.round((qualified / total) * 100)}%` : '—'} />
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
          <thead>
            <tr>{['Source', 'Leads', 'Qualified', 'Disqualified', 'Qual. rate'].map((h) => (
              <th key={h} className="table-th">{h}</th>))}
            </tr>
          </thead>
          <tbody>
            {rows.map(([key, r]) => (
              <tr key={key} style={{ borderTop: '1px solid #000' }}>
                <td style={{ padding: '10px 8px' }}>{sourceLabel.get(key) ?? key}</td>
                <td style={{ padding: '10px 8px' }}>{r.total}</td>
                <td style={{ padding: '10px 8px', color: 'var(--emerald)' }}>{r.qualified}</td>
                <td style={{ padding: '10px 8px', color: 'var(--coral)' }}>{r.lost}</td>
                <td style={{ padding: '10px 8px' }}>
                  {r.total ? `${Math.round((r.qualified / r.total) * 100)}%` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!rows.length && !isLoading && <div className="page-sub">// NO LEADS TO REPORT ON</div>}
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="card" style={{ padding: 14 }}>
      <div style={{ color: 'var(--text-3)', fontSize: 12, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 28, fontFamily: 'var(--font-display)' }}>{value}</div>
    </div>
  );
}
