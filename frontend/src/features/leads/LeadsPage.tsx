/**
 * The Sales board — F2's core screen.
 *
 * Columns come from usePipeline(); with the API down they degrade to
 * PIPELINE_FALLBACK so the board keeps its bones. Clicking a card opens the
 * gate checklist, which is where advancing happens — there is deliberately no
 * silent drag-to-move, because a stage change without its gate is exactly
 * what the backend now refuses.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { usePipeline, PIPELINE_FALLBACK, can } from '../../meta/usePipeline';
import { KanbanBoard } from '../../components/KanbanBoard';
import type { KanbanStage } from '../../components/KanbanBoard';
import { StageGateChecklist } from '../../components/StageGateChecklist';
import { NewLeadModal } from './NewLeadModal';

interface LeadRow {
  _id: string;
  name: string;
  company?: string;
  phone: string;
  stage: string;
  value?: number;
  needsReview?: boolean;
  reviewIssues?: string[];
}

const inr = (n?: number) =>
  n ? `₹${n.toLocaleString('en-IN')}` : '—';

export function LeadsPage() {
  const pipeline = usePipeline();
  const navigate = useNavigate();
  const [selected, setSelected] = useState<LeadRow | null>(null);
  const [creating, setCreating] = useState(false);

  const leads = useQuery({
    queryKey: ['leads'],
    queryFn: async () => (await api<LeadRow[]>('GET', '/leads?limit=200')).data,
  });

  const stages: KanbanStage[] = pipeline.data
    ? pipeline.data.sales.stages
    : PIPELINE_FALLBACK.sales;

  return (
    <>
      <h1 className="page-title">Lead <em>Pipeline</em></h1>
      <div className="page-sub">// SPENCO · STAGE GATES ENFORCED SERVER-SIDE</div>

      {can(pipeline.data, 'lead.write') && (
        <button className="neo-btn gold" style={{ margin: '12px 0' }} onClick={() => setCreating(true)}>
          + New Lead
        </button>
      )}

      {pipeline.isError && (
        <div className="offline-banner">
          Pipeline metadata is unavailable — showing the offline board skeleton.
          Stage gates and dropdowns need the server.
        </div>
      )}
      {leads.isError && (
        <div className="offline-banner">Could not load leads: {String((leads.error as Error).message)}</div>
      )}

      <KanbanBoard
        stages={stages}
        cards={(leads.data ?? []).map((lead) => ({
          id: lead._id,
          stage: lead.stage,
          render: () => (
            <>
              <div className="lead-card-name">{lead.name}</div>
              <div className="lead-card-meta">
                {lead.company || 'No company'} · {inr(lead.value)}
              </div>
              {lead.needsReview && (
                <div className="lead-card-flag">
                  ⚠ {lead.reviewIssues?.length ?? 0} hygiene issue(s)
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button
                  className="neo-btn"
                  style={{ padding: '3px 8px', fontSize: 11 }}
                  onClick={(e) => { e.stopPropagation(); navigate(`/leads/${lead._id}`); }}
                >
                  Details
                </button>
              </div>
            </>
          ),
        }))}
        onCardClick={(card) => {
          const lead = (leads.data ?? []).find((l) => l._id === card.id);
          if (lead) setSelected(lead);
        }}
      />

      {creating && (
        <NewLeadModal
          onClose={() => setCreating(false)}
          onCreated={() => { setCreating(false); void leads.refetch(); }}
        />
      )}

      {selected && (
        <StageGateChecklist
          entityPath={`/leads/${selected._id}`}
          entityName={selected.name}
          stages={stages}
          allowOverride={!!pipeline.data?.me.permissions.includes('lead.gate_override')}
          invalidateKeys={[['leads'], ['hygiene']]}
          onClose={() => setSelected(null)}
          onAdvanced={() => setSelected(null)}
        />
      )}
    </>
  );
}
