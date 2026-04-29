import { useState, useEffect, useCallback } from 'react';
import { getModels, warmupCodingModel } from '../services/OllamaService';
import { pickCodingModel } from '../utils/pickCodingModel';

export type OllamaStatus = 'checking' | 'offline' | 'ready';

export interface UseOllamaResult {
  status: OllamaStatus;
  models: string[];
  errorMsg: string;
  recheck: () => void;
}

export function useOllama(): UseOllamaResult {
  const [status, setStatus] = useState<OllamaStatus>('checking');
  const [models, setModels] = useState<string[]>([]);
  const [errorMsg, setErrorMsg] = useState('');

  const check = useCallback(async () => {
    setStatus('checking');
    setErrorMsg('');
    try {
      const found = await getModels();
      setModels(found);
      setStatus('ready');
      warmupCodingModel(pickCodingModel(found));
    } catch (error) {
      setModels([]);
      setStatus('offline');
      setErrorMsg(error instanceof Error ? error.message : String(error));
    }
  }, []);

  useEffect(() => { check(); }, [check]);

  return { status, models, errorMsg, recheck: check };
}
