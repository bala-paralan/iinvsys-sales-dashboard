import { useState } from 'react';
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
 * all time" — plus, per SA-DIR-06, the deals, the open CS tickets and the AMC, because
 * the Director opening this screen is asking about the relationship, not one module's
 * slice of it.
 *
 * Deliberately NOT owner-scoped. Money in the payload is still redacted per role on the
 * server, so a finance-blind role sees the timeline without the values.
 */
const TABS = [
  { key: 'all', label: 'All' },
  { key: 'call', label: 'Calls' },
  { key: 'email', label: 'Emails' },
  { key: 'visit', label: 'Visits' },
  { key: 'deals', label: 'Deals' },
  { key: 'tickets', label: 'CS tickets' },
];

export function Customer360Page() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const { data: me } = useMe();
  const [tab, setTab] = useState('all');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['customer360', id],
    queryFn: () => isApi.customer360(id),
    enabled: !!id,
  });

  if (isLoading) return <div className="page-sub">// LOADING</div>;
  if (isError || !data) return <div className="offline-banner" role="alert">Could not load this account.</div>;

  const { customer, metrics, leads = [], timeline = [], tickets = [] } = data;
  const byType = metrics.byType ?? {};
  const portal = me?.portal?.key ?? '';
  const salesBase = portal === 'director' ? '/director/sales' : `/${portal}`;

  /* The tab counts come from the server's aggregation over ALL activity; the timeline
     itself is the most recent hundred. Filtering that page can therefore show fewer rows
     than the tab promises on a very busy account — which is honest, and the alternative
     is shipping every activity ever logged to render a badge. */
  const count = (k: string) => byType[k] ?? 0;
  const shownActivities = tab === 'all' ? timeline
    : ['call', 'email', 'visit'].includes(tab)
      ? timeline.filter((a: any) => a.type === tab)
      : [];

  return (
    <div>
      <button className="neo-btn" onClick={() => nav(-1)} style={{ marginBottom: 12 }}>← Back</button>

      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div>
          <h1 className="page-title">{customer.name} <em>360</em></h1>
          <div className="page-sub">
            // {customer.city || '—'} · {(customer.domain || 'none').replace(/_/g, ' ').toUpperCase()}
          </div>
        </div>
        {me?.permissions.includes('lead.write') && (
          <button className="neo-btn gold" onClick={() => nav(`${salesBase}/new`)}>
            ➕ Create deal for {customer.name}
          </button>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, margin: '16px 0' }}>
        <Tile label="Account manager"
          value={customer.accountManager?.name ?? customer.accountOwner?.name ?? '—'} />
        <Tile label="Active deals" value={String(metrics.activeDeals)} />
        <Tile label="IS leads" value={String(metrics.activeInsideSalesLeads)} />
        {me?.scope.canSeeFinancials && (
          <Tile label="Lifetime revenue"
            value={`₹${(metrics.lifetimeRevenue ?? 0).toLocaleString('en-IN')}`} />
        )}
        <Tile label="Interactions" value={String(metrics.totalInteractions)} />
        <Tile label="Open CS tickets" value={String(metrics.openTickets ?? 0)}
          tone={metrics.openTickets ? 'var(--amber)' : undefined} />
        <Tile label="AMC status"
          value={metrics.amc
            ? `${metrics.amc.status} till ${new Date(metrics.amc.expiresAt)
              .toLocaleDateString('en-IN', { month: 'short', year: '2-digit' })}`
            : 'None'}
          tone={!metrics.amc || metrics.amc.status === 'expired' ? 'var(--text-3)' : undefined} />
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

      <h3 style={{ marginTop: 24, marginBottom: 8 }}>Complete history — all team members</h3>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
        {TABS.map((t) => {
          const n = t.key === 'all' ? metrics.totalInteractions
            : t.key === 'deals' ? leads.length
              : t.key === 'tickets' ? tickets.length
                : count(t.key);
          return (
            <button key={t.key} type="button" className="neo-btn" aria-pressed={tab === t.key}
              style={tab === t.key ? { borderColor: 'var(--gold)', color: 'var(--gold)' } : undefined}
              onClick={() => setTab(t.key)}>
              {t.label} ({n})
            </button>
          );
        })}
      </div>

      {tab === 'deals' && (
        <div style={{ display: 'grid', gap: 8 }}>
          {!leads.length && <div className="page-sub">// NO DEALS OR LEADS ON THIS ACCOUNT</div>}
          {leads.map((l: any) => (
            <div key={l._id} className="card"
              style={{ padding: 12, cursor: l.track === 'sales' ? 'pointer' : 'default' }}
              onClick={() => l.track === 'sales' && nav(`${salesBase}/deals/${l._id}`)}>
              <strong>{l.refId}</strong> — {l.opportunityName || l.company || customer.name}
              <div style={{ color: 'var(--text-3)', fontSize: 12 }}>
                {l.track === 'inside_sales' ? 'Inside Sales' : 'Sales'} ·{' '}
                {String(l.stage).replace(/_/g, ' ')} · {l.owner?.name ?? 'unassigned'}
                {l.value ? ` · ₹${l.value.toLocaleString('en-IN')}` : ''}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'tickets' && (
        <div style={{ display: 'grid', gap: 8 }}>
          {!tickets.length && <div className="page-sub">// NO SUPPORT TICKETS RAISED</div>}
          {tickets.map((t: any) => {
            const open = !['resolved', 'closed'].includes(t.status);
            return (
              <div key={t._id} className="card"
                style={{ padding: 12, borderLeft: `4px solid ${open ? 'var(--amber)' : 'var(--emerald)'}` }}>
                <strong>{t.ref}</strong> — {t.subject}
                <div style={{ color: 'var(--text-3)', fontSize: 12 }}>
                  {String(t.status).replace(/_/g, ' ')} · {t.priority} ·{' '}
                  {t.assignedTo?.name ?? 'unassigned'} · raised {relTime(t.raisedAt)}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!['deals', 'tickets'].includes(tab) && <ActivityTimeline activities={shownActivities} />}
    </div>
  );
}

function Tile({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="card" style={{ padding: 14 }}>
      <div style={{ color: 'var(--text-3)', fontSize: 12, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 18, fontFamily: 'var(--font-display)', color: tone }}>{value}</div>
    </div>
  );
}
