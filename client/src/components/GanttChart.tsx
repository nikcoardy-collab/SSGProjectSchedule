import { Fragment, useMemo, useRef, useState } from 'react';
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
  project, users, isPM, currentUserId,
  onAddTask, onEditTask, onDeleteTask, onPatchTask, onAssignPic, onDeletePhase,
}: Props) {
  const timeline = useTimeline(project);
  const bands = useMemo(() => weekBands(timeline), [timeline]);
  const today = todayIso();
  const wrapRef = useRef<HTMLDivElement>(null);

  const [datePicker, setDatePicker] = useState<{ task: Task; anchor: DOMRect } | null>(null);
  const [picMenu, setPicMenu] = useState<{ phase: Phase; anchor: DOMRect } | null>(null);
  const [phaseMenu, setPhaseMenu] = useState<{ phase: Phase; anchor: DOMRect } | null>(null);

  const canEditPhase = (phase: Phase) => isPM || phase.picUserId === currentUserId;

  function taskCells(task: Task) {
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
        classes.push(`s-${task.status.toLowerCase().replace(/\s+/g, '')}`);
        if (!filled.has(addDays(iso, -1))) classes.push('b-start');
        if (!filled.has(addDays(iso, 1))) classes.push('b-end');
      }
      return (
        <td key={iso} className={classes.join(' ')}>
          {on && <i />}
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
      <table className="gantt">
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
                  <tr className="task-row" key={task.id}>
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
                    {taskCells(task)}
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
