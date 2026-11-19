import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { fileURLToPath } from 'url';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import type {
  AgentDiagnosticReport,
  AdminAgentProfile,
  AudioAnalysisReport,
  BookChapterItem,
  ChapterPlan,
  LearningCategory,
  LearningLesson,
  ProductionProject,
  ProductionSequence,
  ProjectAsset,
  ProjectTrailer,
  ResolutionTier,
  SourceMaterialType,
  StoryboardCard,
  VoiceOverTrack,
  VoicePreset,
} from './src/types/studio';
import { buildContinuationContext } from './src/utils/studioLogic';
import {
  buildLearningPromptContext,
  extractAutomaticLessons,
  validateLessonInput,
} from './src/utils/learningEngine';
import { buildRatedChoiceLessons } from './src/utils/studioIntelligence';
import {
  buildHyperRealisticResolutionSpec,
  getNanoImageSizeForResolution,
  markChapterCompleted,
  normalizeResolution,
  normalizeTrailerBeats,
} from './src/utils/productionPipeline';
import {
  DEFAULT_ADMIN_AGENT_PROFILE,
  buildAdminTrainingPromptBlock,
  computeSequenceDiagnostics,
  normalizeAdminAgentProfile,
  normalizeFourKeyStoryboardFrames,
  validateAdminDirective,
} from './src/utils/adminAndStoryboardLogic';
import { buildLocalPreviewFixture } from './src/utils/devPreviewFixture';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const WORKSPACE_DIR = path.resolve(__dirname, 'workspace');
const USERS_WORKSPACE_ROOT = path.join(WORKSPACE_DIR, 'users');

const AUDIO_EXTENSIONS = new Set([
  '.mp3',
  '.wav',
  '.m4a',
  '.ogg',
  '.aac',
  '.flac',
  '.webm',
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 24 * 1024 * 1024 },
});

function sanitizeSlug(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function getRequestUserId(req: express.Request): string {
  const fromHeader = req.headers['x-user-id'];
  const headerVal = Array.isArray(fromHeader) ? fromHeader[0] : fromHeader;
  const queryVal = typeof req.query?.userId === 'string' ? req.query.userId : '';
  const bodyVal = typeof req.body?.userId === 'string' ? req.body.userId : '';
  const raw = (headerVal || queryVal || bodyVal || 'default').trim();
  return sanitizeSlug(raw).slice(0, 120) || 'default';
}

function getUserProjectsRoot(userId: string): string {
  return path.join(USERS_WORKSPACE_ROOT, sanitizeSlug(userId), 'projects');
}

function getProjectDir(userId: string, projectId: string): string {
  return path.join(getUserProjectsRoot(userId), sanitizeSlug(projectId));
}

function getProjectJsonPath(userId: string, projectId: string): string {
  return path.join(getProjectDir(userId, projectId), 'project.json');
}

function getProjectAssetsDir(userId: string, projectId: string): string {
  return path.join(getProjectDir(userId, projectId), 'assets');
}

function getLearningFile(userId: string): string {
  return path.join(USERS_WORKSPACE_ROOT, sanitizeSlug(userId), 'learning_memory.json');
}

function writeProjectFolder(userId: string, project: ProductionProject): void {
  const assetsDir = getProjectAssetsDir(userId, project.id);
  fs.mkdirSync(assetsDir, { recursive: true });
  fs.writeFileSync(
    getProjectJsonPath(userId, project.id),
    JSON.stringify(project, null, 2),
    'utf-8'
  );
}

function ensureWorkspaceProjects(userId: string): ProductionProject[] {
  const root = getUserProjectsRoot(userId);
  fs.mkdirSync(root, { recursive: true });
  const entries = fs.readdirSync(root, { withFileTypes: true });
  const folders = entries.filter((e) => e.isDirectory());

  const projects: ProductionProject[] = [];
  for (const folder of folders) {
    const jsonPath = path.join(root, folder.name, 'project.json');
    if (!fs.existsSync(jsonPath)) continue;
    try {
      const raw = fs.readFileSync(jsonPath, 'utf-8');
      const parsed = JSON.parse(raw) as ProductionProject;
      if (parsed && parsed.id) {
        parsed.sequences = (parsed.sequences || []).map((seq) => ({
          ...seq,
          versionStatus: seq.versionStatus === 'final' ? 'final' : 'draft',
        }));
        projects.push(parsed);
      }
    } catch {
      // Skip malformed project file
    }
  }

  return projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function readProjectById(userId: string, projectId: string): ProductionProject | null {
  ensureWorkspaceProjects(userId);
  const jsonPath = getProjectJsonPath(userId, projectId);
  if (!fs.existsSync(jsonPath)) return null;
  try {
    const raw = fs.readFileSync(jsonPath, 'utf-8');
    return JSON.parse(raw) as ProductionProject;
  } catch {
    return null;
  }
}

function ensureLearningMemory(userId: string): LearningLesson[] {
  const file = getLearningFile(userId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify([], null, 2), 'utf-8');
    return [];
  }
  try {
    const raw = fs.readFileSync(file, 'utf-8');
    const parsed = JSON.parse(raw) as LearningLesson[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveLearningMemory(userId: string, lessons: LearningLesson[]): void {
  const file = getLearningFile(userId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(lessons, null, 2), 'utf-8');
}

function getAdminConfigFile(): string {
  return path.join(WORKSPACE_DIR, 'admin', 'agent_config.json');
}

function ensureAdminAgentProfile(): AdminAgentProfile {
  const file = getAdminConfigFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!fs.existsSync(file)) {
    const initial: AdminAgentProfile = {
      ...DEFAULT_ADMIN_AGENT_PROFILE,
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(file, JSON.stringify(initial, null, 2), 'utf-8');
    return initial;
  }
  try {
    const raw = fs.readFileSync(file, 'utf-8');
    return normalizeAdminAgentProfile(JSON.parse(raw) as Partial<AdminAgentProfile>);
  } catch {
    return { ...DEFAULT_ADMIN_AGENT_PROFILE, updatedAt: new Date().toISOString() };
  }
}

function saveAdminAgentProfile(profile: AdminAgentProfile): AdminAgentProfile {
  const normalized = normalizeAdminAgentProfile({
    ...profile,
    updatedAt: new Date().toISOString(),
  });
  const file = getAdminConfigFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(normalized, null, 2), 'utf-8');
  return normalized;
}

function getGenAIClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error(
      'GEMINI_API_KEY no está configurada en el servidor. Configura tu clave en Settings > Secrets.'
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function inferMimeType(filename: string, providedMime: string): string {
  const ext = path.extname(filename).toLowerCase();
  if (ext === '.pdf') return 'application/pdf';
  if (ext === '.mp3') return 'audio/mpeg';
  if (ext === '.wav') return 'audio/wav';
  if (ext === '.m4a') return 'audio/mp4';
  if (ext === '.ogg') return 'audio/ogg';
  if (ext === '.aac') return 'audio/aac';
  if (ext === '.flac') return 'audio/flac';
  if (ext === '.webm') return 'audio/webm';
  return providedMime || 'application/octet-stream';
}

function isAudioFilename(filename: string): boolean {
  return AUDIO_EXTENSIONS.has(path.extname(filename).toLowerCase());
}

function saveUploadedAsset(
  userId: string,
  project: ProductionProject,
  file: Express.Multer.File
): { updatedProject: ProductionProject; asset: ProjectAsset } {
  const assetsDir = getProjectAssetsDir(userId, project.id);
  fs.mkdirSync(assetsDir, { recursive: true });
  const ext = path.extname(file.originalname).toLowerCase();
  const baseName = sanitizeSlug(path.basename(file.originalname, ext)).slice(0, 60);
  const storedName = `${Date.now().toString(36)}-${baseName}${ext}`;
  const fullPath = path.join(assetsDir, storedName);
  fs.writeFileSync(fullPath, file.buffer);

  const kind: ProjectAsset['kind'] = isAudioFilename(file.originalname)
    ? 'audio'
    : ext === '.jpg' || ext === '.jpeg' || ext === '.png' || ext === '.webp'
      ? 'image'
      : 'document';

  const asset: ProjectAsset = {
    id: `asset-${Date.now().toString(36)}`,
    filename: file.originalname,
    kind,
    mimeType: inferMimeType(file.originalname, file.mimetype),
    sizeBytes: file.size,
    url: `/workspace-assets/${encodeURIComponent(userId)}/${encodeURIComponent(project.id)}/${encodeURIComponent(storedName)}`,
    createdAt: new Date().toISOString(),
  };

  const updatedProject: ProductionProject = {
    ...project,
    assets: [asset, ...(project.assets || [])],
    updatedAt: new Date().toISOString(),
  };
  writeProjectFolder(userId, updatedProject);
  return { updatedProject, asset };
}

function saveGeneratedAssetBuffer(
  userId: string,
  project: ProductionProject,
  params: {
    baseName: string;
    ext: string;
    mimeType: string;
    buffer: Buffer;
    kind: ProjectAsset['kind'];
  }
): { updatedProject: ProductionProject; asset: ProjectAsset } {
  const assetsDir = getProjectAssetsDir(userId, project.id);
  fs.mkdirSync(assetsDir, { recursive: true });
  const safeBase = sanitizeSlug(params.baseName).slice(0, 50) || 'asset';
  const storedName = `${Date.now().toString(36)}-${safeBase}${params.ext}`;
  const fullPath = path.join(assetsDir, storedName);
  fs.writeFileSync(fullPath, params.buffer);

  const asset: ProjectAsset = {
    id: `asset-${Date.now().toString(36)}`,
    filename: storedName,
    kind: params.kind,
    mimeType: params.mimeType,
    sizeBytes: params.buffer.byteLength,
    url: `/workspace-assets/${encodeURIComponent(userId)}/${encodeURIComponent(project.id)}/${encodeURIComponent(storedName)}`,
    createdAt: new Date().toISOString(),
  };

  const updatedProject: ProductionProject = {
    ...project,
    assets: [asset, ...(project.assets || [])],
    updatedAt: new Date().toISOString(),
  };
  writeProjectFolder(userId, updatedProject);
  return { updatedProject, asset };
}

function normalizeNanoAspectRatio(rawRatio: string): '16:9' | '4:3' | '1:1' | '3:4' | '9:16' {
  const r = (rawRatio || '').trim();
  if (r === '9:16') return '9:16';
  if (r === '3:4') return '3:4';
  if (r === '1:1') return '1:1';
  if (r === '4:3' || r === '1.43:1') return '4:3';
  return '16:9';
}

function normalizeOmniAspectRatio(rawRatio: string): '16:9' | '9:16' {
  const r = (rawRatio || '').trim();
  if (r === '9:16' || r === '3:4') return '9:16';
  return '16:9';
}

function resolveLocalImageBase64(imageUrl?: string): { data: string; mimeType: string } | null {
  if (!imageUrl) return null;
  try {
    let targetPath: string | null = null;
    if (imageUrl.startsWith('/workspace-assets/')) {
      const parts = imageUrl.replace('/workspace-assets/', '').split('/');
      if (parts.length === 3) {
        const uid = sanitizeSlug(decodeURIComponent(parts[0]));
        const pid = sanitizeSlug(decodeURIComponent(parts[1]));
        const fname = sanitizeSlug(decodeURIComponent(parts[2]));
        targetPath = path.join(getProjectAssetsDir(uid, pid), fname);
      }
    } else if (imageUrl.startsWith('/src/assets/')) {
      const rel = imageUrl.replace(/^\/+/, '');
      targetPath = path.resolve(__dirname, rel);
    }
    if (!targetPath || !fs.existsSync(targetPath)) return null;
    const ext = path.extname(targetPath).toLowerCase();
    const mimeType =
      ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
    const data = fs.readFileSync(targetPath).toString('base64');
    return { data, mimeType };
  } catch {
    return null;
  }
}

function resolveProjectAssetBuffer(
  userId: string,
  project: ProductionProject,
  assetId: string
): { asset: ProjectAsset; buffer: Buffer } | null {
  const asset = (project.assets || []).find((a) => a.id === assetId);
  if (!asset || !asset.url.startsWith('/workspace-assets/')) return null;
  try {
    const parts = asset.url.replace('/workspace-assets/', '').split('/');
    if (parts.length !== 3) return null;
    const fname = sanitizeSlug(decodeURIComponent(parts[2]));
    const targetPath = path.join(getProjectAssetsDir(userId, project.id), fname);
    if (!fs.existsSync(targetPath)) return null;
    return { asset, buffer: fs.readFileSync(targetPath) };
  } catch {
    return null;
  }
}

function normalizeVoicePreset(raw?: string): VoicePreset {
  if (
    raw === 'Charon' ||
    raw === 'Kore' ||
    raw === 'Fenrir' ||
    raw === 'Puck' ||
    raw === 'Zephyr'
  ) {
    return raw;
  }
  return 'Charon';
}

async function transcribeAudioWithGemini(
  ai: GoogleGenAI,
  fileBuffer: Buffer,
  mimeType: string
): Promise<string> {
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3.5-transcribe',
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: 'Transcribe íntegramente este archivo de audio en su idioma original, preservando pausas dramáticas, entonaciones relevantes o anotaciones de efectos sonoros audibles entre corchetes.',
            },
            {
              inlineData: {
                mimeType,
                data: fileBuffer.toString('base64'),
              },
            },
          ],
        },
      ],
    });
    return (response.text ?? '').trim();
  } catch (err) {
    console.warn('Fallback: gemini-3.5-transcribe no devolvió texto:', err);
    return '';
  }
}

const AUDIO_ANALYSIS_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    transcription: { type: Type.STRING },
    narrationStyle: { type: Type.STRING },
    emotionalArc: { type: Type.STRING },
    rhythmAndPacing: { type: Type.STRING },
    detectedSoundEffects: { type: Type.ARRAY, items: { type: Type.STRING } },
    directingRecommendations: { type: Type.STRING },
  },
  required: [
    'transcription',
    'narrationStyle',
    'emotionalArc',
    'rhythmAndPacing',
    'detectedSoundEffects',
    'directingRecommendations',
  ],
};

const PRODUCER_SYSTEM_INSTRUCTION = `Eres AUTEUR, un Productor, Director de Cine, Guionista, Experto en Escenografía y Director de Fotografía de Hollywood premiado en los Premios Óscar, Cannes y Venecia.
Tu sello personal es convertir cualquier material fuente —capítulos de libros, audiolibros narrados, relatos cortos o sinopsis— en una producción cinematográfica monumental de clase mundial.

REGLAS DE ORO DE PRODUCCIÓN:
1. FIDELIDAD ABSOLUTA Y PRODUCCIÓN CAPÍTULO A CAPÍTULO: Respeta los eventos, nombres propios, tono emocional, diálogos clave y atmósfera de la obra proporcionada. Si estás produciendo un capítulo específico de un libro o audiolibro largo, céntrate exclusivamente en ese capítulo respetando la Biblia de Continuidad heredada de los capítulos previos. Si recibes un archivo de audio (MP3, WAV, M4A, OGG), escucha no solo las palabras sino la narración, el tono emocional, el ritmo, las pausas y los efectos sonoros para elaborar un informe de dirección y diseño sonoro preciso junto con la transcripción.
2. DIRECCIÓN DE FOTOGRAFÍA Y ESCENOGRAFÍA HIPERREALISTA: Especifica cuerpos de cámara reales (ARRI Alexa 65, Panavision Millennium DXL2, RED V-Raptor XL, Sony VENICE 2), ópticas concretas (Cooke Anamorphic, Panavision Sphero 65, Leitz Summilux-C), distancias focales en mm, profundidad de campo, textura arquitectónica de escenografía, materiales PBR y movimientos motivados.
3. PROMPT HIPERREALISTA ULTRA DEFINICIÓN: Genera "hyperRealisticPrompt" en inglés describiendo con precisión fotográfica absoluta el estilo visual de la secuencia adaptado a la resolución objetivo (720p, 1080p, 2K o 4K), especificando cámara, lente, apertura, iluminación en Kelvin, atmósfera volumétrica, textura de piel/vestuario/escenografía y colorimetría.
4. TODOS LOS PLANOS NECESARIOS: En "shotList", genera todos los planos necesarios (mínimo 6 planos detallados) para cubrir cada beat dramático con encuadre, óptica, movimiento y duración realista.
5. VOCES EN OFF REALISTAS: En "voiceOverTracks", genera líneas de voz en off cinematográficas realistas (narrador o monólogo interior del personaje) con dirección vocal actoral ("deliveryDirection"), pista temporal ("timecodeHint") y selección de timbre ("voicePreset": Charon, Kore, Fenrir, Puck o Zephyr).
6. ILUMINACIÓN, DOLBY ATMOS Y GUION: Define fuentes principales, temperaturas Kelvin exactas, paleta hexadecimal, capas Dolby Atmos, subgraves en Hz, foley, silencios, score con BPM y guion profesional completo en español.
7. STORYBOARD PROMPTS: Para cada tarjeta de storyboard, escribe el prompt visual hiperrealista detallado en inglés (adaptado a la ultra definición solicitada) y el prompt de movimiento de cámara en inglés.
8. AUTOAPRENDIZAJE CONTINUO: Aplica activamente las lecciones acumuladas por el estudio que recibes en el contexto para mejorar tu criterio en cada nueva producción.`;

function buildEffectiveProducerInstruction(lessons: LearningLesson[]): string {
  const adminProfile = ensureAdminAgentProfile();
  const adminBlock = buildAdminTrainingPromptBlock(adminProfile);
  const learningBlock = buildLearningPromptContext(lessons, 8);
  return `${PRODUCER_SYSTEM_INSTRUCTION}

--- DIRECTIVAS DE ENTRENAMIENTO DEL ADMINISTRADOR ---
${adminBlock}

--- MEMORIA ACTIVA DE AUTOAPRENDIZAJE ---
${learningBlock}`;
}

const PRODUCTION_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    cameraSystem: { type: Type.STRING },
    lensPackage: { type: Type.STRING },
    filmStockOrLut: { type: Type.STRING },
    logline: { type: Type.STRING },
    directorVision: { type: Type.STRING },
    hyperRealisticPrompt: { type: Type.STRING },
    colorPalette: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          hex: { type: Type.STRING },
          role: { type: Type.STRING },
        },
        required: ['name', 'hex', 'role'],
      },
    },
    lighting: {
      type: Type.OBJECT,
      properties: {
        keyLight: { type: Type.STRING },
        fillRatio: { type: Type.STRING },
        rimAndBacklight: { type: Type.STRING },
        colorTemperatureKelvin: { type: Type.STRING },
        atmosphereAndHaze: { type: Type.STRING },
      },
      required: [
        'keyLight',
        'fillRatio',
        'rimAndBacklight',
        'colorTemperatureKelvin',
        'atmosphereAndHaze',
      ],
    },
    shotList: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          shotNumber: { type: Type.STRING },
          shotType: { type: Type.STRING },
          lensMm: { type: Type.STRING },
          movement: { type: Type.STRING },
          durationSec: { type: Type.NUMBER },
          framingNote: { type: Type.STRING },
          psychologicalIntent: { type: Type.STRING },
        },
        required: [
          'shotNumber',
          'shotType',
          'lensMm',
          'movement',
          'durationSec',
          'framingNote',
          'psychologicalIntent',
        ],
      },
    },
    soundDesign: {
      type: Type.OBJECT,
      properties: {
        atmosLayers: { type: Type.ARRAY, items: { type: Type.STRING } },
        subBassCue: { type: Type.STRING },
        foleyDetails: { type: Type.ARRAY, items: { type: Type.STRING } },
        silenceBeats: { type: Type.STRING },
        musicalScore: { type: Type.STRING },
        tempoBpm: { type: Type.NUMBER },
      },
      required: [
        'atmosLayers',
        'subBassCue',
        'foleyDetails',
        'silenceBeats',
        'musicalScore',
        'tempoBpm',
      ],
    },
    voiceOverTracks: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          characterOrNarrator: { type: Type.STRING },
          voicePersona: { type: Type.STRING },
          voicePreset: { type: Type.STRING },
          deliveryDirection: { type: Type.STRING },
          timecodeHint: { type: Type.STRING },
          text: { type: Type.STRING },
        },
        required: [
          'characterOrNarrator',
          'voicePersona',
          'voicePreset',
          'deliveryDirection',
          'timecodeHint',
          'text',
        ],
      },
    },
    audioAnalysis: AUDIO_ANALYSIS_SCHEMA,
    vfx: {
      type: Type.OBJECT,
      properties: {
        cgiElements: { type: Type.ARRAY, items: { type: Type.STRING } },
        practicalSfx: { type: Type.ARRAY, items: { type: Type.STRING } },
        locationsAndSets: { type: Type.STRING },
        wardrobeAndMakeup: { type: Type.STRING },
      },
      required: ['cgiElements', 'practicalSfx', 'locationsAndSets', 'wardrobeAndMakeup'],
    },
    screenplay: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          sceneNumber: { type: Type.STRING },
          slugline: { type: Type.STRING },
          timeOfDay: { type: Type.STRING },
          beats: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                type: { type: Type.STRING },
                character: { type: Type.STRING },
                parenthetical: { type: Type.STRING },
                text: { type: Type.STRING },
              },
              required: ['type', 'text'],
            },
          },
        },
        required: ['sceneNumber', 'slugline', 'timeOfDay', 'beats'],
      },
    },
    storyboardFrames: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          shotRef: { type: Type.STRING },
          cameraSpec: { type: Type.STRING },
          visualPrompt: { type: Type.STRING },
          veoMotionPrompt: { type: Type.STRING },
        },
        required: ['title', 'shotRef', 'cameraSpec', 'visualPrompt', 'veoMotionPrompt'],
      },
    },
    continuitySummary: { type: Type.STRING },
  },
  required: [
    'cameraSystem',
    'lensPackage',
    'filmStockOrLut',
    'logline',
    'directorVision',
    'hyperRealisticPrompt',
    'colorPalette',
    'lighting',
    'shotList',
    'soundDesign',
    'voiceOverTracks',
    'vfx',
    'screenplay',
    'storyboardFrames',
    'continuitySummary',
  ],
};

const CHAPTER_PLAN_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    chapters: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          index: { type: Type.INTEGER },
          title: { type: Type.STRING },
          summary: { type: Type.STRING },
          keyCharacters: { type: Type.ARRAY, items: { type: Type.STRING } },
          estimatedStartHint: { type: Type.STRING },
          sourceExcerpt: { type: Type.STRING },
        },
        required: [
          'index',
          'title',
          'summary',
          'keyCharacters',
          'estimatedStartHint',
          'sourceExcerpt',
        ],
      },
    },
  },
  required: ['chapters'],
};

const TRAILER_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    title: { type: Type.STRING },
    tagline: { type: Type.STRING },
    voiceDirection: { type: Type.STRING },
    voiceOverScript: { type: Type.STRING },
    musicPrompt: { type: Type.STRING },
    tempoBpm: { type: Type.NUMBER },
    soundMixNotes: { type: Type.STRING },
    beats: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          durationSec: { type: Type.NUMBER },
          sourceSequenceId: { type: Type.STRING },
          sourceSequenceTitle: { type: Type.STRING },
          visualDescription: { type: Type.STRING },
          hyperRealisticPrompt: { type: Type.STRING },
          motionPrompt: { type: Type.STRING },
          voiceOverLine: { type: Type.STRING },
          onScreenTitleCard: { type: Type.STRING },
          sfxCue: { type: Type.STRING },
          editingTransition: { type: Type.STRING },
        },
        required: [
          'durationSec',
          'sourceSequenceId',
          'sourceSequenceTitle',
          'visualDescription',
          'hyperRealisticPrompt',
          'motionPrompt',
          'voiceOverLine',
          'onScreenTitleCard',
          'sfxCue',
          'editingTransition',
        ],
      },
    },
  },
  required: [
    'title',
    'tagline',
    'voiceDirection',
    'voiceOverScript',
    'musicPrompt',
    'tempoBpm',
    'soundMixNotes',
    'beats',
  ],
};

const STORYBOARD_4_FRAMES_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    frames: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          shotRef: { type: Type.STRING },
          cameraSpec: { type: Type.STRING },
          visualPrompt: { type: Type.STRING },
          veoMotionPrompt: { type: Type.STRING },
        },
        required: ['title', 'shotRef', 'cameraSpec', 'visualPrompt', 'veoMotionPrompt'],
      },
    },
  },
  required: ['frames'],
};

const AGENT_DIAGNOSTIC_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    coherenceScore: { type: Type.NUMBER },
    summary: { type: Type.STRING },
    strengths: { type: Type.ARRAY, items: { type: Type.STRING } },
    weaknesses: { type: Type.ARRAY, items: { type: Type.STRING } },
    continuityRisks: { type: Type.ARRAY, items: { type: Type.STRING } },
    recommendedLessons: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          category: { type: Type.STRING },
          insight: { type: Type.STRING },
          rating: { type: Type.NUMBER },
        },
        required: ['category', 'insight', 'rating'],
      },
    },
  },
  required: [
    'coherenceScore',
    'summary',
    'strengths',
    'weaknesses',
    'continuityRisks',
    'recommendedLessons',
  ],
};

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '4mb' }));

  // Serve per-user project saved assets safely
  app.get('/workspace-assets/:userId/:projectId/:filename', (req, res) => {
    const userId = sanitizeSlug(req.params.userId);
    const projectId = sanitizeSlug(req.params.projectId);
    const filename = sanitizeSlug(req.params.filename);
    const filePath = path.join(getProjectAssetsDir(userId, projectId), filename);
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: 'Asset no encontrado.' });
      return;
    }
    res.sendFile(filePath);
  });

  app.get('/api/health', (_req, res) => {
    const apiKey = process.env.GEMINI_API_KEY;
    const geminiConfigured = Boolean(apiKey && apiKey !== 'MY_GEMINI_API_KEY');
    res.json({ ok: true, geminiConfigured });
  });

  // Admin Profile Login & Agent Inspection / Training Console Endpoints
  app.post('/api/admin/login', (req, res) => {
    const rawEmail = typeof req.body?.email === 'string' ? req.body.email.trim() : '';
    const rawName = typeof req.body?.displayName === 'string' ? req.body.displayName.trim() : '';
    const adminUid = 'admin-studio';
    ensureWorkspaceProjects(adminUid);
    ensureLearningMemory(adminUid);
    ensureAdminAgentProfile();

    res.json({
      session: {
        uid: adminUid,
        displayName: rawName || 'Administrador AUTEUR',
        email: rawEmail || 'compuappscolombia@gmail.com',
        role: 'admin',
        emailVerified: true,
      },
    });
  });

  app.post('/api/admin/seed-audit-project', (req, res) => {
    const userId = getRequestUserId(req);
    const existing = ensureWorkspaceProjects(userId);
    const fixture = buildLocalPreviewFixture()[0];
    const alreadyExists = existing.some((p) => p.id === fixture.id);
    const projectToWrite: ProductionProject = alreadyExists
      ? existing.find((p) => p.id === fixture.id)!
      : {
          ...fixture,
          updatedAt: new Date().toISOString(),
        };
    writeProjectFolder(userId, projectToWrite);
    const updatedList = ensureWorkspaceProjects(userId);
    res.json({ project: projectToWrite, projects: updatedList });
  });

  app.get('/api/admin/agent-profile', (req, res) => {
    const userId = getRequestUserId(req);
    const profile = ensureAdminAgentProfile();
    const lessons = ensureLearningMemory(userId);
    res.json({
      profile,
      baseSystemInstruction: PRODUCER_SYSTEM_INSTRUCTION,
      effectiveSystemInstruction: buildEffectiveProducerInstruction(lessons),
      learningCount: lessons.length,
      learningPreview: buildLearningPromptContext(lessons, 8),
      activeModels: [
        { role: 'Director / Guionista / Crítico', model: 'gemini-4-hydrogen' },
        { role: 'Storyboard Hiperrealista (720p–4K)', model: 'gemini-nano-banana-2.1' },
        { role: 'Clips en Movimiento', model: 'gemini-omni-1.2-flash' },
        { role: 'Voces en Off Realistas', model: 'gemini-3.8-flash-tts' },
        { role: 'Transcripción de Audio / Dictado', model: 'gemini-3.5-transcribe' },
        { role: 'Música Original Tráiler 30s', model: 'lyria-3-clip-preview' },
      ],
    });
  });

  app.put('/api/admin/agent-profile', (req, res) => {
    const userId = getRequestUserId(req);
    const body = req.body ?? {};
    const customDirectives = String(body.customDirectives || '');
    const check = validateAdminDirective(customDirectives);
    if (!check.valid) {
      res.status(400).json({ error: check.error });
      return;
    }

    const current = ensureAdminAgentProfile();
    const saved = saveAdminAgentProfile({
      ...current,
      strictContinuityMode:
        typeof body.strictContinuityMode === 'boolean'
          ? body.strictContinuityMode
          : current.strictContinuityMode,
      preferredVisualGrammar:
        typeof body.preferredVisualGrammar === 'string' && body.preferredVisualGrammar.trim()
          ? body.preferredVisualGrammar.trim()
          : current.preferredVisualGrammar,
      targetAudienceTone:
        typeof body.targetAudienceTone === 'string' && body.targetAudienceTone.trim()
          ? body.targetAudienceTone.trim()
          : current.targetAudienceTone,
      customDirectives: customDirectives.trim(),
      updatedAt: new Date().toISOString(),
    });
    const lessons = ensureLearningMemory(userId);

    res.json({
      profile: saved,
      effectiveSystemInstruction: buildEffectiveProducerInstruction(lessons),
    });
  });

  app.post('/api/admin/analyze-sequence', async (req, res) => {
    try {
      const userId = getRequestUserId(req);
      const { projectId, sequenceId } = req.body ?? {};
      const pid = String(projectId || '').trim();
      const sid = String(sequenceId || '').trim();

      if (!pid || !sid) {
        res.status(400).json({ error: 'Selecciona un proyecto y una secuencia para auditar.' });
        return;
      }

      const project = readProjectById(userId, pid);
      if (!project) {
        res.status(404).json({ error: 'Proyecto no encontrado.' });
        return;
      }
      const sequence = project.sequences.find((s) => s.id === sid);
      if (!sequence) {
        res.status(404).json({ error: 'Secuencia no encontrada.' });
        return;
      }

      const localMetrics = computeSequenceDiagnostics(project, sequence);
      const ai = getGenAIClient();
      const adminProfile = ensureAdminAgentProfile();
      const lessons = ensureLearningMemory(userId);

      const screenplayExcerpt = (sequence.screenplay || [])
        .map(
          (sc) =>
            `${sc.sceneNumber}. ${sc.slugline}\n` +
            sc.beats
              .slice(0, 8)
              .map((b) => `  [${b.type}] ${b.character ? `${b.character}: ` : ''}${b.text}`)
              .join('\n')
        )
        .join('\n\n')
        .slice(0, 3500);

      const shotsSummary = (sequence.shotList || [])
        .slice(0, 10)
        .map((sh) => `${sh.shotNumber} ${sh.shotType} (${sh.lensMm}, ${sh.movement}): ${sh.framingNote}`)
        .join('\n');

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: `Eres el Supervisor Jefe de Calidad y Entrenador del Agente Director en AUTEUR Studio.
Audita en profundidad la siguiente secuencia cinematográfica contra su Biblia de Continuidad y las directivas vigentes del Administrador.

PROYECTO: ${project.title} (${project.genreStyle})
SECUENCIA: ${sequence.title} (${sequence.versionStatus})
CÁMARA Y ÓPTICA: ${sequence.cameraSystem} · ${sequence.lensPackage} · ${sequence.aspectRatio}
ILUMINACIÓN KELVIN: ${sequence.lighting?.colorTemperatureKelvin || 'No especificada'}
PROMPT HIPERREALISTA ACTUAL: ${sequence.hyperRealisticPrompt || 'No definido'}

BIBLIA DE CONTINUIDAD:
${project.continuityBible || '[Vacía]'}

LISTA DE PLANOS:
${shotsSummary || '[Sin planos]'}

GUION TÉCNICO:
${screenplayExcerpt || '[Sin guion]'}

DIRECTIVAS ACTUALES DEL ADMINISTRADOR:
${buildAdminTrainingPromptBlock(adminProfile)}

MEMORIA ACTUAL DEL AGENTE:
${buildLearningPromptContext(lessons, 6)}

Evalúa con rigor técnico de Hollywood:
1. coherenceScore (0-100): puntuación real de coherencia entre Biblia, guion, planos y prompts visuales.
2. summary: diagnóstico ejecutivo claro (2-3 frases).
3. strengths: 2 a 4 aciertos técnicos concretos.
4. weaknesses: 2 a 4 áreas mejorables del Agente Director en esta secuencia.
5. continuityRisks: riesgos específicos de continuidad visual, vestuario, iluminación Kelvin o diálogo.
6. recommendedLessons: 2 a 3 reglas accionables ("category": camera|lighting|sound|screenplay|pacing|continuity, "insight": texto concreto, "rating": 4 o 5) listas para enseñar al agente.`,
        config: {
          responseMimeType: 'application/json',
          responseSchema: AGENT_DIAGNOSTIC_SCHEMA,
          thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
        },
      });

      const raw = (response.text ?? '').trim();
      if (!raw) {
        throw new Error('El auditor del agente no devolvió diagnóstico.');
      }
      const parsed = JSON.parse(raw) as Omit<AgentDiagnosticReport, 'localMetrics' | 'auditedAt'>;
      const validCategories: LearningCategory[] = [
        'camera',
        'lighting',
        'sound',
        'screenplay',
        'pacing',
        'continuity',
      ];

      const report: AgentDiagnosticReport = {
        coherenceScore: Math.max(0, Math.min(100, Math.round(Number(parsed.coherenceScore) || localMetrics.readinessScore))),
        summary: parsed.summary || 'Auditoría completada.',
        strengths: Array.isArray(parsed.strengths) ? parsed.strengths : [],
        weaknesses: Array.isArray(parsed.weaknesses) ? parsed.weaknesses : [],
        continuityRisks: Array.isArray(parsed.continuityRisks) ? parsed.continuityRisks : [],
        recommendedLessons: Array.isArray(parsed.recommendedLessons)
          ? parsed.recommendedLessons.map((rec) => ({
              category: validCategories.includes(rec.category) ? rec.category : 'continuity',
              insight: String(rec.insight || '').trim(),
              rating: Math.max(1, Math.min(5, Math.round(Number(rec.rating) || 5))),
            }))
          : [],
        localMetrics,
        auditedAt: new Date().toISOString(),
      };

      res.json({ report });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Error auditando la secuencia.';
      console.error('Error en /api/admin/analyze-sequence:', error);
      res.status(500).json({ error: message });
    }
  });

  // Microphone Dictation Transcription (for Continuity Bible & Story Notes)
  app.post('/api/transcribe-dictation', upload.single('audio'), async (req, res) => {
    try {
      const file = req.file;
      if (!file) {
        res.status(400).json({ error: 'No se recibió audio del micrófono.' });
        return;
      }
      const ai = getGenAIClient();
      const mimeType = file.mimetype || 'audio/webm';
      const response = await ai.models.generateContent({
        model: 'gemini-3.5-transcribe',
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: 'Transcribe con precisión y puntuación natural en español (o en el idioma hablado) este dictado de dirección cinematográfica para añadirlo a la biblia de continuidad o guion. Devuelve únicamente el texto transcrito limpio, sin preámbulos.',
              },
              {
                inlineData: {
                  mimeType,
                  data: file.buffer.toString('base64'),
                },
              },
            ],
          },
        ],
      });
      const transcript = (response.text ?? '').trim();
      if (!transcript) {
        throw new Error('No se detectó voz inteligible en la grabación.');
      }
      res.json({ transcript });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Error transcribiendo el dictado de voz.';
      console.error('Error en /api/transcribe-dictation:', error);
      res.status(500).json({ error: message });
    }
  });

  // Projects CRUD (per-user folder + project.json)
  app.get('/api/projects', (req, res) => {
    const userId = getRequestUserId(req);
    const projects = ensureWorkspaceProjects(userId);
    res.json({ projects });
  });

  app.post('/api/projects', (req, res) => {
    const userId = getRequestUserId(req);
    const { title, genreStyle, defaultSourceType, continuityBible } = req.body ?? {};
    if (!title || typeof title !== 'string' || !title.trim()) {
      res.status(400).json({ error: 'El título del proyecto es obligatorio.' });
      return;
    }
    ensureWorkspaceProjects(userId);
    const now = new Date().toISOString();
    const newProject: ProductionProject = {
      id: `proj-${Date.now().toString(36)}`,
      title: title.trim(),
      genreStyle:
        typeof genreStyle === 'string' && genreStyle.trim()
          ? genreStyle.trim()
          : 'Épica Monumental IMAX',
      defaultSourceType:
        defaultSourceType === 'audiobook' || defaultSourceType === 'story'
          ? defaultSourceType
          : 'book',
      continuityBible: typeof continuityBible === 'string' ? continuityBible.trim() : '',
      assets: [],
      createdAt: now,
      updatedAt: now,
      sequences: [],
    };
    writeProjectFolder(userId, newProject);
    res.status(201).json({ project: newProject });
  });

  app.patch('/api/projects/:id', (req, res) => {
    const userId = getRequestUserId(req);
    const { id } = req.params;
    const { title, genreStyle, continuityBible } = req.body ?? {};
    const existing = readProjectById(userId, id);
    if (!existing) {
      res.status(404).json({ error: 'Proyecto no encontrado.' });
      return;
    }
    const updatedProject: ProductionProject = {
      ...existing,
      title: typeof title === 'string' && title.trim() ? title.trim() : existing.title,
      genreStyle:
        typeof genreStyle === 'string' && genreStyle.trim()
          ? genreStyle.trim()
          : existing.genreStyle,
      continuityBible:
        typeof continuityBible === 'string' ? continuityBible : existing.continuityBible,
      updatedAt: new Date().toISOString(),
    };
    writeProjectFolder(userId, updatedProject);
    res.json({ project: updatedProject });
  });

  app.delete('/api/projects/:id', (req, res) => {
    const userId = getRequestUserId(req);
    const { id } = req.params;
    const dir = getProjectDir(userId, id);
    if (!fs.existsSync(dir)) {
      res.status(404).json({ error: 'Proyecto no encontrado.' });
      return;
    }
    fs.rmSync(dir, { recursive: true, force: true });
    res.json({ ok: true });
  });

  // Finalize a sequence (Draft -> Final Version) + extract automatic self-learning lessons
  app.patch('/api/projects/:id/sequences/:seqId/finalize', (req, res) => {
    const userId = getRequestUserId(req);
    const { id, seqId } = req.params;
    const project = readProjectById(userId, id);
    if (!project) {
      res.status(404).json({ error: 'Proyecto no encontrado.' });
      return;
    }
    const seqIdx = project.sequences.findIndex((s) => s.id === seqId);
    if (seqIdx === -1) {
      res.status(404).json({ error: 'Secuencia no encontrada.' });
      return;
    }

    const currentSeq = project.sequences[seqIdx];
    const finalizedSeq: ProductionSequence = {
      ...currentSeq,
      versionStatus: 'final',
      updatedAt: new Date().toISOString(),
    };

    const updatedSequences = [...project.sequences];
    updatedSequences[seqIdx] = finalizedSeq;
    const updatedProject: ProductionProject = {
      ...project,
      updatedAt: new Date().toISOString(),
      sequences: updatedSequences,
    };
    writeProjectFolder(userId, updatedProject);

    // Extract automatic lessons into self-learning memory if not already final
    let lessons = ensureLearningMemory(userId);
    if (currentSeq.versionStatus !== 'final') {
      const autoLessons = extractAutomaticLessons(project.title, finalizedSeq).map((item, i) => ({
        ...item,
        id: `lesson-auto-${Date.now().toString(36)}-${i}`,
        createdAt: new Date().toISOString(),
      }));
      lessons = [...autoLessons, ...lessons];
      saveLearningMemory(userId, lessons);
    }

    res.json({
      project: updatedProject,
      sequence: finalizedSeq,
      lessons,
    });
  });

  // Studio Intelligence: Rate a sequence's camera, lighting & soundscape outcomes (1-5)
  app.patch('/api/projects/:id/sequences/:seqId/rate', (req, res) => {
    const userId = getRequestUserId(req);
    const { id, seqId } = req.params;
    const rating = Number(req.body?.rating);
    const note = typeof req.body?.note === 'string' ? req.body.note.trim() : '';

    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      res.status(400).json({ error: 'La valoración debe ser un entero entre 1 y 5.' });
      return;
    }

    const project = readProjectById(userId, id);
    if (!project) {
      res.status(404).json({ error: 'Proyecto no encontrado.' });
      return;
    }
    const seqIdx = project.sequences.findIndex((s) => s.id === seqId);
    if (seqIdx === -1) {
      res.status(404).json({ error: 'Secuencia no encontrada.' });
      return;
    }

    const currentSeq = project.sequences[seqIdx];
    const ratedSeq: ProductionSequence = {
      ...currentSeq,
      sequenceRating: rating,
      updatedAt: new Date().toISOString(),
    };
    const updatedSequences = [...project.sequences];
    updatedSequences[seqIdx] = ratedSeq;
    const updatedProject: ProductionProject = {
      ...project,
      updatedAt: new Date().toISOString(),
      sequences: updatedSequences,
    };
    writeProjectFolder(userId, updatedProject);

    let lessons = ensureLearningMemory(userId);
    if (rating >= 4) {
      const extracted = buildRatedChoiceLessons({
        projectTitle: project.title,
        sequence: ratedSeq,
        rating,
        note,
      }).map((item, idx) => ({
        ...item,
        id: `lesson-rate-${Date.now().toString(36)}-${idx}`,
        createdAt: new Date().toISOString(),
      }));
      lessons = [...extracted, ...lessons];
      saveLearningMemory(userId, lessons);
    }

    res.json({
      project: updatedProject,
      sequence: ratedSeq,
      lessons,
    });
  });

  // Nano Image Generation (gemini-nano-banana-2.1 / gemini-3.1-flash-lite-image, 720p-4K)
  app.post('/api/generate-image', async (req, res) => {
    try {
      const userId = getRequestUserId(req);
      const {
        projectId,
        sequenceId,
        frameId,
        trailerBeatId,
        prompt,
        aspectRatio,
        quality,
        resolution,
      } = req.body ?? {};
      const pid = String(projectId || '').trim();
      const sid = String(sequenceId || '').trim();
      const fid = String(frameId || '').trim();
      const tbid = String(trailerBeatId || '').trim();
      const visualPrompt = String(prompt || '').trim();
      const targetRes = normalizeResolution(
        typeof resolution === 'string' ? resolution : '4K'
      );

      if (!pid || !visualPrompt) {
        res.status(400).json({ error: 'Se requiere el proyecto y el prompt visual.' });
        return;
      }

      let project = readProjectById(userId, pid);
      if (!project) {
        res.status(404).json({ error: 'Proyecto no encontrado.' });
        return;
      }

      const ai = getGenAIClient();
      const modelName =
        quality === 'lite' ? 'gemini-3.1-flash-lite-image' : 'gemini-nano-banana-2.1';
      const nanoRatio = normalizeNanoAspectRatio(String(aspectRatio || '16:9'));
      const imageSize = getNanoImageSizeForResolution(targetRes);
      const resolutionSpec = buildHyperRealisticResolutionSpec(targetRes);

      const response = await ai.models.generateContent({
        model: modelName,
        contents: {
          parts: [
            {
              text: `${visualPrompt}\n\n${resolutionSpec}`,
            },
          ],
        },
        config: {
          imageConfig: {
            aspectRatio: nanoRatio,
            ...(modelName === 'gemini-nano-banana-2.1' ? { imageSize } : {}),
          },
        },
      });

      let imageBase64 = '';
      let mimeType = 'image/png';
      for (const part of response.candidates?.[0]?.content?.parts ?? []) {
        if (part.inlineData?.data) {
          imageBase64 = part.inlineData.data;
          mimeType = part.inlineData.mimeType || 'image/png';
          break;
        }
      }

      if (!imageBase64) {
        throw new Error('Nano no devolvió ninguna imagen en la respuesta.');
      }

      const ext = mimeType.includes('jpeg') || mimeType.includes('jpg') ? '.jpg' : '.png';
      const buffer = Buffer.from(imageBase64, 'base64');
      const saved = saveGeneratedAssetBuffer(userId, project, {
        baseName: `nano-${tbid || fid || 'frame'}-${targetRes}`,
        ext,
        mimeType,
        buffer,
        kind: 'image',
      });
      project = saved.updatedProject;

      // Update sequence storyboard frame imageUrl in project.json
      if (sid && fid) {
        const seqIdx = project.sequences.findIndex((s) => s.id === sid);
        if (seqIdx !== -1) {
          const seq = project.sequences[seqIdx];
          const updatedFrames = seq.storyboardFrames.map((fr) =>
            fr.id === fid ? { ...fr, imageUrl: saved.asset.url } : fr
          );
          project = {
            ...project,
            sequences: project.sequences.map((s, idx) =>
              idx === seqIdx
                ? { ...s, storyboardFrames: updatedFrames, updatedAt: new Date().toISOString() }
                : s
            ),
          };
          writeProjectFolder(userId, project);
        }
      } else if (tbid && project.trailer) {
        project = {
          ...project,
          trailer: {
            ...project.trailer,
            beats: project.trailer.beats.map((b) =>
              b.id === tbid ? { ...b, imageUrl: saved.asset.url } : b
            ),
          },
          updatedAt: new Date().toISOString(),
        };
        writeProjectFolder(userId, project);
      }

      res.json({
        imageUrl: saved.asset.url,
        model: modelName,
        resolution: targetRes,
        project,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Error generando la imagen con Nano.';
      console.error('Error en /api/generate-image:', error);
      res.status(500).json({ error: message });
    }
  });

  // Omni Flash Video Generation (gemini-omni-1.2-flash via Interactions API)
  app.post('/api/generate-video', async (req, res) => {
    try {
      const userId = getRequestUserId(req);
      const {
        projectId,
        sequenceId,
        frameId,
        trailerBeatId,
        prompt,
        aspectRatio,
        duration,
        imageUrl,
      } = req.body ?? {};
      const pid = String(projectId || '').trim();
      const sid = String(sequenceId || '').trim();
      const fid = String(frameId || '').trim();
      const tbid = String(trailerBeatId || '').trim();
      const motionPrompt = String(prompt || '').trim();

      if (!pid || !motionPrompt) {
        res.status(400).json({ error: 'Se requiere el proyecto y el prompt de movimiento.' });
        return;
      }

      let project = readProjectById(userId, pid);
      if (!project) {
        res.status(404).json({ error: 'Proyecto no encontrado.' });
        return;
      }

      const ai = getGenAIClient();
      const omniRatio = normalizeOmniAspectRatio(String(aspectRatio || '16:9'));
      const videoDuration =
        typeof duration === 'string' && /^(3|4|5|6|7|8|9|10)s$/.test(duration)
          ? duration
          : '6s';

      const sourceImage = resolveLocalImageBase64(
        typeof imageUrl === 'string' ? imageUrl : undefined
      );

      const inputPayload = sourceImage
        ? [
            {
              type: 'image' as const,
              mime_type: sourceImage.mimeType,
              data: sourceImage.data,
            },
            {
              type: 'text' as const,
              text: motionPrompt,
            },
          ]
        : motionPrompt;

      const interaction = await ai.interactions.create(
        {
          model: 'gemini-omni-1.2-flash',
          input: inputPayload,
          background: false,
          store: false,
          stream: false,
          response_format: {
            type: 'video',
            aspect_ratio: omniRatio,
            duration: videoDuration,
            resolution: '720p',
          },
        },
        { timeout: 300000 }
      );

      const videoPart = interaction.output_video;
      if (!videoPart || (!videoPart.data && !videoPart.uri)) {
        throw new Error('Omni Flash no devolvió un archivo de video válido.');
      }

      let videoBuffer: Buffer;
      let mimeType = videoPart.mime_type || 'video/mp4';

      if (videoPart.data) {
        videoBuffer = Buffer.from(videoPart.data, 'base64');
      } else if (videoPart.uri) {
        const fetched = await fetch(videoPart.uri);
        if (!fetched.ok) {
          throw new Error('No se pudo descargar el video generado por Omni Flash.');
        }
        mimeType = fetched.headers.get('content-type') || mimeType;
        videoBuffer = Buffer.from(await fetched.arrayBuffer());
      } else {
        throw new Error('Respuesta de video vacía.');
      }

      const saved = saveGeneratedAssetBuffer(userId, project, {
        baseName: `omniflash-${tbid || fid || 'clip'}`,
        ext: '.mp4',
        mimeType,
        buffer: videoBuffer,
        kind: 'video',
      });
      project = saved.updatedProject;

      if (sid && fid) {
        const seqIdx = project.sequences.findIndex((s) => s.id === sid);
        if (seqIdx !== -1) {
          const seq = project.sequences[seqIdx];
          const updatedFrames = seq.storyboardFrames.map((fr) =>
            fr.id === fid ? { ...fr, videoUrl: saved.asset.url } : fr
          );
          project = {
            ...project,
            sequences: project.sequences.map((s, idx) =>
              idx === seqIdx
                ? { ...s, storyboardFrames: updatedFrames, updatedAt: new Date().toISOString() }
                : s
            ),
          };
          writeProjectFolder(userId, project);
        }
      } else if (tbid && project.trailer) {
        project = {
          ...project,
          trailer: {
            ...project.trailer,
            beats: project.trailer.beats.map((b) =>
              b.id === tbid ? { ...b, videoUrl: saved.asset.url } : b
            ),
          },
          updatedAt: new Date().toISOString(),
        };
        writeProjectFolder(userId, project);
      }

      res.json({
        videoUrl: saved.asset.url,
        model: 'gemini-omni-1.2-flash',
        project,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Error generando el video con Omni Flash.';
      console.error('Error en /api/generate-video:', error);
      res.status(500).json({ error: message });
    }
  });

  // Self-Learning Memory Endpoints
  app.get('/api/learning', (req, res) => {
    const userId = getRequestUserId(req);
    const lessons = ensureLearningMemory(userId);
    res.json({ lessons });
  });

  app.post('/api/learning', (req, res) => {
    const userId = getRequestUserId(req);
    const { category, insight, rating, sourceProjectTitle } = req.body ?? {};
    const validCategories: LearningCategory[] = [
      'camera',
      'lighting',
      'sound',
      'screenplay',
      'pacing',
      'continuity',
    ];
    const check = validateLessonInput({
      insight: String(insight || ''),
      rating: Number(rating),
    });
    if (!check.valid) {
      res.status(400).json({ error: check.error });
      return;
    }

    const lessons = ensureLearningMemory(userId);
    const newLesson: LearningLesson = {
      id: `lesson-${Date.now().toString(36)}`,
      category: validCategories.includes(category) ? category : 'camera',
      insight: String(insight).trim(),
      rating: Number(rating),
      sourceProjectTitle: String(sourceProjectTitle || 'AUTEUR Studio').trim(),
      createdAt: new Date().toISOString(),
    };
    const updated = [newLesson, ...lessons];
    saveLearningMemory(userId, updated);
    res.status(201).json({ lesson: newLesson, lessons: updated });
  });

  app.delete('/api/learning/:id', (req, res) => {
    const userId = getRequestUserId(req);
    const { id } = req.params;
    const lessons = ensureLearningMemory(userId);
    const filtered = lessons.filter((l) => l.id !== id);
    if (filtered.length === lessons.length) {
      res.status(404).json({ error: 'Lección no encontrada.' });
      return;
    }
    saveLearningMemory(userId, filtered);
    res.json({ ok: true, lessons: filtered });
  });

  // Standalone Audio Analysis & Transcription endpoint
  app.post('/api/analyze-audio', upload.single('audioFile'), async (req, res) => {
    try {
      const userId = getRequestUserId(req);
      const file = req.file;
      const projectId = String(req.body?.projectId || '').trim();
      if (!file) {
        res.status(400).json({ error: 'Adjunta un archivo de audio MP3, WAV, M4A u OGG.' });
        return;
      }
      if (!isAudioFilename(file.originalname)) {
        res.status(400).json({
          error: 'Formato de audio no compatible. Usa MP3, WAV, M4A, OGG, AAC, FLAC o WEBM.',
        });
        return;
      }

      let activeProject = projectId ? readProjectById(userId, projectId) : null;
      if (activeProject) {
        const saved = saveUploadedAsset(userId, activeProject, file);
        activeProject = saved.updatedProject;
      }

      const ai = getGenAIClient();
      const mimeType = inferMimeType(file.originalname, file.mimetype);
      const verbatimTranscript = await transcribeAudioWithGemini(ai, file.buffer, mimeType);
      const lessons = ensureLearningMemory(userId);
      const learningContext = buildLearningPromptContext(lessons, 6);

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: {
          parts: [
            {
              inlineData: {
                mimeType,
                data: file.buffer.toString('base64'),
              },
            },
            {
              text: `Analiza este archivo de audio cinematográfico (${file.originalname}).
TRANSCRIPCIÓN BASE DETECTADA:
${verbatimTranscript || '[Extrae la transcripción verbatim escuchando directamente el audio.]'}

MEMORIA DE AUTOAPRENDIZAJE DEL ESTUDIO:
${learningContext}

Genera un informe profesional en español que capture:
1) transcription: transcripción fiel y completa del audio.
2) narrationStyle: cadencia vocal, dicción, timbre, proximidad al micrófono e intención actoral.
3) emotionalArc: evolución emocional y subtexto dramático de principio a fin.
4) rhythmAndPacing: estructura rítmica, pausas, aceleraciones y cortes recomendados para montaje.
5) detectedSoundEffects: lista detallada de efectos sonoros, ambientes o ruidos reales detectados o sugeridos.
6) directingRecommendations: indicaciones concretas de cámara, luz y mezcla Dolby Atmos basadas en la escucha.`,
            },
          ],
        },
        config: {
          systemInstruction: PRODUCER_SYSTEM_INSTRUCTION,
          responseMimeType: 'application/json',
          responseSchema: AUDIO_ANALYSIS_SCHEMA,
          thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
        },
      });

      const raw = (response.text ?? '').trim();
      if (!raw) throw new Error('No se recibió análisis de audio del modelo.');
      const report = JSON.parse(raw) as AudioAnalysisReport;
      if (!report.transcription && verbatimTranscript) {
        report.transcription = verbatimTranscript;
      }

      res.json({ report, project: activeProject });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Error analizando el archivo de audio.';
      console.error('Error en /api/analyze-audio:', error);
      res.status(500).json({ error: message });
    }
  });

  // Analyze Book (PDF/TXT) or Audiobook into Sequential Chapters (1 by 1)
  app.post('/api/analyze-chapters', upload.single('sourceFile'), async (req, res) => {
    try {
      const userId = getRequestUserId(req);
      const body = req.body ?? {};
      const projectId = String(body.projectId || '').trim();
      const sourceType = (String(body.sourceType || 'book').trim() || 'book') as SourceMaterialType;
      let sourceText = String(body.sourceText || '').trim();
      const file = req.file;

      if (!projectId) {
        res.status(400).json({ error: 'Falta el identificador del proyecto.' });
        return;
      }

      let project = readProjectById(userId, projectId);
      if (!project) {
        res.status(404).json({ error: 'Proyecto no encontrado.' });
        return;
      }

      if (!file && sourceText.length < 40) {
        res.status(400).json({
          error: 'Adjunta un libro (PDF/TXT) o archivo de audio, o pega el texto completo para extraer sus capítulos en orden.',
        });
        return;
      }

      const ai = getGenAIClient();
      const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];
      let sourceAssetId: string | undefined;
      let sourceFilename = 'Manuscrito escrito';

      if (file) {
        sourceFilename = file.originalname;
        const saved = saveUploadedAsset(userId, project, file);
        project = saved.updatedProject;
        sourceAssetId = saved.asset.id;

        const ext = path.extname(file.originalname).toLowerCase();
        if (ext === '.txt' || ext === '.md' || ext === '.fountain') {
          const decoded = file.buffer.toString('utf-8');
          sourceText = sourceText ? `${sourceText}\n\n${decoded}` : decoded;
        } else {
          const mimeType = inferMimeType(file.originalname, file.mimetype);
          parts.push({
            inlineData: {
              mimeType,
              data: file.buffer.toString('base64'),
            },
          });
        }
      }

      parts.push({
        text: `Analiza íntegramente este material (${sourceFilename}) y divídelo en capítulos o bloques narrativos en estricto orden cronológico (1, 2, 3...) para producirlos uno a uno como secuencias cinematográficas.
${sourceText ? `\nTEXTO PROPORCIONADO:\n${sourceText.slice(0, 60000)}` : ''}

Devuelve entre 2 y 12 capítulos ordenados cronológicamente (index: 1, 2, 3...), cada uno con:
- index: número entero secuencial empezando en 1
- title: título exacto del capítulo o segmento
- summary: sinopsis fiel y detallada de lo que ocurre en ese capítulo (2-4 frases)
- keyCharacters: personajes principales presentes
- estimatedStartHint: referencia de página, marca temporal o inicio del capítulo
- sourceExcerpt: fragmento o diálogo clave literal/fiel del capítulo para guiar al guionista.`,
      });

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: { parts },
        config: {
          systemInstruction: PRODUCER_SYSTEM_INSTRUCTION,
          responseMimeType: 'application/json',
          responseSchema: CHAPTER_PLAN_SCHEMA,
          thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
        },
      });

      const raw = (response.text ?? '').trim();
      if (!raw) {
        throw new Error('No se pudo extraer la estructura de capítulos.');
      }

      const parsed = JSON.parse(raw) as {
        chapters?: Array<{
          index: number;
          title: string;
          summary: string;
          keyCharacters: string[];
          estimatedStartHint: string;
          sourceExcerpt: string;
        }>;
      };

      const rawList = Array.isArray(parsed.chapters) ? parsed.chapters : [];
      if (rawList.length === 0) {
        throw new Error('El material no contiene capítulos identificables.');
      }

      const chapters: BookChapterItem[] = rawList
        .sort((a, b) => Number(a.index || 0) - Number(b.index || 0))
        .map((ch, idx) => ({
          index: idx + 1,
          title: ch.title || `Capítulo ${idx + 1}`,
          summary: ch.summary || '',
          keyCharacters: Array.isArray(ch.keyCharacters) ? ch.keyCharacters : [],
          estimatedStartHint: ch.estimatedStartHint || `Bloque ${idx + 1}`,
          sourceExcerpt: ch.sourceExcerpt || '',
          status: 'pending',
        }));

      const chapterPlan: ChapterPlan = {
        sourceAssetId,
        sourceFilename,
        sourceType,
        createdAt: new Date().toISOString(),
        chapters,
      };

      const updatedProject: ProductionProject = {
        ...project,
        chapterPlan,
        updatedAt: new Date().toISOString(),
      };
      writeProjectFolder(userId, updatedProject);

      res.json({ project: updatedProject, chapterPlan });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Error analizando los capítulos del material.';
      console.error('Error en /api/analyze-chapters:', error);
      res.status(500).json({ error: message });
    }
  });

  // Full Production Generation (Book, Audio MP3/WAV/M4A/OGG, or Story — supports 1-by-1 chapters & 720p-4K)
  app.post('/api/produce', upload.single('sourceFile'), async (req, res) => {
    try {
      const userId = getRequestUserId(req);
      const body = req.body ?? {};
      const projectId = String(body.projectId || '').trim();
      const sequenceTitle = String(body.sequenceTitle || '').trim();
      const sourceType = (String(body.sourceType || 'book').trim() || 'book') as SourceMaterialType;
      const directorStyle = String(body.directorStyle || 'Épica Monumental IMAX').trim();
      const aspectRatio = String(body.aspectRatio || '2.39:1').trim();
      const targetResolution = normalizeResolution(String(body.targetResolution || '4K'));
      const thinkingDepth = String(body.thinkingDepth || 'standard').trim();
      const continuityBible = String(body.continuityBible || '').trim();
      const sourceAssetId = String(body.sourceAssetId || '').trim();
      const chapterIndexRaw = body.chapterIndex !== undefined ? Number(body.chapterIndex) : undefined;
      const chapterIndex =
        typeof chapterIndexRaw === 'number' && Number.isInteger(chapterIndexRaw) && chapterIndexRaw > 0
          ? chapterIndexRaw
          : undefined;
      const chapterTotalRaw = body.chapterTotal !== undefined ? Number(body.chapterTotal) : undefined;
      const chapterTotal =
        typeof chapterTotalRaw === 'number' && Number.isInteger(chapterTotalRaw) && chapterTotalRaw > 0
          ? chapterTotalRaw
          : undefined;
      const chapterSummary = String(body.chapterSummary || '').trim();
      let sourceText = String(body.sourceText || '').trim();

      if (!projectId) {
        res.status(400).json({ error: 'Falta el identificador del proyecto.' });
        return;
      }
      if (!sequenceTitle) {
        res.status(400).json({ error: 'El título de la secuencia o capítulo es obligatorio.' });
        return;
      }

      let project = readProjectById(userId, projectId);
      if (!project) {
        res.status(404).json({ error: 'Proyecto no encontrado en el estudio.' });
        return;
      }

      const file = req.file;
      const storedAsset =
        !file && sourceAssetId ? resolveProjectAssetBuffer(userId, project, sourceAssetId) : null;

      if (!file && !storedAsset && sourceText.length < 20) {
        res.status(400).json({
          error:
            'Proporciona al menos 20 caracteres del texto fuente o adjunta un archivo PDF, TXT o audio.',
        });
        return;
      }

      const ai = getGenAIClient();
      const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];

      let sourceFilename: string | undefined;
      let isAudioUpload = false;
      let verbatimTranscript = '';

      if (file) {
        sourceFilename = file.originalname;
        const saved = saveUploadedAsset(userId, project, file);
        project = saved.updatedProject;

        const ext = path.extname(file.originalname).toLowerCase();
        if (ext === '.txt' || ext === '.md' || ext === '.fountain') {
          const decodedText = file.buffer.toString('utf-8');
          sourceText = sourceText
            ? `${sourceText}\n\n--- CONTENIDO DEL ARCHIVO (${file.originalname}) ---\n${decodedText}`
            : decodedText;
        } else {
          const mimeType = inferMimeType(file.originalname, file.mimetype);
          isAudioUpload = isAudioFilename(file.originalname);
          if (isAudioUpload) {
            verbatimTranscript = await transcribeAudioWithGemini(ai, file.buffer, mimeType);
          }
          parts.push({
            inlineData: {
              mimeType,
              data: file.buffer.toString('base64'),
            },
          });
        }
      } else if (storedAsset) {
        sourceFilename = storedAsset.asset.filename;
        const ext = path.extname(storedAsset.asset.filename).toLowerCase();
        if (ext === '.txt' || ext === '.md' || ext === '.fountain') {
          const decodedText = storedAsset.buffer.toString('utf-8');
          sourceText = sourceText
            ? `${sourceText}\n\n--- CONTENIDO DEL ARCHIVO (${storedAsset.asset.filename}) ---\n${decodedText}`
            : decodedText;
        } else {
          const mimeType = storedAsset.asset.mimeType;
          isAudioUpload = storedAsset.asset.kind === 'audio';
          if (isAudioUpload) {
            verbatimTranscript = await transcribeAudioWithGemini(ai, storedAsset.buffer, mimeType);
          }
          parts.push({
            inlineData: {
              mimeType,
              data: storedAsset.buffer.toString('base64'),
            },
          });
        }
      }

      const lessons = ensureLearningMemory(userId);
      const learningContext = buildLearningPromptContext(lessons, 8);
      const resolutionSpec = buildHyperRealisticResolutionSpec(targetResolution);

      const audioInstructions = isAudioUpload
        ? `\nMATERIAL DE AUDIO DETECTADO (${sourceFilename}):
Transcripción inicial capturada: ${verbatimTranscript || '[Escucha directamente el audio adjunto]'}
OBLIGATORIO: Completa el bloque "audioAnalysis" en el JSON con: transcription (transcripción completa), narrationStyle, emotionalArc, rhythmAndPacing, detectedSoundEffects y directingRecommendations.`
        : '';

      const chapterDirective = chapterIndex
        ? `\nPRODUCCIÓN SECUENCIAL CAPÍTULO A CAPÍTULO (ORDEN ESTRICTO):
Estás dirigiendo específicamente el Capítulo ${chapterIndex}${chapterTotal ? ` de ${chapterTotal}` : ''}: "${sequenceTitle}".
${chapterSummary ? `Sinopsis del capítulo a adaptar: ${chapterSummary}` : ''}
Extrae e interpreta exclusivamente los acontecimientos, diálogos, escenografía y ritmo de este capítulo manteniendo continuidad exacta con los capítulos anteriores.`
        : '';

      const promptText = `PRODUCCIÓN ACTIVA: ${project.title}
SECUENCIA / CAPÍTULO: ${sequenceTitle}
TIPO DE MATERIAL FUENTE: ${sourceType === 'audiobook' ? 'Audiolibro / Relato Narrado' : sourceType === 'book' ? 'Libro / Manuscrito Literario' : 'Historia Original / Sinopsis'}
ESTILO CINEMATOGRÁFICO OBJETIVO: ${directorStyle}
RELACIÓN DE ASPECTO OBJETIVO: ${aspectRatio}
RESOLUCIÓN Y ULTRA DEFINICIÓN OBJETIVO: ${targetResolution} (${resolutionSpec})
${chapterDirective}

MEMORIA DE AUTOAPRENDIZAJE Y MEJORA DEL ESTUDIO:
${learningContext}

BIBLIA DE CONTINUIDAD DEL PROYECTO:
${continuityBible || project.continuityBible || 'Establecer el estándar visual y sonoro desde cero manteniendo coherencia de Hollywood.'}
${audioInstructions}

MATERIAL FUENTE ESCRITO / NOTAS DEL CLIENTE:
${sourceText || '[El material fuente principal está adjunto como archivo binario PDF o Audio. Procésalo íntegramente.]'}

Genera el expediente completo de dirección en JSON estructurado siguiendo el esquema solicitado:
- "hyperRealisticPrompt": Prompt cinematográfico maestro hiperrealista en inglés calibrado a ultra definición ${targetResolution} con cámara, óptica, escenografía, textura PBR y luz Kelvin.
- "shotList": Todos los planos necesarios (al menos 6 planos detallados) para cubrir completamente la secuencia.
- "voiceOverTracks": Al menos 2 pistas de voz en off realistas (narración y/o monólogo interior) con "voicePreset" elegido entre Charon, Kore, Fenrir, Puck o Zephyr, "deliveryDirection" actoral y "timecodeHint".
- "screenplay": Escenas completas con múltiples beats (action, camera, sound, dialogue).
- "storyboardFrames": Al menos 3 tarjetas con prompts visuales hiperrealistas en inglés calibrados a ${targetResolution}.`;

      parts.push({ text: promptText });

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: { parts },
        config: {
          systemInstruction: buildEffectiveProducerInstruction(lessons),
          responseMimeType: 'application/json',
          responseSchema: PRODUCTION_RESPONSE_SCHEMA,
          thinkingConfig: {
            thinkingLevel:
              thinkingDepth === 'deep' ? ThinkingLevel.HIGH : ThinkingLevel.MEDIUM,
          },
        },
      });

      const rawJson = (response.text ?? '').trim();
      if (!rawJson) {
        throw new Error('El motor cinematográfico devolvió una respuesta vacía.');
      }

      const parsed = JSON.parse(rawJson);

      const audioAnalysis: AudioAnalysisReport | undefined = isAudioUpload
        ? parsed.audioAnalysis || {
            transcription: verbatimTranscript || sourceText,
            narrationStyle: 'Narración expresiva capturada del audio fuente.',
            emotionalArc: 'Progresión dramática analizada en la pista vocal.',
            rhythmAndPacing: 'Cadencia y pausas integradas en el montaje.',
            detectedSoundEffects: [],
            directingRecommendations: parsed.directorVision || '',
          }
        : undefined;

      if (audioAnalysis && !audioAnalysis.transcription && verbatimTranscript) {
        audioAnalysis.transcription = verbatimTranscript;
      }

      const now = new Date().toISOString();
      const seqId = `seq-${Date.now().toString(36)}`;
      const voiceOverTracks: VoiceOverTrack[] = Array.isArray(parsed.voiceOverTracks)
        ? parsed.voiceOverTracks.map((vo: Record<string, string>, idx: number) => ({
            id: `vo-${Date.now().toString(36)}-${idx}`,
            characterOrNarrator: vo.characterOrNarrator || 'Narrador',
            voicePersona: vo.voicePersona || 'Voz cinematográfica realista',
            voicePreset: normalizeVoicePreset(vo.voicePreset),
            deliveryDirection: vo.deliveryDirection || 'Tono contenido, íntimo y cinematográfico',
            timecodeHint: vo.timecodeHint || `00:${String(idx * 12).padStart(2, '0')}`,
            text: vo.text || '',
          }))
        : [];

      const createdSequence: ProductionSequence = {
        id: seqId,
        title: sequenceTitle,
        versionStatus: 'draft',
        sourceType,
        sourceFilename,
        directorStyle,
        aspectRatio,
        targetResolution,
        hyperRealisticPrompt:
          parsed.hyperRealisticPrompt ||
          `${parsed.directorVision || ''}. ${resolutionSpec}`.trim(),
        chapterIndex,
        chapterTotal,
        cameraSystem: parsed.cameraSystem || 'ARRI Alexa 65',
        lensPackage: parsed.lensPackage || 'Cooke Anamorphic /i',
        filmStockOrLut: parsed.filmStockOrLut || 'Kodak 2383 Print LUT',
        logline: parsed.logline || '',
        directorVision: parsed.directorVision || '',
        colorPalette: Array.isArray(parsed.colorPalette) ? parsed.colorPalette : [],
        lighting: parsed.lighting,
        shotList: Array.isArray(parsed.shotList) ? parsed.shotList : [],
        soundDesign: parsed.soundDesign,
        voiceOverTracks,
        audioAnalysis,
        vfx: parsed.vfx,
        screenplay: Array.isArray(parsed.screenplay) ? parsed.screenplay : [],
        storyboardFrames: Array.isArray(parsed.storyboardFrames)
          ? parsed.storyboardFrames.map((frame: Record<string, string>, idx: number) => ({
              id: `sb-${Date.now().toString(36)}-${idx}`,
              title: frame.title || `Fotograma ${idx + 1}`,
              shotRef: frame.shotRef || `Plano 0${idx + 1}`,
              aspectRatio,
              cameraSpec: frame.cameraSpec || parsed.cameraSystem || '65mm IMAX',
              visualPrompt: frame.visualPrompt || '',
              veoMotionPrompt: frame.veoMotionPrompt || '',
            }))
          : [],
        continuitySummary: parsed.continuitySummary || '',
        createdAt: now,
        updatedAt: now,
      };

      const updatedBible = buildContinuationContext(
        continuityBible || project.continuityBible,
        sequenceTitle,
        createdSequence.continuitySummary
      );

      const updatedChapterPlan =
        chapterIndex && project.chapterPlan
          ? markChapterCompleted(project.chapterPlan, chapterIndex, seqId)
          : project.chapterPlan;

      const updatedProject: ProductionProject = {
        ...project,
        continuityBible: updatedBible,
        chapterPlan: updatedChapterPlan,
        updatedAt: now,
        sequences: [createdSequence, ...project.sequences],
      };

      writeProjectFolder(userId, updatedProject);

      res.json({
        project: updatedProject,
        sequence: createdSequence,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Error inesperado al producir la secuencia.';
      console.error('Error en /api/produce:', error);
      res.status(500).json({ error: message });
    }
  });

  // Realistic Voice-Over Generation (gemini-3.8-flash-tts -> WAV)
  app.post('/api/generate-voiceover', async (req, res) => {
    try {
      const userId = getRequestUserId(req);
      const { projectId, sequenceId, trackId, target, text, voicePreset, deliveryDirection } =
        req.body ?? {};
      const pid = String(projectId || '').trim();
      const sid = String(sequenceId || '').trim();
      const tid = String(trackId || '').trim();
      const scriptText = String(text || '').trim();
      const preset = normalizeVoicePreset(
        typeof voicePreset === 'string' ? voicePreset : 'Charon'
      );
      const style = String(
        deliveryDirection || 'Cinematic Hollywood voice-over narration, measured dramatic pacing'
      ).trim();

      if (!pid || !scriptText) {
        res.status(400).json({ error: 'Se requiere el proyecto y el texto de voz en off.' });
        return;
      }

      let project = readProjectById(userId, pid);
      if (!project) {
        res.status(404).json({ error: 'Proyecto no encontrado.' });
        return;
      }

      const ai = getGenAIClient();
      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash-tts',
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: scriptText,
                speechMetadata: {
                  style,
                },
              },
            ],
          },
        ],
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: preset },
            },
          },
        },
      });

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (!base64Audio) {
        throw new Error('El motor de voz en off no devolvió audio WAV.');
      }

      const wavBuffer = Buffer.from(base64Audio, 'base64');
      const saved = saveGeneratedAssetBuffer(userId, project, {
        baseName: `voiceover-${target === 'trailer' ? 'trailer' : tid || 'vo'}`,
        ext: '.wav',
        mimeType: 'audio/wav',
        buffer: wavBuffer,
        kind: 'audio',
      });
      project = saved.updatedProject;

      if (target === 'trailer' && project.trailer) {
        project = {
          ...project,
          trailer: {
            ...project.trailer,
            voiceOverAudioUrl: saved.asset.url,
          },
          updatedAt: new Date().toISOString(),
        };
        writeProjectFolder(userId, project);
      } else if (sid && tid) {
        const seqIdx = project.sequences.findIndex((s) => s.id === sid);
        if (seqIdx !== -1) {
          const seq = project.sequences[seqIdx];
          const nextTracks = (seq.voiceOverTracks || []).map((tr) =>
            tr.id === tid ? { ...tr, audioUrl: saved.asset.url } : tr
          );
          project = {
            ...project,
            sequences: project.sequences.map((s, idx) =>
              idx === seqIdx
                ? { ...s, voiceOverTracks: nextTracks, updatedAt: new Date().toISOString() }
                : s
            ),
            updatedAt: new Date().toISOString(),
          };
          writeProjectFolder(userId, project);
        }
      }

      res.json({
        audioUrl: saved.asset.url,
        project,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Error generando la voz en off realista.';
      console.error('Error en /api/generate-voiceover:', error);
      res.status(500).json({ error: message });
    }
  });

  // 30-Second Cinematic Trailer Generator (based on Continuity Bible + Approved Sequences)
  app.post('/api/generate-trailer', async (req, res) => {
    try {
      const userId = getRequestUserId(req);
      const { projectId, tone, targetResolution, voicePreset } = req.body ?? {};
      const pid = String(projectId || '').trim();
      if (!pid) {
        res.status(400).json({ error: 'Falta el identificador del proyecto.' });
        return;
      }

      const project = readProjectById(userId, pid);
      if (!project) {
        res.status(404).json({ error: 'Proyecto no encontrado.' });
        return;
      }

      const approvedSequences = project.sequences.filter(
        (seq) => seq.versionStatus === 'final'
      );
      if (approvedSequences.length === 0) {
        res.status(400).json({
          error:
            'Debes aprobar al menos una secuencia en Versión Final para generar el tráiler de 30 segundos.',
        });
        return;
      }

      const resolution = normalizeResolution(
        typeof targetResolution === 'string' ? targetResolution : '4K'
      );
      const chosenTone = String(tone || 'Teaser Épico Monumental').trim();
      const chosenVoice = normalizeVoicePreset(
        typeof voicePreset === 'string' ? voicePreset : 'Charon'
      );

      const scenesSummary = approvedSequences
        .map((seq, idx) => {
          const dialogueSample = (seq.screenplay || [])
            .flatMap((sc) => sc.beats)
            .filter((b) => b.type === 'dialogue')
            .slice(0, 3)
            .map((b) => `${b.character || 'PERSONAJE'}: "${b.text}"`)
            .join(' | ');
          return `ESCENA APROBADA ${idx + 1}:
- ID: ${seq.id}
- Título: ${seq.title}
- Cámara / Formato: ${seq.cameraSystem} (${seq.aspectRatio})
- Logline: ${seq.logline}
- Visión: ${seq.directorVision}
- Clima Sonoro: ${seq.soundDesign?.musicalScore || ''} (${seq.soundDesign?.tempoBpm || 80} BPM)
- Diálogos clave: ${dialogueSample || 'Ninguno'}
- Continuidad: ${seq.continuitySummary}`;
        })
        .join('\n\n');

      const ai = getGenAIClient();
      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: `Eres el Agente Director de Tráilers de AUTEUR Studio. Diseña un TRÁILER CINEMATOGRÁFICO OFICIAL DE EXACTAMENTE 30 SEGUNDOS (00:00 a 00:30) para el proyecto "${project.title}" (${project.genreStyle}).

TONO DEL TRÁILER: ${chosenTone}
RESOLUCIÓN MAESTRA OBJETIVO: ${resolution} (${buildHyperRealisticResolutionSpec(resolution)})
VOZ EN OFF PRINCIPAL: ${chosenVoice}

BIBLIA DE CONTINUIDAD OFICIAL DEL PROYECTO:
${project.continuityBible || 'Mantener absoluta fidelidad tonal y estética con las escenas aprobadas.'}

ESCENAS YA APROBADAS (VERSIÓN FINAL):
${scenesSummary}

INSTRUCCIONES DE MONTAJE DE 30 SEGUNDOS:
1. Estructura exactamente 6 cortes ("beats") cuya suma de "durationSec" sea 30 segundos exactos (por ejemplo 5s + 5s + 5s + 5s + 5s + 5s, o crescendo 6s + 5s + 5s + 5s + 5s + 4s).
2. Cada beat debe referenciar el "sourceSequenceId" y "sourceSequenceTitle" de una de las escenas aprobadas.
3. Redacta "hyperRealisticPrompt" y "motionPrompt" en inglés con calidad hiperrealista ${resolution} (cámara, lente, luz Kelvin, escenografía, atmósfera).
4. Redacta un "voiceOverScript" completo en español que dure ~22-26 segundos hablados y coordina las líneas por beat ("voiceOverLine") y rótulos en pantalla ("onScreenTitleCard") junto con "sfxCue" y "editingTransition" (ej. Smash Cut, LFE Boom, Riser).
5. En "musicPrompt", describe en inglés la partitura cinematográfica de 30 segundos para Lyria (tempo, instrumentación, crescendo y clímax en el segundo 24).`,
        config: {
          systemInstruction: buildEffectiveProducerInstruction(ensureLearningMemory(userId)),
          responseMimeType: 'application/json',
          responseSchema: TRAILER_RESPONSE_SCHEMA,
          thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
        },
      });

      const raw = (response.text ?? '').trim();
      if (!raw) {
        throw new Error('El Agente Director no devolvió el diseño del tráiler.');
      }
      const parsed = JSON.parse(raw);

      const normalizedBeats = normalizeTrailerBeats(
        Array.isArray(parsed.beats) ? parsed.beats : [],
        approvedSequences
      );

      const trailer: ProjectTrailer = {
        id: `trailer-${Date.now().toString(36)}`,
        title: parsed.title || `${project.title} — Tráiler Oficial (30s)`,
        tagline: parsed.tagline || 'Muy pronto en cines',
        tone: chosenTone,
        targetResolution: resolution,
        totalDurationSec: 30,
        voicePreset: chosenVoice,
        voiceDirection:
          parsed.voiceDirection || 'Voz cinematográfica profunda con crescendo dramático',
        voiceOverScript: parsed.voiceOverScript || '',
        musicPrompt:
          parsed.musicPrompt ||
          '30-second epic Hollywood trailer orchestral score with sub-bass braams, tense strings ostinato, and dramatic percussion climax at 24s.',
        tempoBpm: Number(parsed.tempoBpm) || 110,
        soundMixNotes: parsed.soundMixNotes || 'Dolby Atmos trailer master con subgraves LFE 28Hz.',
        approvedSequenceIds: approvedSequences.map((s) => s.id),
        beats: normalizedBeats,
        createdAt: new Date().toISOString(),
      };

      const updatedProject: ProductionProject = {
        ...project,
        trailer,
        updatedAt: new Date().toISOString(),
      };
      writeProjectFolder(userId, updatedProject);

      res.json({ trailer, project: updatedProject });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Error generando el tráiler cinematográfico.';
      console.error('Error en /api/generate-trailer:', error);
      res.status(500).json({ error: message });
    }
  });

  // 30-Second Trailer Music Score via Lyria Clip (lyria-3-clip-preview)
  app.post('/api/generate-trailer-music', async (req, res) => {
    try {
      const userId = getRequestUserId(req);
      const { projectId, musicPrompt } = req.body ?? {};
      const pid = String(projectId || '').trim();
      if (!pid) {
        res.status(400).json({ error: 'Falta el identificador del proyecto.' });
        return;
      }

      let project = readProjectById(userId, pid);
      if (!project || !project.trailer) {
        res.status(404).json({ error: 'Genera primero la estructura del tráiler de 30s.' });
        return;
      }

      const prompt = String(musicPrompt || project.trailer.musicPrompt || '').trim();
      if (!prompt) {
        res.status(400).json({ error: 'Se requiere un prompt musical para el tráiler.' });
        return;
      }

      const ai = getGenAIClient();
      const responseStream = await ai.models.generateContentStream({
        model: 'lyria-3-clip-preview',
        contents: prompt,
      });

      const audioChunks: Buffer[] = [];
      let mimeType = 'audio/mpeg';

      for await (const chunk of responseStream) {
        const parts = chunk.candidates?.[0]?.content?.parts;
        if (!parts) continue;
        for (const part of parts) {
          if (part.inlineData?.data) {
            if (audioChunks.length === 0 && part.inlineData.mimeType) {
              mimeType = part.inlineData.mimeType;
            }
            audioChunks.push(Buffer.from(part.inlineData.data, 'base64'));
          }
        }
      }

      if (audioChunks.length === 0) {
        throw new Error('Lyria no devolvió pistas de audio para el tráiler.');
      }

      const audioBuffer = Buffer.concat(audioChunks);
      const ext = mimeType.includes('wav') ? '.wav' : '.mp3';
      const saved = saveGeneratedAssetBuffer(userId, project, {
        baseName: 'trailer-score-30s',
        ext,
        mimeType,
        buffer: audioBuffer,
        kind: 'audio',
      });

      project = {
        ...saved.updatedProject,
        trailer: {
          ...project.trailer,
          musicAudioUrl: saved.asset.url,
        },
        updatedAt: new Date().toISOString(),
      };
      writeProjectFolder(userId, project);

      res.json({ audioUrl: saved.asset.url, project });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Error generando música de 30s con Lyria.';
      console.error('Error en /api/generate-trailer-music:', error);
      res.status(500).json({ error: message });
    }
  });

  // Auto-generate 4 Key Storyboard Frames for the active sequence (Continuity Bible + Screenplay + Nano Render)
  app.post('/api/generate-storyboard-frames', async (req, res) => {
    try {
      const userId = getRequestUserId(req);
      const { projectId, sequenceId, resolution, renderImages } = req.body ?? {};
      const pid = String(projectId || '').trim();
      const sid = String(sequenceId || '').trim();

      if (!pid || !sid) {
        res.status(400).json({ error: 'Se requiere proyecto y secuencia activa.' });
        return;
      }

      let project = readProjectById(userId, pid);
      if (!project) {
        res.status(404).json({ error: 'Proyecto no encontrado.' });
        return;
      }
      const seqIdx = project.sequences.findIndex((s) => s.id === sid);
      if (seqIdx === -1) {
        res.status(404).json({ error: 'Secuencia activa no encontrada.' });
        return;
      }

      const sequence = project.sequences[seqIdx];
      const targetRes = normalizeResolution(
        typeof resolution === 'string' ? resolution : sequence.targetResolution || '4K'
      );
      const resSpec = buildHyperRealisticResolutionSpec(targetRes);
      const lessons = ensureLearningMemory(userId);
      const ai = getGenAIClient();

      const screenplayText = (sequence.screenplay || [])
        .map(
          (sc) =>
            `ESCENA ${sc.sceneNumber}: ${sc.slugline} (${sc.timeOfDay})\n` +
            sc.beats
              .map(
                (b) =>
                  `- [${b.type.toUpperCase()}]${b.character ? ` ${b.character}` : ''}: ${b.text}`
              )
              .join('\n')
        )
        .join('\n\n')
        .slice(0, 6000);

      const shotsSummary = (sequence.shotList || [])
        .map(
          (sh) =>
            `${sh.shotNumber} | ${sh.shotType} | ${sh.lensMm} | ${sh.movement} | ${sh.framingNote}`
        )
        .join('\n');

      const paletteSummary = (sequence.colorPalette || [])
        .map((c) => `${c.name} (${c.hex}: ${c.role})`)
        .join(', ');

      const directorPrompt = `Eres el Agente Director y Director de Fotografía de AUTEUR Studio.
Genera EXACTAMENTE 4 FRAMES DE STORYBOARD CLAVE para la secuencia activa, respetando con fidelidad absoluta la BIBLIA DE CONTINUIDAD y el GUION TÉCNICO.

PROYECTO: ${project.title} (${project.genreStyle})
SECUENCIA ACTIVA: ${sequence.title}
CÁMARA Y ÓPTICA MAESTRA: ${sequence.cameraSystem} · ${sequence.lensPackage} · ${sequence.filmStockOrLut}
RELACIÓN DE ASPECTO: ${sequence.aspectRatio}
RESOLUCIÓN OBJETIVO: ${targetRes} (${resSpec})
PALETA OFICIAL: ${paletteSummary || 'Según biblia de continuidad'}
ILUMINACIÓN KELVIN: ${sequence.lighting?.keyLight || ''} · ${sequence.lighting?.colorTemperatureKelvin || ''} · ${sequence.lighting?.atmosphereAndHaze || ''}

BIBLIA DE CONTINUIDAD DEL PROYECTO:
${project.continuityBible || 'Mantener coherencia estricta de personajes, vestuario, escenografía y colorimetría.'}

LISTA DE PLANOS DE REFERENCIA:
${shotsSummary || 'Planos maestros de la secuencia'}

GUION TÉCNICO COMPLETO DE LA SECUENCIA:
${screenplayText || sequence.directorVision || sequence.logline}

REQUISITOS OBLIGATORIOS PARA LOS 4 FRAMES:
1. Frame 1 (Establecimiento y Atmósfera): abre la secuencia definiendo espacio, luz Kelvin y escala escenográfica.
2. Frame 2 (Desarrollo / Tensión dramática): introduce el conflicto o acción clave del guion técnico.
3. Frame 3 (Clímax emocional o visual): el momento de mayor intensidad de la secuencia.
4. Frame 4 (Punto de giro o cierre): imagen conclusiva con resonancia dramática y continuidad hacia la siguiente escena.
5. Para cada frame incluye:
   - "title": título en español conciso y dramático
   - "shotRef": referencia exacta de plano (ej. "Plano 1A")
   - "cameraSpec": cámara, óptica en mm y apertura
   - "visualPrompt": prompt fotográfico hiperrealista en INGLÉS adaptado a ${targetRes}, describiendo vestuario exacto, rasgos de la Biblia de Continuidad, iluminación en Kelvin, atmósfera y textura PBR (sin texto superpuesto).
   - "veoMotionPrompt": prompt en INGLÉS de movimiento de cámara fluido para Omni Flash.`;

      const dirResponse = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: directorPrompt,
        config: {
          systemInstruction: buildEffectiveProducerInstruction(lessons),
          responseMimeType: 'application/json',
          responseSchema: STORYBOARD_4_FRAMES_SCHEMA,
          thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
        },
      });

      const raw = (dirResponse.text ?? '').trim();
      if (!raw) {
        throw new Error('El Agente Director no devolvió los 4 frames de storyboard.');
      }

      const parsed = JSON.parse(raw) as { frames?: Array<Partial<StoryboardCard>> };
      const normalizedFrames = normalizeFourKeyStoryboardFrames(
        Array.isArray(parsed.frames) ? parsed.frames : [],
        {
          sequence,
          resolution: targetRes,
        }
      );

      const shouldRenderImages = renderImages !== false;
      const nanoRatio = normalizeNanoAspectRatio(sequence.aspectRatio || '16:9');
      const imageSize = getNanoImageSizeForResolution(targetRes);
      const imageWarnings: string[] = [];
      let renderedCount = 0;

      if (shouldRenderImages) {
        const finalFrames: StoryboardCard[] = [];
        for (const frame of normalizedFrames) {
          try {
            const imgRes = await ai.models.generateContent({
              model: 'gemini-nano-banana-2.1',
              contents: {
                parts: [
                  {
                    text: `${frame.visualPrompt}\n\n${resSpec}`,
                  },
                ],
              },
              config: {
                imageConfig: {
                  aspectRatio: nanoRatio,
                  imageSize,
                },
              },
            });

            let imageBase64 = '';
            let mimeType = 'image/png';
            for (const part of imgRes.candidates?.[0]?.content?.parts ?? []) {
              if (part.inlineData?.data) {
                imageBase64 = part.inlineData.data;
                mimeType = part.inlineData.mimeType || 'image/png';
                break;
              }
            }

            if (imageBase64) {
              const ext = mimeType.includes('jpeg') || mimeType.includes('jpg') ? '.jpg' : '.png';
              const buffer = Buffer.from(imageBase64, 'base64');
              const saved = saveGeneratedAssetBuffer(userId, project, {
                baseName: `sb4-${frame.id}-${targetRes}`,
                ext,
                mimeType,
                buffer,
                kind: 'image',
              });
              project = saved.updatedProject;
              renderedCount += 1;
              finalFrames.push({ ...frame, imageUrl: saved.asset.url });
            } else {
              imageWarnings.push(`${frame.title}: Nano no devolvió imagen.`);
              finalFrames.push(frame);
            }
          } catch (imgErr) {
            const msg = imgErr instanceof Error ? imgErr.message : 'Error de renderizado Nano';
            imageWarnings.push(`${frame.title}: ${msg}`);
            finalFrames.push(frame);
          }
        }
        normalizedFrames.splice(0, normalizedFrames.length, ...finalFrames);
      }

      const now = new Date().toISOString();
      const updatedSeq: ProductionSequence = {
        ...sequence,
        targetResolution: targetRes,
        storyboardFrames: normalizedFrames,
        updatedAt: now,
      };
      project = {
        ...project,
        sequences: project.sequences.map((s, idx) => (idx === seqIdx ? updatedSeq : s)),
        updatedAt: now,
      };
      writeProjectFolder(userId, project);

      res.json({
        project,
        sequence: updatedSeq,
        frames: normalizedFrames,
        renderedCount,
        imageWarnings,
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Error auto-generando los 4 frames de storyboard.';
      console.error('Error en /api/generate-storyboard-frames:', error);
      res.status(500).json({ error: message });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'custom',
    });
    app.use(vite.middlewares);

    app.use('*', async (req, res, next) => {
      if (req.originalUrl.startsWith('/api') || req.originalUrl.startsWith('/workspace-assets')) {
        next();
        return;
      }
      try {
        const htmlPath = path.resolve(__dirname, 'index.html');
        let template = fs.readFileSync(htmlPath, 'utf-8');
        template = await vite.transformIndexHtml(req.originalUrl, template);
        res.status(200).set({ 'Content-Type': 'text/html' }).end(template);
      } catch (err) {
        vite.ssrFixStacktrace(err as Error);
        next(err);
      }
    });
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`AUTEUR Studio server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
