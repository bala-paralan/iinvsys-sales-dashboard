import { Navigate, Route, Routes } from 'react-router-dom';
import { useSession } from './auth/session';
import { useMe } from './portal/useMe';
import { PortalShell } from './portal/PortalShell';
import { RequireScreen } from './portal/RequireScreen';
import { componentFor } from './portal/registry';
import { NotImplemented } from './portal/NotImplemented';
import { LoginPage } from './features/auth/LoginPage';
import { InvitePage } from './features/auth/InvitePage';

/**
 * The route tree is GENERATED from the caller's portal.
 *
 * v2 declared eleven routes as JSX literals under a single `RequireAuth`, with the
 * sidebar links permission-gated one by one and no route-level check at all — so any
 * signed-in user could type /admin, watch the page mount, and read a 403 banner. Both
 * halves now come from one server-side object (backend/src/config/portals.js): the paths
 * a role may mount and the links it is shown are the same list.
 */
function Authenticated() {
  const { user, restoring } = useSession();
  const { data: me, isLoading } = useMe();

  if (restoring) return null;
  if (!user) return <Navigate to="/login" replace />;
  if (isLoading || !me) return null;

  return <PortalShell me={me} />;
}

/**
 * The whole route tree depends on /api/meta/me, so a failure there is not a page that
 * degrades — it is no page at all. Say so, rather than rendering blank forever.
 */
function SessionUnavailable({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="login-wrap">
      <div className="card" style={{ maxWidth: 460, margin: '80px auto', padding: 28 }}>
        <h1 className="page-title">Session <em>unavailable</em></h1>
        <div className="page-sub">// COULD NOT LOAD YOUR PERMISSIONS</div>
        <div className="offline-banner" style={{ marginTop: 16 }}>
          The server did not return your role and portal, so there is nothing to render.
          This is usually the API being unreachable.
        </div>
        <button className="neo-btn gold" style={{ marginTop: 16 }} onClick={onRetry}>
          Retry
        </button>
      </div>
    </div>
  );
}

function PortalRoutes() {
  const { user, restoring } = useSession();
  const { data: me, isLoading, isError, refetch } = useMe();

  if (restoring) return null;
  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/invite/:token" element={<InvitePage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }
  if (isError) return <SessionUnavailable onRetry={() => refetch()} />;
  if (isLoading || !me) return null;

  const routes = me.portal?.routes ?? [];

  return (
    <Routes>
      <Route path="/login" element={<Navigate to={me.portal?.landing ?? '/login'} replace />} />
      <Route path="/invite/:token" element={<InvitePage />} />

      <Route element={<Authenticated />}>
        {routes.map((r) => {
          const Screen = componentFor(r.screen);
          const element = Screen
            ? <RequireScreen me={me} screen={r.screen}><Screen /></RequireScreen>
            : <NotImplemented screen={r.screen} />;
          return <Route key={r.path} path={r.path} element={element} />;
        })}

        {/* Anything else goes to this role's own landing page — never to a shared
            default, which in v2 sent every operational role to /leads and a 403. */}
        <Route path="*" element={<Navigate to={me.portal?.landing ?? '/login'} replace />} />
      </Route>
    </Routes>
  );
}

export function App() {
  return <PortalRoutes />;
}
