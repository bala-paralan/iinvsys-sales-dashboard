import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { isApi } from './api';
import { api } from '../../api/client';
import { useMe } from '../../portal/useMe';
import { relTime } from './ActivityTimeline';

/**
 * IS-EX-01 — the Inside Sales Executive's personal home.
 *
 * Doc 1: "No team data, no other exec's numbers. Personal targets visible — no peer
 * comparison shown." The omission is the requirement, which is why this is a separate
 * screen from IS-DIR-01 rather than the same one with rows filtered out.
 */
export function MyDashboardPage() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const { data: me } = useMe();

  const { data: leads = [] } = useQuery({
    queryKey: ['is', 'leads', 'mine'],
    queryFn: () => isApi.leads(''),
  });
  const { data: tasks = [] } = useQuery({
    queryKey: ['tasks', 'today'],
    queryFn: () => isApi.tasks('?status=open&due=today'),
  });
  const { data: compliance } = useQuery({
    queryKey: ['activities', 'compliance'],
    queryFn: async () => (await api<{
      dailyTarget: number;
      users: Array<{ user: string; loggedToday: number; lastAt: string | null; severity: string }>;
    }>('GET', '/activities/compliance')).data,
  });

  const complete = useMutation({
    mutationFn: (id: string) => isApi.completeTask(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  });

  const mine = compliance?.users?.[0];

  /* The monthly target panel. `me.target` is the executive's own figure from the org
     chart; 10 is the doc's worked example and the fallback when nobody has set one. */
  const monthlyTarget = (me as any)?.target || 10;
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  const qualifiedThisMonth = leads.filter((l) =>
    ['is_qualified', 'is_handoff_requested', 'is_converted'].includes(l.isStage)
    && new Date(l.createdAt) >= monthStart).length;
  const pctToTarget = monthlyTarget
    ? Math.round((qualifiedThisMonth / monthlyTarget) * 100) : 0;
  const shortfall = Math.max(0, monthlyTarget - qualifiedThisMonth);
  const monthLabel = new Date().toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  /* Mon-Fri remaining in this month, today included. */
  const workingDaysLeft = (() => {
    const d = new Date(); const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    let n = 0;
    for (const c = new Date(d); c <= end; c.setDate(c.getDate() + 1)) {
      if (c.getDay() !== 0 && c.getDay() !== 6) n += 1;
    }
    return n;
  })();
  const open = leads.filter((l) => !['is_converted', 'is_lost'].includes(l.isStage));
  const qualified = leads.filter((l) => ['is_qualified', 'is_handoff_requested', 'is_converted'].includes(l.isStage));
  const noContact = open.filter((l) => !l.lastActivityAt);
  const overdue = tasks.filter((t) => new Date(t.dueAt) < new Date());

  return (
    <div>
      <h1 className="page-title">Good day, <em>{me?.name?.split(' ')[0] ?? 'there'}</em></h1>
      <div className="page-sub">// YOUR LEADS, YOUR TASKS, YOUR TARGET</div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12, margin: '16px 0' }}>
        <Tile label="My active leads" value={String(open.length)}
          hint={noContact.length ? `${noContact.length} never contacted` : undefined}
          tone={noContact.length ? 'var(--coral)' : undefined} />
        <Tile label="Qualified" value={String(qualified.length)} />
        <Tile label="Tasks due" value={String(tasks.length)}
          hint={overdue.length ? `${overdue.length} overdue` : undefined}
          tone={overdue.length ? 'var(--coral)' : undefined} />
        <Tile label="Logged today" value={String(mine?.loggedToday ?? 0)}
          hint={`Daily target: ${compliance?.dailyTarget ?? 5}`}
          tone={(mine?.loggedToday ?? 0) === 0 ? 'var(--amber)' : undefined} />
      </div>

      {/* Doc 1 IS-EX-01 draws this as its own panel: "My Monthly Target — Qualified Leads:
          6 of 10, 60%, 11 working days left in August." The point is the gap and the time
          left to close it, which four flat tiles do not convey. */}
      <div className="card" style={{ padding: 16, marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
          <h3 style={{ margin: 0 }}>My monthly target</h3>
          <span style={{ color: 'var(--text-3)', fontSize: 12 }}>
            {monthLabel} · {workingDaysLeft} working day{workingDaysLeft === 1 ? '' : 's'} left
          </span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 8 }}>
          <span>Qualified leads: <strong>{qualifiedThisMonth}</strong> of {monthlyTarget}</span>
          <span style={{ fontFamily: 'var(--font-display)', fontSize: 22,
            color: pctToTarget >= 100 ? 'var(--emerald)' : pctToTarget >= 60 ? 'var(--gold)' : 'var(--coral)' }}>
            {pctToTarget}%
          </span>
        </div>
        <div style={{ height: 10, background: 'var(--surface-3)', marginTop: 8 }}>
          <div style={{
            height: '100%', width: `${Math.min(100, pctToTarget)}%`,
            background: pctToTarget >= 100 ? 'var(--emerald)' : 'var(--gold)',
          }} />
        </div>
        {shortfall > 0 && (
          <div style={{ color: 'var(--text-3)', fontSize: 12, marginTop: 6 }}>
            {shortfall} more qualification{shortfall === 1 ? '' : 's'} needed to hit target.
          </div>
        )}
      </div>

      <h3>Today's tasks</h3>
      {!tasks.length && <div className="page-sub">// NOTHING DUE — LOG AN ACTIVITY TO SEED THE NEXT ONE</div>}
      <div style={{ display: 'grid', gap: 8 }}>
        {tasks.map((t) => {
          const late = new Date(t.dueAt) < new Date();
          return (
            <div key={t._id} className="card"
              style={{ padding: 12, display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center',
                borderLeft: `4px solid ${late ? 'var(--coral)' : 'var(--azure)'}` }}>
              <div>
                <div style={{ fontWeight: 600 }}>{t.title}</div>
                <div style={{ color: late ? 'var(--coral)' : 'var(--text-3)', fontSize: 12 }}>
                  {late ? 'Overdue · ' : ''}due {new Date(t.dueAt).toLocaleDateString('en-IN')}
                  {t.customer ? ` · ${t.customer.name}` : ''}
                </div>
              </div>
              <button className="neo-btn" disabled={complete.isPending}
                onClick={() => complete.mutate(t._id)}>✓ Done</button>
            </div>
          );
        })}
      </div>

      <h3 style={{ marginTop: 24 }}>Leads needing attention</h3>
      {!noContact.length && <div className="page-sub">// EVERY LEAD HAS BEEN CONTACTED</div>}
      <div style={{ display: 'grid', gap: 8 }}>
        {noContact.slice(0, 8).map((l) => (
          <div key={l._id} className="card"
            style={{ padding: 12, cursor: 'pointer', borderLeft: '4px solid var(--coral)' }}
            onClick={() => nav(`/is-exec/leads/${l._id}`)}>
            <strong>{l.name}</strong> — {l.company}
            <div style={{ color: 'var(--text-3)', fontSize: 12 }}>
              {l.refId} · assigned {relTime(l.createdAt)} · no activity logged
            </div>
          </div>
        ))}
      </div>
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
