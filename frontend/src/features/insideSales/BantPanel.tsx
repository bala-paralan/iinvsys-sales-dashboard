import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { isApi } from './api';
import { ApiError } from '../../api/client';
import type { BantDimension, BantKey, IsLead } from './types';

/**
 * BANT qualification — doc 1 IS-EX-05.
 *
 * Each dimension confirms independently and carries the note the IS Head reads at
 * IS-HD-04 before approving a handoff. The server refuses a confirmation with no note,
 * because "Budget ✓" is not something anyone can make a decision on, and this panel says
 * so up front rather than letting the request fail.
 */
const DIMENSIONS: Array<{ key: BantKey; label: string; hint: string }> = [
  { key: 'budget',    label: 'Budget',    hint: 'Is there money, and roughly how much?' },
  { key: 'authority', label: 'Authority', hint: 'Is this person the decision point, or who is?' },
  { key: 'need',      label: 'Need',      hint: 'What problem are they actually solving?' },
  { key: 'timeline',  label: 'Timeline',  hint: 'When do they intend to buy?' },
];

export function BantPanel({ lead, canEdit }: { lead: IsLead; canEdit: boolean }) {
  const qc = useQueryClient();
  const [drafts, setDrafts] = useState<Partial<Record<BantKey, string>>>({});
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => isApi.bant(lead._id, body),
    onSuccess: () => {
      setError(null);
      qc.invalidateQueries({ queryKey: ['is', 'lead', lead._id] });
      qc.invalidateQueries({ queryKey: ['is', 'gate', lead._id] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not save'),
  });

  const complete = DIMENSIONS.every((d) => lead.bant?.[d.key]?.confirmed);

  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h3 style={{ margin: 0 }}>BANT qualification</h3>
        <span style={{ color: complete ? 'var(--emerald)' : 'var(--amber)', fontSize: 12 }}>
          {complete ? 'All four confirmed' : `${DIMENSIONS.filter((d) => lead.bant?.[d.key]?.confirmed).length} of 4`}
        </span>
      </div>

      <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
        {DIMENSIONS.map((d) => {
          const dim: BantDimension | undefined = lead.bant?.[d.key];
          const draft = drafts[d.key] ?? dim?.note ?? '';
          return (
            <div key={d.key} style={{
              border: '1px solid #000',
              borderLeft: `4px solid ${dim?.confirmed ? 'var(--emerald)' : 'var(--amber)'}`,
              padding: 10,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <div>
                  <strong>{d.label}</strong>{' '}
                  <span aria-label={dim?.confirmed ? 'confirmed' : 'not confirmed'}>
                    {dim?.confirmed ? '✓' : '⚠'}
                  </span>
                  <div style={{ color: 'var(--text-3)', fontSize: 12 }}>{d.hint}</div>
                </div>
              </div>

              {canEdit ? (
                <>
                  <input
                    className="form-input"
                    style={{ marginTop: 8 }}
                    placeholder={`What was established about ${d.label.toLowerCase()}?`}
                    value={draft}
                    aria-label={`${d.label} note`}
                    onChange={(e) => setDrafts((s) => ({ ...s, [d.key]: e.target.value }))}
                  />
                  <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                    <button
                      className="neo-btn"
                      disabled={save.isPending || !draft.trim()}
                      onClick={() => save.mutate({ [d.key]: { confirmed: true, note: draft } })}
                    >
                      {dim?.confirmed ? 'Update' : 'Confirm'}
                    </button>
                    {dim?.confirmed && (
                      <button
                        className="neo-btn"
                        disabled={save.isPending}
                        onClick={() => save.mutate({ [d.key]: { confirmed: false } })}
                      >
                        Un-confirm
                      </button>
                    )}
                  </div>
                </>
              ) : (
                <div style={{ marginTop: 6 }}>{dim?.note || <span style={{ color: 'var(--text-3)' }}>— nothing recorded</span>}</div>
              )}
            </div>
          );
        })}
      </div>

      {error && <div className="offline-banner" style={{ borderColor: 'var(--coral)', marginTop: 10 }} role="alert">{error}</div>}
    </div>
  );
}
