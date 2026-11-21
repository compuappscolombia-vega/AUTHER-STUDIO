import 'dotenv/config';
import crypto from 'crypto';
import express from 'express';
import fs from 'fs';
import http from 'http';
import path from 'path';
import multer from 'multer';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import { GoogleGenAI, Modality, ThinkingLevel, Type } from '@google/genai';
import type {
  AgentDiagnosticReport,
  AdminAgentProfile,
  ApiCapability,
  ApiProviderInput,
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
  ScreenplayNote,
  ScreenplayNoteRole,
  SourceMaterialType,
  StoryboardCard,
  VoiceOverTrack,
  VoicePreset,
} from './src/types/studio.ts';
import { buildContinuationContext } from './src/utils/studioLogic.ts';
import {
  buildLearningPromptContext,
  extractAutomaticLessons,
  validateLessonInput,
} from './src/utils/learningEngine.ts';
import { buildRatedChoiceLessons } from './src/utils/studioIntelligence.ts';
import {
  buildHyperRealisticResolutionSpec,
  markChapterCompleted,
  normalizeResolution,
  normalizeTrailerBeats,
} from './src/utils/productionPipeline.ts';
import {
  ProviderConfigurationError,
  deleteUserProvider,
  detectTestAndSaveProvider,
  executeImageGeneration,
  executeVideoGeneration,
  listPublicProviders,
  resolveProviderForCapability,
  saveConnectedFrameoMcpProvider,
} from './src/utils/serverProviderVault.ts';
import {
  DEFAULT_FRAMEO_MCP_URL,
  callFrameoMcpTool,
  completeFrameoOAuthCallback,
  createFrameoOAuthAuthorizationUrl,
  disconnectFrameoMcpSession,
  getFrameoMcpPublicStatus,
  listFrameoMcpTools,
} from './src/utils/frameoMcpClient.ts';
import {
  DEFAULT_ADMIN_AGENT_PROFILE,
  buildAdminTrainingPromptBlock,
  buildFrameoProductionSpecForSequence,
  computeSequenceDiagnostics,
  normalizeAdminAgentProfile,
  normalizeFourKeyStoryboardFrames,
  validateAdminDirective,
} from './src/utils/adminAndStoryboardLogic.ts';
import {
  ADMIN_UID,
  getConfiguredAdminIdentity,
  verifyAdminCredentials,
  verifyFirebaseGoogleIdToken,
} from './src/utils/adminAuth.ts';
import { buildLocalPreviewFixture } from './src/utils/devPreviewFixture.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const WORKSPACE_DIR = path.resolve(__dirname, 'workspace');
const USERS_WORKSPACE_ROOT = path.join(WORKSPACE_DIR, 'users');

const FIREBASE_PROJECT_ID: string = (() => {
  try {
    const raw = fs.readFileSync(path.resolve(__dirname, 'firebase-applet-config.json'), 'utf-8');
    const parsed = JSON.parse(raw) as { projectId?: string };
    return (parsed.projectId || '').trim() || 'pelagic-cat-405307';
  } catch {
    return 'pelagic-cat-405307';
  }
})();

const ADMIN_TOKEN_SECRET =
  (process.env.ADMIN_SESSION_SECRET || '').trim() || crypto.randomBytes(32).toString('hex');
const ADMIN_TOKEN_TTL_MS = 1000 * 60 * 60 * 12;

interface AdminTokenPayload {
  uid: string;
  role: 'admin';
  exp: number;
}

function signAdminToken(uid: string): string {
  const payload: AdminTokenPayload = {
    uid,
    role: 'admin',
    exp: Date.now() + ADMIN_TOKEN_TTL_MS,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = crypto
    .createHmac('sha256', ADMIN_TOKEN_SECRET)
    .update(encodedPayload)
    .digest('base64url');
  return `${encodedPayload}.${signature}`;
}

function verifyAdminToken(token: string): AdminTokenPayload | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encodedPayload, signature] = parts;
  if (!encodedPayload || !signature) return null;

  const expectedSig = crypto
    .createHmac('sha256', ADMIN_TOKEN_SECRET)
    .update(encodedPayload)
    .digest('base64url');

  const sigBuf = Buffer.from(signature, 'utf8');
  const expectedBuf = Buffer.from(expectedSig, 'utf8');
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }

  try {
    const parsed = JSON.parse(
      Buffer.from(encodedPayload, 'base64url').toString('utf8')
    ) as Partial<AdminTokenPayload>;
    if (
      parsed &&
      parsed.role === 'admin' &&
      typeof parsed.uid === 'string' &&
      typeof parsed.exp === 'number' &&
      parsed.exp > Date.now()
    ) {
      return { uid: parsed.uid, role: 'admin', exp: parsed.exp };
    }
    return null;
  } catch {
    return null;
  }
}

interface AdminAuthenticatedRequest extends express.Request {
  adminUid?: string;
}

function requireAdminAuth(
  req: AdminAuthenticatedRequest,
  res: express.Response,
  next: express.NextFunction
): void {
  const authHeader = req.headers.authorization;
  const rawHeader = Array.isArray(authHeader) ? authHeader[0] : authHeader;
  const token =
    typeof rawHeader === 'string' && rawHeader.startsWith('Bearer ')
      ? rawHeader.slice('Bearer '.length).trim()
      : '';

  if (!token) {
    res.status(401).json({ error: 'Acceso restringido al Administrador.' });
    return;
  }

  const verified = verifyAdminToken(token);
  if (!verified || verified.role !== 'admin') {
    res.status(401).json({ error: 'Sesión de Administrador inválida o expirada.' });
    return;
  }

  req.adminUid = verified.uid;
  next();
}

function isVerifiedAdminRequest(req: express.Request): boolean {
  const authHeader = req.headers.authorization;
  const rawHeader = Array.isArray(authHeader) ? authHeader[0] : authHeader;
  const token =
    typeof rawHeader === 'string' && rawHeader.startsWith('Bearer ')
      ? rawHeader.slice('Bearer '.length).trim()
      : '';
  if (!token) return false;
  const verified = verifyAdminToken(token);
  return Boolean(verified && verified.role === 'admin');
}

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
  let entries = fs.readdirSync(root, { withFileTypes: true });
  let folders = entries.filter((e) => e.isDirectory());

  if (userId === 'dev-preview-director' && folders.length === 0) {
    const previewProjects = buildLocalPreviewFixture();
    for (const proj of previewProjects) {
      writeProjectFolder(userId, proj);
    }
    entries = fs.readdirSync(root, { withFileTypes: true });
    folders = entries.filter((e) => e.isDirectory());
  }

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

function classifyGeminiApiError(
  error: unknown,
  fallbackMessage: string
): {
  status: number;
  message: string;
  isBillingOrPermission: boolean;
  needsApiConfig?: ApiCapability;
} {
  if (error instanceof ProviderConfigurationError) {
    return {
      status: error.status,
      message: error.message,
      isBillingOrPermission:
        error.code === 'PROVIDER_BILLING_OR_QUOTA' || error.code === 'PROVIDER_AUTH_ERROR',
      needsApiConfig: error.code === 'API_NOT_CONFIGURED' ? error.capability : undefined,
    };
  }

  const rawMessage = error instanceof Error ? error.message : String(error || fallbackMessage);
  const statusProp =
    typeof error === 'object' && error !== null && 'status' in error
      ? Number((error as { status?: unknown }).status)
      : NaN;

  if (
    statusProp === 403 ||
    /PERMISSION_DENIED|PermissionDeniedError|billing account|outstanding balance|\b403\b/i.test(
      rawMessage
    )
  ) {
    return {
      status: 403,
      isBillingOrPermission: true,
      message:
        'Permiso denegado o facturación pendiente en Google Cloud (403 PERMISSION_DENIED). Verifica la cuenta de facturación o selecciona una clave API de pago activa en Settings > Secrets.',
    };
  }

  if (statusProp === 429 || /RESOURCE_EXHAUSTED|\b429\b/i.test(rawMessage)) {
    return {
      status: 429,
      isBillingOrPermission: true,
      message:
        'Se alcanzó el límite de cuota o se requiere una clave API con facturación activa (429 RESOURCE_EXHAUSTED). Verifica tu clave en Settings > Secrets.',
    };
  }

  if (statusProp === 400 && /API_KEY_INVALID|API key not valid/i.test(rawMessage)) {
    return {
      status: 400,
      isBillingOrPermission: false,
      message:
        'Clave GEMINI_API_KEY inválida (400 API_KEY_INVALID). Revisa la configuración en Settings > Secrets.',
    };
  }

  if (statusProp === 404 || /NOT_FOUND/i.test(rawMessage)) {
    return {
      status: 404,
      isBillingOrPermission: false,
      message: rawMessage || 'Modelo o recurso no encontrado (404 NOT_FOUND).',
    };
  }

  return {
    status: 500,
    isBillingOrPermission: false,
    message: rawMessage || fallbackMessage,
  };
}

function logClassifiedRouteError(
  routeLabel: string,
  classified: { status: number; message: string; isBillingOrPermission: boolean }
): void {
  if (classified.isBillingOrPermission || classified.status < 500) {
    console.warn(`Aviso en ${routeLabel} (HTTP ${classified.status}):`, classified.message);
  } else {
    console.error(`Error en ${routeLabel}:`, classified.message);
  }
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

function safeParseModelJson<T = Record<string, unknown>>(
  rawText: string,
  errorLabel = 'La respuesta del modelo no tuvo formato JSON válido.'
): T {
  const stripped = rawText
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  try {
    return JSON.parse(stripped) as T;
  } catch {
    const startObj = stripped.indexOf('{');
    const endObj = stripped.lastIndexOf('}');
    if (startObj !== -1 && endObj > startObj) {
      try {
        return JSON.parse(stripped.slice(startObj, endObj + 1)) as T;
      } catch {
        // fall through
      }
    }
    throw new Error(errorLabel);
  }
}

interface VideoJobState {
  jobId: string;
  userId: string;
  projectId: string;
  capability?: 'video' | 'frameo_video';
  status: 'pending' | 'completed' | 'failed';
  interactionId?: string;
  videoUrl?: string;
  project?: ProductionProject;
  error?: string;
  frameoFailed?: boolean;
  needsManualApiConfig?: boolean;
  createdAt: number;
}

const videoJobs = new Map<string, VideoJobState>();

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

function buildEffectiveProducerInstruction(
  lessons: LearningLesson[],
  options?: { isAdmin?: boolean }
): string {
  const adminProfile = ensureAdminAgentProfile();
  const adminBlock = buildAdminTrainingPromptBlock(adminProfile, {
    includeFrameoIa: Boolean(options?.isAdmin),
  });
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

  app.get('/api/health', (req, res) => {
    const userId = getRequestUserId(req);
    const apiKey = process.env.GEMINI_API_KEY;
    const geminiConfigured = Boolean(apiKey && apiKey !== 'MY_GEMINI_API_KEY');
    const providers = listPublicProviders(userId, WORKSPACE_DIR, {
      includeAdminFrameo: isVerifiedAdminRequest(req),
    });
    res.json({ ok: true, geminiConfigured, providers });
  });

  // Dynamic API Providers (Image, Video & Admin Frameo IA — free or paid, encrypted in server vault)
  app.get('/api/providers', (req, res) => {
    const userId = getRequestUserId(req);
    const providers = listPublicProviders(userId, WORKSPACE_DIR, {
      includeAdminFrameo: isVerifiedAdminRequest(req),
    });
    res.json({ providers });
  });

  app.post('/api/providers/detect', async (req, res) => {
    try {
      const isAdminReq = isVerifiedAdminRequest(req);
      const userId = isAdminReq ? ADMIN_UID : getRequestUserId(req);
      const body = req.body ?? {};
      const capability: ApiCapability =
        body.capability === 'frameo_video'
          ? 'frameo_video'
          : body.capability === 'video'
            ? 'video'
            : body.capability === 'core'
              ? 'core'
              : 'image';

      if (capability === 'frameo_video' && !isAdminReq) {
        res.status(403).json({
          error: 'El servicio de video Frameo IA es exclusivo del perfil Administrador.',
        });
        return;
      }

      const input: ApiProviderInput & { save?: boolean } = {
        capability,
        providerHint: typeof body.providerHint === 'string' ? body.providerHint : 'auto',
        tierHint: typeof body.tierHint === 'string' ? body.tierHint : 'auto',
        endpointUrl: typeof body.endpointUrl === 'string' ? body.endpointUrl : '',
        apiKey: typeof body.apiKey === 'string' ? body.apiKey : '',
        model: typeof body.model === 'string' ? body.model : '',
        authHeader: typeof body.authHeader === 'string' ? body.authHeader : undefined,
        authPrefix: typeof body.authPrefix === 'string' ? body.authPrefix : undefined,
        label: typeof body.label === 'string' ? body.label : undefined,
        save: body.save !== false,
      };
      const result = await detectTestAndSaveProvider(userId, input, WORKSPACE_DIR);
      res.json(result);
    } catch (error) {
      const classified = classifyGeminiApiError(
        error,
        'No se pudo detectar o verificar el proveedor de API.'
      );
      logClassifiedRouteError('/api/providers/detect', classified);
      res.status(classified.status).json({ error: classified.message });
    }
  });

  app.delete('/api/providers/:capability', (req, res) => {
    const isAdminReq = isVerifiedAdminRequest(req);
    const userId = isAdminReq ? ADMIN_UID : getRequestUserId(req);
    const capParam = req.params.capability;
    if (
      capParam !== 'image' &&
      capParam !== 'video' &&
      capParam !== 'core' &&
      capParam !== 'frameo_video'
    ) {
      res.status(400).json({ error: 'Capacidad de proveedor inválida.' });
      return;
    }
    if (capParam === 'frameo_video' && !isAdminReq) {
      res.status(403).json({
        error: 'El servicio de video Frameo IA es exclusivo del perfil Administrador.',
      });
      return;
    }
    const providers = deleteUserProvider(userId, capParam, WORKSPACE_DIR, {
      includeAdminFrameo: isAdminReq,
    });
    res.json({ providers });
  });

  // Admin Profile Login & Agent Inspection / Training Console Endpoints
  app.post('/api/admin/login', (req, res) => {
    const rawIdentifier =
      typeof req.body?.identifier === 'string'
        ? req.body.identifier
        : typeof req.body?.username === 'string'
          ? req.body.username
          : typeof req.body?.email === 'string'
            ? req.body.email
            : '';
    const rawPassword = typeof req.body?.password === 'string' ? req.body.password : '';

    if (!verifyAdminCredentials(rawIdentifier, rawPassword)) {
      res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
      return;
    }

    const { email } = getConfiguredAdminIdentity();
    ensureWorkspaceProjects(ADMIN_UID);
    ensureLearningMemory(ADMIN_UID);
    ensureAdminAgentProfile();
    const token = signAdminToken(ADMIN_UID);

    res.json({
      token,
      session: {
        uid: ADMIN_UID,
        displayName: 'Administrador AUTEUR',
        email,
        role: 'admin',
        emailVerified: true,
      },
    });
  });

  app.post('/api/admin/google-login', async (req, res) => {
    try {
      const idToken = typeof req.body?.idToken === 'string' ? req.body.idToken.trim() : '';
      if (!idToken) {
        res.status(400).json({ error: 'Falta el token de verificación de Google.' });
        return;
      }

      const verified = await verifyFirebaseGoogleIdToken(idToken, FIREBASE_PROJECT_ID);
      if (!verified.valid) {
        res.status(403).json({ error: verified.reason || 'Acceso de Administrador denegado.' });
        return;
      }

      const { email } = getConfiguredAdminIdentity();
      ensureWorkspaceProjects(ADMIN_UID);
      ensureLearningMemory(ADMIN_UID);
      ensureAdminAgentProfile();
      const token = signAdminToken(ADMIN_UID);

      res.json({
        token,
        session: {
          uid: ADMIN_UID,
          displayName: verified.name || 'Administrador AUTEUR',
          email: verified.email || email,
          role: 'admin',
          emailVerified: true,
        },
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'No se pudo verificar el acceso Google Administrador.';
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/admin/seed-audit-project', requireAdminAuth, (req: AdminAuthenticatedRequest, res) => {
    const userId = req.adminUid || ADMIN_UID;
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

  app.get('/api/admin/agent-profile', requireAdminAuth, (req: AdminAuthenticatedRequest, res) => {
    const userId = req.adminUid || ADMIN_UID;
    const profile = ensureAdminAgentProfile();
    const lessons = ensureLearningMemory(userId);
    const providers = listPublicProviders(userId, WORKSPACE_DIR, { includeAdminFrameo: true });
    const frameoMcpStatus = getFrameoMcpPublicStatus(userId, WORKSPACE_DIR);
    res.json({
      profile,
      providers,
      frameoMcpStatus,
      baseSystemInstruction: PRODUCER_SYSTEM_INSTRUCTION,
      effectiveSystemInstruction: buildEffectiveProducerInstruction(lessons, { isAdmin: true }),
      learningCount: lessons.length,
      learningPreview: buildLearningPromptContext(lessons, 8),
      activeModels: [
        { role: 'Agente Arthur (Director / Guionista / Crítico)', model: 'gemini-4-hydrogen' },
        {
          role: 'Motor de Producción Administrador',
          model:
            profile.frameoIaEnabled !== false
              ? `Frameo IA · ${profile.frameoIaModel || 'Veo 3.1 Rápido'} (${profile.frameoIaAspectRatio || '16:9'})`
              : 'Modo Estándar AUTEUR',
        },
        {
          role: 'Servicio Video Frameo IA (Admin)',
          model: providers.frameo_video.configured
            ? `${providers.frameo_video.label} (${providers.frameo_video.model || providers.frameo_video.tier})`
            : 'Sin conector Frameo IA activo (usa respaldo manual si falla)',
        },
        {
          role: 'Generador de Imágenes (Configurable Free/Pago)',
          model: providers.image.configured
            ? `${providers.image.label} (${providers.image.model || providers.image.tier})`
            : 'Sin asignar (suministrable por usuario)',
        },
        {
          role: 'Generador de Video Manual / Estándar (Free/Pago)',
          model: providers.video.configured
            ? `${providers.video.label} (${providers.video.model || providers.video.tier})`
            : 'Sin asignar (suministrable manualmente)',
        },
        { role: 'Voces en Off Realistas', model: 'gemini-3.8-flash-tts' },
        { role: 'Transcripción de Audio / Dictado', model: 'gemini-3.5-transcribe' },
        { role: 'Música Original Tráiler 30s', model: 'lyria-3-clip-preview' },
      ],
    });
  });

  function resolveFrameoOAuthRedirectUri(req: express.Request): string {
    const envAppUrl = (process.env.APP_URL || '').trim().replace(/\/+$/, '');
    if (envAppUrl) {
      return `${envAppUrl}/api/admin/frameo-mcp/callback`;
    }
    const rawOrigin = typeof req.query?.origin === 'string' ? req.query.origin.trim() : '';
    if (rawOrigin) {
      try {
        const parsed = new URL(rawOrigin);
        if (
          (parsed.protocol === 'https:' && parsed.hostname.endsWith('.run.app')) ||
          ((parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
            (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1'))
        ) {
          return `${parsed.origin}/api/admin/frameo-mcp/callback`;
        }
      } catch {
        // Ignore malformed origin query
      }
    }
    const forwardedHost = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
    const forwardedProto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim();
    if (
      forwardedHost &&
      (forwardedHost.endsWith('.run.app') ||
        forwardedHost.startsWith('localhost') ||
        forwardedHost.startsWith('127.0.0.1'))
    ) {
      const proto = forwardedHost.endsWith('.run.app') ? 'https' : forwardedProto;
      return `${proto}://${forwardedHost}/api/admin/frameo-mcp/callback`;
    }
    return `http://localhost:${PORT}/api/admin/frameo-mcp/callback`;
  }

  app.get('/api/admin/frameo-mcp/auth-url', requireAdminAuth, async (req: AdminAuthenticatedRequest, res) => {
    try {
      const userId = req.adminUid || ADMIN_UID;
      const mcpUrl =
        typeof req.query?.mcpUrl === 'string' && req.query.mcpUrl.trim()
          ? req.query.mcpUrl.trim()
          : DEFAULT_FRAMEO_MCP_URL;
      const redirectUri = resolveFrameoOAuthRedirectUri(req);
      const authData = await createFrameoOAuthAuthorizationUrl({
        userId,
        redirectUri,
        mcpUrl,
        workspaceDir: WORKSPACE_DIR,
      });
      res.json(authData);
    } catch (error) {
      const msg =
        error instanceof Error
          ? error.message
          : 'No se pudo iniciar la autorización OAuth con Frameo.AI MCP.';
      res.status(502).json({ error: msg });
    }
  });

  const handleFrameoMcpCallback = async (req: express.Request, res: express.Response) => {
    const oauthError = typeof req.query?.error === 'string' ? req.query.error : '';
    const oauthErrorDesc =
      typeof req.query?.error_description === 'string' ? req.query.error_description : '';
    const code = typeof req.query?.code === 'string' ? req.query.code.trim() : '';
    const state = typeof req.query?.state === 'string' ? req.query.state.trim() : '';

    if (oauthError) {
      const msg = oauthErrorDesc || oauthError || 'Autorización denegada en Frameo.AI.';
      res.status(400).send(`<!DOCTYPE html>
<html lang="es"><body style="font-family:sans-serif;background:#0b0b0e;color:#f2f0eb;padding:24px;">
  <h3>Error conectando con Frameo.AI</h3>
  <p>${msg.replace(/[<>&"]/g, '')}</p>
  <script>
    if (window.opener) {
      window.opener.postMessage(${JSON.stringify({ type: 'FRAMEO_MCP_OAUTH_ERROR', error: msg })}, '*');
    }
  </script>
</body></html>`);
      return;
    }

    if (!code || !state) {
      res.status(400).send('Faltan parámetros OAuth (code / state).');
      return;
    }

    try {
      const adminProfile = ensureAdminAgentProfile();
      const done = await completeFrameoOAuthCallback({ code, state });
      const providers = saveConnectedFrameoMcpProvider(
        done.userId,
        {
          mcpUrl: done.mcpUrl,
          model: adminProfile.frameoIaModel || 'Veo 3.1 Rápido',
          toolsCount: done.tools.length,
          serverName: done.serverName,
        },
        WORKSPACE_DIR
      );

      const payload = {
        type: 'FRAMEO_MCP_OAUTH_SUCCESS',
        toolsCount: done.tools.length,
        serverName: done.serverName || 'Frameo.AI MCP',
        providers,
      };
      res.send(`<!DOCTYPE html>
<html lang="es"><body style="font-family:sans-serif;background:#0b0b0e;color:#f2f0eb;padding:24px;">
  <h3>Frameo.AI MCP conectado correctamente</h3>
  <p>Herramientas detectadas: ${done.tools.length}. Esta ventana se cerrará automáticamente.</p>
  <script>
    if (window.opener) {
      window.opener.postMessage(${JSON.stringify(payload)}, '*');
      window.close();
    } else {
      window.location.href = '/';
    }
  </script>
</body></html>`);
    } catch (error) {
      const msg =
        error instanceof Error ? error.message : 'Error completando OAuth con Frameo.AI.';
      res.status(502).send(`<!DOCTYPE html>
<html lang="es"><body style="font-family:sans-serif;background:#0b0b0e;color:#f2f0eb;padding:24px;">
  <h3>Error completando conexión Frameo.AI</h3>
  <p>${msg.replace(/[<>&"]/g, '')}</p>
  <script>
    if (window.opener) {
      window.opener.postMessage(${JSON.stringify({ type: 'FRAMEO_MCP_OAUTH_ERROR', error: msg })}, '*');
    }
  </script>
</body></html>`);
    }
  };

  app.get(['/api/admin/frameo-mcp/callback', '/api/admin/frameo-mcp/callback/'], handleFrameoMcpCallback);

  app.get('/api/admin/frameo-mcp/status', requireAdminAuth, (req: AdminAuthenticatedRequest, res) => {
    const userId = req.adminUid || ADMIN_UID;
    const status = getFrameoMcpPublicStatus(userId, WORKSPACE_DIR);
    const providers = listPublicProviders(userId, WORKSPACE_DIR, { includeAdminFrameo: true });
    res.json({ status, providers });
  });

  app.post('/api/admin/frameo-mcp/refresh-tools', requireAdminAuth, async (req: AdminAuthenticatedRequest, res) => {
    try {
      const userId = req.adminUid || ADMIN_UID;
      const adminProfile = ensureAdminAgentProfile();
      const synced = await listFrameoMcpTools(userId, WORKSPACE_DIR);
      const providers = saveConnectedFrameoMcpProvider(
        userId,
        {
          model: adminProfile.frameoIaModel || 'Veo 3.1 Rápido',
          toolsCount: synced.tools.length,
          serverName: synced.serverName,
        },
        WORKSPACE_DIR
      );
      const status = getFrameoMcpPublicStatus(userId, WORKSPACE_DIR);
      res.json({ status, providers, tools: synced.tools });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'No se pudieron sincronizar las herramientas MCP de Frameo.AI.';
      res.status(502).json({ error: msg });
    }
  });

  app.post('/api/admin/frameo-mcp/call-tool', requireAdminAuth, async (req: AdminAuthenticatedRequest, res) => {
    try {
      const userId = req.adminUid || ADMIN_UID;
      const toolName = typeof req.body?.toolName === 'string' ? req.body.toolName.trim() : '';
      const args =
        req.body?.arguments && typeof req.body.arguments === 'object'
          ? (req.body.arguments as Record<string, unknown>)
          : {};
      if (!toolName) {
        res.status(400).json({ error: 'Debes indicar toolName para invocar Frameo.AI MCP.' });
        return;
      }
      const result = await callFrameoMcpTool(userId, toolName, args, WORKSPACE_DIR);
      res.json({ ok: true, result });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Error invocando herramienta de Frameo.AI MCP.';
      res.status(502).json({ error: msg });
    }
  });

  app.delete('/api/admin/frameo-mcp/disconnect', requireAdminAuth, (req: AdminAuthenticatedRequest, res) => {
    const userId = req.adminUid || ADMIN_UID;
    disconnectFrameoMcpSession(userId, WORKSPACE_DIR);
    const current = resolveProviderForCapability(userId, 'frameo_video', WORKSPACE_DIR);
    const providers =
      current.providerKind === 'frameo_mcp'
        ? deleteUserProvider(userId, 'frameo_video', WORKSPACE_DIR, { includeAdminFrameo: true })
        : listPublicProviders(userId, WORKSPACE_DIR, { includeAdminFrameo: true });
    res.json({
      status: getFrameoMcpPublicStatus(userId, WORKSPACE_DIR),
      providers,
    });
  });

  app.put('/api/admin/agent-profile', requireAdminAuth, (req: AdminAuthenticatedRequest, res) => {
    const userId = req.adminUid || ADMIN_UID;
    const body = req.body ?? {};
    const customDirectives = String(body.customDirectives || '');
    const check = validateAdminDirective(customDirectives);
    if (!check.valid) {
      res.status(400).json({ error: check.error });
      return;
    }

    const current = ensureAdminAgentProfile();
    const rawClipDuration = Number(body.frameoIaClipDurationSec);
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
      frameoIaEnabled:
        typeof body.frameoIaEnabled === 'boolean'
          ? body.frameoIaEnabled
          : current.frameoIaEnabled,
      frameoIaAutoGenerateVideo:
        typeof body.frameoIaAutoGenerateVideo === 'boolean'
          ? body.frameoIaAutoGenerateVideo
          : current.frameoIaAutoGenerateVideo,
      frameoIaModel:
        typeof body.frameoIaModel === 'string' && body.frameoIaModel.trim()
          ? body.frameoIaModel.trim()
          : current.frameoIaModel,
      frameoIaVfxMode:
        typeof body.frameoIaVfxMode === 'string' && body.frameoIaVfxMode.trim()
          ? body.frameoIaVfxMode.trim()
          : current.frameoIaVfxMode,
      frameoIaRenderQuality:
        body.frameoIaRenderQuality === 'full_hd'
          ? 'full_hd'
          : body.frameoIaRenderQuality === '480p_preview'
            ? '480p_preview'
            : current.frameoIaRenderQuality,
      frameoIaStylePreset:
        typeof body.frameoIaStylePreset === 'string' && body.frameoIaStylePreset.trim()
          ? body.frameoIaStylePreset.trim()
          : current.frameoIaStylePreset,
      frameoIaAspectRatio:
        typeof body.frameoIaAspectRatio === 'string' && body.frameoIaAspectRatio.trim()
          ? body.frameoIaAspectRatio.trim()
          : current.frameoIaAspectRatio,
      frameoIaClipDurationSec:
        Number.isFinite(rawClipDuration) && rawClipDuration >= 3 && rawClipDuration <= 12
          ? Math.round(rawClipDuration)
          : current.frameoIaClipDurationSec,
      customDirectives: customDirectives.trim(),
      updatedAt: new Date().toISOString(),
    });
    const lessons = ensureLearningMemory(userId);

    res.json({
      profile: saved,
      effectiveSystemInstruction: buildEffectiveProducerInstruction(lessons, { isAdmin: true }),
    });
  });

  app.post('/api/admin/generate-frameo-package', requireAdminAuth, (req: AdminAuthenticatedRequest, res) => {
    const userId = req.adminUid || ADMIN_UID;
    const { projectId, sequenceId } = req.body ?? {};
    const pid = String(projectId || '').trim();
    const sid = String(sequenceId || '').trim();

    if (!pid || !sid) {
      res.status(400).json({ error: 'Selecciona un proyecto y una secuencia para generar el paquete Frameo IA.' });
      return;
    }

    const project = readProjectById(userId, pid);
    if (!project) {
      res.status(404).json({ error: 'Proyecto no encontrado.' });
      return;
    }
    const seqIdx = project.sequences.findIndex((s) => s.id === sid);
    if (seqIdx === -1) {
      res.status(404).json({ error: 'Secuencia no encontrada.' });
      return;
    }

    const profile = ensureAdminAgentProfile();
    const currentSeq = project.sequences[seqIdx];
    const frameoSpec = buildFrameoProductionSpecForSequence({
      project,
      sequence: currentSeq,
      profile,
    });
    const updatedSeq: ProductionSequence = {
      ...currentSeq,
      productionEngine: 'frameo_ia',
      frameoProductionSpec: frameoSpec,
      updatedAt: new Date().toISOString(),
    };
    const updatedProject: ProductionProject = {
      ...project,
      sequences: project.sequences.map((s, idx) => (idx === seqIdx ? updatedSeq : s)),
      updatedAt: new Date().toISOString(),
    };
    writeProjectFolder(userId, updatedProject);

    res.json({
      project: updatedProject,
      sequence: updatedSeq,
      frameoProductionSpec: frameoSpec,
    });
  });

  // Admin-only Frameo IA Video Generation Service (strictly uses 'frameo_video' configuration)
  app.post('/api/admin/generate-frameo-video', requireAdminAuth, async (req: AdminAuthenticatedRequest, res) => {
    try {
      const userId = req.adminUid || ADMIN_UID;
      const {
        projectId,
        sequenceId,
        frameId,
        prompt,
        aspectRatio,
        duration,
        imageUrl,
        asyncJob,
      } = req.body ?? {};

      const pid = String(projectId || '').trim();
      const sid = String(sequenceId || '').trim();
      const fid = String(frameId || '').trim();
      const incomingPrompt = String(prompt || '').trim();

      if (!pid || !sid) {
        res.status(400).json({
          error: 'Se requiere projectId y sequenceId para generar el video en Frameo IA.',
          frameoFailed: true,
          needsManualApiConfig: true,
        });
        return;
      }

      const initialProject = readProjectById(userId, pid);
      if (!initialProject) {
        res.status(404).json({
          error: 'Proyecto no encontrado para el perfil Administrador.',
          frameoFailed: true,
          needsManualApiConfig: true,
        });
        return;
      }

      const targetSeq = initialProject.sequences.find((s) => s.id === sid);
      if (!targetSeq) {
        res.status(404).json({
          error: 'Secuencia no encontrada en el proyecto del Administrador.',
          frameoFailed: true,
          needsManualApiConfig: true,
        });
        return;
      }

      const adminProfile = ensureAdminAgentProfile();
      const frameoProvider = resolveProviderForCapability(userId, 'frameo_video', WORKSPACE_DIR);
      if (!frameoProvider.configured || !frameoProvider.providerKind) {
        res.status(428).json({
          error:
            'El servicio de generación de video de Frameo IA no está configurado en la configuración del Administrador. Configura Frameo IA o suministra manualmente una API de generación.',
          frameoFailed: true,
          needsManualApiConfig: true,
          capability: 'frameo_video',
        });
        return;
      }

      const firstScene = targetSeq.frameoProductionSpec?.scenes?.[0];
      const fallbackFrame = targetSeq.storyboardFrames?.[0];
      const motionPrompt =
        incomingPrompt ||
        (firstScene
          ? `${firstScene.frameoMotionPrompt} (${firstScene.frameoVisualPrompt})`
          : fallbackFrame
            ? `${fallbackFrame.veoMotionPrompt} (${fallbackFrame.visualPrompt})`
            : targetSeq.hyperRealisticPrompt || targetSeq.directorVision || targetSeq.logline);

      if (!motionPrompt || motionPrompt.length < 5) {
        res.status(400).json({
          error: 'No hay prompt visual/movimiento válido para ejecutar Frameo IA.',
          frameoFailed: true,
          needsManualApiConfig: true,
        });
        return;
      }

      const rawRatio = String(
        aspectRatio || targetSeq.aspectRatio || adminProfile.frameoIaAspectRatio || '16:9'
      ).trim();
      const cleanRatio = rawRatio === '9:16' || rawRatio === '3:4' ? '9:16' : '16:9';
      const defaultSec = Math.min(
        10,
        Math.max(3, Math.round(adminProfile.frameoIaClipDurationSec || 5))
      );
      const videoDuration =
        typeof duration === 'string' && /^(3|4|5|6|7|8|9|10)s$/.test(duration)
          ? duration
          : `${defaultSec}s`;

      const sourceImage = resolveLocalImageBase64(
        typeof imageUrl === 'string' ? imageUrl : fallbackFrame?.imageUrl
      );

      async function persistFrameoVideoBuffer(
        buffer: Buffer,
        mimeType: string,
        providerLabel: string
      ): Promise<{ videoUrl: string; project: ProductionProject }> {
        let latestProject = readProjectById(userId, pid) || initialProject!;
        const saved = saveGeneratedAssetBuffer(userId, latestProject, {
          baseName: `frameo-${sid}-${fid || 'seq'}`,
          ext: mimeType.includes('webm') ? '.webm' : '.mp4',
          mimeType,
          buffer,
          kind: 'video',
        });
        latestProject = saved.updatedProject;

        const seqIdx = latestProject.sequences.findIndex((s) => s.id === sid);
        if (seqIdx !== -1) {
          const seq = latestProject.sequences[seqIdx];
          const targetFrameId = fid || seq.storyboardFrames?.[0]?.id;
          let updatedFrames: StoryboardCard[];
          if (targetFrameId && seq.storyboardFrames.some((fr) => fr.id === targetFrameId)) {
            updatedFrames = seq.storyboardFrames.map((fr) =>
              fr.id === targetFrameId ? { ...fr, videoUrl: saved.asset.url } : fr
            );
          } else {
            const newCard: StoryboardCard = {
              id: `sb-frameo-${Date.now().toString(36)}`,
              title: `Frameo IA · ${seq.title} (${cleanRatio} · ${videoDuration})`,
              shotRef: firstScene?.shotRef || 'Frameo Clip 01',
              aspectRatio: cleanRatio,
              cameraSpec: `${seq.cameraSystem} · ${providerLabel}`,
              videoUrl: saved.asset.url,
              visualPrompt: motionPrompt,
              veoMotionPrompt: motionPrompt,
            };
            updatedFrames = [newCard, ...(seq.storyboardFrames || [])];
          }

          latestProject = {
            ...latestProject,
            sequences: latestProject.sequences.map((s, idx) =>
              idx === seqIdx
                ? {
                    ...s,
                    productionEngine: 'frameo_ia',
                    storyboardFrames: updatedFrames,
                    updatedAt: new Date().toISOString(),
                  }
                : s
            ),
            updatedAt: new Date().toISOString(),
          };
          writeProjectFolder(userId, latestProject);
        }

        return { videoUrl: saved.asset.url, project: latestProject };
      }

      if (asyncJob === false) {
        const result = await executeVideoGeneration(
          userId,
          {
            prompt: motionPrompt,
            aspectRatio: cleanRatio,
            duration: videoDuration,
            sourceImage,
            capability: 'frameo_video',
            model: adminProfile.frameoIaModel,
            vfxMode: adminProfile.frameoIaVfxMode,
            renderQuality: adminProfile.frameoIaRenderQuality,
          },
          WORKSPACE_DIR
        );
        const done = await persistFrameoVideoBuffer(
          result.buffer,
          result.mimeType,
          result.providerLabel
        );
        res.json({
          status: 'completed',
          videoUrl: done.videoUrl,
          model: result.model,
          provider: result.providerLabel,
          tier: result.tier,
          project: done.project,
        });
        return;
      }

      const jobId = `fjob-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      const jobRecord: VideoJobState = {
        jobId,
        userId,
        projectId: pid,
        capability: 'frameo_video',
        status: 'pending',
        createdAt: Date.now(),
      };
      videoJobs.set(jobId, jobRecord);

      void (async () => {
        try {
          const result = await executeVideoGeneration(
            userId,
            {
              prompt: motionPrompt,
              aspectRatio: cleanRatio,
              duration: videoDuration,
              sourceImage,
              capability: 'frameo_video',
              model: adminProfile.frameoIaModel,
              vfxMode: adminProfile.frameoIaVfxMode,
              renderQuality: adminProfile.frameoIaRenderQuality,
            },
            WORKSPACE_DIR
          );
          const done = await persistFrameoVideoBuffer(
            result.buffer,
            result.mimeType,
            result.providerLabel
          );
          videoJobs.set(jobId, {
            ...jobRecord,
            status: 'completed',
            videoUrl: done.videoUrl,
            project: done.project,
          });
        } catch (bgErr) {
          const classifiedBg = classifyGeminiApiError(
            bgErr,
            'El servicio de generación de video Frameo IA falló al renderizar.'
          );
          videoJobs.set(jobId, {
            ...jobRecord,
            status: 'failed',
            error: classifiedBg.message,
            frameoFailed: true,
            needsManualApiConfig: true,
          });
        }
      })();

      res.status(202).json({
        jobId,
        status: 'pending',
        capability: 'frameo_video',
        model: frameoProvider.model || frameoProvider.label,
        provider: frameoProvider.label,
        tier: frameoProvider.tier,
      });
    } catch (error) {
      const classified = classifyGeminiApiError(
        error,
        'El servicio de generación de video de Frameo IA falló.'
      );
      logClassifiedRouteError('/api/admin/generate-frameo-video', classified);
      res.status(classified.status).json({
        error: classified.message,
        frameoFailed: true,
        needsManualApiConfig: true,
        capability: 'frameo_video',
      });
    }
  });

  app.post('/api/admin/analyze-sequence', requireAdminAuth, async (req: AdminAuthenticatedRequest, res) => {
    try {
      const userId = req.adminUid || ADMIN_UID;
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
      const parsed = safeParseModelJson<Omit<AgentDiagnosticReport, 'localMetrics' | 'auditedAt'>>(
        raw,
        'El auditor del agente devolvió un JSON inválido.'
      );
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
      const classified = classifyGeminiApiError(error, 'Error auditando la secuencia.');
      logClassifiedRouteError('/api/admin/analyze-sequence', classified);
      res.status(classified.status).json({ error: classified.message });
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
      const classified = classifyGeminiApiError(error, 'Error transcribiendo el dictado de voz.');
      logClassifiedRouteError('/api/transcribe-dictation', classified);
      res.status(classified.status).json({ error: classified.message });
    }
  });

  // Projects CRUD (per-user folder + project.json)
  app.get('/api/projects', (req, res) => {
    const userId = getRequestUserId(req);
    const projects = ensureWorkspaceProjects(userId);
    res.json({ projects });
  });

  // Sync a client/cloud project snapshot onto workspace disk so media/trailer endpoints never 404
  app.post('/api/projects/sync', (req, res) => {
    const userId = getRequestUserId(req);
    const incoming = req.body?.project as ProductionProject | undefined;
    if (!incoming || !incoming.id || !incoming.title) {
      res.status(400).json({ error: 'Se requiere un proyecto válido para sincronizar.' });
      return;
    }

    const existing = readProjectById(userId, incoming.id);
    if (!existing) {
      const normalized: ProductionProject = {
        ...incoming,
        sequences: Array.isArray(incoming.sequences) ? incoming.sequences : [],
        assets: Array.isArray(incoming.assets) ? incoming.assets : [],
        updatedAt: incoming.updatedAt || new Date().toISOString(),
      };
      writeProjectFolder(userId, normalized);
      res.json({ project: normalized, synced: true });
      return;
    }

    // Merge sequences keeping server-rendered media assets while preserving screenplayNotes
    const seqMap = new Map<string, ProductionSequence>();
    for (const s of existing.sequences) {
      seqMap.set(s.id, s);
    }
    for (const s of incoming.sequences || []) {
      const prev = seqMap.get(s.id);
      if (!prev) {
        seqMap.set(s.id, s);
      } else {
        seqMap.set(s.id, {
          ...s,
          storyboardFrames:
            prev.storyboardFrames.length > 0 &&
            prev.storyboardFrames.some((f) => f.imageUrl || f.videoUrl) &&
            !s.storyboardFrames.some((f) => f.imageUrl || f.videoUrl)
              ? prev.storyboardFrames
              : s.storyboardFrames,
          screenplayNotes: s.screenplayNotes?.length
            ? s.screenplayNotes
            : prev.screenplayNotes,
        });
      }
    }

    const merged: ProductionProject = {
      ...existing,
      ...incoming,
      sequences: Array.from(seqMap.values()),
      trailer: incoming.trailer || existing.trailer,
      assets:
        (existing.assets?.length || 0) >= (incoming.assets?.length || 0)
          ? existing.assets
          : incoming.assets,
    };
    writeProjectFolder(userId, merged);
    res.json({ project: merged, synced: true });
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

  // Screenplay Footnotes (Director / Producer Review Notes linked to a specific line)
  app.post('/api/projects/:id/sequences/:seqId/notes', (req, res) => {
    const userId = getRequestUserId(req);
    const { id, seqId } = req.params;
    const {
      beatKey,
      sceneNumber,
      beatIndex,
      beatType,
      lineExcerpt,
      authorRole,
      authorName,
      note,
    } = req.body ?? {};

    const cleanNote = String(note || '').trim();
    const role: ScreenplayNoteRole = authorRole === 'producer' ? 'producer' : 'director';
    if (cleanNote.length < 3 || cleanNote.length > 1200) {
      res.status(400).json({ error: 'La nota al pie debe tener entre 3 y 1200 caracteres.' });
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

    const seq = project.sequences[seqIdx];
    const newNote: ScreenplayNote = {
      id: `note-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      beatKey: String(beatKey || '0:0'),
      sceneNumber: String(sceneNumber || '1'),
      beatIndex: Number(beatIndex) || 0,
      beatType:
        beatType === 'dialogue' || beatType === 'camera' || beatType === 'sound'
          ? beatType
          : 'action',
      lineExcerpt: String(lineExcerpt || '').slice(0, 140),
      authorRole: role,
      authorName:
        String(authorName || '').trim() ||
        (role === 'producer' ? 'Productor Ejecutivo' : 'Director'),
      note: cleanNote,
      createdAt: new Date().toISOString(),
      resolved: false,
    };

    const nextSeq: ProductionSequence = {
      ...seq,
      screenplayNotes: [...(seq.screenplayNotes || []), newNote],
      updatedAt: new Date().toISOString(),
    };
    const updatedProject: ProductionProject = {
      ...project,
      sequences: project.sequences.map((s, idx) => (idx === seqIdx ? nextSeq : s)),
      updatedAt: new Date().toISOString(),
    };
    writeProjectFolder(userId, updatedProject);
    res.status(201).json({ note: newNote, sequence: nextSeq, project: updatedProject });
  });

  app.patch('/api/projects/:id/sequences/:seqId/notes/:noteId', (req, res) => {
    const userId = getRequestUserId(req);
    const { id, seqId, noteId } = req.params;
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

    const seq = project.sequences[seqIdx];
    const existingNotes = seq.screenplayNotes || [];
    const targetNote = existingNotes.find((n) => n.id === noteId);
    if (!targetNote) {
      res.status(404).json({ error: 'Nota al pie no encontrada.' });
      return;
    }

    const nextNotes = existingNotes.map((n) => {
      if (n.id !== noteId) return n;
      return {
        ...n,
        resolved:
          typeof req.body?.resolved === 'boolean' ? req.body.resolved : n.resolved,
        note:
          typeof req.body?.note === 'string' && req.body.note.trim().length >= 3
            ? req.body.note.trim().slice(0, 1200)
            : n.note,
      };
    });

    const nextSeq: ProductionSequence = {
      ...seq,
      screenplayNotes: nextNotes,
      updatedAt: new Date().toISOString(),
    };
    const updatedProject: ProductionProject = {
      ...project,
      sequences: project.sequences.map((s, idx) => (idx === seqIdx ? nextSeq : s)),
      updatedAt: new Date().toISOString(),
    };
    writeProjectFolder(userId, updatedProject);
    res.json({ sequence: nextSeq, project: updatedProject });
  });

  app.delete('/api/projects/:id/sequences/:seqId/notes/:noteId', (req, res) => {
    const userId = getRequestUserId(req);
    const { id, seqId, noteId } = req.params;
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

    const seq = project.sequences[seqIdx];
    const nextNotes = (seq.screenplayNotes || []).filter((n) => n.id !== noteId);
    const nextSeq: ProductionSequence = {
      ...seq,
      screenplayNotes: nextNotes,
      updatedAt: new Date().toISOString(),
    };
    const updatedProject: ProductionProject = {
      ...project,
      sequences: project.sequences.map((s, idx) => (idx === seqIdx ? nextSeq : s)),
      updatedAt: new Date().toISOString(),
    };
    writeProjectFolder(userId, updatedProject);
    res.json({ ok: true, sequence: nextSeq, project: updatedProject });
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

  // Flexible Image Generation (uses user-supplied Free or Paid Image API)
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

      const generated = await executeImageGeneration(
        userId,
        {
          prompt: visualPrompt,
          aspectRatio: String(aspectRatio || '16:9'),
          resolution: targetRes,
          quality: quality === 'lite' ? 'lite' : 'standard',
        },
        WORKSPACE_DIR
      );

      const ext =
        generated.mimeType.includes('jpeg') || generated.mimeType.includes('jpg')
          ? '.jpg'
          : generated.mimeType.includes('webp')
            ? '.webp'
            : '.png';
      const saved = saveGeneratedAssetBuffer(userId, project, {
        baseName: `img-${tbid || fid || 'frame'}-${targetRes}`,
        ext,
        mimeType: generated.mimeType,
        buffer: generated.buffer,
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
        model: generated.model,
        provider: generated.providerLabel,
        tier: generated.tier,
        resolution: targetRes,
        project,
      });
    } catch (error) {
      const classified = classifyGeminiApiError(error, 'Error generando la imagen.');
      logClassifiedRouteError('/api/generate-image', classified);
      res.status(classified.status).json({
        error: classified.message,
        ...(classified.needsApiConfig ? { needsApiConfig: classified.needsApiConfig } : {}),
      });
    }
  });

  // Poll background video job
  app.get('/api/video-jobs/:jobId', (req, res) => {
    const isAdminReq = isVerifiedAdminRequest(req);
    const userId = isAdminReq ? ADMIN_UID : getRequestUserId(req);
    const job = videoJobs.get(req.params.jobId);
    if (!job || (job.userId !== userId && !(isAdminReq && job.userId === ADMIN_UID))) {
      res.status(404).json({ error: 'Trabajo de video no encontrado.' });
      return;
    }
    res.json({
      jobId: job.jobId,
      capability: job.capability,
      status: job.status,
      videoUrl: job.videoUrl,
      project: job.project,
      error: job.error,
      frameoFailed: job.frameoFailed,
      needsManualApiConfig: job.needsManualApiConfig,
    });
  });

  // Flexible Video Generation (uses user-supplied Free or Paid Video API)
  app.post('/api/generate-video', async (req, res) => {
    try {
      const userId = getRequestUserId(req);
      const {
        projectId,
        sequenceId,
        frameId,
        trailerBeatId,
        prompt,
        title,
        aspectRatio,
        duration,
        imageUrl,
        asyncJob,
      } = req.body ?? {};
      const pid = String(projectId || '').trim();
      const sid = String(sequenceId || '').trim();
      const fid = String(frameId || '').trim();
      const tbid = String(trailerBeatId || '').trim();
      const clipTitle = String(title || '').trim();
      const motionPrompt = String(prompt || '').trim();

      if (!pid || !motionPrompt) {
        res.status(400).json({ error: 'Se requiere el proyecto y el prompt de movimiento.' });
        return;
      }

      const initialProject = readProjectById(userId, pid);
      if (!initialProject) {
        res.status(404).json({ error: 'Proyecto no encontrado.' });
        return;
      }

      const videoProvider = resolveProviderForCapability(userId, 'video', WORKSPACE_DIR);
      if (!videoProvider.configured || !videoProvider.providerKind) {
        res.status(428).json({
          error:
            'No hay ninguna API de Video asignada. Ve a Configuración del Estudio > Proveedores de API y suministra una API de video (free o de pago).',
          needsApiConfig: 'video',
        });
        return;
      }

      const cleanRatio =
        String(aspectRatio || '').trim() === '9:16' || String(aspectRatio || '').trim() === '3:4'
          ? '9:16'
          : '16:9';
      const videoDuration =
        typeof duration === 'string' && /^(3|4|5|6|7|8|9|10)s$/.test(duration)
          ? duration
          : '6s';

      const sourceImage = resolveLocalImageBase64(
        typeof imageUrl === 'string' ? imageUrl : undefined
      );

      async function persistVideoBuffer(
        buffer: Buffer,
        mimeType: string,
        providerLabel: string
      ): Promise<{ videoUrl: string; project: ProductionProject }> {
        let latestProject = readProjectById(userId, pid) || initialProject!;
        const saved = saveGeneratedAssetBuffer(userId, latestProject, {
          baseName: `clip-${tbid || fid || 'video'}`,
          ext: mimeType.includes('webm') ? '.webm' : '.mp4',
          mimeType,
          buffer,
          kind: 'video',
        });
        latestProject = saved.updatedProject;

        if (sid && fid) {
          const seqIdx = latestProject.sequences.findIndex((s) => s.id === sid);
          if (seqIdx !== -1) {
            const seq = latestProject.sequences[seqIdx];
            const updatedFrames = seq.storyboardFrames.map((fr) =>
              fr.id === fid ? { ...fr, videoUrl: saved.asset.url } : fr
            );
            latestProject = {
              ...latestProject,
              sequences: latestProject.sequences.map((s, idx) =>
                idx === seqIdx
                  ? { ...s, storyboardFrames: updatedFrames, updatedAt: new Date().toISOString() }
                  : s
              ),
              updatedAt: new Date().toISOString(),
            };
            writeProjectFolder(userId, latestProject);
          }
        } else if (sid && !fid && !tbid) {
          const seqIdx = latestProject.sequences.findIndex((s) => s.id === sid);
          if (seqIdx !== -1) {
            const seq = latestProject.sequences[seqIdx];
            const newCard: StoryboardCard = {
              id: `sb-clip-${Date.now().toString(36)}`,
              title: clipTitle || `Clip ${providerLabel} (${cleanRatio} · ${videoDuration})`,
              shotRef: `Clip ${seq.storyboardFrames.length + 1}`,
              aspectRatio: cleanRatio,
              cameraSpec: `${seq.cameraSystem} · ${videoDuration} · ${cleanRatio}`,
              videoUrl: saved.asset.url,
              visualPrompt: motionPrompt,
              veoMotionPrompt: motionPrompt,
            };
            latestProject = {
              ...latestProject,
              sequences: latestProject.sequences.map((s, idx) =>
                idx === seqIdx
                  ? {
                      ...s,
                      storyboardFrames: [newCard, ...s.storyboardFrames],
                      updatedAt: new Date().toISOString(),
                    }
                  : s
              ),
              updatedAt: new Date().toISOString(),
            };
            writeProjectFolder(userId, latestProject);
          }
        } else if (tbid && latestProject.trailer) {
          latestProject = {
            ...latestProject,
            trailer: {
              ...latestProject.trailer,
              beats: latestProject.trailer.beats.map((b) =>
                b.id === tbid ? { ...b, videoUrl: saved.asset.url } : b
              ),
            },
            updatedAt: new Date().toISOString(),
          };
          writeProjectFolder(userId, latestProject);
        }

        return { videoUrl: saved.asset.url, project: latestProject };
      }

      if (asyncJob === false) {
        const result = await executeVideoGeneration(
          userId,
          {
            prompt: motionPrompt,
            aspectRatio: cleanRatio,
            duration: videoDuration,
            sourceImage,
          },
          WORKSPACE_DIR
        );
        const done = await persistVideoBuffer(
          result.buffer,
          result.mimeType,
          result.providerLabel
        );
        res.json({
          status: 'completed',
          videoUrl: done.videoUrl,
          model: result.model,
          provider: result.providerLabel,
          tier: result.tier,
          project: done.project,
        });
        return;
      }

      const jobId = `vjob-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      const jobRecord: VideoJobState = {
        jobId,
        userId,
        projectId: pid,
        status: 'pending',
        createdAt: Date.now(),
      };
      videoJobs.set(jobId, jobRecord);

      void (async () => {
        try {
          const result = await executeVideoGeneration(
            userId,
            {
              prompt: motionPrompt,
              aspectRatio: cleanRatio,
              duration: videoDuration,
              sourceImage,
            },
            WORKSPACE_DIR
          );
          const done = await persistVideoBuffer(
            result.buffer,
            result.mimeType,
            result.providerLabel
          );
          videoJobs.set(jobId, {
            ...jobRecord,
            status: 'completed',
            videoUrl: done.videoUrl,
            project: done.project,
          });
        } catch (bgErr) {
          const classifiedBg = classifyGeminiApiError(
            bgErr,
            'Error ejecutando la API de video configurada.'
          );
          videoJobs.set(jobId, {
            ...jobRecord,
            status: 'failed',
            error: classifiedBg.message,
          });
        }
      })();

      res.status(202).json({
        jobId,
        status: 'pending',
        model: videoProvider.model || videoProvider.label,
        provider: videoProvider.label,
        tier: videoProvider.tier,
      });
    } catch (error) {
      const classified = classifyGeminiApiError(error, 'Error generando el video.');
      logClassifiedRouteError('/api/generate-video', classified);
      res.status(classified.status).json({
        error: classified.message,
        ...(classified.needsApiConfig ? { needsApiConfig: classified.needsApiConfig } : {}),
      });
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
      const report = safeParseModelJson<AudioAnalysisReport>(
        raw,
        'El análisis de audio devolvió un JSON inválido.'
      );
      if (!report.transcription && verbatimTranscript) {
        report.transcription = verbatimTranscript;
      }

      res.json({ report, project: activeProject });
    } catch (error) {
      const classified = classifyGeminiApiError(error, 'Error analizando el archivo de audio.');
      logClassifiedRouteError('/api/analyze-audio', classified);
      res.status(classified.status).json({ error: classified.message });
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

      const parsed = safeParseModelJson<{
        chapters?: Array<{
          index: number;
          title: string;
          summary: string;
          keyCharacters: string[];
          estimatedStartHint: string;
          sourceExcerpt: string;
        }>;
      }>(raw, 'La estructura de capítulos no devolvió JSON válido.');

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
      const classified = classifyGeminiApiError(
        error,
        'Error analizando los capítulos del material.'
      );
      logClassifiedRouteError('/api/analyze-chapters', classified);
      res.status(classified.status).json({ error: classified.message });
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

      const isAdminProd = isVerifiedAdminRequest(req);
      const adminProfile = ensureAdminAgentProfile();
      const useFrameoIa = isAdminProd && adminProfile.frameoIaEnabled !== false;
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

      const frameoAdminDirective = useFrameoIa
        ? `\nMOTOR DE PRODUCCIÓN ADMINISTRADOR: FRAMEO IA (${adminProfile.frameoIaStylePreset || 'Frameo IA Cinema 4K'} · clips de ${adminProfile.frameoIaClipDurationSec || 5}s):
Genera todos los prompts visuales, movimientos de cámara, continuidad de personajes y bloques de narración/diálogo optimizados para producción directa en Frameo IA.`
        : '';

      const promptText = `PRODUCCIÓN ACTIVA: ${project.title}
SECUENCIA / CAPÍTULO: ${sequenceTitle}
TIPO DE MATERIAL FUENTE: ${sourceType === 'audiobook' ? 'Audiolibro / Relato Narrado' : sourceType === 'book' ? 'Libro / Manuscrito Literario' : 'Historia Original / Sinopsis'}
ESTILO CINEMATOGRÁFICO OBJETIVO: ${directorStyle}
RELACIÓN DE ASPECTO OBJETIVO: ${aspectRatio}
RESOLUCIÓN Y ULTRA DEFINICIÓN OBJETIVO: ${targetResolution} (${resolutionSpec})
${chapterDirective}
${frameoAdminDirective}

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
          systemInstruction: buildEffectiveProducerInstruction(lessons, { isAdmin: isAdminProd }),
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

      const parsed = safeParseModelJson<Record<string, any>>(
        rawJson,
        'El motor cinematográfico devolvió una estructura JSON incompleta.'
      );

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
        productionEngine: useFrameoIa ? 'frameo_ia' : 'standard',
        createdAt: now,
        updatedAt: now,
      };

      if (useFrameoIa) {
        createdSequence.frameoProductionSpec = buildFrameoProductionSpecForSequence({
          project,
          sequence: createdSequence,
          profile: adminProfile,
        });
      }

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
      const classified = classifyGeminiApiError(error, 'Error inesperado al producir la secuencia.');
      logClassifiedRouteError('/api/produce', classified);
      res.status(classified.status).json({ error: classified.message });
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
      const classified = classifyGeminiApiError(error, 'Error generando la voz en off realista.');
      logClassifiedRouteError('/api/generate-voiceover', classified);
      res.status(classified.status).json({ error: classified.message });
    }
  });

  // 30-Second Cinematic Trailer Generator (based on Continuity Bible + Approved Sequences)
  app.post('/api/generate-trailer', async (req, res) => {
    try {
      const userId = getRequestUserId(req);
      const {
        projectId,
        tone,
        targetResolution,
        voicePreset,
        autoApproveSequenceId,
      } = req.body ?? {};
      const pid = String(projectId || '').trim();
      if (!pid) {
        res.status(400).json({ error: 'Falta el identificador del proyecto.' });
        return;
      }

      let project = readProjectById(userId, pid);
      if (!project) {
        res.status(404).json({ error: 'Proyecto no encontrado.' });
        return;
      }

      let approvedSequences = project.sequences.filter(
        (seq) => seq.versionStatus === 'final'
      );

      // Optional 1-click auto-approve when user initiates trailer directly from a draft sequence
      if (
        approvedSequences.length === 0 &&
        typeof autoApproveSequenceId === 'string' &&
        autoApproveSequenceId.trim()
      ) {
        const targetId = autoApproveSequenceId.trim();
        const targetIdx = project.sequences.findIndex((s) => s.id === targetId);
        if (targetIdx !== -1) {
          const finalizedSeq: ProductionSequence = {
            ...project.sequences[targetIdx],
            versionStatus: 'final',
            updatedAt: new Date().toISOString(),
          };
          project = {
            ...project,
            sequences: project.sequences.map((s, idx) =>
              idx === targetIdx ? finalizedSeq : s
            ),
            updatedAt: new Date().toISOString(),
          };
          writeProjectFolder(userId, project);
          approvedSequences = [finalizedSeq];
        }
      }

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
          systemInstruction: buildEffectiveProducerInstruction(ensureLearningMemory(userId), {
            isAdmin: isVerifiedAdminRequest(req),
          }),
          responseMimeType: 'application/json',
          responseSchema: TRAILER_RESPONSE_SCHEMA,
          thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
        },
      });

      const raw = (response.text ?? '').trim();
      if (!raw) {
        throw new Error('El Agente Director no devolvió el diseño del tráiler.');
      }
      const parsed = safeParseModelJson<Record<string, any>>(
        raw,
        'El Agente Director devolvió una estructura de tráiler inválida.'
      );

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
      const classified = classifyGeminiApiError(
        error,
        'Error generando el tráiler cinematográfico.'
      );
      logClassifiedRouteError('/api/generate-trailer', classified);
      res.status(classified.status).json({ error: classified.message });
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
        config: {
          responseModalities: [Modality.AUDIO],
        },
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
      const classified = classifyGeminiApiError(error, 'Error generando música de 30s con Lyria.');
      logClassifiedRouteError('/api/generate-trailer-music', classified);
      res.status(classified.status).json({ error: classified.message });
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
          systemInstruction: buildEffectiveProducerInstruction(lessons, {
            isAdmin: isVerifiedAdminRequest(req),
          }),
          responseMimeType: 'application/json',
          responseSchema: STORYBOARD_4_FRAMES_SCHEMA,
          thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
        },
      });

      const raw = (dirResponse.text ?? '').trim();
      if (!raw) {
        throw new Error('El Agente Director no devolvió los 4 frames de storyboard.');
      }

      const parsed = safeParseModelJson<{ frames?: Array<Partial<StoryboardCard>> }>(
        raw,
        'El Agente Director devolvió una lista de storyboard inválida.'
      );
      const normalizedFrames = normalizeFourKeyStoryboardFrames(
        Array.isArray(parsed.frames) ? parsed.frames : [],
        {
          sequence,
          resolution: targetRes,
        }
      );

      const shouldRenderImages = renderImages !== false;
      const imageWarnings: string[] = [];
      let renderedCount = 0;

      if (shouldRenderImages) {
        const finalFrames: StoryboardCard[] = [];
        for (const frame of normalizedFrames) {
          try {
            const generated = await executeImageGeneration(
              userId,
              {
                prompt: frame.visualPrompt,
                aspectRatio: sequence.aspectRatio || '16:9',
                resolution: targetRes,
              },
              WORKSPACE_DIR
            );
            const ext =
              generated.mimeType.includes('jpeg') || generated.mimeType.includes('jpg')
                ? '.jpg'
                : generated.mimeType.includes('webp')
                  ? '.webp'
                  : '.png';
            const saved = saveGeneratedAssetBuffer(userId, project, {
              baseName: `sb4-${frame.id}-${targetRes}`,
              ext,
              mimeType: generated.mimeType,
              buffer: generated.buffer,
              kind: 'image',
            });
            project = saved.updatedProject;
            renderedCount += 1;
            finalFrames.push({ ...frame, imageUrl: saved.asset.url });
          } catch (imgErr) {
            const classifiedImg = classifyGeminiApiError(imgErr, 'Error renderizando frame');
            imageWarnings.push(`${frame.title}: ${classifiedImg.message}`);
            finalFrames.push(frame);
            if (classifiedImg.isBillingOrPermission || classifiedImg.needsApiConfig) {
              const currentIndex = normalizedFrames.indexOf(frame);
              for (const remaining of normalizedFrames.slice(currentIndex + 1)) {
                finalFrames.push(remaining);
              }
              break;
            }
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
      const classified = classifyGeminiApiError(
        error,
        'Error auto-generando los 4 frames de storyboard.'
      );
      logClassifiedRouteError('/api/generate-storyboard-frames', classified);
      res.status(classified.status).json({ error: classified.message });
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

  const httpServer = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (request, socket, head) => {
    const rawUrl = request.url || '/';
    const url = new URL(rawUrl, `http://${request.headers.host || 'localhost'}`);
    if (url.pathname === '/api/live-voice') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    }
  });

  wss.on('connection', async (ws: WebSocket, req) => {
    const reqUrl = new URL(req.url || '/api/live-voice', 'http://localhost');
    const projectTitle = reqUrl.searchParams.get('projectTitle') || 'AUTEUR Studio';
    const sequenceTitle = reqUrl.searchParams.get('sequenceTitle') || 'Secuencia Activa';
    const directorStyle = reqUrl.searchParams.get('directorStyle') || 'Cinematográfico';
    const voicePreset = normalizeVoicePreset(reqUrl.searchParams.get('voicePreset') || 'Charon');
    const continuityBible = (reqUrl.searchParams.get('continuityBible') || '').slice(0, 1800);

    let session: Awaited<ReturnType<GoogleGenAI['live']['connect']>> | null = null;
    try {
      const ai = getGenAIClient();
      session = await ai.live.connect({
        model: 'gemini-3.8-live',
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: voicePreset },
            },
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          systemInstruction: `Eres el Agente Director y Productor Ejecutivo de AUTEUR Studio conversando en tiempo real por voz con el cineasta sobre la película "${projectTitle}" (Secuencia activa: "${sequenceTitle}", Estilo: ${directorStyle}).
Contexto de Biblia de Continuidad: ${continuityBible || 'Sin notas previas.'}
Habla en español natural, directo, práctico y cinematográfico. Guía al usuario paso a paso (1. Proyecto y Biblia -> 2. Ingesta y Producción -> 3. Guion y Notas al Pie -> 4. Storyboard / Pre-Vis 3D / Omni Flash -> 5. Aprobar Versión Final -> 6. Tráiler 30s y PDF) y da sugerencias concretas de cámara, luz Kelvin, diálogos y montaje.`,
        },
        callbacks: {
          onopen: () => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ ready: true }));
            }
          },
          onmessage: (msg) => {
            if (ws.readyState !== WebSocket.OPEN) return;
            const sc = msg.serverContent;
            if (!sc) return;

            if (sc.interrupted) {
              ws.send(JSON.stringify({ interrupted: true }));
            }
            if (sc.inputTranscription?.text) {
              ws.send(JSON.stringify({ inputTranscript: sc.inputTranscription.text }));
            }
            if (sc.outputTranscription?.text) {
              ws.send(JSON.stringify({ outputTranscript: sc.outputTranscription.text }));
            }
            if (sc.modelTurn?.parts) {
              for (const part of sc.modelTurn.parts) {
                if (part.inlineData?.data) {
                  ws.send(
                    JSON.stringify({
                      audio: part.inlineData.data,
                      mimeType: part.inlineData.mimeType || 'audio/pcm;rate=24000',
                    })
                  );
                }
              }
            }
            if (sc.turnComplete) {
              ws.send(JSON.stringify({ turnComplete: true }));
            }
          },
          onerror: (err) => {
            if (ws.readyState === WebSocket.OPEN) {
              const classified = classifyGeminiApiError(err, 'Error en sesión de voz en vivo.');
              ws.send(JSON.stringify({ error: classified.message }));
            }
          },
          onclose: () => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.close();
            }
          },
        },
      });
    } catch (err) {
      if (ws.readyState === WebSocket.OPEN) {
        const classified = classifyGeminiApiError(
          err,
          'No se pudo conectar con Gemini Live (gemini-3.8-live).'
        );
        ws.send(JSON.stringify({ error: classified.message }));
        ws.close();
      }
      return;
    }

    ws.on('message', (raw) => {
      if (!session) return;
      try {
        const msg = JSON.parse(raw.toString()) as { audio?: string; text?: string };
        if (typeof msg.audio === 'string' && msg.audio.length > 0) {
          session.sendRealtimeInput({
            audio: { data: msg.audio, mimeType: 'audio/pcm;rate=16000' },
          });
        } else if (typeof msg.text === 'string' && msg.text.trim()) {
          session.sendClientContent({
            turns: [{ role: 'user', parts: [{ text: msg.text.trim() }] }],
            turnComplete: true,
          });
        }
      } catch {
        // Ignore malformed WS message
      }
    });

    ws.on('close', () => {
      try {
        session?.close();
      } catch {
        // Ignore close errors
      }
    });
  });

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`AUTEUR Studio server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
