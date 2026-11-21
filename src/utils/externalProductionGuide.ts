import type {
  ExternalGuideSection,
  ExternalGuideStepItem,
  ExternalProductionGuide,
  ProductionProject,
  ProductionSequence,
} from '../types/studio.ts';
import { formatTimecodeSec } from './productionPipeline.ts';

function computeMidjourneyAspectFlag(aspectRatio: string): string {
  const clean = (aspectRatio || '16:9').trim();
  if (clean === '2.39:1') return '--ar 21:9';
  if (clean === '1.43:1') return '--ar 4:3';
  if (/^\d+:\d+$/.test(clean)) return `--ar ${clean}`;
  return '--ar 16:9';
}

function buildNegativePrompt(genreStyle: string): string {
  return `cartoon, anime, 3d render plastic skin, CGI look, oversaturated neon, watermark, subtitle text, logo, blurry, distorted hands, extra fingers, low resolution, stock photo lighting, break continuity of ${genreStyle}`;
}

function formatClockSeconds(totalSec: number): string {
  const sec = Math.max(0, Math.round(totalSec));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function buildSingleSequenceSections(
  project: ProductionProject,
  sequence: ProductionSequence,
  stepPrefix = ''
): ExternalGuideSection[] {
  const resolution = sequence.targetResolution || '4K';
  const arFlag = computeMidjourneyAspectFlag(sequence.aspectRatio);
  const masterPrompt =
    sequence.hyperRealisticPrompt ||
    `${sequence.directorVision}. Shot on ${sequence.cameraSystem}, ${sequence.lensPackage}, ${sequence.filmStockOrLut}.`;
  const consistencyPrefix = `${sequence.cameraSystem}, ${sequence.lensPackage}, ${sequence.filmStockOrLut}, Kelvin ${sequence.lighting?.colorTemperatureKelvin || '4500K'}`;
  const negativePrompt = buildNegativePrompt(project.genreStyle);

  // STEP 1: Project Configuration, Continuity Bible & Camera/Lighting Bible
  const step1Items: ExternalGuideStepItem[] = [
    {
      stepCode: `${stepPrefix}1.1`,
      title: 'Parámetros Maestros del Proyecto y Cámara',
      subtitle: 'Configura estos ajustes antes de generar cualquier plano externo',
      specs: [
        { label: 'Proyecto', value: project.title },
        { label: 'Secuencia', value: sequence.title },
        { label: 'Resolución Objetivo', value: resolution },
        { label: 'Aspect Ratio', value: `${sequence.aspectRatio} (${arFlag})` },
        { label: 'Cámara & Sensor', value: sequence.cameraSystem },
        { label: 'Óptica / Lentes', value: sequence.lensPackage },
        { label: 'Emulsión / LUT', value: sequence.filmStockOrLut },
      ],
      instructions: `En tu plataforma externa de generación o editor NLE (DaVinci Resolve / Premiere), crea una línea de tiempo en ${resolution} con relación de aspecto ${sequence.aspectRatio}. Mantén exactamente la combinación óptica (${sequence.cameraSystem} + ${sequence.lensPackage}) en cada prompt para no romper la unidad fotográfica.`,
    },
    {
      stepCode: `${stepPrefix}1.2`,
      title: 'Biblia de Continuidad, Paleta HEX, Iluminación y Arte/VFX',
      subtitle: 'Referencia fija para vestuario, rostros, locaciones y colorimetría',
      specs: [
        {
          label: 'Paleta de Color',
          value: (sequence.colorPalette || [])
            .map((c) => `${c.name} ${c.hex} (${c.role})`)
            .join(' | '),
        },
        {
          label: 'Esquema Kelvin',
          value: `${sequence.lighting?.keyLight || ''} · Ratio ${sequence.lighting?.fillRatio || '4:1'} · ${sequence.lighting?.colorTemperatureKelvin || '4500K'} · ${sequence.lighting?.atmosphereAndHaze || ''}`,
        },
        {
          label: 'Locaciones y Sets',
          value: sequence.vfx?.locationsAndSets || 'Según guion técnico',
        },
        {
          label: 'Vestuario y Maquillaje',
          value: sequence.vfx?.wardrobeAndMakeup || 'Continuidad de personaje',
        },
        {
          label: 'VFX / SFX Prácticos',
          value: [
            ...(sequence.vfx?.cgiElements || []),
            ...(sequence.vfx?.practicalSfx || []),
          ].join(' · '),
        },
      ],
      instructions:
        project.continuityBible ||
        sequence.continuitySummary ||
        'Mantener coherencia estricta de rasgos faciales, vestuario, clima e iluminación entre todos los planos.',
      copyPromptLabel: 'Copiar Biblia de Continuidad',
      copyPromptText: `CONTINUITY BIBLE (${project.title} - ${sequence.title}):\n${project.continuityBible || sequence.continuitySummary}\n\nCAMERA & COLOR: ${consistencyPrefix} | PALETTE: ${(sequence.colorPalette || []).map((c) => `${c.name} ${c.hex}`).join(', ')}\nSETS: ${sequence.vfx?.locationsAndSets || ''}\nWARDROBE: ${sequence.vfx?.wardrobeAndMakeup || ''}`,
    },
  ];

  // STEP 2: Master Style Prompt & Negative Prompt
  const step2Items: ExternalGuideStepItem[] = [
    {
      stepCode: `${stepPrefix}2.1`,
      title: `Prompt Maestro Hiperrealista (${resolution})`,
      subtitle: 'Úsalo como base o prefijo de estilo en Midjourney, Flux, Ideogram o ComfyUI',
      specs: [
        { label: 'Estilo del Director', value: sequence.directorStyle },
        { label: 'Parámetro Aspecto', value: arFlag },
      ],
      instructions:
        'Copia este Prompt Maestro junto con el Prompt Negativo en la configuración global o de estilo de tu plataforma de generación de imágenes para fijar iluminación, piel realista y óptica anamórfica/esférica.',
      copyPromptLabel: 'Copiar Prompt Maestro',
      copyPromptText: `${masterPrompt}\n\n[Style Lock]: ${consistencyPrefix} ${arFlag}`,
      notes: `Negative Prompt recomendado: ${negativePrompt}`,
    },
    {
      stepCode: `${stepPrefix}2.2`,
      title: 'Prompt Negativo Universal (Anti-artefactos)',
      specs: [{ label: 'Uso', value: 'Campo Negative Prompt / --no en Midjourney' }],
      instructions:
        'Pega este bloque en el campo de exclusión (Negative Prompt) para evitar texturas plásticas, manos deformes, marcas de agua o cambios de iluminación.',
      copyPromptLabel: 'Copiar Prompt Negativo',
      copyPromptText: negativePrompt,
    },
  ];

  // STEP 3: Frame-by-Frame Image Generation Prompts
  const step3Items: ExternalGuideStepItem[] = (sequence.storyboardFrames || []).map(
    (frame, idx) => ({
      stepCode: `${stepPrefix}3.${idx + 1}`,
      title: `Fotograma ${idx + 1}: ${frame.title} (${frame.shotRef})`,
      subtitle: `Óptica: ${frame.cameraSpec} · ${frame.aspectRatio || sequence.aspectRatio}`,
      specs: [
        { label: 'Plano Referencia', value: frame.shotRef },
        { label: 'Aspect Ratio', value: computeMidjourneyAspectFlag(frame.aspectRatio || sequence.aspectRatio) },
        { label: 'Objetivo', value: 'Generar imagen clave (Key Frame) de alta definición' },
      ],
      instructions: `1. Abre tu generador de imágenes (Midjourney / Flux / Ideogram / Nano / ComfyUI).\n2. Pega el prompt visual completo y selecciona formato ${frame.aspectRatio || sequence.aspectRatio}.\n3. Si usas Midjourney, agrega el parámetro ${computeMidjourneyAspectFlag(frame.aspectRatio || sequence.aspectRatio)}. Guarda el resultado como "frame_${idx + 1}_${frame.shotRef.replace(/\s+/g, '_').toLowerCase()}.png".`,
      copyPromptLabel: `Copiar Prompt Imagen ${idx + 1}`,
      copyPromptText: `${frame.visualPrompt}, ${consistencyPrefix}, ${resolution} photorealistic film still ${computeMidjourneyAspectFlag(frame.aspectRatio || sequence.aspectRatio)}`,
      notes: frame.imageUrl
        ? `Ya cuenta con imagen generada en estudio (${frame.imageUrl}) que puedes usar como Seed / Character Reference (--cref / img2img).`
        : 'Genera primero esta imagen para usarla como fotograma inicial (Image-to-Video) en el Paso 4.',
    })
  );

  // STEP 4: Shot-by-Shot Video Motion Generation (Image-to-Video / Text-to-Video)
  const step4Items: ExternalGuideStepItem[] = (sequence.shotList || []).map((shot, idx) => {
    const matchingFrame =
      sequence.storyboardFrames?.[idx] ||
      sequence.storyboardFrames?.find((f) =>
        f.shotRef.toLowerCase().includes(shot.shotNumber.toLowerCase())
      );
    const motionDescription =
      matchingFrame?.veoMotionPrompt ||
      `${shot.movement} camera motion, ${shot.lensMm} lens, ${shot.framingNote}, cinematic photorealistic motion`;
    const visualContext = matchingFrame?.visualPrompt || masterPrompt;

    return {
      stepCode: `${stepPrefix}4.${idx + 1}`,
      title: `Plano ${shot.shotNumber}: ${shot.shotType} (${shot.durationSec}s)`,
      subtitle: `Lente ${shot.lensMm} · Movimiento: ${shot.movement}`,
      specs: [
        { label: 'Duración', value: `${shot.durationSec} segundos` },
        { label: 'Óptica & Movimiento', value: `${shot.lensMm} · ${shot.movement}` },
        {
          label: 'Modo Recomendado',
          value: matchingFrame
            ? `Image-to-Video usando Fotograma "${matchingFrame.title}"`
            : 'Text-to-Video con Prompt Maestro',
        },
      ],
      instructions: `En Runway Gen-3/4, Kling, Sora, Luma Dream Machine, Veo u Omni:\n1. ${matchingFrame ? `Sube el Fotograma ${matchingFrame.title} del Paso 3 como primer frame (Start Frame).` : 'Selecciona modo Text-to-Video.'}\n2. Configura duración a ${Math.min(10, Math.max(4, Math.round(shot.durationSec || 5)))}s y formato ${sequence.aspectRatio}.\n3. Pega el prompt de movimiento y renderiza el clip.`,
      copyPromptLabel: `Copiar Prompt Video ${shot.shotNumber}`,
      copyPromptText: `${motionDescription}. Scene context: ${visualContext.slice(0, 360)}. Framing: ${shot.framingNote}. Intent: ${shot.psychologicalIntent}. ${consistencyPrefix}`,
      notes: `Intención dramática: ${shot.psychologicalIntent}`,
    };
  });

  // STEP 5: Voice-Over, Screenplay Dialogues, Sound Design & Musical Score
  const step5Items: ExternalGuideStepItem[] = [];

  (sequence.voiceOverTracks || []).forEach((track, idx) => {
    step5Items.push({
      stepCode: `${stepPrefix}5.VO.${idx + 1}`,
      title: `Voz en Off ${idx + 1}: ${track.characterOrNarrator} (${track.timecodeHint})`,
      subtitle: `Timbre ${track.voicePreset} · ${track.voicePersona}`,
      specs: [
        { label: 'Timecode', value: track.timecodeHint },
        { label: 'Timbre / Perfil', value: `${track.voicePreset} (${track.voicePersona})` },
        { label: 'Dirección Actoral', value: track.deliveryDirection },
      ],
      instructions: `En ElevenLabs, OpenAI TTS o estudio de locución: configura una voz tipo "${track.voicePersona}" con indicación actoral "${track.deliveryDirection}" y genera el archivo WAV para colocarlo en el minuto/segundo ${track.timecodeHint}.`,
      copyPromptLabel: `Copiar Locución VO ${idx + 1}`,
      copyPromptText: `[Direction: ${track.deliveryDirection} | Timecode: ${track.timecodeHint}]\n${track.text}`,
    });
  });

  (sequence.screenplay || []).forEach((scene, scIdx) => {
    const dialogues = scene.beats.filter((b) => b.type === 'dialogue');
    const sceneLines = scene.beats
      .map((b) => {
        if (b.type === 'dialogue') {
          return `${(b.character || 'PERSONAJE').toUpperCase()}${b.parenthetical ? ` (${b.parenthetical})` : ''}: ${b.text}`;
        }
        return `[${b.type.toUpperCase()}] ${b.text}`;
      })
      .join('\n');

    step5Items.push({
      stepCode: `${stepPrefix}5.SC.${scIdx + 1}`,
      title: `Guion Escena ${scene.sceneNumber}: ${scene.slugline}`,
      subtitle: `${scene.timeOfDay} · ${dialogues.length} intervenciones de diálogo`,
      specs: [
        { label: 'Escena', value: scene.sceneNumber },
        { label: 'Ambientación', value: scene.timeOfDay },
      ],
      instructions:
        'Utiliza este guion exacto para doblaje, sincronización labial (Lip-Sync en Kling/Runway/HeyGen) o subtítulos finales.',
      copyPromptLabel: `Copiar Escena ${scene.sceneNumber}`,
      copyPromptText: `${scene.slugline}\n\n${sceneLines}`,
    });
  });

  step5Items.push({
    stepCode: `${stepPrefix}5.SFX`,
    title: `Diseño Sonoro Dolby Atmos y Partitura Musical (${sequence.soundDesign?.tempoBpm || 84} BPM)`,
    subtitle: 'Genera stems ambientales, foley y música en Suno, Udio o Lyria',
    specs: [
      { label: 'Tempo', value: `${sequence.soundDesign?.tempoBpm || 84} BPM` },
      { label: 'Subgraves (LFE)', value: sequence.soundDesign?.subBassCue || 'Subgrave sutil' },
      { label: 'Silencios', value: sequence.soundDesign?.silenceBeats || 'Según clímax' },
    ],
    instructions:
      'Genera la pista musical instrumental en Suno / Udio / Lyria con el prompt de abajo, y añade las capas Atmos y efectos Foley en pistas separadas dentro de tu editor de video.',
    copyPromptLabel: 'Copiar Prompt Musical & Sonoro',
    copyPromptText: `Music Score (${sequence.soundDesign?.tempoBpm || 84} BPM): ${sequence.soundDesign?.musicalScore || ''}\nAtmos Layers: ${(sequence.soundDesign?.atmosLayers || []).join(', ')}\nFoley Cues: ${(sequence.soundDesign?.foleyDetails || []).join(', ')}\nSub-bass: ${sequence.soundDesign?.subBassCue || ''}`,
  });

  // STEP 6: Final NLE Editing & Assembly Timeline
  let runningTimeSec = 0;
  const timelineRows = (sequence.shotList || []).map((shot) => {
    const start = runningTimeSec;
    const end = runningTimeSec + (Number(shot.durationSec) || 5);
    runningTimeSec = end;
    return `${formatClockSeconds(start)} -> ${formatClockSeconds(end)} | [${shot.shotNumber}] ${shot.shotType} (${shot.lensMm}, ${shot.movement}) — ${shot.framingNote}`;
  });

  const step6Items: ExternalGuideStepItem[] = [
    {
      stepCode: `${stepPrefix}6.1`,
      title: `Línea de Tiempo Maestra de Montaje (Duración estimada: ${formatClockSeconds(runningTimeSec)})`,
      subtitle: 'Orden exacto de clips, pistas de audio y etalonaje final',
      specs: [
        { label: 'Duración Total Secuencia', value: formatClockSeconds(runningTimeSec) },
        { label: 'Cantidad de Planos', value: `${(sequence.shotList || []).length} clips` },
        { label: 'LUT / Color Final', value: sequence.filmStockOrLut },
      ],
      instructions:
        timelineRows.length > 0
          ? timelineRows.join('\n')
          : 'Ordena los clips renderizados siguiendo la lista de planos de la secuencia.',
      copyPromptLabel: 'Copiar Escaleta de Montaje',
      copyPromptText: `TIMELINE ASSEMBLY — ${sequence.title} (${resolution}, ${sequence.aspectRatio})\nTOTAL DURATION: ${formatClockSeconds(runningTimeSec)}\n\nVIDEO TRACK V1:\n${timelineRows.join('\n')}\n\nAUDIO TRACKS:\n- A1: Diálogos / Voz en Off (${(sequence.voiceOverTracks || []).length} pistas)\n- A2: Foley & Atmos (${(sequence.soundDesign?.foleyDetails || []).slice(0, 3).join(', ')})\n- A3: Música (${sequence.soundDesign?.tempoBpm || 84} BPM)\n- A4: Sub-Bass LFE (${sequence.soundDesign?.subBassCue || '40Hz'})\n\nCOLOR GRADE: ${sequence.filmStockOrLut}`,
    },
  ];

  return [
    {
      stepNumber: 1,
      id: `${stepPrefix}step-1-config`,
      title: 'Paso 1 · Configuración Maestra, Biblia de Continuidad y Arte',
      platformHint: 'Ajustes de Proyecto · DaVinci / Premiere / Generador Externo',
      summary: 'Parámetros ópticos, resolución, paleta HEX, iluminación Kelvin y coherencia visual.',
      items: step1Items,
    },
    {
      stepNumber: 2,
      id: `${stepPrefix}step-2-prompts`,
      title: 'Paso 2 · Prompt Maestro de Estilo y Prompt Negativo',
      platformHint: 'Midjourney · Flux · Ideogram · ComfyUI',
      summary: 'Reglas visuales globales para que todas las imágenes mantengan el mismo estilo de película.',
      items: step2Items,
    },
    {
      stepNumber: 3,
      id: `${stepPrefix}step-3-images`,
      title: `Paso 3 · Generación de Imágenes Clave (${step3Items.length} fotogramas)`,
      platformHint: 'Midjourney · Flux.1 · Nano · Imagen · DALL·E',
      summary: 'Prompts fotográficos exactos para generar cada fotograma clave antes de animar en video.',
      items: step3Items,
    },
    {
      stepNumber: 4,
      id: `${stepPrefix}step-4-video`,
      title: `Paso 4 · Generación de Clips en Video (${step4Items.length} planos)`,
      platformHint: 'Runway Gen-3/4 · Kling · Sora · Luma · Veo · Wan 2.1',
      summary: 'Indicaciones plano por plano para animar los fotogramas con movimiento de cámara real.',
      items: step4Items,
    },
    {
      stepNumber: 5,
      id: `${stepPrefix}step-5-audio`,
      title: 'Paso 5 · Voces en Off, Guion, Foley y Partitura Musical',
      platformHint: 'ElevenLabs · Suno · Udio · Lyria · Estudio de Voz',
      summary: 'Locuciones exactas, diálogos por escena y prompts sonoros Dolby Atmos.',
      items: step5Items,
    },
    {
      stepNumber: 6,
      id: `${stepPrefix}step-6-assembly`,
      title: 'Paso 6 · Montaje Final y Línea de Tiempo (NLE)',
      platformHint: 'DaVinci Resolve · Premiere Pro · CapCut · Final Cut',
      summary: 'Timecodes exactos, distribución de pistas de audio A1–A4 y etalonaje LUT.',
      items: step6Items,
    },
  ];
}

function buildTrailerSection(project: ProductionProject): ExternalGuideSection | null {
  const trailer = project.trailer;
  if (!trailer) return null;

  const items: ExternalGuideStepItem[] = [
    {
      stepCode: '7.0',
      title: `Master Tráiler 30s: "${trailer.title}" — "${trailer.tagline}"`,
      subtitle: `${trailer.tone} · ${trailer.targetResolution} · ${trailer.tempoBpm} BPM`,
      specs: [
        { label: 'Duración Total', value: '00:00 → 00:30 (6 cortes)' },
        { label: 'Voz Tráiler', value: `${trailer.voicePreset} — ${trailer.voiceDirection}` },
        { label: 'Partitura', value: `${trailer.tempoBpm} BPM · ${trailer.soundMixNotes}` },
      ],
      instructions:
        'Genera primero la voz en off completa y la pista musical de 30s, luego monta los 6 cortes en los timecodes exactos detallados abajo.',
      copyPromptLabel: 'Copiar Guion Vocal + Música del Tráiler',
      copyPromptText: `VOICE-OVER SCRIPT (${trailer.voicePreset} - ${trailer.voiceDirection}):\n${trailer.voiceOverScript}\n\nMUSIC PROMPT (30s, ${trailer.tempoBpm} BPM):\n${trailer.musicPrompt}`,
    },
    ...trailer.beats.map((beat) => ({
      stepCode: `7.${beat.beatNumber}`,
      title: `Corte ${beat.beatNumber} (${formatTimecodeSec(beat.startSec)} → ${formatTimecodeSec(beat.endSec)}) · ${beat.onScreenTitleCard}`,
      subtitle: `${beat.sourceSequenceTitle} · Transición: ${beat.editingTransition}`,
      specs: [
        { label: 'Duración', value: `${beat.durationSec}s` },
        { label: 'Efecto / SFX', value: beat.sfxCue },
        { label: 'Voz en Off', value: beat.voiceOverLine || '(Silencio / Solo música)' },
      ],
      instructions: `1. Genera la imagen clave del corte ${beat.beatNumber}.\n2. Anímala durante ${beat.durationSec}s usando el prompt de movimiento.\n3. Superpón el título en pantalla "${beat.onScreenTitleCard}" y aplica transición "${beat.editingTransition}".`,
      copyPromptLabel: `Copiar Prompts Corte ${beat.beatNumber}`,
      copyPromptText: `[IMAGE PROMPT - ${trailer.targetResolution}]:\n${beat.hyperRealisticPrompt}\n\n[VIDEO MOTION PROMPT - ${beat.durationSec}s]:\n${beat.motionPrompt}\n\n[TITLE CARD]: ${beat.onScreenTitleCard}\n[VO LINE]: ${beat.voiceOverLine}\n[SFX]: ${beat.sfxCue}`,
    })),
  ];

  return {
    stepNumber: 7,
    id: 'step-7-trailer',
    title: 'Paso 7 · Tráiler Oficial de 30 Segundos (6 Cortes)',
    platformHint: 'Montaje Promocional · Runway / Kling + Suno / ElevenLabs',
    summary: 'Guion vocal, música de 30s y los 6 cortes cronometrados para producir el tráiler fuera del estudio.',
    items,
  };
}

function renderGuideToMarkdown(guide: Omit<ExternalProductionGuide, 'markdown' | 'plainText'>): string {
  const lines: string[] = [];
  lines.push(`# ${guide.agentName} — Documento Paso a Paso de Producción Externa`);
  lines.push('');
  lines.push(`- **Proyecto:** ${guide.projectTitle} (${guide.genreStyle})`);
  lines.push(`- **Alcance:** ${guide.scope === 'project' ? 'Proyecto Completo' : `Secuencia: ${guide.sequenceTitle}`}`);
  lines.push(`- **Formato y Definición:** ${guide.aspectRatio} · ${guide.targetResolution}`);
  lines.push(`- **Emitido:** ${new Date(guide.generatedAt).toLocaleString('es-ES')}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  for (const section of guide.sections) {
    lines.push(`## ${section.title}`);
    lines.push(`> **Plataformas sugeridas:** ${section.platformHint}`);
    lines.push('');
    lines.push(section.summary);
    lines.push('');

    for (const item of section.items) {
      lines.push(`### [${item.stepCode}] ${item.title}`);
      if (item.subtitle) {
        lines.push(`*${item.subtitle}*`);
      }
      if (item.specs.length > 0) {
        lines.push('');
        for (const sp of item.specs) {
          lines.push(`- **${sp.label}:** ${sp.value}`);
        }
      }
      lines.push('');
      lines.push(item.instructions);
      if (item.copyPromptText) {
        lines.push('');
        lines.push('```text');
        lines.push(item.copyPromptText);
        lines.push('```');
      }
      if (item.notes) {
        lines.push('');
        lines.push(`> Nota: ${item.notes}`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

function renderGuideToPlainText(guide: Omit<ExternalProductionGuide, 'markdown' | 'plainText'>): string {
  const lines: string[] = [];
  lines.push(`${guide.agentName.toUpperCase()} — GUÍA PASO A PASO PARA PLATAFORMA EXTERNA`);
  lines.push(`PROYECTO: ${guide.projectTitle} (${guide.genreStyle})`);
  lines.push(`ALCANCE: ${guide.scope === 'project' ? 'Proyecto Completo' : guide.sequenceTitle}`);
  lines.push(`FORMATO: ${guide.aspectRatio} | RESOLUCIÓN: ${guide.targetResolution}`);
  lines.push('='.repeat(72));
  lines.push('');

  for (const section of guide.sections) {
    lines.push(section.title.toUpperCase());
    lines.push(`Plataformas: ${section.platformHint}`);
    lines.push('-'.repeat(60));
    for (const item of section.items) {
      lines.push(`[${item.stepCode}] ${item.title}`);
      if (item.subtitle) lines.push(`  ${item.subtitle}`);
      for (const sp of item.specs) {
        lines.push(`  - ${sp.label}: ${sp.value}`);
      }
      lines.push(`  Instrucciones: ${item.instructions}`);
      if (item.copyPromptText) {
        lines.push(`  PROMPT / CONTENIDO:\n${item.copyPromptText}`);
      }
      if (item.notes) lines.push(`  Nota: ${item.notes}`);
      lines.push('');
    }
    lines.push('');
  }

  return lines.join('\n');
}

export function buildExternalProductionGuide(params: {
  project: ProductionProject;
  sequence?: ProductionSequence | null;
  scope?: 'sequence' | 'project';
}): ExternalProductionGuide {
  const { project } = params;
  const scope = params.scope || (params.sequence ? 'sequence' : 'project');

  const targetSequences: ProductionSequence[] =
    scope === 'project'
      ? project.sequences
      : params.sequence
        ? [params.sequence]
        : project.sequences.slice(0, 1);

  const primarySeq = targetSequences[0];
  let sections: ExternalGuideSection[] = [];

  if (targetSequences.length === 1 && primarySeq) {
    sections = buildSingleSequenceSections(project, primarySeq, '');
  } else {
    targetSequences.forEach((seq, idx) => {
      const seqSections = buildSingleSequenceSections(project, seq, `C${idx + 1}.`);
      const labeled = seqSections.map((sec, sIdx) => ({
        ...sec,
        stepNumber: idx * 6 + sIdx + 1,
        id: `seq-${idx + 1}-${sec.id}`,
        title: `Secuencia ${idx + 1} (${seq.title}) · ${sec.title}`,
      }));
      sections.push(...labeled);
    });
  }

  const trailerSection = buildTrailerSection(project);
  if (trailerSection) {
    sections.push({
      ...trailerSection,
      stepNumber: sections.length + 1,
    });
  }

  const baseGuide: Omit<ExternalProductionGuide, 'markdown' | 'plainText'> = {
    agentName: 'Agente Arthur',
    generatedAt: new Date().toISOString(),
    scope,
    projectTitle: project.title,
    genreStyle: project.genreStyle,
    sequenceTitle:
      scope === 'project'
        ? `${targetSequences.length} ${targetSequences.length === 1 ? 'secuencia' : 'secuencias'}`
        : primarySeq?.title || 'Sin secuencia',
    aspectRatio: primarySeq?.aspectRatio || '16:9',
    targetResolution: primarySeq?.targetResolution || '4K',
    sections,
  };

  return {
    ...baseGuide,
    markdown: renderGuideToMarkdown(baseGuide),
    plainText: renderGuideToPlainText(baseGuide),
  };
}
