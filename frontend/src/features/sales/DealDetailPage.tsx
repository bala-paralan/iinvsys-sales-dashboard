import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { salesApi, money } from './api';
import { ApiError } from '../../api/client';
import { useMe } from '../../portal/useMe';
import { usePipeline } from '../../meta/usePipeline';
import { LogActivityForm } from '../insideSales/LogActivityForm';
import { ActivityTimeline, relTime } from '../insideSales/ActivityTimeline';
import { isApi } from '../insideSales/api';

/**
 * The deal working screen — SA-EX-03/04/06/07, SA-MGR-06 and SA-DIR-03.
 *
 * Doc 2 draws these as separate screens; they are panels here for the same reason the
 * Inside Sales detail page combines its three. An executive asking for a discount is
 * also logging the call it came out of and reading the account's history, and making
 * that three navigations would be worse, not more faithful.
 *
 * The SPENCO score and stage transitions stay on the existing lead detail page and its
 * gate checklist — unchanged since v2, and deliberately not duplicated here.
 */
export function DealDetailPage() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const { data: meta } = usePipeline();

  const [percent, setPercent] = useState('');
  const [listPrice, setListPrice] = useState('');
  const [why, setWhy] = useState('');
  const [poValue, setPoValue] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: deal, isLoading } = useQuery({
    queryKey: ['deal', id],
    queryFn: () => salesApi.deal(id),
    enabled: !!id,
  });

  const customerId = (deal as any)?.customer?._id ?? (deal as any)?.customer;

  const { data: activities = [] } = useQuery({
    queryKey: ['activities', 'customer', customerId],
    queryFn: () => isApi.activities(`?customer=${customerId}`),
    enabled: !!customerId,
  });

  const after = (m: string) => {
    setError(null); setMsg(m);
    qc.invalidateQueries({ queryKey: ['deal', id] });
    qc.invalidateQueries({ queryKey: ['deals'] });
    qc.invalidateQueries({ queryKey: ['approvals'] });
  };
  const onErr = (e: unknown) =>
    setError(e instanceof ApiError ? e.message : 'Request failed');

  const discount = useMutation({
    mutationFn: () => salesApi.requestDiscount(id, {
      percent: Number(percent),
      justification: why,
      standardPrice: listPrice ? Number(listPrice) : undefined,
    }),
    onSuccess: (r) => { setPercent(''); setWhy(''); after(r.message ?? 'Recorded'); },
    onError: onErr,
  });

  const proposal = useMutation({
    mutationFn: () => salesApi.recordProposal(id, {}),
    onSuccess: (r) => after(r.message ?? 'Proposal recorded'),
    onError: onErr,
  });

  const submitCo = useMutation({
    mutationFn: () => salesApi.submitCo(id, { poValue: poValue ? Number(poValue) : undefined }),
    onSuccess: (r) => after(r.message ?? 'Submitted'),
    onError: onErr,
  });

  if (isLoading) return <div className="page-sub">// LOADING</div>;
  if (!deal) return <div className="offline-banner" role="alert">Deal not found, or outside your team.</div>;

  const d: any = deal;
  const tiers: Array<{
    tier: number; label: string; from: number; to: number | null;
    approverRole: string | null;
  }> = (meta as any)?.enums?.discountTiers ?? [];
  const band = tiers.find((t) => Number(percent) > t.from && (t.to === null || Number(percent) <= t.to));
  const isOwner = String(d.owner?._id ?? d.owner) === String(me?.userId);

  return (
    <div>
      <button className="neo-btn" onClick={() => nav(-1)} style={{ marginBottom: 12 }}>← Back</button>

      <h1 className="page-title">{d.company || d.name} <em>{d.refId}</em></h1>
      <div className="page-sub">
        // {String(d.stage).replace(/_/g, ' ').toUpperCase()} · {d.owner?.name ?? 'UNASSIGNED'}
      </div>

      {error && <div className="offline-banner" style={{ borderColor: 'var(--coral)', marginTop: 12 }} role="alert">{error}</div>}
      {msg && !error && <div className="offline-banner" style={{ borderColor: 'var(--emerald)', marginTop: 12 }}>{msg}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16, marginTop: 16 }}>
        <div className="card" style={{ padding: 16 }}>
          <h3 style={{ marginTop: 0 }}>Deal</h3>
          <Row label="Contact" value={d.name} />
          <Row label="Company" value={d.company || '—'} />
          <Row label="Value" value={money(d.value)} />
          <Row label="Probability" value={d.probability === null || d.probability === undefined ? '—' : `${d.probability}%`} />
          <Row label="SPENCO" value={d.spenco?.total ? `${d.spenco.total}/30${d.spenco.qualified ? ' ✓' : ''}` : 'not scored'} />
          <Row label="Expected close" value={d.expectedCloseDate ? new Date(d.expectedCloseDate).toLocaleDateString('en-IN') : '—'} />
          <Row label="Last activity" value={relTime(d.lastActivityAt)} />
          <Row label="Proposal" value={d.proposal?.version ? `v${d.proposal.version} sent ${relTime(d.proposal.sentAt)}` : 'none sent'} />
          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <button className="neo-btn" onClick={() => nav(`${window.location.pathname.split('/deals')[0]}/../pipeline`)}>
              ⟵ Pipeline
            </button>
            {customerId && (
              <button className="neo-btn"
                onClick={() => nav(`/${me?.portal?.key}/customers/${customerId}`)}>
                🏢 Customer 360
              </button>
            )}
          </div>
        </div>

        <div className="card" style={{ padding: 16 }}>
          <h3 style={{ marginTop: 0 }}>Discount</h3>
          {d.discount?.status && d.discount.status !== 'none' ? (
            <div style={{
              padding: 10, marginBottom: 12, border: '1px solid #000',
              borderLeft: `4px solid ${d.discount.status === 'pending' ? 'var(--amber)'
                : d.discount.status === 'rejected' ? 'var(--coral)' : 'var(--emerald)'}`,
            }}>
              <strong>{d.discount.percent}%</strong> — {d.discount.status.replace(/_/g, ' ')}
              {d.discount.standardPrice ? (
                <div style={{ color: 'var(--text-3)', fontSize: 12 }}>
                  {money(d.discount.standardPrice)} → {money(d.value)}
                </div>
              ) : null}
            </div>
          ) : (
            <p style={{ color: 'var(--text-3)', marginTop: 0 }}>No discount requested.</p>
          )}

          {isOwner && d.discount?.status !== 'pending' && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <label className="form-label" htmlFor="pct">Discount %</label>
                  <input id="pct" className="form-input" type="number" min={0} max={100}
                    value={percent} onChange={(e) => setPercent(e.target.value)} />
                </div>
                <div>
                  <label className="form-label" htmlFor="list">Standard price</label>
                  <input id="list" className="form-input" type="number" min={0}
                    placeholder={String(d.discount?.standardPrice || d.value || '')}
                    value={listPrice} onChange={(e) => setListPrice(e.target.value)} />
                </div>
              </div>
              <div style={{ marginTop: 10 }}>
                <label className="form-label" htmlFor="why">Justification</label>
                <textarea id="why" className="form-input" rows={3}
                  value={why} onChange={(e) => setWhy(e.target.value)} />
              </div>
              {band && (
                <div style={{ marginTop: 8, fontSize: 12, color: band.approverRole === null ? 'var(--emerald)' : 'var(--amber)' }}>
                  {percent}% falls in the <strong>{band.label}</strong> band
                  {band.tier === 1 ? ' — you can apply this yourself.' : ' — it needs their approval.'}
                </div>
              )}
              <button className="neo-btn gold" style={{ marginTop: 12 }}
                disabled={!percent || discount.isPending}
                onClick={() => discount.mutate()}>
                {discount.isPending ? 'Sending…' : 'Request discount'}
              </button>
            </>
          )}
        </div>
      </div>

      {isOwner && (
        <div className="card" style={{ padding: 16, marginTop: 16 }}>
          <h3 style={{ marginTop: 0 }}>Proposal &amp; Commercial Order</h3>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <button className="neo-btn" disabled={proposal.isPending} onClick={() => proposal.mutate()}>
              📝 Record proposal v{(d.proposal?.version ?? 0) + 1} sent
            </button>
            <div>
              <label className="form-label" htmlFor="pov">PO value</label>
              <input id="pov" className="form-input" type="number" min={0} style={{ maxWidth: 180 }}
                placeholder={String(d.value ?? '')}
                value={poValue} onChange={(e) => setPoValue(e.target.value)} />
            </div>
            <button className="neo-btn gold" disabled={submitCo.isPending || !!d.co?.confirmedAt}
              onClick={() => submitCo.mutate()}>
              {d.co?.confirmedAt ? 'Order confirmed ✓'
                : d.co?.submittedAt ? 'Awaiting Director confirmation'
                  : '📦 Submit Commercial Order'}
            </button>
          </div>
          <p style={{ color: 'var(--text-3)', fontSize: 12, marginBottom: 0 }}>
            Submitting sends the order to the Sales Director. Confirming it is what raises
            the production order — the stage gate (PO document, PO number, subscription
            and AMC answers) still applies separately.
          </p>
        </div>
      )}

      {customerId && (
        <div style={{ marginTop: 16 }}>
          <LogActivityForm customerId={customerId} dealId={id} />
        </div>
      )}

      <h3 style={{ marginTop: 24 }}>Activity timeline — {d.company || d.name}</h3>
      <p className="page-sub" style={{ marginTop: -8 }}>
        // EVERY INTERACTION WITH THIS ACCOUNT, BY ANYONE — NOT JUST THIS DEAL
      </p>
      <ActivityTimeline activities={activities} />
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
