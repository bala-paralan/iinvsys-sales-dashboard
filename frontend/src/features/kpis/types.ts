/** The KPI envelope from docs/requirements/05-kpi-definitions.md. */
export interface Kpi {
  key: string;
  label: string;
  actual: number | null;
  target: number | null;
  unit: string;
  direction: 'min' | 'max';
  /** null when the KPI has no target OR no data — never silently 'ok'. */
  status: 'ok' | 'warn' | 'breach' | null;
  window: string;
  numerator: number | null;
  denominator: number | null;
}

export interface KpiWindow {
  from: string;
  to: string;
  label: string;
}

export interface ProcessKpis {
  process: string;
  window: KpiWindow;
  metrics: Kpi[];
  counters?: Record<string, number>;
}

export interface KpiSummary {
  window: KpiWindow;
  pipelineVersion: string;
  sales: Kpi[];
  delivery: Kpi[];
  installation: Kpi[];
  counters: Record<string, number>;
  health: { ok: number; warn: number; breach: number; unmeasured: number };
}

export type Period = 'last_month' | 'current_month';

export const COUNTER_LABELS: Record<string, string> = {
  leads_needing_review: 'Needing review',
  leads_inactive_30d: 'Inactive 30d+',
  leads_stage_age_exceeded: 'Stage age exceeded',
  leads_missing_followup: 'No follow-up set',
  leads_close_date_expired: 'Close date passed',
};
