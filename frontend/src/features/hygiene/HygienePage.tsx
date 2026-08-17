/**
 * The manager review worklist — GET /api/leads/hygiene.
 *
 * The byCode breakdown leads and filters the list: a count of flagged records
 * is not actionable, but "16 leads missing a designation" is a task someone
 * can finish. Codes come from the server's aggregation, never a client-side
 * enumeration of rules — the rules live in pipeline.hygieneIssues().
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';

interface HygieneLead {
  _id: string;
  name: string;
  company?: string;
  stage: string;
  reviewIssues: string[];
  value?: number;
  assignedAgent?: { name: string } | null;
}

interface HygienePayload {
  leads: HygieneLead[];
  byCode: Array<{ _id: string; count: number }>;
}

/** presentation only — unknown codes fall back to the raw code string */
const CODE_LABELS: Record<string, string> = {
  company_type_missing: 'No company type',
  industry_segment_missing: 'No industry segment',
  email_missing: 'No email (B2B)',
  designation_missing: 'No designation',
  state_missing: 'No state',
  zone_underived: 'Zone underivable',
  phone_format_invalid: 'Phone not a 10-digit mobile',
  close_date_missing: 'No expected close date',
  close_date_expired: 'Close date in the past',
  followup_missing: 'No follow-up date',
  followup_past: 'Follow-up date passed',
  followup_far_unexplained: 'Follow-up >14d out, no reason',
  next_action_missing: 'No next action',
  inactive_30d: 'Inactive 30+ days',
  stage_age_exceeded: 'Too long at stage',
  stale_notes: 'No note this week',
  probability_override_unexplained: 'Probability override unexplained',
};

export function HygienePage() {
  const [code, setCode] = useState<string | null>(null);

  const queue = useQuery({
    queryKey: ['hygiene', code],
    queryFn: async () =>
      (await api<HygienePayload>('GET', `/leads/hygiene${code ? `?code=${code}` : ''}`)).data,
  });

  return (
    <>
      <h1 className="page-title">Review <em>Queue</em></h1>
      <div className="page-sub">// CRM HYGIENE · FLAGS NEVER BLOCK — THEY SURFACE</div>

      {queue.isError && (
        <div className="offline-banner">Could not load the queue: {String((queue.error as Error).message)}</div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
        <button
          className="neo-btn"
          style={code === null ? { background: 'var(--gold)', color: '#000' } : {}}
          onClick={() => setCode(null)}
        >
          All
        </button>
        {queue.data?.byCode.map((c) => (
          <button
            key={c._id}
            className="neo-btn"
            style={code === c._id ? { background: 'var(--gold)', color: '#000' } : {}}
            onClick={() => setCode(code === c._id ? null : c._id)}
          >
            {CODE_LABELS[c._id] ?? c._id} · {c.count}
          </button>
        ))}
      </div>

      {queue.data?.leads.length === 0 && (
        <p style={{ color: 'var(--text-3)' }}>Nothing needs review. Clean book.</p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 720 }}>
        {queue.data?.leads.map((lead) => (
          <Link
            key={lead._id}
            to={`/leads/${lead._id}`}
            className="lead-card"
            style={{ textDecoration: 'none', color: 'inherit' }}
          >
            <div className="lead-card-name">{lead.name}</div>
            <div className="lead-card-meta">
              {lead.company || 'No company'} · {lead.stage}
              {lead.assignedAgent ? ` · ${lead.assignedAgent.name}` : ''}
            </div>
            <div className="lead-card-flag">
              {lead.reviewIssues.map((c) => CODE_LABELS[c] ?? c).join(' · ')}
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}
