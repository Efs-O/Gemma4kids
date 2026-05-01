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

  const check = useCallback(async () => {
    setStatus('checking');
    setErrorMsg('');
    try {
      const health = await adapter.healthCheck();
      if (!health.ok) {
        throw new Error(health.error ?? 'The selected runtime is not ready.');
      }
      const found = await adapter.listModels();
      const modelIds = found.map((model) => model.id);
      setModels(modelIds);
      setStatus('ready');
      adapter.warmupCodingModel(pickCodingModel(modelIds));
    } catch (error) {
      setModels([]);
      setStatus('offline');
      setErrorMsg(error instanceof Error ? error.message : String(error));
    }
  }, [adapter]);

  useEffect(() => { check(); }, [check]);

  return { runtime, adapter, status, models, errorMsg, recheck: check };
}
