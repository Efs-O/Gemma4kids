/**
 * Butterfly generation benchmark — 4 combinations, single pass + local CSS audit.
 *
 * For each run saves:
 *   butterflies-{label}.html         — raw generation
 *   butterflies-{label}-audited.html — after local JS audit (no extra Ollama call)
 *
 * Usage: node scripts/test-butterfly-gen.mjs
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { homedir } from 'os';
import path from 'path';

const OLLAMA  = 'http://localhost:11434';
const OUT_DIR = path.join(homedir(), 'Documents', 'KidAnimations');

// Prompt with explicit bug-prevention constraints baked in
const GEN_PROMPT =
  'Create a complete, self-contained HTML file with a colorful animation of butterflies flying around flowers. ' +
  'Make it visually beautiful with bright colors, smooth animations, and a cheerful feel. ' +
  'Before outputting, verify:\n' +
  '- Every CSS custom property used (var(--x)) is defined on a rule that actually matches an element in the HTML\n' +
  '- Every CSS :nth-child() selector matches the real position of elements in the HTML\n' +
  '- All looping animations use `infinite`, not `forwards`\n' +
  '- All HTML tags are correctly spelled and closed\n' +
  '- There are no duplicate JavaScript tokens or undefined JS variables\n' +
  'Output ONLY the raw HTML starting with <!DOCTYPE html>. No markdown, no code fences, no explanation.';

const RUNS = [
  { model: 'gemma4:e4b', think: false, label: 'e4b-thinking-off' },
  { model: 'gemma4:e4b', think: true,  label: 'e4b-thinking-on'  },
  { model: 'gemma4:26b', think: false, label: '26b-thinking-off' },
  { model: 'gemma4:26b', think: true,  label: '26b-thinking-on'  },
];

const OLLAMA_OPTIONS = {
  num_ctx:     98304,
  num_predict: 32768,
  temperature: 1.0,
  top_p:       0.95,
  top_k:       64,
};

// ── Known mistyped closing tags Gemma produces ────────────────────────────────
const TAG_TYPO_MAP = {
  candas: 'style',   // </candas> seen in 26b output
  canavs: 'canvas',
  scrpit: 'script',
  styel:  'style',
  sytpe:  'style',
};

const VALID_HTML_TAGS = new Set([
  'html','head','body','div','span','p','a','img','canvas','script','style',
  'meta','link','title','h1','h2','h3','h4','h5','h6','ul','ol','li','table',
  'tr','td','th','form','input','button','select','option','textarea',
  'header','footer','nav','main','section','article','aside','figure',
  'figcaption','video','audio','source','svg','path','circle','rect','line',
  'polygon','polyline','g','defs','use','symbol','text','tspan',
]);

// ── CSS audit ─────────────────────────────────────────────────────────────────
function auditHtml(html) {
  const fixes = [];
  let out = html;

  // 1. Fix mistyped closing tags
  out = out.replace(/<\/([a-zA-Z][a-zA-Z0-9]*)>/g, (match, tag) => {
    const lower = tag.toLowerCase();
    if (VALID_HTML_TAGS.has(lower)) return match;
    const corrected = TAG_TYPO_MAP[lower];
    if (corrected) { fixes.push(`tag typo: </${tag}> → </${corrected}>`); return `</${corrected}>`; }
    return match;
  });

  // 2. Fix duplicate adjacent window token  e.g. "window        window.addEventListener"
  const dupBefore = out;
  out = out.replace(/\bwindow(\s{2,})window\b/g, 'window');
  if (out !== dupBefore) fixes.push('duplicate window token removed');

  // 3. Fix `forwards` → `infinite` in animation shorthand
  //    Only inside <style> blocks to avoid touching prose
  out = out.replace(/(<style[\s\S]*?<\/style>)/gi, styleBlock => {
    const fixed = styleBlock.replace(/\bforwards\b/g, () => {
      fixes.push('animation: forwards → infinite');
      return 'infinite';
    });
    return fixed;
  });

  // 4. CSS variable audit — find var(--x) usages, check each is defined
  const styleMatch = out.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
  if (styleMatch) {
    const css = styleMatch[1];

    const usedVars   = new Set([...css.matchAll(/var\(\s*--([^),\s]+)/g)].map(m => m[1]));
    const definedVars = new Set([...css.matchAll(/--([^:;\s]+)\s*:/g)].map(m => m[1]));

    const missing = [...usedVars].filter(v => !definedVars.has(v));
    if (missing.length > 0) {
      // Inject sensible defaults into :root at top of <style>
      const defaults = missing.map(v => {
        // Guess a reasonable default from the variable name
        if (/x|left|right|width/i.test(v)) return `  --${v}: 0vw`;
        if (/y|top|bottom|height/i.test(v)) return `  --${v}: 0vh`;
        if (/offset|shift|delta/i.test(v))  return `  --${v}: 0`;
        if (/speed|duration/i.test(v))      return `  --${v}: 1`;
        if (/color/i.test(v))               return `  --${v}: #ff69b4`;
        return `  --${v}: 0`;
      }).join(';\n');

      const rootBlock = `:root {\n${defaults};\n}`;
      out = out.replace(/<style([^>]*)>/, `<style$1>\n${rootBlock}\n`);
      fixes.push(`undefined CSS vars injected into :root: ${missing.join(', ')}`);
    }
  }

  return { html: out, fixes };
}

// ── Stream one Ollama chat call ───────────────────────────────────────────────
async function streamChat(messages, model, think) {
  const start = Date.now();
  let lastDot = start;

  const res = await fetch(`${OLLAMA}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, think, stream: true, options: OLLAMA_OPTIONS }),
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);

  const reader  = res.body.getReader();
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

// ── One full run ──────────────────────────────────────────────────────────────
async function run({ model, think, label }) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  ${label}   (model: ${model}  think: ${think})`);
  console.log(`${'═'.repeat(60)}`);

  process.stdout.write('  Generating ');
  const gen = await streamChat([{ role: 'user', content: GEN_PROMPT }], model, think);
  console.log(` done (${gen.elapsed}s, content: ~${gen.contentChunks}, think: ~${gen.thinkChunks})`);

  const rawHtml = extractHtml(gen.text);
  writeFileSync(path.join(OUT_DIR, `butterflies-${label}.html`), rawHtml, 'utf-8');
  console.log(`  Raw    → butterflies-${label}.html  (${(rawHtml.length / 1024).toFixed(1)} KB)`);

  const { html: auditedHtml, fixes } = auditHtml(rawHtml);
  writeFileSync(path.join(OUT_DIR, `butterflies-${label}-audited.html`), auditedHtml, 'utf-8');

  if (fixes.length === 0) {
    console.log('  Audit  → no fixes needed ✓');
  } else {
    console.log(`  Audit  → ${fixes.length} fix(es):`);
    fixes.forEach(f => console.log(`           • ${f}`));
  }

  return { genKb: rawHtml.length / 1024, auditKb: auditedHtml.length / 1024, fixes: fixes.length };
}

// ── Main ──────────────────────────────────────────────────────────────────────
if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

console.log('Butterfly benchmark — single pass + local CSS audit');
console.log(`Output dir: ${OUT_DIR}\n`);

const results = [];
for (const cfg of RUNS) {
  try {
    results.push({ label: cfg.label, ...(await run(cfg)) });
  } catch (err) {
    console.error(`\n  FAILED (${cfg.label}):`, err.message);
    results.push({ label: cfg.label, error: err.message });
  }
}

console.log('\n' + '═'.repeat(60));
console.log('  Summary');
console.log('═'.repeat(60));
console.log(`  ${'Label'.padEnd(25)} ${'Raw'.padStart(7)} ${'Audited'.padStart(9)} ${'Fixes'.padStart(7)}`);
for (const r of results) {
  if (r.error) {
    console.log(`  ${r.label.padEnd(25)} ERROR: ${r.error}`);
  } else {
    console.log(`  ${r.label.padEnd(25)} ${(r.genKb.toFixed(1)+' KB').padStart(7)} ${(r.auditKb.toFixed(1)+' KB').padStart(9)} ${String(r.fixes).padStart(7)}`);
  }
}
console.log('\n✅ Done. Compare *-audited.html vs raw in KidAnimations/');
