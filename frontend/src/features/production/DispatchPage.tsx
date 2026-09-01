import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { prodApi } from './api';
import { ApiError } from '../../api/client';

/**
 * PD-HD-08 (dispatch authorisation) and PD-HD-09 (delivery tracking).
 *
 * Only orders whose QC the Head has approved appear here at all — the endpoint refuses
 * without it and the dispatch stage gate refuses without it, so this list showing nothing
 * for an un-QC'd order is the third and least important of the three layers.
 */
const MODES = [
  'Road – Company Vehicle',
  'Road – Courier (Blue Dart)',
  'Road – Courier (FedEx)',
  'Air Cargo',
  'Rail Cargo',
];

export function DispatchPage() {
  const qc = useQueryClient();
  const [form, setForm] = useState<Record<string, Record<string, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ['production', 'orders'],
    queryFn: () => prodApi.orders(),
  });

  const authorise = useMutation({
    mutationFn: (id: string) => prodApi.authoriseDispatch(id, {
      mode: form[id]?.mode,
      awb: form[id]?.awb,
      dispatchDate: form[id]?.dispatchDate || undefined,
      expectedDelivery: form[id]?.expectedDelivery || undefined,
      cartons: form[id]?.cartons ? Number(form[id].cartons) : undefined,
      grossWeightKg: form[id]?.weight ? Number(form[id].weight) : undefined,
      notes: form[id]?.notes || '',
    }),
    onSuccess: () => {
      setError(null); setMsg('Dispatch authorised — delivery tracking is live');
      qc.invalidateQueries({ queryKey: ['production'] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not authorise dispatch'),
  });

  const set = (id: string, k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((s) => ({ ...s, [id]: { ...(s[id] ?? {}), [k]: e.target.value } }));

  const ready = orders.filter((o) => o.qc?.approvedAt && !o.dispatchedAt);
  const inTransit = orders.filter((o) => o.dispatchedAt && !o.deliveredAt);
  const delivered = orders.filter((o) => o.deliveredAt);

  return (
    <div>
      <h1 className="page-title">Dispatch <em>&amp; delivery</em></h1>
      <div className="page-sub">// QC-APPROVED ORDERS ONLY — HEAD AUTHORISATION</div>

      {error && <div className="offline-banner" style={{ borderColor: 'var(--coral)', marginTop: 12 }} role="alert">{error}</div>}
      {msg && !error && <div className="offline-banner" style={{ borderColor: 'var(--emerald)', marginTop: 12 }}>{msg}</div>}
      {isLoading && <div className="page-sub">// LOADING</div>}

      <h3 style={{ marginTop: 20 }}>Ready to dispatch ({ready.length})</h3>
      {!ready.length && <div className="page-sub">// NOTHING QC-APPROVED AND WAITING</div>}
      <div style={{ display: 'grid', gap: 16 }}>
        {ready.map((o) => (
          <div key={o._id} className="card" style={{ padding: 16, borderLeft: '4px solid var(--emerald)' }}>
            <h3 style={{ margin: 0 }}>{o.woNumber} — {o.customerSnapshot?.company}</h3>
            <div style={{ color: 'var(--text-3)', fontSize: 12 }}>
              {o.items?.[0]?.name ?? '—'} · {[o.customerSnapshot?.city, o.customerSnapshot?.state].filter(Boolean).join(', ')}
              {' · QC approved ✓'}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10, marginTop: 12 }}>
              <div>
                <label className="form-label" htmlFor={`m-${o._id}`}>Dispatch mode *</label>
                <select id={`m-${o._id}`} className="form-input"
                  value={form[o._id]?.mode ?? ''} onChange={set(o._id, 'mode')}>
                  <option value="">— select —</option>
                  {MODES.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <Field id={`a-${o._id}`} label="AWB / docket *" value={form[o._id]?.awb ?? ''} onChange={set(o._id, 'awb')} />
              <Field id={`d-${o._id}`} label="Dispatch date" type="date" value={form[o._id]?.dispatchDate ?? ''} onChange={set(o._id, 'dispatchDate')} />
              <Field id={`e-${o._id}`} label="Expected delivery" type="date" value={form[o._id]?.expectedDelivery ?? ''} onChange={set(o._id, 'expectedDelivery')} />
              <Field id={`c-${o._id}`} label="Cartons" type="number" value={form[o._id]?.cartons ?? ''} onChange={set(o._id, 'cartons')} />
              <Field id={`w-${o._id}`} label="Gross weight (kg)" type="number" value={form[o._id]?.weight ?? ''} onChange={set(o._id, 'weight')} />
            </div>

            <button className="neo-btn gold" style={{ marginTop: 12 }}
              disabled={!form[o._id]?.mode || !form[o._id]?.awb || authorise.isPending}
              onClick={() => authorise.mutate(o._id)}>
              🚚 Confirm dispatch
            </button>
          </div>
        ))}
      </div>

      <h3 style={{ marginTop: 24 }}>In transit ({inTransit.length})</h3>
      <div style={{ display: 'grid', gap: 8 }}>
        {inTransit.map((o) => (
          <div key={o._id} className="card" style={{ padding: 12, borderLeft: '4px solid var(--amber)' }}>
            <strong>{o.woNumber}</strong> — {o.customerSnapshot?.company}
            <div style={{ color: 'var(--text-3)', fontSize: 12 }}>
              {o.dispatchAuth?.mode} {o.dispatchAuth?.awb}
              {o.dispatchAuth?.expectedDelivery
                ? ` · expected ${new Date(o.dispatchAuth.expectedDelivery).toLocaleDateString('en-IN')}`
                : ''}
            </div>
            <div style={{ color: 'var(--text-4)', fontSize: 11, marginTop: 4 }}>
              POD is recorded on the delivery board — confirming it creates the installation job.
            </div>
          </div>
        ))}
        {!inTransit.length && <div className="page-sub">// NOTHING IN TRANSIT</div>}
      </div>

      {!!delivered.length && (
        <>
          <h3 style={{ marginTop: 24 }}>Delivered ({delivered.length})</h3>
          <div style={{ display: 'grid', gap: 8 }}>
            {delivered.map((o) => (
              <div key={o._id} className="card" style={{ padding: 12, borderLeft: '4px solid var(--emerald)' }}>
                <strong>{o.woNumber}</strong> — {o.customerSnapshot?.company}
                <div style={{ color: 'var(--text-3)', fontSize: 12 }}>
                  Delivered {new Date(o.deliveredAt!).toLocaleDateString('en-IN')}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Field({ id, label, value, onChange, type = 'text' }: {
  id: string; label: string; value: string; type?: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <div>
      <label className="form-label" htmlFor={id}>{label}</label>
      <input id={id} className="form-input" type={type} value={value} onChange={onChange} />
    </div>
  );
}
