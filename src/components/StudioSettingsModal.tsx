import { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Film,
  Image as ImageIcon,
  KeyRound,
  PlugZap,
  RotateCcw,
  Server,
  ShieldCheck,
  Sliders,
  Trash2,
  X,
} from 'lucide-react';
import type {
  ApiBillingTier,
  ApiCapability,
  ApiProviderKind,
  ApiProviderPublicSummary,
  ResolutionTier,
  StudioSettings,
  ThinkingDepth,
  VoicePreset,
} from '../types/studio';
import {
  DEFAULT_STUDIO_SETTINGS,
  RESOLUTION_OPTIONS,
  VOICE_PRESET_OPTIONS,
} from '../utils/productionPipeline';
import { ASPECT_RATIO_OPTIONS, DIRECTOR_STYLES } from '../utils/studioLogic';
import {
  IMAGE_PROVIDER_PRESETS,
  VIDEO_PROVIDER_PRESETS,
  type ProviderPresetOption,
} from '../utils/apiProviders';
import { parseApiResponse } from '../utils/apiClient';

interface StudioSettingsModalProps {
  open: boolean;
  userId?: string;
  settings: StudioSettings;
  onClose: () => void;
  onSaveSettings: (next: StudioSettings) => void;
  onProvidersChanged?: (providers: Record<ApiCapability, ApiProviderPublicSummary>) => void;
}

interface ProviderFormState {
  providerHint: ApiProviderKind | 'auto';
  tierHint: ApiBillingTier;
  endpointUrl: string;
  apiKey: string;
  model: string;
  authHeader: string;
  authPrefix: string;
}

function createInitialProviderForm(summary?: ApiProviderPublicSummary): ProviderFormState {
  return {
    providerHint: summary?.providerKind || 'auto',
    tierHint:
      summary?.tier === 'free' || summary?.tier === 'paid' ? summary.tier : 'auto',
    endpointUrl: summary?.endpointUrl || '',
    apiKey: '',
    model: summary?.model || '',
    authHeader: summary?.authHeader || 'Authorization',
    authPrefix: summary?.authPrefix ?? 'Bearer ',
  };
}

export function StudioSettingsModal({
  open,
  userId = 'default',
  settings,
  onClose,
  onSaveSettings,
  onProvidersChanged,
}: StudioSettingsModalProps) {
  const [draft, setDraft] = useState<StudioSettings>(settings);
  const [healthLoading, setHealthLoading] = useState(false);
  const [geminiConfigured, setGeminiConfigured] = useState<boolean | null>(null);
  const [providers, setProviders] = useState<
    Record<ApiCapability, ApiProviderPublicSummary> | null
  >(null);
  const [imageForm, setImageForm] = useState<ProviderFormState>(createInitialProviderForm());
  const [videoForm, setVideoForm] = useState<ProviderFormState>(createInitialProviderForm());
  const [testingCap, setTestingCap] = useState<'image' | 'video' | null>(null);
  const [providerFeedback, setProviderFeedback] = useState<{
    image?: { ok: boolean; text: string };
    video?: { ok: boolean; text: string };
  }>({});
  const [savedNotice, setSavedNotice] = useState(false);

  useEffect(() => {
    setDraft(settings);
  }, [settings, open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setHealthLoading(true);
    setProviderFeedback({});

    fetch('/api/health', { headers: { 'x-user-id': userId } })
      .then((res) => res.json())
      .then(
        (data: {
          ok?: boolean;
          geminiConfigured?: boolean;
          providers?: Record<ApiCapability, ApiProviderPublicSummary>;
        }) => {
          if (cancelled) return;
          setGeminiConfigured(Boolean(data.geminiConfigured));
          if (data.providers) {
            setProviders(data.providers);
            setImageForm(createInitialProviderForm(data.providers.image));
            setVideoForm(createInitialProviderForm(data.providers.video));
          }
        }
      )
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
  }, [open, userId, onClose]);

  if (!open) return null;

  function applyPreset(
    capability: 'image' | 'video',
    presetId: ApiProviderKind | 'auto',
    presets: ProviderPresetOption[]
  ) {
    const found = presets.find((p) => p.id === presetId);
    const setter = capability === 'image' ? setImageForm : setVideoForm;
    setter((prev) => ({
      ...prev,
      providerHint: presetId,
      endpointUrl: found?.defaultEndpointUrl || (presetId === 'auto' ? prev.endpointUrl : ''),
      model: found?.defaultModel || (presetId === 'auto' ? prev.model : ''),
      tierHint:
        found?.tierLabel === 'Free'
          ? 'free'
          : found?.tierLabel === 'Pago'
            ? 'paid'
            : 'auto',
      authHeader: presetId === 'gemini' ? 'x-goog-api-key' : 'Authorization',
      authPrefix:
        presetId === 'gemini' ? '' : presetId === 'fal' ? 'Key ' : 'Bearer ',
    }));
  }

  async function handleDetectAndSaveProvider(capability: 'image' | 'video') {
    const form = capability === 'image' ? imageForm : videoForm;
    setTestingCap(capability);
    setProviderFeedback((prev) => ({ ...prev, [capability]: undefined }));
    try {
      const res = await fetch('/api/providers/detect', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': userId,
        },
        body: JSON.stringify({
          capability,
          providerHint: form.providerHint,
          tierHint: form.tierHint,
          endpointUrl: form.endpointUrl,
          apiKey: form.apiKey,
          model: form.model,
          authHeader: form.authHeader,
          authPrefix: form.authPrefix,
          save: true,
        }),
      });
      const data = await parseApiResponse<{
        summary: ApiProviderPublicSummary;
        providers: Record<ApiCapability, ApiProviderPublicSummary>;
        diagnostics: string;
      }>(res, `Error verificando la API de ${capability === 'image' ? 'imágenes' : 'video'}`);

      setProviders(data.providers);
      onProvidersChanged?.(data.providers);
      if (capability === 'image') {
        setImageForm(createInitialProviderForm(data.providers.image));
      } else {
        setVideoForm(createInitialProviderForm(data.providers.video));
      }
      setProviderFeedback((prev) => ({
        ...prev,
        [capability]: { ok: true, text: data.diagnostics },
      }));
    } catch (err) {
      setProviderFeedback((prev) => ({
        ...prev,
        [capability]: {
          ok: false,
          text: err instanceof Error ? err.message : 'No se pudo validar el proveedor.',
        },
      }));
    } finally {
      setTestingCap(null);
    }
  }

  async function handleDisconnectProvider(capability: 'image' | 'video') {
    setTestingCap(capability);
    try {
      const res = await fetch(`/api/providers/${capability}`, {
        method: 'DELETE',
        headers: { 'x-user-id': userId },
      });
      const data = await parseApiResponse<{
        providers: Record<ApiCapability, ApiProviderPublicSummary>;
      }>(res, 'No se pudo desconectar el proveedor');
      setProviders(data.providers);
      onProvidersChanged?.(data.providers);
      if (capability === 'image') {
        setImageForm(createInitialProviderForm(data.providers.image));
      } else {
        setVideoForm(createInitialProviderForm(data.providers.video));
      }
      setProviderFeedback((prev) => ({
        ...prev,
        [capability]: { ok: true, text: 'Proveedor desconectado. Ninguna API predeterminada activa.' },
      }));
    } catch (err) {
      setProviderFeedback((prev) => ({
        ...prev,
        [capability]: {
          ok: false,
          text: err instanceof Error ? err.message : 'Error desconectando proveedor.',
        },
      }));
    } finally {
      setTestingCap(null);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSaveSettings(draft);
    setSavedNotice(true);
    setTimeout(() => {
      setSavedNotice(false);
      onClose();
    }, 600);
  }

  function handleReset() {
    setDraft(DEFAULT_STUDIO_SETTINGS);
  }

  function renderProviderCard(
    capability: 'image' | 'video',
    title: string,
    presets: ProviderPresetOption[],
    form: ProviderFormState,
    setForm: React.Dispatch<React.SetStateAction<ProviderFormState>>
  ) {
    const summary = providers?.[capability];
    const feedback = providerFeedback[capability];
    const isBusy = testingCap === capability;
    const Icon = capability === 'image' ? ImageIcon : Film;

    return (
      <div className="p-4 rounded-xl border border-[#DCD6CA] dark:border-white/12 bg-[#FAF8F4] dark:bg-[#0D0D12] space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-[#18181B] dark:text-[#F2F0EB]">
            <Icon className="w-4 h-4 text-amber-600 dark:text-[#E5A93C]" />
            <span>{title}</span>
          </div>

          <div className="flex items-center gap-2 text-[11px] font-mono-tech">
            {summary?.configured ? (
              <>
                <span className="text-teal-700 dark:text-[#5EEAD4]">
                  {summary.label}
                </span>
                <span className="text-[#57534E] dark:text-[#8D8981]">·</span>
                <span className="text-amber-700 dark:text-[#E5A93C] uppercase">
                  {summary.tier === 'free'
                    ? 'FREE'
                    : summary.tier === 'paid'
                      ? 'PAGO'
                      : 'AUTO'}
                </span>
              </>
            ) : (
              <span className="text-amber-700 dark:text-[#F59E0B]">
                Sin asignar (suministra tu API)
              </span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label
              htmlFor={`prov-preset-${capability}`}
              className="block text-[11px] font-medium text-[#3F3F46] dark:text-[#C8C3BA] mb-1"
            >
              Proveedor / Modo de Detección
            </label>
            <select
              id={`prov-preset-${capability}`}
              value={form.providerHint}
              onChange={(e) =>
                applyPreset(capability, e.target.value as ApiProviderKind | 'auto', presets)
              }
              className="w-full rounded-lg border border-[#D6D1C7] dark:border-white/12 bg-[#FFFFFF] dark:bg-[#0B0B0E] px-2.5 py-1.5 text-xs text-[#18181B] dark:text-[#F2F0EB] focus:border-[#E5A93C] focus:outline-none"
            >
              {presets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor={`prov-tier-${capability}`}
              className="block text-[11px] font-medium text-[#3F3F46] dark:text-[#C8C3BA] mb-1"
            >
              Tipo de API (Free o de Pago)
            </label>
            <select
              id={`prov-tier-${capability}`}
              value={form.tierHint}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, tierHint: e.target.value as ApiBillingTier }))
              }
              className="w-full rounded-lg border border-[#D6D1C7] dark:border-white/12 bg-[#FFFFFF] dark:bg-[#0B0B0E] px-2.5 py-1.5 text-xs text-[#18181B] dark:text-[#F2F0EB] focus:border-[#E5A93C] focus:outline-none"
            >
              <option value="auto">Auto-detectar automáticamente</option>
              <option value="free">API Gratuita / Free Tier</option>
              <option value="paid">API de Pago / Facturación Activa</option>
            </select>
          </div>

          <div className="sm:col-span-2">
            <label
              htmlFor={`prov-url-${capability}`}
              className="block text-[11px] font-medium text-[#3F3F46] dark:text-[#C8C3BA] mb-1"
            >
              URL del Endpoint HTTPS (o deja vacío si usas clave Gemini / HuggingFace / Replicate)
            </label>
            <input
              id={`prov-url-${capability}`}
              type="url"
              value={form.endpointUrl}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, endpointUrl: e.target.value }))
              }
              placeholder={
                presets.find((p) => p.id === form.providerHint)?.placeholderUrl ||
                'https://...'
              }
              className="w-full rounded-lg border border-[#D6D1C7] dark:border-white/12 bg-[#FFFFFF] dark:bg-[#0B0B0E] px-2.5 py-1.5 text-xs font-mono-tech text-[#18181B] dark:text-[#F2F0EB] focus:border-[#E5A93C] focus:outline-none"
            />
          </div>

          <div>
            <label
              htmlFor={`prov-key-${capability}`}
              className="block text-[11px] font-medium text-[#3F3F46] dark:text-[#C8C3BA] mb-1"
            >
              API Key / Token {summary?.hasKey ? `(actual: ${summary.keyPreview})` : '(opcional si es Free sin clave)'}
            </label>
            <div className="relative">
              <KeyRound className="w-3.5 h-3.5 text-[#78746C] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                id={`prov-key-${capability}`}
                type="password"
                autoComplete="off"
                value={form.apiKey}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, apiKey: e.target.value }))
                }
                placeholder={
                  summary?.hasKey
                    ? 'Dejar vacío para conservar clave cifrada'
                    : 'Pega aquí tu clave (hf_..., r8_..., AIza..., sk-...)'
                }
                className="w-full rounded-lg border border-[#D6D1C7] dark:border-white/12 bg-[#FFFFFF] dark:bg-[#0B0B0E] pl-8 pr-2.5 py-1.5 text-xs font-mono-tech text-[#18181B] dark:text-[#F2F0EB] focus:border-[#E5A93C] focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor={`prov-model-${capability}`}
              className="block text-[11px] font-medium text-[#3F3F46] dark:text-[#C8C3BA] mb-1"
            >
              Modelo (opcional / auto)
            </label>
            <input
              id={`prov-model-${capability}`}
              type="text"
              value={form.model}
              onChange={(e) => setForm((prev) => ({ ...prev, model: e.target.value }))}
              placeholder={
                capability === 'image'
                  ? 'Ej. flux, FLUX.1-schnell, gpt-image-1...'
                  : 'Ej. Wan2.1-T2V-14B, kling, sora-2...'
              }
              className="w-full rounded-lg border border-[#D6D1C7] dark:border-white/12 bg-[#FFFFFF] dark:bg-[#0B0B0E] px-2.5 py-1.5 text-xs font-mono-tech text-[#18181B] dark:text-[#F2F0EB] focus:border-[#E5A93C] focus:outline-none"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={isBusy}
              onClick={() => handleDetectAndSaveProvider(capability)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#E5A93C] hover:bg-[#EDA949] disabled:opacity-60 text-[#0B0B0E] text-xs font-semibold whitespace-nowrap shrink-0"
            >
              <PlugZap className="w-3.5 h-3.5" />
              <span>
                {isBusy ? 'Verificando...' : 'Detectar, Probar y Guardar API'}
              </span>
            </button>

            {summary?.configured && summary.source === 'user_vault' && (
              <button
                type="button"
                disabled={isBusy}
                onClick={() => handleDisconnectProvider(capability)}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[#D6D1C7] dark:border-white/15 bg-[#FFFFFF] dark:bg-[#16161E] hover:bg-rose-50 dark:hover:bg-rose-950/30 text-xs font-medium text-[#57534E] hover:text-rose-700 dark:text-[#9A968E] dark:hover:text-rose-300 whitespace-nowrap shrink-0"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Desconectar</span>
              </button>
            )}
          </div>

          {summary?.configured && (
            <span className="text-[11px] font-mono-tech text-[#57534E] dark:text-[#8D8981] truncate max-w-[260px]">
              Modelo: {summary.model || 'automático'}
            </span>
          )}
        </div>

        {(feedback?.text || summary?.lastMessage) && (
          <p
            className={`text-[11px] leading-relaxed ${
              feedback
                ? feedback.ok
                  ? 'text-teal-700 dark:text-[#5EEAD4]'
                  : 'text-rose-700 dark:text-rose-300'
                : 'text-[#57534E] dark:text-[#9A968E]'
            }`}
          >
            {feedback ? feedback.text : summary?.lastMessage}
          </p>
        )}
      </div>
    );
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="studio-settings-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 dark:bg-black/80"
    >
      <div className="w-full max-w-3xl rounded-xl border border-[#DCD6CA] dark:border-white/15 bg-[#FFFFFF] dark:bg-[#121217] overflow-hidden shadow-2xl max-h-[92vh] flex flex-col">
        <div className="px-5 py-4 border-b border-[#E2DDD3] dark:border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sliders className="w-4 h-4 text-amber-600 dark:text-[#E5A93C]" />
            <h2
              id="studio-settings-title"
              className="font-display text-base font-semibold text-[#18181B] dark:text-[#F2F0EB]"
            >
              Configuración del Estudio y Proveedores de API (Free / Pago)
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar configuración"
            className="p-1.5 rounded-lg text-[#57534E] dark:text-[#9A968E] hover:text-[#18181B] dark:hover:text-[#F2F0EB] hover:bg-black/5 dark:hover:bg-white/10"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 overflow-y-auto space-y-5">
          {/* Core Agente Arthur Status + Security Architecture Notice */}
          <div className="p-4 rounded-xl border border-[#DCD6CA] dark:border-white/10 bg-[#FAF8F4] dark:bg-[#0D0D12] space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-[#18181B] dark:text-[#F2F0EB]">
                <Server className="w-4 h-4 text-amber-600 dark:text-[#E5A93C]" />
                <span>Motor Principal Agente Arthur (Guion, Planos y Guía Externa)</span>
              </div>
              <span
                className={`text-[11px] font-mono-tech ${
                  healthLoading
                    ? 'text-[#57534E] dark:text-[#9A968E]'
                    : geminiConfigured
                      ? 'text-teal-700 dark:text-[#5EEAD4]'
                      : 'text-amber-700 dark:text-[#F59E0B]'
                }`}
              >
                {healthLoading
                  ? 'Verificando...'
                  : geminiConfigured
                    ? 'Agente Arthur Activo'
                    : 'Pendiente en servidor'}
              </span>
            </div>
            <p className="text-xs text-[#52525B] dark:text-[#A7A299] leading-relaxed">
              Las APIs de generación de <strong>Imágenes</strong> y <strong>Videos</strong> ya no
              están predeterminadas a un único servicio de pago: suministra abajo cualquier API
              gratuita (free) o de pago. Las claves se cifran en la bóveda del servidor (AES-256) y
              nunca se exponen en el navegador.
            </p>
            <div className="flex items-center gap-2 text-[11px] text-[#57534E] dark:text-[#8D8981]">
              <ShieldCheck className="w-3.5 h-3.5 text-teal-600 dark:text-[#38B2AC] shrink-0" />
              <span>
                Ejecución Proxy Segura HTTPS · Detección automática Free vs Pago · Compatibilidad
                universal REST
              </span>
            </div>
          </div>

          {/* Flexible Image & Video API Configurators */}
          <div className="space-y-4">
            {renderProviderCard(
              'image',
              'API de Generación de Imágenes (Storyboard y Tráiler)',
              IMAGE_PROVIDER_PRESETS,
              imageForm,
              setImageForm
            )}
            {renderProviderCard(
              'video',
              'API de Generación de Videos (Clips y Tráiler 30s)',
              VIDEO_PROVIDER_PRESETS,
              videoForm,
              setVideoForm
            )}
          </div>

          {/* Master Resolution Preset */}
          <div>
            <span className="block text-xs font-medium text-[#3F3F46] dark:text-[#C8C3BA] mb-2">
              Resolución Maestra Hiperrealista por Defecto (Prompts y Storyboard)
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
                        ? 'border-amber-600 dark:border-[#E5A93C] bg-amber-50 dark:bg-[#1E1A12] text-[#18181B] dark:text-[#F2F0EB]'
                        : 'border-[#DCD6CA] dark:border-white/10 bg-[#FAF8F4] dark:bg-[#0B0B0E] hover:border-amber-600/40 dark:hover:border-white/25 text-[#3F3F46] dark:text-[#C8C3BA]'
                    }`}
                  >
                    <div className="font-mono-tech text-xs font-semibold text-amber-700 dark:text-[#E5A93C]">
                      {opt.value}
                    </div>
                    <div className="text-[11px] font-medium text-[#18181B] dark:text-[#F2F0EB] mt-0.5">
                      {opt.label}
                    </div>
                    <div className="text-[10px] font-mono-tech text-[#57534E] dark:text-[#8D8981] mt-0.5 tabular-nums">
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
                className="block text-xs font-medium text-[#3F3F46] dark:text-[#C8C3BA] mb-1.5"
              >
                Estilo de Dirección Predeterminado
              </label>
              <select
                id="settings-director-style"
                value={draft.defaultDirectorStyle}
                onChange={(e) =>
                  setDraft((prev) => ({ ...prev, defaultDirectorStyle: e.target.value }))
                }
                className="w-full rounded-lg border border-[#D6D1C7] dark:border-white/12 bg-[#FFFFFF] dark:bg-[#0B0B0E] px-3 py-2 text-xs text-[#18181B] dark:text-[#F2F0EB] focus:border-[#E5A93C] focus:outline-none"
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
                className="block text-xs font-medium text-[#3F3F46] dark:text-[#C8C3BA] mb-1.5"
              >
                Relación de Aspecto Predeterminada
              </label>
              <select
                id="settings-aspect-ratio"
                value={draft.defaultAspectRatio}
                onChange={(e) =>
                  setDraft((prev) => ({ ...prev, defaultAspectRatio: e.target.value }))
                }
                className="w-full rounded-lg border border-[#D6D1C7] dark:border-white/12 bg-[#FFFFFF] dark:bg-[#0B0B0E] px-3 py-2 text-xs text-[#18181B] dark:text-[#F2F0EB] font-mono-tech focus:border-[#E5A93C] focus:outline-none"
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
                className="block text-xs font-medium text-[#3F3F46] dark:text-[#C8C3BA] mb-1.5"
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
                className="w-full rounded-lg border border-[#D6D1C7] dark:border-white/12 bg-[#FFFFFF] dark:bg-[#0B0B0E] px-3 py-2 text-xs text-[#18181B] dark:text-[#F2F0EB] focus:border-[#E5A93C] focus:outline-none"
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
                className="block text-xs font-medium text-[#3F3F46] dark:text-[#C8C3BA] mb-1.5"
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
                className="w-full rounded-lg border border-[#D6D1C7] dark:border-white/12 bg-[#FFFFFF] dark:bg-[#0B0B0E] px-3 py-2 text-xs text-[#18181B] dark:text-[#F2F0EB] focus:border-[#E5A93C] focus:outline-none"
              >
                <option value="standard">Estándar (Ágil)</option>
                <option value="deep">Profundo (Máximo detalle técnico)</option>
              </select>
            </div>
          </div>

          <div className="pt-3 border-t border-[#E2DDD3] dark:border-white/10 flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={handleReset}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[#D6D1C7] dark:border-white/12 bg-[#FAF8F4] dark:bg-[#16161E] hover:bg-[#EFECE4] dark:hover:bg-[#1E1E28] text-xs font-medium text-[#3F3F46] dark:text-[#C8C3BA]"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Restaurar valores de estudio</span>
            </button>

            <div className="flex items-center gap-2">
              {savedNotice && (
                <span className="inline-flex items-center gap-1 text-xs text-teal-700 dark:text-[#5EEAD4]">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Preferencias aplicadas</span>
                </span>
              )}
              <button
                type="button"
                onClick={onClose}
                className="px-3.5 py-2 rounded-lg border border-[#D6D1C7] dark:border-white/12 text-xs font-medium text-[#3F3F46] dark:text-[#C8C3BA] hover:bg-black/5 dark:hover:bg-white/5"
              >
                Cerrar
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-lg bg-[#E5A93C] hover:bg-[#EDA949] text-[#0B0B0E] text-xs font-semibold"
              >
                Guardar preferencias
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
