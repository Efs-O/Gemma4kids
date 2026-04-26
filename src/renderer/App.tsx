import React, { useState, useCallback, useEffect } from 'react';
import { ChatPanel } from './components/ChatPanel';
import { EditorPanel } from './components/EditorPanel';
import { ProjectList } from './components/ProjectList';
import { ErrorBoundary } from './components/ErrorBoundary';
import { useChat } from './hooks/useChat';
import { useOllama } from './hooks/useOllama';

export default function App() {
  const { status: ollamaStatus, models, recheck } = useOllama();

  // Auto-pick best available coding model — no selector exposed to kids.
  const [model, setModel] = useState('gemma4:26b');
  useEffect(() => {
    if (models.length === 0) return;
    const g26b = models.find(m => m.includes('gemma') && m.includes('26b'));
    const gemma = models.find(m => m.toLowerCase().includes('gemma'));
    setModel(g26b ?? gemma ?? models[0]);
  }, [models]);

  const e4bAvailable = models.some(m => m.includes('e4b'));

  const { messages, streamingText, latestCode, lastSaved, status, errorMsg, sendMessage, cancel, retry } = useChat(model);

  const [displayCode, setDisplayCode] = useState('');
  useEffect(() => { if (latestCode) setDisplayCode(latestCode); }, [latestCode]);

  const [filename, setFilename] = useState('my-animation');
  const [manualSaved, setManualSaved] = useState('');

  const handleSave = useCallback(async () => {
    if (!displayCode) return;
    const result = await window.electronAPI.saveAnimation(filename, displayCode);
    if (result.success) setManualSaved(result.filename);
  }, [displayCode, filename]);

  const openTarget = lastSaved ?? manualSaved;
  const handleOpenBrowser = useCallback(async () => {
    if (!openTarget) return;
    await window.electronAPI.openInBrowser(openTarget);
  }, [openTarget]);

  const handleLoadProject = useCallback((_name: string, content: string) => {
    setDisplayCode(content);
  }, []);

  // ── Startup screens ──────────────────────────────────────────────────────

  if (ollamaStatus === 'checking') {
    return (
      <div className="startup-screen">
        <div style={{ fontSize: 64 }}>🤖</div>
        <div className="startup-title">Looking for Gemma...</div>
      </div>
    );
  }

  if (ollamaStatus === 'offline') {
    return (
      <div className="startup-screen">
        <div style={{ fontSize: 64 }}>😴</div>
        <div className="startup-title">Gemma is sleeping!</div>
        <div className="startup-msg">Ask a grown-up to start Ollama, then press the button below.</div>
        <button className="btn-recheck" onClick={recheck}>🔄 Check Again</button>
      </div>
    );
  }

  // Ollama is running but no Gemma model installed.
  if (!models.some(m => m.toLowerCase().includes('gemma'))) {
    return (
      <div className="startup-screen">
        <div style={{ fontSize: 64 }}>📦</div>
        <div className="startup-title">Gemma needs a download!</div>
        <div className="startup-msg">Ask a grown-up to open a terminal and type:</div>
        <div className="startup-code">ollama pull gemma4:26b</div>
        <div className="startup-msg" style={{ fontSize: '0.9rem', marginTop: 4 }}>
          (Optional voice input: <code style={{ fontSize: '0.85em' }}>ollama pull gemma4:e4b</code>)
        </div>
        <button className="btn-recheck" onClick={recheck}>🔄 Check Again</button>
      </div>
    );
  }

  // ── Main UI ───────────────────────────────────────────────────────────────

  return (
    <ErrorBoundary>
      <div className="app">
        <header className="app-header">
          <span className="app-title">✨ gemma4kids</span>
          <div className="header-controls">
            <input
              className="filename-input"
              value={filename}
              onChange={e => setFilename(e.target.value)}
              placeholder="animation name"
            />
            <button className="btn-save" onClick={handleSave} disabled={!displayCode}>💾 Save</button>
            <button className="btn-preview" onClick={handleOpenBrowser} disabled={!openTarget}>🌐 Open in Browser</button>
          </div>
        </header>

        <div className="app-body">
          <div className="sidebar">
            <ProjectList onLoad={handleLoadProject} refreshTrigger={lastSaved} />
          </div>

          <EditorPanel code={displayCode} onChange={setDisplayCode} />

          <ChatPanel
            messages={messages}
            streamingText={streamingText}
            status={status}
            errorMsg={errorMsg}
            onSend={sendMessage}
            onCancel={cancel}
            onRetry={retry}
            e4bAvailable={e4bAvailable}
          />
        </div>
      </div>
    </ErrorBoundary>
  );
}
