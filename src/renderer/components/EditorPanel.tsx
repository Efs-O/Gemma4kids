import React, { useEffect, useRef, useState } from 'react';
import { EditorView, basicSetup } from 'codemirror';
import { html } from '@codemirror/lang-html';
import { oneDark } from '@codemirror/theme-one-dark';
import type { AuditSummary } from '../hooks/useChat';

interface Props {
  code: string;
  onChange: (code: string) => void;
  auditResult?: AuditSummary | null;
  isStreaming: boolean;
  saveStatus?: 'unsaved' | 'saved' | null;
}

export function EditorPanel({ code, onChange, auditResult, isStreaming, saveStatus }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const wasStreamingRef = useRef(false);
  const [lastAiCode, setLastAiCode] = useState<string | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const view = new EditorView({
      doc: code,
      extensions: [
        basicSetup,
        html(),
        oneDark,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChangeRef.current(update.state.doc.toString());
        }),
      ],
      parent: containerRef.current,
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === code) {
      wasStreamingRef.current = isStreaming;
      return;
    }
    if (isStreaming) {
      const snap = view.scrollSnapshot();
      view.dispatch({ changes: { from: 0, to: current.length, insert: code } });
      view.dispatch({ effects: snap });
    } else {
      view.dispatch({ changes: { from: 0, to: current.length, insert: code } });
      if (wasStreamingRef.current) {
        view.dispatch({ effects: EditorView.scrollIntoView(0) });
      }
    }
    wasStreamingRef.current = isStreaming;
  }, [code, isStreaming]);

  const aiWasStreamingRef = useRef(false);
  useEffect(() => {
    if (!isStreaming && aiWasStreamingRef.current && code) {
      setLastAiCode(code);
    }
    aiWasStreamingRef.current = isStreaming;
  }, [isStreaming, code]);

  function handleRevert() {
    if (!lastAiCode || !viewRef.current) return;
    const view = viewRef.current;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: lastAiCode } });
  }

  const badgeText =
    auditResult && auditResult.fixes.length > 0
      ? `code checked · ${auditResult.fixes.length} fix${auditResult.fixes.length > 1 ? 'es' : ''} applied`
      : null;

  const revertDisabled = !lastAiCode || code === lastAiCode;

  return (
    <div className="editor-panel">
      <div className="editor-label">
        Your Code
        {saveStatus === 'unsaved' && <span className="editor-reminder">Save to see your changes</span>}
        {saveStatus === 'unsaved' && <span className="save-dot save-dot--unsaved" title="Unsaved changes - press Save animation before asking Gemma to review">●</span>}
        {saveStatus === 'saved' && <span className="save-dot save-dot--saved" title="Saved!">●</span>}
        {badgeText && <span className="audit-badge">{badgeText}</span>}
        <button
          className="btn-revert"
          onClick={handleRevert}
          disabled={revertDisabled}
          title="Restore Gemma's last generated code"
        >
          Back to Gemma's version
        </button>
      </div>
      <div ref={containerRef} className="editor-container" />
    </div>
  );
}
