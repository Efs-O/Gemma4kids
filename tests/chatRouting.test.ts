import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectLang,
  extractHtml,
  extractPartialHtml,
  getLatestUserText,
  isSimpleMotionKeyword,
  isEditIntent,
  previewText,
  buildRequestMessages,
} from '../src/renderer/chatRouting';
import type { ChatMessage } from '../src/renderer/llm/types';

test('detectLang distinguishes Greek, German and English', () => {
  assert.equal(detectLang('φτιάξε ένα παιχνίδι'), 'el');
  assert.equal(detectLang('mach ein grünes Auto'), 'de');
  assert.equal(detectLang('make a bouncing ball'), 'en');
});

test('extractHtml reads a standard fenced block', () => {
  const html = '<!DOCTYPE html><html><body>hi</body></html>';
  assert.equal(extractHtml('here:\n```html\n' + html + '\n```'), html);
});

// Regression: fence without a trailing newline / with CRLF used to return null (audit §2.4).
test('extractHtml tolerates fences without a trailing newline and CRLF', () => {
  const html = '<!DOCTYPE html><html></html>';
  assert.equal(extractHtml('```html ' + html + '```'), html);
  assert.equal(extractHtml('```html\r\n' + html + '\r\n```'), html);
});

test('extractHtml falls back to a raw DOCTYPE scan when unfenced', () => {
  const html = '<!DOCTYPE html><html><body>x</body></html>';
  assert.equal(extractHtml('sure! ' + html), html);
});

test('extractPartialHtml captures a streaming document before the closing fence', () => {
  const partial = extractPartialHtml('blah <!DOCTYPE html><html><body>partial');
  assert.equal(partial, '<!DOCTYPE html><html><body>partial');
});

test('getLatestUserText skips [Context:] injections', () => {
  const history: ChatMessage[] = [
    { role: 'user', content: 'make a star' },
    { role: 'user', content: '[Context: editor has unsaved changes]' },
  ];
  assert.equal(getLatestUserText(history), 'make a star');
});

test('isSimpleMotionKeyword matches across languages', () => {
  assert.equal(isSimpleMotionKeyword('a bouncing ball'), true);
  assert.equal(isSimpleMotionKeyword('περιστρέφεται'), true);
  assert.equal(isSimpleMotionKeyword('tell me a story'), false);
});

test('isEditIntent recognises edit verbs and context injections', () => {
  assert.equal(isEditIntent('make it faster'), true);
  assert.equal(isEditIntent('fix the bug'), true);
  assert.equal(isEditIntent('[Context: editor has changes]'), true);
  assert.equal(isEditIntent('draw a brand new rocket'), false);
});

test('previewText truncates long input with an ellipsis', () => {
  assert.equal(previewText('abc'), 'abc');
  assert.equal(previewText('a'.repeat(200)).endsWith('...'), true);
  assert.equal(previewText('a'.repeat(200)).length, 143);
});

test('buildRequestMessages prepends a system prompt and keeps real turns', () => {
  const history: ChatMessage[] = [
    { role: 'user', content: 'make a tree' },
    { role: 'assistant', content: 'done' },
  ];
  const out = buildRequestMessages(history, 'full', null);
  assert.equal(out[0].role, 'system');
  assert.equal(out.length, 3);
  assert.equal(out[2].content, 'done');
});

// Regression: independent slicing could keep a tool result without its parent
// assistant tool-call (or vice-versa), which servers reject (audit §2.2).
test('buildRequestMessages drops an orphan tool result with no parent', () => {
  const history: ChatMessage[] = [
    { role: 'tool', content: '{"ok":true}', tool_call_id: 'gone', name: 'save_animation' },
    { role: 'user', content: 'thanks' },
  ];
  const out = buildRequestMessages(history, 'full', null);
  assert.equal(out.some((m) => m.role === 'tool'), false);
  assert.equal(out.some((m) => m.role === 'user'), true);
});

test('buildRequestMessages drops an assistant tool-call whose result is missing', () => {
  const history: ChatMessage[] = [
    {
      role: 'assistant',
      content: null,
      tool_calls: [{ id: 'c1', type: 'function', function: { name: 'list_animations', arguments: '{}' } }],
    },
    { role: 'user', content: 'hello' },
  ];
  const out = buildRequestMessages(history, 'full', null);
  assert.equal(out.some((m) => m.role === 'assistant' && m.tool_calls), false);
});

test('buildRequestMessages keeps a matched tool-call + result pair intact', () => {
  const history: ChatMessage[] = [
    {
      role: 'assistant',
      content: null,
      tool_calls: [{ id: 'c1', type: 'function', function: { name: 'list_animations', arguments: '{}' } }],
    },
    { role: 'tool', content: '{"files":[]}', tool_call_id: 'c1', name: 'list_animations' },
  ];
  const out = buildRequestMessages(history, 'full', null);
  assert.equal(out.some((m) => m.role === 'assistant' && m.tool_calls), true);
  assert.equal(out.some((m) => m.role === 'tool'), true);
});
