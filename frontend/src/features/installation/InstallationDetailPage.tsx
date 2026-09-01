/**
 * Installation Job detail — the checklist runner, snag tracker, dual-signature
 * commissioning panel, support issues and the CSAT/closure flow.
 *
 * Checklist ITEMS come from the job document, which was instantiated from the
 * pipeline templates at handoff. Rendering them from the job (not from the
 * live template) is deliberate: a job that ran under an older checklist keeps
 * showing the items its technician actually ticked.
 */
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiUpload, ApiError } from '../../api/client';
import type { GateRequirementFailure } from '../../api/client';
import { usePipeline, can } from '../../meta/usePipeline';
import { useMe } from '../../portal/useMe';
import { EnumSelect } from '../../components/EnumSelect';
import { StageGateChecklist } from '../../components/StageGateChecklist';

interface ChecklistItem {
  key: string; label: string; required: boolean; done: boolean;
}
interface Checklist {
  stageKey: string; items: ChecklistItem[]; signedByName: string; signedAt: string | null;
}
interface Snag {
  _id: string; severity: string; description: string; closedAt: string | null; resolution: string;
}
interface Issue {
  _id: string; description: string; slaHours: number; reportedAt: string;
  resolvedAt: string | null; slaBreached: boolean;
}
interface JobDoc {
  _id: string; jobNumber: string; stage: string; status: string;
  customerSnapshot: { name: string; company?: string; phone?: string; city?: string; state?: string };
  technicianName?: string; scheduledDate?: string | null;
  siteReady?: { confirmedAt: string | null; confirmedBy: string };
  checklists: Checklist[];
  snags: Snag[];
  commissioning: {
    passed: boolean; technicianSignedAt: string | null;
    customerCountersignedAt: string | null; customerSignatory: string; retestCount: number;
  };
  handover: { trainedAttendees: string[]; handedOverAt: string | null };
  postSupport: { checkInDueAt: string | null; checkInDoneAt: string | null; issues: Issue[] };
  feedback: { receivedAt: string | null; csat: number | null; comments: string };
  correctiveAction: { required: boolean; dueAt: string | null; documentedAt: string | null; plan: string };
  firstTimeRight: boolean | null;
  attachments: Array<{ docType: string; filename: string }>;
}

export function InstallationDetailPage() {
  const { id = '' } = useParams();
  const queryClient = useQueryClient();
  const { data: meta } = usePipeline();
  const { data: me } = useMe();
  const [gateOpen, setGateOpen] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [gateMissing, setGateMissing] = useState<GateRequirementFailure[] | null>(null);

  const job = useQuery({
    queryKey: ['installation', id],
    queryFn: async () => (await api<JobDoc>('GET', `/installations/${id}`)).data,
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['installation', id] });
    queryClient.invalidateQueries({ queryKey: ['installations'] });
  };
  const onOk = (res: { message?: string }) => { setGateMissing(null); setBanner(res.message ?? null); refresh(); };
  const onErr = (err: Error) => {
    if (err instanceof ApiError && err.missing?.length) setGateMissing(err.missing);
    setBanner(err.message);
  };

  /* local form state */
  const [snagSeverity, setSnagSeverity] = useState('minor');
  const [snagText, setSnagText] = useState('');
  const [signatory, setSignatory] = useState('');
  const [attendees, setAttendees] = useState('');
  const [issueText, setIssueText] = useState('');
  const [csat, setCsat] = useState('');
  const [csatComments, setCsatComments] = useState('');
  const [plan, setPlan] = useState('');
  const [docType, setDocType] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [technicianName, setTechnicianName] = useState('');
  const [scheduledDate, setScheduledDate] = useState('');
  const [siteReadyBy, setSiteReadyBy] = useState('');

  const planJob = useMutation({
    mutationFn: () => api('POST', `/installations/${id}/plan`, {
      /* Only technicianName — `technician` is an ObjectId ref to User and the
         API exposes no endpoint that lists users, so no client can obtain a
         valid id. Sending the name there is a 422 on the whole request, which
         would also drop the date and the site confirmation. The gate reads
         `technician`, so it stays unmet until the backend either lists
         assignable users or gates on the name. */
      ...(technicianName.trim() ? { technicianName: technicianName.trim() } : {}),
      ...(scheduledDate ? { scheduledDate } : {}),
      ...(siteReadyBy.trim() ? { siteReadyConfirmedBy: siteReadyBy.trim() } : {}),
    }),
    onSuccess: onOk, onError: onErr,
  });

  const tick = useMutation({
    mutationFn: (v: { stageKey: string; itemKey?: string; done?: boolean; signedByName?: string }) =>
      api('PATCH', `/installations/${id}/checklist`, v),
    onSuccess: onOk, onError: onErr,
  });
  const addSnag = useMutation({
    mutationFn: () => api('POST', `/installations/${id}/snags`, { severity: snagSeverity, description: snagText }),
    onSuccess: (r) => { setSnagText(''); onOk(r); }, onError: onErr,
  });
  const closeSnag = useMutation({
    mutationFn: (snagId: string) => api('PATCH', `/installations/${id}/snags/${snagId}/close`, {}),
    onSuccess: onOk, onError: onErr,
  });
  const commission = useMutation({
    mutationFn: (v: Record<string, unknown>) => api('POST', `/installations/${id}/commissioning`, v),
    onSuccess: onOk, onError: onErr,
  });
  const handover = useMutation({
    mutationFn: () => api('POST', `/installations/${id}/handover`, {
      trainedAttendees: attendees.split(',').map((s) => s.trim()).filter(Boolean),
    }),
    onSuccess: onOk, onError: onErr,
  });
  const checkIn = useMutation({
    mutationFn: () => api('POST', `/installations/${id}/check-in`, {}), onSuccess: onOk, onError: onErr,
  });
  const addIssue = useMutation({
    mutationFn: () => api('POST', `/installations/${id}/issues`, { description: issueText }),
    onSuccess: (r) => { setIssueText(''); onOk(r); }, onError: onErr,
  });
  const resolveIssue = useMutation({
    mutationFn: (issueId: string) => api('PATCH', `/installations/${id}/issues/${issueId}/resolve`, {}),
    onSuccess: onOk, onError: onErr,
  });
  const feedback = useMutation({
    mutationFn: () => api('POST', `/installations/${id}/feedback`, {
      csat: Number(csat), comments: csatComments,
    }),
    onSuccess: onOk, onError: onErr,
  });
  const corrective = useMutation({
    mutationFn: () => api('POST', `/installations/${id}/corrective-action`, { plan }),
    onSuccess: onOk, onError: onErr,
  });
  const close = useMutation({
    mutationFn: () => api('POST', `/installations/${id}/close`, {}), onSuccess: onOk, onError: onErr,
  });
  const uploadDoc = useMutation({
    mutationFn: () => {
      const form = new FormData();
      form.append('docType', docType); form.append('file', file!);
      return apiUpload(`/installations/${id}/upload`, form);
    },
    onSuccess: (r) => { setFile(null); setDocType(''); onOk(r); }, onError: onErr,
  });

  if (job.isLoading) return <p style={{ color: 'var(--text-3)' }}>Loading…</p>;
  if (job.isError || !job.data) return <div className="offline-banner">Could not load this job.</div>;

  const d = job.data;
  const stageLabel = (k: string) =>
    meta?.installation.stages.find((s) => s.key === k)?.label ?? k;
  const when = (s?: string | null) => (s ? new Date(s).toLocaleDateString('en-IN') : '—');
  const needsPlan = d.correctiveAction.required && !d.correctiveAction.documentedAt;

  return (
    <>
      <Link to="/installation" style={{ color: 'var(--text-3)', fontSize: 13 }}>← Back to installation board</Link>
      <h1 className="page-title" style={{ marginTop: 8 }}>{d.jobNumber}</h1>
      <div className="page-sub">
        // {stageLabel(d.stage).toUpperCase()} · {d.status.toUpperCase()}
        {d.technicianName ? ` · ${d.technicianName}` : ''}
        {d.firstTimeRight !== null && ` · FTR ${d.firstTimeRight ? 'YES' : 'NO'}`}
      </div>

      {banner && <div className="offline-banner">{banner}</div>}
      {needsPlan && (
        <div className="offline-banner" style={{ borderColor: 'var(--coral)' }}>
          ⚠ CSAT {d.feedback.csat} — a corrective action plan is due by {when(d.correctiveAction.dueAt)}.
          This job cannot close without it.
        </div>
      )}
      {gateMissing && (
        <div style={{ marginBottom: 16 }}>
          {gateMissing.map((m) => (
            <div key={m.code} className="gate-req unmet">
              <span className="gate-req-mark">[ ]</span><span>{m.message}</span>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 480px', maxWidth: 700, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <section className="card" style={{ padding: 16 }}>
            <div className="form-label">Customer</div>
            <div style={{ fontSize: 15 }}>
              {d.customerSnapshot.company || d.customerSnapshot.name}
            </div>
            <div style={{ color: 'var(--text-3)', fontSize: 13 }}>
              {d.customerSnapshot.phone} · {d.customerSnapshot.city}
              {d.siteReady?.confirmedAt
                ? ` · site confirmed by ${d.siteReady.confirmedBy}`
                : ' · site readiness NOT confirmed'}
              {d.scheduledDate ? ` · scheduled ${when(d.scheduledDate)}` : ''}
            </div>
          </section>

          {/* Planning → On-Site gates on technician, scheduledDate and
              siteReady.confirmedAt. POST /installations/:id/plan has set all
              three since B3; this page only ever displayed them, so the stage
              was a dead end. Site readiness records who AT THE CUSTOMER
              confirmed it — the controller stamps confirmedAt itself. */}
          {d.stage === 'planning' && can(me, 'install.assign') && (
            <section className="card" style={{ padding: 16 }}>
              <div className="form-label">Plan the job</div>
              <div style={{ display: 'grid', gap: 10, marginTop: 8 }}>
                <div>
                  <label className="form-label" htmlFor="ij-tech">Technician name</label>
                  <input id="ij-tech" className="form-input" value={technicianName}
                    onChange={(e) => setTechnicianName(e.target.value)} />
                  <div style={{ color: 'var(--coral)', fontSize: 12, marginTop: 4 }}>
                    Recorded for reporting, but the stage gate wants a linked user
                    account and the API exposes no way to list them — that gate
                    stays unmet until the backend provides one.
                  </div>
                </div>
                <div>
                  <label className="form-label" htmlFor="ij-date">Scheduled date</label>
                  <input id="ij-date" className="form-input" type="date" value={scheduledDate}
                    onChange={(e) => setScheduledDate(e.target.value)} />
                </div>
                <div>
                  <label className="form-label" htmlFor="ij-siteby">Site readiness confirmed by (customer)</label>
                  <input id="ij-siteby" className="form-input" value={siteReadyBy}
                    onChange={(e) => setSiteReadyBy(e.target.value)} />
                </div>
                <div>
                  <button className="neo-btn gold" disabled={planJob.isPending}
                    onClick={() => planJob.mutate()}>
                    {planJob.isPending ? 'Saving…' : 'Save plan'}
                  </button>
                </div>
              </div>
            </section>
          )}

          {/* ── Checklist runner ── */}
          {d.checklists.map((cl) => (
            <section key={cl.stageKey} className="card" style={{ padding: 16 }}>
              <div className="form-label">{stageLabel(cl.stageKey)} checklist</div>
              {cl.items.map((item) => (
                <label key={item.key} style={{
                  display: 'flex', gap: 10, alignItems: 'center', padding: '5px 0',
                  fontSize: 14, cursor: can(me, 'install.execute') ? 'pointer' : 'default',
                  color: item.done ? 'var(--text-3)' : 'var(--text-1)',
                }}>
                  <input
                    type="checkbox" checked={item.done}
                    disabled={!can(me, 'install.execute') || tick.isPending}
                    onChange={(e) => tick.mutate({
                      stageKey: cl.stageKey, itemKey: item.key, done: e.target.checked,
                    })}
                  />
                  {item.label}
                </label>
              ))}
              {cl.signedByName
                ? <div style={{ color: 'var(--emerald)', fontSize: 12, marginTop: 6 }}>
                    ✓ signed by {cl.signedByName}
                  </div>
                : can(me, 'install.execute') && (
                  <button className="neo-btn" style={{ marginTop: 8, padding: '4px 10px', fontSize: 12 }}
                    onClick={() => {
                      const name = window.prompt('Technician name signing this checklist:');
                      if (name) tick.mutate({ stageKey: cl.stageKey, signedByName: name });
                    }}>
                    Sign checklist
                  </button>
                )}
            </section>
          ))}

          {/* ── Snags ── */}
          <section className="card" style={{ padding: 16 }}>
            <div className="form-label">Snags — major and blocker stop commissioning</div>
            {d.snags.length === 0 && <div style={{ color: 'var(--text-3)', fontSize: 13 }}>None recorded.</div>}
            {d.snags.map((s) => (
              <div key={s._id} style={{
                fontSize: 13, padding: '5px 0', borderBottom: '1px solid var(--surface-3)',
                color: s.closedAt ? 'var(--text-3)' : 'var(--text-1)',
              }}>
                <span style={{
                  fontFamily: 'var(--font-mono)',
                  color: s.closedAt ? 'var(--emerald)'
                    : ['major', 'blocker'].includes(s.severity) ? 'var(--coral)' : 'var(--amber)',
                }}>
                  [{s.closedAt ? 'closed' : s.severity}]
                </span>{' '}{s.description}
                {!s.closedAt && can(me, 'install.execute') && (
                  <button className="neo-btn" style={{ marginLeft: 8, padding: '2px 8px', fontSize: 11 }}
                    onClick={() => closeSnag.mutate(s._id)}>close</button>
                )}
              </div>
            ))}
            {can(me, 'install.execute') && (
              <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                <div style={{ minWidth: 150 }}>
                  <EnumSelect enumName="snagSeverities" value={snagSeverity} onChange={setSnagSeverity}
                    placeholder="severity" />
                </div>
                <input className="form-input" style={{ maxWidth: 260 }} placeholder="what is wrong?"
                  value={snagText} onChange={(e) => setSnagText(e.target.value)} />
                <button className="neo-btn" disabled={!snagText.trim() || addSnag.isPending}
                  onClick={() => addSnag.mutate()}>Add snag</button>
              </div>
            )}
          </section>

          {/* ── Commissioning: the dual signature ── */}
          <section className="card" style={{ padding: 16 }}>
            <div className="form-label">Commissioning — needs BOTH signatures (I-9)</div>
            <div style={{ fontSize: 13, color: 'var(--text-2)' }}>
              passed: {d.commissioning.passed ? 'yes' : 'no'} · retests: {d.commissioning.retestCount}
            </div>
            <div style={{ fontSize: 13, marginTop: 6 }}>
              <span style={{ color: d.commissioning.technicianSignedAt ? 'var(--emerald)' : 'var(--coral)' }}>
                {d.commissioning.technicianSignedAt ? '[x]' : '[ ]'} technician
              </span>{'   '}
              <span style={{ color: d.commissioning.customerCountersignedAt ? 'var(--emerald)' : 'var(--coral)' }}>
                {d.commissioning.customerCountersignedAt ? '[x]' : '[ ]'} customer
                {d.commissioning.customerSignatory ? ` (${d.commissioning.customerSignatory})` : ''}
              </span>
            </div>
            {can(me, 'install.execute') && (
              <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                <button className="neo-btn"
                  onClick={() => commission.mutate({ passed: true, technicianSigned: true })}>
                  Pass + technician sign
                </button>
                <input className="form-input" style={{ maxWidth: 190 }} placeholder="customer signatory"
                  value={signatory} onChange={(e) => setSignatory(e.target.value)} />
                <button className="neo-btn" disabled={!signatory.trim()}
                  onClick={() => commission.mutate({ customerCountersigned: true, customerSignatory: signatory })}>
                  Countersign
                </button>
                <button className="neo-btn" onClick={() => commission.mutate({ passed: false })}>
                  Record failure
                </button>
              </div>
            )}
          </section>

          {/* ── Handover + support ── */}
          <section className="card" style={{ padding: 16 }}>
            <div className="form-label">Handover & support window</div>
            <div style={{ fontSize: 13, color: 'var(--text-2)' }}>
              handed over: {when(d.handover.handedOverAt)} ·
              check-in due {when(d.postSupport.checkInDueAt)}
              {d.postSupport.checkInDoneAt ? ` · done ${when(d.postSupport.checkInDoneAt)}` : ''}
            </div>

            {can(me, 'install.handover') && !d.handover.handedOverAt && (
              <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                <input className="form-input" style={{ maxWidth: 300 }}
                  placeholder="trained attendees, comma separated"
                  value={attendees} onChange={(e) => setAttendees(e.target.value)} />
                <button className="neo-btn gold" disabled={!attendees.trim() || handover.isPending}
                  onClick={() => handover.mutate()}>Record handover</button>
              </div>
            )}

            {can(me, 'support.manage') && (
              <>
                {!d.postSupport.checkInDoneAt && d.handover.handedOverAt && (
                  <button className="neo-btn" style={{ marginTop: 10 }} onClick={() => checkIn.mutate()}>
                    Log proactive check-in
                  </button>
                )}
                <div style={{ marginTop: 12 }}>
                  {d.postSupport.issues.map((i) => (
                    <div key={i._id} style={{ fontSize: 13, padding: '4px 0' }}>
                      <span style={{ color: i.resolvedAt ? 'var(--emerald)' : i.slaBreached ? 'var(--coral)' : 'var(--amber)' }}>
                        [{i.resolvedAt ? 'closed' : 'open'}{i.slaBreached ? ' · SLA BREACH' : ''}]
                      </span>{' '}{i.description}
                      {!i.resolvedAt && (
                        <button className="neo-btn" style={{ marginLeft: 8, padding: '2px 8px', fontSize: 11 }}
                          onClick={() => resolveIssue.mutate(i._id)}>resolve</button>
                      )}
                    </div>
                  ))}
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <input className="form-input" style={{ maxWidth: 300 }} placeholder="log a support issue"
                      value={issueText} onChange={(e) => setIssueText(e.target.value)} />
                    <button className="neo-btn" disabled={!issueText.trim()} onClick={() => addIssue.mutate()}>
                      Log issue
                    </button>
                  </div>
                </div>
              </>
            )}
          </section>

          {/* ── Feedback + closure ── */}
          <section className="card" style={{ padding: 16 }}>
            <div className="form-label">Customer feedback & closure</div>
            {d.feedback.receivedAt ? (
              <div style={{ fontSize: 14 }}>
                CSAT <strong>{d.feedback.csat}</strong> / 5 · received {when(d.feedback.receivedAt)}
                {d.feedback.comments && <div style={{ color: 'var(--text-2)', fontSize: 13 }}>“{d.feedback.comments}”</div>}
              </div>
            ) : (
              <div style={{ color: 'var(--text-3)', fontSize: 13 }}>
                No feedback yet — the job cannot close without it (I-7).
              </div>
            )}

            {can(me, 'feedback.log') && !d.feedback.receivedAt && (
              <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                <input className="form-input" type="number" step="0.5" min="0" max="5"
                  style={{ maxWidth: 100 }} placeholder="CSAT"
                  value={csat} onChange={(e) => setCsat(e.target.value)} />
                <input className="form-input" style={{ maxWidth: 260 }} placeholder="comments"
                  value={csatComments} onChange={(e) => setCsatComments(e.target.value)} />
                <button className="neo-btn" disabled={!csat || feedback.isPending}
                  onClick={() => feedback.mutate()}>Record feedback</button>
              </div>
            )}

            {needsPlan && can(me, 'feedback.corrective_action') && (
              <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                <input className="form-input" style={{ maxWidth: 380 }}
                  placeholder="corrective action plan (required before closure)"
                  value={plan} onChange={(e) => setPlan(e.target.value)} />
                <button className="neo-btn" disabled={!plan.trim()} onClick={() => corrective.mutate()}>
                  Document plan
                </button>
              </div>
            )}

            {can(me, 'feedback.log') && d.status !== 'closed' && (
              <button className="neo-btn gold" style={{ marginTop: 12 }}
                disabled={close.isPending} onClick={() => close.mutate()}>
                Close job
              </button>
            )}
          </section>

          {/* ── Documents ── */}
          <section className="card" style={{ padding: 16 }}>
            <div className="form-label">Documents</div>
            {d.attachments.length === 0 && <div style={{ color: 'var(--text-3)', fontSize: 13 }}>None attached.</div>}
            {d.attachments.map((a, i) => (
              <div key={i} style={{ fontSize: 13 }}>
                <span style={{ color: 'var(--gold)', fontFamily: 'var(--font-mono)' }}>{a.docType}</span> · {a.filename}
              </div>
            ))}
            {can(me, 'install.upload') && (
              <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                <div style={{ minWidth: 200 }}>
                  <EnumSelect enumName="docTypes" value={docType} onChange={setDocType} />
                </div>
                <input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  style={{ color: 'var(--text-2)', fontSize: 13 }} />
                <button className="neo-btn" disabled={!docType || !file || uploadDoc.isPending}
                  onClick={() => uploadDoc.mutate()}>Upload</button>
              </div>
            )}
          </section>
        </div>

        <aside style={{ flex: '0 1 260px' }}>
          {can(me, 'install.advance') && d.status !== 'closed' && (
            <button className="neo-btn gold" style={{ width: '100%' }} onClick={() => setGateOpen(true)}>
              Advance stage →
            </button>
          )}
        </aside>
      </div>

      {gateOpen && (
        <StageGateChecklist
          entityPath={`/installations/${d._id}`}
          entityName={d.jobNumber}
          stages={meta?.installation.stages ?? []}
          allowOverride={false}
          invalidateKeys={[['installations'], ['installation', id]]}
          onClose={() => setGateOpen(false)}
          onAdvanced={() => setGateOpen(false)}
        />
      )}
    </>
  );
}
