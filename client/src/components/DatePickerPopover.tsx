import { useMemo, useState } from 'react';
import Popover from './Popover';
import {
  dayOfWeek, durationDays, formatShort, fromIso, monthGrid, monthName,
  rangeBetween, todayIso,
} from '../lib/dates';

interface Props {
  anchor: DOMRect;
  value: string[];
  onClose: () => void;
  onSave: (dates: string[]) => void;
}

const DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

/**
 * Multi-day picker. Click days to toggle them; shift-click extends from the last
 * click. Whatever is picked, the schedule takes the earliest day as the start and
 * the latest as the end.
 */
export default function DatePickerPopover({ anchor, value, onClose, onSave }: Props) {
  const [picked, setPicked] = useState<string[]>([...value].sort());
  const [lastClick, setLastClick] = useState<string | null>(null);

  const initial = value[0] ?? todayIso();
  const [cursor, setCursor] = useState(() => {
    const d = fromIso(initial);
    return { year: d.getFullYear(), month: d.getMonth() };
  });

  const set = useMemo(() => new Set(picked), [picked]);
  const start = picked[0] ?? null;
  const end = picked.length ? picked[picked.length - 1] : null;
  const span = durationDays(start, end);

  const weeks = monthGrid(cursor.year, cursor.month);
  const today = todayIso();

  function shiftMonth(delta: number) {
    setCursor((c) => {
      const d = new Date(c.year, c.month + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  }

  function toggle(iso: string, shift: boolean) {
    setPicked((prev) => {
      if (shift && lastClick) {
        const [a, b] = lastClick <= iso ? [lastClick, iso] : [iso, lastClick];
        return [...new Set([...prev, ...rangeBetween(a, b)])].sort();
      }
      const next = new Set(prev);
      if (next.has(iso)) next.delete(iso);
      else next.add(iso);
      return [...next].sort();
    });
    setLastClick(iso);
  }

  function fillSpan() {
    if (!start || !end) return;
    setPicked(rangeBetween(start, end));
  }

  function pickWorkdays() {
    if (!start || !end) return;
    setPicked(rangeBetween(start, end).filter((d) => {
      const day = fromIso(d).getDay();
      return day !== 0 && day !== 6;
    }));
  }

  return (
    <Popover anchor={anchor} onClose={onClose} className="cal">
      <div className="cal-head">
        <button className="cal-nav" onClick={() => shiftMonth(-1)} aria-label="Previous month">‹</button>
        <div className="m">{monthName(cursor.month)} {cursor.year}</div>
        <button className="cal-nav" onClick={() => shiftMonth(1)} aria-label="Next month">›</button>
      </div>

      <div className="cal-grid">
        {DOW.map((d, i) => (
          <div className="cal-dow" key={i}>{d}</div>
        ))}
        {weeks.flat().map((iso, i) => {
          if (!iso) return <span className="cal-day blank" key={`b${i}`} />;
          const on = set.has(iso);
          const inSpan = !on && !!start && !!end && iso > start && iso < end;
          const weekend = [0, 6].includes(fromIso(iso).getDay());
          return (
            <button
              key={iso}
              className={[
                'cal-day',
                on ? 'on' : '',
                inSpan ? 'on span' : '',
                weekend ? 'wknd' : '',
                iso === today ? 'today' : '',
              ].join(' ')}
              title={`${dayOfWeek(iso)} ${formatShort(iso)}`}
              onClick={(e) => toggle(iso, e.shiftKey)}
            >
              {fromIso(iso).getDate()}
            </button>
          );
        })}
      </div>

      <div className="cal-foot">
        <div className="sum">
          {start ? (
            <>
              <b>{formatShort(start)} → {formatShort(end)}</b>
              {picked.length} day{picked.length === 1 ? '' : 's'} picked · {span} day span
            </>
          ) : (
            <>No days picked yet</>
          )}
        </div>
      </div>

      <div className="cal-foot" style={{ borderTop: 'none', paddingTop: 0, marginTop: 6 }}>
        <button className="btn btn-sm" onClick={fillSpan} disabled={!start} title="Select every day between start and end">
          Fill span
        </button>
        <button className="btn btn-sm" onClick={pickWorkdays} disabled={!start} title="Keep weekdays only">
          Weekdays
        </button>
        <button className="btn btn-sm" onClick={() => { setPicked([]); setLastClick(null); }}>
          Clear
        </button>
        <div style={{ flex: 1 }} />
        <button className="btn btn-sm btn-primary" onClick={() => { onSave(picked); onClose(); }}>
          Save
        </button>
      </div>

      <p className="hint" style={{ marginTop: 8 }}>
        Shift-click to select a run of days. Start and end are taken from the first and
        last day picked.
      </p>
    </Popover>
  );
}
