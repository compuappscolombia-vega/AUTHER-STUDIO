import { Search, FolderPlus, Layers, Brain, Sliders, UserCog, Keyboard, X } from 'lucide-react';
import type { ProductionProject } from '../types/studio';
import {
  computeProjectStats,
  filterProjects,
  getSourceTypeLabel,
} from '../utils/studioLogic';

interface ProjectSidebarProps {
  projects: ProductionProject[];
  activeProjectId: string;
  searchQuery: string;
  lessonsCount: number;
  isAdmin?: boolean;
  onSearchChange: (q: string) => void;
  onSelectProject: (id: string) => void;
  onOpenNewProject: () => void;
  onOpenAgentBlueprint: () => void;
  onOpenAdminLab: () => void;
  onOpenLearning: () => void;
  onOpenSettings: () => void;
  onOpenShortcuts: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

export function ProjectSidebar({
  projects,
  activeProjectId,
  searchQuery,
  lessonsCount,
  isAdmin = false,
  onSearchChange,
  onSelectProject,
  onOpenNewProject,
  onOpenAgentBlueprint,
  onOpenAdminLab,
  onOpenLearning,
  onOpenSettings,
  onOpenShortcuts,
  mobileOpen,
  onCloseMobile,
}: ProjectSidebarProps) {
  const filtered = filterProjects(projects, searchQuery);

  const sidebarContent = (
    <div className="flex flex-col h-full bg-[#FAF8F4] dark:bg-[#101015] border-r border-[#E2DDD3] dark:border-white/10">
      <div className="p-4 border-b border-[#E2DDD3] dark:border-white/10 flex items-center justify-between gap-2">
        <h2 className="font-display text-sm font-semibold text-[#18181B] dark:text-[#F2F0EB]">
          Archivo de Producciones
        </h2>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onOpenNewProject}
            aria-label="Crear nueva producción"
            className="p-2 rounded-md text-[#57534E] dark:text-[#9A968E] hover:text-[#18181B] dark:hover:text-[#F2F0EB] hover:bg-black/5 dark:hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-[#E5A93C]"
          >
            <FolderPlus className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onCloseMobile}
            aria-label="Cerrar panel de proyectos"
            className="lg:hidden p-2 rounded-md text-[#57534E] dark:text-[#9A968E] hover:text-[#18181B] dark:hover:text-[#F2F0EB] hover:bg-black/5 dark:hover:bg-white/5"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="p-3 border-b border-[#EBE7DF] dark:border-white/5">
        <label htmlFor="project-search" className="sr-only">
          Buscar producción
        </label>
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-[#78746C] dark:text-[#7A7670] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            id="project-search"
            type="search"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Buscar libro, audio o película..."
            className="w-full bg-[#FFFFFF] dark:bg-[#0B0B0E] border border-[#D6D1C7] dark:border-white/10 rounded-lg pl-8 pr-3 py-2 text-xs text-[#18181B] dark:text-[#F2F0EB] placeholder:text-[#78746C] dark:placeholder:text-[#7A7670] focus:border-[#E5A93C] focus:outline-none"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
        {projects.length === 0 ? (
          <div className="py-10 px-3 text-center space-y-3">
            <p className="text-xs text-[#57534E] dark:text-[#9A968E] leading-relaxed">
              Sin producciones aún. Inicia un proyecto nuevo desde cero.
            </p>
            <button
              type="button"
              onClick={() => {
                onOpenNewProject();
                onCloseMobile();
              }}
              className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-[#E5A93C] hover:bg-[#EDA949] text-[#0B0B0E] text-xs font-semibold transition-colors"
            >
              <FolderPlus className="w-3.5 h-3.5" />
              <span>Nuevo proyecto</span>
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-10 px-3 text-center">
            <p className="text-xs text-[#57534E] dark:text-[#9A968E]">
              Ninguna producción coincide con &ldquo;{searchQuery}&rdquo;.
            </p>
          </div>
        ) : (
          filtered.map((project) => {
            const isSelected = project.id === activeProjectId;
            const stats = computeProjectStats(project);
            return (
              <button
                key={project.id}
                type="button"
                onClick={() => {
                  onSelectProject(project.id);
                  onCloseMobile();
                }}
                aria-current={isSelected ? 'true' : undefined}
                className={`w-full text-left px-3 py-3 rounded-lg border transition-colors focus-visible:outline-2 focus-visible:outline-[#E5A93C] ${
                  isSelected
                    ? 'bg-[#FFFFFF] dark:bg-[#1A1A22] border-amber-500/60 dark:border-[#E5A93C]/50 text-[#18181B] dark:text-[#F2F0EB] shadow-xs dark:shadow-none'
                    : 'bg-transparent border-transparent hover:bg-black/[0.03] dark:hover:bg-white/[0.03] hover:border-[#E2DDD3] dark:hover:border-white/10 text-[#3F3F46] dark:text-[#C8C3BA]'
                }`}
              >
                <div className="text-sm font-semibold leading-snug line-clamp-2">
                  {project.title}
                </div>
                <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-[#57534E] dark:text-[#8D8981] font-mono-tech whitespace-nowrap overflow-hidden tabular-nums">
                  <span className="truncate">
                    {project.defaultSourceType === 'book'
                      ? 'Libro'
                      : getSourceTypeLabel(project.defaultSourceType)}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>{stats.sequenceCount} sec.</span>
                  <span aria-hidden="true">·</span>
                  <span>
                    {stats.shotCount} {stats.shotCount === 1 ? 'plano' : 'planos'}
                  </span>
                </div>
              </button>
            );
          })
        )}
      </div>

      <div className="p-3 border-t border-[#E2DDD3] dark:border-white/10 space-y-2">
        {isAdmin && (
          <button
            type="button"
            onClick={() => {
              onOpenAdminLab();
              onCloseMobile();
            }}
            className="w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg border border-amber-500/50 dark:border-[#E5A93C]/50 bg-amber-50 hover:bg-amber-100 dark:bg-[#1B1710] dark:hover:bg-[#272116] text-xs font-medium text-[#18181B] dark:text-[#F2F0EB] transition-colors whitespace-nowrap"
          >
            <span className="inline-flex items-center gap-2">
              <UserCog className="w-3.5 h-3.5 text-amber-700 dark:text-[#E5A93C]" />
              <span>Laboratorio Admin</span>
            </span>
            <span className="font-mono-tech text-[10px] text-amber-800 dark:text-[#E5A93C]">
              ACTIVO
            </span>
          </button>
        )}

        <button
          type="button"
          onClick={() => {
            onOpenLearning();
            onCloseMobile();
          }}
          className="w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg border border-[#E2DDD3] dark:border-white/10 bg-[#FFFFFF] hover:bg-[#F1EFE9] dark:bg-[#15151C] dark:hover:bg-[#1C1C26] text-xs font-medium text-[#27272A] dark:text-[#E6E2DA] transition-colors whitespace-nowrap"
        >
          <span className="inline-flex items-center gap-2">
            <Brain className="w-3.5 h-3.5 text-amber-700 dark:text-[#E5A93C]" />
            <span>Autoaprendizaje</span>
          </span>
          <span className="font-mono-tech text-[11px] text-[#57534E] dark:text-[#8D8981] tabular-nums">
            {lessonsCount}
          </span>
        </button>

        <button
          type="button"
          onClick={() => {
            onOpenAgentBlueprint();
            onCloseMobile();
          }}
          className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border border-[#E2DDD3] dark:border-white/10 bg-[#FFFFFF] hover:bg-[#F1EFE9] dark:bg-[#15151C] dark:hover:bg-[#1C1C26] text-xs font-medium text-[#27272A] dark:text-[#E6E2DA] transition-colors whitespace-nowrap"
        >
          <Layers className="w-3.5 h-3.5 text-amber-700 dark:text-[#E5A93C]" />
          <span>Plantilla Agent Studio</span>
        </button>

        <button
          type="button"
          onClick={() => {
            onOpenSettings();
            onCloseMobile();
          }}
          className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border border-[#E2DDD3] dark:border-white/10 bg-[#FFFFFF] hover:bg-[#F1EFE9] dark:bg-[#15151C] dark:hover:bg-[#1C1C26] text-xs font-medium text-[#27272A] dark:text-[#E6E2DA] transition-colors whitespace-nowrap"
        >
          <Sliders className="w-3.5 h-3.5 text-amber-700 dark:text-[#E5A93C]" />
          <span>Configuración</span>
        </button>

        <button
          type="button"
          onClick={() => {
            onOpenShortcuts();
            onCloseMobile();
          }}
          className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-[#E2DDD3] dark:border-white/10 bg-[#F5F3EE] hover:bg-[#ECE9E1] dark:bg-[#13131A] dark:hover:bg-[#1C1C26] text-xs font-medium text-[#3F3F46] dark:text-[#C8C3BA] transition-colors whitespace-nowrap"
        >
          <span className="inline-flex items-center gap-2">
            <Keyboard className="w-3.5 h-3.5 text-amber-700 dark:text-[#E5A93C]" />
            <span>Atajos de teclado</span>
          </span>
          <kbd className="font-mono-tech text-[10px] text-[#57534E] dark:text-[#8D8981]">?</kbd>
        </button>
      </div>
    </div>
  );

  return (
    <>
      <aside className="hidden lg:block w-64 shrink-0 h-full">
        {sidebarContent}
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-black/50 dark:bg-black/75"
            onClick={onCloseMobile}
            aria-hidden="true"
          />
          <aside className="relative z-10 w-80 max-w-[85vw] h-full">
            {sidebarContent}
          </aside>
        </div>
      )}
    </>
  );
}
