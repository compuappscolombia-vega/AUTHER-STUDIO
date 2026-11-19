import type { WorkspaceTab } from '../types/studio.ts';

export const STUDIO_TAB_ORDER: WorkspaceTab[] = [
  'vision',
  'shots',
  'screenplay',
  'storyboard',
  'previs3d',
  'trailer',
];

export interface ShortcutItem {
  id: string;
  keys: string[];
  label: string;
  description: string;
}

export interface ShortcutGroup {
  id: string;
  title: string;
  items: ShortcutItem[];
}

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    id: 'navigation',
    title: 'Navegación entre vistas del estudio',
    items: [
      {
        id: 'tab-1',
        keys: ['1'],
        label: 'Dirección',
        description: 'Ir a la vista Dirección y Biblia de Continuidad',
      },
      {
        id: 'tab-2',
        keys: ['2'],
        label: 'Planos y Sonido',
        description: 'Ir al visor óptico, lista de planos y pistas de audio',
      },
      {
        id: 'tab-3',
        keys: ['3'],
        label: 'Guion',
        description: 'Ir al guion técnico-literario y notas al pie',
      },
      {
        id: 'tab-4',
        keys: ['4'],
        label: 'Storyboard',
        description: 'Ir al storyboard de frames y clips Omni Flash',
      },
      {
        id: 'tab-5',
        keys: ['5'],
        label: 'Pre-Vis 3D',
        description: 'Ir a la cámara interactiva de previsualización 3D',
      },
      {
        id: 'tab-6',
        keys: ['6'],
        label: 'Tráiler 30s',
        description: 'Ir a la sala de montaje y proyección del tráiler',
      },
      {
        id: 'tab-cycle',
        keys: ['[', ']'],
        label: 'Vista anterior / siguiente',
        description: 'Desplazarse en orden por las 6 vistas del estudio',
      },
    ],
  },
  {
    id: 'screenplay',
    title: 'Guion y Modo Lectura',
    items: [
      {
        id: 'reading-mode',
        keys: ['L'],
        label: 'Alternar Modo Lectura',
        description:
          'Expande el guion a pantalla completa o regresa al escritorio normal',
      },
      {
        id: 'voiceover-tts',
        keys: ['V'],
        label: 'Voz Provisional (TTS)',
        description:
          'Abre el estudio de audio provisional para las líneas de la secuencia activa',
      },
      {
        id: 'escape-close',
        keys: ['Esc'],
        label: 'Salir / Cerrar',
        description: 'Sale de Modo Lectura o cierra cualquier ventana modal abierta',
      },
    ],
  },
  {
    id: 'workspace',
    title: 'Mesa de trabajo y utilidades',
    items: [
      {
        id: 'toggle-ingest',
        keys: ['I'],
        label: 'Mesa de ingesta',
        description: 'Muestra u oculta el panel lateral de ingesta de material',
      },
      {
        id: 'new-project',
        keys: ['N'],
        label: 'Nueva producción',
        description: 'Abre el diálogo para crear un proyecto cinematográfico',
      },
      {
        id: 'open-settings',
        keys: [','],
        label: 'Configuración',
        description: 'Abre las preferencias globales del estudio',
      },
      {
        id: 'toggle-shortcuts',
        keys: ['?'],
        label: 'Atajos de teclado',
        description: 'Abre o cierra esta guía rápida de comandos',
      },
    ],
  },
];

export type ShortcutAction =
  | { type: 'switch-tab'; tab: WorkspaceTab }
  | { type: 'cycle-tab'; direction: -1 | 1 }
  | { type: 'toggle-reading-mode' }
  | { type: 'toggle-ingest' }
  | { type: 'open-voiceover-modal' }
  | { type: 'open-new-project' }
  | { type: 'open-settings' }
  | { type: 'toggle-shortcuts-modal' };

export function isEditableEventTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== 'object') return false;
  const el = target as {
    tagName?: string;
    isContentEditable?: boolean;
    closest?: (selector: string) => unknown;
  };
  const tag = (el.tagName || '').toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
    return true;
  }
  if (el.isContentEditable) return true;
  if (typeof el.closest === 'function' && el.closest('[contenteditable="true"]')) {
    return true;
  }
  return false;
}

export function getNextStudioTab(current: WorkspaceTab, direction: -1 | 1): WorkspaceTab {
  const idx = STUDIO_TAB_ORDER.indexOf(current);
  const safeIdx = idx === -1 ? 0 : idx;
  const nextIdx = (safeIdx + direction + STUDIO_TAB_ORDER.length) % STUDIO_TAB_ORDER.length;
  return STUDIO_TAB_ORDER[nextIdx];
}

export function resolveStudioShortcutAction(input: {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  isEditable?: boolean;
  hasBlockingModalOpen?: boolean;
  shortcutsModalOpen?: boolean;
}): ShortcutAction | null {
  if (input.ctrlKey || input.metaKey || input.altKey) return null;
  if (input.isEditable) return null;

  const key = input.key;
  if (key === '?') {
    return { type: 'toggle-shortcuts-modal' };
  }

  if (input.shortcutsModalOpen || input.hasBlockingModalOpen) {
    return null;
  }

  if (key >= '1' && key <= '6') {
    const tab = STUDIO_TAB_ORDER[Number(key) - 1];
    return tab ? { type: 'switch-tab', tab } : null;
  }

  if (key === '[') return { type: 'cycle-tab', direction: -1 };
  if (key === ']') return { type: 'cycle-tab', direction: 1 };

  const lower = key.toLowerCase();
  if (lower === 'l') return { type: 'toggle-reading-mode' };
  if (lower === 'i') return { type: 'toggle-ingest' };
  if (lower === 'v') return { type: 'open-voiceover-modal' };
  if (lower === 'n') return { type: 'open-new-project' };
  if (key === ',') return { type: 'open-settings' };

  return null;
}
