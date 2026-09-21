import { api } from '../../api/client';

/** SPENCO CRM brief §5 (transfers) and §7 (history) — one client for both tracks. */

export interface TransferTarget {
  _id: string; name: string; role: string; zone?: string; domain?: string;
  initials?: string; color?: string; reportsTo?: string | null;
}

export interface TransferTargets {
  canTransfer: boolean;
  roles: string[];
  targets: TransferTarget[];
}

export interface HistoryActor { id: string; name: string; role: string | null }

export interface HistoryEvent {
  at: string;
  kind: 'created' | 'assigned' | 'transferred' | 'stage' | 'gate_override' | string;
  actor: HistoryActor | null;
  summary: string;
  meta: Record<string, any>;
}

export const transferApi = {
  targets: (id: string) =>
    api<TransferTargets>('GET', `/leads/${id}/transfer-targets`).then((r) => r.data),
  transfer: (id: string, body: { to: string; note?: string }) =>
    api<{ lead: any; salesLead: any | null; crossedTrack: boolean }>('POST', `/leads/${id}/transfer`, body),
  request: (id: string, body: { reason: string; suggestedTo?: string | null }) =>
    api<any>('POST', `/leads/${id}/request-transfer`, body),
  decide: (approvalId: string, body: { status: string; to?: string | null; note?: string }) =>
    api<any>('POST', `/leads/transfer-requests/${approvalId}/decide`, body),
  history: (id: string) =>
    api<{ refId: string; events: HistoryEvent[] }>('GET', `/leads/${id}/history`).then((r) => r.data),
};
