import { useEffect, type RefObject } from 'react';

/** EXPERIENCE.md "HUD & Diegetic UI": cursor hides after 2 s of mouse idle on the bomb scene. */
export const IDLE_CURSOR_MS = 2000;

/**
 * Hides the cursor over the given container after `idleMs` without pointer
 * activity; any pointer move/press re-shows it instantly. Scoped to the stage
 * container only — HUD/overlay elements outside the scene keep their cursor.
 */
export function useIdleCursor(
  containerRef: RefObject<HTMLElement | null>,
  idleMs: number = IDLE_CURSOR_MS,
): void {
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let timer: number | undefined;
    const hide = () => {
      el.style.cursor = 'none';
    };
    const wake = () => {
      el.style.cursor = '';
      window.clearTimeout(timer);
      timer = window.setTimeout(hide, idleMs);
    };

    el.addEventListener('pointermove', wake);
    el.addEventListener('pointerdown', wake);
    wake(); // arm the timer on mount

    return () => {
      el.removeEventListener('pointermove', wake);
      el.removeEventListener('pointerdown', wake);
      window.clearTimeout(timer);
      el.style.cursor = '';
    };
  }, [containerRef, idleMs]);
}
