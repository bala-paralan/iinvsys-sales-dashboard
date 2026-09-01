/**
 * The three KPI dashboards, one page with a process switch.
 *
 * This replaces the legacy Analytics page, whose charts were fed by literal
 * arrays in app.js — `[12, 19, 8, 15, ...]` with a hardcoded forecast card.
 * It looked like a dashboard and reported nothing. Every number here comes
 * from /api/kpis, including the targets.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { can } from '../../meta/usePipeline';
import { useMe } from '../../portal/useMe';
import { KpiCard } from '../../components/KpiCard';
import { COUNTER_LABELS, type KpiSummary, type Period } from './types';

const PROCESSES = [
  { key: 'sales', label: 'Sales', permission: 'lead.read' },
  { key: 'delivery', label: 'Delivery', permission: 'workorder.read' },
  { key: 'installation', label: 'Installation', permission: 'install.read' },
] as const;

type ProcessKey = (typeof PROCESSES)[number]['key'];

export function DashboardPage() {
  const { data: me } = useMe();
  const [period, setPeriod] = useState<Period>('last_month');

  const visible = PROCESSES.filter((p) => can(me, p.permission));
  const [active, setActive] = useState<ProcessKey | 'all'>('all');

  const summary = useQuery({
    queryKey: ['kpis', 'summary', period],
    queryFn: async () => (await api<KpiSummary>('GET', `/kpis/summary?period=${period}`)).data,
  });

  const groups = summary.data
    ? PROCESSES.filter((p) => visible.some((v) => v.key === p.key))
      .filter((p) => active === 'all' || active === p.key)
      .map((p) => ({ ...p, metrics: summary.data[p.key] }))
    : [];

  return (
    <>
      <h1 className="page-title">Performance <em>Dashboard</em></h1>
      <div className="page-sub">
        {/* The window is stated, always. A dashboard that does not say what
            period it covers invites the reader to assume "now". */}
        // {summary.data ? summary.data.window.label : 'LOADING…'} · ASIA/KOLKATA
      </div>

      {summary.isError && (
        <div className="offline-banner">
          Could not load KPIs: {String((summary.error as Error).message)}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 18 }}>
        <button
          className={`neo-btn${period === 'last_month' ? ' gold' : ''}`}
          onClick={() => setPeriod('last_month')}
        >
          Last full month
        </button>
        <button
          className={`neo-btn${period === 'current_month' ? ' gold' : ''}`}
          onClick={() => setPeriod('current_month')}
        >
          Month to date
        </button>

        <div style={{ flex: 1 }} />

        {visible.length > 1 && (
          <>
            <button
              className={`neo-btn${active === 'all' ? ' gold' : ''}`}
              onClick={() => setActive('all')}
            >
              All
            </button>
            {visible.map((p) => (
              <button
                key={p.key}
                className={`neo-btn${active === p.key ? ' gold' : ''}`}
                onClick={() => setActive(p.key)}
              >
                {p.label}
              </button>
            ))}
          </>
        )}

        <a
          className="neo-btn"
          href={`/api/reports/export.xlsx?period=${period}`}
          onClick={(e) => {
            /* The export is an authenticated endpoint and a plain <a> sends no
               Authorization header. Fetch it with the client, then hand the
               browser a blob URL. */
            e.preventDefault();
            void downloadExport(period);
          }}
        >
          ⤓ Export xlsx
        </a>
      </div>

      {summary.data && (
        <div className="card" style={{ padding: '12px 16px', marginBottom: 18, display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          <Health label="On target" value={summary.data.health.ok} color="var(--emerald)" />
          <Health label="Near target" value={summary.data.health.warn} color="var(--amber)" />
          <Health label="Off target" value={summary.data.health.breach} color="var(--coral)" />
          {/* Reported, not hidden. 17 unmeasured KPIs and 4 green is a very
              different month from 21 green, and the difference is the point. */}
          <Health label="Unmeasured" value={summary.data.health.unmeasured} color="var(--text-4)" />
        </div>
      )}

      {summary.isLoading && <p style={{ color: 'var(--text-3)' }}>Loading…</p>}

      {groups.map((g) => (
        <section key={g.key} style={{ marginBottom: 28 }}>
          <div className="form-label" style={{ fontSize: 13 }}>{g.label}</div>
          <div
            style={{
              display: 'grid', gap: 12,
              gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))',
            }}
          >
            {g.metrics.map((m) => <KpiCard key={m.key} metric={m} />)}
          </div>
        </section>
      ))}

      {summary.data && can(me, 'lead.read') && (
        <section>
          <div className="form-label" style={{ fontSize: 13 }}>Hygiene queues</div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {Object.entries(summary.data.counters).map(([key, value]) => (
              <div key={key} className="card" style={{ padding: '10px 16px', minWidth: 150 }}>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 24, color: value > 0 ? 'var(--amber)' : 'var(--text-3)' }}>
                  {value}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>
                  {COUNTER_LABELS[key] ?? key}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

function Health({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div>
      <span style={{ fontFamily: 'var(--font-display)', fontSize: 22, color }}>{value}</span>
      <span style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-mono)', marginLeft: 8 }}>
        {label}
      </span>
    </div>
  );
}

/** Authenticated download — see the onClick note above. */
async function downloadExport(period: Period): Promise<void> {
  const { downloadFile } = await import('../../api/download');
  await downloadFile(`/reports/export.xlsx?period=${period}`);
}
