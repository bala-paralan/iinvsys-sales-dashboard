import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { salesApi, money } from './api';
import { api, ApiError } from '../../api/client';
import { usePipeline } from '../../meta/usePipeline';
import { relTime } from '../insideSales/ActivityTimeline';
import { transferApi } from '../leads/transferApi';

/**
 * SA-MGR-08 (3–10%), SA-DIR-07 (>10% and COs) and SA-DIR-09 (confirm the order).
 *
 * One queue, because they are one job: decisions addressed to me. A Manager sees only
 * discounts in their band because the SERVER routed the request up the requester's own
 * reporting line — this screen shows whatever is assigned to the caller and does not
 * decide who may see what.
 *
 * The counter-offer is doc 2's "Counter: Approve 5%": in a real negotiation the approver
 * grants a different number rather than refusing outright.
 */
export function SalesApprovalsPage() {
  const qc = useQueryClient();
  const { data: meta } = usePipeline();
  const [counters, setCounters] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const { data: queue = [], isLoading } = useQuery({
    queryKey: ['approvals', 'sales'],
    queryFn: () => salesApi.approvals(),
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['approvals'] });
    qc.invalidateQueries({ queryKey: ['deals'] });
  };

  const decideDiscount = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      salesApi.decideDiscount(id, {
        status,
        counterPercent: counters[id] ? Number(counters[id]) : undefined,
        note: notes[id] || '',
      }),
    onSuccess: (r) => { setError(null); setDone(r.message ?? 'Recorded'); refresh(); },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not record the decision'),
  });

  const escalate = useMutation({
    mutationFn: (id: string) => api('POST', `/approvals/${id}/escalate`, { note: notes[id] || '' }),
    onSuccess: () => { setError(null); setDone('Escalated to the Director'); refresh(); },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not escalate'),
  });

  const confirmCo = useMutation({
    mutationFn: (id: string) => salesApi.confirmCo(id, { note: notes[id] || '' }),
    onSuccess: (r) => { setError(null); setDone(r.message ?? 'Confirmed'); refresh(); },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not confirm the order'),
  });

  /* SPENCO CRM brief §5: an executive's "escalate" lands here as a `transfer` request.
     Approving it MOVES the lead, under the approver's own transfer rule — the picker
     is fed by the same endpoint the Transfer panel uses. */
  const [transferTo, setTransferTo] = useState<Record<string, string>>({});
  const decideTransfer = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      transferApi.decide(id, { status, to: transferTo[id] || null, note: notes[id] || '' }),
    onSuccess: (r) => { setError(null); setDone(r.message ?? 'Recorded'); refresh(); },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not record the decision'),
  });

  const tiers: Array<{ tier: number; label: string; from: number; to: number | null }> =
    (meta as any)?.enums?.discountTiers ?? [];

  const discounts = queue.filter((a: any) => a.kind === 'discount');
  const orders = queue.filter((a: any) => a.kind === 'co_confirm');
  const transfers = queue.filter((a: any) => a.kind === 'transfer');
  const others = queue.filter((a: any) => !['discount', 'co_confirm', 'transfer'].includes(a.kind));

  return (
    <div>
      <h1 className="page-title">Sales <em>approvals</em></h1>
      <div className="page-sub">// {queue.length} WAITING ON YOUR DECISION</div>

      {!!tiers.length && (
        <div className="card" style={{ padding: 12, marginTop: 12, fontSize: 12, color: 'var(--text-3)' }}>
          Discount authority:{' '}
          {tiers.map((t) => `${t.from}–${t.to ?? '∞'}% ${t.label}`).join(' · ')}
        </div>
      )}

      {error && <div className="offline-banner" style={{ borderColor: 'var(--coral)', marginTop: 12 }} role="alert">{error}</div>}
      {done && !error && <div className="offline-banner" style={{ borderColor: 'var(--emerald)', marginTop: 12 }}>{done}</div>}
      {isLoading && <div className="page-sub">// LOADING</div>}
      {!isLoading && !queue.length && <div className="page-sub" style={{ marginTop: 16 }}>// NOTHING PENDING</div>}

      {!!discounts.length && <h3 style={{ marginTop: 20 }}>Discount requests</h3>}
      <div style={{ display: 'grid', gap: 16 }}>
        {discounts.map((a: any) => {
          const p = a.payload ?? {};
          return (
            <div key={a._id} className="card" style={{ padding: 16, borderLeft: '4px solid var(--amber)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                <div>
                  <h3 style={{ margin: 0 }}>{p.company || p.name}</h3>
                  <div style={{ color: 'var(--text-3)', fontSize: 12 }}>
                    {p.refId} · {a.requestedBy?.name} · {relTime(a.createdAt)}
                  </div>
                </div>
                <div style={{ fontSize: 24, fontFamily: 'var(--font-display)', color: 'var(--amber)' }}>
                  {p.percent}%
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginTop: 12 }}>
                <Figure label="Standard price" value={money(p.standardPrice)} />
                <Figure label={`With ${p.percent}% off`} value={money(p.discountedPrice)} />
                <Figure label="Margin impact" value={money(p.marginImpact)} tone="var(--coral)" />
                <Figure label="Band" value={p.band ?? `Tier ${a.tier}`} />
              </div>

              {p.justification && (
                <>
                  <h4 style={{ marginBottom: 4 }}>Justification</h4>
                  <div style={{ whiteSpace: 'pre-wrap' }}>{p.justification}</div>
                </>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10, marginTop: 12 }}>
                <div>
                  <label className="form-label" htmlFor={`c-${a._id}`}>
                    Counter with a different % (optional)
                  </label>
                  <input id={`c-${a._id}`} className="form-input" type="number" min={0} max={100}
                    placeholder={String(p.percent)}
                    value={counters[a._id] ?? ''}
                    onChange={(e) => setCounters((s) => ({ ...s, [a._id]: e.target.value }))} />
                </div>
                <div>
                  <label className="form-label" htmlFor={`n-${a._id}`}>Decision note</label>
                  <input id={`n-${a._id}`} className="form-input"
                    value={notes[a._id] ?? ''}
                    onChange={(e) => setNotes((s) => ({ ...s, [a._id]: e.target.value }))} />
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                <button className="neo-btn gold" disabled={decideDiscount.isPending}
                  onClick={() => decideDiscount.mutate({ id: a._id, status: 'approved' })}>
                  ✅ Approve {counters[a._id] ? `${counters[a._id]}%` : `${p.percent}%`}
                </button>
                <button className="neo-btn" disabled={decideDiscount.isPending}
                  onClick={() => decideDiscount.mutate({ id: a._id, status: 'rejected' })}>
                  ❌ Reject
                </button>
                <button className="neo-btn" disabled={decideDiscount.isPending}
                  onClick={() => decideDiscount.mutate({ id: a._id, status: 'returned' })}>
                  ↩ Send back
                </button>
                {/* Doc 2 SA-MGR-08: a Manager who will not grant a discount inside their
                    own band passes it up rather than refusing it — the request moves to
                    the Director with its justification intact. */}
                <button className="neo-btn" disabled={escalate.isPending}
                  onClick={() => escalate.mutate(a._id)}>
                  ⬆ Escalate to Director
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {!!orders.length && <h3 style={{ marginTop: 24 }}>Commercial Orders — confirming starts Production</h3>}
      <div style={{ display: 'grid', gap: 16 }}>
        {orders.map((a: any) => {
          const p = a.payload ?? {};
          return (
            <div key={a._id} className="card" style={{ padding: 16, borderLeft: '4px solid var(--emerald)' }}>
              <h3 style={{ margin: 0 }}>{p.company || p.name}</h3>
              <div style={{ color: 'var(--text-3)', fontSize: 12 }}>
                {p.refId} · submitted by {a.requestedBy?.name} · {relTime(a.createdAt)}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginTop: 12 }}>
                <Figure label="PO number" value={p.poNumber || '—'} />
                <Figure label="PO value" value={money(p.poValue)} />
                <Figure label="Discount applied" value={`${p.discountPercent ?? 0}%`} />
              </div>
              {p.note && <div style={{ marginTop: 10, whiteSpace: 'pre-wrap' }}>{p.note}</div>}
              <div style={{ marginTop: 12 }}>
                <label className="form-label" htmlFor={`co-${a._id}`}>Note</label>
                <input id={`co-${a._id}`} className="form-input"
                  value={notes[a._id] ?? ''}
                  onChange={(e) => setNotes((s) => ({ ...s, [a._id]: e.target.value }))} />
              </div>
              <button className="neo-btn gold" style={{ marginTop: 12 }}
                disabled={confirmCo.isPending}
                onClick={() => confirmCo.mutate(a._id)}>
                🏭 Confirm order → raise production
              </button>
            </div>
          );
        })}
      </div>

      {!!transfers.length && <h3 style={{ marginTop: 24 }}>Transfer requests — an executive asked you to move a lead</h3>}
      <div style={{ display: 'grid', gap: 16 }}>
        {transfers.map((a: any) => (
          <TransferRequestCard key={a._id} a={a}
            to={transferTo[a._id] ?? (a.payload?.suggestedTo ?? '')}
            setTo={(v) => setTransferTo((s) => ({ ...s, [a._id]: v }))}
            note={notes[a._id] ?? ''}
            setNote={(v) => setNotes((s) => ({ ...s, [a._id]: v }))}
            busy={decideTransfer.isPending}
            decide={(status) => decideTransfer.mutate({ id: a._id, status })} />
        ))}
      </div>

      {!!others.length && (
        <div className="page-sub" style={{ marginTop: 24 }}>
          // {others.length} OTHER APPROVAL(S) — SEE THE RELEVANT MODULE
        </div>
      )}
    </div>
  );
}

function TransferRequestCard({ a, to, setTo, note, setNote, busy, decide }: {
  a: any; to: string; setTo: (v: string) => void; note: string; setNote: (v: string) => void;
  busy: boolean; decide: (status: string) => void;
}) {
  const p = a.payload ?? {};
  const leadId = a.subject?.id;
  const { data: targets } = useQuery({
    queryKey: ['lead', leadId, 'transfer-targets'],
    queryFn: () => transferApi.targets(leadId),
    enabled: !!leadId,
  });
  return (
    <div className="card" style={{ padding: 16, borderLeft: '4px solid var(--gold)' }}>
      <h3 style={{ margin: 0 }}>{p.leadName || p.refId}</h3>
      <div style={{ color: 'var(--text-3)', fontSize: 12 }}>
        {p.refId} · asked by {a.requestedBy?.name} · {relTime(a.createdAt)}
      </div>
      {p.reason && <div style={{ marginTop: 10, whiteSpace: 'pre-wrap' }}>“{p.reason}”</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10, marginTop: 12 }}>
        <div>
          <label className="form-label" htmlFor={`tr-to-${a._id}`}>Transfer to</label>
          <select id={`tr-to-${a._id}`} className="form-input" value={to} onChange={(e) => setTo(e.target.value)}>
            <option value="">— choose —</option>
            {(targets?.targets ?? []).map((u) => (
              <option key={u._id} value={u._id}>{u.name}{u.domain && u.domain !== 'none' ? ` · ${u.domain.replace(/_/g, ' ')}` : ''}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="form-label" htmlFor={`tr-note-${a._id}`}>Note</label>
          <input id={`tr-note-${a._id}`} className="form-input" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        <button className="neo-btn gold" disabled={busy || !to} onClick={() => decide('approved')}>✓ Approve &amp; transfer</button>
        <button className="neo-btn" disabled={busy} onClick={() => decide('returned')}>↩ Return</button>
        <button className="neo-btn" disabled={busy} onClick={() => decide('rejected')}>✕ Reject</button>
      </div>
    </div>
  );
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <div style={{ color: 'var(--text-3)', fontSize: 11, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 16, color: tone }}>{value}</div>
    </div>
  );
}
