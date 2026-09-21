import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { salesApi, money, type TeamRow } from './api';
import { usePipeline } from '../../meta/usePipeline';
import { useMe } from '../../portal/useMe';
import { useRoles } from '../../meta/roles';
import { relTime } from '../insideSales/ActivityTimeline';

/**
 * SA-DIR-01 "Sales Command Dashboard" and SA-MGR-01 "Manager Dashboard — My Team".
 *
 * The same screen at two scopes, and the reason doc 2 gives for keeping them apart is
 * worth restating: "Sales Manager 1 cannot see that Sales Manager 2 is at only 44% of
 * target." That isolation is enforced by the server; this component renders what came
 * back, which is why it needs no role test of its own.
 *
 * Three panels, in doc 2's order:
 *   TILES     the roll-up over the caller's whole scope, their own book included
 *   TABLE     their people — the caller is NOT a row, so a manager's own pipeline
 *             cannot inflate the team's numbers (that is "My Own Deals", a separate screen)
 *   APPROVALS what is waiting on this person right now, because doc 2 draws it on the
 *             dashboard and not only behind the sidebar link
 */
const SEVERITY: Record<string, string | undefined> = {
  ok: undefined, warn: 'var(--amber)', alert: 'var(--coral)',
};

export function SalesTeamPage() {
  const nav = useNavigate();
  const { data: me } = useMe();
  const { data: meta } = usePipeline();
  const [domain, setDomain] = useState('');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['deals', 'team'],
    queryFn: () => salesApi.team(),
  });

  /* Doc 2 draws the pending-approval list on the dashboard itself. A Director with no
     approvals sees nothing rather than an empty heading. */
  const { data: queue = [] } = useQuery({
    queryKey: ['approvals', 'sales'],
    queryFn: () => salesApi.approvals(),
    enabled: !!me?.permissions.includes('approval.decide'),
  });

  const base = me?.portal?.key === 'director' ? '/director/sales' : `/${me?.portal?.key ?? ''}`;
  const all = data?.people ?? [];
  const s = data?.summary;

  /* SA-DIR-01's "All Managers / Manager 1 – Railways / …" tabs. A display filter over
     rows the server already scoped, never a boundary. */
  const domains: Array<{ key: string; label: string }> =
    (meta as any)?.enums?.domains?.filter((d: any) => d.key !== 'none') ?? [];
  const people = domain ? all.filter((p) => p.user.domain === domain) : all;

  const isDirector = me?.scope.mode === 'all';
  const financials = !!me?.scope.canSeeFinancials;

  return (
    <div>
      <h1 className="page-title">Sales <em>command</em></h1>
      <div className="page-sub">
        // {isDirector ? 'EVERY TEAM' : 'YOUR TEAM'} — CLICK A ROW TO DRILL IN
      </div>

      {isError && <div className="offline-banner" role="alert" style={{ marginTop: 12 }}>
        Could not load team performance.
      </div>}
      {isLoading && <div className="page-sub">// LOADING</div>}

      {s && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, margin: '16px 0' }}>
          <Tile label="Total pipeline"
            value={financials ? money(s.pipelineValue) : String(s.openDeals)}
            hint={`${s.openDeals} active deal${s.openDeals === 1 ? '' : 's'}`} />
          {/* SA-MGR-01 keeps the manager's own book beside the team's. Hidden for the
              Director, whose own deals are a rounding error against four teams — and
              hidden when they have none, where an empty tile only takes up room. */}
          {!isDirector && !!s.ownDeals?.count && (
            <Tile label="My own deals"
              value={financials ? money(s.ownDeals.value) : String(s.ownDeals.count)}
              hint={`${s.ownDeals.count} deal${s.ownDeals.count === 1 ? '' : 's'} I own directly`} />
          )}
          <Tile label="Closed / CO (month)"
            value={financials ? money(s.closedThisMonth.value) : String(s.closedThisMonth.count)}
            hint={`${s.closedThisMonth.count} CO${s.closedThisMonth.count === 1 ? '' : 's'} confirmed`} />
          <Tile label="Pending approvals" value={String(s.pendingApprovals)}
            hint="Discounts + COs"
            tone={s.pendingApprovals ? 'var(--amber)' : undefined} />
          <Tile label={`At risk (>${s.staleDays}d stale)`} value={String(s.atRisk)}
            hint={s.atRisk ? 'Needs intervention' : 'Nothing stale'}
            tone={s.atRisk ? 'var(--coral)' : undefined} />
          <Tile label="Win rate" value={s.winRate === null ? '—' : `${s.winRate}%`}
            hint={s.winRate === null ? 'Nothing closed yet' : 'Won / (won + lost)'} />
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', margin: '16px 0 10px' }}>
        <h3 style={{ margin: 0 }}>
          {isDirector ? 'Team performance — every ZSM and ASM' : 'My executives'}
        </h3>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button className="neo-btn" aria-pressed={!domain}
            style={!domain ? { borderColor: 'var(--gold)', color: 'var(--gold)' } : undefined}
            onClick={() => setDomain('')}>All</button>
          {domains.map((d) => (
            <button key={d.key} className="neo-btn" aria-pressed={domain === d.key}
              style={domain === d.key ? { borderColor: 'var(--gold)', color: 'var(--gold)' } : undefined}
              onClick={() => setDomain(d.key)}>{d.label}</button>
          ))}
          <button className="neo-btn gold" onClick={() => nav(`${base}/new`)}>➕ Create &amp; assign deal</button>
        </div>
      </div>

      {!!people.length && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 980 }}>
            <thead>
              <tr>
                {['Person', 'Domain', 'Team', 'Open', 'Pipeline', 'Closed', 'vs target',
                  'At risk', 'Today', 'Last activity', ''].map((h) => (
                    <th key={h} className="table-th">{h}</th>))}
              </tr>
            </thead>
            <tbody>
              {people.map((p) => (
                <Row key={p.user._id} p={p}
                  onOpen={() => nav(`${base}/exec/${p.user._id}`)} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!isLoading && !all.length && (
        <div className="page-sub">// NOBODY REPORTS TO YOU YET — SET REPORTING LINES IN ADMIN</div>
      )}
      {!!all.length && !people.length && (
        <div className="page-sub">// NOBODY IN THAT DOMAIN</div>
      )}

      {!!queue.length && (
        <>
          <h3 style={{ marginTop: 24 }}>Pending your approval ({queue.length})</h3>
          <div style={{ display: 'grid', gap: 8 }}>
            {queue.slice(0, 6).map((a: any) => (
              <div key={a._id} className="card"
                style={{ padding: 12, cursor: 'pointer', display: 'flex',
                  justifyContent: 'space-between', gap: 12, alignItems: 'center',
                  borderLeft: `4px solid ${a.kind === 'discount' ? 'var(--amber)' : 'var(--emerald)'}` }}
                onClick={() => nav(`${base}/approvals`)}>
                <div>
                  <strong>
                    {a.kind === 'discount' ? `${a.payload?.percent}% discount` : 'CO confirm'}
                    {' — '}{a.payload?.company || a.payload?.name}
                  </strong>
                  <div style={{ color: 'var(--text-3)', fontSize: 12 }}>
                    {a.payload?.refId} · {a.requestedBy?.name} · {relTime(a.createdAt)}
                    {a.payload?.standardPrice ? ` · ${money(a.payload.standardPrice)}` : ''}
                  </div>
                </div>
                <span className="neo-btn">Review →</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Row({ p, onOpen }: { p: TeamRow; onOpen: () => void }) {
  const roles = useRoles();
  return (
    <tr style={{ borderTop: '1px solid #000', cursor: 'pointer' }} onClick={onOpen}>
      <td style={{ padding: '10px 8px' }}>
        <strong>{p.user.name}</strong>
        <div style={{ color: 'var(--text-3)', fontSize: 12 }}>
          {roles.label(p.user.role)}
        </div>
      </td>
      <td style={{ padding: '10px 8px' }}>{(p.user.domain ?? 'none').replace(/_/g, ' ')}</td>
      {/* A manager row says "2 SEs" — or "2 ASMs" for a Zonal Sales Manager, whose reports
          are managers. An executive has nobody, and a dash reads better than a zero that
          looks like a missing figure. */}
      <td style={{ padding: '10px 8px' }}>
        {p.teamSize
          ? `${p.teamSize} ${roles.abbr(p.user.role === 'zonal_sales_manager' ? 'area_sales_manager' : 'sales_executive')}s`
          : '—'}
      </td>
      <td style={{ padding: '10px 8px' }}>{p.open}</td>
      <td style={{ padding: '10px 8px' }}>{money(p.pipelineValue)}</td>
      <td style={{ padding: '10px 8px' }}>{money(p.wonValue)}</td>
      <td style={{ padding: '10px 8px',
        color: p.targetAchieved !== null && p.targetAchieved < 60 ? 'var(--coral)' : undefined }}>
        {p.targetAchieved === null ? '—' : `${p.targetAchieved}%`}
      </td>
      <td style={{ padding: '10px 8px', color: p.atRisk ? 'var(--coral)' : undefined }}>
        {p.atRisk ? `${p.atRisk} ⚠` : '0'}
      </td>
      {/* Doc 2 SA-MGR-01 marks the exec who has logged nothing today. */}
      <td style={{ padding: '10px 8px', color: p.activitiesToday ? undefined : 'var(--amber)' }}>
        {p.activitiesToday === undefined || p.activitiesToday === null
          ? '—' : `${p.activitiesToday ? '✓' : '⚠'} ${p.activitiesToday}`}
      </td>
      <td style={{ padding: '10px 8px', color: SEVERITY[p.lastActivity?.severity ?? 'ok'] }}>
        {p.lastActivity?.lastAt ? relTime(p.lastActivity.lastAt) : '⚠ never'}
      </td>
      <td style={{ padding: '10px 8px', textAlign: 'right' }}>Drill down →</td>
    </tr>
  );
}

function Tile({ label, value, hint, tone }: {
  label: string; value: string; hint?: string; tone?: string;
}) {
  return (
    <div className="card" style={{ padding: 14 }}>
      <div style={{ color: 'var(--text-3)', fontSize: 12, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 24, fontFamily: 'var(--font-display)', color: tone }}>{value}</div>
      {hint && <div style={{ color: 'var(--text-3)', fontSize: 12 }}>{hint}</div>}
    </div>
  );
}
