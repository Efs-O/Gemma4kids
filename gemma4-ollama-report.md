# Gemma 4 + Ollama Report

Date: 2026-04-28

## Purpose

This report explains why Gemma 4 behavior feels confusing in this app, especially around:

- `think` flags
- Ollama `/api/chat`
- Gemma 4 thinking mode
- chat templates
- Ollama model templates
- our app's two different request paths

The goal is to separate documented behavior from local implementation details so we stop guessing.

## Executive Summary

There are two different layers controlling "thinking":

1. Gemma 4 model behavior
2. Ollama API/runtime behavior

Those are related, but not identical.

For this project, the important conclusion is:

- We are not manually constructing a Gemma 4 chat template in the app.
- We are sending structured `messages` to Ollama.
- Ollama is using its Gemma 4 renderer/parser internally for the installed `gemma4:*` models.
- The `think` API flag is the main switch our app was using to enable or disable reasoning behavior at runtime.
- We have two separate `/api/chat` request paths in the codebase, so the flag had to be changed in two places.

## What The Official Sources Say

### 1. Ollama `think` is an API-level runtime flag

Ollama documents `think` on `/api/chat` as a request field. When enabled, the API can return a separate reasoning stream or reasoning field in addition to final content.

Relevant docs:

- Ollama API chat: https://docs.ollama.com/api/chat
- Ollama thinking capability: https://docs.ollama.com/capabilities/thinking

Practical meaning:

- `think: true` is not just a prompt preference.
- It is a top-level Ollama runtime instruction.
- Ollama says thinking is enabled by default in the CLI and API for supported models.

### 2. Gemma 4 has its own thinking conventions

Google's Gemma 4 model card says thinking is controlled through the chat/template layer using `<|think|>` at the start of the system prompt. It also describes model-family-specific behavior when thinking is disabled.

Relevant source:

- Gemma 4 E4B-it model card: https://huggingface.co/google/gemma-4-E4B-it

Important points from the card:

- Gemma 4 uses normal `system`, `user`, and `assistant` roles.
- Thinking is associated with the `<|think|>` control token in the system prompt/template path.
- For most Gemma 4 models, disabling thinking may still produce an empty thought channel block.
- The E2B and E4B variants are called out as exceptions to that exact disabled-thinking behavior.

Practical meaning:

- "Thinking" exists as a Gemma model capability.
- Libraries/runtimes may expose that capability differently.
- Ollama's `think` flag is its runtime abstraction over that capability.

### 3. Ollama owns the model rendering/parsing layer for these installed models

Local inspection with:

```powershell
ollama show --modelfile gemma4:26b
ollama show --modelfile gemma4:e4b
```

shows:

```text
TEMPLATE {{ .Prompt }}
RENDERER gemma4
PARSER gemma4
```

This is the key local finding.

Interpretation:

- The visible Modelfile template is minimal.
- The important model-specific formatting is not being hand-authored by our app.
- Ollama's `RENDERER gemma4` and `PARSER gemma4` are doing the Gemma-specific formatting/parsing work internally.

This is an inference from the local installed model metadata plus Ollama's Modelfile docs:

- Ollama Modelfile reference: https://docs.ollama.com/modelfile

## What Our App Actually Does

## Path A: Main chat/code generation path

File:

- [src/renderer/llm/ollamaNativeChat.ts](C:/Users/efso%20office/Desktop/Gemma4kids/src/renderer/llm/ollamaNativeChat.ts:109)

This path sends the main streaming coding/tool-calling requests to:

- `POST /api/chat`

This body includes:

- `model`
- `messages`
- `tools`
- `stream`
- `think`
- `options.num_ctx`
- sampling params

This is the path used by:

- [src/renderer/hooks/useChat.ts](C:/Users/efso%20office/Desktop/Gemma4kids/src/renderer/hooks/useChat.ts:61)

So the coding/chat behavior and tool-calling behavior come through this request builder.

## Path B: E4B transcription path

File:

- [src/renderer/services/OllamaService.ts](C:/Users/efso%20office/Desktop/Gemma4kids/src/renderer/services/OllamaService.ts:74)

This path also sends:

- `POST /api/chat`

but it is a separate request body for speech transcription, not the main coding loop.

It includes:

- `model`
- a single user message
- base64 media payload
- `keep_alive: 0`
- `stream: false`
- `think`
- `options.num_ctx: 8192`

This exists because transcription is a separate product flow with different constraints from coding chat.

So the reason there were two `think` flags is simple:

- We do have two separate Ollama chat requests.
- One is for coding/tool use.
- One is for E4B audio transcription.

That is not elegant, but it is not accidental.

## What We Are Not Doing

We are not doing these things ourselves in app code:

- manually writing a Gemma 4 Jinja chat template
- manually inserting `<|think|>` into the system prompt
- manually formatting the full Gemma thought/content channel structure
- manually parsing Gemma thought channels

Our system prompt is plain instruction text:

- [src/renderer/prompts.ts](C:/Users/efso%20office/Desktop/Gemma4kids/src/renderer/prompts.ts:1)

That matters because it means:

- if thinking was active, it was not because our prompt explicitly added `<|think|>`
- it was active because of Ollama/runtime handling

## Why This Feels Messy

Because there are really four layers at once:

1. Gemma 4 model-card guidance
2. Ollama API-level request flags
3. Ollama internal renderer/parser behavior for Gemma 4
4. Our app's own product-specific request split

That creates several sources of confusion:

- The Gemma card talks in template/control-token terms.
- Ollama talks in API-flag terms.
- The installed Ollama model looks like it has a trivial template, but hidden Gemma-specific rendering still exists through `RENDERER gemma4`.
- Our app uses two different `/api/chat` calls, so changing one flag does not change the other path.

## Audio-Specific Note

Google's Gemma 4 card says E2B/E4B support audio and recommends placing audio before text in the prompt.

Source:

- https://huggingface.co/google/gemma-4-E4B-it

Our current transcription implementation sends media in the `images` field. That is not clearly documented as the official Gemma-4-audio REST shape in Ollama's public docs. It is best understood as a runtime compatibility workaround in this app, not a clean architecture ideal.

This is the most fragile part of the current setup.

## Findings For This Codebase

### Finding 1

The "thinking on/off" switch that was affecting code quality lived in two files, not one:

- [src/renderer/llm/ollamaNativeChat.ts](C:/Users/efso%20office/Desktop/Gemma4kids/src/renderer/llm/ollamaNativeChat.ts:121)
- [src/renderer/services/OllamaService.ts](C:/Users/efso%20office/Desktop/Gemma4kids/src/renderer/services/OllamaService.ts:86)

### Finding 2

The app does not own the Gemma 4 chat template. Ollama does.

Evidence:

- local `ollama show --modelfile` output
- `RENDERER gemma4`
- `PARSER gemma4`

### Finding 3

Our plain `SYSTEM_PROMPT` is not the source of thinking-mode activation.

Evidence:

- [src/renderer/prompts.ts](C:/Users/efso%20office/Desktop/Gemma4kids/src/renderer/prompts.ts:1)

### Finding 4

It is completely plausible that turning thinking on made code quality worse for this product.

Why:

- extra reasoning tokens can increase latency
- streaming UX becomes noisier
- short complete HTML generation is often better with less deliberation
- smaller models are especially vulnerable to quality drift when they allocate budget to reasoning traces

This is consistent with both Ollama's thinking feature design and Gemma 4's reasoning-oriented behavior.

## Recommended Project Policy

For Gemma4kids, the cleanest policy is:

1. Keep `think: false` in both request paths by default.
2. Do not manually add `<|think|>` to the system prompt.
3. Keep sending structured `messages` and let Ollama handle Gemma-specific formatting.
4. Treat transcription as a separate modality path with its own constraints.
5. If we ever want reasoning back, expose it as an explicit debug toggle, not a silent default.

## Open Questions

These are still worth validating later:

1. Whether future Ollama releases change Gemma 4 audio request conventions.
2. Whether `gemma4:e4b` transcription is best handled through the same chat path long-term.
3. Whether we should log the final effective request body shape in dev builds for model debugging.

## Current Decision

We have already changed both request paths to:

- `think: false`

That is the right default for this product unless testing proves otherwise.

## Sources

- Ollama API chat: https://docs.ollama.com/api/chat
- Ollama thinking: https://docs.ollama.com/capabilities/thinking
- Ollama Modelfile reference: https://docs.ollama.com/modelfile
- Gemma 4 E4B-it model card: https://huggingface.co/google/gemma-4-E4B-it
- Gemma 4 E4B model card: https://huggingface.co/google/gemma-4-E4B
