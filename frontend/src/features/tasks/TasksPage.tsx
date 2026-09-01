import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { isApi } from '../insideSales/api';

/**
 * The task list. Tasks are created by logging an activity with a next action — doc 1
 * IS-EX-03 note 2 — so this screen is mostly a place to close them, not to create them.
 */
export function TasksPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<'open' | 'done'>('open');

  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ['tasks', status],
    queryFn: () => isApi.tasks(`?status=${status}`),
  });

  const complete = useMutation({
    mutationFn: (id: string) => isApi.completeTask(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  });

  return (
    <div>
      <h1 className="page-title">My <em>tasks</em></h1>
      <div className="page-sub">// SEEDED BY THE NEXT ACTION ON EVERY LOGGED ACTIVITY</div>

      <div style={{ display: 'flex', gap: 8, margin: '16px 0' }}>
        {(['open', 'done'] as const).map((s) => (
          <button key={s} className="neo-btn" aria-pressed={status === s}
            style={status === s ? { borderColor: 'var(--gold)', color: 'var(--gold)' } : undefined}
            onClick={() => setStatus(s)}>
            {s === 'open' ? 'Open' : 'Completed'}
          </button>
        ))}
      </div>

      {isLoading && <div className="page-sub">// LOADING</div>}
      {!isLoading && !tasks.length && <div className="page-sub">// NOTHING HERE</div>}

      <div style={{ display: 'grid', gap: 8 }}>
        {tasks.map((t) => {
          const late = status === 'open' && new Date(t.dueAt) < new Date();
          return (
            <div key={t._id} className="card"
              style={{ padding: 12, display: 'flex', justifyContent: 'space-between',
                alignItems: 'center', gap: 10,
                borderLeft: `4px solid ${late ? 'var(--coral)' : 'var(--azure)'}` }}>
              <div>
                <div style={{ fontWeight: 600 }}>{t.title}</div>
                <div style={{ color: late ? 'var(--coral)' : 'var(--text-3)', fontSize: 12 }}>
                  {late ? 'Overdue · ' : ''}
                  {new Date(t.dueAt).toLocaleDateString('en-IN')}
                  {t.customer ? ` · ${t.customer.name}` : ''}
                </div>
              </div>
              {status === 'open' && (
                <button className="neo-btn" disabled={complete.isPending}
                  onClick={() => complete.mutate(t._id)}>✓ Done</button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
