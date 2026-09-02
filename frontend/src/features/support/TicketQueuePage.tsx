import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supportApi, PRIORITY_COLOR, slaLabel } from './api';
import { useMe } from '../../portal/useMe';

/**
 * IC-AG-01 (an agent's own queue) and IC-CSM-02 (every agent, with countdowns).
 *
 * One screen. An agent's rows are narrowed by the server, and the Agent column simply
 * isn't rendered for them — doc 4 IC-AG-01: "They cannot see how their queue compares to
 * other agents, or any team-wide statistics." Hiding the column is cosmetic; the reason
 * it is safe is that the rows were never sent.
 */
export function TicketQueuePage() {
  const nav = useNavigate();
  const { data: me } = useMe();
  const [status, setStatus] = useState('open');
  const [breached, setBreached] = useState(false);

  const isManager = !!me?.permissions.includes('kpi.read_team');

  const q = [
    status === 'open' ? 'open=true' : status ? `status=${status}` : '',
    breached ? 'breached=true' : '',
  ].filter(Boolean).join('&');

  const { data: tickets = [], isLoading, isError } = useQuery({
    queryKey: ['tickets', status, breached],
    queryFn: () => supportApi.tickets(q ? `?${q}` : ''),
    /* Doc 4 draws a live countdown; without a refetch it is a screenshot of one. */
    refetchInterval: 60000,
  });

  const base = `/${me?.portal?.key ?? ''}/tickets`;
  const openCount = tickets.filter((t) => !t.resolvedAt).length;
  const breachedCount = tickets.filter((t) => t.slaBreached && !t.resolvedAt).length;

  return (
    <div>
      <h1 className="page-title">{isManager ? <>All <em>tickets</em></> : <>My <em>tickets</em></>}</h1>
      <div className="page-sub">
        // {isManager ? 'EVERY AGENT' : 'ONLY YOUR OWN'} · {openCount} OPEN
        {breachedCount ? ` · ${breachedCount} BREACHED` : ''}
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', margin: '16px 0', flexWrap: 'wrap' }}>
        <div>
          <label className="form-label" htmlFor="st">Status</label>
          <select id="st" className="form-input" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="open">Open</option>
            <option value="">All</option>
            <option value="resolved">Resolved</option>
            <option value="closed">Closed</option>
          </select>
        </div>
        <button className="neo-btn" aria-pressed={breached}
          style={breached ? { borderColor: 'var(--coral)', color: 'var(--coral)' } : undefined}
          onClick={() => setBreached((v) => !v)}>
          ⚠ SLA breached only
        </button>
      </div>

      {isError && <div className="offline-banner" role="alert">Could not load tickets.</div>}
      {isLoading && <div className="page-sub">// LOADING</div>}
      {!isLoading && !tickets.length && <div className="page-sub">// NOTHING IN THIS QUEUE</div>}

      {!!tickets.length && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 820 }}>
            <thead>
              <tr>
                {['Ticket', 'Customer', 'Issue', 'Priority',
                  ...(isManager ? ['Agent'] : []), 'SLA', 'Status', ''].map((h) => (
                    <th key={h} className="table-th">{h}</th>))}
              </tr>
            </thead>
            <tbody>
              {tickets.map((t) => {
                const late = t.slaBreached && !t.resolvedAt;
                return (
                  <tr key={t._id} style={{ borderTop: '1px solid #000', cursor: 'pointer' }}
                    onClick={() => nav(`${base}/${t._id}`)}>
                    <td style={{ padding: '10px 8px' }}>{t.ref}</td>
                    <td style={{ padding: '10px 8px' }}>{t.customer?.name ?? '—'}</td>
                    <td style={{ padding: '10px 8px' }}>{t.subject}</td>
                    <td style={{ padding: '10px 8px', color: PRIORITY_COLOR[t.priority] }}>
                      {t.priority}
                    </td>
                    {isManager && (
                      <td style={{ padding: '10px 8px' }}>
                        {t.assignedTo?.name
                          ?? <span style={{ color: 'var(--coral)' }}>unassigned</span>}
                      </td>
                    )}
                    <td style={{ padding: '10px 8px', color: late ? 'var(--coral)' : undefined }}>
                      {late ? '⚠ ' : ''}{slaLabel(t)}
                    </td>
                    <td style={{ padding: '10px 8px' }}>{t.status.replace(/_/g, ' ')}</td>
                    <td style={{ padding: '10px 8px', textAlign: 'right' }}>→</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {!isManager && (
        <p className="page-sub" style={{ marginTop: 16 }}>
          // YOU SEE ONLY YOUR OWN TICKETS. FOR CROSS-AGENT QUERIES, ASK THE CS MANAGER.
        </p>
      )}
    </div>
  );
}
