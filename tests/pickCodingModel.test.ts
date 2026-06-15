import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeOllamaModelRef,
  isGemma4EdgeE4b,
  isGemma4EdgeE2b,
  isPlainGemma4E2b,
  isGemma412b,
  isGemma426b,
  isGemma431b,
  pickCodingModel,
  getModelTier,
  sortGemma4CodingModelsSmallestFirst,
  pickTranscribeModel,
  hasSupportedOllamaTranscribeModel,
} from '../src/renderer/utils/pickCodingModel';

test('normalizeOllamaModelRef strips a registry host prefix', () => {
  assert.equal(normalizeOllamaModelRef('registry.example.com/gemma4:e4b'), 'gemma4:e4b');
  assert.equal(normalizeOllamaModelRef('gemma4:e4b'), 'gemma4:e4b');
});

test('family predicates classify each tier', () => {
  assert.equal(isGemma4EdgeE2b('gemma4:e2b'), true);
  assert.equal(isGemma4EdgeE4b('gemma4:latest'), true);
  assert.equal(isGemma412b('gemma4:12b-it-q4'), true);
  assert.equal(isGemma426b('gemma4:26b'), true);
  assert.equal(isGemma431b('gemma4:31b'), true);
  assert.equal(isPlainGemma4E2b('gemma4:e2b'), true);
  assert.equal(isPlainGemma4E2b('gemma4:e2b-it-q4'), false);
});

test('pickCodingModel prefers the lightest available tier', () => {
  assert.equal(pickCodingModel([]), 'gemma4:e2b');
  assert.equal(pickCodingModel(['gemma4:26b', 'gemma4:e4b']), 'gemma4:e4b');
  assert.equal(pickCodingModel(['gemma4:26b', 'gemma4:e2b', 'gemma4:e4b']), 'gemma4:e2b');
  assert.equal(pickCodingModel(['llama3:8b']), 'llama3:8b');
});

test('getModelTier maps edge models to the simple tier', () => {
  assert.equal(getModelTier('gemma4:e2b'), 'simple');
  assert.equal(getModelTier('gemma4:e4b'), 'simple');
  assert.equal(getModelTier('gemma4:26b'), 'full');
});

test('sortGemma4CodingModelsSmallestFirst orders tiers ascending', () => {
  const sorted = sortGemma4CodingModelsSmallestFirst(['gemma4:31b', 'gemma4:e2b', 'gemma4:12b', 'gemma4:e4b']);
  assert.deepEqual(sorted, ['gemma4:e2b', 'gemma4:e4b', 'gemma4:12b', 'gemma4:31b']);
});

test('transcribe-model helpers detect a supported STT candidate', () => {
  assert.equal(pickTranscribeModel(['gemma4:e4b']), 'gemma4:e4b');
  assert.equal(hasSupportedOllamaTranscribeModel(['gemma4:e4b']), true);
  assert.equal(hasSupportedOllamaTranscribeModel(['llama3:8b']), false);
});
