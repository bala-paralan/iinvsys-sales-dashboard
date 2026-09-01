/**
 * The R-2 rule editor.
 *
 * These ten settings are the assumptions the source documents left open —
 * the SPENCO threshold, what counts as "industrial", which stage makes a
 * competitor mandatory. They were compile-time constants; making them editable
 * is what took four blocking assumptions off the critical path.
 *
 * The screen renders from `GET /api/settings/pipeline`, which returns the spec
 * alongside the value. It knows no rule by name — adding an eleventh rule to
 * the backend SPEC makes it appear here with no change to this file.
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../api/client';
import { can } from '../../meta/usePipeline';
import { useMe } from '../../portal/useMe';

interface RuleRow {
  key: string;
  rule: string;
  label: string;
  description: string;
  value: unknown;
  default: unknown;
  active: unknown;
  overridden: boolean;
  updatedAt: string | null;
}

/** Objects and arrays are edited as JSON — honest about what they are. */
const isScalar = (v: unknown) => typeof v !== 'object' || v === null;
const toText = (v: unknown) => (isScalar(v) ? String(v) : JSON.stringify(v, null, 2));

export function PipelineRulesPage({ canEdit }: { canEdit: boolean }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string[]>([]);

  const rules = useQuery({
    queryKey: ['settings', 'pipeline'],
    queryFn: async () => (await api<{ version: string; rules: RuleRow[] }>('GET', '/settings/pipeline')).data,
  });

  /* Seed the draft once the rules land; edits then live in the draft only. */
  useEffect(() => {
    if (rules.data && Object.keys(draft).length === 0) {
      setDraft(Object.fromEntries(rules.data.rules.map((r) => [r.key, toText(r.value)])));
    }
  }, [rules.data]);   // eslint-disable-line react-hooks/exhaustive-deps

  const save = useMutation({
    mutationFn: (updates: Record<string, unknown>) =>
      api<{ version: string; changed: string[] }>('PUT', '/settings/pipeline', { updates }),
    onSuccess: (res) => {
      setError(null);
      setSaved(res.data.changed);
      /* The version hash folds in the resolved rules, so a changed threshold
         must drop every cached gate checklist in this tab — otherwise the UI
         keeps validating against the old rule until a reload. */
      void queryClient.invalidateQueries({ queryKey: ['meta', 'pipeline'] });
      void queryClient.invalidateQueries({ queryKey: ['settings', 'pipeline'] });
    },
    onError: (err) => {
      setSaved([]);
      setError(err instanceof ApiError ? err.message : String(err));
    },
  });

  function changedUpdates(): Record<string, unknown> {
    if (!rules.data) return {};
    const out: Record<string, unknown> = {};
    for (const r of rules.data.rules) {
      const text = draft[r.key];
      if (text === undefined || text === toText(r.value)) continue;
      if (isScalar(r.value)) {
        out[r.key] = text;                     // the server coerces by spec
      } else {
        try {
          out[r.key] = JSON.parse(text);
        } catch {
          throw new SyntaxError(`${r.label}: not valid JSON`);
        }
      }
    }
    return out;
  }

  function onSave() {
    try {
      const updates = changedUpdates();
      if (!Object.keys(updates).length) { setError('Nothing changed'); return; }
      save.mutate(updates);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const dirty = rules.data
    ? rules.data.rules.filter((r) => draft[r.key] !== undefined && draft[r.key] !== toText(r.value)).length
    : 0;

  return (
    <section>
      <div className="form-label" style={{ fontSize: 13 }}>
        Pipeline rules {rules.data && <span style={{ opacity: 0.6 }}>· spec version {rules.data.version.slice(0, 12)}</span>}
      </div>

      <p style={{ color: 'var(--text-3)', fontSize: 13, maxWidth: 760, marginBottom: 14 }}>
        The assumptions the source documents left open. A change takes effect immediately —
        no restart — and invalidates every browser's cached gate checklist.
      </p>

      {error && <div className="offline-banner">{error}</div>}
      {saved.length > 0 && (
        <div className="card" style={{ padding: '10px 14px', marginBottom: 14, borderColor: 'var(--emerald)' }}>
          Applied: {saved.join(', ')}
        </div>
      )}

      {rules.isLoading && <p style={{ color: 'var(--text-3)' }}>Loading…</p>}

      <div style={{ display: 'grid', gap: 12 }}>
        {rules.data?.rules.map((r) => {
          const text = draft[r.key] ?? toText(r.value);
          const multiline = !isScalar(r.value);
          return (
            <div key={r.key} className="card" style={{ padding: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
                <label className="form-label" htmlFor={r.key} style={{ margin: 0 }}>{r.label}</label>
                {r.overridden && (
                  <span style={{ fontSize: 11, color: 'var(--amber)', fontFamily: 'var(--font-mono)' }}>
                    overridden · default {toText(r.default)}
                  </span>
                )}
              </div>

              <p style={{ color: 'var(--text-3)', fontSize: 12, margin: '4px 0 8px' }}>{r.description}</p>

              {multiline ? (
                <textarea
                  id={r.key}
                  className="form-input"
                  rows={Math.min(10, text.split('\n').length + 1)}
                  style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}
                  value={text}
                  disabled={!canEdit}
                  onChange={(e) => setDraft((d) => ({ ...d, [r.key]: e.target.value }))}
                />
              ) : (
                <input
                  id={r.key}
                  className="form-input"
                  style={{ fontFamily: 'var(--font-mono)' }}
                  value={text}
                  disabled={!canEdit}
                  onChange={(e) => setDraft((d) => ({ ...d, [r.key]: e.target.value }))}
                />
              )}

              <div style={{ fontSize: 11, color: 'var(--text-4)', fontFamily: 'var(--font-mono)', marginTop: 6 }}>
                {r.key}
                {!canEdit && ' · read-only for your role'}
              </div>
            </div>
          );
        })}
      </div>

      {canEdit && (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 16 }}>
          <button className="neo-btn gold" onClick={onSave} disabled={save.isPending || dirty === 0}>
            {save.isPending ? 'Applying…' : `Apply ${dirty || 'no'} change${dirty === 1 ? '' : 's'}`}
          </button>
          <button
            className="neo-btn"
            disabled={dirty === 0}
            onClick={() => {
              if (rules.data) {
                setDraft(Object.fromEntries(rules.data.rules.map((r) => [r.key, toText(r.value)])));
                setError(null);
              }
            }}
          >
            Discard
          </button>
        </div>
      )}
    </section>
  );
}

/** The Settings page proper — rules plus the read-only environment facts. */
export function SettingsPage() {
  const { data: me } = useMe();
  /* Reading the rules and changing them are different rights: doc 04 gives
     settings.read to the Director and settings.write to superadmin alone. */
  const canEdit = can(me, 'settings.write');

  return (
    <>
      <h1 className="page-title">Settings</h1>
      <div className="page-sub">// RUNTIME-CONFIGURABLE RULES · R-2</div>
      <PipelineRulesPage canEdit={canEdit} />
    </>
  );
}
