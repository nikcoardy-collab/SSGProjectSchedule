import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

interface Props {
  anchor: DOMRect;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  width?: number;
}

/** A light-weight popover pinned to an element's bounding box, kept inside the viewport. */
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

  return (
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
    </>
  );
}
