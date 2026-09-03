import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../api/client';
import { salesApi, money, type TeamRow } from './api';
import { isApi } from '../insideSales/api';
import { useMe } from '../../portal/useMe';
import { ActivityTimeline, relTime } from '../insideSales/ActivityTimeline';

/**
 * SA-DIR-02 "Manager Drill-Down", SA-DIR-03 "Executive Drill-Down" and SA-MGR-03
 * "Executive Activity Log — Per Customer View".
 *
 * ONE page, because they are one act: open a person and see everything they are doing.
 * Which panels appear is decided by what came back, not by the caller's role — drilling
 * into a Sales Manager shows their two executives as well as their own book, drilling
 * into an executive shows the book alone, and both show the activity log.
 *
 * The per-customer filter is SA-MGR-03's whole point: "The Manager selects one of their
 * 2 Executives and a customer, and sees the complete per-customer activity log ... This
 * is how the Manager coaches." Choosing the executive is the row they clicked to get
 * here; choosing the account is the picker below.
 *
 * The coaching note is private in a way nothing else here is: readable by the author and
 * the author's ancestors, never by the subject. The SERVER decides that, so an empty
 * list is a correct answer rather than a bug.
 */
export function SalesExecDrillPage() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const [customerId, setCustomerId] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data: person } = useQuery({
    queryKey: ['users', id],
    queryFn: async () => (await api<{ name: string; role: string; domain?: string; target?: number }>(
      'GET', `/users/${id}`)).data,
    enabled: !!id,
  });

  const { data: board } = useQuery({
    queryKey: ['deals', 'board', 'owner', id],
    queryFn: () => salesApi.board(`?owner=${id}`),
    enabled: !!id,
  });

  const { data: activities = [] } = useQuery({
    queryKey: ['activities', 'byUser', id],
    queryFn: () => isApi.activities(`?by=${id}&limit=200`),
    enabled: !!id,
  });

  /* SA-DIR-02. Empty for an executive, which is what makes the panel disappear. */
  const { data: team } = useQuery({
    queryKey: ['deals', 'team', 'under', id],
    queryFn: () => salesApi.team(id),
    enabled: !!id && !!me?.permissions.includes('kpi.read_team'),
  });

  const { data: notes = [] } = useQuery({
    queryKey: ['coaching', id],
    queryFn: async () => (await api<Array<{
      _id: string; body: string; createdAt: string; author: { name: string };
    }>>('GET', `/coaching-notes?about=${id}`)).data,
    enabled: !!id && !!me?.permissions.includes('coaching.read'),
  });

  const addNote = useMutation({
    mutationFn: () => api('POST', '/coaching-notes', {
      about: id, body: note, customer: customerId || undefined,
    }),
    onSuccess: () => {
      setNote(''); setError(null);
      qc.invalidateQueries({ queryKey: ['coaching', id] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not save the note'),
  });

  const base = me?.portal?.key === 'director' ? '/director/sales' : `/${me?.portal?.key ?? ''}`;
  const deals = (board?.stages ?? []).flatMap((c) => c.deals);
  const openDeals = deals.filter((d) => !['commercial_order', 'order_lost'].includes(d.stage));
  const reports = team?.people ?? [];

  /* The accounts this person has actually touched, so the picker offers what there is a
     log to read rather than the whole customer list. */
  const accounts = new Map<string, string>();
  for (const a of activities as any[]) {
    const c = a.customer;
    if (c?._id) accounts.set(String(c._id), c.name);
  }
  for (const d of deals) if (d.customer?._id) accounts.set(String(d.customer._id), d.customer.name);

  const shown = customerId
    ? (activities as any[]).filter((a) => String(a.customer?._id ?? a.customer) === customerId)
    : (activities as any[]);

  const count = (t: string) => shown.filter((a: any) => a.type === t).length;
  const dealHere = customerId
    ? openDeals.find((d) => String(d.customer?._id ?? d.customer) === customerId)
    : undefined;

  return (
    <div>
      <button className="neo-btn" onClick={() => nav(-1)} style={{ marginBottom: 12 }}>← Team</button>

      <h1 className="page-title">{person?.name ?? 'Team member'} <em>drill-down</em></h1>
      <div className="page-sub">
        // {(person?.role ?? '').replace(/_/g, ' ').toUpperCase()}
        {person?.domain && person.domain !== 'none' ? ` · ${person.domain.replace(/_/g, ' ').toUpperCase()}` : ''}
        {' · '}{openDeals.length} OPEN DEALS · {activities.length} ACTIVITIES LOGGED
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, margin: '16px 0' }}>
        <Tile label={customerId ? 'Activities (account)' : 'Total activities'} value={String(shown.length)} />
        <Tile label="Calls" value={String(count('call'))} />
        <Tile label="Emails" value={String(count('email'))} />
        <Tile label="Visits" value={String(count('visit'))} />
        <Tile label="Last activity"
          value={shown.length ? relTime(shown[0].occurredAt) : '⚠ never'}
          tone={shown.length ? undefined : 'var(--coral)'} />
        {dealHere && <Tile label="Deal stage"
          value={String(dealHere.stage).replace(/_/g, ' ')} hint={dealHere.refId} />}
      </div>

      {/* SA-DIR-02 — the manager's own two executives. */}
      {!!reports.length && (
        <>
          <h3>Their team</h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
              <thead>
                <tr>{['Person', 'Open', 'Pipeline', 'Closed', 'vs target', 'At risk', 'Today', ''].map((h) => (
                  <th key={h} className="table-th">{h}</th>))}
                </tr>
              </thead>
              <tbody>
                {reports.map((p: TeamRow) => (
                  <tr key={p.user._id} style={{ borderTop: '1px solid #000', cursor: 'pointer' }}
                    onClick={() => nav(`${base}/exec/${p.user._id}`)}>
                    <td style={{ padding: '10px 8px' }}>
                      <strong>{p.user.name}</strong>
                      <div style={{ color: 'var(--text-3)', fontSize: 12 }}>
                        {p.user.role?.replace(/_/g, ' ')}
                      </div>
                    </td>
                    <td style={{ padding: '10px 8px' }}>{p.open}</td>
                    <td style={{ padding: '10px 8px' }}>{money(p.pipelineValue)}</td>
                    <td style={{ padding: '10px 8px' }}>{money(p.wonValue)}</td>
                    <td style={{ padding: '10px 8px' }}>
                      {p.targetAchieved === null ? '—' : `${p.targetAchieved}%`}
                    </td>
                    <td style={{ padding: '10px 8px', color: p.atRisk ? 'var(--coral)' : undefined }}>
                      {p.atRisk || 0}
                    </td>
                    <td style={{ padding: '10px 8px' }}>{p.activitiesToday ?? '—'}</td>
                    <td style={{ padding: '10px 8px', textAlign: 'right' }}>Drill down →</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <h3 style={{ marginTop: 24 }}>Their deals</h3>
      {!deals.length && <div className="page-sub">// NO DEALS ASSIGNED</div>}
      {!!deals.length && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
            <thead>
              <tr>{['Deal', 'Stage', 'Value', 'Discount', 'Last activity', ''].map((h) => (
                <th key={h} className="table-th">{h}</th>))}
              </tr>
            </thead>
            <tbody>
              {deals.map((d) => (
                <tr key={d._id} style={{ borderTop: '1px solid #000', cursor: 'pointer' }}
                  onClick={() => nav(`${base}/deals/${d._id}`)}>
                  <td style={{ padding: '10px 8px' }}>
                    <strong>{d.company || d.name}</strong>
                    <div style={{ color: 'var(--text-3)', fontSize: 12 }}>{d.refId}</div>
                  </td>
                  <td style={{ padding: '10px 8px' }}>{String(d.stage).replace(/_/g, ' ')}</td>
                  <td style={{ padding: '10px 8px' }}>{money(d.value)}</td>
                  <td style={{ padding: '10px 8px' }}>
                    {d.discount?.percent
                      ? `−${d.discount.percent}%${d.discount.status === 'pending' ? ' (pending)' : ''}`
                      : '—'}
                  </td>
                  <td style={{ padding: '10px 8px' }}>
                    {d.lastActivityAt ? relTime(d.lastActivityAt)
                      : <span style={{ color: 'var(--coral)' }}>⚠ none</span>}
                  </td>
                  <td style={{ padding: '10px 8px', textAlign: 'right' }}>→</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* SA-MGR-03 — "Manager Note (Private)", optionally about one account. */}
      {me?.permissions.includes('coaching.write') && (
        <div className="card" style={{ padding: 16, marginTop: 24, borderLeft: '4px solid var(--violet)' }}>
          <h3 style={{ marginTop: 0 }}>
            Manager note <span style={{ color: 'var(--text-3)', fontWeight: 400, fontSize: 13 }}>
              — private; never visible to {person?.name ?? 'them'}
            </span>
          </h3>
          {notes.map((n) => (
            <div key={n._id} style={{ padding: '8px 0', borderBottom: '1px solid #000' }}>
              <div style={{ whiteSpace: 'pre-wrap' }}>{n.body}</div>
              <div style={{ color: 'var(--text-3)', fontSize: 12 }}>
                {n.author?.name} · {relTime(n.createdAt)}
              </div>
            </div>
          ))}
          <textarea className="form-input" rows={3} style={{ marginTop: 10 }}
            placeholder="What should this person do differently?"
            value={note} onChange={(e) => setNote(e.target.value)} />
          {error && <div className="offline-banner" style={{ borderColor: 'var(--coral)', marginTop: 8 }} role="alert">{error}</div>}
          <button className="neo-btn" style={{ marginTop: 8 }}
            disabled={!note.trim() || addNote.isPending} onClick={() => addNote.mutate()}>
            📝 Save note{customerId ? ` on ${accounts.get(customerId)}` : ''}
          </button>
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', marginTop: 24 }}>
        <h3 style={{ margin: 0 }}>Activity log</h3>
        <div style={{ marginLeft: 'auto', minWidth: 240 }}>
          <label className="form-label" htmlFor="drill-account">Account</label>
          <select id="drill-account" className="form-input" value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}>
            <option value="">All accounts ({activities.length})</option>
            {[...accounts.entries()].map(([cid, name]) => (
              <option key={cid} value={cid}>{name}</option>
            ))}
          </select>
        </div>
      </div>
      {customerId && (
        <p className="page-sub" style={{ marginTop: 6 }}>
          // EVERY CALL, EMAIL, VISIT AND MESSAGE {person?.name?.toUpperCase()} LOGGED ON {accounts.get(customerId)?.toUpperCase()}
        </p>
      )}
      <ActivityTimeline activities={shown}
        emptyMessage={customerId
          ? 'Nothing logged on this account yet.'
          : 'This person has logged nothing yet.'} />
    </div>
  );
}

function Tile({ label, value, hint, tone }: {
  label: string; value: string; hint?: string; tone?: string;
}) {
  return (
    <div className="card" style={{ padding: 14 }}>
      <div style={{ color: 'var(--text-3)', fontSize: 12, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 20, fontFamily: 'var(--font-display)', color: tone }}>{value}</div>
      {hint && <div style={{ color: 'var(--text-3)', fontSize: 12 }}>{hint}</div>}
    </div>
  );
}
