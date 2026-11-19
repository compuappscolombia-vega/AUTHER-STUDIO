import type {
  BookChapterItem,
  ChapterPlan,
  ProductionProject,
  ProductionSequence,
  ResolutionTier,
  StudioSettings,
  TimelineMilestone,
  TrailerBeat,
  VoicePreset,
} from '../types/studio.ts';

export const RESOLUTION_OPTIONS: {
  value: ResolutionTier;
  label: string;
  dimensions: string;
  nanoImageSize: '1K' | '2K' | '4K';
  promptDescriptor: string;
}[] = [
  {
    value: '720p',
    label: '720p HD',
    dimensions: '1280×720',
    nanoImageSize: '1K',
    promptDescriptor:
      '720p HD cinema master, crisp anamorphic lens focus, natural film grain',
  },
  {
    value: '1080p',
    label: '1080p Full HD',
    dimensions: '1920×1080',
    nanoImageSize: '1K',
    promptDescriptor:
      '1080p Full HD cinema still, high dynamic range lighting, rich set textures',
  },
  {
    value: '2K',
    label: '2K DCI Cinema',
    dimensions: '2048×1080',
    nanoImageSize: '2K',
    promptDescriptor:
      '2K DCI theater master, hyper-realistic skin pores and fabric weave, volumetric light shafts',
  },
  {
    value: '4K',
    label: '4K Ultra HD IMAX',
    dimensions: '3840×2160',
    nanoImageSize: '4K',
    promptDescriptor:
      '4K Ultra HD 65mm IMAX hyper-realistic frame, razor-sharp optical micro-detail, physically accurate ray-traced reflections and atmospheric haze',
  },
];

export const VOICE_PRESET_OPTIONS: {
  value: VoicePreset;
  label: string;
  character: string;
}[] = [
  { value: 'Charon', label: 'Charon · Barítono Cinematográfico', character: 'Grave, autoritario, épico' },
  { value: 'Kore', label: 'Kore · Narradora Documental', character: 'Cálida, articulada, envolvente' },
  { value: 'Fenrir', label: 'Fenrir · Tráiler Intenso', character: 'Profunda, tensa, dramática' },
  { value: 'Puck', label: 'Puck · Narrativa Ágil', character: 'Expresiva, cercana, dinámica' },
  { value: 'Zephyr', label: 'Zephyr · Intimista Literaria', character: 'Serena, poética, susurrada' },
];

export const TRAILER_TONE_OPTIONS = [
  'Teaser Épico Monumental',
  'Thriller Psicológico de Tensión',
  'Drama Autoral Emocional',
  'Ciencia Ficción Visionaria',
] as const;

export const DEFAULT_STUDIO_SETTINGS: StudioSettings = {
  defaultResolution: '4K',
  defaultDirectorStyle: 'Épica Monumental IMAX',
  defaultAspectRatio: '2.39:1',
  defaultVoicePreset: 'Charon',
  defaultThinkingDepth: 'standard',
};

export function normalizeResolution(raw?: string): ResolutionTier {
  if (raw === '720p' || raw === '1080p' || raw === '2K' || raw === '4K') {
    return raw;
  }
  return '4K';
}

export function getNanoImageSizeForResolution(resolution: ResolutionTier): '1K' | '2K' | '4K' {
  const found = RESOLUTION_OPTIONS.find((r) => r.value === resolution);
  return found ? found.nanoImageSize : '4K';
}

export function buildHyperRealisticResolutionSpec(resolution: ResolutionTier): string {
  const found =
    RESOLUTION_OPTIONS.find((r) => r.value === resolution) || RESOLUTION_OPTIONS[3];
  return `${found.promptDescriptor} (${found.dimensions}, photorealistic Hollywood cinema production, no text overlays or watermarks)`;
}

export function appendDictatedText(existing: string, dictated: string): string {
  const cleanDictated = dictated.trim();
  if (!cleanDictated) return existing;
  const cleanExisting = existing.trim();
  if (!cleanExisting) return cleanDictated;
  return `${cleanExisting}\n${cleanDictated}`;
}

export function getApprovedTimelineMilestones(
  project: ProductionProject | null | undefined
): TimelineMilestone[] {
  if (!project || !Array.isArray(project.sequences)) return [];

  const finals = project.sequences
    .filter((seq) => seq.versionStatus === 'final')
    .sort((a, b) => {
      const aChap = typeof a.chapterIndex === 'number' ? a.chapterIndex : Number.MAX_SAFE_INTEGER;
      const bChap = typeof b.chapterIndex === 'number' ? b.chapterIndex : Number.MAX_SAFE_INTEGER;
      if (aChap !== bChap) return aChap - bChap;
      return a.createdAt.localeCompare(b.createdAt);
    });

  return finals.map((seq, idx) => {
    const durationSec = (seq.shotList || []).reduce(
      (sum, shot) => sum + (Number.isFinite(shot.durationSec) ? shot.durationSec : 0),
      0
    );
    return {
      sequenceId: seq.id,
      milestoneNumber: idx + 1,
      title: seq.title,
      chapterIndex: seq.chapterIndex,
      shotCount: seq.shotList?.length || 0,
      durationSec: Math.round(durationSec),
      cameraSystem: seq.cameraSystem,
      aspectRatio: seq.aspectRatio,
      targetResolution: normalizeResolution(seq.targetResolution),
      continuityHighlight: (seq.continuitySummary || seq.logline || '').trim(),
      approvedAt: seq.updatedAt || seq.createdAt,
    };
  });
}

export function getSequentialChapterState(plan: ChapterPlan | undefined): {
  nextChapter: BookChapterItem | null;
  completedCount: number;
  totalCount: number;
  isComplete: boolean;
  canProduceIndex: (chapterIndex: number) => boolean;
} {
  if (!plan || !Array.isArray(plan.chapters) || plan.chapters.length === 0) {
    return {
      nextChapter: null,
      completedCount: 0,
      totalCount: 0,
      isComplete: false,
      canProduceIndex: () => false,
    };
  }

  const sorted = [...plan.chapters].sort((a, b) => a.index - b.index);
  const completedCount = sorted.filter((c) => c.status === 'completed').length;
  const nextChapter = sorted.find((c) => c.status !== 'completed') || null;

  return {
    nextChapter,
    completedCount,
    totalCount: sorted.length,
    isComplete: nextChapter === null && sorted.length > 0,
    canProduceIndex: (chapterIndex: number) =>
      nextChapter !== null && nextChapter.index === chapterIndex,
  };
}

export function markChapterCompleted(
  plan: ChapterPlan,
  chapterIndex: number,
  sequenceId: string
): ChapterPlan {
  return {
    ...plan,
    chapters: plan.chapters.map((ch) =>
      ch.index === chapterIndex
        ? { ...ch, status: 'completed', sequenceId }
        : ch
    ),
  };
}

export function validateTrailerReadiness(project: ProductionProject | null | undefined): {
  ready: boolean;
  approvedSequences: ProductionSequence[];
  reason?: string;
} {
  if (!project) {
    return {
      ready: false,
      approvedSequences: [],
      reason: 'Selecciona o crea un proyecto para generar un tráiler.',
    };
  }

  const approvedSequences = (project.sequences || []).filter(
    (s) => s.versionStatus === 'final'
  );

  if (approvedSequences.length === 0) {
    return {
      ready: false,
      approvedSequences: [],
      reason:
        'Aprueba al menos 1 secuencia en Versión Final para que el Agente Director construya el tráiler de 30 segundos.',
    };
  }

  return {
    ready: true,
    approvedSequences,
  };
}

export function normalizeTrailerBeats(
  rawBeats: Array<Partial<TrailerBeat>>,
  approvedSequences: ProductionSequence[]
): TrailerBeat[] {
  const fallbackSeq = approvedSequences[0];
  const count = Math.max(1, rawBeats.length);
  const targetTotal = 30;

  let durations = rawBeats.map((b) =>
    Number.isFinite(Number(b.durationSec)) && Number(b.durationSec) >= 2
      ? Math.min(10, Math.round(Number(b.durationSec)))
      : Math.floor(targetTotal / count)
  );

  const currentSum = durations.reduce((a, b) => a + b, 0);
  if (currentSum !== targetTotal && durations.length > 0) {
    const diff = targetTotal - currentSum;
    durations[durations.length - 1] = Math.max(2, durations[durations.length - 1] + diff);
  }

  // Re-normalize proportionally if clamping caused mismatch
  const finalSum = durations.reduce((a, b) => a + b, 0);
  if (finalSum !== targetTotal && durations.length > 0) {
    const base = Math.floor(targetTotal / durations.length);
    durations = durations.map((_, idx) =>
      idx === durations.length - 1 ? targetTotal - base * (durations.length - 1) : base
    );
  }

  let cursor = 0;
  return rawBeats.map((b, idx) => {
    const dur = durations[idx];
    const startSec = cursor;
    const endSec = cursor + dur;
    cursor = endSec;
    const matchedSeq =
      approvedSequences.find((s) => s.id === b.sourceSequenceId) ||
      approvedSequences[idx % Math.max(1, approvedSequences.length)] ||
      fallbackSeq;

    return {
      id: b.id || `tbeat-${idx + 1}`,
      beatNumber: idx + 1,
      startSec,
      endSec,
      durationSec: dur,
      sourceSequenceId: matchedSeq?.id || '',
      sourceSequenceTitle: b.sourceSequenceTitle || matchedSeq?.title || `Escena ${idx + 1}`,
      visualDescription: b.visualDescription || '',
      hyperRealisticPrompt: b.hyperRealisticPrompt || '',
      motionPrompt: b.motionPrompt || '',
      voiceOverLine: b.voiceOverLine || '',
      onScreenTitleCard: b.onScreenTitleCard || '',
      sfxCue: b.sfxCue || '',
      editingTransition: b.editingTransition || 'Corte directo',
      imageUrl: b.imageUrl || matchedSeq?.storyboardFrames?.[0]?.imageUrl,
      videoUrl: b.videoUrl,
    };
  });
}

export function formatTimecodeSec(sec: number): string {
  const clamped = Math.max(0, Math.round(sec));
  const m = Math.floor(clamped / 60);
  const s = clamped % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function mergeLocalAndCloudProjects(
  localProjects: ProductionProject[],
  cloudProjects: ProductionProject[]
): ProductionProject[] {
  if (cloudProjects.length === 0) return localProjects;
  const localById = new Map(localProjects.map((p) => [p.id, p]));
  const cloudIds = new Set(cloudProjects.map((p) => p.id));

  const mergedCloud = cloudProjects.map((cp) => {
    const lp = localById.get(cp.id);
    if (!lp) return cp;
    const localSeqById = new Map((lp.sequences || []).map((s) => [s.id, s]));
    const mergedSeqs = (cp.sequences || []).map((cs) => {
      const ls = localSeqById.get(cs.id);
      if (!ls) return cs;
      return {
        ...ls,
        ...cs,
        sequenceRating: cs.sequenceRating ?? ls.sequenceRating,
        voiceOverTracks: cs.voiceOverTracks?.length ? cs.voiceOverTracks : ls.voiceOverTracks,
        storyboardFrames: cs.storyboardFrames?.length ? cs.storyboardFrames : ls.storyboardFrames,
      };
    });
    const cloudSeqIds = new Set(mergedSeqs.map((s) => s.id));
    const localOnlySeqs = (lp.sequences || []).filter((s) => !cloudSeqIds.has(s.id));

    return {
      ...cp,
      assets: lp.assets || cp.assets || [],
      chapterPlan: lp.chapterPlan || cp.chapterPlan,
      trailer: lp.trailer || cp.trailer,
      continuityBible:
        (cp.continuityBible || '').length >= (lp.continuityBible || '').length
          ? cp.continuityBible
          : lp.continuityBible,
      sequences: [...mergedSeqs, ...localOnlySeqs].sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt)
      ),
    };
  });

  const localOnly = localProjects.filter((p) => !cloudIds.has(p.id));
  return [...mergedCloud, ...localOnly].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt)
  );
}

export function getStudioSettingsStorageKey(uid: string): string {
  return `auteur_studio_settings_v1_${uid}`;
}

export function loadStudioSettings(uid: string): StudioSettings {
  if (typeof window === 'undefined' || !window.localStorage) {
    return DEFAULT_STUDIO_SETTINGS;
  }
  try {
    const raw = window.localStorage.getItem(getStudioSettingsStorageKey(uid));
    if (!raw) return DEFAULT_STUDIO_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<StudioSettings>;
    return {
      defaultResolution: normalizeResolution(parsed.defaultResolution),
      defaultDirectorStyle:
        typeof parsed.defaultDirectorStyle === 'string' && parsed.defaultDirectorStyle.trim()
          ? parsed.defaultDirectorStyle
          : DEFAULT_STUDIO_SETTINGS.defaultDirectorStyle,
      defaultAspectRatio:
        typeof parsed.defaultAspectRatio === 'string' && parsed.defaultAspectRatio.trim()
          ? parsed.defaultAspectRatio
          : DEFAULT_STUDIO_SETTINGS.defaultAspectRatio,
      defaultVoicePreset:
        parsed.defaultVoicePreset === 'Charon' ||
        parsed.defaultVoicePreset === 'Kore' ||
        parsed.defaultVoicePreset === 'Fenrir' ||
        parsed.defaultVoicePreset === 'Puck' ||
        parsed.defaultVoicePreset === 'Zephyr'
          ? parsed.defaultVoicePreset
          : DEFAULT_STUDIO_SETTINGS.defaultVoicePreset,
      defaultThinkingDepth:
        parsed.defaultThinkingDepth === 'deep' ? 'deep' : 'standard',
    };
  } catch {
    return DEFAULT_STUDIO_SETTINGS;
  }
}

export function saveStudioSettings(uid: string, settings: StudioSettings): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(
      getStudioSettingsStorageKey(uid),
      JSON.stringify(settings)
    );
  } catch {
    // Ignore storage errors
  }
}
