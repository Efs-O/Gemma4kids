import test from 'node:test';
import assert from 'node:assert/strict';
import { parseInlineExecuteTool } from '../src/renderer/chatTools';

const Q = '<|"|>';

test('returns null when no inline tool marker is present', () => {
  assert.equal(parseInlineExecuteTool('just a normal reply'), null);
});

test('parses a single-field inline execute_tool call', () => {
  // The model emits key:<|"|>value<|"|> with no space between the colon and the quote.
  const text = `<execute_tool>open_in_browser{filename:${Q}my-star${Q}}`;
  const calls = parseInlineExecuteTool(text);
  assert.notEqual(calls, null);
  assert.equal(calls!.length, 1);
  assert.equal(calls![0].function.name, 'open_in_browser');
  assert.deepEqual(JSON.parse(calls![0].function.arguments), { filename: 'my-star' });
});

test('parses a multi-field inline execute_tool call preserving raw HTML', () => {
  const html = '<!DOCTYPE html><html>{ weird: "value" }</html>';
  const text = `<execute_tool>save_animation{filename:${Q}tree${Q},html_content:${Q}${html}${Q}}`;
  const calls = parseInlineExecuteTool(text);
  assert.notEqual(calls, null);
  const args = JSON.parse(calls![0].function.arguments) as { filename: string; html_content: string };
  assert.equal(args.filename, 'tree');
  assert.equal(args.html_content, html);
});

test('returns null for a marker with no parseable fields', () => {
  assert.equal(parseInlineExecuteTool('<execute_tool>save_animation{ }'), null);
});
