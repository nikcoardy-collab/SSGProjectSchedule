import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { ActivityEntry, Phase, Project, Task, User } from '../lib/types';
import { formatDate, formatShort } from '../lib/dates';
import GanttChart, { phaseSpan } from '../components/GanttChart';
import TaskModal from '../components/TaskModal';
import ProjectModal from '../components/ProjectModal';
import Popover from '../components/Popover';
import { initials } from '../components/Shell';

/** Timestamps arrive as ISO strings from Postgres. */
function formatWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString();
}

type Editor =
  | { kind: 'new'; phase: Phase }
  | { kind: 'edit'; phase: Phase; task: Task }
  | null;

export default function SchedulePage() {
  const { id } = useParams();
  const projectId = Number(id);
  const { user, isPM } = useAuth();

  const [project, setProject] = useState<Project | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [error, setError] = useState('');
  const [editor, setEditor] = useState<Editor>(null);
  const [editingProject, setEditingProject] = useState(false);
  const [activityAnchor, setActivityAnchor] = useState<DOMRect | null>(null);
  const [addingPhase, setAddingPhase] = useState(false);

  const load = useCallback(async () => {
    try {
      const [p, u, a] = await Promise.all([
        api.project(projectId),
        api.users(),
        api.activity(projectId),
      ]);
      setProject(p);
      setUsers(u);
      setActivity(a);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load this project');
    }
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  const totals = useMemo(() => {
    if (!project) return { tasks: 0, done: 0, start: null as string | null, end: null as string | null };
    const all = project.phases.flatMap((p) => p.tasks);
    const spans = project.phases.map(phaseSpan).filter((s) => s.start && s.end);
    return {
      tasks: all.length,
      done: all.filter((t) => t.status === 'Complete').length,
      start: spans.length ? spans.map((s) => s.start!).reduce((a, b) => (a < b ? a : b)) : null,
      end: spans.length ? spans.map((s) => s.end!).reduce((a, b) => (a > b ? a : b)) : null,
    };
  }, [project]);

  async function run(fn: () => Promise<unknown>) {
    try {
      await fn();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work');
    }
  }

  if (error && !project) return <div className="page"><div className="alert">{error}</div></div>;
  if (!project || !user) {
    return (
      <div className="center-note">
        <div className="spinner" />
        Loading schedule…
      </div>
    );
  }

  const myPhases = project.phases.filter((p) => p.picUserId === user.id);
  const pct = totals.tasks ? Math.round((totals.done / totals.tasks) * 100) : 0;

  return (
    <>
      <div className="sched-head">
        <div className="sched-title">
          <div>
            <h2>{project.name}</h2>
            <div className="sched-facts">
              <span>Company: <b>{project.company || '—'}</b></span>
              {project.location && <span>Site: <b>{project.location}</b></span>}
              {project.client && <span>Client: <b>{project.client}</b></span>}
              <span>Start: <b>{formatDate(project.startDate)}</b></span>
              {totals.start && (
                <span>Schedule: <b>{formatShort(totals.start)} → {formatShort(totals.end)}</b></span>
              )}
              <span>Progress: <b>{totals.done}/{totals.tasks} done ({pct}%)</b></span>
            </div>
          </div>
          <div className="spacer" />
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Link className="btn btn-sm" to="/">← All projects</Link>
            <button
              className="btn btn-sm"
              onClick={(e) => setActivityAnchor(e.currentTarget.getBoundingClientRect())}
            >
              Activity
            </button>
            {isPM && (
              <>
                <button className="btn btn-sm" onClick={() => setEditingProject(true)}>
                  Edit details
                </button>
                <button className="btn btn-sm" onClick={() => setAddingPhase(true)}>
                  + Stage
                </button>
              </>
            )}
          </div>
        </div>

        <div className="sched-tools">
          {myPhases.length > 0 && (
            <span className="chip chip-pic">
              You are PIC for {myPhases.map((p) => p.name).join(', ')}
            </span>
          )}
          {!isPM && myPhases.length === 0 && (
            <span className="hint">
              You have view-only access here — ask the project manager to make you PIC of a stage.
            </span>
          )}
          <div className="spacer" style={{ flex: 1 }} />
          <div className="legend">
            <span><i style={{ background: 'var(--ink)' }} />Complete</span>
            <span><i style={{ background: 'var(--gold)' }} />In progress</span>
            <span><i style={{ background: '#b8bcb2' }} />Not started</span>
            <span><i style={{ background: 'var(--danger)' }} />Blocked</span>
          </div>
        </div>
      </div>

      {error && (
        <div style={{ padding: '10px 24px' }}>
          <div className="alert" onClick={() => setError('')}>{error} (click to dismiss)</div>
        </div>
      )}

      <GanttChart
        project={project}
        users={users}
        isPM={isPM}
        currentUserId={user.id}
        onAddTask={(phaseId) => {
          const phase = project.phases.find((p) => p.id === phaseId);
          if (phase) setEditor({ kind: 'new', phase });
        }}
        onEditTask={(task) => {
          const phase = project.phases.find((p) => p.id === task.phaseId);
          if (phase) setEditor({ kind: 'edit', phase, task });
        }}
        onDeleteTask={(task) => {
          if (confirm(`Delete "${task.name}"?`)) run(() => api.deleteTask(task.id));
        }}
        onPatchTask={(taskId, patch) => run(() => api.updateTask(taskId, patch))}
        onAssignPic={(phaseId, userId) => run(() => api.updatePhase(phaseId, { picUserId: userId }))}
        onDeletePhase={(phase) => {
          if (confirm(`Delete the "${phase.name}" stage and everything in it?`)) {
            run(() => api.deletePhase(phase.id));
          }
        }}
      />

      {editor && (
        <TaskModal
          phase={editor.phase}
          task={editor.kind === 'edit' ? editor.task : null}
          users={users}
          linkOptions={project.phases.flatMap((ph) =>
            ph.tasks.map((t) => ({
              id: t.id, name: t.name, status: t.status, phaseName: ph.name,
            }))
          )}
          onClose={() => setEditor(null)}
          onSave={async (draft) => {
            if (editor.kind === 'edit') {
              await api.updateTask(editor.task.id, draft);
            } else {
              await api.createTask({ ...draft, phaseId: editor.phase.id });
            }
            await load();
          }}
        />
      )}

      {editingProject && (
        <ProjectModal
          project={project}
          users={users}
          onClose={() => setEditingProject(false)}
          onSave={async (draft) => {
            await api.updateProject(project.id, {
              name: draft.name,
              company: draft.company,
              location: draft.location,
              client: draft.client,
              description: draft.description,
              startDate: draft.startDate,
              status: draft.status,
            });
            await load();
          }}
        />
      )}

      {addingPhase && (
        <AddPhaseModal
          users={users}
          onClose={() => setAddingPhase(false)}
          onSave={async (name, picUserId) => {
            await api.addPhase(project.id, name, picUserId);
            await load();
          }}
        />
      )}

      {activityAnchor && (
        <Popover
          anchor={activityAnchor}
          onClose={() => setActivityAnchor(null)}
          width={340}
        >
          <div className="pop-title">Recent activity</div>
          <div className="side-panel" style={{ maxHeight: 380, overflow: 'auto' }}>
            {activity.length === 0 && <p className="hint">Nothing has happened yet.</p>}
            {activity.map((a) => (
              <div className="act-item" key={a.id}>
                <div className="who-dot">{initials(a.userName)}</div>
                <div className="body">
                  <b>{a.userName}</b> {a.action}
                  {a.detail ? <> — {a.detail}</> : null}
                  <br />
                  <time>{formatWhen(a.createdAt)}</time>
                </div>
              </div>
            ))}
          </div>
        </Popover>
      )}
    </>
  );
}

function AddPhaseModal({
  users, onClose, onSave,
}: {
  users: User[];
  onClose: () => void;
  onSave: (name: string, picUserId: number | null) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [pic, setPic] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form
        className="modal"
        style={{ maxWidth: 440 }}
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim()) return setError('Give the stage a name');
          setBusy(true);
          try {
            await onSave(name.trim(), pic);
            onClose();
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not add the stage');
            setBusy(false);
          }
        }}
      >
        <div className="modal-head"><h3>Add a stage</h3></div>
        <div className="modal-body">
          {error && <div className="alert">{error}</div>}
          <div className="field">
            <label htmlFor="phname">Stage name</label>
            <input
              id="phname"
              className="input"
              value={name}
              autoFocus
              onChange={(e) => setName(e.target.value)}
            />
            <p className="hint">
              This sits after the six standard stages — use it for anything a project needs
              on top of the usual flow.
            </p>
          </div>
          <div className="field">
            <label htmlFor="phpic">Person in charge</label>
            <select
              id="phpic"
              className="select"
              value={pic ?? ''}
              onChange={(e) => setPic(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">Unassigned</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="modal-foot">
          <div className="spacer" />
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>Add stage</button>
        </div>
      </form>
    </div>
  );
}
