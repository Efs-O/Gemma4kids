import React from 'react';

interface Props {
  runtimeLabel: string;
  codingModel: string;
  availableCodingModels: string[];
  chatThinkEnabled: boolean;
  thinkingAvailable: boolean;
  showThinking: boolean;
  musicEnabled: boolean;
  filename: string;
  displayCode: string;
  currentProjectFilename: string;
  isStreaming: boolean;
  onModelChange: (modelName: string) => void;
  onThinkToggle: (enabled: boolean) => void;
  onShowThinkingToggle: (enabled: boolean) => void;
  onToggleMusic: () => void;
  onFilenameChange: (value: string) => void;
  onSave: () => void;
  onOpenBrowser: () => void;
  onOpenSetup: () => void;
  onToggleHelp: () => void;
}

export function AppHeader(props: Props) {
  const {
    runtimeLabel,
    codingModel,
    availableCodingModels,
    chatThinkEnabled,
    thinkingAvailable,
    showThinking,
    musicEnabled,
    filename,
    displayCode,
    currentProjectFilename,
    isStreaming,
    onModelChange,
    onThinkToggle,
    onShowThinkingToggle,
    onToggleMusic,
    onFilenameChange,
    onSave,
    onOpenBrowser,
    onOpenSetup,
    onToggleHelp,
  } = props;

  return (
    <header className="app-header">
      <span className="app-title">gemma4kids<span className="runtime-pill">Runtime: {runtimeLabel}</span></span>
      <div className="model-controls">
        <select className="model-selector" value={codingModel} onChange={(event) => onModelChange(event.target.value)} title="Coding model">
          {availableCodingModels.map((modelName) => <option key={modelName} value={modelName}>{modelName}</option>)}
        </select>
        <label className="think-toggle" title="Controls thinking for the coding reply model. Voice transcription always keeps thinking off.">
          <input type="checkbox" checked={chatThinkEnabled} onChange={(event) => onThinkToggle(event.target.checked)} disabled={!thinkingAvailable} />
          <span>{thinkingAvailable ? `Think ${chatThinkEnabled ? 'On' : 'Off'}` : 'Think Unavailable'}</span>
        </label>
        <label className="think-toggle" title="Show Gemma's reasoning bubble when the reply model returns it.">
          <input type="checkbox" checked={showThinking} onChange={(event) => onShowThinkingToggle(event.target.checked)} />
          <span>Show Thoughts</span>
        </label>
      </div>
      <div className="header-controls">
        <input className="filename-input" value={filename} onChange={(event) => onFilenameChange(event.target.value)} placeholder="animation name" />
        <button className="btn-save" onClick={onSave} disabled={!displayCode}>Save animation</button>
        <button className="btn-preview" onClick={onOpenBrowser} disabled={!currentProjectFilename || isStreaming}>Open in Browser</button>
        <button className="btn-setup" onClick={onOpenSetup} aria-label="Setup assistant" title="Open Setup Assistant">Setup</button>
        <button className="btn-help" onClick={onToggleHelp} aria-label="Help" title="How to use Gemma4kids">?</button>
        <button className="btn-music" onClick={onToggleMusic} aria-label="Background music" title="Toggle background music">
          {musicEnabled ? 'Music Off' : 'Music On'}
        </button>
      </div>
    </header>
  );
}
