import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { prodApi, money } from './api';
import { useMe } from '../../portal/useMe';

/**
 * PD-HD-01 (the Head's command centre) and PD-ENG-01 (the engineer's own orders).
 *
 * One screen at two scopes, and the difference is not cosmetic: the Head's rows carry an
 * Order Value column and the engineer's do not, because the SERVER never sent one. Doc 3:
 * "not just hidden in the UI but not sent to the engineer's session at all."
 */
const STAGE_LABEL: Record<string, string> = {
  order_review: 'Order Review',
  procurement: 'Procurement',
  preparation_packing: 'In Production',
  scheduling_dispatch: 'Ready to Dispatch',
  delivery_handover: 'Delivered',
};

export function ProductionDashboardPage() {
  const nav = useNavigate();
  const { data: me } = useMe();
  const isHead = !!me?.permissions.includes('workorder.dispatch');

  const { data: orders = [], isLoading, isError } = useQuery({
    queryKey: ['production', 'orders'],
    queryFn: () => prodApi.orders(),
  });

  const base = `/${me?.portal?.key ?? ''}/orders`;
  const active = orders.filter((o) => !o.deliveredAt);
  const overdue = active.filter((o) => o.currentCommittedDate
    && new Date(o.currentCommittedDate) < new Date());
  const qcPending = orders.filter((o) => o.qc?.submittedAt && !o.qc?.approvedAt);
  const readyToDispatch = orders.filter((o) => o.qc?.approvedAt && !o.dispatchedAt);

  return (
    <div>
      <h1 className="page-title">
        {isHead ? <>Production <em>dashboard</em></> : <>My <em>production</em></>}
      </h1>
      <div className="page-sub">
        // {isHead ? 'ALL ORDERS, ALL ENGINEERS' : 'ONLY THE ORDERS ASSIGNED TO YOU'}
      </div>

      {isError && <div className="offline-banner" role="alert" style={{ marginTop: 12 }}>
        Could not load production orders.
      </div>}
      {isLoading && <div className="page-sub">// LOADING</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, margin: '16px 0' }}>
        <Tile label="Active orders" value={String(active.length)} />
        <Tile label="Overdue" value={String(overdue.length)}
          tone={overdue.length ? 'var(--coral)' : undefined}
          hint={overdue.length ? overdue[0].woNumber : undefined} />
        <Tile label={isHead ? 'QC pending' : 'QC submitted'} value={String(qcPending.length)}
          tone={qcPending.length ? 'var(--amber)' : undefined}
          hint={isHead ? 'Awaiting your review' : 'Awaiting the Head'} />
        {isHead && <Tile label="Ready to dispatch" value={String(readyToDispatch.length)}
          tone={readyToDispatch.length ? 'var(--emerald)' : undefined} />}
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 780 }}>
          <thead>
            <tr>
              {['Order', 'Customer', 'Product', ...(isHead ? ['Order value'] : []),
                'Stage', ...(isHead ? ['Engineer'] : []), 'Target', '% complete', ''].map((h) => (
                  <th key={h} className="table-th">{h}</th>))}
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => {
              const late = o.currentCommittedDate
                && new Date(o.currentCommittedDate) < new Date() && !o.deliveredAt;
              return (
                <tr key={o._id} style={{ borderTop: '1px solid #000', cursor: 'pointer' }}
                  onClick={() => nav(`${base}/${o._id}`)}>
                  <td style={{ padding: '10px 8px' }}>{o.woNumber}</td>
                  <td style={{ padding: '10px 8px' }}>
                    <strong>{o.customerSnapshot?.company || o.customerSnapshot?.name}</strong>
                    <div style={{ color: 'var(--text-3)', fontSize: 12 }}>
                      {o.customerSnapshot?.city}
                    </div>
                  </td>
                  <td style={{ padding: '10px 8px' }}>
                    {o.items?.[0]?.name ?? '—'}
                    {o.items?.length > 1 ? ` +${o.items.length - 1}` : ''}
                  </td>
                  {isHead && <td style={{ padding: '10px 8px' }}>{money(o.poValue)}</td>}
                  <td style={{ padding: '10px 8px', color: late ? 'var(--coral)' : undefined }}>
                    {late ? 'OVERDUE ⚠' : STAGE_LABEL[o.stage] ?? o.stage}
                  </td>
                  {isHead && (
                    <td style={{ padding: '10px 8px' }}>
                      {o.assignedEngineer?.name
                        ?? <span style={{ color: 'var(--coral)' }}>unassigned</span>}
                    </td>
                  )}
                  <td style={{ padding: '10px 8px', color: late ? 'var(--coral)' : undefined }}>
                    {o.currentCommittedDate
                      ? new Date(o.currentCommittedDate).toLocaleDateString('en-IN')
                      : '—'}
                  </td>
                  <td style={{ padding: '10px 8px' }}>
                    {o.wipPercent === null ? '—' : `${o.wipPercent}%`}
                  </td>
                  <td style={{ padding: '10px 8px', textAlign: 'right' }}>→</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {!isLoading && !orders.length && (
        <div className="page-sub">
          // {isHead ? 'NO PRODUCTION ORDERS YET — THEY ARRIVE WHEN A COMMERCIAL ORDER IS CONFIRMED'
            : 'NOTHING ASSIGNED TO YOU YET'}
        </div>
      )}
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
