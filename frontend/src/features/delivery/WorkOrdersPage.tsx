/**
 * The Delivery board — the SAME KanbanBoard as sales, fed
 * meta.delivery.stages. That reuse is the point of the generic components:
 * this file contains no stage names.
 */
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { usePipeline } from '../../meta/usePipeline';
import { KanbanBoard } from '../../components/KanbanBoard';

export interface WorkOrderRow {
  _id: string;
  woNumber: string;
  stage: string;
  status: string;
  poNumber?: string;
  poValue?: number;
  customerSnapshot: { name: string; company?: string; city?: string };
  currentCommittedDate?: string | null;
  acceptedAt?: string | null;
  delayEvents?: Array<{ lateNotice: boolean }>;
}

const inr = (n?: number) => (n ? `₹${n.toLocaleString('en-IN')}` : '—');

const STATUS_COLOR: Record<string, string> = {
  created: 'var(--text-3)', accepted: 'var(--azure)', in_progress: 'var(--amber)',
  dispatched: 'var(--violet)', delivered: 'var(--emerald)', cancelled: 'var(--coral)',
};

export function WorkOrdersPage() {
  const pipeline = usePipeline();
  const navigate = useNavigate();

  const orders = useQuery({
    queryKey: ['workorders'],
    queryFn: async () => (await api<WorkOrderRow[]>('GET', '/workorders?limit=200')).data,
  });

  return (
    <>
      <h1 className="page-title">Delivery <em>Work Orders</em></h1>
      <div className="page-sub">// PO → SIGNED DELIVERY ACKNOWLEDGEMENT · A11 CLOCKS RUNNING</div>

      {orders.isError && (
        <div className="offline-banner">
          Could not load work orders: {String((orders.error as Error).message)}
        </div>
      )}

      <KanbanBoard
        stages={pipeline.data?.delivery.stages ?? []}
        cards={(orders.data ?? []).map((wo) => ({
          id: wo._id,
          stage: wo.stage,
          render: () => (
            <>
              <div className="lead-card-name">{wo.woNumber}</div>
              <div className="lead-card-meta">
                {wo.customerSnapshot.company || wo.customerSnapshot.name} · {inr(wo.poValue)}
              </div>
              <div className="lead-card-meta" style={{ color: STATUS_COLOR[wo.status] }}>
                ● {wo.status.replace('_', ' ')}
                {wo.currentCommittedDate
                  ? ` · due ${new Date(wo.currentCommittedDate).toLocaleDateString('en-IN')}`
                  : wo.acceptedAt ? ' · NO DATE COMMITTED' : ' · awaiting acceptance'}
              </div>
              {wo.delayEvents?.some((d) => d.lateNotice) && (
                <div className="lead-card-flag">⚠ late delay notice on record</div>
              )}
            </>
          ),
        }))}
        onCardClick={(card) => navigate(`/delivery/${card.id}`)}
      />
    </>
  );
}
