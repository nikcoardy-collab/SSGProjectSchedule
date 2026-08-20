import { useState } from 'react';
import type { Project, ProjectStatus, User } from '../lib/types';
import { PROJECT_STATUSES } from '../lib/types';
import { todayIso } from '../lib/dates';

export const DEFAULT_PHASES = [
  'Tender',
  'Procurement',
  'Production',
  'Installation',
  'Handover',
  'Calibration / Testing / Final Handover',
];

export interface ProjectDraft {
  name: string;
  company: string;
  location: string;
  client: string;
  description: string;
  startDate: string;
  status: ProjectStatus;
  phasePics: (number | null)[];
}

interface Props {
  project: Project | null;
  users: User[];
  onClose: () => void;
  onSave: (draft: ProjectDraft) => Promise<void>;
}

export default function ProjectModal({ project, users, onClose, onSave }: Props) {
  const [draft, setDraft] = useState<ProjectDraft>(() => ({
    name: project?.name ?? '',
    company: project?.company ?? '',
    location: project?.location ?? '',
    client: project?.client ?? '',
    description: project?.description ?? '',
    startDate: project?.startDate ?? todayIso(),
    status: project?.status ?? 'Active',
    phasePics: project
      ? project.phases.map((p) => p.picUserId)
      : DEFAULT_PHASES.map(() => null),
  }));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.name.trim()) {
      setError('The project needs a name');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await onSave({ ...draft, name: draft.name.trim() });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the project');
      setBusy(false);
    }
  }

  const phaseNames = project ? project.phases.map((p) => p.name) : DEFAULT_PHASES;

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="modal modal-wide" onSubmit={submit}>
        <div className="modal-head">
          <h3>{project ? 'Project details' : 'New project'}</h3>
        </div>

        <div className="modal-body">
          {error && <div className="alert">{error}</div>}

          <div className="form-grid">
            <div className="field span-2">
              <label htmlFor="pname">Project name</label>
              <input
                id="pname"
                className="input"
                value={draft.name}
                autoFocus
                placeholder="e.g. Playce - Alam Sutera"
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </div>

            <div className="field">
              <label htmlFor="pcompany">Company</label>
              <input
                id="pcompany"
                className="input"
                value={draft.company}
                placeholder="e.g. Berkat/Berkarya/Bersatu"
                onChange={(e) => setDraft({ ...draft, company: e.target.value })}
              />
            </div>

            <div className="field">
              <label htmlFor="pclient">Client contact</label>
              <input
                id="pclient"
                className="input"
                value={draft.client}
                onChange={(e) => setDraft({ ...draft, client: e.target.value })}
              />
            </div>

            <div className="field">
              <label htmlFor="ploc">Site / location</label>
              <input
                id="ploc"
                className="input"
                value={draft.location}
                placeholder="e.g. Alam Sutera"
                onChange={(e) => setDraft({ ...draft, location: e.target.value })}
              />
            </div>

            <div className="field">
              <label htmlFor="pstart">Start date</label>
              <input
                id="pstart"
                className="input"
                type="date"
                value={draft.startDate}
                onChange={(e) => setDraft({ ...draft, startDate: e.target.value })}
              />
            </div>

            {project && (
              <div className="field">
                <label htmlFor="pstatus">Project status</label>
                <select
                  id="pstatus"
                  className="select"
                  value={draft.status}
                  onChange={(e) => setDraft({ ...draft, status: e.target.value as ProjectStatus })}
                >
                  {PROJECT_STATUSES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
            )}

            <div className="field span-2">
              <label htmlFor="pdesc">Description</label>
              <textarea
                id="pdesc"
                className="textarea"
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              />
            </div>
          </div>

          {!project && (
            <div className="field">
              <label>Person in charge per stage</label>
              <p className="hint" style={{ marginTop: -2 }}>
                Every project starts with the six standard stages. Assign a PIC now or later —
                the PIC can add and schedule items in their own stage.
              </p>
              <div className="phase-pick-list">
                {phaseNames.map((name, i) => (
                  <div className="phase-pick" key={name}>
                    <div className="n">{i + 1}</div>
                    <div className="t">{name}</div>
                    <select
                      className="select"
                      value={draft.phasePics[i] ?? ''}
                      onChange={(e) => {
                        const next = [...draft.phasePics];
                        next[i] = e.target.value ? Number(e.target.value) : null;
                        setDraft({ ...draft, phasePics: next });
                      }}
                    >
                      <option value="">Unassigned</option>
                      {users.map((u) => (
                        <option key={u.id} value={u.id}>{u.name}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="modal-foot">
          <div className="spacer" />
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving…' : project ? 'Save changes' : 'Create project'}
          </button>
        </div>
      </form>
    </div>
  );
}
