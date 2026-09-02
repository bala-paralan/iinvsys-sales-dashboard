import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { prodApi, money, type QcTest } from './api';
import { ApiError } from '../../api/client';
import { useMe } from '../../portal/useMe';

/**
 * The order working screen — PD-HD-03/06 for the Head, PD-ENG-02/03/04/05 for the engineer.
 *
 * The difference between the two views is NOT a prop on this component: the Head's payload
 * carries `poValue` and BOM prices and the engineer's does not, because the server sends
 * two different documents. This file renders whatever arrived, which is why doc 3's rule
 * cannot be undone by a mistake here.
 */
export function ProductionOrderPage() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const isHead = !!me?.permissions.includes('workorder.dispatch');

  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [issue, setIssue] = useState('');
  const [qcRows, setQcRows] = useState<QcTest[]>([]);
  const [qcNotes, setQcNotes] = useState('');

  const { data: order, isLoading } = useQuery({
    queryKey: ['production', 'order', id],
    queryFn: () => prodApi.order(id),
    enabled: !!id,
  });

  const after = (m: string) => {
    setError(null); setMsg(m);
    qc.invalidateQueries({ queryKey: ['production'] });
  };
  const onErr = (e: unknown) => setError(e instanceof ApiError ? e.message : 'Request failed');

  const step = useMutation({
    mutationFn: ({ stepId, status }: { stepId: string; status: string }) =>
      prodApi.updateStep(id, stepId, { status }),
    onSuccess: () => after('Step updated'),
    onError: onErr,
  });

  const submitQc = useMutation({
    mutationFn: () => prodApi.submitQc(id, { tests: qcRows, notes: qcNotes }),
    onSuccess: () => { setQcRows([]); setQcNotes(''); after('QC submitted to the Production Head'); },
    onError: onErr,
  });

  const decideQc = useMutation({
    mutationFn: ({ status, reason }: { status: string; reason?: string }) =>
      prodApi.decideQc(id, { status, reason }),
    onSuccess: (r: any) => after(r.message ?? 'Recorded'),
    onError: onErr,
  });

  /* Doc 3 PD-ENG-02 puts a photo against each completed step as proof. The endpoint and
     the API wrapper existed from the start; there was no control to reach them, which is
     the same defect class as v2.0.1 — a backend that enforces something the UI offers no
     way to satisfy. */
  const photo = useMutation({
    mutationFn: ({ stepId, file }: { stepId: string; file: File }) => {
      const form = new FormData();
      form.append('file', file);
      return prodApi.stepPhoto(id, stepId, form);
    },
    onSuccess: () => after('Photo attached'),
    onError: onErr,
  });

  const flag = useMutation({
    mutationFn: () => prodApi.flagIssue(id, { description: issue, severity: 'high' }),
    onSuccess: () => { setIssue(''); after('Issue flagged to the Production Head'); },
    onError: onErr,
  });

  if (isLoading) return <div className="page-sub">// LOADING</div>;
  if (!order) return <div className="offline-banner" role="alert">Order not found, or not assigned to you.</div>;

  const o = order;
  const current = o.wipSteps?.find((s) => s.status !== 'done');
  const qcSubmitted = !!o.qc?.submittedAt;
  const qcApproved = !!o.qc?.approvedAt;

  return (
    <div>
      <button className="neo-btn" onClick={() => nav(-1)} style={{ marginBottom: 12 }}>← Back</button>

      <h1 className="page-title">
        {o.woNumber} <em>{o.customerSnapshot?.company}</em>
      </h1>
      <div className="page-sub">
        // {o.stage.replace(/_/g, ' ').toUpperCase()}
        {o.wipPercent !== null ? ` · ${o.wipPercent}% COMPLETE` : ''}
      </div>

      {error && <div className="offline-banner" style={{ borderColor: 'var(--coral)', marginTop: 12 }} role="alert">{error}</div>}
      {msg && !error && <div className="offline-banner" style={{ borderColor: 'var(--emerald)', marginTop: 12 }}>{msg}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16, marginTop: 16 }}>
        <div className="card" style={{ padding: 16 }}>
          <h3 style={{ marginTop: 0 }}>
            Order summary
            {!isHead && <span style={{ color: 'var(--text-3)', fontWeight: 400, fontSize: 13 }}>
              {' '}— no financial values
            </span>}
          </h3>
          <Row label="Order" value={o.woNumber} />
          <Row label="Customer" value={o.customerSnapshot?.company || '—'} />
          <Row label="Site" value={[o.customerSnapshot?.city, o.customerSnapshot?.state].filter(Boolean).join(', ') || '—'} />
          <Row label="Product" value={o.items?.[0]?.name ?? '—'} />
          <Row label="Quantity" value={String(o.items?.[0]?.quantity ?? '—')} />
          {/* Rendered only when the value is present. It is absent — not zero, not
              hidden — for a finance-blind role. */}
          {o.poValue !== undefined && <Row label="Order value" value={money(o.poValue)} />}
          <Row label="Target date" value={o.currentCommittedDate
            ? new Date(o.currentCommittedDate).toLocaleDateString('en-IN') : '—'} />
          <Row label="Engineer" value={o.assignedEngineer?.name ?? 'unassigned'} />
        </div>

        <div className="card" style={{ padding: 16 }}>
          <h3 style={{ marginTop: 0 }}>Bill of materials</h3>
          {!o.bom?.length && <div className="page-sub">// NO BOM RECORDED</div>}
          {!!o.bom?.length && (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>{['Part', 'Qty', 'Spec', ...(isHead ? ['Unit price'] : [])].map((h) => (
                  <th key={h} className="table-th">{h}</th>))}
                </tr>
              </thead>
              <tbody>
                {o.bom.map((l) => (
                  <tr key={l._id} style={{ borderTop: '1px solid #000' }}>
                    <td style={{ padding: '6px 4px' }}>{l.part}</td>
                    <td style={{ padding: '6px 4px' }}>{l.quantity} {l.unit}</td>
                    <td style={{ padding: '6px 4px', color: 'var(--text-3)', fontSize: 12 }}>{l.spec}</td>
                    {isHead && <td style={{ padding: '6px 4px' }}>{money(l.unitPrice)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <h3 style={{ marginTop: 24 }}>Production steps</h3>
      {!o.wipSteps?.length && (
        <div className="page-sub">// NO STEPS DEFINED — THE PRODUCTION HEAD SETS THESE WHEN ASSIGNING</div>
      )}
      <div style={{ display: 'grid', gap: 8 }}>
        {o.wipSteps?.map((s) => {
          const isCurrent = current?._id === s._id;
          return (
            <div key={s._id} className="card" style={{
              padding: 12,
              borderLeft: `4px solid ${s.status === 'done' ? 'var(--emerald)'
                : isCurrent ? 'var(--gold)' : 'var(--surface-3)'}`,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                <div>
                  <strong>{s.status === 'done' ? '✓' : s.order}. {s.label}</strong>
                  {isCurrent && <span style={{ color: 'var(--gold)' }}> ← current step</span>}
                  {s.instruction && (
                    <div style={{ color: 'var(--text-3)', fontSize: 12 }}>{s.instruction}</div>
                  )}
                  {s.completedAt && (
                    <div style={{ color: 'var(--text-4)', fontSize: 11 }}>
                      Completed {new Date(s.completedAt).toLocaleDateString('en-IN')}
                      {s.photo ? ' · photo attached' : ''}
                    </div>
                  )}
                </div>
                {!isHead && (
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                    {/* A label wrapping a hidden input: the file picker styled as a button,
                        without losing the keyboard and screen-reader behaviour of a real
                        <input type="file">. */}
                    <label className="neo-btn" style={{ cursor: 'pointer', margin: 0 }}>
                      {s.photo ? '📷 Replace photo' : '📷 Upload photo'}
                      <input
                        type="file"
                        accept="image/*"
                        style={{ display: 'none' }}
                        aria-label={`Photo for step ${s.order}: ${s.label}`}
                        disabled={photo.isPending}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) photo.mutate({ stepId: s._id, file });
                          e.target.value = '';
                        }}
                      />
                    </label>
                    {s.status !== 'done' && (
                      <button className="neo-btn" disabled={step.isPending}
                        onClick={() => step.mutate({ stepId: s._id, status: 'done' })}>
                        ✓ Mark complete
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <h3 style={{ marginTop: 24 }}>Quality control</h3>
      <div className="card" style={{ padding: 16 }}>
        {qcApproved ? (
          <div className="offline-banner" style={{ borderColor: 'var(--emerald)' }}>
            QC approved by the Production Head — dispatch is unlocked.
          </div>
        ) : o.qc?.rejectedAt ? (
          <div className="offline-banner" style={{ borderColor: 'var(--coral)' }}>
            QC rejected: {o.qc.rejectedReason}
          </div>
        ) : qcSubmitted ? (
          <div className="offline-banner">Submitted — awaiting the Production Head's review.</div>
        ) : null}

        {!!o.qc?.tests?.length && (
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 12 }}>
            <thead>
              <tr>{['Parameter', 'Standard', 'Result', 'Status'].map((h) => (
                <th key={h} className="table-th">{h}</th>))}
              </tr>
            </thead>
            <tbody>
              {o.qc.tests.map((t, i) => (
                <tr key={t._id ?? i} style={{ borderTop: '1px solid #000' }}>
                  <td style={{ padding: '6px 4px' }}>{t.parameter}</td>
                  <td style={{ padding: '6px 4px', color: 'var(--text-3)' }}>{t.standard}</td>
                  <td style={{ padding: '6px 4px' }}>{t.result}</td>
                  <td style={{ padding: '6px 4px', color: t.status === 'pass' ? 'var(--emerald)'
                    : t.status === 'marginal' ? 'var(--amber)' : 'var(--coral)' }}>
                    {t.status}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {o.qc?.notes && <p style={{ whiteSpace: 'pre-wrap', marginTop: 10 }}>{o.qc.notes}</p>}

        {/* The engineer submits; only the Head decides. Two controls, never both. */}
        {!isHead && !qcSubmitted && !qcApproved && (
          <div style={{ marginTop: 12 }}>
            <QcEntry rows={qcRows} setRows={setQcRows} notes={qcNotes} setNotes={setQcNotes} />
            <button className="neo-btn gold" style={{ marginTop: 10 }}
              disabled={!qcRows.length || submitQc.isPending}
              onClick={() => submitQc.mutate()}>
              🔬 Submit QC results
            </button>
          </div>
        )}

        {isHead && qcSubmitted && !qcApproved && (
          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <button className="neo-btn gold" disabled={decideQc.isPending}
              onClick={() => decideQc.mutate({ status: 'approved' })}>
              ✅ Approve QC → enable dispatch
            </button>
            <button className="neo-btn" disabled={decideQc.isPending}
              onClick={() => {
                const reason = window.prompt('Why is QC rejected? The engineer has to act on this.');
                if (reason) decideQc.mutate({ status: 'rejected', reason });
              }}>
              ❌ Reject — return to engineer
            </button>
          </div>
        )}
      </div>

      {!isHead && (
        <div className="card" style={{ padding: 16, marginTop: 16 }}>
          <h3 style={{ marginTop: 0 }}>Flag an issue</h3>
          <p style={{ color: 'var(--text-3)', fontSize: 12, marginTop: 0 }}>
            A late part or a wrong drawing is not something you can fix. This goes straight
            to the Production Head.
          </p>
          <input className="form-input" value={issue} onChange={(e) => setIssue(e.target.value)}
            placeholder="What is blocking you?" />
          <button className="neo-btn" style={{ marginTop: 8 }}
            disabled={!issue.trim() || flag.isPending} onClick={() => flag.mutate()}>
            ⚠ Flag issue
          </button>
        </div>
      )}

      {!!o.productionIssues?.length && (
        <>
          <h3 style={{ marginTop: 24 }}>Issues</h3>
          <div style={{ display: 'grid', gap: 8 }}>
            {o.productionIssues.map((i) => (
              <div key={i._id} className="card" style={{
                padding: 12,
                borderLeft: `4px solid ${i.resolvedAt ? 'var(--emerald)' : 'var(--coral)'}`,
              }}>
                {i.description}
                <div style={{ color: 'var(--text-3)', fontSize: 12 }}>
                  {i.severity} · {new Date(i.raisedAt).toLocaleDateString('en-IN')}
                  {i.resolvedAt ? ' · resolved' : ''}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** A small editable grid for QC results — doc 3 PD-ENG-04 / PD-HD-07. */
function QcEntry({ rows, setRows, notes, setNotes }: {
  rows: QcTest[]; setRows: (r: QcTest[]) => void;
  notes: string; setNotes: (n: string) => void;
}) {
  const update = (i: number, patch: Partial<QcTest>) =>
    setRows(rows.map((r, j) => (i === j ? { ...r, ...patch } : r)));

  return (
    <div>
      {rows.map((r, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr auto', gap: 6, marginBottom: 6 }}>
          <input className="form-input" placeholder="Parameter" aria-label={`Parameter ${i + 1}`}
            value={r.parameter} onChange={(e) => update(i, { parameter: e.target.value })} />
          <input className="form-input" placeholder="Standard" aria-label={`Standard ${i + 1}`}
            value={r.standard} onChange={(e) => update(i, { standard: e.target.value })} />
          <input className="form-input" placeholder="Result" aria-label={`Result ${i + 1}`}
            value={r.result} onChange={(e) => update(i, { result: e.target.value })} />
          <select className="form-input" aria-label={`Status ${i + 1}`}
            value={r.status} onChange={(e) => update(i, { status: e.target.value as QcTest['status'] })}>
            <option value="pass">pass</option>
            {/* `marginal` exists because doc 3's own example turns on it — 1°C over spec
                but inside the customer's tolerance band. */}
            <option value="marginal">marginal</option>
            <option value="fail">fail</option>
          </select>
          <button className="neo-btn" onClick={() => setRows(rows.filter((_, j) => j !== i))}>✕</button>
        </div>
      ))}
      <button className="neo-btn"
        onClick={() => setRows([...rows, { parameter: '', standard: '', result: '', status: 'pass' }])}>
        + Add test
      </button>
      <textarea className="form-input" rows={3} style={{ marginTop: 8 }}
        placeholder="Notes — explain any deviation" aria-label="QC notes"
        value={notes} onChange={(e) => setNotes(e.target.value)} />
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '4px 0' }}>
      <span style={{ color: 'var(--text-3)' }}>{label}</span>
      <span style={{ textAlign: 'right' }}>{value}</span>
    </div>
  );
}
