import type {
  ScreenplayNote,
  ScreenplayNoteRole,
  ScreenplayScene,
} from '../types/studio';

export type ReadingFontScale = 'normal' | 'comfortable' | 'large';

export function buildBeatKey(sceneIndex: number, beatIndex: number): string {
  return `${sceneIndex}:${beatIndex}`;
}

export function getBeatNotes(
  notes: ScreenplayNote[] | undefined,
  beatKey: string
): ScreenplayNote[] {
  if (!Array.isArray(notes) || !beatKey) return [];
  return notes.filter((n) => n.beatKey === beatKey);
}

export function sortScreenplayNotes(notes: ScreenplayNote[] | undefined): ScreenplayNote[] {
  if (!Array.isArray(notes)) return [];
  return [...notes].sort((a, b) => {
    const [aScene, aBeat] = a.beatKey.split(':').map((v) => Number(v) || 0);
    const [bScene, bBeat] = b.beatKey.split(':').map((v) => Number(v) || 0);
    if (aScene !== bScene) return aScene - bScene;
    if (aBeat !== bBeat) return aBeat - bBeat;
    return a.createdAt.localeCompare(b.createdAt);
  });
}

export function validateScreenplayNote(input: {
  note: string;
  role: ScreenplayNoteRole;
}): { valid: boolean; error?: string } {
  const trimmed = (input.note || '').trim();
  if (trimmed.length < 3) {
    return {
      valid: false,
      error: 'Escribe una nota de al menos 3 caracteres.',
    };
  }
  if (trimmed.length > 1200) {
    return {
      valid: false,
      error: 'La nota no puede superar los 1200 caracteres.',
    };
  }
  if (input.role !== 'director' && input.role !== 'producer') {
    return {
      valid: false,
      error: 'El rol de la nota debe ser Director o Productor.',
    };
  }
  return { valid: true };
}

export function computeScreenplayReadingStats(
  screenplay: ScreenplayScene[] | undefined,
  wordsPerMinute = 155
): {
  sceneCount: number;
  beatCount: number;
  dialogueCount: number;
  wordCount: number;
  estimatedMinutes: number;
} {
  const scenes = Array.isArray(screenplay) ? screenplay : [];
  let beatCount = 0;
  let dialogueCount = 0;
  let wordCount = 0;

  for (const scene of scenes) {
    const slugWords = String(scene.slugline || '')
      .trim()
      .split(/\s+/)
      .filter(Boolean).length;
    wordCount += slugWords;

    const beats = Array.isArray(scene.beats) ? scene.beats : [];
    for (const beat of beats) {
      beatCount += 1;
      if (beat.type === 'dialogue') {
        dialogueCount += 1;
      }
      const lineWords = String(beat.text || '')
        .trim()
        .split(/\s+/)
        .filter(Boolean).length;
      wordCount += lineWords;
    }
  }

  const safeWpm = Math.max(80, wordsPerMinute);
  const estimatedMinutes = wordCount > 0 ? Math.max(1, Math.ceil(wordCount / safeWpm)) : 0;

  return {
    sceneCount: scenes.length,
    beatCount,
    dialogueCount,
    wordCount,
    estimatedMinutes,
  };
}

export function getReadingTypographyClasses(scale: ReadingFontScale): {
  sheetText: string;
  measureClass: string;
  dialogueMeasureClass: string;
  sceneHeading: string;
  spacingClass: string;
} {
  if (scale === 'large') {
    return {
      sheetText: 'text-[18px] sm:text-[19px] leading-[1.85]',
      measureClass: 'max-w-[74ch]',
      dialogueMeasureClass: 'max-w-[50ch]',
      sceneHeading: 'text-base sm:text-lg',
      spacingClass: 'space-y-6',
    };
  }
  if (scale === 'comfortable') {
    return {
      sheetText: 'text-[16px] sm:text-[17px] leading-[1.78]',
      measureClass: 'max-w-[70ch]',
      dialogueMeasureClass: 'max-w-[46ch]',
      sceneHeading: 'text-sm sm:text-base',
      spacingClass: 'space-y-5',
    };
  }
  return {
    sheetText: 'text-[13px] sm:text-[14px] leading-relaxed',
    measureClass: 'max-w-[66ch]',
    dialogueMeasureClass: 'max-w-[44ch]',
    sceneHeading: 'text-xs sm:text-sm',
    spacingClass: 'space-y-4',
  };
}
