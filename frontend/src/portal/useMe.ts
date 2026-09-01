/**
 * The session block: who the caller is, what they may do, and which portal they get.
 *
 * Separate from usePipeline() and never cached across a role change. The pipeline
 * payload is cached with `staleTime: Infinity` keyed on its `version` hash, which is the
 * right invalidation signal for stage tables and the WRONG one for permissions — while
 * `me` rode along inside it, changing someone's role changed what the server sent and
 * changed nothing about what their open tab believed.
 *
 * The portal comes from the server (backend/src/config/portals.js) for the same reason
 * every stage and enum does: a hardcoded role list in this directory would be a defect.
 */
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';

export interface NavItem {
  label: string;
  to: string;
  screen: string;
  badge?: string;
}

export interface NavSection {
  section: string;
  items: NavItem[];
}

export interface PortalRoute {
  path: string;
  screen: string;
  nav: boolean;
}

export interface Portal {
  key: string;
  landing: string;
  nav: NavSection[];
  routes: PortalRoute[];
  screens: string[];
}

export interface Me {
  userId: string;
  name: string;
  role: string;
  domain: string;
  permissions: string[];
  scope: {
    mode: 'own' | 'team' | 'all';
    /* A rendering hint only. The server strips the values from the payload either way —
       see backend/src/utils/redact.js — so a screen that ignores this shows an empty
       column, never someone else's numbers. */
    canSeeFinancials: boolean;
  };
  reportsTo: { id: string; name: string; role: string } | null;
  /* Every "Switch Exec ▼" picker and assignment dropdown in the specification. */
  directReports: Array<{ _id: string; name: string; role: string; domain?: string }>;
  portal: Portal | null;
}

export function useMe() {
  return useQuery({
    queryKey: ['meta', 'me'],
    queryFn: async () => (await api<Me>('GET', '/meta/me')).data,
    /* Zero, not Infinity: this is the half that changes without the pipeline changing. */
    staleTime: 0,
    refetchOnWindowFocus: true,
    retry: 1,
  });
}
