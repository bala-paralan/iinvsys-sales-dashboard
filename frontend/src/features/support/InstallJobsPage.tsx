import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supportApi } from './api';
import { useMe } from '../../portal/useMe';
import { SignOffPanel } from './SignOffPanel';

/**
 * IC-HD-01 (all jobs plus a live CS SLA panel) and IC-FE-01 (my jobs only).
 *
 * The Head's version carries the CS panel because doc 4 says why: "so they know if a
 * customer is having support issues on a newly installed product." A Field Engineer gets
 * the jobs and nothing else — no CS, no other engineer's work.
 */
export function InstallJobsPage() {
  const nav = useNavigate();
  const { data: me } = useMe();
  const isHead = !!me?.permissions.includes('install.assign');
  const [signOffFor, setSignOffFor] = useState<string | null>(null);

  const { data: jobs = [], isLoading, isError } = useQuery({
    queryKey: ['installations'],
    queryFn: () => supportApi.jobs(),
  });
  const { data: sla } = useQuery({
    queryKey: ['tickets', 'sla'],
    queryFn: supportApi.sla,
    enabled: isHead,
  });

  const base = `/${me?.portal?.key ?? ''}/jobs`;
  const active = jobs.filter((j: any) => !['closed', 'cancelled'].includes(j.status));
  const awaitingSignOff = jobs.filter((j: any) => j.signOff?.signedAt && !j.signOff?.approvedAt);

  return (
    <div>
      <h1 className="page-title">
        {isHead ? <>Installation <em>dashboard</em></> : <>My <em>jobs</em></>}
      </h1>
      <div className="page-sub">
        // {isHead ? 'ALL JOBS, ALL ENGINEERS' : 'ONLY THE JOBS ASSIGNED TO YOU'}
      </div>

      {isError && <div className="offline-banner" role="alert" style={{ marginTop: 12 }}>
        Could not load installation jobs.
      </div>}
      {isLoading && <div className="page-sub">// LOADING</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, margin: '16px 0' }}>
        <Tile label="Active jobs" value={String(active.length)} />
        <Tile label="Sign-off pending" value={String(awaitingSignOff.length)}
          tone={awaitingSignOff.length ? 'var(--amber)' : undefined} />
        {isHead && sla && <Tile label="Open CS tickets" value={String(sla.open)} />}
        {isHead && sla && <Tile label="CS SLA breached" value={String(sla.breached)}
          tone={sla.breached ? 'var(--coral)' : undefined} hint="Read-only view" />}
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
          <thead>
            <tr>{['Job', 'Customer / site', 'Stage', ...(isHead ? ['Engineer'] : []),
              'Sign-off', ''].map((h) => <th key={h} className="table-th">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {jobs.map((j: any) => (
              <tr key={j._id} style={{ borderTop: '1px solid #000' }}>
                <td style={{ padding: '10px 8px', cursor: 'pointer' }}
                  onClick={() => nav(`${base}/${j._id}`)}>{j.jobNumber}</td>
                <td style={{ padding: '10px 8px' }}>
                  <strong>{j.customerSnapshot?.company}</strong>
                  <div style={{ color: 'var(--text-3)', fontSize: 12 }}>
                    {j.customerSnapshot?.city}
                  </div>
                </td>
                <td style={{ padding: '10px 8px' }}>{String(j.stage).replace(/_/g, ' ')}</td>
                {isHead && (
                  <td style={{ padding: '10px 8px' }}>
                    {j.technicianName || j.technician?.name || '—'}
                  </td>
                )}
                <td style={{ padding: '10px 8px' }}>
                  {j.signOff?.approvedAt
                    ? <span style={{ color: 'var(--emerald)' }}>approved ✓</span>
                    : j.signOff?.signedAt
                      ? <span style={{ color: 'var(--amber)' }}>awaiting Head</span>
                      : <span style={{ color: 'var(--text-3)' }}>not signed</span>}
                </td>
                <td style={{ padding: '10px 8px', textAlign: 'right' }}>
                  {!isHead && !j.signOff?.signedAt && (
                    <button className="neo-btn gold" onClick={() => setSignOffFor(j._id)}>
                      ✍ Collect sign-off
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!isLoading && !jobs.length && (
        <div className="page-sub">
          // {isHead ? 'NO JOBS YET — THEY ARRIVE WHEN A DELIVERY IS CONFIRMED WITH A SIGNED DA'
            : 'NOTHING ASSIGNED TO YOU YET'}
        </div>
      )}

      {signOffFor && (
        <SignOffPanel jobId={signOffFor}
          job={jobs.find((j: any) => j._id === signOffFor)}
          onClose={() => setSignOffFor(null)} />
      )}
    </div>
  );
}

function Tile({ label, value, hint, tone }: {
  label: string; value: string; hint?: string; tone?: string;
}) {
  return (
    <div className="card" style={{ padding: 14 }}>
      <div style={{ color: 'var(--text-3)', fontSize: 12, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 28, fontFamily: 'var(--font-display)', color: tone }}>{value}</div>
      {hint && <div style={{ color: 'var(--text-3)', fontSize: 12 }}>{hint}</div>}
    </div>
  );
}
