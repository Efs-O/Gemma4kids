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
