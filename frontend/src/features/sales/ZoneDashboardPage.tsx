import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { salesApi, money, type TeamRow } from './api';
import { useMe } from '../../portal/useMe';
import { useRoles } from '../../meta/roles';
import { relTime } from '../insideSales/ActivityTimeline';

/**
 * SPENCO CRM brief §6 — the Zonal Sales Manager's dashboard:
 * "Zone-level leads, ASM-wise pipeline, zone performance."
 *
 * Its own screen, not the ASM's with a different heading. The difference is the row:
 * an ASM's dashboard lists people, a ZSM's lists TEAMS — each ASM row is that ASM plus
 * every SE beneath them, which is what `GET /deals/team?rollup=1` folds server-side.
 * Click a row to drill into the ASM's team (SA-DIR-02's path, one level down).
 */
export function ZoneDashboardPage() {
  const nav = useNavigate();
  const { data: me } = useMe();
  const { abbr } = useRoles();

  const { data, isLoading, isError } = useQuery({
    queryKey: ['deals', 'team', 'rollup'],
    queryFn: () => salesApi.team(undefined, { rollup: true }),
  });

  const { data: queue = [] } = useQuery({
    queryKey: ['approvals', 'sales'],
    queryFn: () => salesApi.approvals(),
    enabled: !!me?.permissions.includes('approval.decide'),
  });

  const base = `/${me?.portal?.key ?? 'zsm'}`;
  const teams = data?.people ?? [];
  const s = data?.summary;
  const financials = !!me?.scope.canSeeFinancials;
  const zone = me?.zone ? me.zone.toUpperCase() : 'YOUR ZONE';

  const totals = teams.reduce((acc, t) => ({
    open: acc.open + t.open, won: acc.won + t.won, lost: acc.lost + t.lost,
    atRisk: acc.atRisk + t.atRisk, people: acc.people + 1 + t.teamSize,
  }), { open: 0, won: 0, lost: 0, atRisk: 0, people: 0 });
  const zoneWinRate = totals.won + totals.lost
    ? Math.round((totals.won / (totals.won + totals.lost)) * 100) : null;

  return (
    <div>
      <h1 className="page-title">Zone <em>{zone.toLowerCase()}</em></h1>
      <div className="page-sub">// {zone} — ASM-WISE PIPELINE · CLICK AN ASM TO SEE THEIR TEAM</div>

      {isError && <div className="offline-banner" role="alert" style={{ marginTop: 12 }}>Could not load the zone.</div>}
      {isLoading && <div className="page-sub">// LOADING</div>}

      {s && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, margin: '16px 0' }}>
          <Tile label="Zone pipeline" value={financials ? money(s.pipelineValue) : String(s.openDeals)}
            hint={`${s.openDeals} open deal${s.openDeals === 1 ? '' : 's'}`} />
          <Tile label="Closed / CO (month)"
            value={financials ? money(s.closedThisMonth.value) : String(s.closedThisMonth.count)}
            hint={`${s.closedThisMonth.count} CO${s.closedThisMonth.count === 1 ? '' : 's'} confirmed`} />
          <Tile label="Area teams" value={String(teams.length)}
            hint={`${totals.people} people in the zone`} />
          <Tile label="Pending approvals" value={String(s.pendingApprovals)}
            hint="Discounts · transfers · COs" tone={s.pendingApprovals ? 'var(--amber)' : undefined} />
          <Tile label={`At risk (>${s.staleDays}d)`} value={String(s.atRisk)}
            hint={s.atRisk ? 'Needs an ASM to step in' : 'Nothing stale'}
            tone={s.atRisk ? 'var(--coral)' : undefined} />
          <Tile label="Zone win rate" value={zoneWinRate === null ? '—' : `${zoneWinRate}%`}
            hint={zoneWinRate === null ? 'Nothing closed yet' : `${totals.won} won · ${totals.lost} lost`} />
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', margin: '16px 0 10px' }}>
        <h3 style={{ margin: 0 }}>ASM-wise pipeline</h3>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <button className="neo-btn" onClick={() => nav(`${base}/pipeline`)}>Zone board</button>
          <button className="neo-btn gold" onClick={() => nav(`${base}/new`)}>➕ Create lead</button>
        </div>
      </div>

      {!!teams.length && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 960 }}>
            <thead>
              <tr>
                {['Area team', 'Domain', 'SEs', 'Open', 'Pipeline', 'Closed', 'vs target',
                  'Win rate', 'At risk', 'Today', 'Last activity', ''].map((h) => (
                    <th key={h} className="table-th">{h}</th>))}
              </tr>
            </thead>
            <tbody>
              {teams.map((t) => (
                <TeamRowView key={t.user._id} t={t} roleAbbr={abbr(t.user.role)}
                  onOpen={() => nav(`${base}/asm/${t.user._id}`)} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!isLoading && !teams.length && (
        <div className="page-sub">// NO AREA SALES MANAGER REPORTS TO YOU YET — SET REPORTING LINES IN ADMIN</div>
      )}

      {!!teams.length && (
        <>
          <h3 style={{ marginTop: 24 }}>Zone performance</h3>
          <p className="page-sub" style={{ marginTop: -8 }}>// EACH AREA'S SHARE OF THE ZONE'S OPEN PIPELINE</p>
          <div style={{ display: 'grid', gap: 8 }}>
            {teams.map((t) => {
              const total = teams.reduce((n, x) => n + (x.pipelineValue ?? x.open), 0) || 1;
              const share = Math.round(((t.pipelineValue ?? t.open) / total) * 100);
              return (
                <div key={t.user._id} style={{ display: 'grid', gridTemplateColumns: '200px 1fr 60px', gap: 12, alignItems: 'center' }}>
                  <span>{t.user.name}</span>
                  <div style={{ height: 10, border: '1px solid #000', background: 'var(--surface-1)' }}>
                    <div style={{ width: `${share}%`, height: '100%', background: t.atRisk ? 'var(--amber)' : 'var(--gold)' }} />
                  </div>
                  <span style={{ color: 'var(--text-3)', fontSize: 12, textAlign: 'right' }}>{share}%</span>
                </div>
              );
            })}
          </div>
        </>
      )}

      {!!queue.length && (
        <>
          <h3 style={{ marginTop: 24 }}>Pending your approval ({queue.length})</h3>
          <div style={{ display: 'grid', gap: 8 }}>
            {queue.slice(0, 6).map((a: any) => (
              <div key={a._id} className="card"
                style={{ padding: 12, cursor: 'pointer', display: 'flex', justifyContent: 'space-between',
                  gap: 12, alignItems: 'center', borderLeft: '4px solid var(--amber)' }}
                onClick={() => nav(`${base}/approvals`)}>
                <div>
                  <strong>{a.kind.replace(/_/g, ' ')} — {a.payload?.company || a.payload?.leadName || a.payload?.name || a.payload?.refId}</strong>
                  <div style={{ color: 'var(--text-3)', fontSize: 12 }}>
                    {a.payload?.refId} · {a.requestedBy?.name} · {relTime(a.createdAt)}
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

function TeamRowView({ t, roleAbbr, onOpen }: { t: TeamRow; roleAbbr: string; onOpen: () => void }) {
  return (
    <tr style={{ borderTop: '1px solid #000', cursor: 'pointer' }} onClick={onOpen}>
      <td style={{ padding: '10px 8px' }}>
        <strong>{t.user.name}</strong>
        <div style={{ color: 'var(--text-3)', fontSize: 12 }}>{roleAbbr}</div>
      </td>
      <td style={{ padding: '10px 8px' }}>{(t.user.domain ?? 'none').replace(/_/g, ' ')}</td>
      <td style={{ padding: '10px 8px' }}>{t.teamSize}</td>
      <td style={{ padding: '10px 8px' }}>{t.open}</td>
      <td style={{ padding: '10px 8px' }}>{money(t.pipelineValue)}</td>
      <td style={{ padding: '10px 8px' }}>{money(t.wonValue)}</td>
      <td style={{ padding: '10px 8px', color: t.targetAchieved !== null && t.targetAchieved < 60 ? 'var(--coral)' : undefined }}>
        {t.targetAchieved === null ? '—' : `${t.targetAchieved}%`}
      </td>
      <td style={{ padding: '10px 8px' }}>{t.winRate === null ? '—' : `${t.winRate}%`}</td>
      <td style={{ padding: '10px 8px', color: t.atRisk ? 'var(--coral)' : undefined }}>{t.atRisk ? `${t.atRisk} ⚠` : '0'}</td>
      <td style={{ padding: '10px 8px', color: t.activitiesToday ? undefined : 'var(--amber)' }}>
        {`${t.activitiesToday ? '✓' : '⚠'} ${t.activitiesToday}`}
      </td>
      <td style={{ padding: '10px 8px' }}>{t.lastActivity?.lastAt ? relTime(t.lastActivity.lastAt) : '⚠ never'}</td>
      <td style={{ padding: '10px 8px', textAlign: 'right' }}>Team →</td>
    </tr>
  );
}

function Tile({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: string }) {
  return (
    <div className="card" style={{ padding: 14 }}>
      <div style={{ color: 'var(--text-3)', fontSize: 12, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 24, fontFamily: 'var(--font-display)', color: tone }}>{value}</div>
      {hint && <div style={{ color: 'var(--text-3)', fontSize: 12 }}>{hint}</div>}
    </div>
  );
}
