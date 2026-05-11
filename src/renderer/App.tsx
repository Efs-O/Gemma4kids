import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { ChatPanel } from './components/ChatPanel';
import { EditorPanel } from './components/EditorPanel';
import { ProjectList } from './components/ProjectList';
import { ErrorBoundary } from './components/ErrorBoundary';
import { CodeRunner } from './components/CodeRunner';
import { HelpPanel } from './components/HelpPanel';
import { SetupAssistant } from './components/SetupAssistant';
import { StartupChecking, StartupNoModels, StartupOffline } from './components/StartupState';
import { AppHeader } from './components/AppHeader';
import { useChat } from './hooks/useChat';
import { useOllama } from './hooks/useOllama';
import type { LlamaCppRuntimeConfig, RuntimeKind } from './services/OllamaService';
import { DEFAULT_LLAMA_CACHE_TYPE, getConfiguredLlamaPathForModel, LLAMA_CACHE_TYPE_K_KEY, LLAMA_CACHE_TYPE_V_KEY, LLAMA_GPU_LAYERS_KEY, LLAMA_MODEL_PRESETS, LLAMA_NUM_CTX_KEY, LLAMA_NUM_PREDICT_KEY, LLAMA_PORT_KEY, LLAMA_SERVER_PATH_KEY, LLAMA_STT_PORT_KEY, persistLlamaModelPaths, readLlamaCppSetupConfig, readSelectedRuntime, RUNTIME_SELECTED_KEY, type LlamaCppSetupConfig, type LlamaModelPresetId } from './config/llamaSetup';
import { isGemma4EdgeE4b, isGemma4EdgeE2b, isGemma426b, isGemma431b, pickCodingModel, pickGreekTranscribeModel, pickTranscribeModel, sortGemma4CodingModelsSmallestFirst, getModelTier } from './utils/pickCodingModel';
import { auditHtml } from './htmlAudit';

function titleToFilename(html: string, fallback: string): string {
  const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (!m) return fallback;
  return m[1].trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || fallback;
}

function pointsToMmproj(filePath: string): boolean {
  return /mmproj/i.test(filePath.split(/[\\/]/).pop() ?? '');
}

export default function App() {
  const [selectedRuntime, setSelectedRuntime] = useState<RuntimeKind>(() => readSelectedRuntime());
  const [llamaSetup, setLlamaSetup] = useState<LlamaCppSetupConfig>(() => readLlamaCppSetupConfig());
  const [showSetupAssistant, setShowSetupAssistant] = useState(true);
  const [userModel, setUserModel] = useState('');
  const [chatThinkEnabled, setChatThinkEnabled] = useState<boolean>(() => {
    const stored = localStorage.getItem('g4k-chat-think');
    return stored == null ? true : stored === 'true';
  });
  const [showThinking, setShowThinking] = useState<boolean>(() => localStorage.getItem('g4k-show-thinking') === 'true');

  const llamaCodingModels = useMemo(() => sortGemma4CodingModelsSmallestFirst(LLAMA_MODEL_PRESETS.map((preset) => preset.modelTag)), []);
  const activeLlamaModel = useMemo(() => (userModel && llamaCodingModels.includes(userModel)) ? userModel : pickCodingModel(llamaCodingModels), [llamaCodingModels, userModel]);
  const llamaMmprojSearchPaths = useMemo(
    () => LLAMA_MODEL_PRESETS.map((preset) => llamaSetup.modelPaths[preset.id]),
    [llamaSetup.modelPaths],
  );
  const activeLlamaRuntimeConfig = useMemo<LlamaCppRuntimeConfig>(() => ({
    serverPath: llamaSetup.serverPath,
    modelPath: getConfiguredLlamaPathForModel(activeLlamaModel, llamaSetup.modelPaths),
    mmprojSearchPaths: llamaMmprojSearchPaths,
    port: llamaSetup.port,
    sttModelPath: llamaSetup.modelPaths.e4b.trim() || llamaSetup.modelPaths.e2b.trim(),
    sttPort: llamaSetup.sttPort,
    gpuLayers: llamaSetup.gpuLayers,
    numCtx: llamaSetup.numCtx,
    numPredict: llamaSetup.numPredict,
    cacheTypeK: llamaSetup.cacheTypeK.trim() || DEFAULT_LLAMA_CACHE_TYPE,
    cacheTypeV: llamaSetup.cacheTypeV.trim() || DEFAULT_LLAMA_CACHE_TYPE,
    reasoningEnabled: chatThinkEnabled,
  }), [activeLlamaModel, chatThinkEnabled, llamaMmprojSearchPaths, llamaSetup]);

  const { runtime: runtimeInUse, adapter: runtimeAdapter, status: runtimeStatus, models, errorMsg: runtimeErrorMsg, llamaMmprojPath, recheck } = useOllama(selectedRuntime, activeLlamaRuntimeConfig);

  const autoOllamaModel = useMemo(() => pickCodingModel(models), [models]);
  const transcribeModel = useMemo(() => pickTranscribeModel(models), [models]);
  const greekTranscribeModel = useMemo(() => pickGreekTranscribeModel(models), [models]);
  const voiceInputAvailable = useMemo(() => {
    if (runtimeInUse === 'llama_cpp') return activeLlamaRuntimeConfig.sttModelPath.trim() !== '';
    return models.some(isGemma4EdgeE4b) || models.some(isGemma4EdgeE2b);
  }, [activeLlamaRuntimeConfig.sttModelPath, models, runtimeInUse]);

  const supportsVisualAttachments = runtimeAdapter.capabilities.supportsMultimodal;
  const availableCodingModels = useMemo(() => (
    runtimeInUse === 'llama_cpp'
      ? llamaCodingModels
      : sortGemma4CodingModelsSmallestFirst(
        models.filter((m) => /gemma/i.test(m)),
      )
  ), [llamaCodingModels, models, runtimeInUse]);

  const codingModel = useMemo(() => {
    if (runtimeInUse === 'llama_cpp') return activeLlamaModel;
    if (userModel && models.includes(userModel)) return userModel;
    return autoOllamaModel;
  }, [activeLlamaModel, autoOllamaModel, models, runtimeInUse, userModel]);
  const ollamaCleanupModels = useMemo(() => {
    const collected = [codingModel, transcribeModel, greekTranscribeModel ?? ''];
    return [...new Set(collected.map((model) => model.trim()).filter(Boolean))];
  }, [codingModel, greekTranscribeModel, transcribeModel]);
  const modelTier = useMemo(() => getModelTier(codingModel), [codingModel]);
  const misconfiguredMmprojTabs = useMemo(
    () => LLAMA_MODEL_PRESETS
      .filter((preset) => pointsToMmproj(llamaSetup.modelPaths[preset.id]))
      .map((preset) => preset.label),
    [llamaSetup.modelPaths],
  );
  const llamaMmprojWarning = useMemo(() => {
    if (runtimeInUse !== 'llama_cpp') return '';
    if (misconfiguredMmprojTabs.length > 0) {
      const labelText = misconfiguredMmprojTabs.join(', ');
      return `${labelText} ${misconfiguredMmprojTabs.length === 1 ? 'is' : 'are'} pointing to an mmproj file instead of a model .gguf. Fix ${misconfiguredMmprojTabs.length === 1 ? 'that tab' : 'those tabs'} first.`;
    }
    if (runtimeStatus !== 'ready' || llamaMmprojPath) return '';
    if (activeLlamaRuntimeConfig.sttModelPath.trim()) {
      return 'No mmproj file found next to your model — voice is unavailable. Put the mmproj .gguf in the same folder as your model file.';
    }
    return '';
  }, [activeLlamaRuntimeConfig.sttModelPath, llamaMmprojPath, misconfiguredMmprojTabs, runtimeInUse, runtimeStatus]);

  const customRuntimeLimits = useMemo(
    () => runtimeInUse === 'llama_cpp' ? { numCtx: llamaSetup.numCtx, numPredict: llamaSetup.numPredict } : undefined,
    [llamaSetup.numCtx, llamaSetup.numPredict, runtimeInUse],
  );
  const videoAttachmentFileRef = useRef<File | null>(null);
  const { messages, streamingText, streamingThinking, latestCode, lastSaved, lastAudit, status, errorMsg, ctxUsedPct, sendMessage, cancel, retry, clearContext, injectContext } = useChat(runtimeAdapter, codingModel, chatThinkEnabled, modelTier, customRuntimeLimits, videoAttachmentFileRef);

  const [sidebarWidth, setSidebarWidth] = useState(() => { const stored = localStorage.getItem('g4k-sidebar-width'); const value = stored ? parseInt(stored, 10) : 196; return Number.isNaN(value) || value < 80 || value > 400 ? 196 : value; });
  const [chatWidth, setChatWidth] = useState(() => { const stored = localStorage.getItem('g4k-chat-width'); const value = stored ? parseInt(stored, 10) : 390; return Number.isNaN(value) || value < 200 || value > 700 ? 390 : value; });
  const [displayCode, setDisplayCode] = useState('');
  const [savedCode, setSavedCode] = useState('');
  const [saveStatus, setSaveStatus] = useState<'unsaved' | 'saved' | null>(null);
  const [filename, setFilename] = useState('my-animation');
  const [currentProjectFilename, setCurrentProjectFilename] = useState('');
  const [uiError, setUiError] = useState('');
  const [helpOpen, setHelpOpen] = useState(false);

  const draggingTarget = useRef<'sidebar' | 'chat' | null>(null);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(0);
  const saveStatusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingAutoSave = useRef(false);
  const streamStartSaved = useRef<string | null>(null);
  const filenameRef = useRef(filename);

  useEffect(() => { filenameRef.current = filename; }, [filename]);
  useEffect(() => { if (latestCode) setDisplayCode(latestCode); }, [latestCode]);
  useEffect(() => { if (displayCode && savedCode && displayCode !== savedCode) setSaveStatus('unsaved'); }, [displayCode, savedCode]);
  useEffect(() => { localStorage.setItem('g4k-sidebar-width', String(sidebarWidth)); }, [sidebarWidth]);
  useEffect(() => { localStorage.setItem('g4k-chat-width', String(chatWidth)); }, [chatWidth]);
  useEffect(() => {
    const modelsForCleanup = runtimeInUse === 'ollama' ? ollamaCleanupModels : [];
    void window.electronAPI.setOllamaCleanupTargets(runtimeInUse, modelsForCleanup);
  }, [ollamaCleanupModels, runtimeInUse]);

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
    const onMouseUp = () => { draggingTarget.current = null; };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  const baseFilename = useCallback((name: string) => name.replace(/\.html$/, ''), []);
  const flashSaved = useCallback((code: string) => {
    setSavedCode(code);
    setSaveStatus('saved');
    if (saveStatusTimerRef.current) clearTimeout(saveStatusTimerRef.current);
    saveStatusTimerRef.current = setTimeout(() => setSaveStatus(null), 2000);
  }, []);

  useEffect(() => {
    if (!lastSaved) return;
    setCurrentProjectFilename(lastSaved);
    setFilename(baseFilename(lastSaved));
    if (latestCode) flashSaved(latestCode);
  }, [baseFilename, flashSaved, lastSaved, latestCode]);

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
        setCurrentProjectFilename(result.filename);
        setFilename(baseFilename(result.filename));
        flashSaved(audited.html);
      }
    })();
  }, [status, latestCode, lastSaved, baseFilename, flashSaved]);

  const handleModelChange = useCallback((modelName: string) => setUserModel(modelName), []);
  const handleThinkToggle = useCallback((enabled: boolean) => {
    setChatThinkEnabled(enabled);
    localStorage.setItem('g4k-chat-think', String(enabled));
  }, []);
  const handleShowThinkingToggle = useCallback((enabled: boolean) => {
    setShowThinking(enabled);
    localStorage.setItem('g4k-show-thinking', String(enabled));
  }, []);
  const handleRuntimeSelection = useCallback((runtime: RuntimeKind) => {
    setSelectedRuntime(runtime);
    localStorage.setItem(RUNTIME_SELECTED_KEY, runtime);
  }, []);
  const handleLlamaSetupChange = useCallback((patch: Partial<LlamaCppSetupConfig>) => {
    setLlamaSetup((current) => {
      const next = { ...current, ...patch };
      localStorage.setItem(LLAMA_SERVER_PATH_KEY, next.serverPath);
      persistLlamaModelPaths(next.modelPaths);
      localStorage.setItem(LLAMA_PORT_KEY, String(next.port));
      localStorage.setItem(LLAMA_STT_PORT_KEY, String(next.sttPort));
      localStorage.setItem(LLAMA_GPU_LAYERS_KEY, String(next.gpuLayers));
      localStorage.setItem(LLAMA_NUM_CTX_KEY, String(next.numCtx));
      localStorage.setItem(LLAMA_NUM_PREDICT_KEY, String(next.numPredict));
      localStorage.setItem(LLAMA_CACHE_TYPE_K_KEY, next.cacheTypeK.trim() || DEFAULT_LLAMA_CACHE_TYPE);
      localStorage.setItem(LLAMA_CACHE_TYPE_V_KEY, next.cacheTypeV.trim() || DEFAULT_LLAMA_CACHE_TYPE);
      return next;
    });
  }, []);
  const handleLlamaModelPathChange = useCallback((id: LlamaModelPresetId, modelPath: string) => {
    setLlamaSetup((current) => { const next = { ...current, modelPaths: { ...current.modelPaths, [id]: modelPath } }; persistLlamaModelPaths(next.modelPaths); return next; });
  }, []);
  const openSetupAssistant = useCallback(() => {
    setHelpOpen(false);
    setShowSetupAssistant(true);
  }, []);
  const closeSetupAssistant = useCallback(() => setShowSetupAssistant(false), []);
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

  const handleSave = useCallback(async () => {
    if (!displayCode) return;
    const audited = auditHtml(displayCode);
    const result = await window.electronAPI.saveAnimation(filename, audited.html, 'kid');
    if (result.success) {
      setCurrentProjectFilename(result.filename);
      setFilename(baseFilename(result.filename));
      flashSaved(audited.html);
      setUiError('');
      injectContext(`[Context: the child just manually saved their edits as "${result.filename}". If they ask you to review, fix, or change this file, call read_animation("${baseFilename(result.filename)}") first to get their edited version.]`);
      return;
    }
    setUiError(`I couldn't save that animation. ${result.error ?? 'Please try again.'}`);
  }, [baseFilename, displayCode, filename, flashSaved, injectContext]);
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
    setSaveStatus(null);
    setCurrentProjectFilename(name);
    setFilename(baseFilename(name));
    setUiError('');
    injectContext(`[Context: the child loaded "${name}" from the sidebar. You MUST call read_animation("${baseFilename(name)}") before responding to any message about this code. Do not comment on, review, or fix this code without reading it first with the tool.]`);
  }, [baseFilename, injectContext]);
  const handleDeleteProject = useCallback((deletedFilename: string) => {
    if (deletedFilename === currentProjectFilename) setCurrentProjectFilename('');
    setUiError('');
  }, [currentProjectFilename]);
  const handleClearContext = useCallback(() => {
    clearContext();
    setDisplayCode('');
    setCurrentProjectFilename('');
    setFilename('my-animation');
    setUiError('');
  }, [clearContext]);

  if (showSetupAssistant) return <SetupAssistant selectedRuntime={selectedRuntime} llamaSetup={llamaSetup} runtimeStatus={runtimeStatus} runtimeError={runtimeErrorMsg} mmprojWarning={llamaMmprojWarning} onRuntimeChange={handleRuntimeSelection} onLlamaSetupChange={handleLlamaSetupChange} onLlamaModelPathChange={handleLlamaModelPathChange} onClose={closeSetupAssistant} />;

  if (runtimeStatus === 'checking') return <StartupChecking selectedRuntime={selectedRuntime} />;
  if (runtimeStatus === 'offline') {
    return <StartupOffline selectedRuntime={selectedRuntime} runtimeErrorMsg={runtimeErrorMsg} onRecheck={recheck} onOpenSetup={openSetupAssistant} />;
  }
  if (selectedRuntime === 'ollama' && !models.some((m) => m.toLowerCase().includes('gemma'))) return <StartupNoModels onRecheck={recheck} />;

  return (
    <ErrorBoundary>
      <div className="app">
        <AppHeader
          runtimeLabel={runtimeInUse === 'ollama' ? 'Ollama' : 'llama.cpp'}
          codingModel={codingModel}
          availableCodingModels={availableCodingModels}
          chatThinkEnabled={chatThinkEnabled}
          showThinking={showThinking}
          filename={filename}
          displayCode={displayCode}
          currentProjectFilename={currentProjectFilename}
          isStreaming={status === 'streaming'}
          onModelChange={handleModelChange}
          onThinkToggle={handleThinkToggle}
          onShowThinkingToggle={handleShowThinkingToggle}
          onFilenameChange={(value) => { setFilename(value); setUiError(''); }}
          onSave={handleSave}
          onOpenBrowser={handleOpenBrowser}
          onOpenSetup={openSetupAssistant}
          onToggleHelp={() => setHelpOpen((v) => !v)}
        />
        {helpOpen && <HelpPanel onClose={() => setHelpOpen(false)} onOpenSetupAssistant={openSetupAssistant} />}
        {uiError && <div className="error-msg" role="status"><div>Oops! Something went wrong.</div><pre className="error-detail">{uiError}</pre></div>}

        <div className="app-body">
          <div className="sidebar" style={{ width: sidebarWidth }}>
            <ProjectList onLoad={handleLoadProject} onDelete={handleDeleteProject} onError={setUiError} refreshTrigger={currentProjectFilename} />
          </div>
          <div className="resize-divider" onMouseDown={onSidebarDividerMouseDown} />
          <EditorPanel code={displayCode} onChange={setDisplayCode} auditResult={lastAudit} isStreaming={status === 'streaming'} saveStatus={saveStatus} />
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
              e4bAvailable={voiceInputAvailable}
              greekTranscribeModel={greekTranscribeModel}
              transcribeModel={transcribeModel}
              codingModel={codingModel}
              runtimeAdapter={runtimeAdapter}
              showThinking={showThinking}
              ctxUsedPct={ctxUsedPct}
              onClearContext={handleClearContext}
              modelTier={modelTier}
              supportsVisualAttachments={supportsVisualAttachments}
              videoAttachmentFileRef={videoAttachmentFileRef}
            />
          </div>
        </div>
        <CodeRunner streaming={status === 'streaming'} enabled={isGemma426b(codingModel) || isGemma431b(codingModel)} />
      </div>
    </ErrorBoundary>
  );
}
