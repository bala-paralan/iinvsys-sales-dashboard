import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { isApi } from './api';
import { useMe } from '../../portal/useMe';
import { relTime } from './ActivityTimeline';

/**
 * The Inside Sales lead list — IS-EX-02 for an executive, IS-HD-02 for the Head,
 * IS-DIR-01's "All IS Leads" for the Director. One screen: the rows differ because the
 * SERVER scopes them, not because the component knows who is asking.
 *
 * The Activity column is doc 1's red flag — "K. Subramaniam at ICF Chennai — 5 days,
 * 0 activities — is an instant red flag" — so it is a column, not a detail-page fact.
 */
const STAGE_LABEL: Record<string, string> = {
  is_new: 'New',
  is_contacted: 'Contacted',
  is_qualified: 'Qualified',
  is_handoff_requested: 'Handoff requested',
  is_converted: 'Converted',
  is_lost: 'Disqualified',
};

const STAGE_COLOR: Record<string, string> = {
  is_new: 'var(--gold)',
  is_contacted: 'var(--azure)',
  is_qualified: 'var(--emerald)',
  is_handoff_requested: 'var(--violet)',
  is_converted: 'var(--emerald)',
  is_lost: 'var(--coral)',
};

const PRIORITY_COLOR: Record<string, string> = {
  hot: 'var(--coral)', high: 'var(--amber)', normal: 'var(--text-3)',
};

export function IsLeadsPage() {
  const nav = useNavigate();
  const { data: me } = useMe();
  /* Seeded from the URL so a sidebar link can point at a filtered view — doc 1 lists
     "Request Handoff" as an action, and what that means in practice is "show me the
     leads that are ready for one". */
  const [params] = useSearchParams();
  const [stage, setStage] = useState(params.get('isStage') ?? '');
  const [unassigned, setUnassigned] = useState(params.get('unassigned') === 'true');

  const query = [
    stage ? `isStage=${stage}` : '',
    unassigned ? 'unassigned=true' : '',
  ].filter(Boolean).join('&');

  const { data: leads = [], isLoading, isError } = useQuery({
    queryKey: ['is', 'leads', stage, unassigned],
    queryFn: () => isApi.leads(query ? `?${query}` : ''),
  });

  const base = `/${me?.portal?.key === 'director' ? 'director/inside-sales' : me?.portal?.key ?? ''}`;
  const open = (id: string) => nav(`${base}/leads/${id}`);

  return (
    <div>
      <h1 className="page-title">Inside Sales <em>leads</em></h1>
      <div className="page-sub">
        // {me?.scope.mode === 'own' ? 'YOUR OWN LEADS' : me?.scope.mode === 'team' ? 'YOUR TEAM' : 'ALL LEADS'}
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', margin: '16px 0', flexWrap: 'wrap' }}>
        <div>
          <label className="form-label" htmlFor="f-stage">Stage</label>
          <select id="f-stage" className="form-input" value={stage} onChange={(e) => setStage(e.target.value)}>
            <option value="">All stages</option>
            {Object.entries(STAGE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        {me?.scope.mode !== 'own' && (
          <button className="neo-btn" aria-pressed={unassigned}
            style={unassigned ? { borderColor: 'var(--coral)', color: 'var(--coral)' } : undefined}
            onClick={() => setUnassigned((v) => !v)}>
            ⚠ Unassigned only
          </button>
        )}
        <button className="neo-btn gold" onClick={() => nav(`${base}/leads/new`)}>➕ Capture lead</button>
      </div>

      {isError && <div className="offline-banner" role="alert">Could not load leads.</div>}
      {isLoading && <div className="page-sub">// LOADING</div>}

      {!isLoading && !leads.length && (
        <div className="page-sub">// NO LEADS MATCH THIS FILTER</div>
      )}

      {!!leads.length && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 820 }}>
            <thead>
              <tr>
                {['Lead / Company', 'Stage', 'Priority', 'Owner', 'BANT', 'Last activity', ''].map((h) => (
                  <th key={h} className="table-th">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {leads.map((l) => {
                const confirmed = (['budget', 'authority', 'need', 'timeline'] as const)
                  .filter((k) => l.bant?.[k]?.confirmed).length;
                const stale = l.lastActivityAt
                  ? (Date.now() - new Date(l.lastActivityAt).getTime()) / 36e5
                  : Infinity;
                return (
                  <tr key={l._id} style={{ borderTop: '1px solid #000', cursor: 'pointer' }}
                    onClick={() => open(l._id)}>
                    <td style={{ padding: '10px 8px' }}>
                      <div style={{ fontWeight: 600 }}>{l.name}</div>
                      <div style={{ color: 'var(--text-3)', fontSize: 12 }}>
                        {l.company || '—'} · {l.refId}
                      </div>
                    </td>
                    <td style={{ padding: '10px 8px', color: STAGE_COLOR[l.isStage] }}>
                      {STAGE_LABEL[l.isStage] ?? l.isStage ?? '—'}
                    </td>
                    <td style={{ padding: '10px 8px', color: PRIORITY_COLOR[l.priority] }}>
                      {l.priority}
                    </td>
                    <td style={{ padding: '10px 8px' }}>
                      {l.owner?.name ?? (l.directorManaged
                        ? <span style={{ color: 'var(--violet)' }}>Director-managed</span>
                        : <span style={{ color: 'var(--coral)' }}>Unassigned</span>)}
                    </td>
                    <td style={{ padding: '10px 8px' }}>
                      <span style={{ color: confirmed === 4 ? 'var(--emerald)' : 'var(--text-3)' }}>
                        {confirmed}/4
                      </span>
                    </td>
                    <td style={{ padding: '10px 8px', color: stale > 48 ? 'var(--coral)' : stale > 24 ? 'var(--amber)' : undefined }}>
                      {l.lastActivityAt ? relTime(l.lastActivityAt) : '⚠ no contact'}
                    </td>
                    <td style={{ padding: '10px 8px', textAlign: 'right' }}>→</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
