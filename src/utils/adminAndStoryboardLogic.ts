import type {
  AdminAgentProfile,
  FrameoProductionSpec,
  FrameoSceneSpec,
  ProductionProject,
  ProductionSequence,
  ResolutionTier,
  SequenceLocalMetrics,
  StoryboardCard,
} from '../types/studio.ts';
import { buildHyperRealisticResolutionSpec, normalizeResolution } from './productionPipeline.ts';

export const FRAMEO_MODEL_CATALOG = [
  'Veo 3.1 Rápido',
  'Kling O3',
  'Kling 3.0 Turbo',
  'Semilla 2,5',
  'MiniMax H3',
  'Happy Horse 1.1',
  'Gemini Omni Flash',
  'Grok Imagine',
  'Imagen GPT 2',
  'Seedream 5.0 Pro',
] as const;

export const FRAMEO_VFX_MANTO_MODES = [
  'Estándar (Dirección directa sin reemplazo VFX)',
  'Cambiar de contexto (Reemplazo de entorno / Chroma)',
  'Añade al plano (Composición e inserción de elementos)',
  'Extensión de conjunto (Set Extension arquitectónica)',
] as const;

export function buildFrameoShotFilename(
  projectTitle: string,
  sequenceNumber: number,
  shotIndex: number,
  version = 1
): string {
  const words = (projectTitle || 'AUTEUR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const code =
    words.length >= 2
      ? words
          .slice(0, 3)
          .map((w) => w[0].toUpperCase())
          .join('')
      : (words[0] || 'AUT').slice(0, 3).toUpperCase();
  const ep = String(Math.max(1, Math.round(sequenceNumber))).padStart(2, '0');
  const sh = String(Math.max(1, Math.round(shotIndex))).padStart(3, '0');
  const ver = String(Math.max(1, Math.round(version))).padStart(3, '0');
  return `${code}_EP${ep}_SH${sh}_v${ver}.mov`;
}

export const FRAMEO_STYLE_PRESETS = [
  'Frameo IA Cinema 4K (Mini-Drama / Hiperrealismo)',
  'Frameo IA VFX Studio Manto (Previsualización 480P -> Full Render)',
  'Frameo IA Thriller Noir (Anamórfico Alto Contraste)',
  'Frameo IA Épica Monumental (IMAX / Escala Histórica)',
  'Frameo IA Documental Fotorrealista (Luz Natural)',
  'Frameo IA Sci-Fi Cyberpunk (Volumétrico Neon/Kelvin)',
] as const;

export const DEFAULT_ADMIN_AGENT_PROFILE: AdminAgentProfile = {
  strictContinuityMode: true,
  preferredVisualGrammar:
    'Composición arquitectónica de Hollywood, profundidad de campo motivada, iluminación práctica con contraste Kelvin realista y continuidad exacta de vestuario y utilería.',
  customDirectives: '',
  targetAudienceTone: 'Cine autoral de prestigio internacional (IMAX / Festival de Cannes)',
  frameoIaEnabled: true,
  frameoIaAutoGenerateVideo: true,
  frameoIaModel: FRAMEO_MODEL_CATALOG[0],
  frameoIaVfxMode: FRAMEO_VFX_MANTO_MODES[0],
  frameoIaRenderQuality: '480p_preview',
  frameoIaStylePreset: FRAMEO_STYLE_PRESETS[0],
  frameoIaAspectRatio: '16:9',
  frameoIaClipDurationSec: 5,
  updatedAt: new Date(0).toISOString(),
};

export function normalizeAdminAgentProfile(
  raw: Partial<AdminAgentProfile> | null | undefined
): AdminAgentProfile {
  const rawClip = Number(raw?.frameoIaClipDurationSec);
  const clipDuration =
    Number.isFinite(rawClip) && rawClip >= 3 && rawClip <= 12 ? Math.round(rawClip) : 5;

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
    frameoIaEnabled:
      typeof raw?.frameoIaEnabled === 'boolean'
        ? raw.frameoIaEnabled
        : DEFAULT_ADMIN_AGENT_PROFILE.frameoIaEnabled,
    frameoIaAutoGenerateVideo:
      typeof raw?.frameoIaAutoGenerateVideo === 'boolean'
        ? raw.frameoIaAutoGenerateVideo
        : DEFAULT_ADMIN_AGENT_PROFILE.frameoIaAutoGenerateVideo,
    frameoIaModel:
      typeof raw?.frameoIaModel === 'string' && raw.frameoIaModel.trim()
        ? raw.frameoIaModel.trim()
        : DEFAULT_ADMIN_AGENT_PROFILE.frameoIaModel,
    frameoIaVfxMode:
      typeof raw?.frameoIaVfxMode === 'string' && raw.frameoIaVfxMode.trim()
        ? raw.frameoIaVfxMode.trim()
        : DEFAULT_ADMIN_AGENT_PROFILE.frameoIaVfxMode,
    frameoIaRenderQuality:
      raw?.frameoIaRenderQuality === 'full_hd' ? 'full_hd' : '480p_preview',
    frameoIaStylePreset:
      typeof raw?.frameoIaStylePreset === 'string' && raw.frameoIaStylePreset.trim()
        ? raw.frameoIaStylePreset.trim()
        : DEFAULT_ADMIN_AGENT_PROFILE.frameoIaStylePreset,
    frameoIaAspectRatio:
      typeof raw?.frameoIaAspectRatio === 'string' && raw.frameoIaAspectRatio.trim()
        ? raw.frameoIaAspectRatio.trim()
        : DEFAULT_ADMIN_AGENT_PROFILE.frameoIaAspectRatio,
    frameoIaClipDurationSec: clipDuration,
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

export function buildFrameoAdminPromptDirective(profile: AdminAgentProfile): string {
  const stylePreset = profile.frameoIaStylePreset || DEFAULT_ADMIN_AGENT_PROFILE.frameoIaStylePreset;
  const modelName = profile.frameoIaModel || FRAMEO_MODEL_CATALOG[0];
  const vfxMode = profile.frameoIaVfxMode || FRAMEO_VFX_MANTO_MODES[0];
  const qualityLabel =
    profile.frameoIaRenderQuality === 'full_hd'
      ? 'Resolución completa (Full HD / 4K)'
      : 'Vista previa rápida 480P (validación previa de look y movimiento)';
  const aspectRatio = profile.frameoIaAspectRatio || '16:9';
  const clipDuration = profile.frameoIaClipDurationSec || 5;

  return [
    'MOTOR DE PRODUCCIÓN EXCLUSIVO DE ADMINISTRADOR: FRAMEO.AI / MCP (ArthurAgent -> Frameo IA Pipeline)',
    `- Modelo Frameo.AI seleccionado: ${modelName} · Preset: ${stylePreset}`,
    `- VFX Studio (Agente Manto): ${vfxMode} · Calidad objetivo: ${qualityLabel}`,
    `- Formato maestro Frameo IA: ${aspectRatio} · Duración objetivo por escena/clip Frameo: ${clipDuration}s`,
    '- ESTRUCTURA FRAMEO IA OBLIGATORIA: Diseña cada plano de "shotList" y cada tarjeta de "storyboardFrames" con anclajes consistentes de personaje (rasgos faciales, edad, peinado, vestuario exacto y paleta HEX) para que Frameo IA conserve identidad visual continua entre escenas.',
    '- En "visualPrompt" y "veoMotionPrompt", redacta instrucciones limpias, hiperrealistas y listas para ejecución directa en Frameo IA / MCP (sin marcas de agua, sin texto en pantalla, especificando cámara, lente, iluminación Kelvin y movimiento fluido de cámara).',
    '- Coordina "voiceOverTracks" y diálogos de "screenplay" en bloques cortos sincronizables con clips de ' +
      `${clipDuration}s en Frameo IA.`,
  ].join('\n');
}

export function buildAdminTrainingPromptBlock(
  profile: AdminAgentProfile,
  options?: { includeFrameoIa?: boolean }
): string {
  const sections: string[] = [
    `TONO EDITORIAL DEFINIDO POR ADMINISTRACIÓN: ${profile.targetAudienceTone}`,
    `GRAMÁTICA VISUAL PREFERIDA: ${profile.preferredVisualGrammar}`,
    profile.strictContinuityMode
      ? 'MODO CONTINUIDAD ESTRICTA ACTIVO: Verifica cada rasgo físico, vestuario, iluminación Kelvin y objeto clave contra la Biblia de Continuidad antes de redactar planos o storyboards.'
      : 'MODO EXPLORACIÓN CREATIVA: Mantén coherencia narrativa permitiendo variaciones estilísticas controladas.',
  ];

  if (options?.includeFrameoIa && profile.frameoIaEnabled !== false) {
    sections.push(buildFrameoAdminPromptDirective(profile));
  }

  if (profile.customDirectives.trim()) {
    sections.push(`DIRECTIVAS MAESTRAS DEL ADMINISTRADOR:\n${profile.customDirectives.trim()}`);
  }

  return sections.join('\n');
}

export function buildFrameoProductionSpecForSequence(params: {
  project: ProductionProject;
  sequence: ProductionSequence;
  profile: AdminAgentProfile;
}): FrameoProductionSpec {
  const { project, sequence, profile } = params;
  const stylePreset =
    profile.frameoIaStylePreset || DEFAULT_ADMIN_AGENT_PROFILE.frameoIaStylePreset || 'Frameo IA Cinema 4K';
  const modelName = profile.frameoIaModel || FRAMEO_MODEL_CATALOG[0];
  const vfxMantoMode = profile.frameoIaVfxMode || FRAMEO_VFX_MANTO_MODES[0];
  const renderQuality = profile.frameoIaRenderQuality || '480p_preview';
  const seqIndex = Math.max(
    1,
    sequence.chapterIndex ||
      project.sequences.findIndex((s) => s.id === sequence.id) + 1 ||
      1
  );
  const shotNamingTemplate = buildFrameoShotFilename(project.title, seqIndex, 1, 1);
  const targetRatio =
    sequence.aspectRatio || profile.frameoIaAspectRatio || '16:9';
  const defaultClipSec = profile.frameoIaClipDurationSec || 5;
  const consistencyAnchor = `${sequence.cameraSystem}, ${sequence.lensPackage}, ${sequence.filmStockOrLut}, Kelvin ${sequence.lighting?.colorTemperatureKelvin || '4500K'}, Wardrobe: ${sequence.vfx?.wardrobeAndMakeup || 'Consistent main cast wardrobe'}`;

  const allDialogueBeats = (sequence.screenplay || [])
    .flatMap((sc) => sc.beats || [])
    .filter((b) => b.type === 'dialogue');
  const voiceTracks = sequence.voiceOverTracks || [];
  const shots = sequence.shotList || [];
  const frames = sequence.storyboardFrames || [];
  const sceneCount = Math.max(frames.length, Math.min(shots.length, 6), 4);

  const scenes: FrameoSceneSpec[] = [];
  for (let i = 0; i < sceneCount; i++) {
    const shot = shots[i] || shots[0];
    const frame = frames[i];
    const vo = voiceTracks[i];
    const dlg = allDialogueBeats[i];

    const shotRef = frame?.shotRef || shot?.shotNumber || `Escena 0${i + 1}`;
    const sceneLabel =
      frame?.title ||
      (shot ? `${shot.shotType} (${shot.lensMm})` : `Escena Frameo ${i + 1}`);

    const visualBase =
      frame?.visualPrompt ||
      `${sequence.hyperRealisticPrompt || sequence.directorVision}. Shot: ${shot?.shotType || 'Medium Shot'}, ${shot?.framingNote || sequence.logline}`;

    const motionBase =
      frame?.veoMotionPrompt ||
      `${shot?.movement || 'Smooth cinematic dolly push-in'}, natural micro-expressions, volumetric atmosphere`;

    const narrationOrDialogue = vo
      ? `[VO ${vo.characterOrNarrator} · ${vo.voicePreset}]: "${vo.text}"`
      : dlg
        ? `[${dlg.character || 'PERSONAJE'}]: "${dlg.text}"`
        : `[Atmósfera Sonora]: ${sequence.soundDesign?.musicalScore || 'Música cinematográfica contenida'}`;

    const durationSec = Math.max(
      3,
      Math.min(12, Math.round(shot?.durationSec || defaultClipSec))
    );

    scenes.push({
      sceneNumber: i + 1,
      shotRef,
      sceneLabel,
      characterAnchor: `${sequence.vfx?.wardrobeAndMakeup || 'Continuidad de personajes según Biblia'} · ${sequence.vfx?.locationsAndSets || project.title}`,
      frameoVisualPrompt: `${visualBase}. Engine Model: ${modelName}. Style: ${stylePreset}. VFX Manto: ${vfxMantoMode}. Camera & Color Lock: ${consistencyAnchor}. Aspect Ratio ${targetRatio}, photorealistic skin texture, no text overlay.`,
      frameoMotionPrompt: `${motionBase}. Clip duration ${durationSec}s, smooth physics, cinematic motion blur.`,
      narrationOrDialogue,
      aspectRatio: targetRatio,
      durationSec,
    });
  }

  return {
    engine: 'Frameo IA',
    stylePreset,
    modelName,
    vfxMantoMode,
    renderQuality,
    shotNamingTemplate,
    aspectRatio: targetRatio,
    clipDurationSec: defaultClipSec,
    continuitySeedNote: `${project.continuityBible || sequence.continuitySummary || 'Mantener consistencia física de elenco y luz.'}\n[Lock Técnico]: ${consistencyAnchor}`,
    workflowChecklist: [
      `1. Conecta Frameo.AI vía MCP (https://mcp.frameo.ai/mcp) o crea proyecto en Frameo.AI en ${targetRatio} con modelo "${modelName}" y preset "${stylePreset}".`,
      `2. En VFX Studio (Agente Manto), configura "${vfxMantoMode}" y verifica fotogramas antes del render (${renderQuality === 'full_hd' ? 'Resolución completa' : 'Vista previa rápida 480P'}).`,
      `3. Genera las ${scenes.length} escenas pegando Visual Prompt + Motion Prompt (${defaultClipSec}s promedio por clip).`,
      `4. Ordena los archivos exportados con nomenclatura de estudio (ej. ${shotNamingTemplate}) y sincroniza audio/Voz en Off.`,
      '5. Valida la versión final en el Storyboard y Timeline de AUTEUR Studio.',
    ],
    scenes,
    generatedAt: new Date().toISOString(),
  };
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
