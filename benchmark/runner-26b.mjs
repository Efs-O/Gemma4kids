// Gemma4kids benchmark runner — 26b only.
// Runs the full Stage 1 + Stage 2 suite against gemma4:26b exclusively.
// Results saved in benchmark/results-26b/ — existing results are untouched.
// Run: node benchmark/runner-26b.mjs

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { FAMILIES }  from './families.mjs';
import { CHECKERS }  from './checkers.mjs';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const RESULTS    = path.join(__dirname, 'results-26b');
const OLLAMA     = 'http://localhost:11434';
const MODELS     = ['gemma4:26b'];
const TIMEOUT_MS = 360_000;

const OLLAMA_OPTIONS = {
  temperature: 1.0,
  top_p:       0.95,
  top_k:       64,
  num_ctx:     65536,
  num_predict: 32768,
};

// ── corpus ────────────────────────────────────────────────────────────────────

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

// ── folder names ──────────────────────────────────────────────────────────────

const FAMILY_FOLDERS = {
  1: 'family-1-basic',
  2: 'family-2-production',
  3: 'family-3-hardcoded',
  4: 'family-4-wide',
  5: 'family-5-edit-first',
};

// ── utilities ─────────────────────────────────────────────────────────────────

function log(msg)      { console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`); }
function ensureDir(d)  { fs.mkdirSync(d, { recursive: true }); }
function slugify(s)    { return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
function modelSlug(m)  { return m.replace('gemma4:', 'e').replace(':', '-'); }

function extractHtml(content) {
  const m1 = content.match(/```html\s*([\s\S]*?)```/i);
  if (m1) return m1[1].trim();
  const m2 = content.match(/```\s*(<!DOCTYPE[\s\S]*?)```/i);
  if (m2) return m2[1].trim();
  const m3 = content.match(/(<!DOCTYPE\s+html[\s\S]*?<\/html>)/i);
  if (m3) return m3[1].trim();
  return null;
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

// ── single run ────────────────────────────────────────────────────────────────

async function executeRun({ model, systemPrompt, userMsg, checkerKey, slug, preHtml }) {
  const startMs = Date.now();
  let rawResponse = '', html = null, error = null, checkerResult = null;
  try {
    rawResponse  = await ollamaChat(model, systemPrompt, userMsg);
    html         = extractHtml(rawResponse);
    if (html) checkerResult = CHECKERS[checkerKey](html, slug, preHtml ?? null);
  } catch (e) {
    error = e.message;
  }
  return { rawResponse, html, error, checkerResult, durationSec: ((Date.now() - startMs) / 1000).toFixed(1) };
}

// ── stage 1 ───────────────────────────────────────────────────────────────────

async function runStage1() {
  const allMeta = [];

  for (const folder of Object.values(FAMILY_FOLDERS)) ensureDir(path.join(RESULTS, folder));

  for (const model of MODELS) {
    log(`══ Stage 1 | ${model} ══`);
    const mSlug = modelSlug(model);

    for (const family of FAMILIES) {
      const folder  = path.join(RESULTS, FAMILY_FOLDERS[family.id]);
      const metaKey = `s1-${mSlug}-f${family.id}`;

      for (const starter of STARTERS) {
        const htmlFile = path.join(folder, `${mSlug}--${starter.slug}.html`);
        const rawFile  = path.join(folder, `${mSlug}--${starter.slug}.raw.txt`);
        const runKey   = `${mSlug}-f${family.id}-${starter.slug}`;

        if (fs.existsSync(htmlFile)) {
          log(`SKIP  ${runKey}`);
          allMeta.push({ runKey, model, familyId: family.id, familyLabel: family.label,
            promptSlug: starter.slug, promptText: starter.text,
            htmlExtracted: true, error: null,
            checkerScore: null, checkerPassed: [], checkerFailed: [], checkerWarnings: [],
            durationSec: '0', skipped: true, timestamp: new Date().toISOString() });
          continue;
        }

        log(`RUN   ${runKey}`);
        const { rawResponse, html, error, checkerResult, durationSec } = await executeRun({
          model, systemPrompt: family.systemPrompt, userMsg: starter.text,
          checkerKey: family.checkerKey, slug: starter.slug, preHtml: null,
        });

        const meta = {
          runKey, model, familyId: family.id, familyLabel: family.label,
          promptSlug: starter.slug, promptText: starter.text,
          htmlExtracted: !!html, error: error ?? null,
          checkerScore:    checkerResult?.score    ?? null,
          checkerPassed:   checkerResult?.passed   ?? [],
          checkerFailed:   checkerResult?.failed   ?? [],
          checkerWarnings: checkerResult?.warnings ?? [],
          durationSec, timestamp: new Date().toISOString(),
        };

        if (html) fs.writeFileSync(htmlFile, html, 'utf8');
        fs.writeFileSync(rawFile, rawResponse, 'utf8');
        allMeta.push(meta);

        const s = checkerResult ? `score ${checkerResult.score}` : 'NO HTML';
        log(`      ${durationSec}s | ${s} | fails: ${checkerResult?.failed?.length ?? '?'} | warns: ${checkerResult?.warnings?.length ?? '?'}`);
        if (checkerResult?.failed?.length)   log(`      FAIL: ${checkerResult.failed.join(' | ')}`);
        if (checkerResult?.warnings?.length) log(`      WARN: ${checkerResult.warnings.join(' | ')}`);
      }
    }
    await unloadModel(model);
    log(`Unloaded ${model}`);
  }

  for (const family of FAMILIES) {
    const famMeta = allMeta.filter(m => m.familyId === family.id);
    fs.writeFileSync(path.join(RESULTS, FAMILY_FOLDERS[family.id], '_meta.json'), JSON.stringify(famMeta, null, 2), 'utf8');
  }

  return allMeta;
}

// ── stage 2 ───────────────────────────────────────────────────────────────────

async function runStage2(stage1Meta) {
  const editDir  = path.join(RESULTS, 'edit');
  ensureDir(editDir);

  const f2Dir    = path.join(RESULTS, FAMILY_FOLDERS[2]);
  const editFamily = FAMILIES.find(f => f.id === 5);
  const allMeta  = [];

  for (const model of MODELS) {
    log(`══ Stage 2 | ${model} ══`);
    const mSlug = modelSlug(model);

    for (const [slug, chips] of Object.entries(CHIP_MATRIX)) {
      const baseFile = path.join(f2Dir, `${mSlug}--${slug}.html`);
      if (!fs.existsSync(baseFile)) {
        log(`SKIP  base missing: ${mSlug}--${slug} (stage 1 must run first)`);
        continue;
      }
      const baseHtml = fs.readFileSync(baseFile, 'utf8');

      for (const chip of chips) {
        const chipSlug = slugify(chip);
        const htmlFile = path.join(editDir, `${mSlug}--${slug}--${chipSlug}.html`);
        const rawFile  = path.join(editDir, `${mSlug}--${slug}--${chipSlug}.raw.txt`);
        const runKey   = `${mSlug}--${slug}--${chipSlug}`;

        if (fs.existsSync(htmlFile)) {
          log(`SKIP  ${runKey}`);
          allMeta.push({ runKey, model, stage: 2, promptSlug: slug, chip,
            htmlExtracted: true, skipped: true });
          continue;
        }

        log(`RUN   ${runKey}`);
        const userMsg = `Here is the current animation code:\n\n\`\`\`html\n${baseHtml}\n\`\`\`\n\n${chip}`;
        const { rawResponse, html, error, checkerResult, durationSec } = await executeRun({
          model, systemPrompt: editFamily.editSystemPrompt, userMsg,
          checkerKey: 'family5', slug, preHtml: baseHtml,
        });

        const meta = {
          runKey, model, stage: 2, familyId: 5, familyLabel: editFamily.label,
          promptSlug: slug, chip, chipSlug,
          htmlExtracted: !!html, error: error ?? null,
          checkerScore:    checkerResult?.score    ?? null,
          checkerPassed:   checkerResult?.passed   ?? [],
          checkerFailed:   checkerResult?.failed   ?? [],
          checkerWarnings: checkerResult?.warnings ?? [],
          durationSec, timestamp: new Date().toISOString(),
        };

        if (html) fs.writeFileSync(htmlFile, html, 'utf8');
        fs.writeFileSync(rawFile, rawResponse, 'utf8');
        allMeta.push(meta);

        const s = checkerResult ? `score ${checkerResult.score}` : 'NO HTML';
        log(`      ${durationSec}s | ${s}`);
        if (checkerResult?.failed?.length)   log(`      FAIL: ${checkerResult.failed.join(' | ')}`);
        if (checkerResult?.warnings?.length) log(`      WARN: ${checkerResult.warnings.join(' | ')}`);
      }
    }
    await unloadModel(model);
    log(`Unloaded ${model}`);
  }

  fs.writeFileSync(path.join(editDir, '_meta.json'), JSON.stringify(allMeta, null, 2), 'utf8');
  return allMeta;
}

// ── report ────────────────────────────────────────────────────────────────────

function buildReport(s1, s2) {
  const lines = [];
  lines.push('# Gemma4kids Benchmark — gemma4:26b only');
  lines.push(`\nGenerated: ${new Date().toISOString()}\n`);

  lines.push('## Stage 1 — Create\n');
  lines.push('| Family | Model | Runs | HTML OK | Score 2 | Score 1 | Score 0 | Avg | Warnings |');
  lines.push('|--------|-------|------|---------|---------|---------|---------|-----|----------|');

  for (const fam of FAMILIES) {
    for (const model of MODELS) {
      const runs = s1.filter(m => m.familyId === fam.id && m.model === model && !m.skipped);
      if (!runs.length) continue;
      const ok   = runs.filter(r => r.htmlExtracted).length;
      const s2c  = runs.filter(r => r.checkerScore === 2).length;
      const s1c  = runs.filter(r => r.checkerScore === 1).length;
      const s0c  = runs.filter(r => r.checkerScore === 0 || r.checkerScore === null).length;
      const avg  = (runs.reduce((a, r) => a + (r.checkerScore ?? 0), 0) / runs.length).toFixed(2);
      const tot  = runs.reduce((a, r) => a + (r.checkerWarnings?.length ?? 0), 0);
      lines.push(`| F${fam.id}: ${fam.label} | ${model} | ${runs.length} | ${ok} | ${s2c} | ${s1c} | ${s0c} | ${avg} | ${tot} |`);
    }
  }

  lines.push('\n### Warning breakdown by family\n');
  for (const fam of FAMILIES) {
    const runs  = s1.filter(m => m.familyId === fam.id && !m.skipped);
    const total = runs.reduce((a, r) => a + (r.checkerWarnings?.length ?? 0), 0);
    const types = {};
    for (const r of runs) for (const w of (r.checkerWarnings || [])) {
      const key = w.split(' ')[0] + ' ' + (w.split(' ')[1] ?? '');
      types[key] = (types[key] || 0) + 1;
    }
    lines.push(`**F${fam.id} ${fam.label}** — ${total} warnings across ${runs.length} runs (${(total/Math.max(runs.length,1)).toFixed(2)}/run)`);
    for (const [k, v] of Object.entries(types)) lines.push(`  - ${v}× ${k}…`);
    lines.push('');
  }

  lines.push('## Stage 2 — Edit\n');
  lines.push('| Model | Runs | HTML OK | Score 2 | Score 1 | Score 0 | Replacements |');
  lines.push('|-------|------|---------|---------|---------|---------|-------------|');
  for (const model of MODELS) {
    const runs = s2.filter(m => m.model === model && !m.skipped);
    if (!runs.length) continue;
    const ok   = runs.filter(r => r.htmlExtracted).length;
    const s2c  = runs.filter(r => r.checkerScore === 2).length;
    const s1c  = runs.filter(r => r.checkerScore === 1).length;
    const s0c  = runs.filter(r => r.checkerScore === 0 || r.checkerScore === null).length;
    const rep  = runs.filter(r => (r.checkerWarnings || []).some(w => w.includes('replacement'))).length;
    lines.push(`| ${model} | ${runs.length} | ${ok} | ${s2c} | ${s1c} | ${s0c} | ${rep} |`);
  }

  lines.push('\n### Per-run details (Stage 2)\n');
  for (const m of s2.filter(r => !r.skipped)) {
    const s = m.htmlExtracted ? `score ${m.checkerScore}` : 'NO HTML';
    lines.push(`- **${m.runKey}** | ${m.durationSec}s | ${s}`);
    if (m.checkerWarnings?.length) lines.push(`  - ${m.checkerWarnings.join('; ')}`);
  }

  return lines.join('\n');
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  log('Gemma4kids Benchmark — gemma4:26b only');
  log(`Results: ${RESULTS}`);
  ensureDir(RESULTS);

  try {
    const r    = await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(5000) });
    const data = await r.json();
    const names = (data.models || []).map(m => m.name);
    log(`Ollama healthy. Models: ${names.join(', ')}`);
  } catch {
    console.error('ERROR: Ollama not reachable. Start Ollama first.'); process.exit(1);
  }

  log('Starting Stage 1…');
  const s1 = await runStage1();
  fs.writeFileSync(path.join(RESULTS, 'stage1.json'), JSON.stringify(s1, null, 2), 'utf8');
  log(`Stage 1 done: ${s1.length} runs.`);

  log('Starting Stage 2…');
  const s2 = await runStage2(s1);
  fs.writeFileSync(path.join(RESULTS, 'stage2.json'), JSON.stringify(s2, null, 2), 'utf8');
  log(`Stage 2 done: ${s2.length} runs.`);

  const md = buildReport(s1, s2);
  fs.writeFileSync(path.join(RESULTS, 'benchmark-report.md'), md, 'utf8');
  log(`Report: ${path.join(RESULTS, 'benchmark-report.md')}`);
  log('Complete.');
}

main().catch(e => { console.error(e); process.exit(1); });
