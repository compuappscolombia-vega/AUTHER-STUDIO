import { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Clapperboard,
  FileDown,
  FolderPlus,
  Library,
  Lock,
  PanelLeftClose,
  PanelLeftOpen,
  UserCog,
} from 'lucide-react';
import type {
  AudioAnalysisReport,
  LearningCategory,
  LearningLesson,
  ProductionProject,
  ProductionSequence,
  SourceMaterialType,
  StudioSettings,
  WorkspaceTab,
} from './types/studio';
import { TopBar } from './components/TopBar';
import { ProjectSidebar } from './components/ProjectSidebar';
import { TimelineBar } from './components/TimelineBar';
import { SourceIngestPanel } from './components/SourceIngestPanel';
import { VisionView } from './components/VisionView';
import { ShotsAndSoundView } from './components/ShotsAndSoundView';
import { ScreenplayView } from './components/ScreenplayView';
import { StoryboardView } from './components/StoryboardView';
import { TrailerView } from './components/TrailerView';
import { NewProjectModal } from './components/NewProjectModal';
import { AgentBlueprintModal } from './components/AgentBlueprintModal';
import { AuthModal } from './components/AuthModal';
import { AuthGate } from './components/AuthGate';
import { LearningModal } from './components/LearningModal';
import { StudioSettingsModal } from './components/StudioSettingsModal';
import { AdminAgentLabModal } from './components/AdminAgentLabModal';
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

export default function App() {
  const { user, loading: authLoading, isVerified, isAdminSession, isLocalDevPreview } = useAuth();
  const skipCloudSync = isLocalDevPreview || isAdminSession;

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
  const [isProducing, setIsProducing] = useState(false);
  const [finalizingSeq, setFinalizingSeq] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [produceError, setProduceError] = useState<string | null>(null);

  // Purge legacy unauthenticated cache if present
  useEffect(() => {
    try {
      localStorage.removeItem(LEGACY_CACHE_KEY);
    } catch {
      // Ignore storage failures
    }
  }, []);

  // Load user-scoped workspace & Firestore cloud projects ONLY after verified login
  useEffect(() => {
    if (!user || !isVerified) {
      setProjects([]);
      setLessons([]);
      setActiveProjectId('');
      setActiveSequenceId('');
      setProduceError(null);
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
          const data = (await projRes.json()) as { projects: ProductionProject[] };
          if (Array.isArray(data.projects)) {
            localProjects = data.projects;
          }
        }

        if (learnRes.ok) {
          const learnData = (await learnRes.json()) as { lessons: LearningLesson[] };
          if (!cancelled && Array.isArray(learnData.lessons)) {
            setLessons(learnData.lessons);
          }
        }
      } catch {
        const cached = localStorage.getItem(cacheKey);
        if (cached) {
          try {
            const parsed = JSON.parse(cached) as ProductionProject[];
            if (Array.isArray(parsed)) {
              localProjects = parsed;
            }
          } catch {
            localProjects = [];
          }
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
      localStorage.setItem(cacheKey, JSON.stringify(merged));
      setActiveProjectId((prev) => {
        if (prev && merged.some((p) => p.id === prev)) return prev;
        return merged[0]?.id || '';
      });
      setActiveSequenceId((prev) => {
        if (!merged.length) return '';
        const target = merged.find((p) => p.id === activeProjectId) || merged[0];
        if (prev && target?.sequences.some((s) => s.id === prev)) return prev;
        return target?.sequences[0]?.id || '';
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
  }, [user?.uid, isVerified, skipCloudSync]);

  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#0B0B0E] text-[#F2F0EB] flex flex-col items-center justify-center gap-3 p-6">
        <Clapperboard className="w-7 h-7 text-[#E5A93C]" />
        <div className="font-display text-base font-semibold">AUTEUR Studio</div>
        <p className="text-xs text-[#8D8981]">Verificando sesión de usuario...</p>
      </div>
    );
  }

  // Mandatory Authentication Gate: unauthenticated or unverified users cannot enter the workspace
  if (!user || !isVerified) {
    return <AuthGate />;
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
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Error al crear la producción.');
    }
    const created = data.project as ProductionProject;
    const next = [created, ...projects];
    setProjects(next);
    localStorage.setItem(userCacheKey, JSON.stringify(next));
    setActiveProjectId(created.id);
    setActiveSequenceId('');
    setShowIngest(true);

    if (!skipCloudSync) {
      await saveProjectToFirestore(currentUid, created);
    }
  }

  async function handleSaveContinuity(continuityBible: string) {
    if (!activeProject) return;
    if (isLocalDevPreview && activeProject.id === 'proj-preview-odisea') {
      const updatedProj: ProductionProject = {
        ...activeProject,
        continuityBible,
        updatedAt: new Date().toISOString(),
      };
      const next = projects.map((p) => (p.id === updatedProj.id ? updatedProj : p));
      setProjects(next);
      localStorage.setItem(userCacheKey, JSON.stringify(next));
      return;
    }

    const res = await fetch(`/api/projects/${activeProject.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': currentUid,
      },
      body: JSON.stringify({ continuityBible }),
    });
    const data = await res.json();
    if (!res.ok) {
      setProduceError(data.error || 'No se pudo guardar la biblia.');
      return;
    }
    const updatedProj = data.project as ProductionProject;
    const next = projects.map((p) => (p.id === updatedProj.id ? updatedProj : p));
    setProjects(next);
    localStorage.setItem(userCacheKey, JSON.stringify(next));

    if (!skipCloudSync) {
      await updateProjectContinuityInFirestore(currentUid, updatedProj.id, continuityBible);
    }
  }

  async function handleAnalyzeAudioOnly(
    projectId: string,
    file: File
  ): Promise<AudioAnalysisReport> {
    const fd = new FormData();
    fd.append('projectId', projectId);
    fd.append('audioFile', file);
    const res = await fetch('/api/analyze-audio', {
      method: 'POST',
      headers: { 'x-user-id': currentUid },
      body: fd,
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Error analizando el archivo de audio.');
    }
    if (data.project) {
      const updatedProj = data.project as ProductionProject;
      setProjects((prev) => {
        const next = prev.map((p) => (p.id === updatedProj.id ? updatedProj : p));
        localStorage.setItem(userCacheKey, JSON.stringify(next));
        return next;
      });
    }
    return data.report as AudioAnalysisReport;
  }

  async function handleAnalyzeChapters(formData: FormData): Promise<ProductionProject | null> {
    setProduceError(null);
    const res = await fetch('/api/analyze-chapters', {
      method: 'POST',
      headers: { 'x-user-id': currentUid },
      body: formData,
    });
    const data = await res.json();
    if (!res.ok) {
      const msg = data.error || 'No se pudo extraer la estructura de capítulos.';
      setProduceError(msg);
      throw new Error(msg);
    }
    const updatedProj = data.project as ProductionProject;
    setProjects((prev) => {
      const next = prev.map((p) => (p.id === updatedProj.id ? updatedProj : p));
      localStorage.setItem(userCacheKey, JSON.stringify(next));
      return next;
    });
    if (!skipCloudSync) {
      await saveProjectToFirestore(currentUid, updatedProj);
    }
    return updatedProj;
  }

  async function handleProduce(formData: FormData): Promise<ProductionProject | null> {
    setIsProducing(true);
    setProduceError(null);
    try {
      const res = await fetch('/api/produce', {
        method: 'POST',
        headers: { 'x-user-id': currentUid },
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Error en la producción cinematográfica.');
      }
      const updatedProj = data.project as ProductionProject;
      const newSeq = data.sequence as ProductionSequence;
      setProjects((prev) => {
        const next = prev.map((p) => (p.id === updatedProj.id ? updatedProj : p));
        localStorage.setItem(userCacheKey, JSON.stringify(next));
        return next;
      });
      setActiveSequenceId(newSeq.id);
      setActiveTab('vision');

      if (!skipCloudSync) {
        await saveProjectToFirestore(currentUid, updatedProj);
        await saveSequenceToFirestore(currentUid, updatedProj.id, newSeq);
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
      const res = await fetch(
        `/api/projects/${activeProject.id}/sequences/${activeSequence.id}/finalize`,
        {
          method: 'PATCH',
          headers: { 'x-user-id': currentUid },
        }
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'No se pudo aprobar la Versión Final.');
      }
      const updatedProj = data.project as ProductionProject;
      const next = projects.map((p) => (p.id === updatedProj.id ? updatedProj : p));
      setProjects(next);
      localStorage.setItem(userCacheKey, JSON.stringify(next));
      if (Array.isArray(data.lessons)) {
        setLessons(data.lessons);
      }

      if (!skipCloudSync) {
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
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'No se pudo guardar la lección.');
    }
    if (Array.isArray(data.lessons)) {
      setLessons(data.lessons);
    }
    if (data.lesson && !skipCloudSync) {
      await addLessonToFirestore(currentUid, data.lesson as LearningLesson);
    }
  }

  async function handleDeleteLesson(lessonId: string) {
    const res = await fetch(`/api/learning/${lessonId}`, {
      method: 'DELETE',
      headers: { 'x-user-id': currentUid },
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.lessons)) {
        setLessons(data.lessons);
      }
    }
    if (!skipCloudSync) {
      await deleteLessonFromFirestore(currentUid, lessonId);
    }
  }

  async function handleRateSequence(rating: number, note: string) {
    if (!activeProject || !activeSequence) return;
    setProduceError(null);
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
    const data = await res.json();
    if (!res.ok) {
      const msg = data.error || 'No se pudo registrar la evaluación de la secuencia.';
      setProduceError(msg);
      throw new Error(msg);
    }
    if (data.project) {
      const updatedProj = data.project as ProductionProject;
      const next = projects.map((p) => (p.id === updatedProj.id ? updatedProj : p));
      setProjects(next);
      localStorage.setItem(userCacheKey, JSON.stringify(next));
    }
    if (Array.isArray(data.lessons)) {
      setLessons(data.lessons);
    }
    if (rating >= 4 && !skipCloudSync) {
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

  async function handleProjectMediaUpdated(updatedProj: ProductionProject) {
    const next = projects.map((p) => (p.id === updatedProj.id ? updatedProj : p));
    setProjects(next);
    localStorage.setItem(userCacheKey, JSON.stringify(next));

    if (!skipCloudSync && activeSequence) {
      const updatedSeq = updatedProj.sequences.find((s) => s.id === activeSequence.id);
      if (updatedSeq && updatedSeq.versionStatus === 'draft') {
        await saveSequenceToFirestore(currentUid, updatedProj.id, updatedSeq);
      }
    }
  }

  function handleProjectSeeded(seededProjects: ProductionProject[], seededId: string) {
    setProjects(seededProjects);
    localStorage.setItem(userCacheKey, JSON.stringify(seededProjects));
    const target = seededProjects.find((p) => p.id === seededId) || seededProjects[0];
    if (target) {
      setActiveProjectId(target.id);
      setActiveSequenceId(target.sequences[0]?.id || '');
    }
  }

  const userLabel = user.displayName || user.email?.split('@')[0] || 'Director';

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-[#0B0B0E] text-[#F2F0EB]">
      <TopBar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onOpenNewProject={() => setNewProjectOpen(true)}
        onOpenAuth={() => setAuthOpen(true)}
        onOpenAdminLab={() => setAdminLabOpen(true)}
        isAdmin={isAdminSession}
        userLabel={userLabel}
        onToggleMobileMenu={() => setMobileMenuOpen(true)}
      />

      {/* Mobile Tab Bar */}
      <nav
        aria-label="Vistas móviles del estudio"
        className="flex md:hidden items-center justify-between gap-1 px-2.5 py-1.5 border-b border-white/10 bg-[#101015] overflow-x-auto shrink-0"
      >
        {(
          [
            { id: 'vision', label: 'Dirección' },
            { id: 'shots', label: 'Planos' },
            { id: 'screenplay', label: 'Guion' },
            { id: 'storyboard', label: 'Storyboard' },
            { id: 'trailer', label: 'Tráiler 30s' },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`px-2 py-1.5 rounded-md text-[11px] font-medium whitespace-nowrap shrink-0 ${
              activeTab === tab.id
                ? 'bg-[#E5A93C] text-[#0B0B0E]'
                : 'text-[#9A968E] hover:text-[#F2F0EB]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <div className="flex-1 flex overflow-hidden">
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
          mobileOpen={mobileMenuOpen}
          onCloseMobile={() => setMobileMenuOpen(false)}
        />

        <main className="flex-1 flex flex-col overflow-hidden min-w-0">
          {/* Active Project & Sequence Bar */}
          {activeProject && (
            <div className="border-b border-white/10 bg-[#101015] px-4 sm:px-5 py-3 flex flex-wrap items-center justify-between gap-3 shrink-0">
              <div className="min-w-0 max-w-full">
                <div className="flex flex-wrap items-center gap-2.5">
                  <h1 className="font-display text-base sm:text-lg font-semibold text-[#F2F0EB] truncate">
                    {activeProject.title}
                  </h1>
                  {activeSequence && (
                    <span
                      className={`text-[11px] font-mono-tech ${
                        isFinalSequence ? 'text-[#38B2AC]' : 'text-[#E5A93C]'
                      }`}
                    >
                      {isFinalSequence ? 'Versión Final' : 'Borrador'}
                    </span>
                  )}
                </div>
                <div className="text-xs text-[#8D8981] truncate">
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
                      className="w-full sm:w-auto sm:max-w-[220px] rounded-lg border border-white/12 bg-[#0B0B0E] px-3 py-1.5 text-xs text-[#F2F0EB] focus:border-[#E5A93C] focus:outline-none"
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
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#38B2AC]/45 bg-[#102625] hover:bg-[#163433] text-xs font-medium text-[#5EEAD4] whitespace-nowrap shrink-0 disabled:opacity-60"
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
                        ? 'border-[#E5A93C]/45 bg-[#1B1812] hover:bg-[#272116] text-[#F2F0EB]'
                        : 'border-white/10 bg-[#121217] text-[#6E6A63] cursor-not-allowed'
                    }`}
                  >
                    {isFinalSequence ? (
                      <FileDown className="w-3.5 h-3.5 text-[#E5A93C]" />
                    ) : (
                      <Lock className="w-3.5 h-3.5 text-[#6E6A63]" />
                    )}
                    <span>
                      {isFinalSequence ? 'Bitácora PDF' : 'PDF bloqueado (Borrador)'}
                    </span>
                  </button>
                )}

                {finalSequencesCount > 0 && (
                  <button
                    type="button"
                    onClick={handleExportLibraryPdf}
                    disabled={exportingPdf}
                    title="Exportar biblioteca de todas las secuencias en Versión Final"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/12 bg-[#16161E] hover:bg-[#1E1E29] text-xs font-medium text-[#E6E2DA] whitespace-nowrap shrink-0"
                  >
                    <Library className="w-3.5 h-3.5 text-[#E5A93C]" />
                    <span>Biblioteca PDF</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setShowIngest((v) => !v)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/12 bg-[#16161E] hover:bg-[#1E1E29] text-xs font-medium text-[#E6E2DA] whitespace-nowrap shrink-0"
                >
                  {showIngest ? (
                    <>
                      <PanelLeftClose className="w-3.5 h-3.5 text-[#E5A93C]" />
                      <span>Ocultar mesa</span>
                    </>
                  ) : (
                    <>
                      <PanelLeftOpen className="w-3.5 h-3.5 text-[#E5A93C]" />
                      <span>Ingresar material</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Horizontal Approved Sequences Timeline */}
          {activeProject && (
            <TimelineBar
              project={activeProject}
              activeSequenceId={activeSequence?.id || ''}
              onSelectSequence={handleSelectTimelineSequence}
            />
          )}

          {/* Split Workspace: Ingest Drawer + Active View */}
          <div className="flex-1 flex flex-col xl:flex-row overflow-y-auto xl:overflow-hidden">
            {activeProject && showIngest && (
              <SourceIngestPanel
                userId={currentUid}
                project={activeProject}
                studioSettings={studioSettings}
                isProducing={isProducing}
                errorMessage={produceError}
                onDismissError={() => setProduceError(null)}
                onSaveContinuity={handleSaveContinuity}
                onProduce={handleProduce}
                onAnalyzeAudioOnly={handleAnalyzeAudioOnly}
                onAnalyzeChapters={handleAnalyzeChapters}
              />
            )}

            <div className="flex-1 xl:overflow-y-auto p-6 lg:p-8 min-w-0">
              {activeTab === 'trailer' && activeProject ? (
                <TrailerView
                  userId={currentUid}
                  project={activeProject}
                  studioSettings={studioSettings}
                  onProjectUpdated={handleProjectMediaUpdated}
                  onGoToVision={() => setActiveTab('vision')}
                />
              ) : isProducing ? (
                <div className="py-20 max-w-md mx-auto text-center space-y-3">
                  <Clapperboard className="w-8 h-8 text-[#E5A93C] mx-auto" />
                  <h2 className="font-display text-lg font-semibold text-[#F2F0EB]">
                    Diseñando producción cinematográfica
                  </h2>
                  <p className="text-xs text-[#9A968E] leading-relaxed">
                    Estructurando óptica de cámara, temperaturas de luz, lista de planos, mezcla
                    Dolby Atmos, voces en off realistas, VFX y guion completo.
                  </p>
                </div>
              ) : activeSequence ? (
                <>
                  {activeTab === 'vision' && studioIntelligence && activeProject && (
                    <VisionView
                      key={activeSequence.id}
                      sequence={activeSequence}
                      continuityBible={activeProject.continuityBible || ''}
                      intelligence={studioIntelligence}
                      onRateSequence={handleRateSequence}
                      onApplyEnhancement={handleApplyEnhancement}
                    />
                  )}
                  {activeTab === 'shots' && activeProject && (
                    <ShotsAndSoundView
                      userId={currentUid}
                      projectId={activeProject.id}
                      sequence={activeSequence}
                      onProjectMediaUpdated={handleProjectMediaUpdated}
                    />
                  )}
                  {activeTab === 'screenplay' && activeProject && (
                    <ScreenplayView
                      project={activeProject}
                      sequence={activeSequence}
                      onExportSequencePdf={handleExportSequencePdf}
                      exportingPdf={exportingPdf}
                    />
                  )}
                  {activeTab === 'storyboard' && activeProject && (
                    <StoryboardView
                      key={activeSequence.id}
                      userId={currentUid}
                      projectId={activeProject.id}
                      sequence={activeSequence}
                      defaultResolution={studioSettings.defaultResolution}
                      onProjectMediaUpdated={handleProjectMediaUpdated}
                    />
                  )}
                </>
              ) : activeProject ? (
                <div className="py-20 max-w-md mx-auto text-center space-y-4">
                  <Clapperboard className="w-9 h-9 text-[#E5A93C] mx-auto" />
                  <h2 className="font-display text-xl font-semibold text-[#F2F0EB]">
                    Producción lista para rodar
                  </h2>
                  <p className="text-sm text-[#9A968E] leading-relaxed">
                    Carga un capítulo de libro, un audiolibro en MP3/WAV/M4A/OGG o dicta tu
                    historia en la mesa de ingesta para dirigir la primera secuencia.
                  </p>
                  {!showIngest && (
                    <button
                      type="button"
                      onClick={() => setShowIngest(true)}
                      className="px-4 py-2 rounded-lg bg-[#E5A93C] text-[#0B0B0E] text-xs font-semibold"
                    >
                      Abrir mesa de ingesta
                    </button>
                  )}
                </div>
              ) : (
                <div className="py-20 max-w-lg mx-auto text-center space-y-5">
                  <Clapperboard className="w-10 h-10 text-[#E5A93C] mx-auto" />
                  <div className="space-y-2">
                    <h1 className="font-display text-2xl font-semibold text-[#F2F0EB]">
                      Nuevo proyecto cinematográfico
                    </h1>
                    <p className="text-sm text-[#9A968E] leading-relaxed">
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
                        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg border border-[#E5A93C]/45 bg-[#1B1710] hover:bg-[#272116] text-[#F2F0EB] text-xs font-semibold transition-colors"
                      >
                        <UserCog className="w-4 h-4 text-[#E5A93C]" />
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
        onOpenAdminLab={() => setAdminLabOpen(true)}
      />

      <AdminAgentLabModal
        open={adminLabOpen}
        userId={currentUid}
        activeProject={activeProject}
        activeSequence={activeSequence}
        lessons={lessons}
        onClose={() => setAdminLabOpen(false)}
        onAddLesson={handleAddLesson}
        onDeleteLesson={handleDeleteLesson}
        onProjectSeeded={handleProjectSeeded}
      />

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
        settings={studioSettings}
        onClose={() => setSettingsOpen(false)}
        onSaveSettings={handleSaveStudioSettings}
      />
    </div>
  );
}
