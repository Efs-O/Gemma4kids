// Local HTML post-processor for Gemma output.
// No Ollama, no IPC, no network. See gemma_code_quality_report.md.

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
}

export function auditHtml(html: string): HtmlAuditResult {
  const fixes: string[] = [];
  let out = html;

  // 1. Mistyped closing tags  </candas> → </style>
  out = out.replace(/<\/([a-zA-Z][a-zA-Z0-9]*)>/g, (match, tag: string) => {
    const lower = tag.toLowerCase();
    if (VALID_HTML_TAGS.has(lower)) return match;
    const corrected = TAG_TYPO_MAP[lower];
    if (corrected) {
      fixes.push(`tag typo: </${tag}> → </${corrected}>`);
      return `</${corrected}>`;
    }
    return match;
  });

  // 2. Duplicate adjacent "window" token  e.g. "window        window.addEventListener"
  const dupBefore = out;
  out = out.replace(/\bwindow(\s{2,})window\b/g, 'window');
  if (out !== dupBefore) fixes.push('duplicate window token removed');

  // 3. `forwards` → `infinite` inside <style> blocks only (avoids touching prose)
  out = out.replace(/(<style[\s\S]*?<\/style>)/gi, (styleBlock) =>
    styleBlock.replace(/\bforwards\b/g, () => {
      fixes.push('animation: forwards → infinite');
      return 'infinite';
    }),
  );

  // 4. CSS variable audit — inject defaults for vars used but never defined
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

    if (missing.length > 0) {
      const defaults = missing
        .map((v) => {
          if (/x|left|right|width/i.test(v)) return `  --${v}: 0vw`;
          if (/y|top|bottom|height/i.test(v)) return `  --${v}: 0vh`;
          if (/offset|shift|delta/i.test(v)) return `  --${v}: 0`;
          if (/speed|duration/i.test(v)) return `  --${v}: 1`;
          if (/color/i.test(v)) return `  --${v}: #ff69b4`;
          return `  --${v}: 0`;
        })
        .join(';\n');

      const rootBlock = `:root {\n${defaults};\n}`;
      out = out.replace(/<style([^>]*)>/, `<style$1>\n${rootBlock}\n`);
      fixes.push(`undefined CSS vars injected: ${missing.join(', ')}`);
    }
  }

  return { html: out, fixes };
}
