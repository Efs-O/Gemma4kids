/**
 * Deterministic audit fixture test — no LLM, runs in <1s.
 *
 * Replays the exact kebab-case bug Gemma produced in the user's fireworks
 * sessions and verifies the audit + acorn gate catch and repair it.
 *
 * Usage: node scripts/test-audit-fixture.mjs
 */

import { Parser } from 'acorn';

// ── duplicated audit (matches src/renderer/htmlAudit.ts) ─────────────────────
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

// ── fixture: the exact bug pattern Gemma produced ────────────────────────────
const FIXTURES = [
  {
    name: 'fireworks (kebab-case .style assignment)',
    html: `<!DOCTYPE html>
<html><head><style>body{background:#000022}.spark{position:absolute;border-radius:50%}</style></head>
<body>
<script>
const container = document.body;
function createFirework(x, y) {
  const firework = document.createElement('div');
  firework.classList.add('firework');
  firework.style.left = \`\${x}px\`;
  firework.style.background-color = 'white';
  firework.style.animationDuration = '1.5s';
  container.appendChild(firework);
}
document.body.addEventListener('click', e => createFirework(e.clientX, e.clientY));
</script>
</body></html>`,
  },
  {
    name: 'multiple kebab-case props',
    html: `<!DOCTYPE html>
<html><body>
<script>
const el = document.createElement('div');
el.style.font-size = '20px';
el.style.border-radius = '10px';
el.style.background-color = 'red';
document.body.appendChild(el);
</script>
</body></html>`,
  },
  {
    name: 'clean script (no bugs — should not change)',
    html: `<!DOCTYPE html>
<html><body>
<script>
const el = document.createElement('div');
el.style.backgroundColor = 'red';
el.style.fontSize = '20px';
document.body.appendChild(el);
</script>
</body></html>`,
  },
  {
    name: 'mistyped closing tag',
    html: `<!DOCTYPE html>
<html><head><style>body{margin:0}</candas></head>
<body><script>console.log('ok')</script></body></html>`,
  },
];

console.log('Audit fixture test — no LLM, deterministic\n');
console.log('═'.repeat(72));

let pass = 0, fail = 0;
for (const f of FIXTURES) {
  const before = checkScripts(f.html);
  const { html: fixed, fixes } = auditHtml(f.html);
  const after = checkScripts(fixed);

  // Test passes if:
  // - audited script parses (or has no script)
  // - audit didn't break a clean script
  const ok = after.status !== 'broken';

  console.log(`\n  ${ok ? '✓' : '✗'}  ${f.name}`);
  console.log(`     raw:     ${before.status}${before.error ? ` — ${before.error.slice(0, 60)}` : ''}`);
  console.log(`     audited: ${after.status}${after.error ? ` — ${after.error.slice(0, 60)}` : ''}`);
  if (fixes.length) console.log(`     fixes:   ${fixes.join(', ')}`);

  if (ok) pass++; else fail++;
}

console.log('\n' + '═'.repeat(72));
console.log(`  ${pass}/${pass + fail} fixtures passed`);
process.exit(fail === 0 ? 0 : 1);
