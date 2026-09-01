import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { salesApi, money } from './api';
import { isApi } from '../insideSales/api';
import { api } from '../../api/client';
import { useMe } from '../../portal/useMe';
import { relTime } from '../insideSales/ActivityTimeline';

/**
 * SA-EX-01 (executive) and SA-MGR-04 (the manager's own deals).
 *
 * Personal only: doc 2 is explicit that an executive sees "No other exec's data, no
 * company pipeline, no manager's deals." A manager reaches this for their OWN book;
 * their team's numbers are a separate screen, which is the distinction doc 2 draws
 * between SA-MGR-04 and SA-MGR-01.
 */
export function SalesDashboardPage() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const { data: me } = useMe();

  const { data: board } = useQuery({
    queryKey: ['deals', 'board', 'mine'],
    queryFn: () => salesApi.board(me ? `?owner=${me.userId}` : ''),
    enabled: !!me,
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

  const cols = board?.stages ?? [];
  const open = cols.filter((c) => !['commercial_order', 'order_lost'].includes(c.key));
  const openCount = open.reduce((t, c) => t + c.deals.length, 0);
  const openValue = open.every((c) => c.value !== null)
    ? open.reduce((t, c) => t + (c.value ?? 0), 0) : null;
  const won = cols.find((c) => c.key === 'commercial_order');
  const mine = compliance?.users?.[0];
  const overdue = tasks.filter((t) => new Date(t.dueAt) < new Date());

  const base = `/${me?.portal?.key ?? ''}`;

  return (
    <div>
      <h1 className="page-title">Good day, <em>{me?.name?.split(' ')[0] ?? 'there'}</em></h1>
      <div className="page-sub">// YOUR DEALS, YOUR TASKS, YOUR TARGET</div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12, margin: '16px 0' }}>
        <Tile label="My active deals" value={String(openCount)}
          hint={openValue !== null ? money(openValue) : undefined} />
        <Tile label="Closed (CO)" value={String(won?.deals.length ?? 0)}
          hint={won?.value !== null && won?.value !== undefined ? money(won.value) : undefined} />
        <Tile label="Tasks due" value={String(tasks.length)}
          hint={overdue.length ? `${overdue.length} overdue` : undefined}
          tone={overdue.length ? 'var(--coral)' : undefined} />
        <Tile label="Logged today" value={String(mine?.loggedToday ?? 0)}
          hint={`Daily target: ${compliance?.dailyTarget ?? 5}`}
          tone={(mine?.loggedToday ?? 0) === 0 ? 'var(--amber)' : undefined} />
      </div>

      <h3>My SPENCO pipeline</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10 }}>
        {cols.map((c) => (
          <div key={c.key} className="card" style={{ padding: 12, borderLeft: `4px solid ${c.color}` }}>
            <div style={{ color: 'var(--text-3)', fontSize: 11, textTransform: 'uppercase' }}>{c.label}</div>
            <div style={{ fontSize: 22, fontFamily: 'var(--font-display)' }}>{c.deals.length}</div>
            {c.value !== null && <div style={{ color: 'var(--text-3)', fontSize: 12 }}>{money(c.value)}</div>}
          </div>
        ))}
      </div>

      <h3 style={{ marginTop: 24 }}>Today's tasks</h3>
      {!tasks.length && <div className="page-sub">// NOTHING DUE — LOG AN ACTIVITY TO SEED THE NEXT ONE</div>}
      <div style={{ display: 'grid', gap: 8 }}>
        {tasks.map((t) => {
          const late = new Date(t.dueAt) < new Date();
          return (
            <div key={t._id} className="card"
              style={{ padding: 12, display: 'flex', justifyContent: 'space-between',
                alignItems: 'center', gap: 10,
                borderLeft: `4px solid ${late ? 'var(--coral)' : 'var(--azure)'}` }}>
              <div>
                <div style={{ fontWeight: 600 }}>{t.title}</div>
                <div style={{ color: late ? 'var(--coral)' : 'var(--text-3)', fontSize: 12 }}>
                  {late ? 'Overdue · ' : ''}{new Date(t.dueAt).toLocaleDateString('en-IN')}
                  {t.customer ? ` · ${t.customer.name}` : ''}
                </div>
              </div>
              <button className="neo-btn" disabled={complete.isPending}
                onClick={() => complete.mutate(t._id)}>✓ Done</button>
            </div>
          );
        })}
      </div>

      <h3 style={{ marginTop: 24 }}>Deals with no recent contact</h3>
      <div style={{ display: 'grid', gap: 8 }}>
        {open.flatMap((c) => c.deals)
          .filter((d) => !d.lastActivityAt
            || (Date.now() - new Date(d.lastActivityAt).getTime()) / 86400000 > 7)
          .slice(0, 8)
          .map((d) => (
            <div key={d._id} className="card"
              style={{ padding: 12, cursor: 'pointer', borderLeft: '4px solid var(--amber)' }}
              onClick={() => nav(`${base}/deals/${d._id}`)}>
              <strong>{d.company || d.name}</strong> — {money(d.value)}
              <div style={{ color: 'var(--text-3)', fontSize: 12 }}>
                {d.refId} · {d.lastActivityAt ? `last contact ${relTime(d.lastActivityAt)}` : 'no activity logged'}
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
