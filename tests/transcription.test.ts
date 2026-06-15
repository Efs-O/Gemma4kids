import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTranscribePrompt,
  stripPromptEcho,
  looksLikeTranscriptionRefusal,
} from '../src/shared/transcription';

test('buildTranscribePrompt routes by language hint', () => {
  assert.match(buildTranscribePrompt('el'), /Greek/);
  assert.match(buildTranscribePrompt('el-strict'), /only Greek script/);
  assert.match(buildTranscribePrompt('de'), /German/);
  assert.match(buildTranscribePrompt('en'), /English/);
  assert.match(buildTranscribePrompt(), /First infer whether/);
});

test('stripPromptEcho removes a leading echoed prompt', () => {
  const prompt = buildTranscribePrompt('en');
  assert.equal(stripPromptEcho(prompt + ' hello world', 'en'), 'hello world');
  assert.equal(stripPromptEcho(prompt, 'en'), '');
  assert.equal(stripPromptEcho('just a transcript', 'en'), 'just a transcript');
});

test('looksLikeTranscriptionRefusal detects refusal phrasings', () => {
  assert.equal(looksLikeTranscriptionRefusal('There is no speech in this audio.'), true);
  assert.equal(looksLikeTranscriptionRefusal('I cannot provide a transcription.'), true);
  assert.equal(looksLikeTranscriptionRefusal('γεια σου κόσμε'), false);
  assert.equal(looksLikeTranscriptionRefusal(''), false);
});
