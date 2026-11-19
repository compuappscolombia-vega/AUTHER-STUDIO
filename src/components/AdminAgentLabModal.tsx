import { useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  Cpu,
  FlaskConical,
  Plus,
  Save,
  Sparkles,
  Trash2,
  UserCog,
  X,
} from 'lucide-react';
import type {
  AdminAgentProfile,
  AgentDiagnosticReport,
  LearningCategory,
  LearningLesson,
  ProductionProject,
  ProductionSequence,
} from '../types/studio';
import {
  DEFAULT_ADMIN_AGENT_PROFILE,
  computeSequenceDiagnostics,
  validateAdminDirective,
} from '../utils/adminAndStoryboardLogic';
import { LEARNING_CATEGORY_LABELS } from '../utils/learningEngine';

interface AdminAgentLabModalProps {
  open: boolean;
  userId: string;
  activeProject: ProductionProject | null;
  activeSequence: ProductionSequence | null;
  lessons: LearningLesson[];
  onClose: () => void;
  onAddLesson: (payload: {
    category: LearningCategory;
    insight: string;
    rating: number;
    sourceProjectTitle: string;
  }) => Promise<void>;
  onDeleteLesson: (lessonId: string) => Promise<void>;
  onProjectSeeded: (projects: ProductionProject[], seededProjectId: string) => void;
}

type LabTab = 'inspect' | 'teach' | 'audit';

interface ActiveModelItem {
  role: string;
  model: string;
}

export function AdminAgentLabModal({
  open,
  userId,
  activeProject,
  activeSequence,
  lessons,
  onClose,
  onAddLesson,
  onDeleteLesson,
  onProjectSeeded,
}: AdminAgentLabModalProps) {
  const [tab, setTab] = useState<LabTab>('inspect');
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [seedingProject, setSeedingProject] = useState(false);
  const [auditing, setAuditing] = useState(false);

  const [profile, setProfile] = useState<AdminAgentProfile>(DEFAULT_ADMIN_AGENT_PROFILE);
  const [baseInstruction, setBaseInstruction] = useState('');
  const [effectiveInstruction, setEffectiveInstruction] = useState('');
  const [activeModels, setActiveModels] = useState<ActiveModelItem[]>([]);
  const [diagnosticReport, setDiagnosticReport] = useState<AgentDiagnosticReport | null>(null);

  const [quickCategory, setQuickCategory] = useState<LearningCategory>('continuity');
  const [quickInsight, setQuickInsight] = useState('');
  const [quickRating, setQuickRating] = useState(5);
  const [addingLesson, setAddingLesson] = useState(false);
  const [taughtInsights, setTaughtInsights] = useState<Record<string, boolean>>({});

  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    async function loadAgentProfile() {
      setLoadingProfile(true);
      setError(null);
      try {
        const res = await fetch('/api/admin/agent-profile', {
          headers: { 'x-user-id': userId },
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'No se pudo cargar el perfil del agente.');
        }
        if (cancelled) return;
        if (data.profile) setProfile(data.profile as AdminAgentProfile);
        setBaseInstruction(String(data.baseSystemInstruction || ''));
        setEffectiveInstruction(String(data.effectiveSystemInstruction || ''));
        setActiveModels(Array.isArray(data.activeModels) ? data.activeModels : []);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Error cargando inspección.');
        }
      } finally {
        if (!cancelled) setLoadingProfile(false);
      }
    }
    void loadAgentProfile();
    return () => {
      cancelled = true;
    };
  }, [open, userId, lessons.length]);

  if (!open) return null;

  const localMetrics = computeSequenceDiagnostics(activeProject, activeSequence);

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    const check = validateAdminDirective(profile.customDirectives);
    if (!check.valid) {
      setError(check.error || 'Directiva inválida.');
      return;
    }

    setSavingProfile(true);
    try {
      const res = await fetch('/api/admin/agent-profile', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': userId,
        },
        body: JSON.stringify(profile),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'No se pudieron guardar las directivas.');
      }
      if (data.profile) setProfile(data.profile as AdminAgentProfile);
      if (data.effectiveSystemInstruction) {
        setEffectiveInstruction(String(data.effectiveSystemInstruction));
      }
      setNotice(
        'Directivas guardadas. El Agente Director las aplicará en cada nueva secuencia, storyboard de 4 frames y tráiler.'
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error guardando directivas.');
    } finally {
      setSavingProfile(false);
    }
  }

  async function handleSeedAuditProject() {
    setSeedingProject(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/admin/seed-audit-project', {
        method: 'POST',
        headers: { 'x-user-id': userId },
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'No se pudo cargar el proyecto de auditoría.');
      }
      if (Array.isArray(data.projects) && data.project) {
        onProjectSeeded(data.projects as ProductionProject[], data.project.id);
        setNotice(
          `Proyecto de auditoría "${data.project.title}" cargado. Ya puedes inspeccionar su Storyboard o auditar su secuencia.`
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error cargando proyecto de auditoría.');
    } finally {
      setSeedingProject(false);
    }
  }

  async function handleRunAudit() {
    if (!activeProject || !activeSequence) {
      setError('Selecciona o carga primero un proyecto con al menos una secuencia para auditar.');
      return;
    }
    setAuditing(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/admin/analyze-sequence', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': userId,
        },
        body: JSON.stringify({
          projectId: activeProject.id,
          sequenceId: activeSequence.id,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'No se pudo completar la auditoría con el Agente Crítico.');
      }
      setDiagnosticReport(data.report as AgentDiagnosticReport);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error en auditoría.');
    } finally {
      setAuditing(false);
    }
  }

  async function handleTeachLesson(payload: {
    category: LearningCategory;
    insight: string;
    rating: number;
    key?: string;
  }) {
    setAddingLesson(true);
    setError(null);
    setNotice(null);
    try {
      await onAddLesson({
        category: payload.category,
        insight: payload.insight,
        rating: payload.rating,
        sourceProjectTitle: activeProject?.title || 'Entrenamiento Administrador',
      });
      if (payload.key) {
        setTaughtInsights((prev) => ({ ...prev, [payload.key!]: true }));
      } else {
        setQuickInsight('');
      }
      setNotice('Regla incorporada a la memoria activa del Agente Director.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo enseñar la lección.');
    } finally {
      setAddingLesson(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="admin-lab-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4"
    >
      <div className="w-full max-w-4xl max-h-[90vh] flex flex-col rounded-xl border border-white/15 bg-[#121218] overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <UserCog className="w-5 h-5 text-[#E5A93C] shrink-0" />
            <div className="min-w-0">
              <h2 id="admin-lab-title" className="font-display text-lg font-semibold text-[#F2F0EB]">
                Laboratorio Administrador · Análisis y Entrenamiento del Agente
              </h2>
              <p className="text-xs text-[#8D8981] truncate">
                Inspecciona el razonamiento interno de AUTEUR, audita secuencias y enséñale directivas permanentes.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar laboratorio de administrador"
            className="p-2 rounded-lg text-[#9A968E] hover:text-[#F2F0EB] hover:bg-white/5 shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div
          role="tablist"
          aria-label="Secciones del Laboratorio Administrador"
          className="px-6 pt-3 border-b border-white/10 flex flex-wrap items-center gap-4 bg-[#0E0E13] shrink-0"
        >
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'inspect'}
            onClick={() => setTab('inspect')}
            className={`pb-3 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap inline-flex items-center gap-1.5 ${
              tab === 'inspect'
                ? 'border-[#E5A93C] text-[#F2F0EB]'
                : 'border-transparent text-[#8D8981] hover:text-[#E6E2DA]'
            }`}
          >
            <Cpu className="w-3.5 h-3.5" />
            <span>Inspección del Sistema</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'teach'}
            onClick={() => setTab('teach')}
            className={`pb-3 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap inline-flex items-center gap-1.5 ${
              tab === 'teach'
                ? 'border-[#E5A93C] text-[#F2F0EB]'
                : 'border-transparent text-[#8D8981] hover:text-[#E6E2DA]'
            }`}
          >
            <BookOpen className="w-3.5 h-3.5" />
            <span>Enseñanza y Directivas ({lessons.length})</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'audit'}
            onClick={() => setTab('audit')}
            className={`pb-3 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap inline-flex items-center gap-1.5 ${
              tab === 'audit'
                ? 'border-[#E5A93C] text-[#F2F0EB]'
                : 'border-transparent text-[#8D8981] hover:text-[#E6E2DA]'
            }`}
          >
            <FlaskConical className="w-3.5 h-3.5" />
            <span>Auditoría de Secuencia</span>
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {notice && (
            <div className="rounded-lg border border-[#38B2AC]/35 bg-[#122625] px-4 py-2.5 text-xs text-[#A7F3D0] flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{notice}</span>
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="rounded-lg border border-[#EF4444]/35 bg-[#3B1515]/50 px-4 py-2.5 text-xs text-[#FCA5A5] flex items-center gap-2"
            >
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {tab === 'inspect' && (
            <div className="space-y-5">
              {/* Audit Quick Seed Banner */}
              <div className="p-4 rounded-xl border border-[#E5A93C]/35 bg-[#19150E] flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-1 max-w-xl">
                  <div className="text-xs font-semibold text-[#F2F0EB]">
                    Banco de Pruebas del Administrador
                  </div>
                  <p className="text-xs text-[#C8C3BA] leading-relaxed">
                    Carga un proyecto cinematográfico de referencia (&ldquo;Crónicas de Bruma y Hierro&rdquo;)
                    en tu espacio Administrador para auditar su guion, probar el generador automático de
                    4 frames y validar tus enseñanzas.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleSeedAuditProject}
                  disabled={seedingProject}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#E5A93C] hover:bg-[#EDA949] disabled:opacity-60 text-[#0B0B0E] text-xs font-semibold whitespace-nowrap shrink-0"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>{seedingProject ? 'Cargando...' : 'Cargar proyecto de auditoría'}</span>
                </button>
              </div>

              {/* Active Model Stack */}
              <div className="space-y-2.5">
                <h3 className="text-xs font-semibold text-[#F2F0EB]">
                  Arquitectura de Modelos Activos
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                  {activeModels.map((item) => (
                    <div
                      key={item.role}
                      className="p-3 rounded-lg border border-white/10 bg-[#0B0B0E]"
                    >
                      <div className="text-[11px] text-[#8D8981]">{item.role}</div>
                      <div className="text-xs font-mono-tech text-[#E5A93C] mt-1">{item.model}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Effective System Instruction Inspection */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold text-[#F2F0EB]">
                    Prompt Maestro Ensamblado (Instrucción Base + Directivas Admin + Memoria)
                  </h3>
                  <span className="text-[11px] font-mono-tech text-[#8D8981]">
                    {loadingProfile ? 'Actualizando...' : `${effectiveInstruction.length} chars`}
                  </span>
                </div>
                <pre className="p-4 rounded-xl border border-white/10 bg-[#08080B] text-[11px] font-mono-tech text-[#C8C3BA] whitespace-pre-wrap leading-relaxed max-h-64 overflow-y-auto">
                  {effectiveInstruction || baseInstruction || 'Cargando instrucciones del Agente Director...'}
                </pre>
              </div>
            </div>
          )}

          {tab === 'teach' && (
            <div className="space-y-6">
              <form
                onSubmit={handleSaveProfile}
                className="p-4 rounded-xl border border-white/10 bg-[#0B0B0E] space-y-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-xs font-semibold text-[#F2F0EB]">
                      Reglas Maestras del Administrador (Inyectadas en Tiempo Real)
                    </h3>
                    <p className="text-[11px] text-[#8D8981] mt-0.5">
                      Lo que configures aquí modifica directamente las instrucciones del Agente Director.
                    </p>
                  </div>
                  <label className="inline-flex items-center gap-2 text-xs text-[#E6E2DA] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={profile.strictContinuityMode}
                      onChange={(e) =>
                        setProfile((prev) => ({
                          ...prev,
                          strictContinuityMode: e.target.checked,
                        }))
                      }
                      className="rounded border-white/20 bg-[#14141B] text-[#E5A93C]"
                    />
                    <span>Continuidad estricta</span>
                  </label>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label
                      htmlFor="admin-tone-input"
                      className="block text-[11px] font-medium text-[#9A968E] mb-1"
                    >
                      Tono editorial objetivo
                    </label>
                    <input
                      id="admin-tone-input"
                      type="text"
                      value={profile.targetAudienceTone}
                      onChange={(e) =>
                        setProfile((prev) => ({ ...prev, targetAudienceTone: e.target.value }))
                      }
                      className="w-full rounded-lg border border-white/12 bg-[#14141B] px-3 py-2 text-xs text-[#F2F0EB] focus:border-[#E5A93C] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="admin-grammar-input"
                      className="block text-[11px] font-medium text-[#9A968E] mb-1"
                    >
                      Gramática visual preferida
                    </label>
                    <input
                      id="admin-grammar-input"
                      type="text"
                      value={profile.preferredVisualGrammar}
                      onChange={(e) =>
                        setProfile((prev) => ({ ...prev, preferredVisualGrammar: e.target.value }))
                      }
                      className="w-full rounded-lg border border-white/12 bg-[#14141B] px-3 py-2 text-xs text-[#F2F0EB] focus:border-[#E5A93C] focus:outline-none"
                    />
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label
                      htmlFor="admin-directives-textarea"
                      className="block text-[11px] font-medium text-[#9A968E]"
                    >
                      Directivas de entrenamiento para el Agente Director
                    </label>
                    <span className="text-[11px] font-mono-tech text-[#8D8981] tabular-nums">
                      {profile.customDirectives.length}/2000
                    </span>
                  </div>
                  <textarea
                    id="admin-directives-textarea"
                    rows={3}
                    value={profile.customDirectives}
                    onChange={(e) =>
                      setProfile((prev) => ({ ...prev, customDirectives: e.target.value }))
                    }
                    placeholder="Ej: Prioriza planos sostenidos sin cortes rápidos en escenas intimistas; especifica siempre temperatura Kelvin en interiores y describe textura de piel sin suavizado artificial."
                    className="w-full rounded-lg border border-white/12 bg-[#14141B] p-2.5 text-xs text-[#F2F0EB] placeholder:text-[#6E6A63] focus:border-[#E5A93C] focus:outline-none"
                  />
                </div>

                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={savingProfile}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#E5A93C] hover:bg-[#EDA949] disabled:opacity-60 text-[#0B0B0E] text-xs font-semibold"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>{savingProfile ? 'Guardando...' : 'Guardar directivas de entrenamiento'}</span>
                  </button>
                </div>
              </form>

              {/* Quick Lesson Teaching */}
              <div className="p-4 rounded-xl border border-white/10 bg-[#0B0B0E] space-y-3">
                <h3 className="text-xs font-semibold text-[#F2F0EB]">
                  Enseñar lección específica a la memoria del estudio
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <select
                    aria-label="Categoría de enseñanza"
                    value={quickCategory}
                    onChange={(e) => setQuickCategory(e.target.value as LearningCategory)}
                    className="rounded-lg border border-white/12 bg-[#14141B] px-3 py-2 text-xs text-[#F2F0EB] focus:border-[#E5A93C] focus:outline-none"
                  >
                    {(Object.keys(LEARNING_CATEGORY_LABELS) as LearningCategory[]).map((cat) => (
                      <option key={cat} value={cat}>
                        {LEARNING_CATEGORY_LABELS[cat]}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="Prioridad de enseñanza"
                    value={quickRating}
                    onChange={(e) => setQuickRating(Number(e.target.value))}
                    className="rounded-lg border border-white/12 bg-[#14141B] px-3 py-2 text-xs text-[#F2F0EB] font-mono-tech focus:border-[#E5A93C] focus:outline-none"
                  >
                    <option value={5}>5/5 — Regla maestra obligatoria</option>
                    <option value={4}>4/5 — Muy recomendada</option>
                    <option value={3}>3/5 — Referencia útil</option>
                  </select>
                </div>
                <textarea
                  rows={2}
                  aria-label="Nueva observación para enseñar al agente"
                  value={quickInsight}
                  onChange={(e) => setQuickInsight(e.target.value)}
                  placeholder="Escribe una corrección concreta aprendida tras revisar secuencias del agente..."
                  className="w-full rounded-lg border border-white/12 bg-[#14141B] p-2.5 text-xs text-[#F2F0EB] placeholder:text-[#6E6A63] focus:border-[#E5A93C] focus:outline-none"
                />
                <div className="flex justify-end">
                  <button
                    type="button"
                    disabled={addingLesson || quickInsight.trim().length < 5}
                    onClick={() =>
                      void handleTeachLesson({
                        category: quickCategory,
                        insight: quickInsight,
                        rating: quickRating,
                      })
                    }
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-[#E5A93C]/45 bg-[#1B1812] hover:bg-[#272116] disabled:opacity-50 text-xs font-semibold text-[#F2F0EB]"
                  >
                    <Plus className="w-3.5 h-3.5 text-[#E5A93C]" />
                    <span>{addingLesson ? 'Enseñando...' : 'Enseñar lección al Agente'}</span>
                  </button>
                </div>
              </div>

              {/* Active Lessons List */}
              {lessons.length > 0 && (
                <div className="space-y-2">
                  <div className="text-xs font-medium text-[#9A968E]">
                    Lecciones activas en memoria ({lessons.length})
                  </div>
                  <div className="space-y-2 max-h-52 overflow-y-auto">
                    {lessons.map((lesson) => (
                      <div
                        key={lesson.id}
                        className="p-3 rounded-lg border border-white/10 bg-[#17171F] flex items-start justify-between gap-3"
                      >
                        <div className="space-y-1 min-w-0">
                          <div className="text-[11px] font-mono-tech text-[#E5A93C]">
                            {LEARNING_CATEGORY_LABELS[lesson.category]} · {lesson.rating}/5 ·{' '}
                            <span className="text-[#8D8981]">{lesson.sourceProjectTitle}</span>
                          </div>
                          <p className="text-xs text-[#EAE6DE] leading-relaxed">{lesson.insight}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => void onDeleteLesson(lesson.id)}
                          aria-label={`Eliminar lección ${lesson.id}`}
                          className="p-1.5 rounded hover:bg-white/5 text-[#8D8981] hover:text-[#FCA5A5] shrink-0"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {tab === 'audit' && (
            <div className="space-y-5">
              {/* Local Structural Readiness Metrics */}
              <div className="p-4 rounded-xl border border-white/10 bg-[#0B0B0E] space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-xs font-semibold text-[#F2F0EB]">
                      Diagnóstico Estructural de Secuencia Activa
                    </h3>
                    <p className="text-[11px] text-[#8D8981] mt-0.5">
                      {activeProject && activeSequence
                        ? `${activeProject.title} · ${activeSequence.title}`
                        : 'Sin secuencia seleccionada todavía.'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {!activeSequence && (
                      <button
                        type="button"
                        onClick={handleSeedAuditProject}
                        disabled={seedingProject}
                        className="px-3 py-2 rounded-lg border border-white/15 bg-[#181822] text-xs font-medium text-[#F2F0EB]"
                      >
                        Cargar proyecto de auditoría
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={handleRunAudit}
                      disabled={auditing || !activeSequence}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#E5A93C] hover:bg-[#EDA949] disabled:opacity-50 text-[#0B0B0E] text-xs font-semibold"
                    >
                      <Activity className="w-3.5 h-3.5" />
                      <span>
                        {auditing ? 'Auditando con Gemini...' : 'Auditar secuencia con Agente Crítico'}
                      </span>
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 text-xs">
                  <div className="p-2.5 rounded-lg border border-white/8 bg-[#121218]">
                    <div className="text-[11px] text-[#8D8981]">Índice</div>
                    <div className="font-mono-tech text-base font-semibold text-[#E5A93C] tabular-nums">
                      {localMetrics.readinessScore}%
                    </div>
                  </div>
                  <div className="p-2.5 rounded-lg border border-white/8 bg-[#121218]">
                    <div className="text-[11px] text-[#8D8981]">Planos</div>
                    <div className="font-mono-tech text-base font-semibold text-[#F2F0EB] tabular-nums">
                      {localMetrics.shotCount}
                    </div>
                  </div>
                  <div className="p-2.5 rounded-lg border border-white/8 bg-[#121218]">
                    <div className="text-[11px] text-[#8D8981]">Escenas</div>
                    <div className="font-mono-tech text-base font-semibold text-[#F2F0EB] tabular-nums">
                      {localMetrics.screenplaySceneCount}
                    </div>
                  </div>
                  <div className="p-2.5 rounded-lg border border-white/8 bg-[#121218]">
                    <div className="text-[11px] text-[#8D8981]">Storyboard</div>
                    <div className="font-mono-tech text-base font-semibold text-[#F2F0EB] tabular-nums">
                      {localMetrics.storyboardCount}
                    </div>
                  </div>
                  <div className="p-2.5 rounded-lg border border-white/8 bg-[#121218]">
                    <div className="text-[11px] text-[#8D8981]">Voces Off</div>
                    <div className="font-mono-tech text-base font-semibold text-[#F2F0EB] tabular-nums">
                      {localMetrics.voiceOverCount}
                    </div>
                  </div>
                  <div className="p-2.5 rounded-lg border border-white/8 bg-[#121218]">
                    <div className="text-[11px] text-[#8D8981]">Biblia</div>
                    <div className="font-mono-tech text-sm font-semibold text-[#38B2AC]">
                      {localMetrics.hasContinuityBible ? 'Activa' : 'Vacía'}
                    </div>
                  </div>
                </div>
              </div>

              {/* AI Critic Report */}
              {diagnosticReport && (
                <div className="space-y-4">
                  <div className="p-4 rounded-xl border border-[#E5A93C]/35 bg-[#15141A] space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-[#E5A93C]">
                        Dictamen del Supervisor Crítico
                      </span>
                      <span className="font-mono-tech text-sm font-semibold text-[#F2F0EB] tabular-nums">
                        Coherencia: {diagnosticReport.coherenceScore}/100
                      </span>
                    </div>
                    <p className="text-xs text-[#E6E2DA] leading-relaxed">
                      {diagnosticReport.summary}
                    </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                    <div className="p-3.5 rounded-lg border border-[#38B2AC]/30 bg-[#0F1B1A] space-y-1.5">
                      <div className="font-semibold text-[#5EEAD4]">Aciertos técnicos</div>
                      <ul className="space-y-1 text-[#C8C3BA] list-disc pl-4">
                        {diagnosticReport.strengths.map((s, i) => (
                          <li key={i}>{s}</li>
                        ))}
                      </ul>
                    </div>
                    <div className="p-3.5 rounded-lg border border-[#E5A93C]/30 bg-[#1B1710] space-y-1.5">
                      <div className="font-semibold text-[#F4C46A]">Puntos mejorables</div>
                      <ul className="space-y-1 text-[#C8C3BA] list-disc pl-4">
                        {diagnosticReport.weaknesses.map((w, i) => (
                          <li key={i}>{w}</li>
                        ))}
                      </ul>
                    </div>
                    <div className="p-3.5 rounded-lg border border-[#EF4444]/30 bg-[#241214] space-y-1.5">
                      <div className="font-semibold text-[#FCA5A5]">Riesgos de continuidad</div>
                      <ul className="space-y-1 text-[#C8C3BA] list-disc pl-4">
                        {diagnosticReport.continuityRisks.map((r, i) => (
                          <li key={i}>{r}</li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  {diagnosticReport.recommendedLessons.length > 0 && (
                    <div className="space-y-2.5">
                      <div className="text-xs font-semibold text-[#F2F0EB]">
                        Enseñanzas recomendadas tras la auditoría
                      </div>
                      {diagnosticReport.recommendedLessons.map((rec, idx) => {
                        const key = `rec-${idx}-${rec.insight.slice(0, 16)}`;
                        const taught = Boolean(taughtInsights[key]);
                        return (
                          <div
                            key={key}
                            className="p-3.5 rounded-lg border border-white/10 bg-[#0B0B0E] flex flex-wrap items-center justify-between gap-3"
                          >
                            <div className="space-y-1 max-w-2xl">
                              <div className="text-[11px] font-mono-tech text-[#E5A93C]">
                                {LEARNING_CATEGORY_LABELS[rec.category] || rec.category} · {rec.rating}/5
                              </div>
                              <p className="text-xs text-[#E6E2DA]">{rec.insight}</p>
                            </div>
                            <button
                              type="button"
                              disabled={taught || addingLesson}
                              onClick={() =>
                                void handleTeachLesson({
                                  category: rec.category,
                                  insight: rec.insight,
                                  rating: rec.rating,
                                  key,
                                })
                              }
                              className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap ${
                                taught
                                  ? 'bg-[#122625] text-[#5EEAD4] border border-[#38B2AC]/35'
                                  : 'bg-[#E5A93C] text-[#0B0B0E] hover:bg-[#EDA949]'
                              }`}
                            >
                              {taught ? 'Enseñada al Agente' : 'Enseñar esta regla'}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
