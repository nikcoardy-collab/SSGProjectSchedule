import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { User } from '../lib/types';

export default function PeoplePage() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState<User[] | null>(null);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);

  const load = useCallback(async () => {
    try {
      setUsers(await api.allUsers());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the team');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function run(fn: () => Promise<unknown>) {
    try {
      await fn();
      setError('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work');
    }
  }

  if (!users) {
    return (
      <div className="center-note">
        <div className="spinner" />
        Loading team…
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-narrow">
        <div className="page-head">
          <div>
            <h2>People</h2>
            <p className="hint">
              Accounts are created here — there is no public sign-up. Give each person their
              username and starting password directly.
            </p>
          </div>
          <div className="spacer" />
          <button className="btn btn-primary" onClick={() => setCreating(true)}>+ New account</button>
        </div>

        {error && <div className="alert" style={{ marginBottom: 16 }}>{error}</div>}

        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Username</th>
              <th>Email</th>
              <th>Role</th>
              <th className="right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className={u.active ? '' : 'inactive'}>
                <td>
                  {u.name}
                  {u.id === me?.id && <span className="hint"> (you)</span>}
                </td>
                <td><code>{u.username}</code></td>
                <td>{u.email || <span className="hint">—</span>}</td>
                <td>
                  <span className={`chip ${u.role === 'pm' ? 'chip-pm' : 'chip-user'}`}>
                    {u.role === 'pm' ? 'Project Manager' : 'User'}
                  </span>
                  {!u.active && <span className="chip chip-cancelled" style={{ marginLeft: 6 }}>Disabled</span>}
                </td>
                <td className="right">
                  <div className="actions">
                    <button className="btn btn-sm" onClick={() => setEditing(u)}>Edit</button>
                    {u.active ? (
                      <button
                        className="btn btn-sm btn-danger"
                        disabled={u.id === me?.id}
                        onClick={() =>
                          confirm(`Disable ${u.name}'s account?`) &&
                          run(() => api.deactivateUser(u.id))
                        }
                      >
                        Disable
                      </button>
                    ) : (
                      <button
                        className="btn btn-sm"
                        onClick={() => run(() => api.updateUser(u.id, { active: true }))}
                      >
                        Re-enable
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {creating && (
        <UserModal
          user={null}
          onClose={() => setCreating(false)}
          onSave={async (draft) => {
            await api.createUser({
              username: draft.username,
              name: draft.name,
              email: draft.email,
              password: draft.password,
              role: draft.role,
            });
            await load();
          }}
        />
      )}

      {editing && (
        <UserModal
          user={editing}
          onClose={() => setEditing(null)}
          onSave={async (draft) => {
            await api.updateUser(editing.id, {
              name: draft.name,
              email: draft.email,
              role: draft.role,
              ...(draft.password ? { password: draft.password } : {}),
            });
            await load();
          }}
        />
      )}
    </div>
  );
}

interface UserDraft {
  username: string;
  name: string;
  email: string;
  password: string;
  role: 'pm' | 'user';
}

function UserModal({
  user, onClose, onSave,
}: {
  user: User | null;
  onClose: () => void;
  onSave: (draft: UserDraft) => Promise<void>;
}) {
  const [draft, setDraft] = useState<UserDraft>({
    username: user?.username ?? '',
    name: user?.name ?? '',
    email: user?.email ?? '',
    password: '',
    role: user?.role ?? 'user',
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form
        className="modal"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await onSave(draft);
            onClose();
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not save');
            setBusy(false);
          }
        }}
      >
        <div className="modal-head">
          <h3>{user ? `Edit ${user.name}` : 'New account'}</h3>
        </div>

        <div className="modal-body">
          {error && <div className="alert">{error}</div>}

          <div className="form-grid">
            <div className="field">
              <label htmlFor="uname">Full name</label>
              <input
                id="uname"
                className="input"
                value={draft.name}
                autoFocus
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </div>

            <div className="field">
              <label htmlFor="uuser">Username</label>
              <input
                id="uuser"
                className="input"
                value={draft.username}
                disabled={!!user}
                placeholder="e.g. kevin"
                onChange={(e) => setDraft({ ...draft, username: e.target.value })}
              />
            </div>

            <div className="field">
              <label htmlFor="uemail">Email (optional)</label>
              <input
                id="uemail"
                className="input"
                type="email"
                value={draft.email}
                onChange={(e) => setDraft({ ...draft, email: e.target.value })}
              />
            </div>

            <div className="field">
              <label htmlFor="urole">Role</label>
              <select
                id="urole"
                className="select"
                value={draft.role}
                onChange={(e) => setDraft({ ...draft, role: e.target.value as 'pm' | 'user' })}
              >
                <option value="user">User — contributes to stages they are PIC for</option>
                <option value="pm">Project Manager — full access</option>
              </select>
            </div>

            <div className="field span-2">
              <label htmlFor="upass">{user ? 'Reset password (leave blank to keep)' : 'Starting password'}</label>
              <input
                id="upass"
                className="input"
                type="text"
                value={draft.password}
                placeholder="at least 6 characters"
                onChange={(e) => setDraft({ ...draft, password: e.target.value })}
              />
              <p className="hint">
                Share this with them directly — they can change it from their account page.
              </p>
            </div>
          </div>
        </div>

        <div className="modal-foot">
          <div className="spacer" />
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving…' : user ? 'Save changes' : 'Create account'}
          </button>
        </div>
      </form>
    </div>
  );
}
