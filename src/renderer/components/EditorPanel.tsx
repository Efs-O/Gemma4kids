import React, { useEffect, useRef } from 'react';
import { EditorView, basicSetup } from 'codemirror';
import { html } from '@codemirror/lang-html';
import { oneDark } from '@codemirror/theme-one-dark';
import type { AuditSummary } from '../hooks/useChat';

interface Props {
  code: string;
  onChange: (code: string) => void;
  auditResult?: AuditSummary | null;
}

export function EditorPanel({ code, onChange, auditResult }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!containerRef.current) return;
    const view = new EditorView({
      doc: code,
      extensions: [
        basicSetup,
        html(),
        oneDark,
        EditorView.updateListener.of(update => {
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
  }, []); // mount only

  // Sync AI-generated code into the editor
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === code) return;
    view.dispatch({ changes: { from: 0, to: current.length, insert: code } });
  }, [code]);

  const badgeText =
    auditResult && auditResult.fixes.length > 0
      ? `✓ code checked · ${auditResult.fixes.length} fix${auditResult.fixes.length > 1 ? 'es' : ''} applied`
      : null;

  return (
    <div className="editor-panel">
      <div className="editor-label">
        ✏️ Your Code
        {badgeText && <span className="audit-badge">{badgeText}</span>}
      </div>
      <div ref={containerRef} className="editor-container" />
    </div>
  );
}
