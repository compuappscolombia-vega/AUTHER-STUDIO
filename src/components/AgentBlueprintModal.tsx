import { useEffect, useState } from 'react';
import { Check, Copy, X } from 'lucide-react';
import type { ProductionProject } from '../types/studio';

interface AgentBlueprintModalProps {
  open: boolean;
  onClose: () => void;
  activeProject: ProductionProject | null;
}

export function AgentBlueprintModal({
  open,
  onClose,
  activeProject,
}: AgentBlueprintModalProps) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const blueprint = JSON.stringify(
    {
      agentName: 'AUTEUR - Hollywood Film Producer',
      platform: 'https://console.cloud.google.com/agent-platform/studio',
      recommendedModel: 'gemini-4-hydrogen',
      projectContext: activeProject
        ? {
            productionTitle: activeProject.title,
            genreStyle: activeProject.genreStyle,
            continuityBible: activeProject.continuityBible,
            sequencesIndexed: activeProject.sequences.length,
          }
        : null,
      systemInstructions:
        'Eres AUTEUR, Productor y Director de Cine de Hollywood premiado. Transformas capítulos de libros, audiolibros e historias en expedientes cinematográficos completos con ópticas reales, iluminación en Kelvin, shot lists, diseño Dolby Atmos, VFX y guion técnico-literario.',
      ragRecommendation:
        'Sube el libro completo o la saga en el Data Store / RAG Engine de Agent Studio para mantener continuidad exacta a través de decenas de capítulos.',
    },
    null,
    2
  );

  async function copyBlueprint() {
    try {
      await navigator.clipboard.writeText(blueprint);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Ignore clipboard failure in restricted contexts
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="agent-blueprint-heading"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 dark:bg-black/80"
    >
      <div className="w-full max-w-2xl rounded-xl border border-[#DCD6CA] dark:border-white/15 bg-[#FFFFFF] dark:bg-[#131318] p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-3">
          <h2 id="agent-blueprint-heading" className="font-display text-lg font-semibold text-[#18181B] dark:text-[#F2F0EB]">
            Plantilla para Google Cloud Agent Platform Studio
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar plantilla"
            className="p-2 rounded-lg text-[#57534E] dark:text-[#9A968E] hover:text-[#18181B] dark:hover:text-[#F2F0EB] hover:bg-black/5 dark:hover:bg-white/5"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-xs text-[#52525B] dark:text-[#A7A299] leading-relaxed mb-4">
          Copia esta configuración para desplegar el mismo agente productor en{' '}
          <span className="font-mono-tech text-amber-700 dark:text-[#E5A93C]">
            console.cloud.google.com/agent-platform/studio
          </span>{' '}
          con un Data Store RAG para libros extensos.
        </p>

        <pre className="max-h-72 overflow-auto rounded-lg border border-[#DCD6CA] dark:border-white/10 bg-[#FAF8F4] dark:bg-[#0B0B0E] p-4 text-xs font-mono-tech text-[#27272A] dark:text-[#D4CFC7] leading-relaxed">
          {blueprint}
        </pre>

        <div className="flex items-center justify-end gap-3 mt-5">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-[#D6D1C7] dark:border-white/15 text-xs font-medium text-[#3F3F46] dark:text-[#C8C3BA] hover:bg-black/5 dark:hover:bg-white/5"
          >
            Cerrar
          </button>
          <button
            type="button"
            onClick={copyBlueprint}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#E5A93C] hover:bg-[#EDA949] text-[#0B0B0E] text-xs font-semibold"
          >
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copied ? 'Copiado' : 'Copiar configuración'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
