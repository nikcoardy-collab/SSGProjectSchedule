import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';

interface Props {
  anchor: DOMRect;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  width?: number;
}

/**
 * A light-weight popover pinned to an element's bounding box, kept inside the viewport.
 *
 * Rendered through a portal on <body>: the schedule opens these from inside
 * `position: sticky` table cells, and a sticky cell with a z-index starts its own
 * stacking context that would otherwise trap the popover behind later rows.
 */
export default function Popover({ anchor, onClose, children, className = '', width }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: anchor.bottom + 6, left: anchor.left, ready: false });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    const margin = 8;
    let left = anchor.left;
    let top = anchor.bottom + 6;
    if (left + box.width > window.innerWidth - margin) {
      left = Math.max(margin, window.innerWidth - box.width - margin);
    }
    if (top + box.height > window.innerHeight - margin) {
      top = Math.max(margin, anchor.top - box.height - 6);
    }
    setPos({ top, left, ready: true });
  }, [anchor]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <>
      <div className="pop-backdrop" onMouseDown={onClose} />
      <div
        ref={ref}
        className={`pop ${className}`}
        style={{
          top: pos.top,
          left: pos.left,
          width,
          visibility: pos.ready ? 'visible' : 'hidden',
        }}
      >
        {children}
      </div>
    </>,
    document.body
  );
}
