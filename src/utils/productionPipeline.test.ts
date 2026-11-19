import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appendDictatedText,
  buildHyperRealisticResolutionSpec,
  formatTimecodeSec,
  getApprovedTimelineMilestones,
  getNanoImageSizeForResolution,
  getSequentialChapterState,
  markChapterCompleted,
  mergeLocalAndCloudProjects,
  normalizeTrailerBeats,
  validateTrailerReadiness,
} from './productionPipeline';
import type { ChapterPlan, ProductionProject, ProductionSequence } from '../types/studio';

function makeSequence(overrides: Partial<ProductionSequence>): ProductionSequence {
  return {
    id: overrides.id || 'seq-1',
    title: overrides.title || 'Secuencia Base',
    versionStatus: overrides.versionStatus || 'draft',
    sourceType: 'book',
    directorStyle: 'Épica Monumental IMAX',
    aspectRatio: '2.39:1',
    targetResolution: '4K',
    cameraSystem: 'ARRI Alexa 65',
    lensPackage: 'Panavision Sphero 65',
    filmStockOrLut: 'Kodak 2383',
    logline: 'Logline de prueba.',
    directorVision: 'Visión de prueba.',
    colorPalette: [],
    lighting: {
      keyLight: 'Sol bajo',
      fillRatio: '4:1',
      rimAndBacklight: 'Dorado',
      colorTemperatureKelvin: '5600K',
      atmosphereAndHaze: 'Polvo dorado',
    },
    shotList: [
      {
        shotNumber: '01A',
        shotType: 'WS',
        lensMm: '35mm',
        movement: 'Dolly lento',
        durationSec: 12,
        framingNote: 'Plano general',
        psychologicalIntent: 'Escala',
      },
      {
        shotNumber: '01B',
        shotType: 'CU',
        lensMm: '85mm',
        movement: 'Fijo',
        durationSec: 8,
        framingNote: 'Primer plano',
        psychologicalIntent: 'Tensión',
      },
    ],
    soundDesign: {
      atmosLayers: ['Viento'],
      subBassCue: '28Hz',
      foleyDetails: ['Pasos'],
      silenceBeats: '1s',
      musicalScore: 'Cuerdas graves',
      tempoBpm: 72,
    },
    vfx: {
      cgiElements: [],
      practicalSfx: [],
      locationsAndSets: 'Desierto',
      wardrobeAndMakeup: 'Traje técnico',
    },
    screenplay: [],
    storyboardFrames: [],
    continuitySummary: 'Resumen de continuidad.',
    createdAt: overrides.createdAt || '2026-11-16T10:00:00.000Z',
    ...overrides,
  };
}

test('resolution mapping produces valid Nano image sizes and hyper-realistic specs', () => {
  assert.equal(getNanoImageSizeForResolution('720p'), '1K');
  assert.equal(getNanoImageSizeForResolution('1080p'), '1K');
  assert.equal(getNanoImageSizeForResolution('2K'), '2K');
  assert.equal(getNanoImageSizeForResolution('4K'), '4K');

  const spec4k = buildHyperRealisticResolutionSpec('4K');
  assert.match(spec4k, /4K Ultra HD/);
  assert.match(spec4k, /3840×2160/);
});

test('appendDictatedText appends microphone dictation cleanly to continuity bible', () => {
  assert.equal(appendDictatedText('', '  Nota inicial. '), 'Nota inicial.');
  assert.equal(
    appendDictatedText('Regla 1.', 'El abrigo es azul oscuro.'),
    'Regla 1.\nEl abrigo es azul oscuro.'
  );
  assert.equal(appendDictatedText('Regla 1.', '   '), 'Regla 1.');
});

test('getApprovedTimelineMilestones filters only final sequences and orders chronologically by chapter/date', () => {
  const project: ProductionProject = {
    id: 'p1',
    title: 'Saga',
    genreStyle: 'Épica',
    defaultSourceType: 'book',
    continuityBible: '',
    createdAt: '2026-11-16T10:00:00.000Z',
    updatedAt: '2026-11-16T12:00:00.000Z',
    sequences: [
      makeSequence({
        id: 'seq-draft',
        title: 'Capítulo 3 (Borrador)',
        versionStatus: 'draft',
        chapterIndex: 3,
        createdAt: '2026-11-16T12:00:00.000Z',
      }),
      makeSequence({
        id: 'seq-2',
        title: 'Capítulo 2: El Faro',
        versionStatus: 'final',
        chapterIndex: 2,
        createdAt: '2026-11-16T11:00:00.000Z',
      }),
      makeSequence({
        id: 'seq-1',
        title: 'Capítulo 1: El Muelle',
        versionStatus: 'final',
        chapterIndex: 1,
        createdAt: '2026-11-16T10:30:00.000Z',
      }),
    ],
  };

  const milestones = getApprovedTimelineMilestones(project);
  assert.equal(milestones.length, 2);
  assert.equal(milestones[0].sequenceId, 'seq-1');
  assert.equal(milestones[0].milestoneNumber, 1);
  assert.equal(milestones[0].durationSec, 20);
  assert.equal(milestones[1].sequenceId, 'seq-2');
  assert.equal(milestones[1].milestoneNumber, 2);
});

test('sequential chapter state enforces strict 1-by-1 order', () => {
  const plan: ChapterPlan = {
    sourceFilename: 'novela.pdf',
    sourceType: 'book',
    createdAt: '2026-11-17T10:00:00.000Z',
    chapters: [
      {
        index: 1,
        title: 'Capítulo 1',
        summary: 'Inicio',
        keyCharacters: ['Elena'],
        estimatedStartHint: 'Pág 1',
        sourceExcerpt: 'Texto 1',
        status: 'pending',
      },
      {
        index: 2,
        title: 'Capítulo 2',
        summary: 'Nudo',
        keyCharacters: ['Elena'],
        estimatedStartHint: 'Pág 18',
        sourceExcerpt: 'Texto 2',
        status: 'pending',
      },
    ],
  };

  const s1 = getSequentialChapterState(plan);
  assert.equal(s1.nextChapter?.index, 1);
  assert.equal(s1.canProduceIndex(1), true);
  assert.equal(s1.canProduceIndex(2), false);

  const updated = markChapterCompleted(plan, 1, 'seq-ch1');
  const s2 = getSequentialChapterState(updated);
  assert.equal(s2.completedCount, 1);
  assert.equal(s2.nextChapter?.index, 2);
  assert.equal(s2.canProduceIndex(1), false);
  assert.equal(s2.canProduceIndex(2), true);

  const done = markChapterCompleted(updated, 2, 'seq-ch2');
  const s3 = getSequentialChapterState(done);
  assert.equal(s3.isComplete, true);
  assert.equal(s3.nextChapter, null);
});

test('validateTrailerReadiness requires at least one final approved sequence', () => {
  const draftProject: ProductionProject = {
    id: 'p1',
    title: 'Test',
    genreStyle: 'Noir',
    defaultSourceType: 'story',
    continuityBible: 'Regla',
    createdAt: '2026-11-16T10:00:00.000Z',
    updatedAt: '2026-11-16T10:00:00.000Z',
    sequences: [makeSequence({ id: 's1', versionStatus: 'draft' })],
  };

  assert.equal(validateTrailerReadiness(draftProject).ready, false);

  const readyProject: ProductionProject = {
    ...draftProject,
    sequences: [makeSequence({ id: 's1', versionStatus: 'final' })],
  };
  const check = validateTrailerReadiness(readyProject);
  assert.equal(check.ready, true);
  assert.equal(check.approvedSequences.length, 1);
});

test('normalizeTrailerBeats produces contiguous 30-second timeline cuts', () => {
  const approved = [makeSequence({ id: 'seq-a', title: 'Escena A', versionStatus: 'final' })];
  const beats = normalizeTrailerBeats(
    [
      { durationSec: 5, visualDescription: 'Corte 1', onScreenTitleCard: 'ESTE AÑO' },
      { durationSec: 6, visualDescription: 'Corte 2' },
      { durationSec: 7, visualDescription: 'Corte 3' },
      { durationSec: 6, visualDescription: 'Corte 4' },
      { durationSec: 6, visualDescription: 'Corte 5' },
    ],
    approved
  );

  assert.equal(beats.length, 5);
  assert.equal(beats[0].startSec, 0);
  assert.equal(beats[beats.length - 1].endSec, 30);
  assert.equal(
    beats.reduce((sum, b) => sum + b.durationSec, 0),
    30
  );
  assert.equal(formatTimecodeSec(30), '00:30');
});

test('mergeLocalAndCloudProjects preserves server-only assets, chapterPlan, and trailer', () => {
  const localProj: ProductionProject = {
    id: 'p1',
    title: 'Libro',
    genreStyle: 'IMAX',
    defaultSourceType: 'book',
    continuityBible: 'Biblia extendida con notas locales',
    assets: [
      {
        id: 'a1',
        filename: 'libro.pdf',
        kind: 'document',
        mimeType: 'application/pdf',
        sizeBytes: 1200,
        url: '/workspace-assets/u/p1/libro.pdf',
        createdAt: '2026-11-17T10:00:00.000Z',
      },
    ],
    chapterPlan: {
      sourceFilename: 'libro.pdf',
      sourceType: 'book',
      createdAt: '2026-11-17T10:00:00.000Z',
      chapters: [],
    },
    createdAt: '2026-11-17T10:00:00.000Z',
    updatedAt: '2026-11-17T10:00:00.000Z',
    sequences: [],
  };

  const cloudProj: ProductionProject = {
    id: 'p1',
    title: 'Libro',
    genreStyle: 'IMAX',
    defaultSourceType: 'book',
    continuityBible: 'Biblia',
    createdAt: '2026-11-17T10:00:00.000Z',
    updatedAt: '2026-11-17T10:00:00.000Z',
    sequences: [],
  };

  const merged = mergeLocalAndCloudProjects([localProj], [cloudProj]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].assets?.length, 1);
  assert.equal(merged[0].chapterPlan?.sourceFilename, 'libro.pdf');
  assert.equal(merged[0].continuityBible, 'Biblia extendida con notas locales');
});
