import type {
  AdminAgentProfile,
  ProductionProject,
  ProductionSequence,
  ResolutionTier,
  SequenceLocalMetrics,
  StoryboardCard,
} from '../types/studio.ts';
import { buildHyperRealisticResolutionSpec, normalizeResolution } from './productionPipeline.ts';

export const DEFAULT_ADMIN_AGENT_PROFILE: AdminAgentProfile = {
  strictContinuityMode: true,
  preferredVisualGrammar:
    'Composición arquitectónica de Hollywood, profundidad de campo motivada, iluminación práctica con contraste Kelvin realista y continuidad exacta de vestuario y utilería.',
  customDirectives: '',
  targetAudienceTone: 'Cine autoral de prestigio internacional (IMAX / Festival de Cannes)',
  updatedAt: new Date(0).toISOString(),
};

export function normalizeAdminAgentProfile(
  raw: Partial<AdminAgentProfile> | null | undefined
): AdminAgentProfile {
  return {
    strictContinuityMode:
      typeof raw?.strictContinuityMode === 'boolean'
        ? raw.strictContinuityMode
        : DEFAULT_ADMIN_AGENT_PROFILE.strictContinuityMode,
    preferredVisualGrammar:
      typeof raw?.preferredVisualGrammar === 'string' && raw.preferredVisualGrammar.trim()
        ? raw.preferredVisualGrammar.trim()
        : DEFAULT_ADMIN_AGENT_PROFILE.preferredVisualGrammar,
    customDirectives:
      typeof raw?.customDirectives === 'string' ? raw.customDirectives.trim() : '',
    targetAudienceTone:
      typeof raw?.targetAudienceTone === 'string' && raw.targetAudienceTone.trim()
        ? raw.targetAudienceTone.trim()
        : DEFAULT_ADMIN_AGENT_PROFILE.targetAudienceTone,
    updatedAt:
      typeof raw?.updatedAt === 'string' && raw.updatedAt.trim()
        ? raw.updatedAt
        : new Date().toISOString(),
  };
}

export function validateAdminDirective(text: string): { valid: boolean; error?: string } {
  const trimmed = text.trim();
  if (trimmed.length > 2000) {
    return {
      valid: false,
      error: 'Las directivas del Administrador no pueden superar los 2000 caracteres.',
    };
  }
  return { valid: true };
}

export function buildAdminTrainingPromptBlock(profile: AdminAgentProfile): string {
  const sections: string[] = [
    `TONO EDITORIAL DEFINIDO POR ADMINISTRACIÓN: ${profile.targetAudienceTone}`,
    `GRAMÁTICA VISUAL PREFERIDA: ${profile.preferredVisualGrammar}`,
    profile.strictContinuityMode
      ? 'MODO CONTINUIDAD ESTRICTA ACTIVO: Verifica cada rasgo físico, vestuario, iluminación Kelvin y objeto clave contra la Biblia de Continuidad antes de redactar planos o storyboards.'
      : 'MODO EXPLORACIÓN CREATIVA: Mantén coherencia narrativa permitiendo variaciones estilísticas controladas.',
  ];

  if (profile.customDirectives.trim()) {
    sections.push(`DIRECTIVAS MAESTRAS DEL ADMINISTRADOR:\n${profile.customDirectives.trim()}`);
  }

  return sections.join('\n');
}

const KEY_FRAME_PHASE_LABELS = [
  '01 · Establecimiento y Atmósfera',
  '02 · Tensión y Conflicto',
  '03 · Clímax Dramático',
  '04 · Punto de Giro / Cierre',
] as const;

export function normalizeFourKeyStoryboardFrames(
  rawFrames: Array<Partial<StoryboardCard>>,
  params: {
    sequence: ProductionSequence;
    resolution: ResolutionTier;
    nowIso?: string;
    idPrefix?: string;
  }
): StoryboardCard[] {
  const { sequence } = params;
  const resolution = normalizeResolution(params.resolution);
  const resSpec = buildHyperRealisticResolutionSpec(resolution);
  const prefix = params.idPrefix || `sb4-${Date.now().toString(36)}`;
  const aspectRatio = sequence.aspectRatio || '2.39:1';
  const defaultCamera = `${sequence.cameraSystem || 'ARRI Alexa 65'} · ${sequence.lensPackage || 'Cooke Anamorphic'}`;

  const fallbackShots = sequence.shotList || [];
  const baseList = Array.isArray(rawFrames) ? rawFrames.slice(0, 4) : [];

  const result: StoryboardCard[] = [];
  for (let i = 0; i < 4; i++) {
    const item = baseList[i] || {};
    const matchedShot = fallbackShots[i] || fallbackShots[0];
    const cleanTitle =
      typeof item.title === 'string' && item.title.trim()
        ? item.title.trim()
        : `${KEY_FRAME_PHASE_LABELS[i]} — ${sequence.title}`;
    const cleanShotRef =
      typeof item.shotRef === 'string' && item.shotRef.trim()
        ? item.shotRef.trim()
        : matchedShot
          ? `Plano ${matchedShot.shotNumber}`
          : `Plano 0${i + 1}`;
    const cleanCameraSpec =
      typeof item.cameraSpec === 'string' && item.cameraSpec.trim()
        ? item.cameraSpec.trim()
        : matchedShot
          ? `${sequence.cameraSystem} · ${matchedShot.lensMm}`
          : defaultCamera;

    const rawVisualPrompt =
      typeof item.visualPrompt === 'string' && item.visualPrompt.trim()
        ? item.visualPrompt.trim()
        : `${sequence.hyperRealisticPrompt || sequence.directorVision || sequence.logline}. ${
            matchedShot?.framingNote || ''
          }. ${resSpec}`.trim();

    const visualPrompt = rawVisualPrompt.includes(resolution)
      ? rawVisualPrompt
      : `${rawVisualPrompt} (${resolution})`;

    const veoMotionPrompt =
      typeof item.veoMotionPrompt === 'string' && item.veoMotionPrompt.trim()
        ? item.veoMotionPrompt.trim()
        : `${matchedShot?.movement || 'Slow controlled cinema dolly push-in'} at ${aspectRatio}, natural atmospheric motion.`;

    result.push({
      id: `${prefix}-${i + 1}`,
      title: cleanTitle,
      shotRef: cleanShotRef,
      aspectRatio: item.aspectRatio?.trim() || aspectRatio,
      cameraSpec: cleanCameraSpec,
      visualPrompt,
      veoMotionPrompt,
      imageUrl: item.imageUrl,
      videoUrl: item.videoUrl,
    });
  }

  return result;
}

export function computeSequenceDiagnostics(
  project: ProductionProject | null | undefined,
  sequence: ProductionSequence | null | undefined
): SequenceLocalMetrics {
  if (!sequence) {
    return {
      shotCount: 0,
      screenplaySceneCount: 0,
      screenplayBeatCount: 0,
      dialogueBeatCount: 0,
      storyboardCount: 0,
      voiceOverCount: 0,
      hasContinuityBible: Boolean(project?.continuityBible?.trim()),
      hasHyperRealisticPrompt: false,
      readinessScore: 0,
    };
  }

  const shotCount = sequence.shotList?.length || 0;
  const screenplaySceneCount = sequence.screenplay?.length || 0;
  const allBeats = (sequence.screenplay || []).flatMap((s) => s.beats || []);
  const screenplayBeatCount = allBeats.length;
  const dialogueBeatCount = allBeats.filter((b) => b.type === 'dialogue').length;
  const storyboardCount = sequence.storyboardFrames?.length || 0;
  const voiceOverCount = sequence.voiceOverTracks?.length || 0;
  const hasContinuityBible = Boolean(project?.continuityBible?.trim());
  const hasHyperRealisticPrompt = Boolean(sequence.hyperRealisticPrompt?.trim());

  let score = 0;
  if (shotCount >= 6) score += 25;
  else if (shotCount > 0) score += 12;
  if (screenplaySceneCount >= 1 && screenplayBeatCount >= 4) score += 20;
  else if (screenplayBeatCount > 0) score += 10;
  if (storyboardCount >= 4) score += 20;
  else if (storyboardCount >= 2) score += 10;
  if (voiceOverCount >= 2) score += 15;
  else if (voiceOverCount >= 1) score += 8;
  if (hasContinuityBible) score += 10;
  if (hasHyperRealisticPrompt) score += 10;

  return {
    shotCount,
    screenplaySceneCount,
    screenplayBeatCount,
    dialogueBeatCount,
    storyboardCount,
    voiceOverCount,
    hasContinuityBible,
    hasHyperRealisticPrompt,
    readinessScore: Math.min(100, score),
  };
}
