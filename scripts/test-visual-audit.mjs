/**
 * Visual-correctness audit test — loads the 3 known blank-screen benchmark
 * outputs and verifies the new heuristic checks fire on each.
 *
 * No LLM required. Deterministic. Runs in <1s.
 *
 * Usage: node scripts/test-visual-audit.mjs
 */

import { readFileSync } from 'fs';
import { homedir } from 'os';
import path from 'path';
import { Parser } from 'acorn';

const KID_DIR = path.join(homedir(), 'Documents', 'KidAnimations');

// ── audit (mirrors src/renderer/htmlAudit.ts) ────────────────────────────────

const TAG_TYPO_MAP = {
  candas: 'style', canavs: 'canvas', scrpit: 'script', styel: 'style', sytpe: 'style',
};
const VALID_HTML_TAGS = new Set([
  'html','head','body','div','span','p','a','img','canvas','script','style',
  'meta','link','title','h1','h2','h3','h4','h5','h6','ul','ol','li','table',
  'tr','td','th','form','input','button','select','option','textarea',
  'header','footer','nav','main','section','article','aside','figure',
  'figcaption','video','audio','source','svg','path','circle','rect','line',
  'polygon','polyline','g','defs','use','symbol','text','tspan',
]);

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

function checkVisualRisks(html) {
  const warnings = [];
  const styleMatch = html.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
  const css = styleMatch?.[1] ?? '';

  // W1. animation shorthand uses var() as duration slot (no time unit → invalid)
  for (const m of css.matchAll(/animation\s*:\s*([\w-]+)\s+(var\s*\((--[\w-]+)\))/gi)) {
    const varName = m[3];
    const resolvedMatch = css.match(new RegExp(`${varName}\\s*:\\s*([^;\\n]+)`));
    const resolved = resolvedMatch?.[1]?.trim() ?? '';
    if (/^\d+(\.\d+)?$/.test(resolved)) {
      warnings.push(
        `animation duration: var(${varName}) resolves to '${resolved}' (no 's'/'ms' unit) — animation will not run`,
      );
    } else if (!resolved) {
      warnings.push(
        `animation duration: var(${varName}) value not found in stylesheet — ensure it resolves to a time value with 's' or 'ms' unit`,
      );
    }
  }

  // W2. :nth-child(1) mismatch — target class not at position 1 in its container
  const nthOneClasses = [];
  for (const m of css.matchAll(/\.([\w-]+):nth-child\(1\)/g)) {
    if (!nthOneClasses.includes(m[1])) nthOneClasses.push(m[1]);
  }
  if (nthOneClasses.length > 0) {
    const htmlNoComments = html.replace(/<!--[\s\S]*?-->/g, '');
    for (const cls of nthOneClasses) {
      const elemRe = new RegExp(
        `<[a-z][a-z0-9]*[^>]*\\bclass\\s*=\\s*["'][^"']*\\b${cls}\\b[^"']*["'][^>]*>`,
        'i',
      );
      const elemMatch = htmlNoComments.match(elemRe);
      if (!elemMatch) continue;
      const elemIdx = htmlNoComments.indexOf(elemMatch[0]);
      let i = elemIdx - 1;
      while (i >= 0 && /\s/.test(htmlNoComments[i])) i--;
      if (i < 0 || htmlNoComments[i] !== '>') continue;
      const tagEnd = i;
      while (i >= 0 && htmlNoComments[i] !== '<') i--;
      if (i < 0) continue;
      const prevTag = htmlNoComments.slice(i, tagEnd + 1);
      if (/^<\//.test(prevTag)) {
        const prevName = prevTag.match(/^<\/([\w-]+)/)?.[1] ?? 'element';
        warnings.push(
          `:nth-child(1) mismatch: .${cls}:nth-child(1) expects first child, ` +
          `but first .${cls} is preceded by </${prevName}> — ` +
          `all .${cls}:nth-child(N) selectors likely target wrong elements`,
        );
      }
    }
  }

  return warnings;
}

function auditHtml(html) {
  const fixes = [];
  let out = html;

  // 1. tag typos
  out = out.replace(/<\/([a-zA-Z][a-zA-Z0-9]*)>/g, (m, tag) => {
    const lower = tag.toLowerCase();
    if (VALID_HTML_TAGS.has(lower)) return m;
    if (TAG_TYPO_MAP[lower]) { fixes.push(`tag typo: </${tag}> → </${TAG_TYPO_MAP[lower]}>`); return `</${TAG_TYPO_MAP[lower]}>`; }
    return m;
  });

  // 2. duplicate window token
  const dup = out;
  out = out.replace(/\bwindow(\s{2,})window\b/g, 'window');
  if (out !== dup) fixes.push('duplicate window token removed');

  // 3. forwards → infinite
  out = out.replace(/(<style[\s\S]*?<\/style>)/gi, b =>
    b.replace(/\bforwards\b/g, () => { fixes.push('animation: forwards → infinite'); return 'infinite'; }),
  );

  // 4. kebab-case .style property
  out = out.replace(/(<script[\s\S]*?<\/script>)/gi, b =>
    b.replace(/(\.style\.)([a-z]+(?:-[a-z]+)+)(\s*=)/g, (_m, p, prop, s) => {
      const camel = prop.replace(/-([a-z])/g, (_x, c) => c.toUpperCase());
      fixes.push(`style property: ${prop} → ${camel}`);
      return `${p}${camel}${s}`;
    }),
  );

  // 5. undefined CSS vars
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

  // 6. window-PROPERTY typo
  out = out.replace(/(<script[\s\S]*?<\/script>)/gi, b =>
    b.replace(/\bwindow-([a-zA-Z_$][\w$]*)/g, (_m, prop) => {
      fixes.push(`window-${prop} → window.${prop}`);
      return `window.${prop}`;
    }),
  );

  const scriptCheck = checkScripts(out);
  const visualWarnings = checkVisualRisks(out);
  return { html: out, fixes, ...scriptCheck, visualWarnings };
}

// ── test cases ────────────────────────────────────────────────────────────────

const CASES = [
  {
    name: 'butterflies-e4b-thinking-off  (light blue screen — nth-child mismatch)',
    file: 'butterflies-e4b-thinking-off.html',
    expectFix: null,
    expectWarning: /nth-child.*butterfly/,
  },
  {
    name: 'fireworks-26b-off             (blank canvas — window-dot typo)',
    file: 'fireworks-26b-off.html',
    expectFix: /window-innerHeight.*window\.innerHeight/,
    expectWarning: null,
  },
  {
    name: 'pulse-circle-26b-off          (no pulse — animation var() duration)',
    file: 'pulse-circle-26b-off.html',
    expectFix: null,
    expectWarning: /animation.*--pulse-scale.*no 's'/,
  },
];

// ── run ───────────────────────────────────────────────────────────────────────

console.log('Visual-correctness audit test\n');
console.log('═'.repeat(72));

let pass = 0, fail = 0;

for (const c of CASES) {
  const filePath = path.join(KID_DIR, c.file);
  let html;
  try {
    html = readFileSync(filePath, 'utf-8');
  } catch {
    console.log(`\n  ✗  ${c.name}`);
    console.log(`     FILE NOT FOUND: ${filePath}`);
    fail++;
    continue;
  }

  const rawParse = checkScripts(html);
  const result = auditHtml(html);

  const fixMatch  = !c.expectFix    || result.fixes.some(f => c.expectFix.test(f));
  const warnMatch = !c.expectWarning || result.visualWarnings.some(w => c.expectWarning.test(w));
  const ok = fixMatch && warnMatch;

  console.log(`\n  ${ok ? '✓' : '✗'}  ${c.name}`);
  console.log(`     raw parse:    ${rawParse.status}${rawParse.error ? ` — ${rawParse.error.slice(0, 60)}` : ''}`);
  console.log(`     fixes (${result.fixes.length}):    ${result.fixes.join(' | ') || '—'}`);
  console.log(`     warnings (${result.visualWarnings.length}): ${result.visualWarnings.join(' | ') || '—'}`);

  if (!fixMatch)  console.log(`     MISSING fix matching: ${c.expectFix}`);
  if (!warnMatch) console.log(`     MISSING warning matching: ${c.expectWarning}`);

  if (ok) pass++; else fail++;
}

console.log('\n' + '═'.repeat(72));
console.log(`  ${pass}/${pass + fail} cases passed`);
process.exit(fail === 0 ? 0 : 1);
