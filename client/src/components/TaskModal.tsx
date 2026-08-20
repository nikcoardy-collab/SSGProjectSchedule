import { useState } from 'react';
import type { Phase, Task, TaskStatus, User } from '../lib/types';
import { TASK_STATUSES } from '../lib/types';
import { durationDays, formatDate, rangeBetween } from '../lib/dates';
import DatePickerPopover from './DatePickerPopover';
import DependencyPicker from './DependencyPicker';
import { statusClass } from './StatusPill';

export interface TaskDraft {
  name: string;
  status: TaskStatus;
  selectedDates: string[];
  assigneeId: number | null;
  /** Item-wide link ids while editing in the form. */
  dependsOn: number[];
  notes: string;
}

/** What the form hands back on save: the full edge list, scoped links included. */
export type TaskSave = Omit<TaskDraft, 'dependsOn'> & {
  dependsOn: { id: number; forDay: string | null }[];
};

/** Another item in the project this one can be linked to come after. */
export interface LinkOption {
  id: number;
  name: string;
  status: TaskStatus;
  phaseName: string;
}

interface Props {
  phase: Phase;
  task: Task | null;
  users: User[];
  linkOptions: LinkOption[];
  onClose: () => void;
  onSave: (draft: TaskSave) => Promise<void>;
  /** Shown when editing an existing item; hover toolbars don't exist on touch. */
  onDelete?: () => Promise<void>;
}

function initialDraft(task: Task | null): TaskDraft {
  if (!task) {
    return {
      name: '', status: 'Not Started', selectedDates: [],
      assigneeId: null, dependsOn: [], notes: '',
    };
  }
  return {
    name: task.name,
    status: task.status,
    selectedDates: task.selectedDates.length
      ? task.selectedDates
      : task.startDate && task.endDate
        ? rangeBetween(task.startDate, task.endDate)
        : [],
    assigneeId: task.assigneeId,
    dependsOn: task.predecessors.filter((p) => p.forDay === null).map((p) => p.id),
    notes: task.notes,
  };
}

export default function TaskModal({ phase, task, users, linkOptions, onClose, onSave, onDelete }: Props) {
  const [draft, setDraft] = useState<TaskDraft>(() => initialDraft(task));

  const options = linkOptions.filter((o) => o.id !== task?.id);
  const chosen = options.filter((o) => draft.dependsOn.includes(o.id));
  // While any chosen predecessor is not complete, this item is blocked and
  // cannot be started — mirror the server rule in the status field.
  const blockedByChoice = chosen.some((o) => o.status !== 'Complete');
  const blockingName = chosen.find((o) => o.status !== 'Complete')?.name;
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const start = draft.selectedDates[0] ?? null;
  const end = draft.selectedDates.length ? draft.selectedDates[draft.selectedDates.length - 1] : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.name.trim()) {
      setError('Give the item a name');
      return;
    }
    setBusy(true);
    setError('');
    try {
      // This form edits the item-wide links; day-scoped ones ride along untouched.
      const dayScoped = (task?.predecessors ?? [])
        .filter((p) => p.forDay !== null)
        .map((p) => ({ id: p.id, forDay: p.forDay }));
      await onSave({
        ...draft,
        name: draft.name.trim(),
        dependsOn: [
          ...draft.dependsOn.map((id) => ({ id, forDay: null })),
          ...dayScoped,
        ],
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="modal" onSubmit={submit}>
        <div className="modal-head">
          <h3>{task ? 'Edit item' : 'New sub-timeline item'}</h3>
          <div className="spacer" />
          <span className="chip chip-active">{phase.name}</span>
        </div>

        <div className="modal-body">
          {error && <div className="alert">{error}</div>}

          <div className="field">
            <label htmlFor="tname">Item name</label>
            <input
              id="tname"
              className="input"
              value={draft.name}
              autoFocus
              placeholder="e.g. Preliminary Survey"
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </div>

          <div className="form-grid">
            <div className="field">
              <label htmlFor="tstatus">Status</label>
              <select
                id="tstatus"
                className="select"
                value={draft.status}
                onChange={(e) => setDraft({ ...draft, status: e.target.value as TaskStatus })}
              >
                {TASK_STATUSES.map((s) => (
                  <option
                    key={s}
                    value={s}
                    disabled={blockedByChoice && (s === 'In Progress' || s === 'Complete')}
                  >
                    {s}
                  </option>
                ))}
              </select>
              {blockedByChoice && (
                <p className="hint">
                  Shows as Blocked until “{blockingName}” is completed.
                </p>
              )}
            </div>

            <div className="field">
              <label htmlFor="tassignee">Handled by</label>
              <select
                id="tassignee"
                className="select"
                value={draft.assigneeId ?? ''}
                onChange={(e) =>
                  setDraft({ ...draft, assigneeId: e.target.value ? Number(e.target.value) : null })
                }
              >
                <option value="">
                  {phase.picName ? `Stage PIC (${phase.picName})` : 'Nobody in particular'}
                </option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="field">
            <label>Comes after (optional)</label>
            <DependencyPicker
              options={options}
              value={draft.dependsOn}
              onChange={(dependsOn) => {
                const next = { ...draft, dependsOn };
                const stillBlocked = options.some(
                  (o) => dependsOn.includes(o.id) && o.status !== 'Complete'
                );
                if (stillBlocked &&
                    (next.status === 'In Progress' || next.status === 'Complete')) {
                  next.status = 'Not Started';
                }
                setDraft(next);
              }}
            />
            <p className="hint">
              Link this item to one or more items. It stays Blocked until every linked
              item is Complete, then opens by itself.
            </p>
          </div>

          <div className="field">
            <label>Dates</label>
            <button
              type="button"
              className="btn btn-block"
              style={{ justifyContent: 'space-between' }}
              onClick={(e) => setAnchor(e.currentTarget.getBoundingClientRect())}
            >
              <span>
                {start ? `${formatDate(start)} → ${formatDate(end)}` : 'Pick the days for this item'}
              </span>
              <span className={`chip ${statusClass(draft.status)}`}>
                {draft.selectedDates.length
                  ? `${draft.selectedDates.length} day${draft.selectedDates.length === 1 ? '' : 's'} · ${durationDays(start, end)} span`
                  : 'none'}
              </span>
            </button>
            <p className="hint">
              Pick as many days as you need. The start date is the first day picked and the
              end date is the last.
            </p>
          </div>

          <div className="field">
            <label htmlFor="tnotes">Notes</label>
            <textarea
              id="tnotes"
              className="textarea"
              value={draft.notes}
              placeholder="Anything the rest of the team should know"
              onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
            />
          </div>
        </div>

        <div className="modal-foot">
          {task && onDelete && (
            <button
              type="button"
              className="btn btn-danger btn-sm"
              disabled={busy}
              onClick={async () => {
                if (!confirm(`Delete "${task.name}"?`)) return;
                setBusy(true);
                try {
                  await onDelete();
                  onClose();
                } catch (err) {
                  setError(err instanceof Error ? err.message : 'Could not delete');
                  setBusy(false);
                }
              }}
            >
              Delete item
            </button>
          )}
          <div className="spacer" />
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving…' : task ? 'Save changes' : 'Add item'}
          </button>
        </div>

        {anchor && (
          <DatePickerPopover
            anchor={anchor}
            value={draft.selectedDates}
            onClose={() => setAnchor(null)}
            onSave={(dates) => setDraft({ ...draft, selectedDates: dates })}
          />
        )}
      </form>
    </div>
  );
}
