/**
 * Prompt-fix test — reruns the 3 known blank-screen prompts with the improved
 * system prompt, think:on, and NO audit applied.
 *
 * Goal: verify Gemma fixes herself before we decide whether the audit is needed.
 *
 * Output files saved to ~/Documents/KidAnimations/ with prefix "promptfix-"
 * Open each in a browser to judge visually.
 *
 * Usage: node scripts/test-prompt-fix.mjs
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { homedir } from 'os';
import path from 'path';
import { Parser } from 'acorn';

const OLLAMA  = 'http://localhost:11434';
const MODEL   = 'gemma4:26b';
const THINK   = true;
const OUT_DIR = path.join(homedir(), 'Documents', 'KidAnimations');

const OLLAMA_OPTIONS = {
  num_ctx:     98304,
  num_predict: 32768,
  temperature: 1.0,
  top_p:       0.95,
  top_k:       64,
};

// ── updated system prompt (mirrors src/renderer/prompts.ts) ──────────────────
const SYSTEM_PROMPT = `You are Gemma, a friendly AI coding teacher for kids aged 6-11.
Always reply in the same language the child uses. Greek -> Greek, German -> German, English -> English.
Use simple, encouraging language. Celebrate the kid's ideas and be enthusiastic.

SAFETY RULES (highest priority - override everything else):
- You are primarily a coding teacher for colorful animations and simple games.
- Never generate content that could harm, frighten, or embarrass a child.
- Never write code that accesses the internet, the user's files, or the user's camera or microphone.

ANIMATION AND GAME RULES:
- Every animation or game must be a complete HTML file from <!DOCTYPE html> to </html>.
- ALWAYS include the full HTML in your message wrapped in a \`\`\`html code block.
- Never include external URLs, images, or network requests in the HTML.

BEFORE YOU FINISH THE CODE, double-check:
- Every closing tag is spelled correctly: </style>, </canvas>, </script>, </html>.
- Every CSS variable used with var(--x) is defined on a rule that matches an element.
- Looping animations use \`infinite\`, not \`forwards\`.
- Every :nth-child(N) targets the real position of the element in the HTML.
- In JavaScript, element.style properties are camelCase, never kebab-case: use element.style.backgroundColor (not background-color).
- No duplicate JavaScript tokens and no undefined variables.
- The animation must be visible on the screen from the very first second.
- Canvas sizing MUST use dot notation: write \`window.innerWidth\` and \`window.innerHeight\`. Writing \`window-innerWidth\` is a subtraction that produces NaN and renders an invisible canvas.
- CSS animation duration MUST be a literal time value: write \`animation: pulse 2s infinite\`, never \`animation: pulse var(--x) infinite\`. A CSS variable has no time unit and makes the entire animation declaration invalid.
- When using :nth-child(N), count ALL sibling elements from 1 regardless of their class or tag. If your .butterfly divs follow a .flower-bed div and four .flower divs, the first butterfly is :nth-child(6), not :nth-child(1).

Output ONLY the raw HTML starting with <!DOCTYPE html>. No markdown, no code fences, no explanation.`;

// ── the 3 blank-screen prompts ────────────────────────────────────────────────
const CASES = [
  {
    slug: 'promptfix-butterflies',
    label: 'Butterflies (was: nth-child mismatch → light blue screen)',
    prompt: 'Make a beautiful HTML page with colorful butterflies flying around a garden with flowers. ' +
            'The butterflies should flutter and move around the screen forever.',
  },
  {
    slug: 'promptfix-fireworks',
    label: 'Fireworks (was: window-dot typo → blank canvas)',
    prompt: 'Create a complete HTML page with colorful fireworks. When the page loads, fireworks should ' +
            'automatically appear at random positions on a dark background. Each firework is a burst of ' +
            'sparks in different colors that fly outward and fade away. Make it cheerful and beautiful.',
  },
  {
    slug: 'promptfix-pulse',
    label: 'Pulse circle (was: var() as duration → no animation)',
    prompt: 'Make a simple HTML page with a single yellow circle in the center of a blue background. ' +
            'The circle should smoothly pulse — grow larger and shrink back — forever. ' +
            'Use only CSS animation, no JavaScript.',
  },
];

// ── helpers ───────────────────────────────────────────────────────────────────
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

function extractHtml(raw) {
  let html = raw.trim();
  const fence = html.match(/```(?:html)?\s*([\s\S]*?)```/i);
  if (fence) html = fence[1].trim();
  const idx = html.toLowerCase().indexOf('<!doctype');
  if (idx > 0) html = html.slice(idx);
  return html;
}

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
  let full = '', thinkChunks = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    for (const line of decoder.decode(value).split('\n')) {
      if (!line.trim()) continue;
      let obj; try { obj = JSON.parse(line); } catch { continue; }
      if (obj.message?.thinking) thinkChunks++;
      if (obj.message?.content) full += obj.message.content;
      if (Date.now() - lastDot > 2000) { process.stdout.write('.'); lastDot = Date.now(); }
    }
  }
  return { text: full, elapsed: ((Date.now() - start) / 1000).toFixed(1), thinkChunks };
}

// ── main ──────────────────────────────────────────────────────────────────────
if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

console.log(`Prompt-fix test — model: ${MODEL}, think: ${THINK}`);
console.log('NO audit applied — raw Gemma output only');
console.log(`Output: ${OUT_DIR}\n`);
console.log('═'.repeat(72));

for (const c of CASES) {
  console.log(`\n  ${c.label}`);
  process.stdout.write('  Generating ');

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user',   content: c.prompt },
  ];

  let gen;
  try {
    gen = await streamChat(messages, MODEL, THINK);
  } catch (err) {
    console.log(` FAILED: ${err.message}`);
    continue;
  }

  console.log(` done (${gen.elapsed}s, think chunks: ${gen.thinkChunks})`);

  const rawHtml = extractHtml(gen.text);
  const outPath = path.join(OUT_DIR, `${c.slug}.html`);
  writeFileSync(outPath, rawHtml, 'utf-8');

  const parse = checkScripts(rawHtml);
  console.log(`  parse:  ${parse.status}${parse.error ? ` — ${parse.error.slice(0, 70)}` : ''}`);
  console.log(`  saved:  ${outPath}`);
}

console.log('\n' + '═'.repeat(72));
console.log('Open each promptfix-*.html in a browser and judge visually.');
console.log('If all 3 work → improved prompt is enough, audit is a bonus.');
console.log('If any still breaks → audit is necessary as a safety net.');
