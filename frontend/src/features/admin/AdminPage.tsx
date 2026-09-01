/**
 * Admin — agents, products and expos.
 *
 * One page with three tables rather than three routes, because these are all
 * small reference lists that the same person maintains in one sitting.
 *
 * Each table is driven by a column spec so add/edit share one form and one
 * validation path. The legacy app had a separate 200-line modal per entity in
 * index.html, which is why its Products modal validated price and its Expos
 * modal did not.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../api/client';
import { useMe } from '../../portal/useMe';
import { Modal } from '../../components/Modal';

type FieldType = 'text' | 'number' | 'date' | 'email' | 'select';

interface Field {
  key: string;
  label: string;
  type?: FieldType;
  required?: boolean;
  /** Shown in the table; a field can be editable but not listed, and vice versa. */
  inTable?: boolean;
  format?: (v: unknown, row: Row) => string;
  /** type: 'select' only — the permitted values. */
  options?: Array<{ value: string; label: string }>;
}

interface Row { _id: string; [k: string]: unknown }

interface EntitySpec {
  key: string;
  title: string;
  path: string;
  fields: Field[];
  /** Roles below this see the table but no add/edit controls. */
  writeRole: 'manager' | 'superadmin';
}

const money = (v: unknown) => (v == null || v === '' ? '—' : `₹${Number(v).toLocaleString('en-IN')}`);
const day = (v: unknown) => (v ? new Date(String(v)).toLocaleDateString('en-IN') : '—');

const ENTITIES: EntitySpec[] = [
  {
    key: 'agents', title: 'Agents', path: '/agents', writeRole: 'manager',
    fields: [
      { key: 'name', label: 'Name', required: true, inTable: true },
      { key: 'initials', label: 'Initials', required: true, inTable: true },
      { key: 'email', label: 'Email', type: 'email', required: true, inTable: true },
      { key: 'phone', label: 'Phone', required: true, inTable: true },
      { key: 'territory', label: 'Territory', inTable: true },
      { key: 'designation', label: 'Designation' },
      { key: 'target', label: 'Monthly target (₹)', type: 'number', inTable: true, format: money },
    ],
  },
  {
    key: 'products', title: 'Products', path: '/products', writeRole: 'superadmin',
    fields: [
      { key: 'name', label: 'Name', required: true, inTable: true },
      { key: 'sku', label: 'SKU', required: true, inTable: true },
      /* Server-side enum (backend/src/routes/products.js, and required on
         create) — a free-text box here made every save a 422 the user could
         not see. FOLLOW-UP: this list belongs in the /meta/pipeline payload
         like every other enum; it is duplicated here only to avoid a backend
         redeploy. */
      {
        key: 'category', label: 'Category', type: 'select', required: true, inTable: true,
        options: [
          { value: 'hardware', label: 'Hardware' },
          { value: 'software', label: 'Software' },
          { value: 'service', label: 'Service' },
          { value: 'bundle', label: 'Bundle' },
        ],
      },
      { key: 'price', label: 'Price (₹)', type: 'number', required: true, inTable: true, format: money },
      { key: 'description', label: 'Description' },
    ],
  },
  {
    key: 'expos', title: 'Expos', path: '/expos', writeRole: 'manager',
    fields: [
      { key: 'name', label: 'Name', required: true, inTable: true },
      { key: 'venue', label: 'Venue', inTable: true },
      { key: 'city', label: 'City', inTable: true },
      { key: 'startDate', label: 'Starts', type: 'date', required: true, inTable: true, format: day },
      { key: 'endDate', label: 'Ends', type: 'date', required: true, inTable: true, format: day },
    ],
  },
];

const ROLE_RANK: Record<string, number> = { superadmin: 3, manager: 2, agent: 1 };

export function AdminPage() {
  const { data: me } = useMe();
  const [active, setActive] = useState(ENTITIES[0].key);
  const spec = ENTITIES.find((e) => e.key === active)!;
  const role = me?.role ?? '';
  const canWrite = (ROLE_RANK[role] ?? 0) >= ROLE_RANK[spec.writeRole];

  return (
    <>
      <h1 className="page-title">Admin</h1>
      <div className="page-sub">// REFERENCE DATA</div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {ENTITIES.map((e) => (
          <button
            key={e.key}
            className={`neo-btn${active === e.key ? ' gold' : ''}`}
            onClick={() => setActive(e.key)}
          >
            {e.title}
          </button>
        ))}
      </div>

      <EntityTable key={spec.key} spec={spec} canWrite={canWrite} />
    </>
  );
}

function EntityTable({ spec, canWrite }: { spec: EntitySpec; canWrite: boolean }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Row | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ['admin', spec.key],
    queryFn: async () => (await api<Row[]>('GET', `${spec.path}?limit=200`)).data,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['admin', spec.key] });

  const save = useMutation({
    mutationFn: ({ id, body }: { id: string | null; body: Record<string, unknown> }) =>
      (id ? api('PUT', `${spec.path}/${id}`, body) : api('POST', spec.path, body)),
    onSuccess: () => { setEditing(null); setError(null); void invalidate(); },
    onError: (err) => setError(err instanceof ApiError ? err.message : String(err)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api('DELETE', `${spec.path}/${id}`),
    onSuccess: () => { setError(null); void invalidate(); },
    onError: (err) => setError(err instanceof ApiError ? err.message : String(err)),
  });

  const columns = spec.fields.filter((f) => f.inTable);
  const rows = list.data ?? [];

  return (
    <section>
      {error && <div className="offline-banner">{error}</div>}
      {list.isError && (
        <div className="offline-banner">
          Could not load {spec.title.toLowerCase()}: {String((list.error as Error).message)}
        </div>
      )}

      {canWrite && (
        <button className="neo-btn gold" style={{ marginBottom: 12 }} onClick={() => setEditing('new')}>
          + New {spec.title.replace(/s$/, '')}
        </button>
      )}

      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  className="table-th"
                  style={{ textAlign: 'left', padding: '10px 12px', margin: 0, whiteSpace: 'nowrap' }}
                >
                  {c.label}
                </th>
              ))}
              {canWrite && <th style={{ width: 140 }} />}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row._id} style={{ borderTop: '1px solid var(--surface-3)' }}>
                {columns.map((c) => (
                  <td key={c.key} style={{ padding: '9px 12px' }}>
                    {c.format ? c.format(row[c.key], row) : (row[c.key] == null || row[c.key] === '' ? '—' : String(row[c.key]))}
                  </td>
                ))}
                {canWrite && (
                  <td style={{ padding: '6px 12px', whiteSpace: 'nowrap' }}>
                    <button
                      className="neo-btn" style={{ padding: '3px 9px', fontSize: 11 }}
                      onClick={() => { setEditing(row); setError(null); }}
                    >
                      Edit
                    </button>{' '}
                    <button
                      className="neo-btn" style={{ padding: '3px 9px', fontSize: 11 }}
                      onClick={() => {
                        /* A delete here is not recoverable from this screen, so
                           it asks — and names what it is about to remove. */
                        if (window.confirm(`Delete "${String(row.name ?? row._id)}"?`)) remove.mutate(row._id);
                      }}
                    >
                      Delete
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {!list.isLoading && rows.length === 0 && (
              <tr>
                <td colSpan={columns.length + 1} style={{ padding: 16, color: 'var(--text-3)' }}>
                  No {spec.title.toLowerCase()} yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <EntityForm
          spec={spec}
          row={editing === 'new' ? null : editing}
          pending={save.isPending}
          /* The save error has to render INSIDE the dialog: the banner at the
             top of this section sits behind the modal overlay, so a rejected
             save looked like a dead Save button. */
          error={error}
          onCancel={() => { setEditing(null); setError(null); }}
          onSubmit={(body) => save.mutate({ id: editing === 'new' ? null : editing._id, body })}
        />
      )}
    </section>
  );
}

function EntityForm({
  spec, row, pending, error, onCancel, onSubmit,
}: {
  spec: EntitySpec;
  row: Row | null;
  pending: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (body: Record<string, unknown>) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(spec.fields.map((f) => {
      const v = row ? row[f.key] : '';
      /* A date input needs YYYY-MM-DD; the API returns a full ISO string. */
      if (f.type === 'date' && v) return [f.key, String(v).slice(0, 10)];
      return [f.key, v == null ? '' : String(v)];
    })));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const body: Record<string, unknown> = {};
    for (const f of spec.fields) {
      const raw = values[f.key];
      if (raw === '' && !f.required) continue;      // don't send blanks
      body[f.key] = f.type === 'number' ? Number(raw) : raw;
    }
    onSubmit(body);
  }

  return (
    <Modal title={`${row ? 'Edit' : 'New'} ${spec.title.replace(/s$/, '')}`} onClose={onCancel}>
      <form onSubmit={submit}>
        <div className="gate-title">{row ? 'Edit' : 'New'} {spec.title.replace(/s$/, '')}</div>

        {error && (
          <div className="offline-banner" style={{ borderColor: 'var(--coral)', marginTop: 10 }}>
            {error}
          </div>
        )}

        <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
          {spec.fields.map((f) => (
            <div key={f.key}>
              <label className="form-label" htmlFor={`f-${f.key}`}>
                {f.label}{f.required && <span style={{ color: 'var(--coral)' }}> *</span>}
              </label>
              {f.type === 'select' ? (
                <select
                  id={`f-${f.key}`}
                  className="form-input"
                  required={f.required}
                  value={values[f.key] ?? ''}
                  onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                >
                  <option value="">— Select —</option>
                  {(f.options ?? []).map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              ) : (
                <input
                  id={`f-${f.key}`}
                  className="form-input"
                  type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : f.type === 'email' ? 'email' : 'text'}
                  required={f.required}
                  value={values[f.key] ?? ''}
                  onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                />
              )}
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          <button className="neo-btn gold" type="submit" disabled={pending}>
            {pending ? 'Saving…' : 'Save'}
          </button>
          <button className="neo-btn" type="button" onClick={onCancel}>Cancel</button>
        </div>
      </form>
    </Modal>
  );
}
