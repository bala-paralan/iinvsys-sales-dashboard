import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { isApi } from '../insideSales/api';
import { useMe } from '../../portal/useMe';

/** The account list — the way into Customer 360. */
export function CustomersPage() {
  const nav = useNavigate();
  const { data: me } = useMe();
  const [q, setQ] = useState('');

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['customers', q],
    queryFn: () => isApi.customers(q ? `?q=${encodeURIComponent(q)}` : ''),
  });

  const base = `/${me?.portal?.key ?? ''}`;

  return (
    <div>
      <h1 className="page-title">Customer <em>accounts</em></h1>
      <div className="page-sub">// SEARCH ANY COMPANY FOR ITS COMPLETE HISTORY</div>

      <input className="form-input" style={{ margin: '16px 0', maxWidth: 380 }}
        placeholder="Search company…" value={q} onChange={(e) => setQ(e.target.value)}
        aria-label="Search customers" />

      {isLoading && <div className="page-sub">// LOADING</div>}
      {!isLoading && !rows.length && <div className="page-sub">// NO ACCOUNTS MATCH</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
        {rows.map((c: any) => (
          <div key={c._id} className="card" style={{ padding: 14, cursor: 'pointer' }}
            onClick={() => nav(`${base}/customers/${c._id}`)}>
            <strong>{c.name}</strong>
            <div style={{ color: 'var(--text-3)', fontSize: 12 }}>
              {c.city || '—'} · {(c.domain || 'none').replace(/_/g, ' ')}
            </div>
            <div style={{ color: 'var(--text-3)', fontSize: 12, marginTop: 4 }}>
              Owner: {c.accountOwner?.name ?? '—'}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
