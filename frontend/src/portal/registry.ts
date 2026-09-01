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

/* Phase 1 — Inside Sales (ERP Bible V3, document 1) */
import { IsTeamPage } from '../features/insideSales/IsTeamPage';
import { IsExecDrillPage } from '../features/insideSales/IsExecDrillPage';
import { IsCapturePage } from '../features/insideSales/IsCapturePage';
import { IsLeadsPage } from '../features/insideSales/IsLeadsPage';
import { IsLeadDetailPage } from '../features/insideSales/IsLeadDetailPage';
import { HandoffQueuePage } from '../features/insideSales/HandoffQueuePage';
import { IsAnalyticsPage } from '../features/insideSales/IsAnalyticsPage';
import { MyDashboardPage } from '../features/insideSales/MyDashboardPage';
import { Customer360Page } from '../features/customers/Customer360Page';
import { CustomersPage } from '../features/customers/CustomersPage';
import { TasksPage } from '../features/tasks/TasksPage';

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

  /* Phase 1 — Inside Sales */
  'is.team':            IsTeamPage,          // IS-DIR-01 / IS-HD-01
  'is.exec':            IsExecDrillPage,     // IS-DIR-02 / IS-HD-03
  'is.capture':         IsCapturePage,       // IS-DIR-03
  'is.leads':           IsLeadsPage,         // IS-HD-02 / IS-EX-02
  'is.lead':            IsLeadDetailPage,    // IS-EX-03 / IS-EX-04 / IS-EX-05
  'is.handoffs':        HandoffQueuePage,    // IS-HD-04
  'is.analytics':       IsAnalyticsPage,     // IS-DIR-05 / IS-HD-05
  'is.myDashboard':     MyDashboardPage,     // IS-EX-01
  'customer.360':       Customer360Page,     // IS-DIR-04 / SA-DIR-06
  'customer.list':      CustomersPage,
  'task.list':          TasksPage,
};

export function componentFor(screen: string): ComponentType | null {
  return SCREENS[screen] ?? null;
}
