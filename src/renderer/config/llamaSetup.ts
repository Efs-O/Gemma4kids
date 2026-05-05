import type { RuntimeKind } from '../services/OllamaService';
import { OLLAMA_CHAT_PROFILE, OLLAMA_CHAT_WORKSTATION_CTX, OLLAMA_CHAT_WORKSTATION_PREDICT } from '../ollamaConstants';
import {
  isGemma426b,
  isGemma431b,
  isGemma4EdgeE2b,
  isGemma4EdgeE4b,
} from '../utils/pickCodingModel';

export const RUNTIME_SELECTED_KEY = 'runtime.selected';
export const LLAMA_SERVER_PATH_KEY = 'runtime.llama_cpp.serverPath';
const LEGACY_LLAMA_MODEL_PATH_KEY = 'runtime.llama_cpp.modelPath';
export const LLAMA_PORT_KEY = 'runtime.llama_cpp.port';
export const LLAMA_GPU_LAYERS_KEY = 'runtime.llama_cpp.gpuLayers';
export const LLAMA_CACHE_TYPE_K_KEY = 'runtime.llama_cpp.cacheTypeK';
export const LLAMA_CACHE_TYPE_V_KEY = 'runtime.llama_cpp.cacheTypeV';
export const DEFAULT_LLAMA_HUB_ROOT = 'N:\\.cache\\huggingface\\hub';
export const DEFAULT_LLAMA_CACHE_TYPE = 'f16';
export const LLAMA_CACHE_TYPE_OPTIONS = ['f16', 'bf16', 'q8_0', 'q5_1', 'q5_0', 'q4_1', 'q4_0', 'iq4_nl'] as const;

export const LLAMA_MODEL_PRESETS = [
  {
    id: 'e2b',
    label: 'Gemma 4 E2B',
    modelTag: 'gemma4:e2b',
    filename: 'gemma-4-E2B-it-Q4_K_M.gguf',
    repoSegment: 'models--unsloth--gemma-4-E2B-it-GGUF',
    snapshot: 'f064409f340b34190993560b2168133e5dbae558',
  },
  {
    id: 'e4b',
    label: 'Gemma 4 E4B',
    modelTag: 'gemma4:e4b',
    filename: 'gemma-4-E4B-it-Q4_K_M.gguf',
    repoSegment: 'models--unsloth--gemma-4-E4B-it-GGUF',
    snapshot: 'ce152932ac27bc40bc9c727386760424d50bb456',
  },
  {
    id: '26b',
    label: 'Gemma 4 26B',
    modelTag: 'gemma4:26b',
    filename: 'gemma-4-26B-A4B-it-UD-Q3_K_M.gguf',
    repoSegment: 'models--unsloth--gemma-4-26B-A4B-it-GGUF',
    snapshot: '2f6caf1733f31c87fdcfda391e978120033609a0',
  },
  {
    id: '31b',
    label: 'Gemma 4 31B',
    modelTag: 'gemma4:31b',
    filename: 'gemma-4-31B-it-Q3_K_S.gguf',
    repoSegment: 'models--unsloth--gemma-4-31B-it-GGUF',
    snapshot: '43e80d41a220ac7c83023daacd6a0d1fd8559251',
  },
] as const;

export type LlamaModelPresetId = typeof LLAMA_MODEL_PRESETS[number]['id'];
export type LlamaModelPaths = Record<LlamaModelPresetId, string>;

export interface LlamaCppSetupConfig {
  serverPath: string;
  modelPaths: LlamaModelPaths;
  port: number;
  gpuLayers: number;
  numCtx: number;
  numPredict: number;
  cacheTypeK: string;
  cacheTypeV: string;
}

export const LLAMA_MODEL_PATH_KEYS: Record<LlamaModelPresetId, string> = {
  e2b: 'runtime.llama_cpp.modelPath.e2b',
  e4b: 'runtime.llama_cpp.modelPath.e4b',
  '26b': 'runtime.llama_cpp.modelPath.26b',
  '31b': 'runtime.llama_cpp.modelPath.31b',
};
export const LLAMA_NUM_CTX_KEY = 'runtime.llama_cpp.numCtx';
export const LLAMA_NUM_PREDICT_KEY = 'runtime.llama_cpp.numPredict';

export function normalizeHubRoot(root: string): string {
  return root.trim().replace(/[\\/]+$/, '');
}

export function buildPresetPath(baseRoot: string, preset: typeof LLAMA_MODEL_PRESETS[number]): string {
  return `${normalizeHubRoot(baseRoot)}\\${preset.repoSegment}\\snapshots\\${preset.snapshot}\\${preset.filename}`;
}

function inferHubRootFromModelPath(modelPath: string): string | null {
  const markerIndex = modelPath.indexOf('models--');
  if (markerIndex === -1) return null;
  return normalizeHubRoot(modelPath.slice(0, markerIndex));
}

function makeDefaultLlamaModelPaths(baseRoot: string): LlamaModelPaths {
  return {
    e2b: buildPresetPath(baseRoot, LLAMA_MODEL_PRESETS[0]),
    e4b: buildPresetPath(baseRoot, LLAMA_MODEL_PRESETS[1]),
    '26b': buildPresetPath(baseRoot, LLAMA_MODEL_PRESETS[2]),
    '31b': buildPresetPath(baseRoot, LLAMA_MODEL_PRESETS[3]),
  };
}

function mergeModelPaths(current: Partial<LlamaModelPaths>, baseRoot: string): LlamaModelPaths {
  const defaults = makeDefaultLlamaModelPaths(baseRoot);
  return {
    e2b: current.e2b?.trim() ? current.e2b : defaults.e2b,
    e4b: current.e4b?.trim() ? current.e4b : defaults.e4b,
    '26b': current['26b']?.trim() ? current['26b'] : defaults['26b'],
    '31b': current['31b']?.trim() ? current['31b'] : defaults['31b'],
  };
}

function migrateLegacyModelPaths(legacyModelPath: string): LlamaModelPaths {
  const baseRoot = inferHubRootFromModelPath(legacyModelPath) ?? DEFAULT_LLAMA_HUB_ROOT;
  const next = makeDefaultLlamaModelPaths(baseRoot);
  const matched = LLAMA_MODEL_PRESETS.find((preset) => legacyModelPath.includes(preset.repoSegment));
  if (matched) {
    next[matched.id] = legacyModelPath;
  }
  return next;
}

export function readSelectedRuntime(): RuntimeKind {
  const stored = localStorage.getItem(RUNTIME_SELECTED_KEY);
  return stored === 'llama_cpp' ? 'llama_cpp' : 'ollama';
}

export function readStoredNumber(key: string, fallback: number): number {
  const stored = localStorage.getItem(key);
  if (stored == null) return fallback;
  const parsed = Number.parseInt(stored, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

export function persistLlamaModelPaths(modelPaths: LlamaModelPaths): void {
  for (const preset of LLAMA_MODEL_PRESETS) {
    localStorage.setItem(LLAMA_MODEL_PATH_KEYS[preset.id], modelPaths[preset.id]);
  }
}

export function readLlamaCppSetupConfig(): LlamaCppSetupConfig {
  const storedPaths: Partial<LlamaModelPaths> = {};
  for (const preset of LLAMA_MODEL_PRESETS) {
    const stored = localStorage.getItem(LLAMA_MODEL_PATH_KEYS[preset.id]) ?? '';
    if (stored.trim()) storedPaths[preset.id] = stored;
  }

  const legacyModelPath = localStorage.getItem(LEGACY_LLAMA_MODEL_PATH_KEY) ?? '';
  const baseRootSource = Object.values(storedPaths).find((value) => value.trim()) ?? legacyModelPath;
  const baseRoot = inferHubRootFromModelPath(baseRootSource) ?? DEFAULT_LLAMA_HUB_ROOT;
  const modelPaths = Object.keys(storedPaths).length > 0
    ? mergeModelPaths(storedPaths, baseRoot)
    : migrateLegacyModelPaths(legacyModelPath);

  persistLlamaModelPaths(modelPaths);
  if (legacyModelPath) localStorage.removeItem(LEGACY_LLAMA_MODEL_PATH_KEY);

  return {
    serverPath: localStorage.getItem(LLAMA_SERVER_PATH_KEY) ?? '',
    modelPaths,
    port: readStoredNumber(LLAMA_PORT_KEY, 8080),
    gpuLayers: readStoredNumber(LLAMA_GPU_LAYERS_KEY, -1),
    numCtx: readStoredNumber(LLAMA_NUM_CTX_KEY, OLLAMA_CHAT_WORKSTATION_CTX),
    numPredict: readStoredNumber(LLAMA_NUM_PREDICT_KEY, OLLAMA_CHAT_WORKSTATION_PREDICT),
    cacheTypeK: localStorage.getItem(LLAMA_CACHE_TYPE_K_KEY) ?? DEFAULT_LLAMA_CACHE_TYPE,
    cacheTypeV: localStorage.getItem(LLAMA_CACHE_TYPE_V_KEY) ?? DEFAULT_LLAMA_CACHE_TYPE,
  };
}

export function getConfiguredLlamaPathForModel(model: string, modelPaths: LlamaModelPaths): string {
  if (isGemma431b(model)) return modelPaths['31b'];
  if (isGemma426b(model)) return modelPaths['26b'];
  if (isGemma4EdgeE4b(model)) return modelPaths.e4b;
  if (isGemma4EdgeE2b(model)) return modelPaths.e2b;
  return modelPaths.e2b;
}

export function getDefaultLlamaNumCtx(model: string): number {
  return isGemma431b(model) || isGemma426b(model) ? OLLAMA_CHAT_WORKSTATION_CTX : OLLAMA_CHAT_PROFILE.numCtx;
}

export function getDefaultLlamaNumPredict(model: string): number {
  return isGemma431b(model) || isGemma426b(model) ? OLLAMA_CHAT_WORKSTATION_PREDICT : OLLAMA_CHAT_PROFILE.numPredict;
}
