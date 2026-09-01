import { NavLink, Outlet } from 'react-router-dom';
import { useSession } from '../auth/session';
import { NotificationBell } from '../components/NotificationBell';
import { can } from '../meta/usePipeline';
import type { Me } from './useMe';

/**
 * The sidebar, rendered from the caller's portal.
 *
 * v2 had one shared shell whose links were each wrapped in an individual `can()` check,
 * with Admin and Settings gated by a hardcoded role list. ERP Bible V3 says the opposite
 * on every document header — "All screens, all flows, no shared views" — so the sidebar
 * is data now, and the same object supplies the routes, which is what stops the two
 * drifting apart.
 */
export function PortalShell({ me }: { me: Me }) {
  const { logout } = useSession();
  const portal = me.portal;

  return (
    <div className="shell">
      <nav className="sidebar">
        <div className="brand">IINVSYS</div>

        {portal?.nav.map((section) => (
          <div key={section.section} style={{ marginBottom: 14 }}>
            <div style={{
              color: 'var(--text-4)', fontSize: 10, letterSpacing: '0.12em',
              textTransform: 'uppercase', padding: '10px 10px 4px',
              fontFamily: 'var(--font-mono)',
            }}>
              {section.section}
            </div>
            {section.items.map((item) => (
              <NavLink key={item.to} to={item.to} end>{item.label}</NavLink>
            ))}
          </div>
        ))}

        {/* The user manual. Deliberately ungated: it documents what every role can and
            cannot do, and the role that most needs that is the one with the fewest
            permissions. Built from BASE_URL — '/' after cutover, '/v2/' before it. */}
        <a
          href={`${import.meta.env.BASE_URL}manual/index.html`}
          target="_blank"
          rel="noopener noreferrer"
        >
          Manual ↗
        </a>

        <div className="spacer" />

        {can(me, 'notification.read') && (
          <div style={{ padding: '0 0 10px' }}>
            <NotificationBell />
          </div>
        )}

        <div style={{ color: 'var(--text-3)', fontSize: 12, padding: '0 10px 8px' }}>
          {me.name} · {me.role.replace(/_/g, ' ')}
          {me.domain && me.domain !== 'none' && ` · ${me.domain.replace(/_/g, ' ')}`}
          {/* Doc 2 SA-MGR-01 puts this on the screen so a manager is never confused about
              why the numbers are smaller than the company's. */}
          {me.scope.mode === 'team' && (
            <div style={{ color: 'var(--text-4)', fontSize: 11, marginTop: 2 }}>
              Viewing your team only
            </div>
          )}
        </div>

        <button className="neo-btn" onClick={logout}>⏻ Logout</button>
      </nav>

      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
