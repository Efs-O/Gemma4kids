import React, { useReducer, useRef, useCallback, useEffect } from 'react';
import { ChatPanel } from './components/ChatPanel';
import { EditorPanel } from './components/EditorPanel';
import { streamChatCompletion } from './llm/OpenAIClient';
import { CancellationToken } from './llm/cancellation';
import type { ChatMessage } from './llm/types';

const OLLAMA_BASE = 'http://localhost:11434';

const SYSTEM_PROMPT = `You are Gemma, a friendly AI coding teacher for kids aged 8-14.
Always explain things in simple, encouraging language a child can understand.
When writing code, ALWAYS provide a complete, runnable HTML file inside a \`\`\`html code block.
Never write partial code — always include the full file from <!DOCTYPE html> to </html>.
Keep animations colorful, fun, and simple.
If asked a question without code, answer warmly and offer to show a fun example.`;

function extractHtml(text: string): string | null {
  const match = text.match(/```(?:html)?\n([\s\S]*?)```/i);
  return match ? match[1].trim() : null;
}

interface AppState {
  messages: ChatMessage[];
  streamingText: string;
  code: string;
  filename: string;
  model: string;
  models: string[];
  status: 'idle' | 'streaming' | 'error';
  errorMsg: string;
  savedFilename: string;
}

type AppAction =
  | { type: 'send'; text: string }
  | { type: 'token'; token: string }
  | { type: 'done' }
  | { type: 'error'; msg: string }
  | { type: 'cancel' }
  | { type: 'code_change'; code: string }
  | { type: 'set_models'; models: string[] }
  | { type: 'set_model'; model: string }
  | { type: 'set_filename'; name: string }
  | { type: 'set_saved'; filename: string };

function reducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'send':
      return { ...state, messages: [...state.messages, { role: 'user', content: action.text }], streamingText: '', status: 'streaming', errorMsg: '' };
    case 'token':
      return { ...state, streamingText: state.streamingText + action.token };
    case 'done': {
      const newCode = extractHtml(state.streamingText);
      return {
        ...state,
        messages: [...state.messages, { role: 'assistant', content: state.streamingText }],
        streamingText: '',
        code: newCode ?? state.code,
        status: 'idle',
      };
    }
    case 'error':
      return { ...state, status: 'error', errorMsg: action.msg, streamingText: '' };
    case 'cancel':
      return {
        ...state,
        messages: state.streamingText ? [...state.messages, { role: 'assistant', content: state.streamingText }] : state.messages,
        streamingText: '',
        status: 'idle',
      };
    case 'code_change':
      return { ...state, code: action.code };
    case 'set_models':
      return {
        ...state,
        models: action.models,
        model: action.models.find(m => m.toLowerCase().includes('gemma')) ?? action.models[0] ?? state.model,
      };
    case 'set_model':
      return { ...state, model: action.model };
    case 'set_filename':
      return { ...state, filename: action.name };
    case 'set_saved':
      return { ...state, savedFilename: action.filename };
    default:
      return state;
  }
}

const initial: AppState = {
  messages: [],
  streamingText: '',
  code: '',
  filename: 'my-animation',
  model: 'gemma4:4b',
  models: [],
  status: 'idle',
  errorMsg: '',
  savedFilename: '',
};

export default function App() {
  const [state, dispatch] = useReducer(reducer, initial);
  const cancelRef = useRef<CancellationToken | null>(null);

  useEffect(() => {
    fetch(`${OLLAMA_BASE}/api/tags`)
      .then(r => r.json())
      .then((data: { models: Array<{ name: string }> }) => {
        const names = data.models.map(m => m.name);
        if (names.length > 0) dispatch({ type: 'set_models', models: names });
      })
      .catch(() => { /* Ollama not running yet — keep default model */ });
  }, []);

  const handleSend = useCallback((text: string) => {
    const token = new CancellationToken();
    cancelRef.current = token;
    dispatch({ type: 'send', text });

    const messages: ChatMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...state.messages,
      { role: 'user', content: text },
    ];

    streamChatCompletion(
      OLLAMA_BASE,
      { model: state.model, messages, stream: true, temperature: 0.7 },
      {
        onToken: t => dispatch({ type: 'token', token: t }),
        onDone: () => dispatch({ type: 'done' }),
        onError: e => dispatch({ type: 'error', msg: e.message }),
      },
      token.signal,
    );
  }, [state.messages, state.model]);

  const handleCancel = useCallback(() => {
    cancelRef.current?.cancel();
    dispatch({ type: 'cancel' });
  }, []);

  const handleSave = useCallback(async () => {
    if (!state.code) return;
    const result = await window.electronAPI.saveAnimation(state.filename, state.code);
    if (result.success) dispatch({ type: 'set_saved', filename: result.filename });
    else dispatch({ type: 'error', msg: result.error ?? 'Save failed' });
  }, [state.code, state.filename]);

  const handleOpenBrowser = useCallback(async () => {
    if (!state.savedFilename) return;
    await window.electronAPI.openInBrowser(state.savedFilename);
  }, [state.savedFilename]);

  return (
    <div className="app">
      <header className="app-header">
        <span className="app-title">✨ gemma4kids</span>
        <div className="header-controls">
          <select value={state.model} onChange={e => dispatch({ type: 'set_model', model: e.target.value })}>
            {state.models.length === 0
              ? <option value={state.model}>{state.model}</option>
              : state.models.map(m => <option key={m} value={m}>{m}</option>)
            }
          </select>
          <input
            className="filename-input"
            value={state.filename}
            onChange={e => dispatch({ type: 'set_filename', name: e.target.value })}
            placeholder="filename"
          />
          <button className="btn-save" onClick={handleSave} disabled={!state.code}>Save</button>
          <button className="btn-preview" onClick={handleOpenBrowser} disabled={!state.savedFilename}>Open in Browser</button>
        </div>
      </header>
      <div className="app-body">
        <EditorPanel code={state.code} onChange={code => dispatch({ type: 'code_change', code })} />
        <ChatPanel
          messages={state.messages}
          streamingText={state.streamingText}
          status={state.status}
          errorMsg={state.errorMsg}
          onSend={handleSend}
          onCancel={handleCancel}
        />
      </div>
    </div>
  );
}
