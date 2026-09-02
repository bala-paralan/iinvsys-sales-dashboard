import { api } from '../../api/client';

export interface Ticket {
  _id: string; ref: string; subject: string; description?: string;
  product?: string; issueType: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  status: string;
  customer: { _id: string; name: string; city?: string } | null;
  assignedTo: { _id: string; name: string; initials?: string } | null;
  raisedAt: string; slaHours: number | null; slaDueAt: string | null;
  slaBreached: boolean; slaRemainingMs: number | null;
  resolvedAt: string | null; resolution: string;
  activities: Array<{ _id: string; type: string; summary: string; minutes: number | null;
    by: { name: string } | null; at: string }>;
}

export interface Contract {
  _id: string; ref: string; type: string; product?: string;
  customer: { _id: string; name: string; city?: string } | null;
  startsAt: string; expiresAt: string; daysToExpiry: number | null;
  status: string;
  /** Absent for a CS Agent — the server does not send it. */
  value?: number; renewalValue?: number;
  renewalLead?: string | null; renewalPushedAt?: string | null;
}

export interface SlaOverview {
  open: number; breached: number; meanResolutionHours: number | null;
  agents: Array<{
    user: { _id: string; name: string; initials?: string };
    total: number; open: number; breached: number; meanResolutionHours: number | null;
  }>;
}

export const supportApi = {
  tickets: (q = '') => api<Ticket[]>('GET', `/tickets${q}`).then((r) => r.data),
  ticket: (id: string) => api<Ticket>('GET', `/tickets/${id}`).then((r) => r.data),
  createTicket: (b: unknown) => api<Ticket>('POST', '/tickets', b).then((r) => r.data),
  updateTicket: (id: string, b: unknown) => api<Ticket>('PATCH', `/tickets/${id}`, b),
  assignTicket: (id: string, b: unknown) => api('POST', `/tickets/${id}/assign`, b),
  logActivity: (id: string, b: unknown) => api('POST', `/tickets/${id}/activities`, b),
  sla: () => api<SlaOverview>('GET', '/tickets/sla').then((r) => r.data),

  contracts: (q = '') => api<Contract[]>('GET', `/contracts${q}`).then((r) => r.data),
  renewals: (days = 30) => api<Contract[]>('GET', `/contracts/renewals?days=${days}`).then((r) => r.data),
  pushRenewal: (id: string) => api<any>('POST', `/contracts/${id}/push-to-sales`, {}),

  jobs: (q = '') => api<any[]>('GET', `/installations${q}`).then((r) => r.data),
  job: (id: string) => api<any>('GET', `/installations/${id}`).then((r) => r.data),
  submitSignOff: (id: string, b: unknown) => api<any>('POST', `/installations/${id}/sign-off`, b),
  decideSignOff: (id: string, b: unknown) => api<any>('POST', `/installations/sign-offs/${id}/decide`, b),
  signOffQueue: () => api<any[]>('GET', '/approvals?kind=signoff&queue=inbox').then((r) => r.data),
};

export const PRIORITY_COLOR: Record<string, string> = {
  critical: 'var(--coral)', high: 'var(--amber)',
  medium: 'var(--azure)', low: 'var(--text-3)',
};

/** Doc 4 renders a live countdown; a breach shows how far past, not a bare "breached". */
export function slaLabel(t: Pick<Ticket, 'slaRemainingMs' | 'slaBreached' | 'resolvedAt'>): string {
  if (t.resolvedAt) return 'resolved';
  if (t.slaRemainingMs === null) return '—';
  const mins = Math.round(Math.abs(t.slaRemainingMs) / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const span = h ? `${h}h ${m}m` : `${m}m`;
  return t.slaRemainingMs < 0 ? `BREACHED ${span} ago` : `${span} left`;
}
