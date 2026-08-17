/**
 * The Installation board — the third process on the same KanbanBoard,
 * fed meta.installation.stages. No stage names in this file either.
 */
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { usePipeline } from '../../meta/usePipeline';
import { KanbanBoard } from '../../components/KanbanBoard';

export interface JobRow {
  _id: string;
  jobNumber: string;
  stage: string;
  status: string;
  technicianName?: string;
  scheduledDate?: string | null;
  customerSnapshot: { name: string; company?: string; city?: string };
  snags?: Array<{ severity: string; closedAt: string | null }>;
  feedback?: { csat: number | null };
  correctiveAction?: { required: boolean; documentedAt: string | null };
}

const STATUS_COLOR: Record<string, string> = {
  open: 'var(--text-3)', in_progress: 'var(--amber)', handed_over: 'var(--azure)',
  support: 'var(--violet)', closed: 'var(--emerald)', cancelled: 'var(--coral)',
};

export function InstallationsPage() {
  const pipeline = usePipeline();
  const navigate = useNavigate();

  const jobs = useQuery({
    queryKey: ['installations'],
    queryFn: async () => (await api<JobRow[]>('GET', '/installations?limit=200')).data,
  });

  return (
    <>
      <h1 className="page-title">Installation <em>& Service</em></h1>
      <div className="page-sub">// SIGNED DA → CLOSED FEEDBACK · CHECKLISTS GATE EVERY STAGE</div>

      {jobs.isError && (
        <div className="offline-banner">
          Could not load jobs: {String((jobs.error as Error).message)}
        </div>
      )}

      <KanbanBoard
        stages={pipeline.data?.installation.stages ?? []}
        cards={(jobs.data ?? []).map((job) => {
          const openBlocking = (job.snags ?? []).filter(
            (s) => !s.closedAt && ['major', 'blocker'].includes(s.severity)).length;
          const needsPlan = job.correctiveAction?.required && !job.correctiveAction.documentedAt;
          return {
            id: job._id,
            stage: job.stage,
            render: () => (
              <>
                <div className="lead-card-name">{job.jobNumber}</div>
                <div className="lead-card-meta">
                  {job.customerSnapshot.company || job.customerSnapshot.name}
                  {job.technicianName ? ` · ${job.technicianName}` : ' · unassigned'}
                </div>
                <div className="lead-card-meta" style={{ color: STATUS_COLOR[job.status] }}>
                  ● {job.status.replace('_', ' ')}
                  {job.feedback?.csat != null && ` · CSAT ${job.feedback.csat}`}
                </div>
                {openBlocking > 0 && (
                  <div className="lead-card-flag">⚠ {openBlocking} blocking snag(s)</div>
                )}
                {needsPlan && (
                  <div className="lead-card-flag">⚠ corrective action plan overdue</div>
                )}
              </>
            ),
          };
        })}
        onCardClick={(card) => navigate(`/installation/${card.id}`)}
      />
    </>
  );
}
