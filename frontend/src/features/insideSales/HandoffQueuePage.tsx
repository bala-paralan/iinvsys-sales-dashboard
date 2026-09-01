import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { isApi } from './api';
import { api, ApiError } from '../../api/client';
import { relTime } from './ActivityTimeline';
import type { BantKey } from './types';

/**
 * IS-HD-04 — the Sales Handoff Approval Queue.
 *
 * The IS Head reads the four BANT lines and the executive's note, then approves,
 * returns for more qualification, or escalates. Approving is the ONLY path that mints a
 * Sales deal, so "no Sales record without an approved handoff" is a property of the
 * system rather than a convention.
 */
const BANT_KEYS: BantKey[] = ['budget', 'authority', 'need', 'timeline'];

export function HandoffQueuePage() {
  const qc = useQueryClient();
  const [assignees, setAssignees] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const { data: queue = [], isLoading } = useQuery({
    queryKey: ['is', 'handoffs'],
    queryFn: isApi.handoffs,
  });

  const { data: salesUsers = [] } = useQuery({
    queryKey: ['users', 'sales'],
    queryFn: async () => (await api<Array<{ _id: string; name: string; role: string; domain?: string }>>(
      'GET', '/users?role=sales_executive&limit=200')).data,
  });

  const decide = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      isApi.decideHandoff(id, {
        status,
        assignTo: assignees[id] || undefined,
        note: notes[id] || '',
      }),
    onSuccess: () => {
      setError(null);
      qc.invalidateQueries({ queryKey: ['is', 'handoffs'] });
      qc.invalidateQueries({ queryKey: ['is', 'leads'] });
      qc.invalidateQueries({ queryKey: ['is', 'team'] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not record the decision'),
  });

  return (
    <div>
      <h1 className="page-title">Handoff <em>queue</em></h1>
      <div className="page-sub">// {queue.length} WAITING ON YOUR DECISION</div>

      {error && <div className="offline-banner" style={{ borderColor: 'var(--coral)', marginTop: 12 }} role="alert">{error}</div>}
      {isLoading && <div className="page-sub">// LOADING</div>}
      {!isLoading && !queue.length && (
        <div className="page-sub" style={{ marginTop: 16 }}>// NOTHING PENDING</div>
      )}

      <div style={{ display: 'grid', gap: 16, marginTop: 16 }}>
        {queue.map((a) => (
          <div key={a._id} className="card" style={{ padding: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
              <div>
                <h3 style={{ margin: 0 }}>
                  {a.payload?.name} — {a.payload?.company}
                </h3>
                <div style={{ color: 'var(--text-3)', fontSize: 12 }}>
                  {a.payload?.refId} · raised by {a.requestedBy?.name} · {relTime(a.createdAt)}
                </div>
              </div>
            </div>

            <h4 style={{ marginBottom: 6 }}>BANT qualification</h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8 }}>
              {BANT_KEYS.map((k) => {
                const dim = a.payload?.bant?.[k];
                return (
                  <div key={k} style={{
                    border: '1px solid #000', padding: 8,
                    borderLeft: `4px solid ${dim?.confirmed ? 'var(--emerald)' : 'var(--coral)'}`,
                  }}>
                    <div style={{ textTransform: 'capitalize', fontWeight: 600 }}>
                      {k} {dim?.confirmed ? '✓' : '✗'}
                    </div>
                    <div style={{ fontSize: 13 }}>{dim?.note || '—'}</div>
                  </div>
                );
              })}
            </div>

            {a.payload?.note && (
              <>
                <h4 style={{ marginBottom: 4 }}>Executive's note</h4>
                <div style={{ whiteSpace: 'pre-wrap' }}>{a.payload.note}</div>
              </>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10, marginTop: 12 }}>
              <div>
                <label className="form-label" htmlFor={`assign-${a._id}`}>
                  Hand to (Sales Executive) *
                </label>
                <select id={`assign-${a._id}`} className="form-input"
                  value={assignees[a._id] ?? ''}
                  onChange={(e) => setAssignees((s) => ({ ...s, [a._id]: e.target.value }))}>
                  <option value="">— select —</option>
                  {salesUsers.map((u) => (
                    <option key={u._id} value={u._id}>
                      {u.name}{u.domain && u.domain !== 'none' ? ` (${u.domain.replace(/_/g, ' ')})` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="form-label" htmlFor={`note-${a._id}`}>Decision note</label>
                <input id={`note-${a._id}`} className="form-input"
                  value={notes[a._id] ?? ''}
                  onChange={(e) => setNotes((s) => ({ ...s, [a._id]: e.target.value }))} />
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
              <button className="neo-btn gold"
                disabled={decide.isPending || !assignees[a._id]}
                onClick={() => decide.mutate({ id: a._id, status: 'approved' })}>
                ✅ Approve → Sales
              </button>
              <button className="neo-btn" disabled={decide.isPending}
                onClick={() => decide.mutate({ id: a._id, status: 'returned' })}>
                ↩ Return for more qualification
              </button>
              <button className="neo-btn" disabled={decide.isPending}
                onClick={() => api('POST', `/approvals/${a._id}/escalate`, { note: notes[a._id] || '' })
                  .then(() => qc.invalidateQueries({ queryKey: ['is', 'handoffs'] }))
                  .catch((e) => setError(e instanceof ApiError ? e.message : 'Could not escalate'))}>
                ⬆ Escalate to Director
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
