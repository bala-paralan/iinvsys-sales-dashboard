/**
 * screen key → component. The ONLY thing this client knows about portals.
 *
 * Everything else — which roles exist, which screens each gets, what the sidebar says,
 * what the URLs are — comes from the server (backend/src/config/portals.js), for the same
 * reason every stage and enum does. A role list hardcoded here would be exactly the
 * defect docs/requirements/10-frontend-architecture.md forbids.
 *
 * A key the server sends with no entry here renders NotImplemented rather than a blank
 * page, so a portal entry added ahead of its screen is visible instead of silent. Phase
 * 1–4 screens land by adding a key here and to SCREEN in portals.js.
 */
import type { ComponentType } from 'react';

import { DashboardPage } from '../features/kpis/DashboardPage';
import { LeadsPage } from '../features/leads/LeadsPage';
import { LeadDetailPage } from '../features/leads/LeadDetailPage';
import { HygienePage } from '../features/hygiene/HygienePage';
import { WorkOrdersPage } from '../features/delivery/WorkOrdersPage';
import { WorkOrderDetailPage } from '../features/delivery/WorkOrderDetailPage';
import { InstallationsPage } from '../features/installation/InstallationsPage';
import { InstallationDetailPage } from '../features/installation/InstallationDetailPage';
import { NotificationsPage } from '../features/notifications/NotificationsPage';
import { AdminPage } from '../features/admin/AdminPage';
import { SettingsPage } from '../features/settings/PipelineRulesPage';

export const SCREENS: Record<string, ComponentType> = {
  'kpi.dashboard':      DashboardPage,
  'lead.board':         LeadsPage,
  'lead.detail':        LeadDetailPage,
  'lead.hygiene':       HygienePage,
  'workorder.board':    WorkOrdersPage,
  'workorder.detail':   WorkOrderDetailPage,
  'install.board':      InstallationsPage,
  'install.detail':     InstallationDetailPage,
  'notification.list':  NotificationsPage,
  'platform.admin':     AdminPage,
  'platform.settings':  SettingsPage,
};

export function componentFor(screen: string): ComponentType | null {
  return SCREENS[screen] ?? null;
}
