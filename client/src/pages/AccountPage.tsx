import { useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

export default function AccountPage() {
  const { user, refresh } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setDone(false);
    if (next !== confirm) return setError('The two new passwords do not match');
    setBusy(true);
    try {
      await api.changePassword(current, next);
      setCurrent('');
      setNext('');
      setConfirm('');
      setDone(true);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change the password');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <div className="page-narrow" style={{ maxWidth: 520 }}>
        <div className="page-head">
          <div>
            <h2>Your account</h2>
            <p className="hint">
              Signed in as <b>{user?.name}</b> ({user?.username}) ·{' '}
              {user?.role === 'pm' ? 'Project Manager' : 'Contributor'}
            </p>
          </div>
        </div>

        {user?.mustChange && (
          <div className="alert alert-info" style={{ marginBottom: 16 }}>
            You are still on the password your project manager set. Choose your own below.
          </div>
        )}

        <form
          onSubmit={submit}
          style={{
            background: 'var(--card)', border: '1px solid var(--line)',
            borderRadius: 12, padding: 20, display: 'flex', flexDirection: 'column', gap: 14,
          }}
        >
          <h3>Change password</h3>
          {error && <div className="alert">{error}</div>}
          {done && <div className="alert alert-info">Password updated.</div>}

          <div className="field">
            <label htmlFor="c">Current password</label>
            <input
              id="c" className="input" type="password" value={current} required
              autoComplete="current-password"
              onChange={(e) => setCurrent(e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="n">New password</label>
            <input
              id="n" className="input" type="password" value={next} required minLength={6}
              autoComplete="new-password"
              onChange={(e) => setNext(e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="r">Repeat new password</label>
            <input
              id="r" className="input" type="password" value={confirm} required minLength={6}
              autoComplete="new-password"
              onChange={(e) => setConfirm(e.target.value)}
            />
          </div>

          <button className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving…' : 'Update password'}
          </button>
        </form>
      </div>
    </div>
  );
}
