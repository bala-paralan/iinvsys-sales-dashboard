import { api } from '../../api/client';
import type { Activity, Approval, IsLead, Task, TeamPerformance } from './types';

/* One place per endpoint, so a screen never spells a path itself. */
export const isApi = {
  leads: (q = '') => api<IsLead[]>('GET', `/is/leads${q}`).then((r) => r.data),
  lead:  (id: string) => api<IsLead>('GET', `/is/leads/${id}`).then((r) => r.data),
  team:  () => api<TeamPerformance>('GET', '/is/team').then((r) => r.data),

  create: (body: unknown) =>
    api<{ lead: IsLead; salesLead?: IsLead }>('POST', '/is/leads', body).then((r) => r.data),
  assign: (id: string, body: unknown) => api('POST', `/is/leads/${id}/assign`, body),
  bant:   (id: string, body: unknown) => api('PATCH', `/is/leads/${id}/bant`, body),
  advance: (id: string, body: unknown) => api('POST', `/is/leads/${id}/advance`, body),
  requestHandoff: (id: string, body: unknown) =>
    api('POST', `/is/leads/${id}/request-handoff`, body),
  decideHandoff: (id: string, body: unknown) =>
    api('POST', `/is/handoffs/${id}/decide`, body),

  activities: (q: string) => api<Activity[]>('GET', `/activities${q}`).then((r) => r.data),
  logActivity: (body: unknown) => api('POST', '/activities', body),
  tasks: (q = '?status=open') => api<Task[]>('GET', `/tasks${q}`).then((r) => r.data),
  completeTask: (id: string) => api('PATCH', `/tasks/${id}`, { status: 'done' }),

  handoffs: () => api<Approval[]>('GET', '/approvals?kind=is_handoff&queue=inbox')
    .then((r) => r.data),

  customer360: (id: string) => api<any>('GET', `/customers/${id}/360`).then((r) => r.data),
  customers: (q = '') => api<any[]>('GET', `/customers${q}`).then((r) => r.data),

  users: (q = '') => api<IsUserRefList>('GET', `/users${q}`).then((r) => r.data),
};

type IsUserRefList = Array<{ _id: string; name: string; role: string; domain?: string }>;
