import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  createLlamaCppAdapter,
  ollamaAdapter,
  type LLMRuntimeAdapter,
  type LlamaCppRuntimeConfig,
  type RuntimeKind,
} from '../services/OllamaService';
import { pickCodingModel } from '../utils/pickCodingModel';

export type OllamaStatus = 'checking' | 'offline' | 'ready';

export interface UseOllamaResult {
  runtime: RuntimeKind;
  adapter: LLMRuntimeAdapter;
  status: OllamaStatus;
  models: string[];
  errorMsg: string;
  runtimeMessage: string;
  runtimeDetails: string[];
  llamaMmprojPath: string | null;
  llamaSttMmprojPath: string | null;
  recheck: () => void;
  warmup: () => void;
}

export function useOllama(
  runtime: RuntimeKind = 'ollama',
  llamaConfig?: LlamaCppRuntimeConfig,
): UseOllamaResult {
  const adapter = useMemo(() => {
    if (runtime === 'llama_cpp' && llamaConfig) {
      return createLlamaCppAdapter(llamaConfig);
    }
    return ollamaAdapter;
  }, [llamaConfig, runtime]);
  const [status, setStatus] = useState<OllamaStatus>('checking');
  const [models, setModels] = useState<string[]>([]);
  const [errorMsg, setErrorMsg] = useState('');
  const [runtimeMessage, setRuntimeMessage] = useState('');
  const [runtimeDetails, setRuntimeDetails] = useState<string[]>([]);
  const [llamaMmprojPath, setLlamaMmprojPath] = useState<string | null>(null);
  const [llamaSttMmprojPath, setLlamaSttMmprojPath] = useState<string | null>(null);

  const check = useCallback(async () => {
    setStatus('checking');
    setErrorMsg('');
    setRuntimeMessage('');
    setRuntimeDetails([]);
    try {
      const health = await adapter.healthCheck();
      if (!health.ok) {
        setRuntimeMessage(health.message ?? '');
        setRuntimeDetails(health.details ?? []);
        throw new Error(health.error ?? 'The selected runtime is not ready.');
      }
      setRuntimeMessage(health.message ?? '');
      setRuntimeDetails(health.details ?? []);
      if (runtime === 'llama_cpp') {
        const llamaHealth = health as LlamaCppHealthResult;
        setLlamaMmprojPath(llamaHealth.mmprojPath ?? null);
        setLlamaSttMmprojPath(llamaHealth.sttMmprojPath ?? null);
      }
      const found = await adapter.listModels();
      const modelIds = found.map((model) => model.id);
      setModels(modelIds);
      setStatus('ready');
    } catch (error) {
      setModels([]);
      setLlamaMmprojPath(null);
      setLlamaSttMmprojPath(null);
      setStatus('offline');
      setErrorMsg(error instanceof Error ? error.message : String(error));
      if (runtime === 'llama_cpp' && error instanceof Error) {
        setRuntimeMessage(error.message);
      }
    }
  }, [adapter, runtime]);

  useEffect(() => { check(); }, [check]);

  const warmup = useCallback(() => {
    adapter.warmupCodingModel(pickCodingModel(models));
  }, [adapter, models]);

  return { runtime, adapter, status, models, errorMsg, runtimeMessage, runtimeDetails, llamaMmprojPath, llamaSttMmprojPath, recheck: check, warmup };
}
