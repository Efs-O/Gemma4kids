import React from 'react';
import type { RuntimeKind } from '../services/OllamaService';
import {
  DEFAULT_LLAMA_CACHE_TYPE,
  LLAMA_CACHE_TYPE_OPTIONS,
  LLAMA_MODEL_PRESETS,
  type LlamaCppSetupConfig,
  type LlamaModelPresetId,
} from '../config/llamaSetup';

const OLLAMA_LOGO_SRC = './ollama logo.jpg';
const LLAMA_LOGO_SRC = './llama server.jpg';

interface Props {
  selectedRuntime: RuntimeKind;
  llamaSetup: LlamaCppSetupConfig;
  runtimeStatus: 'checking' | 'offline' | 'ready';
  runtimeError: string;
  onRuntimeChange: (runtime: RuntimeKind) => void;
  onLlamaSetupChange: (patch: Partial<LlamaCppSetupConfig>) => void;
  onLlamaModelPathChange: (id: LlamaModelPresetId, modelPath: string) => void;
  onClose: () => void;
}

export function SetupAssistant({
  selectedRuntime,
  llamaSetup,
  runtimeStatus,
  runtimeError,
  onRuntimeChange,
  onLlamaSetupChange,
  onLlamaModelPathChange,
  onClose,
}: Props) {
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
            <img className="runtime-card-logo" src={OLLAMA_LOGO_SRC} alt="Ollama logo" />
            <span className="runtime-card-title">Ollama Server</span>
            <span className="runtime-card-tag">Recommended</span>
            <span className="runtime-card-copy">Easy setup, guided checks, and the current live runtime for Gemma4kids.</span>
          </button>

          <button
            className={`runtime-card${selectedRuntime === 'llama_cpp' ? ' runtime-card-selected' : ''}`}
            onClick={() => onRuntimeChange('llama_cpp')}
            type="button"
          >
            <img className="runtime-card-logo runtime-card-logo-llama" src={LLAMA_LOGO_SRC} alt="llama.cpp logo" />
            <span className="runtime-card-title">llama.cpp</span>
            <span className="runtime-card-tag runtime-card-tag-advanced">Advanced</span>
            <span className="runtime-card-copy">Manual binary path, one persistent GGUF path per Gemma size, and deeper control. Gemma4kids will start the local server when this runtime is selected.</span>
          </button>
        </div>

        <div className="setup-status">
          <strong>Current runtime check:</strong>{' '}
          {runtimeStatus === 'checking' && `Checking ${selectedRuntime === 'ollama' ? 'Ollama' : 'llama.cpp'}...`}
          {runtimeStatus === 'ready' && `${selectedRuntime === 'ollama' ? 'Ollama' : 'llama.cpp'} is ready.`}
          {runtimeStatus === 'offline' && runtimeError}
        </div>

        {selectedRuntime === 'llama_cpp' && (
          <div className="setup-form">
            <label className="setup-field">
              <span>llama-server Path</span>
              <input
                type="text"
                value={llamaSetup.serverPath}
                onChange={(event) => onLlamaSetupChange({ serverPath: event.target.value })}
                placeholder="C:\\path\\to\\llama-server.exe"
              />
            </label>

            <div className="setup-model-grid">
              {LLAMA_MODEL_PRESETS.map((preset) => (
                <div key={preset.id} className="setup-model-card">
                  <label className="setup-field">
                    <span>{preset.label} GGUF Path</span>
                    <input
                      type="text"
                      value={llamaSetup.modelPaths[preset.id]}
                      onChange={(event) => onLlamaModelPathChange(preset.id, event.target.value)}
                      placeholder="C:\\models\\gemma.gguf"
                    />
                  </label>
                </div>
              ))}
            </div>

            <div className="setup-inline-fields">
              <label className="setup-field">
                <span>Context Length</span>
                <input
                  type="number"
                  value={llamaSetup.numCtx}
                  onChange={(event) => onLlamaSetupChange({ numCtx: Number.parseInt(event.target.value, 10) || 65536 })}
                  min={4096}
                  max={262144}
                  step={1024}
                />
              </label>
              <label className="setup-field">
                <span>Generation Tokens</span>
                <input
                  type="number"
                  value={llamaSetup.numPredict}
                  onChange={(event) => onLlamaSetupChange({ numPredict: Number.parseInt(event.target.value, 10) || 32768 })}
                  min={256}
                  max={131072}
                  step={256}
                />
              </label>
              <label className="setup-field">
                <span>Port</span>
                <input
                  type="number"
                  value={llamaSetup.port}
                  onChange={(event) => onLlamaSetupChange({ port: Number.parseInt(event.target.value, 10) || 8080 })}
                  min={1024}
                  max={65535}
                />
              </label>
              <label className="setup-field">
                <span>GPU Layers</span>
                <input
                  type="number"
                  value={llamaSetup.gpuLayers}
                  onChange={(event) => onLlamaSetupChange({ gpuLayers: Number.parseInt(event.target.value, 10) || -1 })}
                  min={-1}
                />
              </label>
              <label className="setup-field">
                <span>Cache Type K</span>
                <select
                  value={llamaSetup.cacheTypeK || DEFAULT_LLAMA_CACHE_TYPE}
                  onChange={(event) => onLlamaSetupChange({ cacheTypeK: event.target.value })}
                >
                  {LLAMA_CACHE_TYPE_OPTIONS.map((cacheType) => (
                    <option key={cacheType} value={cacheType}>{cacheType}</option>
                  ))}
                </select>
              </label>
              <label className="setup-field">
                <span>Cache Type V</span>
                <select
                  value={llamaSetup.cacheTypeV || DEFAULT_LLAMA_CACHE_TYPE}
                  onChange={(event) => onLlamaSetupChange({ cacheTypeV: event.target.value })}
                >
                  {LLAMA_CACHE_TYPE_OPTIONS.map((cacheType) => (
                    <option key={cacheType} value={cacheType}>{cacheType}</option>
                  ))}
                </select>
              </label>
            </div>
          </div>
        )}

        <div className="setup-actions">
          <button className="setup-primary" onClick={onClose} type="button">Start Gemma4kids</button>
        </div>
      </div>
    </div>
  );
}
