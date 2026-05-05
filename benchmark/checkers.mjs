// Checker functions for each prompt family.
// Each checker returns: { score: 0|1|2, passed: string[], failed: string[], warnings: string[] }
// score 2 = zero fails, score 1 = 1-2 fails, score 0 = 3+ fails or no HTML

import { Parser } from 'acorn';

// ── helpers ───────────────────────────────────────────────────────────────────

function parseJs(html) {
  const matches = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
  if (matches.length === 0) return { ok: true, noScript: true, error: null };
  for (const m of matches) {
    const code = m[1].trim();
    if (!code) continue;
    try {
      Parser.parse(code, { ecmaVersion: 'latest', sourceType: 'script' });
    } catch (e) {
      return { ok: false, noScript: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
  return { ok: true, noScript: false, error: null };
}

function computeScore(failed) {
  if (failed.length === 0) return 2;
  if (failed.length <= 2) return 1;
  return 0;
}

function getStyleBlock(html) {
  return html.match(/<style[^>]*>([\s\S]*?)<\/style>/i)?.[1] ?? '';
}

function getScriptBlocks(html) {
  return [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]).join('\n');
}

// Returns true if JS creates elements in a loop (any count) or if a for-loop
// with count >= threshold is found, or if a variable >= threshold feeds a loop.
function detectJsLoop(scripts, threshold = 15) {
  // for (... i < N ...) with literal N
  const forCounts = [...scripts.matchAll(/for\s*\([^;]*;\s*\w+\s*[<>]=?\s*(\d+)/gi)]
    .map(m => parseInt(m[1]));
  if (forCounts.some(n => n >= threshold)) return `JS for-loop (count ${forCounts.find(n => n >= threshold)})`;

  // Array.from({length: N})
  const afCounts = [...scripts.matchAll(/Array\.from\s*\(\s*\{[^}]*length\s*:\s*(\d+)/gi)]
    .map(m => parseInt(m[1]));
  if (afCounts.some(n => n >= threshold)) return `Array.from(length ${afCounts.find(n => n >= threshold)})`;

  // Variable assigned N >= threshold and a for-loop exists
  const varNums = [...scripts.matchAll(/(?:const|let|var)\s+\w+\s*=\s*(\d+)/g)]
    .map(m => parseInt(m[1]));
  if (varNums.some(n => n >= threshold) && /for\s*\(/.test(scripts))
    return `variable (${varNums.find(n => n >= threshold)}) in loop`;

  // createElement inside any loop
  if (/createElement/.test(scripts) && /for\s*\(/.test(scripts))
    return 'createElement in loop';

  return null;
}

// ── shared base checks ────────────────────────────────────────────────────────

function structuralChecks(html) {
  const passed = [], failed = [];
  if (/<!doctype html/i.test(html))                                        passed.push('has DOCTYPE');
  else                                                                      failed.push('missing DOCTYPE');
  if (/<html[\s>]/i.test(html) && /<\/html>/i.test(html))                 passed.push('has <html>');
  else                                                                      failed.push('missing <html>');
  if (/<head[\s>]/i.test(html) && /<\/head>/i.test(html))                 passed.push('has <head>');
  else                                                                      failed.push('missing <head>');
  if (/<body[\s>]/i.test(html) && /<\/body>/i.test(html))                 passed.push('has <body>');
  else                                                                      failed.push('missing <body>');
  const hasStyle  = /<style[\s>]/i.test(html) && /<\/style>/i.test(html);
  const hasScript = /<script[\s>]/i.test(html) && /<\/script>/i.test(html);
  if (hasStyle || hasScript)                                                passed.push('has <style> or <script>');
  else                                                                      failed.push('missing both <style> and <script>');
  return { passed, failed };
}

function jsChecks(html) {
  const passed = [], failed = [];
  const r = parseJs(html);
  if (r.noScript) passed.push('CSS-only (no script to parse)');
  else if (r.ok)  passed.push('JS parses OK');
  else            failed.push(`JS parse error: ${r.error}`);
  return { passed, failed };
}

function animationChecks(html) {
  const passed = [], failed = [];
  if (/@keyframes\s/i.test(html) || /requestAnimationFrame/i.test(html) || /setInterval/i.test(html))
    passed.push('animation mechanism present');
  else
    failed.push('no @keyframes, requestAnimationFrame, or setInterval found');
  return { passed, failed };
}

function backgroundChecks(html) {
  const warnings = [];
  if (!/background(?:-color)?\s*:/i.test(html))
    warnings.push('background may be white/default — no background property found');
  return { warnings };
}

// ── animation-duration check (fixed) ─────────────────────────────────────────
// Only tests explicit `animation-duration:` property, not the shorthand.
// Uses \d[\d.]* so "3.5s" does NOT trigger (full decimal consumed before lookahead).

function durationChecks(html) {
  const warnings = [];
  const style   = getStyleBlock(html);
  const scripts = getScriptBlocks(html);

  // Case 1: animation-duration: <number>; — unitless explicit property
  // \d[\d.]* consumes the full decimal (e.g. 3.5) before the unit lookahead.
  if (/animation-duration\s*:\s*\d[\d.]*\s*(?![sm%])/i.test(style))
    warnings.push('animation-duration: unitless value in CSS (missing s or ms)');

  // Case 2: CSS var used as animation duration but var resolves to unitless number
  for (const m of style.matchAll(/animation(?:-duration)?\s*:[^;]*var\s*\(\s*(--[\w-]+)\s*\)/gi)) {
    const varName = m[1];
    const varVal  = style.match(new RegExp(varName + '\\s*:\\s*([^;\\n]+)'))?.[1]?.trim() ?? '';
    if (/^\d+[\d.]*$/.test(varVal))
      warnings.push(`animation uses var(${varName}) but it resolves to unitless "${varVal}" (add s or ms)`);
  }

  // Case 3: JS sets animationDuration to a number (not a string with unit)
  // e.g. el.style.animationDuration = 3   (no quotes, no template literal with s)
  if (/\.style\.animationDuration\s*=\s*\d[\d.]*/i.test(scripts) &&
      !/\.style\.animationDuration\s*=\s*[`'"]/.test(scripts))
    warnings.push('JS sets animationDuration to a bare number (needs string like "2s")');

  return { warnings };
}

// ── family 1 ──────────────────────────────────────────────────────────────────

function checkFamily1(html) {
  const s = structuralChecks(html);
  const j = jsChecks(html);
  const a = animationChecks(html);
  const b = backgroundChecks(html);
  const passed   = [...s.passed, ...j.passed, ...a.passed];
  const failed   = [...s.failed, ...j.failed, ...a.failed];
  const warnings = [...b.warnings];
  return { score: computeScore(failed), passed, failed, warnings };
}

// ── family 2 (production + code-quality detections) ──────────────────────────

function checkFamily2(html) {
  const base     = checkFamily1(html);
  const dur      = durationChecks(html);
  const warnings = [...base.warnings, ...dur.warnings];
  const style    = getStyleBlock(html);

  // window-property typo
  if (/window-[a-zA-Z_$][\w$]*/.test(html))
    warnings.push('window-property typo detected (use dot: window.property)');

  // kebab-case JS style assignment
  if (/\.style\.[a-z]+-[a-z]/i.test(html))
    warnings.push('kebab-case JS style property (use camelCase)');

  // duplicate window token
  if (/\bwindow\s{2,}window\b/.test(html))
    warnings.push('duplicate "window window" token');

  // undefined CSS vars
  if (style) {
    const used    = new Set([...style.matchAll(/var\(\s*--([\w-]+)/g)].map(m => m[1]));
    const defined = new Set([...style.matchAll(/--([\w-]+)\s*:/g)].map(m => m[1]));
    const missing = [...used].filter(v => !defined.has(v));
    if (missing.length > 0)
      warnings.push(`undefined CSS vars: ${missing.join(', ')}`);
  }

  return { ...base, warnings };
}

// ── family 3 (production base + per-category checks) ─────────────────────────

function categoryChecks(html, slug) {
  const passed = [], warnings = [];
  const style   = getStyleBlock(html);
  const scripts = getScriptBlocks(html);

  if (slug === 'bouncing-ball') {
    if (/velocity|bounce|gravity|vy\b|dy\b/i.test(html))
      passed.push('bounce physics variable detected');
    else
      warnings.push('no velocity/bounce/gravity variable found');
    if (/(?:width|height)\s*:\s*(?:[89]\d|1[0-4]\d|150)px/i.test(html))
      passed.push('element size ≥ 80px');
    else
      warnings.push('element may be smaller than 80px');
  }

  if (['snowflakes', 'autumn-leaves', 'fireworks', 'fish'].includes(slug)) {
    const inlineCount = (html.match(/class="[^"]*(?:snowflake|flake|leaf|spark|particle|confetti|fish|bubble)[^"]*"/gi) || []).length;
    const jsLoop      = detectJsLoop(scripts, 15);
    if (inlineCount >= 15 || jsLoop)
      passed.push(`sufficient particles (${jsLoop ?? `${inlineCount} inline`})`);
    else
      warnings.push(`low particle count (${inlineCount} inline, no JS loop ≥ 15 found)`);
  }

  if (slug === 'butterflies') {
    // Wing animation: keyframe containing scaleX, rotateY, or explicit wing transform
    if (/@keyframes[^{]*{[^}]*(?:scaleX|rotateY|rotate)/is.test(html) ||
        /\.wing[^{]*animation|animation[^;]*wing/i.test(html))
      passed.push('wing animation keyframe detected');
    else
      warnings.push('no wing scaleX/rotateY keyframe found — wings may not animate');
  }

  if (slug === 'ocean-waves') {
    const waveCount = (html.match(/class="[^"]*wave[^"]*"/gi) || []).length;
    if (waveCount >= 2)
      passed.push(`${waveCount} wave layers detected`);
    else
      warnings.push(`only ${waveCount} wave element(s) — need at least 2`);
  }

  if (slug === 'carousel') {
    // rotate() or rotateZ() or angular transform
    if (/rotate[ZX]?\s*\(|transform\s*:[^;]*rotate/i.test(html))
      passed.push('rotation transform detected');
    else
      warnings.push('no rotate() found for carousel — may not spin');
    // Circular placement: translate() or translateY() or margin auto in a rotation context
    if (/translateY\s*\(|translate\s*\(|translateX\s*\(/i.test(html))
      passed.push('translate for circular placement detected');
    else
      warnings.push('no translate() for circular element placement');
  }

  if (['night-sky', 'rocket'].includes(slug)) {
    const inlineStars = (html.match(/class="[^"]*star[^"]*"/gi) || []).length;
    const jsLoop      = detectJsLoop(scripts, 10);
    const canvasDraw  = /(?:fillRect|\.arc)\s*\(/.test(scripts) && /Math\.random/.test(scripts);
    if (inlineStars >= 10 || jsLoop || canvasDraw)
      passed.push(`starfield present (${jsLoop ?? (canvasDraw ? 'canvas' : `${inlineStars} inline`)})`);
    else
      warnings.push(`sparse starfield (${inlineStars} inline stars, no JS loop or canvas random draw found)`);
  }

  if (slug === 'fish') {
    if (/border-radius\s*:\s*50%|ellipse|oval/i.test(html))
      passed.push('oval/fish body shape detected');
    else
      warnings.push('no oval/fish body shape found');
    if (/bubble/i.test(html))
      passed.push('bubble elements present');
    else
      warnings.push('no bubble elements found');
  }

  if (slug === 'rainbow') {
    if (/@keyframes/.test(html))
      passed.push('rainbow animation keyframe present');
    else
      warnings.push('rainbow may be static — no @keyframes found');
  }

  if (slug === 'rocket') {
    if (/translateY|bottom|top\s*:/i.test(html))
      passed.push('vertical motion detected');
    else
      warnings.push('no upward launch motion detected');
  }

  if (slug === 'clown') {
    if (/arc|juggl|toss|throw|parabola/i.test(html) ||
        (/translateX/.test(html) && /translateY/.test(html)))
      passed.push('juggling arc or multi-axis motion detected');
    else
      warnings.push('no arc/juggle multi-axis motion detected');
  }

  if (slug === 'autumn-leaves') {
    const hasRotate   = /rotate/.test(html);
    const hasFall     = /translateY|fall|drop/i.test(html);
    if (hasRotate && hasFall)
      passed.push('rotation + downward drift detected');
    else if (!hasRotate)
      warnings.push('no rotate in leaf animation — leaves fall without spinning');
    else
      warnings.push('no translateY/fall/drop motion — leaves may not drift');
  }

  return { passed, warnings };
}

function checkFamily3(html, slug) {
  const base = checkFamily2(html);
  const cat  = categoryChecks(html, slug);
  return {
    score:    computeScore(base.failed),
    passed:   [...base.passed,   ...cat.passed],
    failed:   base.failed,
    warnings: [...base.warnings, ...cat.warnings],
  };
}

// ── family 4 (wide general) ────────────────────────────────────────────────────

function checkFamily4(html) {
  const base     = checkFamily2(html);
  const passed   = [...base.passed];
  const warnings = [...base.warnings];

  // @keyframes count
  const kfCount = [...html.matchAll(/@keyframes\s+([\w-]+)/gi)].length;
  if (kfCount >= 2)
    passed.push(`${kfCount} distinct @keyframes defined`);
  else
    warnings.push(`only ${kfCount} @keyframes — wide prompt expects ≥ 2 for multi-element scene`);

  // Element count in body
  const bodyContent = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? '';
  const divCount    = (bodyContent.match(/<div/gi) || []).length;
  if (divCount >= 3)
    passed.push(`${divCount} div elements in body`);
  else
    warnings.push(`only ${divCount} div elements — wide prompt expects ≥ 3 distinct animated elements`);

  // setTimeout(fn, 0) anti-pattern
  if (/setTimeout\s*\([^,]+,\s*0\s*\)/.test(html))
    warnings.push('setTimeout(fn, 0) anti-pattern');

  // display:none with @keyframes
  if (/display\s*:\s*none/.test(html) && /@keyframes/.test(html))
    warnings.push('display:none alongside @keyframes — possible invisible animated element');

  // Hardcoded canvas size
  if (/canvas\.width\s*=\s*\d{3,}|canvas\.height\s*=\s*\d{3,}/.test(html))
    warnings.push('canvas sized to hardcoded pixels — use window.innerWidth/innerHeight');

  return { ...base, passed, warnings };
}

// ── family 5 create ────────────────────────────────────────────────────────────

function checkFamily5Create(html) {
  return checkFamily1(html);
}

// ── family 5 edit (compare pre vs post) ───────────────────────────────────────

function checkFamily5Edit(preHtml, postHtml) {
  const passed = [], failed = [], warnings = [];

  if (!postHtml) {
    failed.push('no HTML extracted from edit response');
    return { score: 0, passed, failed, warnings };
  }

  // Structure preservation
  const countEls = h => (h.match(/<(div|canvas|svg|section|article)\b/gi) || []).length;
  const pre = countEls(preHtml), post = countEls(postHtml);
  if (Math.abs(post - pre) <= Math.max(3, Math.round(pre * 0.3)))
    passed.push(`element count preserved (${pre} → ${post})`);
  else
    warnings.push(`element count shifted: ${pre} → ${post}`);

  // Theme preservation
  const extractBg = h => (h.match(/background(?:-color)?\s*:\s*([^;}"'\n]+)/i) || [])[1]?.trim() ?? '';
  const preBg = extractBg(preHtml), postBg = extractBg(postHtml);
  if (preBg && postBg && preBg.slice(0, 10) === postBg.slice(0, 10))
    passed.push('background color/gradient preserved');
  else if (preBg && postBg)
    warnings.push(`background changed: "${preBg.slice(0, 30)}" → "${postBg.slice(0, 30)}"`);

  // Replace detection
  const strip  = h => h.replace(/\s/g, '');
  const ratio  = Math.abs(strip(postHtml).length - strip(preHtml).length) / Math.max(strip(preHtml).length, 1);
  if (ratio > 0.60)
    warnings.push(`${Math.round(ratio * 100)}% content change — possible full replacement`);
  else
    passed.push(`content change ratio OK (${Math.round(ratio * 100)}%)`);

  // Breakage check
  const j = jsChecks(postHtml);
  passed.push(...j.passed);
  failed.push(...j.failed);

  return { score: computeScore(failed), passed, failed, warnings };
}

// ── exports ────────────────────────────────────────────────────────────────────

export const CHECKERS = {
  family1: (html, _slug, _pre) => checkFamily1(html),
  family2: (html, _slug, _pre) => checkFamily2(html),
  family3: (html,  slug, _pre) => checkFamily3(html, slug),
  family4: (html, _slug, _pre) => checkFamily4(html),
  family5: (html,  slug,  pre) => pre ? checkFamily5Edit(pre, html) : checkFamily5Create(html),
};
