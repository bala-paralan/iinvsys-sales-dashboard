import { useQuery } from '@tanstack/react-query';
import { supportApi } from './api';

/**
 * IC-CSM-01 and IC-CSM-03 — the CS Manager's dashboard and agent comparison, and the
 * Install Head's read-only CS SLA panel (IC-HD-01).
 *
 * Behind `kpi.read_team`, which a CS Agent does not hold: doc 4 calls agent comparison
 * "exclusive to CS Manager", so an agent gets a 403 rather than a filtered view. A
 * leaderboard of one is still a leaderboard.
 */
export function AgentPerformancePage() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['tickets', 'sla'],
    queryFn: supportApi.sla,
    refetchInterval: 60000,
  });

  return (
    <div>
      <h1 className="page-title">Support <em>performance</em></h1>
      <div className="page-sub">// SLA HEALTH AND PER-AGENT LOAD</div>

      {isError && <div className="offline-banner" role="alert" style={{ marginTop: 12 }}>
        Could not load support performance.
      </div>}
      {isLoading && <div className="page-sub">// LOADING</div>}

      {data && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12, margin: '16px 0' }}>
            <Tile label="Open tickets" value={String(data.open)} />
            <Tile label="SLA breached" value={String(data.breached)}
              tone={data.breached ? 'var(--coral)' : undefined}
              hint={data.breached ? 'Needs escalation' : 'All within target'} />
            <Tile label="Mean resolution"
              value={data.meanResolutionHours === null ? '—' : `${data.meanResolutionHours}h`} />
            <Tile label="Agents" value={String(data.agents.length)} />
          </div>

          <h3>Per agent</h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 620 }}>
              <thead>
                <tr>{['Agent', 'Total', 'Open', 'Breached', 'Mean resolution'].map((h) => (
                  <th key={h} className="table-th">{h}</th>))}
                </tr>
              </thead>
              <tbody>
                {data.agents.map((a) => (
                  <tr key={a.user._id} style={{ borderTop: '1px solid #000' }}>
                    <td style={{ padding: '10px 8px' }}><strong>{a.user.name}</strong></td>
                    <td style={{ padding: '10px 8px' }}>{a.total}</td>
                    <td style={{ padding: '10px 8px' }}>{a.open}</td>
                    <td style={{ padding: '10px 8px', color: a.breached ? 'var(--coral)' : undefined }}>
                      {a.breached}
                    </td>
                    <td style={{ padding: '10px 8px' }}>
                      {a.meanResolutionHours === null ? '—' : `${a.meanResolutionHours}h`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!data.agents.length && <div className="page-sub">// NO CS AGENTS CONFIGURED</div>}
        </>
      )}
    </div>
  );
}

function Tile({ label, value, hint, tone }: {
  label: string; value: string; hint?: string; tone?: string;
}) {
  return (
    <div className="card" style={{ padding: 14 }}>
      <div style={{ color: 'var(--text-3)', fontSize: 12, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 28, fontFamily: 'var(--font-display)', color: tone }}>{value}</div>
      {hint && <div style={{ color: tone ?? 'var(--text-3)', fontSize: 12 }}>{hint}</div>}
    </div>
  );
}
