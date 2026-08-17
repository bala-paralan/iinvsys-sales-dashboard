import { Navigate, NavLink, Outlet, Route, Routes } from 'react-router-dom';
import { useSession } from './auth/session';
import { usePipeline, can } from './meta/usePipeline';
import { NotificationBell } from './components/NotificationBell';
import { LoginPage } from './features/auth/LoginPage';
import { InvitePage } from './features/auth/InvitePage';
import { LeadsPage } from './features/leads/LeadsPage';
import { LeadDetailPage } from './features/leads/LeadDetailPage';
import { HygienePage } from './features/hygiene/HygienePage';
import { WorkOrdersPage } from './features/delivery/WorkOrdersPage';
import { WorkOrderDetailPage } from './features/delivery/WorkOrderDetailPage';
import { InstallationsPage } from './features/installation/InstallationsPage';
import { InstallationDetailPage } from './features/installation/InstallationDetailPage';
import { DashboardPage } from './features/kpis/DashboardPage';
import { NotificationsPage } from './features/notifications/NotificationsPage';
import { SettingsPage } from './features/settings/PipelineRulesPage';
import { AdminPage } from './features/admin/AdminPage';

/** Routes that require a signed-in user; waits out token restoration so a
    reload does not bounce a valid session to the login page. */
function RequireAuth() {
  const { user, restoring } = useSession();
  if (restoring) return null;
  if (!user) return <Navigate to="/login" replace />;
  return <Shell />;
}

function Shell() {
  const { user, logout } = useSession();
  const { data: meta } = usePipeline();

  return (
    <div className="shell">
      <nav className="sidebar">
        <div className="brand">IINVSYS</div>
        {can(meta, 'kpi.read') && <NavLink to="/dashboard" end>Dashboard</NavLink>}
        <NavLink to="/leads" end>Leads</NavLink>
        {/* Gated by permission, never by role name — the payload's `me` block
            is the authority. */}
        {can(meta, 'lead.read') && <NavLink to="/hygiene">Review queue</NavLink>}
        {can(meta, 'workorder.read') && <NavLink to="/delivery" end>Delivery</NavLink>}
        {can(meta, 'install.read') && <NavLink to="/installation" end>Installation</NavLink>}
        {can(meta, 'notification.read') && <NavLink to="/notifications" end>Alerts</NavLink>}
        {/* Admin is a role judgement, not a permission one — doc 04 defines no
            `agent.write` verb, and the routes behind it are requireMinRole. */}
        {['manager', 'superadmin'].includes(meta?.me.role ?? '') && (
          <NavLink to="/admin" end>Admin</NavLink>
        )}
        {['manager', 'superadmin'].includes(meta?.me.role ?? '') && (
          <NavLink to="/settings" end>Settings</NavLink>
        )}
        <div className="spacer" />
        {can(meta, 'notification.read') && (
          <div style={{ padding: '0 0 10px' }}>
            <NotificationBell />
          </div>
        )}
        <div style={{ color: 'var(--text-3)', fontSize: 12, padding: '0 10px 8px' }}>
          {user?.name} · {meta?.me.role ?? user?.role}
        </div>
        <button className="neo-btn" onClick={logout}>⏻ Logout</button>
      </nav>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      {/* Unauthenticated by necessity — the holder has no credential yet. */}
      <Route path="/invite/:token" element={<InvitePage />} />
      <Route element={<RequireAuth />}>
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/leads" element={<LeadsPage />} />
        <Route path="/leads/:id" element={<LeadDetailPage />} />
        <Route path="/hygiene" element={<HygienePage />} />
        <Route path="/delivery" element={<WorkOrdersPage />} />
        <Route path="/delivery/:id" element={<WorkOrderDetailPage />} />
        <Route path="/installation" element={<InstallationsPage />} />
        <Route path="/installation/:id" element={<InstallationDetailPage />} />
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/leads" replace />} />
      </Route>
    </Routes>
  );
}
