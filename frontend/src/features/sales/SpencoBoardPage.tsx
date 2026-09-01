import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { salesApi, money } from './api';
import { useMe } from '../../portal/useMe';
import { relTime } from '../insideSales/ActivityTimeline';

/**
 * The SPENCO board — SA-DIR-05, SA-MGR-05 and SA-EX-02.
 *
 * ONE component for all three. The Director's all-team board, the Manager's team board
 * and the Executive's own pipeline differ only in which rows the server returns, so
 * "what is in Negotiation" has one definition rather than three that drift.
 *
 * Column totals come from the server and are `null` for a role without `finance.read` —
 * summing client-side would produce a total whose parts that same caller is not allowed
 * to see.
 */
export function SpencoBoardPage() {
  const nav = useNavigate();
  const { data: me } = useMe();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['deals', 'board'],
    queryFn: () => salesApi.board(),
  });

  const base = `/${me?.portal?.key ?? ''}`;
  const dealPath = me?.portal?.key === 'director'
    ? '/director/sales/deals'
    : `${base}/deals`;

  const scopeLine = me?.scope.mode === 'own' ? 'YOUR OWN PIPELINE'
    : me?.scope.mode === 'team' ? 'YOUR TEAM' : 'EVERY TEAM';

  return (
    <div>
      <h1 className="page-title">SPENCO <em>pipeline</em></h1>
      <div className="page-sub">// {scopeLine} · {data?.total ?? 0} DEALS</div>

      {isError && <div className="offline-banner" role="alert" style={{ marginTop: 12 }}>
        Could not load the pipeline.
      </div>}
      {isLoading && <div className="page-sub">// LOADING</div>}

      {data && (
        <div className="kanban" style={{ marginTop: 16 }}>
          {data.stages.map((col) => (
            <div key={col.key} className="kanban-col"
              style={{ ['--col-color' as string]: col.color }}
              aria-label={`${col.label}, ${col.deals.length} deals`}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <strong style={{ color: col.color }}>{col.label}</strong>
                <span style={{ color: 'var(--text-3)', fontSize: 12 }}>{col.deals.length}</span>
              </div>
              {col.value !== null && (
                <div style={{ color: 'var(--text-3)', fontSize: 12, marginBottom: 8 }}>
                  {money(col.value)}
                </div>
              )}

              {col.deals.map((d) => (
                <div key={d._id} className="lead-card"
                  style={{ cursor: 'pointer', marginBottom: 8 }}
                  onClick={() => nav(`${dealPath}/${d._id}`)}>
                  <div style={{ fontWeight: 600 }}>{d.company || d.name}</div>
                  <div style={{ color: 'var(--text-3)', fontSize: 12 }}>
                    {d.refId} · {d.owner?.name ?? 'unassigned'}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 12 }}>
                    <span>{money(d.value)}</span>
                    {!!d.discount?.percent && (
                      <span style={{
                        color: d.discount.status === 'pending' ? 'var(--amber)' : 'var(--emerald)',
                      }}>
                        −{d.discount.percent}%{d.discount.status === 'pending' ? ' (pending)' : ''}
                      </span>
                    )}
                  </div>
                  <div style={{ color: 'var(--text-4)', fontSize: 11, marginTop: 4 }}>
                    {d.lastActivityAt ? relTime(d.lastActivityAt) : '⚠ no activity'}
                  </div>
                </div>
              ))}

              {!col.deals.length && (
                <div style={{ color: 'var(--text-4)', fontSize: 12, padding: '8px 0' }}>—</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
