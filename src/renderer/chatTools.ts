import { auditHtml } from './htmlAudit';
import type { ToolCall } from './llm/types';
import { extractVideoFrameForTool } from './services/MediaAttachmentService';

const INLINE_TOOL_QUOTE = '<|"|>';

export interface AuditSummary {
  fixes: string[];
  visualWarnings: string[];
}

type ToolArgs =
  | { filename: string; html_content: string }
  | { filename: string; pick_random?: boolean; time_seconds?: number }
  | Record<string, never>;

interface ToolExecutionCallbacks {
  setLastAudit: (summary: AuditSummary) => void;
  setLatestCode: (html: string) => void;
  setLastSaved: (filename: string) => void;
  getAttachedVideoFile?: () => File | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseToolArgs(raw: string): ToolArgs {
  const parsed = JSON.parse(raw) as unknown;
  if (!isRecord(parsed)) {
    throw new Error('Tool arguments must be a JSON object');
  }

  const filename = parsed.filename;
  const htmlContent = parsed.html_content;

  if (filename !== undefined && typeof filename !== 'string') {
    throw new Error('Tool argument "filename" must be a string');
  }
  if (htmlContent !== undefined && typeof htmlContent !== 'string') {
    throw new Error('Tool argument "html_content" must be a string');
  }

  return parsed as ToolArgs;
}

export function parseInlineExecuteTool(text: string): ToolCall[] | null {
  const execIdx = text.indexOf('<execute_tool>');
  if (execIdx === -1) return null;

  const toolCallEnd = text.indexOf('<tool_call|>', execIdx);
  const raw = (toolCallEnd === -1 ? text.slice(execIdx) : text.slice(execIdx, toolCallEnd)).trim();
  const nameMatch = raw.match(/<execute_tool>\s*([a-z_][a-z0-9_]*)\s*\{/i);
  if (!nameMatch) return null;

  const name = nameMatch[1];
  const argsStart = raw.indexOf('{', nameMatch.index);
  const argsEnd = raw.lastIndexOf('}');
  if (argsStart === -1 || argsEnd === -1 || argsEnd <= argsStart) return null;

  const body = raw.slice(argsStart + 1, argsEnd);
  const args: Record<string, string> = {};
  let cursor = 0;

  while (cursor < body.length) {
    while (cursor < body.length && /[\s,]/.test(body[cursor])) cursor++;
    if (cursor >= body.length) break;

    const keyMatch = body.slice(cursor).match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*:/);
    if (!keyMatch) break;
    const key = keyMatch[1];
    cursor += keyMatch[0].length;

    if (!body.startsWith(INLINE_TOOL_QUOTE, cursor)) return null;
    cursor += INLINE_TOOL_QUOTE.length;

    const nextMarker = `${INLINE_TOOL_QUOTE},`;
    const nextField = body.indexOf(nextMarker, cursor);
    const valueEnd = nextField === -1 ? body.indexOf(INLINE_TOOL_QUOTE, cursor) : nextField;
    if (valueEnd === -1) return null;

    args[key] = body.slice(cursor, valueEnd);

    if (nextField === -1) {
      cursor = valueEnd + INLINE_TOOL_QUOTE.length;
      break;
    }

    cursor = nextField + 1;
  }

  if (Object.keys(args).length === 0) return null;

  return [{
    id: `inline_${name}`,
    type: 'function',
    function: {
      name,
      arguments: JSON.stringify(args),
    },
  }];
}

export async function executeToolCall(
  call: ToolCall,
  callbacks: ToolExecutionCallbacks,
): Promise<unknown> {
  try {
    const args = parseToolArgs(call.function.arguments);

    switch (call.function.name) {
      case 'save_animation': {
        if (!('filename' in args) || !('html_content' in args)) {
          throw new Error('save_animation requires filename and html_content');
        }
        const audited = auditHtml(args.html_content);
        callbacks.setLastAudit({ fixes: audited.fixes, visualWarnings: audited.visualWarnings });
        if (audited.fixes.length > 0) {
          console.info('[htmlAudit] save_animation fixes:', audited.fixes);
        }
        const res = await window.electronAPI.saveAnimation(
          args.filename,
          audited.html,
          'gemma',
        );
        if (res.success) {
          callbacks.setLatestCode(audited.html);
          callbacks.setLastSaved(res.filename);
        }
        return res;
      }
      case 'read_animation':
        if (!('filename' in args)) {
          throw new Error('read_animation requires filename');
        }
        return window.electronAPI.readAnimation(args.filename);
      case 'save_video_frame': {
        if (!('filename' in args)) {
          throw new Error('save_video_frame requires filename');
        }
        const file = callbacks.getAttachedVideoFile?.() ?? null;
        if (!file) {
          return { error: 'No video is attached. Ask the child to attach a short video first.' };
        }

        const videoArgs = args as { filename: string; pick_random?: boolean; time_seconds?: number };
        const pickRandom = videoArgs.pick_random === true;
        const timeSeconds =
          typeof videoArgs.time_seconds === 'number' && Number.isFinite(videoArgs.time_seconds)
            ? videoArgs.time_seconds
            : undefined;
        const snap = await extractVideoFrameForTool(file, {
          pickRandom: pickRandom || timeSeconds === undefined,
          timeSeconds,
        });
        const res = await window.electronAPI.saveVideoFrame(args.filename, snap.base64, 'gemma');
        if (!res.success) {
          return { error: res.error ?? 'Could not save the frame.' };
        }
        return {
          ok: true,
          saved_as: res.filename,
          path: res.path,
          captured_at_seconds: snap.timeSeconds,
          video_duration_seconds: snap.durationSeconds,
        };
      }
      case 'list_animations':
        return window.electronAPI.listAnimations();
      case 'open_in_browser':
        if (!('filename' in args)) {
          throw new Error('open_in_browser requires filename');
        }
        return window.electronAPI.openInBrowser(args.filename);
      default:
        return { error: `Unknown tool: ${call.function.name}` };
    }
  } catch (error) {
    return { error: String(error) };
  }
}
