import { useEffect, useState } from 'react';
import { CheckCircle2, RotateCcw, Server, ShieldCheck, Sliders, X } from 'lucide-react';
import type { ResolutionTier, StudioSettings, ThinkingDepth, VoicePreset } from '../types/studio';
import {
  DEFAULT_STUDIO_SETTINGS,
  RESOLUTION_OPTIONS,
  VOICE_PRESET_OPTIONS,
} from '../utils/productionPipeline';
import { ASPECT_RATIO_OPTIONS, DIRECTOR_STYLES } from '../utils/studioLogic';

interface StudioSettingsModalProps {
  open: boolean;
  settings: StudioSettings;
  onClose: () => void;
  onSaveSettings: (next: StudioSettings) => void;
}

export function StudioSettingsModal({
  open,
  settings,
  onClose,
  onSaveSettings,
}: StudioSettingsModalProps) {
  const [draft, setDraft] = useState<StudioSettings>(settings);
  const [healthLoading, setHealthLoading] = useState(false);
  const [geminiConfigured, setGeminiConfigured] = useState<boolean | null>(null);
  const [savedNotice, setSavedNotice] = useState(false);

  useEffect(() => {
    setDraft(settings);
  }, [settings, open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setHealthLoading(true);
    fetch('/api/health')
      .then((res) => res.json())
      .then((data: { ok?: boolean; geminiConfigured?: boolean }) => {
        if (!cancelled) {
          setGeminiConfigured(Boolean(data.geminiConfigured));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setGeminiConfigured(null);
        }
      })
      .finally(() => {
        if (!cancelled) setHealthLoading(false);
      });

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => {
      cancelled = true;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSaveSettings(draft);
    setSavedNotice(true);
    setTimeout(() => {
      setSavedNotice(false);
      onClose();
    }, 650);
  }

  function handleReset() {
    setDraft(DEFAULT_STUDIO_SETTINGS);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="studio-settings-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80"
    >
      <div className="w-full max-w-2xl rounded-xl border border-white/15 bg-[#121217] overflow-hidden shadow-2xl max-h-[90vh] flex flex-col">
        <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sliders className="w-4 h-4 text-[#E5A93C]" />
            <h2 id="studio-settings-title" className="font-display text-base font-semibold text-[#F2F0EB]">
              Configuración del Estudio e Integraciones
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar configuración"
            className="p-1.5 rounded-lg text-[#9A968E] hover:text-[#F2F0EB] hover:bg-white/10"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 overflow-y-auto space-y-5">
          {/* Server API Integration Status (Managed Securely via Environment Secrets) */}
          <div className="p-4 rounded-xl border border-white/10 bg-[#0D0D12] space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-[#F2F0EB]">
                <Server className="w-4 h-4 text-[#E5A93C]" />
                <span>Estado de Conexión API (Servidor Proxy Seguro)</span>
              </div>
              <span
                className={`text-[11px] font-mono-tech ${
                  healthLoading
                    ? 'text-[#9A968E]'
                    : geminiConfigured
                      ? 'text-[#5EEAD4]'
                      : 'text-[#F59E0B]'
                }`}
              >
                {healthLoading
                  ? 'Verificando...'
                  : geminiConfigured
                    ? 'Motor Gemini Activo'
                    : 'Variable pendiente en servidor'}
              </span>
            </div>
            <p className="text-xs text-[#A7A299] leading-relaxed">
              Por seguridad cinematográfica y protección de credenciales, las claves de API del motor de IA se administran exclusivamente del lado del servidor mediante{' '}
              <code className="font-mono-tech text-[#E5A93C]">GEMINI_API_KEY</code> en{' '}
              <strong className="text-[#F2F0EB]">Settings &gt; Secrets</strong> del entorno de ejecución y nunca se exponen ni almacenan en el navegador.
            </p>
            <div className="flex items-center gap-2 text-[11px] text-[#8D8981]">
              <ShieldCheck className="w-3.5 h-3.5 text-[#38B2AC] shrink-0" />
              <span>
                Modelos conectados: Director (gemini-4-hydrogen) · Nano 4K (gemini-nano-banana-2.1) · Omni Flash · TTS WAV · Lyria 30s
              </span>
            </div>
          </div>

          {/* Master Resolution Preset */}
          <div>
            <span className="block text-xs font-medium text-[#C8C3BA] mb-2">
              Resolución Maestra Hiperrealista por Defecto (Prompts y Storyboard Nano)
            </span>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {RESOLUTION_OPTIONS.map((opt) => {
                const active = draft.defaultResolution === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() =>
                      setDraft((prev) => ({
                        ...prev,
                        defaultResolution: opt.value as ResolutionTier,
                      }))
                    }
                    className={`p-3 rounded-lg border text-left transition-colors ${
                      active
                        ? 'border-[#E5A93C] bg-[#1E1A12] text-[#F2F0EB]'
                        : 'border-white/10 bg-[#0B0B0E] hover:border-white/25 text-[#C8C3BA]'
                    }`}
                  >
                    <div className="font-mono-tech text-xs font-semibold text-[#E5A93C]">
                      {opt.value}
                    </div>
                    <div className="text-[11px] font-medium text-[#F2F0EB] mt-0.5">
                      {opt.label}
                    </div>
                    <div className="text-[10px] font-mono-tech text-[#8D8981] mt-0.5 tabular-nums">
                      {opt.dimensions}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Director Signature & Format */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="settings-director-style"
                className="block text-xs font-medium text-[#C8C3BA] mb-1.5"
              >
                Estilo de Dirección Predeterminado
              </label>
              <select
                id="settings-director-style"
                value={draft.defaultDirectorStyle}
                onChange={(e) =>
                  setDraft((prev) => ({ ...prev, defaultDirectorStyle: e.target.value }))
                }
                className="w-full rounded-lg border border-white/12 bg-[#0B0B0E] px-3 py-2 text-xs text-[#F2F0EB] focus:border-[#E5A93C] focus:outline-none"
              >
                {DIRECTOR_STYLES.map((style) => (
                  <option key={style.id} value={style.label}>
                    {style.label} ({style.references})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="settings-aspect-ratio"
                className="block text-xs font-medium text-[#C8C3BA] mb-1.5"
              >
                Relación de Aspecto Predeterminada
              </label>
              <select
                id="settings-aspect-ratio"
                value={draft.defaultAspectRatio}
                onChange={(e) =>
                  setDraft((prev) => ({ ...prev, defaultAspectRatio: e.target.value }))
                }
                className="w-full rounded-lg border border-white/12 bg-[#0B0B0E] px-3 py-2 text-xs text-[#F2F0EB] font-mono-tech focus:border-[#E5A93C] focus:outline-none"
              >
                {ASPECT_RATIO_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="settings-voice-preset"
                className="block text-xs font-medium text-[#C8C3BA] mb-1.5"
              >
                Voz en Off Principal Predeterminada
              </label>
              <select
                id="settings-voice-preset"
                value={draft.defaultVoicePreset}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    defaultVoicePreset: e.target.value as VoicePreset,
                  }))
                }
                className="w-full rounded-lg border border-white/12 bg-[#0B0B0E] px-3 py-2 text-xs text-[#F2F0EB] focus:border-[#E5A93C] focus:outline-none"
              >
                {VOICE_PRESET_OPTIONS.map((v) => (
                  <option key={v.value} value={v.value}>
                    {v.label} ({v.character})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="settings-thinking-depth"
                className="block text-xs font-medium text-[#C8C3BA] mb-1.5"
              >
                Profundidad de Razonamiento del Agente
              </label>
              <select
                id="settings-thinking-depth"
                value={draft.defaultThinkingDepth}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    defaultThinkingDepth: e.target.value as ThinkingDepth,
                  }))
                }
                className="w-full rounded-lg border border-white/12 bg-[#0B0B0E] px-3 py-2 text-xs text-[#F2F0EB] focus:border-[#E5A93C] focus:outline-none"
              >
                <option value="standard">Estándar (Ágil)</option>
                <option value="deep">Profundo (Máximo detalle técnico)</option>
              </select>
            </div>
          </div>

          <div className="pt-3 border-t border-white/10 flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={handleReset}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-white/12 bg-[#16161E] hover:bg-[#1E1E28] text-xs font-medium text-[#C8C3BA]"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Restaurar valores de estudio</span>
            </button>

            <div className="flex items-center gap-2">
              {savedNotice && (
                <span className="inline-flex items-center gap-1 text-xs text-[#5EEAD4]">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Preferencias aplicadas</span>
                </span>
              )}
              <button
                type="button"
                onClick={onClose}
                className="px-3.5 py-2 rounded-lg border border-white/12 text-xs font-medium text-[#C8C3BA] hover:bg-white/5"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-lg bg-[#E5A93C] hover:bg-[#EDA949] text-[#0B0B0E] text-xs font-semibold"
              >
                Guardar configuración
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
