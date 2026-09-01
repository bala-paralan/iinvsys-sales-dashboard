import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { prodApi } from './api';

/**
 * PD-HD-05 — the schedule.
 *
 * A pure frontend view over data that already exists: `currentCommittedDate` and the WIP
 * step counts. No backend work and no charting library — one bar per order against a
 * shared date range is a div with a width.
 */
export function GanttPage() {
  const nav = useNavigate();
  const { data: orders = [], isLoading } = useQuery({
    queryKey: ['production', 'orders'],
    queryFn: () => prodApi.orders(),
  });

  const active = orders
    .filter((o) => !o.deliveredAt && o.currentCommittedDate)
    .sort((a, b) => +new Date(a.currentCommittedDate!) - +new Date(b.currentCommittedDate!));

  if (isLoading) return <div className="page-sub">// LOADING</div>;
  if (!active.length) {
    return (
      <div>
        <h1 className="page-title">Production <em>schedule</em></h1>
        <div className="page-sub">// NO ORDERS WITH A COMMITTED DATE</div>
      </div>
    );
  }

  const now = Date.now();
  const dates = active.map((o) => +new Date(o.currentCommittedDate!));
  const start = Math.min(now, ...dates);
  const end = Math.max(now, ...dates);
  const span = Math.max(1, end - start);
  const pct = (t: number) => ((t - start) / span) * 100;

  return (
    <div>
      <h1 className="page-title">Production <em>schedule</em></h1>
      <div className="page-sub">
        // {active.length} ORDERS · {new Date(start).toLocaleDateString('en-IN')} → {new Date(end).toLocaleDateString('en-IN')}
      </div>

      <div style={{ display: 'grid', gap: 10, marginTop: 16 }}>
        {active.map((o) => {
          const due = +new Date(o.currentCommittedDate!);
          const late = due < now;
          const progress = o.wipPercent ?? 0;
          return (
            <div key={o._id} className="card" style={{ padding: 12, cursor: 'pointer' }}
              onClick={() => nav(`/prod-head/orders/${o._id}`)}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                <strong>{o.woNumber} — {o.customerSnapshot?.company}</strong>
                <span style={{ color: late ? 'var(--coral)' : 'var(--text-3)', fontSize: 12 }}>
                  {late ? 'OVERDUE · ' : ''}{new Date(due).toLocaleDateString('en-IN')}
                  {' · '}{progress}% · {o.assignedEngineer?.name ?? 'unassigned'}
                </span>
              </div>

              <div style={{ position: 'relative', height: 16, background: 'var(--surface-3)', marginTop: 8 }}>
                {/* The bar runs from today to the committed date; the fill is WIP progress. */}
                <div style={{
                  position: 'absolute', left: `${pct(now)}%`,
                  width: `${Math.max(1, pct(due) - pct(now))}%`,
                  height: '100%',
                  background: late ? 'var(--coral)' : 'var(--surface-4)',
                }} />
                <div style={{
                  position: 'absolute', left: `${pct(now)}%`,
                  width: `${Math.max(0, (pct(due) - pct(now)) * (progress / 100))}%`,
                  height: '100%',
                  background: 'var(--gold)',
                }} />
                {/* Today. */}
                <div style={{
                  position: 'absolute', left: `${pct(now)}%`, top: -2,
                  width: 2, height: 20, background: 'var(--azure)',
                }} aria-label="today" />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
