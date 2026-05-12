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
  llamaMmprojPath: string | null;
  llamaSttMmprojPath: string | null;
  recheck: () => void;
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
  const [llamaMmprojPath, setLlamaMmprojPath] = useState<string | null>(null);
  const [llamaSttMmprojPath, setLlamaSttMmprojPath] = useState<string | null>(null);

  const check = useCallback(async () => {
    setStatus('checking');
    setErrorMsg('');
    try {
      const health = await adapter.healthCheck();
      if (!health.ok) {
        throw new Error(health.error ?? 'The selected runtime is not ready.');
      }
      if (runtime === 'llama_cpp') {
        const llamaHealth = health as LlamaCppHealthResult;
        setLlamaMmprojPath(llamaHealth.mmprojPath ?? null);
        setLlamaSttMmprojPath(llamaHealth.sttMmprojPath ?? null);
      }
      const found = await adapter.listModels();
      const modelIds = found.map((model) => model.id);
      setModels(modelIds);
      setStatus('ready');
      adapter.warmupCodingModel(pickCodingModel(modelIds));
    } catch (error) {
      setModels([]);
      setLlamaMmprojPath(null);
      setLlamaSttMmprojPath(null);
      setStatus('offline');
      setErrorMsg(error instanceof Error ? error.message : String(error));
    }
  }, [adapter, runtime]);

  useEffect(() => { check(); }, [check]);

  return { runtime, adapter, status, models, errorMsg, llamaMmprojPath, llamaSttMmprojPath, recheck: check };
}
