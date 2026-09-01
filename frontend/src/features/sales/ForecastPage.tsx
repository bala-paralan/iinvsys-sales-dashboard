import { useQuery } from '@tanstack/react-query';
import { salesApi, money } from './api';
import { useMe } from '../../portal/useMe';

/**
 * SA-DIR-08 — revenue forecast against target.
 *
 * The weighting uses each deal's own probability, falling back to the stage default —
 * the same number `kpiService` uses for `weighted_pipeline`, so the forecast and the KPI
 * dashboard cannot disagree about what the pipeline is worth.
 */
export function ForecastPage() {
  const { data: me } = useMe();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['deals', 'forecast'],
    queryFn: salesApi.forecast,
  });

  if (!me?.scope.canSeeFinancials) {
    return (
      <div>
        <h1 className="page-title">Revenue <em>forecast</em></h1>
        <div className="offline-banner" style={{ marginTop: 12 }}>
          This screen is about money, and your role does not receive financial values.
        </div>
      </div>
    );
  }

  const max = Math.max(1, ...((data?.byStage ?? []).map((s: any) => s.value)));

  return (
    <div>
      <h1 className="page-title">Revenue <em>forecast</em></h1>
      <div className="page-sub">
        // {me?.scope.mode === 'all' ? 'EVERY TEAM' : 'YOUR TEAM'} — WEIGHTED BY STAGE PROBABILITY
      </div>

      {isError && <div className="offline-banner" role="alert" style={{ marginTop: 12 }}>
        Could not load the forecast.
      </div>}
      {isLoading && <div className="page-sub">// LOADING</div>}

      {data && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, margin: '16px 0' }}>
            <Tile label="Open pipeline" value={money(data.openTotal)} />
            <Tile label="Weighted" value={money(data.weightedTotal)} />
            <Tile label="Closed" value={money(data.won.value)} hint={`${data.won.count} orders`} />
          </div>

          <div style={{ display: 'grid', gap: 10 }}>
            {data.byStage.map((s: any) => (
              <div key={s.stage} className="card" style={{ padding: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <strong>{s.label}</strong>
                  <span style={{ color: 'var(--text-3)', fontSize: 12 }}>
                    {s.count} deal{s.count === 1 ? '' : 's'} · {money(s.value)} · weighted {money(Math.round(s.weighted))}
                  </span>
                </div>
                {/* A plain proportional bar. No chart library for one figure per row. */}
                <div style={{ height: 8, background: 'var(--surface-3)', marginTop: 8 }}>
                  <div style={{
                    height: '100%',
                    width: `${Math.round((s.value / max) * 100)}%`,
                    background: 'var(--gold)',
                  }} />
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="card" style={{ padding: 14 }}>
      <div style={{ color: 'var(--text-3)', fontSize: 12, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 24, fontFamily: 'var(--font-display)' }}>{value}</div>
      {hint && <div style={{ color: 'var(--text-3)', fontSize: 12 }}>{hint}</div>}
    </div>
  );
}
