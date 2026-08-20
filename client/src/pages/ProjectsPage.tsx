import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { ProjectSummary, User } from '../lib/types';
import { formatShort } from '../lib/dates';
import ProjectModal from '../components/ProjectModal';

function statusChip(status: string) {
  const map: Record<string, string> = {
    Active: 'chip-active',
    'On Hold': 'chip-hold',
    Complete: 'chip-complete',
    Cancelled: 'chip-cancelled',
  };
  return `chip ${map[status] ?? 'chip-cancelled'}`;
}

export default function ProjectsPage() {
  const { isPM } = useAuth();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      const [p, u] = await Promise.all([api.projects(), api.users()]);
      setProjects(p);
      setUsers(u);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load projects');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (error) return <div className="page"><div className="alert">{error}</div></div>;
  if (!projects) {
    return (
      <div className="center-note">
        <div className="spinner" />
        Loading projects…
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-narrow">
        <div className="page-head">
          <div>
            <h2>Projects</h2>
            <p className="hint">
              {isPM
                ? 'Every project runs through the six standard SSG stages.'
                : 'Open a project to see the timeline. You can edit the stages you are PIC for.'}
            </p>
          </div>
          <div className="spacer" />
          {isPM && (
            <button className="btn btn-primary" onClick={() => setCreating(true)}>
              + New project
            </button>
          )}
        </div>

        {projects.length === 0 ? (
          <div className="empty">
            <h3>No projects yet</h3>
            <p>
              {isPM
                ? 'Create the first project to start building its timeline.'
                : 'Your project manager has not set up a project yet.'}
            </p>
          </div>
        ) : (
          <div className="card-grid">
            {projects.map((p) => {
              const pct = p.taskCount ? Math.round((p.doneCount / p.taskCount) * 100) : 0;
              return (
                <Link className="pcard" key={p.id} to={`/projects/${p.id}`}>
                  <div className="pcard-top">
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <h3>{p.name}</h3>
                      <div className="company">{p.company || 'No company set'}</div>
                    </div>
                    <span className={statusChip(p.status)}>{p.status}</span>
                  </div>

                  <div className="progress">
                    <i style={{ width: `${pct}%` }} />
                  </div>

                  <div className="pcard-meta">
                    <span><b>{p.doneCount}</b>/{p.taskCount} items done</span>
                    <span>
                      {p.firstDay ? (
                        <>
                          <b>{formatShort(p.firstDay)}</b> → <b>{formatShort(p.lastDay)}</b>
                        </>
                      ) : (
                        <>Starts <b>{formatShort(p.startDate)}</b></>
                      )}
                    </span>
                    {p.isPic && <span className="chip chip-pic">You are PIC</span>}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      {creating && (
        <ProjectModal
          project={null}
          users={users}
          onClose={() => setCreating(false)}
          onSave={async (draft) => {
            await api.createProject({
              name: draft.name,
              company: draft.company,
              location: draft.location,
              client: draft.client,
              description: draft.description,
              startDate: draft.startDate,
              phasePics: draft.phasePics,
            });
            await load();
          }}
        />
      )}
    </div>
  );
}
