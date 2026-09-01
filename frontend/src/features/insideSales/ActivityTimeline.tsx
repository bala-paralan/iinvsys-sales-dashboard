import type { Activity } from './types';

/**
 * The per-customer interaction timeline.
 *
 * Doc 1 IS-EX-03 note 1 and doc 2 SA-EX-04 note 1 both insist activities belong to the
 * COMPANY, not the lead: an executive with two leads at BHEL Trichy sees one BHEL
 * timeline. This component is therefore given activities for a customer, never for a
 * lead, and is the same component on the executive's detail screen, the manager's
 * coaching view and Customer 360.
 */
const ICON: Record<string, string> = {
  call: '📞', email: '📧', visit: '🤝', whatsapp: '💬',
  meeting: '📅', note: '📝', remote_session: '💻',
};

const TYPE_LABEL: Record<string, string> = {
  call: 'Call', email: 'Email', visit: 'Site Visit', whatsapp: 'WhatsApp',
  meeting: 'Meeting', note: 'Note', remote_session: 'Remote Session',
};

export function relTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 60) return `${mins}m ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`;
  const days = Math.round(mins / (60 * 24));
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function ActivityTimeline({
  activities, emptyMessage = 'No interactions logged yet.',
}: { activities: Activity[]; emptyMessage?: string }) {
  if (!activities.length) {
    return <div className="page-sub" style={{ padding: '12px 0' }}>// {emptyMessage.toUpperCase()}</div>;
  }

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {activities.map((a) => (
        <div key={a._id} className="card" style={{ padding: 12, display: 'flex', gap: 12 }}>
          <div style={{ fontSize: 20, lineHeight: 1 }} aria-hidden>{ICON[a.type] ?? '•'}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600 }}>
              {TYPE_LABEL[a.type] ?? a.type}
              {a.durationMinutes ? ` — ${a.durationMinutes} min` : ''}
            </div>
            <div style={{ color: 'var(--text-3)', fontSize: 12, margin: '2px 0 6px' }}>
              {a.by?.name ?? 'Unknown'}
              {a.by?.role ? ` (${a.by.role.replace(/_/g, ' ')})` : ''}
              {' · '}
              {new Date(a.occurredAt).toLocaleString('en-IN', {
                day: 'numeric', month: 'short', year: 'numeric',
                hour: 'numeric', minute: '2-digit',
              })}
              {a.contact?.name ? ` · ${a.contact.name}` : ''}
            </div>
            <div style={{ whiteSpace: 'pre-wrap' }}>{a.summary}</div>
            {a.nextAction?.label && (
              <div style={{ marginTop: 6, fontSize: 12, color: 'var(--azure)' }}>
                → Next: {a.nextAction.label}
                {a.nextAction.dueAt
                  ? ` (due ${new Date(a.nextAction.dueAt).toLocaleDateString('en-IN')})`
                  : ''}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
