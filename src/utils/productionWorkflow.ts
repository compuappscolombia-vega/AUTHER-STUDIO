import type {
  ProductionProject,
  ProductionSequence,
  WorkspaceTab,
} from '../types/studio';

export interface WorkflowStepStatus {
  stepNumber: number;
  id:
    | 'project'
    | 'ingest'
    | 'review'
    | 'visuals'
    | 'finalize'
    | 'trailer';
  title: string;
  shortLabel: string;
  whatItDoes: string;
  completed: boolean;
  active: boolean;
  actionTab?: WorkspaceTab;
  actionLabel: string;
}

export interface FilmDeliveryWorkflow {
  steps: WorkflowStepStatus[];
  currentStepIndex: number;
  completedCount: number;
  percentComplete: number;
  nextActionLabel: string;
  nextActionTab?: WorkspaceTab;
  nextActionKind: 'new_project' | 'open_ingest' | 'open_tab' | 'approve_final' | 'done';
  summaryHint: string;
}

export function computeFilmDeliveryWorkflow(params: {
  activeProject: ProductionProject | null;
  activeSequence: ProductionSequence | null;
}): FilmDeliveryWorkflow {
  const { activeProject, activeSequence } = params;

  const hasProject = Boolean(activeProject);
  const hasSequence = Boolean(activeProject && activeProject.sequences.length > 0 && activeSequence);
  const hasNotesOrReview = Boolean(
    activeSequence &&
      ((activeSequence.screenplayNotes?.length || 0) > 0 ||
        typeof activeSequence.sequenceRating === 'number' ||
        activeSequence.versionStatus === 'final')
  );
  const hasGeneratedMedia = Boolean(
    activeSequence &&
      (activeSequence.storyboardFrames.some((f) => Boolean(f.imageUrl || f.videoUrl)) ||
        (activeSequence.voiceOverTracks || []).some((v) => Boolean(v.audioUrl)))
  );
  const hasApprovedSequence = Boolean(
    activeProject && activeProject.sequences.some((s) => s.versionStatus === 'final')
  );
  const hasTrailerDelivered = Boolean(
    activeProject?.trailer &&
      (Boolean(activeProject.trailer.voiceOverAudioUrl) ||
        Boolean(activeProject.trailer.musicAudioUrl) ||
        activeProject.trailer.beats.some((b) => Boolean(b.imageUrl || b.videoUrl)))
  );

  let currentStepIndex = 0;
  let nextActionLabel = 'Crear nueva producción';
  let nextActionTab: WorkspaceTab | undefined;
  let nextActionKind: FilmDeliveryWorkflow['nextActionKind'] = 'new_project';
  let summaryHint =
    'Paso 1: Crea tu proyecto cinematográfico y define el título y estilo base.';

  if (!hasProject) {
    currentStepIndex = 0;
    nextActionLabel = 'Crear nueva producción';
    nextActionKind = 'new_project';
    summaryHint =
      'Paso 1 de 6: Crea tu producción para abrir la mesa de ingesta y la Biblia de Continuidad.';
  } else if (!hasSequence) {
    currentStepIndex = 1;
    nextActionLabel = 'Ir a Ingesta y Dirigir';
    nextActionKind = 'open_ingest';
    summaryHint =
      'Paso 2 de 6: Carga un libro, audio o escribe tu historia a la izquierda y pulsa «Dirigir y Producir Secuencia».';
  } else if (!hasGeneratedMedia) {
    currentStepIndex = hasNotesOrReview ? 3 : 2;
    nextActionLabel = hasNotesOrReview
      ? 'Ir a Storyboard y Video'
      : 'Revisar Guion y Notas';
    nextActionTab = hasNotesOrReview ? 'storyboard' : 'screenplay';
    nextActionKind = 'open_tab';
    summaryHint = hasNotesOrReview
      ? 'Paso 4 de 6: Renderiza fotogramas y clips con tus APIs configuradas (free o de pago) o usa Pre-Vis 3D.'
      : 'Paso 3 de 6: Revisa el expediente técnico en Dirección, Planos/Voz en Off y añade Notas al pie en Guion.';
  } else if (!hasApprovedSequence) {
    currentStepIndex = 4;
    nextActionLabel = 'Aprobar Versión Final';
    nextActionKind = 'approve_final';
    summaryHint =
      'Paso 5 de 6: Cuando estés conforme con la secuencia, apruébala como Versión Final para desbloquear el Tráiler 30s y PDF.';
  } else if (!hasTrailerDelivered) {
    currentStepIndex = 5;
    nextActionLabel = 'Ir a Tráiler 30s y Entrega';
    nextActionTab = 'trailer';
    nextActionKind = 'open_tab';
    summaryHint =
      'Paso 6 de 6: Abre Tráiler 30s para generar el montaje de 30s con voz en off, música Lyria y clips de entrega.';
  } else {
    currentStepIndex = 5;
    nextActionLabel = 'Ver Tráiler y Exportar PDF';
    nextActionTab = 'trailer';
    nextActionKind = 'done';
    summaryHint =
      'Producción lista: tienes secuencia en Versión Final, tráiler de 30s ensamblado y exportación PDF desbloqueada.';
  }

  const rawSteps: Omit<WorkflowStepStatus, 'active'>[] = [
    {
      stepNumber: 1,
      id: 'project',
      title: '1. Proyecto y Biblia',
      shortLabel: 'Proyecto',
      whatItDoes: 'Define el título, estilo de dirección y Biblia de Continuidad base.',
      completed: hasProject,
      actionTab: 'vision',
      actionLabel: hasProject ? 'Ver Biblia' : 'Crear proyecto',
    },
    {
      stepNumber: 2,
      id: 'ingest',
      title: '2. Material y Producción',
      shortLabel: 'Ingesta',
      whatItDoes:
        'Sube libro, audio o historia en la mesa izquierda; el agente redacta visión, planos, guion y prompts.',
      completed: hasSequence,
      actionTab: 'vision',
      actionLabel: 'Mesa de ingesta',
    },
    {
      stepNumber: 3,
      id: 'review',
      title: '3. Revisión y Notas al Pie',
      shortLabel: 'Guion / Notas',
      whatItDoes:
        'Revisa Dirección, Planos/Voz en Off y Guion (Modo Lectura + Notas de Director/Productor).',
      completed: hasSequence && (hasNotesOrReview || hasGeneratedMedia || hasApprovedSequence),
      actionTab: 'screenplay',
      actionLabel: 'Revisar Guion',
    },
    {
      stepNumber: 4,
      id: 'visuals',
      title: '4. Storyboard, 3D y Video',
      shortLabel: 'Visuales / Video',
      whatItDoes:
        'Previsualiza cámara en Pre-Vis 3D, renderiza fotogramas y clips con la API de Imágenes/Video que suministres.',
      completed: hasGeneratedMedia,
      actionTab: 'storyboard',
      actionLabel: 'Ir a Storyboard',
    },
    {
      stepNumber: 5,
      id: 'finalize',
      title: '5. Aprobar Versión Final',
      shortLabel: 'Aprobar Hito',
      whatItDoes:
        'Bloquea la secuencia en la Línea de Tiempo, alimenta la memoria del estudio y habilita PDF y Tráiler.',
      completed: hasApprovedSequence,
      actionTab: 'vision',
      actionLabel: 'Aprobar Final',
    },
    {
      stepNumber: 6,
      id: 'trailer',
      title: '6. Tráiler 30s y Guía Externa',
      shortLabel: 'Tráiler / Guía',
      whatItDoes:
        'Ensambla el tráiler 30s, descarga la Bitácora PDF o sigue la Guía Paso a Paso Externa de Agente Arthur.',
      completed: hasTrailerDelivered,
      actionTab: 'trailer',
      actionLabel: 'Abrir Tráiler 30s',
    },
  ];

  const steps: WorkflowStepStatus[] = rawSteps.map((s, idx) => ({
    ...s,
    active: idx === currentStepIndex,
  }));

  const completedCount = steps.filter((s) => s.completed).length;
  const percentComplete = Math.round((completedCount / steps.length) * 100);

  return {
    steps,
    currentStepIndex,
    completedCount,
    percentComplete,
    nextActionLabel,
    nextActionTab,
    nextActionKind,
    summaryHint,
  };
}
