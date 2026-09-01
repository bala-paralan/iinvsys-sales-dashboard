export interface IsUserRef {
  _id: string;
  name: string;
  role?: string;
  initials?: string;
  color?: string;
}

export interface BantDimension {
  confirmed: boolean;
  note: string;
  confirmedAt: string | null;
  confirmedBy: string | null;
}

export type BantKey = 'budget' | 'authority' | 'need' | 'timeline';

export interface IsLead {
  _id: string;
  refId: string;
  name: string;
  phone: string;
  email?: string;
  company?: string;
  jobTitle?: string;
  city?: string;
  state?: string;
  isStage: string;
  priority: 'hot' | 'high' | 'normal';
  directorManaged: boolean;
  targetFirstContactAt: string | null;
  lastActivityAt: string | null;
  owner: IsUserRef | null;
  customer: { _id: string; name: string; city?: string; domain?: string } | null;
  bant: Record<BantKey, BantDimension>;
  handoffApproval: string | null;
  convertedTo: string | null;
  createdAt: string;
  lostReason?: string;
}

export interface Activity {
  _id: string;
  type: string;
  occurredAt: string;
  durationMinutes: number | null;
  outcome: string;
  summary: string;
  contact?: { name?: string; designation?: string };
  by: IsUserRef | null;
  customer?: { _id: string; name: string } | null;
  bantUpdate?: string;
  nextAction?: { label: string; dueAt: string | null };
}

export interface Task {
  _id: string;
  title: string;
  type: string;
  dueAt: string;
  status: 'open' | 'done' | 'cancelled';
  customer?: { _id: string; name: string } | null;
  deal?: { _id: string; refId?: string; opportunityName?: string; stage?: string } | null;
}

export interface ExecRow {
  user: IsUserRef & { target?: number };
  assigned: number;
  contacted: number;
  qualified: number;
  lost: number;
  qualificationRate: number | null;
  lastActivity: {
    lastAt: string | null;
    hoursSince: number | null;
    severity: 'ok' | 'warn' | 'alert';
  } | null;
}

export interface TeamPerformance {
  execs: ExecRow[];
  unassigned: number;
  handoffsPending: number;
}

export interface Approval {
  _id: string;
  kind: string;
  status: string;
  createdAt: string;
  requestedBy: IsUserRef | null;
  payload: {
    refId?: string;
    name?: string;
    company?: string;
    note?: string;
    bant?: Record<BantKey, BantDimension>;
  };
}
