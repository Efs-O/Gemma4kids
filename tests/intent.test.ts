import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isCodeCreationIntent,
  isVideoFrameExportIntent,
  isVideoUnderstandingIntent,
  shouldUseDraftForMessage,
} from '../src/renderer/intent';

test('isCodeCreationIntent matches build/animation vocabulary', () => {
  assert.equal(isCodeCreationIntent('make an animation'), true);
  assert.equal(isCodeCreationIntent('open in browser'), true);
  assert.equal(isCodeCreationIntent('tell me a joke'), false);
});

test('isVideoFrameExportIntent matches frame-export phrasings', () => {
  assert.equal(isVideoFrameExportIntent('save a few frames'), true);
  assert.equal(isVideoFrameExportIntent('grab frame at the end'), true);
  assert.equal(isVideoFrameExportIntent('make it spin'), false);
});

test('isVideoUnderstandingIntent matches description questions', () => {
  assert.equal(isVideoUnderstandingIntent("what's happening in the clip"), true);
  assert.equal(isVideoUnderstandingIntent('describe this video'), true);
  assert.equal(isVideoUnderstandingIntent('draw a rocket'), false);
});

test('shouldUseDraftForMessage matches edit-ish messages', () => {
  assert.equal(shouldUseDraftForMessage('make it faster'), true);
  assert.equal(shouldUseDraftForMessage('remove the red box'), true);
  assert.equal(shouldUseDraftForMessage('a brand new scene'), false);
});
