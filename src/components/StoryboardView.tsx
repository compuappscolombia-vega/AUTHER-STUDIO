import { useState, useEffect } from 'react';
import { Check, Copy, Film, Maximize2, X } from 'lucide-react';
import type { ProductionSequence, StoryboardCard } from '../types/studio';

interface StoryboardViewProps {
  sequence: ProductionSequence;
}

export function StoryboardView({ sequence }: StoryboardViewProps) {
  const [activeCard, setActiveCard] = useState<StoryboardCard | null>(null);
  const [brokenImages, setBrokenImages] = useState<Record<string, boolean>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setActiveCard(null);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  async function copyText(id: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch {
      // Ignore clipboard failure in restricted contexts
    }
  }

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-semibold text-[#F2F0EB]">
            Storyboard y Prompts de Pre-Visualización
          </h2>
          <p className="text-xs text-[#8D8981] mt-0.5">
            Fotogramas clave y descripciones de cámara listos para Nano Banana y Veo.
          </p>
        </div>
        <span className="text-xs font-mono-tech text-[#8D8981]">
          {sequence.storyboardFrames.length}{' '}
          {sequence.storyboardFrames.length === 1 ? 'fotograma' : 'fotogramas'}
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {sequence.storyboardFrames.map((frame) => {
          const showImage = Boolean(frame.imageUrl) && !brokenImages[frame.id];
          return (
            <article
              key={frame.id}
              className="rounded-xl border border-white/10 bg-[#131318] overflow-hidden flex flex-col"
            >
              <div className="relative aspect-video bg-[#08080B] border-b border-white/10 overflow-hidden">
                {showImage ? (
                  <img
                    src={frame.imageUrl}
                    alt={`${frame.title} — ${frame.shotRef}`}
                    referrerPolicy="no-referrer"
                    onError={() =>
                      setBrokenImages((prev) => ({ ...prev, [frame.id]: true }))
                    }
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center bg-gradient-to-br from-[#161720] via-[#0D0E14] to-[#1A1610]">
                    <Film className="w-7 h-7 text-[#E5A93C] mb-2.5" />
                    <div className="font-display text-sm font-semibold text-[#F2F0EB]">
                      {frame.title}
                    </div>
                    <div className="text-[11px] font-mono-tech text-[#8D8981] mt-1">
                      {frame.shotRef} · {frame.aspectRatio}
                    </div>
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => setActiveCard(frame)}
                  aria-label={`Ampliar fotograma ${frame.title}`}
                  className="absolute top-3 right-3 p-2 rounded-lg bg-black/75 hover:bg-black text-[#F2F0EB] border border-white/15 transition-colors focus-visible:outline-2 focus-visible:outline-[#E5A93C]"
                >
                  <Maximize2 className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="p-4 flex-1 flex flex-col justify-between space-y-4">
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-display text-sm font-semibold text-[#F2F0EB]">
                      {frame.title}
                    </h3>
                    <span className="text-[11px] font-mono-tech text-[#E5A93C]">
                      {frame.shotRef}
                    </span>
                  </div>
                  <p className="text-xs font-mono-tech text-[#8D8981] mt-1">
                    {frame.cameraSpec} · {frame.aspectRatio}
                  </p>
                </div>

                <div className="space-y-3 pt-3 border-t border-white/5">
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[11px] font-medium text-[#C8C3BA]">
                        Prompt de Fotograma (Imagen)
                      </span>
                      <button
                        type="button"
                        onClick={() => copyText(`${frame.id}-img`, frame.visualPrompt)}
                        className="inline-flex items-center gap-1 text-[11px] text-[#E5A93C] hover:text-[#F4C46A]"
                      >
                        {copiedId === `${frame.id}-img` ? (
                          <>
                            <Check className="w-3 h-3" />
                            <span>Copiado</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3" />
                            <span>Copiar</span>
                          </>
                        )}
                      </button>
                    </div>
                    <p className="text-xs text-[#A7A299] leading-relaxed line-clamp-3">
                      {frame.visualPrompt}
                    </p>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[11px] font-medium text-[#C8C3BA]">
                        Prompt de Movimiento (Video / Veo)
                      </span>
                      <button
                        type="button"
                        onClick={() => copyText(`${frame.id}-veo`, frame.veoMotionPrompt)}
                        className="inline-flex items-center gap-1 text-[11px] text-[#E5A93C] hover:text-[#F4C46A]"
                      >
                        {copiedId === `${frame.id}-veo` ? (
                          <>
                            <Check className="w-3 h-3" />
                            <span>Copiado</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3" />
                            <span>Copiar</span>
                          </>
                        )}
                      </button>
                    </div>
                    <p className="text-xs text-[#A7A299] leading-relaxed line-clamp-2">
                      {frame.veoMotionPrompt}
                    </p>
                  </div>
                </div>
              </div>
            </article>
          );
        })}
      </div>

      {/* Lightbox Modal */}
      {activeCard && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="lightbox-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/90"
        >
          <div className="w-full max-w-4xl rounded-xl border border-white/15 bg-[#121217] overflow-hidden">
            <div className="px-5 py-3.5 border-b border-white/10 flex items-center justify-between">
              <div>
                <h3 id="lightbox-title" className="font-display text-base font-semibold text-[#F2F0EB]">
                  {activeCard.title}
                </h3>
                <p className="text-xs font-mono-tech text-[#8D8981]">
                  {activeCard.shotRef} · {activeCard.cameraSpec} · {activeCard.aspectRatio}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActiveCard(null)}
                aria-label="Cerrar vista ampliada"
                className="p-2 rounded-lg text-[#C8C3BA] hover:bg-white/10"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="aspect-video bg-[#07070A] border-b border-white/10">
              {activeCard.imageUrl && !brokenImages[activeCard.id] ? (
                <img
                  src={activeCard.imageUrl}
                  alt={activeCard.title}
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-contain"
                />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center p-8 text-center">
                  <Film className="w-10 h-10 text-[#E5A93C] mb-3" />
                  <p className="text-sm text-[#D4CFC7] max-w-xl">{activeCard.visualPrompt}</p>
                </div>
              )}
            </div>

            <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div>
                <div className="font-medium text-[#E5A93C] mb-1">Prompt Visual (Imagen)</div>
                <p className="text-[#D4CFC7] leading-relaxed">{activeCard.visualPrompt}</p>
              </div>
              <div>
                <div className="font-medium text-[#E5A93C] mb-1">Prompt de Cámara (Veo)</div>
                <p className="text-[#D4CFC7] leading-relaxed">{activeCard.veoMotionPrompt}</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
