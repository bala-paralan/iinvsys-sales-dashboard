import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { isApi } from './api';
import { ApiError } from '../../api/client';
import { useMe } from '../../portal/useMe';
import { BantPanel } from './BantPanel';
import { LogActivityForm } from './LogActivityForm';
import { ActivityTimeline, relTime } from './ActivityTimeline';
import type { IsLead } from './types';

/**
 * IS-EX-03 / IS-EX-04 / IS-EX-05 in one screen — the Inside Sales Executive's working
 * view. Doc 1 draws them as three screens; they are three panels of one page here
 * because an executive logging a call is also confirming BANT and reading the timeline,
 * and making that three navigations would be worse, not more faithful.
 */
export function IsLeadDetailPage() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const [error, setError] = useState<string | null>(null);
  const [gate, setGate] = useState<Array<{ field: string; message: string }> | null>(null);

  const { data: lead, isLoading } = useQuery({
    queryKey: ['is', 'lead', id],
    queryFn: () => isApi.lead(id),
    enabled: !!id,
  });

  const customerId = lead?.customer?._id;

  const { data: activities = [] } = useQuery({
    queryKey: ['activities', 'customer', customerId],
    queryFn: () => isApi.activities(`?customer=${customerId}`),
    enabled: !!customerId,
  });

  const handoff = useMutation({
    mutationFn: () => isApi.requestHandoff(id, {}),
    onSuccess: () => {
      setError(null); setGate(null);
      qc.invalidateQueries({ queryKey: ['is', 'lead', id] });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.missing?.length) {
        /* The server returns the same checklist shape as every stage gate, so this
           renders as a list of what is actually blocking rather than one flat message. */
        setGate(e.missing as Array<{ field: string; message: string }>);
        setError(e.message);
      } else setError(e instanceof ApiError ? e.message : 'Could not request handoff');
    },
  });

  if (isLoading) return <div className="page-sub">// LOADING</div>;
  if (!lead) return <div className="offline-banner" role="alert">Lead not found, or not yours.</div>;

  const isOwner = me?.userId === lead.owner?._id;
  const canEdit = isOwner || me?.scope.mode !== 'own';
  /* Defensive: the model derives `isStage` for every inside_sales record, so a null here
     means a record that predates that rule. Render it rather than crashing the page. */
  const stageLabel = (lead.isStage ?? 'unknown').replace(/^is_/, '').replace(/_/g, ' ');

  return (
    <div>
      <button className="neo-btn" onClick={() => nav(-1)} style={{ marginBottom: 12 }}>← Back</button>

      <h1 className="page-title">{lead.name} <em>{lead.company}</em></h1>
      <div className="page-sub">
        // {lead.refId} · {stageLabel.toUpperCase()} · {lead.priority.toUpperCase()} PRIORITY
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16, marginTop: 16 }}>
        <div className="card" style={{ padding: 16 }}>
          <h3 style={{ marginTop: 0 }}>Lead</h3>
          <Field label="Reference" value={lead.refId} />
          <Field label="Contact" value={lead.name} />
          <Field label="Designation" value={lead.jobTitle || '—'} />
          <Field label="Company" value={lead.company || '—'} />
          <Field label="Mobile" value={lead.phone} />
          <Field label="Email" value={lead.email || '—'} />
          <Field label="Owner" value={lead.owner?.name ?? (lead.directorManaged ? 'Director-managed' : 'Unassigned')} />
          <Field label="Last activity" value={relTime(lead.lastActivityAt)} />
          {lead.customer && (
            <button className="neo-btn" style={{ marginTop: 10 }}
              onClick={() => nav(`${me?.portal?.landing.split('/')[1] ? `/${me.portal.landing.split('/')[1]}` : ''}/customers/${lead.customer!._id}`)}>
              🏢 Customer 360 — {lead.customer.name}
            </button>
          )}
        </div>

        <BantPanel lead={lead as IsLead} canEdit={canEdit} />
      </div>

      <div className="card" style={{ padding: 16, marginTop: 16 }}>
        <h3 style={{ marginTop: 0 }}>Handoff to Sales</h3>
        {lead.convertedTo ? (
          <div className="offline-banner" style={{ borderColor: 'var(--emerald)' }}>
            Converted — a Sales deal now carries this opportunity.
          </div>
        ) : lead.handoffApproval ? (
          <div className="offline-banner">
            Requested. Waiting on the IS Head to approve, return, or escalate.
          </div>
        ) : (
          <>
            <p style={{ color: 'var(--text-3)', marginTop: 0 }}>
              All four BANT dimensions must be confirmed. The IS Head reviews them before
              a Sales deal is created.
            </p>
            <button className="neo-btn gold" disabled={handoff.isPending || !canEdit}
              onClick={() => handoff.mutate()}>
              {handoff.isPending ? 'Requesting…' : '⏫ Request handoff to Sales'}
            </button>
          </>
        )}
        {gate && (
          <ul style={{ marginTop: 10 }}>
            {gate.map((m) => <li key={m.field} style={{ color: 'var(--coral)' }}>{m.message}</li>)}
          </ul>
        )}
        {error && !gate && <div className="offline-banner" style={{ borderColor: 'var(--coral)', marginTop: 10 }} role="alert">{error}</div>}
      </div>

      {customerId && canEdit && (
        <div style={{ marginTop: 16 }}>
          <LogActivityForm customerId={customerId} dealId={lead._id} />
        </div>
      )}

      <h3 style={{ marginTop: 24 }}>
        Activity timeline — {lead.customer?.name ?? lead.company}
      </h3>
      <p className="page-sub" style={{ marginTop: -8 }}>
        // EVERY INTERACTION WITH THIS ACCOUNT, BY ANYONE — NOT JUST THIS LEAD
      </p>
      <ActivityTimeline activities={activities} />
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '4px 0' }}>
      <span style={{ color: 'var(--text-3)' }}>{label}</span>
      <span style={{ textAlign: 'right' }}>{value}</span>
    </div>
  );
}
