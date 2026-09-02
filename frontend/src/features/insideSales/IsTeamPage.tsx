import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { isApi } from './api';
import { useMe } from '../../portal/useMe';
import { relTime } from './ActivityTimeline';

/**
 * IS-DIR-01 (Director) and IS-HD-01 (IS Head) — the same screen at two scopes.
 *
 * The Last Activity column is the point of it. Doc 1: "If an exec goes 24h without any
 * log, the cell turns orange. 48h turns red. This replaces the need for the Director to
 * ask 'what did you do today?' — the system answers."
 */
const SEVERITY_COLOR: Record<string, string | undefined> = {
  ok: undefined, warn: 'var(--amber)', alert: 'var(--coral)',
};

export function IsTeamPage() {
  const nav = useNavigate();
  const { data: me } = useMe();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['is', 'team'],
    queryFn: isApi.team,
  });

  const base = me?.portal?.key === 'director' ? '/director/inside-sales' : '/is-head';

  return (
    <div>
      <h1 className="page-title">Inside Sales <em>command</em></h1>
      <div className="page-sub">// TEAM PERFORMANCE — CLICK A ROW TO DRILL IN</div>

      {isError && <div className="offline-banner" role="alert" style={{ marginTop: 12 }}>
        Could not load team performance.
      </div>}
      {isLoading && <div className="page-sub">// LOADING</div>}

      {data && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, margin: '16px 0' }}>
            <Tile label="Executives" value={String(data.execs.length)} />
            <Tile label="Active leads"
              value={String(data.execs.reduce((s, e) => s + e.assigned, 0))} />
            <Tile label="Qualified"
              value={String(data.execs.reduce((s, e) => s + e.qualified, 0))} />
            <Tile label="Unassigned" value={String(data.unassigned)}
              tone={data.unassigned > 0 ? 'var(--coral)' : undefined}
              hint={data.unassigned > 0 ? 'Action needed' : undefined} />
            <Tile label="Handoffs pending" value={String(data.handoffsPending)}
              tone={data.handoffsPending > 0 ? 'var(--amber)' : undefined} />
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
              <thead>
                <tr>
                  {['IS Executive', 'Assigned', 'Contacted', 'Qualified', 'Lost',
                    'Qual. rate', 'Activity today', 'vs target', 'Last activity', ''].map((h) => (
                    <th key={h} className="table-th">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.execs.map((row) => (
                  <tr key={row.user._id} style={{ borderTop: '1px solid #000', cursor: 'pointer' }}
                    onClick={() => nav(`${base}/exec/${row.user._id}`)}>
                    <td style={{ padding: '10px 8px' }}>
                      <strong>{row.user.name}</strong>
                      <div style={{ color: 'var(--text-3)', fontSize: 12 }}>
                        {row.user.role?.replace(/_/g, ' ')}
                      </div>
                    </td>
                    <td style={{ padding: '10px 8px' }}>{row.assigned}</td>
                    <td style={{ padding: '10px 8px' }}>{row.contacted}</td>
                    <td style={{ padding: '10px 8px' }}>{row.qualified}</td>
                    <td style={{ padding: '10px 8px' }}>{row.lost}</td>
                    <td style={{ padding: '10px 8px' }}>
                      {row.qualificationRate === null ? '—' : `${row.qualificationRate}%`}
                    </td>
                    {/* Doc 1: an executive with nothing logged today is the thing the
                        Head is meant to notice before end of day. */}
                    {/* Guarded against a field the server did not send. During a rolling
                        deploy the two halves are briefly different versions, and a column
                        that renders the string "undefined" is worse than one showing a
                        dash. */}
                    <td style={{ padding: '10px 8px',
                      color: row.loggedToday ? 'var(--emerald)' : 'var(--amber)' }}>
                      {row.loggedToday === undefined || row.loggedToday === null
                        ? '—'
                        : row.loggedToday === 0
                          ? '⚠ 0 today'
                          : `✓ ${row.loggedToday}${data.dailyActivityTarget ? ` / ${data.dailyActivityTarget}` : ''}`}
                    </td>
                    <td style={{ padding: '10px 8px',
                      color: typeof row.vsTarget === 'number' && row.vsTarget < 60 ? 'var(--coral)' : undefined }}>
                      {typeof row.vsTarget === 'number' ? `${row.vsTarget}%` : '—'}
                    </td>
                    <td style={{ padding: '10px 8px', color: SEVERITY_COLOR[row.lastActivity?.severity ?? 'ok'] }}>
                      {row.lastActivity?.lastAt ? relTime(row.lastActivity.lastAt) : '⚠ never'}
                    </td>
                    <td style={{ padding: '10px 8px', textAlign: 'right' }}>Drill down →</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {!data.execs.length && (
            <div className="page-sub">// NOBODY REPORTS TO YOU YET — SET REPORTING LINES IN ADMIN</div>
          )}
        </>
      )}
    </div>
  );
}

function Tile({ label, value, tone, hint }: {
  label: string; value: string; tone?: string; hint?: string;
}) {
  return (
    <div className="card" style={{ padding: 14 }}>
      <div style={{ color: 'var(--text-3)', fontSize: 12, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 28, fontFamily: 'var(--font-display)', color: tone }}>{value}</div>
      {hint && <div style={{ color: tone, fontSize: 12 }}>{hint}</div>}
    </div>
  );
}
