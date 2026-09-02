import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supportApi } from './api';
import { ApiError } from '../../api/client';
import { relTime } from '../insideSales/ActivityTimeline';

/**
 * IC-HD-04 — the Install Head reviews the signature, the CSAT and the engineer's
 * completion report, then closes the job. Approving is what creates the AMC.
 */
export function SignOffQueuePage() {
  const qc = useQueryClient();
  const [months, setMonths] = useState<Record<string, string>>({});
  const [value, setValue] = useState<Record<string, string>>({});
  const [note, setNote] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: queue = [], isLoading } = useQuery({
    queryKey: ['signoffs'],
    queryFn: supportApi.signOffQueue,
  });

  const decide = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      supportApi.decideSignOff(id, {
        status,
        note: note[id] || '',
        months: months[id] ? Number(months[id]) : undefined,
        value: value[id] ? Number(value[id]) : undefined,
      }),
    onSuccess: (r) => {
      setError(null); setMsg(r.message ?? 'Recorded');
      qc.invalidateQueries({ queryKey: ['signoffs'] });
      qc.invalidateQueries({ queryKey: ['installations'] });
      qc.invalidateQueries({ queryKey: ['contracts'] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not record the decision'),
  });

  return (
    <div>
      <h1 className="page-title">Sign-off <em>queue</em></h1>
      <div className="page-sub">// {queue.length} AWAITING YOUR REVIEW · APPROVING CREATES THE AMC</div>

      {error && <div className="offline-banner" style={{ borderColor: 'var(--coral)', marginTop: 12 }} role="alert">{error}</div>}
      {msg && !error && <div className="offline-banner" style={{ borderColor: 'var(--emerald)', marginTop: 12 }}>{msg}</div>}
      {isLoading && <div className="page-sub">// LOADING</div>}
      {!isLoading && !queue.length && <div className="page-sub" style={{ marginTop: 16 }}>// NOTHING PENDING</div>}

      <div style={{ display: 'grid', gap: 16, marginTop: 16 }}>
        {queue.map((a: any) => {
          const p = a.payload ?? {};
          return (
            <div key={a._id} className="card" style={{ padding: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                <div>
                  <h3 style={{ margin: 0 }}>{p.jobNumber} — {p.company}</h3>
                  <div style={{ color: 'var(--text-3)', fontSize: 12 }}>
                    signed by {p.signatoryName}{p.signatoryTitle ? `, ${p.signatoryTitle}` : ''}
                    {' · '}collected by {a.requestedBy?.name} · {relTime(a.createdAt)}
                  </div>
                </div>
                <div style={{ fontSize: 22, color: 'var(--gold)' }}>
                  {'★'.repeat(p.csat ?? 0)}{'☆'.repeat(Math.max(0, 5 - (p.csat ?? 0)))}
                </div>
              </div>

              {p.completionReport && (
                <>
                  <h4 style={{ marginBottom: 4 }}>Engineer's completion report</h4>
                  <div style={{ whiteSpace: 'pre-wrap' }}>{p.completionReport}</div>
                </>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginTop: 12 }}>
                <div>
                  <label className="form-label" htmlFor={`m-${a._id}`}>AMC months</label>
                  <input id={`m-${a._id}`} className="form-input" type="number" min={1} placeholder="12"
                    value={months[a._id] ?? ''} onChange={(e) => setMonths((s) => ({ ...s, [a._id]: e.target.value }))} />
                </div>
                <div>
                  <label className="form-label" htmlFor={`v-${a._id}`}>AMC value</label>
                  <input id={`v-${a._id}`} className="form-input" type="number" min={0}
                    value={value[a._id] ?? ''} onChange={(e) => setValue((s) => ({ ...s, [a._id]: e.target.value }))} />
                </div>
                <div>
                  <label className="form-label" htmlFor={`n-${a._id}`}>Note</label>
                  <input id={`n-${a._id}`} className="form-input"
                    value={note[a._id] ?? ''} onChange={(e) => setNote((s) => ({ ...s, [a._id]: e.target.value }))} />
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                <button className="neo-btn gold" disabled={decide.isPending}
                  onClick={() => decide.mutate({ id: a._id, status: 'approved' })}>
                  ✅ Approve &amp; close → create AMC
                </button>
                <button className="neo-btn" disabled={decide.isPending}
                  onClick={() => decide.mutate({ id: a._id, status: 'returned' })}>
                  ↩ Return to engineer
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
