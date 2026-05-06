const VIDEO_MAX_SECONDS = 30;
const VIDEO_FRAME_MAX_DIMENSION = 640;

export interface PreparedImageAttachment {
  id: string;
  fileName: string;
  base64: string;
  previewUrl: string;
}

export interface PreparedAudioAttachment {
  id: string;
  file: File;
  fileName: string;
  durationSeconds: number;
}

export interface PreparedVideoAttachment {
  id: string;
  file: File;
  fileName: string;
  durationSeconds: number;
  posterDataUrl: string;
}

function createAttachmentId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function readBlobAsBase64(blob: Blob, errorMessage: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const commaIndex = result.indexOf(',');
      if (commaIndex === -1) {
        reject(new Error(errorMessage));
        return;
      }
      resolve(result.slice(commaIndex + 1));
    };
    reader.onerror = () => reject(new Error(errorMessage));
    reader.readAsDataURL(blob);
  });
}

/** Raw base64 of the whole clip for Ollama native chat `videos` (no data: prefix). */
export async function readVideoClipBase64ForOllama(file: File): Promise<string> {
  return readBlobAsBase64(file, 'Could not read that video file.');
}

/** Windows file picker often leaves `file.type` empty; a typed <source> helps Chromium open MP4/MOV. */
const VIDEO_EXT_MIME: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/x-m4v',
  mov: 'video/quicktime',
  webm: 'video/webm',
  ogv: 'video/ogg',
};

function videoMimeFromFileName(fileName: string): string | undefined {
  const match = /\.([a-z0-9]+)$/i.exec(fileName);
  return match ? VIDEO_EXT_MIME[match[1].toLowerCase()] : undefined;
}

function bindVideoElementToBlob(video: HTMLVideoElement, objectUrl: string, file: File): void {
  video.removeAttribute('src');
  video.replaceChildren();
  const mime = file.type || videoMimeFromFileName(file.name);
  if (mime) {
    const source = document.createElement('source');
    source.src = objectUrl;
    source.type = mime;
    video.appendChild(source);
  } else {
    video.src = objectUrl;
  }
  video.load();
}

function clearVideoElement(video: HTMLVideoElement): void {
  video.pause();
  video.removeAttribute('src');
  video.replaceChildren();
  video.load();
}

function loadMediaMetadata<T extends HTMLMediaElement>(
  element: T,
  objectUrl: string,
  sourceFile?: File,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      element.onloadedmetadata = null;
      element.onerror = null;
    };

    element.preload = 'metadata';
    if (element instanceof HTMLVideoElement && sourceFile) {
      bindVideoElementToBlob(element, objectUrl, sourceFile);
    } else {
      element.src = objectUrl;
    }
    element.onloadedmetadata = () => {
      cleanup();
      resolve(element);
    };
    element.onerror = () => {
      cleanup();
      const videoHelp =
        'This video uses a format the app cannot play. Try an MP4 with H.264 video and AAC audio, under 30 seconds.';
      reject(new Error(element instanceof HTMLVideoElement ? videoHelp : 'This file could not be opened here.'));
    };
  });
}

async function withObjectUrl<T>(file: Blob, work: (objectUrl: string) => Promise<T>): Promise<T> {
  const objectUrl = URL.createObjectURL(file);
  try {
    return await work(objectUrl);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function getScaledFrameSize(width: number, height: number): { width: number; height: number } {
  const largestSide = Math.max(width, height);
  if (largestSide <= VIDEO_FRAME_MAX_DIMENSION) {
    return { width, height };
  }

  const scale = VIDEO_FRAME_MAX_DIMENSION / largestSide;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function seekVideo(video: HTMLVideoElement, timeSeconds: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      video.onseeked = null;
      video.onerror = null;
    };

    video.onseeked = () => {
      cleanup();
      resolve();
    };
    video.onerror = () => {
      cleanup();
      reject(new Error('Could not read that video frame.'));
    };
    video.currentTime = timeSeconds;
  });
}

function drawCurrentVideoFrame(video: HTMLVideoElement): string {
  const scaled = getScaledFrameSize(video.videoWidth || 1, video.videoHeight || 1);
  const canvas = document.createElement('canvas');
  canvas.width = scaled.width;
  canvas.height = scaled.height;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Could not prepare that picture.');
  }

  context.drawImage(video, 0, 0, scaled.width, scaled.height);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.86);
  const commaIndex = dataUrl.indexOf(',');
  if (commaIndex === -1) {
    throw new Error('Could not prepare that picture.');
  }
  return dataUrl.slice(commaIndex + 1);
}

async function createVideoPosterDataUrl(file: File): Promise<{ durationSeconds: number; posterDataUrl: string }> {
  return withObjectUrl(file, async (objectUrl) => {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    await loadMediaMetadata(video, objectUrl, file);
    await seekVideo(video, 0);

    const frameBase64 = drawCurrentVideoFrame(video);
    clearVideoElement(video);

    return {
      durationSeconds: video.duration,
      posterDataUrl: `data:image/jpeg;base64,${frameBase64}`,
    };
  });
}

function pickRecorderMimeType(): string | undefined {
  const options = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
  ];

  for (const option of options) {
    if (MediaRecorder.isTypeSupported(option)) {
      return option;
    }
  }

  return undefined;
}

export async function prepareImageAttachment(file: File): Promise<PreparedImageAttachment> {
  const base64 = await readBlobAsBase64(file, 'Could not read that picture.');
  return {
    id: createAttachmentId(),
    fileName: file.name,
    base64,
    previewUrl: URL.createObjectURL(file),
  };
}

export async function prepareAudioAttachment(file: File): Promise<PreparedAudioAttachment> {
  return withObjectUrl(file, async (objectUrl) => {
    const audio = new Audio();
    await loadMediaMetadata(audio, objectUrl);
    return {
      id: createAttachmentId(),
      file,
      fileName: file.name,
      durationSeconds: audio.duration,
    };
  });
}

export async function prepareVideoAttachment(file: File): Promise<PreparedVideoAttachment> {
  const { durationSeconds, posterDataUrl } = await createVideoPosterDataUrl(file);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error('That video could not be read here.');
  }
  if (durationSeconds > VIDEO_MAX_SECONDS) {
    throw new Error(`Please pick a short video under ${VIDEO_MAX_SECONDS} seconds.`);
  }

  return {
    id: createAttachmentId(),
    file,
    fileName: file.name,
    durationSeconds,
    posterDataUrl,
  };
}

export async function extractAudioFromVideo(file: File): Promise<Blob | null> {
  return withObjectUrl(file, async (objectUrl) => {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    await loadMediaMetadata(video, objectUrl, file);

    const captureStream = (video as HTMLVideoElement & {
      captureStream?: () => MediaStream;
      mozCaptureStream?: () => MediaStream;
    }).captureStream ?? (video as HTMLVideoElement & {
      mozCaptureStream?: () => MediaStream;
    }).mozCaptureStream;

    if (!captureStream) {
      clearVideoElement(video);
      return null;
    }

    const captured = captureStream.call(video);
    const audioTracks = captured.getAudioTracks();
    if (audioTracks.length === 0) {
      captured.getTracks().forEach((track) => track.stop());
      clearVideoElement(video);
      return null;
    }

    const audioOnlyStream = new MediaStream(audioTracks);
    const mimeType = pickRecorderMimeType();
    const recorder = mimeType
      ? new MediaRecorder(audioOnlyStream, { mimeType })
      : new MediaRecorder(audioOnlyStream);
    const chunks: BlobPart[] = [];

    return await new Promise<Blob | null>((resolve) => {
      let settled = false;
      let safetyTimer: number | null = null;

      const finalize = (audioBlob: Blob | null) => {
        if (settled) return;
        settled = true;
        if (safetyTimer !== null) {
          window.clearTimeout(safetyTimer);
          safetyTimer = null;
        }
        recorder.ondataavailable = null;
        recorder.onstop = null;
        video.onended = null;
        video.onerror = null;
        video.ontimeupdate = null;
        video.pause();
        captured.getTracks().forEach((track) => track.stop());
        audioOnlyStream.getTracks().forEach((track) => track.stop());
        clearVideoElement(video);
        resolve(audioBlob);
      };

      const requestRecorderStop = () => {
        if (recorder.state !== 'inactive') {
          recorder.stop();
        }
      };

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunks.push(event.data);
        }
      };
      recorder.onstop = () => {
        const type = mimeType ?? 'audio/webm';
        const audioBlob = chunks.length > 0 ? new Blob(chunks, { type }) : null;
        finalize(audioBlob);
      };
      video.onended = () => {
        requestRecorderStop();
      };
      video.ontimeupdate = () => {
        if (!Number.isFinite(video.duration) || video.duration <= 0) return;
        if (video.currentTime >= video.duration - 0.2) {
          requestRecorderStop();
        }
      };
      video.onerror = () => {
        requestRecorderStop();
        window.setTimeout(() => {
          if (!settled) finalize(null);
        }, 400);
      };

      const durationMs =
        Number.isFinite(video.duration) && video.duration > 0
          ? video.duration * 1000
          : VIDEO_MAX_SECONDS * 1000;
      safetyTimer = window.setTimeout(() => {
        safetyTimer = null;
        requestRecorderStop();
        window.setTimeout(() => {
          if (!settled) finalize(null);
        }, 1500);
      }, Math.min(durationMs + 3500, VIDEO_MAX_SECONDS * 1000 + 6000));

      recorder.start();
      void video.play().catch(() => {
        requestRecorderStop();
        window.setTimeout(() => {
          if (!settled) finalize(null);
        }, 400);
      });
    });
  });
}

/** One JPEG frame (raw base64) for Gemma's save_video_frame tool — Gemma decides time vs random. */
export async function extractVideoFrameForTool(
  file: File,
  opts: { pickRandom: boolean; timeSeconds?: number },
): Promise<{ base64: string; timeSeconds: number; durationSeconds: number }> {
  return withObjectUrl(file, async (objectUrl) => {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    await loadMediaMetadata(video, objectUrl, file);

    const durationSeconds = video.duration;
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      throw new Error('That video could not be read here.');
    }
    if (durationSeconds > VIDEO_MAX_SECONDS) {
      throw new Error(`Please pick a short video under ${VIDEO_MAX_SECONDS} seconds.`);
    }

    const safeEnd = Math.max(durationSeconds - 0.08, 0);
    let timeSeconds: number;
    if (opts.pickRandom || opts.timeSeconds === undefined) {
      timeSeconds = Math.random() * safeEnd;
    } else {
      timeSeconds = Math.max(0, Math.min(opts.timeSeconds, safeEnd));
    }

    await seekVideo(video, timeSeconds);
    const base64 = drawCurrentVideoFrame(video);
    clearVideoElement(video);

    return { base64, timeSeconds, durationSeconds };
  });
}

export { VIDEO_MAX_SECONDS };
