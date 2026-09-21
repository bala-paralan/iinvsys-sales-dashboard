import { useQuery } from '@tanstack/react-query';
import { transferApi, type HistoryEvent } from './transferApi';
import { useRoles } from '../../meta/roles';

/**
 * SPENCO CRM brief §7 — "Lead History Log — Mandatory". One list, oldest first:
 * who created it, who it was assigned to, every transfer (from → to, by whom), every
 * status change and who made it. Read from GET /leads/:id/history, which merges the
 * lead's own ownership and stage logs with the audit rows that neither embeds.
 */
const TONE: Record<string, string> = {
  created: 'var(--emerald)',
  assigned: 'var(--azure)',
  transferred: 'var(--gold)',
  stage: 'var(--violet)',
  gate_override: 'var(--coral)',
  'handoff.created': 'var(--azure)',
  'record.merge': 'var(--amber)',
};

const ICON: Record<string, string> = {
  created: '✚', assigned: '→', transferred: '⇄', stage: '▲', gate_override: '⚠',
  'handoff.created': '⤳', 'record.merge': '⧉', 'record.delete': '✕',
};

function when(iso: string) {
  return new Date(iso).toLocaleString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export function LeadHistoryPanel({ leadId }: { leadId: string }) {
  const { abbr } = useRoles();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['lead', leadId, 'history'],
    queryFn: () => transferApi.history(leadId),
    enabled: !!leadId,
  });

  const events: HistoryEvent[] = data?.events ?? [];

  return (
    <div className="card" style={{ padding: 16 }}>
      <h3 style={{ marginTop: 0 }}>History</h3>
      <p className="page-sub" style={{ marginTop: -6 }}>
        // CREATED · ASSIGNED · EVERY TRANSFER · EVERY STATUS CHANGE — WHO AND WHEN
      </p>
      {isLoading && <div className="page-sub">// LOADING</div>}
      {isError && <div className="offline-banner" style={{ borderColor: 'var(--coral)' }} role="alert">Could not load history.</div>}
      {!isLoading && !events.length && <div className="page-sub">// NOTHING RECORDED YET</div>}
      <ol style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {events.map((e, i) => (
          <li key={`${e.at}-${i}`} style={{
            display: 'grid', gridTemplateColumns: '28px 1fr auto', gap: 10, alignItems: 'start',
            padding: '8px 0', borderTop: i ? '1px solid #000' : undefined,
          }}>
            <span aria-hidden style={{
              width: 24, height: 24, borderRadius: 12, display: 'grid', placeItems: 'center',
              border: `2px solid ${TONE[e.kind] ?? 'var(--text-3)'}`, color: TONE[e.kind] ?? 'var(--text-3)',
              fontSize: 12, fontWeight: 700,
            }}>{ICON[e.kind] ?? '•'}</span>
            <div>
              <div>{e.summary}</div>
              {e.meta?.note && (
                <div style={{ color: 'var(--text-3)', fontSize: 12, whiteSpace: 'pre-wrap' }}>“{e.meta.note}”</div>
              )}
              {e.kind === 'gate_override' && !!e.meta?.missingAtOverride?.length && (
                <div style={{ color: 'var(--coral)', fontSize: 12 }}>
                  Waived: {e.meta.missingAtOverride.join(', ')}
                </div>
              )}
              {e.actor && (
                <div style={{ color: 'var(--text-3)', fontSize: 12 }}>
                  {e.actor.name}{e.actor.role ? ` · ${abbr(e.actor.role)}` : ''}
                </div>
              )}
            </div>
            <time dateTime={e.at} style={{ color: 'var(--text-3)', fontSize: 12, whiteSpace: 'nowrap' }}>
              {when(e.at)}
            </time>
          </li>
        ))}
      </ol>
    </div>
  );
}
