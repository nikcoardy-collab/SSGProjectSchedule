import { useState } from 'react';
import Popover from './Popover';
import { TASK_STATUSES } from '../lib/types';
import type { TaskStatus } from '../lib/types';

export function statusClass(status: TaskStatus): string {
  return `st-${status.toLowerCase().replace(/\s+/g, '')}`;
}

interface Props {
  status: TaskStatus;
  editable: boolean;
  onChange: (status: TaskStatus) => void;
  /** Set while the item this one comes after is not Complete. */
  blockedBy?: string | null;
}

export default function StatusPill({ status, editable, onChange, blockedBy }: Props) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);

  if (blockedBy) {
    return (
      <button
        className="status-pill st-blocked readonly"
        title={`Waiting for "${blockedBy}" to be completed`}
      >
        Blocked
      </button>
    );
  }

  return (
    <>
      <button
        className={`status-pill ${statusClass(status)}${editable ? '' : ' readonly'}`}
        onClick={(e) =>
          editable ? setAnchor(e.currentTarget.getBoundingClientRect()) : undefined
        }
      >
        {status}
      </button>

      {anchor && (
        <Popover anchor={anchor} onClose={() => setAnchor(null)} className="pop-menu">
          {TASK_STATUSES.map((s) => (
            <button
              key={s}
              className={s === status ? 'on' : ''}
              onClick={() => {
                onChange(s);
                setAnchor(null);
              }}
            >
              <span className={`status-pill ${statusClass(s)}`} style={{ width: 'auto' }}>{s}</span>
            </button>
          ))}
        </Popover>
      )}
    </>
  );
}
