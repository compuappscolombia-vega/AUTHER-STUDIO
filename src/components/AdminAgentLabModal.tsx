import { useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BookOpen,
  Check,
  CheckCircle2,
  Clapperboard,
  Copy,
  Cpu,
  FlaskConical,
  PlugZap,
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
  ApiCapability,
  ApiProviderPublicSummary,
  FrameoMcpToolSummary,
  LearningCategory,
  LearningLesson,
  ProductionProject,
  ProductionSequence,
} from '../types/studio';
import {
  DEFAULT_ADMIN_AGENT_PROFILE,
  FRAMEO_MODEL_CATALOG,
  FRAMEO_STYLE_PRESETS,
  FRAMEO_VFX_MANTO_MODES,
  buildFrameoShotFilename,
  computeSequenceDiagnostics,
  validateAdminDirective,
} from '../utils/adminAndStoryboardLogic';
import { LEARNING_CATEGORY_LABELS } from '../utils/learningEngine';

interface AdminAgentLabModalProps {
  open: boolean;
  adminToken: string | null;
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
  onEnsureProjectSynced: () => Promise<void>;
  onProjectUpdated: (project: ProductionProject) => Promise<void>;
  onProvidersChanged?: (providers: Record<ApiCapability, ApiProviderPublicSummary>) => void;
}

type LabTab = 'inspect' | 'teach' | 'audit' | 'frameo';

interface ActiveModelItem {
  role: string;
  model: string;
}

export function AdminAgentLabModal({
  open,
  adminToken,
  userId,
  activeProject,
  activeSequence,
  lessons,
  onClose,
  onAddLesson,
  onDeleteLesson,
  onProjectSeeded,
  onEnsureProjectSynced,
  onProjectUpdated,
  onProvidersChanged,
}: AdminAgentLabModalProps) {
  const [tab, setTab] = useState<LabTab>('inspect');
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [seedingProject, setSeedingProject] = useState(false);
  const [auditing, setAuditing] = useState(false);
  const [generatingFrameo, setGeneratingFrameo] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const [profile, setProfile] = useState<AdminAgentProfile>(DEFAULT_ADMIN_AGENT_PROFILE);
  const [baseInstruction, setBaseInstruction] = useState('');
  const [effectiveInstruction, setEffectiveInstruction] = useState('');
  const [activeModels, setActiveModels] = useState<ActiveModelItem[]>([]);
  const [diagnosticReport, setDiagnosticReport] = useState<AgentDiagnosticReport | null>(null);

  // Frameo.AI MCP (https://mcp.frameo.ai/mcp) OAuth & Tool State
  const [frameoEndpointUrl, setFrameoEndpointUrl] = useState('https://mcp.frameo.ai/mcp');
  const [frameoApiKey, setFrameoApiKey] = useState('');
  const [frameoModelName, setFrameoModelName] = useState<string>(FRAMEO_MODEL_CATALOG[0]);
  const [savingFrameoConn, setSavingFrameoConn] = useState(false);
  const [frameoConnSummary, setFrameoConnSummary] = useState<ApiProviderPublicSummary | null>(null);
  const [mcpConnected, setMcpConnected] = useState(false);
  const [mcpServerName, setMcpServerName] = useState('Frameo.AI MCP');
  const [mcpTools, setMcpTools] = useState<FrameoMcpToolSummary[]>([]);
  const [mcpBusy, setMcpBusy] = useState(false);
  const [mcpPopupFallbackUrl, setMcpPopupFallbackUrl] = useState<string | null>(null);
  const [selectedMcpTool, setSelectedMcpTool] = useState('');
  const [mcpToolArgsJson, setMcpToolArgsJson] = useState('{}');
  const [mcpToolResultText, setMcpToolResultText] = useState<string | null>(null);

  const [quickCategory, setQuickCategory] = useState<LearningCategory>('continuity');
  const [quickInsight, setQuickInsight] = useState('');
  const [quickRating, setQuickRating] = useState(5);
  const [addingLesson, setAddingLesson] = useState(false);
  const [taughtInsights, setTaughtInsights] = useState<Record<string, boolean>>({});

  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !adminToken) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, adminToken, onClose]);

  useEffect(() => {
    if (!open || !adminToken) return;
    function onOAuthMessage(event: MessageEvent) {
      const origin = event.origin || '';
      if (
        origin !== window.location.origin &&
        !origin.endsWith('.run.app') &&
        !origin.includes('localhost')
      ) {
        return;
      }
      const data = event.data as {
        type?: string;
        toolsCount?: number;
        serverName?: string;
        providers?: Record<ApiCapability, ApiProviderPublicSummary>;
        error?: string;
      } | null;
      if (!data || typeof data !== 'object') return;
      if (data.type === 'FRAMEO_MCP_OAUTH_SUCCESS') {
        setMcpPopupFallbackUrl(null);
        setMcpConnected(true);
        if (data.serverName) setMcpServerName(data.serverName);
        if (data.providers) {
          onProvidersChanged?.(data.providers);
          if (data.providers.frameo_video) {
            setFrameoConnSummary(data.providers.frameo_video);
          }
        }
        setNotice(
          `Frameo.AI MCP conectado vía OAuth (${data.toolsCount ?? 0} herramientas sincronizadas).`
        );
        void fetchFrameoMcpStatus();
      } else if (data.type === 'FRAMEO_MCP_OAUTH_ERROR') {
        setError(data.error || 'No se pudo completar la autenticación OAuth en Frameo.AI.');
      }
    }
    window.addEventListener('message', onOAuthMessage);
    return () => window.removeEventListener('message', onOAuthMessage);
  }, [open, adminToken]);

  async function fetchFrameoMcpStatus() {
    if (!adminToken) return;
    try {
      const res = await fetch('/api/admin/frameo-mcp/status', {
        headers: {
          'x-user-id': userId,
          Authorization: `Bearer ${adminToken}`,
        },
      });
      const data = await res.json();
      if (!res.ok) return;
      if (data.status) {
        setMcpConnected(Boolean(data.status.connected));
        if (data.status.serverName) setMcpServerName(String(data.status.serverName));
        if (Array.isArray(data.status.tools)) {
          setMcpTools(data.status.tools);
          if (data.status.tools.length > 0 && !selectedMcpTool) {
            setSelectedMcpTool(data.status.tools[0].name);
          }
        }
      }
      if (data.providers) {
        onProvidersChanged?.(data.providers as Record<ApiCapability, ApiProviderPublicSummary>);
        if (data.providers.frameo_video) {
          setFrameoConnSummary(data.providers.frameo_video as ApiProviderPublicSummary);
        }
      }
    } catch {
      // Ignore background refresh failure
    }
  }

  useEffect(() => {
    if (!open || !adminToken) return;
    let cancelled = false;
    async function loadAgentProfile() {
      setLoadingProfile(true);
      setError(null);
      try {
        const res = await fetch('/api/admin/agent-profile', {
          headers: {
            'x-user-id': userId,
            Authorization: `Bearer ${adminToken}`,
          },
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
        const frameoSummary = data.providers?.frameo_video as
          | ApiProviderPublicSummary
          | undefined;
        if (frameoSummary) {
          setFrameoConnSummary(frameoSummary);
          if (frameoSummary.endpointUrl) setFrameoEndpointUrl(frameoSummary.endpointUrl);
          if (frameoSummary.model) setFrameoModelName(frameoSummary.model);
        }
        if (data.frameoMcpStatus) {
          setMcpConnected(Boolean(data.frameoMcpStatus.connected));
          if (data.frameoMcpStatus.serverName) {
            setMcpServerName(String(data.frameoMcpStatus.serverName));
          }
          if (Array.isArray(data.frameoMcpStatus.tools)) {
            setMcpTools(data.frameoMcpStatus.tools);
            if (data.frameoMcpStatus.tools.length > 0) {
              setSelectedMcpTool(data.frameoMcpStatus.tools[0].name);
            }
          }
        }
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
  }, [open, adminToken, userId, lessons.length]);

  if (!open || !adminToken) return null;

  const localMetrics = computeSequenceDiagnostics(activeProject, activeSequence);

  async function persistAdminProfile(nextProfile: AdminAgentProfile, successMsg: string) {
    if (!adminToken) return;
    setError(null);
    setNotice(null);
    const check = validateAdminDirective(nextProfile.customDirectives);
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
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify(nextProfile),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'No se pudieron guardar las directivas.');
      }
      if (data.profile) setProfile(data.profile as AdminAgentProfile);
      if (data.effectiveSystemInstruction) {
        setEffectiveInstruction(String(data.effectiveSystemInstruction));
      }
      setNotice(successMsg);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error guardando configuración.');
    } finally {
      setSavingProfile(false);
    }
  }

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    await persistAdminProfile(
      profile,
      'Directivas guardadas. El Agente Director las aplicará en cada nueva secuencia, storyboard de 4 frames y tráiler.'
    );
  }

  async function handleSaveFrameoSettings(e: React.FormEvent) {
    e.preventDefault();
    await persistAdminProfile(
      profile,
      'Configuración de ArthurAgent · Frameo IA guardada para el perfil Administrador.'
    );
  }

  async function handleGenerateFrameoPackage() {
    if (!adminToken) return;
    if (!activeProject || !activeSequence) {
      setError('Selecciona o carga primero un proyecto con al menos una secuencia.');
      return;
    }
    setGeneratingFrameo(true);
    setError(null);
    setNotice(null);
    try {
      await onEnsureProjectSynced();
      const res = await fetch('/api/admin/generate-frameo-package', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': userId,
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          projectId: activeProject.id,
          sequenceId: activeSequence.id,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'No se pudo generar el paquete Frameo IA.');
      }
      if (data.project) {
        await onProjectUpdated(data.project as ProductionProject);
      }
      setNotice(
        `Paquete Frameo IA generado para "${activeSequence.title}" (${data.frameoProductionSpec?.scenes?.length || 0} escenas listas).`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error generando paquete Frameo IA.');
    } finally {
      setGeneratingFrameo(false);
    }
  }

  async function handleSaveFrameoConnector(e: React.FormEvent) {
    e.preventDefault();
    if (!adminToken) return;
    if (!frameoEndpointUrl.trim() && !frameoApiKey.trim()) {
      setError('Ingresa al menos la URL del endpoint privado o la clave API compatible con Frameo IA.');
      return;
    }
    setSavingFrameoConn(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/providers/detect', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': userId,
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          capability: 'frameo_video',
          providerHint: 'auto',
          tierHint: 'paid',
          label: 'Frameo IA · Servicio de Video Admin',
          endpointUrl: frameoEndpointUrl.trim(),
          apiKey: frameoApiKey.trim(),
          model: frameoModelName.trim() || 'frameo-cinema-v1',
          save: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'No se pudo validar el conector privado de Frameo IA.');
      }
      if (data.providers) {
        onProvidersChanged?.(data.providers as Record<ApiCapability, ApiProviderPublicSummary>);
        if (data.providers.frameo_video) {
          setFrameoConnSummary(data.providers.frameo_video as ApiProviderPublicSummary);
        }
      }
      setFrameoApiKey('');
      setNotice(
        data.diagnostics ||
          data.message ||
          'Conector privado Frameo IA almacenado en la bóveda del Administrador.'
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error conectando API privada de Frameo IA.');
    } finally {
      setSavingFrameoConn(false);
    }
  }

  async function handleDisconnectFrameoConnector() {
    if (!adminToken) return;
    setSavingFrameoConn(true);
    setError(null);
    setNotice(null);
    try {
      await fetch('/api/admin/frameo-mcp/disconnect', {
        method: 'DELETE',
        headers: {
          'x-user-id': userId,
          Authorization: `Bearer ${adminToken}`,
        },
      }).catch(() => null);

      const res = await fetch('/api/providers/frameo_video', {
        method: 'DELETE',
        headers: {
          'x-user-id': userId,
          Authorization: `Bearer ${adminToken}`,
        },
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'No se pudo desconectar el servicio Frameo IA.');
      }
      if (data.providers) {
        onProvidersChanged?.(data.providers as Record<ApiCapability, ApiProviderPublicSummary>);
        setFrameoConnSummary((data.providers.frameo_video as ApiProviderPublicSummary) || null);
      }
      setMcpConnected(false);
      setMcpTools([]);
      setMcpPopupFallbackUrl(null);
      setFrameoEndpointUrl('https://mcp.frameo.ai/mcp');
      setNotice('Servicio de video Frameo IA / MCP desconectado.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconectando servicio Frameo IA.');
    } finally {
      setSavingFrameoConn(false);
    }
  }

  async function handleConnectFrameoOAuth() {
    if (!adminToken) return;
    setMcpBusy(true);
    setError(null);
    setNotice(null);
    setMcpPopupFallbackUrl(null);
    try {
      const targetUrl = frameoEndpointUrl.trim() || 'https://mcp.frameo.ai/mcp';
      const qs = new URLSearchParams({
        mcpUrl: targetUrl,
        origin: window.location.origin,
      });
      const res = await fetch(`/api/admin/frameo-mcp/auth-url?${qs.toString()}`, {
        headers: {
          'x-user-id': userId,
          Authorization: `Bearer ${adminToken}`,
        },
      });
      const data = await res.json();
      if (!res.ok || !data.authUrl) {
        throw new Error(data.error || 'No se pudo generar la URL de autorización OAuth de Frameo.AI.');
      }
      const popup = window.open(
        String(data.authUrl),
        'frameo_mcp_oauth',
        'width=620,height=740,noopener=no'
      );
      if (!popup) {
        setMcpPopupFallbackUrl(String(data.authUrl));
        setNotice(
          'Tu navegador bloqueó la ventana emergente. Usa el enlace directo de autorización de Frameo.AI debajo.'
        );
      } else {
        setNotice('Autoriza el acceso en la ventana de Frameo.AI para completar la conexión MCP.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error iniciando OAuth con Frameo.AI.');
    } finally {
      setMcpBusy(false);
    }
  }

  async function handleRefreshFrameoMcpTools() {
    if (!adminToken) return;
    setMcpBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/admin/frameo-mcp/refresh-tools', {
        method: 'POST',
        headers: {
          'x-user-id': userId,
          Authorization: `Bearer ${adminToken}`,
        },
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'No se pudieron sincronizar herramientas MCP.');
      }
      if (Array.isArray(data.tools)) {
        setMcpTools(data.tools);
        if (data.tools.length > 0 && !selectedMcpTool) {
          setSelectedMcpTool(data.tools[0].name);
        }
      }
      if (data.providers) {
        onProvidersChanged?.(data.providers as Record<ApiCapability, ApiProviderPublicSummary>);
        if (data.providers.frameo_video) {
          setFrameoConnSummary(data.providers.frameo_video as ApiProviderPublicSummary);
        }
      }
      setMcpConnected(true);
      setNotice(`Sincronización MCP completada: ${data.tools?.length || 0} herramientas disponibles.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error sincronizando MCP de Frameo.AI.');
    } finally {
      setMcpBusy(false);
    }
  }

  async function handleRunMcpToolTest(e: React.FormEvent) {
    e.preventDefault();
    if (!adminToken || !selectedMcpTool) return;
    setMcpBusy(true);
    setError(null);
    setMcpToolResultText(null);
    try {
      const parsedArgs = mcpToolArgsJson.trim() ? JSON.parse(mcpToolArgsJson) : {};
      const res = await fetch('/api/admin/frameo-mcp/call-tool', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': userId,
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          toolName: selectedMcpTool,
          arguments: parsedArgs,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Error ejecutando herramienta Frameo MCP.');
      }
      setMcpToolResultText(JSON.stringify(data.result, null, 2));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error ejecutando herramienta MCP.');
    } finally {
      setMcpBusy(false);
    }
  }

  async function handleCopyText(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1500);
    } catch {
      // Clipboard blocked
    }
  }

  async function handleSeedAuditProject() {
    if (!adminToken) return;
    setSeedingProject(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/admin/seed-audit-project', {
        method: 'POST',
        headers: {
          'x-user-id': userId,
          Authorization: `Bearer ${adminToken}`,
        },
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
    if (!adminToken) return;
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
          Authorization: `Bearer ${adminToken}`,
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 dark:bg-black/85 p-4"
    >
      <div className="w-full max-w-4xl max-h-[90vh] flex flex-col rounded-xl border border-[#DCD6CA] dark:border-white/15 bg-[#FFFFFF] dark:bg-[#121218] overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="px-6 py-4 border-b border-[#E2DDD3] dark:border-white/10 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <UserCog className="w-5 h-5 text-amber-700 dark:text-[#E5A93C] shrink-0" />
            <div className="min-w-0">
              <h2
                id="admin-lab-title"
                className="font-display text-lg font-semibold text-[#18181B] dark:text-[#F2F0EB]"
              >
                Laboratorio Administrador · Análisis y Entrenamiento del Agente
              </h2>
              <p className="text-xs text-[#57534E] dark:text-[#8D8981] truncate">
                Inspecciona el razonamiento interno de AUTEUR, audita secuencias y enséñale directivas permanentes.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar laboratorio de administrador"
            className="p-2 rounded-lg text-[#57534E] dark:text-[#9A968E] hover:text-[#18181B] dark:hover:text-[#F2F0EB] hover:bg-black/5 dark:hover:bg-white/5 shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div
          role="tablist"
          aria-label="Secciones del Laboratorio Administrador"
          className="px-6 pt-3 border-b border-[#E2DDD3] dark:border-white/10 flex flex-wrap items-center gap-4 bg-[#FAF8F4] dark:bg-[#0E0E13] shrink-0"
        >
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'inspect'}
            onClick={() => setTab('inspect')}
            className={`pb-3 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap inline-flex items-center gap-1.5 ${
              tab === 'inspect'
                ? 'border-[#E5A93C] text-[#18181B] dark:text-[#F2F0EB]'
                : 'border-transparent text-[#57534E] dark:text-[#8D8981] hover:text-[#18181B] dark:hover:text-[#E6E2DA]'
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
                ? 'border-[#E5A93C] text-[#18181B] dark:text-[#F2F0EB]'
                : 'border-transparent text-[#57534E] dark:text-[#8D8981] hover:text-[#18181B] dark:hover:text-[#E6E2DA]'
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
                ? 'border-[#E5A93C] text-[#18181B] dark:text-[#F2F0EB]'
                : 'border-transparent text-[#57534E] dark:text-[#8D8981] hover:text-[#18181B] dark:hover:text-[#E6E2DA]'
            }`}
          >
            <FlaskConical className="w-3.5 h-3.5" />
            <span>Auditoría de Secuencia</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'frameo'}
            onClick={() => setTab('frameo')}
            className={`pb-3 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap inline-flex items-center gap-1.5 ${
              tab === 'frameo'
                ? 'border-[#E5A93C] text-[#18181B] dark:text-[#F2F0EB]'
                : 'border-transparent text-[#57534E] dark:text-[#8D8981] hover:text-[#18181B] dark:hover:text-[#E6E2DA]'
            }`}
          >
            <Clapperboard className="w-3.5 h-3.5" />
            <span>Frameo IA (ArthurAgent)</span>
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {notice && (
            <div className="rounded-lg border border-teal-600/35 dark:border-[#38B2AC]/35 bg-teal-50 dark:bg-[#122625] px-4 py-2.5 text-xs text-teal-800 dark:text-[#A7F3D0] flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{notice}</span>
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="rounded-lg border border-red-300 dark:border-[#EF4444]/35 bg-red-50 dark:bg-[#3B1515]/50 px-4 py-2.5 text-xs text-red-700 dark:text-[#FCA5A5] flex items-center gap-2"
            >
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {tab === 'inspect' && (
            <div className="space-y-5">
              {/* Audit Quick Seed Banner */}
              <div className="p-4 rounded-xl border border-amber-500/40 dark:border-[#E5A93C]/35 bg-amber-50 dark:bg-[#19150E] flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-1 max-w-xl">
                  <div className="text-xs font-semibold text-[#18181B] dark:text-[#F2F0EB]">
                    Banco de Pruebas del Administrador
                  </div>
                  <p className="text-xs text-[#3F3F46] dark:text-[#C8C3BA] leading-relaxed">
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
                <h3 className="text-xs font-semibold text-[#18181B] dark:text-[#F2F0EB]">
                  Arquitectura de Modelos Activos
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                  {activeModels.map((item) => (
                    <div
                      key={item.role}
                      className="p-3 rounded-lg border border-[#E2DDD3] dark:border-white/10 bg-[#FAF8F4] dark:bg-[#0B0B0E]"
                    >
                      <div className="text-[11px] text-[#57534E] dark:text-[#8D8981]">{item.role}</div>
                      <div className="text-xs font-mono-tech text-amber-700 dark:text-[#E5A93C] mt-1">
                        {item.model}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Effective System Instruction Inspection */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold text-[#18181B] dark:text-[#F2F0EB]">
                    Prompt Maestro Ensamblado (Instrucción Base + Directivas Admin + Memoria)
                  </h3>
                  <span className="text-[11px] font-mono-tech text-[#57534E] dark:text-[#8D8981]">
                    {loadingProfile ? 'Actualizando...' : `${effectiveInstruction.length} chars`}
                  </span>
                </div>
                <pre className="p-4 rounded-xl border border-[#E2DDD3] dark:border-white/10 bg-[#FAF8F4] dark:bg-[#08080B] text-[11px] font-mono-tech text-[#3F3F46] dark:text-[#C8C3BA] whitespace-pre-wrap leading-relaxed max-h-64 overflow-y-auto">
                  {effectiveInstruction || baseInstruction || 'Cargando instrucciones del Agente Director...'}
                </pre>
              </div>
            </div>
          )}

          {tab === 'teach' && (
            <div className="space-y-6">
              <form
                onSubmit={handleSaveProfile}
                className="p-4 rounded-xl border border-[#E2DDD3] dark:border-white/10 bg-[#FAF8F4] dark:bg-[#0B0B0E] space-y-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-xs font-semibold text-[#18181B] dark:text-[#F2F0EB]">
                      Reglas Maestras del Administrador (Inyectadas en Tiempo Real)
                    </h3>
                    <p className="text-[11px] text-[#57534E] dark:text-[#8D8981] mt-0.5">
                      Lo que configures aquí modifica directamente las instrucciones del Agente Director.
                    </p>
                  </div>
                  <label className="inline-flex items-center gap-2 text-xs text-[#27272A] dark:text-[#E6E2DA] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={profile.strictContinuityMode}
                      onChange={(e) =>
                        setProfile((prev) => ({
                          ...prev,
                          strictContinuityMode: e.target.checked,
                        }))
                      }
                      className="rounded border-[#D6D1C7] dark:border-white/20 bg-[#FFFFFF] dark:bg-[#14141B] text-[#E5A93C]"
                    />
                    <span>Continuidad estricta</span>
                  </label>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label
                      htmlFor="admin-tone-input"
                      className="block text-[11px] font-medium text-[#57534E] dark:text-[#9A968E] mb-1"
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
                      className="w-full rounded-lg border border-[#D6D1C7] dark:border-white/12 bg-[#FFFFFF] dark:bg-[#14141B] px-3 py-2 text-xs text-[#18181B] dark:text-[#F2F0EB] focus:border-[#E5A93C] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="admin-grammar-input"
                      className="block text-[11px] font-medium text-[#57534E] dark:text-[#9A968E] mb-1"
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
                      className="w-full rounded-lg border border-[#D6D1C7] dark:border-white/12 bg-[#FFFFFF] dark:bg-[#14141B] px-3 py-2 text-xs text-[#18181B] dark:text-[#F2F0EB] focus:border-[#E5A93C] focus:outline-none"
                    />
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label
                      htmlFor="admin-directives-textarea"
                      className="block text-[11px] font-medium text-[#57534E] dark:text-[#9A968E]"
                    >
                      Directivas de entrenamiento para el Agente Director
                    </label>
                    <span className="text-[11px] font-mono-tech text-[#57534E] dark:text-[#8D8981] tabular-nums">
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
                    className="w-full rounded-lg border border-[#D6D1C7] dark:border-white/12 bg-[#FFFFFF] dark:bg-[#14141B] p-2.5 text-xs text-[#18181B] dark:text-[#F2F0EB] placeholder:text-[#78746C] dark:placeholder:text-[#6E6A63] focus:border-[#E5A93C] focus:outline-none"
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
              <div className="p-4 rounded-xl border border-[#E2DDD3] dark:border-white/10 bg-[#FAF8F4] dark:bg-[#0B0B0E] space-y-3">
                <h3 className="text-xs font-semibold text-[#18181B] dark:text-[#F2F0EB]">
                  Enseñar lección específica a la memoria del estudio
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <select
                    aria-label="Categoría de enseñanza"
                    value={quickCategory}
                    onChange={(e) => setQuickCategory(e.target.value as LearningCategory)}
                    className="rounded-lg border border-[#D6D1C7] dark:border-white/12 bg-[#FFFFFF] dark:bg-[#14141B] px-3 py-2 text-xs text-[#18181B] dark:text-[#F2F0EB] focus:border-[#E5A93C] focus:outline-none"
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
                    className="rounded-lg border border-[#D6D1C7] dark:border-white/12 bg-[#FFFFFF] dark:bg-[#14141B] px-3 py-2 text-xs text-[#18181B] dark:text-[#F2F0EB] font-mono-tech focus:border-[#E5A93C] focus:outline-none"
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
                  className="w-full rounded-lg border border-[#D6D1C7] dark:border-white/12 bg-[#FFFFFF] dark:bg-[#14141B] p-2.5 text-xs text-[#18181B] dark:text-[#F2F0EB] placeholder:text-[#78746C] dark:placeholder:text-[#6E6A63] focus:border-[#E5A93C] focus:outline-none"
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
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-amber-500/50 dark:border-[#E5A93C]/45 bg-amber-50 hover:bg-amber-100 dark:bg-[#1B1812] dark:hover:bg-[#272116] disabled:opacity-50 text-xs font-semibold text-[#18181B] dark:text-[#F2F0EB]"
                  >
                    <Plus className="w-3.5 h-3.5 text-amber-700 dark:text-[#E5A93C]" />
                    <span>{addingLesson ? 'Enseñando...' : 'Enseñar lección al Agente'}</span>
                  </button>
                </div>
              </div>

              {/* Active Lessons List */}
              {lessons.length > 0 && (
                <div className="space-y-2">
                  <div className="text-xs font-medium text-[#57534E] dark:text-[#9A968E]">
                    Lecciones activas en memoria ({lessons.length})
                  </div>
                  <div className="space-y-2 max-h-52 overflow-y-auto">
                    {lessons.map((lesson) => (
                      <div
                        key={lesson.id}
                        className="p-3 rounded-lg border border-[#E2DDD3] dark:border-white/10 bg-[#FAF8F4] dark:bg-[#17171F] flex items-start justify-between gap-3"
                      >
                        <div className="space-y-1 min-w-0">
                          <div className="text-[11px] font-mono-tech text-amber-700 dark:text-[#E5A93C]">
                            {LEARNING_CATEGORY_LABELS[lesson.category]} · {lesson.rating}/5 ·{' '}
                            <span className="text-[#57534E] dark:text-[#8D8981]">
                              {lesson.sourceProjectTitle}
                            </span>
                          </div>
                          <p className="text-xs text-[#27272A] dark:text-[#EAE6DE] leading-relaxed">
                            {lesson.insight}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              setError(null);
                              await onDeleteLesson(lesson.id);
                            } catch (err) {
                              setError(
                                err instanceof Error
                                  ? err.message
                                  : 'No se pudo eliminar la lección.'
                              );
                            }
                          }}
                          aria-label={`Eliminar lección ${lesson.id}`}
                          className="p-1.5 rounded hover:bg-black/5 dark:hover:bg-white/5 text-[#57534E] dark:text-[#8D8981] hover:text-red-700 dark:hover:text-[#FCA5A5] shrink-0"
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
              <div className="p-4 rounded-xl border border-[#E2DDD3] dark:border-white/10 bg-[#FAF8F4] dark:bg-[#0B0B0E] space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-xs font-semibold text-[#18181B] dark:text-[#F2F0EB]">
                      Diagnóstico Estructural de Secuencia Activa
                    </h3>
                    <p className="text-[11px] text-[#57534E] dark:text-[#8D8981] mt-0.5">
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
                        className="px-3 py-2 rounded-lg border border-[#D6D1C7] dark:border-white/15 bg-[#FFFFFF] dark:bg-[#181822] text-xs font-medium text-[#18181B] dark:text-[#F2F0EB]"
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
                  <div className="p-2.5 rounded-lg border border-[#E2DDD3] dark:border-white/8 bg-[#FFFFFF] dark:bg-[#121218]">
                    <div className="text-[11px] text-[#57534E] dark:text-[#8D8981]">Índice</div>
                    <div className="font-mono-tech text-base font-semibold text-amber-700 dark:text-[#E5A93C] tabular-nums">
                      {localMetrics.readinessScore}%
                    </div>
                  </div>
                  <div className="p-2.5 rounded-lg border border-[#E2DDD3] dark:border-white/8 bg-[#FFFFFF] dark:bg-[#121218]">
                    <div className="text-[11px] text-[#57534E] dark:text-[#8D8981]">Planos</div>
                    <div className="font-mono-tech text-base font-semibold text-[#18181B] dark:text-[#F2F0EB] tabular-nums">
                      {localMetrics.shotCount}
                    </div>
                  </div>
                  <div className="p-2.5 rounded-lg border border-[#E2DDD3] dark:border-white/8 bg-[#FFFFFF] dark:bg-[#121218]">
                    <div className="text-[11px] text-[#57534E] dark:text-[#8D8981]">Escenas</div>
                    <div className="font-mono-tech text-base font-semibold text-[#18181B] dark:text-[#F2F0EB] tabular-nums">
                      {localMetrics.screenplaySceneCount}
                    </div>
                  </div>
                  <div className="p-2.5 rounded-lg border border-[#E2DDD3] dark:border-white/8 bg-[#FFFFFF] dark:bg-[#121218]">
                    <div className="text-[11px] text-[#57534E] dark:text-[#8D8981]">Storyboard</div>
                    <div className="font-mono-tech text-base font-semibold text-[#18181B] dark:text-[#F2F0EB] tabular-nums">
                      {localMetrics.storyboardCount}
                    </div>
                  </div>
                  <div className="p-2.5 rounded-lg border border-[#E2DDD3] dark:border-white/8 bg-[#FFFFFF] dark:bg-[#121218]">
                    <div className="text-[11px] text-[#57534E] dark:text-[#8D8981]">Voces Off</div>
                    <div className="font-mono-tech text-base font-semibold text-[#18181B] dark:text-[#F2F0EB] tabular-nums">
                      {localMetrics.voiceOverCount}
                    </div>
                  </div>
                  <div className="p-2.5 rounded-lg border border-[#E2DDD3] dark:border-white/8 bg-[#FFFFFF] dark:bg-[#121218]">
                    <div className="text-[11px] text-[#57534E] dark:text-[#8D8981]">Biblia</div>
                    <div className="font-mono-tech text-sm font-semibold text-teal-700 dark:text-[#38B2AC]">
                      {localMetrics.hasContinuityBible ? 'Activa' : 'Vacía'}
                    </div>
                  </div>
                </div>
              </div>

              {/* AI Critic Report */}
              {diagnosticReport && (
                <div className="space-y-4">
                  <div className="p-4 rounded-xl border border-amber-500/40 dark:border-[#E5A93C]/35 bg-amber-50 dark:bg-[#15141A] space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-amber-800 dark:text-[#E5A93C]">
                        Dictamen del Supervisor Crítico
                      </span>
                      <span className="font-mono-tech text-sm font-semibold text-[#18181B] dark:text-[#F2F0EB] tabular-nums">
                        Coherencia: {diagnosticReport.coherenceScore}/100
                      </span>
                    </div>
                    <p className="text-xs text-[#27272A] dark:text-[#E6E2DA] leading-relaxed">
                      {diagnosticReport.summary}
                    </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                    <div className="p-3.5 rounded-lg border border-teal-600/30 dark:border-[#38B2AC]/30 bg-teal-50 dark:bg-[#0F1B1A] space-y-1.5">
                      <div className="font-semibold text-teal-800 dark:text-[#5EEAD4]">
                        Aciertos técnicos
                      </div>
                      <ul className="space-y-1 text-[#3F3F46] dark:text-[#C8C3BA] list-disc pl-4">
                        {diagnosticReport.strengths.map((s, i) => (
                          <li key={i}>{s}</li>
                        ))}
                      </ul>
                    </div>
                    <div className="p-3.5 rounded-lg border border-amber-500/35 dark:border-[#E5A93C]/30 bg-amber-50 dark:bg-[#1B1710] space-y-1.5">
                      <div className="font-semibold text-amber-800 dark:text-[#F4C46A]">
                        Puntos mejorables
                      </div>
                      <ul className="space-y-1 text-[#3F3F46] dark:text-[#C8C3BA] list-disc pl-4">
                        {diagnosticReport.weaknesses.map((w, i) => (
                          <li key={i}>{w}</li>
                        ))}
                      </ul>
                    </div>
                    <div className="p-3.5 rounded-lg border border-red-300 dark:border-[#EF4444]/30 bg-red-50 dark:bg-[#241214] space-y-1.5">
                      <div className="font-semibold text-red-700 dark:text-[#FCA5A5]">
                        Riesgos de continuidad
                      </div>
                      <ul className="space-y-1 text-[#3F3F46] dark:text-[#C8C3BA] list-disc pl-4">
                        {diagnosticReport.continuityRisks.map((r, i) => (
                          <li key={i}>{r}</li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  {diagnosticReport.recommendedLessons.length > 0 && (
                    <div className="space-y-2.5">
                      <div className="text-xs font-semibold text-[#18181B] dark:text-[#F2F0EB]">
                        Enseñanzas recomendadas tras la auditoría
                      </div>
                      {diagnosticReport.recommendedLessons.map((rec, idx) => {
                        const key = `rec-${idx}-${rec.insight.slice(0, 16)}`;
                        const taught = Boolean(taughtInsights[key]);
                        return (
                          <div
                            key={key}
                            className="p-3.5 rounded-lg border border-[#E2DDD3] dark:border-white/10 bg-[#FAF8F4] dark:bg-[#0B0B0E] flex flex-wrap items-center justify-between gap-3"
                          >
                            <div className="space-y-1 max-w-2xl">
                              <div className="text-[11px] font-mono-tech text-amber-700 dark:text-[#E5A93C]">
                                {LEARNING_CATEGORY_LABELS[rec.category] || rec.category} · {rec.rating}/5
                              </div>
                              <p className="text-xs text-[#27272A] dark:text-[#E6E2DA]">{rec.insight}</p>
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
                                  ? 'bg-teal-50 dark:bg-[#122625] text-teal-800 dark:text-[#5EEAD4] border border-teal-600/35 dark:border-[#38B2AC]/35'
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

          {tab === 'frameo' && (
            <div className="space-y-6">
              {/* Frameo.AI MCP OAuth 2.0 Connector (https://mcp.frameo.ai/mcp) */}
              <div className="p-4 rounded-xl border border-teal-600/35 dark:border-[#38B2AC]/35 bg-teal-50/70 dark:bg-[#0D1A1A] space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2 text-xs font-semibold text-[#18181B] dark:text-[#F2F0EB]">
                      <PlugZap className="w-4 h-4 text-teal-700 dark:text-[#5EEAD4]" />
                      <span>Conexión Oficial Frameo.AI MCP (HTTP Streamable + OAuth)</span>
                    </div>
                    <p className="text-[11px] font-mono-tech text-[#57534E] dark:text-[#9A968E]">
                      Servidor remoto: https://mcp.frameo.ai/mcp
                    </p>
                  </div>
                  <span
                    className={`px-2.5 py-1 rounded-md text-[11px] font-mono-tech font-medium ${
                      mcpConnected
                        ? 'bg-teal-100 dark:bg-[#143330] text-teal-800 dark:text-[#5EEAD4]'
                        : 'bg-amber-100 dark:bg-[#2A2010] text-amber-800 dark:text-[#F4C46A]'
                    }`}
                  >
                    {mcpConnected
                      ? `Conectado (${mcpServerName} · ${mcpTools.length} tools)`
                      : 'Sin sesión OAuth activa'}
                  </span>
                </div>

                <p className="text-[11px] text-[#3F3F46] dark:text-[#C8C3BA] leading-relaxed">
                  Conecta directamente tu cuenta de Frameo.AI (OAuth 2.0 PKCE + registro automático
                  de aplicación) para que ArthurAgent acceda a modelos de frontera (Veo 3.1 Rápido,
                  Kling O3/3.0, Semilla 2,5, MiniMax H3) y VFX Studio (Agente Manto).
                </p>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={mcpBusy}
                    onClick={() => void handleConnectFrameoOAuth()}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#E5A93C] hover:bg-[#EDA949] disabled:opacity-60 text-[#0B0B0E] text-xs font-semibold"
                  >
                    <PlugZap className="w-3.5 h-3.5" />
                    <span>
                      {mcpBusy
                        ? 'Conectando...'
                        : mcpConnected
                          ? 'Reconectar Frameo.AI (OAuth)'
                          : 'Conectar con Frameo.AI (OAuth MCP)'}
                    </span>
                  </button>

                  {mcpConnected && (
                    <button
                      type="button"
                      disabled={mcpBusy}
                      onClick={() => void handleRefreshFrameoMcpTools()}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[#D6D1C7] dark:border-white/15 bg-[#FFFFFF] dark:bg-[#14141B] text-xs font-medium text-[#18181B] dark:text-[#F2F0EB]"
                    >
                      <Sparkles className="w-3.5 h-3.5 text-teal-600 dark:text-[#5EEAD4]" />
                      <span>Sincronizar herramientas MCP</span>
                    </button>
                  )}

                  {(mcpConnected || frameoConnSummary?.configured) && (
                    <button
                      type="button"
                      disabled={savingFrameoConn || mcpBusy}
                      onClick={() => void handleDisconnectFrameoConnector()}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[#D6D1C7] dark:border-white/15 bg-[#FFFFFF] dark:bg-[#14141B] hover:bg-rose-50 dark:hover:bg-rose-950/30 text-xs font-medium text-[#57534E] hover:text-rose-700 dark:text-[#9A968E] dark:hover:text-rose-300"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Desconectar Frameo.AI</span>
                    </button>
                  )}
                </div>

                {mcpPopupFallbackUrl && (
                  <div className="p-2.5 rounded-lg border border-amber-500/40 bg-amber-50 dark:bg-[#1F180D] text-xs space-y-1">
                    <div className="text-[#3F3F46] dark:text-[#D4CFC7]">
                      Abre el inicio de sesión de Frameo.AI en una pestaña nueva:
                    </div>
                    <a
                      href={mcpPopupFallbackUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-block font-semibold text-amber-800 dark:text-[#E5A93C] underline"
                    >
                      Autorizar acceso en Frameo.AI MCP
                    </a>
                  </div>
                )}

                {mcpTools.length > 0 && (
                  <div className="pt-2 border-t border-teal-600/20 dark:border-white/10 space-y-2.5">
                    <div className="text-[11px] font-semibold text-[#18181B] dark:text-[#F2F0EB]">
                      Herramientas descubiertas en Frameo.AI MCP ({mcpTools.length})
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {mcpTools.map((t) => (
                        <button
                          key={t.name}
                          type="button"
                          onClick={() => {
                            setSelectedMcpTool(t.name);
                            setMcpToolArgsJson(
                              JSON.stringify(
                                {
                                  prompt:
                                    activeSequence?.hyperRealisticPrompt ||
                                    'Escena cinematográfica 4K anamórfica',
                                  model: profile.frameoIaModel || FRAMEO_MODEL_CATALOG[0],
                                },
                                null,
                                2
                              )
                            );
                          }}
                          className={`px-2 py-1 rounded text-[11px] font-mono-tech border transition-colors ${
                            selectedMcpTool === t.name
                              ? 'border-[#E5A93C] bg-amber-50 dark:bg-[#221B0E] text-amber-800 dark:text-[#E5A93C]'
                              : 'border-[#D6D1C7] dark:border-white/12 bg-[#FFFFFF] dark:bg-[#111116] text-[#3F3F46] dark:text-[#C8C3BA]'
                          }`}
                          title={t.description || t.name}
                        >
                          {t.name}
                        </button>
                      ))}
                    </div>

                    {selectedMcpTool && (
                      <form onSubmit={handleRunMcpToolTest} className="space-y-2">
                        <div className="text-[11px] text-[#57534E] dark:text-[#9A968E]">
                          Probar herramienta <strong className="font-mono-tech">{selectedMcpTool}</strong>
                        </div>
                        <textarea
                          rows={3}
                          aria-label="Argumentos JSON MCP"
                          value={mcpToolArgsJson}
                          onChange={(e) => setMcpToolArgsJson(e.target.value)}
                          className="w-full rounded-lg border border-[#D6D1C7] dark:border-white/12 bg-[#FFFFFF] dark:bg-[#0B0B0E] p-2 text-[11px] font-mono-tech text-[#18181B] dark:text-[#F2F0EB] focus:border-[#E5A93C] focus:outline-none"
                        />
                        <div className="flex justify-end">
                          <button
                            type="submit"
                            disabled={mcpBusy}
                            className="px-3 py-1.5 rounded-lg border border-teal-600/40 dark:border-[#38B2AC]/40 bg-teal-100/70 dark:bg-[#132928] text-xs font-semibold text-teal-900 dark:text-[#5EEAD4]"
                          >
                            {mcpBusy ? 'Ejecutando...' : `Ejecutar ${selectedMcpTool}`}
                          </button>
                        </div>
                      </form>
                    )}

                    {mcpToolResultText && (
                      <pre className="p-2.5 rounded-lg border border-[#D6D1C7] dark:border-white/10 bg-[#FFFFFF] dark:bg-[#0B0B0E] text-[10px] font-mono-tech text-[#3F3F46] dark:text-[#D4CFC7] max-h-40 overflow-y-auto whitespace-pre-wrap">
                        {mcpToolResultText}
                      </pre>
                    )}
                  </div>
                )}
              </div>

              {/* Frameo IA Engine & VFX Studio (Manto) Settings (Admin only) */}
              <form
                onSubmit={handleSaveFrameoSettings}
                className="p-4 rounded-xl border border-[#E2DDD3] dark:border-white/10 bg-[#FAF8F4] dark:bg-[#0B0B0E] space-y-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-xs font-semibold text-[#18181B] dark:text-[#F2F0EB]">
                      Motor Frameo IA y VFX Studio (Agente Manto) · Admin
                    </h3>
                    <p className="text-[11px] text-[#57534E] dark:text-[#8D8981] mt-0.5">
                      Selecciona modelo de frontera Frameo, modo VFX de Manto, vista previa 480P y formato de exportación.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-4">
                    <label className="inline-flex items-center gap-2 text-xs text-[#27272A] dark:text-[#E6E2DA] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={profile.frameoIaEnabled !== false}
                        onChange={(e) =>
                          setProfile((prev) => ({
                            ...prev,
                            frameoIaEnabled: e.target.checked,
                          }))
                        }
                        className="rounded border-[#D6D1C7] dark:border-white/20 bg-[#FFFFFF] dark:bg-[#14141B] text-[#E5A93C]"
                      />
                      <span>Activar ArthurAgent · Frameo IA</span>
                    </label>
                    <label className="inline-flex items-center gap-2 text-xs text-[#27272A] dark:text-[#E6E2DA] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={profile.frameoIaAutoGenerateVideo !== false}
                        onChange={(e) =>
                          setProfile((prev) => ({
                            ...prev,
                            frameoIaAutoGenerateVideo: e.target.checked,
                          }))
                        }
                        className="rounded border-[#D6D1C7] dark:border-white/20 bg-[#FFFFFF] dark:bg-[#14141B] text-[#E5A93C]"
                      />
                      <span>Generar video en Frameo IA al producir</span>
                    </label>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <label
                      htmlFor="frameo-model-select"
                      className="block text-[11px] font-medium text-[#57534E] dark:text-[#9A968E] mb-1"
                    >
                      Modelo Frameo.AI
                    </label>
                    <select
                      id="frameo-model-select"
                      value={profile.frameoIaModel || FRAMEO_MODEL_CATALOG[0]}
                      onChange={(e) =>
                        setProfile((prev) => ({ ...prev, frameoIaModel: e.target.value }))
                      }
                      className="w-full rounded-lg border border-[#D6D1C7] dark:border-white/12 bg-[#FFFFFF] dark:bg-[#14141B] px-3 py-2 text-xs text-[#18181B] dark:text-[#F2F0EB] focus:border-[#E5A93C] focus:outline-none"
                    >
                      {FRAMEO_MODEL_CATALOG.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label
                      htmlFor="frameo-vfx-manto-select"
                      className="block text-[11px] font-medium text-[#57534E] dark:text-[#9A968E] mb-1"
                    >
                      VFX Studio (Agente Manto)
                    </label>
                    <select
                      id="frameo-vfx-manto-select"
                      value={profile.frameoIaVfxMode || FRAMEO_VFX_MANTO_MODES[0]}
                      onChange={(e) =>
                        setProfile((prev) => ({ ...prev, frameoIaVfxMode: e.target.value }))
                      }
                      className="w-full rounded-lg border border-[#D6D1C7] dark:border-white/12 bg-[#FFFFFF] dark:bg-[#14141B] px-3 py-2 text-xs text-[#18181B] dark:text-[#F2F0EB] focus:border-[#E5A93C] focus:outline-none"
                    >
                      {FRAMEO_VFX_MANTO_MODES.map((mode) => (
                        <option key={mode} value={mode}>
                          {mode}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label
                      htmlFor="frameo-render-quality-select"
                      className="block text-[11px] font-medium text-[#57534E] dark:text-[#9A968E] mb-1"
                    >
                      Flujo de Renderizado Frameo
                    </label>
                    <select
                      id="frameo-render-quality-select"
                      value={profile.frameoIaRenderQuality || '480p_preview'}
                      onChange={(e) =>
                        setProfile((prev) => ({
                          ...prev,
                          frameoIaRenderQuality:
                            e.target.value === 'full_hd' ? 'full_hd' : '480p_preview',
                        }))
                      }
                      className="w-full rounded-lg border border-[#D6D1C7] dark:border-white/12 bg-[#FFFFFF] dark:bg-[#14141B] px-3 py-2 text-xs text-[#18181B] dark:text-[#F2F0EB] focus:border-[#E5A93C] focus:outline-none"
                    >
                      <option value="480p_preview">Vista previa rápida 480P (Look Check)</option>
                      <option value="full_hd">Renderizar a resolución completa</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <label
                      htmlFor="frameo-preset-select"
                      className="block text-[11px] font-medium text-[#57534E] dark:text-[#9A968E] mb-1"
                    >
                      Preset Visual Frameo IA
                    </label>
                    <select
                      id="frameo-preset-select"
                      value={profile.frameoIaStylePreset || FRAMEO_STYLE_PRESETS[0]}
                      onChange={(e) =>
                        setProfile((prev) => ({ ...prev, frameoIaStylePreset: e.target.value }))
                      }
                      className="w-full rounded-lg border border-[#D6D1C7] dark:border-white/12 bg-[#FFFFFF] dark:bg-[#14141B] px-3 py-2 text-xs text-[#18181B] dark:text-[#F2F0EB] focus:border-[#E5A93C] focus:outline-none"
                    >
                      {FRAMEO_STYLE_PRESETS.map((preset) => (
                        <option key={preset} value={preset}>
                          {preset}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label
                      htmlFor="frameo-ratio-select"
                      className="block text-[11px] font-medium text-[#57534E] dark:text-[#9A968E] mb-1"
                    >
                      Formato Frameo IA
                    </label>
                    <select
                      id="frameo-ratio-select"
                      value={profile.frameoIaAspectRatio || '16:9'}
                      onChange={(e) =>
                        setProfile((prev) => ({ ...prev, frameoIaAspectRatio: e.target.value }))
                      }
                      className="w-full rounded-lg border border-[#D6D1C7] dark:border-white/12 bg-[#FFFFFF] dark:bg-[#14141B] px-3 py-2 text-xs font-mono-tech text-[#18181B] dark:text-[#F2F0EB] focus:border-[#E5A93C] focus:outline-none"
                    >
                      <option value="16:9">16:9 Cine Digital</option>
                      <option value="9:16">9:16 Reel / Mini-Drama</option>
                      <option value="2.39:1">2.39:1 Panavision Scope</option>
                      <option value="1:1">1:1 Cuadrado</option>
                    </select>
                  </div>

                  <div>
                    <label
                      htmlFor="frameo-clip-duration"
                      className="block text-[11px] font-medium text-[#57534E] dark:text-[#9A968E] mb-1"
                    >
                      Duración por Clip Frameo
                    </label>
                    <select
                      id="frameo-clip-duration"
                      value={profile.frameoIaClipDurationSec || 5}
                      onChange={(e) =>
                        setProfile((prev) => ({
                          ...prev,
                          frameoIaClipDurationSec: Number(e.target.value),
                        }))
                      }
                      className="w-full rounded-lg border border-[#D6D1C7] dark:border-white/12 bg-[#FFFFFF] dark:bg-[#14141B] px-3 py-2 text-xs font-mono-tech text-[#18181B] dark:text-[#F2F0EB] focus:border-[#E5A93C] focus:outline-none"
                    >
                      <option value={4}>4 segundos</option>
                      <option value={5}>5 segundos</option>
                      <option value={6}>6 segundos</option>
                      <option value={8}>8 segundos</option>
                      <option value={10}>10 segundos</option>
                    </select>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                  <span className="text-[11px] font-mono-tech text-[#57534E] dark:text-[#8D8981]">
                    Nomenclatura de tomas:{' '}
                    {buildFrameoShotFilename(
                      activeProject?.title || 'AUTEUR',
                      activeSequence?.chapterIndex || 1,
                      1,
                      1
                    )}
                  </span>
                  <button
                    type="submit"
                    disabled={savingProfile}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#E5A93C] hover:bg-[#EDA949] disabled:opacity-60 text-[#0B0B0E] text-xs font-semibold"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>{savingProfile ? 'Guardando...' : 'Guardar configuración Frameo IA'}</span>
                  </button>
                </div>
              </form>

              {/* Generate / View Frameo IA Production Package */}
              <div className="p-4 rounded-xl border border-amber-500/40 dark:border-[#E5A93C]/35 bg-amber-50/70 dark:bg-[#16130D] space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-xs font-semibold text-[#18181B] dark:text-[#F2F0EB]">
                      Paquete Frameo IA de la Secuencia Activa
                    </h3>
                    <p className="text-[11px] text-[#57534E] dark:text-[#8D8981] mt-0.5">
                      {activeProject && activeSequence
                        ? `${activeProject.title} · ${activeSequence.title}`
                        : 'Carga el proyecto de auditoría o crea una secuencia para generar el paquete Frameo IA.'}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {!activeSequence && (
                      <button
                        type="button"
                        onClick={handleSeedAuditProject}
                        disabled={seedingProject}
                        className="px-3 py-2 rounded-lg border border-[#D6D1C7] dark:border-white/15 bg-[#FFFFFF] dark:bg-[#181822] text-xs font-medium text-[#18181B] dark:text-[#F2F0EB]"
                      >
                        {seedingProject ? 'Cargando...' : 'Cargar proyecto de auditoría'}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void handleGenerateFrameoPackage()}
                      disabled={generatingFrameo || !activeSequence}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#E5A93C] hover:bg-[#EDA949] disabled:opacity-50 text-[#0B0B0E] text-xs font-semibold"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>
                        {generatingFrameo
                          ? 'Generando paquete...'
                          : 'Generar / Actualizar Paquete Frameo IA'}
                      </span>
                    </button>
                  </div>
                </div>

                {activeSequence?.frameoProductionSpec && (
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-amber-500/25 dark:border-white/10">
                      <span className="text-[11px] font-mono-tech text-amber-800 dark:text-[#E5A93C]">
                        {activeSequence.frameoProductionSpec.engine} ·{' '}
                        {activeSequence.frameoProductionSpec.modelName || 'Veo 3.1 Rápido'} ·{' '}
                        {activeSequence.frameoProductionSpec.scenes.length} escenas ·{' '}
                        {activeSequence.frameoProductionSpec.shotNamingTemplate || 'AUT_EP01_SH001_v001.mov'}
                      </span>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            void handleCopyText(
                              'frameo-json',
                              JSON.stringify(activeSequence.frameoProductionSpec, null, 2)
                            )
                          }
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-[#D6D1C7] dark:border-white/15 bg-[#FFFFFF] dark:bg-[#111116] text-[11px] font-medium text-[#18181B] dark:text-[#F2F0EB]"
                        >
                          {copiedKey === 'frameo-json' ? (
                            <Check className="w-3 h-3 text-teal-600" />
                          ) : (
                            <Copy className="w-3 h-3 text-amber-600 dark:text-[#E5A93C]" />
                          )}
                          <span>Copiar JSON Frameo IA</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const spec = activeSequence.frameoProductionSpec!;
                            const txt = [
                              `GUÍA FRAMEO IA · ${activeProject?.title || ''} / ${activeSequence.title}`,
                              `Modelo: ${spec.modelName || 'Veo 3.1 Rápido'} | Preset: ${spec.stylePreset} | ${spec.aspectRatio} | ${spec.clipDurationSec}s`,
                              `VFX Manto: ${spec.vfxMantoMode || 'Estándar'} | Toma: ${spec.shotNamingTemplate || 'EP01_SH001_v001.mov'}`,
                              '',
                              spec.workflowChecklist.join('\n'),
                              '',
                              ...spec.scenes.map(
                                (s) =>
                                  `=== ESCENA ${s.sceneNumber}: ${s.sceneLabel} (${s.shotRef}) ===\nCharacter Anchor: ${s.characterAnchor}\nVisual Prompt: ${s.frameoVisualPrompt}\nMotion Prompt (${s.durationSec}s): ${s.frameoMotionPrompt}\nAudio/VO: ${s.narrationOrDialogue}`
                              ),
                            ].join('\n\n');
                            void handleCopyText('frameo-guide', txt);
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-[#D6D1C7] dark:border-white/15 bg-[#FFFFFF] dark:bg-[#111116] text-[11px] font-medium text-[#18181B] dark:text-[#F2F0EB]"
                        >
                          {copiedKey === 'frameo-guide' ? (
                            <Check className="w-3 h-3 text-teal-600" />
                          ) : (
                            <Copy className="w-3 h-3 text-amber-600 dark:text-[#E5A93C]" />
                          )}
                          <span>Copiar Guía Completa Frameo IA</span>
                        </button>
                      </div>
                    </div>

                    <div className="p-3 rounded-lg border border-[#E2DDD3] dark:border-white/10 bg-[#FFFFFF] dark:bg-[#0B0B0E] space-y-1 text-[11px] text-[#3F3F46] dark:text-[#C8C3BA]">
                      {activeSequence.frameoProductionSpec.workflowChecklist.map((step, i) => (
                        <div key={i}>{step}</div>
                      ))}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {activeSequence.frameoProductionSpec.scenes.map((sc) => (
                        <div
                          key={sc.sceneNumber}
                          className="p-3.5 rounded-lg border border-[#DCD6CA] dark:border-white/10 bg-[#FFFFFF] dark:bg-[#0D0D12] space-y-2 text-xs"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-semibold text-[#18181B] dark:text-[#F2F0EB]">
                              Escena {sc.sceneNumber}: {sc.sceneLabel}
                            </span>
                            <span className="font-mono-tech text-[11px] text-amber-700 dark:text-[#E5A93C]">
                              {sc.shotRef} · {sc.durationSec}s
                            </span>
                          </div>
                          <div className="text-[11px] text-[#57534E] dark:text-[#9A968E]">
                            <strong>Anclaje:</strong> {sc.characterAnchor}
                          </div>
                          <div className="space-y-1">
                            <div className="flex items-center justify-between">
                              <span className="text-[11px] font-medium text-[#3F3F46] dark:text-[#C8C3BA]">
                                Visual Prompt
                              </span>
                              <button
                                type="button"
                                onClick={() =>
                                  void handleCopyText(`f-vis-${sc.sceneNumber}`, sc.frameoVisualPrompt)
                                }
                                className="text-[11px] text-amber-700 dark:text-[#E5A93C] hover:underline"
                              >
                                {copiedKey === `f-vis-${sc.sceneNumber}` ? 'Copiado' : 'Copiar'}
                              </button>
                            </div>
                            <p className="text-[11px] font-mono-tech text-[#27272A] dark:text-[#D4CFC7] leading-relaxed">
                              {sc.frameoVisualPrompt}
                            </p>
                          </div>
                          <div className="space-y-1">
                            <div className="flex items-center justify-between">
                              <span className="text-[11px] font-medium text-[#3F3F46] dark:text-[#C8C3BA]">
                                Motion Prompt
                              </span>
                              <button
                                type="button"
                                onClick={() =>
                                  void handleCopyText(`f-mot-${sc.sceneNumber}`, sc.frameoMotionPrompt)
                                }
                                className="text-[11px] text-amber-700 dark:text-[#E5A93C] hover:underline"
                              >
                                {copiedKey === `f-mot-${sc.sceneNumber}` ? 'Copiado' : 'Copiar'}
                              </button>
                            </div>
                            <p className="text-[11px] font-mono-tech text-[#27272A] dark:text-[#D4CFC7] leading-relaxed">
                              {sc.frameoMotionPrompt}
                            </p>
                          </div>
                          <div className="text-[11px] text-teal-700 dark:text-[#5EEAD4]">
                            {sc.narrationOrDialogue}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Optional Private Admin REST / Token Connector for Frameo-compatible API */}
              <form
                onSubmit={handleSaveFrameoConnector}
                className="p-4 rounded-xl border border-[#E2DDD3] dark:border-white/10 bg-[#FAF8F4] dark:bg-[#0B0B0E] space-y-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs font-semibold text-[#18181B] dark:text-[#F2F0EB]">
                    <PlugZap className="w-4 h-4 text-amber-600 dark:text-[#E5A93C]" />
                    <span>Conector Manual MCP / REST Frameo IA (Token o Endpoint Privado)</span>
                  </div>
                  {frameoConnSummary?.configured && (
                    <span className="text-[11px] font-mono-tech text-teal-700 dark:text-[#5EEAD4]">
                      {frameoConnSummary.label} ({frameoConnSummary.keyPreview || 'Configurado'})
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-[#57534E] dark:text-[#8D8981]">
                  Usa <code>https://mcp.frameo.ai/mcp</code> con token Bearer o indica un endpoint REST privado compatible con Frameo IA.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
                  <input
                    type="url"
                    aria-label="URL Endpoint Frameo IA"
                    value={frameoEndpointUrl}
                    onChange={(e) => setFrameoEndpointUrl(e.target.value)}
                    placeholder="https://mcp.frameo.ai/mcp"
                    className="rounded-lg border border-[#D6D1C7] dark:border-white/12 bg-[#FFFFFF] dark:bg-[#14141B] px-3 py-2 text-xs text-[#18181B] dark:text-[#F2F0EB] focus:border-[#E5A93C] focus:outline-none"
                  />
                  <input
                    type="password"
                    aria-label="Clave API Frameo IA"
                    value={frameoApiKey}
                    onChange={(e) => setFrameoApiKey(e.target.value)}
                    placeholder="Token Bearer MCP o API Key privada"
                    className="rounded-lg border border-[#D6D1C7] dark:border-white/12 bg-[#FFFFFF] dark:bg-[#14141B] px-3 py-2 text-xs text-[#18181B] dark:text-[#F2F0EB] focus:border-[#E5A93C] focus:outline-none"
                  />
                  <input
                    type="text"
                    aria-label="Modelo Frameo IA"
                    value={frameoModelName}
                    onChange={(e) => setFrameoModelName(e.target.value)}
                    placeholder="Veo 3.1 Rápido"
                    className="rounded-lg border border-[#D6D1C7] dark:border-white/12 bg-[#FFFFFF] dark:bg-[#14141B] px-3 py-2 text-xs font-mono-tech text-[#18181B] dark:text-[#F2F0EB] focus:border-[#E5A93C] focus:outline-none"
                  />
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <button
                    type="submit"
                    disabled={savingFrameoConn}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-amber-500/45 dark:border-[#E5A93C]/40 bg-amber-50 hover:bg-amber-100 dark:bg-[#1B1812] dark:hover:bg-[#272116] text-xs font-semibold text-[#18181B] dark:text-[#F2F0EB]"
                  >
                    <PlugZap className="w-3.5 h-3.5 text-amber-600 dark:text-[#E5A93C]" />
                    <span>{savingFrameoConn ? 'Conectando...' : 'Guardar conector privado Frameo IA'}</span>
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
