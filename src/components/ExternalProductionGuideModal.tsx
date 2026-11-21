import { useEffect, useMemo, useState } from 'react';
import {
  Bot,
  Check,
  Copy,
  Download,
  FileDown,
  FileText,
  Layers,
  Sparkles,
  X,
} from 'lucide-react';
import type {
  ExternalProductionGuide,
  ProductionProject,
  ProductionSequence,
} from '../types/studio';
import { buildExternalProductionGuide } from '../utils/externalProductionGuide';
import { exportExternalGuidePdf } from '../utils/pdfExporter';

interface ExternalProductionGuideModalProps {
  open: boolean;
  project: ProductionProject | null;
  sequence: ProductionSequence | null;
  initialScope?: 'sequence' | 'project';
  autoDelivered?: boolean;
  onClose: () => void;
}

export function ExternalProductionGuideModal({
  open,
  project,
  sequence,
  initialScope = 'sequence',
  autoDelivered = false,
  onClose,
}: ExternalProductionGuideModalProps) {
  const [scope, setScope] = useState<'sequence' | 'project'>(initialScope);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [exportingPdf, setExportingPdf] = useState(false);

  useEffect(() => {
    setScope(initialScope);
  }, [initialScope, open]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  const guide: ExternalProductionGuide | null = useMemo(() => {
    if (!open || !project) return null;
    if (project.sequences.length === 0 && !project.trailer) return null;
    return buildExternalProductionGuide({ project, sequence, scope });
  }, [open, project, sequence, scope]);

  if (!open || !project) return null;

  async function handleCopy(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1600);
    } catch {
      // Clipboard blocked
    }
  }

  function handleDownloadFile(ext: 'md' | 'txt') {
    if (!guide || !project) return;
    const content = ext === 'md' ? guide.markdown : guide.plainText;
    const mime = ext === 'md' ? 'text/markdown;charset=utf-8' : 'text/plain;charset=utf-8';
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const slug = `${project.title}-guia-arthur`
      .toLowerCase()
      .replace(/[^a-z0-9]+/gi, '_')
      .replace(/^_+|_+$/g, '');
    a.href = url;
    a.download = `${slug || 'guia_arthur'}.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function handleExportPdf() {
    if (!guide) return;
    setExportingPdf(true);
    try {
      await exportExternalGuidePdf(guide);
    } finally {
      setExportingPdf(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="arthur-guide-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/65 dark:bg-black/85"
    >
      <div className="w-full max-w-5xl rounded-xl border border-[#DCD6CA] dark:border-white/15 bg-[#FFFFFF] dark:bg-[#111116] shadow-2xl max-h-[92vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-[#E2DDD3] dark:border-white/10 flex flex-wrap items-center justify-between gap-3 shrink-0 bg-[#FAF8F4] dark:bg-[#14141B]">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Bot className="w-4 h-4 text-amber-600 dark:text-[#E5A93C] shrink-0" />
              <h2
                id="arthur-guide-title"
                className="font-display text-base sm:text-lg font-semibold text-[#18181B] dark:text-[#F2F0EB] truncate"
              >
                Agente Arthur · Guía Paso a Paso para Plataforma Externa
              </h2>
            </div>
            <p className="text-xs text-[#57534E] dark:text-[#9A968E] mt-0.5 truncate">
              {project.title} · {project.genreStyle}
              {guide ? ` · ${guide.sequenceTitle} · ${guide.aspectRatio} (${guide.targetResolution})` : ''}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {project.sequences.length > 1 && (
              <div className="inline-flex rounded-lg border border-[#D6D1C7] dark:border-white/15 bg-[#FFFFFF] dark:bg-[#0B0B0E] p-0.5 text-[11px]">
                <button
                  type="button"
                  onClick={() => setScope('sequence')}
                  className={`px-2.5 py-1 rounded-md font-medium whitespace-nowrap ${
                    scope === 'sequence'
                      ? 'bg-[#E5A93C] text-[#0B0B0E] font-semibold'
                      : 'text-[#57534E] dark:text-[#9A968E]'
                  }`}
                >
                  Secuencia Activa
                </button>
                <button
                  type="button"
                  onClick={() => setScope('project')}
                  className={`px-2.5 py-1 rounded-md font-medium whitespace-nowrap ${
                    scope === 'project'
                      ? 'bg-[#E5A93C] text-[#0B0B0E] font-semibold'
                      : 'text-[#57534E] dark:text-[#9A968E]'
                  }`}
                >
                  Todo el Proyecto ({project.sequences.length})
                </button>
              </div>
            )}

            {guide && (
              <>
                <button
                  type="button"
                  onClick={() => handleCopy('all-md', guide.markdown)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[#D6D1C7] dark:border-white/15 bg-[#FFFFFF] dark:bg-[#171720] hover:bg-[#F1EFE9] dark:hover:bg-[#1E1E29] text-xs font-medium text-[#18181B] dark:text-[#F2F0EB] whitespace-nowrap shrink-0"
                >
                  {copiedKey === 'all-md' ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-teal-600 dark:text-[#5EEAD4]" />
                      <span>Copiado</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5 text-amber-600 dark:text-[#E5A93C]" />
                      <span>Copiar Todo</span>
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => handleDownloadFile('md')}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[#D6D1C7] dark:border-white/15 bg-[#FFFFFF] dark:bg-[#171720] hover:bg-[#F1EFE9] dark:hover:bg-[#1E1E29] text-xs font-medium text-[#18181B] dark:text-[#F2F0EB] whitespace-nowrap shrink-0"
                >
                  <Download className="w-3.5 h-3.5 text-amber-600 dark:text-[#E5A93C]" />
                  <span>.MD</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleDownloadFile('txt')}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[#D6D1C7] dark:border-white/15 bg-[#FFFFFF] dark:bg-[#171720] hover:bg-[#F1EFE9] dark:hover:bg-[#1E1E29] text-xs font-medium text-[#18181B] dark:text-[#F2F0EB] whitespace-nowrap shrink-0"
                >
                  <FileText className="w-3.5 h-3.5 text-amber-600 dark:text-[#E5A93C]" />
                  <span>.TXT</span>
                </button>
                <button
                  type="button"
                  onClick={handleExportPdf}
                  disabled={exportingPdf}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#E5A93C] hover:bg-[#EDA949] disabled:opacity-60 text-[#0B0B0E] text-xs font-semibold whitespace-nowrap shrink-0"
                >
                  <FileDown className="w-3.5 h-3.5" />
                  <span>{exportingPdf ? 'Generando...' : 'Exportar PDF'}</span>
                </button>
              </>
            )}

            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar guía de producción"
              className="p-1.5 rounded-lg text-[#57534E] dark:text-[#9A968E] hover:bg-black/5 dark:hover:bg-white/10"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {autoDelivered && (
            <div className="p-3.5 rounded-xl border border-teal-600/35 dark:border-[#38B2AC]/40 bg-teal-50 dark:bg-[#0F2423] flex items-start gap-2.5">
              <Sparkles className="w-4 h-4 text-teal-700 dark:text-[#5EEAD4] shrink-0 mt-0.5" />
              <div className="text-xs text-teal-900 dark:text-[#CFFAFE] leading-relaxed">
                <strong>Producción finalizada por Agente Arthur.</strong> Aquí tienes el documento
                detallado paso a paso con todas las indicaciones técnicas, prompts fotográficos,
                prompts de movimiento de cámara, locuciones, música y escaleta de montaje para
                recrear esta producción en cualquier plataforma externa.
              </div>
            </div>
          )}

          {!guide ? (
            <div className="py-12 text-center text-sm text-[#57534E] dark:text-[#9A968E]">
              Genera primero al menos una secuencia con Agente Arthur para emitir la guía externa.
            </div>
          ) : (
            <>
              {/* Quick Step Anchor Navigation */}
              <div className="flex flex-wrap gap-2 pb-2 border-b border-[#E2DDD3] dark:border-white/10">
                {guide.sections.map((section) => (
                  <a
                    key={section.id}
                    href={`#${section.id}`}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-[#DCD6CA] dark:border-white/12 bg-[#FAF8F4] dark:bg-[#17171F] hover:border-[#E5A93C] text-[11px] font-medium text-[#27272A] dark:text-[#E6E2DA]"
                  >
                    <Layers className="w-3 h-3 text-amber-600 dark:text-[#E5A93C]" />
                    <span>{section.title.split('·')[0].trim()}</span>
                  </a>
                ))}
              </div>

              {/* Sections */}
              <div className="space-y-8">
                {guide.sections.map((section) => (
                  <section
                    key={section.id}
                    id={section.id}
                    className="space-y-3 scroll-mt-4"
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[#E2DDD3] dark:border-white/10 pb-2">
                      <div>
                        <h3 className="font-display text-base font-semibold text-amber-700 dark:text-[#E5A93C]">
                          {section.title}
                        </h3>
                        <p className="text-xs text-[#57534E] dark:text-[#9A968E] mt-0.5">
                          {section.summary}
                        </p>
                      </div>
                      <span className="text-[11px] font-mono-tech text-teal-700 dark:text-[#5EEAD4]">
                        {section.platformHint}
                      </span>
                    </div>

                    <div className="space-y-3">
                      {section.items.map((item) => (
                        <div
                          key={item.stepCode}
                          className="p-4 rounded-xl border border-[#DCD6CA] dark:border-white/10 bg-[#FAF8F4] dark:bg-[#0D0D12] space-y-2.5"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-mono-tech text-[11px] font-semibold text-amber-700 dark:text-[#E5A93C] tabular-nums">
                                  [{item.stepCode}]
                                </span>
                                <h4 className="text-sm font-semibold text-[#18181B] dark:text-[#F2F0EB]">
                                  {item.title}
                                </h4>
                              </div>
                              {item.subtitle && (
                                <p className="text-[11px] text-[#57534E] dark:text-[#8D8981] mt-0.5">
                                  {item.subtitle}
                                </p>
                              )}
                            </div>

                            {item.copyPromptText && (
                              <button
                                type="button"
                                onClick={() => handleCopy(item.stepCode, item.copyPromptText!)}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-[#E5A93C]/45 bg-amber-50 hover:bg-amber-100 dark:bg-[#1B1710] dark:hover:bg-[#262015] text-[11px] font-medium text-amber-800 dark:text-[#E5A93C] whitespace-nowrap shrink-0"
                              >
                                {copiedKey === item.stepCode ? (
                                  <>
                                    <Check className="w-3 h-3" />
                                    <span>Copiado</span>
                                  </>
                                ) : (
                                  <>
                                    <Copy className="w-3 h-3" />
                                    <span>{item.copyPromptLabel || 'Copiar Prompt'}</span>
                                  </>
                                )}
                              </button>
                            )}
                          </div>

                          {item.specs.length > 0 && (
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 pt-1">
                              {item.specs.map((sp) => (
                                <div
                                  key={`${item.stepCode}-${sp.label}`}
                                  className="px-2.5 py-1.5 rounded-lg border border-[#E2DDD3] dark:border-white/8 bg-[#FFFFFF] dark:bg-[#13131A] text-[11px]"
                                >
                                  <span className="text-[#57534E] dark:text-[#8D8981]">
                                    {sp.label}:{' '}
                                  </span>
                                  <span className="font-medium text-[#18181B] dark:text-[#EAE6DE] break-words">
                                    {sp.value}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}

                          <p className="text-xs text-[#27272A] dark:text-[#CFCAC0] leading-relaxed whitespace-pre-line">
                            {item.instructions}
                          </p>

                          {item.copyPromptText && (
                            <pre className="p-3 rounded-lg border border-[#DCD6CA] dark:border-white/10 bg-[#FFFFFF] dark:bg-[#08080B] font-mono-tech text-[11px] text-[#18181B] dark:text-[#E6E2DA] whitespace-pre-wrap break-words leading-relaxed">
                              {item.copyPromptText}
                            </pre>
                          )}

                          {item.notes && (
                            <p className="text-[11px] text-[#57534E] dark:text-[#9A968E] italic">
                              Nota: {item.notes}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
