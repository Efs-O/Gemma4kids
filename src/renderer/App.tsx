import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { ChatPanel } from './components/ChatPanel';
import { EditorPanel } from './components/EditorPanel';
import { ProjectList } from './components/ProjectList';
import { ErrorBoundary } from './components/ErrorBoundary';
import { CodeRunner } from './components/CodeRunner';
import { HelpPanel } from './components/HelpPanel';
import { useChat } from './hooks/useChat';
import { useOllama } from './hooks/useOllama';
import { isGemma4EdgeE4b, isGemma4EdgeE2b, isGemma426b, isGemma431b, pickCodingModel, pickTranscribeModel } from './utils/pickCodingModel';
import { auditHtml } from './htmlAudit';

export default function App() {
  const { status: ollamaStatus, models, errorMsg: ollamaErrorMsg, recheck } = useOllama();

  const autoModel = useMemo(() => pickCodingModel(models), [models]);
  const transcribeModel = useMemo(() => pickTranscribeModel(models), [models]);
  const e4bAvailable = useMemo(() => models.some(isGemma4EdgeE4b), [models]);
  const gemmaModels = useMemo(() => models.filter((m) => isGemma431b(m) || isGemma426b(m) || isGemma4EdgeE4b(m) || isGemma4EdgeE2b(m)), [models]);

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

  const handleModelChange = useCallback((modelName: string) => {
    setUserModel(modelName);
    localStorage.setItem('g4k-coding-model', modelName);
  }, []);

  const handleThinkToggle = useCallback((enabled: boolean) => {
    setChatThinkEnabled(enabled);
    localStorage.setItem('g4k-chat-think', String(enabled));
  }, []);

  const handleShowThinkingToggle = useCallback((enabled: boolean) => {
    setShowThinking(enabled);
    localStorage.setItem('g4k-show-thinking', String(enabled));
  }, []);

  const {
    messages,
    streamingText,
    streamingThinking,
    latestCode,
    lastSaved,
    lastAudit,
    status,
    errorMsg,
    ctxUsedPct,
    sendMessage,
    cancel,
    retry,
    clearContext,
    injectContext,
  } = useChat(codingModel, chatThinkEnabled);

  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const stored = localStorage.getItem('g4k-sidebar-width');
    const value = stored ? parseInt(stored, 10) : 196;
    return Number.isNaN(value) || value < 80 || value > 400 ? 196 : value;
  });
  const [chatWidth, setChatWidth] = useState(() => {
    const stored = localStorage.getItem('g4k-chat-width');
    const value = stored ? parseInt(stored, 10) : 390;
    return Number.isNaN(value) || value < 200 || value > 700 ? 390 : value;
  });

  useEffect(() => {
    localStorage.setItem('g4k-sidebar-width', String(sidebarWidth));
  }, [sidebarWidth]);

  useEffect(() => {
    localStorage.setItem('g4k-chat-width', String(chatWidth));
  }, [chatWidth]);

  const draggingTarget = useRef<'sidebar' | 'chat' | null>(null);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(0);

  const onSidebarDividerMouseDown = useCallback((event: React.MouseEvent) => {
    draggingTarget.current = 'sidebar';
    dragStartX.current = event.clientX;
    dragStartWidth.current = sidebarWidth;
    event.preventDefault();
  }, [sidebarWidth]);

  const onChatDividerMouseDown = useCallback((event: React.MouseEvent) => {
    draggingTarget.current = 'chat';
    dragStartX.current = event.clientX;
    dragStartWidth.current = chatWidth;
    event.preventDefault();
  }, [chatWidth]);

  useEffect(() => {
    const onMouseMove = (event: MouseEvent) => {
      if (!draggingTarget.current) return;
      if (draggingTarget.current === 'sidebar') {
        const delta = event.clientX - dragStartX.current;
        setSidebarWidth(Math.max(80, Math.min(500, dragStartWidth.current + delta)));
        return;
      }

      const delta = dragStartX.current - event.clientX;
      const maxChat = window.innerWidth - 350;
      setChatWidth(Math.max(0, Math.min(maxChat, dragStartWidth.current + delta)));
    };

    const onMouseUp = () => {
      draggingTarget.current = null;
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  const [displayCode, setDisplayCode] = useState('');
  const [savedCode, setSavedCode] = useState('');
  useEffect(() => {
    if (latestCode) setDisplayCode(latestCode);
  }, [latestCode]);

  const [filename, setFilename] = useState('my-animation');
  const [currentProjectFilename, setCurrentProjectFilename] = useState('');
  const [uiError, setUiError] = useState('');
  const [helpOpen, setHelpOpen] = useState(false);

  const baseFilename = useCallback((name: string) => name.replace(/\.html$/, ''), []);

  useEffect(() => {
    if (!lastSaved) return;
    setCurrentProjectFilename(lastSaved);
    setFilename(baseFilename(lastSaved));
    if (latestCode) setSavedCode(latestCode);
  }, [baseFilename, lastSaved, latestCode]);

  // Auto-save when Gemma generates code but forgets to call save_animation.
  // Tracks lastSaved at streaming start; if it hasn't changed by the time
  // streaming ends but latestCode exists, Gemma skipped the tool call.
  const pendingAutoSave = useRef(false);
  const streamStartSaved = useRef<string | null>(null);
  const filenameRef = useRef(filename);
  useEffect(() => { filenameRef.current = filename; }, [filename]);

  useEffect(() => {
    if (status === 'streaming') {
      pendingAutoSave.current = true;
      streamStartSaved.current = lastSaved;
      return;
    }
    if (status !== 'idle' || !pendingAutoSave.current || !latestCode) return;
    pendingAutoSave.current = false;
    if (lastSaved !== streamStartSaved.current) return; // tool already saved
    const code = latestCode;
    const name = filenameRef.current;
    void (async () => {
      const audited = auditHtml(code);
      const result = await window.electronAPI.saveAnimation(name, audited.html);
      if (result.success) {
        setCurrentProjectFilename(result.filename);
        setFilename(baseFilename(result.filename));
        setSavedCode(audited.html);
      }
    })();
  }, [status, latestCode, lastSaved, baseFilename]);

  const handleSave = useCallback(async () => {
    if (!displayCode) return;
    const audited = auditHtml(displayCode);
    const result = await window.electronAPI.saveAnimation(filename, audited.html);
    if (result.success) {
      setCurrentProjectFilename(result.filename);
      setFilename(baseFilename(result.filename));
      setSavedCode(audited.html);
      setUiError('');
      injectContext(`[Context: the child just saved "${result.filename}" to the editor. You MUST call read_animation("${baseFilename(result.filename)}") before answering any questions about this code. Do not comment on, review, or fix this code without reading it first with the tool.]`);
      return;
    }
    setUiError(`I couldn't save that animation. ${result.error ?? 'Please try again.'}`);
  }, [baseFilename, displayCode, filename]);

  const handleOpenBrowser = useCallback(async () => {
    if (!currentProjectFilename) return;
    const result = await window.electronAPI.openInBrowser(currentProjectFilename);
    if (result.success) {
      setUiError('');
      return;
    }
    setUiError(`I couldn't open that animation in the browser. ${result.error ?? 'Please try again.'}`);
  }, [currentProjectFilename]);

  const handleLoadProject = useCallback((name: string, content: string) => {
    setDisplayCode(content);
    setSavedCode(content);
    setCurrentProjectFilename(name);
    setFilename(baseFilename(name));
    setUiError('');
    injectContext(`[Context: the child loaded "${name}" from the sidebar. You MUST call read_animation("${baseFilename(name)}") before responding to any message about this code. Do not comment on, review, or fix this code without reading it first with the tool.]`);
  }, [baseFilename, injectContext]);

  const handleDeleteProject = useCallback((deletedFilename: string) => {
    if (deletedFilename === currentProjectFilename) {
      setCurrentProjectFilename('');
    }
    setUiError('');
  }, [currentProjectFilename]);

  const handleClearContext = useCallback(() => {
    clearContext();
    setDisplayCode('');
    setCurrentProjectFilename('');
    setFilename('my-animation');
    setUiError('');
  }, [clearContext]);

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
        {ollamaErrorMsg && (
          <div className="startup-msg" style={{ fontSize: '0.9rem' }}>
            For a grown-up: {ollamaErrorMsg}
          </div>
        )}
        <button className="btn-recheck" onClick={recheck}>Check Again</button>
      </div>
    );
  }

  if (!models.some((m) => m.toLowerCase().includes('gemma'))) {
    return (
      <div className="startup-screen">
        <div style={{ fontSize: 64 }}>📥</div>
        <div className="startup-title">Gemma needs a download!</div>
        <div className="startup-msg">Ask a grown-up to open a terminal and type:</div>
        <div className="startup-code">ollama pull gemma4:31b</div>
        <div className="startup-msg" style={{ fontSize: '0.9rem', marginTop: 4 }}>
          (Or <code style={{ fontSize: '0.85em' }}>ollama pull gemma4:26b</code> · Optional voice: <code style={{ fontSize: '0.85em' }}>ollama pull gemma4:e4b</code>)
        </div>
        <button className="btn-recheck" onClick={recheck}>Check Again</button>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <div className="app">
        <header className="app-header">
          <span className="app-title">gemma4kids</span>
          <div className="model-controls">
            <select
              className="model-selector"
              value={codingModel}
              onChange={(event) => handleModelChange(event.target.value)}
              title="Coding model"
            >
              {gemmaModels.map((modelName) => (
                <option key={modelName} value={modelName}>{modelName}</option>
              ))}
            </select>
            <label
              className="think-toggle"
              title="Controls thinking for the coding reply model. Voice transcription always keeps thinking off."
            >
              <input
                type="checkbox"
                checked={chatThinkEnabled}
                onChange={(event) => handleThinkToggle(event.target.checked)}
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
                onChange={(event) => handleShowThinkingToggle(event.target.checked)}
              />
              <span>Show Thoughts</span>
            </label>
          </div>
          <div className="header-controls">
            <input
              className="filename-input"
              value={filename}
              onChange={(event) => {
                setFilename(event.target.value);
                setUiError('');
              }}
              placeholder="animation name"
            />
            <button className="btn-save" onClick={handleSave} disabled={!displayCode}>Save</button>
            <button className="btn-preview" onClick={handleOpenBrowser} disabled={!currentProjectFilename || status === 'streaming'}>Open in Browser</button>
            <button className="btn-help" onClick={() => setHelpOpen(v => !v)} aria-label="Help" title="How to use Gemma4kids">?</button>
          </div>
        </header>
        {helpOpen && <HelpPanel onClose={() => setHelpOpen(false)} />}

        {uiError && (
          <div className="error-msg" role="status">
            <div>Oops! Something went wrong.</div>
            <pre className="error-detail">{uiError}</pre>
          </div>
        )}

        <div className="app-body">
          <div className="sidebar" style={{ width: sidebarWidth }}>
            <ProjectList
              onLoad={handleLoadProject}
              onDelete={handleDeleteProject}
              onError={setUiError}
              refreshTrigger={currentProjectFilename}
            />
          </div>

          <div className="resize-divider" onMouseDown={onSidebarDividerMouseDown} />

          <EditorPanel code={displayCode} onChange={setDisplayCode} auditResult={lastAudit} isStreaming={status === 'streaming'} hasUnsavedChanges={!!displayCode && displayCode !== savedCode} />

          <div className="resize-divider" onMouseDown={onChatDividerMouseDown} />

          <div style={{ width: chatWidth, flexShrink: 0, display: 'flex', overflow: 'hidden' }}>
            <ChatPanel
              messages={messages}
              streamingText={streamingText}
              streamingThinking={streamingThinking}
              status={status}
              errorMsg={errorMsg}
              hasCode={!!displayCode}
              onSend={sendMessage}
              onCancel={cancel}
              onRetry={retry}
              e4bAvailable={e4bAvailable}
              transcribeModel={transcribeModel}
              codingModel={codingModel}
              showThinking={showThinking}
              ctxUsedPct={ctxUsedPct}
              onClearContext={handleClearContext}
            />
          </div>
        </div>

        <CodeRunner streaming={status === 'streaming'} enabled={isGemma426b(codingModel) || isGemma431b(codingModel)} />
      </div>
    </ErrorBoundary>
  );
}
