import { Fragment, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Phase, Project, Task, TaskStatus, User } from '../lib/types';
import {
  addDays, dayOfWeek, diffDays, durationDays, formatShort, isWeekend,
  rangeBetween, shortDay, startOfWeek, todayIso,
} from '../lib/dates';
import DatePickerPopover from './DatePickerPopover';
import StatusPill from './StatusPill';
import Popover from './Popover';

interface Props {
  project: Project;
  users: User[];
  isPM: boolean;
  currentUserId: number;
  onOpenDay: (task: Task, iso: string) => void;
  onAddTask: (phaseId: number) => void;
  onEditTask: (task: Task) => void;
  onDeleteTask: (task: Task) => void;
  onPatchTask: (taskId: number, patch: Record<string, unknown>) => void;
  onAssignPic: (phaseId: number, userId: number | null) => void;
  onDeletePhase: (phase: Phase) => void;
}

/** Every day the chart needs to show, padded a little on each side for breathing room. */
function useTimeline(project: Project) {
  return useMemo(() => {
    const days: string[] = [];
    for (const phase of project.phases) {
      for (const task of phase.tasks) {
        if (task.startDate) days.push(task.startDate);
        if (task.endDate) days.push(task.endDate);
      }
    }
    days.push(project.startDate);
    const min = days.reduce((a, b) => (a < b ? a : b));
    const max = days.reduce((a, b) => (a > b ? a : b));
    const from = startOfWeek(addDays(min, -3));
    const to = addDays(from, Math.max(41, diffDays(from, addDays(max, 4))));
    return rangeBetween(from, to);
  }, [project]);
}

interface WeekBand {
  label: string;
  span: number;
}

function weekBands(timeline: string[]): WeekBand[] {
  const bands: WeekBand[] = [];
  timeline.forEach((iso) => {
    const monday = startOfWeek(iso);
    const last = bands[bands.length - 1];
    const label = `Week of ${formatShort(monday)}`;
    if (last && last.label === label) last.span += 1;
    else bands.push({ label, span: 1 });
  });
  return bands;
}

/** Rolls a phase's child tasks up into one date range for the phase header row. */
export function phaseSpan(phase: Phase) {
  const starts = phase.tasks.map((t) => t.startDate).filter(Boolean) as string[];
  const ends = phase.tasks.map((t) => t.endDate).filter(Boolean) as string[];
  if (!starts.length || !ends.length) return { start: null, end: null, days: 0 };
  const start = starts.reduce((a, b) => (a < b ? a : b));
  const end = ends.reduce((a, b) => (a > b ? a : b));
  return { start, end, days: durationDays(start, end) };
}

export default function GanttChart({
  project, users, isPM, currentUserId, onOpenDay,
  onAddTask, onEditTask, onDeleteTask, onPatchTask, onAssignPic, onDeletePhase,
}: Props) {
  const timeline = useTimeline(project);
  const bands = useMemo(() => weekBands(timeline), [timeline]);
  const today = todayIso();
  const wrapRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);

  // Dependency connectors: measured from the rendered cells, drawn as an SVG
  // overlay that scrolls with the chart.
  const [links, setLinks] = useState<{ key: string; d: string; blocked: boolean }[]>([]);
  const [canvas, setCanvas] = useState({ w: 0, h: 0 });

  useLayoutEffect(() => {
    function compute() {
      const table = tableRef.current;
      if (!table) return;
      const origin = table.getBoundingClientRect();
      const byId = new Map<number, Task>();
      project.phases.forEach((ph) => ph.tasks.forEach((t) => byId.set(t.id, t)));

      const next: { key: string; d: string; blocked: boolean }[] = [];
      for (const t of byId.values()) {
        if (!t.startDate || t.predecessors.length === 0) continue;
        for (const link of t.predecessors) {
          const pred = byId.get(link.id);
          if (!pred?.endDate) continue;
          const endCell = table.querySelector(
            `tr[data-task-id="${pred.id}"] td[data-iso="${pred.endDate}"]`
          );
          const startCell = table.querySelector(
            `tr[data-task-id="${t.id}"] td[data-iso="${t.startDate}"]`
          );
          if (!endCell || !startCell) continue;
          const a = endCell.getBoundingClientRect();
          const b = startCell.getBoundingClientRect();
          const x1 = a.right - origin.left - 3;
          const y1 = a.top - origin.top + a.height / 2;
          const x2 = b.left - origin.left + 1;
          const y2 = b.top - origin.top + b.height / 2;
          const bendX = Math.max(x1 + 7, x2 - 7);
          const d =
            y1 === y2
              ? `M ${x1} ${y1} L ${x2} ${y2}`
              : `M ${x1} ${y1} H ${bendX} V ${y2} H ${x2}`;
          next.push({ key: `${pred.id}-${t.id}`, d, blocked: link.status !== 'Complete' });
        }
      }
      setCanvas({ w: table.offsetWidth, h: table.offsetHeight });
      setLinks(next);
    }
    compute();
    window.addEventListener('resize', compute);
    return () => window.removeEventListener('resize', compute);
  }, [project, timeline]);

  const [datePicker, setDatePicker] = useState<{ task: Task; anchor: DOMRect } | null>(null);
  const [picMenu, setPicMenu] = useState<{ phase: Phase; anchor: DOMRect } | null>(null);
  const [phaseMenu, setPhaseMenu] = useState<{ phase: Phase; anchor: DOMRect } | null>(null);

  const canEditPhase = (phase: Phase) => isPM || phase.picUserId === currentUserId;

  /** Clicking an empty day cell on the chart adds that day to the item. */
  function addDay(task: Task, iso: string) {
    const current = task.selectedDates.length
      ? [...task.selectedDates]
      : task.startDate && task.endDate
        ? rangeBetween(task.startDate, task.endDate)
        : [];
    if (current.includes(iso)) return;
    onPatchTask(task.id, { selectedDates: [...current, iso].sort() });
  }

  function taskCells(task: Task, editable: boolean) {
    const filled = new Set(
      task.selectedDates.length
        ? task.selectedDates
        : task.startDate && task.endDate
          ? rangeBetween(task.startDate, task.endDate)
          : []
    );
    return timeline.map((iso) => {
      const on = filled.has(iso);
      const classes = ['gday'];
      if (!on) classes.push('free');
      if (isWeekend(iso)) classes.push('wknd');
      if (iso === today) classes.push('today');
      if (on) {
        const shown = task.blocked ? 'Blocked' : task.status;
        classes.push(`s-${shown.toLowerCase().replace(/\s+/g, '')}`);
        if (!filled.has(addDays(iso, -1))) classes.push('b-start');
        if (!filled.has(addDays(iso, 1))) classes.push('b-end');
      }
      // Occupied days open their details for anyone; empty days are only
      // clickable for people who can edit this stage.
      const meta = task.dayMeta?.[iso];
      if (on || editable) classes.push('clickable');
      const title = on
        ? `${shortDay(iso)} — ${task.name}: open day details${
            meta ? ` (${meta.comments ? `${meta.comments} comment${meta.comments === 1 ? '' : 's'}` : ''}${meta.comments && meta.files ? ', ' : ''}${meta.files ? `${meta.files} file${meta.files === 1 ? '' : 's'}` : ''})` : ''
          }`
        : editable
          ? `Add ${shortDay(iso)} — ${task.name}`
          : undefined;
      return (
        <td
          key={iso}
          data-iso={iso}
          className={classes.join(' ')}
          title={title}
          onClick={
            on
              ? () => onOpenDay(task, iso)
              : editable
                ? () => addDay(task, iso)
                : undefined
          }
        >
          {on && <i>{meta ? <span className="meta-dot" /> : null}</i>}
        </td>
      );
    });
  }

  function phaseCells(phase: Phase) {
    const { start, end } = phaseSpan(phase);
    const filled = new Set(start && end ? rangeBetween(start, end) : []);
    return timeline.map((iso) => (
      <td
        key={iso}
        className={`gday${filled.has(iso) ? ' rollup' : ''}${iso === today ? ' today' : ''}`}
      >
        {filled.has(iso) && <i />}
      </td>
    ));
  }

  return (
    <div className="gantt-wrap" ref={wrapRef}>
      <table className="gantt" ref={tableRef}>
        <thead>
          <tr>
            <th className="sticky-col col-task label">Tasks</th>
            <th className="sticky-col col-status label">Status</th>
            <th className="sticky-col col-start label">Start</th>
            <th className="sticky-col col-end label">End</th>
            <th className="sticky-col col-days label">Days</th>
            {bands.map((b, i) => (
              <th key={i} className="week" colSpan={b.span}>{b.label}</th>
            ))}
          </tr>
          <tr>
            <th className="sticky-col col-task label" />
            <th className="sticky-col col-status label" />
            <th className="sticky-col col-start label" />
            <th className="sticky-col col-end label" />
            <th className="sticky-col col-days label" />
            {timeline.map((iso) => (
              <th
                key={iso}
                className={`day${isWeekend(iso) ? ' wknd' : ''}${iso === today ? ' today' : ''}`}
                title={`${dayOfWeek(iso)} ${formatShort(iso)}`}
              >
                {shortDay(iso)}
                <span>{dayOfWeek(iso)[0]}</span>
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {project.phases.map((phase) => {
            const span = phaseSpan(phase);
            const editable = canEditPhase(phase);
            return (
              <Fragment key={phase.id}>
                <tr className="phase-row">
                  <td className="sticky-col col-task">
                    <div className="phase-cell">
                      <span className="phase-name">{phase.name}</span>
                      <button
                        className={`phase-pic${isPM ? ' editable' : ''}${phase.picName ? '' : ' unassigned'}`}
                        onClick={(e) =>
                          isPM ? setPicMenu({ phase, anchor: e.currentTarget.getBoundingClientRect() }) : undefined
                        }
                        title={isPM ? 'Assign the person in charge' : 'Person in charge'}
                      >
                        {phase.picName ? `PIC: ${phase.picName}` : 'No PIC'}
                      </button>
                      <div className="spacer" />
                      {editable && (
                        <button
                          className="phase-add"
                          title="Add a sub-timeline item"
                          onClick={() => onAddTask(phase.id)}
                        >
                          +
                        </button>
                      )}
                      {isPM && (
                        <button
                          className="phase-add"
                          title="Stage options"
                          onClick={(e) =>
                            setPhaseMenu({ phase, anchor: e.currentTarget.getBoundingClientRect() })
                          }
                        >
                          ⋯
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="sticky-col col-status summary">
                    {phase.tasks.length
                      ? `${phase.tasks.filter((t) => t.status === 'Complete').length}/${phase.tasks.length} done`
                      : '—'}
                  </td>
                  <td className="sticky-col col-start summary">{formatShort(span.start)}</td>
                  <td className="sticky-col col-end summary">{formatShort(span.end)}</td>
                  <td className="sticky-col col-days summary">{span.days || '—'}</td>
                  {phaseCells(phase)}
                </tr>

                {phase.tasks.map((task) => (
                  <tr className="task-row" key={task.id} data-task-id={task.id}>
                    <td className="sticky-col col-task">
                      <div className="task-cell">
                        <button
                          className={`task-name${editable ? '' : ' readonly'}`}
                          onClick={() => (editable ? onEditTask(task) : undefined)}
                          title={task.notes || task.name}
                        >
                          {task.name}
                          {task.assigneeName ? (
                            <span style={{ color: 'var(--muted)' }}> · {task.assigneeName}</span>
                          ) : null}
                          {task.predecessors.length > 0 ? (
                            <span style={{ color: 'var(--muted)' }}>
                              {' '}· after {task.predecessors.map((p) => p.name).join(', ')}
                            </span>
                          ) : null}
                        </button>
                        {editable && (
                          <div className="row-tools">
                            <button className="icon-btn" title="Edit" onClick={() => onEditTask(task)}>✎</button>
                            <button
                              className="icon-btn danger"
                              title="Delete"
                              onClick={() => onDeleteTask(task)}
                            >
                              ✕
                            </button>
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="sticky-col col-status cell-status">
                      <StatusPill
                        status={task.status}
                        editable={editable}
                        blockedBy={
                          task.blocked
                            ? task.predecessors
                                .filter((p) => p.status !== 'Complete')
                                .map((p) => p.name)
                                .join(', ')
                            : null
                        }
                        onChange={(status: TaskStatus) => onPatchTask(task.id, { status })}
                      />
                    </td>
                    <td className="sticky-col col-start cell-date">
                      <button
                        className={`date-btn${editable ? '' : ' readonly'}${task.startDate ? '' : ' empty'}`}
                        onClick={(e) =>
                          editable
                            ? setDatePicker({ task, anchor: e.currentTarget.getBoundingClientRect() })
                            : undefined
                        }
                      >
                        {formatShort(task.startDate)}
                      </button>
                    </td>
                    <td className="sticky-col col-end cell-date">
                      <button
                        className={`date-btn${editable ? '' : ' readonly'}${task.endDate ? '' : ' empty'}`}
                        onClick={(e) =>
                          editable
                            ? setDatePicker({ task, anchor: e.currentTarget.getBoundingClientRect() })
                            : undefined
                        }
                      >
                        {formatShort(task.endDate)}
                      </button>
                    </td>
                    <td className="sticky-col col-days cell-days">
                      {durationDays(task.startDate, task.endDate) || '—'}
                    </td>
                    {taskCells(task, editable)}
                  </tr>
                ))}

                {editable && (
                  <tr className="task-row">
                    <td className="sticky-col col-task">
                      <div className="task-cell add-task-cell">
                        <button className="add-task-btn" onClick={() => onAddTask(phase.id)}>
                          + Add item to {phase.name}
                        </button>
                      </div>
                    </td>
                    <td className="sticky-col col-status" />
                    <td className="sticky-col col-start" />
                    <td className="sticky-col col-end" />
                    <td className="sticky-col col-days" />
                    {timeline.map((iso) => (
                      <td key={iso} className={`gday free${isWeekend(iso) ? ' wknd' : ''}`} />
                    ))}
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>

      {links.length > 0 && (
        <svg className="dep-lines" width={canvas.w} height={canvas.h} aria-hidden="true">
          <defs>
            <marker id="dep-arrow" markerWidth="7" markerHeight="7" refX="5.5" refY="3.5" orient="auto">
              <path d="M 0 0.5 L 6 3.5 L 0 6.5 Z" fill="#8a6d3b" />
            </marker>
            <marker id="dep-arrow-blocked" markerWidth="7" markerHeight="7" refX="5.5" refY="3.5" orient="auto">
              <path d="M 0 0.5 L 6 3.5 L 0 6.5 Z" fill="#a3382f" />
            </marker>
          </defs>
          {links.map((l) => (
            <path
              key={l.key}
              d={l.d}
              className={l.blocked ? 'blocked' : ''}
              markerEnd={l.blocked ? 'url(#dep-arrow-blocked)' : 'url(#dep-arrow)'}
            />
          ))}
        </svg>
      )}

      {datePicker && (
        <DatePickerPopover
          anchor={datePicker.anchor}
          value={
            datePicker.task.selectedDates.length
              ? datePicker.task.selectedDates
              : datePicker.task.startDate && datePicker.task.endDate
                ? rangeBetween(datePicker.task.startDate, datePicker.task.endDate)
                : []
          }
          onClose={() => setDatePicker(null)}
          onSave={(dates) => onPatchTask(datePicker.task.id, { selectedDates: dates })}
        />
      )}

      {picMenu && (
        <Popover anchor={picMenu.anchor} onClose={() => setPicMenu(null)} className="pop-menu">
          <div className="group-label">Person in charge</div>
          <button
            className={picMenu.phase.picUserId === null ? 'on' : ''}
            onClick={() => {
              onAssignPic(picMenu.phase.id, null);
              setPicMenu(null);
            }}
          >
            Unassigned
          </button>
          <div className="sep" />
          {users.map((u) => (
            <button
              key={u.id}
              className={picMenu.phase.picUserId === u.id ? 'on' : ''}
              onClick={() => {
                onAssignPic(picMenu.phase.id, u.id);
                setPicMenu(null);
              }}
            >
              {u.name}
              <span className={`chip ${u.role === 'pm' ? 'chip-pm' : 'chip-user'}`}>
                {u.role === 'pm' ? 'PM' : 'User'}
              </span>
            </button>
          ))}
        </Popover>
      )}

      {phaseMenu && (
        <Popover anchor={phaseMenu.anchor} onClose={() => setPhaseMenu(null)} className="pop-menu">
          <button
            onClick={() => {
              onAddTask(phaseMenu.phase.id);
              setPhaseMenu(null);
            }}
          >
            Add sub-timeline item
          </button>
          <div className="sep" />
          <button
            style={{ color: 'var(--danger)' }}
            onClick={() => {
              onDeletePhase(phaseMenu.phase);
              setPhaseMenu(null);
            }}
          >
            Delete stage
          </button>
        </Popover>
      )}
    </div>
  );
}
