import { useEffect, useRef } from 'react';
import { auditHtml } from '../htmlAudit';

/** Derive a filename slug from the HTML <title>, falling back to the current name. */
function titleToFilename(html: string, fallback: string): string {
  const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (!m) return fallback;
  return m[1].trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || fallback;
}

interface Params {
  status: 'idle' | 'streaming' | 'error';
  latestCode: string | null;
  lastSaved: string | null;
  filename: string;
  /** Called after a successful auto-save with the saved filename and audited HTML. */
  onAutoSaved: (savedFilename: string, auditedHtml: string) => void;
}

/**
 * Auto-saves Gemma's freshly generated code once a stream finishes, but only when
 * the model itself didn't already save via a tool call (lastSaved unchanged since
 * the stream began). Extracted verbatim from App.tsx — same guards and `gemma`
 * source tag. `onAutoSaved` is read through a ref so its identity never re-triggers
 * the effect, matching the original (which depended on stable callbacks).
 */
export function useAutoSaveOnStreamEnd({ status, latestCode, lastSaved, filename, onAutoSaved }: Params): void {
  const pendingAutoSave = useRef(false);
  const streamStartSaved = useRef<string | null>(null);
  const filenameRef = useRef(filename);
  useEffect(() => { filenameRef.current = filename; }, [filename]);

  const onAutoSavedRef = useRef(onAutoSaved);
  onAutoSavedRef.current = onAutoSaved;

  useEffect(() => {
    if (status === 'streaming') {
      pendingAutoSave.current = true;
      streamStartSaved.current = lastSaved;
      return;
    }
    if (status !== 'idle' || !pendingAutoSave.current || !latestCode) return;
    pendingAutoSave.current = false;
    if (lastSaved !== streamStartSaved.current) return;
    const code = latestCode;
    const name = titleToFilename(code, filenameRef.current);
    void (async () => {
      const audited = auditHtml(code);
      const result = await window.electronAPI.saveAnimation(name, audited.html, 'gemma');
      if (result.success) {
        onAutoSavedRef.current(result.filename, audited.html);
      }
    })();
  }, [status, latestCode, lastSaved]);
}
