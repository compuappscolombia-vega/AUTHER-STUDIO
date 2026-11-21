import { CheckCircle2, Clock, Film, Sparkles } from 'lucide-react';
import type { ProductionProject } from '../types/studio';
import {
  formatTimecodeSec,
  getApprovedTimelineMilestones,
} from '../utils/productionPipeline';

interface TimelineBarProps {
  project: ProductionProject;
  activeSequenceId: string;
  onSelectSequence: (sequenceId: string) => void;
}

export function TimelineBar({
  project,
  activeSequenceId,
  onSelectSequence,
}: TimelineBarProps) {
  const milestones = getApprovedTimelineMilestones(project);

  return (
    <section
      aria-label="Línea de tiempo de hitos aprobados"
      className="border-b border-[#E2DDD3] dark:border-white/10 bg-[#FAF8F4] dark:bg-[#0D0D12] px-4 sm:px-5 py-2.5 shrink-0"
    >
      <div className="flex items-center justify-between gap-3 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <Clock className="w-3.5 h-3.5 text-teal-700 dark:text-[#38B2AC] shrink-0" />
          <h2 className="text-xs font-semibold text-[#18181B] dark:text-[#E6E2DA] truncate">
            Línea de Tiempo — Secuencias Aprobadas
          </h2>
        </div>
        <div className="text-[11px] font-mono-tech text-[#57534E] dark:text-[#8D8981] whitespace-nowrap tabular-nums">
          {milestones.length}{' '}
          {milestones.length === 1 ? 'hito final' : 'hitos finales'}
        </div>
      </div>

      {milestones.length === 0 ? (
        <div className="flex items-center gap-2 py-1.5 px-3 rounded-lg border border-[#E2DDD3] dark:border-white/8 bg-[#FFFFFF] dark:bg-[#121218] text-xs text-[#57534E] dark:text-[#8D8981]">
          <Sparkles className="w-3.5 h-3.5 text-amber-600 dark:text-[#E5A93C] shrink-0" />
          <span className="truncate">
            Aprueba una secuencia como Versión Final para fijar hitos navegables en la línea de tiempo y habilitar el Tráiler de 30s.
          </span>
        </div>
      ) : (
        <div
          role="list"
          className="flex items-stretch gap-2.5 overflow-x-auto pb-1"
        >
          {milestones.map((m, idx) => {
            const isSelected = m.sequenceId === activeSequenceId;
            return (
              <div
                key={m.sequenceId}
                role="listitem"
                className="flex items-center gap-2.5 shrink-0"
              >
                <button
                  type="button"
                  onClick={() => onSelectSequence(m.sequenceId)}
                  aria-current={isSelected ? 'step' : undefined}
                  className={`text-left min-w-[230px] max-w-[270px] px-3 py-2 rounded-lg border transition-colors focus-visible:outline-2 focus-visible:outline-[#E5A93C] ${
                    isSelected
                      ? 'border-teal-600 dark:border-[#38B2AC] bg-teal-50 dark:bg-[#112424] text-[#18181B] dark:text-[#F2F0EB]'
                      : 'border-[#DCD6CA] dark:border-white/10 bg-[#FFFFFF] dark:bg-[#131319] hover:border-[#C2BBB0] dark:hover:border-white/25 hover:bg-[#F5F3EE] dark:hover:bg-[#181820] text-[#3F3F46] dark:text-[#D4CFC7]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 text-[11px] font-mono-tech tabular-nums">
                    <span className="inline-flex items-center gap-1 text-teal-700 dark:text-[#5EEAD4] font-medium">
                      <CheckCircle2 className="w-3 h-3 shrink-0" />
                      <span>
                        {m.chapterIndex
                          ? `Cap. ${m.chapterIndex}`
                          : `Hito ${String(m.milestoneNumber).padStart(2, '0')}`}
                      </span>
                    </span>
                    <span className="text-amber-700 dark:text-[#E5A93C] font-medium">{m.targetResolution}</span>
                  </div>

                  <div className="mt-1 text-xs font-semibold text-[#18181B] dark:text-[#F2F0EB] truncate">
                    {m.title}
                  </div>

                  <div className="mt-1 flex items-center gap-1.5 text-[10px] font-mono-tech text-[#57534E] dark:text-[#8D8981] whitespace-nowrap overflow-hidden tabular-nums">
                    <Film className="w-3 h-3 shrink-0 text-[#57534E] dark:text-[#8D8981]" />
                    <span>{m.shotCount} planos</span>
                    <span aria-hidden="true">·</span>
                    <span>{formatTimecodeSec(m.durationSec)}</span>
                    <span aria-hidden="true">·</span>
                    <span className="truncate">{m.aspectRatio}</span>
                  </div>

                  {m.continuityHighlight && (
                    <p className="mt-1 text-[11px] text-[#57534E] dark:text-[#9A968E] line-clamp-1">
                      {m.continuityHighlight}
                    </p>
                  )}
                </button>

                {idx < milestones.length - 1 && (
                  <div
                    aria-hidden="true"
                    className="w-4 h-px bg-[#D4CEC2] dark:bg-white/15 shrink-0"
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
