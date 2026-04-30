// Gemma4kids benchmark — Simple Mode validation runner.
// Tests the two-tier model strategy: e2b/e4b for static CSS art + __TOOBIG__ sentinel.
// Run all stages:      node benchmark/runner-simple.mjs
// Run one stage:       node benchmark/runner-simple.mjs --stage 1|2|3
// Results: benchmark/results-simple/{art,edits,sentinel}/

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const RESULTS    = path.join(__dirname, 'results-simple');
const OLLAMA     = 'http://localhost:11434';
const MODELS     = ['gemma4:e2b', 'gemma4:e4b'];
const TIMEOUT_MS = 360_000;

const OLLAMA_OPTIONS = {
  temperature: 1.0,
  top_p:       0.95,
  top_k:       64,
  num_ctx:     32768,
  num_predict: 16384,
};

// ── system prompt ─────────────────────────────────────────────────────────────

const SIMPLE_SYSTEM_PROMPT = `You are Gemma, a friendly art assistant for kids aged 6–11.
You create beautiful static CSS illustrations — colourful pictures made entirely with HTML and CSS.

RULES:
- Output a complete HTML file from <!DOCTYPE html> to </html>.
- Use only CSS shapes, colours, and layout. No JavaScript animations or canvas.
- Use bright, vivid colours. Never grey, beige, or white backgrounds.
- Fill the whole screen. Use 100vw / 100vh on body.
- Set body { display: flex; align-items: center; justify-content: center; margin: 0; } to centre every scene.
- Symmetric features (eyes, whiskers, petals, arms) must use equal, mirrored values from the centre — never guess placement.
- Wrap your HTML in a \`\`\`html code block.
- Every closing tag must be correct: </style>, </div>, </html>.

STOP — before writing any HTML, read the child's request and check for these words:
moves moving bounces bouncing falls falling spins spinning rotates rotating
flies flying swims swimming launch launches launching
animates animated animation twinkles twinkling explodes exploding
fireworks confetti sparkles game score shoot jump juggling dancing

If ANY of those words appear explicitly in the request → output ONLY: __TOOBIG__
Do not attempt a static version. Do not explain. Do not apologise.

FINAL CHECK: Scan the request for ANY word from the list above.
Found one? → __TOOBIG__ and nothing else.
Found none? → output the complete HTML file.`;

// ── corpora ───────────────────────────────────────────────────────────────────

const ART_STARTERS = [
  { slug: 'birthday-card',    text: 'Make a colourful birthday card with balloons and a cake' },
  { slug: 'happy-sunshine',   text: 'Draw a big happy sunshine with a blue sky' },
  { slug: 'flower-vase',      text: 'Paint a flower in a vase with colourful petals' },
  { slug: 'rainbow-flag',     text: 'Make a rainbow flag with all the colours' },
  { slug: 'smiley-face',      text: 'Draw a big smiling emoji face' },
  { slug: 'house-garden',     text: 'Draw a house with a garden and flowers' },
  { slug: 'cat-face',         text: 'Draw a cute cat face with whiskers and big eyes' },
  { slug: 'pizza-slice',      text: 'Make a colourful pizza slice with toppings' },
  { slug: 'superhero-badge',  text: 'Draw a superhero badge with a bold letter' },
  { slug: 'hot-air-balloon',  text: 'Make a colourful hot air balloon in the sky' },
  { slug: 'moon-stars',       text: 'Paint a night scene with a moon and stars' },
  { slug: 'welcome-sign',     text: 'Make a colourful Welcome sign with flowers around it' },
];

// Animation starters from runner-v2 — these should trigger __TOOBIG__
const ANIMATION_STARTERS = [
  { slug: 'bouncing-ball',   text: 'Make a bouncing ball animation' },
  { slug: 'snowflakes',      text: 'Make snowflakes gently falling from the sky' },
  { slug: 'fireworks',       text: 'Make colorful fireworks exploding in the night sky' },
  { slug: 'rainbow-anim',    text: 'Make a rainbow appear after rain' },
  { slug: 'butterflies',     text: 'Make colorful butterflies flying around flowers' },
  { slug: 'rocket',          text: 'Make a rocket launch into space with stars in the background' },
  { slug: 'ocean-waves',     text: 'Make animated ocean waves crashing on a sunny beach' },
  { slug: 'carousel',        text: 'Make a colorful spinning carousel with horses' },
  { slug: 'night-sky',       text: 'Make a night sky with twinkling stars and shooting stars' },
  { slug: 'fish',            text: 'Make colorful fish swimming in the sea with bubbles' },
  { slug: 'autumn-leaves',   text: 'Make colorful autumn leaves gently falling from trees' },
  { slug: 'clown',           text: 'Make a fun clown juggling colorful bouncing balls' },
];

// 3 edit chips applied to each picked Stage 1 source
const EDIT_CHIPS = [
  { slug: 'change-colour', text: 'Change the main colour' },
  { slug: 'make-bigger',       text: 'Make everything bigger' },
  { slug: 'more-colours',      text: 'Add more bright colours' },
];

// ── utilities ─────────────────────────────────────────────────────────────────

function log(msg) { console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`); }
function ensureDir(d) { fs.mkdirSync(d, { recursive: true }); }
function modelSlug(m) { return m.replace('gemma4:', 'e').replace(':', '-'); }

function extractHtml(content) {
  const m1 = content.match(/```html\s*([\s\S]*?)```/i);
  if (m1) return m1[1].trim();
  const m2 = content.match(/```\s*(<!DOCTYPE[\s\S]*?)```/i);
  if (m2) return m2[1].trim();
  const m3 = content.match(/(<!DOCTYPE\s+html[\s\S]*?<\/html>)/i);
  if (m3) return m3[1].trim();
  return null;
}

// ── checkers ──────────────────────────────────────────────────────────────────

function checkSimpleArt(html) {
  const passed = [];
  const failed = [];

  // html_extracted — always true here (we already extracted)
  passed.push('html_extracted');

  // no_js_error — no <script> tags (simple mode forbids JS)
  if (!/<script[\s>]/i.test(html)) {
    passed.push('no_js_error');
  } else {
    failed.push('no_js_error');
  }

  // has_background — body/html background is not white, #fff, #ffffff, or unset
  const bgMatch = html.match(/body\s*\{[^}]*background(?:-color)?\s*:\s*([^;}\n]+)/i)
               || html.match(/html\s*\{[^}]*background(?:-color)?\s*:\s*([^;}\n]+)/i);
  if (bgMatch) {
    const bg = bgMatch[1].trim().toLowerCase();
    const isWhite = bg === 'white' || bg === '#fff' || bg === '#ffffff' || bg === 'rgb(255,255,255)' || bg === 'rgb(255, 255, 255)';
    if (!isWhite) {
      passed.push('has_background');
    } else {
      failed.push('has_background');
    }
  } else {
    failed.push('has_background');
  }

  // has_content — at least one styled div, svg, or span beyond empty body
  const hasDiv  = /<div[^>]*style=[^>]*>/i.test(html) || (html.match(/<div/gi) || []).length > 1;
  const hasSvg  = /<svg[\s>]/i.test(html);
  const hasSpan = /<span[^>]*style=[^>]*>/i.test(html);
  if (hasDiv || hasSvg || hasSpan) {
    passed.push('has_content');
  } else {
    failed.push('has_content');
  }

  return { score: passed.length, passed, failed };
}

function checkSimpleEdit(html, originalHtml) {
  const base = checkSimpleArt(html);

  // scene_preserved — response length within 40% of original
  const ratio = html.length / Math.max(originalHtml.length, 1);
  if (ratio >= 0.6 && ratio <= 1.4) {
    base.passed.push('scene_preserved');
  } else {
    base.failed.push(`scene_preserved (ratio ${ratio.toFixed(2)})`);
  }

  return { score: base.passed.length, passed: base.passed, failed: base.failed };
}

// ── Ollama ────────────────────────────────────────────────────────────────────

async function ollamaChat(model, systemPrompt, userMsg, keepAlive = '10m') {
  const res = await fetch(`${OLLAMA}/api/chat`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userMsg },
      ],
      stream: false, think: true, keep_alive: keepAlive,
      options: OLLAMA_OPTIONS,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);
  return (await res.json()).message?.content ?? '';
}

async function unloadModel(model) {
  try {
    await fetch(`${OLLAMA}/api/chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages: [], keep_alive: 0 }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch { /* best-effort */ }
}

// ── Stage 1 — Simple Art Generation ──────────────────────────────────────────

async function runStage1() {
  const artDir = path.join(RESULTS, 'art');
  ensureDir(artDir);
  const allMeta = [];

  for (const model of MODELS) {
    log(`══ Stage 1 | ${model} ══`);
    const mSlug = modelSlug(model);

    for (const starter of ART_STARTERS) {
      const htmlFile = path.join(artDir, `${mSlug}--${starter.slug}.html`);
      const rawFile  = path.join(artDir, `${mSlug}--${starter.slug}.raw.txt`);
      const runKey   = `${mSlug}--${starter.slug}`;

      if (fs.existsSync(htmlFile)) {
        log(`SKIP  ${runKey}`);
        const existingHtml = fs.readFileSync(htmlFile, 'utf8');
        const checkerResult = checkSimpleArt(existingHtml);
        allMeta.push({ runKey, model, stage: 1, promptSlug: starter.slug, promptText: starter.text,
          htmlExtracted: true, error: null, skipped: true,
          checkerScore: checkerResult.score, checkerPassed: checkerResult.passed, checkerFailed: checkerResult.failed,
          durationSec: '0', timestamp: new Date().toISOString() });
        continue;
      }

      const startMs = Date.now();
      let rawResponse = '', html = null, error = null, checkerResult = null;
      try {
        rawResponse   = await ollamaChat(model, SIMPLE_SYSTEM_PROMPT, starter.text);
        html          = extractHtml(rawResponse);
        if (html) checkerResult = checkSimpleArt(html);
      } catch (e) {
        error = e.message;
      }
      const durationSec = ((Date.now() - startMs) / 1000).toFixed(1);

      const meta = {
        runKey, model, stage: 1, promptSlug: starter.slug, promptText: starter.text,
        htmlExtracted: !!html, error: error ?? null, skipped: false,
        checkerScore:  checkerResult?.score  ?? null,
        checkerPassed: checkerResult?.passed ?? [],
        checkerFailed: checkerResult?.failed ?? [],
        durationSec, timestamp: new Date().toISOString(),
      };

      if (html) fs.writeFileSync(htmlFile, html, 'utf8');
      fs.writeFileSync(rawFile, rawResponse, 'utf8');
      allMeta.push(meta);

      const s = checkerResult ? `score ${checkerResult.score}/4` : 'NO HTML';
      log(`      ${durationSec}s | ${s} | fails: ${checkerResult?.failed?.length ?? '?'}`);
      if (checkerResult?.failed?.length) log(`      FAIL: ${checkerResult.failed.join(' | ')}`);
    }

    await unloadModel(model);
    log(`Unloaded ${model}`);
  }

  fs.writeFileSync(path.join(artDir, '_meta.json'), JSON.stringify(allMeta, null, 2), 'utf8');
  return allMeta;
}

// ── Stage 2 — Simple Chip Edits ───────────────────────────────────────────────

function pickTop4(meta, model) {
  // Sort by score desc, then by slug for determinism
  const sorted = meta
    .filter(m => m.model === model && m.htmlExtracted && m.checkerScore !== null)
    .sort((a, b) => b.checkerScore - a.checkerScore || a.promptSlug.localeCompare(b.promptSlug));
  return sorted.slice(0, 4);
}

async function runStage2(stage1Meta) {
  const artDir   = path.join(RESULTS, 'art');
  const editsDir = path.join(RESULTS, 'edits');
  ensureDir(editsDir);
  const allMeta = [];

  // Allow manual picks override: create results-simple/_stage2-picks.json
  // Format: { "e2b": ["slug1","slug2","slug3","slug4"], "e4b": [...] }
  const picksFile = path.join(RESULTS, '_stage2-picks.json');
  let manualPicks = null;
  if (fs.existsSync(picksFile)) {
    manualPicks = JSON.parse(fs.readFileSync(picksFile, 'utf8'));
    log(`Stage 2: using manual picks from _stage2-picks.json`);
  }

  for (const model of MODELS) {
    log(`══ Stage 2 | ${model} ══`);
    const mSlug = modelSlug(model);

    let picks;
    if (manualPicks && manualPicks[mSlug]) {
      picks = manualPicks[mSlug].map(slug => {
        const m = stage1Meta.find(m => m.model === model && m.promptSlug === slug);
        return m ?? { model, promptSlug: slug, htmlExtracted: true };
      });
    } else {
      picks = pickTop4(stage1Meta, model);
      log(`  Auto-picked top 4: ${picks.map(p => p.promptSlug).join(', ')}`);
      log(`  (To override: create results-simple/_stage2-picks.json)`);
    }

    for (const pick of picks) {
      const baseFile = path.join(artDir, `${mSlug}--${pick.promptSlug}.html`);
      if (!fs.existsSync(baseFile)) {
        log(`SKIP  base missing: ${mSlug}--${pick.promptSlug} — run Stage 1 first`);
        continue;
      }
      const baseHtml = fs.readFileSync(baseFile, 'utf8');

      for (const chip of EDIT_CHIPS) {
        const htmlFile = path.join(editsDir, `${mSlug}--${pick.promptSlug}--${chip.slug}.html`);
        const rawFile  = path.join(editsDir, `${mSlug}--${pick.promptSlug}--${chip.slug}.raw.txt`);
        const runKey   = `${mSlug}--${pick.promptSlug}--${chip.slug}`;

        if (fs.existsSync(htmlFile)) {
          log(`SKIP  ${runKey}`);
          const existingHtml = fs.readFileSync(htmlFile, 'utf8');
          const cr = checkSimpleEdit(existingHtml, baseHtml);
          allMeta.push({ runKey, model, stage: 2, promptSlug: pick.promptSlug, chip: chip.text, chipSlug: chip.slug,
            htmlExtracted: true, error: null, skipped: true,
            checkerScore: cr.score, checkerPassed: cr.passed, checkerFailed: cr.failed,
            durationSec: '0', timestamp: new Date().toISOString() });
          continue;
        }

        const userMsg = `Here is the current artwork code:\n\n\`\`\`html\n${baseHtml}\n\`\`\`\n\n${chip.text}`;
        const startMs = Date.now();
        let rawResponse = '', html = null, error = null, checkerResult = null;
        try {
          rawResponse   = await ollamaChat(model, SIMPLE_SYSTEM_PROMPT, userMsg);
          html          = extractHtml(rawResponse);
          if (html) checkerResult = checkSimpleEdit(html, baseHtml);
        } catch (e) {
          error = e.message;
        }
        const durationSec = ((Date.now() - startMs) / 1000).toFixed(1);

        const meta = {
          runKey, model, stage: 2, promptSlug: pick.promptSlug, chip: chip.text, chipSlug: chip.slug,
          htmlExtracted: !!html, error: error ?? null, skipped: false,
          checkerScore:  checkerResult?.score  ?? null,
          checkerPassed: checkerResult?.passed ?? [],
          checkerFailed: checkerResult?.failed ?? [],
          durationSec, timestamp: new Date().toISOString(),
        };

        if (html) fs.writeFileSync(htmlFile, html, 'utf8');
        fs.writeFileSync(rawFile, rawResponse, 'utf8');
        allMeta.push(meta);

        const s = checkerResult ? `score ${checkerResult.score}/5` : 'NO HTML';
        log(`      ${durationSec}s | ${s} | fails: ${checkerResult?.failed?.length ?? '?'}`);
        if (checkerResult?.failed?.length) log(`      FAIL: ${checkerResult.failed.join(' | ')}`);
      }
    }

    await unloadModel(model);
    log(`Unloaded ${model}`);
  }

  fs.writeFileSync(path.join(editsDir, '_meta.json'), JSON.stringify(allMeta, null, 2), 'utf8');
  return allMeta;
}

// ── Stage 3 — __TOOBIG__ Sentinel Test ───────────────────────────────────────

async function runStage3() {
  const sentinelDir = path.join(RESULTS, 'sentinel');
  ensureDir(sentinelDir);
  const allMeta = [];

  for (const model of MODELS) {
    log(`══ Stage 3 | ${model} ══`);
    const mSlug = modelSlug(model);

    for (const starter of ANIMATION_STARTERS) {
      const rawFile = path.join(sentinelDir, `${mSlug}--${starter.slug}.raw.txt`);
      const runKey  = `${mSlug}--${starter.slug}`;

      if (fs.existsSync(rawFile)) {
        const existing = fs.readFileSync(rawFile, 'utf8').trim();
        const pass = existing === '__TOOBIG__';
        log(`SKIP  ${runKey} — ${pass ? 'PASS' : 'FAIL'}`);
        allMeta.push({ runKey, model, stage: 3, promptSlug: starter.slug, promptText: starter.text,
          pass, rawResponse: existing, skipped: true, durationSec: '0', timestamp: new Date().toISOString() });
        continue;
      }

      const startMs = Date.now();
      let rawResponse = '', error = null;
      try {
        rawResponse = await ollamaChat(model, SIMPLE_SYSTEM_PROMPT, starter.text, '0');
      } catch (e) {
        error = e.message;
      }
      const durationSec = ((Date.now() - startMs) / 1000).toFixed(1);
      const trimmed = rawResponse.trim();
      const pass = trimmed === '__TOOBIG__';

      const meta = {
        runKey, model, stage: 3, promptSlug: starter.slug, promptText: starter.text,
        pass, error: error ?? null, skipped: false,
        rawResponse: trimmed.slice(0, 200), // store truncated for readability
        durationSec, timestamp: new Date().toISOString(),
      };

      fs.writeFileSync(rawFile, rawResponse, 'utf8');
      allMeta.push(meta);

      log(`      ${durationSec}s | ${pass ? 'PASS ✓' : `FAIL — got: ${JSON.stringify(trimmed.slice(0, 80))}`}`);
    }

    await unloadModel(model);
    log(`Unloaded ${model}`);
  }

  fs.writeFileSync(path.join(sentinelDir, '_meta.json'), JSON.stringify(allMeta, null, 2), 'utf8');
  return allMeta;
}

// ── report ────────────────────────────────────────────────────────────────────

function buildReport(s1, s2, s3) {
  const lines = [];
  lines.push('# Gemma4kids — Simple Mode Benchmark Report');
  lines.push(`\nGenerated: ${new Date().toISOString()}\n`);

  // ── Stage 1 ──
  lines.push('## Stage 1 — Simple Art Generation\n');
  lines.push('| Model | Runs | HTML OK | Score 4 | Score 3 | Score 2 | ≤1 | Avg |');
  lines.push('|-------|------|---------|---------|---------|---------|-----|-----|');

  for (const model of MODELS) {
    const runs = s1.filter(m => m.model === model);
    const ok   = runs.filter(r => r.htmlExtracted).length;
    const s4   = runs.filter(r => r.checkerScore === 4).length;
    const s3c  = runs.filter(r => r.checkerScore === 3).length;
    const s2c  = runs.filter(r => r.checkerScore === 2).length;
    const s1c  = runs.filter(r => (r.checkerScore ?? -1) <= 1).length;
    const avg  = runs.length
      ? (runs.reduce((a, r) => a + (r.checkerScore ?? 0), 0) / runs.length).toFixed(2)
      : 'n/a';
    lines.push(`| ${model} | ${runs.length} | ${ok} | ${s4} | ${s3c} | ${s2c} | ${s1c} | ${avg} |`);
  }

  const allS1 = s1.filter(r => r.checkerScore !== null);
  const overallAvg = allS1.length
    ? (allS1.reduce((a, r) => a + r.checkerScore, 0) / allS1.length).toFixed(2)
    : 'n/a';
  lines.push(`\n**Overall Stage 1 avg: ${overallAvg} / 4.0** (Gate 1 target: ≥ 3.5)\n`);

  lines.push('### Per-run details (Stage 1)\n');
  for (const m of s1) {
    const s = m.htmlExtracted ? `score ${m.checkerScore}/4` : 'NO HTML';
    lines.push(`- **${m.runKey}** | ${m.durationSec}s | ${s}${m.skipped ? ' (skipped)' : ''}`);
    if (m.checkerFailed?.length) lines.push(`  - FAIL: ${m.checkerFailed.join(' | ')}`);
  }

  // ── Stage 2 ──
  lines.push('\n## Stage 2 — Chip Edits\n');
  lines.push('| Model | Runs | HTML OK | Score 5 | Score 4 | Score 3 | ≤2 | Avg |');
  lines.push('|-------|------|---------|---------|---------|---------|-----|-----|');

  for (const model of MODELS) {
    const runs = s2.filter(m => m.model === model);
    const ok   = runs.filter(r => r.htmlExtracted).length;
    const s5   = runs.filter(r => r.checkerScore === 5).length;
    const s4   = runs.filter(r => r.checkerScore === 4).length;
    const s3c  = runs.filter(r => r.checkerScore === 3).length;
    const s2c  = runs.filter(r => (r.checkerScore ?? -1) <= 2).length;
    const avg  = runs.length
      ? (runs.reduce((a, r) => a + (r.checkerScore ?? 0), 0) / runs.length).toFixed(2)
      : 'n/a';
    lines.push(`| ${model} | ${runs.length} | ${ok} | ${s5} | ${s4} | ${s3c} | ${s2c} | ${avg} |`);
  }
  lines.push('\n*Edit target: all scores ≥ 3/5, no full rewrites (scene_preserved)*\n');

  // ── Stage 3 ──
  lines.push('## Stage 3 — __TOOBIG__ Sentinel\n');
  lines.push('| Model | Runs | PASS | FAIL | Rate |');
  lines.push('|-------|------|------|------|------|');

  for (const model of MODELS) {
    const runs = s3.filter(m => m.model === model);
    const pass = runs.filter(r => r.pass).length;
    const fail = runs.length - pass;
    const rate = runs.length ? `${((pass / runs.length) * 100).toFixed(0)}%` : 'n/a';
    lines.push(`| ${model} | ${runs.length} | ${pass} | ${fail} | ${rate} |`);
  }
  lines.push('\n*Gate 2 target: ≥ 90% PASS on both models independently*\n');

  lines.push('### Per-run details (Stage 3)\n');
  for (const m of s3) {
    lines.push(`- **${m.runKey}** | ${m.durationSec}s | ${m.pass ? 'PASS ✓' : 'FAIL ✗'}${m.skipped ? ' (skipped)' : ''}`);
    if (!m.pass && m.rawResponse) lines.push(`  - got: \`${m.rawResponse.slice(0, 100)}\``);
  }

  // ── Decision gates ──
  lines.push('\n## Decision Gates\n');

  const gate1Avg  = allS1.length
    ? allS1.reduce((a, r) => a + r.checkerScore, 0) / allS1.length
    : 0;
  const gate1Pass = gate1Avg >= 3.5;

  const gate2Pass = MODELS.every(model => {
    const runs = s3.filter(m => m.model === model);
    return runs.length > 0 && (runs.filter(r => r.pass).length / runs.length) >= 0.9;
  });

  lines.push(`| Gate | Condition | Result |`);
  lines.push(`|------|-----------|--------|`);
  lines.push(`| Gate 1 | Stage 1 avg ≥ 3.5 | ${gate1Pass ? `✅ PASS (${gate1Avg.toFixed(2)})` : `❌ FAIL (${gate1Avg.toFixed(2)})`} |`);
  lines.push(`| Gate 2 | __TOOBIG__ rate ≥ 90% on both models | ${gate2Pass ? '✅ PASS' : '❌ FAIL'} |`);
  lines.push('');
  if (gate1Pass && gate2Pass) {
    lines.push('**Both gates PASSED — safe to implement in app. See simple-mode-plan.md § App Implementation.**');
  } else {
    lines.push('**One or more gates FAILED — see plan for remediation steps before touching app code.**');
  }

  // ── Sentinel failure remediation hint ──
  for (const model of MODELS) {
    const runs = s3.filter(m => m.model === model && !m.skipped);
    if (!runs.length) continue;
    const rate = runs.filter(r => r.pass).length / runs.length;
    if (rate < 0.9) {
      lines.push(`\n### ${model} sentinel remediation`);
      if (rate >= 0.8) {
        lines.push('Rate 80–89%: tweak system prompt wording (stronger instruction), re-run Stage 3 only.');
      } else if (rate >= 0.6) {
        lines.push('Rate 60–79%: add a second sentinel instruction at bottom of prompt, re-run Stage 3 only.');
      } else {
        lines.push('Rate < 60%: reconsider sentinel approach — may need keyword-only strategy in app.');
      }
    }
  }

  return lines.join('\n');
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  const stageArg = (() => {
    const idx = process.argv.indexOf('--stage');
    return idx !== -1 ? parseInt(process.argv[idx + 1], 10) : null;
  })();

  log('Gemma4kids — Simple Mode Benchmark');
  log(`Results: ${RESULTS}`);
  ensureDir(RESULTS);

  try {
    const r    = await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(5000) });
    const data = await r.json();
    const names = (data.models || []).map(m => m.name);
    log(`Ollama healthy. Models: ${names.join(', ')}`);
    for (const m of MODELS) {
      if (!names.includes(m)) log(`WARNING: ${m} not found in Ollama — runs will fail`);
    }
  } catch {
    console.error('ERROR: Ollama not reachable. Start Ollama first.');
    process.exit(1);
  }

  let s1 = [], s2 = [], s3 = [];

  if (!stageArg || stageArg === 1) {
    log('Starting Stage 1 — Simple Art Generation…');
    s1 = await runStage1();
    fs.writeFileSync(path.join(RESULTS, 'stage1.json'), JSON.stringify(s1, null, 2), 'utf8');
    const ok  = s1.filter(r => r.htmlExtracted && r.checkerScore !== null);
    const avg = ok.length ? (ok.reduce((a, r) => a + r.checkerScore, 0) / ok.length).toFixed(2) : 'n/a';
    log(`Stage 1 done: ${s1.length} runs | avg score ${avg}/4 | Gate 1 target ≥ 3.5`);
  } else {
    const f = path.join(RESULTS, 'stage1.json');
    if (fs.existsSync(f)) s1 = JSON.parse(fs.readFileSync(f, 'utf8'));
  }

  if (!stageArg || stageArg === 2) {
    log('Starting Stage 2 — Chip Edits…');
    log('NOTE: Auto-picking top 4 by score per model. For manual picks create results-simple/_stage2-picks.json');
    s2 = await runStage2(s1);
    fs.writeFileSync(path.join(RESULTS, 'stage2.json'), JSON.stringify(s2, null, 2), 'utf8');
    log(`Stage 2 done: ${s2.length} runs`);
  } else {
    const f = path.join(RESULTS, 'stage2.json');
    if (fs.existsSync(f)) s2 = JSON.parse(fs.readFileSync(f, 'utf8'));
  }

  if (!stageArg || stageArg === 3) {
    log('Starting Stage 3 — __TOOBIG__ Sentinel Test…');
    s3 = await runStage3();
    fs.writeFileSync(path.join(RESULTS, 'stage3.json'), JSON.stringify(s3, null, 2), 'utf8');
    const pass = s3.filter(r => r.pass).length;
    log(`Stage 3 done: ${s3.length} runs | ${pass} PASS | ${s3.length - pass} FAIL`);
  } else {
    const f = path.join(RESULTS, 'stage3.json');
    if (fs.existsSync(f)) s3 = JSON.parse(fs.readFileSync(f, 'utf8'));
  }

  const md = buildReport(s1, s2, s3);
  fs.writeFileSync(path.join(RESULTS, 'report.md'), md, 'utf8');
  log(`Report: ${path.join(RESULTS, 'report.md')}`);
  log('Complete.');
}

main().catch(e => { console.error(e); process.exit(1); });
