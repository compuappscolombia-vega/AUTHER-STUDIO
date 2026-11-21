import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AudioLines,
  BookOpen,
  Check,
  CheckCircle2,
  Headphones,
  ListOrdered,
  Lock,
  Mic,
  Play,
  Save,
  Sparkles,
  Square,
  Upload,
  X,
} from 'lucide-react';
import type {
  AudioAnalysisReport,
  BookChapterItem,
  ProductionProject,
  ResolutionTier,
  SourceMaterialType,
  StudioSettings,
  ThinkingDepth,
} from '../types/studio';
import {
  RESOLUTION_OPTIONS,
  appendDictatedText,
  getSequentialChapterState,
} from '../utils/productionPipeline';
import {
  ASPECT_RATIO_OPTIONS,
  DIRECTOR_STYLES,
  validateSequenceInput,
} from '../utils/studioLogic';

interface SourceIngestPanelProps {
  userId: string;
  project: ProductionProject;
  studioSettings: StudioSettings;
  isProducing: boolean;
  errorMessage: string | null;
  onDismissError: () => void;
  onSaveContinuity: (bible: string) => Promise<void>;
  onProduce: (formData: FormData) => Promise<ProductionProject | null>;
  onAnalyzeAudioOnly: (projectId: string, file: File) => Promise<AudioAnalysisReport>;
  onAnalyzeChapters: (formData: FormData) => Promise<ProductionProject | null>;
}

const SOURCE_TYPES: {
  id: SourceMaterialType;
  label: string;
  icon: typeof BookOpen;
  hint: string;
}[] = [
  {
    id: 'book',
    label: 'Libro / PDF',
    icon: BookOpen,
    hint: 'Capítulo en texto o archivo PDF / TXT / MD',
  },
  {
    id: 'audiobook',
    label: 'Audiolibro',
    icon: Headphones,
    hint: 'Archivo MP3, WAV, M4A u OGG (transcripción + informe sonoro)',
  },
  {
    id: 'story',
    label: 'Historia',
    icon: Sparkles,
    hint: 'Relato corto, escaleta o idea original',
  },
];

function isAudioFile(file: File | null): boolean {
  if (!file) return false;
  return /\.(mp3|wav|m4a|ogg|aac|flac|webm)$/i.test(file.name);
}

export function SourceIngestPanel({
  userId,
  project,
  studioSettings,
  isProducing,
  errorMessage,
  onDismissError,
  onSaveContinuity,
  onProduce,
  onAnalyzeAudioOnly,
  onAnalyzeChapters,
}: SourceIngestPanelProps) {
  const [sourceType, setSourceType] = useState<SourceMaterialType>(
    project.defaultSourceType || 'book'
  );
  const [sequenceTitle, setSequenceTitle] = useState('');
  const [directorStyle, setDirectorStyle] = useState(
    studioSettings.defaultDirectorStyle || DIRECTOR_STYLES[0].label
  );
  const [aspectRatio, setAspectRatio] = useState<string>(
    studioSettings.defaultAspectRatio || '2.39:1'
  );
  const [targetResolution, setTargetResolution] = useState<ResolutionTier>(
    studioSettings.defaultResolution || '4K'
  );
  const [thinkingDepth, setThinkingDepth] = useState<ThinkingDepth>(
    studioSettings.defaultThinkingDepth || 'standard'
  );
  const [sourceText, setSourceText] = useState('');
  const [continuityBible, setContinuityBible] = useState(project.continuityBible || '');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [savingBible, setSavingBible] = useState(false);
  const [savedBibleOk, setSavedBibleOk] = useState(false);
  const [analyzingAudio, setAnalyzingAudio] = useState(false);
  const [analyzingChapters, setAnalyzingChapters] = useState(false);
  const [quickAudioReport, setQuickAudioReport] = useState<AudioAnalysisReport | null>(null);
  const [autoProducingChapters, setAutoProducingChapters] = useState(false);

  // Microphone Dictation State
  const [recordingTarget, setRecordingTarget] = useState<'bible' | 'source' | null>(null);
  const [transcribingTarget, setTranscribingTarget] = useState<'bible' | 'source' | null>(null);
  const [micStatusMsg, setMicStatusMsg] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const stopAutoChaptersRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [lastProjectId, setLastProjectId] = useState(project.id);
  if (project.id !== lastProjectId) {
    setLastProjectId(project.id);
    setSourceType(project.defaultSourceType || 'book');
    setContinuityBible(project.continuityBible || '');
    setValidationError(null);
    setSelectedFile(null);
    setQuickAudioReport(null);
  }

  useEffect(() => {
    setContinuityBible(project.continuityBible || '');
  }, [project.id, project.continuityBible]);

  useEffect(() => {
    setTargetResolution(studioSettings.defaultResolution);
    setDirectorStyle(studioSettings.defaultDirectorStyle);
    setAspectRatio(studioSettings.defaultAspectRatio);
    setThinkingDepth(studioSettings.defaultThinkingDepth);
  }, [studioSettings]);

  useEffect(() => {
    return () => {
      stopAutoChaptersRef.current = true;
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
      mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const audioPreviewUrl = useMemo(() => {
    if (selectedFile && isAudioFile(selectedFile)) {
      return URL.createObjectURL(selectedFile);
    }
    return null;
  }, [selectedFile]);

  useEffect(() => {
    return () => {
      if (audioPreviewUrl) {
        URL.revokeObjectURL(audioPreviewUrl);
      }
    };
  }, [audioPreviewUrl]);

  async function handleSaveBible(textOverride?: string) {
    setSavingBible(true);
    try {
      await onSaveContinuity(textOverride ?? continuityBible);
      setSavedBibleOk(true);
      setTimeout(() => setSavedBibleOk(false), 1800);
    } finally {
      setSavingBible(false);
    }
  }

  async function toggleDictation(target: 'bible' | 'source') {
    setValidationError(null);
    setMicStatusMsg(null);

    // Stop active recording
    if (recordingTarget === target && mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      setRecordingTarget(null);
      return;
    }

    // Ignore if another recording is active
    if (recordingTarget && mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      setRecordingTarget(null);
      return;
    }

    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === 'undefined'
    ) {
      setValidationError(
        'Tu navegador no soporta grabación de micrófono en este contexto.'
      );
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      audioChunksRef.current = [];

      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) {
          audioChunksRef.current.push(ev.data);
        }
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        mediaStreamRef.current = null;
        mediaRecorderRef.current = null;

        const blob = new Blob(audioChunksRef.current, {
          type: recorder.mimeType || 'audio/webm',
        });
        if (blob.size < 200) {
          setValidationError('La grabación fue demasiado corta para transcribir.');
          return;
        }

        setTranscribingTarget(target);
        try {
          const fd = new FormData();
          fd.append('audio', blob, 'dictation.webm');
          const res = await fetch('/api/transcribe-dictation', {
            method: 'POST',
            headers: { 'x-user-id': userId },
            body: fd,
          });
          const data = await res.json();
          if (!res.ok) {
            throw new Error(data.error || 'Error transcribiendo el audio del micrófono.');
          }
          const transcript = String(data.transcript || '').trim();
          if (transcript) {
            if (target === 'bible') {
              const nextBible = appendDictatedText(continuityBible, transcript);
              setContinuityBible(nextBible);
              await handleSaveBible(nextBible);
              setMicStatusMsg('Nota dictada añadida a la Biblia de continuidad.');
            } else {
              setSourceText((prev) => appendDictatedText(prev, transcript));
              setMicStatusMsg('Historia dictada añadida al material fuente.');
            }
          }
        } catch (err) {
          setValidationError(
            err instanceof Error
              ? err.message
              : 'No se pudo transcribir la nota de voz.'
          );
        } finally {
          setTranscribingTarget(null);
        }
      };

      recorder.start();
      setRecordingTarget(target);
    } catch (err) {
      setValidationError(
        err instanceof Error && err.name === 'NotAllowedError'
          ? 'Permiso de micrófono denegado. Habilita el micrófono en tu navegador para dictar.'
          : 'No se pudo acceder al micrófono del dispositivo.'
      );
    }
  }

  async function handleQuickAudioAnalysis() {
    if (!selectedFile || !isAudioFile(selectedFile)) return;
    setAnalyzingAudio(true);
    setValidationError(null);
    onDismissError();
    try {
      const report = await onAnalyzeAudioOnly(project.id, selectedFile);
      setQuickAudioReport(report);
      if (report.transcription && !sourceText.trim()) {
        setSourceText(report.transcription);
      }
    } catch (err) {
      setValidationError(
        err instanceof Error ? err.message : 'No se pudo analizar el archivo de audio.'
      );
    } finally {
      setAnalyzingAudio(false);
    }
  }

  async function handlePlanChapters() {
    setValidationError(null);
    onDismissError();
    if (!selectedFile && sourceText.trim().length < 40) {
      setValidationError(
        'Adjunta un libro (PDF/TXT) o audiolibro, o pega el contenido completo para dividirlo capítulo a capítulo.'
      );
      return;
    }

    setAnalyzingChapters(true);
    try {
      const fd = new FormData();
      fd.append('projectId', project.id);
      fd.append('sourceType', sourceType);
      if (sourceText.trim()) fd.append('sourceText', sourceText.trim());
      if (selectedFile) fd.append('sourceFile', selectedFile);
      await onAnalyzeChapters(fd);
    } catch (err) {
      setValidationError(
        err instanceof Error ? err.message : 'Error planificando capítulos 1 a 1.'
      );
    } finally {
      setAnalyzingChapters(false);
    }
  }

  async function produceSingleChapter(
    chapter: BookChapterItem,
    activeProj: ProductionProject
  ): Promise<ProductionProject | null> {
    const plan = activeProj.chapterPlan;
    if (!plan) return null;

    const fd = new FormData();
    fd.append('projectId', activeProj.id);
    fd.append('sequenceTitle', `Cap. ${chapter.index}: ${chapter.title}`);
    fd.append('sourceType', plan.sourceType || sourceType);
    fd.append('directorStyle', directorStyle);
    fd.append('aspectRatio', aspectRatio);
    fd.append('targetResolution', targetResolution);
    fd.append('thinkingDepth', thinkingDepth);
    fd.append('continuityBible', activeProj.continuityBible || continuityBible);
    if (plan.sourceAssetId) {
      fd.append('sourceAssetId', plan.sourceAssetId);
    }
    fd.append('chapterIndex', String(chapter.index));
    fd.append('chapterTotal', String(plan.chapters.length));
    fd.append('chapterSummary', chapter.summary);
    fd.append(
      'sourceText',
      `${chapter.sourceExcerpt}\n\nSinopsis del capítulo: ${chapter.summary}\nPersonajes clave: ${chapter.keyCharacters.join(', ')}`
    );

    return onProduce(fd);
  }

  async function handleProduceNextChapter() {
    const state = getSequentialChapterState(project.chapterPlan);
    if (!state.nextChapter) return;
    setValidationError(null);
    onDismissError();
    await produceSingleChapter(state.nextChapter, project);
  }

  async function handleAutoProduceAllChapters() {
    if (!project.chapterPlan) return;
    stopAutoChaptersRef.current = false;
    setAutoProducingChapters(true);
    setValidationError(null);
    onDismissError();

    let workingProject = project;
    try {
      while (!stopAutoChaptersRef.current) {
        const state = getSequentialChapterState(workingProject.chapterPlan);
        if (!state.nextChapter) break;
        const updated = await produceSingleChapter(state.nextChapter, workingProject);
        if (!updated) break;
        workingProject = updated;
      }
    } finally {
      setAutoProducingChapters(false);
      stopAutoChaptersRef.current = false;
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setValidationError(null);
    onDismissError();

    const check = validateSequenceInput({
      sequenceTitle,
      sourceText,
      hasFile: Boolean(selectedFile),
    });

    if (!check.valid) {
      setValidationError(check.errors.join(' '));
      return;
    }

    const fd = new FormData();
    fd.append('projectId', project.id);
    fd.append('sequenceTitle', sequenceTitle.trim());
    fd.append('sourceType', sourceType);
    fd.append('directorStyle', directorStyle);
    fd.append('aspectRatio', aspectRatio);
    fd.append('targetResolution', targetResolution);
    fd.append('thinkingDepth', thinkingDepth);
    fd.append('sourceText', sourceText.trim());
    fd.append('continuityBible', continuityBible.trim());
    if (selectedFile) {
      fd.append('sourceFile', selectedFile);
    }

    const updated = await onProduce(fd);
    if (updated) {
      setSequenceTitle('');
      setSourceText('');
      setSelectedFile(null);
      setQuickAudioReport(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  }

  const activeSourceMeta = SOURCE_TYPES.find((s) => s.id === sourceType) || SOURCE_TYPES[0];
  const fileIsAudio = isAudioFile(selectedFile);
  const chapterState = getSequentialChapterState(project.chapterPlan);

  return (
    <section
      aria-label="Mesa de ingesta y dirección"
      className="w-full xl:w-[355px] shrink-0 border-b xl:border-b-0 xl:border-r border-[#E2DDD3] dark:border-white/10 bg-[#FAF8F4] dark:bg-[#0F0F14] p-4 overflow-y-auto"
    >
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <h2 className="font-display text-base font-semibold text-[#18181B] dark:text-[#F2F0EB]">
            Ingesta y Dirección
          </h2>
          <p className="text-xs text-[#57534E] dark:text-[#8D8981] mt-0.5">
            Convierte libros, audio o relatos dictados en producción 720p–4K.
          </p>
        </div>
        {(project.assets?.length || 0) > 0 && (
          <span className="text-[11px] font-mono-tech text-[#57534E] dark:text-[#8D8981] whitespace-nowrap tabular-nums">
            {project.assets?.length} assets
          </span>
        )}
      </div>

      <form onSubmit={handleSubmit} className="space-y-3">
        {/* Source Type Segmented Control */}
        <div>
          <span className="block text-xs font-medium text-[#3F3F46] dark:text-[#C8C3BA] mb-1.5">
            Tipo de material fuente
          </span>
          <div className="grid grid-cols-3 gap-1 p-1 rounded-lg bg-[#EFECE5] dark:bg-[#09090C] border border-[#DCD6CA] dark:border-white/10">
            {SOURCE_TYPES.map((item) => {
              const Icon = item.icon;
              const active = sourceType === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSourceType(item.id)}
                  className={`flex items-center justify-center gap-1.5 px-2 py-2 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                    active
                      ? 'bg-[#FFFFFF] dark:bg-[#1D1D26] text-[#18181B] dark:text-[#F2F0EB] border border-[#D4CEC2] dark:border-white/10 shadow-xs dark:shadow-none'
                      : 'text-[#57534E] dark:text-[#8D8981] hover:text-[#18181B] dark:hover:text-[#E6E2DA]'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5 shrink-0" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>
          <p className="text-[11px] text-[#57534E] dark:text-[#7D7971] mt-1">{activeSourceMeta.hint}</p>
        </div>

        {/* File Upload */}
        <div>
          <label
            htmlFor="source-file-upload"
            className="block text-xs font-medium text-[#3F3F46] dark:text-[#C8C3BA] mb-1.5"
          >
            Archivo adjunto (PDF, TXT o Audio)
          </label>
          <input
            ref={fileInputRef}
            id="source-file-upload"
            type="file"
            accept=".pdf,.txt,.md,.fountain,.mp3,.wav,.m4a,.ogg,.aac,.flac,.webm"
            onChange={(e) => {
              const file = e.target.files?.[0] || null;
              setSelectedFile(file);
              setQuickAudioReport(null);
              if (file && isAudioFile(file)) {
                setSourceType('audiobook');
              }
            }}
            className="sr-only"
          />
          {selectedFile ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-[#E5A93C]/50 bg-amber-50 dark:bg-[#1A1814] text-xs text-[#18181B] dark:text-[#F2F0EB]">
                <span className="truncate font-mono-tech">{selectedFile.name}</span>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedFile(null);
                    setQuickAudioReport(null);
                    if (fileInputRef.current) fileInputRef.current.value = '';
                  }}
                  aria-label="Quitar archivo adjunto"
                  className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/10 text-[#3F3F46] dark:text-[#C8C3BA]"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              {audioPreviewUrl && (
                <div className="space-y-2 p-2.5 rounded-lg border border-[#DCD6CA] dark:border-white/10 bg-[#FFFFFF] dark:bg-[#0B0B0E]">
                  <audio controls src={audioPreviewUrl} className="w-full h-8" />
                  <button
                    type="button"
                    onClick={handleQuickAudioAnalysis}
                    disabled={analyzingAudio || isProducing}
                    className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md border border-[#E5A93C]/50 bg-amber-50 hover:bg-amber-100 dark:bg-[#1B1812] dark:hover:bg-[#252016] text-[11px] font-medium text-amber-800 dark:text-[#E5A93C] disabled:opacity-60"
                  >
                    <AudioLines className="w-3.5 h-3.5" />
                    <span>
                      {analyzingAudio
                        ? 'Transcribiendo y analizando...'
                        : 'Pre-analizar audio y transcribir'}
                    </span>
                  </button>
                </div>
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-dashed border-[#C7C1B5] dark:border-white/15 bg-[#FFFFFF] dark:bg-[#0B0B0E] hover:border-[#E5A93C] text-xs font-medium text-[#3F3F46] dark:text-[#C8C3BA] transition-colors"
            >
              <Upload className="w-3.5 h-3.5 text-amber-600 dark:text-[#E5A93C]" />
              <span>Cargar PDF, TXT o Audio (MP3 / WAV / M4A / OGG)</span>
            </button>
          )}

          {/* Plan Book / Audiobook Chapters 1-by-1 */}
          {(sourceType === 'book' || sourceType === 'audiobook') && (
            <button
              type="button"
              onClick={handlePlanChapters}
              disabled={analyzingChapters || isProducing || autoProducingChapters}
              className="mt-2 w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-teal-600/35 dark:border-[#38B2AC]/40 bg-teal-50 hover:bg-teal-100 dark:bg-[#102121] dark:hover:bg-[#152D2D] disabled:opacity-60 text-[11px] font-medium text-teal-800 dark:text-[#5EEAD4]"
            >
              <ListOrdered className="w-3.5 h-3.5 shrink-0" />
              <span>
                {analyzingChapters
                  ? 'Extrayendo capítulos en orden...'
                  : 'Planificar capítulos 1 a 1 (Libro / Audio)'}
              </span>
            </button>
          )}
        </div>

        {/* Sequential 1-by-1 Chapter Pipeline */}
        {project.chapterPlan && project.chapterPlan.chapters.length > 0 && (
          <div className="p-3 rounded-lg border border-[#DCD6CA] dark:border-white/10 bg-[#FFFFFF] dark:bg-[#0B0B0E] space-y-2.5">
            <div className="flex items-center justify-between gap-2 text-[11px]">
              <span className="font-semibold text-[#18181B] dark:text-[#F2F0EB] flex items-center gap-1.5">
                <ListOrdered className="w-3.5 h-3.5 text-amber-600 dark:text-[#E5A93C]" />
                <span>Producción 1 a 1 ({chapterState.completedCount}/{chapterState.totalCount})</span>
              </span>
              <span className="font-mono-tech text-[#57534E] dark:text-[#8D8981] truncate max-w-[120px]">
                {project.chapterPlan.sourceFilename}
              </span>
            </div>

            <div className="max-h-40 overflow-y-auto space-y-1.5 pr-0.5">
              {project.chapterPlan.chapters.map((ch) => {
                const isDone = ch.status === 'completed';
                const isNext = chapterState.nextChapter?.index === ch.index;
                return (
                  <div
                    key={ch.index}
                    className={`px-2.5 py-2 rounded-md border text-[11px] flex items-start justify-between gap-2 ${
                      isDone
                        ? 'border-teal-600/30 dark:border-[#38B2AC]/30 bg-teal-50/70 dark:bg-[#0E1D1D] text-[#27272A] dark:text-[#D4CFC7]'
                        : isNext
                          ? 'border-[#E5A93C]/55 bg-amber-50 dark:bg-[#1A160E] text-[#18181B] dark:text-[#F2F0EB]'
                          : 'border-[#E2DDD3] dark:border-white/5 bg-[#F5F3EE] dark:bg-[#121217] text-[#57534E] dark:text-[#7D7971]'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="font-semibold truncate">
                        {ch.index}. {ch.title}
                      </div>
                      <div className="text-[10px] opacity-80 line-clamp-1">
                        {ch.summary}
                      </div>
                    </div>
                    <span className="shrink-0 pt-0.5">
                      {isDone ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-teal-700 dark:text-[#38B2AC]" />
                      ) : isNext ? (
                        <Play className="w-3.5 h-3.5 text-amber-600 dark:text-[#E5A93C]" />
                      ) : (
                        <Lock className="w-3 h-3 text-[#78746C] dark:text-[#6E6A63]" />
                      )}
                    </span>
                  </div>
                );
              })}
            </div>

            {!chapterState.isComplete && chapterState.nextChapter ? (
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={handleProduceNextChapter}
                  disabled={isProducing || autoProducingChapters}
                  className="px-2.5 py-1.5 rounded-md bg-[#E5A93C] hover:bg-[#EDA949] disabled:opacity-60 text-[#0B0B0E] text-[11px] font-semibold truncate"
                >
                  {isProducing
                    ? `Produciendo ${chapterState.nextChapter.index}...`
                    : `Producir Cap. ${chapterState.nextChapter.index}`}
                </button>
                {autoProducingChapters ? (
                  <button
                    type="button"
                    onClick={() => {
                      stopAutoChaptersRef.current = true;
                    }}
                    className="inline-flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-md border border-red-300 dark:border-[#EF4444]/40 bg-red-50 dark:bg-[#2E1313] text-red-700 dark:text-[#FCA5A5] text-[11px] font-medium"
                  >
                    <Square className="w-3 h-3" />
                    <span>Pausar cola</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleAutoProduceAllChapters}
                    disabled={isProducing}
                    className="inline-flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-md border border-teal-600/35 dark:border-[#38B2AC]/40 bg-teal-50 hover:bg-teal-100 dark:bg-[#102625] dark:hover:bg-[#163433] disabled:opacity-60 text-teal-800 dark:text-[#5EEAD4] text-[11px] font-medium"
                  >
                    <Play className="w-3 h-3" />
                    <span>Auto 1 a 1</span>
                  </button>
                )}
              </div>
            ) : (
              <div className="text-[11px] text-teal-700 dark:text-[#5EEAD4] font-medium">
                Todos los capítulos producidos en orden cronológico.
              </div>
            )}
          </div>
        )}

        {quickAudioReport && (
          <div className="p-3 rounded-lg border border-teal-600/35 dark:border-[#38B2AC]/35 bg-teal-50 dark:bg-[#101F1F] space-y-1.5 text-[11px]">
            <div className="font-semibold text-teal-800 dark:text-[#5EEAD4]">
              Pre-análisis sonoro completado
            </div>
            <p className="text-[#27272A] dark:text-[#D4CFC7]">
              <strong className="text-[#18181B] dark:text-[#F2F0EB]">Narración:</strong>{' '}
              {quickAudioReport.narrationStyle}
            </p>
            <p className="text-[#27272A] dark:text-[#D4CFC7]">
              <strong className="text-[#18181B] dark:text-[#F2F0EB]">Ritmo:</strong>{' '}
              {quickAudioReport.rhythmAndPacing}
            </p>
          </div>
        )}

        {/* Sequence Title */}
        <div>
          <label
            htmlFor="sequence-title-input"
            className="block text-xs font-medium text-[#3F3F46] dark:text-[#C8C3BA] mb-1"
          >
            Título del capítulo o secuencia
          </label>
          <input
            id="sequence-title-input"
            type="text"
            value={sequenceTitle}
            onChange={(e) => setSequenceTitle(e.target.value)}
            placeholder={
              fileIsAudio
                ? 'Ej: Escena Sonora: La Llamada Nocturna'
                : 'Ej: Capítulo I: La Llegada al Puerto'
            }
            className="w-full rounded-lg border border-[#D6D1C7] dark:border-white/12 bg-[#FFFFFF] dark:bg-[#0B0B0E] px-3 py-2 text-xs text-[#18181B] dark:text-[#F2F0EB] placeholder:text-[#78746C] dark:placeholder:text-[#6E6A63] focus:border-[#E5A93C] focus:outline-none"
          />
        </div>

        {/* Director Style + Aspect Ratio + Resolution + Depth */}
        <div className="space-y-2.5">
          <div>
            <label
              htmlFor="director-style-select"
              className="block text-xs font-medium text-[#3F3F46] dark:text-[#C8C3BA] mb-1"
            >
              Estilo y firma cinematográfica
            </label>
            <select
              id="director-style-select"
              value={directorStyle}
              onChange={(e) => setDirectorStyle(e.target.value)}
              className="w-full rounded-lg border border-[#D6D1C7] dark:border-white/12 bg-[#FFFFFF] dark:bg-[#0B0B0E] px-3 py-2 text-xs text-[#18181B] dark:text-[#F2F0EB] focus:border-[#E5A93C] focus:outline-none"
            >
              {DIRECTOR_STYLES.map((style) => (
                <option key={style.id} value={style.label}>
                  {style.label} ({style.references})
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div>
              <label
                htmlFor="resolution-tier-select"
                className="block text-xs font-medium text-[#3F3F46] dark:text-[#C8C3BA] mb-1"
              >
                Definición
              </label>
              <select
                id="resolution-tier-select"
                value={targetResolution}
                onChange={(e) => setTargetResolution(e.target.value as ResolutionTier)}
                className="w-full rounded-lg border border-[#D6D1C7] dark:border-white/12 bg-[#FFFFFF] dark:bg-[#0B0B0E] px-2 py-2 text-xs font-mono-tech font-medium text-amber-700 dark:text-[#E5A93C] focus:border-[#E5A93C] focus:outline-none"
              >
                {RESOLUTION_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.value}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="aspect-ratio-select"
                className="block text-xs font-medium text-[#3F3F46] dark:text-[#C8C3BA] mb-1"
              >
                Formato
              </label>
              <select
                id="aspect-ratio-select"
                value={aspectRatio}
                onChange={(e) => setAspectRatio(e.target.value)}
                className="w-full rounded-lg border border-[#D6D1C7] dark:border-white/12 bg-[#FFFFFF] dark:bg-[#0B0B0E] px-2 py-2 text-xs text-[#18181B] dark:text-[#F2F0EB] font-mono-tech focus:border-[#E5A93C] focus:outline-none"
              >
                {ASPECT_RATIO_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.value}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="thinking-depth-select"
                className="block text-xs font-medium text-[#3F3F46] dark:text-[#C8C3BA] mb-1"
              >
                Análisis
              </label>
              <select
                id="thinking-depth-select"
                value={thinkingDepth}
                onChange={(e) => setThinkingDepth(e.target.value as ThinkingDepth)}
                className="w-full rounded-lg border border-[#D6D1C7] dark:border-white/12 bg-[#FFFFFF] dark:bg-[#0B0B0E] px-2 py-2 text-xs text-[#18181B] dark:text-[#F2F0EB] focus:border-[#E5A93C] focus:outline-none"
              >
                <option value="standard">Estándar</option>
                <option value="deep">Profundo</option>
              </select>
            </div>
          </div>
        </div>

        {/* Source Text + Microphone Dictation */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label
              htmlFor="source-text-input"
              className="text-xs font-medium text-[#3F3F46] dark:text-[#C8C3BA]"
            >
              Texto fuente, historia o dictado
            </label>
            <button
              type="button"
              onClick={() => toggleDictation('source')}
              disabled={transcribingTarget === 'source'}
              aria-label="Dictar historia por micrófono"
              className={`inline-flex items-center gap-1 text-[11px] font-medium transition-colors ${
                recordingTarget === 'source'
                  ? 'text-red-600 dark:text-[#FCA5A5]'
                  : 'text-amber-700 hover:text-amber-800 dark:text-[#E5A93C] dark:hover:text-[#F4C46A]'
              }`}
            >
              {recordingTarget === 'source' ? (
                <>
                  <Square className="w-3 h-3 fill-current" />
                  <span>Detener dictado</span>
                </>
              ) : (
                <>
                  <Mic className="w-3 h-3" />
                  <span>
                    {transcribingTarget === 'source' ? 'Transcribiendo...' : 'Dictar historia'}
                  </span>
                </>
              )}
            </button>
          </div>
          <textarea
            id="source-text-input"
            rows={3}
            value={sourceText}
            onChange={(e) => setSourceText(e.target.value)}
            placeholder="Pega el capítulo, escribe tu historia o usa el micrófono para dictar una nueva historia..."
            className="w-full rounded-lg border border-[#D6D1C7] dark:border-white/12 bg-[#FFFFFF] dark:bg-[#0B0B0E] p-2.5 text-xs text-[#18181B] dark:text-[#E6E2DA] leading-relaxed placeholder:text-[#78746C] dark:placeholder:text-[#6E6A63] focus:border-[#E5A93C] focus:outline-none resize-y"
          />
        </div>

        {/* Continuity Bible + Direct Microphone Dictation */}
        <div className="pt-2 border-t border-[#E2DDD3] dark:border-white/10">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
            <label
              htmlFor="continuity-bible-input"
              className="text-xs font-medium text-[#3F3F46] dark:text-[#C8C3BA]"
            >
              Biblia de continuidad
            </label>
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={() => toggleDictation('bible')}
                disabled={transcribingTarget === 'bible'}
                aria-label="Dictar nota de dirección a la Biblia de continuidad"
                className={`inline-flex items-center gap-1 text-[11px] font-medium transition-colors ${
                  recordingTarget === 'bible'
                    ? 'text-red-600 dark:text-[#FCA5A5]'
                    : 'text-teal-700 hover:text-teal-800 dark:text-[#5EEAD4] dark:hover:text-[#99F6E4]'
                }`}
              >
                {recordingTarget === 'bible' ? (
                  <>
                    <Square className="w-3 h-3 fill-current" />
                    <span>Detener micro</span>
                  </>
                ) : (
                  <>
                    <Mic className="w-3 h-3" />
                    <span>
                      {transcribingTarget === 'bible' ? 'Transcribiendo...' : 'Dictar a Biblia'}
                    </span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => handleSaveBible()}
                disabled={savingBible}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-700 hover:text-amber-800 dark:text-[#E5A93C] dark:hover:text-[#F4C46A] disabled:opacity-50"
              >
                {savedBibleOk ? (
                  <>
                    <Check className="w-3 h-3" />
                    <span>Guardada</span>
                  </>
                ) : (
                  <>
                    <Save className="w-3 h-3" />
                    <span>{savingBible ? 'Guardando...' : 'Guardar'}</span>
                  </>
                )}
              </button>
            </div>
          </div>
          <textarea
            id="continuity-bible-input"
            rows={2}
            value={continuityBible}
            onChange={(e) => setContinuityBible(e.target.value)}
            placeholder="Reglas visuales y notas de dirección dictadas por micrófono o acumuladas..."
            className="w-full rounded-lg border border-[#D6D1C7] dark:border-white/12 bg-[#FFFFFF] dark:bg-[#0B0B0E] p-2 text-xs text-[#27272A] dark:text-[#A7A299] leading-relaxed placeholder:text-[#78746C] dark:placeholder:text-[#6E6A63] focus:border-[#E5A93C] focus:outline-none resize-y"
          />
          {micStatusMsg && (
            <p className="mt-1 text-[11px] text-teal-700 dark:text-[#5EEAD4]">{micStatusMsg}</p>
          )}
        </div>

        {(validationError || errorMessage) && (
          <div
            role="alert"
            className="rounded-lg border border-red-300 dark:border-[#EF4444]/35 bg-red-50 dark:bg-[#3B1515]/50 px-3 py-2 text-xs text-red-700 dark:text-[#FCA5A5] leading-relaxed"
          >
            {validationError || errorMessage}
          </div>
        )}

        <button
          type="submit"
          disabled={isProducing || analyzingAudio || analyzingChapters || autoProducingChapters}
          className="w-full py-2.5 px-4 rounded-lg bg-[#E5A93C] hover:bg-[#EDA949] disabled:opacity-60 text-[#0B0B0E] text-xs font-semibold transition-colors whitespace-nowrap"
        >
          {isProducing ? 'Dirigiendo producción...' : `Dirigir secuencia (${targetResolution})`}
        </button>
      </form>
    </section>
  );
}
