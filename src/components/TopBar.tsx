import type { WorkspaceTab } from '../types/studio';

interface TopBarProps {
  activeTab: WorkspaceTab;
  onTabChange: (tab: WorkspaceTab) => void;
  onOpenNewProject: () => void;
  onToggleMobileMenu: () => void;
}

const NAV_TABS: { id: WorkspaceTab; label: string }[] = [
  { id: 'vision', label: 'Dirección' },
  { id: 'shots', label: 'Planos y Sonido' },
  { id: 'screenplay', label: 'Guion' },
  { id: 'storyboard', label: 'Storyboard' },
];

export function TopBar({
  activeTab,
  onTabChange,
  onOpenNewProject,
  onToggleMobileMenu,
}: TopBarProps) {
  return (
    <header className="h-16 border-b border-white/10 bg-[#0B0B0E] px-3 sm:px-4 lg:px-6 flex items-center justify-between gap-2 md:gap-8 shrink-0">
      {/* Zone 1: Brand Wordmark */}
      <div className="flex items-center gap-2 sm:gap-3 min-w-0 shrink-0">
        <button
          type="button"
          onClick={onToggleMobileMenu}
          aria-label="Abrir lista de proyectos"
          className="lg:hidden px-2.5 py-1.5 rounded-lg border border-white/10 text-xs font-medium text-[#E6E2DA] hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-[#E5A93C] whitespace-nowrap shrink-0"
        >
          Proyectos
        </button>
        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            onTabChange('vision');
          }}
          className="font-display text-base sm:text-lg font-bold tracking-tight text-[#F2F0EB] whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-[#E5A93C]"
        >
          AUTEUR Studio
        </a>
      </div>

      {/* Zone 2: Primary Workspace Navigation */}
      <nav aria-label="Vistas del estudio" className="hidden md:flex items-center gap-6">
        {NAV_TABS.map((tab) => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onTabChange(tab.id)}
              aria-current={active ? 'page' : undefined}
              className={`py-5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-[#E5A93C] ${
                active
                  ? 'border-[#E5A93C] text-[#F2F0EB]'
                  : 'border-transparent text-[#9A968E] hover:text-[#F2F0EB]'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </nav>

      {/* Zone 3: Single Primary Action */}
      <div className="shrink-0">
        <button
          type="button"
          onClick={onOpenNewProject}
          className="px-3 sm:px-4 py-2 rounded-lg bg-[#E5A93C] hover:bg-[#EDA949] text-[#0B0B0E] text-xs font-semibold transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#E5A93C]"
        >
          Nueva producción
        </button>
      </div>
    </header>
  );
}
