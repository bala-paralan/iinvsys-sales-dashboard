/**
 * Lead detail — edit form (RHF + Zod), stage-history timeline, and the gate
 * panel for advancing.
 *
 * The form deliberately has NO stage field: PUT refuses stage changes
 * (STAGE_CHANGE_VIA_ADVANCE) and the UI does not offer what the server
 * refuses. Advancing is the gold button, which opens the gate checklist.
 *
 * Validation mirrors the dictionary's ENFORCEMENT MODEL, not its mandatory
 * list: almost everything is optional at save time, because a blank field
 * flags the record rather than blocking the write. The Zod schema only
 * rejects values that are WRONG (a 7-digit phone, a negative deal value) —
 * never values that are merely missing. Missing is the hygiene queue's job.
 */
import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { api } from '../../api/client';
import { usePipeline } from '../../meta/usePipeline';
import { EnumSelect } from '../../components/EnumSelect';
import { StageGateChecklist } from '../../components/StageGateChecklist';

const leadSchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  phone: z.string().trim().regex(/^[6-9]\d{9}$/, 'A 10-digit Indian mobile (A7)'),
  email: z.string().trim().email('Not a valid email').or(z.literal('')),
  company: z.string().trim(),
  jobTitle: z.string().trim(),
  companyType: z.string(),
  industrySegment: z.string(),
  city: z.string().trim(),
  state: z.string().trim(),
  /* Kept as a string in the form (native inputs emit strings; zod4 coerce
     types fight the RHF resolver) and converted on submit. */
  value: z.string().trim()
    .refine((v) => v === '' || (!Number.isNaN(Number(v)) && Number(v) >= 0),
      'Deal value cannot be negative'),
  productPackage: z.string().trim(),
  competitor: z.string(),
  nextAction: z.string().trim(),
  expectedCloseDate: z.string(),   // yyyy-mm-dd or ''
  nextFollowUpDate: z.string(),
  notes: z.string(),
});

type LeadForm = z.infer<typeof leadSchema>;

interface StageHistoryEntry {
  from: string | null;
  to: string;
  at: string;
  byName: string;
  direction: string;
  note: string;
  gateOverride: boolean;
  missingAtOverride: string[];
}

interface LeadDoc extends Record<string, unknown> {
  _id: string;
  name: string;
  stage: string;
  zone?: string;
  opportunityName?: string;
  needsReview?: boolean;
  reviewIssues?: string[];
  stageHistory?: StageHistoryEntry[];
}

const toDateInput = (v: unknown) =>
  typeof v === 'string' && v ? v.slice(0, 10) : '';

export function LeadDetailPage() {
  const { id = '' } = useParams();
  const queryClient = useQueryClient();
  const { data: meta } = usePipeline();
  const [gateOpen, setGateOpen] = useState(false);
  const [saved, setSaved] = useState(false);

  const lead = useQuery({
    queryKey: ['lead', id],
    queryFn: async () => (await api<LeadDoc>('GET', `/leads/${id}`)).data,
  });

  const form = useForm<LeadForm>({
    resolver: zodResolver(leadSchema),
    defaultValues: {
      name: '', phone: '', email: '', company: '', jobTitle: '',
      companyType: '', industrySegment: '', city: '', state: '',
      value: '', productPackage: '', competitor: '', nextAction: '',
      expectedCloseDate: '', nextFollowUpDate: '', notes: '',
    },
  });

  /* Populate once the lead arrives. */
  useEffect(() => {
    if (!lead.data) return;
    const d = lead.data;
    form.reset({
      name: String(d.name ?? ''),
      phone: String(d.phone ?? ''),
      email: String(d.email ?? ''),
      company: String(d.company ?? ''),
      jobTitle: String(d.jobTitle ?? ''),
      companyType: String(d.companyType ?? ''),
      industrySegment: String(d.industrySegment ?? ''),
      city: String(d.city ?? ''),
      state: String(d.state ?? ''),
      value: String(d.value ?? 0),
      productPackage: String(d.productPackage ?? ''),
      competitor: String(d.competitor ?? ''),
      nextAction: String(d.nextAction ?? ''),
      expectedCloseDate: toDateInput(d.expectedCloseDate),
      nextFollowUpDate: toDateInput(d.nextFollowUpDate),
      notes: String(d.notes ?? ''),
    });
  }, [lead.data, form]);

  const save = useMutation({
    mutationFn: (values: LeadForm) => api('PUT', `/leads/${id}`, {
      ...values,
      value: values.value === '' ? 0 : Number(values.value),
      expectedCloseDate: values.expectedCloseDate || null,
      nextFollowUpDate: values.nextFollowUpDate || null,
    }),
    onSuccess: () => {
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      queryClient.invalidateQueries({ queryKey: ['lead', id] });
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['hygiene'] });
      queryClient.invalidateQueries({ queryKey: ['lead-gate', id] });
    },
  });

  const stageLabel = (key: string | null) =>
    (key && meta?.sales.stages.find((s) => s.key === key)?.label) || key || 'created';

  if (lead.isLoading) return <p style={{ color: 'var(--text-3)' }}>Loading…</p>;
  if (lead.isError || !lead.data) {
    return <div className="offline-banner">Could not load this lead.</div>;
  }

  const d = lead.data;
  const history = [...(d.stageHistory ?? [])].reverse();

  return (
    <>
      <Link to="/leads" style={{ color: 'var(--text-3)', fontSize: 13 }}>← Back to board</Link>
      <h1 className="page-title" style={{ marginTop: 8 }}>{d.name}</h1>
      <div className="page-sub">
        // {stageLabel(d.stage).toUpperCase()}
        {d.opportunityName ? ` · ${d.opportunityName}` : ''}
        {d.zone ? ` · ZONE ${String(d.zone).toUpperCase()}` : ''}
      </div>

      {d.needsReview && (
        <div className="offline-banner" style={{ borderColor: 'var(--coral)' }}>
          ⚠ Needs review: {(d.reviewIssues ?? []).join(', ')}
        </div>
      )}

      <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        {/* ── Edit form ── */}
        <form
          onSubmit={form.handleSubmit((v) => save.mutate(v))}
          className="card"
          style={{ padding: 20, flex: '1 1 460px', maxWidth: 640 }}
        >
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <Field label="Contact name" error={form.formState.errors.name?.message}>
              <input className="form-input" {...form.register('name')} />
            </Field>
            <Field label="Phone" error={form.formState.errors.phone?.message}>
              <input className="form-input" {...form.register('phone')} />
            </Field>
            <Field label="Email" error={form.formState.errors.email?.message}>
              <input className="form-input" {...form.register('email')} />
            </Field>
            <Field label="Designation">
              <input className="form-input" placeholder='Not "manager" — the exact title' {...form.register('jobTitle')} />
            </Field>
            <Field label="Company">
              <input className="form-input" {...form.register('company')} />
            </Field>
            <Field label="Company type">
              <Controller
                control={form.control} name="companyType"
                render={({ field }) => (
                  <EnumSelect enumName="companyTypes" value={field.value} onChange={field.onChange} />
                )}
              />
            </Field>
            <Field label="Industry segment">
              <Controller
                control={form.control} name="industrySegment"
                render={({ field }) => (
                  <EnumSelect enumName="industrySegments" value={field.value} onChange={field.onChange} />
                )}
              />
            </Field>
            <Field label="Competitor">
              <Controller
                control={form.control} name="competitor"
                render={({ field }) => (
                  <EnumSelect enumName="competitors" value={field.value} onChange={field.onChange} />
                )}
              />
            </Field>
            <Field label="City">
              <input className="form-input" {...form.register('city')} />
            </Field>
            <Field label="State (zone derives from it)">
              <input className="form-input" {...form.register('state')} />
            </Field>
            <Field label="Deal value (₹)" error={form.formState.errors.value?.message}>
              <input className="form-input" type="number" {...form.register('value')} />
            </Field>
            <Field label="Product / package">
              <input className="form-input" {...form.register('productPackage')} />
            </Field>
            <Field label="Expected close date">
              <input className="form-input" type="date" {...form.register('expectedCloseDate')} />
            </Field>
            <Field label="Next follow-up date">
              <input className="form-input" type="date" {...form.register('nextFollowUpDate')} />
            </Field>
          </div>

          <Field label="Next action">
            <input
              className="form-input"
              placeholder='"Send revised proposal — Exec. Deadline: 16 Jul", not "follow up"'
              {...form.register('nextAction')}
            />
          </Field>
          <Field label="Notes">
            <textarea className="form-input" rows={3} {...form.register('notes')} />
          </Field>

          <div style={{ display: 'flex', gap: 10, marginTop: 16, alignItems: 'center' }}>
            <button type="submit" className="neo-btn gold" disabled={save.isPending}>
              {save.isPending ? 'Saving…' : 'Save'}
            </button>
            <button type="button" className="neo-btn" onClick={() => setGateOpen(true)}>
              Advance stage →
            </button>
            {saved && <span style={{ color: 'var(--emerald)', fontSize: 13 }}>Saved.</span>}
            {save.isError && (
              <span style={{ color: 'var(--coral)', fontSize: 13 }}>
                {(save.error as Error).message}
              </span>
            )}
          </div>
        </form>

        {/* ── Stage history timeline ── */}
        <aside style={{ flex: '0 1 320px' }}>
          <div className="form-label">Stage history</div>
          {history.length === 0 && (
            <p style={{ color: 'var(--text-3)', fontSize: 13 }}>
              No transitions yet — still at first capture.
            </p>
          )}
          {history.map((h, i) => (
            <div
              key={i}
              style={{
                borderLeft: `3px solid ${h.gateOverride ? 'var(--coral)' : 'var(--emerald)'}`,
                padding: '8px 12px', marginBottom: 10, background: 'var(--surface-1)',
              }}
            >
              <div style={{ fontSize: 14 }}>
                {stageLabel(h.from)} → <strong>{stageLabel(h.to)}</strong>
              </div>
              <div style={{ color: 'var(--text-3)', fontSize: 12, fontFamily: 'var(--font-mono)' }}>
                {new Date(h.at).toLocaleString('en-IN')} · {h.byName || 'system'} · {h.direction}
              </div>
              {h.gateOverride && (
                <div style={{ color: 'var(--coral)', fontSize: 12, marginTop: 4 }}>
                  OVERRIDE — {h.missingAtOverride.length} requirement(s) waived
                </div>
              )}
              {h.note && (
                <div style={{ color: 'var(--text-2)', fontSize: 12, marginTop: 4 }}>“{h.note}”</div>
              )}
            </div>
          ))}
        </aside>
      </div>

      {gateOpen && (
        <StageGateChecklist
          entityPath={`/leads/${d._id}`}
          entityName={d.name}
          stages={meta?.sales.stages ?? []}
          allowOverride={!!meta?.me.permissions.includes('lead.gate_override')}
          invalidateKeys={[['leads'], ['hygiene'], ['lead', id]]}
          onClose={() => setGateOpen(false)}
          onAdvanced={() => setGateOpen(false)}
        />
      )}
    </>
  );
}

function Field({ label, error, children }: {
  label: string; error?: string; children: React.ReactNode;
}) {
  return (
    <div style={{ marginTop: 12 }}>
      <label className="form-label">{label}</label>
      {children}
      {error && <div style={{ color: 'var(--coral)', fontSize: 12, marginTop: 4 }}>{error}</div>}
    </div>
  );
}
