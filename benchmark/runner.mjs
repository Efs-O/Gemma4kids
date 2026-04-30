// Gemma4kids hardcoded-prompt benchmark runner.
// Isolated from app runtime — no IPC, no Electron, no tool infrastructure.
// Run: node benchmark/runner.mjs
// Results land in benchmark/results/

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { FAMILIES }  from './families.mjs';
import { CHECKERS }  from './checkers.mjs';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const RESULTS    = path.join(__dirname, 'results');
const OLLAMA     = 'http://localhost:11434';
const MODELS     = ['gemma4:e2b', 'gemma4:e4b'];
const TIMEOUT_MS = 360_000; // 6 min per call

const OLLAMA_OPTIONS = {
  temperature: 1.0,
  top_p:       0.95,
  top_k:       64,
  num_ctx:     65536,
  num_predict: 32768,
};

// ── prompt corpus ─────────────────────────────────────────────────────────────

const STARTERS = [
  { slug: 'bouncing-ball',  text: 'Make a bouncing ball animation' },
  { slug: 'snowflakes',     text: 'Make snowflakes gently falling from the sky' },
  { slug: 'fireworks',      text: 'Make colorful fireworks exploding in the night sky' },
  { slug: 'rainbow',        text: 'Make a rainbow appear after rain' },
  { slug: 'butterflies',    text: 'Make colorful butterflies flying around flowers' },
  { slug: 'rocket',         text: 'Make a rocket launch into space with stars in the background' },
  { slug: 'ocean-waves',    text: 'Make animated ocean waves crashing on a sunny beach' },
  { slug: 'carousel',       text: 'Make a colorful spinning carousel with horses' },
  { slug: 'night-sky',      text: 'Make a night sky with twinkling stars and shooting stars' },
  { slug: 'fish',           text: 'Make colorful fish swimming in the sea with bubbles' },
  { slug: 'autumn-leaves',  text: 'Make colorful autumn leaves gently falling from trees' },
  { slug: 'clown',          text: 'Make a fun clown juggling colorful bouncing balls' },
];

const CHIP_MATRIX = {
  'bouncing-ball': ['Make it faster', 'Make everything bigger', 'Change the main color to red'],
  'snowflakes':    ['Make it slower', 'Add more bright rainbow colors'],
  'fireworks':     ['Add more bright rainbow colors', 'Add falling confetti in many colors', 'Add twinkling stars in the background'],
  'rainbow':       ['Add more bright rainbow colors', 'Make it slower'],
  'butterflies':   ['Make everything bigger', 'Add twinkling stars in the background'],
  'rocket':        ['Add twinkling stars in the background', 'Make it faster'],
  'ocean-waves':   ['Add splashing water or bubbles', 'Make it slower'],
  'carousel':      ['Add a spinning or rotating effect', 'Make everything bigger'],
  'night-sky':     ['Add twinkling stars in the background', 'Add more bright rainbow colors'],
  'fish':          ['Add splashing water or bubbles', 'Change the main color to red'],
  'autumn-leaves': ['Make it slower', 'Change the main color to red'],
  'clown':         ['Make it faster', 'Make everything bigger'],
};

// ── utilities ─────────────────────────────────────────────────────────────────

function log(msg)       { console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`); }
function ensureDir(d)   { fs.mkdirSync(d, { recursive: true }); }
function slugify(s)     { return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
function modelSlug(m)   { return m.replace(':', '-'); }

function extractHtml(content) {
  const m1 = content.match(/```html\s*([\s\S]*?)```/i);
  if (m1) return m1[1].trim();
  const m2 = content.match(/```\s*(<!DOCTYPE[\s\S]*?)```/i);
  if (m2) return m2[1].trim();
  const m3 = content.match(/(<!DOCTYPE\s+html[\s\S]*?<\/html>)/i);
  if (m3) return m3[1].trim();
  return null;
}

// ── Ollama client ─────────────────────────────────────────────────────────────

async function ollamaChat(model, systemPrompt, userMsg, keepAlive = '10m') {
  const body = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userMsg },
    ],
    stream:     false,
    think:      true,
    keep_alive: keepAlive,
    options:    OLLAMA_OPTIONS,
  };
  const res = await fetch(`${OLLAMA}/api/chat`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
    signal:  AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.message?.content ?? '';
}

async function unloadModel(model) {
  try {
    await fetch(`${OLLAMA}/api/chat`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ model, messages: [], keep_alive: 0 }),
      signal:  AbortSignal.timeout(10_000),
    });
  } catch { /* best-effort */ }
}

// ── single run helper ─────────────────────────────────────────────────────────

async function executeRun({ runKey, model, systemPrompt, userMsg, checkerKey, slug, preHtml }) {
  const startMs = Date.now();
  let rawResponse = '', html = null, error = null, checkerResult = null;

  try {
    rawResponse = await ollamaChat(model, systemPrompt, userMsg);
    html        = extractHtml(rawResponse);
    if (html) {
      checkerResult = CHECKERS[checkerKey](html, slug, preHtml ?? null);
    }
  } catch (e) {
    error = e.message;
  }

  const durationSec = ((Date.now() - startMs) / 1000).toFixed(1);
  return { rawResponse, html, error, checkerResult, durationSec };
}

// ── stage 1 ───────────────────────────────────────────────────────────────────

async function runStage1() {
  const stage1Dir = path.join(RESULTS, 'stage1');
  ensureDir(stage1Dir);
  const allMeta = [];

  for (const model of MODELS) {
    log(`══ Stage 1 | model: ${model} ══`);

    for (const family of FAMILIES) {
      for (const starter of STARTERS) {
        const runKey = `${modelSlug(model)}-f${family.id}-${starter.slug}`;
        const runDir = path.join(stage1Dir, runKey);
        ensureDir(runDir);

        const metaFile = path.join(runDir, 'meta.json');
        const htmlFile = path.join(runDir, 'output.html');

        if (fs.existsSync(metaFile)) {
          log(`SKIP  ${runKey}`);
          allMeta.push(JSON.parse(fs.readFileSync(metaFile, 'utf8')));
          continue;
        }

        log(`RUN   ${runKey}`);
        const { rawResponse, html, error, checkerResult, durationSec } =
          await executeRun({
            runKey, model,
            systemPrompt: family.systemPrompt,
            userMsg:      starter.text,
            checkerKey:   family.checkerKey,
            slug:         starter.slug,
            preHtml:      null,
          });

        const meta = {
          runKey, stage: 1,
          model, familyId: family.id, familyLabel: family.label,
          promptSlug: starter.slug, promptText: starter.text,
          htmlExtracted:    !!html,
          error:            error ?? null,
          checkerScore:     checkerResult?.score    ?? null,
          checkerPassed:    checkerResult?.passed   ?? [],
          checkerFailed:    checkerResult?.failed   ?? [],
          checkerWarnings:  checkerResult?.warnings ?? [],
          durationSec,
          timestamp: new Date().toISOString(),
        };

        if (html)        fs.writeFileSync(htmlFile,                        html,         'utf8');
                         fs.writeFileSync(path.join(runDir, 'raw.txt'),    rawResponse,  'utf8');
                         fs.writeFileSync(metaFile, JSON.stringify(meta, null, 2),        'utf8');
        allMeta.push(meta);

        const scoreStr = checkerResult ? `score ${checkerResult.score}` : 'no HTML';
        log(`      ${durationSec}s | ${scoreStr} | fails: ${checkerResult?.failed?.length ?? '?'} | warns: ${checkerResult?.warnings?.length ?? '?'}`);
        if (checkerResult?.failed?.length)    log(`      FAIL: ${checkerResult.failed.join(' | ')}`);
        if (checkerResult?.warnings?.length)  log(`      WARN: ${checkerResult.warnings.join(' | ')}`);
      }
    }

    await unloadModel(model);
    log(`Unloaded ${model}`);
  }

  return allMeta;
}

// ── stage 2 ───────────────────────────────────────────────────────────────────

async function runStage2(stage1Meta) {
  const stage1Dir = path.join(RESULTS, 'stage1');
  const stage2Dir = path.join(RESULTS, 'stage2');
  ensureDir(stage2Dir);
  const allMeta = [];

  // Edit family = Family 5 (edit-first preservation)
  const editFamily = FAMILIES.find(f => f.id === 5);

  for (const model of MODELS) {
    log(`══ Stage 2 | model: ${model} ══`);

    for (const [slug, chips] of Object.entries(CHIP_MATRIX)) {
      // Base = Family 2 (production) stage 1 output for this model + slug
      const baseKey     = `${modelSlug(model)}-f2-${slug}`;
      const baseHtmlPath = path.join(stage1Dir, baseKey, 'output.html');

      if (!fs.existsSync(baseHtmlPath)) {
        log(`SKIP  base missing: ${baseKey}`);
        continue;
      }
      const baseHtml = fs.readFileSync(baseHtmlPath, 'utf8');

      for (const chip of chips) {
        const chipSlug = slugify(chip);
        const runKey   = `${modelSlug(model)}-${slug}--${chipSlug}`;
        const runDir   = path.join(stage2Dir, runKey);
        ensureDir(runDir);

        const metaFile = path.join(runDir, 'meta.json');
        const htmlFile = path.join(runDir, 'output.html');

        if (fs.existsSync(metaFile)) {
          log(`SKIP  ${runKey}`);
          allMeta.push(JSON.parse(fs.readFileSync(metaFile, 'utf8')));
          continue;
        }

        log(`RUN   ${runKey}`);
        const userMsg = `Here is the current animation code:\n\n\`\`\`html\n${baseHtml}\n\`\`\`\n\n${chip}`;

        const { rawResponse, html, error, checkerResult, durationSec } =
          await executeRun({
            runKey, model,
            systemPrompt: editFamily.editSystemPrompt,
            userMsg,
            checkerKey:   'family5',
            slug,
            preHtml:      baseHtml,
          });

        const meta = {
          runKey, stage: 2,
          model, familyId: editFamily.id, familyLabel: editFamily.label,
          baseKey, promptSlug: slug, chip, chipSlug,
          htmlExtracted:    !!html,
          error:            error ?? null,
          checkerScore:     checkerResult?.score    ?? null,
          checkerPassed:    checkerResult?.passed   ?? [],
          checkerFailed:    checkerResult?.failed   ?? [],
          checkerWarnings:  checkerResult?.warnings ?? [],
          durationSec,
          timestamp: new Date().toISOString(),
        };

        if (html)        fs.writeFileSync(htmlFile,                        html,         'utf8');
                         fs.writeFileSync(path.join(runDir, 'raw.txt'),    rawResponse,  'utf8');
                         fs.writeFileSync(metaFile, JSON.stringify(meta, null, 2),        'utf8');
        allMeta.push(meta);

        const scoreStr = checkerResult ? `score ${checkerResult.score}` : 'no HTML';
        log(`      ${durationSec}s | ${scoreStr}`);
        if (checkerResult?.failed?.length)    log(`      FAIL: ${checkerResult.failed.join(' | ')}`);
        if (checkerResult?.warnings?.length)  log(`      WARN: ${checkerResult.warnings.join(' | ')}`);
      }
    }

    await unloadModel(model);
    log(`Unloaded ${model}`);
  }

  return allMeta;
}

// ── report generation ─────────────────────────────────────────────────────────

function buildMarkdown(stage1Meta, stage2Meta) {
  const lines = [];
  const ts    = new Date().toISOString();

  lines.push('# Gemma4kids Hardcoded Prompt Benchmark Report');
  lines.push('');
  lines.push(`Generated: ${ts}`);
  lines.push('');

  // ── Stage 1 summary table
  lines.push('## Stage 1 — Create Benchmark');
  lines.push('');
  lines.push('### Summary by Family × Model');
  lines.push('');
  lines.push('| Family | Model | Runs | HTML OK | Score 2 | Score 1 | Score 0 | Avg Score |');
  lines.push('|--------|-------|------|---------|---------|---------|---------|-----------|');

  for (const fam of FAMILIES) {
    for (const model of MODELS) {
      const runs  = stage1Meta.filter(m => m.familyId === fam.id && m.model === model);
      const ok    = runs.filter(r => r.htmlExtracted).length;
      const s2    = runs.filter(r => r.checkerScore === 2).length;
      const s1    = runs.filter(r => r.checkerScore === 1).length;
      const s0    = runs.filter(r => r.checkerScore === 0 || r.checkerScore === null).length;
      const avg   = runs.length
        ? (runs.reduce((a, r) => a + (r.checkerScore ?? 0), 0) / runs.length).toFixed(2)
        : 'n/a';
      lines.push(`| F${fam.id}: ${fam.label} | ${model} | ${runs.length} | ${ok} | ${s2} | ${s1} | ${s0} | ${avg} |`);
    }
  }

  // ── Stage 1 per-run details
  lines.push('');
  lines.push('### Per-Run Details');
  lines.push('');
  for (const m of stage1Meta) {
    const status = m.error ? `ERROR: ${m.error}` : m.htmlExtracted ? `score ${m.checkerScore}` : 'NO HTML';
    lines.push(`- **${m.runKey}** | ${m.durationSec}s | ${status}`);
    if (m.checkerFailed?.length)   lines.push(`  - FAILED: ${m.checkerFailed.join('; ')}`);
    if (m.checkerWarnings?.length) lines.push(`  - WARN: ${m.checkerWarnings.join('; ')}`);
  }

  // ── Stage 2 summary
  lines.push('');
  lines.push('## Stage 2 — Chip Edit Benchmark');
  lines.push('');
  lines.push('### Summary by Model');
  lines.push('');
  lines.push('| Model | Runs | HTML OK | Score 2 | Score 1 | Score 0 | Avg Score |');
  lines.push('|-------|------|---------|---------|---------|---------|-----------|');

  for (const model of MODELS) {
    const runs = stage2Meta.filter(m => m.model === model);
    const ok   = runs.filter(r => r.htmlExtracted).length;
    const s2   = runs.filter(r => r.checkerScore === 2).length;
    const s1   = runs.filter(r => r.checkerScore === 1).length;
    const s0   = runs.filter(r => r.checkerScore === 0 || r.checkerScore === null).length;
    const avg  = runs.length
      ? (runs.reduce((a, r) => a + (r.checkerScore ?? 0), 0) / runs.length).toFixed(2)
      : 'n/a';
    lines.push(`| ${model} | ${runs.length} | ${ok} | ${s2} | ${s1} | ${s0} | ${avg} |`);
  }

  lines.push('');
  lines.push('### Per-Run Details');
  lines.push('');
  for (const m of stage2Meta) {
    const status = m.error ? `ERROR: ${m.error}` : m.htmlExtracted ? `score ${m.checkerScore}` : 'NO HTML';
    lines.push(`- **${m.runKey}** | chip: "${m.chip}" | ${m.durationSec}s | ${status}`);
    if (m.checkerFailed?.length)   lines.push(`  - FAILED: ${m.checkerFailed.join('; ')}`);
    if (m.checkerWarnings?.length) lines.push(`  - WARN: ${m.checkerWarnings.join('; ')}`);
  }

  return lines.join('\n');
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  log('Gemma4kids Hardcoded Prompt Benchmark');
  log(`Stage 1: ${STARTERS.length} prompts × ${FAMILIES.length} families × ${MODELS.length} models = ${STARTERS.length * FAMILIES.length * MODELS.length} runs`);
  log(`Stage 2: chip edit matrix (~54 runs)`);
  log(`Results: ${RESULTS}`);
  ensureDir(RESULTS);

  // Health check
  try {
    const r = await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error('unhealthy');
    const data  = await r.json();
    const names = (data.models || []).map(m => m.name);
    log(`Ollama healthy. Available models: ${names.join(', ') || '(none)'}`);
    for (const m of MODELS) {
      if (!names.some(n => n.startsWith(m.split(':')[0])))
        log(`WARNING: model ${m} not found in Ollama — runs will fail`);
    }
  } catch (e) {
    console.error(`ERROR: Ollama not reachable at ${OLLAMA}. Start Ollama and ensure models are pulled.`);
    process.exit(1);
  }

  // Stage 1
  log('Starting Stage 1…');
  const s1 = await runStage1();
  fs.writeFileSync(path.join(RESULTS, 'stage1-report.json'), JSON.stringify(s1, null, 2), 'utf8');
  log(`Stage 1 complete: ${s1.length} runs saved.`);

  // Stage 2
  log('Starting Stage 2…');
  const s2 = await runStage2(s1);
  fs.writeFileSync(path.join(RESULTS, 'stage2-report.json'), JSON.stringify(s2, null, 2), 'utf8');
  log(`Stage 2 complete: ${s2.length} runs saved.`);

  // Markdown report
  const md = buildMarkdown(s1, s2);
  const mdPath = path.join(RESULTS, 'benchmark-report.md');
  fs.writeFileSync(mdPath, md, 'utf8');
  log(`Report written: ${mdPath}`);
  log('Benchmark complete.');
}

main().catch(e => { console.error(e); process.exit(1); });
