import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supportApi } from './api';
import { ApiError } from '../../api/client';
import { Modal } from '../../components/Modal';

/**
 * IC-FE-04 — customer sign-off and CSAT, handed to the customer on a tablet.
 *
 * The only genuinely new layout in the specification, and its constraints come from who
 * uses it: a customer who has never seen this software, on someone else's device, at the
 * end of a site visit. So — large touch targets (doc 4 says stars ≥32px), a completion
 * summary in plain language, no ERP vocabulary anywhere on screen, and nothing to read
 * that is not about what was just installed.
 *
 * The CSAT captured here is deliberately NOT `feedback.csat`: that is the form dispatched
 * 14 days later, and collapsing the two would make the collection-rate KPI meaningless.
 */
export function SignOffPanel({ jobId, job, onClose }: {
  jobId: string; job: any; onClose: () => void;
}) {
  const qc = useQueryClient();
  const [csat, setCsat] = useState(0);
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [report, setReport] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = useMutation({
    mutationFn: () => supportApi.submitSignOff(jobId, {
      signatoryName: name, signatoryTitle: title, csat, completionReport: report,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['installations'] });
      onClose();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not submit the sign-off'),
  });

  return (
    <Modal onClose={onClose} title="Installation complete">
      <div style={{ maxWidth: 620 }}>
        <h2 style={{ marginTop: 0, fontFamily: 'var(--font-display)' }}>
          Installation complete ✓
        </h2>
        <p style={{ color: 'var(--text-2)' }}>
          Please review and sign below.
        </p>

        <div className="card" style={{ padding: 14, marginBottom: 16 }}>
          <strong>Installed at your site</strong>
          <div style={{ color: 'var(--text-2)', marginTop: 6 }}>
            {job?.customerSnapshot?.company}
            {job?.customerSnapshot?.city ? `, ${job.customerSnapshot.city}` : ''}
          </div>
          <textarea className="form-input" rows={3} style={{ marginTop: 10 }}
            aria-label="What was installed"
            placeholder="What was installed and commissioned — in plain language for the customer"
            value={report} onChange={(e) => setReport(e.target.value)} />
        </div>

        <div style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>
            How would you rate the installation experience?
          </div>
          <div style={{ display: 'flex', gap: 8 }} role="radiogroup" aria-label="CSAT rating">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} type="button" role="radio" aria-checked={csat === n}
                aria-label={`${n} star${n === 1 ? '' : 's'}`}
                onClick={() => setCsat(n)}
                style={{
                  /* Doc 4: large touch targets, ≥32px. These are 56. */
                  width: 56, height: 56, fontSize: 28, lineHeight: 1,
                  background: 'none', cursor: 'pointer',
                  border: `2px solid ${csat >= n ? 'var(--gold)' : '#000'}`,
                  color: csat >= n ? 'var(--gold)' : 'var(--text-4)',
                }}>
                ★
              </button>
            ))}
          </div>
          {csat > 0 && (
            <div style={{ marginTop: 6, color: 'var(--gold)' }}>
              {['', 'Poor', 'Fair', 'Good', 'Very good', 'Excellent'][csat]}
            </div>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10 }}>
          <div>
            <label className="form-label" htmlFor="sig-name">Your name *</label>
            <input id="sig-name" className="form-input" style={{ fontSize: 18, padding: 12 }}
              value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className="form-label" htmlFor="sig-title">Designation</label>
            <input id="sig-title" className="form-input" style={{ fontSize: 18, padding: 12 }}
              value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
        </div>

        {error && <div className="offline-banner" style={{ borderColor: 'var(--coral)', marginTop: 12 }} role="alert">{error}</div>}

        <button className="neo-btn gold"
          style={{ marginTop: 16, width: '100%', padding: 16, fontSize: 18 }}
          disabled={!name.trim() || csat === 0 || submit.isPending}
          onClick={() => submit.mutate()}>
          {submit.isPending ? 'Submitting…' : '✅ Submit sign-off'}
        </button>
        <p style={{ color: 'var(--text-4)', fontSize: 12, marginBottom: 0 }}>
          Your installation team's manager reviews and closes this job.
        </p>
      </div>
    </Modal>
  );
}
