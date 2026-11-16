import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { fileURLToPath } from 'url';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import { SEED_PROJECTS } from './src/data/seedProjects';
import type {
  ProductionProject,
  ProductionSequence,
  SourceMaterialType,
} from './src/types/studio';
import { buildContinuationContext } from './src/utils/studioLogic';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const WORKSPACE_DIR = path.resolve(__dirname, 'workspace');
const PROJECTS_FILE = path.join(WORKSPACE_DIR, 'projects.json');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 24 * 1024 * 1024 },
});

function ensureWorkspace(): ProductionProject[] {
  if (!fs.existsSync(WORKSPACE_DIR)) {
    fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
  }
  if (!fs.existsSync(PROJECTS_FILE)) {
    fs.writeFileSync(PROJECTS_FILE, JSON.stringify(SEED_PROJECTS, null, 2), 'utf-8');
    return SEED_PROJECTS;
  }
  try {
    const raw = fs.readFileSync(PROJECTS_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as ProductionProject[];
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : SEED_PROJECTS;
  } catch {
    return SEED_PROJECTS;
  }
}

function saveProjects(projects: ProductionProject[]): void {
  if (!fs.existsSync(WORKSPACE_DIR)) {
    fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
  }
  fs.writeFileSync(PROJECTS_FILE, JSON.stringify(projects, null, 2), 'utf-8');
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

const PRODUCER_SYSTEM_INSTRUCTION = `Eres AUTEUR, un Productor y Director de Cine de Hollywood mundialmente reconocido y premiado en los Premios Óscar, Cannes y Venecia.
Tu sello personal es convertir cualquier material fuente —capítulos de libros, audiolibros narrados, relatos cortos o sinopsis— en una producción cinematográfica monumental de clase mundial.

REGLAS DE ORO DE PRODUCCIÓN:
1. FIDELIDAD ABSOLUTA AL MATERIAL FUENTE: Respeta los eventos, nombres propios, tono emocional, diálogos clave y atmósfera de la obra proporcionada. Si recibes un archivo de audio (audiolibro/relato narrado), escucha no solo las palabras sino el ritmo, pausas, inflexiones y tensión dramática de la narración para traducirlo a lenguaje audiovisual.
2. DIRECCIÓN DE FOTOGRAFÍA REAL: Especifica cuerpos de cámara reales (ARRI Alexa 65, Panavision Millennium DXL2, RED V-Raptor XL, Sony VENICE 2), ópticas concretas (Cooke Anamorphic, Panavision Sphero 65, Leitz Summilux-C), distancias focales en mm y movimientos motivados (Technocrane, Steadicam, Dolly-in).
3. ILUMINACIÓN Y COLORIMETRÍA: Define fuentes principales, ratios de contraste, temperaturas Kelvin exactas (ej. 2700K vs 5800K), atmósfera/humo y paleta de color con códigos hexadecimales reales.
4. INGENIERÍA SONORA DOLBY ATMOS: Diseña capas ambientales, frecuencias subgraves concretas (Hz), foley hiperrealista, silencios dramáticos y score musical con tempo en BPM.
5. GUION CINEMATOGRÁFICO PROFESIONAL: Redacta escenas completas en español con sluglines estándar (EXT./INT. LOCACIÓN - MOMENTO DEL DÍA), beats de acción visual pura ("Show, don't tell"), indicaciones técnicas de cámara y sonido, y diálogos con acotaciones precisas.
6. STORYBOARD PROMPTS: Para cada tarjeta de storyboard, escribe tanto el prompt visual detallado en inglés (para motores de imagen 65mm) como el prompt de movimiento de cámara en inglés (para motores de video como Veo).`;

const PRODUCTION_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    cameraSystem: { type: Type.STRING },
    lensPackage: { type: Type.STRING },
    filmStockOrLut: { type: Type.STRING },
    logline: { type: Type.STRING },
    directorVision: { type: Type.STRING },
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
    'colorPalette',
    'lighting',
    'shotList',
    'soundDesign',
    'vfx',
    'screenplay',
    'storyboardFrames',
    'continuitySummary',
  ],
};

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

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '4mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.get('/api/projects', (_req, res) => {
    const projects = ensureWorkspace();
    res.json({ projects });
  });

  app.post('/api/projects', (req, res) => {
    const { title, genreStyle, defaultSourceType, continuityBible } = req.body ?? {};
    if (!title || typeof title !== 'string' || !title.trim()) {
      res.status(400).json({ error: 'El título del proyecto es obligatorio.' });
      return;
    }
    const projects = ensureWorkspace();
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
      createdAt: now,
      updatedAt: now,
      sequences: [],
    };
    const updated = [newProject, ...projects];
    saveProjects(updated);
    res.status(201).json({ project: newProject });
  });

  app.patch('/api/projects/:id', (req, res) => {
    const { id } = req.params;
    const { title, genreStyle, continuityBible } = req.body ?? {};
    const projects = ensureWorkspace();
    const idx = projects.findIndex((p) => p.id === id);
    if (idx === -1) {
      res.status(404).json({ error: 'Proyecto no encontrado.' });
      return;
    }
    const existing = projects[idx];
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
    projects[idx] = updatedProject;
    saveProjects(projects);
    res.json({ project: updatedProject });
  });

  app.delete('/api/projects/:id', (req, res) => {
    const { id } = req.params;
    const projects = ensureWorkspace();
    const filtered = projects.filter((p) => p.id !== id);
    if (filtered.length === projects.length) {
      res.status(404).json({ error: 'Proyecto no encontrado.' });
      return;
    }
    saveProjects(filtered);
    res.json({ ok: true });
  });

  app.post('/api/produce', upload.single('sourceFile'), async (req, res) => {
    try {
      const body = req.body ?? {};
      const projectId = String(body.projectId || '').trim();
      const sequenceTitle = String(body.sequenceTitle || '').trim();
      const sourceType = (String(body.sourceType || 'book').trim() || 'book') as SourceMaterialType;
      const directorStyle = String(body.directorStyle || 'Épica Monumental IMAX').trim();
      const aspectRatio = String(body.aspectRatio || '2.39:1').trim();
      const thinkingDepth = String(body.thinkingDepth || 'standard').trim();
      const continuityBible = String(body.continuityBible || '').trim();
      let sourceText = String(body.sourceText || '').trim();

      if (!projectId) {
        res.status(400).json({ error: 'Falta el identificador del proyecto.' });
        return;
      }
      if (!sequenceTitle) {
        res.status(400).json({ error: 'El título de la secuencia o capítulo es obligatorio.' });
        return;
      }

      const file = req.file;
      if (!file && sourceText.length < 20) {
        res.status(400).json({
          error:
            'Proporciona al menos 20 caracteres del texto fuente o adjunta un archivo PDF, TXT o audio.',
        });
        return;
      }

      const projects = ensureWorkspace();
      const projectIndex = projects.findIndex((p) => p.id === projectId);
      if (projectIndex === -1) {
        res.status(404).json({ error: 'Proyecto no encontrado en el estudio.' });
        return;
      }
      const project = projects[projectIndex];

      const ai = getGenAIClient();
      const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];

      let sourceFilename: string | undefined;
      if (file) {
        sourceFilename = file.originalname;
        const ext = path.extname(file.originalname).toLowerCase();
        if (ext === '.txt' || ext === '.md' || ext === '.fountain') {
          const decodedText = file.buffer.toString('utf-8');
          sourceText = sourceText
            ? `${sourceText}\n\n--- CONTENIDO DEL ARCHIVO (${file.originalname}) ---\n${decodedText}`
            : decodedText;
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

      const promptText = `PRODUCCIÓN ACTIVA: ${project.title}
SECUENCIA / CAPÍTULO: ${sequenceTitle}
TIPO DE MATERIAL FUENTE: ${sourceType === 'audiobook' ? 'Audiolibro / Relato Narrado' : sourceType === 'book' ? 'Libro / Manuscrito Literario' : 'Historia Original / Sinopsis'}
ESTILO CINEMATOGRÁFICO OBJETIVO: ${directorStyle}
RELACIÓN DE ASPECTO OBJETIVO: ${aspectRatio}

BIBLIA DE CONTINUIDAD DEL PROYECTO:
${continuityBible || project.continuityBible || 'Establecer el estándar visual y sonoro desde cero manteniendo coherencia de Hollywood.'}

MATERIAL FUENTE ESCRITO / NOTAS DEL CLIENTE:
${sourceText || '[El material fuente principal está adjunto como archivo binario PDF o Audio. Procésalo íntegramente.]'}

Genera el expediente completo de dirección en JSON estructurado siguiendo el esquema solicitado. Incluye al menos 4 planos en shotList, al menos 1 escena detallada con múltiples beats (action, camera, sound, dialogue) en screenplay, y 3 tarjetas de storyboardFrames.`;

      parts.push({ text: promptText });

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: { parts },
        config: {
          systemInstruction: PRODUCER_SYSTEM_INSTRUCTION,
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

      const createdSequence: ProductionSequence = {
        id: `seq-${Date.now().toString(36)}`,
        title: sequenceTitle,
        sourceType,
        sourceFilename,
        directorStyle,
        aspectRatio,
        cameraSystem: parsed.cameraSystem || 'ARRI Alexa 65',
        lensPackage: parsed.lensPackage || 'Cooke Anamorphic /i',
        filmStockOrLut: parsed.filmStockOrLut || 'Kodak 2383 Print LUT',
        logline: parsed.logline || '',
        directorVision: parsed.directorVision || '',
        colorPalette: Array.isArray(parsed.colorPalette) ? parsed.colorPalette : [],
        lighting: parsed.lighting,
        shotList: Array.isArray(parsed.shotList) ? parsed.shotList : [],
        soundDesign: parsed.soundDesign,
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
        createdAt: new Date().toISOString(),
      };

      const updatedBible = buildContinuationContext(
        continuityBible || project.continuityBible,
        sequenceTitle,
        createdSequence.continuitySummary
      );

      const updatedProject: ProductionProject = {
        ...project,
        continuityBible: updatedBible,
        updatedAt: new Date().toISOString(),
        sequences: [createdSequence, ...project.sequences],
      };

      projects[projectIndex] = updatedProject;
      saveProjects(projects);

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

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'custom',
    });
    app.use(vite.middlewares);

    app.use('*', async (req, res, next) => {
      if (req.originalUrl.startsWith('/api')) {
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
