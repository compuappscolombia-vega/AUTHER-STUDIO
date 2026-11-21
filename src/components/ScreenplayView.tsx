import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AudioLines,
  BookOpen,
  CheckCircle2,
  Download,
  FileCheck2,
  Keyboard,
  Lock,
  Maximize2,
  MessageSquarePlus,
  Minimize2,
  PanelRightClose,
  PanelRightOpen,
  Printer,
  RotateCcw,
  Trash2,
  Volume2,
} from 'lucide-react';
import type {
  ProductionProject,
  ProductionSequence,
  ScreenplayNote,
  ScreenplayNoteRole,
} from '../types/studio';
import {
  formatFountainScreenplay,
  formatScreenplayMarkdown,
} from '../utils/studioLogic';
import { canExportPdfForSequence } from '../utils/learningEngine';
import {
  type ReadingFontScale,
  buildBeatKey,
  computeScreenplayReadingStats,
  getBeatNotes,
  getReadingTypographyClasses,
  sortScreenplayNotes,
  validateScreenplayNote,
} from '../utils/screenplayReader';

interface ScreenplayViewProps {
  project: ProductionProject;
  sequence: ProductionSequence;
  isReadingMode: boolean;
  onToggleReadingMode: (next: boolean) => void;
  onExportSequencePdf: () => Promise<void>;
  exportingPdf: boolean;
  onAddNote: (payload: {
    beatKey: string;
    sceneNumber: string;
    beatIndex: number;
    beatType: 'action' | 'dialogue' | 'camera' | 'sound';
    lineExcerpt: string;
    authorRole: ScreenplayNoteRole;
    authorName: string;
    note: string;
  }) => Promise<void>;
  onToggleResolveNote: (noteId: string, resolved: boolean) => Promise<void>;
  onDeleteNote: (noteId: string) => Promise<void>;
  onOpenVoiceoverModal: (beatKey?: string) => void;
  onOpenShortcuts?: () => void;
}

function triggerDownload(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

const BEAT_TYPE_LABELS: Record<'action' | 'dialogue' | 'camera' | 'sound', string> = {
  action: 'Acción',
  dialogue: 'Diálogo',
  camera: 'Cámara',
  sound: 'Sonido',
};

export function ScreenplayView({
  project,
  sequence,
  isReadingMode,
  onToggleReadingMode,
  onExportSequencePdf,
  exportingPdf,
  onAddNote,
  onToggleResolveNote,
  onDeleteNote,
  onOpenVoiceoverModal,
  onOpenShortcuts,
}: ScreenplayViewProps) {
  const scenes = sequence.screenplay || [];
  const allNotes = useMemo(
    () => sortScreenplayNotes(sequence.screenplayNotes),
    [sequence.screenplayNotes]
  );

  const [fontScale, setFontScale] = useState<ReadingFontScale>('comfortable');
  const [showNotesSidebar, setShowNotesSidebar] = useState(true);
  const [notesScope, setNotesScope] = useState<'all' | 'selected'>('all');
  const [selectedBeat, setSelectedBeat] = useState<{
    beatKey: string;
    sceneNumber: string;
    beatIndex: number;
    beatType: 'action' | 'dialogue' | 'camera' | 'sound';
    lineExcerpt: string;
  } | null>(() => {
    const firstScene = scenes[0];
    const firstBeat = firstScene?.beats?.[0];
    if (!firstScene || !firstBeat) return null;
    return {
      beatKey: buildBeatKey(0, 0),
      sceneNumber: firstScene.sceneNumber,
      beatIndex: 0,
      beatType: firstBeat.type,
      lineExcerpt: firstBeat.text.slice(0, 120),
    };
  });

  const [authorRole, setAuthorRole] = useState<ScreenplayNoteRole>('director');
  const [authorName, setAuthorName] = useState('');
  const [noteText, setNoteText] = useState('');
  const [submittingNote, setSubmittingNote] = useState(false);
  const [busyNoteId, setBusyNoteId] = useState<string | null>(null);
  const [noteError, setNoteError] = useState<string | null>(null);

  const beatRefs = useRef<Record<string, HTMLElement | null>>({});

  useEffect(() => {
    const firstScene = scenes[0];
    const firstBeat = firstScene?.beats?.[0];
    setSelectedBeat(
      firstScene && firstBeat
        ? {
            beatKey: buildBeatKey(0, 0),
            sceneNumber: firstScene.sceneNumber,
            beatIndex: 0,
            beatType: firstBeat.type,
            lineExcerpt: firstBeat.text.slice(0, 120),
          }
        : null
    );
    setNoteError(null);
    setNoteText('');
  }, [sequence.id]);

  useEffect(() => {
    if (!isReadingMode) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
        onToggleReadingMode(false);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isReadingMode, onToggleReadingMode]);

  const slugSafe = sequence.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, '_')
    .replace(/^_+|_+$/g, '');

  const pdfAllowed = canExportPdfForSequence(sequence);
  const readingStats = useMemo(
    () => computeScreenplayReadingStats(scenes),
    [scenes]
  );

  const effectiveScale: ReadingFontScale = isReadingMode ? fontScale : 'normal';
  const typo = getReadingTypographyClasses(effectiveScale);

  const visibleNotes = useMemo(() => {
    if (notesScope === 'selected' && selectedBeat) {
      return allNotes.filter((n) => n.beatKey === selectedBeat.beatKey);
    }
    return allNotes;
  }, [allNotes, notesScope, selectedBeat]);

  function handleExportMarkdown() {
    const md = formatScreenplayMarkdown(project.title, sequence);
    triggerDownload(`${slugSafe || 'guion'}.md`, md, 'text/markdown;charset=utf-8');
  }

  function handleExportFountain() {
    const fountain = formatFountainScreenplay(project.title, sequence);
    triggerDownload(`${slugSafe || 'guion'}.fountain`, fountain, 'text/plain;charset=utf-8');
  }

  function selectAndFocusBeat(params: {
    beatKey: string;
    sceneNumber: string;
    beatIndex: number;
    beatType: 'action' | 'dialogue' | 'camera' | 'sound';
    lineExcerpt: string;
  }) {
    setSelectedBeat(params);
    setShowNotesSidebar(true);
    setNoteError(null);
    const el = beatRefs.current[params.beatKey];
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  async function handleSubmitNote(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedBeat) {
      setNoteError('Selecciona primero una línea de diálogo o acción en el guion.');
      return;
    }
    const validation = validateScreenplayNote({
      note: noteText,
      role: authorRole,
    });
    if (!validation.valid) {
      setNoteError(validation.error || 'Nota inválida.');
      return;
    }

    setSubmittingNote(true);
    setNoteError(null);
    try {
      await onAddNote({
        beatKey: selectedBeat.beatKey,
        sceneNumber: selectedBeat.sceneNumber,
        beatIndex: selectedBeat.beatIndex,
        beatType: selectedBeat.beatType,
        lineExcerpt: selectedBeat.lineExcerpt,
        authorRole,
        authorName:
          authorName.trim() ||
          (authorRole === 'producer' ? 'Productor Ejecutivo' : 'Director'),
        note: noteText.trim(),
      });
      setNoteText('');
    } catch (err) {
      setNoteError(
        err instanceof Error ? err.message : 'No se pudo guardar la nota al pie.'
      );
    } finally {
      setSubmittingNote(false);
    }
  }

  async function handleResolveToggle(note: ScreenplayNote) {
    setBusyNoteId(note.id);
    setNoteError(null);
    try {
      await onToggleResolveNote(note.id, !note.resolved);
    } catch (err) {
      setNoteError(err instanceof Error ? err.message : 'Error actualizando la nota.');
    } finally {
      setBusyNoteId(null);
    }
  }

  async function handleDelete(noteId: string) {
    setBusyNoteId(noteId);
    setNoteError(null);
    try {
      await onDeleteNote(noteId);
    } catch (err) {
      setNoteError(err instanceof Error ? err.message : 'Error eliminando la nota.');
    } finally {
      setBusyNoteId(null);
    }
  }

  return (
    <div
      className={
        isReadingMode
          ? 'fixed inset-0 z-40 bg-[#F5F3EE] dark:bg-[#0B0B0E] flex flex-col overflow-hidden'
          : 'space-y-5 max-w-7xl'
      }
    >
      {/* Toolbar */}
      <div
        className={`no-print flex flex-wrap items-center justify-between gap-3 ${
          isReadingMode
            ? 'px-6 py-3.5 border-b border-[#E2DDD3] dark:border-white/10 bg-[#FAF8F4] dark:bg-[#101015] shrink-0'
            : 'pb-4 border-b border-[#E2DDD3] dark:border-white/10'
        }`}
      >
        <div>
          <div className="flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-amber-600 dark:text-[#E5A93C]" />
            <h2 className="font-display text-lg font-semibold text-[#18181B] dark:text-[#F2F0EB]">
              {isReadingMode ? `${sequence.title} · Modo Lectura` : 'Guion Técnico-Literario'}
            </h2>
          </div>
          <p className="text-xs text-[#57534E] dark:text-[#8D8981] font-mono-tech mt-0.5 tabular-nums">
            {readingStats.sceneCount} escenas · {readingStats.wordCount} palabras (~
            {readingStats.estimatedMinutes} min) · {sequence.aspectRatio} ·{' '}
            <span className={pdfAllowed ? 'text-teal-700 dark:text-[#38B2AC] font-medium' : 'text-amber-700 dark:text-[#E5A93C] font-medium'}>
              {pdfAllowed ? 'Versión Final' : 'Borrador'}
            </span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {isReadingMode && (
            <div className="flex items-center gap-1 rounded-lg border border-[#DCD6CA] dark:border-white/12 bg-[#FFFFFF] dark:bg-[#14141B] p-1">
              {(
                [
                  { id: 'normal', label: 'Compacto' },
                  { id: 'comfortable', label: 'Cómodo' },
                  { id: 'large', label: 'Editorial' },
                ] as const
              ).map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => setFontScale(preset.id)}
                  className={`px-2 py-1 rounded text-[11px] font-medium whitespace-nowrap ${
                    fontScale === preset.id
                      ? 'bg-[#E5A93C] text-[#0B0B0E] font-semibold'
                      : 'text-[#3F3F46] hover:text-[#18181B] dark:text-[#C8C3BA] dark:hover:text-white'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          )}

          <button
            type="button"
            onClick={() => onToggleReadingMode(!isReadingMode)}
            aria-pressed={isReadingMode}
            className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-semibold whitespace-nowrap transition-colors ${
              isReadingMode
                ? 'border-teal-600/45 dark:border-[#38B2AC]/55 bg-teal-50 dark:bg-[#102625] text-teal-800 dark:text-[#5EEAD4] hover:bg-teal-100 dark:hover:bg-[#163433]'
                : 'border-[#E5A93C]/55 bg-amber-50 hover:bg-amber-100 dark:bg-[#1B1812] dark:hover:bg-[#272116] text-amber-800 dark:text-[#E5A93C]'
            }`}
          >
            {isReadingMode ? (
              <>
                <Minimize2 className="w-3.5 h-3.5" />
                <span>Salir de Lectura</span>
              </>
            ) : (
              <>
                <Maximize2 className="w-3.5 h-3.5" />
                <span>Modo Lectura</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={() => onOpenVoiceoverModal(selectedBeat?.beatKey)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-teal-600/35 dark:border-[#38B2AC]/45 bg-teal-50 hover:bg-teal-100 dark:bg-[#102625] dark:hover:bg-[#163433] text-xs font-medium text-teal-800 dark:text-[#5EEAD4] whitespace-nowrap"
          >
            <AudioLines className="w-3.5 h-3.5" />
            <span>Voz Provisional (TTS)</span>
          </button>

          <button
            type="button"
            onClick={() => setShowNotesSidebar((v) => !v)}
            aria-pressed={showNotesSidebar}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[#D6D1C7] dark:border-white/12 bg-[#FFFFFF] hover:bg-[#F1EFE9] dark:bg-[#14141B] dark:hover:bg-[#1C1C26] text-xs font-medium text-[#27272A] dark:text-[#E6E2DA] whitespace-nowrap"
          >
            {showNotesSidebar ? (
              <PanelRightClose className="w-3.5 h-3.5 text-amber-600 dark:text-[#E5A93C]" />
            ) : (
              <PanelRightOpen className="w-3.5 h-3.5 text-amber-600 dark:text-[#E5A93C]" />
            )}
            <span>Notas al pie ({allNotes.length})</span>
          </button>

          <button
            type="button"
            onClick={onExportSequencePdf}
            disabled={!pdfAllowed || exportingPdf}
            title={
              pdfAllowed
                ? 'Exportar bitácora completa en PDF con guion, VFX e ilustraciones'
                : 'Solo disponible cuando la secuencia está en Versión Final'
            }
            className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-medium whitespace-nowrap transition-colors ${
              pdfAllowed
                ? 'border-[#E5A93C]/50 bg-amber-50 hover:bg-amber-100 dark:bg-[#1B1812] dark:hover:bg-[#272116] text-[#18181B] dark:text-[#F2F0EB]'
                : 'border-[#E2DDD3] dark:border-white/10 bg-[#F1EFE9] dark:bg-[#121217] text-[#78746C] dark:text-[#6E6A63] cursor-not-allowed'
            }`}
          >
            {pdfAllowed ? (
              <FileCheck2 className="w-3.5 h-3.5 text-amber-600 dark:text-[#E5A93C]" />
            ) : (
              <Lock className="w-3.5 h-3.5 text-[#78746C] dark:text-[#6E6A63]" />
            )}
            <span>
              {exportingPdf
                ? 'Generando PDF...'
                : pdfAllowed
                  ? 'Bitácora PDF'
                  : 'PDF (Versión Final)'}
            </span>
          </button>

          <button
            type="button"
            onClick={handleExportMarkdown}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[#D6D1C7] dark:border-white/12 bg-[#FFFFFF] hover:bg-[#F1EFE9] dark:bg-[#14141B] dark:hover:bg-[#1C1C26] text-xs font-medium text-[#27272A] dark:text-[#E6E2DA] whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5 text-amber-600 dark:text-[#E5A93C]" />
            <span>Markdown</span>
          </button>
          <button
            type="button"
            onClick={handleExportFountain}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[#D6D1C7] dark:border-white/12 bg-[#FFFFFF] hover:bg-[#F1EFE9] dark:bg-[#14141B] dark:hover:bg-[#1C1C26] text-xs font-medium text-[#27272A] dark:text-[#E6E2DA] whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5 text-amber-600 dark:text-[#E5A93C]" />
            <span>Fountain</span>
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[#D6D1C7] dark:border-white/12 bg-[#FFFFFF] hover:bg-[#F1EFE9] dark:bg-[#14141B] dark:hover:bg-[#1C1C26] text-xs font-medium text-[#27272A] dark:text-[#E6E2DA] whitespace-nowrap"
          >
            <Printer className="w-3.5 h-3.5 text-amber-600 dark:text-[#E5A93C]" />
            <span>Imprimir</span>
          </button>

          {onOpenShortcuts && (
            <button
              type="button"
              onClick={onOpenShortcuts}
              aria-label="Ver atajos de teclado"
              title="Atajos de teclado (?)"
              className="inline-flex items-center gap-1.5 px-2.5 py-2 rounded-lg border border-[#D6D1C7] dark:border-white/12 bg-[#FFFFFF] hover:bg-[#F1EFE9] dark:bg-[#14141B] dark:hover:bg-[#1C1C26] text-xs font-medium text-[#27272A] dark:text-[#E6E2DA] whitespace-nowrap"
            >
              <Keyboard className="w-3.5 h-3.5 text-amber-600 dark:text-[#E5A93C]" />
              <span>Atajos</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Split Area: Screenplay Sheet + Exclusive Right Review Sidebar */}
      <div
        className={
          isReadingMode
            ? 'flex-1 flex flex-col lg:flex-row overflow-hidden'
            : 'flex flex-col lg:flex-row gap-6 items-start'
        }
      >
        {/* Screenplay Sheet */}
        <div
          className={
            isReadingMode
              ? 'flex-1 overflow-y-auto px-4 sm:px-10 py-8'
              : 'flex-1 min-w-0 w-full'
          }
        >
          <article
            className={`screenplay-print-sheet rounded-xl border border-[#DCD6CA] dark:border-white/10 bg-[#FFFFFF] dark:bg-[#121217] px-6 sm:px-12 py-10 font-mono-tech text-[#27272A] dark:text-[#E2DDD4] ${
              typo.sheetText
            } ${isReadingMode ? 'max-w-4xl mx-auto shadow-xl dark:shadow-2xl' : 'shadow-xs dark:shadow-none'}`}
          >
            <header className="mb-10 pb-6 border-b border-[#E2DDD3] dark:border-white/10 text-center space-y-1.5">
              <div className="text-sm font-semibold tracking-wider text-[#18181B] dark:text-[#F2F0EB]">
                {project.title.toUpperCase()}
              </div>
              <div className="text-xs text-amber-700 dark:text-[#E5A93C] font-medium">{sequence.title}</div>
              <div className="text-[11px] text-[#57534E] dark:text-[#8D8981]">
                {sequence.cameraSystem} · {sequence.aspectRatio} ·{' '}
                {pdfAllowed ? 'VERSIÓN FINAL' : 'BORRADOR'}
              </div>
              <p className="no-print text-[11px] text-[#57534E] dark:text-[#8D8981] pt-2">
                Haz clic en cualquier línea de diálogo o acción para vincular una Nota al pie de Director o Productor.
              </p>
            </header>

            <div className={`space-y-10 ${typo.measureClass} mx-auto`}>
              {scenes.map((scene, sceneIdx) => (
                <section
                  key={`${scene.sceneNumber}-${scene.slugline}-${sceneIdx}`}
                  className="space-y-4"
                >
                  <h3
                    className={`${typo.sceneHeading} font-semibold text-[#18181B] dark:text-[#F2F0EB] tracking-wide border-b border-[#E2DDD3] dark:border-white/10 pb-1.5`}
                  >
                    {scene.sceneNumber}. {scene.slugline}
                  </h3>

                  <div className={typo.spacingClass}>
                    {(scene.beats || []).map((beat, beatIdx) => {
                      const beatKey = buildBeatKey(sceneIdx, beatIdx);
                      const beatNotes = getBeatNotes(allNotes, beatKey);
                      const isSelected = selectedBeat?.beatKey === beatKey;
                      const unresolvedCount = beatNotes.filter((n) => !n.resolved).length;

                      const selectPayload = {
                        beatKey,
                        sceneNumber: scene.sceneNumber,
                        beatIndex: beatIdx,
                        beatType: beat.type,
                        lineExcerpt: beat.text.slice(0, 120),
                      };

                      return (
                        <div
                          key={beat.id || beatKey}
                          ref={(el) => {
                            beatRefs.current[beatKey] = el;
                          }}
                          className={`group relative rounded-lg px-3 py-2 -mx-3 transition-colors border ${
                            isSelected
                              ? 'border-[#E5A93C]/70 bg-amber-50 dark:bg-[#1B1810]'
                              : beatNotes.length > 0
                                ? 'border-[#DCD6CA] dark:border-white/10 bg-[#FAF8F4] dark:bg-[#16161E] hover:border-[#E5A93C]/45'
                                : 'border-transparent hover:border-[#DCD6CA] dark:hover:border-white/10 hover:bg-[#FAF8F4] dark:hover:bg-white/[0.02]'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <button
                              type="button"
                              onClick={() => selectAndFocusBeat(selectPayload)}
                              className="flex-1 min-w-0 text-left cursor-pointer focus-visible:outline-2 focus-visible:outline-[#E5A93C] rounded"
                            >
                              {beat.type === 'dialogue' ? (
                                <div
                                  className={`${typo.dialogueMeasureClass} mx-auto space-y-1 py-0.5 text-left`}
                                >
                                  <div className="text-center font-semibold text-[#18181B] dark:text-[#F2F0EB] tracking-wider">
                                    {(beat.character || 'PERSONAJE').toUpperCase()}
                                  </div>
                                  {beat.parenthetical && (
                                    <div className="text-center text-xs text-[#57534E] dark:text-[#9A968E]">
                                      ({beat.parenthetical})
                                    </div>
                                  )}
                                  <p className="text-[#18181B] dark:text-[#EAE6DE]">{beat.text}</p>
                                </div>
                              ) : beat.type === 'camera' ? (
                                <p className="text-[0.9em] text-amber-800 dark:text-[#E5A93C]">
                                  <span className="font-semibold">[CÁMARA]</span> {beat.text}
                                </p>
                              ) : beat.type === 'sound' ? (
                                <p className="text-[0.9em] text-sky-800 dark:text-[#9DB4CC]">
                                  <span className="font-semibold">[SONIDO]</span> {beat.text}
                                </p>
                              ) : (
                                <p className="text-[#27272A] dark:text-[#D4CFC7]">{beat.text}</p>
                              )}
                            </button>

                            <div className="no-print flex items-center gap-1.5 shrink-0 mt-0.5">
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedBeat(selectPayload);
                                  onOpenVoiceoverModal(beatKey);
                                }}
                                aria-label={`Generar voz provisional para Escena ${scene.sceneNumber} línea ${beatIdx + 1}`}
                                title="Previsualizar voz provisional (TTS)"
                                className={`p-1.5 rounded border border-[#D6D1C7] dark:border-white/10 bg-[#FFFFFF] dark:bg-[#0D0D12] text-[#57534E] dark:text-[#8D8981] hover:text-teal-700 dark:hover:text-[#5EEAD4] hover:border-teal-600/45 dark:hover:border-[#38B2AC]/45 transition-opacity ${
                                  isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus:opacity-100'
                                }`}
                              >
                                <Volume2 className="w-3.5 h-3.5" />
                              </button>

                              {beatNotes.length > 0 && (
                                <span
                                  className={`px-2 py-0.5 rounded font-mono-tech text-[10px] font-semibold tabular-nums ${
                                    unresolvedCount > 0
                                      ? 'bg-[#E5A93C] text-[#0B0B0E]'
                                      : 'bg-teal-50 dark:bg-[#102625] text-teal-800 dark:text-[#5EEAD4] border border-teal-600/35 dark:border-[#38B2AC]/35'
                                  }`}
                                  title={`${beatNotes.length} nota(s) al pie vinculadas`}
                                >
                                  [{beatNotes.length}]
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          </article>
        </div>

        {/* Exclusive Right Sidebar for Script Review Notes ("Notas al pie") */}
        {showNotesSidebar && (
          <aside
            aria-label="Notas al pie para revisión de guion"
            className={`no-print w-full lg:w-[360px] xl:w-[390px] shrink-0 border border-[#E2DDD3] dark:border-white/10 bg-[#FAF8F4] dark:bg-[#101015] flex flex-col ${
              isReadingMode
                ? 'lg:h-full border-y-0 border-r-0 rounded-none'
                : 'rounded-xl lg:sticky lg:top-4 max-h-[82vh]'
            }`}
          >
            <div className="px-4 py-3.5 border-b border-[#E2DDD3] dark:border-white/10 flex items-center justify-between gap-2 shrink-0">
              <div>
                <h3 className="font-display text-sm font-semibold text-[#18181B] dark:text-[#F2F0EB]">
                  Revisión y Notas al Pie
                </h3>
                <p className="text-[11px] text-[#57534E] dark:text-[#8D8981]">
                  Anotaciones de Director o Productor vinculadas al guion
                </p>
              </div>
              <div className="flex items-center gap-1 rounded-md border border-[#DCD6CA] dark:border-white/10 bg-[#FFFFFF] dark:bg-[#14141B] p-0.5 text-[10px]">
                <button
                  type="button"
                  onClick={() => setNotesScope('all')}
                  className={`px-2 py-1 rounded font-medium ${
                    notesScope === 'all'
                      ? 'bg-[#E5A93C] text-[#0B0B0E] font-semibold'
                      : 'text-[#3F3F46] dark:text-[#C8C3BA]'
                  }`}
                >
                  Todas ({allNotes.length})
                </button>
                <button
                  type="button"
                  onClick={() => setNotesScope('selected')}
                  className={`px-2 py-1 rounded font-medium ${
                    notesScope === 'selected'
                      ? 'bg-[#E5A93C] text-[#0B0B0E] font-semibold'
                      : 'text-[#3F3F46] dark:text-[#C8C3BA]'
                  }`}
                >
                  Línea
                </button>
              </div>
            </div>

            {/* Add Footnote Form */}
            <form
              onSubmit={handleSubmitNote}
              className="p-4 border-b border-[#E2DDD3] dark:border-white/10 bg-[#F5F3EE] dark:bg-[#0D0D12] space-y-3 shrink-0"
            >
              {selectedBeat ? (
                <div className="rounded-lg border border-[#E5A93C]/45 bg-amber-50 dark:bg-[#18150E] px-3 py-2 space-y-1">
                  <div className="text-[10px] font-mono-tech font-medium text-amber-800 dark:text-[#E5A93C]">
                    Escena {selectedBeat.sceneNumber} · {BEAT_TYPE_LABELS[selectedBeat.beatType]}
                  </div>
                  <p className="text-xs text-[#18181B] dark:text-[#EAE6DE] line-clamp-2 italic">
                    &ldquo;{selectedBeat.lineExcerpt}&rdquo;
                  </p>
                </div>
              ) : (
                <p className="text-xs text-[#57534E] dark:text-[#8D8981]">
                  Haz clic en cualquier línea del guion para adjuntar una nota al pie.
                </p>
              )}

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label htmlFor="note-role-select" className="block text-[10px] text-[#57534E] dark:text-[#9A968E] mb-1">
                    Rol de revisión
                  </label>
                  <select
                    id="note-role-select"
                    value={authorRole}
                    onChange={(e) => setAuthorRole(e.target.value as ScreenplayNoteRole)}
                    className="w-full rounded-lg border border-[#D6D1C7] dark:border-white/12 bg-[#FFFFFF] dark:bg-[#14141B] px-2.5 py-1.5 text-xs text-[#18181B] dark:text-[#F2F0EB] focus:border-[#E5A93C] focus:outline-none"
                  >
                    <option value="director">Director</option>
                    <option value="producer">Productor</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="note-author-input" className="block text-[10px] text-[#57534E] dark:text-[#9A968E] mb-1">
                    Firma (opcional)
                  </label>
                  <input
                    id="note-author-input"
                    type="text"
                    value={authorName}
                    onChange={(e) => setAuthorName(e.target.value)}
                    placeholder={authorRole === 'producer' ? 'Productor' : 'Director'}
                    className="w-full rounded-lg border border-[#D6D1C7] dark:border-white/12 bg-[#FFFFFF] dark:bg-[#14141B] px-2.5 py-1.5 text-xs text-[#18181B] dark:text-[#F2F0EB] placeholder:text-[#78746C] dark:placeholder:text-[#6E6A63] focus:border-[#E5A93C] focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="footnote-textarea" className="sr-only">
                  Texto de la nota al pie
                </label>
                <textarea
                  id="footnote-textarea"
                  rows={2}
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  placeholder="Añadir nota técnica, ajuste de diálogo o presupuesto..."
                  className="w-full rounded-lg border border-[#D6D1C7] dark:border-white/12 bg-[#FFFFFF] dark:bg-[#14141B] p-2.5 text-xs text-[#18181B] dark:text-[#F2F0EB] placeholder:text-[#78746C] dark:placeholder:text-[#6E6A63] focus:border-[#E5A93C] focus:outline-none resize-none"
                />
              </div>

              {noteError && (
                <p role="alert" className="text-[11px] text-red-700 dark:text-[#FCA5A5]">
                  {noteError}
                </p>
              )}

              <button
                type="submit"
                disabled={submittingNote || !selectedBeat}
                className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-[#E5A93C] hover:bg-[#EDA949] disabled:opacity-50 text-[#0B0B0E] text-xs font-semibold"
              >
                <MessageSquarePlus className="w-3.5 h-3.5" />
                <span>{submittingNote ? 'Guardando nota...' : 'Añadir nota al pie'}</span>
              </button>
            </form>

            {/* Footnotes List */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
              {visibleNotes.length === 0 ? (
                <p className="text-xs text-[#57534E] dark:text-[#8D8981] text-center py-6 leading-relaxed">
                  {notesScope === 'selected'
                    ? 'Esta línea no tiene notas aún. Añade una nota arriba.'
                    : 'No hay notas al pie todavía. Selecciona una línea de acción o diálogo en el guion para iniciar la revisión.'}
                </p>
              ) : (
                visibleNotes.map((item) => {
                  const isBusy = busyNoteId === item.id;
                  const isSelectedLine = selectedBeat?.beatKey === item.beatKey;
                  return (
                    <article
                      key={item.id}
                      className={`rounded-lg border p-3 space-y-2 transition-colors ${
                        item.resolved
                          ? 'border-[#E2DDD3] dark:border-white/8 bg-[#EFECE5] dark:bg-[#121217] opacity-75'
                          : isSelectedLine
                            ? 'border-[#E5A93C]/65 bg-amber-50 dark:bg-[#18150E]'
                            : 'border-[#DCD6CA] dark:border-white/10 bg-[#FFFFFF] dark:bg-[#14141C]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 text-[10px] font-mono-tech">
                        <button
                          type="button"
                          onClick={() =>
                            selectAndFocusBeat({
                              beatKey: item.beatKey,
                              sceneNumber: item.sceneNumber,
                              beatIndex: item.beatIndex,
                              beatType: item.beatType,
                              lineExcerpt: item.lineExcerpt,
                            })
                          }
                          className="text-left hover:underline font-semibold truncate"
                        >
                          <span
                            className={
                              item.authorRole === 'producer'
                                ? 'text-teal-700 dark:text-[#5EEAD4]'
                                : 'text-amber-700 dark:text-[#E5A93C]'
                            }
                          >
                            {item.authorRole === 'producer' ? 'PRODUCTOR' : 'DIRECTOR'}
                          </span>
                          <span className="text-[#57534E] dark:text-[#8D8981]">
                            {' '}
                            · Esc. {item.sceneNumber} ({BEAT_TYPE_LABELS[item.beatType]})
                          </span>
                        </button>

                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => void handleResolveToggle(item)}
                            title={item.resolved ? 'Reabrir nota' : 'Marcar como resuelta'}
                            className="p-1 rounded text-[#57534E] dark:text-[#8D8981] hover:text-teal-700 dark:hover:text-[#5EEAD4] hover:bg-black/5 dark:hover:bg-white/5"
                          >
                            {item.resolved ? (
                              <RotateCcw className="w-3 h-3" />
                            ) : (
                              <CheckCircle2 className="w-3 h-3" />
                            )}
                          </button>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => void handleDelete(item.id)}
                            aria-label={`Eliminar nota ${item.id}`}
                            className="p-1 rounded text-[#57534E] dark:text-[#8D8981] hover:text-red-700 dark:hover:text-[#FCA5A5] hover:bg-black/5 dark:hover:bg-white/5"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>

                      <p className="text-[11px] text-[#57534E] dark:text-[#9A968E] italic line-clamp-1">
                        &ldquo;{item.lineExcerpt}&rdquo;
                      </p>

                      <p
                        className={`text-xs leading-relaxed ${
                          item.resolved
                            ? 'line-through text-[#78746C] dark:text-[#8D8981]'
                            : 'text-[#18181B] dark:text-[#EAE6DE]'
                        }`}
                      >
                        {item.note}
                      </p>

                      <div className="text-[10px] text-[#57534E] dark:text-[#7D7971]">
                        {item.authorName} ·{' '}
                        {item.resolved ? 'Resuelta' : 'Pendiente'}
                      </div>
                    </article>
                  );
                })
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
