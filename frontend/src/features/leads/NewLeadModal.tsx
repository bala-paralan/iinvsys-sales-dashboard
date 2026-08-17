/**
 * New Lead — the entry point of the whole ERP.
 *
 * Every downstream record derives from a lead: the work order is created by
 * handoffService when the lead reaches Commercial Order, and the installation
 * from the signed delivery acknowledgement. Without this form the pipeline has
 * no mouth, which is exactly the state production shipped in.
 *
 * Field set mirrors `createValidation` in backend/src/routes/leads.js — name,
 * phone and source are the server's required three. Dropdowns come from the
 * pipeline payload via EnumSelect, never from a local array.
 */
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api, ApiError } from '../../api/client';
import { Modal } from '../../components/Modal';
import { EnumSelect } from '../../components/EnumSelect';

interface Props {
  onClose: () => void;
  onCreated: () => void;
}

/** Blank-string fields are dropped rather than sent: the model defaults them
    to '', and an empty string fails the enum validators on the optional ones. */
function compact(values: Record<string, string>): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values)) {
    if (v === '') continue;
    body[k] = k === 'value' ? Number(v) : v;
  }
  return body;
}

export function NewLeadModal({ onClose, onCreated }: Props) {
  const [values, setValues] = useState<Record<string, string>>({
    name: '', phone: '', source: '', company: '', email: '',
    city: '', state: '', companyType: '', value: '', notes: '',
  });
  const [error, setError] = useState<string | null>(null);

  const set = (k: string) => (v: string) => setValues((prev) => ({ ...prev, [k]: v }));

  const create = useMutation({
    mutationFn: () => api('POST', '/leads', compact(values)),
    onSuccess: () => { setError(null); onCreated(); },
    onError: (err) => setError(err instanceof ApiError ? err.message : String(err)),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    create.mutate();
  }

  const text = (key: string, label: string, opts: { required?: boolean; type?: string } = {}) => (
    <div>
      <label className="form-label" htmlFor={`nl-${key}`}>
        {label}{opts.required && <span style={{ color: 'var(--coral)' }}> *</span>}
      </label>
      <input
        id={`nl-${key}`}
        className="form-input"
        type={opts.type ?? 'text'}
        required={opts.required}
        min={opts.type === 'number' ? 0 : undefined}
        value={values[key]}
        onChange={(e) => set(key)(e.target.value)}
      />
    </div>
  );

  return (
    <Modal title="New Lead" onClose={onClose}>
      <form onSubmit={submit}>
        <div className="gate-title">New Lead</div>

        {error && <div className="offline-banner" style={{ marginTop: 10 }}>{error}</div>}

        <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
          {text('name', 'Contact name', { required: true })}
          {text('phone', 'Phone', { required: true })}

          <div>
            <label className="form-label" htmlFor="nl-source">
              Source<span style={{ color: 'var(--coral)' }}> *</span>
            </label>
            {/* Native `required` does not apply to the custom select, so the
                submit button carries the guard instead. */}
            <EnumSelect
              id="nl-source"
              enumName="leadSources"
              value={values.source}
              onChange={set('source')}
            />
          </div>

          {text('company', 'Company')}
          {text('email', 'Email', { type: 'email' })}

          <div>
            <label className="form-label" htmlFor="nl-companyType">Company type</label>
            <EnumSelect
              id="nl-companyType"
              enumName="companyTypes"
              value={values.companyType}
              onChange={set('companyType')}
            />
          </div>

          {text('city', 'City')}
          {text('state', 'State')}
          {text('value', 'Deal value (₹)', { type: 'number' })}

          <div>
            <label className="form-label" htmlFor="nl-notes">Notes</label>
            <textarea
              id="nl-notes"
              className="form-input"
              rows={3}
              value={values.notes}
              onChange={(e) => set('notes')(e.target.value)}
            />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          <button
            className="neo-btn gold"
            type="submit"
            disabled={create.isPending || !values.name.trim() || !values.phone.trim() || !values.source}
          >
            {create.isPending ? 'Creating…' : 'Create lead'}
          </button>
          <button className="neo-btn" type="button" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </Modal>
  );
}
