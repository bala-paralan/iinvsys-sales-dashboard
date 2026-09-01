import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { isApi } from '../insideSales/api';
import { ActivityTimeline, relTime } from '../insideSales/ActivityTimeline';
import { LogActivityForm } from '../insideSales/LogActivityForm';
import { useMe } from '../../portal/useMe';

/**
 * Customer 360 — doc 1 IS-DIR-04 and doc 2 SA-DIR-06.
 *
 * "Any company shows the COMPLETE interaction history — every call, email, visit and
 * WhatsApp logged by ANY IS Executive or Sales Executive against this company, across
 * all time."
 *
 * Deliberately NOT owner-scoped: the point is the whole relationship, not one rep's
 * slice of it. Money in the payload is still redacted per role on the server, so a
 * finance-blind role sees the timeline without the values.
 */
export function Customer360Page() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const { data: me } = useMe();

  const { data, isLoading, isError } = useQuery({
    queryKey: ['customer360', id],
    queryFn: () => isApi.customer360(id),
    enabled: !!id,
  });

  if (isLoading) return <div className="page-sub">// LOADING</div>;
  if (isError || !data) return <div className="offline-banner" role="alert">Could not load this account.</div>;

  const { customer, metrics, leads = [], timeline = [] } = data;

  return (
    <div>
      <button className="neo-btn" onClick={() => nav(-1)} style={{ marginBottom: 12 }}>← Back</button>

      <h1 className="page-title">{customer.name} <em>360</em></h1>
      <div className="page-sub">
        // {customer.city || '—'} · {(customer.domain || 'none').replace(/_/g, ' ').toUpperCase()}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, margin: '16px 0' }}>
        <Tile label="Active deals" value={String(metrics.activeDeals)} />
        <Tile label="IS leads" value={String(metrics.activeInsideSalesLeads)} />
        {me?.scope.canSeeFinancials && (
          <Tile label="Lifetime revenue"
            value={`₹${(metrics.lifetimeRevenue ?? 0).toLocaleString('en-IN')}`} />
        )}
        <Tile label="Interactions" value={String(metrics.totalInteractions)} />
        <Tile label="Last contact" value={relTime(metrics.lastContact)}
          tone={!metrics.lastContact ? 'var(--coral)' : undefined} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
        <div className="card" style={{ padding: 16 }}>
          <h3 style={{ marginTop: 0 }}>Contacts</h3>
          {(customer.contacts ?? []).length === 0 && (
            <div className="page-sub">// NO CONTACTS RECORDED</div>
          )}
          {(customer.contacts ?? []).map((c: any) => (
            <div key={c._id} style={{ padding: '6px 0', borderBottom: '1px solid #000' }}>
              <strong>{c.name}</strong>
              {c.isPrimary && <span style={{ color: 'var(--gold)' }}> ★</span>}
              <div style={{ color: 'var(--text-3)', fontSize: 12 }}>{c.designation || '—'}</div>
            </div>
          ))}
          <div style={{ marginTop: 10, color: 'var(--text-3)', fontSize: 12 }}>
            Account owner: {customer.accountOwner?.name ?? '—'}
            {customer.accountManager ? ` · Manager: ${customer.accountManager.name}` : ''}
          </div>
        </div>

        <div className="card" style={{ padding: 16 }}>
          <h3 style={{ marginTop: 0 }}>Records on this account</h3>
          {!leads.length && <div className="page-sub">// NOTHING YET</div>}
          {leads.map((l: any) => (
            <div key={l._id} style={{ padding: '6px 0', borderBottom: '1px solid #000' }}>
              <strong>{l.refId}</strong> · {l.track === 'inside_sales' ? 'Inside Sales' : 'Sales'}
              <div style={{ color: 'var(--text-3)', fontSize: 12 }}>
                {l.opportunityName || l.stage} · {l.owner?.name ?? 'unassigned'}
              </div>
            </div>
          ))}
        </div>
      </div>

      {me?.permissions.includes('activity.write') && (
        <div style={{ marginTop: 16 }}>
          <LogActivityForm customerId={id} />
        </div>
      )}

      <h3 style={{ marginTop: 24 }}>Complete interaction timeline — all team members</h3>
      <ActivityTimeline activities={timeline} />
    </div>
  );
}

function Tile({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="card" style={{ padding: 14 }}>
      <div style={{ color: 'var(--text-3)', fontSize: 12, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 22, fontFamily: 'var(--font-display)', color: tone }}>{value}</div>
    </div>
  );
}
