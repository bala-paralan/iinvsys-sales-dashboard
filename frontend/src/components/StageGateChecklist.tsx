/**
 * The gate checklist — the UI face of the transition contract, for ANY of the
 * three processes: the caller passes the stage list (for labels) and the two
 * endpoints. Leads pass /leads/:id/*, Work Orders /workorders/:id/*; the
 * component knows nothing about either entity.
 *
 * Requirements come from the server's gate preview, which is AUTHORITATIVE:
 * it evaluates the same `entryRequires` table the advance endpoint enforces,
 * against the same resolved runtime rules. This component renders that
 * verdict; it never re-implements the 16 test types client-side, because two
 * implementations of gate logic is how they diverge.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal } from './Modal';
import { api, ApiError } from '../api/client';
import type { StageDef } from '../meta/usePipeline';

interface GateRequirement {
  field: string;
  test: string;
  message: string;
  code: string;
  met: boolean;
}

interface GatePreview {
  from: string;
  to: string | null;
  allowed: boolean;
  gated?: boolean;
  ok?: boolean;
  message?: string;
  requirements: GateRequirement[];
}

interface Props {
  /** e.g. `/leads/${id}` or `/workorders/${id}` — gate and advance hang off it */
  entityPath: string;
  entityName: string;
  /** the stage list this entity moves through, for labels */
  stages: Array<Pick<StageDef, 'key' | 'label'>>;
  /** show the force-with-note path (leads only — delivery has no override) */
  allowOverride?: boolean;
  /** invalidated on success, alongside the gate itself */
  invalidateKeys?: string[][];
  onClose: () => void;
  onAdvanced: () => void;
}

export function StageGateChecklist({
  entityPath, entityName, stages, allowOverride = false, invalidateKeys = [], onClose, onAdvanced,
}: Props) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [serverMissing, setServerMissing] = useState<GateRequirement[] | null>(null);
  const [overrideNote, setOverrideNote] = useState('');

  const gate = useQuery({
    queryKey: ['gate', entityPath],
    queryFn: async () => (await api<GatePreview>('GET', `${entityPath}/gate`)).data,
  });

  const advance = useMutation({
    mutationFn: async (opts: { force?: boolean }) =>
      api('POST', `${entityPath}/advance`, {
        toStage: gate.data?.to,
        ...(opts.force ? { force: true, gateOverrideNote: overrideNote } : {}),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gate', entityPath] });
      for (const key of invalidateKeys) queryClient.invalidateQueries({ queryKey: key });
      onAdvanced();
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'STAGE_GATE_FAILED' && err.missing) {
        /* The server's list supersedes the preview. */
        setServerMissing(err.missing.map((m) => ({ ...m, met: false })));
        setError(err.message);
      } else {
        setError(err instanceof Error ? err.message : 'Advance failed');
      }
    },
  });

  const stageLabel = (key: string | null | undefined) =>
    (key && stages.find((s) => s.key === key)?.label) || key || '—';

  const requirements = serverMissing
    ? mergeServerVerdict(gate.data?.requirements ?? [], serverMissing)
    : gate.data?.requirements ?? [];
  const allMet = requirements.length === 0 || requirements.every((r) => r.met);

  return (
    <Modal title={`Advance ${entityName}`} onClose={onClose}>
      <>
        <div className="gate-title">{entityName}</div>
        <div className="gate-sub">
          {stageLabel(gate.data?.from)} → {stageLabel(gate.data?.to)}
        </div>

        {gate.isLoading && <p style={{ color: 'var(--text-3)' }}>Checking the gate…</p>}

        {gate.data && gate.data.to === null && (
          <p style={{ color: 'var(--text-2)' }}>{gate.data.message ?? 'This is a closed stage.'}</p>
        )}

        {requirements.map((r) => (
          <div key={r.code} className={`gate-req ${r.met ? 'met' : 'unmet'}`}>
            <span className="gate-req-mark">{r.met ? '[x]' : '[ ]'}</span>
            <span>{r.message}</span>
          </div>
        ))}

        {error && <div className="gate-error">{error}</div>}

        {gate.data?.to && (
          <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <button
              className="neo-btn gold"
              disabled={advance.isPending || (!allMet && !serverMissing)}
              onClick={() => advance.mutate({})}
            >
              {advance.isPending ? 'Advancing…' : `Advance to ${stageLabel(gate.data.to)}`}
            </button>

            {!allMet && allowOverride && (
              <>
                <input
                  className="form-input"
                  placeholder="Override note (required) — why is this gate being waived?"
                  value={overrideNote}
                  onChange={(e) => setOverrideNote(e.target.value)}
                />
                <button
                  className="neo-btn"
                  disabled={advance.isPending || overrideNote.trim().length === 0}
                  onClick={() => advance.mutate({ force: true })}
                >
                  Force with override
                </button>
              </>
            )}

            <button className="neo-btn" onClick={onClose}>Close</button>
          </div>
        )}
      </>
    </Modal>
  );
}

/** Overlay the server's 422 verdict onto the previewed list. */
function mergeServerVerdict(preview: GateRequirement[], missing: GateRequirement[]): GateRequirement[] {
  const failed = new Set(missing.map((m) => m.code));
  const known = new Set(preview.map((p) => p.code));
  const merged = preview.map((p) => ({ ...p, met: !failed.has(p.code) }));
  /* The server may report requirements the preview never showed (e.g. a rule
     changed between render and submit) — append those rather than drop them. */
  for (const m of missing) if (!known.has(m.code)) merged.push(m);
  return merged;
}
