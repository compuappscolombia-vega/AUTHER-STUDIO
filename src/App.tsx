import { useEffect, useState } from 'react';
import { Clapperboard, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import type {
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
import { SEED_PROJECTS } from './data/seedProjects';

const LOCAL_CACHE_KEY = 'auteur_studio_projects_v1';

export default function App() {
  const [projects, setProjects] = useState<ProductionProject[]>(SEED_PROJECTS);
  const [activeProjectId, setActiveProjectId] = useState<string>(SEED_PROJECTS[0].id);
  const [activeSequenceId, setActiveSequenceId] = useState<string>(
    SEED_PROJECTS[0].sequences[0]?.id || ''
  );
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('vision');
  const [searchQuery, setSearchQuery] = useState('');
  const [showIngest, setShowIngest] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [blueprintOpen, setBlueprintOpen] = useState(false);
  const [isProducing, setIsProducing] = useState(false);
  const [produceError, setProduceError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadFromServer() {
      try {
        const res = await fetch('/api/projects');
        if (!res.ok) throw new Error('Failed to load workspace');
        const data = (await res.json()) as { projects: ProductionProject[] };
        if (!cancelled && Array.isArray(data.projects) && data.projects.length > 0) {
          setProjects(data.projects);
          setActiveProjectId((prev) => {
            const exists = data.projects.some((p) => p.id === prev);
            return exists ? prev : data.projects[0].id;
          });
          localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify(data.projects));
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

  const activeProject =
    projects.find((p) => p.id === activeProjectId) || projects[0] || null;

  const activeSequence: ProductionSequence | null = activeProject
    ? activeProject.sequences.find((s) => s.id === activeSequenceId) ||
      activeProject.sequences[0] ||
      null
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
    } catch (err) {
      setProduceError(
        err instanceof Error ? err.message : 'No se pudo completar la producción.'
      );
    } finally {
      setIsProducing(false);
    }
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-[#0B0B0E] text-[#F2F0EB]">
      <TopBar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onOpenNewProject={() => setNewProjectOpen(true)}
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

      <div className="flex-1 flex overflow-hidden">
        <ProjectSidebar
          projects={projects}
          activeProjectId={activeProject?.id || ''}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onSelectProject={handleSelectProject}
          onOpenNewProject={() => setNewProjectOpen(true)}
          onOpenAgentBlueprint={() => setBlueprintOpen(true)}
          mobileOpen={mobileMenuOpen}
          onCloseMobile={() => setMobileMenuOpen(false)}
        />

        <main className="flex-1 flex flex-col overflow-hidden min-w-0">
          {/* Active Project & Sequence Bar */}
          {activeProject && (
            <div className="border-b border-white/10 bg-[#101015] px-5 py-3 flex flex-wrap items-center justify-between gap-3 shrink-0">
              <div className="min-w-0">
                <h1 className="font-display text-base sm:text-lg font-semibold text-[#F2F0EB] truncate">
                  {activeProject.title}
                </h1>
                <div className="text-xs text-[#8D8981] truncate">
                  {activeProject.genreStyle}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                {activeProject.sequences.length > 0 && (
                  <div className="flex items-center gap-2">
                    <label htmlFor="active-sequence-select" className="sr-only">
                      Secuencia activa
                    </label>
                    <select
                      id="active-sequence-select"
                      value={activeSequence?.id || ''}
                      onChange={(e) => setActiveSequenceId(e.target.value)}
                      className="max-w-[240px] rounded-lg border border-white/12 bg-[#0B0B0E] px-3 py-1.5 text-xs text-[#F2F0EB] focus:border-[#E5A93C] focus:outline-none"
                    >
                      {activeProject.sequences.map((seq) => (
                        <option key={seq.id} value={seq.id}>
                          {seq.title}
                        </option>
                      ))}
                    </select>
                  </div>
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
                    Dolby Atmos, VFX y guion completo.
                  </p>
                </div>
              ) : activeSequence ? (
                <>
                  {activeTab === 'vision' && <VisionView sequence={activeSequence} />}
                  {activeTab === 'shots' && <ShotsAndSoundView sequence={activeSequence} />}
                  {activeTab === 'screenplay' && activeProject && (
                    <ScreenplayView
                      projectTitle={activeProject.title}
                      sequence={activeSequence}
                    />
                  )}
                  {activeTab === 'storyboard' && <StoryboardView sequence={activeSequence} />}
                </>
              ) : (
                <div className="py-20 max-w-md mx-auto text-center space-y-4">
                  <Clapperboard className="w-9 h-9 text-[#E5A93C] mx-auto" />
                  <h2 className="font-display text-xl font-semibold text-[#F2F0EB]">
                    Producción lista para rodar
                  </h2>
                  <p className="text-sm text-[#9A968E] leading-relaxed">
                    Carga un capítulo de libro, un audiolibro en MP3/WAV o escribe tu historia en la
                    mesa de ingesta para dirigir la primera secuencia.
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
    </div>
  );
}
