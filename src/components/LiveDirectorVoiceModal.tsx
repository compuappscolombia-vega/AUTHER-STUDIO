import { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, PhoneOff, Send, Volume2, X } from 'lucide-react';
import type { ProductionProject, ProductionSequence, VoicePreset } from '../types/studio';
import { VOICE_PRESET_OPTIONS } from '../utils/productionPipeline';

interface LiveDirectorVoiceModalProps {
  open: boolean;
  onClose: () => void;
  activeProject: ProductionProject | null;
  activeSequence: ProductionSequence | null;
  defaultVoicePreset: VoicePreset;
}

interface TranscriptEntry {
  id: string;
  speaker: 'director' | 'user';
  text: string;
}

function float32ToBase64Pcm16(input: Float32Array): string {
  const buffer = new ArrayBuffer(input.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64Pcm16ToFloat32(base64: string): Float32Array {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const view = new DataView(bytes.buffer);
  const samples = new Float32Array(Math.floor(len / 2));
  for (let i = 0; i < samples.length; i++) {
    samples[i] = view.getInt16(i * 2, true) / 32768;
  }
  return samples;
}

export function LiveDirectorVoiceModal({
  open,
  onClose,
  activeProject,
  activeSequence,
  defaultVoicePreset,
}: LiveDirectorVoiceModalProps) {
  const [voicePreset, setVoicePreset] = useState<VoicePreset>(defaultVoicePreset);
  const [status, setStatus] = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle');
  const [muted, setMuted] = useState(false);
  const [textInput, setTextInput] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [entries, setEntries] = useState<TranscriptEntry[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
  const captureCtxRef = useRef<AudioContext | null>(null);
  const playbackCtxRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const mutedRef = useRef<boolean>(false);

  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  useEffect(() => {
    if (!open) {
      cleanupSession();
      return;
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') handleClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  function stopScheduledPlayback() {
    for (const src of activeSourcesRef.current) {
      try {
        src.stop();
      } catch {
        // Ignore already stopped sources
      }
    }
    activeSourcesRef.current.clear();
    if (playbackCtxRef.current) {
      nextStartTimeRef.current = playbackCtxRef.current.currentTime;
    }
  }

  function cleanupSession() {
    stopScheduledPlayback();
    if (processorRef.current) {
      try {
        processorRef.current.disconnect();
      } catch {
        // Ignore
      }
      processorRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
    if (captureCtxRef.current) {
      void captureCtxRef.current.close().catch(() => {});
      captureCtxRef.current = null;
    }
    if (playbackCtxRef.current) {
      void playbackCtxRef.current.close().catch(() => {});
      playbackCtxRef.current = null;
    }
    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch {
        // Ignore
      }
      wsRef.current = null;
    }
    setStatus('idle');
  }

  function handleClose() {
    cleanupSession();
    onClose();
  }

  function appendTranscript(speaker: 'director' | 'user', text: string) {
    const clean = text.trim();
    if (!clean) return;
    setEntries((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.speaker === speaker) {
        return [
          ...prev.slice(0, -1),
          { ...last, text: `${last.text} ${clean}`.trim() },
        ];
      }
      return [
        ...prev.slice(-24),
        { id: `tr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`, speaker, text: clean },
      ];
    });
  }

  async function startLiveCall() {
    cleanupSession();
    setErrorMsg(null);
    setStatus('connecting');

    try {
      // Create playback 24kHz AudioContext synchronously on user gesture
      const playbackCtx = new AudioContext({ sampleRate: 24000 });
      playbackCtxRef.current = playbackCtx;
      nextStartTimeRef.current = playbackCtx.currentTime;

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      mediaStreamRef.current = stream;

      const captureCtx = new AudioContext({ sampleRate: 16000 });
      captureCtxRef.current = captureCtx;

      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
      const params = new URLSearchParams({
        projectTitle: activeProject?.title || 'AUTEUR Studio',
        sequenceTitle: activeSequence?.title || 'Nueva Producción',
        directorStyle: activeProject?.genreStyle || 'Cinematográfico',
        voicePreset,
        continuityBible: (activeProject?.continuityBible || '').slice(0, 1200),
      });
      const ws = new WebSocket(`${proto}://${window.location.host}/api/live-voice?${params.toString()}`);
      wsRef.current = ws;

      ws.onopen = () => {
        const source = captureCtx.createMediaStreamSource(stream);
        const processor = captureCtx.createScriptProcessor(2048, 1, 1);
        processorRef.current = processor;

        processor.onaudioprocess = (ev) => {
          if (mutedRef.current || ws.readyState !== WebSocket.OPEN) return;
          const samples = ev.inputBuffer.getChannelData(0);
          ws.send(JSON.stringify({ audio: float32ToBase64Pcm16(samples) }));
        };

        source.connect(processor);
        processor.connect(captureCtx.destination);
      };

      ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data as string) as {
            ready?: boolean;
            audio?: string;
            interrupted?: boolean;
            inputTranscript?: string;
            outputTranscript?: string;
            error?: string;
          };

          if (payload.ready) {
            setStatus('connected');
          }
          if (payload.error) {
            setErrorMsg(payload.error);
            setStatus('error');
          }
          if (payload.interrupted) {
            stopScheduledPlayback();
          }
          if (payload.inputTranscript) {
            appendTranscript('user', payload.inputTranscript);
          }
          if (payload.outputTranscript) {
            appendTranscript('director', payload.outputTranscript);
          }
          if (payload.audio && playbackCtxRef.current) {
            const pCtx = playbackCtxRef.current;
            const samples = base64Pcm16ToFloat32(payload.audio);
            if (samples.length > 0) {
              const audioBuffer = pCtx.createBuffer(1, samples.length, 24000);
              audioBuffer.getChannelData(0).set(samples);
              const src = pCtx.createBufferSource();
              src.buffer = audioBuffer;
              src.connect(pCtx.destination);

              const startAt = Math.max(pCtx.currentTime, nextStartTimeRef.current);
              src.start(startAt);
              nextStartTimeRef.current = startAt + audioBuffer.duration;
              activeSourcesRef.current.add(src);
              src.onended = () => {
                activeSourcesRef.current.delete(src);
              };
            }
          }
        } catch {
          // Ignore malformed WS frame
        }
      };

      ws.onerror = () => {
        setErrorMsg('No se pudo mantener la conexión de voz en tiempo real.');
        setStatus('error');
      };

      ws.onclose = () => {
        setStatus((prev) => (prev === 'error' ? 'error' : 'idle'));
      };
    } catch (err) {
      cleanupSession();
      setStatus('error');
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'Activa el permiso del micrófono para hablar con el Agente Director.'
      );
    }
  }

  function handleSendTextPrompt(e: React.FormEvent) {
    e.preventDefault();
    const clean = textInput.trim();
    if (!clean || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ text: clean }));
    appendTranscript('user', clean);
    setTextInput('');
  }

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="live-voice-heading"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4"
    >
      <div className="w-full max-w-2xl rounded-xl border border-white/15 bg-[#121218] overflow-hidden flex flex-col max-h-[88vh]">
        <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Volume2 className="w-5 h-5 text-[#38B2AC]" />
            <div>
              <h2 id="live-voice-heading" className="font-display text-base font-semibold text-[#F2F0EB]">
                Sala de Dirección en Vivo (Gemini Live 3.8)
              </h2>
              <p className="text-xs text-[#8D8981]">
                Conversa por voz en tiempo real para definir encuadres, diálogos o resolver dudas paso a paso.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Cerrar sala de voz en vivo"
            className="p-2 rounded-lg text-[#9A968E] hover:text-[#F2F0EB] hover:bg-white/5"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto flex-1">
          <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-xl border border-white/10 bg-[#0B0B0E]">
            <div className="flex items-center gap-2.5">
              <label htmlFor="live-voice-preset" className="text-xs text-[#C8C3BA]">
                Voz del Director:
              </label>
              <select
                id="live-voice-preset"
                value={voicePreset}
                disabled={status === 'connected' || status === 'connecting'}
                onChange={(e) => setVoicePreset(e.target.value as VoicePreset)}
                className="rounded-lg border border-white/15 bg-[#14141B] px-2.5 py-1.5 text-xs text-[#F2F0EB]"
              >
                {VOICE_PRESET_OPTIONS.map((v) => (
                  <option key={v.value} value={v.value}>
                    {v.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-2">
              {status === 'connected' ? (
                <>
                  <button
                    type="button"
                    onClick={() => setMuted((m) => !m)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium ${
                      muted
                        ? 'border-[#EF4444]/40 bg-[#3B1515]/50 text-[#FCA5A5]'
                        : 'border-white/15 bg-[#16161E] text-[#F2F0EB]'
                    }`}
                  >
                    {muted ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5 text-[#38B2AC]" />}
                    <span>{muted ? 'Micrófono silenciado' : 'Micrófono activo'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={cleanupSession}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#EF4444] hover:bg-[#DC2626] text-white text-xs font-semibold"
                  >
                    <PhoneOff className="w-3.5 h-3.5" />
                    <span>Colgar</span>
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => void startLiveCall()}
                  disabled={status === 'connecting'}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#38B2AC] hover:bg-[#4FD1C5] disabled:opacity-60 text-[#0B0B0E] text-xs font-semibold"
                >
                  <Mic className="w-3.5 h-3.5" />
                  <span>
                    {status === 'connecting' ? 'Conectando sesión Live...' : 'Iniciar Conversación por Voz'}
                  </span>
                </button>
              )}
            </div>
          </div>

          {errorMsg && (
            <div
              role="alert"
              className="rounded-lg border border-[#EF4444]/35 bg-[#3B1515]/50 px-4 py-3 text-xs text-[#FCA5A5]"
            >
              {errorMsg}
            </div>
          )}

          {/* Live Transcript */}
          <div className="rounded-xl border border-white/10 bg-[#0B0B0E] p-4 min-h-[210px] max-h-[290px] overflow-y-auto space-y-2.5">
            {entries.length === 0 ? (
              <p className="text-xs text-[#8D8981] text-center py-10 leading-relaxed">
                Pulsa «Iniciar Conversación por Voz» y pregunta libremente al Agente Director
                sobre el ritmo de la escena, el uso de lentes o los pasos para entregar tu filme.
              </p>
            ) : (
              entries.map((item) => (
                <div
                  key={item.id}
                  className={`rounded-lg px-3 py-2 text-xs leading-relaxed ${
                    item.speaker === 'director'
                      ? 'bg-[#17171F] border border-[#E5A93C]/25 text-[#F2F0EB]'
                      : 'bg-[#102625] border border-[#38B2AC]/25 text-[#D1FAE5] ml-6'
                  }`}
                >
                  <span className="font-mono-tech text-[10px] uppercase tracking-wider text-[#E5A93C] block mb-0.5">
                    {item.speaker === 'director' ? 'Agente Director AUTEUR' : 'Tú'}
                  </span>
                  {item.text}
                </div>
              ))
            )}
          </div>

          {status === 'connected' && (
            <form onSubmit={handleSendTextPrompt} className="flex items-center gap-2">
              <input
                type="text"
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                placeholder="También puedes escribir una indicación al vuelo..."
                className="flex-1 rounded-lg border border-white/15 bg-[#0B0B0E] px-3 py-2 text-xs text-[#F2F0EB] placeholder:text-[#6E6A63] focus:border-[#38B2AC] focus:outline-none"
              />
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[#38B2AC]/45 bg-[#102625] hover:bg-[#163433] text-xs font-medium text-[#5EEAD4]"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Enviar</span>
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
