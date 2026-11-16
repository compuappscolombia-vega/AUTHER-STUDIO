import { useState, useRef } from 'react';
import { BookOpen, Headphones, Sparkles, Upload, X, Save, Check } from 'lucide-react';
import type {
  ProductionProject,
  SourceMaterialType,
  ThinkingDepth,
} from '../types/studio';
import {
  ASPECT_RATIO_OPTIONS,
  DIRECTOR_STYLES,
  validateSequenceInput,
} from '../utils/studioLogic';

interface SourceIngestPanelProps {
  project: ProductionProject;
  isProducing: boolean;
  errorMessage: string | null;
  onDismissError: () => void;
  onSaveContinuity: (bible: string) => Promise<void>;
  onProduce: (formData: FormData) => Promise<void>;
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
    hint: 'Archivo MP3, WAV, M4A u OGG (análisis nativo de voz y ritmo)',
  },
  {
    id: 'story',
    label: 'Historia',
    icon: Sparkles,
    hint: 'Relato corto, escaleta o idea original',
  },
];

export function SourceIngestPanel({
  project,
  isProducing,
  errorMessage,
  onDismissError,
  onSaveContinuity,
  onProduce,
}: SourceIngestPanelProps) {
  const [sourceType, setSourceType] = useState<SourceMaterialType>(
    project.defaultSourceType || 'book'
  );
  const [sequenceTitle, setSequenceTitle] = useState('');
  const [directorStyle, setDirectorStyle] = useState(DIRECTOR_STYLES[0].label);
  const [aspectRatio, setAspectRatio] = useState<string>('2.39:1');
  const [thinkingDepth, setThinkingDepth] = useState<ThinkingDepth>('standard');
  const [sourceText, setSourceText] = useState('');
  const [continuityBible, setContinuityBible] = useState(project.continuityBible || '');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [savingBible, setSavingBible] = useState(false);
  const [savedBibleOk, setSavedBibleOk] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Sync continuity bible when switching projects
  const [lastProjectId, setLastProjectId] = useState(project.id);
  if (project.id !== lastProjectId) {
    setLastProjectId(project.id);
    setSourceType(project.defaultSourceType || 'book');
    setContinuityBible(project.continuityBible || '');
    setValidationError(null);
    setSelectedFile(null);
  }

  async function handleSaveBible() {
    setSavingBible(true);
    try {
      await onSaveContinuity(continuityBible);
      setSavedBibleOk(true);
      setTimeout(() => setSavedBibleOk(false), 1800);
    } finally {
      setSavingBible(false);
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
    fd.append('thinkingDepth', thinkingDepth);
    fd.append('sourceText', sourceText.trim());
    fd.append('continuityBible', continuityBible.trim());
    if (selectedFile) {
      fd.append('sourceFile', selectedFile);
    }

    await onProduce(fd);
    setSequenceTitle('');
    setSourceText('');
    setSelectedFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }

  const activeSourceMeta = SOURCE_TYPES.find((s) => s.id === sourceType) || SOURCE_TYPES[0];

  return (
    <section
      aria-label="Mesa de ingesta y dirección"
      className="w-full xl:w-[340px] shrink-0 border-b xl:border-b-0 xl:border-r border-white/10 bg-[#0F0F14] p-4 overflow-y-auto"
    >
      <div className="mb-3">
        <h2 className="font-display text-base font-semibold text-[#F2F0EB]">
          Ingesta y Dirección
        </h2>
        <p className="text-xs text-[#8D8981] mt-0.5">
          Convierte cualquier libro, audiolibro o relato en producción cinematográfica.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-3">
        {/* Source Type Segmented Control */}
        <div>
          <span className="block text-xs font-medium text-[#C8C3BA] mb-1.5">
            Tipo de material fuente
          </span>
          <div className="grid grid-cols-3 gap-1 p-1 rounded-lg bg-[#09090C] border border-white/10">
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
                      ? 'bg-[#1D1D26] text-[#F2F0EB] border border-white/10'
                      : 'text-[#8D8981] hover:text-[#E6E2DA]'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5 shrink-0" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>
          <p className="text-[11px] text-[#7D7971] mt-1.5">{activeSourceMeta.hint}</p>
        </div>

        {/* File Upload */}
        <div>
          <label
            htmlFor="source-file-upload"
            className="block text-xs font-medium text-[#C8C3BA] mb-1.5"
          >
            Archivo adjunto (opcional si escribes abajo)
          </label>
          <input
            ref={fileInputRef}
            id="source-file-upload"
            type="file"
            accept=".pdf,.txt,.md,.fountain,.mp3,.wav,.m4a,.ogg,.aac,.flac,.webm"
            onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
            className="sr-only"
          />
          {selectedFile ? (
            <div className="flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg border border-[#E5A93C]/40 bg-[#1A1814] text-xs text-[#F2F0EB]">
              <span className="truncate font-mono-tech">{selectedFile.name}</span>
              <button
                type="button"
                onClick={() => {
                  setSelectedFile(null);
                  if (fileInputRef.current) fileInputRef.current.value = '';
                }}
                aria-label="Quitar archivo adjunto"
                className="p-1 rounded hover:bg-white/10 text-[#C8C3BA]"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border border-dashed border-white/15 bg-[#0B0B0E] hover:border-[#E5A93C]/50 text-xs font-medium text-[#C8C3BA] transition-colors"
            >
              <Upload className="w-3.5 h-3.5 text-[#E5A93C]" />
              <span>Cargar PDF, TXT o Audio (MP3 / WAV / M4A)</span>
            </button>
          )}
        </div>

        {/* Sequence Title */}
        <div>
          <label
            htmlFor="sequence-title-input"
            className="block text-xs font-medium text-[#C8C3BA] mb-1.5"
          >
            Título del capítulo o secuencia
          </label>
          <input
            id="sequence-title-input"
            type="text"
            value={sequenceTitle}
            onChange={(e) => setSequenceTitle(e.target.value)}
            placeholder="Ej: Capítulo VII: Los Gigantes y las Enseñanzas"
            className="w-full rounded-lg border border-white/12 bg-[#0B0B0E] px-3 py-2 text-xs text-[#F2F0EB] placeholder:text-[#6E6A63] focus:border-[#E5A93C] focus:outline-none"
          />
        </div>

        {/* Director Style + Aspect Ratio */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-1 gap-3">
          <div>
            <label
              htmlFor="director-style-select"
              className="block text-xs font-medium text-[#C8C3BA] mb-1.5"
            >
              Estilo y firma cinematográfica
            </label>
            <select
              id="director-style-select"
              value={directorStyle}
              onChange={(e) => setDirectorStyle(e.target.value)}
              className="w-full rounded-lg border border-white/12 bg-[#0B0B0E] px-3 py-2 text-xs text-[#F2F0EB] focus:border-[#E5A93C] focus:outline-none"
            >
              {DIRECTOR_STYLES.map((style) => (
                <option key={style.id} value={style.label}>
                  {style.label} ({style.references})
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label
                htmlFor="aspect-ratio-select"
                className="block text-xs font-medium text-[#C8C3BA] mb-1.5"
              >
                Formato
              </label>
              <select
                id="aspect-ratio-select"
                value={aspectRatio}
                onChange={(e) => setAspectRatio(e.target.value)}
                className="w-full rounded-lg border border-white/12 bg-[#0B0B0E] px-2.5 py-2 text-xs text-[#F2F0EB] font-mono-tech focus:border-[#E5A93C] focus:outline-none"
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
                className="block text-xs font-medium text-[#C8C3BA] mb-1.5"
              >
                Análisis
              </label>
              <select
                id="thinking-depth-select"
                value={thinkingDepth}
                onChange={(e) => setThinkingDepth(e.target.value as ThinkingDepth)}
                className="w-full rounded-lg border border-white/12 bg-[#0B0B0E] px-2.5 py-2 text-xs text-[#F2F0EB] focus:border-[#E5A93C] focus:outline-none"
              >
                <option value="standard">Estándar</option>
                <option value="deep">Profundo</option>
              </select>
            </div>
          </div>
        </div>

        {/* Source Text */}
        <div>
          <label
            htmlFor="source-text-input"
            className="block text-xs font-medium text-[#C8C3BA] mb-1"
          >
            Texto fuente, notas o guion previo
          </label>
          <textarea
            id="source-text-input"
            rows={3}
            value={sourceText}
            onChange={(e) => setSourceText(e.target.value)}
            placeholder="Pega aquí el capítulo del libro, la historia original o notas complementarias al audiolibro..."
            className="w-full rounded-lg border border-white/12 bg-[#0B0B0E] p-2.5 text-xs text-[#E6E2DA] leading-relaxed placeholder:text-[#6E6A63] focus:border-[#E5A93C] focus:outline-none resize-y"
          />
        </div>

        {/* Continuity Bible */}
        <div className="pt-2 border-t border-white/10">
          <div className="flex items-center justify-between mb-1">
            <label
              htmlFor="continuity-bible-input"
              className="text-xs font-medium text-[#C8C3BA]"
            >
              Biblia de continuidad del proyecto
            </label>
            <button
              type="button"
              onClick={handleSaveBible}
              disabled={savingBible}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-[#E5A93C] hover:text-[#F4C46A] disabled:opacity-50"
            >
              {savedBibleOk ? (
                <>
                  <Check className="w-3 h-3" />
                  <span>Guardada</span>
                </>
              ) : (
                <>
                  <Save className="w-3 h-3" />
                  <span>{savingBible ? 'Guardando...' : 'Guardar biblia'}</span>
                </>
              )}
            </button>
          </div>
          <textarea
            id="continuity-bible-input"
            rows={2}
            value={continuityBible}
            onChange={(e) => setContinuityBible(e.target.value)}
            placeholder="Reglas de continuidad acumuladas entre capítulos..."
            className="w-full rounded-lg border border-white/12 bg-[#0B0B0E] p-2 text-xs text-[#A7A299] leading-relaxed focus:border-[#E5A93C] focus:outline-none resize-y"
          />
        </div>

        {(validationError || errorMessage) && (
          <div
            role="alert"
            className="rounded-lg border border-[#EF4444]/35 bg-[#3B1515]/50 px-3 py-2.5 text-xs text-[#FCA5A5] leading-relaxed"
          >
            {validationError || errorMessage}
          </div>
        )}

        <button
          type="submit"
          disabled={isProducing}
          className="w-full py-2.5 px-4 rounded-lg bg-[#E5A93C] hover:bg-[#EDA949] disabled:opacity-60 text-[#0B0B0E] text-xs font-semibold transition-colors whitespace-nowrap"
        >
          {isProducing ? 'Dirigiendo producción...' : 'Dirigir secuencia'}
        </button>
      </form>
    </section>
  );
}
