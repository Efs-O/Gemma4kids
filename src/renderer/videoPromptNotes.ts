export const SIMPLE_VIDEO_UNDERSTANDING_CONTEXT =
  'This turn includes sampled frames from one short video. The child is asking about the media itself, so answer in normal plain text based only on the sampled frames you can see. Do not offer to make HTML or CSS unless the child explicitly asks for code.';

export const VIDEO_EXPORT_TOOL_CONTEXT =
  'This turn is about saving image files from the attached video. The original short video file is attached even if you mainly see sampled frames in chat. Do not ask for the video again. Use the save_video_frame tool. If the child asks for a few or some frames without a count, save 3 frames with simple names like video-frame-1, video-frame-2, and video-frame-3. Do not generate HTML for this request.';
