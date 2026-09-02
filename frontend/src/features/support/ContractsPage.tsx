import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supportApi } from './api';
import { ApiError } from '../../api/client';
import { useMe } from '../../portal/useMe';

/**
 * IC-CSM-04 (AMC tracker and renewal pipeline) and IC-AG-03 (read-only reference).
 *
 * The same screen for both. An agent sees the contracts and NOT their value — not because
 * this component hides the column, but because `value` and `renewalValue` never arrive:
 * utils/redact.js strips them for a role without `finance.read`. The column is rendered
 * from what came back, so the rule holds even if this file is wrong.
 *
 * "Push to Sales as Suspect" is where doc 4's cycle rejoins doc 2's.
 */
export function ContractsPage() {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const [days, setDays] = useState(30);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canPush = !!me?.permissions.includes('kpi.read_team');
  const money = me?.scope.canSeeFinancials;

  const { data: all = [], isLoading } = useQuery({
    queryKey: ['contracts'],
    queryFn: () => supportApi.contracts(),
  });
  const { data: due = [] } = useQuery({
    queryKey: ['contracts', 'renewals', days],
    queryFn: () => supportApi.renewals(days),
    enabled: canPush,
  });

  const push = useMutation({
    mutationFn: (id: string) => supportApi.pushRenewal(id),
    onSuccess: (r) => {
      setError(null); setMsg(r.message ?? 'Pushed to Sales');
      qc.invalidateQueries({ queryKey: ['contracts'] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not push the renewal'),
  });

  return (
    <div>
      <h1 className="page-title">AMC <em>&amp; warranty</em></h1>
      <div className="page-sub">
        // {all.length} CONTRACT{all.length === 1 ? '' : 'S'}
        {money ? '' : ' · VALUES NOT SHOWN FOR YOUR ROLE'}
      </div>

      {error && <div className="offline-banner" style={{ borderColor: 'var(--coral)', marginTop: 12 }} role="alert">{error}</div>}
      {msg && !error && <div className="offline-banner" style={{ borderColor: 'var(--emerald)', marginTop: 12 }}>{msg}</div>}
      {isLoading && <div className="page-sub">// LOADING</div>}

      {canPush && (
        <>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', margin: '16px 0' }}>
            <div>
              <label className="form-label" htmlFor="d">Renewals due within</label>
              <select id="d" className="form-input" value={days} onChange={(e) => setDays(Number(e.target.value))}>
                {[30, 60, 90].map((n) => <option key={n} value={n}>{n} days</option>)}
              </select>
            </div>
          </div>

          <h3>Renewals due ({due.length})</h3>
          {!due.length && <div className="page-sub">// NOTHING DUE IN THIS WINDOW</div>}
          <div style={{ display: 'grid', gap: 10 }}>
            {due.map((c) => (
              <div key={c._id} className="card" style={{
                padding: 14,
                borderLeft: `4px solid ${(c.daysToExpiry ?? 99) < 15 ? 'var(--coral)' : 'var(--amber)'}`,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                  <div>
                    <strong>{c.customer?.name}</strong> — {c.ref}
                    <div style={{ color: 'var(--text-3)', fontSize: 12 }}>
                      expires {new Date(c.expiresAt).toLocaleDateString('en-IN')}
                      {c.daysToExpiry !== null ? ` · ${c.daysToExpiry} days` : ''}
                      {money && c.renewalValue ? ` · ₹${c.renewalValue.toLocaleString('en-IN')}` : ''}
                    </div>
                  </div>
                  <button className="neo-btn gold" disabled={push.isPending}
                    onClick={() => push.mutate(c._id)}>
                    → Push to Sales as Suspect
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <h3 style={{ marginTop: 24 }}>All contracts</h3>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 660 }}>
          <thead>
            <tr>
              {['Contract', 'Customer', 'Type', 'Expires', 'Status',
                ...(money ? ['Value'] : [])].map((h) => (
                  <th key={h} className="table-th">{h}</th>))}
            </tr>
          </thead>
          <tbody>
            {all.map((c) => (
              <tr key={c._id} style={{ borderTop: '1px solid #000' }}>
                <td style={{ padding: '10px 8px' }}>{c.ref}</td>
                <td style={{ padding: '10px 8px' }}>{c.customer?.name ?? '—'}</td>
                <td style={{ padding: '10px 8px' }}>{c.type.toUpperCase()}</td>
                <td style={{ padding: '10px 8px',
                  color: (c.daysToExpiry ?? 99) < 30 ? 'var(--amber)' : undefined }}>
                  {new Date(c.expiresAt).toLocaleDateString('en-IN')}
                </td>
                <td style={{ padding: '10px 8px' }}>
                  {c.renewalLead ? 'renewal in Sales' : c.status}
                </td>
                {money && (
                  <td style={{ padding: '10px 8px' }}>
                    {c.value ? `₹${c.value.toLocaleString('en-IN')}` : '—'}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!all.length && !isLoading && (
        <div className="page-sub">// NO CONTRACTS YET — THEY ARE CREATED WHEN A SIGN-OFF IS APPROVED</div>
      )}
    </div>
  );
}
