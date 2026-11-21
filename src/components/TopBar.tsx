import { UserCheck, LogIn, UserCog } from 'lucide-react';
import type { WorkspaceTab } from '../types/studio';
import type { StudioTheme } from '../utils/theme';
import { ThemeToggle } from './ThemeToggle';

interface TopBarProps {
  activeTab: WorkspaceTab;
  onTabChange: (tab: WorkspaceTab) => void;
  onOpenNewProject: () => void;
  onOpenAuth: () => void;
  onOpenAdminLab?: () => void;
  isAdmin?: boolean;
  userLabel: string | null;
  onToggleMobileMenu: () => void;
  theme: StudioTheme;
  onToggleTheme: (next: StudioTheme) => void;
}

const NAV_TABS: { id: WorkspaceTab; label: string }[] = [
  { id: 'vision', label: 'Dirección' },
  { id: 'shots', label: 'Planos y Sonido' },
  { id: 'screenplay', label: 'Guion' },
  { id: 'storyboard', label: 'Storyboard' },
  { id: 'previs3d', label: 'Pre-Vis 3D' },
  { id: 'trailer', label: 'Tráiler 30s' },
];

export function TopBar({
  activeTab,
  onTabChange,
  onOpenNewProject,
  onOpenAuth,
  onOpenAdminLab,
  isAdmin = false,
  userLabel,
  onToggleMobileMenu,
  theme,
  onToggleTheme,
}: TopBarProps) {
  return (
    <header className="h-16 border-b border-[#E2DDD3] dark:border-white/10 bg-[#FFFFFF] dark:bg-[#0B0B0E] px-3 sm:px-4 lg:px-6 flex items-center justify-between gap-2 md:gap-4 shrink-0 transition-colors">
      {/* Zone 1: Brand Wordmark */}
      <div className="flex items-center gap-2 sm:gap-3 min-w-0 shrink-0">
        <button
          type="button"
          onClick={onToggleMobileMenu}
          aria-label="Abrir lista de proyectos"
          className="lg:hidden px-2 sm:px-2.5 py-1.5 rounded-lg border border-[#DCD6CA] dark:border-white/10 text-xs font-medium text-[#27272A] dark:text-[#E6E2DA] hover:bg-black/5 dark:hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-[#E5A93C] whitespace-nowrap shrink-0"
        >
          Proyectos
        </button>
        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            onTabChange('vision');
          }}
          className="font-display text-sm sm:text-lg font-bold tracking-tight text-[#18181B] dark:text-[#F2F0EB] whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-[#E5A93C]"
        >
          AUTEUR Studio
        </a>
      </div>

      {/* Zone 2: Primary Workspace Navigation */}
      <nav aria-label="Vistas del estudio" className="hidden md:flex items-center gap-4 lg:gap-5">
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
                  ? 'border-[#E5A93C] text-[#18181B] dark:text-[#F2F0EB]'
                  : 'border-transparent text-[#57534E] dark:text-[#9A968E] hover:text-[#18181B] dark:hover:text-[#F2F0EB]'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </nav>

      {/* Zone 3: Theme Toggle, Auth & Primary Action */}
      <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
        {isAdmin && onOpenAdminLab && (
          <button
            type="button"
            onClick={onOpenAdminLab}
            aria-label="Abrir Laboratorio Administrador del Agente"
            className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1.5 sm:py-2 rounded-lg border border-amber-500/50 dark:border-[#E5A93C]/45 bg-amber-50 hover:bg-amber-100 dark:bg-[#1B1710] dark:hover:bg-[#272116] text-xs font-semibold text-amber-800 dark:text-[#E5A93C] transition-colors whitespace-nowrap shrink-0"
          >
            <UserCog className="w-3.5 h-3.5 shrink-0" />
            <span>Lab Agente</span>
          </button>
        )}

        <ThemeToggle theme={theme} onToggle={onToggleTheme} />

        <button
          type="button"
          onClick={onOpenAuth}
          aria-label={userLabel ? `Cuenta activa: ${userLabel}` : 'Acceder o registrarse'}
          className="inline-flex items-center gap-1.5 px-2 sm:px-3 py-1.5 sm:py-2 rounded-lg border border-[#DCD6CA] dark:border-white/12 bg-[#FAF8F4] hover:bg-[#F1EFE9] dark:bg-[#14141B] dark:hover:bg-[#1C1C26] text-xs font-medium text-[#27272A] dark:text-[#E6E2DA] transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-[#E5A93C]"
        >
          {userLabel ? (
            <>
              <UserCheck className="w-3.5 h-3.5 text-teal-700 dark:text-[#38B2AC] shrink-0" />
              <span className="hidden sm:inline max-w-[115px] truncate">{userLabel}</span>
            </>
          ) : (
            <>
              <LogIn className="w-3.5 h-3.5 text-amber-700 dark:text-[#E5A93C] shrink-0" />
              <span>Acceder</span>
            </>
          )}
        </button>

        <button
          type="button"
          onClick={onOpenNewProject}
          className="px-2.5 sm:px-4 py-1.5 sm:py-2 rounded-lg bg-[#E5A93C] hover:bg-[#EDA949] text-[#0B0B0E] text-xs font-semibold transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#E5A93C]"
        >
          <span className="sm:hidden">Nueva</span>
          <span className="hidden sm:inline">Nueva producción</span>
        </button>
      </div>
    </header>
  );
}
