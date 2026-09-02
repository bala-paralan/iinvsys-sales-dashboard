import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { useMe } from '../../portal/useMe';
import { isApi } from './api';
import { salesApi, money } from '../sales/api';
import { relTime } from './ActivityTimeline';

/**
 * "My Performance" — doc 1 IS-EX-01 and doc 2 SA-EX-01 both list it in the sidebar.
 *
 * Personal only, and that is the whole design constraint. Doc 1: "Personal targets
 * visible — no peer comparison shown." So this reads from `GET /users/:id/stats` for the
 * caller's OWN id, which the scope resolver permits, and never from the team endpoints,
 * which would 403 for an executive anyway.
 *
 * One component serves both tracks: an IS Executive is measured on qualifications, a
 * Sales Executive on won value, and which applies is decided by the caller's role rather
 * than by two near-identical files.
 */
export function MyPerformancePage() {
  const { data: me } = useMe();
  const isInsideSales = me?.role === 'is_executive' || me?.role === 'is_head';

  const { data: stats, isLoading, isError } = useQuery({
    queryKey: ['users', me?.userId, 'stats'],
    queryFn: async () => (await api<any>('GET', `/users/${me!.userId}/stats`)).data,
    enabled: !!me?.userId,
  });

  const { data: leads = [] } = useQuery({
    queryKey: ['is', 'leads', 'mine', 'perf'],
    queryFn: () => isApi.leads('?limit=500'),
    enabled: isInsideSales,
  });

  const { data: board } = useQuery({
    queryKey: ['deals', 'board', 'mine', 'perf'],
    queryFn: () => salesApi.board(`?owner=${me!.userId}`),
    enabled: !isInsideSales && !!me?.userId,
  });

  const { data: compliance } = useQuery({
    queryKey: ['activities', 'compliance'],
    queryFn: async () => (await api<{
      dailyTarget: number;
      users: Array<{ loggedToday: number; lastAt: string | null; severity: string }>;
    }>('GET', '/activities/compliance')).data,
  });

  if (isLoading) return <div className="page-sub">// LOADING</div>;
  if (isError) return <div className="offline-banner" role="alert">Could not load your performance.</div>;

  const mine = compliance?.users?.[0];
  const target = stats?.user?.target || 0;

  /* Inside Sales is measured on qualifications; Sales on closed value. */
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  const qualified = leads.filter((l) =>
    ['is_qualified', 'is_handoff_requested', 'is_converted'].includes(l.isStage)).length;
  const qualifiedThisMonth = leads.filter((l) =>
    ['is_qualified', 'is_handoff_requested', 'is_converted'].includes(l.isStage)
    && new Date(l.createdAt) >= monthStart).length;
  const converted = leads.filter((l) => l.isStage === 'is_converted').length;

  const wonValue = stats?.summary?.wonValue ?? 0;
  const pct = isInsideSales
    ? (target ? Math.round((qualifiedThisMonth / target) * 100) : null)
    : (stats?.summary?.targetAchievement ?? null);

  return (
    <div>
      <h1 className="page-title">My <em>performance</em></h1>
      <div className="page-sub">// YOUR OWN NUMBERS — NO PEER COMPARISON</div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, margin: '16px 0' }}>
        {isInsideSales ? (
          <>
            <Tile label="Leads assigned" value={String(leads.length)} />
            <Tile label="Qualified (all time)" value={String(qualified)} />
            <Tile label="Handed to Sales" value={String(converted)} />
            <Tile label="Qualified this month" value={String(qualifiedThisMonth)} />
          </>
        ) : (
          <>
            <Tile label="Deals" value={String(stats?.summary?.totalLeads ?? 0)} />
            <Tile label="Open" value={String(stats?.summary?.activeLeads ?? 0)} />
            <Tile label="Won" value={String(stats?.summary?.wonLeads ?? 0)} />
            {me?.scope.canSeeFinancials && <Tile label="Won value" value={money(wonValue)} />}
          </>
        )}
      </div>

      {/* The target panel. Null rather than a fabricated denominator when nobody has set
          one — a progress bar against an invented target is worse than none. */}
      <div className="card" style={{ padding: 16 }}>
        <h3 style={{ marginTop: 0 }}>
          {isInsideSales ? 'Monthly qualification target' : 'Target achievement'}
        </h3>
        {pct === null ? (
          <div className="page-sub" style={{ padding: 0 }}>
            // NO TARGET SET FOR YOU YET — ASK YOUR MANAGER
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span>
                {isInsideSales
                  ? <>Qualified: <strong>{qualifiedThisMonth}</strong> of {target}</>
                  : <>Won: <strong>{money(wonValue)}</strong> of {money(target)}</>}
              </span>
              <span style={{ fontFamily: 'var(--font-display)', fontSize: 24,
                color: pct >= 100 ? 'var(--emerald)' : pct >= 60 ? 'var(--gold)' : 'var(--coral)' }}>
                {pct}%
              </span>
            </div>
            <div style={{ height: 10, background: 'var(--surface-3)', marginTop: 8 }}>
              <div style={{ height: '100%', width: `${Math.min(100, pct)}%`,
                background: pct >= 100 ? 'var(--emerald)' : 'var(--gold)' }} />
            </div>
          </>
        )}
      </div>

      <div className="card" style={{ padding: 16, marginTop: 16 }}>
        <h3 style={{ marginTop: 0 }}>Activity discipline</h3>
        <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <span>
            Logged today: <strong style={{ color: (mine?.loggedToday ?? 0) === 0 ? 'var(--amber)' : 'var(--emerald)' }}>
              {mine?.loggedToday ?? 0}
            </strong> of {compliance?.dailyTarget ?? 5}
          </span>
          <span style={{ color: 'var(--text-3)' }}>
            Last activity: {mine?.lastAt ? relTime(mine.lastAt) : 'never'}
          </span>
        </div>
        <p style={{ color: 'var(--text-3)', fontSize: 12, marginBottom: 0 }}>
          Your manager sees this figure. Logging every interaction is what makes the
          account history worth reading.
        </p>
      </div>

      {!isInsideSales && !!board?.stages?.length && (
        <>
          <h3 style={{ marginTop: 24 }}>My pipeline by stage</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10 }}>
            {board.stages.map((c) => (
              <div key={c.key} className="card" style={{ padding: 12, borderLeft: `4px solid ${c.color}` }}>
                <div style={{ color: 'var(--text-3)', fontSize: 11, textTransform: 'uppercase' }}>{c.label}</div>
                <div style={{ fontSize: 20, fontFamily: 'var(--font-display)' }}>{c.deals.length}</div>
                {c.value !== null && <div style={{ color: 'var(--text-3)', fontSize: 12 }}>{money(c.value)}</div>}
              </div>
            ))}
          </div>
        </>
      )}
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
