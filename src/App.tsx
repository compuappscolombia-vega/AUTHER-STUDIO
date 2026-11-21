import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Clapperboard,
  FileDown,
  Film,
  FolderPlus,
  Library,
  Lock,
  PanelLeftClose,
  PanelLeftOpen,
  PlugZap,
  UserCog,
  X,
} from 'lucide-react';
import type {
  ApiBillingTier,
  ApiCapability,
  ApiProviderKind,
  ApiProviderPublicSummary,
  AudioAnalysisReport,
  LearningCategory,
  LearningLesson,
  ProductionProject,
  ProductionSequence,
  ScreenplayNoteRole,
  SourceMaterialType,
  StudioSettings,
  WorkspaceTab,
} from './types/studio';
import { TopBar } from './components/TopBar';
import { ProjectSidebar } from './components/ProjectSidebar';
import { TimelineBar } from './components/TimelineBar';
import { WorkflowStepperBar } from './components/WorkflowStepperBar';
import { SourceIngestPanel } from './components/SourceIngestPanel';
import { VisionView } from './components/VisionView';
import { ShotsAndSoundView } from './components/ShotsAndSoundView';
import { ScreenplayView } from './components/ScreenplayView';
import { StoryboardView } from './components/StoryboardView';
import { ThreeDPrevisView } from './components/ThreeDPrevisView';
import { TrailerView } from './components/TrailerView';
import { LiveDirectorVoiceModal } from './components/LiveDirectorVoiceModal';
import { NewProjectModal } from './components/NewProjectModal';
import { AgentBlueprintModal } from './components/AgentBlueprintModal';
import { AuthModal } from './components/AuthModal';
import { AuthGate } from './components/AuthGate';
import { LearningModal } from './components/LearningModal';
import { StudioSettingsModal } from './components/StudioSettingsModal';
import { AdminAgentLabModal } from './components/AdminAgentLabModal';
import { VoiceoverPreviewModal } from './components/VoiceoverPreviewModal';
import { KeyboardShortcutsModal } from './components/KeyboardShortcutsModal';
import { ExternalProductionGuideModal } from './components/ExternalProductionGuideModal';
import { useAuth } from './context/AuthContext';
import {
  canExportPdfForSequence,
  extractAutomaticLessons,
  getFinalSequences,
} from './utils/learningEngine';
import { exportLibraryPdf, exportSequencePdf } from './utils/pdfExporter';
import {
  buildRatedChoiceLessons,
  buildStudioIntelligence,
} from './utils/studioIntelligence';
import {
  DEFAULT_STUDIO_SETTINGS,
  loadStudioSettings,
  mergeLocalAndCloudProjects,
  saveStudioSettings,
} from './utils/productionPipeline';
import { buildLocalPreviewFixture } from './utils/devPreviewFixture';
import { parseApiResponse } from './utils/apiClient';
import { VIDEO_PROVIDER_PRESETS } from './utils/apiProviders';
import {
  getNextStudioTab,
  isEditableEventTarget,
  resolveStudioShortcutAction,
} from './utils/keyboardShortcuts';
import {
  applyStudioTheme,
  persistStudioTheme,
  readInitialTheme,
  type StudioTheme,
} from './utils/theme';
import {
  addLessonToFirestore,
  deleteLessonFromFirestore,
  finalizeSequenceInFirestore,
  loadUserProjectsFromFirestore,
  saveProjectToFirestore,
  saveSequenceToFirestore,
  subscribeLessonsFromFirestore,
  updateProjectContinuityInFirestore,
} from './services/firestoreSync';

const LEGACY_CACHE_KEY = 'auteur_studio_projects_v2';

function getUserCacheKey(uid: string): string {
  return `auteur_studio_projects_v3_${uid}`;
}

function persistProjectsCache(key: string, projects: ProductionProject[]) {
  try {
    localStorage.setItem(key, JSON.stringify(projects));
  } catch {
    // Ignore storage quota or restricted iframe errors
  }
}

export default function App() {
  const {
    user,
    loading: authLoading,
    isVerified,
    isAdminSession,
    adminToken,
    isLocalDevPreview,
  } = useAuth();
  const skipCloudSync = isLocalDevPreview || isAdminSession;

  const [theme, setTheme] = useState<StudioTheme>(() => readInitialTheme());
  const [projects, setProjects] = useState<ProductionProject[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string>('');
  const [activeSequenceId, setActiveSequenceId] = useState<string>('');
  const [lessons, setLessons] = useState<LearningLesson[]>([]);
  const [studioSettings, setStudioSettings] = useState<StudioSettings>(
    DEFAULT_STUDIO_SETTINGS
  );
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('vision');
  const [searchQuery, setSearchQuery] = useState('');
  const [showIngest, setShowIngest] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [blueprintOpen, setBlueprintOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [learningOpen, setLearningOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [adminLabOpen, setAdminLabOpen] = useState(false);
  const [liveVoiceOpen, setLiveVoiceOpen] = useState(false);
  const [voiceoverModalOpen, setVoiceoverModalOpen] = useState(false);
  const [externalGuideOpen, setExternalGuideOpen] = useState(false);
  const [externalGuideScope, setExternalGuideScope] = useState<'sequence' | 'project'>('sequence');
  const [externalGuideAutoDelivered, setExternalGuideAutoDelivered] = useState(false);
  const [providersStatus, setProvidersStatus] = useState<
    Record<ApiCapability, ApiProviderPublicSummary> | null
  >(null);
  const [voiceoverBeatKey, setVoiceoverBeatKey] = useState<string | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [isReadingMode, setIsReadingMode] = useState(false);
  const [isProducing, setIsProducing] = useState(false);
  const [finalizingSeq, setFinalizingSeq] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [produceError, setProduceError] = useState<string | null>(null);
  const [adminVideoStatusNotice, setAdminVideoStatusNotice] = useState<string | null>(null);
  const [frameoFallbackFailure, setFrameoFallbackFailure] = useState<{
    message: string;
    projectId: string;
    sequenceId: string;
    frameId?: string;
    prompt: string;
    aspectRatio: string;
    duration: string;
  } | null>(null);
  const [showInlineManualApiForm, setShowInlineManualApiForm] = useState(false);
  const [manualVideoForm, setManualVideoForm] = useState<{
    providerHint: ApiProviderKind | 'auto';
    tierHint: ApiBillingTier;
    endpointUrl: string;
    apiKey: string;
    model: string;
  }>({
    providerHint: 'auto',
    tierHint: 'auto',
    endpointUrl: '',
    apiKey: '',
    model: '',
  });
  const [savingManualVideoApi, setSavingManualVideoApi] = useState(false);
  const [manualVideoFeedback, setManualVideoFeedback] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);
  const [retryingManualVideo, setRetryingManualVideo] = useState(false);

  useEffect(() => {
    applyStudioTheme(theme);
    persistStudioTheme(theme);
  }, [theme]);

  useEffect(() => {
    if (!isAdminSession && adminLabOpen) {
      setAdminLabOpen(false);
    }
  }, [isAdminSession, adminLabOpen]);

  function handleToggleTheme(next: StudioTheme) {
    setTheme(next);
  }

  // Purge legacy unauthenticated cache if present
  useEffect(() => {
    try {
      localStorage.removeItem(LEGACY_CACHE_KEY);
    } catch {
      // Ignore storage failures
    }
  }, []);

  // Automatically exit Reading Mode when leaving Screenplay tab
  useEffect(() => {
    if (activeTab !== 'screenplay' && isReadingMode) {
      setIsReadingMode(false);
    }
  }, [activeTab, isReadingMode]);

  // Global keyboard shortcuts for studio tabs, reading mode, and utility modals
  const hasBlockingModalOpen =
    newProjectOpen ||
    blueprintOpen ||
    authOpen ||
    learningOpen ||
    settingsOpen ||
    adminLabOpen ||
    liveVoiceOpen ||
    voiceoverModalOpen;

  const currentSequenceExists = Boolean(
    (projects.find((p) => p.id === activeProjectId) || projects[0])?.sequences?.length
  );

  useEffect(() => {
    function handleGlobalKeyDown(event: KeyboardEvent) {
      const action = resolveStudioShortcutAction({
        key: event.key,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        altKey: event.altKey,
        isEditable: isEditableEventTarget(event.target),
        hasBlockingModalOpen,
        shortcutsModalOpen: shortcutsOpen,
      });
      if (!action) return;

      event.preventDefault();
      if (action.type === 'toggle-shortcuts-modal') {
        setShortcutsOpen((v) => !v);
      } else if (action.type === 'switch-tab') {
        setActiveTab(action.tab);
      } else if (action.type === 'cycle-tab') {
        setActiveTab((prev) => getNextStudioTab(prev, action.direction));
      } else if (action.type === 'toggle-reading-mode') {
        if (!currentSequenceExists) return;
        if (activeTab !== 'screenplay') {
          setActiveTab('screenplay');
          setIsReadingMode(true);
        } else {
          setIsReadingMode((v) => !v);
        }
      } else if (action.type === 'toggle-ingest') {
        setShowIngest((v) => !v);
      } else if (action.type === 'open-voiceover-modal') {
        if (!currentSequenceExists) return;
        setVoiceoverBeatKey(null);
        setVoiceoverModalOpen(true);
      } else if (action.type === 'open-new-project') {
        setNewProjectOpen(true);
      } else if (action.type === 'open-settings') {
        setSettingsOpen(true);
      }
    }

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [activeTab, currentSequenceExists, hasBlockingModalOpen, shortcutsOpen]);

  // Load user-scoped workspace & Firestore cloud projects ONLY after verified login
  useEffect(() => {
    if (!user || !isVerified) {
      setProjects([]);
      setLessons([]);
      setActiveProjectId('');
      setActiveSequenceId('');
      setProduceError(null);
      setFrameoFallbackFailure(null);
      setAdminVideoStatusNotice(null);
      setProvidersStatus(null);
      return;
    }

    const uid = user.uid;
    const cacheKey = getUserCacheKey(uid);
    setStudioSettings(loadStudioSettings(uid));
    let cancelled = false;

    async function loadUserWorkspace() {
      let localProjects: ProductionProject[] = [];
      try {
        const [projRes, learnRes] = await Promise.all([
          fetch('/api/projects', { headers: { 'x-user-id': uid } }),
          fetch('/api/learning', { headers: { 'x-user-id': uid } }),
        ]);

        if (projRes.ok) {
          const data = await parseApiResponse<{ projects?: ProductionProject[] }>(
            projRes,
            'No se pudieron cargar los proyectos.'
          );
          if (Array.isArray(data.projects)) {
            localProjects = data.projects;
          }
        }

        if (learnRes.ok) {
          const learnData = await parseApiResponse<{ lessons?: LearningLesson[] }>(
            learnRes,
            'No se pudieron cargar las lecciones.'
          );
          if (!cancelled && Array.isArray(learnData.lessons)) {
            setLessons(learnData.lessons);
          }
        }
      } catch {
        try {
          const cached = localStorage.getItem(cacheKey);
          if (cached) {
            const parsed = JSON.parse(cached) as ProductionProject[];
            if (Array.isArray(parsed)) {
              localProjects = parsed;
            }
          }
        } catch {
          localProjects = [];
        }
      }

      if (cancelled) return;

      if (isLocalDevPreview && localProjects.length === 0) {
        localProjects = buildLocalPreviewFixture();
      }

      let merged = localProjects;
      if (!skipCloudSync) {
        try {
          const cloudProjects = await loadUserProjectsFromFirestore(uid);
          if (!cancelled && cloudProjects.length > 0) {
            merged = mergeLocalAndCloudProjects(localProjects, cloudProjects);
          }
        } catch (err) {
          console.error('Error cargando proyectos desde Firestore:', err);
        }
      }

      if (cancelled) return;
      setProjects(merged);
      persistProjectsCache(cacheKey, merged);
      setActiveProjectId((prevProjId) => {
        const resolvedProjId =
          prevProjId && merged.some((p) => p.id === prevProjId)
            ? prevProjId
            : merged[0]?.id || '';
        const targetProj = merged.find((p) => p.id === resolvedProjId) || merged[0];
        setActiveSequenceId((prevSeqId) => {
          if (!targetProj) return '';
          if (prevSeqId && targetProj.sequences.some((s) => s.id === prevSeqId)) {
            return prevSeqId;
          }
          return targetProj.sequences[0]?.id || '';
        });
        return resolvedProjId;
      });
    }

    void loadUserWorkspace();

    const unsubLessons = skipCloudSync
      ? () => {}
      : subscribeLessonsFromFirestore(uid, (cloudLessons) => {
          if (!cancelled && cloudLessons.length > 0) {
            setLessons(cloudLessons);
          }
        });

    return () => {
      cancelled = true;
      unsubLessons();
    };
  }, [user, isVerified, skipCloudSync, isLocalDevPreview]);

  // Load configured provider summaries (including private Frameo IA service for Admin)
  useEffect(() => {
    if (!user || !isVerified) return;
    let cancelled = false;
    fetch('/api/providers', {
      headers: {
        'x-user-id': user.uid,
        ...(isAdminSession && adminToken ? { Authorization: `Bearer ${adminToken}` } : {}),
      },
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { providers?: Record<ApiCapability, ApiProviderPublicSummary> } | null) => {
        if (!cancelled && data?.providers) {
          setProvidersStatus(data.providers);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [user, isVerified, isAdminSession, adminToken]);

  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#F5F3EE] text-[#18181B] dark:bg-[#0B0B0E] dark:text-[#F2F0EB] flex flex-col items-center justify-center gap-3 p-6">
        <Clapperboard className="w-7 h-7 text-amber-600 dark:text-[#E5A93C]" />
        <div className="font-display text-base font-semibold">AUTEUR Studio</div>
        <p className="text-xs text-[#57534E] dark:text-[#8D8981]">Verificando sesión de usuario...</p>
      </div>
    );
  }

  // Mandatory Authentication Gate: unauthenticated or unverified users cannot enter the workspace
  if (!user || !isVerified) {
    return <AuthGate theme={theme} onToggleTheme={handleToggleTheme} />;
  }

  const currentUid = user.uid;
  const userCacheKey = getUserCacheKey(currentUid);

  const activeProject =
    projects.find((p) => p.id === activeProjectId) || projects[0] || null;

  const activeSequence: ProductionSequence | null = activeProject
    ? activeProject.sequences.find((s) => s.id === activeSequenceId) ||
      activeProject.sequences[0] ||
      null
    : null;

  const isFinalSequence = canExportPdfForSequence(activeSequence);
  const finalSequencesCount = getFinalSequences(activeProject).length;
  const studioIntelligence = activeSequence
    ? buildStudioIntelligence({
        projects,
        lessons,
        activeProject,
        activeSequence,
      })
    : null;

  function handleSelectProject(projectId: string) {
    setActiveProjectId(projectId);
    const proj = projects.find((p) => p.id === projectId);
    setActiveSequenceId(proj?.sequences[0]?.id || '');
    setProduceError(null);
  }

  function handleSelectTimelineSequence(sequenceId: string) {
    setActiveSequenceId(sequenceId);
    if (activeTab === 'trailer') {
      setActiveTab('vision');
    }
  }

  function handleSaveStudioSettings(next: StudioSettings) {
    setStudioSettings(next);
    saveStudioSettings(currentUid, next);
  }

  async function ensureProjectSyncedOnServer(projectSnapshot?: ProductionProject | null) {
    const target = projectSnapshot || activeProject;
    if (!target) return;
    try {
      const res = await fetch('/api/projects/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': currentUid,
        },
        body: JSON.stringify({ project: target }),
      });
      if (!res.ok) return;
      const data = await parseApiResponse<{ project?: ProductionProject }>(
        res,
        'No se pudo sincronizar el proyecto con el servidor.'
      );
      if (data.project) {
        setProjects((prev) => {
          const next = prev.map((p) => (p.id === data.project!.id ? data.project! : p));
          persistProjectsCache(userCacheKey, next);
          return next;
        });
      }
    } catch {
      // Allow server action to proceed or fail cleanly with explicit error
    }
  }

  async function handleCreateProject(payload: {
    title: string;
    genreStyle: string;
    defaultSourceType: SourceMaterialType;
    continuityBible: string;
  }) {
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': currentUid,
      },
      body: JSON.stringify(payload),
    });
    const data = await parseApiResponse<{ project: ProductionProject }>(
      res,
      'Error al crear la producción.'
    );
    const created = data.project;
    const next = [created, ...projects];
    setProjects(next);
    persistProjectsCache(userCacheKey, next);
    setActiveProjectId(created.id);
    setActiveSequenceId('');
    setShowIngest(true);

    if (!skipCloudSync) {
      try {
        await saveProjectToFirestore(currentUid, created);
      } catch (err) {
        console.warn('No se pudo sincronizar proyecto en Firestore:', err);
      }
    }
  }

  async function handleSaveContinuity(continuityBible: string) {
    if (!activeProject) return;
    await ensureProjectSyncedOnServer(activeProject);

    const res = await fetch(`/api/projects/${activeProject.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': currentUid,
      },
      body: JSON.stringify({ continuityBible }),
    });
    const data = await parseApiResponse<{ project: ProductionProject }>(
      res,
      'No se pudo guardar la biblia.'
    );
    const updatedProj = data.project;
    setProjects((prev) => {
      const next = prev.map((p) => (p.id === updatedProj.id ? updatedProj : p));
      persistProjectsCache(userCacheKey, next);
      return next;
    });

    if (!skipCloudSync) {
      try {
        await updateProjectContinuityInFirestore(currentUid, updatedProj.id, continuityBible);
      } catch (err) {
        console.warn('No se pudo actualizar continuidad en Firestore:', err);
      }
    }
  }

  async function handleAnalyzeAudioOnly(
    projectId: string,
    file: File
  ): Promise<AudioAnalysisReport> {
    const targetProj = projects.find((p) => p.id === projectId) || activeProject;
    await ensureProjectSyncedOnServer(targetProj);

    const fd = new FormData();
    fd.append('projectId', projectId);
    fd.append('audioFile', file);
    const res = await fetch('/api/analyze-audio', {
      method: 'POST',
      headers: { 'x-user-id': currentUid },
      body: fd,
    });
    const data = await parseApiResponse<{
      project?: ProductionProject;
      report: AudioAnalysisReport;
    }>(res, 'Error analizando el archivo de audio.');
    if (data.project) {
      const updatedProj = data.project;
      setProjects((prev) => {
        const next = prev.map((p) => (p.id === updatedProj.id ? updatedProj : p));
        persistProjectsCache(userCacheKey, next);
        return next;
      });
    }
    return data.report;
  }

  async function handleAnalyzeChapters(formData: FormData): Promise<ProductionProject | null> {
    setProduceError(null);
    await ensureProjectSyncedOnServer(activeProject);
    const res = await fetch('/api/analyze-chapters', {
      method: 'POST',
      headers: { 'x-user-id': currentUid },
      body: formData,
    });
    const data = await parseApiResponse<{ project: ProductionProject }>(
      res,
      'No se pudo extraer la estructura de capítulos.'
    );
    const updatedProj = data.project;
    setProjects((prev) => {
      const next = prev.map((p) => (p.id === updatedProj.id ? updatedProj : p));
      persistProjectsCache(userCacheKey, next);
      return next;
    });
    if (!skipCloudSync) {
      try {
        await saveProjectToFirestore(currentUid, updatedProj);
      } catch (err) {
        console.warn('No se pudo guardar capítulos en Firestore:', err);
      }
    }
    return updatedProj;
  }

  async function pollVideoJobForApp(jobId: string): Promise<ProductionProject | null> {
    for (let attempt = 0; attempt < 95; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 2500));
      const res = await fetch(`/api/video-jobs/${encodeURIComponent(jobId)}`, {
        headers: {
          'x-user-id': currentUid,
          ...(isAdminSession && adminToken ? { Authorization: `Bearer ${adminToken}` } : {}),
        },
      });
      const data = await parseApiResponse<{
        status: 'pending' | 'completed' | 'failed';
        project?: ProductionProject;
        error?: string;
      }>(res, 'Error consultando el estado de generación de video.');

      if (data.status === 'completed') {
        return data.project || null;
      }
      if (data.status === 'failed') {
        throw new Error(data.error || 'El servicio de generación de video no pudo completar el clip.');
      }
    }
    throw new Error('Tiempo de espera agotado esperando la generación del video.');
  }

  async function runFrameoVideoForSequence(
    proj: ProductionProject,
    seq: ProductionSequence
  ): Promise<{ ok: boolean; project?: ProductionProject }> {
    const firstScene = seq.frameoProductionSpec?.scenes?.[0];
    const firstFrame = seq.storyboardFrames?.[0];
    const prompt = firstScene
      ? `${firstScene.frameoMotionPrompt} (${firstScene.frameoVisualPrompt})`
      : firstFrame
        ? `${firstFrame.veoMotionPrompt} (${firstFrame.visualPrompt})`
        : seq.hyperRealisticPrompt || seq.directorVision || seq.logline;

    const rawRatio = (seq.aspectRatio || '16:9').trim();
    const aspectRatio = rawRatio === '9:16' || rawRatio === '3:4' ? '9:16' : '16:9';
    const clipSec = Math.min(
      10,
      Math.max(3, Math.round(seq.frameoProductionSpec?.clipDurationSec || 5))
    );
    const duration = `${clipSec}s`;

    try {
      setAdminVideoStatusNotice(
        'Generando video de la secuencia con el servicio Frameo IA del Administrador...'
      );
      const res = await fetch('/api/admin/generate-frameo-video', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': currentUid,
          ...(adminToken ? { Authorization: `Bearer ${adminToken}` } : {}),
        },
        body: JSON.stringify({
          projectId: proj.id,
          sequenceId: seq.id,
          frameId: firstFrame?.id,
          prompt,
          aspectRatio,
          duration,
          imageUrl: firstFrame?.imageUrl,
          asyncJob: true,
        }),
      });

      const data = await parseApiResponse<{
        status?: string;
        jobId?: string;
        project?: ProductionProject;
        provider?: string;
      }>(res, 'El servicio de generación de video de Frameo IA falló.');

      let finalProj: ProductionProject | null = data.project || null;
      if (data.status === 'pending' && data.jobId) {
        finalProj = await pollVideoJobForApp(data.jobId);
      }

      if (finalProj) {
        setProjects((prev) => {
          const next = prev.map((p) => (p.id === finalProj!.id ? finalProj! : p));
          persistProjectsCache(userCacheKey, next);
          return next;
        });
      }

      setFrameoFallbackFailure(null);
      setShowInlineManualApiForm(false);
      setAdminVideoStatusNotice(
        `Video generado correctamente con Frameo IA (${data.provider || 'Servicio Admin'}).`
      );
      return { ok: true, project: finalProj || proj };
    } catch (err) {
      const reason =
        err instanceof Error
          ? err.message
          : 'El servicio de generación de video de Frameo IA no respondió.';
      setAdminVideoStatusNotice(null);
      setFrameoFallbackFailure({
        message: reason,
        projectId: proj.id,
        sequenceId: seq.id,
        frameId: firstFrame?.id,
        prompt,
        aspectRatio,
        duration,
      });
      setShowInlineManualApiForm(true);
      setManualVideoFeedback(null);
      return { ok: false };
    }
  }

  async function handleSaveManualVideoApi(andRetry: boolean) {
    setSavingManualVideoApi(true);
    setManualVideoFeedback(null);
    try {
      const res = await fetch('/api/providers/detect', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': currentUid,
          ...(isAdminSession && adminToken ? { Authorization: `Bearer ${adminToken}` } : {}),
        },
        body: JSON.stringify({
          capability: 'video',
          providerHint: manualVideoForm.providerHint,
          tierHint: manualVideoForm.tierHint,
          endpointUrl: manualVideoForm.endpointUrl,
          apiKey: manualVideoForm.apiKey,
          model: manualVideoForm.model,
          save: true,
        }),
      });
      const data = await parseApiResponse<{
        providers: Record<ApiCapability, ApiProviderPublicSummary>;
        diagnostics: string;
      }>(res, 'No se pudo validar ni guardar la API de generación manual.');

      setProvidersStatus(data.providers);
      setManualVideoForm((prev) => ({
        ...prev,
        providerHint: data.providers.video?.providerKind || prev.providerHint,
        endpointUrl: data.providers.video?.endpointUrl || prev.endpointUrl,
        model: data.providers.video?.model || prev.model,
        apiKey: '',
      }));
      setManualVideoFeedback({
        ok: true,
        text: data.diagnostics || 'API de video manual guardada correctamente.',
      });

      if (andRetry) {
        await handleRetryWithManualVideoApi();
      }
    } catch (err) {
      setManualVideoFeedback({
        ok: false,
        text: err instanceof Error ? err.message : 'No se pudo configurar la API manual.',
      });
    } finally {
      setSavingManualVideoApi(false);
    }
  }

  async function handleRetryWithManualVideoApi() {
    const failureCtx = frameoFallbackFailure;
    const targetProject =
      (failureCtx ? projects.find((p) => p.id === failureCtx.projectId) : null) || activeProject;
    const targetSeq =
      (failureCtx && targetProject
        ? targetProject.sequences.find((s) => s.id === failureCtx.sequenceId)
        : null) || activeSequence;

    if (!targetProject || !targetSeq) return;

    setRetryingManualVideo(true);
    setManualVideoFeedback(null);
    setProduceError(null);
    try {
      await ensureProjectSyncedOnServer(targetProject);
      const firstFrame = targetSeq.storyboardFrames?.[0];
      const prompt =
        failureCtx?.prompt ||
        (firstFrame
          ? `${firstFrame.veoMotionPrompt} (${firstFrame.visualPrompt})`
          : targetSeq.hyperRealisticPrompt || targetSeq.directorVision || targetSeq.logline);
      const aspectRatio = failureCtx?.aspectRatio || (targetSeq.aspectRatio === '9:16' ? '9:16' : '16:9');
      const duration = failureCtx?.duration || '6s';

      const res = await fetch('/api/generate-video', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': currentUid,
          ...(isAdminSession && adminToken ? { Authorization: `Bearer ${adminToken}` } : {}),
        },
        body: JSON.stringify({
          projectId: targetProject.id,
          sequenceId: targetSeq.id,
          frameId: failureCtx?.frameId || firstFrame?.id,
          prompt,
          aspectRatio,
          duration,
          imageUrl: firstFrame?.imageUrl,
          asyncJob: true,
        }),
      });
      const data = await parseApiResponse<{
        status?: string;
        jobId?: string;
        project?: ProductionProject;
        provider?: string;
      }>(res, 'La API de generación manual no pudo iniciar el renderizado de video.');

      let finalProj: ProductionProject | null = data.project || null;
      if (data.status === 'pending' && data.jobId) {
        setAdminVideoStatusNotice('Renderizando clip con la API de video configurada manualmente...');
        finalProj = await pollVideoJobForApp(data.jobId);
      }

      if (finalProj) {
        await handleProjectMediaUpdated(finalProj);
      }
      setFrameoFallbackFailure(null);
      setShowInlineManualApiForm(false);
      setAdminVideoStatusNotice(
        `Video generado con éxito usando tu API manual (${data.provider || 'API de Respaldo'}).`
      );
      setActiveTab('storyboard');
    } catch (err) {
      setManualVideoFeedback({
        ok: false,
        text:
          err instanceof Error
            ? err.message
            : 'No se pudo generar el video con la API manual configurada.',
      });
    } finally {
      setRetryingManualVideo(false);
    }
  }

  async function handleProduce(formData: FormData): Promise<ProductionProject | null> {
    setIsProducing(true);
    setProduceError(null);
    setAdminVideoStatusNotice(null);
    setFrameoFallbackFailure(null);
    try {
      await ensureProjectSyncedOnServer(activeProject);
      const res = await fetch('/api/produce', {
        method: 'POST',
        headers: {
          'x-user-id': currentUid,
          ...(isAdminSession && adminToken
            ? { Authorization: `Bearer ${adminToken}` }
            : {}),
        },
        body: formData,
      });
      const data = await parseApiResponse<{
        project: ProductionProject;
        sequence: ProductionSequence;
      }>(res, 'Error en la producción cinematográfica.');
      let updatedProj = data.project;
      const newSeq = data.sequence;
      setProjects((prev) => {
        const next = prev.map((p) => (p.id === updatedProj.id ? updatedProj : p));
        persistProjectsCache(userCacheKey, next);
        return next;
      });
      setActiveSequenceId(newSeq.id);

      // Perfil 'Admin': utilizar específicamente el servicio de generación de video de Frameo IA
      if (isAdminSession) {
        const frameoOutcome = await runFrameoVideoForSequence(updatedProj, newSeq);
        if (frameoOutcome.ok) {
          if (frameoOutcome.project) {
            updatedProj = frameoOutcome.project;
          }
          setActiveTab('storyboard');
          setExternalGuideScope('sequence');
          setExternalGuideAutoDelivered(true);
          setExternalGuideOpen(true);
        } else {
          // Mostrar inmediatamente la secuencia producida y el panel de configuración manual de API
          setActiveTab('vision');
        }
      } else {
        setActiveTab('vision');
        setExternalGuideScope('sequence');
        setExternalGuideAutoDelivered(true);
        setExternalGuideOpen(true);
      }

      if (!skipCloudSync) {
        try {
          await saveProjectToFirestore(currentUid, updatedProj);
          await saveSequenceToFirestore(currentUid, updatedProj.id, newSeq);
        } catch (err) {
          console.warn('No se pudo respaldar la secuencia en Firestore:', err);
        }
      }
      return updatedProj;
    } catch (err) {
      setProduceError(
        err instanceof Error ? err.message : 'No se pudo completar la producción.'
      );
      return null;
    } finally {
      setIsProducing(false);
    }
  }

  async function handleApproveFinalVersion() {
    if (!activeProject || !activeSequence || activeSequence.versionStatus === 'final') return;
    setFinalizingSeq(true);
    setProduceError(null);
    try {
      await ensureProjectSyncedOnServer(activeProject);
      const res = await fetch(
        `/api/projects/${activeProject.id}/sequences/${activeSequence.id}/finalize`,
        {
          method: 'PATCH',
          headers: { 'x-user-id': currentUid },
        }
      );
      const data = await parseApiResponse<{
        project: ProductionProject;
        lessons?: LearningLesson[];
      }>(res, 'No se pudo aprobar la Versión Final.');
      const updatedProj = data.project;
      setProjects((prev) => {
        const next = prev.map((p) => (p.id === updatedProj.id ? updatedProj : p));
        persistProjectsCache(userCacheKey, next);
        return next;
      });
      if (Array.isArray(data.lessons)) {
        setLessons(data.lessons);
      }

      if (!skipCloudSync) {
        try {
          await finalizeSequenceInFirestore(currentUid, activeProject.id, activeSequence.id);
          const autoLessons = extractAutomaticLessons(activeProject.title, {
            ...activeSequence,
            versionStatus: 'final',
          });
          for (let i = 0; i < autoLessons.length; i++) {
            await addLessonToFirestore(currentUid, {
              ...autoLessons[i],
              id: `lesson-auto-${Date.now().toString(36)}-${i}`,
              createdAt: new Date().toISOString(),
            });
          }
        } catch (err) {
          console.warn('Error sincronizando aprobación final en Firestore:', err);
        }
      }
    } catch (err) {
      setProduceError(
        err instanceof Error ? err.message : 'No se pudo aprobar la Versión Final.'
      );
    } finally {
      setFinalizingSeq(false);
    }
  }

  async function handleExportSequencePdf() {
    if (!activeProject || !activeSequence) return;
    setExportingPdf(true);
    setProduceError(null);
    try {
      await exportSequencePdf(activeProject, activeSequence);
    } catch (err) {
      setProduceError(
        err instanceof Error ? err.message : 'No se pudo generar el PDF.'
      );
    } finally {
      setExportingPdf(false);
    }
  }

  async function handleExportLibraryPdf() {
    if (!activeProject) return;
    setExportingPdf(true);
    setProduceError(null);
    try {
      await exportLibraryPdf(activeProject);
    } catch (err) {
      setProduceError(
        err instanceof Error ? err.message : 'No se pudo generar la biblioteca PDF.'
      );
    } finally {
      setExportingPdf(false);
    }
  }

  async function handleAddLesson(payload: {
    category: LearningCategory;
    insight: string;
    rating: number;
    sourceProjectTitle: string;
  }) {
    const res = await fetch('/api/learning', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': currentUid,
      },
      body: JSON.stringify(payload),
    });
    const data = await parseApiResponse<{
      lesson?: LearningLesson;
      lessons?: LearningLesson[];
    }>(res, 'No se pudo guardar la lección.');
    if (Array.isArray(data.lessons)) {
      setLessons(data.lessons);
    }
    if (data.lesson && !skipCloudSync) {
      try {
        await addLessonToFirestore(currentUid, data.lesson);
      } catch (err) {
        console.warn('Error guardando lección en Firestore:', err);
      }
    }
  }

  async function handleDeleteLesson(lessonId: string) {
    const res = await fetch(`/api/learning/${lessonId}`, {
      method: 'DELETE',
      headers: { 'x-user-id': currentUid },
    });
    const data = await parseApiResponse<{ lessons?: LearningLesson[] }>(
      res,
      'No se pudo eliminar la lección.'
    );
    if (Array.isArray(data.lessons)) {
      setLessons(data.lessons);
    }
    if (!skipCloudSync) {
      try {
        await deleteLessonFromFirestore(currentUid, lessonId);
      } catch (err) {
        console.warn('Error eliminando lección en Firestore:', err);
      }
    }
  }

  async function handleRateSequence(rating: number, note: string) {
    if (!activeProject || !activeSequence) return;
    setProduceError(null);
    await ensureProjectSyncedOnServer(activeProject);
    const res = await fetch(
      `/api/projects/${activeProject.id}/sequences/${activeSequence.id}/rate`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': currentUid,
        },
        body: JSON.stringify({ rating, note }),
      }
    );
    const data = await parseApiResponse<{
      project?: ProductionProject;
      lessons?: LearningLesson[];
    }>(res, 'No se pudo registrar la evaluación de la secuencia.');
    if (data.project) {
      const updatedProj = data.project;
      setProjects((prev) => {
        const next = prev.map((p) => (p.id === updatedProj.id ? updatedProj : p));
        persistProjectsCache(userCacheKey, next);
        return next;
      });
    }
    if (Array.isArray(data.lessons)) {
      setLessons(data.lessons);
    }
    if (rating >= 4 && !skipCloudSync) {
      try {
        const extracted = buildRatedChoiceLessons({
          projectTitle: activeProject.title,
          sequence: activeSequence,
          rating,
          note,
        });
        for (let i = 0; i < extracted.length; i++) {
          await addLessonToFirestore(currentUid, {
            ...extracted[i],
            id: `lesson-rate-${Date.now().toString(36)}-${i}`,
            createdAt: new Date().toISOString(),
          });
        }
      } catch (err) {
        console.warn('Error sincronizando lecciones en Firestore:', err);
      }
    }
  }

  async function handleApplyEnhancement(snippet: string) {
    if (!activeProject) return;
    const base = (activeProject.continuityBible || '').trim();
    const cleanSnippet = snippet.trim();
    if (!cleanSnippet || base.includes(cleanSnippet)) return;
    const nextBible = base ? `${base}\n\n${cleanSnippet}` : cleanSnippet;
    await handleSaveContinuity(nextBible);
  }

  async function handleAddScreenplayNote(payload: {
    beatKey: string;
    sceneNumber: string;
    beatIndex: number;
    beatType: 'action' | 'dialogue' | 'camera' | 'sound';
    lineExcerpt: string;
    authorRole: ScreenplayNoteRole;
    authorName: string;
    note: string;
  }) {
    if (!activeProject || !activeSequence) return;
    await ensureProjectSyncedOnServer(activeProject);
    const res = await fetch(
      `/api/projects/${activeProject.id}/sequences/${activeSequence.id}/notes`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': currentUid,
        },
        body: JSON.stringify(payload),
      }
    );
    const data = await parseApiResponse<{
      project: ProductionProject;
      sequence: ProductionSequence;
    }>(res, 'No se pudo guardar la nota al pie.');
    setProjects((prev) => {
      const next = prev.map((p) => (p.id === data.project.id ? data.project : p));
      persistProjectsCache(userCacheKey, next);
      return next;
    });
    if (!skipCloudSync && data.sequence.versionStatus === 'draft') {
      try {
        await saveSequenceToFirestore(currentUid, data.project.id, data.sequence);
      } catch (err) {
        console.warn('No se pudo sincronizar nota al pie en Firestore:', err);
      }
    }
  }

  async function handleToggleResolveScreenplayNote(noteId: string, resolved: boolean) {
    if (!activeProject || !activeSequence) return;
    await ensureProjectSyncedOnServer(activeProject);
    const res = await fetch(
      `/api/projects/${activeProject.id}/sequences/${activeSequence.id}/notes/${noteId}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': currentUid,
        },
        body: JSON.stringify({ resolved }),
      }
    );
    const data = await parseApiResponse<{
      project: ProductionProject;
      sequence: ProductionSequence;
    }>(res, 'No se pudo actualizar la nota al pie.');
    setProjects((prev) => {
      const next = prev.map((p) => (p.id === data.project.id ? data.project : p));
      persistProjectsCache(userCacheKey, next);
      return next;
    });
    if (!skipCloudSync && data.sequence.versionStatus === 'draft') {
      try {
        await saveSequenceToFirestore(currentUid, data.project.id, data.sequence);
      } catch (err) {
        console.warn('No se pudo sincronizar estado de nota en Firestore:', err);
      }
    }
  }

  async function handleDeleteScreenplayNote(noteId: string) {
    if (!activeProject || !activeSequence) return;
    await ensureProjectSyncedOnServer(activeProject);
    const res = await fetch(
      `/api/projects/${activeProject.id}/sequences/${activeSequence.id}/notes/${noteId}`,
      {
        method: 'DELETE',
        headers: { 'x-user-id': currentUid },
      }
    );
    const data = await parseApiResponse<{
      project: ProductionProject;
      sequence: ProductionSequence;
    }>(res, 'No se pudo eliminar la nota al pie.');
    setProjects((prev) => {
      const next = prev.map((p) => (p.id === data.project.id ? data.project : p));
      persistProjectsCache(userCacheKey, next);
      return next;
    });
    if (!skipCloudSync && data.sequence.versionStatus === 'draft') {
      try {
        await saveSequenceToFirestore(currentUid, data.project.id, data.sequence);
      } catch (err) {
        console.warn('No se pudo eliminar nota en Firestore:', err);
      }
    }
  }

  async function handleProjectMediaUpdated(updatedProj: ProductionProject) {
    setProjects((prev) => {
      const next = prev.map((p) => (p.id === updatedProj.id ? updatedProj : p));
      persistProjectsCache(userCacheKey, next);
      return next;
    });

    if (!skipCloudSync && activeSequence) {
      const updatedSeq = updatedProj.sequences.find((s) => s.id === activeSequence.id);
      if (updatedSeq && updatedSeq.versionStatus === 'draft') {
        try {
          await saveSequenceToFirestore(currentUid, updatedProj.id, updatedSeq);
        } catch (err) {
          console.warn('No se pudo sincronizar media de secuencia en Firestore:', err);
        }
      }
    }
  }

  function handleProjectSeeded(seededProjects: ProductionProject[], seededId: string) {
    setProjects(seededProjects);
    persistProjectsCache(userCacheKey, seededProjects);
    const target = seededProjects.find((p) => p.id === seededId) || seededProjects[0];
    if (target) {
      setActiveProjectId(target.id);
      setActiveSequenceId(target.sequences[0]?.id || '');
    }
  }

  const userLabel = user.displayName || user.email?.split('@')[0] || 'Director';
  const hideChromeForReading = activeTab === 'screenplay' && isReadingMode;

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-[#F5F3EE] text-[#18181B] dark:bg-[#0B0B0E] dark:text-[#F2F0EB] transition-colors">
      {!hideChromeForReading && (
        <div className="no-print shrink-0">
          <TopBar
            activeTab={activeTab}
            onTabChange={setActiveTab}
            onOpenNewProject={() => setNewProjectOpen(true)}
            onOpenAuth={() => setAuthOpen(true)}
            onOpenAdminLab={() => setAdminLabOpen(true)}
            isAdmin={isAdminSession}
            userLabel={userLabel}
            onToggleMobileMenu={() => setMobileMenuOpen(true)}
            theme={theme}
            onToggleTheme={handleToggleTheme}
          />

          {/* Mobile Tab Bar */}
          <nav
            aria-label="Vistas móviles del estudio"
            className="flex md:hidden items-center justify-between gap-1 px-2.5 py-1.5 border-b border-[#E2DDD3] dark:border-white/10 bg-[#FAF8F4] dark:bg-[#101015] overflow-x-auto shrink-0"
          >
            {(
              [
                { id: 'vision', label: 'Dirección' },
                { id: 'shots', label: 'Planos' },
                { id: 'screenplay', label: 'Guion' },
                { id: 'storyboard', label: 'Storyboard' },
                { id: 'previs3d', label: 'Pre-Vis 3D' },
                { id: 'trailer', label: 'Tráiler 30s' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`px-2 py-1.5 rounded-md text-[11px] font-medium whitespace-nowrap shrink-0 ${
                  activeTab === tab.id
                    ? 'bg-[#E5A93C] text-[#0B0B0E] font-semibold'
                    : 'text-[#57534E] hover:text-[#18181B] dark:text-[#9A968E] dark:hover:text-[#F2F0EB]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        {!hideChromeForReading && (
          <div className="no-print flex shrink-0">
            <ProjectSidebar
              projects={projects}
              activeProjectId={activeProject?.id || ''}
              searchQuery={searchQuery}
              lessonsCount={lessons.length}
              isAdmin={isAdminSession}
              onSearchChange={setSearchQuery}
              onSelectProject={handleSelectProject}
              onOpenNewProject={() => setNewProjectOpen(true)}
              onOpenAgentBlueprint={() => setBlueprintOpen(true)}
              onOpenAdminLab={() => setAdminLabOpen(true)}
              onOpenLearning={() => setLearningOpen(true)}
              onOpenSettings={() => setSettingsOpen(true)}
              onOpenShortcuts={() => setShortcutsOpen(true)}
              mobileOpen={mobileMenuOpen}
              onCloseMobile={() => setMobileMenuOpen(false)}
            />
          </div>
        )}

        <main className="flex-1 flex flex-col overflow-hidden min-w-0">
          {!hideChromeForReading && (
            <>
              {/* Active Project & Sequence Bar */}
              {activeProject && (
                <div className="no-print border-b border-[#E2DDD3] dark:border-white/10 bg-[#FAF8F4] dark:bg-[#101015] px-4 sm:px-5 py-3 flex flex-wrap items-center justify-between gap-3 shrink-0">
                  <div className="min-w-0 max-w-full">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <h1 className="font-display text-base sm:text-lg font-semibold text-[#18181B] dark:text-[#F2F0EB] truncate">
                        {activeProject.title}
                      </h1>
                      {activeSequence && (
                        <span
                          className={`text-[11px] font-mono-tech font-medium ${
                            isFinalSequence
                              ? 'text-teal-700 dark:text-[#38B2AC]'
                              : 'text-amber-700 dark:text-[#E5A93C]'
                          }`}
                        >
                          {isFinalSequence ? 'Versión Final' : 'Borrador'}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-[#57534E] dark:text-[#8D8981] truncate">
                      {activeProject.genreStyle}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                    {activeProject.sequences.length > 0 && (
                      <div className="flex items-center gap-2 w-full sm:w-auto">
                        <label htmlFor="active-sequence-select" className="sr-only">
                          Secuencia activa
                        </label>
                        <select
                          id="active-sequence-select"
                          value={activeSequence?.id || ''}
                          onChange={(e) => setActiveSequenceId(e.target.value)}
                          className="w-full sm:w-auto sm:max-w-[220px] rounded-lg border border-[#D6D1C7] dark:border-white/12 bg-[#FFFFFF] dark:bg-[#0B0B0E] px-3 py-1.5 text-xs text-[#18181B] dark:text-[#F2F0EB] focus:border-[#E5A93C] focus:outline-none"
                        >
                          {activeProject.sequences.map((seq) => (
                            <option key={seq.id} value={seq.id}>
                              {seq.title} ({seq.versionStatus === 'final' ? 'Final' : 'Borrador'})
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    {activeSequence && !isFinalSequence && (
                      <button
                        type="button"
                        onClick={handleApproveFinalVersion}
                        disabled={finalizingSeq}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-teal-600/35 dark:border-[#38B2AC]/45 bg-teal-50 hover:bg-teal-100 dark:bg-[#102625] dark:hover:bg-[#163433] text-xs font-medium text-teal-800 dark:text-[#5EEAD4] whitespace-nowrap shrink-0 disabled:opacity-60"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>
                          {finalizingSeq ? 'Aprobando...' : 'Aprobar Versión Final'}
                        </span>
                      </button>
                    )}

                    {activeSequence && (
                      <button
                        type="button"
                        onClick={handleExportSequencePdf}
                        disabled={!isFinalSequence || exportingPdf}
                        title={
                          isFinalSequence
                            ? 'Exportar bitácora completa en PDF (guion, VFX e ilustraciones)'
                            : 'Exportación bloqueada: aprueba primero la Versión Final'
                        }
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                          isFinalSequence
                            ? 'border-[#E5A93C]/50 bg-amber-50 hover:bg-amber-100 dark:bg-[#1B1812] dark:hover:bg-[#272116] text-[#18181B] dark:text-[#F2F0EB]'
                            : 'border-[#E2DDD3] dark:border-white/10 bg-[#F1EFE9] dark:bg-[#121217] text-[#78746C] dark:text-[#6E6A63] cursor-not-allowed'
                        }`}
                      >
                        {isFinalSequence ? (
                          <FileDown className="w-3.5 h-3.5 text-amber-600 dark:text-[#E5A93C]" />
                        ) : (
                          <Lock className="w-3.5 h-3.5 text-[#78746C] dark:text-[#6E6A63]" />
                        )}
                        <span>
                          {isFinalSequence ? 'Bitácora PDF' : 'PDF bloqueado (Borrador)'}
                        </span>
                      </button>
                    )}

                    {activeSequence && (
                      <button
                        type="button"
                        onClick={() => {
                          setExternalGuideScope('sequence');
                          setExternalGuideAutoDelivered(false);
                          setExternalGuideOpen(true);
                        }}
                        title="Abrir guía detallada paso a paso generada por Agente Arthur para producir en una plataforma externa"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-amber-600/40 dark:border-[#E5A93C]/45 bg-amber-50 hover:bg-amber-100 dark:bg-[#1B1710] dark:hover:bg-[#262015] text-xs font-medium text-amber-800 dark:text-[#E5A93C] whitespace-nowrap shrink-0"
                      >
                        <Bot className="w-3.5 h-3.5 shrink-0" />
                        <span>Guía Externa Arthur</span>
                      </button>
                    )}

                    {finalSequencesCount > 0 && (
                      <button
                        type="button"
                        onClick={handleExportLibraryPdf}
                        disabled={exportingPdf}
                        title="Exportar biblioteca de todas las secuencias en Versión Final"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#D6D1C7] dark:border-white/12 bg-[#FFFFFF] hover:bg-[#F1EFE9] dark:bg-[#16161E] dark:hover:bg-[#1E1E29] text-xs font-medium text-[#27272A] dark:text-[#E6E2DA] whitespace-nowrap shrink-0"
                      >
                        <Library className="w-3.5 h-3.5 text-amber-600 dark:text-[#E5A93C]" />
                        <span>Biblioteca PDF</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => setShowIngest((v) => !v)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#D6D1C7] dark:border-white/12 bg-[#FFFFFF] hover:bg-[#F1EFE9] dark:bg-[#16161E] dark:hover:bg-[#1E1E29] text-xs font-medium text-[#27272A] dark:text-[#E6E2DA] whitespace-nowrap shrink-0"
                    >
                      {showIngest ? (
                        <>
                          <PanelLeftClose className="w-3.5 h-3.5 text-amber-600 dark:text-[#E5A93C]" />
                          <span>Ocultar mesa</span>
                        </>
                      ) : (
                        <>
                          <PanelLeftOpen className="w-3.5 h-3.5 text-amber-600 dark:text-[#E5A93C]" />
                          <span>Ingresar material</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}

              {/* Horizontal Approved Sequences Timeline */}
              {activeProject && (
                <div className="no-print shrink-0">
                  <TimelineBar
                    project={activeProject}
                    activeSequenceId={activeSequence?.id || ''}
                    onSelectSequence={handleSelectTimelineSequence}
                  />
                </div>
              )}

              {/* Clear Step-by-Step Film Delivery Workflow Strip */}
              <WorkflowStepperBar
                activeProject={activeProject}
                activeSequence={activeSequence}
                activeTab={activeTab}
                onSelectTab={setActiveTab}
                onOpenNewProject={() => setNewProjectOpen(true)}
                onOpenIngest={() => setShowIngest(true)}
                onApproveFinal={handleApproveFinalVersion}
                onOpenLiveVoice={() => setLiveVoiceOpen(true)}
                onOpenExternalGuide={() => {
                  setExternalGuideScope('sequence');
                  setExternalGuideAutoDelivered(false);
                  setExternalGuideOpen(true);
                }}
                finalizingSeq={finalizingSeq}
              />
            </>
          )}

          {/* Split Workspace: Ingest Drawer + Active View */}
          <div className="flex-1 flex flex-col xl:flex-row overflow-y-auto xl:overflow-hidden">
            {!hideChromeForReading && activeProject && showIngest && (
              <div className="no-print flex shrink-0">
                <SourceIngestPanel
                  userId={currentUid}
                  project={activeProject}
                  studioSettings={studioSettings}
                  isAdmin={isAdminSession}
                  isProducing={isProducing}
                  errorMessage={produceError}
                  onDismissError={() => setProduceError(null)}
                  onSaveContinuity={handleSaveContinuity}
                  onProduce={handleProduce}
                  onAnalyzeAudioOnly={handleAnalyzeAudioOnly}
                  onAnalyzeChapters={handleAnalyzeChapters}
                />
              </div>
            )}

            <div
              className={`flex-1 min-w-0 ${
                hideChromeForReading
                  ? 'overflow-hidden flex flex-col'
                  : 'xl:overflow-y-auto p-6 lg:p-8'
              }`}
            >
              {/* Admin Frameo IA Video Status / Manual API Fallback Recovery Panel */}
              {!hideChromeForReading && isAdminSession && adminVideoStatusNotice && (
                <div className="mb-4 rounded-xl border border-teal-600/35 dark:border-[#38B2AC]/40 bg-teal-50 dark:bg-[#102625] px-4 py-3 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-xs text-teal-800 dark:text-[#A7F3D0]">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    <span>{adminVideoStatusNotice}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setAdminVideoStatusNotice(null)}
                    aria-label="Cerrar aviso de video Admin"
                    className="p-1 rounded text-teal-700 dark:text-[#5EEAD4] hover:bg-black/5 dark:hover:bg-white/10"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {!hideChromeForReading && isAdminSession && frameoFallbackFailure && (
                <section
                  role="alert"
                  aria-label="Respaldo manual cuando falla Frameo IA"
                  className="mb-5 rounded-xl border border-amber-500/50 dark:border-[#E5A93C]/50 bg-amber-50 dark:bg-[#1A140B] p-4 sm:p-5 space-y-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex items-start gap-2.5 max-w-2xl">
                      <AlertTriangle className="w-5 h-5 text-amber-700 dark:text-[#E5A93C] shrink-0 mt-0.5" />
                      <div className="space-y-1">
                        <h2 className="text-xs sm:text-sm font-semibold text-[#18181B] dark:text-[#F2F0EB]">
                          El servicio de generación de video Frameo IA no funcionó
                        </h2>
                        <p className="text-xs text-[#3F3F46] dark:text-[#D4CFC7] leading-relaxed">
                          {frameoFallbackFailure.message}
                        </p>
                        <p className="text-[11px] text-[#57534E] dark:text-[#9A968E]">
                          La secuencia fue dirigida por Arthur. Configura manualmente una API de generación
                          de video (free o de pago) para renderizar el video de la secuencia sin perder tu trabajo.
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setShowInlineManualApiForm((v) => !v)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#E5A93C] hover:bg-[#EDA949] text-[#0B0B0E] text-xs font-semibold whitespace-nowrap"
                      >
                        <PlugZap className="w-3.5 h-3.5" />
                        <span>
                          {showInlineManualApiForm
                            ? 'Ocultar configuración manual'
                            : 'Configurar API manualmente'}
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setSettingsOpen(true)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#D6D1C7] dark:border-white/15 bg-[#FFFFFF] dark:bg-[#14141B] hover:border-[#E5A93C] text-xs font-medium text-[#18181B] dark:text-[#F2F0EB] whitespace-nowrap"
                      >
                        <Film className="w-3.5 h-3.5 text-amber-600 dark:text-[#E5A93C]" />
                        <span>Abrir Configuración Completa</span>
                      </button>

                      {providersStatus?.video?.configured && (
                        <button
                          type="button"
                          disabled={retryingManualVideo}
                          onClick={() => void handleRetryWithManualVideoApi()}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-teal-600/40 dark:border-[#38B2AC]/45 bg-teal-50 hover:bg-teal-100 dark:bg-[#102625] dark:hover:bg-[#163433] text-xs font-semibold text-teal-800 dark:text-[#5EEAD4] whitespace-nowrap disabled:opacity-60"
                        >
                          <Film className="w-3.5 h-3.5" />
                          <span>
                            {retryingManualVideo
                              ? 'Generando con API Manual...'
                              : `Reintentar con ${providersStatus.video.label}`}
                          </span>
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => setFrameoFallbackFailure(null)}
                        aria-label="Descartar aviso de respaldo manual"
                        className="p-1.5 rounded-lg text-[#57534E] dark:text-[#9A968E] hover:bg-black/5 dark:hover:bg-white/10"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {showInlineManualApiForm && (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        void handleSaveManualVideoApi(true);
                      }}
                      className="pt-3 border-t border-amber-500/30 dark:border-white/10 space-y-3"
                    >
                      <div className="text-xs font-semibold text-[#18181B] dark:text-[#F2F0EB]">
                        Configuración Manual Rápida de API de Video (Free o Pago)
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2.5">
                        <div>
                          <label
                            htmlFor="manual-video-preset"
                            className="block text-[11px] font-medium text-[#3F3F46] dark:text-[#C8C3BA] mb-1"
                          >
                            Proveedor de Video
                          </label>
                          <select
                            id="manual-video-preset"
                            value={manualVideoForm.providerHint}
                            onChange={(e) => {
                              const nextId = e.target.value as ApiProviderKind | 'auto';
                              const preset = VIDEO_PROVIDER_PRESETS.find((p) => p.id === nextId);
                              setManualVideoForm((prev) => ({
                                ...prev,
                                providerHint: nextId,
                                endpointUrl:
                                  preset?.defaultEndpointUrl ||
                                  (nextId === 'auto' ? prev.endpointUrl : ''),
                                model:
                                  preset?.defaultModel || (nextId === 'auto' ? prev.model : ''),
                                tierHint:
                                  preset?.tierLabel === 'Free'
                                    ? 'free'
                                    : preset?.tierLabel === 'Pago'
                                      ? 'paid'
                                      : 'auto',
                              }));
                            }}
                            className="w-full rounded-lg border border-[#D6D1C7] dark:border-white/12 bg-[#FFFFFF] dark:bg-[#0B0B0E] px-2.5 py-1.5 text-xs text-[#18181B] dark:text-[#F2F0EB] focus:border-[#E5A93C] focus:outline-none"
                          >
                            {VIDEO_PROVIDER_PRESETS.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.label}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label
                            htmlFor="manual-video-tier"
                            className="block text-[11px] font-medium text-[#3F3F46] dark:text-[#C8C3BA] mb-1"
                          >
                            Tipo de API
                          </label>
                          <select
                            id="manual-video-tier"
                            value={manualVideoForm.tierHint}
                            onChange={(e) =>
                              setManualVideoForm((prev) => ({
                                ...prev,
                                tierHint: e.target.value as ApiBillingTier,
                              }))
                            }
                            className="w-full rounded-lg border border-[#D6D1C7] dark:border-white/12 bg-[#FFFFFF] dark:bg-[#0B0B0E] px-2.5 py-1.5 text-xs text-[#18181B] dark:text-[#F2F0EB] focus:border-[#E5A93C] focus:outline-none"
                          >
                            <option value="auto">Auto-detectar</option>
                            <option value="free">Gratuita (Free)</option>
                            <option value="paid">De Pago</option>
                          </select>
                        </div>

                        <div>
                          <label
                            htmlFor="manual-video-url"
                            className="block text-[11px] font-medium text-[#3F3F46] dark:text-[#C8C3BA] mb-1"
                          >
                            URL Endpoint HTTPS
                          </label>
                          <input
                            id="manual-video-url"
                            type="url"
                            value={manualVideoForm.endpointUrl}
                            onChange={(e) =>
                              setManualVideoForm((prev) => ({
                                ...prev,
                                endpointUrl: e.target.value,
                              }))
                            }
                            placeholder="https://api.tu-proveedor-video.com/v1/generate"
                            className="w-full rounded-lg border border-[#D6D1C7] dark:border-white/12 bg-[#FFFFFF] dark:bg-[#0B0B0E] px-2.5 py-1.5 text-xs font-mono-tech text-[#18181B] dark:text-[#F2F0EB] focus:border-[#E5A93C] focus:outline-none"
                          />
                        </div>

                        <div>
                          <label
                            htmlFor="manual-video-key"
                            className="block text-[11px] font-medium text-[#3F3F46] dark:text-[#C8C3BA] mb-1"
                          >
                            API Key / Token
                          </label>
                          <input
                            id="manual-video-key"
                            type="password"
                            autoComplete="off"
                            value={manualVideoForm.apiKey}
                            onChange={(e) =>
                              setManualVideoForm((prev) => ({
                                ...prev,
                                apiKey: e.target.value,
                              }))
                            }
                            placeholder="hf_..., r8_..., AIza..., sk-..."
                            className="w-full rounded-lg border border-[#D6D1C7] dark:border-white/12 bg-[#FFFFFF] dark:bg-[#0B0B0E] px-2.5 py-1.5 text-xs font-mono-tech text-[#18181B] dark:text-[#F2F0EB] focus:border-[#E5A93C] focus:outline-none"
                          />
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex-1 min-w-[200px] max-w-xs">
                          <input
                            aria-label="Modelo manual de video"
                            type="text"
                            value={manualVideoForm.model}
                            onChange={(e) =>
                              setManualVideoForm((prev) => ({ ...prev, model: e.target.value }))
                            }
                            placeholder="Modelo (opcional, ej. Wan2.1-T2V-14B)"
                            className="w-full rounded-lg border border-[#D6D1C7] dark:border-white/12 bg-[#FFFFFF] dark:bg-[#0B0B0E] px-2.5 py-1.5 text-xs font-mono-tech text-[#18181B] dark:text-[#F2F0EB] focus:border-[#E5A93C] focus:outline-none"
                          />
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            disabled={savingManualVideoApi || retryingManualVideo}
                            onClick={() => void handleSaveManualVideoApi(false)}
                            className="px-3 py-1.5 rounded-lg border border-[#D6D1C7] dark:border-white/15 bg-[#FFFFFF] dark:bg-[#14141B] hover:border-[#E5A93C] text-xs font-medium text-[#18181B] dark:text-[#F2F0EB] disabled:opacity-60"
                          >
                            {savingManualVideoApi ? 'Validando...' : 'Solo guardar API'}
                          </button>
                          <button
                            type="submit"
                            disabled={savingManualVideoApi || retryingManualVideo}
                            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[#E5A93C] hover:bg-[#EDA949] text-[#0B0B0E] text-xs font-semibold disabled:opacity-60"
                          >
                            <Film className="w-3.5 h-3.5" />
                            <span>
                              {savingManualVideoApi || retryingManualVideo
                                ? 'Procesando...'
                                : 'Guardar API Manual y Generar Video'}
                            </span>
                          </button>
                        </div>
                      </div>

                      {manualVideoFeedback && (
                        <p
                          className={`text-xs ${
                            manualVideoFeedback.ok
                              ? 'text-teal-700 dark:text-[#5EEAD4]'
                              : 'text-rose-700 dark:text-rose-300'
                          }`}
                        >
                          {manualVideoFeedback.text}
                        </p>
                      )}
                    </form>
                  )}
                </section>
              )}

              {activeTab === 'trailer' && activeProject ? (
                <TrailerView
                  userId={currentUid}
                  project={activeProject}
                  studioSettings={studioSettings}
                  adminToken={adminToken}
                  providersStatus={providersStatus}
                  onEnsureProjectSynced={() => ensureProjectSyncedOnServer(activeProject)}
                  onProjectUpdated={handleProjectMediaUpdated}
                  onGoToVision={() => setActiveTab('vision')}
                  onOpenSettings={() => setSettingsOpen(true)}
                />
              ) : isProducing ? (
                <div className="py-20 max-w-md mx-auto text-center space-y-3">
                  <Clapperboard className="w-8 h-8 text-amber-600 dark:text-[#E5A93C] mx-auto" />
                  <h2 className="font-display text-lg font-semibold text-[#18181B] dark:text-[#F2F0EB]">
                    {isAdminSession
                      ? 'Agente Arthur produciendo con Frameo IA'
                      : 'Agente Arthur dirigiendo producción'}
                  </h2>
                  <p className="text-xs text-[#57534E] dark:text-[#9A968E] leading-relaxed">
                    {isAdminSession
                      ? 'Estructurando guion técnico, anclajes de continuidad y ejecutando el servicio de generación de video de Frameo IA.'
                      : 'Estructurando óptica de cámara, temperaturas de luz, lista de planos, mezcla Dolby Atmos, voces en off realistas, VFX, guion y guía paso a paso externa.'}
                  </p>
                </div>
              ) : activeSequence && activeProject ? (
                <>
                  {activeTab === 'vision' && studioIntelligence && (
                    <VisionView
                      key={activeSequence.id}
                      sequence={activeSequence}
                      continuityBible={activeProject.continuityBible || ''}
                      intelligence={studioIntelligence}
                      onRateSequence={handleRateSequence}
                      onApplyEnhancement={handleApplyEnhancement}
                      onOpenExternalGuide={() => {
                        setExternalGuideScope('sequence');
                        setExternalGuideAutoDelivered(false);
                        setExternalGuideOpen(true);
                      }}
                    />
                  )}
                  {activeTab === 'shots' && (
                    <ShotsAndSoundView
                      key={activeSequence.id}
                      userId={currentUid}
                      projectId={activeProject.id}
                      sequence={activeSequence}
                      onEnsureProjectSynced={() => ensureProjectSyncedOnServer(activeProject)}
                      onProjectMediaUpdated={handleProjectMediaUpdated}
                      onOpenVoiceoverModal={(beatKey) => {
                        setVoiceoverBeatKey(beatKey || null);
                        setVoiceoverModalOpen(true);
                      }}
                    />
                  )}
                  {activeTab === 'screenplay' && (
                    <ScreenplayView
                      key={activeSequence.id}
                      project={activeProject}
                      sequence={activeSequence}
                      isReadingMode={isReadingMode}
                      onToggleReadingMode={setIsReadingMode}
                      onExportSequencePdf={handleExportSequencePdf}
                      exportingPdf={exportingPdf}
                      onAddNote={handleAddScreenplayNote}
                      onToggleResolveNote={handleToggleResolveScreenplayNote}
                      onDeleteNote={handleDeleteScreenplayNote}
                      onOpenVoiceoverModal={(beatKey) => {
                        setVoiceoverBeatKey(beatKey || null);
                        setVoiceoverModalOpen(true);
                      }}
                      onOpenShortcuts={() => setShortcutsOpen(true)}
                    />
                  )}
                  {activeTab === 'storyboard' && (
                    <StoryboardView
                      key={activeSequence.id}
                      userId={currentUid}
                      projectId={activeProject.id}
                      sequence={activeSequence}
                      defaultResolution={studioSettings.defaultResolution}
                      adminToken={adminToken}
                      providersStatus={providersStatus}
                      onEnsureProjectSynced={() => ensureProjectSyncedOnServer(activeProject)}
                      onProjectMediaUpdated={handleProjectMediaUpdated}
                      onOpenSettings={() => setSettingsOpen(true)}
                    />
                  )}
                  {activeTab === 'previs3d' && (
                    <ThreeDPrevisView
                      key={activeSequence.id}
                      sequence={activeSequence}
                    />
                  )}
                </>
              ) : activeProject ? (
                <div className="py-20 max-w-md mx-auto text-center space-y-4">
                  <Clapperboard className="w-9 h-9 text-amber-600 dark:text-[#E5A93C] mx-auto" />
                  <h2 className="font-display text-xl font-semibold text-[#18181B] dark:text-[#F2F0EB]">
                    Producción lista para rodar
                  </h2>
                  <p className="text-sm text-[#57534E] dark:text-[#9A968E] leading-relaxed">
                    Carga un capítulo de libro, un audiolibro en MP3/WAV/M4A/OGG o dicta tu
                    historia en la mesa de ingesta para dirigir la primera secuencia.
                  </p>
                  {!showIngest && (
                    <button
                      type="button"
                      onClick={() => setShowIngest(true)}
                      className="px-4 py-2 rounded-lg bg-[#E5A93C] hover:bg-[#EDA949] text-[#0B0B0E] text-xs font-semibold"
                    >
                      Abrir mesa de ingesta
                    </button>
                  )}
                </div>
              ) : (
                <div className="py-20 max-w-lg mx-auto text-center space-y-5">
                  <Clapperboard className="w-10 h-10 text-amber-600 dark:text-[#E5A93C] mx-auto" />
                  <div className="space-y-2">
                    <h1 className="font-display text-2xl font-semibold text-[#18181B] dark:text-[#F2F0EB]">
                      Nuevo proyecto cinematográfico
                    </h1>
                    <p className="text-sm text-[#57534E] dark:text-[#9A968E] leading-relaxed">
                      Tu mesa de dirección comienza completamente en blanco. Crea tu primer
                      proyecto para adaptar un libro, analizar un audiolibro o dirigir una
                      historia original desde cero.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center justify-center gap-3">
                    <button
                      type="button"
                      onClick={() => setNewProjectOpen(true)}
                      className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#E5A93C] hover:bg-[#EDA949] text-[#0B0B0E] text-xs font-semibold transition-colors"
                    >
                      <FolderPlus className="w-4 h-4" />
                      <span>Crear nueva producción</span>
                    </button>
                    {isAdminSession && (
                      <button
                        type="button"
                        onClick={() => setAdminLabOpen(true)}
                        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg border border-[#E5A93C]/50 bg-amber-50 hover:bg-amber-100 dark:bg-[#1B1710] dark:hover:bg-[#272116] text-[#18181B] dark:text-[#F2F0EB] text-xs font-semibold transition-colors"
                      >
                        <UserCog className="w-4 h-4 text-amber-600 dark:text-[#E5A93C]" />
                        <span>Abrir Laboratorio del Agente</span>
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </main>
      </div>

      <NewProjectModal
        open={newProjectOpen}
        onClose={() => setNewProjectOpen(false)}
        onCreate={handleCreateProject}
      />

      <AgentBlueprintModal
        open={blueprintOpen}
        onClose={() => setBlueprintOpen(false)}
        activeProject={activeProject}
      />

      <AuthModal
        open={authOpen}
        onClose={() => setAuthOpen(false)}
        onOpenAdminLab={isAdminSession ? () => setAdminLabOpen(true) : undefined}
      />

      {isAdminSession && (
        <AdminAgentLabModal
          open={adminLabOpen}
          userId={currentUid}
          adminToken={adminToken}
          activeProject={activeProject}
          activeSequence={activeSequence}
          lessons={lessons}
          onClose={() => setAdminLabOpen(false)}
          onAddLesson={handleAddLesson}
          onDeleteLesson={handleDeleteLesson}
          onProjectSeeded={handleProjectSeeded}
          onEnsureProjectSynced={() => ensureProjectSyncedOnServer(activeProject)}
          onProjectUpdated={handleProjectMediaUpdated}
          onProvidersChanged={setProvidersStatus}
        />
      )}

      <LearningModal
        open={learningOpen}
        lessons={lessons}
        activeProjectTitle={activeProject?.title || 'AUTEUR Studio'}
        onClose={() => setLearningOpen(false)}
        onAddLesson={handleAddLesson}
        onDeleteLesson={handleDeleteLesson}
      />

      <StudioSettingsModal
        open={settingsOpen}
        userId={currentUid}
        isAdmin={isAdminSession}
        adminToken={adminToken}
        frameoFailureReason={frameoFallbackFailure?.message || null}
        settings={studioSettings}
        onClose={() => setSettingsOpen(false)}
        onSaveSettings={handleSaveStudioSettings}
        onProvidersChanged={setProvidersStatus}
        onRetryWithManualVideoApi={
          isAdminSession && frameoFallbackFailure
            ? () => void handleRetryWithManualVideoApi()
            : undefined
        }
      />

      <ExternalProductionGuideModal
        open={externalGuideOpen}
        project={activeProject}
        sequence={activeSequence}
        initialScope={externalGuideScope}
        autoDelivered={externalGuideAutoDelivered}
        onClose={() => {
          setExternalGuideOpen(false);
          setExternalGuideAutoDelivered(false);
        }}
      />

      <LiveDirectorVoiceModal
        open={liveVoiceOpen}
        onClose={() => setLiveVoiceOpen(false)}
        activeProject={activeProject}
        activeSequence={activeSequence}
        defaultVoicePreset={studioSettings.defaultVoicePreset}
      />

      <VoiceoverPreviewModal
        open={voiceoverModalOpen}
        sequence={activeSequence || null}
        initialBeatKey={voiceoverBeatKey}
        onClose={() => setVoiceoverModalOpen(false)}
      />

      <KeyboardShortcutsModal
        open={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
      />
    </div>
  );
}
