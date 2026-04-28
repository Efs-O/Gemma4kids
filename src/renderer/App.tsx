import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { ChatPanel } from './components/ChatPanel';
import { EditorPanel } from './components/EditorPanel';
import { ProjectList } from './components/ProjectList';
import { ErrorBoundary } from './components/ErrorBoundary';
import { CodeRunner } from './components/CodeRunner';
import { useChat } from './hooks/useChat';
import { useOllama } from './hooks/useOllama';
import { isGemma4EdgeE4b, isGemma426b, pickCodingModel, pickTranscribeModel } from './utils/pickCodingModel';

export default function App() {
  const { status: ollamaStatus, models, recheck } = useOllama();

  // Derive synchronously from /api/tags so useChat never lags one frame behind (effect + setState used to pick 26B early).
  const autoModel = useMemo(() => pickCodingModel(models), [models]);
  const transcribeModel = useMemo(() => pickTranscribeModel(models), [models]);
  const e4bAvailable = useMemo(() => models.some(isGemma4EdgeE4b), [models]);
  const gemmaModels = useMemo(() => models.filter(m => isGemma4EdgeE4b(m) || isGemma426b(m)), [models]);

  const [userModel, setUserModel] = useState<string>(() => localStorage.getItem('g4k-coding-model') ?? '');
  const [chatThinkEnabled, setChatThinkEnabled] = useState<boolean>(() => {
    const stored = localStorage.getItem('g4k-chat-think');
    return stored == null ? true : stored === 'true';
  });
  const [showThinking, setShowThinking] = useState<boolean>(() => {
    const stored = localStorage.getItem('g4k-show-thinking');
    return stored === 'true';
  });
  const codingModel = useMemo(() => {
    if (userModel && models.includes(userModel)) return userModel;
    return autoModel;
  }, [userModel, models, autoModel]);

  const handleModelChange = useCallback((m: string) => {
    setUserModel(m);
    localStorage.setItem('g4k-coding-model', m);
  }, []);

  const handleThinkToggle = useCallback((enabled: boolean) => {
    setChatThinkEnabled(enabled);
    localStorage.setItem('g4k-chat-think', String(enabled));
  }, []);

  const handleShowThinkingToggle = useCallback((enabled: boolean) => {
    setShowThinking(enabled);
    localStorage.setItem('g4k-show-thinking', String(enabled));
  }, []);

  const { messages, streamingText, streamingThinking, latestCode, lastSaved, status, errorMsg, sendMessage, cancel, retry } =
    useChat(codingModel, chatThinkEnabled);

  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const s = localStorage.getItem('g4k-sidebar-width');
    const v = s ? parseInt(s, 10) : 196;
    return isNaN(v) || v < 80 || v > 400 ? 196 : v;
  });
  const [chatWidth, setChatWidth] = useState(() => {
    const s = localStorage.getItem('g4k-chat-width');
    const v = s ? parseInt(s, 10) : 390;
    return isNaN(v) || v < 200 || v > 700 ? 390 : v;
  });

  // Persist widths whenever they change
  useEffect(() => { localStorage.setItem('g4k-sidebar-width', String(sidebarWidth)); }, [sidebarWidth]);
  useEffect(() => { localStorage.setItem('g4k-chat-width', String(chatWidth)); }, [chatWidth]);

  const draggingTarget = useRef<'sidebar' | 'chat' | null>(null);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(0);

  const onSidebarDividerMouseDown = useCallback((e: React.MouseEvent) => {
    draggingTarget.current = 'sidebar';
    dragStartX.current = e.clientX;
    dragStartWidth.current = sidebarWidth;
    e.preventDefault();
  }, [sidebarWidth]);

  const onChatDividerMouseDown = useCallback((e: React.MouseEvent) => {
    draggingTarget.current = 'chat';
    dragStartX.current = e.clientX;
    dragStartWidth.current = chatWidth;
    e.preventDefault();
  }, [chatWidth]);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!draggingTarget.current) return;
      if (draggingTarget.current === 'sidebar') {
        const delta = e.clientX - dragStartX.current;
        setSidebarWidth(Math.max(80, Math.min(500, dragStartWidth.current + delta)));
      } else {
        const delta = dragStartX.current - e.clientX;
        const maxChat = window.innerWidth - 350;
        setChatWidth(Math.max(0, Math.min(maxChat, dragStartWidth.current + delta)));
      }
    };
    const onMouseUp = () => { draggingTarget.current = null; };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

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
          <span className="app-title">
            ✨ gemma4kids
          </span>
          <div className="model-controls">
            <select
              className="model-selector"
              value={codingModel}
              onChange={e => handleModelChange(e.target.value)}
              title="Coding model"
            >
              {gemmaModels.map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
            <label
              className="think-toggle"
              title="Controls thinking for the coding reply model. Voice transcription always keeps thinking off."
            >
              <input
                type="checkbox"
                checked={chatThinkEnabled}
                onChange={e => handleThinkToggle(e.target.checked)}
              />
              <span>Think {chatThinkEnabled ? 'On' : 'Off'}</span>
            </label>
            <label
              className="think-toggle"
              title="Show Gemma's reasoning bubble when the reply model returns it."
            >
              <input
                type="checkbox"
                checked={showThinking}
                onChange={e => handleShowThinkingToggle(e.target.checked)}
              />
              <span>Show Thoughts</span>
            </label>
          </div>
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
          <div className="sidebar" style={{ width: sidebarWidth }}>
            <ProjectList onLoad={handleLoadProject} refreshTrigger={lastSaved} />
          </div>

          <div className="resize-divider" onMouseDown={onSidebarDividerMouseDown} />

          <EditorPanel code={displayCode} onChange={setDisplayCode} />

          <div className="resize-divider" onMouseDown={onChatDividerMouseDown} />

          <div style={{ width: chatWidth, flexShrink: 0, display: 'flex', overflow: 'hidden' }}>
            <ChatPanel
              messages={messages}
              streamingText={streamingText}
              streamingThinking={streamingThinking}
              status={status}
              errorMsg={errorMsg}
              onSend={sendMessage}
              onCancel={cancel}
              onRetry={retry}
              e4bAvailable={e4bAvailable}
              transcribeModel={transcribeModel}
              showThinking={showThinking}
            />
          </div>
        </div>

        <CodeRunner streaming={status === 'streaming'} enabled={isGemma426b(codingModel)} />
      </div>
    </ErrorBoundary>
  );
}
