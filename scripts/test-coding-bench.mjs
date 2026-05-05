/**
 * Coding-capability benchmark — 3 prompts × 4 variants = 12 runs.
 *
 * Three prompts of escalating difficulty:
 *   1. pulse-circle   — pure CSS, zero JS         (baseline: can the model code at all?)
 *   2. click-color    — one JS event handler       (sanity: does any JS work?)
 *   3. fireworks      — full animation with JS    (the real failure case)
 *
 * Four variants per prompt: gemma4:e4b/26b × thinking on/off.
 *
 * For each: save raw HTML, run audit, save audited HTML, parse both with acorn,
 * report ok / broken / no-script. Final summary tells you which {prompt, variant}
 * combinations produce runnable code.
 *
 * Usage: node scripts/test-coding-bench.mjs
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { homedir } from 'os';
import path from 'path';
import { Parser } from 'acorn';

const OLLAMA  = 'http://localhost:11434';
const OUT_DIR = path.join(homedir(), 'Documents', 'KidAnimations');

const OLLAMA_OPTIONS = {
  num_ctx:     98304,
  num_predict: 32768,
  temperature: 1.0,
  top_p:       0.95,
  top_k:       64,
};

// ── Prompt suffix matching production prompts.ts checklist ────────────────────
const CHECKLIST = `\n\nBefore outputting, verify:
- Every CSS custom property used (var(--x)) is defined on a rule that matches an element
- Every :nth-child() selector matches the real position of elements in the HTML
- All looping animations use \`infinite\`, not \`forwards\`
- All HTML tags are correctly spelled and closed
- No duplicate JavaScript tokens or undefined JS variables
- In JavaScript, element.style properties are camelCase (backgroundColor, not background-color)
Output ONLY the raw HTML starting with <!DOCTYPE html>. No markdown, no code fences, no explanation.`;

const PROMPTS = [
  {
    slug: 'pulse-circle',
    label: 'Pure CSS (baseline)',
    user:
      'Make a simple HTML page with a single yellow circle in the center of a blue background. ' +
      'The circle should smoothly pulse — grow larger and shrink back — forever. ' +
      'Use only CSS animation, no JavaScript.' + CHECKLIST,
  },
  {
    slug: 'click-color',
    label: 'Minimal JS (one event handler)',
    user:
      'Make a simple HTML page with a button labeled "Click me" in the center of the screen. ' +
      'When the button is clicked, the page background changes to a random bright color.' + CHECKLIST,
  },
  {
    slug: 'fireworks',
    label: 'Fireworks (full JS animation)',
    user:
      'Create a complete HTML page with colorful fireworks. When the page loads, fireworks should ' +
      'automatically appear at random positions on a dark background. Each firework is a burst of ' +
      'sparks in different colors that fly outward and fade away. Make it cheerful and beautiful.' + CHECKLIST,
  },
];

const VARIANTS = [
  { model: 'gemma4:e4b', think: false, label: 'e4b-off' },
  { model: 'gemma4:e4b', think: true,  label: 'e4b-on'  },
  { model: 'gemma4:26b', think: false, label: '26b-off' },
  { model: 'gemma4:26b', think: true,  label: '26b-on'  },
];

// ── audit (matches src/renderer/htmlAudit.ts) ────────────────────────────────
const TAG_TYPO_MAP = { candas:'style', canavs:'canvas', scrpit:'script', styel:'style', sytpe:'style' };
const VALID_HTML_TAGS = new Set([
  'html','head','body','div','span','p','a','img','canvas','script','style',
  'meta','link','title','h1','h2','h3','h4','h5','h6','ul','ol','li','table',
  'tr','td','th','form','input','button','select','option','textarea',
  'header','footer','nav','main','section','article','aside','figure',
  'figcaption','video','audio','source','svg','path','circle','rect','line',
  'polygon','polyline','g','defs','use','symbol','text','tspan',
]);

function auditHtml(html) {
  const fixes = [];
  let out = html;

  out = out.replace(/<\/([a-zA-Z][a-zA-Z0-9]*)>/g, (m, tag) => {
    const lower = tag.toLowerCase();
    if (VALID_HTML_TAGS.has(lower)) return m;
    if (TAG_TYPO_MAP[lower]) { fixes.push(`tag typo: </${tag}> → </${TAG_TYPO_MAP[lower]}>`); return `</${TAG_TYPO_MAP[lower]}>`; }
    return m;
  });

  const dupBefore = out;
  out = out.replace(/\bwindow(\s{2,})window\b/g, 'window');
  if (out !== dupBefore) fixes.push('duplicate window token removed');

  out = out.replace(/(<style[\s\S]*?<\/style>)/gi, b =>
    b.replace(/\bforwards\b/g, () => { fixes.push('animation: forwards → infinite'); return 'infinite'; }),
  );

  out = out.replace(/(<script[\s\S]*?<\/script>)/gi, b =>
    b.replace(/(\.style\.)([a-z]+(?:-[a-z]+)+)(\s*=)/g, (_m, p, prop, s) => {
      const camel = prop.replace(/-([a-z])/g, (_x, c) => c.toUpperCase());
      fixes.push(`style property: ${prop} → ${camel}`);
      return `${p}${camel}${s}`;
    }),
  );

  const styleMatch = out.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
  if (styleMatch) {
    const css = styleMatch[1];
    const usedVars = new Set([...css.matchAll(/var\(\s*--([^),\s]+)/g)].map(m => m[1]));
    const definedVars = new Set([...css.matchAll(/--([^:;\s]+)\s*:/g)].map(m => m[1]));
    const missing = [...usedVars].filter(v => !definedVars.has(v));
    if (missing.length) {
      const defaults = missing.map(v => {
        if (/x|left|right|width/i.test(v)) return `  --${v}: 0vw`;
        if (/y|top|bottom|height/i.test(v)) return `  --${v}: 0vh`;
        if (/offset|shift|delta/i.test(v))  return `  --${v}: 0`;
        if (/speed|duration/i.test(v))      return `  --${v}: 1`;
        if (/color/i.test(v))               return `  --${v}: #ff69b4`;
        return `  --${v}: 0`;
      }).join(';\n');
      out = out.replace(/<style([^>]*)>/, `<style$1>\n:root {\n${defaults};\n}\n`);
      fixes.push(`undefined CSS vars injected: ${missing.join(', ')}`);
    }
  }

  return { html: out, fixes };
}

function checkScripts(html) {
  const matches = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
  if (matches.length === 0) return { status: 'no-script', error: null };
  for (const m of matches) {
    const code = m[1].trim();
    if (!code) continue;
    try { Parser.parse(code, { ecmaVersion: 'latest', sourceType: 'script' }); }
    catch (e) { return { status: 'broken', error: e.message }; }
  }
  return { status: 'ok', error: null };
}

// ── streaming Ollama call ────────────────────────────────────────────────────
async function streamChat(messages, model, think) {
  const start = Date.now();
  let lastDot = start;

  const res = await fetch(`${OLLAMA}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, think, stream: true, options: OLLAMA_OPTIONS }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let full = '', thinkChunks = 0, contentChunks = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    for (const line of decoder.decode(value).split('\n')) {
      if (!line.trim()) continue;
      let obj; try { obj = JSON.parse(line); } catch { continue; }
      if (obj.message?.thinking) thinkChunks++;
      if (obj.message?.content)  { full += obj.message.content; contentChunks++; }
      if (Date.now() - lastDot > 2000) { process.stdout.write('.'); lastDot = Date.now(); }
    }
  }
  return { text: full, elapsed: ((Date.now() - start) / 1000).toFixed(1), thinkChunks, contentChunks };
}

function extractHtml(raw) {
  let html = raw.trim();
  const fence = html.match(/```(?:html)?\s*([\s\S]*?)```/i);
  if (fence) html = fence[1].trim();
  const idx = html.toLowerCase().indexOf('<!doctype');
  if (idx > 0) html = html.slice(idx);
  return html;
}

// ── one prompt × variant run ─────────────────────────────────────────────────
async function run(prompt, variant) {
  const tag = `${prompt.slug}-${variant.label}`;
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  ${tag}   (${prompt.label}, model: ${variant.model}, think: ${variant.think})`);
  console.log(`${'─'.repeat(60)}`);

  process.stdout.write('  Generating ');
  const gen = await streamChat([{ role: 'user', content: prompt.user }], variant.model, variant.think);
  console.log(` done (${gen.elapsed}s, content: ~${gen.contentChunks}, think: ~${gen.thinkChunks})`);

  const rawHtml = extractHtml(gen.text);
  writeFileSync(path.join(OUT_DIR, `${tag}.html`), rawHtml, 'utf-8');

  const rawParse = checkScripts(rawHtml);
  const { html: auditedHtml, fixes } = auditHtml(rawHtml);
  writeFileSync(path.join(OUT_DIR, `${tag}-audited.html`), auditedHtml, 'utf-8');
  const auditedParse = checkScripts(auditedHtml);

  console.log(`  raw     ${rawHtml.length.toString().padStart(5)} B   parse: ${rawParse.status}${rawParse.error ? ` — ${rawParse.error.slice(0, 50)}` : ''}`);
  if (fixes.length) {
    console.log(`  fixes  (${fixes.length}): ${fixes.join(', ').slice(0, 90)}`);
  } else {
    console.log(`  fixes  (0)`);
  }
  console.log(`  audited ${auditedHtml.length.toString().padStart(5)} B   parse: ${auditedParse.status}${auditedParse.error ? ` — ${auditedParse.error.slice(0, 50)}` : ''}`);

  return {
    promptSlug: prompt.slug,
    variant: variant.label,
    elapsed: parseFloat(gen.elapsed),
    rawBytes: rawHtml.length,
    rawParse: rawParse.status,
    rawError: rawParse.error,
    fixes: fixes.length,
    auditedParse: auditedParse.status,
    auditedError: auditedParse.error,
  };
}

// ── main ─────────────────────────────────────────────────────────────────────
if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

console.log('Coding-capability benchmark');
console.log(`Output dir: ${OUT_DIR}`);
console.log(`${PROMPTS.length} prompts × ${VARIANTS.length} variants = ${PROMPTS.length * VARIANTS.length} runs`);
console.log(`Model: e4b ~30-60s/run, 26b ~3min/run, 26b+think ~8min/run.\n`);

const results = [];
for (const p of PROMPTS) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  PROMPT: ${p.slug}  (${p.label})`);
  console.log(`${'═'.repeat(60)}`);
  for (const v of VARIANTS) {
    try {
      results.push(await run(p, v));
    } catch (err) {
      console.error(`  FAILED: ${err.message}`);
      results.push({ promptSlug: p.slug, variant: v.label, error: err.message });
    }
  }
}

// ── summary ──────────────────────────────────────────────────────────────────
console.log('\n' + '═'.repeat(78));
console.log('  Summary — runnable code per (prompt × variant)');
console.log('═'.repeat(78));

const variantHeaders = VARIANTS.map(v => v.label.padStart(10)).join(' ');
console.log(`  ${'Prompt'.padEnd(15)}  ${variantHeaders}`);

for (const p of PROMPTS) {
  const cells = VARIANTS.map(v => {
    const r = results.find(x => x.promptSlug === p.slug && x.variant === v.label);
    if (!r) return 'missing';
    if (r.error) return 'ERROR';
    if (r.auditedParse === 'broken') return '✗ broken';
    if (r.auditedParse === 'no-script') return '○ no-js';
    return '✓ ok';
  }).map(s => s.padStart(10)).join(' ');
  console.log(`  ${p.slug.padEnd(15)}  ${cells}`);
}

console.log('\n  Symbols:  ✓ ok = script parses    ○ no-js = no <script> at all (CSS-only output)    ✗ broken = SyntaxError');

// audit-gain: how many runs went from broken → ok via audit?
const gains = results.filter(r => r.rawParse === 'broken' && r.auditedParse === 'ok');
const stillBroken = results.filter(r => r.auditedParse === 'broken');
console.log(`\n  Audit gain:    ${gains.length} runs (${gains.length}/${results.length}) recovered: broken → ok`);
console.log(`  Still broken:  ${stillBroken.length} runs (${stillBroken.length}/${results.length}) need a retry`);
if (gains.length) {
  console.log(`  Recovered:     ${gains.map(r => `${r.promptSlug}/${r.variant}`).join(', ')}`);
}
if (stillBroken.length) {
  console.log(`  Still broken:`);
  for (const r of stillBroken) {
    console.log(`    ${r.promptSlug}/${r.variant}: ${r.auditedError?.slice(0, 70)}`);
  }
}

console.log('\n✅ Done. All HTML files saved to KidAnimations/ — open each in a browser to verify visually.');
