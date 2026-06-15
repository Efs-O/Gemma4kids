import test from 'node:test';
import assert from 'node:assert/strict';
import { auditHtml } from '../src/renderer/htmlAudit';

test('repairs a known mistyped closing tag', () => {
  const result = auditHtml('<canvas></canavs>');
  assert.match(result.html, /<\/canvas>/);
  assert.equal(result.fixes.some((f) => f.includes('canavs')), true);
});

test('converts kebab-case DOM style assignments to camelCase inside scripts', () => {
  const input = '<script>el.style.background-color = "red";</script>';
  const result = auditHtml(input);
  assert.match(result.html, /\.style\.backgroundColor\s*=/);
});

test('strips bare CSS units used inside JS arithmetic', () => {
  const input = '<script>const x = Math.random() * 100vw;</script>';
  const result = auditHtml(input);
  assert.match(result.html, /Math\.random\(\) \* 100;/);
  assert.equal(result.fixes.some((f) => f.includes('100vw')), true);
});

test('reports a clean parse for valid script and no-op for plain HTML', () => {
  const valid = auditHtml('<script>const a = 1; console.log(a);</script>');
  assert.equal(valid.scriptParse, 'ok');

  const noScript = auditHtml('<div>hello</div>');
  assert.equal(noScript.scriptParse, 'no-script');
  assert.equal(noScript.fixes.length, 0);
});

test('flags broken script syntax without throwing', () => {
  const result = auditHtml('<script>function ( {</script>');
  assert.equal(result.scriptParse, 'broken');
  assert.notEqual(result.scriptError, null);
});

test('warns when an animation duration var resolves to a unitless number', () => {
  const css = ':root{--d:3;}.b{animation: bounce var(--d);}';
  const result = auditHtml(`<style>${css}</style>`);
  assert.equal(result.visualWarnings.some((w) => w.includes('animation duration')), true);
});
