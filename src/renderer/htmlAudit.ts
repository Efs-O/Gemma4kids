// Local HTML post-processor for Gemma output.
// No Ollama, no IPC, no network. See gemma_code_quality_report.md.

import { Parser } from 'acorn';

const TAG_TYPO_MAP: Record<string, string> = {
  candas: 'style',
  canavs: 'canvas',
  scrpit: 'script',
  styel: 'style',
  sytpe: 'style',
};

const VALID_HTML_TAGS = new Set([
  'html', 'head', 'body', 'div', 'span', 'p', 'a', 'img', 'canvas', 'script', 'style',
  'meta', 'link', 'title', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'table',
  'tr', 'td', 'th', 'form', 'input', 'button', 'select', 'option', 'textarea',
  'header', 'footer', 'nav', 'main', 'section', 'article', 'aside', 'figure',
  'figcaption', 'video', 'audio', 'source', 'svg', 'path', 'circle', 'rect', 'line',
  'polygon', 'polyline', 'g', 'defs', 'use', 'symbol', 'text', 'tspan',
]);

export interface HtmlAuditResult {
  html: string;
  fixes: string[];
  scriptParse: 'ok' | 'broken' | 'no-script';
  scriptError: string | null;
  visualWarnings: string[];
}

function checkScripts(html: string): {
  scriptParse: HtmlAuditResult['scriptParse'];
  scriptError: string | null;
} {
  const matches = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
  if (matches.length === 0) return { scriptParse: 'no-script', scriptError: null };

  for (const m of matches) {
    const code = m[1].trim();
    if (!code) continue;
    try {
      Parser.parse(code, { ecmaVersion: 'latest', sourceType: 'script' });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { scriptParse: 'broken', scriptError: msg };
    }
  }
  return { scriptParse: 'ok', scriptError: null };
}

export function auditHtml(html: string): HtmlAuditResult {
  const fixes: string[] = [];
  let out = html;

  // 1. Mistyped closing tags. High-confidence repair only.
  out = out.replace(/<\/([a-zA-Z][a-zA-Z0-9]*)>/g, (match, tag: string) => {
    const lower = tag.toLowerCase();
    if (VALID_HTML_TAGS.has(lower)) return match;
    const corrected = TAG_TYPO_MAP[lower];
    if (corrected) {
      fixes.push(`tag typo: </${tag}> -> </${corrected}>`);
      return `</${corrected}>`;
    }
    return match;
  });

  // 2. Duplicate adjacent "window" token.
  const dupBefore = out;
  out = out.replace(/\bwindow(\s{2,})window\b/g, 'window');
  if (out !== dupBefore) fixes.push('duplicate window token removed');

  // 3. JS DOM style assignment must be camelCase inside <script> blocks.
  out = out.replace(/(<script[\s\S]*?<\/script>)/gi, (scriptBlock) =>
    scriptBlock.replace(
      /(\.style\.)([a-z]+(?:-[a-z]+)+)(\s*=)/g,
      (_match, prefix: string, prop: string, suffix: string) => {
        const camel = prop.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase());
        fixes.push(`style property: ${prop} -> ${camel}`);
        return `${prefix}${camel}${suffix}`;
      },
    ),
  );

  // 4. Detect missing CSS vars, but do not guess values.
  const styleMatch = out.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
  if (styleMatch) {
    const css = styleMatch[1];
    const usedVars = new Set(
      [...css.matchAll(/var\(\s*--([^),\s]+)/g)].map((m) => m[1]),
    );
    const definedVars = new Set(
      [...css.matchAll(/--([^:;\s]+)\s*:/g)].map((m) => m[1]),
    );
    const missing = [...usedVars].filter((v) => !definedVars.has(v));
    if (missing.length > 0) fixes.push(`undefined CSS vars detected: ${missing.join(', ')}`);
  }

  // 5. window-PROPERTY typo.
  out = out.replace(/(<script[\s\S]*?<\/script>)/gi, (scriptBlock) =>
    scriptBlock.replace(/\bwindow-([a-zA-Z_$][\w$]*)/g, (_m, prop: string) => {
      fixes.push(`window-${prop} -> window.${prop}`);
      return `window.${prop}`;
    }),
  );

  // 6. Sanitise the <html> opening tag - strip garbage tokens, normalise lang.
  out = out.replace(/<html([^>]*)>/i, (_match, attrs: string) => {
    const validAttrs: string[] = [];
    const attrRe = /\b([a-zA-Z][a-zA-Z0-9_:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    for (const m of attrs.matchAll(attrRe)) {
      const [, name, dq, sq] = m;
      const value = dq ?? sq ?? '';
      const lname = name.toLowerCase();
      if (lname === 'lang') {
        const lettersOnly = value.replace(/[^a-zA-Z-]/g, '');
        const code = lettersOnly.match(/([a-z]{2,3})(?:-[a-zA-Z]{2,4})?$/i)?.[0]?.toLowerCase() ?? 'en';
        if (code !== value.toLowerCase()) fixes.push(`html lang: "${value}" -> "${code}"`);
        validAttrs.push(`lang="${code}"`);
      } else if (['dir', 'xmlns', 'class', 'id'].includes(lname)) {
        validAttrs.push(`${lname}="${value}"`);
      }
    }
    const newAttrs = validAttrs.length > 0 ? ' ' + validAttrs.join(' ') : '';
    const origNorm = attrs.replace(/\s+/g, ' ').trim();
    if (origNorm !== newAttrs.trim() && !fixes.some((f) => f.startsWith('html lang'))) {
      fixes.push('html tag: garbage text removed');
    }
    return `<html${newAttrs}>`;
  });

  const scriptCheck = checkScripts(out);
  return { html: out, fixes, ...scriptCheck, visualWarnings: checkVisualRisks(out) };
}

// Detect patterns that can produce a blank or frozen screen.
// Returns warnings only; does not mutate the HTML.
function checkVisualRisks(html: string): string[] {
  const warnings: string[] = [];
  const styleMatch = html.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
  const css = styleMatch?.[1] ?? '';

  // W1. animation shorthand uses var() where the duration slot should be a <time>.
  for (const m of css.matchAll(/animation\s*:\s*([\w-]+)\s+(var\s*\((--[\w-]+)\))/gi)) {
    const varName = m[3];
    const resolvedMatch = css.match(new RegExp(`${varName}\\s*:\\s*([^;\\n]+)`));
    const resolved = resolvedMatch?.[1]?.trim() ?? '';
    if (/^\d+(\.\d+)?$/.test(resolved)) {
      warnings.push(
        `animation duration: var(${varName}) resolves to '${resolved}' (no 's'/'ms' unit) - animation will not run`,
      );
    } else if (!resolved) {
      warnings.push(
        `animation duration: var(${varName}) value not found in stylesheet - ensure it resolves to a time value with 's' or 'ms' unit`,
      );
    }
  }

  // W2. :nth-child(1) selector mismatch.
  const nthOneClasses: string[] = [];
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
            `but first .${cls} is preceded by </${prevName}> - ` +
            `all .${cls}:nth-child(N) selectors likely target wrong elements`,
        );
      }
    }
  }

  return warnings;
}
