import type { ToolDefinition } from './llm/types';

export const KIDS_TOOLS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'save_animation',
      description: 'Save or overwrite an HTML animation file. Always call this after creating or updating code — never ask the kid to save manually.',
      parameters: {
        type: 'object',
        properties: {
          filename: {
            type: 'string',
            description: 'Filename without .html extension, lowercase with hyphens. Example: "bouncing-ball"',
          },
          html_content: {
            type: 'string',
            description: 'Complete HTML file content from <!DOCTYPE html> to </html>. Must be the full file, never partial.',
          },
        },
        required: ['filename', 'html_content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'save_video_frame',
      description:
        'Save ONE JPEG still from the original attached video to Documents/KidAnimations/video-frames/. The chat may show only sampled frames, but the original short video file is still available for this tool. Use this when the child wants image files on disk, such as favorite frames, random stills, or specific time_seconds. If the child asks for a few frames, call this tool multiple times and choose simple filenames yourself when needed.',
      parameters: {
        type: 'object',
        properties: {
          filename: {
            type: 'string',
            description: 'Base name without .jpg, lowercase words separated by hyphens, e.g. "garden-snapshot"',
          },
          pick_random: {
            type: 'boolean',
            description: 'If true, grab a random moment in the clip (good default).',
          },
          time_seconds: {
            type: 'number',
            description: 'Seconds into the video to capture (0 … length). Ignored when pick_random is true.',
          },
        },
        required: ['filename'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_animation',
      description: 'Read an existing animation file so you can edit it. Always call this before modifying saved code.',
      parameters: {
        type: 'object',
        properties: {
          filename: {
            type: 'string',
            description: 'Filename without .html extension. Example: "bouncing-ball"',
          },
        },
        required: ['filename'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_animations',
      description: "List all saved animation filenames in the kid's project folder.",
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'open_in_browser',
      description: 'Open a saved animation in the browser so the kid can see it running.',
      parameters: {
        type: 'object',
        properties: {
          filename: {
            type: 'string',
            description: 'Filename without .html extension. Example: "bouncing-ball"',
          },
        },
        required: ['filename'],
      },
    },
  },
];
