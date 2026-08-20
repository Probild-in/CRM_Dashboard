import { useCallback, useEffect, useState } from 'react';

export type ViewMode = 'list' | 'board';

/**
 * Remembers the chosen view per page.
 *
 * The choice is a working preference, not data — someone who works the board
 * expects the board next time, and being dropped back into the table on every
 * visit is a small irritation repeated forever. localStorage is enough; it does
 * not need to follow them between machines.
 */
export function useViewMode(storageKey: string, fallback: ViewMode = 'list') {
  const key = `probild.view.${storageKey}`;

  const [mode, setMode] = useState<ViewMode>(() => {
    try {
      const stored = window.localStorage.getItem(key);
      return stored === 'board' || stored === 'list' ? stored : fallback;
    } catch {
      // Private browsing, or storage disabled. The default is fine.
      return fallback;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(key, mode);
    } catch {
      /* Not being able to remember the choice is not worth failing over. */
    }
  }, [key, mode]);

  return [mode, useCallback((next: ViewMode) => setMode(next), [])] as const;
}
