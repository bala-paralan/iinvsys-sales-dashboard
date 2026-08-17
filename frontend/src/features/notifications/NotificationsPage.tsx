/**
 * The notification centre — the full feed the bell only previews.
 *
 * Notifications are addressed by PERMISSION on the server, not by role name,
 * so this page shows exactly what the signed-in user is entitled to act on.
 * Each row links to the record it concerns; an alert you cannot navigate from
 * is a chore, not a signal.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';

interface NotificationRow {
  _id: string;
  event: string;
  severity: 'info' | 'warn' | 'critical';
  title: string;
  body: string;
  entityType: string | null;
  entityId: string | null;
  readAt: string | null;
  createdAt: string;
}

const SEVERITY: Record<string, { color: string; label: string }> = {
  critical: { color: 'var(--coral)', label: 'CRITICAL' },
  warn: { color: 'var(--amber)', label: 'WARNING' },
  info: { color: 'var(--azure)', label: 'INFO' },
};

/** Where a notification's subject lives in this app. */
const ROUTE: Record<string, string> = {
  lead: '/leads',
  workorder: '/delivery',
  installation: '/installation',
};

export function NotificationsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [unreadOnly, setUnreadOnly] = useState(false);

  const feed = useQuery({
    queryKey: ['notifications', 'page', unreadOnly],
    queryFn: async () => (await api<{ notifications: NotificationRow[]; unread: number }>(
      'GET', `/notifications?limit=100${unreadOnly ? '&unread=true' : ''}`)).data,
  });

  const markRead = useMutation({
    mutationFn: (id: string) => api('PATCH', `/notifications/${id}/read`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const markAllRead = useMutation({
    mutationFn: () => api('PATCH', '/notifications/read-all'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const rows = feed.data?.notifications ?? [];

  function open(n: NotificationRow) {
    if (!n.readAt) markRead.mutate(n._id);
    const base = n.entityType ? ROUTE[n.entityType] : null;
    if (base && n.entityId) navigate(`${base}/${n.entityId}`);
  }

  return (
    <>
      <h1 className="page-title">Notifications</h1>
      <div className="page-sub">// ADDRESSED BY PERMISSION, NOT BY ROLE NAME</div>

      {feed.isError && (
        <div className="offline-banner">
          Could not load notifications: {String((feed.error as Error).message)}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button
          className={`neo-btn${unreadOnly ? '' : ' gold'}`}
          onClick={() => setUnreadOnly(false)}
        >
          All
        </button>
        <button
          className={`neo-btn${unreadOnly ? ' gold' : ''}`}
          onClick={() => setUnreadOnly(true)}
        >
          Unread{feed.data ? ` (${feed.data.unread})` : ''}
        </button>
        <div style={{ flex: 1 }} />
        <button
          className="neo-btn"
          disabled={markAllRead.isPending || (feed.data?.unread ?? 0) === 0}
          onClick={() => markAllRead.mutate()}
        >
          Mark all read
        </button>
      </div>

      {feed.isLoading && <p style={{ color: 'var(--text-3)' }}>Loading…</p>}
      {!feed.isLoading && rows.length === 0 && (
        <p style={{ color: 'var(--text-3)' }}>
          {unreadOnly ? 'Nothing unread.' : 'No notifications yet.'}
        </p>
      )}

      <div style={{ display: 'grid', gap: 8 }}>
        {rows.map((n) => {
          const sev = SEVERITY[n.severity] ?? SEVERITY.info;
          const navigable = n.entityType != null && ROUTE[n.entityType] != null && n.entityId != null;
          return (
            <div
              key={n._id}
              className="card"
              role={navigable ? 'button' : undefined}
              tabIndex={navigable ? 0 : undefined}
              onClick={navigable ? () => open(n) : undefined}
              onKeyDown={navigable ? (e) => { if (e.key === 'Enter') open(n); } : undefined}
              style={{
                padding: 14,
                cursor: navigable ? 'pointer' : 'default',
                /* Read notifications stay visible but recede — deleting them
                   would destroy the only record that an alert was raised. */
                opacity: n.readAt ? 0.55 : 1,
                borderLeft: `4px solid ${sev.color}`,
              }}
            >
              <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
                <span style={{
                  color: sev.color, fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: 1,
                }}>
                  {sev.label}
                </span>
                <span style={{ fontSize: 14 }}>{n.title}</span>
                <div style={{ flex: 1 }} />
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-4)' }}>
                  {new Date(n.createdAt).toLocaleString('en-IN')}
                </span>
              </div>

              {n.body && (
                <div style={{ color: 'var(--text-3)', fontSize: 13, marginTop: 4 }}>{n.body}</div>
              )}

              <div style={{ marginTop: 6, display: 'flex', gap: 12, alignItems: 'center' }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-4)' }}>
                  {n.event}
                </span>
                {!n.readAt && (
                  <button
                    className="neo-btn"
                    style={{ padding: '2px 8px', fontSize: 11 }}
                    onClick={(e) => { e.stopPropagation(); markRead.mutate(n._id); }}
                  >
                    Mark read
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
