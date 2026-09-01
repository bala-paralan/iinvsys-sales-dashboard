import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { isApi } from './api';
import { ApiError } from '../../api/client';

/**
 * Log one interaction — doc 1 IS-EX-04, doc 2 SA-EX-04.
 *
 * Two things this form does that a plain note box would not:
 *
 *   BANT UPDATE   confirming a dimension as the call is logged, so the qualification is
 *                 recorded where it actually happened rather than re-keyed later.
 *   NEXT ACTION   "auto-creates a task with a due date. No manual task creation needed —
 *                 every activity automatically seeds the next action." The server does
 *                 this in the same operation as the activity, so it cannot be half-done.
 */
const TYPES = [
  { key: 'call', label: '📞 Call' },
  { key: 'email', label: '📧 Email' },
  { key: 'visit', label: '🤝 Visit' },
  { key: 'whatsapp', label: '💬 WhatsApp' },
  { key: 'meeting', label: '📅 Meeting' },
  { key: 'note', label: '📝 Note' },
];

const OUTCOMES = [
  { key: '', label: '—' },
  { key: 'connected_positive', label: 'Connected — positive' },
  { key: 'connected_objections', label: 'Connected — objections raised' },
  { key: 'connected_not_interested', label: 'Connected — not interested' },
  { key: 'not_reachable', label: 'Not reachable' },
  { key: 'voicemail', label: 'Voicemail left' },
  { key: 'no_show', label: 'No-show' },
];

const BANT = [
  { key: 'none', label: 'No BANT update' },
  { key: 'budget', label: 'Budget confirmed' },
  { key: 'authority', label: 'Authority confirmed' },
  { key: 'need', label: 'Need confirmed' },
  { key: 'timeline', label: 'Timeline confirmed' },
];

export function LogActivityForm({
  customerId, dealId, onLogged,
}: { customerId: string; dealId?: string; onLogged?: () => void }) {
  const qc = useQueryClient();
  const [type, setType] = useState('call');
  const [duration, setDuration] = useState('');
  const [outcome, setOutcome] = useState('');
  const [summary, setSummary] = useState('');
  const [bantUpdate, setBantUpdate] = useState('none');
  const [nextLabel, setNextLabel] = useState('');
  const [nextDue, setNextDue] = useState('');
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => isApi.logActivity({
      customer: customerId,
      deal: dealId ?? null,
      type,
      durationMinutes: duration ? Number(duration) : null,
      outcome: outcome || '',
      summary,
      bantUpdate,
      nextAction: nextLabel ? { label: nextLabel, dueAt: nextDue || null } : undefined,
    }),
    onSuccess: () => {
      setSummary(''); setDuration(''); setNextLabel(''); setNextDue('');
      setOutcome(''); setBantUpdate('none'); setError(null);
      qc.invalidateQueries({ queryKey: ['activities'] });
      qc.invalidateQueries({ queryKey: ['tasks'] });
      qc.invalidateQueries({ queryKey: ['customer360'] });
      onLogged?.();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not save'),
  });

  return (
    <div className="card" style={{ padding: 16 }}>
      <h3 style={{ margin: '0 0 12px' }}>Log activity</h3>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
        {TYPES.map((t) => (
          <button
            key={t.key}
            type="button"
            className="neo-btn"
            aria-pressed={type === t.key}
            style={type === t.key ? { borderColor: 'var(--gold)', color: 'var(--gold)' } : undefined}
            onClick={() => setType(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
        {type === 'call' && (
          <div>
            <label className="form-label" htmlFor="act-duration">Duration (minutes)</label>
            <input id="act-duration" className="form-input" type="number" min={0}
              value={duration} onChange={(e) => setDuration(e.target.value)} />
          </div>
        )}
        <div>
          <label className="form-label" htmlFor="act-outcome">Outcome</label>
          <select id="act-outcome" className="form-input"
            value={outcome} onChange={(e) => setOutcome(e.target.value)}>
            {OUTCOMES.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
        </div>
        <div>
          <label className="form-label" htmlFor="act-bant">BANT update</label>
          <select id="act-bant" className="form-input"
            value={bantUpdate} onChange={(e) => setBantUpdate(e.target.value)}>
            {BANT.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}
          </select>
        </div>
      </div>

      <div style={{ marginTop: 10 }}>
        <label className="form-label" htmlFor="act-summary">
          Summary * <span style={{ color: 'var(--text-3)' }}>— visible to your manager and Director</span>
        </label>
        <textarea id="act-summary" className="form-input" rows={3}
          value={summary} onChange={(e) => setSummary(e.target.value)} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10, marginTop: 10 }}>
        <div>
          <label className="form-label" htmlFor="act-next">Next action (creates a task)</label>
          <input id="act-next" className="form-input" placeholder="e.g. Follow-up call"
            value={nextLabel} onChange={(e) => setNextLabel(e.target.value)} />
        </div>
        <div>
          <label className="form-label" htmlFor="act-due">Due</label>
          <input id="act-due" className="form-input" type="date"
            value={nextDue} onChange={(e) => setNextDue(e.target.value)} />
        </div>
      </div>

      {error && <div className="offline-banner" style={{ borderColor: 'var(--coral)', marginTop: 10 }} role="alert">{error}</div>}

      <button className="neo-btn gold" style={{ marginTop: 12 }}
        disabled={!summary.trim() || save.isPending}
        onClick={() => save.mutate()}>
        {save.isPending ? 'Saving…' : '💾 Save activity'}
      </button>
    </div>
  );
}
