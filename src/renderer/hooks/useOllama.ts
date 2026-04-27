import { useState, useEffect, useCallback } from 'react';
import { isRunning, getModels } from '../services/OllamaService';

export type OllamaStatus = 'checking' | 'offline' | 'ready';

export interface UseOllamaResult {
  status: OllamaStatus;
  models: string[];
  recheck: () => void;
}

export function useOllama(): UseOllamaResult {
  const [status, setStatus] = useState<OllamaStatus>('checking');
  const [models, setModels] = useState<string[]>([]);

  const check = useCallback(async () => {
    setStatus('checking');
    const running = await isRunning();
    if (!running) {
      setStatus('offline');
      return;
    }
    const found = await getModels();
    setModels(found);
    setStatus('ready');
  }, []);

  useEffect(() => { check(); }, [check]);

  return { status, models, recheck: check };
}
