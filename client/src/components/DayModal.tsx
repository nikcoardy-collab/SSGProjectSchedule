import { useCallback, useEffect, useRef, useState } from 'react';
import { api, MAX_FILE_BYTES } from '../lib/api';
import DependencyPicker from './DependencyPicker';
import { prepareImageForUpload } from '../lib/images';
import type { DayDetails, Task, User } from '../lib/types';
import { dayOfWeek, formatDate } from '../lib/dates';
import { initials } from './Shell';
import { statusClass } from './StatusPill';

import type { LinkOption } from './DependencyPicker';

interface Props {
  task: Task;
  iso: string;
  currentUser: User;
  /** Whether this viewer may edit the item — remove the day, change its link. */
  canEditDays: boolean;
  /** Other items in the project this one can be linked to come after. */
  linkOptions: LinkOption[];
  onRemoveDay: () => void;
  onClose: () => void;
  /** Called after any change so the chart stays fresh. */
  onChanged: () => void;
}

function formatWhen(isoTs: string): string {
  const d = new Date(isoTs);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString();
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

const isImage = (mime: string) => /^image\//.test(mime);

export default function DayModal({
  task, iso, currentUser, canEditDays, linkOptions, onRemoveDay, onClose, onChanged,
}: Props) {
  const [details, setDetails] = useState<DayDetails | null>(null);
  const [error, setError] = useState('');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const isPM = currentUser.role === 'pm';
  // This panel edits the links scoped to THIS day's stretch of work; item-wide
  // links (and other days') are preserved untouched on every change.
  const [dependsOn, setDependsOn] = useState<number[]>(
    task.predecessors.filter((p) => p.forDay === iso).map((p) => p.id)
  );
  const [savingLink, setSavingLink] = useState(false);
  const linkChoices = linkOptions.filter((o) => o.id !== task.id);
  const itemWide = task.predecessors.filter((p) => p.forDay === null);

  async function changeDependencies(next: number[]) {
    const previous = dependsOn;
    setDependsOn(next);
    setSavingLink(true);
    setError('');
    try {
      const others = task.predecessors
        .filter((p) => p.forDay !== iso)
        .map((p) => ({ id: p.id, forDay: p.forDay }));
      await api.updateTask(task.id, {
        dependsOn: [...others, ...next.map((id) => ({ id, forDay: iso }))],
      });
      onChanged();
    } catch (err) {
      setDependsOn(previous); // the server refused (e.g. a circular chain)
      setError(err instanceof Error ? err.message : 'Could not change the links');
    } finally {
      setSavingLink(false);
    }
  }

  const refresh = useCallback(async () => {
    try {
      setDetails(await api.dayDetails(task.id, iso));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load this day');
    }
  }, [task.id, iso]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function act(fn: () => Promise<unknown>) {
    setError('');
    try {
      await fn();
      await refresh();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work');
    }
  }

  async function submitComment(e: React.FormEvent) {
    e.preventDefault();
    const body = comment.trim();
    if (!body) return;
    setBusy(true);
    await act(() => api.addDayComment(task.id, iso, body));
    setComment('');
    setBusy(false);
  }

  async function uploadFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    setUploading(true);
    setError('');
    for (const original of Array.from(list)) {
      // Photos are shrunk in the browser first, so big camera shots just work.
      const file = await prepareImageForUpload(original);
      if (file.size > MAX_FILE_BYTES) {
        setError(`"${original.name}" is larger than 4 MB and could not be compressed — try a smaller file`);
        continue;
      }
      try {
        await api.uploadDayFile(task.id, iso, file);
      } catch (err) {
        setError(err instanceof Error ? err.message : `Could not upload ${original.name}`);
      }
    }
    await refresh();
    onChanged();
    setUploading(false);
    if (fileInput.current) fileInput.current.value = '';
  }

  const photos = details?.files.filter((f) => isImage(f.mime)) ?? [];
  const docs = details?.files.filter((f) => !isImage(f.mime)) ?? [];

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal day-modal">
        <div className="modal-head">
          <div>
            <h3>{dayOfWeek(iso)}, {formatDate(iso)}</h3>
            <p className="hint" style={{ marginTop: 3 }}>
              {task.name}
              {task.assigneeName ? ` · ${task.assigneeName}` : ''}
            </p>
          </div>
          <div className="spacer" />
          <span className={`status-pill ${statusClass(task.status)}`} style={{ width: 'auto' }}>
            {task.blocked ? 'Blocked' : task.status}
          </span>
        </div>

        <div className="modal-body">
          {error && <div className="alert">{error}</div>}

          {canEditDays && (
            <div className="field">
              <label>This stretch comes after</label>
              <DependencyPicker
                options={linkChoices}
                value={dependsOn}
                disabled={savingLink}
                onChange={changeDependencies}
              />
              <p className="hint">
                Applies immediately, and only to the stretch of work around this day —
                other days of this item are not held up.
                {itemWide.length > 0 &&
                  ` Item-wide links (${itemWide.map((p) => p.name).join(', ')}) are edited in the item form.`}
              </p>
            </div>
          )}

          <div className="field">
            <label>Photos & files</label>
            {details === null ? (
              <p className="hint">Loading…</p>
            ) : details.files.length === 0 ? (
              <p className="hint">Nothing attached to this day yet.</p>
            ) : (
              <>
                {photos.length > 0 && (
                  <div className="photo-grid">
                    {photos.map((f) => (
                      <figure className="photo" key={f.id}>
                        <a href={`/api/day-files/${f.id}`} target="_blank" rel="noreferrer">
                          <img src={`/api/day-files/${f.id}`} alt={f.name} loading="lazy" />
                        </a>
                        <figcaption title={`${f.name} · ${f.userName}`}>
                          <span>{f.userName}</span>
                          {(f.userId === currentUser.id || isPM) && (
                            <button
                              type="button"
                              className="icon-btn danger"
                              title="Delete photo"
                              onClick={() =>
                                confirm(`Delete "${f.name}"?`) &&
                                act(() => api.deleteDayFile(f.id))
                              }
                            >
                              ✕
                            </button>
                          )}
                        </figcaption>
                      </figure>
                    ))}
                  </div>
                )}
                {docs.map((f) => (
                  <div className="file-chip" key={f.id}>
                    <span className="file-ico">📄</span>
                    <a href={`/api/day-files/${f.id}`}>
                      {f.name}
                    </a>
                    <span className="hint">{formatSize(f.size)} · {f.userName}</span>
                    <div style={{ flex: 1 }} />
                    {(f.userId === currentUser.id || isPM) && (
                      <button
                        type="button"
                        className="icon-btn danger"
                        title="Delete file"
                        onClick={() =>
                          confirm(`Delete "${f.name}"?`) && act(() => api.deleteDayFile(f.id))
                        }
                      >
                        ✕
                      </button>
                    )}
                  </div>
                ))}
              </>
            )}
            <div>
              <input
                ref={fileInput}
                type="file"
                multiple
                style={{ display: 'none' }}
                onChange={(e) => uploadFiles(e.target.files)}
              />
              <button
                type="button"
                className="btn btn-sm"
                disabled={uploading}
                onClick={() => fileInput.current?.click()}
              >
                {uploading ? 'Uploading…' : '+ Add photos or files'}
              </button>
              <span className="hint" style={{ marginLeft: 8 }}>
                photos are resized automatically · other files up to 4 MB
              </span>
            </div>
          </div>

          <div className="field">
            <label>Comments</label>
            {details === null ? (
              <p className="hint">Loading…</p>
            ) : details.comments.length === 0 ? (
              <p className="hint">No comments on this day yet.</p>
            ) : (
              <div className="side-panel">
                {details.comments.map((c) => (
                  <div className="act-item" key={c.id}>
                    <div className="who-dot">{initials(c.userName)}</div>
                    <div className="body">
                      <b>{c.userName}</b> <time>{formatWhen(c.createdAt)}</time>
                      <div style={{ whiteSpace: 'pre-wrap' }}>{c.body}</div>
                    </div>
                    {(c.userId === currentUser.id || isPM) && (
                      <button
                        type="button"
                        className="icon-btn danger"
                        title="Delete comment"
                        onClick={() =>
                          confirm('Delete this comment?') &&
                          act(() => api.deleteDayComment(c.id))
                        }
                      >
                        ✕
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            <form onSubmit={submitComment} style={{ display: 'flex', gap: 8 }}>
              <input
                className="input"
                placeholder="Write a comment for this day…"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
              />
              <button className="btn btn-primary" disabled={busy || !comment.trim()} type="submit">
                Post
              </button>
            </form>
          </div>
        </div>

        <div className="modal-foot">
          {canEditDays && (
            <button
              type="button"
              className="btn btn-danger btn-sm"
              onClick={() => {
                if (confirm(`Remove ${formatDate(iso)} from "${task.name}"?`)) {
                  onRemoveDay();
                  onClose();
                }
              }}
            >
              Remove this day
            </button>
          )}
          <div className="spacer" />
          <button type="button" className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
