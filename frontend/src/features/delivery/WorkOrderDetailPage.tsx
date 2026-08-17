/**
 * Work Order detail — the delivery workflow in one screen.
 *
 * Every action panel renders only when its permission is held AND the record
 * is in the right state, mirroring the route guards: the UI never offers what
 * the server refuses. The DA gate on "Mark delivered" surfaces the server's
 * missing list the same way the stage gates do.
 */
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiUpload, ApiError } from '../../api/client';
import type { GateRequirementFailure } from '../../api/client';
import { usePipeline, can } from '../../meta/usePipeline';
import { EnumSelect } from '../../components/EnumSelect';
import { StageGateChecklist } from '../../components/StageGateChecklist';

interface DelayEvent {
  reasonCode: string;
  note: string;
  previousDate: string;
  revisedDate: string;
  noticeHours: number;
  lateNotice: boolean;
  at: string;
}

interface Attachment {
  _id?: string;
  docType: string;
  filename: string;
  sizeBytes: number;
}

interface WorkOrderDoc {
  _id: string;
  woNumber: string;
  stage: string;
  status: string;
  poNumber?: string;
  poValue?: number;
  customerSnapshot: {
    name: string; company?: string; phone?: string; email?: string;
    city?: string; state?: string; zone?: string;
  };
  items: Array<{ name: string; sku?: string; quantity: number }>;
  acceptedAt?: string | null;
  originalCommittedDate?: string | null;
  currentCommittedDate?: string | null;
  customerAck?: { acknowledged: boolean; method?: string };
  dispatchedAt?: string | null;
  stockConfirmedAt?: string | null;
  packingCheckedBy?: string;
  deliveredAt?: string | null;
  delayEvents: DelayEvent[];
  attachments: Attachment[];
  stageHistory: Array<{
    from: string | null; to: string; at: string; byName: string; note?: string;
  }>;
}

export function WorkOrderDetailPage() {
  const { id = '' } = useParams();
  const queryClient = useQueryClient();
  const { data: meta } = usePipeline();
  const [gateOpen, setGateOpen] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [daMissing, setDaMissing] = useState<GateRequirementFailure[] | null>(null);

  const wo = useQuery({
    queryKey: ['workorder', id],
    queryFn: async () => (await api<WorkOrderDoc>('GET', `/workorders/${id}`)).data,
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['workorder', id] });
    queryClient.invalidateQueries({ queryKey: ['workorders'] });
  };

  const act = (path: string, body?: unknown) => ({
    mutationFn: () => api('POST', `/workorders/${id}${path}`, body),
    onSuccess: (res: { message?: string }) => { setBanner(res.message ?? null); refresh(); },
    onError: (err: Error) => setBanner(err.message),
  });

  /* forms kept as plain state — each is 1–3 fields */
  const [commitDate, setCommitDate] = useState('');
  const [ackMethod, setAckMethod] = useState('phone');
  const [delayReason, setDelayReason] = useState('');
  const [delayDate, setDelayDate] = useState('');
  const [carrier, setCarrier] = useState('');
  const [itemsDelivered, setItemsDelivered] = useState('');
  const [stockConfirmed, setStockConfirmed] = useState(false);
  const [packedBy, setPackedBy] = useState('');
  const [docType, setDocType] = useState('');
  const [file, setFile] = useState<File | null>(null);

  const accept = useMutation(act('/accept'));
  const commit = useMutation({
    ...act('/commit-date'),
    mutationFn: () => api('POST', `/workorders/${id}/commit-date`, { date: commitDate, ackMethod }),
  });
  const delay = useMutation({
    ...act('/delay'),
    mutationFn: () => api('POST', `/workorders/${id}/delay`, {
      reasonCode: delayReason, revisedDate: delayDate,
    }),
  });
  const dispatch = useMutation({
    ...act('/dispatch'),
    mutationFn: () => api('POST', `/workorders/${id}/dispatch`, { carrier }),
  });
  const deliver = useMutation({
    mutationFn: () => api('POST', `/workorders/${id}/deliver`, {
      itemsDelivered: itemsDelivered ? Number(itemsDelivered) : undefined,
    }),
    onSuccess: (res) => { setDaMissing(null); setBanner(res.message ?? null); refresh(); },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'DA_GATE_FAILED' && err.missing) {
        setDaMissing(err.missing);
      }
      setBanner(err.message);
    },
  });
  const uploadFile = useMutation({
    mutationFn: () => {
      const form = new FormData();
      form.append('docType', docType);
      form.append('file', file!);
      return apiUpload(`/workorders/${id}/upload`, form);
    },
    onSuccess: () => { setFile(null); setDocType(''); setBanner('Document attached'); refresh(); },
    onError: (err: Error) => setBanner(err.message),
  });

  if (wo.isLoading) return <p style={{ color: 'var(--text-3)' }}>Loading…</p>;
  if (wo.isError || !wo.data) return <div className="offline-banner">Could not load this Work Order.</div>;

  const d = wo.data;
  const inr = (n?: number) => (n ? `₹${n.toLocaleString('en-IN')}` : '—');
  const when = (s?: string | null) => (s ? new Date(s).toLocaleString('en-IN') : '—');
  const history = [...(d.stageHistory ?? [])].reverse();

  return (
    <>
      <Link to="/delivery" style={{ color: 'var(--text-3)', fontSize: 13 }}>← Back to delivery board</Link>
      <h1 className="page-title" style={{ marginTop: 8 }}>{d.woNumber}</h1>
      <div className="page-sub">
        // {d.stage.replace(/_/g, ' ').toUpperCase()} · STATUS {d.status.toUpperCase()}
        · PO {d.poNumber || '—'} · {inr(d.poValue)}
      </div>

      {banner && <div className="offline-banner">{banner}</div>}

      <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 460px', maxWidth: 680, display: 'flex', flexDirection: 'column', gap: 18 }}>
          {/* ── Customer (frozen snapshot — A24) ── */}
          <section className="card" style={{ padding: 16 }}>
            <div className="form-label">Customer — snapshot at PO verification</div>
            <div style={{ fontSize: 15 }}>{d.customerSnapshot.name}
              {d.customerSnapshot.company ? ` · ${d.customerSnapshot.company}` : ''}</div>
            <div style={{ color: 'var(--text-3)', fontSize: 13, marginTop: 4 }}>
              {d.customerSnapshot.phone} · {d.customerSnapshot.city}, {d.customerSnapshot.state}
              {d.customerSnapshot.zone ? ` (${d.customerSnapshot.zone})` : ''}
            </div>
            <div className="form-label" style={{ marginTop: 12 }}>Items</div>
            {d.items.length === 0 && <div style={{ color: 'var(--text-3)', fontSize: 13 }}>No line items recorded.</div>}
            {d.items.map((it, i) => (
              <div key={i} style={{ fontSize: 13 }}>{it.quantity}× {it.name}{it.sku ? ` (${it.sku})` : ''}</div>
            ))}
          </section>

          {/* ── The A11 clocks ── */}
          <section className="card" style={{ padding: 16 }}>
            <div className="form-label">Delivery date</div>
            <div style={{ fontSize: 13, color: 'var(--text-2)' }}>
              accepted: {when(d.acceptedAt)} · committed: {when(d.currentCommittedDate)}
              {d.originalCommittedDate && d.currentCommittedDate !== d.originalCommittedDate
                && <span style={{ color: 'var(--amber)' }}> (original {when(d.originalCommittedDate)})</span>}
            </div>

            {!d.acceptedAt && can(meta, 'workorder.accept') && (
              <button className="neo-btn gold" style={{ marginTop: 10 }}
                disabled={accept.isPending} onClick={() => accept.mutate()}>
                Accept Work Order
              </button>
            )}

            {d.acceptedAt && !d.originalCommittedDate && can(meta, 'workorder.commit_date') && (
              <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                <input type="date" className="form-input" style={{ maxWidth: 170 }}
                  value={commitDate} onChange={(e) => setCommitDate(e.target.value)} />
                <input className="form-input" style={{ maxWidth: 140 }} placeholder="ack method"
                  value={ackMethod} onChange={(e) => setAckMethod(e.target.value)} />
                <button className="neo-btn gold" disabled={!commitDate || commit.isPending}
                  onClick={() => commit.mutate()}>
                  Commit date
                </button>
              </div>
            )}

            {d.originalCommittedDate && d.status !== 'delivered' && can(meta, 'workorder.commit_date') && (
              <div style={{ marginTop: 14 }}>
                <div className="form-label">Log a delay (reason code mandatory — D-4)</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <div style={{ minWidth: 200 }}>
                    <EnumSelect enumName="delayReasonCodes" value={delayReason} onChange={setDelayReason} />
                  </div>
                  <input type="date" className="form-input" style={{ maxWidth: 170 }}
                    value={delayDate} onChange={(e) => setDelayDate(e.target.value)} />
                  <button className="neo-btn" disabled={!delayReason || !delayDate || delay.isPending}
                    onClick={() => delay.mutate()}>
                    Record delay
                  </button>
                </div>
              </div>
            )}

            {d.delayEvents.length > 0 && (
              <div style={{ marginTop: 12 }}>
                {d.delayEvents.map((ev, i) => (
                  <div key={i} style={{
                    fontSize: 12, fontFamily: 'var(--font-mono)', padding: '6px 0',
                    borderTop: '1px solid var(--surface-3)',
                    color: ev.lateNotice ? 'var(--coral)' : 'var(--text-2)',
                  }}>
                    {ev.lateNotice ? '⚠ LATE ' : ''}{ev.reasonCode} · {ev.noticeHours}h notice ·
                    {' '}{new Date(ev.revisedDate).toLocaleDateString('en-IN')}
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* ── Documents (D-5) ── */}
          <section className="card" style={{ padding: 16 }}>
            <div className="form-label">Document vault</div>
            {d.attachments.length === 0 && (
              <div style={{ color: 'var(--text-3)', fontSize: 13 }}>Nothing attached yet.</div>
            )}
            {d.attachments.map((a, i) => (
              <div key={i} style={{ fontSize: 13, padding: '4px 0' }}>
                <span style={{ color: 'var(--gold)', fontFamily: 'var(--font-mono)' }}>{a.docType}</span>
                {' '}· {a.filename} · {(a.sizeBytes / 1024).toFixed(0)} KB
              </div>
            ))}

            {can(meta, 'workorder.upload') && (
              <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                <div style={{ minWidth: 200 }}>
                  <EnumSelect enumName="docTypes" value={docType} onChange={setDocType} />
                </div>
                <input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  style={{ color: 'var(--text-2)', fontSize: 13 }} />
                <button className="neo-btn" disabled={!docType || !file || uploadFile.isPending}
                  onClick={() => uploadFile.mutate()}>
                  {uploadFile.isPending ? 'Uploading…' : 'Upload'}
                </button>
              </div>
            )}
          </section>

          {/* ── Progression ── */}
          <section className="card" style={{ padding: 16 }}>
            <div className="form-label">Progression</div>

            {/* stockConfirmedAt gates Procurement → Preparation & Packing and is
                the one gate field in the whole pipeline with no endpoint of its
                own — every other one is set by /accept, /commit-date, /dispatch,
                /plan and friends. Delivery has no override, so without this the
                stage was a dead end for everyone. It rides along as the
                transition's patch, so the timestamp is only written if the move
                actually succeeds. */}
            {d.stage === 'procurement' && !d.stockConfirmedAt && can(meta, 'workorder.advance') && (
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, marginBottom: 10 }}>
                <input
                  type="checkbox"
                  checked={stockConfirmed}
                  onChange={(e) => setStockConfirmed(e.target.checked)}
                />
                <span>All items available, quality-checked and tagged to this Work Order</span>
              </label>
            )}

            {/* packingCheckedBy is the other orphan — same story, and it wants a
                name rather than a timestamp because the sign-off is a person. */}
            {d.stage === 'preparation_packing' && !d.packingCheckedBy && can(meta, 'workorder.advance') && (
              <div style={{ marginBottom: 10 }}>
                <label className="form-label" htmlFor="wo-packedby">Packing checklist signed off by</label>
                <input
                  id="wo-packedby"
                  className="form-input"
                  style={{ maxWidth: 260 }}
                  placeholder="Name of the checker"
                  value={packedBy}
                  onChange={(e) => setPackedBy(e.target.value)}
                />
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {can(meta, 'workorder.advance') && d.status !== 'delivered' && (
                <button className="neo-btn gold" onClick={() => setGateOpen(true)}>
                  Advance stage →
                </button>
              )}
              {can(meta, 'workorder.dispatch') && !d.dispatchedAt && (
                <>
                  <input className="form-input" style={{ maxWidth: 180 }} placeholder="carrier / vehicle"
                    value={carrier} onChange={(e) => setCarrier(e.target.value)} />
                  <button className="neo-btn" disabled={!carrier.trim() || dispatch.isPending}
                    onClick={() => dispatch.mutate()}>
                    Dispatch
                  </button>
                </>
              )}
              {can(meta, 'workorder.deliver') && d.status !== 'delivered' && (
                <>
                  <input className="form-input" type="number" style={{ maxWidth: 130 }}
                    placeholder="# delivered" value={itemsDelivered}
                    onChange={(e) => setItemsDelivered(e.target.value)} />
                  <button className="neo-btn" disabled={deliver.isPending}
                    onClick={() => deliver.mutate()}>
                    Mark delivered (DA gate)
                  </button>
                </>
              )}
            </div>

            {daMissing && (
              <div style={{ marginTop: 10 }}>
                {daMissing.map((m) => (
                  <div key={m.code} className="gate-req unmet">
                    <span className="gate-req-mark">[ ]</span><span>{m.message}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* ── Stage history ── */}
        <aside style={{ flex: '0 1 300px' }}>
          <div className="form-label">History</div>
          {history.map((h, i) => (
            <div key={i} style={{
              borderLeft: '3px solid var(--azure)', padding: '8px 12px',
              marginBottom: 10, background: 'var(--surface-1)',
            }}>
              <div style={{ fontSize: 14 }}>{h.from ?? '·'} → <strong>{h.to}</strong></div>
              <div style={{ color: 'var(--text-3)', fontSize: 12, fontFamily: 'var(--font-mono)' }}>
                {new Date(h.at).toLocaleString('en-IN')} · {h.byName || 'system'}
              </div>
              {h.note && <div style={{ color: 'var(--text-2)', fontSize: 12 }}>“{h.note}”</div>}
            </div>
          ))}
        </aside>
      </div>

      {gateOpen && (
        <StageGateChecklist
          entityPath={`/workorders/${d._id}`}
          entityName={d.woNumber}
          stages={meta?.delivery.stages ?? []}
          allowOverride={false}
          invalidateKeys={[['workorders'], ['workorder', id]]}
          patch={{
            ...(stockConfirmed ? { stockConfirmedAt: new Date().toISOString() } : {}),
            ...(packedBy.trim() ? { packingCheckedBy: packedBy.trim() } : {}),
          }}
          onClose={() => setGateOpen(false)}
          onAdvanced={() => { setGateOpen(false); setStockConfirmed(false); setPackedBy(''); }}
        />
      )}
    </>
  );
}
