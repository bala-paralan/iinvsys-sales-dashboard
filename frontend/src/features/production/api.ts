import { api, apiUpload } from '../../api/client';

export interface WipStep {
  _id: string; order: number; label: string; instruction: string;
  status: 'pending' | 'in_progress' | 'done' | 'blocked';
  completedAt: string | null; photo: string; note: string;
}

export interface QcTest {
  _id?: string; parameter: string; standard: string; result: string;
  status: 'pass' | 'fail' | 'marginal';
}

export interface ProductionOrder {
  _id: string;
  woNumber: string;
  /** Absent for a finance-blind role — the server never sends it. */
  poValue?: number;
  poNumber?: string;
  customerSnapshot: { company?: string; name?: string; city?: string; state?: string };
  items: Array<{ name?: string; sku?: string; quantity?: number; unitPrice?: number }>;
  bom: Array<{ _id: string; part: string; quantity: number; unit: string; spec: string; procured: boolean; unitPrice?: number }>;
  stage: string;
  status: string;
  assignedEngineer: { _id: string; name: string; initials?: string; color?: string } | null;
  currentCommittedDate: string | null;
  dispatchedAt: string | null;
  deliveredAt: string | null;
  wipSteps: WipStep[];
  wipPercent: number | null;
  qc: {
    tests: QcTest[]; notes: string;
    submittedAt: string | null; approvedAt: string | null;
    rejectedAt: string | null; rejectedReason: string;
  };
  dispatchAuth?: {
    mode: string; awb: string; dispatchDate: string | null;
    expectedDelivery: string | null; cartons: number | null; grossWeightKg: number | null;
  };
  productionIssues: Array<{ _id: string; description: string; severity: string; raisedAt: string; resolvedAt: string | null }>;
}

export interface Workload {
  engineers: Array<{ user: { _id: string; name: string; initials?: string }; orders: number; overdue: number }>;
  unassigned: number;
  qcPending: number;
  readyToDispatch: number;
  overdue: Array<{ _id: string; woNumber: string; currentCommittedDate: string }>;
}

export const prodApi = {
  orders: (q = '') => api<ProductionOrder[]>('GET', `/production/orders${q}`).then((r) => r.data),
  order: (id: string) => api<ProductionOrder>('GET', `/production/orders/${id}`).then((r) => r.data),
  workload: () => api<Workload>('GET', '/production/workload').then((r) => r.data),

  assign: (id: string, body: unknown) => api('POST', `/production/orders/${id}/assign`, body),
  setBom: (id: string, bom: unknown[]) => api('PUT', `/production/orders/${id}/bom`, { bom }),
  updateStep: (id: string, stepId: string, body: unknown) =>
    api('PATCH', `/production/orders/${id}/steps/${stepId}`, body),
  stepPhoto: (id: string, stepId: string, form: FormData) =>
    apiUpload(`/production/orders/${id}/steps/${stepId}/photo`, form),
  submitQc: (id: string, body: unknown) => api('POST', `/production/orders/${id}/qc`, body),
  decideQc: (id: string, body: unknown) => api('POST', `/production/orders/${id}/qc/decide`, body),
  authoriseDispatch: (id: string, body: unknown) =>
    api('POST', `/production/orders/${id}/dispatch-auth`, body),
  flagIssue: (id: string, body: unknown) => api('POST', `/production/orders/${id}/issues`, body),
};

export function money(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  return `₹${v.toLocaleString('en-IN')}`;
}
