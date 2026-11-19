import { useEffect, useRef, useState } from 'react';
import {
  Check,
  Clapperboard,
  Copy,
  Film,
  ImagePlus,
  Mic,
  Music,
  Pause,
  Play,
  RotateCcw,
  Sparkles,
  Video,
  X,
} from 'lucide-react';
import type {
  ProductionProject,
  ProjectTrailer,
  ResolutionTier,
  StudioSettings,
  TrailerBeat,
  VoicePreset,
} from '../types/studio';
import {
  RESOLUTION_OPTIONS,
  TRAILER_TONE_OPTIONS,
  VOICE_PRESET_OPTIONS,
  formatTimecodeSec,
  validateTrailerReadiness,
} from '../utils/productionPipeline';

interface TrailerViewProps {
  userId: string;
  project: ProductionProject;
  studioSettings: StudioSettings;
  onProjectUpdated: (project: ProductionProject) => Promise<void>;
  onGoToVision: () => void;
}

export function TrailerView({
  userId,
  project,
  studioSettings,
  onProjectUpdated,
  onGoToVision,
}: TrailerViewProps) {
  const readiness = validateTrailerReadiness(project);
  const trailer: ProjectTrailer | undefined = project.trailer;

  const [tone, setTone] = useState<string>(trailer?.tone || TRAILER_TONE_OPTIONS[0]);
  const [targetResolution, setTargetResolution] = useState<ResolutionTier>(
    trailer?.targetResolution || studioSettings.defaultResolution
  );
  const [voicePreset, setVoicePreset] = useState<VoicePreset>(
    trailer?.voicePreset || studioSettings.defaultVoicePreset
  );

  const [generatingTrailer, setGeneratingTrailer] = useState(false);
  const [generatingVoiceOver, setGeneratingVoiceOver] = useState(false);
  const [generatingMusic, setGeneratingMusic] = useState(false);
  const [busyBeatImgId, setBusyBeatImgId] = useState<string | null>(null);
  const [busyBeatVidId, setBusyBeatVidId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copiedDossier, setCopiedDossier] = useState(false);

  // 30s Screening Room playback state
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTimeSec, setCurrentTimeSec] = useState(0);
  const voAudioRef = useRef<HTMLAudioElement | null>(null);
  const musicAudioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    setIsPlaying(false);
    setCurrentTimeSec(0);
  }, [project.id, trailer?.id]);

  useEffect(() => {
    if (!isPlaying) return;
    const startWall = performance.now() - currentTimeSec * 1000;
    const interval = window.setInterval(() => {
      const elapsed = (performance.now() - startWall) / 1000;
      if (elapsed >= 30) {
        setCurrentTimeSec(30);
        setIsPlaying(false);
        voAudioRef.current?.pause();
        musicAudioRef.current?.pause();
      } else {
        setCurrentTimeSec(elapsed);
      }
    }, 100);
    return () => window.clearInterval(interval);
  }, [isPlaying]);

  function handleTogglePlayback() {
    if (!trailer) return;
    if (isPlaying) {
      setIsPlaying(false);
      voAudioRef.current?.pause();
      musicAudioRef.current?.pause();
      return;
    }

    const startAt = currentTimeSec >= 30 ? 0 : currentTimeSec;
    if (currentTimeSec >= 30) {
      setCurrentTimeSec(0);
    }

    if (voAudioRef.current) {
      voAudioRef.current.currentTime = Math.min(
        startAt,
        voAudioRef.current.duration || startAt
      );
      void voAudioRef.current.play().catch(() => {});
    }
    if (musicAudioRef.current) {
      musicAudioRef.current.currentTime = Math.min(
        startAt,
        musicAudioRef.current.duration || startAt
      );
      musicAudioRef.current.volume = 0.45;
      void musicAudioRef.current.play().catch(() => {});
    }
    setIsPlaying(true);
  }

  function handleResetPlayback() {
    setIsPlaying(false);
    setCurrentTimeSec(0);
    if (voAudioRef.current) {
      voAudioRef.current.pause();
      voAudioRef.current.currentTime = 0;
    }
    if (musicAudioRef.current) {
      musicAudioRef.current.pause();
      musicAudioRef.current.currentTime = 0;
    }
  }

  async function handleGenerateTrailer() {
    setGeneratingTrailer(true);
    setErrorMsg(null);
    handleResetPlayback();
    try {
      const res = await fetch('/api/generate-trailer', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': userId,
        },
        body: JSON.stringify({
          projectId: project.id,
          tone,
          targetResolution,
          voicePreset,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'No se pudo diseñar el tráiler de 30 segundos.');
      }
      if (data.project) {
        await onProjectUpdated(data.project as ProductionProject);
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Error generando el tráiler cinematográfico.'
      );
    } finally {
      setGeneratingTrailer(false);
    }
  }

  async function handleGenerateTrailerVoiceOver() {
    if (!trailer) return;
    setGeneratingVoiceOver(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/generate-voiceover', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': userId,
        },
        body: JSON.stringify({
          projectId: project.id,
          target: 'trailer',
          text: trailer.voiceOverScript,
          voicePreset: trailer.voicePreset,
          deliveryDirection: trailer.voiceDirection,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'No se pudo sintetizar la voz en off del tráiler.');
      }
      if (data.project) {
        await onProjectUpdated(data.project as ProductionProject);
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Error sintetizando la voz en off del tráiler.'
      );
    } finally {
      setGeneratingVoiceOver(false);
    }
  }

  async function handleGenerateTrailerMusic() {
    if (!trailer) return;
    setGeneratingMusic(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/generate-trailer-music', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': userId,
        },
        body: JSON.stringify({
          projectId: project.id,
          musicPrompt: trailer.musicPrompt,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'No se pudo componer la música de 30s con Lyria.');
      }
      if (data.project) {
        await onProjectUpdated(data.project as ProductionProject);
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Error generando música con Lyria.'
      );
    } finally {
      setGeneratingMusic(false);
    }
  }

  async function handleGenerateBeatImage(beat: TrailerBeat) {
    if (!trailer) return;
    setBusyBeatImgId(beat.id);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/generate-image', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': userId,
        },
        body: JSON.stringify({
          projectId: project.id,
          trailerBeatId: beat.id,
          prompt: beat.hyperRealisticPrompt,
          aspectRatio: '16:9',
          resolution: trailer.targetResolution,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'No se pudo generar el fotograma del tráiler.');
      }
      if (data.project) {
        await onProjectUpdated(data.project as ProductionProject);
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Error generando fotograma del tráiler.'
      );
    } finally {
      setBusyBeatImgId(null);
    }
  }

  async function handleGenerateBeatVideo(beat: TrailerBeat) {
    if (!trailer) return;
    setBusyBeatVidId(beat.id);
    setErrorMsg(null);
    try {
      const clipSec = Math.min(10, Math.max(3, Math.round(beat.durationSec)));
      const res = await fetch('/api/generate-video', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': userId,
        },
        body: JSON.stringify({
          projectId: project.id,
          trailerBeatId: beat.id,
          prompt: `${beat.motionPrompt} (${beat.hyperRealisticPrompt})`,
          aspectRatio: '16:9',
          duration: `${clipSec}s`,
          imageUrl: beat.imageUrl,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'No se pudo generar el clip con Omni Flash.');
      }
      if (data.project) {
        await onProjectUpdated(data.project as ProductionProject);
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Error generando clip de tráiler con Omni Flash.'
      );
    } finally {
      setBusyBeatVidId(null);
    }
  }

  async function handleCopyTrailerDossier() {
    if (!trailer) return;
    const lines = [
      `${trailer.title} (${trailer.totalDurationSec}s · ${trailer.targetResolution})`,
      `Tagline: ${trailer.tagline}`,
      `Tono: ${trailer.tone} · Voz: ${trailer.voicePreset}`,
      '',
      'VOZ EN OFF COMPLETA:',
      trailer.voiceOverScript,
      '',
      `PARTITURA MUSICAL (${trailer.tempoBpm} BPM): ${trailer.musicPrompt}`,
      '',
      'MONTAJE BEATS (00:00 - 00:30):',
      ...trailer.beats.map(
        (b) =>
          `[${formatTimecodeSec(b.startSec)}-${formatTimecodeSec(b.endSec)}] ${b.sourceSequenceTitle} | Rótulo: ${b.onScreenTitleCard} | VO: "${b.voiceOverLine}" | SFX: ${b.sfxCue} | Prompt: ${b.hyperRealisticPrompt}`
      ),
    ];
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setCopiedDossier(true);
      setTimeout(() => setCopiedDossier(false), 1600);
    } catch {
      // Ignore clipboard failure
    }
  }

  const activeBeat: TrailerBeat | null =
    trailer?.beats.find(
      (b) => currentTimeSec >= b.startSec && currentTimeSec < b.endSec
    ) ||
    trailer?.beats[trailer.beats.length - 1] ||
    null;

  return (
    <div className="space-y-5 max-w-6xl">
      {/* Header & Controls */}
      <section aria-labelledby="trailer-heading" className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Clapperboard className="w-4 h-4 text-[#E5A93C]" />
              <h2 id="trailer-heading" className="font-display text-xl font-semibold text-[#F2F0EB]">
                Agente Director de Tráiler Cinematográfico (30s)
              </h2>
            </div>
            <p className="text-xs text-[#8D8981] mt-1">
              Ensambla un teaser oficial de 30 segundos cruzando la Biblia de Continuidad y únicamente las secuencias ya aprobadas en Versión Final.
            </p>
          </div>

          <div className="text-xs font-mono-tech text-[#8D8981] tabular-nums">
            {readiness.approvedSequences.length}{' '}
            {readiness.approvedSequences.length === 1
              ? 'escena aprobada'
              : 'escenas aprobadas'}
          </div>
        </div>

        {/* Readiness Banner or Controls */}
        {!readiness.ready ? (
          <div className="p-6 rounded-xl border border-[#E5A93C]/30 bg-[#18150E] space-y-3">
            <div className="font-display text-base font-semibold text-[#F2F0EB]">
              Se requiere al menos 1 secuencia aprobada (Versión Final)
            </div>
            <p className="text-xs text-[#D4CFC7] leading-relaxed max-w-2xl">
              {readiness.reason} Una vez aprobada en el encabezado superior («Aprobar Versión Final»), el Agente Director tomará su guion, óptica, luz, diseño sonoro y la Biblia de Continuidad para dirigir el tráiler de 30 segundos.
            </p>
            <button
              type="button"
              onClick={onGoToVision}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#E5A93C] hover:bg-[#EDA949] text-[#0B0B0E] text-xs font-semibold"
            >
              <span>Volver a Dirección de secuencia</span>
            </button>
          </div>
        ) : (
          <div className="p-4 rounded-xl border border-white/10 bg-[#131318] space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div>
                <div className="font-medium text-[#C8C3BA] mb-1">
                  Fuentes Aprobadas Conectadas ({readiness.approvedSequences.length})
                </div>
                <p className="text-[#9A968E] leading-relaxed">
                  {readiness.approvedSequences.map((s) => s.title).join(' · ')}
                </p>
              </div>
              <div>
                <div className="font-medium text-[#C8C3BA] mb-1">
                  Biblia de Continuidad Activa
                </div>
                <p className="text-[#9A968E] leading-relaxed line-clamp-2">
                  {project.continuityBible || 'Reglas base definidas en las escenas finales.'}
                </p>
              </div>
            </div>

            <div className="pt-3 border-t border-white/10 grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
              <div>
                <label
                  htmlFor="trailer-tone-select"
                  className="block text-[11px] font-medium text-[#C8C3BA] mb-1"
                >
                  Tono de Montaje
                </label>
                <select
                  id="trailer-tone-select"
                  value={tone}
                  onChange={(e) => setTone(e.target.value)}
                  className="w-full rounded-lg border border-white/12 bg-[#0B0B0E] px-2.5 py-2 text-xs text-[#F2F0EB] focus:border-[#E5A93C] focus:outline-none"
                >
                  {TRAILER_TONE_OPTIONS.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="trailer-resolution-select"
                  className="block text-[11px] font-medium text-[#C8C3BA] mb-1"
                >
                  Ultra Definición
                </label>
                <select
                  id="trailer-resolution-select"
                  value={targetResolution}
                  onChange={(e) => setTargetResolution(e.target.value as ResolutionTier)}
                  className="w-full rounded-lg border border-white/12 bg-[#0B0B0E] px-2.5 py-2 text-xs font-mono-tech text-[#F2F0EB] focus:border-[#E5A93C] focus:outline-none"
                >
                  {RESOLUTION_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="trailer-voice-select"
                  className="block text-[11px] font-medium text-[#C8C3BA] mb-1"
                >
                  Voz en Off Principal
                </label>
                <select
                  id="trailer-voice-select"
                  value={voicePreset}
                  onChange={(e) => setVoicePreset(e.target.value as VoicePreset)}
                  className="w-full rounded-lg border border-white/12 bg-[#0B0B0E] px-2.5 py-2 text-xs text-[#F2F0EB] focus:border-[#E5A93C] focus:outline-none"
                >
                  {VOICE_PRESET_OPTIONS.map((v) => (
                    <option key={v.value} value={v.value}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </div>

              <button
                type="button"
                onClick={handleGenerateTrailer}
                disabled={generatingTrailer}
                className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-[#E5A93C] hover:bg-[#EDA949] disabled:opacity-60 text-[#0B0B0E] text-xs font-semibold whitespace-nowrap"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>
                  {generatingTrailer
                    ? 'Dirigiendo 30s...'
                    : trailer
                      ? 'Regenerar Tráiler 30s'
                      : 'Generar Tráiler de 30s'}
                </span>
              </button>
            </div>
          </div>
        )}

        {errorMsg && (
          <div
            role="alert"
            className="rounded-lg border border-[#EF4444]/35 bg-[#3B1515]/50 px-4 py-3 text-xs text-[#FCA5A5] flex items-center justify-between gap-3"
          >
            <span>{errorMsg}</span>
            <button
              type="button"
              onClick={() => setErrorMsg(null)}
              aria-label="Cerrar error de tráiler"
              className="p-1 rounded hover:bg-white/10"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </section>

      {/* Screening Room & Master Controls when Trailer Exists */}
      {trailer && (
        <>
          <section
            aria-label="Sala de proyección de tráiler de 30 segundos"
            className="rounded-xl border border-white/10 bg-[#101015] overflow-hidden"
          >
            <div className="px-5 py-3.5 border-b border-white/10 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-display text-base font-semibold text-[#F2F0EB]">
                  {trailer.title}
                </h3>
                <p className="text-xs text-[#E5A93C] italic">{trailer.tagline}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs font-mono-tech text-[#8D8981] tabular-nums">
                <span>{trailer.tone}</span>
                <span aria-hidden="true">·</span>
                <span>{trailer.targetResolution}</span>
                <span aria-hidden="true">·</span>
                <span>{trailer.tempoBpm} BPM</span>
              </div>
            </div>

            {/* Active 16:9 Cinema Stage */}
            <div className="relative aspect-[16/9] max-h-[340px] w-full bg-[#070709] border-b border-white/10 overflow-hidden">
              {activeBeat?.videoUrl ? (
                <video
                  key={activeBeat.videoUrl}
                  src={activeBeat.videoUrl}
                  autoPlay={isPlaying}
                  loop
                  muted
                  playsInline
                  className="w-full h-full object-cover"
                />
              ) : activeBeat?.imageUrl ? (
                <img
                  src={activeBeat.imageUrl}
                  alt={activeBeat.onScreenTitleCard || activeBeat.sourceSequenceTitle}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center p-8 text-center bg-gradient-to-br from-[#161822] via-[#0B0B0F] to-[#1E170E]">
                  <Film className="w-9 h-9 text-[#E5A93C] mb-3" />
                  <div className="font-display text-lg font-semibold text-[#F2F0EB] max-w-xl">
                    {activeBeat?.sourceSequenceTitle || trailer.title}
                  </div>
                  <p className="mt-2 text-xs text-[#A7A299] max-w-xl leading-relaxed">
                    {activeBeat?.visualDescription}
                  </p>
                </div>
              )}

              {/* Bottom Contrast Scrim for Subtitles & Title Card */}
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent p-5 sm:p-6 pointer-events-none">
                <div className="max-w-3xl space-y-1.5">
                  {activeBeat?.onScreenTitleCard && (
                    <div className="font-display text-sm sm:text-base font-bold tracking-wider uppercase text-[#E5A93C]">
                      {activeBeat.onScreenTitleCard}
                    </div>
                  )}
                  {activeBeat?.voiceOverLine && (
                    <p className="text-sm sm:text-base text-[#F2F0EB] font-medium leading-snug">
                      &ldquo;{activeBeat.voiceOverLine}&rdquo;
                    </p>
                  )}
                  {activeBeat && (
                    <div className="text-[11px] font-mono-tech text-[#9A968E] tabular-nums">
                      Beat {activeBeat.beatNumber}/6 · {formatTimecodeSec(activeBeat.startSec)}–
                      {formatTimecodeSec(activeBeat.endSec)} · {activeBeat.editingTransition} ·{' '}
                      {activeBeat.sfxCue}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Playback Transport + Audio Tracks */}
            <div className="p-4 sm:p-5 space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={handleTogglePlayback}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#E5A93C] hover:bg-[#EDA949] text-[#0B0B0E] text-xs font-semibold whitespace-nowrap shrink-0"
                >
                  {isPlaying ? (
                    <>
                      <Pause className="w-3.5 h-3.5" />
                      <span>Pausar 30s</span>
                    </>
                  ) : (
                    <>
                      <Play className="w-3.5 h-3.5" />
                      <span>Reproducir Tráiler</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={handleResetPlayback}
                  aria-label="Reiniciar tráiler a 00:00"
                  className="p-2 rounded-lg border border-white/12 bg-[#16161E] hover:bg-[#1E1E28] text-[#D4CFC7]"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>

                <div className="flex-1 min-w-[180px] flex items-center gap-3">
                  <span className="text-xs font-mono-tech text-[#E5A93C] tabular-nums">
                    {formatTimecodeSec(currentTimeSec)}
                  </span>
                  <input
                    type="range"
                    aria-label="Línea de tiempo del tráiler (0 a 30 segundos)"
                    min={0}
                    max={30}
                    step={0.5}
                    value={currentTimeSec}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      setCurrentTimeSec(val);
                      if (voAudioRef.current) voAudioRef.current.currentTime = val;
                      if (musicAudioRef.current) musicAudioRef.current.currentTime = val;
                    }}
                    className="w-full accent-[#E5A93C]"
                  />
                  <span className="text-xs font-mono-tech text-[#8D8981] tabular-nums">
                    00:30
                  </span>
                </div>

                <button
                  type="button"
                  onClick={handleCopyTrailerDossier}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-white/12 bg-[#16161E] hover:bg-[#1E1E28] text-xs font-medium text-[#E6E2DA] whitespace-nowrap"
                >
                  {copiedDossier ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-[#22C55E]" />
                      <span>Dossier copiado</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5 text-[#E5A93C]" />
                      <span>Copiar dossier 30s</span>
                    </>
                  )}
                </button>
              </div>

              {/* Real Gemini TTS Voice-Over & Lyria 30s Score */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-3 border-t border-white/10">
                <div className="p-3.5 rounded-xl border border-white/10 bg-[#14141B] space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-[#F2F0EB]">
                      <Mic className="w-3.5 h-3.5 text-[#E5A93C]" />
                      <span>Voz en Off Realista ({trailer.voicePreset})</span>
                    </div>
                    <button
                      type="button"
                      onClick={handleGenerateTrailerVoiceOver}
                      disabled={generatingVoiceOver}
                      className="px-2.5 py-1.5 rounded-md border border-[#E5A93C]/45 bg-[#1B1812] hover:bg-[#272116] disabled:opacity-60 text-[11px] font-medium text-[#E5A93C] whitespace-nowrap"
                    >
                      {generatingVoiceOver
                        ? 'Sintetizando WAV...'
                        : trailer.voiceOverAudioUrl
                          ? 'Regenerar Voz WAV'
                          : 'Generar Voz en Off (WAV)'}
                    </button>
                  </div>
                  <p className="text-xs text-[#CFCAC0] leading-relaxed italic">
                    &ldquo;{trailer.voiceOverScript}&rdquo;
                  </p>
                  {trailer.voiceOverAudioUrl && (
                    <audio
                      ref={voAudioRef}
                      controls
                      src={trailer.voiceOverAudioUrl}
                      className="w-full h-8"
                    />
                  )}
                </div>

                <div className="p-3.5 rounded-xl border border-white/10 bg-[#14141B] space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-[#F2F0EB]">
                      <Music className="w-3.5 h-3.5 text-[#38B2AC]" />
                      <span>Partitura 30s (Lyria) · {trailer.tempoBpm} BPM</span>
                    </div>
                    <button
                      type="button"
                      onClick={handleGenerateTrailerMusic}
                      disabled={generatingMusic}
                      className="px-2.5 py-1.5 rounded-md border border-[#38B2AC]/45 bg-[#102625] hover:bg-[#163433] disabled:opacity-60 text-[11px] font-medium text-[#5EEAD4] whitespace-nowrap"
                    >
                      {generatingMusic
                        ? 'Componiendo MP3...'
                        : trailer.musicAudioUrl
                          ? 'Regenerar Música 30s'
                          : 'Generar Música 30s (Lyria)'}
                    </button>
                  </div>
                  <p className="text-xs text-[#A7A299] leading-relaxed">
                    {trailer.musicPrompt}
                  </p>
                  {trailer.musicAudioUrl && (
                    <audio
                      ref={musicAudioRef}
                      controls
                      src={trailer.musicAudioUrl}
                      className="w-full h-8"
                    />
                  )}
                </div>
              </div>
            </div>
          </section>

          {/* 6-Beat Breakdown Cards */}
          <section aria-labelledby="trailer-beats-heading" className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h3 id="trailer-beats-heading" className="font-display text-sm font-semibold text-[#E5A93C]">
                Desglose de Montaje Plano a Plano (00:00 – 00:30)
              </h3>
              <span className="text-xs font-mono-tech text-[#8D8981] tabular-nums">
                {trailer.beats.length} cortes · {trailer.targetResolution}
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {trailer.beats.map((beat) => {
                const isActive = activeBeat?.id === beat.id;
                const busyImg = busyBeatImgId === beat.id;
                const busyVid = busyBeatVidId === beat.id;
                return (
                  <article
                    key={beat.id}
                    className={`rounded-xl border bg-[#131318] overflow-hidden flex flex-col justify-between transition-colors ${
                      isActive ? 'border-[#E5A93C]' : 'border-white/10'
                    }`}
                  >
                    <div className="aspect-video bg-[#08080B] border-b border-white/10 relative overflow-hidden">
                      {beat.videoUrl ? (
                        <video
                          src={beat.videoUrl}
                          controls
                          loop
                          muted
                          playsInline
                          className="w-full h-full object-cover"
                        />
                      ) : beat.imageUrl ? (
                        <img
                          src={beat.imageUrl}
                          alt={beat.onScreenTitleCard || beat.sourceSequenceTitle}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center p-4 text-center bg-gradient-to-br from-[#161720] to-[#19150E]">
                          <Film className="w-6 h-6 text-[#E5A93C] mb-1.5" />
                          <div className="text-xs font-semibold text-[#F2F0EB]">
                            {beat.onScreenTitleCard || `Beat ${beat.beatNumber}`}
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="p-3.5 space-y-2.5 flex-1 flex flex-col justify-between">
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between gap-2 text-[11px] font-mono-tech tabular-nums">
                          <button
                            type="button"
                            onClick={() => setCurrentTimeSec(beat.startSec)}
                            className="text-[#E5A93C] hover:underline font-semibold"
                          >
                            {formatTimecodeSec(beat.startSec)}–{formatTimecodeSec(beat.endSec)} ({beat.durationSec}s)
                          </button>
                          <span className="text-[#8D8981] truncate">
                            {beat.editingTransition}
                          </span>
                        </div>

                        <div className="text-xs font-semibold text-[#F2F0EB] truncate">
                          {beat.sourceSequenceTitle}
                        </div>

                        {beat.voiceOverLine && (
                          <p className="text-xs text-[#CFCAC0] italic">
                            &ldquo;{beat.voiceOverLine}&rdquo;
                          </p>
                        )}

                        <p className="text-[11px] text-[#8D8981] line-clamp-2">
                          {beat.visualDescription}
                        </p>

                        <div className="text-[10px] font-mono-tech text-[#5EEAD4]">
                          SFX: {beat.sfxCue}
                        </div>
                      </div>

                      <div className="pt-2 border-t border-white/5 flex gap-2">
                        <button
                          type="button"
                          onClick={() => handleGenerateBeatImage(beat)}
                          disabled={busyImg || busyVid}
                          className="flex-1 inline-flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-md border border-[#E5A93C]/40 bg-[#1B1812] hover:bg-[#272116] disabled:opacity-60 text-[11px] font-medium text-[#F2F0EB]"
                        >
                          <ImagePlus className="w-3 h-3 text-[#E5A93C]" />
                          <span>{busyImg ? 'Nano...' : `Imagen ${trailer.targetResolution}`}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleGenerateBeatVideo(beat)}
                          disabled={busyImg || busyVid}
                          className="flex-1 inline-flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-md border border-white/15 bg-[#181822] hover:bg-[#222230] disabled:opacity-60 text-[11px] font-medium text-[#F2F0EB]"
                        >
                          <Video className="w-3 h-3 text-[#38B2AC]" />
                          <span>{busyVid ? 'Omni...' : 'Clip Omni'}</span>
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
