/**
 * SPENCO qualification scoring — the Prospect-stage gate.
 *
 * Without this panel the Prospect → Engagement gate is unsatisfiable from the
 * UI: it demands "SPENCO scoring must be completed" and a total over the
 * threshold, and nothing else in the app can write `lead.spenco`. The only way
 * past it was `lead.gate_override`, which turns a qualification discipline
 * into a rubber stamp.
 *
 * Everything on screen comes from the pipeline payload's `spenco` block —
 * dimensions, their hints, the per-dimension maximum, the qualifying total and
 * the sub-gate floors. Changing a threshold in Settings re-renders this panel
 * with the new rule and no deploy.
 *
 * `total` and `qualified` are DERIVED server-side in the Lead pre-save hook, so
 * this component sends the six dimension scores and never a computed total —
 * the running figure here is a preview of the server's arithmetic, not an input.
 */
import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../api/client';
import { usePipeline } from '../../meta/usePipeline';
import { EnumSelect } from '../../components/EnumSelect';

interface Props {
  leadId: string;
  /** The lead's current `spenco` sub-document, or null if never scored. */
  spenco: Record<string, unknown> | null;
}

type Scores = Record<string, number>;

export function SpencoPanel({ leadId, spenco }: Props) {
  const queryClient = useQueryClient();
  const { data: meta } = usePipeline();
  const [scores, setScores] = useState<Scores>({});
  const [needTypeLabel, setNeedTypeLabel] = useState('');
  const [notes, setNotes] = useState('');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dims = meta?.spenco.dimensions ?? [];
  const max = meta?.spenco.maxPerDimension ?? 5;
  const minTotal = meta?.spenco.minTotal ?? 0;
  const subGates = meta?.spenco.subGates ?? {};

  /* Seed from the saved sub-document once it (and the dimension list) arrive. */
  useEffect(() => {
    if (dims.length === 0) return;
    const seed: Scores = {};
    for (const d of dims) seed[d.key] = Number(spenco?.[d.key] ?? 0);
    setScores(seed);
    setNeedTypeLabel(String(spenco?.needTypeLabel ?? ''));
    setNotes(String(spenco?.notes ?? ''));
  }, [spenco, dims.length]);           // eslint-disable-line react-hooks/exhaustive-deps

  const save = useMutation({
    mutationFn: () => api('PUT', `/leads/${leadId}`, {
      spenco: { ...scores, needTypeLabel, notes },
    }),
    onSuccess: () => {
      setError(null);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      queryClient.invalidateQueries({ queryKey: ['lead', leadId] });
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['gate', `/leads/${leadId}`] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : String(err)),
  });

  if (dims.length === 0) {
    return (
      <div className="offline-banner">
        SPENCO dimensions are unavailable — the scoring rules come from the server.
      </div>
    );
  }

  const total = dims.reduce((sum, d) => sum + (scores[d.key] ?? 0), 0);
  /* Mirrors pipeline.spencoQualified: the total floor AND every sub-gate. */
  const failedSubGates = Object.entries(subGates)
    .filter(([key, floor]) => (scores[key] ?? 0) < Number(floor));
  const qualifies = total >= minTotal && failedSubGates.length === 0;
  const labelOf = (key: string) => dims.find((d) => d.key === key)?.label ?? key;

  return (
    <section className="card" style={{ padding: 20, flex: '1 1 460px', maxWidth: 640, marginTop: 24 }}>
      <div className="gate-title">SPENCO qualification</div>
      <div style={{ color: 'var(--text-3)', fontSize: 12, fontFamily: 'var(--font-mono)', marginBottom: 14 }}>
        // SCORED AT PROSPECT · GATES ENGAGEMENT
      </div>

      {error && <div className="offline-banner">{error}</div>}

      <div style={{ display: 'grid', gap: 12 }}>
        {dims.map((d) => (
          <div key={d.key} style={{ display: 'grid', gridTemplateColumns: '1fr 90px', gap: 10, alignItems: 'center' }}>
            <div>
              <label className="form-label" htmlFor={`sp-${d.key}`} style={{ marginBottom: 2 }}>
                {d.label}
              </label>
              {d.hint && (
                <div style={{ color: 'var(--text-3)', fontSize: 12 }}>{d.hint}</div>
              )}
              {Number(subGates[d.key] ?? 0) > 0 && (
                <div style={{ color: 'var(--text-3)', fontSize: 12, fontFamily: 'var(--font-mono)' }}>
                  min {String(subGates[d.key])}
                </div>
              )}
            </div>
            <select
              id={`sp-${d.key}`}
              className="form-input"
              value={String(scores[d.key] ?? 0)}
              onChange={(e) => setScores((s) => ({ ...s, [d.key]: Number(e.target.value) }))}
            >
              {Array.from({ length: max + 1 }, (_, n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>
        ))}

        <div>
          <label className="form-label" htmlFor="sp-needTypeLabel">Need type</label>
          <EnumSelect
            id="sp-needTypeLabel"
            enumName="needTypes"
            value={needTypeLabel}
            onChange={setNeedTypeLabel}
          />
        </div>

        <div>
          <label className="form-label" htmlFor="sp-notes">Qualification notes</label>
          <textarea
            id="sp-notes"
            className="form-input"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
      </div>

      <div
        style={{
          marginTop: 16, padding: '10px 12px', background: 'var(--surface-1)',
          borderLeft: `3px solid ${qualifies ? 'var(--emerald)' : 'var(--coral)'}`,
        }}
      >
        <div style={{ fontSize: 15 }}>
          <strong>{total}</strong> / {meta?.spenco.maxTotal ?? max * dims.length}
          <span style={{ color: 'var(--text-3)', fontSize: 13 }}> · needs {minTotal} to qualify</span>
        </div>
        {failedSubGates.length > 0 && (
          <div style={{ color: 'var(--coral)', fontSize: 12, marginTop: 4 }}>
            Below the floor on {failedSubGates.map(([k, f]) => `${labelOf(k)} (min ${f})`).join(', ')}
          </div>
        )}
        {qualifies && (
          <div style={{ color: 'var(--emerald)', fontSize: 12, marginTop: 4 }}>Qualifies for Engagement.</div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 10, marginTop: 14, alignItems: 'center' }}>
        <button
          type="button"
          className="neo-btn gold"
          disabled={save.isPending}
          onClick={() => save.mutate()}
        >
          {save.isPending ? 'Saving…' : 'Save scoring'}
        </button>
        {saved && <span style={{ color: 'var(--emerald)', fontSize: 13 }}>Saved.</span>}
      </div>
    </section>
  );
}
