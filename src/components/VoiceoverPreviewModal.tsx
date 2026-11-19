import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AudioLines,
  Download,
  Mic,
  Pause,
  Play,
  SlidersHorizontal,
  Trash2,
  Volume2,
  X,
} from 'lucide-react';
import type { ProductionSequence } from '../types/studio';
import {
  MOCK_TTS_EMOTIONS,
  MOCK_TTS_VOICES,
  type MockTtsEmotion,
  type MockTtsVoiceId,
  type MockVoiceoverClip,
  type ScriptBeatOption,
  createWavBlobUrl,
  estimateSpeechDurationSec,
  extractScriptBeatOptions,
  synthesizeMockVoiceoverWav,
} from '../utils/mockTtsEngine';

interface VoiceoverPreviewModalProps {
  open: boolean;
  sequence: ProductionSequence | null;
  initialBeatKey?: string | null;
  onClose: () => void;
}

const BEAT_TYPE_LABELS: Record<'action' | 'dialogue' | 'camera' | 'sound', string> = {
  action: 'Acción',
  dialogue: 'Diálogo',
  camera: 'Cámara',
  sound: 'Sonido',
};

export function VoiceoverPreviewModal({
  open,
  sequence,
  initialBeatKey,
  onClose,
}: VoiceoverPreviewModalProps) {
  const beatOptions = useMemo(
    () => extractScriptBeatOptions(sequence?.screenplay || []),
    [sequence?.screenplay]
  );

  const [beatFilter, setBeatFilter] = useState<'all' | 'dialogue' | 'action'>('all');
  const [selectedBeatKey, setSelectedBeatKey] = useState<string>('');
  const [scriptText, setScriptText] = useState<string>('');
  const [voiceId, setVoiceId] = useState<MockTtsVoiceId>('narrator-baritone');
  const [emotion, setEmotion] = useState<MockTtsEmotion>('dramatic');
  const [rate, setRate] = useState<number>(1.0);
  const [pitchSemitones, setPitchSemitones] = useState<number>(0);

  const [clips, setClips] = useState<MockVoiceoverClip[]>([]);
  const [activeClipId, setActiveClipId] = useState<string | null>(null);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [playbackProgress, setPlaybackProgress] = useState(0);
  const [isSpeakingBrowser, setIsSpeakingBrowser] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const createdUrlsRef = useRef<string[]>([]);

  const speechSynthesisSupported =
    typeof window !== 'undefined' && 'speechSynthesis' in window;

  const filteredBeats = useMemo(() => {
    if (beatFilter === 'all') return beatOptions;
    return beatOptions.filter((b) => b.beatType === beatFilter);
  }, [beatFilter, beatOptions]);

  const selectedBeat: ScriptBeatOption | null = useMemo(
    () =>
      beatOptions.find((b) => b.beatKey === selectedBeatKey) ||
      filteredBeats[0] ||
      beatOptions[0] ||
      null,
    [beatOptions, filteredBeats, selectedBeatKey]
  );

  const activeClip: MockVoiceoverClip | null = useMemo(
    () => clips.find((c) => c.id === activeClipId) || clips[0] || null,
    [clips, activeClipId]
  );

  // Clean up blob URLs and reset session clips when sequence changes or component unmounts
  useEffect(() => {
    setClips([]);
    setActiveClipId(null);
    setPlaybackProgress(0);
    setIsPlayingAudio(false);
    return () => {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
      createdUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      createdUrlsRef.current = [];
    };
  }, [sequence?.id]);

  // Reset selected beat when modal opens or initialBeatKey changes
  useEffect(() => {
    if (!open) {
      if (audioRef.current) {
        audioRef.current.pause();
      }
      if (speechSynthesisSupported) {
        window.speechSynthesis.cancel();
      }
      setIsPlayingAudio(false);
      setIsSpeakingBrowser(false);
      return;
    }

    const fallbackBeat =
      (initialBeatKey && beatOptions.find((b) => b.beatKey === initialBeatKey)) ||
      beatOptions.find((b) => b.beatType === 'dialogue') ||
      beatOptions[0] ||
      null;

    if (fallbackBeat) {
      setBeatFilter('all');
      setSelectedBeatKey(fallbackBeat.beatKey);
      setScriptText(fallbackBeat.text);
    }
    setFormError(null);
  }, [open, initialBeatKey, sequence?.id]);

  // Escape key closes modal
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const estimatedDuration = estimateSpeechDurationSec(scriptText, rate);

  function handleSelectBeat(beat: ScriptBeatOption) {
    setSelectedBeatKey(beat.beatKey);
    setScriptText(beat.text);
    setFormError(null);
  }

  function handleGenerateClip(e: React.FormEvent) {
    e.preventDefault();
    const clean = scriptText.trim();
    if (clean.length < 3) {
      setFormError('Escribe o selecciona al menos 3 caracteres para sintetizar la voz.');
      return;
    }
    setFormError(null);

    const synth = synthesizeMockVoiceoverWav({
      text: clean,
      voiceId,
      emotion,
      rate,
      pitchSemitones,
    });

    const audioUrl = createWavBlobUrl(synth.wavBytes);
    createdUrlsRef.current.push(audioUrl);

    const voiceProfile =
      MOCK_TTS_VOICES.find((v) => v.id === voiceId) || MOCK_TTS_VOICES[0];

    const newClip: MockVoiceoverClip = {
      id: `mock-vo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
      beatKey: selectedBeat?.beatKey || 'custom',
      sceneNumber: selectedBeat?.sceneNumber || '1',
      beatType: selectedBeat?.beatType || 'dialogue',
      character: selectedBeat?.character,
      text: clean,
      voiceId,
      voiceLabel: voiceProfile.label,
      emotion,
      rate,
      pitchSemitones,
      durationSec: synth.durationSec,
      waveform: synth.waveform,
      audioUrl,
      createdAt: new Date().toISOString(),
    };

    setClips((prev) => [newClip, ...prev]);
    setActiveClipId(newClip.id);
    setPlaybackProgress(0);
    setIsPlayingAudio(false);

    // Auto-load audio element
    window.setTimeout(() => {
      if (audioRef.current) {
        audioRef.current.currentTime = 0;
        void audioRef.current
          .play()
          .then(() => setIsPlayingAudio(true))
          .catch(() => setIsPlayingAudio(false));
      }
    }, 40);
  }

  function handleToggleClipPlayback(clip: MockVoiceoverClip) {
    if (activeClipId === clip.id && audioRef.current) {
      if (isPlayingAudio) {
        audioRef.current.pause();
        setIsPlayingAudio(false);
      } else {
        void audioRef.current
          .play()
          .then(() => setIsPlayingAudio(true))
          .catch(() => setIsPlayingAudio(false));
      }
      return;
    }

    setActiveClipId(clip.id);
    setPlaybackProgress(0);
    window.setTimeout(() => {
      if (audioRef.current) {
        audioRef.current.currentTime = 0;
        void audioRef.current
          .play()
          .then(() => setIsPlayingAudio(true))
          .catch(() => setIsPlayingAudio(false));
      }
    }, 30);
  }

  function handlePreviewBrowserSpeech() {
    if (!speechSynthesisSupported) return;
    if (isSpeakingBrowser) {
      window.speechSynthesis.cancel();
      setIsSpeakingBrowser(false);
      return;
    }
    const clean = scriptText.trim();
    if (!clean) return;

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(clean);
    const voiceProfile =
      MOCK_TTS_VOICES.find((v) => v.id === voiceId) || MOCK_TTS_VOICES[0];
    utterance.lang = 'es-ES';
    utterance.rate = rate;
    utterance.pitch = Math.max(
      0.5,
      Math.min(1.8, voiceProfile.webSpeechPitch + pitchSemitones * 0.05)
    );
    utterance.onend = () => setIsSpeakingBrowser(false);
    utterance.onerror = () => setIsSpeakingBrowser(false);

    setIsSpeakingBrowser(true);
    window.speechSynthesis.speak(utterance);
  }

  function handleDeleteClip(clipId: string) {
    const target = clips.find((c) => c.id === clipId);
    if (target) {
      URL.revokeObjectURL(target.audioUrl);
      createdUrlsRef.current = createdUrlsRef.current.filter((u) => u !== target.audioUrl);
    }
    setClips((prev) => {
      const next = prev.filter((c) => c.id !== clipId);
      if (activeClipId === clipId) {
        setActiveClipId(next[0]?.id || null);
        setIsPlayingAudio(false);
        setPlaybackProgress(0);
      }
      return next;
    });
  }

  function handleDownloadClip(clip: MockVoiceoverClip) {
    const anchor = document.createElement('a');
    anchor.href = clip.audioUrl;
    const safeChar = (clip.character || clip.beatType)
      .toLowerCase()
      .replace(/[^a-z0-9]+/gi, '_');
    anchor.download = `voz_provisional_esc${clip.sceneNumber}_${safeChar}.wav`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="mock-tts-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80"
    >
      <div className="w-full max-w-5xl rounded-xl border border-white/15 bg-[#121217] overflow-hidden shadow-2xl max-h-[92vh] flex flex-col">
        {/* Modal Header */}
        <div className="px-5 py-4 border-b border-white/10 bg-[#101015] flex items-center justify-between gap-4 shrink-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <AudioLines className="w-4 h-4 text-[#E5A93C] shrink-0" />
              <h2
                id="mock-tts-modal-title"
                className="font-display text-base font-semibold text-[#F2F0EB] truncate"
              >
                Estudio de Voz Provisional (Motor TTS Simulado)
              </h2>
            </div>
            <p className="text-xs text-[#8D8981] mt-0.5 truncate">
              {sequence
                ? `${sequence.title} · Genera y previsualiza pistas guía WAV por línea de guion sin consumir cuota externa`
                : 'Selecciona una secuencia para generar locuciones provisionales.'}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar estudio de voz provisional"
            className="p-2 rounded-lg text-[#9A968E] hover:text-[#F2F0EB] hover:bg-white/10 shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        {!sequence || beatOptions.length === 0 ? (
          <div className="p-10 text-center space-y-2">
            <Mic className="w-8 h-8 text-[#8D8981] mx-auto" />
            <p className="text-sm font-medium text-[#F2F0EB]">
              No hay líneas de guion disponibles en esta secuencia
            </p>
            <p className="text-xs text-[#8D8981] max-w-md mx-auto">
              Genera primero una secuencia con diálogos o beats de acción para crear clips de voz provisionales.
            </p>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-white/10">
            {/* Left Column: Script Beat Selector */}
            <div className="lg:col-span-5 flex flex-col bg-[#0D0D12] max-h-[68vh] lg:max-h-none">
              <div className="p-4 border-b border-white/10 space-y-3 shrink-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-[#F2F0EB]">
                    Líneas del Guion ({filteredBeats.length})
                  </span>
                  <div className="flex items-center gap-1 rounded-lg border border-white/10 bg-[#14141B] p-0.5 text-[11px]">
                    {(
                      [
                        { id: 'all', label: 'Todas' },
                        { id: 'dialogue', label: 'Diálogos' },
                        { id: 'action', label: 'Acción' },
                      ] as const
                    ).map((tab) => (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setBeatFilter(tab.id)}
                        className={`px-2.5 py-1 rounded font-medium whitespace-nowrap ${
                          beatFilter === tab.id
                            ? 'bg-[#E5A93C] text-[#0B0B0E] font-semibold'
                            : 'text-[#C8C3BA] hover:text-white'
                        }`}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {filteredBeats.map((beat) => {
                  const isSelected = selectedBeat?.beatKey === beat.beatKey;
                  const clipCount = clips.filter((c) => c.beatKey === beat.beatKey).length;
                  return (
                    <button
                      key={beat.beatKey}
                      type="button"
                      onClick={() => handleSelectBeat(beat)}
                      className={`w-full text-left rounded-lg border p-3 transition-colors space-y-1.5 ${
                        isSelected
                          ? 'border-[#E5A93C]/70 bg-[#1B1810]'
                          : 'border-white/10 bg-[#131318] hover:border-white/25'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 text-[11px] font-mono-tech">
                        <span className="text-[#E5A93C] truncate">
                          Esc. {beat.sceneNumber} · {BEAT_TYPE_LABELS[beat.beatType]}
                          {beat.character ? ` · ${beat.character}` : ''}
                        </span>
                        {clipCount > 0 && (
                          <span className="text-[#5EEAD4] tabular-nums shrink-0">
                            {clipCount} clip{clipCount === 1 ? '' : 's'}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-[#EAE6DE] line-clamp-2 leading-relaxed">
                        {beat.text}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Right Column: Voice Parameters + Active Player + Generated Clips */}
            <div className="lg:col-span-7 p-5 space-y-5 overflow-y-auto">
              <form onSubmit={handleGenerateClip} className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs font-semibold text-[#F2F0EB]">
                    <SlidersHorizontal className="w-3.5 h-3.5 text-[#E5A93C]" />
                    <span>Configuración del Motor TTS Provisional</span>
                  </div>
                  <span className="text-[11px] font-mono-tech text-[#8D8981] tabular-nums">
                    Duración estimada: {estimatedDuration.toFixed(1)}s · WAV 16 kHz
                  </span>
                </div>

                <div>
                  <label
                    htmlFor="mock-tts-text"
                    className="block text-[11px] text-[#C8C3BA] mb-1.5"
                  >
                    Texto de locución para {selectedBeat?.character || `Escena ${selectedBeat?.sceneNumber || '1'}`}
                  </label>
                  <textarea
                    id="mock-tts-text"
                    rows={3}
                    value={scriptText}
                    onChange={(e) => setScriptText(e.target.value)}
                    placeholder="Edita la frase o beat del guion para probar ritmo y duración..."
                    className="w-full rounded-lg border border-white/15 bg-[#0B0B0E] p-3 text-xs text-[#F2F0EB] leading-relaxed focus:border-[#E5A93C] focus:outline-none resize-none"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label
                      htmlFor="mock-tts-voice"
                      className="block text-[11px] text-[#C8C3BA] mb-1"
                    >
                      Perfil de Voz Sintética
                    </label>
                    <select
                      id="mock-tts-voice"
                      value={voiceId}
                      onChange={(e) => setVoiceId(e.target.value as MockTtsVoiceId)}
                      className="w-full rounded-lg border border-white/15 bg-[#0B0B0E] px-3 py-2 text-xs text-[#F2F0EB] focus:border-[#E5A93C] focus:outline-none"
                    >
                      {MOCK_TTS_VOICES.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.label} ({v.register})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label
                      htmlFor="mock-tts-emotion"
                      className="block text-[11px] text-[#C8C3BA] mb-1"
                    >
                      Intención / Energía
                    </label>
                    <select
                      id="mock-tts-emotion"
                      value={emotion}
                      onChange={(e) => setEmotion(e.target.value as MockTtsEmotion)}
                      className="w-full rounded-lg border border-white/15 bg-[#0B0B0E] px-3 py-2 text-xs text-[#F2F0EB] focus:border-[#E5A93C] focus:outline-none"
                    >
                      {MOCK_TTS_EMOTIONS.map((em) => (
                        <option key={em.id} value={em.id}>
                          {em.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
                  <div>
                    <div className="flex items-center justify-between text-[11px] mb-1">
                      <label htmlFor="mock-tts-rate" className="text-[#C8C3BA]">
                        Velocidad de locución
                      </label>
                      <span className="font-mono-tech text-[#E5A93C] tabular-nums">
                        {rate.toFixed(2)}x
                      </span>
                    </div>
                    <input
                      id="mock-tts-rate"
                      type="range"
                      min="0.7"
                      max="1.45"
                      step="0.05"
                      value={rate}
                      onChange={(e) => setRate(Number(e.target.value))}
                      className="w-full accent-[#E5A93C]"
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between text-[11px] mb-1">
                      <label htmlFor="mock-tts-pitch" className="text-[#C8C3BA]">
                        Tono (semitonos)
                      </label>
                      <span className="font-mono-tech text-[#E5A93C] tabular-nums">
                        {pitchSemitones > 0 ? `+${pitchSemitones}` : pitchSemitones} st
                      </span>
                    </div>
                    <input
                      id="mock-tts-pitch"
                      type="range"
                      min="-6"
                      max="6"
                      step="1"
                      value={pitchSemitones}
                      onChange={(e) => setPitchSemitones(Number(e.target.value))}
                      className="w-full accent-[#E5A93C]"
                    />
                  </div>
                </div>

                {formError && (
                  <p role="alert" className="text-xs text-[#FCA5A5]">
                    {formError}
                  </p>
                )}

                <div className="flex flex-wrap items-center gap-2.5 pt-1">
                  <button
                    type="submit"
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#E5A93C] hover:bg-[#EDA949] text-[#0B0B0E] text-xs font-semibold whitespace-nowrap shrink-0 transition-colors"
                  >
                    <Mic className="w-3.5 h-3.5" />
                    <span>Generar clip provisional (WAV)</span>
                  </button>

                  {speechSynthesisSupported && (
                    <button
                      type="button"
                      onClick={handlePreviewBrowserSpeech}
                      className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-[#38B2AC]/45 bg-[#102625] hover:bg-[#163433] text-[#5EEAD4] text-xs font-medium whitespace-nowrap shrink-0 transition-colors"
                    >
                      <Volume2 className="w-3.5 h-3.5" />
                      <span>
                        {isSpeakingBrowser ? 'Detener lectura oral' : 'Lectura oral rápida'}
                      </span>
                    </button>
                  )}
                </div>
              </form>

              {/* Active Audio Clip Player + Waveform */}
              <div className="pt-4 border-t border-white/10 space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-[#F2F0EB]">
                    Previsualización de Audio Generado
                  </span>
                  {activeClip && (
                    <span className="font-mono-tech text-[11px] text-[#8D8981] tabular-nums">
                      Esc. {activeClip.sceneNumber} · {activeClip.voiceLabel} ·{' '}
                      {activeClip.durationSec.toFixed(1)}s
                    </span>
                  )}
                </div>

                {!activeClip ? (
                  <div className="rounded-lg border border-white/10 bg-[#0D0D12] p-5 text-center text-xs text-[#8D8981]">
                    Pulsa &ldquo;Generar clip provisional (WAV)&rdquo; para crear y escuchar la pista guía de la línea seleccionada.
                  </div>
                ) : (
                  <div className="rounded-lg border border-[#E5A93C]/35 bg-[#0D0D12] p-4 space-y-3">
                    {/* Waveform Visualization */}
                    <div
                      className="h-12 flex items-end gap-[3px] px-1"
                      aria-hidden="true"
                    >
                      {activeClip.waveform.map((amp, idx) => {
                        const barProgress = idx / activeClip.waveform.length;
                        const activeBar = barProgress <= playbackProgress;
                        return (
                          <div
                            key={idx}
                            style={{ height: `${Math.max(14, Math.round(amp * 100))}%` }}
                            className={`flex-1 rounded-t-sm transition-colors ${
                              activeBar ? 'bg-[#E5A93C]' : 'bg-white/20'
                            }`}
                          />
                        );
                      })}
                    </div>

                    <audio
                      ref={audioRef}
                      controls
                      src={activeClip.audioUrl}
                      onPlay={() => setIsPlayingAudio(true)}
                      onPause={() => setIsPlayingAudio(false)}
                      onEnded={() => {
                        setIsPlayingAudio(false);
                        setPlaybackProgress(0);
                      }}
                      onTimeUpdate={(e) => {
                        const el = e.currentTarget;
                        if (el.duration > 0) {
                          setPlaybackProgress(el.currentTime / el.duration);
                        }
                      }}
                      className="w-full h-9"
                    />

                    <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                      <span className="text-[#C8C3BA] italic truncate max-w-md">
                        &ldquo;{activeClip.text}&rdquo;
                      </span>
                      <button
                        type="button"
                        onClick={() => handleDownloadClip(activeClip)}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-white/15 bg-[#14141B] hover:bg-[#1E1E29] text-[#F2F0EB] font-medium whitespace-nowrap shrink-0"
                      >
                        <Download className="w-3 h-3 text-[#E5A93C]" />
                        <span>Descargar WAV</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Session Queue of Generated Clips */}
              {clips.length > 0 && (
                <div className="pt-4 border-t border-white/10 space-y-2.5">
                  <div className="text-xs font-semibold text-[#C8C3BA]">
                    Clips provisionales generados ({clips.length})
                  </div>
                  <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                    {clips.map((clip) => {
                      const isCurrent = activeClip?.id === clip.id;
                      return (
                        <div
                          key={clip.id}
                          className={`rounded-lg border px-3 py-2.5 flex items-center justify-between gap-3 ${
                            isCurrent
                              ? 'border-[#E5A93C]/55 bg-[#1B1810]'
                              : 'border-white/10 bg-[#131318]'
                          }`}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="text-[11px] font-mono-tech text-[#E5A93C] truncate tabular-nums">
                              Esc. {clip.sceneNumber} ·{' '}
                              {clip.character || BEAT_TYPE_LABELS[clip.beatType]} ·{' '}
                              {clip.voiceLabel} · {clip.durationSec.toFixed(1)}s
                            </div>
                            <p className="text-xs text-[#D4CFC7] truncate">{clip.text}</p>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              onClick={() => handleToggleClipPlayback(clip)}
                              aria-label={
                                isCurrent && isPlayingAudio
                                  ? `Pausar clip ${clip.id}`
                                  : `Reproducir clip ${clip.id}`
                              }
                              className="p-2 rounded-md border border-white/12 bg-[#0B0B0E] hover:border-[#E5A93C]/50 text-[#E5A93C]"
                            >
                              {isCurrent && isPlayingAudio ? (
                                <Pause className="w-3.5 h-3.5" />
                              ) : (
                                <Play className="w-3.5 h-3.5" />
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDownloadClip(clip)}
                              aria-label={`Descargar clip ${clip.id}`}
                              className="p-2 rounded-md border border-white/12 bg-[#0B0B0E] hover:border-white/30 text-[#C8C3BA]"
                            >
                              <Download className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteClip(clip.id)}
                              aria-label={`Eliminar clip ${clip.id}`}
                              className="p-2 rounded-md border border-white/12 bg-[#0B0B0E] hover:border-[#EF4444]/40 text-[#8D8981] hover:text-[#FCA5A5]"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
