/**
 * Modal — focus trap, focus restore, Escape to close. (N-10)
 *
 * The three things every dialog in the legacy app was missing, and each has a
 * concrete consequence for a keyboard or screen-reader user:
 *
 *   · **No trap.** Tab walks straight out of the dialog into the page behind
 *     it, which is still there and still focusable. The user is typing into a
 *     form they cannot see.
 *   · **No restore.** Closing drops focus to `<body>`, so the next Tab starts
 *     from the top of the document — the position in a long lead list is lost.
 *   · **No Escape.** The only way out is to find and click the Cancel button.
 *
 * `aria-modal` alone does not do any of this; it tells assistive tech the rest
 * of the page is inert, which is a promise this component has to keep.
 */
import { useCallback, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])',
  'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(',');

export function Modal({
  title, onClose, children, labelledBy,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  labelledBy?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  /* Captured on mount — the element that opened the dialog. */
  const opener = useRef<HTMLElement | null>(null);

  const focusable = useCallback((): HTMLElement[] => {
    if (!panelRef.current) return [];
    return Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE))
      .filter((el) => el.offsetParent !== null);
  }, []);

  useEffect(() => {
    opener.current = document.activeElement as HTMLElement | null;

    /* Focus the first control rather than the panel, so a screen reader starts
       reading the form instead of announcing an empty container. */
    const first = focusable()[0];
    (first ?? panelRef.current)?.focus();

    return () => {
      /* Restore only if the opener is still in the document — deleting a row
         from within the dialog removes the button that opened it. */
      const el = opener.current;
      if (el && document.contains(el)) el.focus();
    };
  }, [focusable]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
      if (e.key !== 'Tab') return;

      const items = focusable();
      if (!items.length) { e.preventDefault(); return; }

      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;

      /* Wrap at both ends. Also catch the case where focus has already
         escaped the panel — pull it back rather than letting it wander. */
      if (!panelRef.current?.contains(active)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [focusable, onClose]);

  return (
    <div
      className="gate-overlay"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={panelRef}
        className="gate-panel"
        role="dialog"
        aria-modal="true"
        aria-label={labelledBy ? undefined : title}
        aria-labelledby={labelledBy}
        tabIndex={-1}
      >
        {children}
      </div>
    </div>
  );
}
