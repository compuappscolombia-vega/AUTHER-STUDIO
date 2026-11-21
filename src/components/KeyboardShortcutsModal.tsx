import { useEffect } from 'react';
import { Keyboard, X } from 'lucide-react';
import { SHORTCUT_GROUPS } from '../utils/keyboardShortcuts';

interface KeyboardShortcutsModalProps {
  open: boolean;
  onClose: () => void;
}

export function KeyboardShortcutsModal({
  open,
  onClose,
}: KeyboardShortcutsModalProps) {
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

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="keyboard-shortcuts-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 dark:bg-black/80"
    >
      <div className="w-full max-w-3xl rounded-xl border border-[#DCD6CA] dark:border-white/15 bg-[#FFFFFF] dark:bg-[#121217] overflow-hidden shadow-2xl max-h-[90vh] flex flex-col">
        <div className="px-5 py-4 border-b border-[#E2DDD3] dark:border-white/10 bg-[#FAF8F4] dark:bg-[#101015] flex items-center justify-between gap-4 shrink-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Keyboard className="w-4 h-4 text-amber-600 dark:text-[#E5A93C] shrink-0" />
              <h2
                id="keyboard-shortcuts-title"
                className="font-display text-base font-semibold text-[#18181B] dark:text-[#F2F0EB] truncate"
              >
                Atajos de Teclado del Estudio
              </h2>
            </div>
            <p className="text-xs text-[#57534E] dark:text-[#8D8981] mt-0.5">
              Comandos rápidos para navegar entre vistas, alternar Modo Lectura y agilizar la revisión.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar atajos de teclado"
            className="p-2 rounded-lg text-[#57534E] dark:text-[#9A968E] hover:text-[#18181B] dark:hover:text-[#F2F0EB] hover:bg-black/5 dark:hover:bg-white/10 shrink-0 focus-visible:outline-2 focus-visible:outline-[#E5A93C]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-6">
          {SHORTCUT_GROUPS.map((group) => (
            <section key={group.id} aria-labelledby={`shortcut-group-${group.id}`} className="space-y-2.5">
              <h3
                id={`shortcut-group-${group.id}`}
                className="font-display text-xs font-semibold text-amber-700 dark:text-[#E5A93C] tracking-wide"
              >
                {group.title}
              </h3>

              <div className="rounded-lg border border-[#DCD6CA] dark:border-white/10 bg-[#FAF8F4] dark:bg-[#0D0D12] divide-y divide-[#E2DDD3] dark:divide-white/8">
                {group.items.map((item) => (
                  <div
                    key={item.id}
                    className="px-4 py-3 flex items-center justify-between gap-4"
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-[#18181B] dark:text-[#F2F0EB]">
                        {item.label}
                      </div>
                      <p className="text-[11px] text-[#57534E] dark:text-[#8D8981] mt-0.5">
                        {item.description}
                      </p>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {item.keys.map((keyLabel, idx) => (
                        <span key={`${item.id}-${keyLabel}`} className="inline-flex items-center gap-1.5">
                          {idx > 0 && (
                            <span className="text-[10px] text-[#78746C] dark:text-[#6E6A63]" aria-hidden="true">
                              /
                            </span>
                          )}
                          <kbd className="inline-flex items-center justify-center min-w-[28px] px-2 py-1 rounded border border-[#D4CEC2] dark:border-white/15 bg-[#FFFFFF] dark:bg-[#181820] font-mono-tech text-[11px] font-semibold text-[#18181B] dark:text-[#F2F0EB] shadow-xs dark:shadow-inner tabular-nums">
                            {keyLabel}
                          </kbd>
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>

        <div className="px-5 py-3 border-t border-[#E2DDD3] dark:border-white/10 bg-[#FAF8F4] dark:bg-[#101015] flex items-center justify-between gap-3 text-[11px] text-[#57534E] dark:text-[#8D8981] shrink-0">
          <span>
            Los atajos se desactivan automáticamente mientras escribes en formularios o notas.
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-1.5 rounded-lg border border-[#D6D1C7] dark:border-white/12 bg-[#FFFFFF] dark:bg-[#16161E] hover:bg-[#EFECE4] dark:hover:bg-[#1E1E29] text-xs font-medium text-[#18181B] dark:text-[#E6E2DA] whitespace-nowrap shrink-0"
          >
            Entendido
          </button>
        </div>
      </div>
    </div>
  );
}
