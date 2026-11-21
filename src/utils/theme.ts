export type StudioTheme = 'dark' | 'light';

export const THEME_STORAGE_KEY = 'auteur_studio_theme_v1';

export function normalizeStudioTheme(value: unknown): StudioTheme {
  return value === 'light' ? 'light' : 'dark';
}

export function getNextStudioTheme(current: StudioTheme): StudioTheme {
  return current === 'dark' ? 'light' : 'dark';
}

export function getThemeLabel(theme: StudioTheme): string {
  return theme === 'dark' ? 'Cinema Dark' : 'Light Studio';
}

export function readInitialTheme(): StudioTheme {
  if (typeof window === 'undefined') return 'dark';
  try {
    const stored = window.localStorage?.getItem(THEME_STORAGE_KEY);
    return normalizeStudioTheme(stored);
  } catch {
    return 'dark';
  }
}

export function persistStudioTheme(theme: StudioTheme): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage?.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Ignore storage quota or sandbox errors
  }
}

export function applyStudioTheme(
  theme: StudioTheme,
  doc: Pick<Document, 'documentElement'> | undefined = typeof document !== 'undefined'
    ? document
    : undefined
): void {
  if (!doc?.documentElement) return;
  const root = doc.documentElement;
  root.classList.toggle('dark', theme === 'dark');
  if (root.dataset) {
    root.dataset.theme = theme;
  }
  if (root.style) {
    root.style.colorScheme = theme;
  }
}
