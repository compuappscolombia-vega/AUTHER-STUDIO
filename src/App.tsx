import { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Clapperboard,
  FileDown,
  Library,
  Lock,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';
import type {
  AudioAnalysisReport,
  LearningCategory,
  LearningLesson,
  ProductionProject,
  ProductionSequence,
  SourceMaterialType,
  WorkspaceTab,
} from './types/studio';
import { TopBar } from './components/TopBar';
import { ProjectSidebar } from './components/ProjectSidebar';
import { SourceIngestPanel } from './components/SourceIngestPanel';
import { VisionView } from './components/VisionView';
import { ShotsAndSoundView } from './components/ShotsAndSoundView';
import { ScreenplayView } from './components/ScreenplayView';
import { StoryboardView } from './components/StoryboardView';
import { NewProjectModal } from './components/NewProjectModal';
import { AgentBlueprintModal } from './components/AgentBlueprintModal';
import { AuthModal } from './components/AuthModal';
import { LearningModal } from './components/LearningModal';
import { SEED_PROJECTS } from './data/seedProjects';
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
  addLessonToFirestore,
  deleteLessonFromFirestore,
  finalizeSequenceInFirestore,
  loadUserProjectsFromFirestore,
  saveProjectToFirestore,
  saveSequenceToFirestore,
  subscribeLessonsFromFirestore,
  updateProjectContinuityInFirestore,
} from './services/firestoreSync';

const LOCAL_CACHE_KEY = 'auteur_studio_projects_v2';

export default function App() {
  const { user, isVerified } = useAuth();

  const [projects, setProjects] = useState<ProductionProject[]>(SEED_PROJECTS);
  const [activeProjectId, setActiveProjectId] = useState<string>(SEED_PROJECTS[0].id);
  const [activeSequenceId, setActiveSequenceId] = useState<string>(
    SEED_PROJECTS[0].sequences[0]?.id || ''
  );
  const [lessons, setLessons] = useState<LearningLesson[]>([]);
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('vision');
  const [searchQuery, setSearchQuery] = useState('');
  const [showIngest, setShowIngest] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [blueprintOpen, setBlueprintOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [learningOpen, setLearningOpen] = useState(false);
  const [isProducing, setIsProducing] = useState(false);
  const [finalizingSeq, setFinalizingSeq] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [produceError, setProduceError] = useState<string | null>(null);

  // Load workspace projects + self-learning memory from server on mount
  useEffect(() => {
    let cancelled = false;
    async function loadFromServer() {
      try {
        const [projRes, learnRes] = await Promise.all([
          fetch('/api/projects'),
          fetch('/api/learning'),
        ]);

        if (projRes.ok) {
          const data = (await projRes.json()) as { projects: ProductionProject[] };
          if (!cancelled && Array.isArray(data.projects) && data.projects.length > 0) {
            setProjects(data.projects);
            setActiveProjectId((prev) => {
              const exists = data.projects.some((p) => p.id === prev);
              return exists ? prev : data.projects[0].id;
            });
            localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify(data.projects));
          }
        }

        if (learnRes.ok) {
          const learnData = (await learnRes.json()) as { lessons: LearningLesson[] };
          if (!cancelled && Array.isArray(learnData.lessons)) {
            setLessons(learnData.lessons);
          }
        }
      } catch {
        const cached = localStorage.getItem(LOCAL_CACHE_KEY);
        if (!cancelled && cached) {
          try {
            const parsed = JSON.parse(cached) as ProductionProject[];
            if (Array.isArray(parsed) && parsed.length > 0) {
              setProjects(parsed);
            }
          } catch {
            // Keep SEED_PROJECTS
          }
        }
      }
    }
    loadFromServer();
    return () => {
      cancelled = true;
    };
  }, []);

  // Sync Firestore cloud projects and learning memory when authenticated & email verified
  useEffect(() => {
    if (!user || !isVerified) return;
    let cancelled = false;

    async function syncCloud() {
      try {
        const cloudProjects = await loadUserProjectsFromFirestore(user!.uid);
        if (cancelled) return;
        if (cloudProjects.length > 0) {
          setProjects((prev) => {
            const cloudIds = new Set(cloudProjects.map((p) => p.id));
            const localOnly = prev.filter((p) => !cloudIds.has(p.id));
            const merged = [...cloudProjects, ...localOnly];
            localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify(merged));
            return merged;
          });
        } else {
          // Seed initial projects to user's Firestore workspace once authenticated
          for (const seedProj of projects.slice(0, 3)) {
            await saveProjectToFirestore(user!.uid, seedProj);
          }
        }
      } catch (err) {
        console.error('Error cargando proyectos desde Firestore:', err);
      }
    }

    void syncCloud();

    const unsubLessons = subscribeLessonsFromFirestore(user.uid, (cloudLessons) => {
      if (!cancelled && cloudLessons.length > 0) {
        setLessons(cloudLessons);
      }
    });

    return () => {
      cancelled = true;
      unsubLessons();
    };
  }, [user?.uid, isVerified]);

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

  async function handleCreateProject(payload: {
    title: string;
    genreStyle: string;
    defaultSourceType: SourceMaterialType;
    continuityBible: string;
  }) {
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Error al crear la producción.');
    }
    const created = data.project as ProductionProject;
    const next = [created, ...projects];
    setProjects(next);
    localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify(next));
    setActiveProjectId(created.id);
    setActiveSequenceId('');
    setShowIngest(true);

    if (user && isVerified) {
      await saveProjectToFirestore(user.uid, created);
    }
  }

  async function handleSaveContinuity(continuityBible: string) {
    if (!activeProject) return;
    const res = await fetch(`/api/projects/${activeProject.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
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
    localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify(next));

    if (user && isVerified) {
      await updateProjectContinuityInFirestore(user.uid, updatedProj.id, continuityBible);
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
        localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify(next));
        return next;
      });
    }
    return data.report as AudioAnalysisReport;
  }

  async function handleProduce(formData: FormData) {
    setIsProducing(true);
    setProduceError(null);
    try {
      const res = await fetch('/api/produce', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Error en la producción cinematográfica.');
      }
      const updatedProj = data.project as ProductionProject;
      const newSeq = data.sequence as ProductionSequence;
      const next = projects.map((p) => (p.id === updatedProj.id ? updatedProj : p));
      setProjects(next);
      localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify(next));
      setActiveSequenceId(newSeq.id);
      setActiveTab('vision');

      if (user && isVerified) {
        await saveProjectToFirestore(user.uid, updatedProj);
        await saveSequenceToFirestore(user.uid, updatedProj.id, newSeq);
      }
    } catch (err) {
      setProduceError(
        err instanceof Error ? err.message : 'No se pudo completar la producción.'
      );
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
        { method: 'PATCH' }
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'No se pudo aprobar la Versión Final.');
      }
      const updatedProj = data.project as ProductionProject;
      const next = projects.map((p) => (p.id === updatedProj.id ? updatedProj : p));
      setProjects(next);
      localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify(next));
      if (Array.isArray(data.lessons)) {
        setLessons(data.lessons);
      }

      if (user && isVerified) {
        await finalizeSequenceInFirestore(user.uid, activeProject.id, activeSequence.id);
        const autoLessons = extractAutomaticLessons(activeProject.title, {
          ...activeSequence,
          versionStatus: 'final',
        });
        for (let i = 0; i < autoLessons.length; i++) {
          await addLessonToFirestore(user.uid, {
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
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'No se pudo guardar la lección.');
    }
    if (Array.isArray(data.lessons)) {
      setLessons(data.lessons);
    }
    if (user && isVerified && data.lesson) {
      await addLessonToFirestore(user.uid, data.lesson as LearningLesson);
    }
  }

  async function handleDeleteLesson(lessonId: string) {
    const res = await fetch(`/api/learning/${lessonId}`, { method: 'DELETE' });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.lessons)) {
        setLessons(data.lessons);
      }
    }
    if (user && isVerified) {
      await deleteLessonFromFirestore(user.uid, lessonId);
    }
  }

  async function handleRateSequence(rating: number, note: string) {
    if (!activeProject || !activeSequence) return;
    setProduceError(null);
    const res = await fetch(
      `/api/projects/${activeProject.id}/sequences/${activeSequence.id}/rate`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
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
      localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify(next));
    }
    if (Array.isArray(data.lessons)) {
      setLessons(data.lessons);
    }
    if (user && isVerified && rating >= 4) {
      const extracted = buildRatedChoiceLessons({
        projectTitle: activeProject.title,
        sequence: activeSequence,
        rating,
        note,
      });
      for (let i = 0; i < extracted.length; i++) {
        await addLessonToFirestore(user.uid, {
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
    localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify(next));

    if (user && isVerified && activeSequence) {
      const updatedSeq = updatedProj.sequences.find((s) => s.id === activeSequence.id);
      if (updatedSeq && updatedSeq.versionStatus === 'draft') {
        await saveSequenceToFirestore(user.uid, updatedProj.id, updatedSeq);
      }
    }
  }

  const userLabel = user
    ? user.displayName || user.email?.split('@')[0] || 'Director'
    : null;

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-[#0B0B0E] text-[#F2F0EB]">
      <TopBar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onOpenNewProject={() => setNewProjectOpen(true)}
        onOpenAuth={() => setAuthOpen(true)}
        userLabel={userLabel}
        onToggleMobileMenu={() => setMobileMenuOpen(true)}
      />

      {/* Mobile Tab Bar */}
      <nav
        aria-label="Vistas móviles del estudio"
        className="flex md:hidden items-center gap-1 px-3 py-1.5 border-b border-white/10 bg-[#101015] overflow-x-auto shrink-0"
      >
        {(
          [
            { id: 'vision', label: 'Dirección' },
            { id: 'shots', label: 'Planos y Sonido' },
            { id: 'screenplay', label: 'Guion' },
            { id: 'storyboard', label: 'Storyboard' },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap shrink-0 ${
              activeTab === tab.id
                ? 'bg-[#E5A93C] text-[#0B0B0E]'
                : 'text-[#9A968E] hover:text-[#F2F0EB]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {/* Unverified email notice (only shown if signed in without email verification) */}
      {user && !isVerified && (
        <div className="px-5 py-2 border-b border-[#E5A93C]/25 bg-[#1B170E] flex flex-wrap items-center justify-between gap-2 text-xs text-[#F4D08A] shrink-0">
          <span>
            Cuenta creada ({user.email}). Verifica tu correo para activar el guardado en la nube.
          </span>
          <button
            type="button"
            onClick={() => setAuthOpen(true)}
            className="font-semibold underline hover:text-white"
          >
            Verificar ahora
          </button>
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        <ProjectSidebar
          projects={projects}
          activeProjectId={activeProject?.id || ''}
          searchQuery={searchQuery}
          lessonsCount={lessons.length}
          onSearchChange={setSearchQuery}
          onSelectProject={handleSelectProject}
          onOpenNewProject={() => setNewProjectOpen(true)}
          onOpenAgentBlueprint={() => setBlueprintOpen(true)}
          onOpenLearning={() => setLearningOpen(true)}
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

          {/* Split Workspace: Ingest Drawer + Active View */}
          <div className="flex-1 flex flex-col xl:flex-row overflow-y-auto xl:overflow-hidden">
            {activeProject && showIngest && (
              <SourceIngestPanel
                project={activeProject}
                isProducing={isProducing}
                errorMessage={produceError}
                onDismissError={() => setProduceError(null)}
                onSaveContinuity={handleSaveContinuity}
                onProduce={handleProduce}
                onAnalyzeAudioOnly={handleAnalyzeAudioOnly}
              />
            )}

            <div className="flex-1 xl:overflow-y-auto p-6 lg:p-8 min-w-0">
              {isProducing ? (
                <div className="py-20 max-w-md mx-auto text-center space-y-3">
                  <Clapperboard className="w-8 h-8 text-[#E5A93C] mx-auto" />
                  <h2 className="font-display text-lg font-semibold text-[#F2F0EB]">
                    Diseñando producción cinematográfica
                  </h2>
                  <p className="text-xs text-[#9A968E] leading-relaxed">
                    Estructurando óptica de cámara, temperaturas de luz, lista de planos, mezcla
                    Dolby Atmos, análisis de audio, VFX y guion completo.
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
                  {activeTab === 'shots' && <ShotsAndSoundView sequence={activeSequence} />}
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
                      projectId={activeProject.id}
                      sequence={activeSequence}
                      onProjectMediaUpdated={handleProjectMediaUpdated}
                    />
                  )}
                </>
              ) : (
                <div className="py-20 max-w-md mx-auto text-center space-y-4">
                  <Clapperboard className="w-9 h-9 text-[#E5A93C] mx-auto" />
                  <h2 className="font-display text-xl font-semibold text-[#F2F0EB]">
                    Producción lista para rodar
                  </h2>
                  <p className="text-sm text-[#9A968E] leading-relaxed">
                    Carga un capítulo de libro, un audiolibro en MP3/WAV/M4A/OGG o escribe tu
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

      <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} />

      <LearningModal
        open={learningOpen}
        lessons={lessons}
        activeProjectTitle={activeProject?.title || 'AUTEUR Studio'}
        onClose={() => setLearningOpen(false)}
        onAddLesson={handleAddLesson}
        onDeleteLesson={handleDeleteLesson}
      />
    </div>
  );
}
