import React from 'react';
import type { RuntimeKind } from '../services/OllamaService';

interface CheckingProps {
  selectedRuntime: RuntimeKind;
}

export function StartupChecking({ selectedRuntime }: CheckingProps) {
  return (
    <div className="startup-screen">
      <div style={{ fontSize: 64 }}>🤖</div>
      <div className="startup-title">Checking {selectedRuntime === 'ollama' ? 'Ollama' : 'llama.cpp'}...</div>
    </div>
  );
}

interface OfflineProps {
  selectedRuntime: RuntimeKind;
  runtimeErrorMsg: string;
  onRecheck: () => void;
  onOpenSetup: () => void;
}

export function StartupOffline({ selectedRuntime, runtimeErrorMsg, onRecheck, onOpenSetup }: OfflineProps) {
  return (
    <div className="startup-screen">
      <div style={{ fontSize: 64 }}>😴</div>
      <div className="startup-title">{selectedRuntime === 'ollama' ? 'Gemma is sleeping!' : 'llama.cpp is not ready yet!'}</div>
      <div className="startup-msg">
        {selectedRuntime === 'ollama' ? 'Ask a grown-up to start Ollama, then press the button below.' : 'Open Setup, check your llama-server path, GGUF paths, and port, then try again.'}
      </div>
      {runtimeErrorMsg && <div className="startup-msg" style={{ fontSize: '0.9rem' }}>For a grown-up: {runtimeErrorMsg}</div>}
      <div style={{ display: 'flex', gap: 12 }}>
        <button className="btn-recheck" onClick={onRecheck}>Check Again</button>
        <button className="btn-recheck" onClick={onOpenSetup}>Open Setup</button>
      </div>
    </div>
  );
}

interface NoModelsProps {
  onRecheck: () => void;
}

export function StartupNoModels({ onRecheck }: NoModelsProps) {
  return (
    <div className="startup-screen">
      <div style={{ fontSize: 64 }}>📥</div>
      <div className="startup-title">Gemma needs a download!</div>
      <div className="startup-msg">Ask a grown-up to open a terminal and type:</div>
      <div className="startup-code">ollama pull gemma4:31b</div>
      <div className="startup-msg" style={{ fontSize: '0.9rem', marginTop: 4 }}>(Or <code style={{ fontSize: '0.85em' }}>ollama pull gemma4:26b</code> · Optional voice: <code style={{ fontSize: '0.85em' }}>ollama pull gemma4:e4b</code>)</div>
      <button className="btn-recheck" onClick={onRecheck}>Check Again</button>
    </div>
  );
}
