import { useEffect, useMemo, useRef, useState } from 'react';

const empty = { isRecording: false, durationMillis: 0, url: null as string | null, level: 0 };

/** Same MediaRecorder, echo cancellation and RMS meter as the desktop mic recorder. */
export function useVoiceCapture() {
  const [state, setState] = useState(empty);
  const live = useRef<{
    media: MediaRecorder | null; stream: MediaStream | null; context: AudioContext | null;
    timer: ReturnType<typeof setInterval> | null; chunks: Blob[]; uri: string; started: number;
    generation: number; stopping: Promise<void> | null;
  }>({ media: null, stream: null, context: null, timer: null, chunks: [], uri: '', started: 0, generation: 0, stopping: null });
  const recorder = useMemo(() => {
    const cleanup = () => {
      const current = live.current;
      if (current.timer) clearInterval(current.timer);
      current.timer = null;
      current.stream?.getTracks().forEach((track) => track.stop());
      current.stream = null;
      void current.context?.close().catch(() => undefined);
      current.context = null;
      current.media = null;
    };
    return {
      get uri() { return live.current.uri; },
      async prepareToRecordAsync() {
        const current = live.current;
        const generation = ++current.generation;
        if (current.stopping) await current.stopping;
        cleanup();
        if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') throw new Error('此浏览器不支持麦克风录音');
        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
        } catch (cause) {
          const name = cause instanceof DOMException ? cause.name : '';
          throw new Error(name === 'NotAllowedError' ? '请允许浏览器使用麦克风' : name === 'NotFoundError' ? '没有找到可用的麦克风' : '无法打开麦克风，请检查设备是否被占用');
        }
        if (generation !== current.generation) { stream.getTracks().forEach((track) => track.stop()); return; }
        current.stream = stream;
        current.chunks = [];
        current.uri = '';
        const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find((type) => MediaRecorder.isTypeSupported(type));
        current.media = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
        current.media.ondataavailable = (event) => { if (event.data.size) current.chunks.push(event.data); };
        setState(empty);
      },
      record() {
        const current = live.current;
        if (!current.media || !current.stream) throw new Error('麦克风尚未准备好');
        current.started = Date.now();
        current.media.start(250);
        setState({ ...empty, isRecording: true });
        const AudioContextConstructor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        let analyser: AnalyserNode | undefined;
        if (AudioContextConstructor) {
          current.context = new AudioContextConstructor();
          void current.context.resume();
          analyser = current.context.createAnalyser();
          analyser.fftSize = 256;
          current.context.createMediaStreamSource(current.stream).connect(analyser);
        }
        const data = new Uint8Array(256);
        current.timer = setInterval(() => {
          let sum = 0;
          if (analyser) {
            analyser.getByteTimeDomainData(data);
            for (const value of data) sum += (value - 128) ** 2;
          }
          setState({ isRecording: true, durationMillis: Date.now() - current.started, url: null,
            level: analyser ? Math.min(1, Math.sqrt(sum / data.length) / 42) : 0 });
        }, 100);
      },
      async stop() {
        const current = live.current;
        if (current.stopping) return current.stopping;
        const media = current.media;
        if (!media || media.state === 'inactive') { cleanup(); return; }
        current.stopping = new Promise<void>((resolve, reject) => {
          media.onstop = () => {
            const blob = new Blob(current.chunks, { type: media.mimeType || 'audio/webm' });
            current.uri = blob.size ? URL.createObjectURL(blob) : '';
            current.chunks = [];
            cleanup();
            setState({ ...empty, url: current.uri, durationMillis: Date.now() - current.started });
            resolve();
          };
          media.onerror = () => { cleanup(); reject(new Error('录音失败，请重试')); };
          media.stop();
        });
        try { await current.stopping; } finally { current.stopping = null; }
      },
      dispose() { live.current.generation += 1; if (live.current.media?.state === 'recording') live.current.media.stop(); cleanup(); },
    };
  }, []);
  useEffect(() => () => recorder.dispose(), [recorder]);
  return { recorder, state };
}
