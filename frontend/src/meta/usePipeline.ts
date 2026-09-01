/**
 * The pipeline metadata layer — the load-bearing rule of this frontend.
 *
 * docs/requirements/10-frontend-architecture.md: the client renders stage
 * columns, gate checklists, enum dropdowns and KPI targets FROM THIS PAYLOAD.
 * A hardcoded enum anywhere else in src/ is a defect, not a shortcut.
 *
 * Caching: the payload embeds `version`, a hash of the stage keys AND the
 * resolved runtime rules (R-2). Changing the SPENCO threshold in Settings
 * changes the hash, so no client keeps rendering a stale gate checklist.
 * TanStack Query holds it for the session; `staleTime: Infinity` because the
 * version hash — not time — is the invalidation signal, re-checked on login.
 */
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import fallbackJson from './pipeline-fallback.json';

export interface StageDef {
  key: string;
  order: number;
  shortCode: string;
  label: string;
  color: string;
  probability: number;
  maxDays: number | null;
  terminal: boolean;
  won: boolean;
  lost: boolean;
  reachableFromAny: boolean;
  definition: string;
  advancesOn: string;
  entryRequires: Array<{ field: string; test: string; message: string }>;
  checklistTemplate?: Array<{ key: string; label: string; required: boolean }>;
}

export interface EnumEntry {
  key: string;
  label: string;
}

export interface PipelineMeta {
  version: string;
  sales: { stages: StageDef[]; terminal: string[]; won: string; lost: string };
  delivery: { stages: StageDef[]; statuses: string[] };
  installation: { stages: StageDef[]; statuses: string[] };
  enums: Record<string, EnumEntry[]>;
  spenco: {
    dimensions: Array<{ key: string; label: string; hint?: string }>;
    maxPerDimension: number;
    maxTotal: number;
    minTotal: number;
    subGates: Record<string, number>;
  };
  rules: Record<string, unknown>;
  kpiTargets: Record<string, unknown>;
  /* `me` used to ride along here. It does not any more — see portal/useMe.ts.
     This payload is cached with `staleTime: Infinity` keyed on `version`, so while the
     per-user block lived inside it a role or permission change never reached an
     already-signed-in client. */
}

/**
 * The offline skeleton. Deliberately minimal — stage keys, labels, colours —
 * enough to draw the board's bones instead of a blank page when the API is
 * unreachable. It carries NO gates and NO enums: a gate checklist rendered
 * from stale data would tell a rep the wrong requirements, which is worse
 * than showing none. Parity with serialize() is pinned by
 * backend/tests/22-frontend-fallback-parity.test.js.
 */
export const PIPELINE_FALLBACK = fallbackJson as {
  version: 'fallback';
  sales: Array<Pick<StageDef, 'key' | 'label' | 'order' | 'color' | 'terminal' | 'won' | 'lost'>>;
};

export function usePipeline() {
  return useQuery({
    queryKey: ['meta', 'pipeline'],
    queryFn: async () => (await api<PipelineMeta>('GET', '/meta/pipeline')).data,
    staleTime: Infinity,
    retry: 1,
  });
}

/**
 * Permission check.
 *
 * Takes the session block from portal/useMe.ts, not the pipeline payload — permissions
 * change without the pipeline changing, and the two are cached on different terms.
 * Re-exported here so the ~40 existing `can(meta, 'perm')` call sites keep one import.
 */
export function can(me: { permissions: string[] } | undefined, permission: string): boolean {
  return me?.permissions.includes(permission) ?? false;
}
