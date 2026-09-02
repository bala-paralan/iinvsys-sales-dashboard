import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supportApi, PRIORITY_COLOR, slaLabel } from './api';
import { ApiError } from '../../api/client';
import { usePipeline } from '../../meta/usePipeline';

/**
 * IC-AG-02 — the agent's working screen for one ticket.
 *
 * Every interaction is logged here and is visible to the CS Manager, which is the same
 * arrangement the Sales and Inside Sales activity logs use. Resolving requires saying HOW,
 * because the next agent to open this needs it and "fixed" is not a handover.
 */
const ACTIVITY_TYPES = [
  { key: 'call', label: '📞 Call' },
  { key: 'email', label: '📧 Email' },
  { key: 'remote_session', label: '💻 Remote session' },
  { key: 'whatsapp', label: '💬 WhatsApp' },
  { key: 'note', label: '📝 Note' },
];

export function TicketDetailPage() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { data: meta } = usePipeline();

  const [type, setType] = useState('call');
  const [summary, setSummary] = useState('');
  const [minutes, setMinutes] = useState('');
  const [resolution, setResolution] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data: t, isLoading } = useQuery({
    queryKey: ['ticket', id],
    queryFn: () => supportApi.ticket(id),
    enabled: !!id,
    refetchInterval: 60000,
  });

  const after = () => {
    setError(null);
    qc.invalidateQueries({ queryKey: ['ticket', id] });
    qc.invalidateQueries({ queryKey: ['tickets'] });
  };
  const onErr = (e: unknown) => setError(e instanceof ApiError ? e.message : 'Request failed');

  const log = useMutation({
    mutationFn: () => supportApi.logActivity(id, {
      type, summary, minutes: minutes ? Number(minutes) : undefined,
    }),
    onSuccess: () => { setSummary(''); setMinutes(''); after(); },
    onError: onErr,
  });

  const resolve = useMutation({
    mutationFn: () => supportApi.updateTicket(id, { status: 'resolved', resolution }),
    onSuccess: () => { setResolution(''); after(); },
    onError: onErr,
  });

  const escalate = useMutation({
    mutationFn: () => supportApi.updateTicket(id, { priority: 'critical' }),
    onSuccess: after,
    onError: onErr,
  });

  if (isLoading) return <div className="page-sub">// LOADING</div>;
  if (!t) return <div className="offline-banner" role="alert">Ticket not found, or not assigned to you.</div>;

  const late = t.slaBreached && !t.resolvedAt;
  const issueLabel = (meta as any)?.enums?.ticketIssueTypes
    ?.find((x: any) => x.key === t.issueType)?.label ?? t.issueType;

  return (
    <div>
      <button className="neo-btn" onClick={() => nav(-1)} style={{ marginBottom: 12 }}>← Back</button>

      <h1 className="page-title">{t.ref} <em>{t.customer?.name}</em></h1>
      <div className="page-sub" style={{ color: late ? 'var(--coral)' : undefined }}>
        // {t.status.replace(/_/g, ' ').toUpperCase()} · {t.priority.toUpperCase()} · {slaLabel(t).toUpperCase()}
      </div>

      {error && <div className="offline-banner" style={{ borderColor: 'var(--coral)', marginTop: 12 }} role="alert">{error}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16, marginTop: 16 }}>
        <div className="card" style={{ padding: 16 }}>
          <h3 style={{ marginTop: 0 }}>Ticket</h3>
          <Row label="Reference" value={t.ref} />
          <Row label="Customer" value={t.customer?.name ?? '—'} />
          <Row label="Product" value={t.product || '—'} />
          <Row label="Issue type" value={issueLabel} />
          <Row label="Priority" value={t.priority} tone={PRIORITY_COLOR[t.priority]} />
          <Row label="SLA target" value={t.slaHours ? `${t.slaHours}h` : '—'} />
          <Row label="Raised" value={new Date(t.raisedAt).toLocaleString('en-IN')} />
          <Row label="Agent" value={t.assignedTo?.name ?? 'unassigned'} />
        </div>

        <div className="card" style={{ padding: 16 }}>
          <h3 style={{ marginTop: 0 }}>Problem</h3>
          <p style={{ whiteSpace: 'pre-wrap', marginTop: 0 }}>{t.description || t.subject}</p>
          {t.resolvedAt && (
            <div className="offline-banner" style={{ borderColor: 'var(--emerald)' }}>
              Resolved {new Date(t.resolvedAt).toLocaleString('en-IN')} — {t.resolution}
            </div>
          )}
        </div>
      </div>

      {!t.resolvedAt && (
        <div className="card" style={{ padding: 16, marginTop: 16 }}>
          <h3 style={{ marginTop: 0 }}>Log activity</h3>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
            {ACTIVITY_TYPES.map((a) => (
              <button key={a.key} type="button" className="neo-btn" aria-pressed={type === a.key}
                style={type === a.key ? { borderColor: 'var(--gold)', color: 'var(--gold)' } : undefined}
                onClick={() => setType(a.key)}>{a.label}</button>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '3fr 1fr', gap: 10 }}>
            <div>
              <label className="form-label" htmlFor="sum">What happened? *</label>
              <textarea id="sum" className="form-input" rows={3}
                value={summary} onChange={(e) => setSummary(e.target.value)} />
            </div>
            <div>
              <label className="form-label" htmlFor="min">Minutes</label>
              <input id="min" className="form-input" type="number" min={0}
                value={minutes} onChange={(e) => setMinutes(e.target.value)} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            <button className="neo-btn" disabled={!summary.trim() || log.isPending}
              onClick={() => log.mutate()}>💾 Save activity</button>
            {t.priority !== 'critical' && (
              <button className="neo-btn" disabled={escalate.isPending}
                onClick={() => escalate.mutate()}>⬆ Escalate to critical</button>
            )}
          </div>

          <div style={{ marginTop: 16, borderTop: '1px solid #000', paddingTop: 12 }}>
            <label className="form-label" htmlFor="res">Resolution — required to close</label>
            <input id="res" className="form-input" value={resolution}
              placeholder="How was it actually fixed?"
              onChange={(e) => setResolution(e.target.value)} />
            <button className="neo-btn gold" style={{ marginTop: 8 }}
              disabled={!resolution.trim() || resolve.isPending}
              onClick={() => resolve.mutate()}>✓ Mark resolved</button>
          </div>
        </div>
      )}

      <h3 style={{ marginTop: 24 }}>Activity log</h3>
      {!t.activities?.length && <div className="page-sub">// NOTHING LOGGED YET</div>}
      <div style={{ display: 'grid', gap: 8 }}>
        {[...(t.activities ?? [])].reverse().map((a) => (
          <div key={a._id} className="card" style={{ padding: 12 }}>
            <div style={{ fontWeight: 600 }}>
              {ACTIVITY_TYPES.find((x) => x.key === a.type)?.label ?? a.type}
              {a.minutes ? ` — ${a.minutes} min` : ''}
            </div>
            <div style={{ color: 'var(--text-3)', fontSize: 12 }}>
              {a.by?.name ?? '—'} · {new Date(a.at).toLocaleString('en-IN')}
            </div>
            <div style={{ whiteSpace: 'pre-wrap', marginTop: 4 }}>{a.summary}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '4px 0' }}>
      <span style={{ color: 'var(--text-3)' }}>{label}</span>
      <span style={{ textAlign: 'right', color: tone }}>{value}</span>
    </div>
  );
}
