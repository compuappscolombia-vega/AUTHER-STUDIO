import { useState } from 'react';
import { Volume2, Camera, AudioLines, Mic } from 'lucide-react';
import type {
  ProductionProject,
  ProductionSequence,
  VoiceOverTrack,
} from '../types/studio';
import { parseAspectRatio } from '../utils/studioLogic';
import { parseApiResponse } from '../utils/apiClient';

interface ShotsAndSoundViewProps {
  userId: string;
  projectId: string;
  sequence: ProductionSequence;
  onEnsureProjectSynced: () => Promise<void>;
  onProjectMediaUpdated: (project: ProductionProject) => Promise<void>;
  onOpenVoiceoverModal?: (beatKey?: string) => void;
}

export function ShotsAndSoundView({
  userId,
  projectId,
  sequence,
  onEnsureProjectSynced,
  onProjectMediaUpdated,
  onOpenVoiceoverModal,
}: ShotsAndSoundViewProps) {
  const [selectedShotIdx, setSelectedShotIdx] = useState(0);
  const [generatingVoId, setGeneratingVoId] = useState<string | null>(null);
  const [voError, setVoError] = useState<string | null>(null);

  const shotList = sequence.shotList || [];
  const soundDesign = sequence.soundDesign || {
    atmosLayers: [],
    subBassCue: 'No especificado',
    foleyDetails: [],
    silenceBeats: 'No especificado',
    musicalScore: 'No especificado',
    tempoBpm: 80,
  };

  async function handleGenerateVoiceOver(track: VoiceOverTrack) {
    setGeneratingVoId(track.id);
    setVoError(null);
    try {
      await onEnsureProjectSynced();
      const res = await fetch('/api/generate-voiceover', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': userId,
        },
        body: JSON.stringify({
          projectId,
          sequenceId: sequence.id,
          trackId: track.id,
          text: track.text,
          voicePreset: track.voicePreset,
          deliveryDirection: track.deliveryDirection,
        }),
      });
      const data = await parseApiResponse<{ project?: ProductionProject }>(
        res,
        'No se pudo sintetizar la voz en off'
      );
      if (data.project) {
        await onProjectMediaUpdated(data.project);
      }
    } catch (err) {
      setVoError(
        err instanceof Error ? err.message : 'Error generando voz en off realista.'
      );
    } finally {
      setGeneratingVoId(null);
    }
  }

  const safeIdx =
    selectedShotIdx >= 0 && selectedShotIdx < shotList.length
      ? selectedShotIdx
      : 0;
  const activeShot = shotList[safeIdx];
  const ratioValue = parseAspectRatio(sequence.aspectRatio);

  // Compute inner framing box inside a 400x240 SVG viewport
  const svgW = 400;
  const svgH = 240;
  const maxBoxW = 352;
  const maxBoxH = 200;
  let frameW = maxBoxW;
  let frameH = frameW / ratioValue;
  if (frameH > maxBoxH) {
    frameH = maxBoxH;
    frameW = frameH * ratioValue;
  }
  const frameX = (svgW - frameW) / 2;
  const frameY = (svgH - frameH) / 2;

  return (
    <div className="space-y-8 max-w-6xl">
      {/* Interactive Framing Monitor + Shot List */}
      <section aria-labelledby="shots-heading" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Camera className="w-4 h-4 text-[#E5A93C]" />
            <h2 id="shots-heading" className="font-display text-lg font-semibold text-[#F2F0EB]">
              Planos de Cámara y Encuadre
            </h2>
          </div>
          <div className="text-xs font-mono-tech text-[#8D8981] tabular-nums">
            {shotList.length} planos · Relación {sequence.aspectRatio}
          </div>
        </div>

        <div className="grid grid-cols-1 2xl:grid-cols-12 gap-5 items-stretch">
          {/* Interactive Optical Viewfinder */}
          <div className="2xl:col-span-5 rounded-xl border border-white/10 bg-[#111116] p-4 flex flex-col justify-between">
            <div className="flex items-center justify-between text-xs font-mono-tech text-[#9A968E] mb-3">
              <span>Visor Óptico</span>
              <span>
                {activeShot ? `${activeShot.shotNumber} · ${activeShot.lensMm}` : 'Sin plano'}
              </span>
            </div>

            <div className="rounded-lg bg-[#07070A] border border-white/10 overflow-hidden max-w-md">
              <svg
                viewBox={`0 0 ${svgW} ${svgH}`}
                className="w-full h-auto block"
                role="img"
                aria-label={
                  activeShot
                    ? `Diagrama de encuadre para plano ${activeShot.shotNumber} (${sequence.aspectRatio})`
                    : 'Visor de encuadre cinematográfico'
                }
              >
                <rect x="0" y="0" width={svgW} height={svgH} fill="#07070A" />
                <rect
                  x={frameX}
                  y={frameY}
                  width={frameW}
                  height={frameH}
                  fill="#12141B"
                  stroke="#E5A93C"
                  strokeWidth="1.2"
                  strokeOpacity="0.85"
                />
                <line
                  x1={frameX + frameW / 3}
                  y1={frameY}
                  x2={frameX + frameW / 3}
                  y2={frameY + frameH}
                  stroke="#FFFFFF"
                  strokeOpacity="0.14"
                  strokeDasharray="3 3"
                />
                <line
                  x1={frameX + (frameW * 2) / 3}
                  y1={frameY}
                  x2={frameX + (frameW * 2) / 3}
                  y2={frameY + frameH}
                  stroke="#FFFFFF"
                  strokeOpacity="0.14"
                  strokeDasharray="3 3"
                />
                <line
                  x1={frameX}
                  y1={frameY + frameH / 3}
                  x2={frameX + frameW}
                  y2={frameY + frameH / 3}
                  stroke="#FFFFFF"
                  strokeOpacity="0.14"
                  strokeDasharray="3 3"
                />
                <line
                  x1={frameX}
                  y1={frameY + (frameH * 2) / 3}
                  x2={frameX + frameW}
                  y2={frameY + (frameH * 2) / 3}
                  stroke="#FFFFFF"
                  strokeOpacity="0.14"
                  strokeDasharray="3 3"
                />
                <line
                  x1={svgW / 2 - 10}
                  y1={svgH / 2}
                  x2={svgW / 2 + 10}
                  y2={svgH / 2}
                  stroke="#E5A93C"
                  strokeOpacity="0.6"
                  strokeWidth="1"
                />
                <line
                  x1={svgW / 2}
                  y1={svgH / 2 - 10}
                  x2={svgW / 2}
                  y2={svgH / 2 + 10}
                  stroke="#E5A93C"
                  strokeOpacity="0.6"
                  strokeWidth="1"
                />
                <text
                  x={frameX + 8}
                  y={frameY + 16}
                  fill="#E5A93C"
                  fontSize="10"
                  fontFamily="JetBrains Mono, monospace"
                >
                  {activeShot ? `${activeShot.shotType} · ${activeShot.lensMm}` : sequence.aspectRatio}
                </text>
                <text
                  x={frameX + frameW - 8}
                  y={frameY + frameH - 8}
                  textAnchor="end"
                  fill="#9A968E"
                  fontSize="9"
                  fontFamily="JetBrains Mono, monospace"
                >
                  {sequence.aspectRatio}
                </text>
              </svg>
            </div>

            {activeShot && (
              <div className="mt-4 space-y-2 text-xs">
                <div>
                  <span className="text-[#8D8981]">Movimiento: </span>
                  <span className="text-[#F2F0EB] font-medium">{activeShot.movement}</span>
                </div>
                <div>
                  <span className="text-[#8D8981]">Composición: </span>
                  <span className="text-[#D4CFC7]">{activeShot.framingNote}</span>
                </div>
                <div>
                  <span className="text-[#8D8981]">Intención psicológica: </span>
                  <span className="text-[#E5A93C]">{activeShot.psychologicalIntent}</span>
                </div>
              </div>
            )}
          </div>

          {/* High-Density Shot Table */}
          <div className="2xl:col-span-7 rounded-xl border border-white/10 bg-[#131318] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-white/10 text-[11px] font-medium text-[#8D8981] bg-[#0F0F14]">
                    <th className="py-2.5 px-3 whitespace-nowrap">Plano</th>
                    <th className="py-2.5 px-3 whitespace-nowrap">Tipo</th>
                    <th className="py-2.5 px-3 whitespace-nowrap">Óptica</th>
                    <th className="py-2.5 px-3">Movimiento</th>
                    <th className="py-2.5 px-3 text-right whitespace-nowrap">Duración</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 text-xs">
                  {shotList.map((shot, idx) => {
                    const selected = idx === safeIdx;
                    return (
                      <tr
                        key={`${shot.shotNumber}-${idx}`}
                        onClick={() => setSelectedShotIdx(idx)}
                        className={`cursor-pointer transition-colors ${
                          selected
                            ? 'bg-[#E5A93C]/12 text-[#F2F0EB]'
                            : 'hover:bg-white/[0.03] text-[#D4CFC7]'
                        }`}
                      >
                        <td className="py-2.5 px-3 font-mono-tech font-semibold text-[#E5A93C] whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => setSelectedShotIdx(idx)}
                            className="text-left focus-visible:outline-2 focus-visible:outline-[#E5A93C]"
                          >
                            {shot.shotNumber}
                          </button>
                        </td>
                        <td className="py-2.5 px-3 font-mono-tech whitespace-nowrap">
                          {shot.shotType}
                        </td>
                        <td className="py-2.5 px-3 font-mono-tech whitespace-nowrap">
                          {shot.lensMm}
                        </td>
                        <td className="py-2.5 px-3 max-w-[200px] truncate">{shot.movement}</td>
                        <td className="py-2.5 px-3 text-right font-mono-tech whitespace-nowrap tabular-nums">
                          {shot.durationSec}s
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

      {/* Sound Design, Foley & Musical Score */}
      <section aria-labelledby="sound-heading" className="pt-6 border-t border-white/10 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Volume2 className="w-4 h-4 text-[#E5A93C]" />
            <h2 id="sound-heading" className="font-display text-lg font-semibold text-[#F2F0EB]">
              Ingeniería Sonora, Foley y Banda Sonora
            </h2>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {onOpenVoiceoverModal && (
              <button
                type="button"
                onClick={() => onOpenVoiceoverModal()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#38B2AC]/45 bg-[#102625] hover:bg-[#163433] text-xs font-medium text-[#5EEAD4] whitespace-nowrap"
              >
                <AudioLines className="w-3.5 h-3.5" />
                <span>Estudio TTS Provisional</span>
              </button>
            )}
            <div className="text-xs font-mono-tech text-[#8D8981] tabular-nums">
              Dolby Atmos · {soundDesign.tempoBpm} BPM
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-4 rounded-xl border border-white/10 bg-[#131318] space-y-4">
            <div>
              <div className="text-xs font-medium text-[#C8C3BA] mb-2">
                Capas Espaciales (Atmos)
              </div>
              <ul className="space-y-1.5 text-sm text-[#D4CFC7] list-disc pl-4">
                {(soundDesign.atmosLayers || []).map((layer, idx) => (
                  <li key={idx}>{layer}</li>
                ))}
              </ul>
            </div>

            <div className="pt-3 border-t border-white/5">
              <div className="text-xs font-medium text-[#C8C3BA] mb-1">
                Diseño de Subgraves (LFE)
              </div>
              <p className="text-sm text-[#EAE6DE]">{soundDesign.subBassCue}</p>
            </div>

            <div className="pt-3 border-t border-white/5">
              <div className="text-xs font-medium text-[#C8C3BA] mb-1">
                Uso Dramático del Silencio
              </div>
              <p className="text-sm text-[#EAE6DE]">{soundDesign.silenceBeats}</p>
            </div>
          </div>

          <div className="p-4 rounded-xl border border-white/10 bg-[#131318] space-y-4">
            <div>
              <div className="text-xs font-medium text-[#C8C3BA] mb-2">
                Foley Hiperrealista
              </div>
              <ul className="space-y-1.5 text-sm text-[#D4CFC7] list-disc pl-4">
                {(soundDesign.foleyDetails || []).map((item, idx) => (
                  <li key={idx}>{item}</li>
                ))}
              </ul>
            </div>

            <div className="pt-3 border-t border-white/5">
              <div className="text-xs font-medium text-[#C8C3BA] mb-1">
                Composición Musical ({soundDesign.tempoBpm} BPM)
              </div>
              <p className="text-sm text-[#EAE6DE] leading-relaxed">
                {soundDesign.musicalScore}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Realistic Voice-Over Tracks (Gemini TTS WAV) */}
      {(sequence.voiceOverTracks?.length || 0) > 0 && (
        <section aria-labelledby="voiceover-heading" className="pt-6 border-t border-white/10 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Mic className="w-4 h-4 text-[#E5A93C]" />
              <h2 id="voiceover-heading" className="font-display text-lg font-semibold text-[#F2F0EB]">
                Voces en Off Realistas
              </h2>
            </div>
            <div className="text-xs font-mono-tech text-[#8D8981] tabular-nums">
              {sequence.voiceOverTracks?.length}{' '}
              {sequence.voiceOverTracks?.length === 1 ? 'pista vocal' : 'pistas vocales'} · WAV
            </div>
          </div>

          {voError && (
            <div
              role="alert"
              className="rounded-lg border border-[#EF4444]/35 bg-[#3B1515]/50 px-4 py-2.5 text-xs text-[#FCA5A5]"
            >
              {voError}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {sequence.voiceOverTracks?.map((track) => {
              const busy = generatingVoId === track.id;
              return (
                <article
                  key={track.id}
                  className="p-4 rounded-xl border border-white/10 bg-[#131318] space-y-3 flex flex-col justify-between"
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-semibold text-[#F2F0EB]">
                        {track.characterOrNarrator}
                      </span>
                      <span className="font-mono-tech text-[11px] text-[#E5A93C] tabular-nums">
                        {track.voicePreset} · {track.timecodeHint}
                      </span>
                    </div>
                    <div className="text-[11px] text-[#8D8981]">
                      {track.voicePersona} — {track.deliveryDirection}
                    </div>
                    <p className="text-sm text-[#EAE6DE] leading-relaxed italic">
                      &ldquo;{track.text}&rdquo;
                    </p>
                  </div>

                  <div className="pt-2 border-t border-white/5 space-y-2">
                    {track.audioUrl && (
                      <audio controls src={track.audioUrl} className="w-full h-8" />
                    )}
                    <button
                      type="button"
                      onClick={() => handleGenerateVoiceOver(track)}
                      disabled={busy}
                      className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-[#E5A93C]/45 bg-[#1B1812] hover:bg-[#272116] disabled:opacity-60 text-xs font-medium text-[#F2F0EB]"
                    >
                      <Mic className="w-3.5 h-3.5 text-[#E5A93C]" />
                      <span>
                        {busy
                          ? 'Sintetizando voz realista...'
                          : track.audioUrl
                            ? 'Regenerar Voz en Off (WAV)'
                            : 'Generar Voz en Off (WAV)'}
                      </span>
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      {/* Audio Analysis & Verbatim Transcription Report */}
      {sequence.audioAnalysis && (
        <section
          aria-labelledby="audio-analysis-heading"
          className="pt-6 border-t border-white/10 space-y-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <AudioLines className="w-4 h-4 text-[#E5A93C]" />
              <h2
                id="audio-analysis-heading"
                className="font-display text-lg font-semibold text-[#F2F0EB]"
              >
                Informe de Dirección Sonoro y Transcripción del Audio Fuente
              </h2>
            </div>
            {sequence.sourceFilename && (
              <div className="text-xs font-mono-tech text-[#8D8981]">
                {sequence.sourceFilename}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 rounded-xl border border-white/10 bg-[#131318] space-y-3">
              <div>
                <div className="text-xs font-medium text-[#C8C3BA] mb-1">
                  Estilo de Narración e Interpretación Vocal
                </div>
                <p className="text-sm text-[#EAE6DE] leading-relaxed">
                  {sequence.audioAnalysis.narrationStyle}
                </p>
              </div>
              <div className="pt-3 border-t border-white/5">
                <div className="text-xs font-medium text-[#C8C3BA] mb-1">
                  Arco y Tono Emocional
                </div>
                <p className="text-sm text-[#EAE6DE] leading-relaxed">
                  {sequence.audioAnalysis.emotionalArc}
                </p>
              </div>
              <div className="pt-3 border-t border-white/5">
                <div className="text-xs font-medium text-[#C8C3BA] mb-1">
                  Ritmo y Cadencia de Montaje
                </div>
                <p className="text-sm text-[#EAE6DE] leading-relaxed">
                  {sequence.audioAnalysis.rhythmAndPacing}
                </p>
              </div>
            </div>

            <div className="p-4 rounded-xl border border-white/10 bg-[#131318] space-y-3">
              <div>
                <div className="text-xs font-medium text-[#C8C3BA] mb-1.5">
                  Efectos de Sonido Detectados / Capturados
                </div>
                <ul className="space-y-1.5 text-sm text-[#D4CFC7] list-disc pl-4">
                  {sequence.audioAnalysis.detectedSoundEffects.map((sfx, idx) => (
                    <li key={idx}>{sfx}</li>
                  ))}
                </ul>
              </div>
              <div className="pt-3 border-t border-white/5">
                <div className="text-xs font-medium text-[#C8C3BA] mb-1">
                  Recomendaciones de Dirección
                </div>
                <p className="text-sm text-[#EAE6DE] leading-relaxed">
                  {sequence.audioAnalysis.directingRecommendations}
                </p>
              </div>
            </div>
          </div>

          <div className="p-4 rounded-xl border border-white/10 bg-[#0D0D11] space-y-2">
            <div className="text-xs font-medium text-[#E5A93C]">
              Transcripción Verbatim del Material de Audio
            </div>
            <p className="font-mono-tech text-xs text-[#D4CFC7] leading-relaxed whitespace-pre-wrap">
              {sequence.audioAnalysis.transcription}
            </p>
          </div>
        </section>
      )}
    </div>
  );
}
