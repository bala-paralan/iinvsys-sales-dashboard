/**
 * Invite redemption — where a referrer chooses their own password. (N-5)
 *
 * This is the only place a referrer credential is ever set, and it is set by
 * the referrer. Nobody else — including the manager who invited them — ever
 * knows it. Previously the manager typed a password, the API echoed it back in
 * JSON, and it was relayed over WhatsApp.
 *
 * Unauthenticated by necessity: the holder has no credential yet. The token in
 * the URL *is* the credential, so it is single-use and expiring.
 */
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError, setToken } from '../../api/client';
import { useSession } from '../../auth/session';

const MIN_LENGTH = 8;

interface InviteInfo { name: string; role: string; expiresAt: string; purpose: string }

export function InvitePage() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const { adopt } = useSession();

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const info = useQuery({
    queryKey: ['invite', token],
    queryFn: async () => (await api<InviteInfo>('GET', `/auth/invite/${token}`)).data,
    retry: false,
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < MIN_LENGTH) { setError(`Use at least ${MIN_LENGTH} characters`); return; }
    /* Confirmation is client-side only: a typo in a password nobody else knows
       locks the referrer out with no recovery path. */
    if (password !== confirm) { setError('The two passwords do not match'); return; }

    setSubmitting(true);
    setError(null);
    try {
      const res = await api<{ token: string; user: { id: string; name: string; email: string; role: string } }>(
        'POST', `/auth/invite/${token}`, { password });
      setToken(res.data.token);
      adopt(res.data.user);
      /* '/' rather than a named screen: the caller's landing route comes from their
         portal, which App.tsx has not fetched yet at this moment. The catch-all sends
         them there as soon as it arrives. v2 hardcoded '/leads' here, which meant every
         operational role landed on a 403 banner the instant they signed in. */
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (info.isLoading) {
    return (
      <div className="login-wrap">
        <div className="login-card"><p style={{ color: 'var(--text-3)' }}>Checking your invitation…</p></div>
      </div>
    );
  }

  if (info.isError) {
    return (
      <div className="login-wrap">
        <div className="login-card">
          <h1 className="page-title">Invitation <em>unusable</em></h1>
          {/* Deliberately one message for unknown, expired and already-used —
              distinguishing them would let someone enumerate valid tokens. */}
          <p style={{ color: 'var(--text-3)', fontSize: 14, marginTop: 8 }}>
            This link is invalid, has expired, or has already been used.
            Ask whoever invited you to send a new one.
          </p>
          <button className="neo-btn" style={{ marginTop: 16 }} onClick={() => navigate('/login')}>
            Go to sign in
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <h1 className="page-title">Welcome, <em>{info.data?.name}</em></h1>
        <div className="page-sub">// CHOOSE A PASSWORD — ONLY YOU WILL KNOW IT</div>

        {error && <div className="login-error">{error}</div>}

        <div className="login-field">
          <label className="form-label" htmlFor="invite-password">New password</label>
          <input
            id="invite-password"
            className="form-input"
            type="password"
            autoComplete="new-password"
            minLength={MIN_LENGTH}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        <div className="login-field">
          <label className="form-label" htmlFor="invite-confirm">Confirm password</label>
          <input
            id="invite-confirm"
            className="form-input"
            type="password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </div>

        <button className="neo-btn gold" type="submit" disabled={submitting}>
          {submitting ? 'Setting…' : 'Set password & sign in →'}
        </button>

        {info.data && (
          <p style={{ color: 'var(--text-4)', fontSize: 11, fontFamily: 'var(--font-mono)', marginTop: 12 }}>
            This link expires {new Date(info.data.expiresAt).toLocaleString('en-IN')} and works once.
          </p>
        )}
      </form>
    </div>
  );
}
