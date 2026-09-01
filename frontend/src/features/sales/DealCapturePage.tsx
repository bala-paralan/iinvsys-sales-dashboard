import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { salesApi } from './api';
import { api, ApiError } from '../../api/client';
import { usePipeline } from '../../meta/usePipeline';
import { useMe } from '../../portal/useMe';

/**
 * SA-DIR-04 (Director creates and assigns) and SA-EX-05 (an executive's own new deal).
 *
 * One form. An own-scoped executive never sees the assignee picker because the server
 * makes them the owner regardless — showing a control that cannot change the outcome is
 * worse than not showing it.
 *
 * Everything here goes through `salesEntryService.mintSalesLead()`, the same function the
 * Inside Sales handoff uses, so a deal created here and a deal handed over from IS are
 * the same shape rather than two near-identical records.
 */
export function DealCapturePage() {
  const nav = useNavigate();
  const { data: me } = useMe();
  const { data: meta } = usePipeline();

  const [form, setForm] = useState<Record<string, string>>({
    name: '', phone: '', email: '', company: '', jobTitle: '',
    city: '', state: '', source: 'referral', productPackage: '',
  });
  const [stage, setStage] = useState('suspect');
  const [assignTo, setAssignTo] = useState('');
  const [error, setError] = useState<string | null>(null);

  const canAssign = me?.scope.mode !== 'own';

  const { data: users = [] } = useQuery({
    queryKey: ['users', 'sales-assignable'],
    queryFn: async () => (await api<Array<{ _id: string; name: string; role: string; domain?: string }>>(
      'GET', '/users?limit=200')).data,
    enabled: canAssign && !!me?.permissions.includes('directory.read'),
  });

  const candidates = (users.length ? users : (me?.directReports ?? []))
    .filter((u) => ['sales_executive', 'sales_manager'].includes(u.role));

  const save = useMutation({
    mutationFn: () => salesApi.create({ ...form, stage, assignTo: canAssign ? assignTo : undefined }),
    onSuccess: (deal) => nav(`/${me?.portal?.key === 'director' ? 'director/sales' : me?.portal?.key}/deals/${deal._id}`),
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not create the deal'),
  });

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((s) => ({ ...s, [k]: e.target.value }));

  /* Only the open stages: a deal cannot be created already won or already lost. */
  const stages = (meta?.sales?.stages ?? []).filter((s: any) => !s.terminal);

  return (
    <div>
      <h1 className="page-title">New <em>deal</em></h1>
      <div className="page-sub">// ENTERS THE SPENCO PIPELINE IMMEDIATELY</div>

      <div className="card" style={{ padding: 16, marginTop: 16 }}>
        <h3 style={{ marginTop: 0 }}>Contact &amp; company</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
          <Text id="name" label="Contact name *" value={form.name} onChange={set('name')} />
          <Text id="jobTitle" label="Designation" value={form.jobTitle} onChange={set('jobTitle')} />
          <Text id="company" label="Company *" value={form.company} onChange={set('company')} />
          <Text id="phone" label="Mobile *" value={form.phone} onChange={set('phone')} />
          <Text id="email" label="Email" value={form.email} onChange={set('email')} />
          <Text id="city" label="City" value={form.city} onChange={set('city')} />
          <Text id="state" label="State" value={form.state} onChange={set('state')} />
          <Text id="productPackage" label="Product / package" value={form.productPackage} onChange={set('productPackage')} />
          <div>
            <label className="form-label" htmlFor="source">Source *</label>
            <select id="source" className="form-input" value={form.source} onChange={set('source')}>
              {(meta?.enums.leadSources ?? []).map((s: any) => (
                <option key={s.key} value={s.key}>{s.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="form-label" htmlFor="stage">Starting SPENCO stage</label>
            <select id="stage" className="form-input" value={stage} onChange={(e) => setStage(e.target.value)}>
              {stages.map((s: any) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </div>
        </div>

        {canAssign && (
          <div style={{ marginTop: 12 }}>
            <label className="form-label" htmlFor="assignTo">Assign to *</label>
            <select id="assignTo" className="form-input" value={assignTo}
              onChange={(e) => setAssignTo(e.target.value)}>
              <option value="">— select team member —</option>
              {candidates.map((u) => (
                <option key={u._id} value={u._id}>
                  {u.name} — {u.role.replace(/_/g, ' ')}
                  {u.domain && u.domain !== 'none' ? ` (${u.domain.replace(/_/g, ' ')})` : ''}
                </option>
              ))}
            </select>
          </div>
        )}

        <p style={{ color: 'var(--text-3)', fontSize: 12 }}>
          A later stage still has to satisfy its own gate to move on — creating a deal at
          Engagement does not skip the SPENCO score that Engagement requires.
        </p>
      </div>

      {error && <div className="offline-banner" style={{ borderColor: 'var(--coral)', marginTop: 12 }} role="alert">{error}</div>}

      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <button className="neo-btn" onClick={() => nav(-1)}>Cancel</button>
        <button className="neo-btn gold"
          disabled={save.isPending || !form.name.trim() || !form.phone.trim()
            || (canAssign && !assignTo)}
          onClick={() => save.mutate()}>
          {save.isPending ? 'Saving…' : '💾 Create deal'}
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
