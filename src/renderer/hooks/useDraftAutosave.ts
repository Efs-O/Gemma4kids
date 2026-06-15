import { useEffect, useRef } from 'react';

/** Internal animations filename for the kid's in-progress editor draft. */
export const ACTIVE_DRAFT_FILENAME = '__active_draft';
const DRAFT_AUTOSAVE_DELAY_MS = 700;

/**
 * Debounced autosave of the current editor contents to the draft file so a kid's
 * unsaved edits survive a crash/restart. Extracted verbatim from App.tsx — no
 * behavior change: same delay, same trim guard, same draft source tag.
 */
export function useDraftAutosave(displayCode: string): void {
  const draftAutosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (draftAutosaveTimerRef.current) {
      clearTimeout(draftAutosaveTimerRef.current);
      draftAutosaveTimerRef.current = null;
    }
    const trimmed = displayCode.trim();
    if (!trimmed) return;
    draftAutosaveTimerRef.current = setTimeout(() => {
      void window.electronAPI.saveAnimation(ACTIVE_DRAFT_FILENAME, trimmed, 'draft');
    }, DRAFT_AUTOSAVE_DELAY_MS);
    return () => {
      if (draftAutosaveTimerRef.current) {
        clearTimeout(draftAutosaveTimerRef.current);
        draftAutosaveTimerRef.current = null;
      }
    };
  }, [displayCode]);
}
