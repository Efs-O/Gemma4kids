import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { ChatPanel } from './components/ChatPanel';
import { EditorPanel } from './components/EditorPanel';
import { ProjectList } from './components/ProjectList';
import { ErrorBoundary } from './components/ErrorBoundary';
import { CodeRunner } from './components/CodeRunner';
import { HelpPanel } from './components/HelpPanel';
import { useChat } from './hooks/useChat';
import { useOllama } from './hooks/useOllama';
import type { LlamaCppRuntimeConfig, RuntimeKind } from './services/OllamaService';
import {
  isGemma4EdgeE4b,
  isGemma4EdgeE2b,
  isGemma426b,
  isGemma431b,
  pickCodingModel,
  pickGreekTranscribeModel,
  pickTranscribeModel,
  sortGemma4CodingModelsSmallestFirst,
  getModelTier,
} from './utils/pickCodingModel';
import { auditHtml } from './htmlAudit';

function titleToFilename(html: string, fallback: string): string {
  const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (!m) return fallback;
  return m[1].trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || fallback;
}

const RUNTIME_SELECTED_KEY = 'runtime.selected';
const LLAMA_SERVER_PATH_KEY = 'runtime.llama_cpp.serverPath';
const LLAMA_MODEL_PATH_KEY = 'runtime.llama_cpp.modelPath';
const LLAMA_PORT_KEY = 'runtime.llama_cpp.port';
const LLAMA_GPU_LAYERS_KEY = 'runtime.llama_cpp.gpuLayers';
const LLAMA_MODEL_PRESETS = [
  {
    id: 'e2b',
    label: 'Gemma 4 E2B',
    filename: 'gemma-4-E2B-it-Q4_K_M.gguf',
    repoSegment: 'models--unsloth--gemma-4-E2B-it-GGUF',
    snapshot: 'f064409f340b34190993560b2168133e5dbae558',
  },
  {
    id: 'e4b',
    label: 'Gemma 4 E4B',
    filename: 'gemma-4-E4B-it-Q4_K_M.gguf',
    repoSegment: 'models--unsloth--gemma-4-E4B-it-GGUF',
    snapshot: 'ce152932ac27bc40bc9c727386760424d50bb456',
  },
  {
    id: '26b',
    label: 'Gemma 4 26B',
    filename: 'gemma-4-26B-A4B-it-UD-Q3_K_M.gguf',
    repoSegment: 'models--unsloth--gemma-4-26B-A4B-it-GGUF',
    snapshot: '2f6caf1733f31c87fdcfda391e978120033609a0',
  },
  {
    id: '31b',
    label: 'Gemma 4 31B',
    filename: 'gemma-4-31B-it-Q3_K_S.gguf',
    repoSegment: 'models--unsloth--gemma-4-31B-it-GGUF',
    snapshot: '43e80d41a220ac7c83023daacd6a0d1fd8559251',
  },
] as const;

type LlamaModelPresetId = typeof LLAMA_MODEL_PRESETS[number]['id'];

interface LlamaModelPreset {
  id: LlamaModelPresetId;
  label: string;
  path: string;
}

function buildPresetPath(baseModelPath: string, repoSegment: string, snapshot: string, filename: string): string | null {
  const markerIndex = baseModelPath.indexOf('models--');
  if (markerIndex === -1) return null;
  const prefix = baseModelPath.slice(0, markerIndex);
  return `${prefix}${repoSegment}\\snapshots\\${snapshot}\\${filename}`;
}

function getLlamaModelPresets(baseModelPath: string): LlamaModelPreset[] {
  const presets: LlamaModelPreset[] = [];
  for (const preset of LLAMA_MODEL_PRESETS) {
    const path = buildPresetPath(baseModelPath, preset.repoSegment, preset.snapshot, preset.filename);
    if (!path) continue;
    presets.push({
      id: preset.id,
      label: preset.label,
      path,
    });
  }
  return presets;
}

function upgradeStoredLlamaModelPath(storedModelPath: string): string {
  if (!storedModelPath) return storedModelPath;
  const e2bPreset = LLAMA_MODEL_PRESETS[0];
  if (storedModelPath.includes(e2bPreset.repoSegment) && storedModelPath.endsWith(e2bPreset.filename)) {
    return storedModelPath;
  }

  const migratableRepoSegments = [
    'models--unsloth--gemma-4-26B-A4B-it-GGUF',
    'models--unsloth--gemma-4-E4B-it-GGUF',
  ];
  const matchedSegment = migratableRepoSegments.find((segment) => storedModelPath.includes(segment));
  if (!matchedSegment) return storedModelPath;

  const markerIndex = storedModelPath.indexOf(matchedSegment);
  const prefix = storedModelPath.slice(0, markerIndex);
  return `${prefix}${e2bPreset.repoSegment}\\snapshots\\${e2bPreset.snapshot}\\${e2bPreset.filename}`;
}

function readSelectedRuntime(): RuntimeKind {
  const stored = localStorage.getItem(RUNTIME_SELECTED_KEY);
  return stored === 'llama_cpp' ? 'llama_cpp' : 'ollama';
}

function readStoredNumber(key: string, fallback: number): number {
  const stored = localStorage.getItem(key);
  if (stored == null) return fallback;
  const parsed = Number.parseInt(stored, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function readLlamaCppConfig(): LlamaCppRuntimeConfig {
  const storedModelPath = localStorage.getItem(LLAMA_MODEL_PATH_KEY) ?? '';
  const modelPath = upgradeStoredLlamaModelPath(storedModelPath);
  if (modelPath && modelPath !== storedModelPath) {
    localStorage.setItem(LLAMA_MODEL_PATH_KEY, modelPath);
  }

  return {
    serverPath: localStorage.getItem(LLAMA_SERVER_PATH_KEY) ?? '',
    modelPath,
    port: readStoredNumber(LLAMA_PORT_KEY, 8080),
    gpuLayers: readStoredNumber(LLAMA_GPU_LAYERS_KEY, -1),
  };
}

interface SetupAssistantProps {
  selectedRuntime: RuntimeKind;
  llamaConfig: LlamaCppRuntimeConfig;
  modelPathPresets: LlamaModelPreset[];
  runtimeStatus: 'checking' | 'offline' | 'ready';
  runtimeError: string;
  onRuntimeChange: (runtime: RuntimeKind) => void;
  onLlamaConfigChange: (patch: Partial<LlamaCppRuntimeConfig>) => void;
  onSelectModelPath: (modelPath: string) => void;
  onClose: () => void;
}

function SetupAssistant({
  selectedRuntime,
  llamaConfig,
  modelPathPresets,
  runtimeStatus,
  runtimeError,
  onRuntimeChange,
  onLlamaConfigChange,
  onSelectModelPath,
  onClose,
}: SetupAssistantProps) {
  return (
    <div className="setup-overlay" role="dialog" aria-modal="true" aria-label="Setup assistant">
      <div className="setup-panel">
        <div className="setup-badge">Runtime Setup</div>
        <h1 className="setup-title">Welcome to Gemma4kids</h1>
        <p className="setup-copy">
          Pick how Gemma should run on this computer. This selector opens on every launch so you can switch runtimes or model sizes before entering the app.
        </p>

        <div className="runtime-grid">
          <button
            className={`runtime-card${selectedRuntime === 'ollama' ? ' runtime-card-selected' : ''}`}
            onClick={() => onRuntimeChange('ollama')}
            type="button"
          >
            <span className="runtime-card-title">Ollama Server</span>
            <span className="runtime-card-tag">Recommended</span>
            <span className="runtime-card-copy">Easy setup, guided checks, and the current live runtime for Gemma4kids.</span>
          </button>

          <button
            className={`runtime-card${selectedRuntime === 'llama_cpp' ? ' runtime-card-selected' : ''}`}
            onClick={() => onRuntimeChange('llama_cpp')}
            type="button"
          >
            <span className="runtime-card-title">llama.cpp</span>
            <span className="runtime-card-tag runtime-card-tag-advanced">Advanced</span>
            <span className="runtime-card-copy">Manual binary path, GGUF model path, and deeper control. Gemma4kids will start the local server when this runtime is selected.</span>
          </button>
        </div>

        <div className="setup-status">
          <strong>Current runtime check:</strong>{' '}
          {runtimeStatus === 'checking' && `Checking ${selectedRuntime === 'ollama' ? 'Ollama' : 'llama.cpp'}...`}
          {runtimeStatus === 'ready' && `${selectedRuntime === 'ollama' ? 'Ollama' : 'llama.cpp'} is ready.`}
          {runtimeStatus === 'offline' && runtimeError}
        </div>

        {selectedRuntime === 'llama_cpp' && (
          <>
            <div className="setup-note">
              Add the `llama-server` binary and one GGUF file here. Gemma4kids will start the local server for you when this runtime is selected.
            </div>
            <div className="setup-form">
              <label className="setup-field">
                <span>llama-server Path</span>
                <input
                  type="text"
                  value={llamaConfig.serverPath}
                  onChange={(event) => onLlamaConfigChange({ serverPath: event.target.value })}
                  placeholder="C:\\path\\to\\llama-server.exe"
                />
              </label>
              <label className="setup-field">
                <span>GGUF Model Path</span>
                <input
                  type="text"
                  value={llamaConfig.modelPath}
                  onChange={(event) => onLlamaConfigChange({ modelPath: event.target.value })}
                  placeholder="C:\\models\\gemma.gguf"
                />
              </label>
              {modelPathPresets.length > 0 && (
                <div className="setup-preset-grid">
                  {modelPathPresets.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      className={`setup-preset${llamaConfig.modelPath === preset.path ? ' setup-preset-active' : ''}`}
                      onClick={() => onSelectModelPath(preset.path)}
                    >
                      <span className="setup-preset-name">{preset.label}</span>
                      <span className="setup-preset-path">{preset.path}</span>
                    </button>
                  ))}
                </div>
              )}
              <div className="setup-inline-fields">
                <label className="setup-field">
                  <span>Port</span>
                  <input
                    type="number"
                    value={llamaConfig.port}
                    onChange={(event) => onLlamaConfigChange({ port: Number.parseInt(event.target.value, 10) || 8080 })}
                    min={1024}
                    max={65535}
                  />
                </label>
                <label className="setup-field">
                  <span>GPU Layers</span>
                  <input
                    type="number"
                    value={llamaConfig.gpuLayers}
                    onChange={(event) => onLlamaConfigChange({ gpuLayers: Number.parseInt(event.target.value, 10) || -1 })}
                    min={-1}
                  />
                </label>
              </div>
            </div>
          </>
        )}

        <div className="setup-actions">
          <button className="setup-primary" onClick={onClose} type="button">Start Gemma4kids</button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [selectedRuntime, setSelectedRuntime] = useState<RuntimeKind>(() => readSelectedRuntime());
  const [llamaConfig, setLlamaConfig] = useState<LlamaCppRuntimeConfig>(() => readLlamaCppConfig());
  const [showSetupAssistant, setShowSetupAssistant] = useState<boolean>(true);
  const { runtime: runtimeInUse, adapter: runtimeAdapter, status: runtimeStatus, models, errorMsg: runtimeErrorMsg, recheck } = useOllama(selectedRuntime, llamaConfig);
  const llamaModelPathPresets = useMemo(() => getLlamaModelPresets(llamaConfig.modelPath), [llamaConfig.modelPath]);

  const autoModel = useMemo(() => pickCodingModel(models), [models]);
  const transcribeModel = useMemo(() => pickTranscribeModel(models), [models]);
  const greekTranscribeModel = useMemo(() => pickGreekTranscribeModel(models), [models]);
  const voiceInputAvailable = useMemo(
    () => runtimeInUse === 'ollama' && (models.some(isGemma4EdgeE4b) || models.some(isGemma4EdgeE2b)),
    [models, runtimeInUse],
  );
  const availableCodingModels = useMemo(
    () => {
      if (runtimeInUse === 'llama_cpp') {
        return models;
      }
      return sortGemma4CodingModelsSmallestFirst(
        models.filter((m) => isGemma431b(m) || isGemma426b(m) || isGemma4EdgeE4b(m) || isGemma4EdgeE2b(m)),
      );
    },
    [models, runtimeInUse],
  );

  const [userModel, setUserModel] = useState<string>('');
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

  const modelTier = useMemo(() => getModelTier(codingModel), [codingModel]);

  const handleModelChange = useCallback((modelName: string) => {
    setUserModel(modelName);
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
  } = useChat(runtimeAdapter, codingModel, chatThinkEnabled, modelTier);

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
  const [saveStatus, setSaveStatus] = useState<'unsaved' | 'saved' | null>(null);
  const saveStatusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (latestCode) setDisplayCode(latestCode);
  }, [latestCode]);

  useEffect(() => {
    if (!displayCode || !savedCode) return;
    if (displayCode !== savedCode) setSaveStatus('unsaved');
  }, [displayCode, savedCode]);

  const [filename, setFilename] = useState('my-animation');
  const [currentProjectFilename, setCurrentProjectFilename] = useState('');
  const [uiError, setUiError] = useState('');
  const [helpOpen, setHelpOpen] = useState(false);

  const handleRuntimeSelection = useCallback((runtime: RuntimeKind) => {
    setSelectedRuntime(runtime);
    localStorage.setItem(RUNTIME_SELECTED_KEY, runtime);
  }, []);

  const handleLlamaConfigChange = useCallback((patch: Partial<LlamaCppRuntimeConfig>) => {
    setLlamaConfig((current) => {
      const next = { ...current, ...patch };
      localStorage.setItem(LLAMA_SERVER_PATH_KEY, next.serverPath);
      localStorage.setItem(LLAMA_MODEL_PATH_KEY, next.modelPath);
      localStorage.setItem(LLAMA_PORT_KEY, String(next.port));
      localStorage.setItem(LLAMA_GPU_LAYERS_KEY, String(next.gpuLayers));
      return next;
    });
  }, []);

  const openSetupAssistant = useCallback(() => {
    setHelpOpen(false);
    setShowSetupAssistant(true);
  }, []);

  const closeSetupAssistant = useCallback(() => {
    setShowSetupAssistant(false);
  }, []);

  const handleSelectModelPath = useCallback((modelPath: string) => {
    handleLlamaConfigChange({ modelPath });
  }, [handleLlamaConfigChange]);

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
  }, [status, latestCode, lastSaved, baseFilename]);

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
    setSaveStatus(null);
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

  if (showSetupAssistant) {
    return (
      <SetupAssistant
        selectedRuntime={selectedRuntime}
        llamaConfig={llamaConfig}
        modelPathPresets={llamaModelPathPresets}
        runtimeStatus={runtimeStatus}
        runtimeError={runtimeErrorMsg}
        onRuntimeChange={handleRuntimeSelection}
        onLlamaConfigChange={handleLlamaConfigChange}
        onSelectModelPath={handleSelectModelPath}
        onClose={closeSetupAssistant}
      />
    );
  }

  if (runtimeStatus === 'checking') {
    return (
      <div className="startup-screen">
        <div style={{ fontSize: 64 }}>🤖</div>
        <div className="startup-title">Checking {selectedRuntime === 'ollama' ? 'Ollama' : 'llama.cpp'}...</div>
      </div>
    );
  }

  if (runtimeStatus === 'offline') {
    return (
      <div className="startup-screen">
        <div style={{ fontSize: 64 }}>😴</div>
        <div className="startup-title">{selectedRuntime === 'ollama' ? 'Gemma is sleeping!' : 'llama.cpp is not ready yet!'}</div>
        <div className="startup-msg">
          {selectedRuntime === 'ollama'
            ? 'Ask a grown-up to start Ollama, then press the button below.'
            : 'Open Setup, check your llama-server path, GGUF model path, and port, then try again.'}
        </div>
        {runtimeErrorMsg && (
          <div className="startup-msg" style={{ fontSize: '0.9rem' }}>
            For a grown-up: {runtimeErrorMsg}
          </div>
        )}
        <div style={{ display: 'flex', gap: 12 }}>
          <button className="btn-recheck" onClick={recheck}>Check Again</button>
          <button className="btn-recheck" onClick={openSetupAssistant}>Open Setup</button>
        </div>
      </div>
    );
  }

  if (selectedRuntime === 'ollama' && !models.some((m) => m.toLowerCase().includes('gemma'))) {
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
          <span className="app-title">
            gemma4kids
            <span className="runtime-pill">Runtime: {runtimeInUse === 'ollama' ? 'Ollama' : 'llama.cpp'}</span>
          </span>
          <div className="model-controls">
            <select
              className="model-selector"
              value={codingModel}
              onChange={(event) => handleModelChange(event.target.value)}
              title="Coding model"
            >
              {availableCodingModels.map((modelName) => (
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
            <button className="btn-setup" onClick={openSetupAssistant} aria-label="Setup assistant" title="Open Setup Assistant">Setup</button>
            <button className="btn-help" onClick={() => setHelpOpen(v => !v)} aria-label="Help" title="How to use Gemma4kids">?</button>
          </div>
        </header>
        {helpOpen && <HelpPanel onClose={() => setHelpOpen(false)} onOpenSetupAssistant={openSetupAssistant} />}

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
              showThinking={showThinking}
              ctxUsedPct={ctxUsedPct}
              onClearContext={handleClearContext}
              modelTier={modelTier}
            />
          </div>
        </div>

        <CodeRunner streaming={status === 'streaming'} enabled={isGemma426b(codingModel) || isGemma431b(codingModel)} />
      </div>
    </ErrorBoundary>
  );
}
