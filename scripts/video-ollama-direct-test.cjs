const { app, BrowserWindow } = require('electron/main');
const fs = require('node:fs');
const path = require('node:path');

const OLLAMA_BASE = 'http://localhost:11434';

function buildTranscribePrompt(languageHint = '') {
  const hint = String(languageHint).trim().toLowerCase();
  if (hint.startsWith('el')) {
    return 'The spoken language is most likely Greek (el-GR). Transcribe exactly what is spoken. Keep the original language and script exactly as spoken. Reply with transcription only. Never translate. Never transliterate. Do not mix languages. If the speech is Greek, return only Greek script. If a short foreign word is clearly spoken, keep that word exactly as spoken. Output only the transcription text, with no newlines. Write numbers as digits.';
  }
  if (hint.startsWith('de')) {
    return 'The spoken language is most likely German (de-DE). Transcribe exactly what is spoken. Keep the original language and script exactly as spoken. Reply with transcription only. Never translate. Never transliterate. Do not mix languages. If the speech is German, return only German text with normal German spelling. If the speaker switches briefly to another language, keep those exact spoken words only where they were actually said. Output only the transcription text, with no newlines. Write numbers as digits.';
  }
  if (hint.startsWith('en')) {
    return 'The spoken language is most likely English (en). Transcribe exactly what is spoken. Keep the original language and script exactly as spoken. Reply with transcription only. Never translate. Never transliterate. Do not mix languages. If the speech is English, return only English text. If the speaker switches briefly to another language, keep those exact spoken words only where they were actually said. Output only the transcription text, with no newlines. Write numbers as digits.';
  }
  return 'Transcribe exactly what is spoken in the audio. First infer whether the speech is Greek, German, English, or another language. Keep the original language and script exactly as spoken. Reply with transcription only. Never translate. Never transliterate. Do not mix languages unless the speaker actually switches languages. If the speech is Greek, return Greek script. If the speech is German, return German spelling. If the speech is English, return English text. Output only the transcription text, with no newlines. Write numbers as digits.';
}

async function ollamaChat(body) {
  const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  return JSON.parse(text);
}

async function run() {
  const videoFile = process.argv[2];
  if (!videoFile) {
    throw new Error('Usage: electron scripts/video-ollama-direct-test.cjs <video-file>');
  }
  const fullPath = path.resolve(videoFile);
  const raw = fs.readFileSync(fullPath);
  const dataUrl = `data:video/mp4;base64,${raw.toString('base64')}`;

  await app.whenReady();
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: true,
      sandbox: false,
    },
  });
  await win.loadURL('about:blank');

  const media = await win.webContents.executeJavaScript(`
    (async () => {
      const dataUrl = ${JSON.stringify(dataUrl)};

      function waitMetadata(video) {
        return new Promise((resolve, reject) => {
          const cleanup = () => {
            video.onloadedmetadata = null;
            video.onerror = null;
          };
          video.preload = 'metadata';
          video.src = dataUrl;
          video.onloadedmetadata = () => {
            cleanup();
            resolve();
          };
          video.onerror = () => {
            cleanup();
            reject(new Error('metadata failed'));
          };
        });
      }

      function seekVideo(video, timeSeconds) {
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
            reject(new Error('seek failed'));
          };
          video.currentTime = timeSeconds;
        });
      }

      function frameBase64(video) {
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, video.videoWidth);
        canvas.height = Math.max(1, video.videoHeight);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const out = canvas.toDataURL('image/jpeg', 0.86);
        return out.slice(out.indexOf(',') + 1);
      }

      async function audioBlobToWav16kBase64(blob) {
        const arrayBuf = await blob.arrayBuffer();
        const audioCtx = new AudioContext();
        const decoded = await audioCtx.decodeAudioData(arrayBuf);
        await audioCtx.close();
        const targetSr = 16000;
        const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * targetSr), targetSr);
        const src = offline.createBufferSource();
        src.buffer = decoded;
        src.connect(offline.destination);
        src.start(0);
        const rendered = await offline.startRendering();
        const pcmData = rendered.getChannelData(0);
        const pcmBytes = new Int16Array(pcmData.length);
        for (let i = 0; i < pcmData.length; i++) {
          pcmBytes[i] = Math.max(-32768, Math.min(32767, Math.round(pcmData[i] * 32767)));
        }
        const pcmLen = pcmBytes.byteLength;
        const wavBuf = new ArrayBuffer(44 + pcmLen);
        const view = new DataView(wavBuf);
        const writeStr = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
        writeStr(0, 'RIFF'); view.setUint32(4, 36 + pcmLen, true);
        writeStr(8, 'WAVE'); writeStr(12, 'fmt ');
        view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
        view.setUint32(24, targetSr, true); view.setUint32(28, targetSr * 2, true);
        view.setUint16(32, 2, true); view.setUint16(34, 16, true);
        writeStr(36, 'data'); view.setUint32(40, pcmLen, true);
        new Int16Array(wavBuf, 44).set(pcmBytes);
        const bytes = new Uint8Array(wavBuf);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        return btoa(binary);
      }

      async function extractAudioWavBase64(video) {
        const captureStream = video.captureStream ?? video.mozCaptureStream;
        if (!captureStream) return null;
        const captured = captureStream.call(video);
        const audioTracks = captured.getAudioTracks();
        if (audioTracks.length === 0) {
          captured.getTracks().forEach((track) => track.stop());
          return null;
        }
        const audioOnlyStream = new MediaStream(audioTracks);
        const recorder = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? new MediaRecorder(audioOnlyStream, { mimeType: 'audio/webm;codecs=opus' })
          : new MediaRecorder(audioOnlyStream);
        const chunks = [];
        const audioBlob = await new Promise((resolve) => {
          let settled = false;
          const finish = (blob) => {
            if (settled) return;
            settled = true;
            recorder.ondataavailable = null;
            recorder.onstop = null;
            video.onended = null;
            video.ontimeupdate = null;
            video.onerror = null;
            video.pause();
            captured.getTracks().forEach((track) => track.stop());
            audioOnlyStream.getTracks().forEach((track) => track.stop());
            resolve(blob);
          };
          recorder.ondataavailable = (event) => {
            if (event.data.size > 0) chunks.push(event.data);
          };
          recorder.onstop = () => {
            finish(chunks.length ? new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }) : null);
          };
          video.onended = () => {
            if (recorder.state !== 'inactive') recorder.stop();
          };
          video.ontimeupdate = () => {
            if (Number.isFinite(video.duration) && video.currentTime >= video.duration - 0.2 && recorder.state !== 'inactive') {
              recorder.stop();
            }
          };
          video.onerror = () => {
            if (recorder.state !== 'inactive') recorder.stop();
            setTimeout(() => finish(null), 500);
          };
          recorder.start();
          video.play().catch(() => {
            if (recorder.state !== 'inactive') recorder.stop();
            setTimeout(() => finish(null), 500);
          });
        });
        if (!audioBlob) return null;
        return await audioBlobToWav16kBase64(audioBlob);
      }

      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      await waitMetadata(video);
      const duration = video.duration;
      const checkpoints = [0, duration / 2, Math.max(0, duration - 0.2)]
        .filter((t, i, arr) => Number.isFinite(t) && t >= 0 && arr.indexOf(t) === i);
      const frames = [];
      for (const t of checkpoints) {
        await seekVideo(video, t);
        frames.push({ seconds: t, base64: frameBase64(video) });
      }
      await seekVideo(video, 0);
      const audioWavBase64 = await extractAudioWavBase64(video);
      video.pause();
      video.removeAttribute('src');
      video.load();
      return {
        duration,
        width: video.videoWidth,
        height: video.videoHeight,
        frameCount: frames.length,
        frames,
        audioWavBase64,
      };
    })();
  `, true);

  let transcript = null;
  if (media.audioWavBase64) {
    try {
      const transcribe = await ollamaChat({
        model: 'gemma4:e4b',
        stream: false,
        keep_alive: 0,
        think: false,
        options: { num_ctx: 8192 },
        messages: [{
          role: 'user',
          images: [media.audioWavBase64],
          content: buildTranscribePrompt('en-US'),
        }],
      });
      transcript = (transcribe.message?.content || '').trim() || null;
    } catch (error) {
      transcript = `TRANSCRIBE_ERROR: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  const contentParts = [
    'These are frames sampled from one short video in time order.',
    transcript ? `Transcript from the audio track:\n${transcript}` : 'No transcript available from the audio track.',
    'Tell me in one short English sentence what is happening in the video.',
  ];

  const analyze = await ollamaChat({
    model: 'gemma4:e2b',
    stream: false,
    keep_alive: 0,
    think: false,
    messages: [{
      role: 'user',
      content: contentParts.join('\\n\\n'),
      images: media.frames.map((frame) => frame.base64),
    }],
  });

  const result = {
    video: {
      file: fullPath,
      duration: media.duration,
      width: media.width,
      height: media.height,
      frameCount: media.frameCount,
    },
    transcript,
    analysis: analyze.message?.content || '',
    doneReason: analyze.done_reason || null,
  };

  console.log(JSON.stringify(result, null, 2));
  await win.destroy();
  await app.quit();
}

run().catch(async (error) => {
  console.error(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }, null, 2));
  try {
    await app.quit();
  } catch {
    // ignore
  }
  process.exitCode = 1;
});
