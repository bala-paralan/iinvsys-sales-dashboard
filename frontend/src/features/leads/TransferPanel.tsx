import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { transferApi } from './transferApi';
import { ApiError } from '../../api/client';
import { useRoles } from '../../meta/roles';
import { useMe } from '../../portal/useMe';

/**
 * SPENCO CRM brief §5 — the transfer control, on every lead detail page.
 *
 * Who appears in the picker is the SERVER's answer (`/transfer-targets`: the caller's
 * matrix row ∩ their subtree). This component draws one of two things:
 *
 *   - a picker, when the caller may transfer — a ZSM sees their ASMs, an ASM their SEs,
 *     an ISM every ZSM and ASM, the Director everyone;
 *   - an "Ask my manager" form, when the list comes back empty because the caller is
 *     an ISE or SE — "Cannot transfer — escalates to ISM / ASM".
 *
 * It does not decide which; a client that guessed from the role would be a second copy
 * of the matrix, and the two would drift.
 */
export function TransferPanel({ leadId, ownerId, onDone }: {
  leadId: string;
  ownerId?: string | null;
  onDone?: (message: string) => void;
}) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const { data: me } = useMe();
  const { label, abbr } = useRoles();
  const [to, setTo] = useState('');
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['lead', leadId, 'transfer-targets'],
    queryFn: () => transferApi.targets(leadId),
    enabled: !!leadId,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['lead', leadId] });
    qc.invalidateQueries({ queryKey: ['deal', leadId] });
    qc.invalidateQueries({ queryKey: ['is'] });
    qc.invalidateQueries({ queryKey: ['deals'] });
    qc.invalidateQueries({ queryKey: ['approvals'] });
  };
  const fail = (e: unknown) => setError(e instanceof ApiError ? e.message : 'Request failed');

  const transfer = useMutation({
    mutationFn: () => transferApi.transfer(leadId, { to, note }),
    onSuccess: (r) => {
      setError(null); invalidate();
      const d = r.data;
      if (d.crossedTrack && d.salesLead?._id) {
        /* The IS lead is now converted; the deal is where the work continues — for
           someone who can open a deal. An ISM cannot (doc 1: "cannot see Sales
           pipeline"), so they stay here and see the lead marked converted. */
        onDone?.(r.message || 'Transferred to Sales');
        const dealRoute = me?.portal?.routes?.find((x: any) => /\/deals\/:id$/.test(x.path));
        if (dealRoute) nav(dealRoute.path.replace(':id', d.salesLead._id));
        return;
      }
      onDone?.(r.message || 'Transferred');
      setTo(''); setNote('');
    },
    onError: fail,
  });

  const request = useMutation({
    mutationFn: () => transferApi.request(leadId, { reason, suggestedTo: to || null }),
    onSuccess: (r) => { setError(null); setSent(r.message || 'Transfer requested'); invalidate(); },
    onError: fail,
  });

  if (isLoading || !data) return null;
  const isOwner = ownerId && me?.userId && String(ownerId) === String(me.userId);

  /* ── Executives: escalate ────────────────────────────────────────────── */
  if (!data.canTransfer) {
    /* Only the owner escalates; someone who merely sees the lead has nothing to ask. */
    if (!isOwner) return null;
    const mgr = me?.reportsTo;
    return (
      <div className="card" style={{ padding: 16 }}>
        <h3 style={{ marginTop: 0 }}>Transfer</h3>
        <p className="page-sub" style={{ marginTop: -6 }}>
          // A {abbr(me?.role)} CANNOT TRANSFER — ESCALATE TO {mgr ? `${mgr.name.toUpperCase()} (${abbr(mgr.role)})` : 'YOUR MANAGER'}
        </p>
        {sent ? (
          <div className="offline-banner" style={{ borderColor: 'var(--emerald)' }}>{sent}</div>
        ) : (
          <>
            <label className="form-label">Why should this lead move?</label>
            <textarea className="form-input" rows={2} value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder="Customer relocated to Chennai; better served by the local SE" />
            <button className="neo-btn gold" style={{ marginTop: 8 }}
              disabled={!reason.trim() || request.isPending || !mgr}
              onClick={() => request.mutate()}>
              {request.isPending ? 'Sending…' : `Ask ${mgr?.name ?? 'my manager'} to transfer`}
            </button>
            {!mgr && <div className="page-sub">// NO MANAGER ON YOUR RECORD — ASK ADMIN TO SET YOUR REPORTING LINE</div>}
          </>
        )}
        {error && <div className="offline-banner" style={{ borderColor: 'var(--coral)', marginTop: 8 }} role="alert">{error}</div>}
      </div>
    );
  }

  /* ── Managers: the picker ────────────────────────────────────────────── */
  return (
    <div className="card" style={{ padding: 16 }}>
      <h3 style={{ marginTop: 0 }}>Transfer</h3>
      <p className="page-sub" style={{ marginTop: -6 }}>
        // YOU MAY TRANSFER TO: {data.roles.map((r) => label(r).toUpperCase()).join(', ')}
      </p>
      {data.targets.length === 0 ? (
        <div className="page-sub">// NOBODY ELIGIBLE IN YOUR TEAM RIGHT NOW</div>
      ) : (
        <>
          <label className="form-label">To</label>
          <select className="form-input" value={to} onChange={(e) => setTo(e.target.value)}>
            <option value="">— choose —</option>
            {data.targets.map((u) => (
              <option key={u._id} value={u._id}>
                {u.name} · {abbr(u.role)}{u.zone ? ` · ${u.zone}` : ''}{u.domain && u.domain !== 'none' ? ` · ${u.domain.replace(/_/g, ' ')}` : ''}
              </option>
            ))}
          </select>
          <label className="form-label" style={{ marginTop: 8 }}>Note to the new owner</label>
          <textarea className="form-input" rows={2} value={note} onChange={(e) => setNote(e.target.value)}
            placeholder="What they need to know before they call" />
          <button className="neo-btn gold" style={{ marginTop: 8 }}
            disabled={!to || transfer.isPending}
            onClick={() => transfer.mutate()}>
            {transfer.isPending ? 'Transferring…' : 'Transfer lead'}
          </button>
        </>
      )}
      {error && <div className="offline-banner" style={{ borderColor: 'var(--coral)', marginTop: 8 }} role="alert">{error}</div>}
    </div>
  );
}
