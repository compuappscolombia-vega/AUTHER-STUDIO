import { Moon, Sun } from 'lucide-react';
import { getNextStudioTheme, getThemeLabel, type StudioTheme } from '../utils/theme';

interface ThemeToggleProps {
  theme: StudioTheme;
  onToggle: (next: StudioTheme) => void;
}

export function ThemeToggle({ theme, onToggle }: ThemeToggleProps) {
  const nextTheme = getNextStudioTheme(theme);
  const currentLabel = getThemeLabel(theme);
  const nextLabel = getThemeLabel(nextTheme);
  const isDark = theme === 'dark';

  return (
    <button
      type="button"
      onClick={() => onToggle(nextTheme)}
      aria-pressed={!isDark}
      aria-label={`Tema actual: ${currentLabel}. Cambiar a ${nextLabel}`}
      title={`Cambiar a ${nextLabel}`}
      data-testid="theme-toggle"
      className="inline-flex items-center gap-1.5 px-2 sm:px-2.5 py-1.5 sm:py-2 rounded-lg border border-[#DCD6CA] dark:border-white/12 bg-[#FFFFFF] dark:bg-[#14141B] hover:bg-[#F1EFE9] dark:hover:bg-[#1C1C26] text-xs font-medium text-[#27272A] dark:text-[#E6E2DA] transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-[#E5A93C]"
    >
      {isDark ? (
        <Moon className="w-3.5 h-3.5 text-[#E5A93C] shrink-0" />
      ) : (
        <Sun className="w-3.5 h-3.5 text-amber-700 shrink-0" />
      )}
      <span className="hidden xl:inline">{currentLabel}</span>
    </button>
  );
}
