import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSession } from '../../auth/session';
import { ApiError } from '../../api/client';

/** Say what actually happened — the legacy banner blamed the password for
    every failure including the server being down. */
function messageFor(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 0) return '⚠ Cannot reach the server. Is the API running?';
    if (err.status === 401) return '⚠ Invalid credentials. Try again.';
    if (err.status === 429) return '⚠ Too many failed attempts for this account. Try again in 15 minutes.';
    if (err.status >= 500) return '⚠ The server returned an error. Try again shortly.';
    return `⚠ ${err.message}`;
  }
  return '⚠ Sign-in failed.';
}

export function LoginPage() {
  const { login } = useSession();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email.trim().toLowerCase(), password);
      navigate('/leads', { replace: true });
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={onSubmit}>
        <h1>Welcome <em>Back</em></h1>
        <p className="page-sub">// IINVSYS SALES OS v2</p>

        {error && <div className="login-error" role="alert">{error}</div>}

        <div className="login-field">
          <label className="form-label" htmlFor="email">Email Address</label>
          <input
            id="email" type="email" className="form-input" autoComplete="username"
            value={email} onChange={(e) => setEmail(e.target.value)} required
          />
        </div>
        <div className="login-field">
          <label className="form-label" htmlFor="password">Password</label>
          <input
            id="password" type="password" className="form-input" autoComplete="current-password"
            value={password} onChange={(e) => setPassword(e.target.value)} required
          />
        </div>

        <button type="submit" className="neo-btn gold" disabled={busy} style={{ width: '100%' }}>
          {busy ? 'Signing in…' : 'Sign In →'}
        </button>
      </form>
    </div>
  );
}
