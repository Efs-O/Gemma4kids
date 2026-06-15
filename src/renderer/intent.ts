// Keyword-based intent detection used by the chat routing / message handling.
// These helpers were previously private to useChat.ts and App.tsx; collected here
// so the routing vocabularies live in one place. Vocabularies are unchanged from
// their original definitions (pure relocation — no behavior change).
//
// Note: `isEditIntent`, `isSimpleMotionKeyword`, and `isGeneralChatIntent` remain
// in chatRouting.ts because they are entangled with the simple-mode classifier.

export function isCodeCreationIntent(text: string): boolean {
  const lower = text.toLowerCase();
  return [
    'animation',
    'animate',
    'game',
    'html',
    'code',
    'canvas',
    'css',
    'javascript',
    'js',
    'web page',
    'webpage',
    'editor',
    'open in browser',
  ].some((term) => lower.includes(term));
}

export function isVideoFrameExportIntent(text: string): boolean {
  const lower = text.toLowerCase();
  return [
    'save frame',
    'save frames',
    'save some frames',
    'save a few frames',
    'export frame',
    'export frames',
    'grab frame',
    'grab frames',
    'pick frame',
    'pick frames',
    'capture frame',
    'capture frames',
    'video frame',
    'video frames',
    'still frame',
    'still frames',
    'snapshot',
    'snapshots',
  ].some((term) => lower.includes(term));
}

export function isVideoUnderstandingIntent(text: string): boolean {
  const lower = text.toLowerCase();
  return [
    'what is happening',
    "what's happening",
    'what happens',
    'what is this video about',
    "what's this video about",
    'what this video is about',
    'what is in this video',
    "what's in this video",
    'what does this video show',
    'describe this video',
    'describe the video',
    'summarize this video',
    'summarise this video',
    'about this video',
    'tell me about this video',
    'what do you see',
    'who is in the video',
    'what color',
    'what colour',
    'is it',
    'are they',
  ].some((term) => lower.includes(term));
}

export function shouldUseDraftForMessage(text: string): boolean {
  const lower = text.toLowerCase();
  return [
    'fix', 'broken', 'bug', 'review', 'debug', 'check', 'edit', 'change', 'update',
    'continue', 'improve', 'make it', 'add', 'remove', 'color', 'colour',
    'faster', 'slower', 'bigger', 'smaller', 'wrong',
  ].some((term) => lower.includes(term));
}
