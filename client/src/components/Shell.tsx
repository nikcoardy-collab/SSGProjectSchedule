import type { ReactNode } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

export default function Shell({ children }: { children: ReactNode }) {
  const { user, logout, isPM } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="shell">
      <header className="topbar">
        <Link className="brand" to="/">
          <div className="brand-mark">SSG</div>
          <div className="brand-text">
            <strong>Solusi Golf Simulator</strong>
            <span>PROJECT SCHEDULE</span>
          </div>
        </Link>

        <nav className="topnav">
          <NavLink to="/" end>Projects</NavLink>
          {isPM && <NavLink to="/people">People</NavLink>}
        </nav>

        <div className="topbar-spacer" />

        <div className="who">
          <div className="who-name">
            {user?.name}
            <span>{isPM ? 'Project Manager' : 'Contributor'}</span>
          </div>
          <Link to="/account" className="avatar" title="Account settings">
            {initials(user?.name ?? '?')}
          </Link>
          <button
            className="btn btn-sm"
            onClick={async () => {
              await logout();
              navigate('/login');
            }}
          >
            Sign out
          </button>
        </div>
      </header>

      <div className="shell-body">{children}</div>
    </div>
  );
}
