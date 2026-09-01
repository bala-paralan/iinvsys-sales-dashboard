import { Navigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { Me } from './useMe';

/**
 * Refuses a screen the caller's portal does not list.
 *
 * v2 had no route-level gating at all: a hidden sidebar link left the URL working, the
 * page mounted, called the API and rendered a 403 banner. Both halves now come from one
 * server-side object, so a role's sidebar and its reachable routes cannot drift apart.
 *
 * A REDIRECT, not a 403 page — a refusal that distinguishes "not yours" from "does not
 * exist" lets someone map the application by typing URLs. This is UX only: the server
 * stays the authority, with every route behind requirePermission() and a boot-time
 * assertion that refuses to start if one is missing.
 */
export function RequireScreen({
  me, screen, children,
}: { me: Me | undefined; screen: string; children: ReactNode }) {
  if (!me) return null;                       // still loading; the shell renders nothing
  const allowed = me.portal?.screens.includes(screen);
  if (!allowed) return <Navigate to={me.portal?.landing ?? '/login'} replace />;
  return <>{children}</>;
}
