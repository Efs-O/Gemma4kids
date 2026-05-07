export const SIMPLE_VIDEO_UNDERSTANDING_CONTEXT =
  'This turn includes sampled frames from a short video, and the original short video file is also attached. The child is asking about the media itself, so answer in normal plain text based only on the sampled frames you can see. Do not offer to make HTML or CSS unless the child explicitly asks for code.';

export const VIDEO_EXPORT_TOOL_CONTEXT =
  'This turn includes sampled frames from a short video, and the original short video file is also attached. Use the sampled frames for visual understanding, and use the attached original video with save_video_frame when the child asks to save image files from the video. Do not ask for the video again. If the child asks for a few or some frames without a count, save 3 frames with simple names like video-frame-1, video-frame-2, and video-frame-3. Do not generate HTML for this request.';
