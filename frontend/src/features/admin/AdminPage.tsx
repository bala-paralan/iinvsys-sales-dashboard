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
import { usePipeline } from '../../meta/usePipeline';
import { useRoles, type RoleDef } from '../../meta/roles';
import { Modal } from '../../components/Modal';

type FieldType = 'text' | 'number' | 'date' | 'email' | 'select' | 'password';

type Option = { value: string; label: string };

/**
 * What a dynamic field can see: the server's enums, the roster (for "reports to"), and
 * the other values on the form (a "reports to" list depends on the role chosen).
 */
interface OptionCtx {
  roles: ReturnType<typeof useRoles>;
  meta: any;
  users: Row[];
  values: Record<string, string>;
  /** The caller may only place people inside their own team (scope !== 'all'). */
  teamOnly: boolean;
}

interface Field {
  key: string;
  label: string;
  type?: FieldType;
  required?: boolean;
  /** Shown in the table; a field can be editable but not listed, and vice versa. */
  inTable?: boolean;
  format?: (v: unknown, row: Row, ctx: OptionCtx) => string;
  /** type: 'select' only — the permitted values, fixed or derived from the context. */
  options?: Option[] | ((ctx: OptionCtx) => Option[]);
  /**
   * Sent through its own endpoint rather than the PUT body. `reportsTo` is the one:
   * PUT /api/users/:id strips it so subtree repair can never be skipped, and the move
   * goes through PATCH /:id/manager instead.
   */
  separateOnEdit?: string;
  /**
   * Shown when adding, hidden when editing. `password` is the only one: PUT
   * /api/users/:id strips the field (see userController.updateUser — reassignment
   * goes through PATCH /:id/manager so subtree repair cannot be skipped), so an
   * admin who typed a new password into the edit form would be told "saved" and
   * change nothing. A field that silently does nothing is worse than no field.
   */
  createOnly?: boolean;
  /** Rendered under the input, for a rule the input cannot express on its own. */
  help?: string;
  /** Required only in some contexts — a manager must place a new person in their team. */
  requiredWhen?: (ctx: OptionCtx) => boolean;
}

interface Row { _id: string; [k: string]: unknown }

interface EntitySpec {
  key: string;
  title: string;
  path: string;
  fields: Field[];
}

const money = (v: unknown) => (v == null || v === '' ? '—' : `₹${Number(v).toLocaleString('en-IN')}`);
const day = (v: unknown) => (v ? new Date(String(v)).toLocaleDateString('en-IN') : '—');

const ENTITIES: EntitySpec[] = [
  {
    key: 'agents', title: 'Agents', path: '/agents',
    fields: [
      { key: 'name', label: 'Name', required: true, inTable: true },
      /*
       * Role sits where "Initials" used to. Initials are derived from the name by the
       * server (User.pre('validate')), so typing them bought nothing — while the form
       * had NO role field, so every person it created became a Sales Executive by the
       * model default. That is how a Sales Director arrived on production as an SE.
       * Options are the server's taxonomy, rendered as the brief writes them:
       * "SD - Sales Director".
       */
      { key: 'role', label: 'Role', type: 'select', required: true, inTable: true,
        options: ({ roles }) => roles.roles.map((r: RoleDef) => ({
          value: r.key, label: r.abbr ? `${r.abbr} - ${r.label}` : r.label,
        })),
        format: (v, _row, ctx) => {
          const r = ctx.roles.get(String(v ?? ''));
          return r ? (r.abbr ? `${r.abbr} - ${r.label}` : r.label) : String(v ?? '—');
        } },
      /*
       * The reporting line is what every scoped screen and every transfer rule reads.
       * The list is narrowed to the roles the chart allows above the chosen role
       * (REPORTS_TO_ROLES on the server), so the form cannot offer a manager the API
       * would refuse. Empty until a role is picked.
       */
      { key: 'reportsTo', label: 'Reports to', type: 'select', inTable: true,
        separateOnEdit: 'manager',
        options: ({ roles, users, values }) => {
          const def = roles.get(values.role);
          const allowed = def?.reportsTo?.filter((k): k is string => !!k) ?? null;
          return users
            .filter((u) => u.isActive !== false && (!allowed || allowed.includes(String(u.role))))
            .map((u) => ({ value: u._id, label: `${String(u.name)} · ${roles.abbr(String(u.role))}` }));
        },
        format: (v, _row, ctx) => {
          const id = typeof v === 'object' && v ? String((v as any)._id ?? (v as any).id ?? '') : String(v ?? '');
          const m = ctx.users.find((u) => u._id === id);
          return m ? String(m.name) : '—';
        },
        requiredWhen: (ctx) => ctx.teamOnly,
        help: 'SD → ISM → ISE, and SD → ZSM → ASM → SE. Leave blank to place them later.' },
      { key: 'zone', label: 'Zone', type: 'select', inTable: true,
        options: ({ meta }) => (meta?.enums?.zones ?? []).map((z: any) => ({ value: z.key, label: z.label })) },
      { key: 'domain', label: 'Domain', type: 'select',
        options: ({ meta }) => (meta?.enums?.domains ?? [])
          .filter((d: any) => d.key !== 'none')
          .map((d: any) => ({ value: d.key, label: d.label })) },
      { key: 'email', label: 'Email', type: 'email', required: true, inTable: true },
      /* Not required: the server does not require it, and insisting here made every
         person created without one (seed, import, invite) impossible to edit — the
         browser refused the submit before a request was ever sent. */
      { key: 'phone', label: 'Phone', inTable: true },
      { key: 'territory', label: 'Territory', inTable: true },
      { key: 'designation', label: 'Designation' },
      { key: 'target', label: 'Monthly target (₹)', type: 'number', inTable: true, format: money },
      /*
       * Required, though POST /api/users treats it as optional. Omitting it there mints
       * a random password that is immediately discarded, so the account lands in the org
       * chart and nobody — including the admin who created it — can ever sign into it.
       * That is only sound once invites are wired for ordinary users, and today
       * Invite.mint() is reachable from the expo referrer flow alone. Until then the
       * form insists, so that creating a person produces a person who can log in.
       */
      { key: 'password', label: 'Initial password', type: 'password', required: true,
        createOnly: true,
        help: 'At least 8 characters. Share it with them directly and have them change it '
            + 'under Account → Password on first sign-in.' },
    ],
  },
  {
    key: 'products', title: 'Products', path: '/products',
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
    key: 'expos', title: 'Expos', path: '/expos',
    fields: [
      { key: 'name', label: 'Name', required: true, inTable: true },
      { key: 'venue', label: 'Venue', inTable: true },
      { key: 'city', label: 'City', inTable: true },
      { key: 'startDate', label: 'Starts', type: 'date', required: true, inTable: true, format: day },
      { key: 'endDate', label: 'Ends', type: 'date', required: true, inTable: true, format: day },
    ],
  },
];

/*
 * Write access is the permission the SERVER gates the route on, not a role rank.
 *
 * This used to be `ROLE_RANK = {superadmin:3, manager:2, agent:1}` — the v2 ladder,
 * still standing here after the backend deleted it in Phase 0. `manager` and `agent`
 * are not roles any more, so every V3 role scored `?? 0` and lost the add/edit
 * controls; only superadmin still cleared the bar, by accident rather than by rule.
 * Ranking incomparable roles is what the ladder's removal was about, and the client
 * had quietly kept a copy.
 */
const WRITE_PERMISSION: Record<string, string> = {
  agents: 'user.write',
  products: 'catalog.write',
  expos: 'expo.manage',
};

export function AdminPage() {
  const { data: me } = useMe();
  const perms = me?.permissions ?? [];
  /*
   * A tab appears only when the caller can WRITE it. This screen is where things are
   * maintained; a read-only copy of the product catalogue does nothing for an Area
   * Sales Manager who came here to add an executive. The superadmin sees all three,
   * the Director sees Agents and Expos, a manager sees Agents alone — and the server
   * scopes that one to their own team (SPENCO CRM brief §3).
   */
  const tabs = ENTITIES.filter((e) => perms.includes(WRITE_PERMISSION[e.key] ?? '\u0000'));
  const [active, setActive] = useState(ENTITIES[0].key);
  const spec = tabs.find((e) => e.key === active) ?? tabs[0];
  const teamOnly = !!me && me.scope.mode !== 'all';

  if (!spec) {
    return (
      <>
        <h1 className="page-title">People</h1>
        <div className="page-sub">// NOTHING HERE IS YOURS TO EDIT</div>
      </>
    );
  }

  return (
    <>
      <h1 className="page-title">{tabs.length > 1 ? 'Admin' : 'People'}</h1>
      <div className="page-sub">
        // {teamOnly ? 'YOUR TEAM — PEOPLE YOU MAY ADD, EDIT AND MOVE' : 'REFERENCE DATA'}
      </div>

      {tabs.length > 1 && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          {tabs.map((e) => (
            <button
              key={e.key}
              className={`neo-btn${spec.key === e.key ? ' gold' : ''}`}
              onClick={() => setActive(e.key)}
            >
              {e.title}
            </button>
          ))}
        </div>
      )}

      <EntityTable key={spec.key} spec={spec} canWrite teamOnly={teamOnly} />
    </>
  );
}

function EntityTable({ spec, canWrite, teamOnly }: { spec: EntitySpec; canWrite: boolean; teamOnly: boolean }) {
  const queryClient = useQueryClient();
  const { data: me } = useMe();
  const [editing, setEditing] = useState<Row | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ['admin', spec.key],
    /* A manager's staff list is their subtree — the people the server will let them
       touch. Asking for everyone would show rows whose Edit button 403s. */
    queryFn: async () => (await api<Row[]>('GET', `${spec.path}?limit=200${teamOnly && spec.key === 'agents' ? '&team=1' : ''}`)).data,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['admin', spec.key] });

  const roles = useRoles();
  const { data: meta } = usePipeline();
  const all = list.data ?? [];
  /* A manager's own record is in the team list so "reports to me" can be offered — but
     it is not theirs to edit here (the server refuses), so it is not a row. */
  const rows = teamOnly ? all.filter((r) => r._id !== me?.userId) : all;
  /* Only the agents table needs the roster for "reports to"; it IS the roster. */
  const ctx: OptionCtx = { roles, meta, users: spec.key === 'agents' ? all : [], values: {}, teamOnly };

  const save = useMutation({
    mutationFn: async ({ id, body }: { id: string | null; body: Record<string, unknown> }) => {
      if (!id) return api('POST', spec.path, body);
      /* Fields the PUT would silently drop go through their own endpoint, after the
         PUT, so a refused manager (wrong role for the chart) surfaces as the error. */
      const separate = spec.fields.filter((f) => f.separateOnEdit && f.key in body);
      const rest = { ...body };
      for (const f of separate) delete rest[f.key];
      const res = await api('PUT', `${spec.path}/${id}`, rest);
      for (const f of separate) {
        await api('PATCH', `${spec.path}/${id}/${f.separateOnEdit}`, { [f.key]: body[f.key] || null });
      }
      return res;
    },
    onSuccess: () => { setEditing(null); setError(null); void invalidate(); },
    onError: (err) => setError(err instanceof ApiError ? err.message : String(err)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api('DELETE', `${spec.path}/${id}`),
    onSuccess: () => { setError(null); void invalidate(); },
    onError: (err) => setError(err instanceof ApiError ? err.message : String(err)),
  });

  const columns = spec.fields.filter((f) => f.inTable);

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
                    {c.format ? c.format(row[c.key], row, ctx) : (row[c.key] == null || row[c.key] === '' ? '—' : String(row[c.key]))}
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
          ctx={ctx}
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
  spec, ctx, row, pending, error, onCancel, onSubmit,
}: {
  spec: EntitySpec;
  ctx: OptionCtx;
  row: Row | null;
  pending: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (body: Record<string, unknown>) => void;
}) {
  /* Editing shows every field the server will actually accept, and no others. */
  const fields = spec.fields.filter((f) => !(row && f.createOnly));

  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => {
      /* A secret is never seeded into the form, even on a create where `row` is
         null and `row[f.key]` could not have produced one anyway. Stated as a rule
         so that adding a second create-only secret later cannot get it wrong. */
      const v = row && f.type !== 'password' ? row[f.key] : '';
      /* A date input needs YYYY-MM-DD; the API returns a full ISO string. */
      if (f.type === 'date' && v) return [f.key, String(v).slice(0, 10)];
      /* A reference may come back populated ({_id, name}) or as a bare id. */
      if (v && typeof v === 'object') return [f.key, String((v as any)._id ?? (v as any).id ?? '')];
      return [f.key, v == null ? '' : String(v)];
    })));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const body: Record<string, unknown> = {};
    for (const f of fields) {
      const raw = values[f.key];
      /* Blanks are not sent — except a cleared reporting line on edit, which is a
         real instruction ("unplace them") rather than an untouched box. */
      if (raw === '' && !f.required && !(row && f.separateOnEdit)) continue;
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

        {/* Say why the password box vanished, rather than letting an admin hunt for it. */}
        {row && spec.fields.some((f) => f.type === 'password') && (
          <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text-3)' }}>
            // PASSWORDS ARE NOT CHANGED HERE — the account holder sets their own under
            Account → Password
          </div>
        )}

        <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
          {fields.map((f) => { const required = !!f.required || !!f.requiredWhen?.(ctx); return (
            <div key={f.key}>
              <label className="form-label" htmlFor={`f-${f.key}`}>
                {f.label}{required && <span style={{ color: 'var(--coral)' }}> *</span>}
              </label>
              {f.type === 'select' ? (
                <select
                  id={`f-${f.key}`}
                  className="form-input"
                  required={required}
                  value={values[f.key] ?? ''}
                  onChange={(e) => setValues((v) => ({
                    ...v, [f.key]: e.target.value,
                    /* A new role changes who may sit above it; a stale manager pick
                       would be refused by the server, so drop it rather than send it. */
                    ...(f.key === 'role' && 'reportsTo' in v ? { reportsTo: '' } : {}),
                  }))}
                >
                  <option value="">— Select —</option>
                  {(typeof f.options === 'function'
                    ? f.options({ ...ctx, values, users: ctx.users.filter((u) => u._id !== row?._id) })
                    : f.options ?? []
                  ).map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              ) : (
                <input
                  id={`f-${f.key}`}
                  className="form-input"
                  type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : f.type === 'email' ? 'email' : f.type === 'password' ? 'password' : 'text'}
                  required={required}
                  /* Matches the server's own rule (body('password').isLength({min:8})),
                     so a short password is refused here rather than as a 422. */
                  minLength={f.type === 'password' ? 8 : undefined}
                  /* 'new-password' stops the browser offering the ADMIN's saved
                     credentials for the account they are creating for someone else. */
                  autoComplete={f.type === 'password' ? 'new-password' : undefined}
                  value={values[f.key] ?? ''}
                  onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                />
              )}
              {f.help && (
                <div className="form-help" style={{ marginTop: 4, fontSize: 11, color: 'var(--text-3)' }}>
                  {f.help}
                </div>
              )}
            </div>
          ); })}
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
