import { useState } from 'react';
import {
  ArrowRight,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  HelpCircle,
  Mic,
} from 'lucide-react';
import type {
  ProductionProject,
  ProductionSequence,
  WorkspaceTab,
} from '../types/studio';
import { computeFilmDeliveryWorkflow } from '../utils/productionWorkflow';

interface WorkflowStepperBarProps {
  activeProject: ProductionProject | null;
  activeSequence: ProductionSequence | null;
  activeTab: WorkspaceTab;
  onSelectTab: (tab: WorkspaceTab) => void;
  onOpenNewProject: () => void;
  onOpenIngest: () => void;
  onApproveFinal: () => Promise<void>;
  onOpenLiveVoice: () => void;
  onOpenExternalGuide?: () => void;
  finalizingSeq: boolean;
}

export function WorkflowStepperBar({
  activeProject,
  activeSequence,
  activeTab,
  onSelectTab,
  onOpenNewProject,
  onOpenIngest,
  onApproveFinal,
  onOpenLiveVoice,
  onOpenExternalGuide,
  finalizingSeq,
}: WorkflowStepperBarProps) {
  const [expanded, setExpanded] = useState(true);
  const workflow = computeFilmDeliveryWorkflow({ activeProject, activeSequence });

  function handlePrimaryNextAction() {
    if (workflow.nextActionKind === 'new_project') {
      onOpenNewProject();
    } else if (workflow.nextActionKind === 'open_ingest') {
      onOpenIngest();
      onSelectTab('vision');
    } else if (workflow.nextActionKind === 'approve_final') {
      void onApproveFinal();
    } else if (workflow.nextActionTab) {
      onSelectTab(workflow.nextActionTab);
    }
  }

  return (
    <section
      aria-label="Orden de ejecución paso a paso"
      className="no-print border-b border-[#E2DDD3] dark:border-white/10 bg-[#FAF8F4] dark:bg-[#0D0D12] px-4 sm:px-5 py-2.5 shrink-0"
    >
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex items-center gap-2.5 min-w-0">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#18181B] hover:text-amber-700 dark:text-[#F2F0EB] dark:hover:text-[#E5A93C] whitespace-nowrap"
          >
            <HelpCircle className="w-3.5 h-3.5 text-amber-600 dark:text-[#E5A93C] shrink-0" />
            <span>Guía Paso a Paso ({workflow.completedCount}/6)</span>
            {expanded ? (
              <ChevronUp className="w-3.5 h-3.5 text-[#57534E] dark:text-[#8D8981]" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5 text-[#57534E] dark:text-[#8D8981]" />
            )}
          </button>

          <span className="hidden md:inline text-[11px] font-mono-tech text-[#57534E] dark:text-[#8D8981] tabular-nums">
            · {workflow.percentComplete}% completado
          </span>

          <span className="hidden lg:inline text-xs text-[#3F3F46] dark:text-[#CFCAC0] truncate max-w-xl">
            · {workflow.summaryHint}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {activeSequence && onOpenExternalGuide && (
            <button
              type="button"
              onClick={onOpenExternalGuide}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-amber-600/35 dark:border-[#E5A93C]/40 bg-amber-50 hover:bg-amber-100 dark:bg-[#1B1710] dark:hover:bg-[#262015] text-[11px] font-medium text-amber-800 dark:text-[#E5A93C] whitespace-nowrap shrink-0"
            >
              <Bot className="w-3.5 h-3.5 shrink-0" />
              <span>Documento Externa Arthur</span>
            </button>
          )}

          <button
            type="button"
            onClick={onOpenLiveVoice}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-teal-600/35 dark:border-[#38B2AC]/45 bg-teal-50 hover:bg-teal-100 dark:bg-[#102625] dark:hover:bg-[#163433] text-[11px] font-medium text-teal-800 dark:text-[#5EEAD4] whitespace-nowrap shrink-0"
          >
            <Mic className="w-3.5 h-3.5 shrink-0" />
            <span>Hablar con Director (Voz Live)</span>
          </button>

          <button
            type="button"
            onClick={handlePrimaryNextAction}
            disabled={finalizingSeq}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#E5A93C] hover:bg-[#EDA949] disabled:opacity-60 text-[#0B0B0E] text-[11px] font-semibold whitespace-nowrap shrink-0"
          >
            <span>{finalizingSeq ? 'Aprobando...' : workflow.nextActionLabel}</span>
            <ArrowRight className="w-3.5 h-3.5 shrink-0" />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="mt-2.5 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          {workflow.steps.map((step) => {
            const isTabFocused = step.actionTab && activeTab === step.actionTab && step.active;
            return (
              <button
                key={step.id}
                type="button"
                onClick={() => {
                  if (step.id === 'project' && !activeProject) {
                    onOpenNewProject();
                  } else if (step.id === 'ingest') {
                    onOpenIngest();
                    if (step.actionTab) onSelectTab(step.actionTab);
                  } else if (step.id === 'finalize' && activeSequence && activeSequence.versionStatus !== 'final') {
                    void onApproveFinal();
                  } else if (step.actionTab) {
                    onSelectTab(step.actionTab);
                  }
                }}
                className={`text-left rounded-lg border px-2.5 py-2 transition-colors flex flex-col justify-between gap-1 ${
                  step.active || isTabFocused
                    ? 'border-[#E5A93C] bg-amber-50 dark:bg-[#1A160E]'
                    : step.completed
                      ? 'border-teal-600/35 dark:border-[#38B2AC]/35 bg-teal-50/70 dark:bg-[#101C1C]'
                      : 'border-[#DCD6CA] dark:border-white/10 bg-[#FFFFFF] dark:bg-[#131318] hover:border-[#C2BBB0] dark:hover:border-white/25'
                }`}
              >
                <div className="flex items-center justify-between gap-1.5 w-full">
                  <span
                    className={`text-[11px] font-semibold truncate ${
                      step.active
                        ? 'text-amber-700 dark:text-[#E5A93C]'
                        : step.completed
                          ? 'text-teal-700 dark:text-[#5EEAD4]'
                          : 'text-[#18181B] dark:text-[#EAE6DE]'
                    }`}
                  >
                    {step.title}
                  </span>
                  {step.completed && (
                    <CheckCircle2 className="w-3.5 h-3.5 text-teal-700 dark:text-[#38B2AC] shrink-0" />
                  )}
                </div>
                <p className="text-[10px] text-[#57534E] dark:text-[#9A968E] leading-snug line-clamp-2">
                  {step.whatItDoes}
                </p>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
