import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isApi } from './api';
import { api, ApiError } from '../../api/client';
import { usePipeline } from '../../meta/usePipeline';
import { useMe } from '../../portal/useMe';

/**
 * IS-DIR-03 — "the most important new screen in V3".
 *
 * One form, three destinations, because it is one decision the capturer makes once:
 *
 *   Assign to IS Executive   nurture through BANT, then request a handoff
 *   Bypass IS → Sales        a warm CXO lead enters SPENCO immediately; the server
 *                            creates BOTH records so the origin stays in Customer 360
 *   Director Managed         held personally rather than vanishing into someone's list
 *
 * Which options appear depends on what the caller may do, and the assignee list comes
 * from the server — this file knows no role names.
 */
export function IsCapturePage() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const { data: meta } = usePipeline();

  const [form, setForm] = useState<Record<string, string>>({
    name: '', phone: '', email: '', company: '', jobTitle: '',
    city: '', state: '', source: 'inside_sales_outbound', priority: 'normal', note: '',
  });
  const [mode, setMode] = useState('is_executive');
  const [assignTo, setAssignTo] = useState('');
  const [error, setError] = useState<string | null>(null);

  /* Who may receive a lead. `directReports` covers an IS Head routing within their own
     team; a Director needs the wider list and holds `directory.read` to fetch it. */
  const { data: users = [] } = useQuery({
    queryKey: ['users', 'assignable'],
    queryFn: async () => (await api<Array<{ _id: string; name: string; role: string }>>(
      'GET', '/users?limit=200')).data,
    enabled: !!me?.permissions.includes('directory.read'),
  });

  const candidates = (users.length ? users : (me?.directReports ?? []))
    .filter((u) => (mode === 'bypass_is'
      ? ['sales_executive', 'sales_manager'].includes(u.role)
      : ['is_executive', 'is_head'].includes(u.role)));

  const save = useMutation({
    mutationFn: () => isApi.create({
      ...form,
      assignmentMode: mode,
      assignTo: mode === 'director_managed' ? undefined : assignTo,
    }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['is', 'leads'] });
      const base = `/${me?.portal?.key === 'director' ? 'director/inside-sales' : me?.portal?.key ?? ''}`;
      nav(`${base}/leads/${data.lead._id}`);
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not save'),
  });

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((s) => ({ ...s, [k]: e.target.value }));

  const canBypass = !!me?.permissions.includes('lead.gate_override');
  const modes = [
    { key: 'is_executive', label: 'Assign to IS Executive',
      hint: 'Nurtures the lead, qualifies via BANT, then requests a handoff to Sales.' },
    ...(canBypass ? [{ key: 'bypass_is', label: 'Bypass IS → Sales Executive',
      hint: 'Already warm. Enters SPENCO immediately; Inside Sales qualification is skipped.' }] : []),
    ...(canBypass ? [{ key: 'director_managed', label: 'Director-managed — hold',
      hint: 'Stays in your own queue. Reassign later with the context already recorded.' }] : []),
  ];

  return (
    <div>
      <h1 className="page-title">Capture <em>lead</em></h1>
      <div className="page-sub">// NEW LEAD — AND WHERE IT GOES</div>

      <div className="card" style={{ padding: 16, marginTop: 16 }}>
        <h3 style={{ marginTop: 0 }}>Lead information</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
          <Text id="name" label="Contact name *" value={form.name} onChange={set('name')} />
          <Text id="jobTitle" label="Designation" value={form.jobTitle} onChange={set('jobTitle')} />
          <Text id="company" label="Company / organisation" value={form.company} onChange={set('company')} />
          <Text id="phone" label="Mobile *" value={form.phone} onChange={set('phone')} />
          <Text id="email" label="Email" value={form.email} onChange={set('email')} />
          <Text id="city" label="City" value={form.city} onChange={set('city')} />
          <Text id="state" label="State" value={form.state} onChange={set('state')} />
          <div>
            <label className="form-label" htmlFor="source">Lead source *</label>
            <select id="source" className="form-input" value={form.source} onChange={set('source')}>
              {(meta?.enums.leadSources ?? []).map((s) => (
                <option key={s.key} value={s.key}>{s.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="form-label" htmlFor="priority">Priority</label>
            <select id="priority" className="form-input" value={form.priority} onChange={set('priority')}>
              {(meta?.enums.leadPriorities ?? [
                { key: 'normal', label: 'Normal' },
                { key: 'high', label: 'High' },
                { key: 'hot', label: 'Hot' },
              ]).map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
            </select>
          </div>
        </div>
      </div>

      <div className="card" style={{ padding: 16, marginTop: 16 }}>
        <h3 style={{ marginTop: 0 }}>🎯 Where does this lead go?</h3>
        <div style={{ display: 'grid', gap: 8 }}>
          {modes.map((m) => (
            <label key={m.key} style={{
              display: 'block', padding: 10, cursor: 'pointer',
              border: '1px solid #000',
              borderLeft: `4px solid ${mode === m.key ? 'var(--gold)' : 'transparent'}`,
            }}>
              <input type="radio" name="mode" value={m.key} checked={mode === m.key}
                onChange={() => { setMode(m.key); setAssignTo(''); }} />
              {' '}<strong>{m.label}</strong>
              <div style={{ color: 'var(--text-3)', fontSize: 12, marginLeft: 22 }}>{m.hint}</div>
            </label>
          ))}
        </div>

        {mode !== 'director_managed' && (
          <div style={{ marginTop: 12 }}>
            <label className="form-label" htmlFor="assignTo">Assign to *</label>
            <select id="assignTo" className="form-input" value={assignTo}
              onChange={(e) => setAssignTo(e.target.value)}>
              <option value="">— select team member —</option>
              {candidates.map((u) => (
                <option key={u._id} value={u._id}>
                  {u.name} — {u.role.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
            {!candidates.length && (
              <div className="offline-banner" style={{ marginTop: 8 }}>
                Nobody to assign to. An IS Head routes within their own team, so someone
                must report to you.
              </div>
            )}
          </div>
        )}

        <div style={{ marginTop: 12 }}>
          <label className="form-label" htmlFor="note">Note to the assignee</label>
          <input id="note" className="form-input" value={form.note} onChange={set('note')} />
        </div>
      </div>

      {error && <div className="offline-banner" style={{ borderColor: 'var(--coral)', marginTop: 12 }} role="alert">{error}</div>}

      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <button className="neo-btn" onClick={() => nav(-1)}>Cancel</button>
        <button className="neo-btn gold"
          disabled={save.isPending || !form.name.trim() || !form.phone.trim()
            || (mode !== 'director_managed' && !assignTo)}
          onClick={() => save.mutate()}>
          {save.isPending ? 'Saving…' : '💾 Save & assign'}
        </button>
      </div>
    </div>
  );
}

function Text({ id, label, value, onChange }: {
  id: string; label: string; value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <div>
      <label className="form-label" htmlFor={id}>{label}</label>
      <input id={id} className="form-input" value={value} onChange={onChange} />
    </div>
  );
}
