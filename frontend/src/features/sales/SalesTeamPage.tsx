import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { salesApi, money } from './api';
import { useMe } from '../../portal/useMe';
import { relTime } from '../insideSales/ActivityTimeline';

/**
 * SA-DIR-01 (all managers and executives) and SA-MGR-09 (one manager's two executives).
 *
 * The same screen at two scopes, and the reason doc 2 gives for keeping them apart is
 * worth restating: "Sales Manager 1 cannot see that Sales Manager 2 is at only 44% of
 * target." That isolation is enforced by the server; this component simply renders what
 * came back, which is why it needs no role test of its own.
 */
const SEVERITY: Record<string, string | undefined> = {
  ok: undefined, warn: 'var(--amber)', alert: 'var(--coral)',
};

export function SalesTeamPage() {
  const nav = useNavigate();
  const { data: me } = useMe();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['deals', 'team'],
    queryFn: salesApi.team,
  });

  const base = me?.portal?.key === 'director' ? '/director/sales' : `/${me?.portal?.key ?? ''}`;
  const people = data?.people ?? [];
  const totals = people.reduce((t, p) => ({
    open: t.open + p.open,
    pipeline: t.pipeline + (p.pipelineValue ?? 0),
    won: t.won + (p.wonValue ?? 0),
  }), { open: 0, pipeline: 0, won: 0 });

  return (
    <div>
      <h1 className="page-title">Sales <em>command</em></h1>
      <div className="page-sub">
        // {me?.scope.mode === 'all' ? 'EVERY TEAM' : 'YOUR TEAM'} — CLICK A ROW TO DRILL IN
      </div>

      {isError && <div className="offline-banner" role="alert" style={{ marginTop: 12 }}>
        Could not load team performance.
      </div>}
      {isLoading && <div className="page-sub">// LOADING</div>}

      {!!people.length && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12, margin: '16px 0' }}>
            <Tile label="People" value={String(people.length)} />
            <Tile label="Open deals" value={String(totals.open)} />
            {me?.scope.canSeeFinancials && <Tile label="Open pipeline" value={money(totals.pipeline)} />}
            {me?.scope.canSeeFinancials && <Tile label="Closed" value={money(totals.won)} />}
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 860 }}>
              <thead>
                <tr>
                  {['Person', 'Domain', 'Open', 'Pipeline', 'Won', 'Win rate',
                    'vs target', 'Last activity', ''].map((h) => (
                      <th key={h} className="table-th">{h}</th>))}
                </tr>
              </thead>
              <tbody>
                {people.map((p) => (
                  <tr key={p.user._id} style={{ borderTop: '1px solid #000', cursor: 'pointer' }}
                    onClick={() => nav(`${base}/exec/${p.user._id}`)}>
                    <td style={{ padding: '10px 8px' }}>
                      <strong>{p.user.name}</strong>
                      <div style={{ color: 'var(--text-3)', fontSize: 12 }}>
                        {p.user.role?.replace(/_/g, ' ')}
                      </div>
                    </td>
                    <td style={{ padding: '10px 8px' }}>
                      {(p.user.domain ?? 'none').replace(/_/g, ' ')}
                    </td>
                    <td style={{ padding: '10px 8px' }}>{p.open}</td>
                    <td style={{ padding: '10px 8px' }}>{money(p.pipelineValue)}</td>
                    <td style={{ padding: '10px 8px' }}>{money(p.wonValue)}</td>
                    <td style={{ padding: '10px 8px' }}>
                      {p.winRate === null ? '—' : `${p.winRate}%`}
                    </td>
                    <td style={{ padding: '10px 8px',
                      color: p.targetAchieved !== null && p.targetAchieved < 60 ? 'var(--coral)' : undefined }}>
                      {p.targetAchieved === null ? '—' : `${p.targetAchieved}%`}
                    </td>
                    <td style={{ padding: '10px 8px', color: SEVERITY[p.lastActivity?.severity ?? 'ok'] }}>
                      {p.lastActivity?.lastAt ? relTime(p.lastActivity.lastAt) : '⚠ never'}
                    </td>
                    <td style={{ padding: '10px 8px', textAlign: 'right' }}>Drill down →</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {!isLoading && !people.length && (
        <div className="page-sub">// NOBODY REPORTS TO YOU YET — SET REPORTING LINES IN ADMIN</div>
      )}
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="card" style={{ padding: 14 }}>
      <div style={{ color: 'var(--text-3)', fontSize: 12, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 24, fontFamily: 'var(--font-display)' }}>{value}</div>
    </div>
  );
}
