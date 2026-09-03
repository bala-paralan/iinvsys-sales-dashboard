import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { salesApi } from './api';
import { isApi } from '../insideSales/api';
import { api, ApiError } from '../../api/client';
import { usePipeline } from '../../meta/usePipeline';
import { useMe } from '../../portal/useMe';

/**
 * SA-DIR-04 "Director Lead / Deal Creation & Assignment" and SA-EX-05 "New Deal / Lead
 * Capture Form".
 *
 * ONE form, three destinations — doc 2 draws the choice as the first question on the
 * screen, because it is one decision made once:
 *
 *   Lead → IS queue          an IS Executive qualifies it through BANT first
 *   Hot lead → Sales Exec    already warm; Inside Sales is bypassed and SPENCO starts
 *   Deal → SPENCO direct     a fully-formed deal created at any open stage
 *
 * The first two are exactly doc 1 IS-DIR-03's `is_executive` and `bypass_is` modes, so
 * they post to that endpoint rather than growing a second one — the bypass has to create
 * BOTH records for the origin to stay visible in Customer 360, and that logic already
 * exists and is tested.
 *
 * An own-scoped executive sees neither the intake choice nor the assignee picker: the
 * server makes them the owner regardless, and a control that cannot change the outcome
 * is worse than no control.
 */
const INTAKE = [
  { key: 'deal', label: 'Deal → SPENCO direct',
    hint: 'A fully-formed deal, created at whichever SPENCO stage it has already reached.' },
  { key: 'hot', label: 'Hot lead → Sales Executive',
    hint: 'Bypasses Inside Sales — enters SPENCO at Suspect immediately.' },
  { key: 'lead', label: 'Lead → Inside Sales queue',
    hint: 'Goes to an IS Executive for BANT qualification before it reaches Sales.' },
];

const PRIORITIES = [
  { key: 'hot', label: '🔥 Hot — first contact within 4 hours' },
  { key: 'high', label: '⚡ High — first contact within 24h' },
  { key: 'normal', label: 'Normal — route to queue' },
];

export function DealCapturePage() {
  const nav = useNavigate();
  const { data: me } = useMe();
  const { data: meta } = usePipeline();

  const [form, setForm] = useState<Record<string, string>>({
    name: '', phone: '', email: '', company: '', jobTitle: '',
    city: '', state: '', source: 'referral', productPackage: '',
    domain: '', value: '', priority: 'normal', targetFirstContactAt: '',
    notes: '', assigneeNote: '',
  });
  const [intake, setIntake] = useState('deal');
  const [stage, setStage] = useState('suspect');
  const [assignTo, setAssignTo] = useState('');
  const [error, setError] = useState<string | null>(null);

  const canAssign = me?.scope.mode !== 'own';
  /* Doc 2 SA-DIR-04's three-way choice is the Director's screen. Routing into Inside
     Sales or past it is `lead.gate_override`, the same permission IS-DIR-03 gates on. */
  const canRoute = canAssign && !!me?.permissions.includes('lead.gate_override');

  const { data: users = [] } = useQuery({
    queryKey: ['users', 'sales-assignable'],
    queryFn: async () => (await api<Array<{ _id: string; name: string; role: string; domain?: string }>>(
      'GET', '/users?limit=200')).data,
    enabled: canAssign && !!me?.permissions.includes('directory.read'),
  });

  /* Who may receive it depends on where it is going — an Inside Sales lead cannot be
     assigned to a Sales Executive, and the server rejects it either way. */
  const wanted = intake === 'lead'
    ? ['is_executive', 'is_head']
    : ['sales_executive', 'sales_manager'];
  const candidates = (users.length ? users : (me?.directReports ?? []))
    .filter((u) => wanted.includes(u.role));

  const save = useMutation({
    mutationFn: async () => {
      const shared = {
        name: form.name, phone: form.phone, email: form.email, company: form.company,
        jobTitle: form.jobTitle, city: form.city, state: form.state,
        source: form.source, domain: form.domain || undefined,
        priority: form.priority,
        targetFirstContactAt: form.targetFirstContactAt || undefined,
        notes: form.notes,
      };
      if (intake === 'deal') {
        const deal = await salesApi.create({
          ...shared,
          productPackage: form.productPackage,
          value: form.value ? Number(form.value) : undefined,
          stage,
          assignTo: canAssign ? assignTo : undefined,
          assigneeNote: form.assigneeNote,
        });
        return { id: deal._id, sales: true };
      }
      const r = await isApi.create({
        ...shared,
        note: form.assigneeNote,
        assignmentMode: intake === 'hot' ? 'bypass_is' : 'is_executive',
        spencoStage: 'suspect',
        assignTo,
      });
      /* The bypass returns both records. Land on the SPENCO deal when there is one —
         that is the record the assignee will work. */
      return { id: (r.salesLead?._id ?? r.lead._id) as string, sales: !!r.salesLead };
    },
    onSuccess: ({ id, sales }) => {
      const portal = me?.portal?.key === 'director' ? 'director' : me?.portal?.key;
      if (sales) {
        nav(`/${portal === 'director' ? 'director/sales' : portal}/deals/${id}`);
      } else {
        nav(`/${portal === 'director' ? 'director/inside-sales' : portal}/leads/${id}`);
      }
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not create the record'),
  });

  const set = (k: string) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>,
  ) => setForm((s) => ({ ...s, [k]: e.target.value }));

  /* Only the open stages: a deal cannot be created already won or already lost. */
  const stages = (meta?.sales?.stages ?? []).filter((s: any) => !s.terminal);
  const domains: Array<{ key: string; label: string }> =
    (meta as any)?.enums?.domains?.filter((d: any) => d.key !== 'none') ?? [];

  const title = intake === 'lead' ? 'lead' : 'deal';

  return (
    <div>
      <h1 className="page-title">New <em>{title}</em></h1>
      <div className="page-sub">
        // {intake === 'deal' ? 'ENTERS THE SPENCO PIPELINE IMMEDIATELY'
          : intake === 'hot' ? 'BYPASSES INSIDE SALES — SPENCO FROM SUSPECT'
            : 'GOES TO INSIDE SALES FOR QUALIFICATION FIRST'}
      </div>

      {canRoute && (
        <div className="card" style={{ padding: 16, marginTop: 16 }}>
          <h3 style={{ marginTop: 0 }}>What are you creating?</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 10 }}>
            {INTAKE.map((o) => (
              <button key={o.key} type="button" className="neo-btn"
                aria-pressed={intake === o.key}
                style={{
                  textAlign: 'left', padding: 12, height: 'auto', whiteSpace: 'normal',
                  ...(intake === o.key ? { borderColor: 'var(--gold)', color: 'var(--gold)' } : {}),
                }}
                onClick={() => { setIntake(o.key); setAssignTo(''); }}>
                <strong>{o.label}</strong>
                <div style={{ color: 'var(--text-3)', fontSize: 12, marginTop: 4 }}>{o.hint}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="card" style={{ padding: 16, marginTop: 16 }}>
        <h3 style={{ marginTop: 0 }}>Contact &amp; company</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
          <Text id="name" label="Contact name *" value={form.name} onChange={set('name')} />
          <Text id="jobTitle" label="Designation" value={form.jobTitle} onChange={set('jobTitle')} />
          <Text id="company" label="Company *" value={form.company} onChange={set('company')} />
          <Text id="phone" label="Mobile *" value={form.phone} onChange={set('phone')} />
          <Text id="email" label="Email" value={form.email} onChange={set('email')} />
          <Text id="city" label="City / location" value={form.city} onChange={set('city')} />
          <Text id="state" label="State" value={form.state} onChange={set('state')} />
          <Text id="productPackage" label="Product / package"
            value={form.productPackage} onChange={set('productPackage')} />
          <div>
            {/* SA-DIR-04 "Domain *" — the axis the whole sales org is arranged along.
                Kept separate from industry segment: see config/pipeline.js. */}
            <label className="form-label" htmlFor="domain">Domain</label>
            <select id="domain" className="form-input" value={form.domain} onChange={set('domain')}>
              <option value="">— select —</option>
              {domains.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
            </select>
          </div>
          <div>
            <label className="form-label" htmlFor="source">Source *</label>
            <select id="source" className="form-input" value={form.source} onChange={set('source')}>
              {(meta?.enums.leadSources ?? []).map((s: any) => (
                <option key={s.key} value={s.key}>{s.label}</option>
              ))}
            </select>
          </div>
          {intake === 'deal' && (
            <>
              <div>
                <label className="form-label" htmlFor="value">Est. opportunity size (₹)</label>
                <input id="value" className="form-input" type="number" min={0}
                  value={form.value} onChange={set('value')} />
              </div>
              <div>
                <label className="form-label" htmlFor="stage">SPENCO stage</label>
                <select id="stage" className="form-input" value={stage}
                  onChange={(e) => setStage(e.target.value)}>
                  {stages.map((s: any) => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
              </div>
            </>
          )}
        </div>

        <div style={{ marginTop: 12 }}>
          <label className="form-label" htmlFor="notes">
            {canRoute ? 'Director intelligence / context' : 'Context'}
          </label>
          <textarea id="notes" className="form-input" rows={3}
            placeholder="Where this came from, what was said, what makes it worth working."
            value={form.notes} onChange={set('notes')} />
        </div>

        {intake === 'deal' && (
          <p style={{ color: 'var(--text-3)', fontSize: 12, marginBottom: 0 }}>
            A later stage still has to satisfy its own gate to move on — creating a deal at
            Engagement does not skip the SPENCO score that Engagement requires.
          </p>
        )}
      </div>

      {canAssign && (
        <div className="card" style={{ padding: 16, marginTop: 16 }}>
          <h3 style={{ marginTop: 0 }}>🎯 Assign to</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
            <div>
              <label className="form-label" htmlFor="assignTo">Team member *</label>
              <select id="assignTo" className="form-input" value={assignTo}
                onChange={(e) => setAssignTo(e.target.value)}>
                <option value="">— select person —</option>
                {candidates.map((u) => (
                  <option key={u._id} value={u._id}>
                    {u.name} — {u.role.replace(/_/g, ' ')}
                    {u.domain && u.domain !== 'none' ? ` (${u.domain.replace(/_/g, ' ')})` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="form-label" htmlFor="priority">Priority</label>
              <select id="priority" className="form-input" value={form.priority} onChange={set('priority')}>
                {PRIORITIES.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
              </select>
            </div>
            <div>
              <label className="form-label" htmlFor="tfc">Target first contact date</label>
              <input id="tfc" className="form-input" type="date"
                value={form.targetFirstContactAt} onChange={set('targetFirstContactAt')} />
            </div>
          </div>
          <div style={{ marginTop: 10 }}>
            <label className="form-label" htmlFor="assigneeNote">
              Private note to the assignee
              <span style={{ color: 'var(--text-3)' }}> — sent with their notification</span>
            </label>
            <textarea id="assigneeNote" className="form-input" rows={2}
              value={form.assigneeNote} onChange={set('assigneeNote')} />
          </div>
          {!candidates.length && (
            <p className="page-sub" style={{ marginBottom: 0 }}>
              // NOBODY AVAILABLE FOR THAT DESTINATION — CHECK ROLES IN ADMIN
            </p>
          )}
        </div>
      )}

      {error && <div className="offline-banner" style={{ borderColor: 'var(--coral)', marginTop: 12 }} role="alert">{error}</div>}

      <div className="card" style={{ padding: 16, marginTop: 16, color: 'var(--text-3)', fontSize: 12 }}>
        After saving: the reference is generated automatically · the assignee is notified
        with your note · the account's activity log is started with this context
        {intake === 'deal' ? ' · the deal appears on their SPENCO board immediately' : ''}
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <button className="neo-btn" onClick={() => nav(-1)}>Cancel</button>
        <button className="neo-btn gold"
          disabled={save.isPending || !form.name.trim() || !form.phone.trim()
            || !form.company.trim() || (canAssign && !assignTo)}
          onClick={() => save.mutate()}>
          {save.isPending ? 'Saving…' : `💾 Save${canAssign ? ' & assign' : ''}`}
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
