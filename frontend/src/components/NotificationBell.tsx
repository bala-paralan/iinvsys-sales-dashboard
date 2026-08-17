/**
 * The notification bell — the legacy app's was decorative markup with a
 * hardcoded red dot. This one is the real feed: unread count polled on an
 * interval, dropdown from GET /api/notifications, mark-read wired through.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';

interface NotificationRow {
  _id: string;
  event: string;
  severity: 'info' | 'warn' | 'critical';
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
}

const SEVERITY_COLOR: Record<string, string> = {
  critical: 'var(--coral)',
  warn: 'var(--amber)',
  info: 'var(--azure)',
};

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();

  const unread = useQuery({
    queryKey: ['notifications', 'unread'],
    queryFn: async () => (await api<{ unread: number }>('GET', '/notifications/unread-count')).data.unread,
    refetchInterval: 30_000,
  });

  const feed = useQuery({
    queryKey: ['notifications', 'feed'],
    queryFn: async () =>
      (await api<{ notifications: NotificationRow[] }>('GET', '/notifications?limit=15')).data.notifications,
    enabled: open,
  });

  const markAllRead = useMutation({
    mutationFn: () => api('PATCH', '/notifications/read-all'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  return (
    <div style={{ position: 'relative' }}>
      <button
        className="neo-btn"
        aria-label={`Notifications — ${unread.data ?? 0} unread`}
        onClick={() => setOpen((o) => !o)}
      >
        🔔{(unread.data ?? 0) > 0 && (
          <span style={{ color: 'var(--coral)', marginLeft: 6, fontFamily: 'var(--font-mono)' }}>
            {unread.data}
          </span>
        )}
      </button>

      {open && (
        <div
          className="card"
          style={{
            position: 'absolute', right: 0, top: 'calc(100% + 8px)', width: 340,
            maxHeight: 420, overflowY: 'auto', zIndex: 50, padding: 12,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span className="form-label" style={{ margin: 0 }}>Notifications</span>
            <button
              className="neo-btn" style={{ padding: '4px 8px', fontSize: 11 }}
              disabled={markAllRead.isPending || (unread.data ?? 0) === 0}
              onClick={() => markAllRead.mutate()}
            >
              Mark all read
            </button>
          </div>

          {feed.isLoading && <p style={{ color: 'var(--text-3)', fontSize: 13 }}>Loading…</p>}
          {feed.data?.length === 0 && (
            <p style={{ color: 'var(--text-3)', fontSize: 13 }}>Nothing yet.</p>
          )}

          {feed.data?.map((n) => (
            <div
              key={n._id}
              style={{
                padding: '8px 0',
                borderBottom: '1px solid var(--surface-3)',
                opacity: n.readAt ? 0.55 : 1,
              }}
            >
              <div style={{ fontSize: 13 }}>
                <span style={{ color: SEVERITY_COLOR[n.severity] ?? 'var(--text-3)' }}>● </span>
                {n.title}
              </div>
              {n.body && (
                <div style={{ color: 'var(--text-3)', fontSize: 12, marginTop: 2 }}>{n.body}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
