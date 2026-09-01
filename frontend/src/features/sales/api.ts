import { api } from '../../api/client';

export interface DealUserRef {
  _id: string; name: string; role?: string; initials?: string; color?: string; domain?: string;
}

export interface Deal {
  _id: string;
  refId: string;
  name: string;
  company?: string;
  stage: string;
  value?: number | null;
  probability: number | null;
  expectedCloseDate: string | null;
  lastActivityAt: string | null;
  owner: DealUserRef | null;
  customer: { _id: string; name: string } | null;
  discount?: {
    percent: number; status: string; tier: number | null;
    justification?: string; standardPrice?: number | null;
  };
  proposal?: { version: number; sentAt: string | null };
  co?: { submittedAt: string | null; confirmedAt: string | null; poValue?: number | null };
  poNumber?: string;
  spenco?: { total?: number; qualified?: boolean } | null;
}

export interface BoardColumn {
  key: string; label: string; color: string;
  deals: Deal[];
  /** null when the caller holds no finance.read — the server does not send the parts. */
  value: number | null;
}

export interface TeamRow {
  user: DealUserRef & { target?: number };
  deals: number; open: number; won: number; lost: number;
  pipelineValue: number | null; wonValue: number | null;
  winRate: number | null; targetAchieved: number | null;
  lastActivity: { lastAt: string | null; hoursSince: number | null; severity: string } | null;
}

export const salesApi = {
  board: (q = '') => api<{ stages: BoardColumn[]; total: number }>('GET', `/deals/board${q}`)
    .then((r) => r.data),
  team: () => api<{ people: TeamRow[] }>('GET', '/deals/team').then((r) => r.data),
  forecast: () => api<any>('GET', '/deals/forecast').then((r) => r.data),

  create: (body: unknown) => api<Deal>('POST', '/deals', body).then((r) => r.data),
  deal: (id: string) => api<Deal>('GET', `/leads/${id}`).then((r) => r.data),

  requestDiscount: (id: string, body: unknown) => api<any>('POST', `/deals/${id}/discount`, body),
  decideDiscount: (id: string, body: unknown) => api<any>('POST', `/deals/discounts/${id}/decide`, body),
  recordProposal: (id: string, body: unknown) => api<any>('POST', `/deals/${id}/proposal`, body),
  submitCo: (id: string, body: unknown) => api<any>('POST', `/deals/${id}/commercial-order`, body),
  confirmCo: (id: string, body: unknown) =>
    api<any>('POST', `/deals/commercial-orders/${id}/confirm`, body),

  approvals: (kind?: string) =>
    api<any[]>('GET', `/approvals?queue=inbox${kind ? `&kind=${kind}` : ''}`).then((r) => r.data),
};

/** ₹ with Indian digit grouping, or an em dash when the server withheld the number. */
export function money(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  return `₹${v.toLocaleString('en-IN')}`;
}
