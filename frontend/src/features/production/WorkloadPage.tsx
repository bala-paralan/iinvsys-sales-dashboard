import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { prodApi } from './api';
import { ApiError } from '../../api/client';

/**
 * PD-HD-02 — engineer workload and assignment.
 *
 * Assigning is also where the Head defines the WIP steps, because doc 3 PD-ENG-02 shows
 * the engineer following a checklist "defined by the Production Head" rather than writing
 * their own. Doing it in two screens would let an order be assigned with no steps, which
 * is an engineer with nothing to tick.
 */
const DEFAULT_STEPS = [
  'PCB sourcing & inspection',
  'SMD component placement & soldering',
  'Firmware flashing',
  'Enclosure assembly & sealing',
  'Burn-in test',
  'Final functional test',
  'Packaging & label',
];

export function WorkloadPage() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [engineerFor, setEngineerFor] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const { data: load } = useQuery({ queryKey: ['production', 'workload'], queryFn: prodApi.workload });
  const { data: orders = [] } = useQuery({
    queryKey: ['production', 'orders'],
    queryFn: () => prodApi.orders(),
  });

  const assign = useMutation({
    mutationFn: ({ id, engineer, withSteps }: { id: string; engineer: string; withSteps: boolean }) =>
      prodApi.assign(id, {
        engineer,
        wipSteps: withSteps ? DEFAULT_STEPS.map((label, i) => ({ order: i + 1, label })) : undefined,
      }),
    onSuccess: () => {
      setError(null); setMsg('Assigned');
      qc.invalidateQueries({ queryKey: ['production'] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not assign'),
  });

  const unassigned = orders.filter((o) => !o.assignedEngineer && !o.deliveredAt);

  return (
    <div>
      <h1 className="page-title">Engineer <em>workload</em></h1>
      <div className="page-sub">// WHO IS BUILDING WHAT</div>

      {error && <div className="offline-banner" style={{ borderColor: 'var(--coral)', marginTop: 12 }} role="alert">{error}</div>}
      {msg && !error && <div className="offline-banner" style={{ borderColor: 'var(--emerald)', marginTop: 12 }}>{msg}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 12, margin: '16px 0' }}>
        {load?.engineers.map((e) => (
          <div key={e.user._id} className="card" style={{ padding: 14 }}>
            <strong>{e.user.name}</strong>
            <div style={{ fontSize: 24, fontFamily: 'var(--font-display)' }}>{e.orders}</div>
            <div style={{ color: e.overdue ? 'var(--coral)' : 'var(--text-3)', fontSize: 12 }}>
              {e.orders === 0 ? 'available'
                : `${e.orders} order${e.orders === 1 ? '' : 's'}`}
              {e.overdue ? ` · ${e.overdue} overdue ⚠` : ''}
            </div>
          </div>
        ))}
      </div>

      <h3>Unassigned orders</h3>
      {!unassigned.length && <div className="page-sub">// EVERY ORDER HAS AN ENGINEER</div>}
      <div style={{ display: 'grid', gap: 10 }}>
        {unassigned.map((o) => (
          <div key={o._id} className="card" style={{ padding: 14, borderLeft: '4px solid var(--coral)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ cursor: 'pointer' }} onClick={() => nav(`/prod-head/orders/${o._id}`)}>
                <strong>{o.woNumber}</strong> — {o.customerSnapshot?.company}
                <div style={{ color: 'var(--text-3)', fontSize: 12 }}>
                  {o.items?.[0]?.name ?? '—'} · due {o.currentCommittedDate
                    ? new Date(o.currentCommittedDate).toLocaleDateString('en-IN') : 'TBC'}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <select className="form-input" style={{ maxWidth: 200 }}
                  aria-label={`Assign ${o.woNumber}`}
                  value={engineerFor[o._id] ?? ''}
                  onChange={(e) => setEngineerFor((s) => ({ ...s, [o._id]: e.target.value }))}>
                  <option value="">— engineer —</option>
                  {load?.engineers.map((e) => (
                    <option key={e.user._id} value={e.user._id}>
                      {e.user.name} ({e.orders})
                    </option>
                  ))}
                </select>
                <button className="neo-btn gold"
                  disabled={!engineerFor[o._id] || assign.isPending}
                  onClick={() => assign.mutate({
                    id: o._id, engineer: engineerFor[o._id],
                    withSteps: !o.wipSteps?.length,
                  })}>
                  Assign{!o.wipSteps?.length ? ' + 7 steps' : ''}
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
