import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../api/client';
import { isApi } from './api';
import { useMe } from '../../portal/useMe';
import { ActivityTimeline, relTime } from './ActivityTimeline';

/**
 * IS-DIR-02 (Director) / IS-HD-03 (IS Head) — one executive, everything they have done.
 *
 * The coaching note is the part that needs care. Doc 1: "Private — not visible to Rajan
 * or IS Head." The server decides who may read a note (the author and the author's
 * ancestors, never the subject); this screen only renders what came back, which is why
 * an empty list here is a correct answer rather than a bug.
 */
export function IsExecDrillPage() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data: exec } = useQuery({
    queryKey: ['users', id],
    queryFn: async () => (await api<{ name: string; role: string; domain?: string }>(
      'GET', `/users/${id}`)).data,
    enabled: !!id,
  });

  const { data: leads = [] } = useQuery({
    queryKey: ['is', 'leads', 'byOwner', id],
    queryFn: () => isApi.leads(`?owner=${id}`),
    enabled: !!id,
  });

  const { data: activities = [] } = useQuery({
    queryKey: ['activities', 'byUser', id],
    queryFn: () => isApi.activities(`?by=${id}`),
    enabled: !!id,
  });

  const { data: notes = [] } = useQuery({
    queryKey: ['coaching', id],
    queryFn: async () => (await api<Array<{ _id: string; body: string; createdAt: string; author: { name: string } }>>(
      'GET', `/coaching-notes?about=${id}`)).data,
    enabled: !!id && !!me?.permissions.includes('coaching.read'),
  });

  const addNote = useMutation({
    mutationFn: () => api('POST', '/coaching-notes', { about: id, body: note }),
    onSuccess: () => { setNote(''); setError(null); qc.invalidateQueries({ queryKey: ['coaching', id] }); },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not save the note'),
  });

  const base = me?.portal?.key === 'director' ? '/director/inside-sales' : '/is-head';

  return (
    <div>
      <button className="neo-btn" onClick={() => nav(-1)} style={{ marginBottom: 12 }}>← Team</button>

      <h1 className="page-title">{exec?.name ?? 'Executive'} <em>drill-down</em></h1>
      <div className="page-sub">// {leads.length} LEADS · {activities.length} ACTIVITIES LOGGED</div>

      {me?.permissions.includes('coaching.write') && (
        <div className="card" style={{ padding: 16, marginTop: 16, borderLeft: '4px solid var(--violet)' }}>
          <h3 style={{ marginTop: 0 }}>
            Coaching note <span style={{ color: 'var(--text-3)', fontWeight: 400, fontSize: 13 }}>
              — private; never visible to {exec?.name ?? 'them'}
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
            📝 Save coaching note
          </button>
        </div>
      )}

      <h3 style={{ marginTop: 24 }}>Their leads</h3>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
          <thead>
            <tr>{['Lead / Company', 'Stage', 'BANT', 'Last activity', ''].map((h) => (
              <th key={h} className="table-th">{h}</th>))}
            </tr>
          </thead>
          <tbody>
            {leads.map((l) => {
              const confirmed = (['budget', 'authority', 'need', 'timeline'] as const)
                .filter((k) => l.bant?.[k]?.confirmed).length;
              return (
                <tr key={l._id} style={{ borderTop: '1px solid #000', cursor: 'pointer' }}
                  onClick={() => nav(`${base}/leads/${l._id}`)}>
                  <td style={{ padding: '10px 8px' }}>
                    <strong>{l.name}</strong>
                    <div style={{ color: 'var(--text-3)', fontSize: 12 }}>{l.company}</div>
                  </td>
                  <td style={{ padding: '10px 8px' }}>{(l.isStage ?? '—').replace(/^is_/, '').replace(/_/g, ' ')}</td>
                  <td style={{ padding: '10px 8px' }}>{confirmed}/4</td>
                  <td style={{ padding: '10px 8px' }}>
                    {l.lastActivityAt ? relTime(l.lastActivityAt) : <span style={{ color: 'var(--coral)' }}>⚠ 0 activities</span>}
                  </td>
                  <td style={{ padding: '10px 8px', textAlign: 'right' }}>→</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!leads.length && <div className="page-sub">// NO LEADS ASSIGNED</div>}

      <h3 style={{ marginTop: 24 }}>Everything they have logged</h3>
      <ActivityTimeline activities={activities} emptyMessage="This executive has logged nothing yet." />
    </div>
  );
}
