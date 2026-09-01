import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { prodApi } from './api';

/**
 * PD-HD-07 — the QC approval queue.
 *
 * A list, not a decision surface: the decision needs the test table, the engineer's
 * deviation note and the photos, which is the order screen. Deciding from a summary row
 * is how a marginal result gets waved through.
 */
export function QcQueuePage() {
  const nav = useNavigate();
  const { data: orders = [], isLoading } = useQuery({
    queryKey: ['production', 'orders'],
    queryFn: () => prodApi.orders(),
  });

  const pending = orders.filter((o) => o.qc?.submittedAt && !o.qc?.approvedAt);
  const approved = orders.filter((o) => o.qc?.approvedAt && !o.dispatchedAt);

  return (
    <div>
      <h1 className="page-title">QC <em>approvals</em></h1>
      <div className="page-sub">// {pending.length} AWAITING YOUR REVIEW · MANDATORY BEFORE DISPATCH</div>

      {isLoading && <div className="page-sub">// LOADING</div>}
      {!isLoading && !pending.length && <div className="page-sub" style={{ marginTop: 16 }}>// NOTHING PENDING</div>}

      <div style={{ display: 'grid', gap: 10, marginTop: 16 }}>
        {pending.map((o) => {
          const fails = o.qc.tests.filter((t) => t.status === 'fail').length;
          const marginal = o.qc.tests.filter((t) => t.status === 'marginal').length;
          return (
            <div key={o._id} className="card"
              style={{ padding: 14, cursor: 'pointer', borderLeft: '4px solid var(--amber)' }}
              onClick={() => nav(`/prod-head/orders/${o._id}`)}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                <div>
                  <strong>{o.woNumber}</strong> — {o.customerSnapshot?.company}
                  <div style={{ color: 'var(--text-3)', fontSize: 12 }}>
                    {o.items?.[0]?.name ?? '—'} · submitted by {o.assignedEngineer?.name ?? '—'}
                  </div>
                </div>
                <div style={{ textAlign: 'right', fontSize: 12 }}>
                  <div>{o.qc.tests.length} test{o.qc.tests.length === 1 ? '' : 's'}</div>
                  {!!fails && <div style={{ color: 'var(--coral)' }}>{fails} failed</div>}
                  {!!marginal && <div style={{ color: 'var(--amber)' }}>{marginal} marginal</div>}
                  {!fails && !marginal && <div style={{ color: 'var(--emerald)' }}>all passed</div>}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {!!approved.length && (
        <>
          <h3 style={{ marginTop: 24 }}>Approved, awaiting dispatch</h3>
          <div style={{ display: 'grid', gap: 8 }}>
            {approved.map((o) => (
              <div key={o._id} className="card" style={{ padding: 12, borderLeft: '4px solid var(--emerald)' }}>
                <strong>{o.woNumber}</strong> — {o.customerSnapshot?.company}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
