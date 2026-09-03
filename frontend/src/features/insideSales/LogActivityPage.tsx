import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { isApi } from './api';
import { api } from '../../api/client';
import { LogActivityForm } from './LogActivityForm';
import { ActivityTimeline } from './ActivityTimeline';
import { useMe } from '../../portal/useMe';

/**
 * "Log Activity" as its own screen — doc 1 IS-EX-04 and doc 2 SA-EX-04.
 *
 * The form already exists on the lead and deal detail pages, where you arrive having
 * chosen a record. This is the other direction, and the one both documents draw: you have
 * just come off a call and want to log it without first hunting for the lead. So the
 * account is picked here, and the deal link is optional — doc 2 SA-EX-04 offers "General
 * Account Activity (no deal)" explicitly, because not every conversation is about a deal.
 *
 * Reuses LogActivityForm rather than restating it, so the "next action creates a task"
 * behaviour cannot drift between the two places it is offered.
 */
export function LogActivityPage() {
  const { data: me } = useMe();
  const [customerId, setCustomerId] = useState('');
  const [dealId, setDealId] = useState('');

  const { data: customers = [] } = useQuery({
    queryKey: ['customers', 'for-logging'],
    queryFn: () => isApi.customers('?limit=200'),
  });

  const isInsideSales = me?.role === 'is_executive' || me?.role === 'is_head';

  /* The caller's own records against the chosen account, so the deal picker offers only
     things they could legitimately be talking about. */
  const { data: records = [] } = useQuery({
    queryKey: ['records', 'for-logging', customerId, isInsideSales],
    queryFn: async () => (isInsideSales
      ? await isApi.leads(`?limit=200`)
      : (await import('../sales/api')).salesApi.board().then((b) =>
        b.stages.flatMap((s) => s.deals))),
    enabled: !!customerId,
  });

  const forCustomer = (records as any[]).filter(
    (r) => String(r.customer?._id ?? r.customer) === String(customerId),
  );

  /* Doc 2 SA-EX-04's counter panel — "Daily target: 5 activities. 1 more needed after
     this." A flat number nobody is measured against does not change behaviour. */
  const { data: compliance } = useQuery({
    queryKey: ['activities', 'compliance'],
    queryFn: async () => (await api<{
      dailyTarget: number;
      today: { total: number; call: number; email: number; visit: number };
    }>('GET', '/activities/compliance')).data,
  });

  const { data: timeline = [] } = useQuery({
    queryKey: ['activities', 'customer', customerId],
    queryFn: () => isApi.activities(`?customer=${customerId}`),
    enabled: !!customerId,
  });

  return (
    <div>
      <h1 className="page-title">Log <em>activity</em></h1>
      <div className="page-sub">// EVERY CALL, EMAIL, VISIT AND MESSAGE — AGAINST THE ACCOUNT</div>

      <div className="card" style={{ padding: 16, marginTop: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10 }}>
          <div>
            <label className="form-label" htmlFor="cust">Customer account *</label>
            <select id="cust" className="form-input" value={customerId}
              onChange={(e) => { setCustomerId(e.target.value); setDealId(''); }}>
              <option value="">— select an account —</option>
              {(customers as any[]).map((c) => (
                <option key={c._id} value={c._id}>
                  {c.name}{c.city ? ` — ${c.city}` : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="form-label" htmlFor="deal">
              Link to {isInsideSales ? 'lead' : 'deal'} (optional)
            </label>
            <select id="deal" className="form-input" value={dealId}
              disabled={!customerId}
              onChange={(e) => setDealId(e.target.value)}>
              <option value="">General account activity (no {isInsideSales ? 'lead' : 'deal'})</option>
              {forCustomer.map((r) => (
                <option key={r._id} value={r._id}>
                  {r.refId} — {r.name || r.company}
                </option>
              ))}
            </select>
          </div>
        </div>
        {!customerId && (
          <p className="page-sub" style={{ marginTop: 12, marginBottom: 0 }}>
            // PICK AN ACCOUNT TO START. ACTIVITIES BELONG TO THE COMPANY, NOT THE LEAD —
            // SO EVERY CONVERSATION WITH THEM LANDS IN ONE TIMELINE.
          </p>
        )}
      </div>

      {compliance?.today && (
        <div className="card" style={{ padding: 14, marginTop: 16 }}>
          <h3 style={{ margin: '0 0 10px' }}>Today's activity count</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10 }}>
            <Count label="📞 Calls" n={compliance.today.call} />
            <Count label="📧 Emails" n={compliance.today.email} />
            <Count label="🤝 Visits" n={compliance.today.visit} />
            <Count label="Total today" n={compliance.today.total} />
          </div>
          <div style={{ marginTop: 10, fontSize: 12,
            color: compliance.today.total >= compliance.dailyTarget ? 'var(--emerald)' : 'var(--amber)' }}>
            Daily target: {compliance.dailyTarget} activities.{' '}
            {compliance.today.total >= compliance.dailyTarget
              ? 'Target met ✓'
              : `${compliance.dailyTarget - compliance.today.total} more needed.`}
          </div>
        </div>
      )}

      {customerId && (
        <>
          <div style={{ marginTop: 16 }}>
            <LogActivityForm customerId={customerId} dealId={dealId || undefined} />
          </div>
          <h3 style={{ marginTop: 24 }}>Recent activity on this account</h3>
          <ActivityTimeline activities={timeline} />
        </>
      )}
    </div>
  );
}

function Count({ label, n }: { label: string; n: number }) {
  return (
    <div>
      <div style={{ color: 'var(--text-3)', fontSize: 12 }}>{label}</div>
      <div style={{ fontSize: 20, fontFamily: 'var(--font-display)' }}>{n}</div>
    </div>
  );
}
